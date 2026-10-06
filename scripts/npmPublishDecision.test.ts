import { describe, expect, test } from "bun:test";
import { decidePublish, parseRegistryState } from "./npmPublishDecision";

describe("npm publish decision", () => {
  const state = { latest: "0.1.4", versions: ["0.1.3", "0.1.4"] };

  test("publishes only a version newer than npm's latest", () => {
    expect(decidePublish("0.1.5", state).publish).toBe(true);
    expect(decidePublish("0.2.0", state).publish).toBe(true);
    expect(decidePublish("0.1.4", state)).toEqual({
      publish: false,
      reason: "0.1.4 is already on npm",
    });
    expect(decidePublish("0.1.2", state).publish).toBe(false);
  });

  test("refuses versions ship-pr would never write", () => {
    expect(() => decidePublish("0.1.5-beta.1", state)).toThrow("invalid package version");
    expect(() => decidePublish("1.0", state)).toThrow("invalid package version");
  });

  test("reads npm view output, including a single version as a string", () => {
    expect(parseRegistryState('{"versions":"0.1.0","dist-tags":{"latest":"0.1.0"}}')).toEqual({
      latest: "0.1.0",
      versions: ["0.1.0"],
    });
    expect(
      parseRegistryState('{"versions":["0.1.0","0.1.1"],"dist-tags":{"latest":"0.1.1"}}').versions,
    ).toHaveLength(2);
  });

  test("explains that the first version is published by hand", () => {
    expect(() => parseRegistryState('{"error":{"code":"E404"}}')).toThrow(
      "publish its first version by hand",
    );
  });
});
