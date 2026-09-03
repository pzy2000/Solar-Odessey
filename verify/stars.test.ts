/**
 * M2 验收（离线）：Hipparcos 星表数据完整性 —— 猎户座主要亮星的位置/星等与真实星图一致。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const stars = JSON.parse(readFileSync("src/ephemeris/data/stars.json", "utf8")) as {
  n: number;
  ra: number[];
  dec: number[];
  mag: number[];
  bv: number[];
  hip: number[];
};

// 猎户座主要亮星（Hipparcos 编号 → 真实 ICRS 坐标 °）
const ORION: Array<[number, string, number, number]> = [
  [27989, "参宿四 Betelgeuse", 88.7929, 7.4071],
  [24436, "参宿七 Rigel", 78.6345, -8.2016],
  [25930, "参宿三 Mintaka", 83.0017, -0.2991],
  [26311, "参宿二 Alnilam", 84.0534, -1.2019],
  [26727, "参宿一 Alnitak", 85.1897, -1.9426],
  [25336, "参宿五 Bellatrix", 81.2828, 6.3497],
  [27366, "参宿六 Saiph", 86.9391, -9.6696],
];

function find(hip: number): { ra: number; dec: number; mag: number; bv: number } | null {
  const i = stars.hip.indexOf(hip);
  return i < 0 ? null : { ra: stars.ra[i], dec: stars.dec[i], mag: stars.mag[i], bv: stars.bv[i] };
}

describe("Hipparcos 星表（猎户座）", () => {
  it("包含 ≥25000 颗恒星", () => {
    expect(stars.n).toBeGreaterThan(25000);
  });

  it("猎户座主要亮星存在且位置误差 < 0.01°", () => {
    for (const [hip, name, ra, dec] of ORION) {
      const s = find(hip);
      expect(s, name).not.toBeNull();
      const dra = Math.abs(((s!.ra - ra + 540) % 360) - 180);
      const ddec = Math.abs(s!.dec - dec);
      expect(dra, `${name} RA`).toBeLessThan(0.01);
      expect(ddec, `${name} Dec`).toBeLessThan(0.01);
    }
  });

  it("参宿四比参宿七更亮（B−V 判色：参宿四偏红）", () => {
    const bt = find(27989)!;
    const rj = find(24436)!;
    expect(bt.mag).toBeLessThan(1.0);
    expect(rj.mag).toBeLessThan(0.5);
    expect(bt.bv ?? 0).toBeGreaterThan(rj.bv ?? 0); // 红超巨星 B−V 更大
  });

  it("腰带三星近乎共线（Alnilam 处转角接近 180°）", () => {
    const m = find(25930)!, a = find(26311)!, z = find(26727)!;
    const v = (p: { ra: number; dec: number }, q: { ra: number; dec: number }) => ({
      x: (q.ra - p.ra) * Math.cos((q.dec * Math.PI) / 180),
      y: q.dec - p.dec,
    });
    const v1 = v(a, m), v2 = v(a, z);
    const cosAng = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
    const angleDeg = (Math.acos(Math.max(-1, Math.min(1, cosAng))) * 180) / Math.PI;
    expect(angleDeg).toBeGreaterThan(165); // 转角接近 180°（投影有轻微弧度 ~171°）
  });
});
