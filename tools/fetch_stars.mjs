#!/usr/bin/env node
/**
 * M2 数据：Hipparcos 星表（VizieR I/239）→ src/ephemeris/data/stars.json
 * 取 Vmag ≤ 7.5（裸眼+双筒范围，猎户座形状验收充分），字段：HIP 编号、ICRS RA/Dec、Vmag、B−V。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const URL =
  "https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=I/239/hip_main" +
  "&-out=HIP&-out=RAICRS&-out=DEICRS&-out=Vmag&-out=B-V&-out.max=unlimited&Vmag=%3C7.5";

console.log("GET Hipparcos (Vmag<7.5) from VizieR ...");
const res = await fetch(URL, { redirect: "follow" });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const tsv = await res.text();

const rows = [];
for (const line of tsv.split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const cols = line.split("\t").map((c) => c.trim());
  const hip = parseInt(cols[0], 10);
  if (!Number.isInteger(hip)) continue; // 跳过列名/单位/分隔线
  const ra = parseFloat(cols[1]);
  const dec = parseFloat(cols[2]);
  const vmag = parseFloat(cols[3]);
  const bv = parseFloat(cols[4]);
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(vmag)) continue;
  rows.push({
    ra: Math.round(ra * 1e6) / 1e6,
    dec: Math.round(dec * 1e6) / 1e6,
    mag: Math.round(vmag * 100) / 100,
    bv: Number.isFinite(bv) ? Math.round(bv * 100) / 100 : 99,
    hip,
  });
}
if (rows.length < 10000) throw new Error(`星数异常: ${rows.length}`);

const out = {
  n: rows.length,
  limit: 7.5,
  source: "Hipparcos Main Catalogue (I/239) via CDS VizieR, ICRS J1991.25",
  ra: rows.map((r) => r.ra),
  dec: rows.map((r) => r.dec),
  mag: rows.map((r) => r.mag),
  bv: rows.map((r) => r.bv),
  hip: rows.map((r) => r.hip),
};
await mkdir(dirname("src/ephemeris/data/stars.json"), { recursive: true });
await writeFile("src/ephemeris/data/stars.json", JSON.stringify(out));
console.log(`[done] stars.json: ${rows.length} stars (${(JSON.stringify(out).length / 1e6).toFixed(1)} MB)`);
