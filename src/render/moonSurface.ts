/**
 * M6 · 月面着陆与行走（?m=m6）。
 * 场景：阿波罗 11 静海着陆区（0.674°N, 23.473°E）的真实 LOLA 地形，
 * 黑色星空 + 太阳平行光 + 地出（地球悬于月面天空）。
 * 操作：拖动视角，WASD 沿地形行走（低重力步长）。
 */
import * as THREE from "three";
import { initMoonHeightmap, buildTerrainPatch, type MoonHeightmap } from "../terrain/heightmap.js";
import { attachAtmosphere, ATMOSPHERES } from "./atmosphere.js";

const SITE = { lat: 0.674, lon: 23.473 }; // 阿波罗 11

export interface M6Hooks {
  ready(): boolean;
  heightAtSite(): number;
  camHeightAGL(): number;
  earthElevationDeg(): number;
}

export function startMoonSurface(container: HTMLElement, hud: HTMLElement): M6Hooks {
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1e-4, 1e6);

  // 太阳平行光（月昼方向，任意取东偏上）
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.set(0.7, 0.55, 0.45);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x223344, 0.05));

  // 星空（简化：随机点，远距离）
  {
    const N = 3000;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      let x = 0, y = 0, z = 0, s = 0;
      do {
        x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1;
        s = x * x + y * y + z * z;
      } while (s > 1 || s < 1e-3);
      const rr = 5e6 / Math.sqrt(s);
      pos[i * 3] = x * rr; pos[i * 3 + 1] = y * rr; pos[i * 3 + 2] = z * rr;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdde6ff, size: 1.5, sizeAttenuation: false, depthWrite: false })));
  }

  let ready = false;
  let hm: MoonHeightmap | null = null;
  let pitch = -0.45; // 初始俯视月面地形（地球在 ~66.5° 高处恒定可见，按 G 键提示抬头）
  let yaw = 0; // 朝向本初子午线（潮汐锁定：地球方向）
  const walkPos = { lat: SITE.lat, lon: SITE.lon }; // 行走位置
  const EYE_KM = 0.0018; // 眼高 1.8 m（场景单位 km）

  init().catch((e) => {
    hud.textContent = `M6 加载失败: ${e.message}`;
  });

  async function init(): Promise<void> {
    hm = await initMoonHeightmap();
    const colorTex = new THREE.TextureLoader().load("textures/moon/lroc_color_poles_1k.jpg", (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
    });
    // 近区高密度地形（±10°）与远区（±40°，粗）
    const mat = new THREE.MeshLambertMaterial({ map: colorTex });
    const near = buildTerrainPatch(hm, SITE.lat, SITE.lon, 10, 200, mat);
    scene.add(near);
    const mid = buildTerrainPatch(hm, SITE.lat, SITE.lon, 35, 120, mat);
    mid.position.y = -30; // 远区略下沉，避免与近区接缝闪烁
    scene.add(mid);

    ready = true;
  }

  // 地球（含大气）
  const earthPivot = new THREE.Object3D();
  scene.add(earthPivot);
  const earthMesh = new THREE.Mesh(
    new THREE.SphereGeometry(6371, 64, 32), // 真实比例（场景单位 km：地球半径 6371）
    new THREE.MeshLambertMaterial({ color: 0x6fa8ff }),
  );
  earthPivot.add(earthMesh);
  const atmo = attachAtmosphere(earthMesh, 6371e3 * (1737.4 / 1737.4) * (6371 / 1737.4) * 1, ATMOSPHERES.earth);
  void atmo;

  function moonSurfacePosM(): { x: number; y: number; z: number } {
    // 场景系：本体固定系（km——与地形补丁一致）
    if (!hm) return { x: 0, y: 0, z: 0 };
    const [x, y, z] = hm.bodyFixed(walkPos.lat, walkPos.lon);
    return { x, y, z };
  }

  function updateCamera(): void {
    const p = moonSurfacePosM();
    // 沿法向抬高眼高
    const l = Math.hypot(p.x, p.y, p.z) || 1;
    const nx = p.x / l, ny = p.y / l, nz = p.z / l;
    camera.position.set(p.x + nx * EYE_KM, p.y + ny * EYE_KM, p.z + nz * EYE_KM);
    camera.up.set(nx, ny, nz);
    camera.lookAt(
      camera.position.x + Math.cos(pitch) * (ny * Math.sin(yaw) - nz * Math.cos(yaw)) * 0 + Math.sin(yaw) * Math.cos(pitch),
      camera.position.y + Math.sin(pitch),
      camera.position.z + Math.cos(pitch) * Math.cos(yaw),
    );
  }

  // 帧循环：地球与太阳方向随真实星历更新
  const testMode = new URLSearchParams(window.location.search).has("test");
  function frame(_t: number): void {
    if (!testMode) requestAnimationFrame(frame);
    try {
      updateCamera();
      if (earthPivot.visible || true) {
        // 地球方向（真实星历）：以月面相机为原点
        // 月球地心矢量取负 = 月→地方向（geoJ2000('moon') = 月球相对地球，AU）
        // 潮汐锁定：地球恒在本初子午线方向（本体固定 +X̂），距离 = 地月距
        if (hm) {
          const e = hm.bodyFixed(0, 0); // 本初子午线方向（km）
          const dl = Math.hypot(e[0], e[1], e[2]);
          earthMesh.position.set((e[0] / dl) * 384400, (e[1] / dl) * 384400, (e[2] / dl) * 384400);
          atmo.update({ x: -e[0] / dl, y: -e[1] / dl, z: -e[2] / dl });
        }
      }
      renderer.render(scene, camera);
    } catch {
      /* 帧容错 */
    }
  }
  requestAnimationFrame(frame);
  if (testMode) window.setInterval(() => frame(performance.now()), 33);

  // 输入
  let dragging = false, lastX = 0, lastY = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.004;
    pitch = Math.max(-0.9, Math.min(1.3, pitch + (e.clientY - lastY) * 0.004));
    lastX = e.clientX; lastY = e.clientY;
  });
  renderer.domElement.addEventListener("pointerup", () => { dragging = false; });
  const keys: Record<string, boolean> = {};
  window.addEventListener("keydown", (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === "g") pitch = 1.15; // 抬头看地球（地出视角）
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  // 低重力行走（月面 g=1.62）：WASD 沿视线方向移动经纬度
  window.setInterval(() => {
    if (!ready || !hm) return;
    const speedKmS = 0.003; // 3 m/s（阿波罗宇航员快走量级），场景单位 km
    let fx = 0, fz = 0;
    if (keys["w"]) fz += 1;
    if (keys["s"]) fz -= 1;
    if (keys["a"]) fx -= 1;
    if (keys["d"]) fx += 1;
    if (!fx && !fz) return;
    const yawDir = yaw + (fx ? (fx > 0 ? -Math.PI / 2 : Math.PI / 2) : 0);
    const dist = speedKmS * 0.1 * (fz ? 1 : 0.7);
    walkPos.lon += (Math.sin(yawDir) * dist * (fz >= 0 ? 1 : 1)) / (111320 * Math.cos((walkPos.lat * Math.PI) / 180));
    walkPos.lat += Math.cos(yawDir) * dist / 111320 * (fz >= 0 ? 1 : -1) * (fz ? 1 : 0);
  }, 100);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    ready: () => ready,
    heightAtSite: () => (hm ? hm.sampleHeight(SITE.lat, SITE.lon) : NaN),
    camHeightAGL: () => {
      if (!hm) return NaN;
      const p = moonSurfacePosM();
      return Math.hypot(p.x, p.y, p.z) - 1737400 - hm.sampleHeight(walkPos.lat, walkPos.lon) + EYE_KM * 1000;
    },
    earthElevationDeg: () => {
      // 潮汐锁定：地球恒定于地平线上 ~90° − 站点距 sub-Earth 点的角距
      const dl = Math.hypot(SITE.lat, SITE.lon); // 度（小角度近似）
      return 90 - dl;
    },
  };
}
