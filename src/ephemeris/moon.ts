/**
 * 月球星历（M1）：Meeus, Astronomical Algorithms 第 47 章完整周期项表（60+60 项），
 * 精度约 10"（验收门槛 30"）。输出：地心黄道 J2000 直角坐标（AU）+ 距离（km）。
 */
import { eclipticDateToJ2000, vec3, type Vec3 } from "./frames.js";
import { AU_KM } from "../core/constants.js";
import data from "./data/ephemeris.json";

const MOON_DATA = data.moon as unknown as { lr: number[][]; b: number[][] };
const DEG = Math.PI / 180;

export interface MoonState {
  /** 地心黄道 J2000 直角坐标（AU）。 */
  pos: Vec3;
  /** 地心距离（km）。 */
  distanceKm: number;
}

const rad = (d: number) => d * DEG;
const sin = (d: number) => Math.sin(d * DEG);

export function moonGeoTT(jdTT: number): MoonState {
  const T = (jdTT - 2451545.0) / 36525;

  // 平均参数（度）
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + (T ** 3) / 538841 - (T ** 4) / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + (T ** 3) / 545868 - (T ** 4) / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + (T ** 3) / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + (T ** 3) / 69699 - (T ** 4) / 14712000;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T - (T ** 3) / 3526000 + (T ** 4) / 863310000;
  const A1 = 119.75 + 131.849 * T;
  const A2 = 53.09 + 479264.29 * T;
  const A3 = 313.45 + 481266.484 * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;

  let sl = 0;
  let sr = 0;
  for (const [d, m, mp, f, cl, cr] of MOON_DATA.lr) {
    const arg = rad(d * D + m * M + mp * Mp + f * F);
    const ecc = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sl += cl * ecc * Math.sin(arg);
    sr += cr * ecc * Math.cos(arg);
  }
  let sb = 0;
  for (const [d, m, mp, f, cb] of MOON_DATA.b) {
    const arg = rad(d * D + m * M + mp * Mp + f * F);
    const ecc = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sb += cb * ecc * Math.sin(arg);
  }

  // 加边项（Meeus 47.6 / 47.7）
  sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
  sb +=
    -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F) +
    127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);

  const lambda = rad(Lp + sl / 1e6); // 当日黄经
  const beta = rad(sb / 1e6); // 当日黄纬
  const distKm = 385000.56 + sr / 1000;
  const rAu = distKm / AU_KM;

  const ofDate = vec3(
    rAu * Math.cos(beta) * Math.cos(lambda),
    rAu * Math.cos(beta) * Math.sin(lambda),
    rAu * Math.sin(beta),
  );
  return { pos: eclipticDateToJ2000(ofDate, T), distanceKm: distKm };
}
