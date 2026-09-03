/**
 * double → (hi, lo) 拆分：hi 是最接近原值的 float32，lo 是 hi 的舍入残差。
 * hi + lo（f64 下相加）以 ~1e-10 相对精度还原原值；
 * 着色器里用 (v - hi) - lo 做"仿真双精度"减法，
 * 消除 1:1 行星半径（~6.4e6 m）下的 float32 灾难性抵消（Outerra/Grand Unified Scale 方法）。
 */
export function splitDouble(v: number): [number, number] {
  const hi = Math.fround(v);
  const lo = Math.fround(v - hi);
  return [hi, lo];
}
