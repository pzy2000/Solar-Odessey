/**
 * 卫星位置传播（M2）：平均轨道要素（圆轨道模型，源自 INPOP 拟合，见 tools/fetch_satellites.mjs）。
 * 基向量 P/Q 为黄道 J2000 框架；位置相对母星中心（km）。
 */
import data from "./data/satellites.json";

export interface MoonElements {
  parent: string;
  aKm: number;
  e: number;
  nRadDay: number;
  L0Rad: number;
  epochJD: number;
  P: [number, number, number];
  Q: [number, number, number];
  diameterKm: number;
}

export const MOONS = data as unknown as Record<string, MoonElements>;

/** 卫星相对母星中心的位置（黄道 J2000，km）。jdUTC 任意时标（内部换算 TT）。 */
export function moonPosLocal(moon: MoonElements, jdTT: number): [number, number, number] {
  const L = moon.L0Rad + moon.nRadDay * (jdTT - moon.epochJD);
  const cl = Math.cos(L);
  const sl = Math.sin(L);
  const a = moon.aKm;
  return [a * (cl * moon.P[0] + sl * moon.Q[0]), a * (cl * moon.P[1] + sl * moon.Q[1]), a * (cl * moon.P[2] + sl * moon.Q[2])];
}
