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
  TEARDOWN_TIMEOUT,
} from "./chrome";

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
      const browser = await launchChrome();
      const pid = await browserProcess(browser);
      const page = await browser.newPage();
      await page.goto("data:text/html,<p>hung</p>");
      // A stopped Chrome answers nothing, as a hung one wouldn't.
      process.kill(pid, "SIGSTOP");
      const warn = spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        await closeChrome(browser, 500);
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
});
