/**
 * 冥王星星历（M1）：Meeus 第 41 章（经 PyMeeus 验证），适用 1885–2099，
 * 目视级精度（不在 <1' 验收门槛内，门外行星）。
 */
import { eclipticDateToJ2000, vec3, type Vec3 } from "./frames.js";
import data from "./data/ephemeris.json";

const PLUTO = data.pluto as unknown as {
  PLUTO_ARGUMENT: number[][];
  PLUTO_LONGITUDE: number[][];
  PLUTO_LATITUDE: number[][];
  PLUTO_RADIUS_VECTOR: number[][];
};
const DEG = Math.PI / 180;

export function plutoHelioTT(jdTT: number): Vec3 {
  const T = (jdTT - 2451545.0) / 36525;
  const jj = 34.35 + 3034.9057 * T;
  const ss = 50.08 + 1222.1138 * T;
  const pp = 238.96 + 144.96 * T;

  let cl = 0;
  let cb = 0;
  let cr = 0;
  for (let n = 0; n < PLUTO.PLUTO_ARGUMENT.length; n++) {
    const [i, j, k] = PLUTO.PLUTO_ARGUMENT[n];
    const arg = (i * jj + j * ss + k * pp) * DEG;
    const sa = Math.sin(arg);
    const ca = Math.cos(arg);
    cl += PLUTO.PLUTO_LONGITUDE[n][0] * sa + PLUTO.PLUTO_LONGITUDE[n][1] * ca;
    cb += PLUTO.PLUTO_LATITUDE[n][0] * sa + PLUTO.PLUTO_LATITUDE[n][1] * ca;
    cr += PLUTO.PLUTO_RADIUS_VECTOR[n][0] * sa + PLUTO.PLUTO_RADIUS_VECTOR[n][1] * ca;
  }

  const lon = (238.958116 + 144.96 * T + cl / 1e6) * DEG;
  const lat = (-3.908239 + cb / 1e6) * DEG;
  const r = 40.7241346 + cr / 1e7;
  const cosB = Math.cos(lat);
  const ofDate = vec3(r * cosB * Math.cos(lon), r * cosB * Math.sin(lon), r * Math.sin(lat));
  return eclipticDateToJ2000(ofDate, T);
}
