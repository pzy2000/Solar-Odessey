#!/usr/bin/env node
/**
 * 星历数据生成（M1）：下载 PyMeeus（Meeus, Astronomical Algorithms 的开源实现，LGPL，仅取数据表）
 * 中的 VSOP87 截断序列（八大行星，L/B/R，约 1" 精度）、Meeus ch.47 月球周期项表（约 10" 精度）
 * 与冥王星轨道多项式，转换为 src/ephemeris/data/ephemeris.json。
 * 精度由 verify/horizons 验收（行星 < 1'，月球 < 30"）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const BASE = "https://raw.githubusercontent.com/architest/pymeeus/master/pymeeus";
const OUT = "src/ephemeris/data/ephemeris.json";
const PLANETS = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];

/** 解析 Python 源文件中的顶层 `NAME = [ ... ]` 数字嵌套列表（仅含数字，可 JSON 解析）。 */
function extractLists(src) {
  const lists = {};
  const re = /^([A-Z_0-9]+) = \[/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    let depth = 0;
    let i = src.indexOf("[", m.index + m[0].length - 1);
    const start = i;
    do {
      const ch = src[i];
      if (ch === "[") depth++;
      else if (ch === "]") depth--;
      i++;
    } while (depth > 0 && i < src.length);
    // 剥离注释 + 尾逗号，Python 元组→数组后转 JSON
    const body = src
      .slice(start, i)
      .replace(/#[^\n]*/g, "")
      .replace(/[()]/g, (ch) => (ch === "(" ? "[" : "]"))
      .replace(/,(\s*[\]])/g, "$1");
    lists[name] = JSON.parse(body);
  }
  return lists;
}

async function fetchSrc(name) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${BASE}/${name}.py`, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error(`${name}: ${lastErr.message}`);
}

const data = { planets: {}, moon: {}, pluto: {} };

for (const p of PLANETS) {
  const lists = extractLists(await fetchSrc(p));
  const key = p.toLowerCase();
  for (const v of ["L", "B", "R"]) {
    const series = lists[`VSOP87_${v}`];
    if (!series) throw new Error(`${p}: missing VSOP87_${v}`);
    data.planets[key] ??= {};
    // 压缩为紧凑数组：[k][A,B,C,...]
    data.planets[key][v] = series.map((terms) => terms.flat());
  }
  console.log(`[ok] ${key}: L=${lists.VSOP87_L.length} B=${lists.VSOP87_B.length} R=${lists.VSOP87_R.length} powers`);
}

{
  const lists = extractLists(await fetchSrc("Moon"));
  const lr = lists.PERIODIC_TERMS_LR_TABLE;
  const b = lists.PERIODIC_TERMS_B_TABLE;
  if (!lr || !b) throw new Error("Moon: missing periodic term tables");
  data.moon = { lr, b };
  console.log(`[ok] moon: lr=${lr.length} terms, b=${b.length} terms`);
}

{
  const lists = extractLists(await fetchSrc("Pluto"));
  for (const v of ["PLUTO_ARGUMENT", "PLUTO_LONGITUDE", "PLUTO_LATITUDE", "PLUTO_RADIUS_VECTOR"]) {
    if (!lists[v]) throw new Error(`Pluto: missing ${v}`);
    data.pluto[v] = lists[v];
  }
  console.log("[ok] pluto tables");
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(data));
console.log(`[done] ${OUT} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
