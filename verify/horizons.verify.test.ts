/**
 * M1 验收网关（Horizons 版）：与 JPL Horizons 实测比对（需要网络，JPL 可达时使用）。
 * 运行：npm run verify:horizons
 * 注：本网络环境可能无法直连 JPL——此时自动 SKIP，改跑 npm run verify:truth（IMCCE Miriade/INPOP，同为权威真值）。
 * 比对口径：地心 astrometric RA/Dec（QUANTITIES=1，光行时校正、无光行差）。
 */
import { describe, expect, it } from "vitest";
import { astrometricGeo, type BodyName } from "../src/ephemeris/ephemeris.js";

async function jplReachable(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 8000);
    await fetch("https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='%23barycenter'", { signal: ctl.signal });
    return true;
  } catch {
    return false;
  }
}

const BODIES: Array<{ name: BodyName; command: string; gateArcsec: number }> = [
  { name: "mercury", command: "199", gateArcsec: 60 },
  { name: "venus", command: "299", gateArcsec: 60 },
  { name: "mars", command: "499", gateArcsec: 60 },
  { name: "jupiter", command: "599", gateArcsec: 60 },
  { name: "saturn", command: "699", gateArcsec: 60 },
  { name: "uranus", command: "799", gateArcsec: 60 },
  { name: "neptune", command: "899", gateArcsec: 60 },
  { name: "moon", command: "301", gateArcsec: 30 },
  { name: "pluto", command: "999", gateArcsec: 600 },
];

const DATES_UTC = [
  "1968-12-21 12:00",
  "1977-09-05 12:00",
  "1989-08-25 12:00",
  "2017-09-15 12:00",
  "2026-09-04 12:00",
];

function dateToJD(utc: string): number {
  return Date.parse(utc.replace(" ", "T") + "Z") / 86400000 + 2440587.5;
}

async function horizonsRADEC(command: string, utc: string): Promise<[number, number]> {
  const params = new URLSearchParams({
    format: "text",
    COMMAND: `'${command}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'500@399'",
    START_TIME: `'${utc}'`,
    STOP_TIME: `'${utc}'`,
    STEP_SIZE: "'1m'",
    QUANTITIES: "'1'",
    ANG_FORMAT: "'DEG'",
    CAL_FORMAT: "'CAL'",
    TIME_DIGITS: "'MIN'",
  });
  const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`);
  if (!res.ok) throw new Error(`Horizons HTTP ${res.status}`);
  const text = await res.text();
  const soe = text.indexOf("$$SOE");
  const eoe = text.indexOf("$$EOE");
  if (soe < 0 || eoe < 0) throw new Error(`Horizons 无数据:\n${text.slice(0, 600)}`);
  const line = text
    .slice(soe + 5, eoe)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)[0];
  const nums = line.match(/-?\d+\.\d+/g);
  if (!nums || nums.length < 2) throw new Error(`无法解析行: ${line}`);
  return [parseFloat(nums[0]), parseFloat(nums[1])];
}

function separationArcsec(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const d = Math.PI / 180;
  const a1 = dec1 * d, a2 = dec2 * d, dr = (ra1 - ra2) * d;
  const cosSep =
    Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dr);
  return Math.acos(Math.min(1, Math.max(-1, cosSep))) * (180 / Math.PI) * 3600;
}

describe("Horizons 真值比对（5 日期 × 9 天体）", () => {
  it("行星 < 1'，月球 < 30\"", async () => {
    if (!(await jplReachable())) {
      console.warn("[SKIP] JPL 不可达，请改跑 npm run verify:truth（IMCCE INPOP 真值）");
      return;
    }
    const results: string[] = [];
    const failures: string[] = [];
    for (const utc of DATES_UTC) {
      const jd = dateToJD(utc);
      for (const body of BODIES) {
        const [hra, hdec] = await horizonsRADEC(body.command, utc);
        const mine = astrometricGeo(body.name, jd);
        const sep = separationArcsec(mine.raDeg, mine.decDeg, hra, hdec);
        const line = `${utc} ${body.name.padEnd(8)} sep=${sep.toFixed(2)}" (gate ${body.gateArcsec}")`;
        results.push(line);
        if (sep > body.gateArcsec) failures.push(line);
        await new Promise((r) => setTimeout(r, 120)); // 礼貌限速
      }
    }
    console.log(results.join("\n"));
    expect(failures, `超差项:\n${failures.join("\n")}`).toHaveLength(0);
  }, 300000);
});
