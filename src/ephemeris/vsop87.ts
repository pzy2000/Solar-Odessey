/**
 * VSOP87 行星理论求值器（M1）。
 * 数据：PyMeeus 提供的完整 VSOP87 L/B/R 序列（Meeus, Astronomical Algorithms），
 * 日心黄道"当日"球坐标：L, B 单位 1e-8 rad，R 单位 1e-8 AU。
 * L(k) = Σ A·cos(B + C·T)，k 为 T 的幂次。
 */
import { eclipticDateToJ2000, vec3, type Vec3 } from "./frames.js";
import data from "./data/ephemeris.json";

interface PlanetSeries {
  L: number[][];
  B: number[][];
  R: number[][];
}

const PLANETS = data.planets as unknown as Record<string, PlanetSeries>;

export type PlanetName =
  | "mercury"
  | "venus"
  | "earth"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune";

export const PLANET_NAMES: PlanetName[] = [
  "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune",
];

function evalSeries(series: number[][], T: number): number {
  let total = 0;
  for (let k = 0; k < series.length; k++) {
    const terms = series[k];
    let s = 0;
    for (let i = 0; i < terms.length; i += 3) {
      s += terms[i] * Math.cos(terms[i + 1] + terms[i + 2] * T);
    }
    total += s * Math.pow(T, k);
  }
  return total * 1e-8;
}

/** 日心黄道 J2000 直角坐标（AU）。jdTT 为 TT 时间尺度的儒略日。 */
export function planetHelioTT(planet: PlanetName, jdTT: number): Vec3 {
  // VSOP87 级数时间变量为儒略千年（365250 天，见 PyMeeus vsop_pos；勿改为世纪）
  const tau = (jdTT - 2451545.0) / 365250.0;
  const s = PLANETS[planet];
  const L = evalSeries(s.L, tau);
  const B = evalSeries(s.B, tau);
  const R = evalSeries(s.R, tau);
  const cosB = Math.cos(B);
  const ofDate = vec3(R * cosB * Math.cos(L), R * cosB * Math.sin(L), R * Math.sin(B));
  // 岁差角按世纪（IAU-76）
  return eclipticDateToJ2000(ofDate, (jdTT - 2451545.0) / 36525.0);
}
