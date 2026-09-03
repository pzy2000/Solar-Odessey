import * as THREE from "three";
import { EARTH_RADIUS_M } from "../core/constants.js";

/**
 * 近场地面细节补丁（M0）：大球体三角网的弦高误差在 256 段下约 480 m，
 * 相机贴地时会低于弦面导致近场穿帮。此补丁在亚相机点铺设一小块
 * 随曲率下沉的 RTC（relative-to-center）高密度网格——顶点坐标为米级局部量，
 * f32 精度 1e-4 m，彻底消除近场量化。
 *
 * M6 将用完整的 LOLA/MOLA quadtree LOD 替换本补丁。
 */
const PATCH_SIZE_M = 4000; // 边长 4 km
const PATCH_SEGS = 192; // 顶点间距 ~21 m
const REBUILD_STEP_M = 300; // 亚相机点移动超过该距离才重建几何
const MAX_ALT_M = 20000; // 高空隐藏（远距离对数深度分辨率不足以区分补丁与球面）

export class GroundPatch {
  mesh: THREE.Mesh;
  calls = 0;
  lastAlt = NaN;
  private cx = 0;
  private cy = 0;
  private cz = 0;
  private built = false;

  constructor(material: THREE.ShaderMaterial) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false; // 补丁几何随相机构建，包围球不可靠
  }

  /** camX/Y/Z：相机位置（double，行星本地系，米） */
  update(camX: number, camY: number, camZ: number): void {
    this.calls++;
    const r = Math.hypot(camX, camY, camZ);
    const alt = r - EARTH_RADIUS_M;
    this.lastAlt = alt;
    this.mesh.visible = alt < MAX_ALT_M;
    if (!this.mesh.visible) return;

    const s = EARTH_RADIUS_M / r;
    const px = camX * s;
    const py = camY * s;
    const pz = camZ * s;
    if (!this.built || Math.hypot(px - this.cx, py - this.cy, pz - this.cz) > REBUILD_STEP_M) {
      this.rebuild(px, py, pz); // 只重建几何（局部坐标，米级量级）
    }

    // 浮动原点：每帧重算相机相对矩阵。基架随亚相机点方向更新；
    // 平移 = 亚相机点 − 相机（f64 计算，量级 ~高度 + 2 km，f32 安全）。
    const R = EARTH_RADIUS_M;
    const ux = px / R, uy = py / R, uz = pz / R;
    let ex = -uz, ey = 0, ez = ux; // east = normalize(cross(kY, up))
    const el = Math.hypot(ex, ey, ez);
    if (el < 1e-6) { ex = 1; ey = 0; ez = 0; } else { ex /= el; ez /= el; }
    const nx = uy * ez - uz * ey; // north = cross(up, east)
    const ny = uz * ex - ux * ez;
    const nz = ux * ey - uy * ex;
    this.mesh.matrix.makeBasis(
      new THREE.Vector3(ex, ey, ez),
      new THREE.Vector3(nx, ny, nz),
      new THREE.Vector3(ux, uy, uz),
    ).setPosition(px - camX, py - camY, pz - camZ);
    this.mesh.matrixWorldNeedsUpdate = true;
  }

  private rebuild(px: number, py: number, pz: number): void {
    const R = EARTH_RADIUS_M;
    this.cx = px;
    this.cy = py;
    this.cz = pz;

    // 本地基架：up = 径向，east/north = 切向（极点附近退化保护）
    const ux = px / R, uy = py / R, uz = pz / R;
    let ex = -uz, ey = 0, ez = ux; // east = normalize(cross(kY, up))
    let el = Math.hypot(ex, ey, ez);
    if (el < 1e-6) { ex = 1; ey = 0; ez = 0; el = 1; }
    ex /= el; ey /= el; ez /= el;
    const nx = uy * ez - uz * ey; // north = cross(up, east)
    const ny = uz * ex - ux * ez;
    const nz = ux * ey - uy * ex;

    // 中心 UV（与 three SphereGeometry 参数化一致：x=-r·cosφ·sinθ, z=r·sinφ·sinθ）
    const phi0 = Math.atan2(pz, -px);
    const u0 = phi0 / (2 * Math.PI);

    const N = PATCH_SEGS;
    const half = PATCH_SIZE_M / 2;
    const step = PATCH_SIZE_M / N;
    const count = (N + 1) * (N + 1);
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const indices = new Uint32Array(N * N * 6);

    let vi = 0, ui = 0;
    for (let j = 0; j <= N; j++) {
      const n = -half + j * step;
      for (let i = 0; i <= N; i++) {
        const e = -half + i * step;
        const dip = -(e * e + n * n) / (2 * R); // 抛物线近似球面下沉，2 km 内误差 < 1e-5 m
        // 局部坐标（右手基：east/north/up），量级 ≤ ~2.1e3，f32 精度 1e-4 m
        positions[vi] = e;
        positions[vi + 1] = n;
        positions[vi + 2] = dip;
        normals[vi] = 0; // 局部系法线 = +Z（up），经 modelMatrix 旋转后指向径向
        normals[vi + 1] = 0;
        normals[vi + 2] = 1;
        // UV：经度差 wrap 到 [-π, π]，配合 RepeatWrapping 避免接缝
        const wx = px + ex * e + nx * n + ux * dip;
        const wy = py + ey * e + ny * n + uy * dip;
        const wz = pz + ez * e + nz * n + uz * dip;
        const phi = Math.atan2(wz, -wx);
        let dPhi = phi - phi0;
        if (dPhi > Math.PI) dPhi -= 2 * Math.PI;
        if (dPhi < -Math.PI) dPhi += 2 * Math.PI;
        uvs[ui] = u0 + dPhi / (2 * Math.PI);
        uvs[ui + 1] = 1 - Math.acos(Math.min(1, Math.max(-1, wy / R))) / Math.PI;
        vi += 3;
        ui += 2;
      }
    }
    let ii = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i;
        // 逆时针绕序（从上方看）：east×north = up，法线朝上
        indices[ii++] = a;
        indices[ii++] = a + 1;
        indices[ii++] = a + N + 1;
        indices[ii++] = a + 1;
        indices[ii++] = a + N + 2;
        indices[ii++] = a + N + 1;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    this.built = true;
  }
}
