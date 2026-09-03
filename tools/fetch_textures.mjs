#!/usr/bin/env node
/**
 * 数据获取管线（M0 雏形）：下载 NASA 公有领域纹理到 public/textures/。
 * 每个 target 按顺序尝试多个 URL（主源 + 备源），校验 content-type 与体积。
 * 后续里程碑在此扩展：月面 LRO WAC、LOLA 高程、其余行星 USGS 纹理等。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const TARGETS = [
  {
    out: "public/textures/earth/blue_marble.jpg",
    // NASA Blue Marble Topo-Bathy（公有领域）
    urls: [
      "https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg",
      "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg",
    ],
    minBytes: 100_000,
  },
];

async function fetchOne(urls, minBytes) {
  let lastErr = new Error("no urls");
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < minBytes) throw new Error(`too small: ${buf.length} B`);
      const type = res.headers.get("content-type") ?? "";
      if (!/image|octet-stream/.test(type)) throw new Error(`bad content-type: ${type}`);
      return { url, buf };
    } catch (e) {
      lastErr = e;
      console.warn(`  [skip] ${url} -> ${e.message}`);
    }
  }
  throw lastErr;
}

for (const t of TARGETS) {
  console.log(`GET ${t.out}`);
  try {
    const { url, buf } = await fetchOne(t.urls, t.minBytes);
    await mkdir(dirname(t.out), { recursive: true });
    await writeFile(t.out, buf);
    console.log(`  [ok] ${url} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    console.error(`  [FAIL] ${t.out}: ${e.message}`);
    process.exitCode = 1;
  }
}
