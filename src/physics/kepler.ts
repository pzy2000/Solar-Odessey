/**
 * 轨道力学核心（M3）：状态矢量 ↔ 经典轨道要素、Kepler 传播（universal variables，
 * 椭圆/抛物/双曲统一）、Lambert 问题（universal variable + Stumpff 函数）。
 * 全部 f64；单位由调用方约定（本文件不假设 km/m，只要求 r/v/μ 一致）。
 * 框架约定：所有函数在"中心天体惯性系"下工作（本引擎用黄道 J2000）。
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const unit = (a: Vec3): Vec3 => scale(a, 1 / norm(a));
const TAU = Math.PI * 2;

/** Stumpff 函数 C(z), S(z) */
export function stumpffC(z: number): number {
  if (z > 1e-8) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-8) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5 - z / 24 + z * z / 720;
}
export function stumpffS(z: number): number {
  if (z > 1e-8) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-8) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + z * z / 5040;
}

export interface State {
  r: Vec3;
  v: Vec3;
}

/** 二体能量（比机械能） */
export function energy(s: State, mu: number): number {
  return (dot(s.v, s.v)) / 2 - mu / norm(s.r);
}
/** 比角动量 */
export function angMomentum(s: State): Vec3 {
  return cross(s.r, s.v);
}

/** 从状态矢量求经典要素（弧度）。e ≥ 1 时 a 为负（双曲半长轴）。 */
export interface Elements {
  a: number;
  e: number;
  i: number;
  om: number; // Ω 升交点赤经
  w: number; // ω 近拱点幅角
  nu: number; // 真近点角
}

export function elementsFromState(s: State, mu: number): Elements {
  const rm = norm(s.r);
  const vm2 = dot(s.v, s.v);
  const h = cross(s.r, s.v);
  const hm = norm(h);
  const evec = scale(sub(scale(s.r, vm2 - mu / rm), scale(s.v, dot(s.r, s.v))), 1 / mu);
  const e = norm(evec);
  const energy = vm2 / 2 - mu / rm;
  const a = -mu / (2 * energy);
  const nHat = v3(0, 0, 1);
  const node = cross(nHat, h);
  const nm = norm(node);
  const i = Math.acos(Math.min(1, Math.max(-1, h.z / hm)));
  const om = nm > 1e-12 ? Math.atan2(node.y, node.x) : 0;
  let w = 0;
  if (nm > 1e-12 && e > 1e-12) {
    w = Math.acos(Math.min(1, Math.max(-1, dot(node, evec) / (nm * e))));
    if (evec.z < 0) w = TAU - w;
  } else if (e > 1e-12) {
    w = Math.atan2(evec.y, evec.x);
  }
  let nu = 0;
  if (e > 1e-12) {
    nu = Math.acos(Math.min(1, Math.max(-1, dot(evec, s.r) / (e * rm))));
    if (dot(s.r, s.v) < 0) nu = TAU - nu;
  }
  return { a, e, i, om, w, nu };
}

/** 由经典要素生成状态矢量（椭圆或双曲）。 */
export function stateFromElements(el: Elements, mu: number): State {
  const p = el.a * (1 - el.e * el.e);
  const rm = p / (1 + el.e * Math.cos(el.nu));
  // 近心点坐标系：x̂ 指向近心点，ẑ = h
  const xp = rm * Math.cos(el.nu);
  const yp = rm * Math.sin(el.nu);
  const h = Math.sqrt(mu * p);
  const vxp = (-h / p) * el.e * Math.sin(el.nu);
  const vyp = (h / p) * (1 + el.e * Math.cos(el.nu));
  // 旋转：Rz(om)·Rx(i)·Rz(w)（平面内矢量 z 分量为 0，第三列不参与）
  const co = Math.cos(el.om), so = Math.sin(el.om);
  const cw = Math.cos(el.w), sw = Math.sin(el.w);
  const ci = Math.cos(el.i), si = Math.sin(el.i);
  const r11 = co * cw - so * sw * ci;
  const r12 = -co * sw - so * cw * ci;
  const r21 = so * cw + co * sw * ci;
  const r22 = -so * sw + co * cw * ci;
  const r31 = sw * si;
  const r32 = cw * si;
  return {
    r: v3(r11 * xp + r12 * yp, r21 * xp + r22 * yp, r31 * xp + r32 * yp),
    v: v3(r11 * vxp + r12 * vyp, r21 * vxp + r22 * vyp, r31 * vxp + r32 * vyp),
  };
}

/** 单步残差：F(χ)=0 即为解。 */
function residual(chi: number, rm0: number, rdotv0: number, alpha: number, sqmu: number, dt: number): number {
  const z = alpha * chi * chi;
  const C = stumpffC(z);
  const S = stumpffS(z);
  return (rdotv0 / sqmu) * chi * chi * C + (1 - alpha * rm0) * chi * chi * chi * S + rm0 * chi - sqmu * dt;
}

/** 开普勒传播：从 state 出发 Δt 秒（可负）。universal variables（Vallado Alg. 8）。
 *  牛顿迭代 + 单调二分兜底：椭圆/抛物/双曲统一鲁棒。 */
export function propagate(s0: State, dt: number, mu: number, tol = 1e-12): State {
  // 时间对称：负 dt 用速度镜像化为正 dt
  const s: State = dt >= 0 ? s0 : { r: { ...s0.r }, v: scale(s0.v, -1) };
  const absDt = Math.abs(dt);
  const rm0 = norm(s.r);
  const v02 = dot(s.v, s.v);
  const rdotv0 = dot(s.r, s.v);
  const alpha = -v02 / mu + 2 / rm0; // 1/a（双曲为负）
  const sqmu = Math.sqrt(mu);

  let chi: number;
  if (Math.abs(alpha) < 1e-12) {
    // 抛物线初值
    const h = cross(s.r, s.v);
    const p = dot(h, h) / mu;
    const s0 = 0.5 * Math.atan2(1, 3 * Math.sqrt(mu / (p * p * p)) * absDt);
    const w0 = Math.atan(Math.cbrt(Math.tan(s0)));
    chi = Math.sqrt(p) * 2 / Math.tan(2 * w0);
  } else if (alpha > 0) {
    // 椭圆初值
    chi = sqmu * absDt * alpha;
  } else {
    // 双曲初值（asinh 平滑，任意量级稳定）
    const aHyp = 1 / -alpha;
    chi = Math.sqrt(aHyp) * Math.asinh((-mu * absDt) / (Math.sqrt(aHyp) * 10));
  }

  const F = (c: number): number => residual(c, rm0, rdotv0, alpha, sqmu, absDt);
  // 牛顿迭代
  let converged = false;
  for (let iter = 0; iter < 60; iter++) {
    const z = alpha * chi * chi;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const f =
      (rdotv0 / sqmu) * chi * chi * C + (1 - alpha * rm0) * chi * chi * chi * S + rm0 * chi - sqmu * absDt;
    const dfdchi =
      (rdotv0 / sqmu) * chi * (1 - z * S) + (1 - alpha * rm0) * chi * chi * C + rm0 * (1 - z * C);
    const d = f / dfdchi;
    chi -= d;
    if (Math.abs(d) < tol * Math.max(1, Math.abs(chi))) {
      converged = true;
      break;
    }
  }
  // 二分兜底：F(χ) 对 χ 单调增；从 0 扩张上界后二分
  if (!converged) {
    let lo = 0;
    let hi = Math.max(1, chi);
    while (F(hi) < 0 && hi < 1e12) hi = hi * 2 + 1;
    for (let iter = 0; iter < 120; iter++) {
      const mid = (lo + hi) / 2;
      if (F(mid) < 0) lo = mid;
      else hi = mid;
      if (hi - lo < tol) break;
    }
    chi = (lo + hi) / 2;
  }

  const z = alpha * chi * chi;
  const C = stumpffC(z);
  const S = stumpffS(z);
  const Fc = 1 - (chi * chi / rm0) * C;
  const G = absDt - (chi * chi * chi / sqmu) * S;
  const rNew = add(scale(s.r, Fc), scale(s.v, G));
  const rm1 = norm(rNew);
  const Fd = (sqmu / (rm0 * rm1)) * chi * (alpha * chi * chi * S - 1);
  const Gd = 1 - (chi * chi / rm1) * C;
  const vNew = add(scale(s.v, Gd), scale(s.r, Fd));
  return dt >= 0 ? { r: rNew, v: vNew } : { r: rNew, v: scale(vNew, -1) };
}

/** Lambert 问题：给定 r1、r2、飞行时间 dt、μ，求 v1、v2（universal variables，Vallado Alg. 57）。 */
export function lambert(
  r1v: Vec3,
  r2v: Vec3,
  dt: number,
  mu: number,
  prograde = true,
  tol = 1e-10,
): { v1: Vec3; v2: Vec3 } {
  const r1 = norm(r1v);
  const r2 = norm(r2v);
  const cosdnu = Math.min(1, Math.max(-1, dot(r1v, r2v) / (r1 * r2)));
  let dnu = Math.acos(cosdnu);
  const cross12 = cross(r1v, r2v);
  const isProgradeActual = prograde ? cross12.z >= 0 : cross12.z < 0;
  if (!isProgradeActual) dnu = TAU - dnu;

  const A = Math.sin(dnu) * Math.sqrt((r1 * r2) / (1 - Math.cos(dnu)));
  const sqmu = Math.sqrt(mu);

  let psi = 0;
  let psiUp = 4 * Math.PI * Math.PI;
  let psiLow = -4 * Math.PI;
  let c2 = stumpffC(psi);
  let c3 = stumpffS(psi);
  let y = r1 + r2 + A * ((psi * c3 - 1) / Math.sqrt(c2));
  let dtCalc = 0;

  for (let iter = 0; iter < 200; iter++) {
    if (A > 0 && y < 0) {
      // y<0 表示该 ψ 不可行（解在更小的 ψ 一侧）：视同过冲，向上收窄区间
      psiUp = psi;
      psi = (psiUp + psiLow) / 2;
      c2 = stumpffC(psi);
      c3 = stumpffS(psi);
      y = r1 + r2 + A * ((psi * c3 - 1) / Math.sqrt(c2));
      continue;
    }
    const chi = Math.sqrt(Math.max(1e-12, y / c2));
    dtCalc = (chi * chi * chi * c3 + A * Math.sqrt(y)) / sqmu;
    if (Math.abs(dtCalc - dt) < tol * dt) break;
    if (dtCalc <= dt) psiLow = psi;
    else psiUp = psi;
    psi = (psiUp + psiLow) / 2;
    c2 = stumpffC(psi);
    c3 = stumpffS(psi);
    y = r1 + r2 + A * ((psi * c3 - 1) / Math.sqrt(c2));
  }

  const f = 1 - y / r1;
  const g = A * Math.sqrt(y);
  const gd = 1 - y / r2;
  // v = √μ/g × (r − f·r0)（量纲：g 为 km^1.5，需 ×√μ 才是 km/s）
  return {
    v1: scale(sub(r2v, scale(r1v, f)), sqmu / g),
    v2: scale(sub(r2v, scale(r1v, gd)), sqmu / g),
  };
}
