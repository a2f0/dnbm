// The Chrome the browser suites share (chrome.ts): its switches, and its teardown when
// Chrome won't close.

import { describe, expect, spyOn, test } from "bun:test";
import {
  browserProcess,
  closeChrome,
  DISABLED_FEATURES,
  LAUNCH_TIMEOUT,
  launchChrome,
  PLAYWRIGHT_DISABLED_FEATURES,
  running,
  TEARDOWN_TIMEOUT,
} from "./chrome";

/** Launches Chrome with a page, then stops it, so it answers nothing, as a hung one wouldn't. */
async function hungChrome() {
  const browser = await launchChrome();
  const pid = await browserProcess(browser);
  const page = await browser.newPage();
  await page.goto("data:text/html,<p>hung</p>");
  process.kill(pid, "SIGSTOP");
  return { browser, pid };
}

describe("the browser suites' Chrome", () => {
  test(
    "disables the features playwright-core does, and the key collection",
    async () => {
      const browser = await launchChrome();
      try {
        const pid = await browserProcess(browser);
        const command = Bun.spawnSync(["ps", "-ww", "-o", "command=", "-p", String(pid)]);
        const lists = [...command.stdout.toString().matchAll(/--disable-features=(\S+)/g)].map(
          ([, list = ""]) => list.split(","),
        );
        // playwright-core's switch, then ours, the one Chrome reads.
        expect(lists).toEqual([PLAYWRIGHT_DISABLED_FEATURES, DISABLED_FEATURES]);
      } finally {
        await closeChrome(browser);
      }
    },
    LAUNCH_TIMEOUT + TEARDOWN_TIMEOUT,
  );

  test(
    "kills a Chrome that doesn't close in its budget, and says so",
    async () => {
      const { browser, pid } = await hungChrome();
      const warn = spyOn(console, "warn").mockImplementation(() => undefined);
      // Playwright's close can settle before the killed process is reaped; report it
      // alive at the first check so the close has to wait for it to go.
      const checks: boolean[] = [];
      const alive = (target: number) => {
        const answer = checks.length === 0 || running(target);
        checks.push(answer);
        return answer;
      };
      try {
        await closeChrome(browser, 500, alive);
        expect(checks[0]).toBe(true);
        expect(checks.at(-1)).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain("so it was killed");
      } finally {
        warn.mockRestore();
      }
      expect(browser.isConnected()).toBe(false);
      expect(running(pid)).toBe(false);
    },
    LAUNCH_TIMEOUT + TEARDOWN_TIMEOUT,
  );

  test(
    "fails when a killed Chrome's processes outlast the kill budget",
    async () => {
      const { browser, pid } = await hungChrome();
      try {
        await expect(closeChrome(browser, 500, () => true)).rejects.toThrow(
          `Chrome (pid ${pid}) didn't exit within`,
        );
      } finally {
        await closeChrome(browser);
      }
      expect(running(pid)).toBe(false);
    },
    LAUNCH_TIMEOUT + 2 * TEARDOWN_TIMEOUT,
  );
});
