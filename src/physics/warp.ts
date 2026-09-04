/**
 * M7 · 超光速引擎（曲速泡框架）与相对论渲染数学。
 * - 亚光速段（β<1）：真实狭义相对论——光行差、多普勒频移（渲染底座，任意速度生效）
 * - 超光速段（0.1c–100c）：曲速泡叙事框架，视觉规则由 β→1⁻ 的公式形态单调延伸
 * - 硬约束：SOI 内禁止点火；隧道星线全部源自真实 Hipparcos 恒星
 */
import type { Vec3 } from "./kepler.js";

export const C_KMS = 299792.458;

/** 相对论光行差：运动方向 uHat、星线方向 sHat（单位矢量）、β=v/c → 观察方向（仍为单位矢量）。
 *  cosθ' = (cosθ + β)/(1 + β cosθ)，垂直分量按相对论公式缩放。 */
export function aberrate(sHat: Vec3, uHat: Vec3, beta: number): Vec3 {
  const cosT = sHat.x * uHat.x + sHat.y * uHat.y + sHat.z * uHat.z;
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const cosT2 = (cosT + beta) / (1 + beta * cosT);
  // 垂直平面内的方位角保持，径向按 sinθ'/sinθ 缩放：
  // sinθ' = sinθ / (γ(1 + β cosθ))
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  const sinT2 = sinT / (gamma * (1 + beta * cosT));
  // sHat = cosT·uHat + perp（perp 为垂直分量）
  const perp = {
    x: sHat.x - cosT * uHat.x,
    y: sHat.y - cosT * uHat.y,
    z: sHat.z - cosT * uHat.z,
  };
  const pl = Math.hypot(perp.x, perp.y, perp.z);
  const k = pl > 1e-12 ? (sinT2 / sinT) / pl : 0;
  return {
    x: cosT2 * uHat.x + perp.x * k * (pl > 1e-12 ? pl : 0),
    y: cosT2 * uHat.y + perp.y * k * (pl > 1e-12 ? pl : 0),
    z: cosT2 * uHat.z + perp.z * k * (pl > 1e-12 ? pl : 0),
  };
}

/** 相对论多普勒因子 D = 1/(γ(1 − β cosθ))（θ 为星线与运动方向夹角）。>1 蓝移。 */
export function dopplerFactor(sHat: Vec3, uHat: Vec3, beta: number): number {
  const cosT = sHat.x * uHat.x + sHat.y * uHat.y + sHat.z * uHat.z;
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  return 1 / (gamma * (1 - beta * cosT));
}

export type WarpPhase = "IDLE" | "CHARGING" | "ENGAGED";

export interface WarpOptions {
  /** 充能秒数 */
  chargeSec?: number;
  /** 点火前必须离开所有行星 SOI（回调，返回当前主导天体） */
  dominantBodyFn?: () => string;
}

/** 曲速引擎状态机：IDLE → CHARGING → ENGAGED；SOI 内禁止点火。 */
export class WarpDrive {
  phase: WarpPhase = "IDLE";
  chargeLeft = 0;
  /** 节流阀（单位 c）：0.1–100 */
  throttleC = 1;
  /** 点火方向（单位矢量，惯性系） */
  dir: Vec3 = { x: 0, y: 0, z: 1 };
  private chargeSec: number;
  private dominantBodyFn?: () => string;
  /** 累计曲速位移（km，惯性系）——由 tick 返回，调用方叠加到飞船位置 */
  lastDisplacement: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(opts: WarpOptions = {}) {
    this.chargeSec = opts.chargeSec ?? 3;
    this.dominantBodyFn = opts.dominantBodyFn;
  }

  get beta(): number {
    return this.phase === "ENGAGED" ? this.throttleC : 0;
  }

  /** 请求点火：SOI 内（非日心）被拒绝。返回是否接受。 */
  engage(dir: Vec3): boolean {
    if (this.phase !== "IDLE") return false;
    if (this.dominantBodyFn && this.dominantBodyFn() !== "sun") return false; // SOI 内禁止点火
    this.dir = { ...dir };
    this.phase = "CHARGING";
    this.chargeLeft = this.chargeSec;
    return true;
  }

  disengage(): void {
    this.phase = "IDLE";
    this.chargeLeft = 0;
  }

  /** 推进 dtSimSec 秒（模拟时）。ENGAGED 时返回位移（km）。 */
  tick(dtSimSec: number): Vec3 {
    this.lastDisplacement = { x: 0, y: 0, z: 0 };
    if (this.phase === "CHARGING") {
      this.chargeLeft -= dtSimSec;
      if (this.chargeLeft <= 0) {
        this.chargeLeft = 0;
        this.phase = "ENGAGED";
      }
    } else if (this.phase === "ENGAGED") {
      const v = this.throttleC * C_KMS; // km/s
      this.lastDisplacement = {
        x: this.dir.x * v * dtSimSec,
        y: this.dir.y * v * dtSimSec,
        z: this.dir.z * v * dtSimSec,
      };
    }
    return this.lastDisplacement;
  }
}
