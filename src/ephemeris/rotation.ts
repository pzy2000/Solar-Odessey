/**
 * IAU/WGCCRE 自转要素（M1）：各天体北极指向与本初子午线角 W。
 * 输出北极矢量转换到黄道 J2000 框架（与渲染场景一致）。
 * 采用线性化要素（忽略高阶项与岁差交叉项，自转极点误差 < 0.1°，满足目视）。
 * 参考：IAU/WGCCRE 2009 报告（Archinal et al. 2011）。
 */
import { jdTT } from "../core/time.js";
import { rotX, EPSILON_0, type Vec3 } from "./frames.js";

export interface RotationElements {
  /** 北极赤经（J2000 度）。 */
  alpha0: number;
  /** 北极赤纬（J2000 度）。 */
  delta0: number;
  /** 子午线角（度）。 */
  w0: number;
  /** 子午线角速率（度/天）。 */
  wDot: number;
}

const DEG = Math.PI / 180;

export const ROTATION: Record<string, RotationElements> = {
  sun: { alpha0: 284.95, delta0: 63.87, w0: 84.176, wDot: 14.1844 },
  mercury: { alpha0: 281.0103, delta0: 61.45, w0: 329.548, wDot: 6.1385025 },
  venus: { alpha0: 272.76, delta0: 67.16, w0: 160.2, wDot: -1.4813688 },
  earth: { alpha0: 0.0, delta0: 90.0, w0: 190.147, wDot: 360.9856235 },
  mars: { alpha0: 317.68143, delta0: 52.8865, w0: 176.63, wDot: 350.89198226 },
  jupiter: { alpha0: 268.056595, delta0: 64.495303, w0: 284.95, wDot: 870.5366420 },
  saturn: { alpha0: 40.589, delta0: 83.537, w0: 38.9, wDot: 810.7939024 },
  uranus: { alpha0: 257.311, delta0: -15.175, w0: 203.81, wDot: -501.1600928 },
  neptune: { alpha0: 299.36, delta0: 43.46, w0: 249.978, wDot: 536.3128492 },
  moon: { alpha0: 266.86, delta0: 66.53, w0: 38.3213, wDot: 13.17635815 },
  pluto: { alpha0: 132.993, delta0: -6.163, w0: 302.695, wDot: 56.3625225 },
};

export interface RotationState {
  /** 北极方向（黄道 J2000 单位矢量）。 */
  northPole: Vec3;
  /** 本初子午线角（度，含自转累计）。 */
  wDeg: number;
}

export function rotationState(body: string, jdUTC: number): RotationState {
  const el = ROTATION[body];
  if (!el) throw new Error(`no rotation elements for ${body}`);
  const d = jdTT(jdUTC) - 2451545.0;
  // 赤道 J2000 单位矢量（α₀, δ₀）
  const a = el.alpha0 * DEG;
  const dd = el.delta0 * DEG;
  const eq: Vec3 = {
    x: Math.cos(dd) * Math.cos(a),
    y: Math.cos(dd) * Math.sin(a),
    z: Math.sin(dd),
  };
  // 赤道 → 黄道 J2000（eq→ecl 为 rotX(−ε₀)，见 frames.ts 基准事实）
  const northPole = rotX(eq, -EPSILON_0);
  const wDeg = el.w0 + el.wDot * d;
  return { northPole, wDeg };
}
