// The editor's layout at the sizes it meets embedded in windows and on small screens.
// Needs Google Chrome, like the package's browser suite.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type Browser, chromium } from "playwright-core";
import { build, DIST } from "../../scripts/build";

interface Layout {
  readonly topBar: number;
  readonly pageScrolls: boolean;
  readonly overflowsSideways: boolean;
  readonly gridScrolls: boolean;
  readonly stacked: boolean;
}

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  await build();
  server = Bun.serve({
    hostname: "localhost",
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      const file = Bun.file(join(DIST, path === "/" ? "index.html" : path));
      return file.size > 0 ? new Response(file) : new Response("Not found", { status: 404 });
    },
  });
  browser = await chromium.launch({ channel: "chrome", headless: true });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
});

/** Opens the example song embedded at a size and measures the layout. */
async function layout(width: number, height: number): Promise<Layout> {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(new URL("/?embed=1", server.url).href);
    await page.waitForSelector(".cell");
    return await page.evaluate(() => {
      const root = document.documentElement;
      const grid = document.querySelector(".grid-scroll");
      const lower = document.querySelector(".lower");
      if (!grid || !lower) throw new Error("the editor did not render");
      return {
        topBar: document.querySelector(".topbar")?.getBoundingClientRect().height ?? 0,
        pageScrolls: root.scrollHeight > innerHeight,
        overflowsSideways: root.scrollWidth > innerWidth,
        gridScrolls: grid.scrollHeight > grid.clientHeight,
        stacked: getComputedStyle(lower).gridTemplateColumns.split(" ").length === 1,
      };
    });
  } finally {
    await page.close();
  }
}

describe("layout", () => {
  test("a fitted 1200 by 800 window shows everything on one screen", async () => {
    const fitted = await layout(1200, 800);
    expect(fitted.topBar).toBeLessThan(60);
    expect(fitted).toMatchObject({
      pageScrolls: false,
      overflowsSideways: false,
      gridScrolls: false,
      stacked: false,
    });
  });

  test("a short window keeps the desktop arrangement and scrolls the page, not the grid", async () => {
    expect(await layout(880, 520)).toMatchObject({
      pageScrolls: true,
      overflowsSideways: false,
      gridScrolls: false,
      stacked: false,
    });
  });

  test("the panels stack at 720px wide and below", async () => {
    expect((await layout(721, 700)).stacked).toBe(false);
    expect(await layout(720, 700)).toMatchObject({ stacked: true, overflowsSideways: false });
    expect(await layout(390, 844)).toMatchObject({ stacked: true, overflowsSideways: false });
  });
});
