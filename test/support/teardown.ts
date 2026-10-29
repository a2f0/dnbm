// Teardown for what several test files share, such as the package suites' packed
// package and Chrome (test/package/support.ts), which no one file can tell it is the last
// to use. bunfig.toml preloads this module, so its `afterAll` runs once, after every
// file in the run; a file run without the preload tears down after itself instead.

import { afterAll } from "bun:test";
import { TEARDOWN_TIMEOUT } from "../../scripts/testing/chrome";

const teardowns: (() => Promise<void>)[] = [];

/** Runs `teardown` once the run's tests have finished, before those registered earlier. */
export function onTeardown(teardown: () => Promise<void>): void {
  teardowns.push(teardown);
}

afterAll(async () => {
  const errors: unknown[] = [];
  for (const teardown of teardowns.splice(0).reverse()) {
    try {
      await teardown();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, "shared test teardown failed");
}, TEARDOWN_TIMEOUT + 15_000);
