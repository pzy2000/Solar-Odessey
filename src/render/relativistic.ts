/**
 * M7 · 相对论渲染：星流隧道（超光速段）与光行差（亚光速段）。
 * 隧道线段全部源自真实 Hipparcos 恒星方向（验收硬性要求：可追溯）。
 */
import starData from "../ephemeris/data/stars.json";
import type { Vec3 } from "../physics/kepler.js";

const DEG = Math.PI / 180;
const EPS0 = 23.439279444444445 * DEG;

/** 星表方向（黄道 J2000 单位矢量）。 */
function starDir(i: number): Vec3 {
  const ra = starData.ra[i] * DEG;
  const dec = starData.dec[i] * DEG;
  const cd = Math.cos(dec);
  const x = cd * Math.cos(ra);
  const y = cd * Math.sin(ra);
  const z = Math.sin(dec);
  const ce = Math.cos(EPS0), se = Math.sin(EPS0);
  return { x, y: y * ce - z * se, z: y * se + z * ce };
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * 构建星流隧道线段（LineSegments 顶点对）。
 * 每条线段：起点 = 真实恒星的像方向（亚光速光行差公式），终点向运动轴汇聚（超光速延伸），
 * 拉伸程度随 β 增长。返回写入的线段数。
 */
export function buildTunnelLines(
  uHat: Vec3,
  beta: number,
  positions: Float32Array,
  colors: Float32Array,
  maxStars = 1500,
): number {
  const stretch = Math.max(0, Math.min(0.88, (beta - 0.25) * 0.35));
  let seg = 0;
  for (let i = 0; i < starData.n && seg < maxStars; i++) {
    if (starData.mag[i] > 5.2) continue;
    if (i % 3 !== 0) continue;
    const s = starDir(i);
    // 亚光速光行差（公式与 warp.aberrate 一致）
    const cosT = Math.max(-1, Math.min(1, dot(s, uHat)));
    const betaSub = Math.min(0.99, beta);
    const cosT2 = (cosT + betaSub) / (1 + betaSub * cosT);
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const gamma = 1 / Math.sqrt(1 - betaSub * betaSub);
    const sinT2 = Math.min(1, sinT / (gamma * (1 + betaSub * cosT)));
    const perp = { x: s.x - cosT * uHat.x, y: s.y - cosT * uHat.y, z: s.z - cosT * uHat.z };
    const pl = Math.hypot(perp.x, perp.y, perp.z) || 1;
    const k = sinT2 / sinT / pl;
    const sA = {
      x: cosT2 * uHat.x + perp.x * k,
      y: cosT2 * uHat.y + perp.y * k,
      z: cosT2 * uHat.z + perp.z * k,
    };
    // 终点向运动轴汇聚（超光速延伸，保持可追溯到该恒星）
    const end = {
      x: sA.x + (uHat.x - sA.x) * stretch,
      y: sA.y + (uHat.y - sA.y) * stretch,
      z: sA.z + (uHat.z - sA.z) * stretch,
    };
    const o = seg * 6;
    positions[o] = sA.x * 8e12;
    positions[o + 1] = sA.y * 8e12;
    positions[o + 2] = sA.z * 8e12;
    positions[o + 3] = end.x * 8e12;
    positions[o + 4] = end.y * 8e12;
    positions[o + 5] = end.z * 8e12;
    // 多普勒着色：前蓝后红
    const dop = 1 / (Math.sqrt(1 - Math.min(0.99, beta) ** 2) * (1 - Math.min(0.99, beta) * cosT2));
    const b = Math.max(0.15, Math.min(1.4, 1 / Math.max(0.4, dop)));
    colors[o] = 0.55 * b;
    colors[o + 1] = 0.62 * b;
    colors[o + 2] = Math.min(1.2, 0.8 * b);
    colors[o + 3] = colors[o] * 0.7;
    colors[o + 4] = colors[o + 1] * 0.7;
    colors[o + 5] = colors[o + 2] * 0.7;
    seg++;
  }
  return seg;
}
