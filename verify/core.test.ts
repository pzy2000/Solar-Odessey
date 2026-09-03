import { describe, expect, it } from "vitest";
import { applyWheel, clampLogDist, MAX_LOG_DIST, MIN_LOG_DIST } from "../src/core/cameraZoom.js";
import { splitDouble } from "../src/core/doubleSplit.js";

describe("doubleSplit", () => {
  it("hi+lo 以远超 f32 的精度还原 double（行星半径量级）", () => {
    const v = 6371000.123456789;
    const [hi, lo] = splitDouble(v);
    expect(hi + lo).toBeCloseTo(v, 6); // 误差 < 5e-7，纯 f32 只有 ~0.25
  });

  it("在 1 AU 量级同样成立（未来多天体场景）", () => {
    const v = 1.495978707e11 + 12345.678;
    const [hi, lo] = splitDouble(v);
    expect(Math.abs(hi + lo - v)).toBeLessThan(1e-2);
  });
});

describe("cameraZoom", () => {
  it("滚轮缩放单调且方向正确", () => {
    const base = Math.log10(1e6);
    expect(applyWheel(base, -100)).toBeLessThan(base); // 上滚推近
    expect(applyWheel(base, 100)).toBeGreaterThan(base); // 下滚拉远
  });

  it("夹在 [100 m, 42000 km] 区间内", () => {
    expect(applyWheel(-50, -1e6)).toBeCloseTo(MIN_LOG_DIST);
    expect(applyWheel(50, 1e6)).toBeCloseTo(MAX_LOG_DIST);
    expect(clampLogDist(4)).toBe(4); // 区间内不干预
  });
});
