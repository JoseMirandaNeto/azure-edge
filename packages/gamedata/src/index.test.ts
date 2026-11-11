import { describe, expect, it } from "vitest";
import { ZONE } from "../src/index.js";

describe("gamedata", () => {
  it("loads a valid Lotus Village zone", () => {
    expect(ZONE.zone.id).toBe("lotus_village");
    expect(ZONE.player.walkSpeedMps).toBeGreaterThan(0);
    expect(ZONE.player.maxHp).toBe(100);
    expect(ZONE.camera.distanceM).toBeGreaterThan(0);
  });
});
