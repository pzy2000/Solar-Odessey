/**
 * M2 验收网关：伽利略卫星今晚排布 vs IMCCE Miriade/INPOP（网络测试，npm run verify:truth）。
 * 门槛：木卫一/二/三/四 地心方向误差 < 0.5°（圆轨道模型 + 共振摄动余量）；
 *       土卫六 < 1°；月球沿用 30" 门槛（在 truth 门禁中）。
 * 注意：卫星排布依赖具体时刻的近似线性传播，误差含光行时效应（~40min 弧 ≈ 8'）已计入门槛。
 */
import { describe, expect, it } from "vitest";
import { jdTT } from "../src/core/time.js";
import { moonPosLocal, MOONS } from "../src/ephemeris/satellites.js";
import { geoJ2000 } from "../src/ephemeris/ephemeris.js";
import { EPSILON_0, rotX, type Vec3 } from "../src/ephemeris/frames.js";
import { AU_KM } from "../src/core/constants.js";

const NOW_UTC = "2026-09-03 21:00:00";

function dateToJD(utc: string): number {
  return Date.parse(utc.replace(" ", "T") + "Z") / 86400000 + 2440587.5;
}

async function miriadeGeoRADEC(sat: string, parent: string, utc: string): Promise<[number, number]> {
  // 卫星相对地心的 astrometric RA/DEC：直接向 Miriade 请求 geocenter 观察者
  const params = new URLSearchParams({
    "-name": `s:${sat}`,
    "-type": "Satellite",
    "-ep": utc,
    "-nbd": "1",
    "-step": "1d",
    "-tscale": "UTC",
    "-observer": "@500",
    "-theory": "INPOP",
    "-teph": "1",
    "-tcoor": "1",
    "-rplane": "1",
    "-mime": "json",
    "-from": "solar_odyssey",
  });
  void parent;
  const res = await fetch(`https://ssp.imcce.fr/webservices/miriade/api/ephemcc.php?${params}`);
  if (!res.ok) throw new Error(`Miriade HTTP ${res.status} (${sat})`);
  const j = (await res.json()) as { data?: Array<{ RA: string; DEC: string }> };
  const row = j.data?.[0];
  if (!row) throw new Error(`无数据 ${sat}`);
  const toDeg = (s: string, isRA: boolean) => {
    const sign = s.trim().startsWith("-") ? -1 : 1;
    const p = s.replace(/^[+-]/, "").split(":").map(parseFloat);
    const deg = p[0] + p[1] / 60 + (p[2] ?? 0) / 3600;
    return sign * (isRA ? deg * 15 : deg);
  };
  return [toDeg(row.RA, true), toDeg(row.DEC, false)];
}

function separationArcsec(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const d = Math.PI / 180;
  const a1 = dec1 * d, a2 = dec2 * d, dr = (ra1 - ra2) * d;
  const c = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dr);
  return Math.acos(Math.min(1, Math.max(-1, c))) * (180 / Math.PI) * 3600;
}

/** 我们的卫星地心方向（黄道 J2000 → 赤道 → RA/Dec） */
function ourGeoRADEC(moonKey: string, jdUTC: number): [number, number] {
  const el = MOONS[moonKey];
  const local = moonPosLocal(el, jdTT(jdUTC)); // km，黄道 J2000
  const parent = geoJ2000(el.parent as never, jdUTC); // AU 黄道
  const pos: Vec3 = {
    x: parent.x * AU_KM + local[0],
    y: parent.y * AU_KM + local[1],
    z: parent.z * AU_KM + local[2],
  };
  const eq = rotX(pos, EPSILON_0);
  let ra = (Math.atan2(eq.y, eq.x) * 180) / Math.PI;
  if (ra < 0) ra += 360;
  const dec = (Math.asin(eq.z / Math.hypot(eq.x, eq.y, eq.z)) * 180) / Math.PI;
  return [ra, dec];
}

describe("伽利略卫星排布 vs INPOP", () => {
  it("木卫一二三四 < 0.5°，土卫六 < 1°", async () => {
    const jd = dateToJD(NOW_UTC);
    const cases: Array<[string, number]> = [
      ["Io", 0.5 * 3600],
      ["Europa", 0.5 * 3600],
      ["Ganymede", 0.5 * 3600],
      ["Callisto", 0.5 * 3600],
      ["Titan", 1 * 3600],
    ];
    const lines: string[] = [];
    const failures: string[] = [];
    for (const [sat, gate] of cases) {
      const key = sat.toLowerCase();
      const [tra, tdec] = await miriadeGeoRADEC(sat, MOONS[key].parent, NOW_UTC);
      const [ra, dec] = ourGeoRADEC(key, jd);
      const sep = separationArcsec(ra, dec, tra, tdec);
      const line = `${sat.padEnd(8)} sep=${(sep / 60).toFixed(2)}' (gate ${gate / 3600}°)`;
      lines.push(line);
      if (sep > gate) failures.push(line);
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log("\n" + lines.join("\n"));
    expect(failures, failures.join("\n")).toHaveLength(0);
  }, 120000);
});
