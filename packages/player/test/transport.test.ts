import { describe, expect, test } from "bun:test";
import {
  counting,
  pendingStart,
  resumable,
  STOPPED,
  TAIL_MS,
  type Transport,
  type TransportEvent,
  transition,
} from "../src/transport";

const queued = (slot: number) => ({ phase: "queued", slot }) as const;
const starting = (slot: number) => ({ phase: "starting", slot }) as const;
const running = { phase: "running" } as const;
const ending = (remaining: number, since?: number) =>
  ({ phase: "ending", remaining, since }) as const;

const playing = (engine: Transport["engine"]): Transport => ({ status: "playing", engine });
const paused = (engine: Transport["engine"]): Transport => ({ status: "paused", engine });
const stopped = (slot: number): Transport => ({ status: "stopped", engine: queued(slot) });

const report = (playing: boolean, slot: number, step: number): TransportEvent => ({
  type: "report",
  playing,
  slot,
  step,
});

const run = (events: readonly TransportEvent[], from: Transport = STOPPED) =>
  events.reduce(transition, from);

describe("transport transitions", () => {
  test.each<[string, Transport, TransportEvent, Transport]>([
    // Selecting a position forgets what the engine plays, in every status.
    ["stopped queue", stopped(0), { type: "queue", slot: 3 }, stopped(3)],
    ["paused queue", paused(running), { type: "queue", slot: 2 }, paused(queued(2))],
    ["playing queue", playing(ending(400, 10)), { type: "queue", slot: 0 }, playing(queued(0))],
    // Play keeps the engine where it is.
    ["stopped play", stopped(2), { type: "play" }, playing(queued(2))],
    ["paused play", paused(ending(500)), { type: "play" }, playing(ending(500))],
    ["start", playing(queued(2)), { type: "start", slot: 2 }, playing(starting(2))],
    ["seek while running", playing(running), { type: "start", slot: 4 }, playing(starting(4))],
    [
      "seek while ending",
      playing(ending(TAIL_MS, 5)),
      { type: "start", slot: 1 },
      playing(starting(1)),
    ],
    // Only the requested slot's first step starts the song.
    ["first step", playing(starting(2)), report(true, 2, 0), playing(running)],
    ["first step while paused", paused(starting(2)), report(true, 2, 0), paused(running)],
    ["song ends", playing(running), report(false, 3, 15), playing(ending(TAIL_MS))],
    ["song ends while paused", paused(running), report(false, 3, 15), paused(ending(TAIL_MS))],
    [
      "wait counts",
      playing(ending(TAIL_MS)),
      { type: "wait", now: 100 },
      playing(ending(TAIL_MS, 100)),
    ],
    [
      "pause holds the wait",
      playing(ending(1000, 100)),
      { type: "pause", now: 400 },
      paused(ending(700)),
    ],
    ["pause", playing(running), { type: "pause", now: 1 }, paused(running)],
    ["pause before startup", playing(queued(1)), { type: "pause", now: 1 }, paused(queued(1))],
    ["stop", paused(ending(300)), { type: "stop" }, STOPPED],
    ["stop while starting", playing(starting(3)), { type: "stop" }, STOPPED],
    ["startup fails", playing(queued(2)), { type: "fail" }, stopped(2)],
    ["startup fails after a pause", paused(queued(2)), { type: "fail" }, stopped(2)],
    ["ending rings out", playing(ending(0, 5)), { type: "elapse" }, playing(queued(0))],
    ["ending abandoned while paused", paused(ending(200)), { type: "elapse" }, paused(queued(0))],
  ])("%s", (_name, state, event, next) => {
    expect(transition(state, event)).toEqual(next);
  });

  test.each<[string, Transport, TransportEvent]>([
    ["stale slot", playing(starting(2)), report(true, 0, 0)],
    ["stale step", playing(starting(2)), report(true, 2, 5)],
    ["stale stop", playing(starting(2)), report(false, 2, 0)],
    ["running position", playing(running), report(true, 1, 4)],
    ["queued report", paused(queued(2)), report(false, 0, 5)],
    ["stopped report", stopped(0), report(true, 0, 0)],
    ["ending report", playing(ending(TAIL_MS)), report(false, 0, 0)],
    ["play while playing", playing(running), { type: "play" }],
    ["start while paused", paused(queued(1)), { type: "start", slot: 1 }],
    ["start while stopped", stopped(1), { type: "start", slot: 1 }],
    ["wait while paused", paused(ending(TAIL_MS)), { type: "wait", now: 1 }],
    ["wait while counting", playing(ending(TAIL_MS, 1)), { type: "wait", now: 9 }],
    ["wait outside an ending", playing(running), { type: "wait", now: 1 }],
    ["pause while paused", paused(running), { type: "pause", now: 1 }],
    ["pause while stopped", stopped(2), { type: "pause", now: 1 }],
    ["fail once started", playing(running), { type: "fail" }],
    ["elapse outside an ending", playing(running), { type: "elapse" }],
    ["elapse while stopped", stopped(2), { type: "elapse" }],
  ])("ignores %s", (_name, state, event) => {
    expect(transition(state, event)).toBe(state);
  });
});

describe("transport sequences", () => {
  test("a stale report can't start a replacement request", () => {
    // Play slot 0, seek to slot 2 before the engine reports, then the old first step lands.
    const state = run([
      { type: "play" },
      { type: "start", slot: 0 },
      { type: "start", slot: 2 },
      report(true, 0, 0),
    ]);
    expect(state).toEqual(playing(starting(2)));
    expect(transition(state, report(true, 2, 0))).toEqual(playing(running));
  });

  test("a report from before a selection can't end the selected song", () => {
    const state = run([
      { type: "play" },
      { type: "start", slot: 0 },
      report(true, 0, 0),
      { type: "pause", now: 0 },
      { type: "queue", slot: 2 },
      report(true, 0, 5),
      report(false, 0, 5),
    ]);
    expect(state).toEqual(paused(queued(2)));
    expect(resumable(state)).toBe(false);
  });

  test("a stop during startup leaves nothing to start", () => {
    const state = run([{ type: "play" }, { type: "stop" }]);
    expect(pendingStart(state)).toBeUndefined();
  });

  test("an ending's wait holds across a pause", () => {
    const ended = run([{ type: "play" }, { type: "start", slot: 0 }, report(true, 0, 0)]);
    const state = run(
      [
        report(false, 0, 15),
        { type: "wait", now: 1000 },
        { type: "pause", now: 1600 },
        { type: "play" },
        { type: "wait", now: 5000 },
      ],
      ended,
    );
    expect(counting(state)).toEqual({ remaining: TAIL_MS - 600, since: 5000 });
  });

  test("the helpers name what the player does next", () => {
    expect(resumable(paused(running))).toBe(true);
    expect(resumable(paused(starting(1)))).toBe(true);
    expect(resumable(paused(ending(10)))).toBe(true);
    expect(resumable(paused(queued(1)))).toBe(false);
    expect(resumable(playing(running))).toBe(false);
    expect(pendingStart(playing(queued(3)))).toBe(3);
    expect(pendingStart(paused(queued(3)))).toBeUndefined();
    expect(pendingStart(playing(running))).toBeUndefined();
    expect(counting(playing(ending(10)))).toBeUndefined();
    expect(counting(paused(running))).toBeUndefined();
  });
});
