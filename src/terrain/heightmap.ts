/**
 * M6 · 月面高度图采样：LOLA 实测数据（SVS ldem_3_8bit, 2400×1200）。
 * 标定：8-bit 0..255 ↔ −9,061 m .. +10,787 m（月面实测最低/最高点）。
 * init 为异步（解码 jpg）；sampleHeight(latDeg, lonDeg) → 米（双线性插值）。
 */
import * as THREE from "three";

export const MOON_MIN_M = -9061;
export const MOON_MAX_M = 10787;

export interface MoonHeightmap {
  width: number;
  height: number;
  /** 行优先，行 0 = 北纬 90°。单位：米。 */
  heights: Float32Array;
  sampleHeight(latDeg: number, lonDeg: number): number;
  /** 本体固定系单位矢量（与 IAU 自转要素一致：经度东向自本初子午线）。 */
  bodyFixed(latDeg: number, lonDeg: number): [number, number, number];
}

export async function initMoonHeightmap(url = "textures/moon/ldem_3_8bit.jpg"): Promise<MoonHeightmap> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("heightmap load failed"));
    i.src = url;
  });
  const W = img.width;
  const H = img.height;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;
  const heights = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const v = data[i * 4]; // 灰度图 RGB 相同
    heights[i] = MOON_MIN_M + (v / 255) * (MOON_MAX_M - MOON_MIN_M);
  }
  const sampleHeight = (latDeg: number, lonDeg: number): number => {
    // equirect：行 0 = +90°，列 0 = −180°（双线性插值，经度环绕）
    const fx = ((lonDeg + 180) / 360) * W;
    const fy = ((90 - latDeg) / 180) * H;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const h = (xx: number, yy: number) => {
      const cx = ((xx % W) + W) % W;
      const cy = Math.min(H - 1, Math.max(0, yy));
      return heights[cy * W + cx];
    };
    return (
      h(x0, y0) * (1 - tx) * (1 - ty) +
      h(x0 + 1, y0) * tx * (1 - ty) +
      h(x0, y0 + 1) * (1 - tx) * ty +
      h(x0 + 1, y0 + 1) * tx * ty
    );
  };
  const bodyFixed = (latDeg: number, lonDeg: number): [number, number, number] => {
    const hKm = sampleHeight(latDeg, lonDeg) / 1000;
    const r = 1737.4 + hKm;
    const la = (latDeg * Math.PI) / 180;
    const lo = (lonDeg * Math.PI) / 180;
    return [r * Math.cos(la) * Math.cos(lo), r * Math.cos(la) * Math.sin(lo), r * Math.sin(la)];
  };
  return { width: W, height: H, heights, sampleHeight, bodyFixed };
}

/** 建一块月面地形网格（经纬度框，含高度位移与法线）。 */
export function buildTerrainPatch(
  hm: MoonHeightmap,
  latC: number,
  lonC: number,
  halfSizeDeg: number,
  segs: number,
  material: THREE.Material,
): THREE.Mesh {
  const N = segs;
  const pos = new Float32Array((N + 1) * (N + 1) * 3);
  const uv = new Float32Array((N + 1) * (N + 1) * 2);
  const idx = new Uint32Array(N * N * 6);
  let vi = 0, ui = 0;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const lat = latC - halfSizeDeg + (i / N) * 2 * halfSizeDeg;
      const lon = lonC - halfSizeDeg + (j / N) * 2 * halfSizeDeg;
      const [x, y, z] = hm.bodyFixed(lat, lon);
      pos[vi] = x; pos[vi + 1] = y; pos[vi + 2] = z;
      uv[ui] = (lon + 180) / 360;
      uv[ui + 1] = 1 - (lat + 90) / 180;
      vi += 3; ui += 2;
    }
  }
  let ii = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      idx[ii++] = a; idx[ii++] = a + 1; idx[ii++] = a + N + 1;
      idx[ii++] = a + 1; idx[ii++] = a + N + 2; idx[ii++] = a + N + 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.material.side = THREE.DoubleSide;
  return mesh;
}
