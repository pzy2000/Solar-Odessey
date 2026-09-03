/**
 * M4 · 光效包：太阳米粒表面、日冕、遮挡感知镜头光斑、土星环（双向阴影）、
 * 小行星带与柯伊伯带。全部通过内置材质 + onBeforeCompile 注入实现（规避 ShaderMaterial
 * 与内置管线的兼容问题，见 ADR-001）。
 */
import * as THREE from "three";
import { BODIES, bodyPosHelioM } from "../ephemeris/bodies.js";

/** 程序化太阳米粒组织纹理（Canvas 柔和斑点）。 */
export function makeGranulationTexture(): THREE.Texture {
  const W = 512, H = 256;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, "#ffe9a8");
  base.addColorStop(0.5, "#ffc24d");
  base.addColorStop(1, "#ffe9a8");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = 4 + Math.random() * 7;
    const light = Math.random() > 0.45;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, light ? "rgba(255,246,200,0.20)" : "rgba(230,130,20,0.16)");
    g.addColorStop(1, "rgba(255,200,80,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // CanvasTexture 在部分环境上传异常，走 dataURL 图片加载路径
  const tex = new THREE.TextureLoader().load(c.toDataURL("image/jpeg", 0.92), (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** 程序化光晕纹理（小画布软渐变，JPEG dataURL 加载）。 */
function makeGlowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,244,214,0.95)");
  g.addColorStop(0.2, "rgba(255,215,140,0.5)");
  g.addColorStop(0.55, "rgba(255,170,70,0.12)");
  g.addColorStop(1, "rgba(255,150,50,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.TextureLoader().load(c.toDataURL("image/jpeg", 0.92), (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeCoronaSprites(): THREE.Object3D[] {
  const mk = (scale: number): THREE.Mesh => {
    const tex = makeGlowTexture();
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    quad.scale.setScalar(scale);
    quad.userData.billboard = true;
    return quad;
  };
  const SUN_R = 6.96e8;
  return [
    mk(SUN_R * 6),
    mk(SUN_R * 16),
  ];
}

export interface FlareHandle {
  /** 遮挡系数 0(全遮)~1(通透) */
  occlusion(): number;
  /** 当前日心遮挡天体名（无=null） */
  blocker(): string | null;
  update(cam: { x: number; y: number; z: number }, camera: THREE.Camera, jdUTC: number): void;
  dispose(): void;
}

/** 遮挡感知镜头光斑：太阳到屏心轴线上的 5 个渐变光斑，行星遮挡时整体衰减。 */
export function makeFlare(container: HTMLElement): FlareHandle {
  const els: HTMLDivElement[] = [];
  const specs = [
    { pos: 1.35, size: 0.10, color: "rgba(255,190,120,0.30)" },
    { pos: 1.05, size: 0.05, color: "rgba(180,220,255,0.25)" },
    { pos: 0.7, size: 0.13, color: "rgba(255,230,180,0.22)" },
    { pos: -0.4, size: 0.09, color: "rgba(160,255,220,0.18)" },
    { pos: -0.8, size: 0.18, color: "rgba(255,180,140,0.16)" },
  ];
  for (const s of specs) {
    const d = document.createElement("div");
    const px = Math.round(s.size * 1000);
    d.style.cssText = `position:fixed;z-index:4;pointer-events:none;width:${px}px;height:${px}px;` +
      `transform:translate(-50%,-50%);border-radius:50%;opacity:0;background:` +
      `radial-gradient(circle, ${s.color} 0%, rgba(0,0,0,0) 70%);mix-blend-mode:screen;`;
    container.appendChild(d);
    els.push(d);
  }

  let occ = 1;
  let blocker: string | null = null;
  let sunScreen: { x: number; y: number; vis: boolean } = { x: 0, y: 0, vis: false };

  const handle: FlareHandle = {
    occlusion: () => occ,
    blocker: () => blocker,
    update(cam, camera, jdUTC) {
      // 太阳在原点：屏幕投影
      const projV = new THREE.Vector4(-cam.x, -cam.y, -cam.z, 1).applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
      const sunDist = Math.hypot(cam.x, cam.y, cam.z);
      const vis = projV.w > 0;
      const sx = ((projV.x / projV.w) * 0.5 + 0.5) * window.innerWidth;
      const sy = (1 - ((projV.y / projV.w) * 0.5 + 0.5)) * window.innerHeight;
      sunScreen = { x: sx, y: sy, vis };
      // 遮挡：任一行星圆盘遮住太阳方向视线（射线-球体解析求交）
      occ = 1;
      blocker = null;
      if (vis) {
        const toSun = { x: -cam.x / sunDist, y: -cam.y / sunDist, z: -cam.z / sunDist };
        for (const b of BODIES) {
          if (b.name === "sun") continue;
          const p = bodyPosHelioM(b.name, jdUTC);
          const rel = { x: p.x - cam.x, y: p.y - cam.y, z: p.z - cam.z };
          const t = rel.x * toSun.x + rel.y * toSun.y + rel.z * toSun.z;
          if (t <= 0 || t > sunDist) continue; // 在太阳后方或比太阳远
          const perp = Math.hypot(
            rel.x - t * toSun.x,
            rel.y - t * toSun.y,
            rel.z - t * toSun.z,
          );
          if (perp < b.radiusM * 1.05) {
            const cover = Math.min(1, (b.radiusM * 1.05 - perp) / (b.radiusM * 0.6));
            if (cover < occ || occ === 1) {
              occ = 1 - cover * 0.92;
              blocker = b.name;
            }
          }
        }
      }
      // 布局：光斑沿太阳→屏心轴线的镜像位置
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      for (let i = 0; i < els.length; i++) {
        const s = specs[i];
        const fx = sx + (cx - sx) * 2 * (s.pos - 1);
        const fy = sy + (cy - sy) * 2 * (s.pos - 1);
        els[i].style.left = `${fx}px`;
        els[i].style.top = `${fy}px`;
        els[i].style.opacity = String(vis ? s.color.match(/0\.\d+/) ? parseFloat(s.color.match(/0\.\d+/)![0]) * occ : occ * 0.2 : 0);
      }
    },
    dispose() {
      for (const d of els) d.remove();
    },
  };
  void sunScreen;
  return handle;
}

/** 土星环：双面透明 Basic + 注入"行星本影"暗化（环上的行星阴影）。 */
export function makeSaturnRing(innerM: number, outerM: number, texturePath: string, planetRadiusM: number): THREE.Mesh {
  const geo = new THREE.RingGeometry(innerM, outerM, 180, 1);
  // 径向 UV：u = (r−inner)/(outer−inner)
  const pos = geo.getAttribute("position");
  const uv = geo.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (r - innerM) / (outerM - innerM), 0.5);
  }
  const mat = new THREE.MeshBasicMaterial({
    map: new THREE.TextureLoader().load(texturePath, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
    }),
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  // 注入行星本影：片元位于行星背光圆柱内时变暗
  const uShadow = {
    uPlanetRel: { value: new THREE.Vector3() },
    uSunRel: { value: new THREE.Vector3() },
    uPlanetR: { value: planetRadiusM },
  };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPlanetRel = uShadow.uPlanetRel;
    shader.uniforms.uSunRel = uShadow.uSunRel;
    shader.uniforms.uPlanetR = uShadow.uPlanetR;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWP = (modelMatrix * vec4(position, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWP;\nuniform vec3 uPlanetRel;\nuniform vec3 uSunRel;\nuniform float uPlanetR;")
      .replace(
        "#include <dithering_fragment>",
        `vec3 dSun = normalize(uSunRel - vWP);
         vec3 bb = uPlanetRel - vWP;
         float tP = dot(bb, dSun);
         float perp = length(bb - tP * dSun);
         float shK = (tP > 0.0) ? mix(0.12, 1.0, smoothstep(uPlanetR * 0.97, uPlanetR * 1.06, perp)) : 1.0;
         gl_FragColor.rgb *= shK;
         #include <dithering_fragment>`,
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotateX(-Math.PI / 2); // 环面法向 = 母星 Y 轴（极轴）
  mesh.frustumCulled = false;
  (mesh as unknown as { __uShadow: typeof uShadow }).__uShadow = uShadow;
  return mesh;
}

/** 给行星材质注入"环的影子"（沿太阳方向投影到环平面内的带状遮挡）。 */
export function injectRingShadowOnPlanet(mat: THREE.Material, ringInnerM: number, ringOuterM: number): {
  uSunRel: { value: THREE.Vector3 };
  uPlanetRel: { value: THREE.Vector3 };
  uRingNormal: { value: THREE.Vector3 };
} {
  const u = {
    uSunRel: { value: new THREE.Vector3() },
    uPlanetRel: { value: new THREE.Vector3() },
    uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
    uRingInner: { value: ringInnerM },
    uRingOuter: { value: ringOuterM },
  };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunRel = u.uSunRel;
    shader.uniforms.uPlanetRel = u.uPlanetRel;
    shader.uniforms.uRingNormal = u.uRingNormal;
    shader.uniforms.uRingInner = u.uRingInner;
    shader.uniforms.uRingOuter = u.uRingOuter;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWP = (modelMatrix * vec4(position, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWP;\nuniform vec3 uSunRel;\nuniform vec3 uPlanetRel;\nuniform vec3 uRingNormal;\nuniform float uRingInner;\nuniform float uRingOuter;")
      .replace(
        "#include <dithering_fragment>",
        `vec3 dSun2 = normalize(uSunRel - vWP);
         float denom = dot(uRingNormal, dSun2);
         if (abs(denom) > 1e-6) {
           float sHit = dot(uRingNormal, uPlanetRel - vWP) / denom;
           if (sHit > 0.0) {
             vec3 hit = vWP + dSun2 * sHit;
             float rr = length(hit - uPlanetRel);
             if (rr > uRingInner * 0.98 && rr < uRingOuter) {
               gl_FragColor.rgb *= 0.55;
             }
           }
         }
         #include <dithering_fragment>`,
      );
  };
  return u;
}

/** 小行星带（主带 2.1–3.3 AU）与柯伊伯带远景（Points）。 */
export function makeBelts(): { belt: THREE.Points; kuiper: THREE.Points } {
  const AU_M = 1.495978707e11;
  const mkRing = (n: number, rIn: number, rOut: number, zSpread: number, color: number, size: number): THREE.Points => {
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = (rIn + Math.random() * (rOut - rIn)) * AU_M;
      const th = Math.random() * Math.PI * 2;
      const z = (Math.random() - 0.5) * zSpread * AU_M;
      pos[i * 3] = r * Math.cos(th);
      pos[i * 3 + 1] = z;
      pos[i * 3 + 2] = r * Math.sin(th);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false }));
  };
  return {
    belt: mkRing(3200, 2.06, 3.28, 0.14, 0x9a8f80, 1.4),
    kuiper: mkRing(2200, 30, 49, 3.5, 0x7f8fa6, 1.2),
  };
}
