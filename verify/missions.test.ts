/**
 * M8 验收：三大任务事件时间线与 NASA 官方记录一致。
 */
import { describe, expect, it } from "vitest";
import { MISSIONS, missionStartJD, eventJD, jdFromISO } from "../src/gameplay/missions.js";

describe("M8 任务时间线 vs NASA 官方记录", () => {
  it("阿波罗 8：TLI/LOI-1/溅落时刻", () => {
    const a8 = MISSIONS.find((m) => m.id === "apollo8")!;
    expect(a8.events[0].t).toBe("1968-12-21T15:41:00Z"); // TLI（NASA 日志）
    expect(a8.events[1].t).toBe("1968-12-24T09:59:17Z"); // LOI-1 点火开始
    expect(a8.events[3].t).toBe("1968-12-27T15:49:00Z"); // 溅落
    // 地出时刻在 NASA 记录的拍摄窗口内（16:37–19:07 UTC）
    const er = eventJD(a8.events[2]);
    expect(er).toBeGreaterThan(jdFromISO("1968-12-24T16:37:00Z") - 1e-6);
    expect(er).toBeLessThan(jdFromISO("1968-12-24T19:07:00Z") + 1e-6);
  });

  it("旅行者 2 号：四行星飞掠日期", () => {
    const v2 = MISSIONS.find((m) => m.id === "voyager2")!;
    expect(v2.events[0].t.startsWith("1979-07-09")).toBe(true); // 木星
    expect(v2.events[1].t.startsWith("1981-08-25")).toBe(true); // 土星
    expect(v2.events[2].t.startsWith("1986-01-24")).toBe(true); // 天王星
    expect(v2.events[3].t.startsWith("1989-08-25")).toBe(true); // 海王星
  });

  it("卡西尼：环缝首穿与最终坠落", () => {
    const c = MISSIONS.find((m) => m.id === "cassini")!;
    expect(c.events[0].t.startsWith("2017-04-26")).toBe(true); // 首次穿越环缝
    expect(c.events[2].t.startsWith("2017-09-15")).toBe(true); // 坠入土星
  });

  it("任务时间单调递增且开始时刻正确", () => {
    for (const m of MISSIONS) {
      const start = missionStartJD(m);
      let prev = start;
      for (const e of m.events) {
        const t = eventJD(e);
        expect(t).toBeGreaterThanOrEqual(prev);
        prev = t;
      }
    }
    expect(missionStartJD(MISSIONS[0])).toBeCloseTo(jdFromISO("1968-12-21T12:51:00Z"), 8);
  });
});
