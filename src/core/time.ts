/**
 * 时间系统（M1）：内部模拟时间为 JD(UTC)。
 * 星历计算按需换算为 TT：
 *   - 1972 起：TT = UTC + (闰秒 + 32.184)s（精确）；
 *   - 1972 前（含 1968 阿波罗任务）：TT − UT1 ≈ ΔT，Espenak & Meeus 多项式（1961–1986 段）。
 * 时间加速为解析推进（星历本身是解析级数），任意倍率无累积误差。
 */

export const J2000_JD = 2451545.0;
export const SEC_PER_DAY = 86400;

/** 闰秒表：UTC JD → 累计闰秒。2017-01-01（37s）之后外推维持 37s。 */
const LEAP_TABLE: Array<[number, number]> = [
  [2441317.5, 10], [2441499.5, 11], [2441551.5, 12], [2441606.5, 13],
  [2441683.5, 14], [2442048.5, 15], [2442413.5, 16], [2442778.5, 17],
  [2443144.5, 18], [2443509.5, 19], [2443874.5, 20], [2444239.5, 21],
  [2444786.5, 22], [2445151.5, 23], [2445516.5, 24], [2446247.5, 25],
  [2447161.5, 26], [2447892.5, 27], [2448257.5, 28], [2448804.5, 29],
  [2449169.5, 30], [2449534.5, 31], [2450083.5, 32], [2450630.5, 33],
  [2451179.5, 34], [2453736.5, 35], [2454832.5, 36], [2457204.5, 37],
];

export function leapSeconds(jdUTC: number): number {
  let n = 0;
  for (const [jd, s] of LEAP_TABLE) if (jdUTC >= jd) n = s;
  return n;
}

/** ΔT（秒），仅用于 1972 年之前。Espenak & Meeus 1961–1986 段（1968-12 实测 ≈39.2s ✓）。 */
export function deltaTpre1972(jdUTC: number): number {
  const y = 2000 + (jdUTC - J2000_JD) / 365.25;
  const t = y - 1975;
  return 45.45 + 1.067 * t - (t * t) / 260 - (t * t * t) / 718;
}

/** JD(UTC) → JD(TT)。 */
export function jdTT(jdUTC: number): number {
  if (jdUTC >= 2441317.5) return jdUTC + (leapSeconds(jdUTC) + 32.184) / SEC_PER_DAY;
  return jdUTC + deltaTpre1972(jdUTC) / SEC_PER_DAY;
}

/** 自 J2000（TT）起的儒略世纪数。 */
export function julianCenturiesTT(jdUTC: number): number {
  return (jdTT(jdUTC) - J2000_JD) / 36525;
}

export const WARP_RATES = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7];

export class TimeWarp {
  jd: number;
  rateIndex = 0;
  paused = true;
  reverse = false;

  constructor(jd: number) {
    this.jd = jd;
  }

  get rate(): number {
    return WARP_RATES[this.rateIndex];
  }

  faster(): void {
    this.rateIndex = Math.min(WARP_RATES.length - 1, this.rateIndex + 1);
  }

  slower(): void {
    this.rateIndex = Math.max(0, this.rateIndex - 1);
  }

  /** realDtSec：真实流逝秒数。返回推进的模拟天数。 */
  advance(realDtSec: number): number {
    if (this.paused) return 0;
    const dDays = (realDtSec * this.rate) / SEC_PER_DAY * (this.reverse ? -1 : 1);
    this.jd += dDays;
    return dDays;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** JD(UTC) → "YYYY-MMM-DD HH:MM UTC"（供 HUD）。 */
export function formatUTC(jdUTC: number): string {
  const z = jdUTC + 0.5;
  const f = Math.floor(z);
  const sec = Math.round((z - f) * SEC_PER_DAY);
  const dayFrac = Math.floor(sec / 60);
  const s = sec % 60;
  const h = Math.floor(dayFrac / 60);
  const m = dayFrac % 60;
  let a = Math.floor(f + 32044);
  const b = Math.floor((4 * a + 3) / 146097);
  a -= Math.floor((146097 * b) / 4);
  const c = Math.floor((4 * a + 3) / 1461);
  a -= Math.floor((1461 * c) / 4);
  const e = Math.floor((5 * a + 2) / 153);
  const day = a - Math.floor((153 * e + 2) / 5) + 1;
  const month = e + 3 - 12 * Math.floor(e / 10);
  const year = 100 * b + c - 4800 + Math.floor(e / 10);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${MONTHS[month - 1]}-${pad(day)} ${pad(h)}:${pad(m)}:${pad(s)} UTC`;
}
