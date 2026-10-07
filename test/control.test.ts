// The state an instance reports to its host (src/control.ts): snapshots, and the
// subscriptions that end with the instance.

import { describe, expect, test } from "bun:test";
import {
  type DnbmSequencerState,
  isCommand,
  PLAYER_IDLE,
  SEQUENCER_COMMANDS,
  SEQUENCER_IDLE,
  StateChannel,
} from "../src/control";

const READY: DnbmSequencerState = {
  playing: false,
  title: "Undertow",
  fileName: "undertow.dnbm.json",
  dirty: false,
  available: { ...SEQUENCER_IDLE.available, play: true, togglePlay: true, save: true },
};

/** Lets queued microtasks, where subscribers hear of changes, run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("an instance's state", () => {
  test("is idle and frozen until the app is ready, and then shows what it published", async () => {
    const channel = new StateChannel(SEQUENCER_IDLE);
    const heard: DnbmSequencerState[] = [];
    channel.subscribe((state) => heard.push(state));
    channel.publish(READY);
    await settle();
    expect(channel.state).toBe(SEQUENCER_IDLE);
    expect(heard).toEqual([]);
    channel.open();
    expect(channel.state).toEqual(READY);
    expect(channel.state).not.toBe(READY);
    expect(Object.isFrozen(channel.state)).toBe(true);
    expect(Object.isFrozen(channel.state.available)).toBe(true);
    expect(heard).toEqual([]);
    await settle();
    expect(heard).toEqual([READY]);
    expect(heard[0]).toBe(channel.state);
  });

  test("keeps one snapshot until something changes, and tells of a burst of changes once", async () => {
    const channel = new StateChannel(SEQUENCER_IDLE);
    channel.open();
    channel.publish(READY);
    const first = channel.state;
    channel.publish({ ...READY, available: { ...READY.available } });
    expect(channel.state).toBe(first);
    await settle();
    const heard: DnbmSequencerState[] = [];
    channel.subscribe((state) => heard.push(state));
    channel.publish({ ...READY, playing: true });
    channel.publish({ ...READY, playing: true, dirty: true });
    await settle();
    expect(heard).toEqual([{ ...READY, playing: true, dirty: true }]);
    expect(heard[0]).toBe(channel.state);
  });

  test("a subscriber that read a change undone in the same task still hears of it", async () => {
    const channel = new StateChannel(SEQUENCER_IDLE);
    channel.open();
    channel.publish(READY);
    await settle();
    channel.publish({ ...READY, playing: true });
    // As React's useSyncExternalStore does: read the snapshot, then subscribe.
    const read = channel.state;
    const heard: DnbmSequencerState[] = [];
    channel.subscribe((state) => heard.push(state));
    channel.publish(READY);
    await settle();
    expect(read.playing).toBe(true);
    expect(heard).toEqual([READY]);
    expect(heard[0]).toBe(channel.state);
  });

  test("a listener's error reaches the page without stopping the others", async () => {
    const channel = new StateChannel(SEQUENCER_IDLE);
    channel.open();
    const reported: unknown[] = [];
    const original = globalThis.reportError;
    globalThis.reportError = (error: unknown) => reported.push(error);
    try {
      const heard: string[] = [];
      channel.subscribe(() => {
        throw new Error("host bug");
      });
      channel.subscribe((state) => heard.push(state.title));
      channel.publish(READY);
      await settle();
      expect(heard).toEqual(["Undertow"]);
      expect(reported).toEqual([new Error("host bug")]);
    } finally {
      globalThis.reportError = original;
    }
  });

  test("unsubscribing, even mid-call, stops only that subscription", async () => {
    const channel = new StateChannel(SEQUENCER_IDLE);
    channel.open();
    const heard: string[] = [];
    const listener = () => heard.push("twice");
    const once = channel.subscribe(listener);
    channel.subscribe(listener);
    let second = () => {};
    channel.subscribe(() => {
      heard.push("first");
      second();
    });
    second = channel.subscribe(() => heard.push("second"));
    once();
    once();
    channel.publish(READY);
    await settle();
    expect(heard).toEqual(["twice", "first"]);
  });

  test("closing ends every subscription, even mid-call, and returns to idle", async () => {
    const channel = new StateChannel(SEQUENCER_IDLE);
    channel.open();
    const heard: string[] = [];
    channel.subscribe(() => {
      heard.push("first");
      channel.close();
    });
    channel.subscribe(() => heard.push("second"));
    channel.publish(READY);
    await settle();
    expect(heard).toEqual(["first"]);
    expect(channel.state).toBe(SEQUENCER_IDLE);

    // A change just before closing reaches no one, and nothing after it counts.
    const closing = new StateChannel(SEQUENCER_IDLE);
    closing.open();
    const late: unknown[] = [];
    closing.subscribe((state) => late.push(state));
    closing.publish(READY);
    closing.close();
    closing.publish({ ...READY, playing: true });
    closing.open();
    const unsubscribe = closing.subscribe((state) => late.push(state));
    unsubscribe();
    await settle();
    expect(late).toEqual([]);
    expect(closing.state).toBe(SEQUENCER_IDLE);
  });

  test("shares a frozen idle state between instances", () => {
    for (const idle of [SEQUENCER_IDLE, PLAYER_IDLE]) {
      expect(Object.isFrozen(idle)).toBe(true);
      expect(Object.isFrozen(idle.available)).toBe(true);
      expect(Object.values(idle.available)).not.toContain(true);
    }
  });

  test("takes only its own commands, never an inherited key", () => {
    expect(isCommand(SEQUENCER_COMMANDS, "saveAs")).toBe(true);
    for (const command of ["toString", "constructor", "__proto__", "SAVE", "", 1, undefined]) {
      expect(isCommand(SEQUENCER_COMMANDS, command)).toBe(false);
    }
    expect(Object.keys(SEQUENCER_IDLE.available)).toEqual([...SEQUENCER_COMMANDS]);
  });
});
