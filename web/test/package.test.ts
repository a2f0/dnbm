// Packs @a2f0/dnbm exactly as npm publishes it and uses the tarball as a consumer
// would: no repository sources, only what the package ships.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium, type Frame, type Page } from "playwright-core";
import { buildPackage } from "../../scripts/buildPackage";

const ROOT = join(import.meta.dir, "..", "..");

interface Packed {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

interface Metadata {
  readonly name: string;
  readonly private?: boolean;
  readonly license: string;
  readonly publishConfig?: { readonly access?: string };
  readonly scripts: Record<string, string>;
  readonly exports: Record<string, unknown>;
}

let temporary = "";
let consumer = "";
let installed = "";
let packed: Packed;

beforeAll(async () => {
  await buildPackage();
  temporary = await mkdtemp(join(tmpdir(), "dnbm-package-"));
  consumer = join(temporary, "consumer");
  installed = join(consumer, "node_modules", "@a2f0", "dnbm");
  await mkdir(installed, { recursive: true });
  const output = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  [packed] = JSON.parse(output) as [Packed];
  execFileSync("tar", [
    "-xzf",
    join(temporary, packed.filename),
    "--strip-components=1",
    "-C",
    installed,
  ]);
  await writeFile(
    join(consumer, "package.json"),
    '{ "name": "dnbm-consumer", "type": "module" }\n',
  );
}, 120_000);

afterAll(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

describe("the published package", () => {
  test("ships the app and declarations, and nothing from the repository besides docs", async () => {
    const files = packed.files.map((file) => file.path);
    expect(
      files.filter(
        (file) =>
          !/^(lib\/|site\/|docs\/(package|song-format)\.md$|README\.md$|package\.json$)/.test(file),
      ),
    ).toEqual([]);
    for (const file of [
      "lib/index.js",
      "lib/index.d.ts",
      "lib/build.js",
      "lib/build.d.ts",
      "site/index.html",
      "site/main.js",
      "site/styles.css",
      "site/worklet.js",
      "site/renderWorker.js",
      "site/engine.wasm",
      "site/songs/index.json",
      "site/songs/undertow.dnbm.json",
      "site/song.schema.json",
      "docs/package.md",
    ]) {
      expect(files).toContain(file);
    }
    // Cloudflare reads _headers only at a deployment's root; in a host it would just be served.
    expect(files).not.toContain("site/_headers");

    const metadata = JSON.parse(
      await readFile(join(installed, "package.json"), "utf8"),
    ) as Metadata;
    expect(metadata.name).toBe("@a2f0/dnbm");
    expect(metadata.private).toBeUndefined();
    expect(metadata.license).toBe("UNLICENSED");
    // npm publishes a scoped package as restricted unless told otherwise.
    expect(metadata.publishConfig?.access).toBe("public");
    expect(metadata.scripts["postinstall"]).toBeUndefined();
    expect(metadata.scripts["prepare"]).toBeUndefined();
    expect(Object.keys(metadata.exports)).toEqual([".", "./build", "./assets/*", "./package.json"]);
  });

  test("imports without a DOM, and type-checks in a strict consumer through its exports", async () => {
    await writeFile(
      join(consumer, "entry.ts"),
      `import { mountDnbm, type DnbmInstance, type DnbmOptions } from "@a2f0/dnbm";
import { copyDnbmAssets } from "@a2f0/dnbm/build";

export function mount(container: HTMLElement): DnbmInstance {
  const options: DnbmOptions = { assetsUrl: "/dnbm/", branding: false };
  return mountDnbm(container, options);
}
const copy: (destination: string | URL) => Promise<void> = copyDnbmAssets;
console.log(JSON.stringify({ dom: typeof document, mount: typeof mountDnbm, copy: typeof copy }));
`,
    );
    await writeFile(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
          noEmit: true,
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2023",
          lib: ["es2023", "dom"],
          types: [],
        },
        include: ["entry.ts"],
      }),
    );
    const output = execFileSync("bun", ["entry.ts"], { cwd: consumer, encoding: "utf8" });
    expect(JSON.parse(output)).toEqual({ dom: "undefined", mount: "function", copy: "function" });
    const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
    // tsc prints errors on stdout and exits non-zero, which throws here with them.
    execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
      cwd: consumer,
      encoding: "utf8",
    });
  }, 60_000);

  test("copies an app that serves from a nested path", async () => {
    const { copyDnbmAssets } = (await import(
      pathToFileURL(join(installed, "lib", "build.js")).href
    )) as {
      copyDnbmAssets: (destination: string) => Promise<void>;
    };
    const publicDirectory = join(temporary, "public");
    await copyDnbmAssets(join(publicDirectory, "apps", "dnbm"));
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        const file = Bun.file(
          join(publicDirectory, path.endsWith("/") ? `${path}index.html` : path),
        );
        return file.size > 0 ? new Response(file) : new Response("Not found", { status: 404 });
      },
    });
    try {
      const page = new URL("/apps/dnbm/", server.url);
      const html = await (await fetch(page)).text();
      const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
        (match) => match[1] ?? "",
      );
      // What the page and its scripts load, relative to the page.
      for (const path of [...referenced, "worklet.js", "renderWorker.js", "songs/index.json"]) {
        expect([path, (await fetch(new URL(path, page))).status]).toEqual([path, 200]);
      }
      const wasm = new Uint8Array(await (await fetch(new URL("engine.wasm", page))).arrayBuffer());
      expect([...wasm.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
    } finally {
      await server.stop(true);
    }
  });

  test("mounts the app in a frame, and refuses assets it can't serve", async () => {
    const { mountDnbm } = (await import(
      pathToFileURL(join(installed, "lib", "index.js")).href
    )) as typeof import("../src/package/index");
    const appended: unknown[] = [];
    let removed = false;
    const frame = {
      title: "",
      src: "",
      allow: "",
      style: { cssText: "" },
      remove: () => {
        removed = true;
      },
    };
    const container = {
      ownerDocument: { baseURI: "https://example.com/apps/", createElement: () => frame },
      append: (node: unknown) => appended.push(node),
    } as unknown as HTMLElement;

    const app = mountDnbm(container, { assetsUrl: "../static/dnbm" });
    expect(appended).toEqual([frame]);
    expect(frame.src).toBe("https://example.com/static/dnbm/index.html?embed=1");
    expect(frame.allow).toBe("autoplay");
    expect(frame.title).toBe("dnbm drum and bass sequencer");
    app.destroy();
    expect(removed).toBe(true);

    mountDnbm(container, { assetsUrl: "/dnbm/", branding: true, title: "dnbm" });
    expect([frame.src, frame.title]).toEqual(["https://example.com/dnbm/index.html", "dnbm"]);
    expect(() => mountDnbm(container, { assetsUrl: "file:///dnbm/" })).toThrow("HTTP or HTTPS");
    expect(() => mountDnbm(container, { assetsUrl: "/dnbm/?v=1" })).toThrow("without a query");
  });
});

/** Serves a directory over HTTP, mapping directory URLs to their index.html. */
function serveDirectory(directory: string, hostname: string) {
  return Bun.serve({
    hostname,
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      const file = Bun.file(join(directory, path.endsWith("/") ? `${path}index.html` : path));
      return file.size > 0 ? new Response(file) : new Response("Not found", { status: 404 });
    },
  });
}

// The packaged app in a real browser, in a cross-origin frame: the strictest place a
// host can embed it, where browsers refuse native dialogs and file pickers. Needs
// Google Chrome, as on GitHub's runners.
describe("the packaged app embedded in a cross-origin frame", () => {
  let browser: Browser;
  let page: Page;
  let frame: Frame;
  let servers: { stop: (force?: boolean) => Promise<void> }[] = [];

  beforeAll(async () => {
    const assets = join(temporary, "cross-origin-assets");
    const host = join(temporary, "cross-origin-host");
    const { copyDnbmAssets } = (await import(
      pathToFileURL(join(installed, "lib", "build.js")).href
    )) as {
      copyDnbmAssets: (destination: string) => Promise<void>;
    };
    await copyDnbmAssets(join(assets, "dnbm"));
    await mkdir(host, { recursive: true });
    await writeFile(join(host, "dnbm.js"), await readFile(join(installed, "lib", "index.js")));
    const assetServer = serveDirectory(assets, "localhost");
    await writeFile(
      join(host, "index.html"),
      `<!doctype html><meta charset="utf-8"><title>host</title>
<div id="window" style="width:1200px;height:800px"></div>
<script type="module">
  import { mountDnbm } from "/dnbm.js";
  window.remount = () => {
    window.dnbm?.destroy();
    window.dnbm = mountDnbm(document.getElementById("window"), { assetsUrl: "${new URL("/dnbm/", assetServer.url).href}" });
  };
  window.remount();
</script>`,
    );
    const hostServer = serveDirectory(host, "127.0.0.1");
    servers = [assetServer, hostServer];
    // No autoplay override: audio must start from a click inside the frame.
    browser = await chromium.launch({ channel: "chrome", headless: true });
    page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 860 } });
    await page.goto(hostServer.url.href);
    const element = await page.waitForSelector("iframe");
    const content = await element.contentFrame();
    if (!content) throw new Error("the iframe has no content frame");
    frame = content;
    await frame.waitForSelector(".cell");
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    for (const server of servers) await server.stop(true);
  });

  test("loads embedded, without the wordmark", async () => {
    expect(new URL(frame.url()).searchParams.get("embed")).toBe("1");
    expect(await frame.locator(".brand").isVisible()).toBe(false);
  });

  test("starts audio from a click in the frame", async () => {
    await frame.click(".play");
    // The playhead moves only when the worklet reports steps from the running engine.
    await frame.waitForSelector(".cell.now", { timeout: 10_000 });
    await frame.click(".play");
  }, 20_000);

  test("asks before discarding edits with an in-app dialog", async () => {
    await frame.locator('.grid-row[data-track="0"] .cell').nth(1).click();
    await frame.click('button:text-is("new")');
    const dialog = frame.getByRole("dialog", { name: "Discard unsaved changes to this song?" });
    await dialog.waitFor();
    await dialog.locator('button:text-is("discard")').click();
    await frame.waitForFunction(
      () => document.querySelector<HTMLInputElement>(".title")?.value === "Untitled",
    );
  }, 20_000);

  test("cancel and Escape keep unsaved edits", async () => {
    const step = frame.locator('.grid-row[data-track="0"] .cell').nth(2);
    await step.click();
    expect(await step.getAttribute("class")).toContain("hit");
    for (const dismiss of ["cancel", "Escape"]) {
      await frame.click('button:text-is("new")');
      const dialog = frame.getByRole("dialog", { name: "Discard unsaved changes to this song?" });
      await dialog.waitFor();
      if (dismiss === "cancel") await dialog.locator('button:text-is("cancel")').click();
      else await frame.press("dialog[open]", "Escape");
      await dialog.waitFor({ state: "detached" });
      expect([dismiss, await step.getAttribute("class")]).toEqual([
        dismiss,
        expect.stringContaining("hit"),
      ]);
    }
  }, 20_000);

  test("renames a pattern through an in-app prompt, and keeps it on cancel", async () => {
    const prompt = frame.getByRole("dialog", { name: /Pattern id/ });
    await frame.click('button:text-is("rename")');
    await prompt.waitFor();
    expect(await prompt.locator("input").inputValue()).toBe("a");
    await prompt.locator("input").fill("intro");
    await prompt.locator("input").press("Enter");
    await frame.waitForSelector('.tab[data-pattern="intro"]');
    expect(await frame.locator(".chip").allTextContents()).toEqual(["intro"]);

    await frame.click('button:text-is("rename")');
    await prompt.locator("input").fill("ignored");
    await prompt.locator('button:text-is("cancel")').click();
    await prompt.waitFor({ state: "detached" });
    expect(await frame.locator(".tab").allTextContents()).toEqual(["intro"]);
  }, 20_000);

  test("saves by downloading when the frame may not show a file picker", async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      frame.click('button:text-is("save")'),
    ]);
    expect(download.suggestedFilename()).toBe("untitled.dnbm.json");
    // The rename test's edit is unsaved; saving marks the song clean.
  }, 20_000);

  test("keeps an edit made just before the host destroys and remounts the app", async () => {
    await frame.fill(".title", "Night Bus");
    // Commit the edit, then destroy and remount at once: milliseconds, not the
    // hundreds a delayed autosave would need.
    await frame.evaluate(() =>
      document.querySelector(".title")?.dispatchEvent(new Event("change")),
    );
    await page.evaluate(() => (window as unknown as { remount(): void }).remount());
    const element = await page.waitForSelector("iframe");
    const content = await element.contentFrame();
    if (!content) throw new Error("the iframe has no content frame");
    frame = content;
    await frame.waitForSelector(".cell");
    expect(await frame.inputValue(".title")).toBe("Night Bus");
  }, 20_000);

  test("destroy removes the frame", async () => {
    await page.evaluate(() => (window as unknown as { dnbm: { destroy(): void } }).dnbm.destroy());
    expect(await page.locator("iframe").count()).toBe(0);
  });
});
