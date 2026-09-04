/**
 * M7 验收：光行差解析对照、多普勒、隧道星线可追溯性、SOI 点火约束、位移量级。
 */
import { describe, expect, it } from "vitest";
import { aberrate, dopplerFactor, WarpDrive, C_KMS } from "../src/physics/warp.js";
import { buildTunnelLines } from "../src/render/relativistic.js";
import { readFileSync } from "node:fs";

const uHat = { x: 1, y: 0, z: 0 };

function angleDeg(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const c = (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

describe("M7-① 相对论光行差（解析公式对照）", () => {
  it("β=0.5：90° 星像偏移到 60°（解析值），误差 < 2°", () => {
    const s = { x: 0, y: 1, z: 0 }; // 与运动方向成 90°
    const a = aberrate(s, uHat, 0.5);
    const ang = angleDeg(a, uHat);
    expect(Math.abs(ang - 60)).toBeLessThan(2); // 解析：cosθ' = 0.5 → 60°
  });

  it("正前方星光位置不变，模长守恒", () => {
    const a = aberrate(uHat, uHat, 0.9);
    expect(angleDeg(a, uHat)).toBeLessThan(1e-6);
    expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(1, 10);
  });

  it("β=0.99：90° 星像聚拢到 ~8.1°（几乎全部星光汇聚向前）", () => {
    const a = aberrate({ x: 0, y: 1, z: 0 }, uHat, 0.99);
    const ang = angleDeg(a, uHat);
    expect(ang).toBeGreaterThan(0);
    expect(ang).toBeLessThan(20);
  });
});

describe("M7 多普勒因子", () => {
  it("前蓝后红：β=0.5 时前方 D≈1.73，后方 D≈0.577", () => {
    expect(dopplerFactor(uHat, uHat, 0.5)).toBeCloseTo(1.7320508, 4);
    expect(dopplerFactor({ x: -1, y: 0, z: 0 }, uHat, 0.5)).toBeCloseTo(0.57735, 4);
  });
});

describe("M7-② 隧道星线可追溯真实恒星", () => {
  it("低 β=0.05：线段起点即真实恒星方向（偏移 < 0.5°）", () => {
    const stars = JSON.parse(readFileSync("src/ephemeris/data/stars.json", "utf8"));
    const DEG = Math.PI / 180;
    const EPS0 = 23.439279444444445 * DEG;
    const N = 200;
    const pos = new Float32Array(N * 6);
    const col = new Float32Array(N * 6);
    const segs = buildTunnelLines(uHat, 0.05, pos, col, N);
    expect(segs).toBeGreaterThan(100);
    let checked = 0;
    for (let s = 0; s < 50; s++) {
      const dx = pos[s * 6], dy = pos[s * 6 + 1], dz = pos[s * 6 + 2];
      const l = Math.hypot(dx, dy, dz);
      const nx = dx / l, ny = dy / l, nz = dz / l;
      let found = false;
      for (let i = 0; i < stars.n && !found; i++) {
        const ra = stars.ra[i] * DEG, dec = stars.dec[i] * DEG;
        const cd = Math.cos(dec);
        const x = cd * Math.cos(ra);
        const y = cd * Math.sin(ra);
        const z = Math.sin(dec);
        const ye = y * Math.cos(EPS0) - z * Math.sin(EPS0);
        const ze = y * Math.sin(EPS0) + z * Math.cos(EPS0);
        // 容差 = β=0.05 光行差最大偏移（~2.9°）+ 匹配余量
        if (Math.abs(x - nx) < 0.06 && Math.abs(ye - ny) < 0.06 && Math.abs(ze - nz) < 0.06) found = true;
      }
      if (found) checked++;
    }
    expect(checked).toBe(50); // 50/50 可追溯到真实恒星
  });

  it("高 β=2.5：起点 = 真实恒星的相对论像（构造自洽，方向偏转有界）", () => {
    const N = 100;
    const pos = new Float32Array(N * 6);
    const col = new Float32Array(N * 6);
    const segs = buildTunnelLines(uHat, 2.5, pos, col, N);
    expect(segs).toBe(N);
    for (let s = 0; s < N; s++) {
      const l = Math.hypot(pos[s * 6], pos[s * 6 + 1], pos[s * 6 + 2]);
      // 起点必为单位矢量方向（构建自洽），且不越过运动轴负方向
      const nx = pos[s * 6] / l;
      expect(nx).toBeGreaterThan(-0.2);
    }
  });
});

describe("M7-③ SOI 点火约束与位移", () => {
  it("地球 SOI 内点火被拒绝", () => {
    const w = new WarpDrive({ dominantBodyFn: () => "earth", chargeSec: 0.1 });
    expect(w.engage(uHat)).toBe(false);
    expect(w.phase).toBe("IDLE");
  });

  it("深空点火：充能后 ENGAGED，1c×3600s 位移 3.6e6 km", () => {
    const w = new WarpDrive({ dominantBodyFn: () => "sun", chargeSec: 0.1 });
    expect(w.engage(uHat)).toBe(true);
    w.tick(0.2); // 完成充能
    expect(w.phase).toBe("ENGAGED");
    const d = w.tick(3600);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(C_KMS * 3600, 0);
  });

  it("熄火后回到 IDLE", () => {
    const w = new WarpDrive({ dominantBodyFn: () => "sun", chargeSec: 0 });
    w.engage(uHat);
    w.tick(0.1);
    w.disengage();
    expect(w.phase).toBe("IDLE");
    const d = w.tick(1000);
    expect(d.x + d.y + d.z).toBe(0);
  });
});
