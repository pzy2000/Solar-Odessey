/**
 * 飞船与 patched conics（M3）。
 * 飞船状态 = {中心天体, 相对中心的状态矢量}。传播为解析 Kepler（无漂移）；
 * 每次传播后做 SOI 检测，切换中心天体时在 f64 下重算相对状态（无跳变）。
 * 单位：km、km/s。框架：黄道 J2000。
 */
import { add, cross, dot, elementsFromState, norm, propagate, scale, sub, unit, type State, type Vec3 } from "./kepler.js";
import { bodyPosHelioM, GM, soiRadiusKm } from "../ephemeris/bodies.js";

const G0 = 9.80665; // m/s²

/** 天体日心位置（km，黄道 J2000）与其速度（km/s，中心差分 ±1 s）。 */
export function bodyStateKm(name: string, jdUTC: number): State {
  const p = bodyPosHelioM(name, jdUTC);
  const p1 = bodyPosHelioM(name, jdUTC + 1 / 86400);
  const p0 = bodyPosHelioM(name, jdUTC - 1 / 86400);
  return {
    r: { x: p.x / 1000, y: p.y / 1000, z: p.z / 1000 },
    v: { x: (p1.x - p0.x) / 2000, y: (p1.y - p0.y) / 2000, z: (p1.z - p0.z) / 2000 },
  };
}

const SOI_PLANETS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
const EARTH_MOON_SOI_FACTOR = Math.pow(GM.moon / GM.earth, 0.4);

/**
 * SOI 检测（层级）：日心 → 行星 SOI → 月球 SOI（相对母行星计算）。
 * 返回最内层主导天体名。
 */
export function dominantBody(helioKm: Vec3, jdUTC: number): string {
  let center = "sun";
  let planetPos: Vec3 | null = null;
  for (const name of SOI_PLANETS) {
    const b = bodyStateKm(name, jdUTC);
    const soi = soiRadiusKm(name, jdUTC);
    if (norm(sub(helioKm, b.r)) < soi) {
      center = name;
      planetPos = b.r;
      break;
    }
  }
  if (center === "earth") {
    const m = bodyStateKm("moon", jdUTC);
    const moonSoi = norm(sub(m.r, planetPos!)) * EARTH_MOON_SOI_FACTOR;
    if (norm(sub(helioKm, m.r)) < moonSoi) center = "moon";
  }
  return center;
}

export interface ShipState {
  center: string;
  rel: State;
  jdUTC: number;
}

/** 飞船日心状态（km, km/s）。 */
export function shipHelio(ship: ShipState): State {
  const c = bodyStateKm(ship.center, ship.jdUTC);
  return { r: add(c.r, ship.rel.r), v: add(c.v, ship.rel.v) };
}

/**
 * 传播飞船 dtSec 秒（正）。解析 Kepler + SOI 切换。
 * steps：dtSec 大时分为多步（默认 1 步即可，解析传播无漂移；多步用于沿线检测 SOI 穿越时刻）。
 */
export function propagateShip(ship: ShipState, dtSec: number, steps = 1): ShipState {
  let s: ShipState = { ...ship, rel: { r: { ...ship.rel.r }, v: { ...ship.rel.v } } };
  const stepDt = dtSec / steps;
  for (let i = 0; i < steps; i++) {
    const mu = GM[s.center] ?? GM.sun;
    const before = { jd: s.jdUTC };
    const relNew = propagate(s.rel, stepDt, mu);
    s = { center: s.center, rel: relNew, jdUTC: s.jdUTC + stepDt / 86400 };
    void before;
    // SOI 检测：日心位置 → 最内层天体
    const helio = shipHelio(s);
    const center = dominantBody(helio.r, s.jdUTC);
    if (center !== s.center) {
      // 重新定框：新相对状态 = 日心状态 − 新中心状态
      const nb = bodyStateKm(center, s.jdUTC);
      const helioV = shipHelio(s).v;
      s = {
        center,
        rel: { r: sub(helio.r, nb.r), v: sub(helioV, nb.v) },
        jdUTC: s.jdUTC,
      };
    }
  }
  return s;
}

/** 姿态方向（相对当前中心天体）。 */
export type Attitude = "prograde" | "retrograde" | "normal" | "antinormal" | "radialIn" | "radialOut";

export function attitudeDir(ship: ShipState, att: Attitude): Vec3 {
  const vHat = unit(ship.rel.v);
  const h = unit(cross(ship.rel.r, ship.rel.v));
  const radialOut = unit(sub(ship.rel.r, scale(vHat, dot(ship.rel.r, vHat))));
  switch (att) {
    case "prograde": return vHat;
    case "retrograde": return scale(vHat, -1);
    case "normal": return h;
    case "antinormal": return scale(h, -1);
    case "radialIn": return scale(radialOut, -1);
    case "radialOut": return radialOut;
  }
}

/** 飞船硬件：干重/燃料（t）、推力（kN）、比冲（s）。 */
export class Ship {
  name: string;
  dryMassT: number;
  fuelT: number;
  thrustKN: number;
  ispS: number;
  state: ShipState;

  constructor(opts: {
    name: string;
    dryMassT: number;
    fuelT: number;
    thrustKN: number;
    ispS: number;
    state: ShipState;
  }) {
    this.name = opts.name;
    this.dryMassT = opts.dryMassT;
    this.fuelT = opts.fuelT;
    this.thrustKN = opts.thrustKN;
    this.ispS = opts.ispS;
    this.state = opts.state;
  }

  totalMassT(): number {
    return this.dryMassT + this.fuelT;
  }

  /** 剩余 Δv 预算（m/s）：ve·ln(m0/mf)。 */
  dvBudgetMS(): number {
    const ve = this.ispS * G0;
    return ve * Math.log(this.totalMassT() / this.dryMassT);
  }

  /** 质量比对应的燃料需求（t）。 */
  fuelForDvMS(dvMS: number): number {
    const ve = this.ispS * G0;
    const m0 = this.totalMassT();
    return m0 * (1 - Math.exp(-dvMS / ve));
  }

  /** 冲量点火：沿 dir（单位矢量，中心天体系）施加 dvMS（m/s）。返回实际消耗燃料（t）。 */
  burn(dvMS: number, dir: Vec3): number {
    if (dvMS <= 0) return 0;
    const fuel = Math.min(this.fuelForDvMS(dvMS), this.fuelT);
    const actualDv = fuel <= 0 ? 0 : this.dvFromFuel(fuel);
    this.fuelT -= fuel;
    const dvKmS = actualDv / 1000;
    const vNew = add(this.state.rel.v, scale(unit(dir), dvKmS));
    this.state.rel = { r: { ...this.state.rel.r }, v: vNew };
    return fuel;
  }

  private dvFromFuel(fuelT: number): number {
    const ve = this.ispS * G0;
    return ve * Math.log(this.totalMassT() / (this.totalMassT() - fuelT));
  }

  /** 当前轨道要素（相对中心天体）。 */
  elements() {
    return elementsFromState(this.state.rel, GM[this.state.center] ?? GM.sun);
  }
}
