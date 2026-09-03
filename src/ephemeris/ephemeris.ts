/**
 * 星历总 API（M1）：任意天体的日心 J2000 位置与地心 astrometric 方向（含光行时迭代）。
 * 公共 API 接收 JD(UTC)，内部换算 JD(TT) 后调用理论求值器。
 */
import { AU_KM, C_KM_S } from "../core/constants.js";
import { jdTT } from "../core/time.js";
import { eclipticToEquatorial, type Vec3 } from "./frames.js";
import { PLANET_NAMES, planetHelioTT, type PlanetName } from "./vsop87.js";
import { moonGeoTT } from "./moon.js";
import { plutoHelioTT } from "./pluto.js";

export type BodyName = PlanetName | "moon" | "pluto" | "sun";

export const ALL_BODIES: BodyName[] = [...PLANET_NAMES, "moon", "pluto"];

const MOON_EMB_RATIO = 0.012150585; // M_moon/(M_earth+M_moon)

/** 日心黄道 J2000 直角坐标（AU）。 */
export function helioJ2000(body: BodyName, jdUTC: number): Vec3 {
  const tt = jdTT(jdUTC);
  if (body === "sun") return { x: 0, y: 0, z: 0 };
  if (body === "moon") throw new Error("moon is geocentric; use geoJ2000");
  if (body === "pluto") return plutoHelioTT(tt);
  return planetHelioTT(body, tt);
}

/** 地心黄道 J2000 直角坐标（AU）。 */
export function geoJ2000(body: BodyName, jdUTC: number): Vec3 {
  const tt = jdTT(jdUTC);
  if (body === "moon") return moonGeoTT(tt).pos;
  if (body === "earth") return { x: 0, y: 0, z: 0 };
  // 地球（非 EMB）= EMB − MOON_EMB_RATIO·r_moon；所有天体的地心矢量一律相对地球中心
  const emb = planetHelioTT("earth", tt);
  const moon = moonGeoTT(tt).pos;
  const ex = emb.x - MOON_EMB_RATIO * moon.x;
  const ey = emb.y - MOON_EMB_RATIO * moon.y;
  const ez = emb.z - MOON_EMB_RATIO * moon.z;
  const p =
    body === "sun"
      ? { x: 0, y: 0, z: 0 }
      : body === "pluto"
        ? plutoHelioTT(tt)
        : planetHelioTT(body as PlanetName, tt);
  return { x: p.x - ex, y: p.y - ey, z: p.z - ez };
}

/** 地心距离（km）。 */
export function distanceKm(body: BodyName, jdUTC: number): number {
  if (body === "moon") return moonGeoTT(jdTT(jdUTC)).distanceKm;
  const g = geoJ2000(body, jdUTC);
  return Math.hypot(g.x, g.y, g.z) * AU_KM;
}

export interface Astrometric {
  raDeg: number;
  decDeg: number;
  distKm: number;
}

/**
 * 地心 astrometric 方向（光行时迭代，无光行差）——与 Horizons QUANTITIES=1 一致。
 * 天体位置取 t−τ 时刻，3 次迭代收敛（最大光行时 ≈ 4.4 小时，外行星）。
 */
export function astrometricGeo(body: BodyName, jdUTC: number): Astrometric {
  let tau = 0;
  let dir: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 3; i++) {
    dir = geoJ2000(body, jdUTC - tau);
    tau = (Math.hypot(dir.x, dir.y, dir.z) * AU_KM) / C_KM_S / 86400;
  }
  // 黄道 J2000 → 赤道 J2000
  const eq = eclipticToEquatorial(dir);
  const len = Math.hypot(eq.x, eq.y, eq.z);
  let ra = Math.atan2(eq.y, eq.x) * (180 / Math.PI);
  if (ra < 0) ra += 360;
  const dec = Math.asin(eq.z / len) * (180 / Math.PI);
  return { raDeg: ra, decDeg: dec, distKm: len * AU_KM };
}

/** 光行时（分钟）——HUD 尺度感设计的一部分。 */
export function lightTimeMin(body: BodyName, jdUTC: number): number {
  return distanceKm(body, jdUTC) / C_KM_S / 60;
}
