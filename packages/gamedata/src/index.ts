import zoneData from "../data/zone_lotus_village.json" with { type: "json" };

export interface ZoneData {
  zone: { id: string; name: string; sizeM: number; spawn: { x: number; y: number } };
  player: { walkSpeedMps: number; runSpeedMps: number; radiusM: number; maxHp: number };
  camera: { distanceM: number; heightM: number; pitchRad: number };
}

function isZoneData(v: unknown): v is ZoneData {
  if (typeof v !== "object" || v === null) return false;
  const z = v as Record<string, unknown>;
  const zone = z.zone as Record<string, unknown> | undefined;
  const player = z.player as Record<string, unknown> | undefined;
  return (
    typeof zone?.id === "string" &&
    typeof zone?.sizeM === "number" &&
    typeof player?.walkSpeedMps === "number" &&
    player.walkSpeedMps > 0 &&
    typeof player?.maxHp === "number"
  );
}

if (!isZoneData(zoneData)) {
  throw new Error("zone_lotus_village.json failed schema validation");
}

/** Validated, data-driven zone/player tuning. Code must read this, not hard-code numbers. */
export const ZONE: ZoneData = zoneData;
