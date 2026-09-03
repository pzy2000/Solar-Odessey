/**
 * 坐标框架（M1）：黄道/赤道/岁差转换。
 * 约定：本项目星历输出统一为 **日心黄道 J2000 直角坐标**（AU），与 JPL Horizons 一致。
 * VSOP87/月球/冥王星理论输出为"当日黄道"球坐标，此处负责转换回 J2000。
 * 精度：IAU-76 岁差 + 平黄赤交角（忽略章动与框架偏差 ~0.02"，远小于验收门槛 1'）。
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const ARCSEC = Math.PI / (180 * 3600);
export const EPSILON_0 = 84381.406 * ARCSEC; // J2000 平黄赤交角

/** 平黄赤交角（当日），IAU-76，T 为儒略世纪数。 */
export function meanObliquity(T: number): number {
  return (
    EPSILON_0 -
    46.815 * ARCSEC * T -
    0.00059 * ARCSEC * T * T +
    0.001813 * ARCSEC * T * T * T
  );
}

/** 绕 X 轴旋转：y' = y·cos a − z·sin a；z' = y·sin a + z·cos a。 */
export function rotX(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

export function rotY(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

export function rotZ(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
}

/**
 * 当日黄道 → J2000 黄道。
 * 链条：v_ecl_date →[rotX(+ε_date)]→ v_eq_date →[Rz(−ζ)·Ry(θ)·Rz(−z)]→ v_eq_J2000
 *   →[rotX(−ε₀)]→ v_ecl_J2000。
 * 基准事实：黄道北极在赤道系 = (0, −sinε, cosε) → ecl→eq 为 rotX(+ε)，eq→ecl 为 rotX(−ε)。
 * 岁差组合由数值实验标定（verify/debug：date 二分点矢量 (1,0,0) 必须输出 λ_J2000 = −p_A·T）；
 * 注意这是被动/主动约定问题——按经典符号直接使用 Vallado 的 P 矩阵，勿" intuitively "取逆。
 */
export function eclipticDateToJ2000(v: Vec3, T: number): Vec3 {
  const eps = meanObliquity(T);
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * ARCSEC;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * ARCSEC;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * ARCSEC;
  let r = rotX(v, eps);
  r = rotZ(r, -zeta);
  r = rotY(r, theta);
  r = rotZ(r, -z);
  return rotX(r, -EPSILON_0);
}

/** 黄道 J2000 → 赤道 J2000（求 RA/Dec 用）。 */
export function eclipticToEquatorial(v: Vec3): Vec3 {
  return rotX(v, EPSILON_0);
}
