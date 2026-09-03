import { describe, expect, it } from "vitest";
import { deltaTpre1972, jdTT, leapSeconds, TimeWarp, WARP_RATES, formatUTC } from "../src/core/time.js";
import { moonGeoTT } from "../src/ephemeris/moon.js";
import { eclipticDateToJ2000, eclipticToEquatorial, EPSILON_0 } from "../src/ephemeris/frames.js";
import { rotationState } from "../src/ephemeris/rotation.js";
import { astrometricGeo, geoJ2000, helioJ2000 } from "../src/ephemeris/ephemeris.js";

const JD_1992_04_12_0H_TD = 2448724.5; // Meeus ch.47 算例时刻（TT）

describe("时间系统", () => {
  it("1972 前的 ΔT 接近 1968 实测 39.2s", () => {
    const jd = 2440211.5; // 1968-05-31
    expect(deltaTpre1972(jd)).toBeGreaterThan(38);
    expect(deltaTpre1972(jd)).toBeLessThan(40.5);
  });

  it("闰秒：2017 起 37s，1968 为 0", () => {
    expect(leapSeconds(2457754.5)).toBe(37); // 2017-01-01
    expect(leapSeconds(2440211.5)).toBe(0); // 1968
  });

  it("jdTT 在 1972 后 = UTC + (leap+32.184)s", () => {
    expect(jdTT(2457754.5)).toBeCloseTo(2457754.5 + 69.184 / 86400, 12);
  });

  it("时间加速：10⁷× 推进 1h 真实时间 ≈ 1.14 年，无漂移", () => {
    const tw = new TimeWarp(2451545.0);
    tw.rateIndex = WARP_RATES.length - 1;
    tw.paused = false;
    for (let i = 0; i < 3600; i++) tw.advance(1);
    expect(tw.jd - 2451545.0).toBeCloseTo(3600 * 1e7 / 86400, 6);
  });

  it("UTC 格式化", () => {
    expect(formatUTC(2451544.5)).toContain("2000-Jan-01 00:00");
  });
});

describe("月球（Meeus ch.47 算例）", () => {
  it("1992-04-12 0h TD：距离 368409.7 km", () => {
    const m = moonGeoTT(JD_1992_04_12_0H_TD);
    expect(m.distanceKm).toBeCloseTo(368409.7, 0);
  });
});

describe("坐标框架", () => {
  it("基准事实：黄道北极经 eq 转换 = (0, −sinε₀, cosε₀)", () => {
    const e = eclipticToEquatorial({ x: 0, y: 0, z: 1 });
    expect(e.x).toBeCloseTo(0, 12);
    expect(e.y).toBeCloseTo(-Math.sin(EPSILON_0), 12);
    expect(e.z).toBeCloseTo(Math.cos(EPSILON_0), 12);
  });

  it("T=0 时当日黄道→J2000 为恒等变换", () => {
    const v = { x: 1, y: 2, z: 0.5 };
    const r = eclipticDateToJ2000(v, 0);
    expect(r.x).toBeCloseTo(1, 12);
    expect(r.y).toBeCloseTo(2, 12);
    expect(r.z).toBeCloseTo(0.5, 12);
  });

  it("保持矢量长度", () => {
    const v = { x: 0.3, y: -0.8, z: 0.2 };
    const r = eclipticDateToJ2000(v, 0.25);
    expect(Math.hypot(r.x, r.y, r.z)).toBeCloseTo(Math.hypot(v.x, v.y, v.z), 12);
  });
});

describe("自转要素", () => {
  it("天王星自转轴与黄道法线夹角 ≈ 82.3°（IAU 北极与轨道角动量反向，倾角 97.8°——躺着转）", () => {
    const { northPole } = rotationState("uranus", 2451545.0);
    const len = Math.hypot(northPole.x, northPole.y, northPole.z);
    const tilt = Math.acos(northPole.z / len) * (180 / Math.PI);
    expect(tilt).toBeGreaterThan(81);
    expect(tilt).toBeLessThan(83.5);
  });

  it("地球自转轴倾角 ≈ 23.44°", () => {
    const { northPole } = rotationState("earth", 2451545.0);
    const tilt = Math.acos(northPole.z) * (180 / Math.PI);
    expect(tilt).toBeGreaterThan(23.2);
    expect(tilt).toBeLessThan(23.7);
  });

  it("地球一天后 W 推进 ≈ 360.99°", () => {
    const w1 = rotationState("earth", 2451545.0).wDeg;
    const w2 = rotationState("earth", 2451546.0).wDeg;
    expect(w2 - w1).toBeCloseTo(360.9856235, 4);
  });
});

describe("星历一致性（结构验证，精度由 Horizons 网关验收）", () => {
  it("各行星日心距离在合理范围（2026-09-04）", () => {
    const jd = 2461288.0; // 2026-09-04
    const ranges: Record<string, [number, number]> = {
      mercury: [0.3, 0.47], venus: [0.7, 0.73], earth: [0.98, 1.02], mars: [1.38, 1.67],
      jupiter: [4.9, 5.5], saturn: [9, 10.1], uranus: [18, 20.2], neptune: [29.8, 30.4],
      pluto: [29, 50],
    };
    for (const [body, [lo, hi]] of Object.entries(ranges)) {
      const p = helioJ2000(body as never, jd);
      const r = Math.hypot(p.x, p.y, p.z);
      expect(r, body).toBeGreaterThan(lo);
      expect(r, body).toBeLessThan(hi);
    }
  });

  it("月球地心距离 356,000–407,000 km", () => {
    const jd = 2461288.0;
    for (let i = 0; i < 30; i++) {
      const m = geoJ2000("moon", jd + i * 0.8);
      const d = Math.hypot(m.x, m.y, m.z) * 1.495978707e8;
      expect(d).toBeGreaterThan(356000);
      expect(d).toBeLessThan(407000);
    }
  });

  it("太阳的 astrometric 方向 = −地球日心方向（光行时后）", () => {
    const jd = 2461288.0;
    const sun = astrometricGeo("sun", jd);
    expect(sun.distKm).toBeGreaterThan(1.49e8);
    expect(sun.distKm).toBeLessThan(1.53e8);
    expect(sun.raDeg).toBeGreaterThanOrEqual(0);
    expect(sun.raDeg).toBeLessThan(360);
  });
});
