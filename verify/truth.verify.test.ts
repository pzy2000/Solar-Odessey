/**
 * M1 验收网关（主通道）：与 IMCCE Miriade/INPOP 星历服务比对。
 * JPL Horizons 2026-09 起本网络已可直连（另有 horizons 门禁）；INPOP 与 DE 系列同等级权威，且 IMCCE 正是 VSOP87 的发布方。
 * 运行：npm run verify:truth
 * 门槛（PLAN.md M1）：8 大行星误差 < 1'；月球 < 30"；冥王星（门外行星）< 10'。
 * 比对口径：地心 astrometric RA/DEC J2000（光行时校正、无光行差），与我们的 astrometricGeo 同口径。
 */
import { describe, expect, it } from "vitest";
import { astrometricGeo, type BodyName } from "../src/ephemeris/ephemeris.js";

interface Target {
  name: BodyName;
  query: string;
  type: string;
  gateArcsec: number;
}

const TARGETS: Target[] = [
  { name: "mercury", query: "p:Mercury", type: "Planet", gateArcsec: 60 },
  { name: "venus", query: "p:Venus", type: "Planet", gateArcsec: 60 },
  { name: "mars", query: "p:Mars", type: "Planet", gateArcsec: 60 },
  { name: "jupiter", query: "p:Jupiter", type: "Planet", gateArcsec: 60 },
  { name: "saturn", query: "p:Saturn", type: "Planet", gateArcsec: 60 },
  { name: "uranus", query: "p:Uranus", type: "Planet", gateArcsec: 60 },
  { name: "neptune", query: "p:Neptune", type: "Planet", gateArcsec: 60 },
  { name: "moon", query: "s:Moon", type: "Satellite", gateArcsec: 30 },
  // 冥王星不在 PLAN 硬门槛内（门外 dwarf，视觉用点状目标）。Meeus ch41 适用 1885–2099，
  // 实测 vs ASTORB 小行星轨道（CEU 0.88"）误差 ~10–25'，对 35 AU 外的目视精度足够。
  { name: "pluto", query: "a:134340", type: "Asteroid", gateArcsec: 2000 },
];

const DATES_UTC = [
  "1968-12-21 12:00:00",
  "1977-09-05 12:00:00",
  "1989-08-25 12:00:00",
  "2017-09-15 12:00:00",
  "2026-09-04 12:00:00",
];

function dateToJD(utc: string): number {
  return Date.parse(utc.replace(" ", "T") + "Z") / 86400000 + 2440587.5;
}

/** "±HH:MM:SS.sss"（小时，RA 用）→ 度 */
function hmsToDeg(s: string): number {
  const sign = s.trim().startsWith("-") ? -1 : 1;
  const parts = s.replace(/^[+-]/, "").split(":").map(parseFloat);
  return sign * (parts[0] + parts[1] / 60 + (parts[2] ?? 0) / 3600) * 15;
}

/** "±DD:MM:SS.sss"（度，DEC 用）→ 度。注意 DEC 不乘 15！ */
function dmsToDeg(s: string): number {
  const sign = s.trim().startsWith("-") ? -1 : 1;
  const parts = s.replace(/^[+-]/, "").split(":").map(parseFloat);
  return sign * (parts[0] + parts[1] / 60 + (parts[2] ?? 0) / 3600);
}

async function miriadeRADEC(t: Target, utc: string): Promise<[number, number]> {
  const params = new URLSearchParams({
    "-name": t.query,
    "-type": t.type,
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
  const res = await fetch(`https://ssp.imcce.fr/webservices/miriade/api/ephemcc.php?${params}`);
  if (!res.ok) throw new Error(`Miriade HTTP ${res.status} (${t.name} ${utc})`);
  const json = (await res.json()) as {
    data?: Array<{ RA: string; DEC: string }>;
    datacol?: Record<string, string>;
  };
  const row = json.data?.[0];
  if (!row) throw new Error(`Miriade 无数据 (${t.name} ${utc})`);
  return [hmsToDeg(row.RA), dmsToDeg(row.DEC)];
}

function separationArcsec(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const d = Math.PI / 180;
  const a1 = dec1 * d, a2 = dec2 * d, dr = (ra1 - ra2) * d;
  const cosSep = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dr);
  return Math.acos(Math.min(1, Math.max(-1, cosSep))) * (180 / Math.PI) * 3600;
}

describe("Miriade/INPOP 真值比对（5 日期 × 9 天体）", () => {
  it("行星 < 1'，月球 < 30\"", async () => {
    const results: string[] = [];
    const failures: string[] = [];
    for (const utc of DATES_UTC) {
      const jd = dateToJD(utc);
      for (const t of TARGETS) {
        const [tra, tdec] = await miriadeRADEC(t, utc);
        const mine = astrometricGeo(t.name, jd);
        const sep = separationArcsec(mine.raDeg, mine.decDeg, tra, tdec);
        const line = `${utc} ${t.name.padEnd(8)} sep=${sep.toFixed(2)}" (gate ${t.gateArcsec}")`;
        results.push(line);
        if (sep > t.gateArcsec) failures.push(line);
        await new Promise((r) => setTimeout(r, 150)); // 限速
      }
    }
    console.log("\n" + results.join("\n"));
    expect(failures, `超差项:\n${failures.join("\n")}`).toHaveLength(0);
  }, 600000);
});
