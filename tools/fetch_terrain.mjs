#!/usr/bin/env node
/**
 * M6 地形数据：NASA SVS 提供的 LRO LOLA 实测高度图（2400×1200, 8-bit）与 LROC 色彩图。
 * PDS Geosciences 主站点当前不可用，SVS 为 NASA 官方发布渠道（同一 LOLA 数据产品的可视化版本）。
 * 高程标定：0..255 ↔ −9,061 m .. +10,787 m（月面最低/最高点，LOLA 实测）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const TARGETS = [
  {
    out: "public/textures/moon/ldem_3_8bit.jpg",
    url: "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_3_8bit.jpg",
    note: "LOLA 激光测高 8-bit 高度图",
  },
  {
    out: "public/textures/moon/lroc_color_poles_1k.jpg",
    url: "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_1k.jpg",
    note: "LROC WAC 全球镶嵌色彩图",
  },
];

for (const t of TARGETS) {
  console.log(`GET ${t.out} (${t.note})`);
  const res = await fetch(t.url, { redirect: "follow" });
  if (!res.ok) {
    console.error(`  [FAIL] HTTP ${res.status}`);
    process.exitCode = 1;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(t.out), { recursive: true });
  await writeFile(t.out, buf);
  console.log(`  [ok] ${(buf.length / 1024).toFixed(0)} KB`);
}
