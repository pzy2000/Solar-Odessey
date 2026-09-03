#!/usr/bin/env node
/**
 * M2 数据：主要卫星平均轨道（圆轨道模型 + 相位回归）。
 * 从 IMCCE Miriade/INPOP 获取卫星相对母星中心的位置序列（J2000 赤道，astrometric）。
 * 方法：PCA 定轨道面 → 面内平黄经 L(t) 线性回归（对几十年外推稳健）→
 *       a = 中位半径，e 取密切要素中位数（仅记录，传播用圆模型）。
 * 输出基向量旋转到黄道 J2000：src/ephemeris/data/satellites.json。
 * 注：Charon 在 Miriade 无卫星条目，剔除；月球用 ELP（另册）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const BASE = "https://ssp.imcce.fr/webservices/miriade/api/ephemcc.php";
const AU_KM = 1.495978707e8;
const EPOCH0 = 2451545.0;
const EPS0 = 23.439279444444445 * (Math.PI / 180);

const SATS = [
  ["Io", "jupiter", 1.7691, 0.3, 300],
  ["Europa", "jupiter", 3.5512, 0.6, 300],
  ["Ganymede", "jupiter", 7.1546, 1.2, 300],
  ["Callisto", "jupiter", 16.689, 2.8, 300],
  ["Mimas", "saturn", 0.9424, 0.16, 280],
  ["Enceladus", "saturn", 1.3702, 0.23, 280],
  ["Tethys", "saturn", 1.8878, 0.32, 280],
  ["Dione", "saturn", 2.7369, 0.46, 280],
  ["Rhea", "saturn", 4.5175, 0.76, 280],
  ["Titan", "saturn", 15.9454, 2.7, 300],
  ["Iapetus", "saturn", 79.3215, 1.1, 320],
  ["Titania", "uranus", 8.7059, 1.5, 300],
  ["Oberon", "uranus", 13.4632, 2.3, 300],
  ["Triton", "neptune", 5.8769, 1.0, 300],
  ["Phobos", "mars", 0.31891, 0.06, 300],
  ["Deimos", "mars", 1.26244, 0.21, 280],
];

async function fetchPositions(sat, observer, nbd, step) {
  const params = new URLSearchParams({
    "-name": `s:${sat}`,
    "-type": "Satellite",
    "-ep": "2026-08-01 12:00:00",
    "-nbd": String(nbd),
    "-step": `${step}d`,
    "-tscale": "UTC",
    "-observer": `@${observer}`,
    "-theory": "INPOP",
    "-teph": "1",
    "-tcoor": "2",
    "-rplane": "1",
    "-mime": "json",
    "-from": "solar_odyssey",
  });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (!j.data || j.data.length < 20) throw new Error("数据不足");
      return { rows: j.data, diameter: j.sso?.parameters?.diameter ?? 0 };
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

function median(arr) {
  const s = [...arr].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v) {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}

const out = {};
for (const [sat, observer, , step, nbd] of SATS) {
  process.stdout.write(`fit ${sat} ... `);
  const { rows, diameter } = await fetchPositions(sat, observer, nbd, step);
  const pts = rows.map((r) => [r.px * AU_KM, r.py * AU_KM, r.pz * AU_KM]);
  const jds = rows.map((r) => (typeof r.Date === "number" ? r.Date : Date.parse(String(r.Date)) / 86400000 + 2440587.5));

  // PCA 轨道面法向（中心化协方差的最小特征向量，用降幂迭代）
  const c = [0, 0, 0];
  for (const p of pts) for (let i = 0; i < 3; i++) c[i] += p[i] / pts.length;
  const cov = Array.from({ length: 3 }, () => new Array(3).fill(0));
  for (const p of pts) {
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += (d[i] * d[j]) / pts.length;
  }
  const powerVec = (M, seed) => {
    let v = seed;
    for (let k = 0; k < 80; k++) {
      const w = [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
      v = norm(w);
    }
    return v;
  };
  const v1 = powerVec(cov, [1, 0.31, 0.17]);
  const Av1 = [cov[0][0] * v1[0] + cov[0][1] * v1[1] + cov[0][2] * v1[2], cov[1][0] * v1[0] + cov[1][1] * v1[1] + cov[1][2] * v1[2], cov[2][0] * v1[0] + cov[2][1] * v1[1] + cov[2][2] * v1[2]];
  const lambda1 = dot(v1, Av1);
  const cov2 = cov.map((row, i) => row.map((x, j) => x - lambda1 * v1[i] * v1[j]));
  const v2 = powerVec(cov2, [0.23, 1, 0.41]);
  const nHat = norm(cross(v1, v2));
  let P = norm(cross(nHat, [0.31, 0.91, 0.27])); // 面内任意稳定方向
  const Q = norm(cross(nHat, P));

  // 面内坐标与平黄经回归
  const xs = pts.map((p) => dot(p, P));
  const ys = pts.map((p) => dot(p, Q));
  const radii = pts.map((_, i) => Math.hypot(xs[i], ys[i]));
  const a = median(radii);
  const Ls = ys.map((y, i) => Math.atan2(y, xs[i]));
  for (let i = 1; i < Ls.length; i++) {
    while (Ls[i] - Ls[i - 1] > Math.PI) Ls[i] -= 2 * Math.PI;
    while (Ls[i] - Ls[i - 1] < -Math.PI) Ls[i] += 2 * Math.PI;
  }
  const tBar = jds.reduce((s, v) => s + v, 0) / jds.length;
  const LBar = Ls.reduce((s, v) => s + v, 0) / Ls.length;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < jds.length; i++) {
    const dt = jds[i] - tBar;
    sxx += dt * dt;
    sxy += dt * (Ls[i] - LBar);
  }
  const nFit = sxy / sxx; // rad/day（负值=逆行）
  const L0 = LBar - nFit * (tBar - EPOCH0); // @J2000

  // 偏心率：密切要素中位数（用 μ 与状态）— 由位置差分估计速度太糙，改用半径变化：e ≈ (rmax−rmin)/(rmax+rmin)
  const eEst = (Math.max(...radii) - Math.min(...radii)) / (Math.max(...radii) + Math.min(...radii));

  // 残差
  let maxRes = 0;
  for (let i = 0; i < pts.length; i++) {
    const L = L0 + nFit * (jds[i] - EPOCH0);
    const pos = [a * (Math.cos(L) * P[0] + Math.sin(L) * Q[0]), a * (Math.cos(L) * P[1] + Math.sin(L) * Q[1]), a * (Math.cos(L) * P[2] + Math.sin(L) * Q[2])];
    maxRes = Math.max(maxRes, Math.hypot(pos[0] - pts[i][0], pos[1] - pts[i][1], pos[2] - pts[i][2]));
  }
  const resArcsec = (maxRes / a) * (180 / Math.PI) * 3600;

  const ce = Math.cos(-EPS0), se = Math.sin(-EPS0);
  const toEcl = (v) => [v[0], v[1] * ce - v[2] * se, v[1] * se + v[2] * ce];
  out[sat.toLowerCase()] = {
    parent: observer,
    aKm: Math.round(a * 10) / 10,
    e: Math.round(eEst * 1e5) / 1e5,
    nRadDay: Math.round(nFit * 1e12) / 1e12,
    L0Rad: Math.round(((L0 % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * 1e10) / 1e10,
    epochJD: EPOCH0,
    P: toEcl(P).map((v) => Math.round(v * 1e9) / 1e9),
    Q: toEcl(Q).map((v) => Math.round(v * 1e9) / 1e9),
    diameterKm: diameter,
    fitMaxResKm: Math.round(maxRes * 10) / 10,
    fitResArcsecAtParent: Math.round(resArcsec * 100) / 100,
  };
  console.log(`a=${a.toFixed(0)}km e~${eEst.toFixed(4)} P=${((2 * Math.PI) / Math.abs(nFit)).toFixed(4)}d ${nFit < 0 ? "(逆行)" : ""} maxRes=${maxRes.toFixed(0)}km (${resArcsec.toFixed(0)}"@母星)`);
  await new Promise((r) => setTimeout(r, 250));
}

await mkdir(dirname("src/ephemeris/data/satellites.json"), { recursive: true });
await writeFile("src/ephemeris/data/satellites.json", JSON.stringify(out));
console.log(`[done] satellites.json: ${Object.keys(out).length} satellites`);
