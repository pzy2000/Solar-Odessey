#!/usr/bin/env node
/**
 * 数据获取管线：下载公开纹理到 public/textures/。
 * 来源：NASA（公有领域）+ Solar System Scope（CC BY 4.0，基于 NASA 数据，见 docs/CREDITS.md）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SSS = "https://www.solarsystemscope.com/textures/download";

const TARGETS = [
  {
    out: "public/textures/earth/blue_marble.jpg",
    urls: [
      "https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg",
      "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg",
    ],
    minBytes: 100_000,
  },
  ...[
    ["mercury", "2k_mercury.jpg"],
    ["venus", "2k_venus_atmosphere.jpg"],
    ["mars", "2k_mars.jpg"],
    ["jupiter", "2k_jupiter.jpg"],
    ["saturn", "2k_saturn.jpg"],
    ["uranus", "2k_uranus.jpg"],
    ["neptune", "2k_neptune.jpg"],
    ["moon", "2k_moon.jpg"],
    ["sky/milky_way", "2k_stars_milky_way.jpg"],
  ].map(([name, file]) => ({
    out: `public/textures/planets/${name}.jpg`,
    urls: [`${SSS}/${file}`],
    minBytes: 20_000,
  })),
  {
    out: "public/textures/planets/saturn_ring_alpha.png",
    urls: [`${SSS}/2k_saturn_ring_alpha.png`],
    minBytes: 10_000,
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
      return { url, buf };
    } catch (e) {
      lastErr = e;
      console.warn(`  [skip] ${url} -> ${e.message}`);
    }
  }
  throw lastErr;
}

let fail = 0;
for (const t of TARGETS) {
  console.log(`GET ${t.out}`);
  try {
    const { buf } = await fetchOne(t.urls, t.minBytes);
    await mkdir(dirname(t.out), { recursive: true });
    await writeFile(t.out, buf);
    console.log(`  [ok] (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    console.error(`  [FAIL] ${t.out}: ${e.message}`);
    fail++;
  }
}
if (fail) process.exitCode = 1;
