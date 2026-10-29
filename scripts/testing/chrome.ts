// Google Chrome for the browser suites, through playwright-core. Launching and closing
// each have their own measured budget, and a Chrome that overruns its graceful close is
// killed, so a slow host can't fail a suite whose tests passed.

import { type Browser, chromium, type LaunchOptions } from "playwright-core";

/**
 * The features playwright-core 1.64 disables (its `chromiumSwitches`). Chrome reads only
 * the last `--disable-features`, so ours repeats them; `chrome.test.ts` fails when
 * playwright-core's list changes.
 */
export const PLAYWRIGHT_DISABLED_FEATURES = [
  "AvoidUnnecessaryBeforeUnloadCheckSync",
  "DestroyProfileOnBrowserClose",
  "DialMediaRouteProvider",
  "GlobalMediaControls",
  "HttpsUpgrades",
  "LensOverlay",
  "MediaRouter",
  "PaintHolding",
  "ThirdPartyStoragePartitioning",
  "BlockOriginHeaderModificationOnRedirect",
  "AvoidCorsURLLoaderRestartOnRedirect",
  "Translate",
  "AutoDeElevate",
  "OptimizationHints",
  "NetworkTimeServiceQuerying",
  "AimEnabled",
  "msForceBrowserSignIn",
  "msEdgeUpdateLaunchServicesPreferredVersion",
];

/**
 * Chrome 156 on macOS garbage-collects its Device Bound Session Credentials keys whenever
 * an off-the-record profile, which every Playwright context is, goes away: a keychain
 * query through the Secure Enclave that took about 5 s each, one at a time, and Chrome
 * won't exit while one runs. These pages never make such keys.
 */
export const DISABLED_FEATURES = [...PLAYWRIGHT_DISABLED_FEATURES, "UnexportableKeyDeletion"];

/** Launching took 0.3-0.7 s with the host's load average at 15-40. */
export const LAUNCH_TIMEOUT = 30_000;
/**
 * How long Chrome may take to close its contexts and exit before it is killed. At the
 * same load, closing took 0.2-2 s, and 7-11 s with the keychain query.
 */
const CLOSE_TIMEOUT = 5_000;
/** How long Chrome may take to exit once killed, which took well under a second. */
const KILL_TIMEOUT = 5_000;
/** A hook that closes Chrome: its close, its kill if need be, and its servers. */
export const TEARDOWN_TIMEOUT = CLOSE_TIMEOUT + KILL_TIMEOUT + 5_000;

const processes = new WeakMap<Browser, number>();

/** Launches Chrome headless, keeping its process to kill if it won't close. */
export async function launchChrome(options: LaunchOptions = {}): Promise<Browser> {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    timeout: LAUNCH_TIMEOUT,
    ...options,
    args: [...(options.args ?? []), `--disable-features=${DISABLED_FEATURES.join(",")}`],
  });
  try {
    processes.set(browser, await browserProcess(browser));
  } catch (error) {
    await browser.close();
    throw error;
  }
  return browser;
}

/** The browser process's id, which leads the process group of all Chrome's processes. */
export async function browserProcess(browser: Browser): Promise<number> {
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send("SystemInfo.getProcessInfo");
    const pid = processInfo.find((info) => info.type === "browser")?.id;
    if (!pid) throw new Error("Chrome didn't report its browser process");
    return pid;
  } finally {
    await session.detach();
  }
}

/**
 * Closes the contexts, then Chrome, as Playwright advises. If that takes longer than
 * `budget`, kills Chrome's processes, waits for Playwright to see it exit and remove its
 * profile, and reports the overrun as a warning: the tests have finished by then.
 */
export async function closeChrome(
  browser: Browser | undefined,
  budget = CLOSE_TIMEOUT,
): Promise<void> {
  if (!browser) return;
  const started = performance.now();
  const closing = (async () => {
    try {
      await Promise.all(browser.contexts().map((context) => context.close()));
    } finally {
      await browser.close();
    }
  })();
  if (await settles(closing, budget)) return;
  const pid = processes.get(browser);
  if (!pid) throw new Error(`Chrome didn't close in ${budget} ms, and its process is unknown`);
  kill(pid);
  // Once Chrome is killed, closing a context may fail, but the browser's close, which
  // `closing` always reaches, resolves when Playwright has cleaned up after the exit.
  const exited = closing.catch(() => undefined);
  if (!(await settles(exited, KILL_TIMEOUT))) {
    throw new Error(`Chrome (pid ${pid}) didn't exit within ${KILL_TIMEOUT} ms of being killed`);
  }
  const elapsed = Math.round(performance.now() - started);
  console.warn(
    `Chrome (pid ${pid}) didn't close in ${budget} ms, so it was killed (${elapsed} ms)`,
  );
}

/** Whether `promise` resolves within `ms`; rethrows its rejection. */
async function settles(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Kills Chrome's process group (Playwright starts Chrome as its leader), or the process. */
function kill(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // It has already exited.
    }
  }
}
