/**
 * 对数缩放相机逻辑（纯函数，便于单测）。
 * 相机距离以 log10 存储：滚轮一格 = 距离 ×10^k，从 100 m 到 42,000 km 连续无级缩放。
 */
export const MIN_LOG_DIST = Math.log10(100); // 100 m —— 贴地
export const MAX_LOG_DIST = Math.log10(4.2e7); // 42,000 km —— 全球视角

export function clampLogDist(log: number, min = MIN_LOG_DIST, max = MAX_LOG_DIST): number {
  return Math.min(max, Math.max(min, log));
}

/** 滚轮向下（deltaY > 0）拉远，向上推近。 */
export function applyWheel(logDist: number, deltaY: number, sensitivity = 0.0015): number {
  return clampLogDist(logDist + deltaY * sensitivity);
}
