// The site's own pages from the packed package (support.ts holds it and the shared
// Chrome).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "playwright-core";
import { packedPackage, ROOT, SETUP_TIMEOUT, serve, sharedChrome } from "./support";

// The site's own pages, as dnbm.a2f0.net serves them: under its content security
// policy, they mount the apps through the same shell and app modules as a host.
describe("the packaged site's own pages", () => {
  let browser: Browser;
  let server: ReturnType<typeof serve>;

  beforeAll(async () => {
    const text = await readFile(join(ROOT, "packages", "sequencer", "_headers"), "utf8");
    const headers: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const match = /^\s+([\w-]+):\s*(.+)$/.exec(line);
      if (match?.[1] && match[2]) headers[match[1]] = match[2];
    }
    expect(headers["Content-Security-Policy"]).toContain("style-src 'self'");
    const { installed } = await packedPackage();
    server = serve({ "/": join(installed, "site") }, { headers });
    browser = await sharedChrome();
  }, SETUP_TIMEOUT);

  afterAll(() => server?.stop(true));

  /** Opens a page, collecting errors and content security policy violations. */
  async function open(path: string): Promise<{ page: Page; problems: string[] }> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    await page.goto(new URL(path, server.url).href);
    return { page, problems };
  }

  test("the sequencer shows its wordmark, titles the page with the song, and plays", async () => {
    const { page, problems } = await open("/");
    try {
      await page.locator(".cell").first().waitFor();
      expect(await page.locator(".brand").isVisible()).toBe(true);
      expect(await page.title()).toBe("Undertow · Drum and Bass Sequencer · dnbm");
      await page.locator(".play").click();
      await page.locator(".cell.now").first().waitFor({ timeout: 10_000 });
      await page.locator('.grid-row[data-track="0"] .cell').nth(1).click();
      expect(await page.title()).toBe("● Undertow · Drum and Bass Sequencer · dnbm");
      expect(problems).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);

  test("the player lists every example song and plays one", async () => {
    const { page, problems } = await open("/player/");
    try {
      await page.locator(".track").first().waitFor();
      expect(await page.locator(".bar").isVisible()).toBe(true);
      expect(await page.locator(".track").count()).toBeGreaterThan(1);
      await page.locator(".control.play").click();
      const time = await page.waitForSelector(".time");
      await page.waitForFunction((element) => element.textContent !== "0:00", time, {
        timeout: 15_000,
      });
      expect(problems).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);
});
