/**
 * 天体注册表（M2）：太阳系天体的尺寸、纹理、自转与位置提供者。
 * 场景坐标：日心黄道 J2000（米）。行星位置 = helioJ2000（VSOP），
 * 卫星 = 母星位置 + moonPosLocal；月球 = 地球 + ELP。
 */
import { jdTT } from "../core/time.js";
import { AU_M } from "../core/constants.js";
import { helioJ2000, type BodyName } from "./ephemeris.js";
import { moonGeoTT } from "./moon.js";
import { MOONS, moonPosLocal, type MoonElements } from "./satellites.js";
import { ROTATION, type RotationElements } from "./rotation.js";
import { rotX, EPSILON_0, type Vec3 } from "./frames.js";

export interface BodyDef {
  name: string;
  label: string;
  parent: string | null;
  radiusM: number;
  texture: string;
  color: string; // 无纹理时的基色（小卫星）
  rotation: RotationElements;
  moon?: MoonElements;
  gmKm3S2: number; // 引力参数 GM（km³/s²）
}

/** 引力参数 GM（km³/s²，IAU/NASA fact sheets）。 */
export const GM: Record<string, number> = {
  sun: 1.32712440018e11,
  mercury: 22031.8685,
  venus: 324858.592,
  earth: 398600.4354,
  mars: 42828.3752,
  jupiter: 1.26686534e8,
  saturn: 3.7931187e7,
  uranus: 5.793939e6,
  neptune: 6.836529e6,
  pluto: 975.5,
  moon: 4902.8001,
  io: 5959.916, europa: 3202.739, ganymede: 9887.834, callisto: 7179.289,
  titan: 8978.1382, triton: 1427.6,
};

/** 影响球半径（km）：r_SOI = a·(m/M)^(2/5)，a 取当前日心距的近似。 */
export function soiRadiusKm(name: string, jdUTC: number): number {
  const gmBody = GM[name];
  if (!gmBody || name === "sun") return Infinity;
  const p = bodyPosHelioM(name, jdUTC);
  const rSun = Math.hypot(p.x, p.y, p.z) / 1000; // km
  return rSun * Math.pow(gmBody / GM.sun, 0.4);
}

const DEG = Math.PI / 180;

const PLANET_DEFS: Array<{
  name: BodyName;
  label: string;
  radiusKm: number;
  texture: string;
  color: string;
}> = [
  { name: "sun", label: "太阳", radiusKm: 696000, texture: "", color: "#ffd27d" },
  { name: "mercury", label: "水星", radiusKm: 2439.7, texture: "mercury", color: "#b9a48f" },
  { name: "venus", label: "金星", radiusKm: 6051.8, texture: "venus", color: "#e8c98f" },
  { name: "earth", label: "地球", radiusKm: 6371, texture: "", color: "#6fa8ff" }, // 蓝宝石纹理
  { name: "mars", label: "火星", radiusKm: 3389.5, texture: "mars", color: "#ff8a5c" },
  { name: "jupiter", label: "木星", radiusKm: 69911, texture: "jupiter", color: "#e0b08a" },
  { name: "saturn", label: "土星", radiusKm: 58232, texture: "saturn", color: "#e8d8a8" },
  { name: "uranus", label: "天王星", radiusKm: 25362, texture: "uranus", color: "#9fdce8" },
  { name: "neptune", label: "海王星", radiusKm: 24622, texture: "neptune", color: "#6f8fe8" },
  { name: "pluto", label: "冥王星", radiusKm: 1188.3, texture: "", color: "#d8c8b8" },
];

const MOON_LABEL: Record<string, string> = {
  moon: "月球", phobos: "火卫一", deimos: "火卫二", io: "木卫一", europa: "木卫二",
  ganymede: "木卫三", callisto: "木卫四", mimas: "土卫一", enceladus: "土卫二",
  tethys: "土卫三", dione: "土卫四", rhea: "土卫五", titan: "土卫六", iapetus: "土卫八",
  titania: "天卫三", oberon: "天卫四", triton: "海卫一", charon: "冥卫一",
};
const MOON_COLOR = "#c8c8c8";

export const BODIES: BodyDef[] = [];

for (const p of PLANET_DEFS) {
  BODIES.push({
    name: p.name,
    label: p.label,
    parent: null,
    radiusM: p.radiusKm * 1000,
    texture: p.name === "earth" ? "textures/earth/blue_marble.jpg" : `textures/planets/${p.texture}.jpg`,
    color: p.color,
    rotation: ROTATION[p.name],
    gmKm3S2: GM[p.name],
  });
}
// 月球（ELP）
BODIES.push({
  name: "moon",
  label: MOON_LABEL.moon,
  parent: "earth",
  radiusM: 1737.4 * 1000,
  texture: "textures/planets/moon.jpg",
  color: MOON_COLOR,
  rotation: ROTATION.moon,
  gmKm3S2: GM.moon,
});
for (const [key, el] of Object.entries(MOONS)) {
  if (key === "moon") continue;
  BODIES.push({
    name: key,
    label: MOON_LABEL[key] ?? key,
    parent: el.parent,
    radiusM: (el.diameterKm / 2) * 1000,
    texture: "",
    color: MOON_COLOR,
    rotation: { alpha0: 0, delta0: 0, w0: 0, wDot: 0 }, // 潮汐锁定（bodyRotation 补全）
    moon: el,
    gmKm3S2: GM[key] ?? 1,
  });
}

export const BODY_BY_NAME: Record<string, BodyDef> = Object.fromEntries(BODIES.map((b) => [b.name, b]));

/** 卫星潮汐锁定：自转 = 公转（面朝母星），W 速率用公转 n。 */
export function bodyRotation(name: string): RotationElements {
  const b = BODY_BY_NAME[name];
  if (b.moon && (b.rotation.wDot === 0)) {
    return { alpha0: b.rotation.alpha0, delta0: b.rotation.delta0, w0: b.moon.L0Rad / DEG, wDot: (b.moon.nRadDay / DEG) };
  }
  return b.rotation;
}

/** 日心黄道 J2000 位置（米）。 */
export function bodyPosHelioM(name: string, jdUTC: number): Vec3 {
  const tt = jdTT(jdUTC);
  const b = BODY_BY_NAME[name];
  if (!b) throw new Error(`unknown body ${name}`);
  if (name === "sun") return { x: 0, y: 0, z: 0 };
  if (name === "moon") {
    const e = helioJ2000("earth", jdUTC);
    const m = moonGeoTT(tt).pos;
    return { x: e.x * AU_M + m.x * AU_M, y: e.y * AU_M + m.y * AU_M, z: e.z * AU_M + m.z * AU_M };
  }
  if (b.moon) {
    const parent = bodyPosHelioM(b.parent!, jdUTC);
    const local = moonPosLocal(b.moon, tt); // km
    return {
      x: parent.x + local[0] * 1000,
      y: parent.y + local[1] * 1000,
      z: parent.z + local[2] * 1000,
    };
  }
  const p = helioJ2000(name as BodyName, jdUTC);
  return { x: p.x * AU_M, y: p.y * AU_M, z: p.z * AU_M };
}

/** 自转北极（黄道 J2000 单位矢量）。 */
export function poleEcl(α0: number, δ0: number): Vec3 {
  const a = α0 * DEG;
  const d = δ0 * DEG;
  const eq: Vec3 = { x: Math.cos(d) * Math.cos(a), y: Math.cos(d) * Math.sin(a), z: Math.sin(d) };
  return rotX(eq, -EPSILON_0);
}
