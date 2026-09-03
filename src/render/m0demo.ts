import * as THREE from "three";
import { EARTH_RADIUS_M } from "../core/constants.js";
import { splitDouble } from "../core/doubleSplit.js";
import { applyWheel, clampLogDist } from "../core/cameraZoom.js";
import { GroundPatch } from "../terrain/groundPatch.js";

/**
 * M0 · 尺度验证 PoC
 *
 * 验证内容（PLAN.md M0 验收）：
 *  1. 1:1 尺度（地球半径 6371 km）下，相机从 4 万 km 连续推近到 100 m 高度，
 *     无顶点抖动、无穿洞——大球走 double-split（hi/lo 仿真双精度）着色器，
 *     近场由 RTC 地面细节补丁承载（Grand Unified Scale 方法）；
 *  2. 对数深度缓冲覆盖 [0.1 m, 1e13 m]，全程无 z-fighting；
 *  3. NASA 真纹理地球无接缝渲染。
 *
 * 自转不旋转顶点（避免大坐标 f32 量化随姿态变化），M2 起由 UV 偏移实现。
 */

const DIST_INIT = 2.2e7; // 22,000 km
const SUN_DIR = new THREE.Vector3(1.0, 0.18, 0.35).normalize();
const FOV = 50;
const NEAR = 0.1;
const FAR = 1e13;

const VERT = /* glsl */ `
  uniform vec3 uCamHi;
  uniform vec3 uCamLo;
  varying vec2 vUv;
  varying vec3 vNormalL;
  varying vec2 vLocalXZ;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
  #ifdef IS_PATCH
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vLocalXZ = position.xy;
  #else
    // 相机相对坐标：hi/lo 仿真双精度减法，消除 1:1 半径下的 f32 灾难性抵消
    vec3 rel = (position - uCamHi) - uCamLo;
    vec4 mv = viewMatrix * vec4(rel, 1.0);
    vLocalXZ = vec2(0.0);
  #endif
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    // 法线变换到行星本地系（基球 modelMatrix=单位阵；补丁经 basis 旋转），保证光照坐标系一致
    vNormalL = mat3(modelMatrix) * normal;
    #include <logdepthbuf_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDirL;
  uniform float uGrid;
  varying vec2 vUv;
  varying vec3 vNormalL;
  varying vec2 vLocalXZ;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float ndl = dot(normalize(vNormalL), uSunDirL);
    float day = clamp(ndl, 0.0, 1.0);
    vec3 col = texture2D(uMap, vUv).rgb;
    if (uGrid > 0.5) {
      // 50 m 精度标尺网格：贴地时直观展示几何稳定性（验收用）
      vec2 gc = vLocalXZ / 50.0;
      vec2 gv = abs(fract(gc - 0.5) - 0.5) / fwidth(gc);
      float line = 1.0 - min(min(gv.x, gv.y), 1.0);
      col = mix(col, vec3(0.25, 1.0, 0.45), line * 0.7);
    }
    gl_FragColor = vec4(col * (day * 1.3 + 0.012), 1.0);
    #include <colorspace_fragment>
  }
`;

function makeTempStars(): THREE.Points {
  const N = 4000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    let x = 0, y = 0, z = 0, s = 0;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
      s = x * x + y * y + z * z;
    } while (s > 1 || s < 1e-4);
    const r = 1e10 / Math.sqrt(s);
    pos[i * 3] = x * r;
    pos[i * 3 + 1] = y * r;
    pos[i * 3 + 2] = z * r;
    const b = 0.55 + Math.random() * 0.45;
    const tint = Math.random();
    col[i * 3] = b * (0.9 + tint * 0.1);
    col[i * 3 + 1] = b * 0.95;
    col[i * 3 + 2] = b * (1.0 - tint * 0.08);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }),
  );
}

export interface OdysseyHooks {
  fps(): number;
  altitude(): number;
  setAltitude(m: number): void;
  setView(azRad: number, polRad: number): void;
  setGrid(enabled: boolean): void;
  setBaseVisible(b: boolean): void;
  setPatchBasic(b: boolean): void;
  textureLoaded(): boolean;
  debug(): Record<string, unknown>;
}

export function startEarthDemo(container: HTMLElement, hud: HTMLElement): OdysseyHooks {
  const consoleErrors: string[] = [];
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (consoleErrors.length < 20) consoleErrors.push(args.map(String).join(" "));
    origError(...args);
  };

  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  window.addEventListener("error", (e) => {
    if (consoleErrors.length < 20) consoleErrors.push(`onerror: ${e.message}`);
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(makeTempStars());

  // ---- 共享纹理 ----
  const loader = new THREE.TextureLoader();
  let texLoaded = false;
  const tex = loader.load("textures/earth/blue_marble.jpg", (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.wrapS = THREE.RepeatWrapping;
    texLoaded = true;
  });

  const baseUniforms = {
    uMap: { value: tex },
    uSunDirL: { value: SUN_DIR.clone() },
    uCamHi: { value: new THREE.Vector3() },
    uCamLo: { value: new THREE.Vector3() },
    uGrid: { value: 0 },
  };
  const patchUniforms = {
    uMap: { value: tex },
    uSunDirL: { value: SUN_DIR.clone() },
    uGrid: { value: 0 },
  };

  // ---- 大球：行星本地系（中心即原点），double-split 相机 uniform ----
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS_M, 256, 128),
    new THREE.ShaderMaterial({ uniforms: baseUniforms, vertexShader: VERT, fragmentShader: FRAG }),
  );
  scene.add(earth);

  // ---- 近场地面细节补丁 ----
  const patchShaderMat = new THREE.ShaderMaterial({
    uniforms: patchUniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { IS_PATCH: 1 },
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const patchBasicMat = new THREE.MeshBasicMaterial({ color: 0xff2222, side: THREE.DoubleSide });
  const patch = new GroundPatch(patchShaderMat);
  scene.add(patch.mesh);

  const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, NEAR, FAR);

  // ---- 相机状态（double）----
  let az = 0.6;
  let pol = 1.35;
  let logDist = Math.log10(DIST_INIT);

  function updateCamera(): void {
    const r = Math.pow(10, logDist);
    const sp = Math.sin(pol), cp = Math.cos(pol);
    const px = r * sp * Math.cos(az);
    const py = r * cp;
    const pz = r * sp * Math.sin(az);

    let fx = -px, fy = -py, fz = -pz;
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    let rx = fz, ry = 0, rz = -fx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;
    camera.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(rx, ry, rz),
        new THREE.Vector3(ux, uy, uz),
        new THREE.Vector3(-fx, -fy, -fz),
      ),
    );

    const [hx, lx] = splitDouble(px);
    const [hy, ly] = splitDouble(py);
    const [hz, lz] = splitDouble(pz);
    (baseUniforms.uCamHi.value as THREE.Vector3).set(hx, hy, hz);
    (baseUniforms.uCamLo.value as THREE.Vector3).set(lx, ly, lz);

    patch.update(px, py, pz);
  }

  // ---- 输入 ----
  let dragging = false;
  let lastX = 0, lastY = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    az -= (e.clientX - lastX) * 0.0025;
    pol = Math.min(Math.PI - 0.05, Math.max(0.05, pol - (e.clientY - lastY) * 0.0025));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  renderer.domElement.addEventListener("pointerup", () => { dragging = false; });
  renderer.domElement.addEventListener("wheel", (e) => {
    e.preventDefault();
    logDist = applyWheel(logDist, e.deltaY);
  }, { passive: false });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- HUD 与帧循环 ----
  let fpsEma = 60;
  let lastT = performance.now();
  let hudT = 0;

  function fmtAlt(m: number): string {
    if (m >= 1e6) return `${(m / 1e3).toFixed(0)} km`;
    if (m >= 1e4) return `${(m / 1e3).toFixed(1)} km`;
    return `${m.toFixed(m >= 1000 ? 0 : 2)} m`;
  }

  // ---- 帧循环驱动 ----
  // 常规：rAF 自驱动 + 看门狗（宿主冻结 rAF 时降级为 4fps 保活）。
  // ?test=1：纯 setInterval 驱动，供自动化验收环境（rAF 被冻结的内嵌浏览器）使用。
  const testMode = new URLSearchParams(window.location.search).has("test");
  let lastRafT = performance.now();

  function frame(t: number): void {
    if (!testMode) {
      lastRafT = t;
      requestAnimationFrame(frame);
    }
    try {
      const dt = Math.max(1e-4, (t - lastT) / 1000);
      lastT = t;
      fpsEma = fpsEma * 0.92 + (1 / dt) * 0.08;

      updateCamera();
      renderer.render(scene, camera);

      hudT += dt;
      if (hudT > 0.2) {
        hudT = 0;
        const alt = Math.pow(10, logDist) - EARTH_RADIUS_M;
        hud.textContent =
          `M0 · 尺度验证 PoC（拖动旋转 · 滚轮缩放 · G 网格）\n` +
          `相机高度: ${fmtAlt(Math.max(0, alt))}   FPS: ${fpsEma.toFixed(0)}`;
      }
    } catch (e) {
      if (consoleErrors.length < 20) consoleErrors.push(`frame: ${(e as Error)?.stack ?? String(e)}`);
    }
  }

  requestAnimationFrame(frame);
  if (testMode) {
    window.setInterval(() => frame(performance.now()), 8);
  } else {
    window.setInterval(() => {
      if (performance.now() - lastRafT > 250) frame(performance.now());
    }, 250);
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "g" || e.key === "G") {
      const on = baseUniforms.uGrid.value > 0.5 ? 0 : 1;
      baseUniforms.uGrid.value = on;
      patchUniforms.uGrid.value = on;
    }
  });

  const hooks: OdysseyHooks = {
    fps: () => Math.round(fpsEma),
    altitude: () => Math.pow(10, logDist) - EARTH_RADIUS_M,
    setAltitude(m: number) {
      logDist = clampLogDist(Math.log10(EARTH_RADIUS_M + Math.max(0, m)));
    },
    setView(azRad: number, polRad: number) {
      az = azRad;
      pol = Math.min(Math.PI - 0.05, Math.max(0.05, polRad));
    },
    setGrid(enabled: boolean) {
      baseUniforms.uGrid.value = enabled ? 1 : 0;
      patchUniforms.uGrid.value = enabled ? 1 : 0;
    },
    setBaseVisible(b: boolean) {
      earth.visible = b;
    },
    setPatchBasic(b: boolean) {
      patch.mesh.material = b ? patchBasicMat : patchShaderMat;
    },
    textureLoaded: () => texLoaded,
    debug: () => ({
      consoleErrors,
      grid: patchUniforms.uGrid.value,
      patchVisible: patch.mesh.visible,
      patchCalls: patch.calls,
      patchLastAlt: patch.lastAlt,
      patchVerts: (patch.mesh.geometry.getAttribute("position")?.count ?? 0),
      patchIdx: (patch.mesh.geometry.getIndex()?.count ?? 0),
      patchMatrix: Array.from(patch.mesh.matrix.elements),
      patchMatrixWorld: Array.from(patch.mesh.matrixWorld.elements),
      patchMWFlag: patch.mesh.matrixWorldNeedsUpdate,
      tri: renderer.info.render.triangles,
      drawCalls: renderer.info.render.calls,
      patchHasGeo: patch.mesh.geometry.getIndex() !== null,
    }),
  };
  (window as unknown as Record<string, unknown>).__odyssey = hooks;
  return hooks;
}
