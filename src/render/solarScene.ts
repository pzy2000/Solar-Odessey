/**
 * M2 · 太阳系全家福场景
 * 架构：mesh.position = bodyPos − camPos（CPU f64 减法后转 f32）+ 内置 Lambert 材质。
 * 太阳光 = 单一平行光（真实：太阳光平行，方向随相机系更新）；自转 = IAU 要素四元数。
 * 注：double-split 着色器在多天体场景中与内置管线冲突（M2 调试结论），留待 M6 近场地形以
 * RTC 补丁形式回归（见 docs/ADR-001.md）。
 */
import * as THREE from "three";
import { formatUTC, TimeWarp, WARP_RATES } from "../core/time.js";
import { clampLogDist } from "../core/cameraZoom.js";
import { BODIES, bodyPosHelioM, bodyRotation, poleEcl, GM, type BodyDef } from "../ephemeris/bodies.js";
import { lightTimeMin, distanceKm, type BodyName } from "../ephemeris/ephemeris.js";
import { MOONS } from "../ephemeris/satellites.js";
import { jdTT as toTT } from "../core/time.js";
import starData from "../ephemeris/data/stars.json";
import { Ship, propagateShip, shipHelio, bodyStateKm, attitudeDir, type Attitude } from "../physics/ship.js";
import { elementsFromState, propagate, lambert, norm, sub } from "../physics/kepler.js";

const DEG = Math.PI / 180;
const STAR_R = 8e12;
const EPS0 = 23.439279444444445 * DEG;

function starColor(bv: number): [number, number, number] {
  const t = Math.max(-0.4, Math.min(2.0, bv));
  const g = Math.max(0.45, Math.min(1.0, 1.0 - 0.35 * t));
  const b = Math.max(0.5, Math.min(1.0, 1.0 - 0.55 * Math.max(0, t)));
  return [1.0 - 0.2 * Math.max(0, -t), g, b];
}

function makeStarField(): THREE.Points {
  const N = starData.n;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const size = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const ra = starData.ra[i] * DEG;
    const dec = starData.dec[i] * DEG;
    const cd = Math.cos(dec);
    const x = cd * Math.cos(ra);
    const y = cd * Math.sin(ra);
    const z = Math.sin(dec);
    const ce = Math.cos(EPS0), se = Math.sin(EPS0);
    pos[i * 3] = x * STAR_R;
    pos[i * 3 + 1] = y * ce - z * se;
    pos[i * 3 + 2] = y * se + z * ce;
    const m = starData.mag[i];
    const b = Math.max(0.12, Math.min(1, Math.pow(10, -0.28 * (m - 0.15))));
    const [r, g, bl] = starColor(starData.bv[i]);
    col[i * 3] = b * r;
    col[i * 3 + 1] = b * g;
    col[i * 3 + 2] = b * bl;
    size[i] = m < 1 ? 3.2 : m < 2 ? 2.6 : m < 3.5 ? 2.1 : m < 5 ? 1.6 : 1.25;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  return new THREE.Points(geo, new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying vec3 vColor;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vColor = color;
        vec4 mv = viewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.12, length(d));
        gl_FragColor = vec4(vColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
  }));
}

function makeMilkyWay(): THREE.Mesh {
  const tex = new THREE.TextureLoader().load("textures/planets/sky/milky_way.jpg", (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
  });
  return new THREE.Mesh(
    new THREE.SphereGeometry(STAR_R * 1.1, 48, 24),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false }),
  );
}

function makeSunSprite(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,250,235,1)");
  g.addColorStop(0.22, "rgba(255,235,190,0.95)");
  g.addColorStop(0.4, "rgba(255,190,110,0.35)");
  g.addColorStop(1, "rgba(255,170,80,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.setScalar(2.6e9);
  return s;
}

interface BodyRender {
  def: BodyDef;
  mesh: THREE.Mesh;
  label: HTMLDivElement;
}

export interface M2Hooks {
  fps(): number;
  target(): string;
  setTarget(name: string): void;
  setDist(m: number): void;
  setJD(jd: number): void;
  bodyScreen(name: string): { x: number; y: number; visible: boolean };
  targets(): string[];
  debug(): Record<string, unknown>;
}

export function startSolarScene(container: HTMLElement, _hud: HTMLElement, flight = false): M2Hooks {
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(makeStarField());
  scene.add(makeMilkyWay());
  scene.add(makeSunSprite());

  // 太阳平行光（方向每帧更新）+ 微弱环境光
  const sunLight = new THREE.DirectionalLight(0xfff2dd, 3.0);
  scene.add(sunLight);
  scene.add(sunLight.target);
  scene.add(new THREE.AmbientLight(0x223344, 0.06));

  const loader = new THREE.TextureLoader();
  const bodyRenders: BodyRender[] = [];
  for (const def of BODIES) {
    const seg = def.radiusM > 2e6 ? 96 : 48;
    let material: THREE.Material;
    if (def.texture) {
      material = new THREE.MeshLambertMaterial({
        map: loader.load(def.texture, (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }),
      });
    } else {
      material = new THREE.MeshLambertMaterial({ color: new THREE.Color(def.color) });
    }
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radiusM, seg, seg / 2), material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const label = document.createElement("div");
    label.textContent = def.label;
    label.style.cssText =
      "position:fixed;z-index:5;font:11px ui-monospace,monospace;color:rgba(190,225,255,0.92);" +
      "text-shadow:0 0 4px #000;pointer-events:none;transform:translate(-50%,-140%);white-space:nowrap;";
    container.appendChild(label);
    bodyRenders.push({ def, mesh, label });
  }

  // ---- 卫星轨道环 ----
  const orbitLines: Array<{ line: THREE.Line; parent: string }> = [];
  {
    const mat = new THREE.LineBasicMaterial({ color: 0x4a6f9f, transparent: true, opacity: 0.35 });
    for (const [key, el] of Object.entries(MOONS)) {
      if (key === "moon") continue;
      const N = 180;
      const pos = new Float32Array((N + 1) * 3);
      for (let i = 0; i <= N; i++) {
        const L = (i / N) * Math.PI * 2;
        const cl = Math.cos(L);
        const sl = Math.sin(L);
        pos[i * 3] = el.aKm * 1000 * (cl * el.P[0] + sl * el.Q[0]);
        pos[i * 3 + 1] = el.aKm * 1000 * (cl * el.P[1] + sl * el.Q[1]);
        pos[i * 3 + 2] = el.aKm * 1000 * (cl * el.P[2] + sl * el.Q[2]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      orbitLines.push({ line, parent: el.parent });
    }
  }

  // ---- 相机与时间 ----
  let targetName = "earth";
  let az = 0.8;
  let pol = 1.25;
  let logDist = Math.log10(6e6);
  const warp = new TimeWarp(Date.now() / 86400000 + 2440587.5);
  warp.paused = false;

  // ---- 飞行模式（M3）：飞船、轨道线、点火控制、porkchop ----
  const GM_EARTH_KM = 398600.4354;
  let ship: Ship | null = null;
  let shipOrbit: THREE.Line | null = null;
  let shipMarker: THREE.Mesh | null = null;
  const shipLabel = document.createElement("div");
  const flightPanel = document.createElement("div");

  function refreshOrbitLine(): void {
    if (!ship || !shipOrbit) return;
    const els = elementsFromState(ship.state.rel, GM_EARTH_KM);
    const N = 64;
    const arr = (shipOrbit.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    if (els.e >= 0.98) {
      shipOrbit.visible = false;
      return;
    }
    shipOrbit.visible = true;
    const T = 2 * Math.PI * Math.sqrt(Math.pow(els.a, 3) / GM_EARTH_KM);
    for (let i = 0; i <= N; i++) {
      const st = propagate(ship.state.rel, (i / N) * T, GM_EARTH_KM);
      arr[i * 3] = st.r.x * 1000;
      arr[i * 3 + 1] = st.r.y * 1000;
      arr[i * 3 + 2] = st.r.z * 1000;
    }
    (shipOrbit.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  function drawPorkchop(): void {
    if (!ship) return;
    const c = flightPanel.querySelector("#f-pork") as HTMLCanvasElement | null;
    const info = flightPanel.querySelector("#f-porkinfo") as HTMLElement | null;
    if (!c || !info) return;
    const ctx = c.getContext("2d")!;
    const W = c.width, H = c.height;
    const Ndep = 60, Ntof = 36;
    const dep0 = warp.jd, depStep = 5, tof0 = 120, tofStep = 8;
    const img = ctx.createImageData(W, H);
    let minV = Infinity;
    let best = { i: 0, j: 0 };
    const grid: number[][] = [];
    for (let i = 0; i < Ndep; i++) {
      grid.push([]);
      for (let j = 0; j < Ntof; j++) grid[i].push(Infinity);
    }
    for (let i = 0; i < Ndep; i++) {
      const jd = dep0 + i * depStep;
      const rE = bodyStateKm("earth", jd);
      for (let j = 0; j < Ntof; j++) {
        const tof = tof0 + j * tofStep;
        const rM = bodyStateKm("mars", jd + tof);
        try {
          const { v1 } = lambert(rE.r, rM.r, tof * 86400, GM.sun);
          const vInf = norm(sub(v1, rE.v));
          grid[i][j] = vInf;
          if (vInf < minV) {
            minV = vInf;
            best = { i, j };
          }
        } catch {
          grid[i][j] = Infinity;
        }
      }
    }
    for (let px = 0; px < W; px++) {
      for (let py = 0; py < H; py++) {
        const i = Math.min(Ndep - 1, Math.floor((px / W) * Ndep));
        const j = Math.min(Ntof - 1, Math.floor((1 - py / H) * Ntof));
        const v = grid[i][j];
        const t = Math.max(0, Math.min(1, (v - 2.4) / 6));
        const o = (py * W + px) * 4;
        img.data[o] = 30 + t * 225;
        img.data[o + 1] = 40 + (1 - t) * 180;
        img.data[o + 2] = 60 + (1 - t) * 90;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // 标注最小点
    const bx = ((best.i + 0.5) / Ndep) * W;
    const by = (1 - (best.j + 0.5) / Ntof) * H;
    ctx.strokeStyle = "#ffe08a";
    ctx.beginPath();
    ctx.arc(bx, by, 5, 0, Math.PI * 2);
    ctx.stroke();
    if (info) info.textContent = `最优: 第${(best.i * depStep).toFixed(0)}天出发 / tof ${(tof0 + best.j * tofStep).toFixed(0)}天  v∞=${minV.toFixed(2)} km/s`;
    c.onclick = (ev) => {
      const i = Math.min(Ndep - 1, Math.floor((ev.offsetX / W) * Ndep));
      const j = Math.min(Ntof - 1, Math.floor((1 - ev.offsetY / H) * Ntof));
      if (info) info.textContent = `选中: +${(i * depStep).toFixed(0)}天出发 / tof ${(tof0 + j * tofStep).toFixed(0)}天  v∞=${grid[i][j] === Infinity ? "∞" : grid[i][j].toFixed(2) + " km/s"}`;
    };
  }

  function initFlight(): void {
    const t0 = warp.jd;
    const eSt = bodyStateKm("earth", t0);
    const vm = Math.hypot(eSt.v.x, eSt.v.y, eSt.v.z);
    const vHat = { x: eSt.v.x / vm, y: eSt.v.y / vm, z: eSt.v.z / vm };
    const rp = 6678; // km，300 km LEO
    ship = new Ship({
      name: "奥德赛-1",
      dryMassT: 12, fuelT: 30, thrustKN: 80, ispS: 350,
      state: {
        center: "earth",
        rel: {
          r: { x: vHat.x * rp, y: vHat.y * rp, z: vHat.z * rp },
          v: { x: 0, y: 0, z: Math.sqrt(GM_EARTH_KM / rp) },
        },
        jdUTC: t0,
      },
    });
    shipMarker = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe08a }),
    );
    shipMarker.frustumCulled = false;
    scene.add(shipMarker);
    shipOrbit = new THREE.Line(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(65 * 3), 3)),
      new THREE.LineBasicMaterial({ color: 0x7fe08a, transparent: true, opacity: 0.8 }),
    );
    shipOrbit.frustumCulled = false;
    scene.add(shipOrbit);

    shipLabel.textContent = "奥德赛-1";
    shipLabel.style.cssText = "position:fixed;z-index:5;font:11px ui-monospace,monospace;color:#ffe08a;text-shadow:0 0 4px #000;pointer-events:none;transform:translate(-50%,-140%);";
    container.appendChild(shipLabel);

    flightPanel.style.cssText =
      "position:fixed;left:12px;top:12px;z-index:10;font:12px/1.6 ui-monospace,monospace;color:#c9ffc9;" +
      "background:rgba(0,20,12,0.6);padding:10px 12px;border-radius:8px;user-select:none;max-width:320px";
    flightPanel.innerHTML = `
      <b style="color:#c9ffc9">奥德赛-1</b>
      <div id="f-orbit"></div>
      <div id="f-dv"></div>
      <div style="margin:3px 0">点火 Δv: <input id="f-dvin" value="10" style="width:52px;background:rgba(255,255,255,0.08);border:1px solid rgba(140,255,180,0.35);color:#c9ffc9;font:inherit;padding:1px 4px;border-radius:4px" /> m/s</div>
      <div style="display:flex;gap:4px;margin:4px 0;flex-wrap:wrap">
        <button data-f="prograde">顺行+</button><button data-f="retrograde">逆行−</button>
        <button data-f="normal">法向+</button><button data-f="radialOut">径向+</button>
      </div>
      <b style="color:#c9ffc9">地球→火星 porkchop</b> (Δv 热图)
      <div><canvas id="f-pork" width="300" height="180" style="border:1px solid rgba(140,255,180,0.3);border-radius:4px;cursor:crosshair;margin-top:4px"></canvas></div>
      <div id="f-porkinfo" style="min-height:16px"></div>
    `;
    container.appendChild(flightPanel);
    flightPanel.querySelectorAll("button").forEach((b) => {
      b.style.cssText = "background:rgba(120,255,180,0.12);color:#c9ffc9;border:1px solid rgba(140,255,180,0.35);border-radius:4px;cursor:pointer;font:inherit;padding:2px 6px";
      b.addEventListener("click", () => {
        const act = (b as HTMLElement).dataset.f as Attitude | undefined;
        if (!act || !ship) return;
        const dvInput = flightPanel.querySelector("#f-dvin") as HTMLInputElement;
        const dv = parseFloat(dvInput.value) || 10;
        ship.burn(dv, attitudeDir(ship.state, act));
        refreshOrbitLine();
        updateFlightPanel();
      });
    });

    drawPorkchop();
    refreshOrbitLine();
    updateFlightPanel();
  }

  function updateFlightPanel(): void {
    if (!ship) return;
    const orb = flightPanel.querySelector("#f-orbit");
    const dv = flightPanel.querySelector("#f-dv");
    if (orb && dv) {
      const els = elementsFromState(ship.state.rel, GM_EARTH_KM);
      const alt = norm(ship.state.rel.r) - 6371;
      orb.textContent = `高度 ${alt.toFixed(0)} km  a=${els.a.toFixed(0)} km  e=${els.e.toFixed(4)}`;
      dv.textContent = `Δv 预算: ${ship.dvBudgetMS().toFixed(0)} m/s  燃料 ${ship.fuelT.toFixed(1)} t`;
    }
  }

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1e13);

  const lastCam = { x: 0, y: 0, z: 0 };

  function targetPos(jd: number): { x: number; y: number; z: number } {
    return bodyPosHelioM(targetName, jd);
  }

  function updateBodies(): void {
    const jd = warp.jd;
    const dDays = toTT(jd) - 2451545.0;
    const tp = targetPos(jd);
    const r = Math.pow(10, logDist);
    const sp = Math.sin(pol), cp = Math.cos(pol);
    const off = { x: r * sp * Math.cos(az), y: r * cp, z: r * sp * Math.sin(az) };
    const cam = { x: tp.x + off.x, y: tp.y + off.y, z: tp.z + off.z };
    lastCam.x = cam.x; lastCam.y = cam.y; lastCam.z = cam.z;

    for (const br of bodyRenders) {
      const p = bodyPosHelioM(br.def.name, jd);
      br.mesh.position.set(p.x - cam.x, p.y - cam.y, p.z - cam.z);
      // 自转四元数：轴对齐 + W 自转
      const rot = bodyRotation(br.def.name);
      const pole = poleEcl(rot.alpha0, rot.delta0);
      const qAxis = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(pole.x, pole.y, pole.z),
      );
      const W = ((rot.w0 + rot.wDot * dDays) * DEG) % (Math.PI * 2);
      const qSpin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(pole.x, pole.y, pole.z), W);
      br.mesh.quaternion.copy(qSpin.multiply(qAxis));
    }

    // 平行光：从太阳（原点）照向场景 → 方向 = cam→origin 的反方向归一
    const sl = Math.hypot(cam.x, cam.y, cam.z);
    sunLight.position.set((-cam.x / sl) * 1e9, (-cam.y / sl) * 1e9, (-cam.z / sl) * 1e9);
    sunLight.target.position.set(0, 0, 0);
    sunLight.target.updateMatrixWorld();

    // 视图基向量
    let fx = -off.x, fy = -off.y, fz = -off.z;
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    let rx = fz, ry = 0, rz = -fx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    camera.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(rx, ry, rz),
        new THREE.Vector3(ux, uy, uz),
        new THREE.Vector3(-fx, -fy, -fz),
      ),
    );
    camera.updateMatrixWorld();

    // 卫星轨道环
    for (const ol of orbitLines) {
      const parentPos = bodyPosHelioM(ol.parent, jd);
      const dParent = Math.hypot(parentPos.x - cam.x, parentPos.y - cam.y, parentPos.z - cam.z);
      ol.line.visible = dParent < 6e10;
      if (!ol.line.visible) continue;
      const arr = ol.line.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = arr.array as Float32Array;
      for (let i = 0; i < arr.count; i++) {
        array[i * 3] = array[i * 3] + (parentPos.x - cam.x);
        array[i * 3 + 1] = array[i * 3 + 1] + (parentPos.y - cam.y);
        array[i * 3 + 2] = array[i * 3 + 2] + (parentPos.z - cam.z);
      }
      arr.needsUpdate = true;
    }

    // 飞船标记与轨道线（M3 飞行模式）
    if (flight && ship && shipMarker && shipOrbit) {
      const sh = shipHelio(ship.state);
      shipMarker.position.set(sh.r.x / 1000 - cam.x, sh.r.y / 1000 - cam.y, sh.r.z / 1000 - cam.z);
      const ePos = bodyPosHelioM("earth", jd);
      shipOrbit.position.set(ePos.x - cam.x, ePos.y - cam.y, ePos.z - cam.z);
      shipOrbit.visible = Math.hypot(ePos.x - cam.x, ePos.y - cam.y, ePos.z - cam.z) < 6e10;
    }
  }

  // ---- 标签投影 ----
  const projV = new THREE.Vector4();
  const projMat = new THREE.Matrix4();
  function updateLabels(): void {
    projMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const project = (p: { x: number; y: number; z: number }, el: HTMLElement, hot: boolean): void => {
      projV.set(p.x - lastCam.x, p.y - lastCam.y, p.z - lastCam.z, 1).applyMatrix4(projMat);
      const behind = projV.w < 0;
      const sx = (projV.x / projV.w) * 0.5 + 0.5;
      const sy = 1 - ((projV.y / projV.w) * 0.5 + 0.5);
      const vis = !behind && sx > -0.03 && sx < 1.03 && sy > -0.03 && sy < 1.03;
      el.style.display = vis ? "block" : "none";
      if (vis) {
        el.style.left = `${sx * window.innerWidth}px`;
        el.style.top = `${sy * window.innerHeight}px`;
        el.style.color = hot ? "rgba(255,230,150,1)" : "rgba(190,225,255,0.85)";
      }
    };
    for (const br of bodyRenders) {
      project(bodyPosHelioM(br.def.name, warp.jd), br.label, br.def.name === targetName);
    }
    if (flight && ship) {
      const sh = shipHelio(ship.state);
      project({ x: sh.r.x * 1000, y: sh.r.y * 1000, z: sh.r.z * 1000 }, shipLabel, true);
    }
  }

  // ---- HUD ----
  const infoDiv = document.createElement("div");
  infoDiv.style.cssText = "position:fixed;right:12px;top:12px;z-index:10;font:12px/1.6 ui-monospace,monospace;color:#9fd8ff;background:rgba(0,10,30,0.55);padding:10px 12px;border-radius:8px;user-select:none";
  infoDiv.innerHTML = `
    <b style="color:#cde8ff">目标</b> <span id="m2-tgt"></span>
    <div id="m2-dist"></div>
    <div id="m2-lt"></div>
    <div style="display:flex;gap:6px;margin:6px 0">
      <button data-act="prev">‹</button><button data-act="next">›</button>
    </div>
    <b style="color:#cde8ff">时间</b>
    <div id="m2-date"></div>
    <div>速率: <span id="m2-rate"></span></div>
    <div style="display:flex;gap:6px;margin-top:2px">
      <button data-act="slower">≪</button><button data-act="pause">⏸/▶</button>
      <button data-act="faster">≫</button><button data-act="rev">⇄</button>
    </div>
  `;
  container.appendChild(infoDiv);
  infoDiv.querySelectorAll("button").forEach((b) => {
    b.style.cssText = "background:rgba(120,180,255,0.15);color:#cde8ff;border:1px solid rgba(140,200,255,0.35);border-radius:4px;cursor:pointer;font:inherit;padding:2px 8px";
    b.addEventListener("click", () => {
      const act = (b as HTMLElement).dataset.act;
      if (act === "faster") warp.faster();
      else if (act === "slower") warp.slower();
      else if (act === "pause") warp.paused = !warp.paused;
      else if (act === "rev") warp.reverse = !warp.reverse;
      else if (act === "next") cycleTarget(1);
      else if (act === "prev") cycleTarget(-1);
    });
  });
  const tgtSpan = infoDiv.querySelector("#m2-tgt") as HTMLElement;
  const distDiv = infoDiv.querySelector("#m2-dist") as HTMLElement;
  const ltDiv = infoDiv.querySelector("#m2-lt") as HTMLElement;
  const dateDiv = infoDiv.querySelector("#m2-date") as HTMLElement;
  const rateSpan = infoDiv.querySelector("#m2-rate") as HTMLElement;

  function cycleTarget(dir: number): void {
    const idx = BODIES.findIndex((b) => b.name === targetName);
    setTarget(BODIES[(idx + dir + BODIES.length) % BODIES.length].name);
  }
  function setTarget(name: string): void {
    targetName = name;
    const b = BODIES.find((x) => x.name === name)!;
    logDist = clampLogDist(Math.log10(b.radiusM * 4.5), 3, 12.7);
    // 相机转到昼侧（目标=太阳或零矢量时用固定方向）
    const p = bodyPosHelioM(name, warp.jd);
    const sl = Math.hypot(p.x, p.y, p.z);
    if (sl < 1e6) {
      az = 0.8;
      pol = 1.25;
      return;
    }
    az = Math.atan2(-p.z / sl, -p.x / sl) + 0.45;
    pol = 1.3;
  }
  setTarget("earth");

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
    logDist = clampLogDist(logDist + e.deltaY * 0.0015, 3, 12.7);
  }, { passive: false });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

    if (flight) initFlight();

    // ---- 帧循环 ----
  let fpsEma = 60;
  let lastT = performance.now();
  const testMode = new URLSearchParams(window.location.search).has("test");

  function frame(t: number): void {
    if (!testMode) requestAnimationFrame(frame);
    try {
      const dt = Math.min(0.25, (t - lastT) / 1000);
      lastT = t;
      fpsEma = fpsEma * 0.92 + (1 / dt) * 0.08;
      const simDt = warp.advance(dt);
      // 飞船随时间加速推进（SOI 切换按小时步长解析检测）
      if (flight && ship && simDt !== 0) {
        const simDtSec = simDt * 86400;
        ship.state = propagateShip(ship.state, simDtSec, Math.min(64, Math.max(1, Math.ceil(Math.abs(simDtSec) / 1800))));
        updateFlightPanel();
      }

      updateBodies();
      renderer.render(scene, camera);
      updateLabels();

      const camDist = Math.pow(10, logDist);
      const b = BODIES.find((x) => x.name === targetName)!;
      const alt = camDist - b.radiusM;
      const dKm = distanceKm(targetName as BodyName, warp.jd);
      const lt = lightTimeMin(targetName as BodyName, warp.jd);
      tgtSpan.textContent = b.label;
      distDiv.textContent = `相机距离: ${(camDist / 1e6).toFixed(0)} Mm  高度 ${(Math.max(0, alt) / 1e3).toFixed(0)} km`;
      ltDiv.textContent = `日心距: ${(dKm / 1e6).toFixed(1)} 百万km  光行时 ${lt < 60 ? lt.toFixed(1) + "分" : (lt / 60).toFixed(2) + "小时"}`;
      dateDiv.textContent = formatUTC(warp.jd);
      rateSpan.textContent = `${WARP_RATES[warp.rateIndex]}×${warp.reverse ? " 逆向" : ""}${warp.paused ? " 已暂停" : ""}`;
    } catch {
      /* 帧循环容错 */
    }
  }
  requestAnimationFrame(frame);
  if (testMode) window.setInterval(() => frame(performance.now()), 33);

  const hooks: M2Hooks = {
    fps: () => Math.round(fpsEma),
    target: () => targetName,
    setTarget,
    setDist(m: number) {
      logDist = clampLogDist(Math.log10(Math.max(1000, m)), 3, 12.7);
    },
    setJD(jd: number) {
      warp.jd = jd;
    },
    bodyScreen(name: string) {
      const br = bodyRenders.find((x) => x.def.name === name)!;
      return { visible: br.label.style.display !== "none", x: parseFloat(br.label.style.left), y: parseFloat(br.label.style.top) };
    },
    targets: () => BODIES.map((b) => b.name),
    debug: () => ({
      info: { calls: renderer.info.render.calls, tris: renderer.info.render.triangles },
      bodies: BODIES.length,
    }),
  };
  (window as unknown as Record<string, unknown>).__odysseyM2 = hooks;
  return hooks;
}
