// The real packed renderer's bytes and download name must identify the same score.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderSong } from "@a2f0/dnbm-synth/audio/offline";
import type { RenderReply, RenderRequest } from "@a2f0/dnbm-synth/audio/renderWorker";
import { WasmEngine } from "@a2f0/dnbm-synth/audio/wasmEngine";
import { encodeWav } from "@a2f0/dnbm-synth/audio/wav";
import { parseSongText } from "@a2f0/dnbm-synth/song/format";
import type { Download, Page } from "playwright-core";
import { TEARDOWN_TIMEOUT } from "../../scripts/testing/chrome";
import {
  type HostPage,
  type HostWindow,
  openHostPage,
  packedPackage,
  SETUP_TIMEOUT,
} from "./support";

interface ExportRecord {
  request?: Pick<RenderRequest, "song" | "sampleRate">;
  reply?: RenderReply;
  terminated: boolean;
  release(): void;
}

interface ExportWindow extends HostWindow {
  exports: ExportRecord[];
  engineBarrier: { entered: boolean; release(): void };
}

/** Pause after the real engine bytes arrive, before renderWav reads the score. */
function holdEngine(): void {
  const host = window as unknown as ExportWindow;
  const { promise, resolve } = Promise.withResolvers<void>();
  host.engineBarrier = { entered: false, release: resolve };
  const native = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = async function (this: Response) {
    const bytes = await native.call(this);
    if (this.url.endsWith("/engine.wasm")) {
      Response.prototype.arrayBuffer = native;
      host.engineBarrier.entered = true;
      await promise;
    }
    return bytes;
  };
}

/** Hold only delivery of real terminal worker replies, never the render or its input. */
function instrumentExports(): void {
  const host = window as unknown as ExportWindow;
  host.exports = [];
  const NativeWorker = Worker;
  window.Worker = class extends NativeWorker {
    private readonly record: ExportRecord;

    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      let releasing = false;
      this.record = {
        terminated: false,
        release: () => {
          if (!this.record.reply) throw new Error("render has not reached the reply barrier");
          releasing = true;
          this.dispatchEvent(new MessageEvent("message", { data: this.record.reply }));
        },
      };
      host.exports.push(this.record);
      this.addEventListener("message", (event: MessageEvent<RenderReply>) => {
        if (!releasing && event.data.type !== "progress") {
          event.stopImmediatePropagation();
          this.record.reply = event.data;
        }
      });
    }

    override postMessage(
      message: RenderRequest,
      transfer: Transferable[] | StructuredSerializeOptions = [],
    ): void {
      this.record.request = { song: structuredClone(message.song), sampleRate: message.sampleRate };
      if (Array.isArray(transfer)) super.postMessage(message, transfer);
      else super.postMessage(message, transfer);
    }

    override terminate(): void {
      this.record.terminated = true;
      super.terminate();
    }
  };
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("WAV export identity in the packed app", () => {
  let host: HostPage;
  let page: Page;
  let installed: string;
  const errors: string[] = [];
  const references = new Map<string, string>();

  beforeAll(async () => {
    ({ installed } = await packedPackage());
    host = await openHostPage(errors);
    ({ page } = host);
  }, SETUP_TIMEOUT);

  afterAll(() => host?.close(), TEARDOWN_TIMEOUT);

  beforeEach(async () => {
    errors.length = 0;
    await page.unrouteAll({ behavior: "wait" });
    await page.goto(host.url);
    await page.evaluate(instrumentExports);
    await page.evaluate(() => {
      localStorage.clear();
      return (window as unknown as HostWindow).mountSequencer();
    });
  });

  async function selectSong(title: string): Promise<void> {
    await page
      .locator('#window select[aria-label="Open an example song"]')
      .selectOption({ label: title });
    await page.waitForFunction(
      (title) => (window as unknown as HostWindow).sequencerApp?.state.title === title,
      title,
    );
  }

  async function startExport(index = 0): Promise<void> {
    await page.locator('#window .files button:text-is("export")').click();
    await waitForReply(index);
  }

  async function waitForReply(index = 0): Promise<void> {
    await page.waitForFunction(
      (index) => (window as unknown as ExportWindow).exports[index]?.reply !== undefined,
      index,
      { timeout: 20_000 },
    );
  }

  async function releaseExport(index = 0): Promise<Download> {
    const download = page.waitForEvent("download");
    await page.evaluate(
      (index) => (window as unknown as ExportWindow).exports[index]?.release(),
      index,
    );
    return download;
  }

  async function reference(slug: string): Promise<string> {
    const saved = references.get(slug);
    if (saved) return saved;
    const song = parseSongText(
      await Bun.file(join(installed, "site", "songs", `${slug}.dnbm.json`)).text(),
    );
    const engine = await WasmEngine.create(
      await Bun.file(join(installed, "site", "engine.wasm")).arrayBuffer(),
      48_000,
    );
    const rendered = renderSong(engine, song);
    const hash = sha256(encodeWav(rendered.left, rendered.right, rendered.sampleRate));
    references.set(slug, hash);
    return hash;
  }

  async function verifyDownload(
    download: Download,
    title: string,
    slug: string,
    index = 0,
    filename = `${slug}.wav`,
  ): Promise<void> {
    const path = await download.path();
    if (!path) throw new Error("no downloaded WAV");
    const hash = sha256(await readFile(path));
    const worker = await page.evaluate(async (index) => {
      const record = (window as unknown as ExportWindow).exports[index];
      if (record?.reply?.type !== "done") throw new Error("no real completed render");
      return {
        title: record.request?.song.title,
        sampleRate: record.request?.sampleRate,
        sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", record.reply.wav)))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
        terminated: record.terminated,
      };
    }, index);
    const expectedHash = await reference(slug);
    console.info(
      JSON.stringify({
        title,
        filename: download.suggestedFilename(),
        sha256: hash,
        expectedHash,
        worker,
      }),
    );
    expect(worker.title).toBe(title);
    expect(worker.sampleRate).toBe(48_000);
    expect(hash).toBe(worker.sha256);
    expect(hash).toBe(expectedHash);
    expect(worker.terminated).toBe(true);
    expect(errors).toEqual([]);
    expect(download.suggestedFilename()).toBe(filename);
    expect(await page.locator("#window .status-message").textContent()).toBe(
      `Exported ${filename}.`,
    );
    expect(await page.title()).toBe("host");
  }

  async function editTitle(title: string): Promise<void> {
    await page.locator("#window .title").fill(title);
    await page.locator("#window .title").press("Tab");
    expect(
      await page.evaluate(() => (window as unknown as HostWindow).sequencerApp?.state.title),
    ).toBe(title);
  }

  async function startAtEngineBarrier(): Promise<void> {
    await page.evaluate(holdEngine);
    await page.locator('#window .files button:text-is("export")').click();
    await page.waitForFunction(() => (window as unknown as ExportWindow).engineBarrier.entered);
    expect(await page.evaluate(() => (window as unknown as ExportWindow).exports.length)).toBe(0);
  }

  test("switching songs after render capture keeps Wraith's name and exact WAV bytes", async () => {
    await selectSong("Wraith");
    await startExport();
    await selectSong("Undertow");
    await verifyDownload(await releaseExport(), "Wraith", "wraith");
  }, 30_000);

  test("editing the title after capture cannot rename the completed render", async () => {
    await selectSong("Wraith");
    await startExport();
    await editTitle("Not Wraith / renamed");
    await verifyDownload(await releaseExport(), "Wraith", "wraith");
  }, 30_000);

  test("engine loading still precedes the score and title capture", async () => {
    await selectSong("Wraith");
    await startAtEngineBarrier();
    await selectSong("Undertow");
    await editTitle("Fetch / Captured");
    await page.evaluate(() => (window as unknown as ExportWindow).engineBarrier.release());
    await waitForReply();
    await editTitle("After render");
    await verifyDownload(
      await releaseExport(),
      "Fetch / Captured",
      "undertow",
      0,
      "fetch-captured.wav",
    );
  }, 30_000);

  test("an unchanged export preserves the original WAV bytes", async () => {
    await selectSong("Wraith");
    await startExport();
    await verifyDownload(await releaseExport(), "Wraith", "wraith");
  }, 30_000);

  test("concurrent exports retain separate identities when completed in reverse order", async () => {
    await selectSong("Wraith");
    await startExport();
    await selectSong("Undertow");
    await startExport(1);
    await verifyDownload(await releaseExport(1), "Undertow", "undertow", 1);
    await editTitle("Later title");
    await verifyDownload(await releaseExport(), "Wraith", "wraith");
  }, 40_000);

  test("destroy before delivery terminates the worker and rejects even a late real reply", async () => {
    const downloads: string[] = [];
    const record = (download: Download) => downloads.push(download.suggestedFilename());
    page.on("download", record);
    try {
      await startExport();
      await page.evaluate(() => (window as unknown as ExportWindow).sequencerApp?.destroy());
      expect(
        await page.evaluate(() => (window as unknown as ExportWindow).exports[0]?.terminated),
      ).toBe(true);
      // Deliver the retained real WAV even after termination: the aborted promise
      // must not allow App's continuation to download it.
      await page.evaluate(() => (window as unknown as ExportWindow).exports[0]?.release());
      await page.waitForTimeout(500); // Negative no-download window, not race scheduling.
      expect(downloads).toEqual([]);
      expect(await page.locator("#window > div").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      page.off("download", record);
    }
  }, 30_000);

  test("destroy during engine loading starts no worker or download", async () => {
    const downloads: string[] = [];
    const record = (download: Download) => downloads.push(download.suggestedFilename());
    page.on("download", record);
    try {
      await startAtEngineBarrier();
      await page.evaluate(() => {
        const host = window as unknown as ExportWindow;
        host.sequencerApp?.destroy();
        host.engineBarrier.release();
      });
      await page.waitForTimeout(500); // Negative no-worker/no-download window.
      expect(await page.evaluate(() => (window as unknown as ExportWindow).exports.length)).toBe(0);
      expect(downloads).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      page.off("download", record);
    }
  }, 30_000);

  test("a real worker failure cleans up without downloading and the next export succeeds", async () => {
    const downloads: string[] = [];
    const record = (download: Download) => downloads.push(download.suggestedFilename());
    page.on("download", record);
    try {
      await page.route("**/engine.wasm", (route) => route.fulfill({ body: "invalid wasm" }));
      await startExport();
      expect(
        await page.evaluate(() => (window as unknown as ExportWindow).exports[0]?.reply?.type),
      ).toBe("error");
      await page.evaluate(() => (window as unknown as ExportWindow).exports[0]?.release());
      await page.waitForFunction(() => (window as unknown as ExportWindow).exports[0]?.terminated);
      expect(await page.locator("#window .status-message").textContent()).toStartWith(
        "Couldn't export:",
      );
      await page.waitForTimeout(500); // Failure must not produce a late download.
      expect(downloads).toEqual([]);
      await page.unroute("**/engine.wasm");
      await startExport(1);
      await verifyDownload(await releaseExport(1), "Undertow", "undertow", 1);
    } finally {
      page.off("download", record);
    }
  }, 30_000);

  test("engine fetch failure starts no worker and does not poison the next export", async () => {
    await page.route("**/engine.wasm", (route) => route.abort("failed"));
    await page.locator('#window .files button:text-is("export")').click();
    await page.waitForFunction(() =>
      (window as unknown as HostWindow)
        .shadow("window")
        .querySelector(".status-message")
        ?.textContent?.startsWith("Couldn't export:"),
    );
    expect(await page.evaluate(() => (window as unknown as ExportWindow).exports.length)).toBe(0);
    await page.unroute("**/engine.wasm");
    await startExport();
    await verifyDownload(await releaseExport(), "Undertow", "undertow");
  }, 30_000);
});
