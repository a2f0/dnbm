import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ClickEvent } from "@a2f0/ct-client";
import { createSiteTracker } from "@a2f0/dnbm-synth/standalone/tracking";
import { type Browser, chromium, type Page } from "playwright-core";
import { buildWeb, DIST, ROOT } from "../scripts/build/build";

const ORIGIN = "https://dnbm.a2f0.net";
const COLLECTOR = "https://ct.a2f0.net/v1/clicks";
interface Batch {
  site: string;
  environment: string;
  events: ClickEvent[];
}
interface Preferences {
  gpc?: boolean;
  dnt?: boolean;
  webdriver?: boolean;
  extension?: boolean;
  saved?: boolean;
}

describe("standalone click tracking", () => {
  let browser: Browser;
  let server: ReturnType<typeof Bun.serve>;
  const headers: Record<string, string> = {};

  beforeAll(async () => {
    await buildWeb(true);
    for (const line of (await Bun.file(join(DIST, "_headers")).text()).split("\n")) {
      const match = /^\s+([\w-]+):\s*(.+)$/.exec(line);
      if (match?.[1] && match[2]) headers[match[1]] = match[2];
    }
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        const file = Bun.file(join(DIST, path.endsWith("/") ? `${path}index.html` : path));
        return file.size > 0
          ? new Response(file, { headers })
          : new Response("Not found", { status: 404 });
      },
    });
    browser = await chromium.launch({ channel: "chrome", headless: true });
  }, 60_000);

  // The first page a newly launched Chrome loads pays its cold start, which on CI
  // runners takes several seconds, close to or past Bun's 5 s default for each test,
  // while every later page loads in under a second. Load one page here, in a context
  // of its own and with its own budget, so no test depends on which one runs first.
  beforeAll(async () => {
    const { context } = await open("/");
    await context.close();
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    await server?.stop(true);
  });

  async function open(
    path: string,
    preferences: Preferences = {},
    origin = ORIGIN,
    replacements: Record<string, { body: string; contentType: string }> = {},
  ) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const batches: Batch[] = [];
    const problems: string[] = [];
    // No browser request can reach CT or another external service, including in
    // positive cases that deliberately simulate a non-automated browser.
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.href === COLLECTOR) {
        batches.push(route.request().postDataJSON() as Batch);
        await route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": origin } });
      } else if (url.origin === origin) {
        const replacement = replacements[url.pathname];
        if (replacement) await route.fulfill(replacement);
        else {
          const response = await route.fetch({ url: new URL(url.pathname, server.url).href });
          await route.fulfill({ response });
        }
      } else {
        problems.push(`Unexpected external request: ${url.origin}`);
        await route.abort();
      }
    });
    await context.addInitScript((settings: Preferences) => {
      Object.defineProperty(navigator, "webdriver", { get: () => settings.webdriver === true });
      Object.defineProperty(navigator, "globalPrivacyControl", {
        get: () => settings.gpc === true,
      });
      Object.defineProperty(navigator, "doNotTrack", { get: () => (settings.dnt ? "1" : "0") });
      if (settings.saved) localStorage.setItem("ct:opt-out", "1");
      if (settings.extension) {
        const disable = () => document.documentElement?.setAttribute("data-ct-disabled", "");
        new MutationObserver(disable).observe(document, { childList: true, subtree: true });
        disable();
      }
    }, preferences);
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    await page.goto(`${origin}${path}`);
    await page.locator("canvas").first().waitFor();
    return { context, page, batches, problems };
  }

  async function flush(page: Page, expectBatch = false): Promise<void> {
    const sent = expectBatch ? page.waitForResponse(COLLECTOR) : undefined;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    // The synthetic lifecycle event flushes real Playwright mouse clicks. It
    // does not synthesize click events, which CT deliberately rejects.
    if (sent) await sent;
    else await page.waitForTimeout(150);
  }

  test("importing and constructing outside a built browser entrypoint stays inert", () => {
    expect(createSiteTracker("sequencer")).toBeUndefined();
    expect(createSiteTracker("player")).toBeUndefined();
  });

  for (const app of ["sequencer", "player"] as const) {
    test(`${app}: GPC override captures one event per shadow button and canvas click`, async () => {
      const path = app === "player" ? "/player/" : "/";
      const { context, page, batches, problems } = await open(`${path}?private=secret#hidden`, {
        gpc: true,
      });
      try {
        const button = app === "player" ? ".control.shuffle" : 'button:text-is("loop")';
        await page.locator(button).click();
        await page.locator("canvas").first().click();
        if (app === "sequencer") {
          await page.locator("input.title").fill("private song title");
          await page.locator("input.title").click();
        }
        await flush(page, true);
        expect(batches).toHaveLength(1);
        expect(batches[0]).toMatchObject({ site: "dnbm", environment: "production" });
        const events = batches.flatMap((batch) => batch.events);
        expect(events).toHaveLength(2);
        expect(events.map(({ target }) => target)).toEqual(["button", "canvas"]);
        for (const event of events) {
          expect(event).toMatchObject({
            app,
            page: app === "player" ? "/player" : "/",
            label: null,
          });
          expect(Object.keys(event).sort()).toEqual([
            "app",
            "id",
            "label",
            "page",
            "target",
            "timestamp",
          ]);
        }
        expect(JSON.stringify(batches)).not.toMatch(/private|secret|hidden|Undertow|https:|song/);
        expect(problems).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  for (const preference of ["dnt", "webdriver", "extension", "saved"] as const) {
    test(`${preference} still stops capture with GPC override`, async () => {
      const { context, page, batches, problems } = await open("/", {
        gpc: true,
        [preference]: true,
      });
      try {
        await page.locator('button:text-is("loop")').click();
        await page.locator("canvas").first().click();
        await flush(page);
        expect(batches).toEqual([]);
        expect(problems).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test("opting out after a click discards the pending queue", async () => {
    const { context, page, batches } = await open("/");
    try {
      await page.locator('button:text-is("loop")').click();
      await page.evaluate(() => {
        document.documentElement.setAttribute("data-ct-disabled", "");
        document.dispatchEvent(new Event("ct:opt-out-change"));
      });
      await flush(page);
      expect(batches).toEqual([]);
    } finally {
      await context.close();
    }
  });

  for (const origin of [
    "https://preview.example.com",
    "http://dnbm.a2f0.net",
    "http://localhost:8174",
  ]) {
    test(`production assets refuse tracking on ${origin}`, async () => {
      const { context, page, batches, problems } = await open("/", {}, origin);
      try {
        await page.locator("canvas").first().click();
        await flush(page);
        expect(batches).toEqual([]);
        expect(problems).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test("development builds remain inert even on the production origin", async () => {
    const result = await Bun.build({
      entrypoints: [join(ROOT, "packages/sequencer/src/main.ts")],
      target: "browser",
      format: "esm",
      define: { __DNBM_PRODUCTION__: "false" },
    });
    expect(result.success).toBe(true);
    const body = await result.outputs[0]?.text();
    expect(body).toBeDefined();
    const { context, page, batches } = await open("/", {}, ORIGIN, {
      "/main.js": { body: body ?? "", contentType: "text/javascript" },
    });
    try {
      await page.locator("canvas").first().click();
      await flush(page);
      expect(batches).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("mount APIs never self-track, even embedded on the production origin", async () => {
    const result = await Bun.build({
      entrypoints: [join(ROOT, "src/index.ts")],
      target: "browser",
      format: "esm",
    });
    expect(result.success).toBe(true);
    const body = await result.outputs[0]?.text();
    expect(body).toBeDefined();
    for (const path of ["mount.js", "player/mount.js"]) {
      expect(await Bun.file(join(DIST, path)).text()).not.toContain("ct.a2f0.net");
    }
    const { context, page, batches, problems } = await open("/embedded-host", {}, ORIGIN, {
      "/loader.js": { body: body ?? "", contentType: "text/javascript" },
      "/embedded-host": {
        contentType: "text/html",
        body: `<!doctype html><div id="editor" style="width:1200px;height:800px"></div>
<div id="player" style="width:440px;height:420px"></div><script type="module" src="/embed.js"></script>`,
      },
      "/embed.js": {
        contentType: "text/javascript",
        body: `import { mountDnbm, mountDnbmPlayer } from "/loader.js";
mountDnbm(document.getElementById("editor"), { assetsUrl: "/" });
mountDnbmPlayer(document.getElementById("player"), { assetsUrl: "/" });`,
      },
    });
    try {
      await page.locator("#editor canvas").click();
      await page.locator("#player .control.shuffle").click();
      await flush(page);
      expect(batches).toEqual([]);
      expect(problems).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
