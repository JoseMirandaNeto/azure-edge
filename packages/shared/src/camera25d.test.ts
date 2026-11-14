import { describe, expect, it } from "vitest";
import { CAMERA_25D, clampCamera25DZoom, computeCamera25D, parseCameraMode } from "../src/camera25d.js";

describe("camera 2.5D", () => {
  it("defaults: 38° elevation, 8.5 m distance, zoom 6–20 m", () => {
    expect(CAMERA_25D.elevationDeg).toBe(38);
    expect(CAMERA_25D.distanceM).toBe(8.5);
    expect(CAMERA_25D.zoomMinM).toBe(6);
    expect(CAMERA_25D.zoomMaxM).toBe(20);
  });

  it("places the camera due south of the player at the elevation", () => {
    const pose = computeCamera25D(0, 0);
    // South = negative y; height = dist * sin(38°), offset = dist * cos(38°).
    expect(pose.camX).toBe(0);
    expect(pose.camY).toBeCloseTo(-8.5 * Math.cos((38 * Math.PI) / 180), 9);
    expect(pose.camZ).toBeCloseTo(8.5 * Math.sin((38 * Math.PI) / 180), 9);
    expect(pose.focusX).toBe(0);
    expect(pose.focusY).toBe(0);
    expect(pose.focusZ).toBe(CAMERA_25D.focusHeightM);
  });

  it("follows the player (same offset at any position)", () => {
    const a = computeCamera25D(10, -20);
    expect(a.camX).toBe(10);
    expect(a.camY).toBeCloseTo(-20 - 8.5 * Math.cos((38 * Math.PI) / 180), 9);
    expect(a.focusX).toBe(10);
    expect(a.focusY).toBe(-20);
  });

  it("clamps wheel zoom to 6–20 m", () => {
    expect(clampCamera25DZoom(5)).toBe(6);
    expect(clampCamera25DZoom(30)).toBe(20);
    expect(clampCamera25DZoom(14)).toBe(14);
  });

  it("?camera= defaults to 2.5d; only '3d' selects the orbit camera", () => {
    expect(parseCameraMode(null)).toBe("2.5d");
    expect(parseCameraMode(undefined)).toBe("2.5d");
    expect(parseCameraMode("2.5d")).toBe("2.5d");
    expect(parseCameraMode("3d")).toBe("3d");
    expect(parseCameraMode("banana")).toBe("2.5d");
  });
});
