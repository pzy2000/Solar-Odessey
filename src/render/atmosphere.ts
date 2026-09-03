/**
 * M5 · 物理大气散射：Rayleigh + Mie 单次散射（16 采样 raymarch，片元实时计算）。
 * 同一套参数化覆盖四类大气：
 *   地球（蓝色 Rayleigh / 红色日落）、火星（稀薄+尘埃 Mie / 蓝色日落）、
 *   金星（浓密硫酸云）、土卫六（橙色雾霾）。
 * 空间视角：行星边缘 Rayleigh 光环 + 晨昏线渐变；地表视角（M6）复用同一材质的背面路径。
 */
import * as THREE from "three";

export interface AtmosphereParams {
  /** Rayleigh 散射系数（m⁻¹，RGB 波长 680/550/440nm） */
  betaR: [number, number, number];
  /** Rayleigh 标高（m） */
  hR: number;
  /** Mie 散射系数（m⁻¹） */
  betaM: number;
  /** Mie 标高（m） */
  hM: number;
  /** Mie 各向异性系数 [-0.999, 0.999] */
  g: number;
  /** 大气层顶高度（m） */
  atmHeightM: number;
  /** 太阳强度 */
  intensity: number;
}

/** 四类大气参数（物理量级：地球值来自标准大气，其余按实测缩放调校） */
export const ATMOSPHERES: Record<string, AtmosphereParams> = {
  earth: {
    betaR: [5.8e-6, 1.35e-5, 3.31e-5],
    hR: 8000,
    betaM: 21e-6,
    hM: 1200,
    g: 0.76,
    atmHeightM: 80000,
    intensity: 22,
  },
  mars: {
    // 稀薄 CO₂（Rayleigh 极弱）+ 尘埃 Mie 主导 → 蓝色日落
    betaR: [0.6e-6, 1.1e-6, 2.0e-6],
    hR: 11000,
    betaM: 8e-6,
    hM: 14000,
    g: 0.85,
    atmHeightM: 90000,
    intensity: 16,
  },
  venus: {
    // 浓密 CO₂ + 硫酸云：强 Mie，高反射
    betaR: [1e-5, 2e-5, 4e-5],
    hR: 60000,
    betaM: 4e-4,
    hM: 8000,
    g: 0.9,
    atmHeightM: 250000,
    intensity: 30,
  },
  titan: {
    // 橙色雾霾：Mie 主导 + 波长无关吸收（视觉用暖色 Mie 近似）
    betaR: [2e-6, 3e-6, 5e-6],
    hR: 40000,
    betaM: 8e-4,
    hM: 60000,
    g: 0.85,
    atmHeightM: 300000,
    intensity: 10,
  },
};

const VERT = /* glsl */ `
  varying vec3 vWorld;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uCenter;      // 行星中心（相机相对，m）
  uniform float uRadius;     // 行星半径（m）
  uniform vec3 uSunDir;      // 太阳方向（单位矢量，相机系）
  uniform vec3 uBetaR;
  uniform vec3 uBetaM;
  uniform float uHR;
  uniform float uHM;
  uniform float uG;
  uniform float uIntensity;
  varying vec3 vWorld;
  #include <common>
  #include <logdepthbuf_pars_fragment>

  // 射线-球体交点：返回 (tNear, tFar)，无交则 tFar < tNear
  vec2 raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
    vec3 oc = ro - c;
    float b = dot(oc, rd);
    float cc = dot(oc, oc) - r * r;
    float disc = b * b - cc;
    if (disc < 0.0) return vec2(1.0, -1.0);
    float sq = sqrt(disc);
    return vec2(-b - sq, -b + sq);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 ro = vec3(0.0); // 相机在原点（相机相对渲染）
    vec3 rd = normalize(vWorld);
    // 与大气外壳求交（本球半径 = uRadius + 顶高）
    float atmR = uRadius + uHR * 8.0 + uHM * 8.0;
    vec2 tatm = raySphere(ro, rd, uCenter, atmR);
    if (tatm.y < tatm.x) discard;
    float t0 = max(tatm.x, 0.0);
    float t1 = tatm.y;
    // 与行星本体求交：命中则截断（表面以上积分）
    vec2 tground = raySphere(ro, rd, uCenter, uRadius);
    if (tground.y > tground.x && tground.x > 0.0) t1 = min(t1, tground.x);

    const int N = 16;
    float seg = (t1 - t0) / float(N);
    // 相位函数
    float mu;
    vec3 totalR = vec3(0.0);
    vec3 totalM = vec3(0.0);
    for (int i = 0; i < N; i++) {
      float t = t0 + seg * (float(i) + 0.5);
      vec3 pos = rd * t;
      float h = length(pos - uCenter) - uRadius;
      float densR = exp(-h / uHR);
      float densM = exp(-h / uHM);
      // 该点到太阳的光学深度（8 采样近似）
      vec2 tsun = raySphere(pos, uSunDir, uCenter, atmR);
      vec2 tg2 = raySphere(pos, uSunDir, uCenter, uRadius);
      if (tg2.y > tg2.x && tg2.x > 0.0) continue; // 处于行星阴影
      float ts0 = max(tsun.x, 0.0);
      float ts1 = tsun.y;
      float sunSeg = (ts1 - ts0) / 8.0;
      vec3 odR = vec3(0.0);
      float odM = 0.0;
      for (int j = 0; j < 8; j++) {
        float ts = ts0 + sunSeg * (float(j) + 0.5);
        float hs = length(rd * ts + pos - uCenter) - uRadius;
        odR += exp(-hs / uHR) * sunSeg;
        odM += exp(-hs / uHM) * sunSeg;
      }
      totalR += densR * seg * odR;
      totalM += densM * seg * odM;
    }
    // 透射
    vec3 tau = uBetaR * totalR * 1.0 + uBetaM * totalM * 1.1;
    vec3 att = exp(-tau);
    // 相位
    mu = dot(rd, uSunDir);
    float g2 = uG * uG;
    float phaseR = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu);
    float phaseM = 3.0 / (8.0 * 3.14159) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * uG * mu, 1.5));
    vec3 c = vec3(1.0) - exp(-(uBetaR * totalR * phaseR + uBetaM * totalM * phaseM) * uIntensity);
    // 衰减（行星阴影内 col≈0 → c≈0）
    c *= att;
    gl_FragColor = vec4(c, clamp(max(c.r, max(c.g, c.b)) * 1.2, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

export interface AtmosphereHandle {
  mesh: THREE.Mesh;
  /** 每帧更新（相机相对位置由父网格承担，这里只更新太阳方向） */
  update(sunDirCam: Vec3Like): void;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** 生成挂在行星网格上的大气壳层（相对行星中心，米）。 */
export function attachAtmosphere(parent: THREE.Object3D, planetRadiusM: number, params: AtmosphereParams): AtmosphereHandle {
  const shellR = planetRadiusM + params.atmHeightM;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(shellR, 96, 48),
    new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uRadius: { value: planetRadiusM },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uBetaR: { value: new THREE.Vector3(...params.betaR) },
        uBetaM: { value: params.betaM },
        uHR: { value: params.hR },
        uHM: { value: params.hM },
        uG: { value: params.g },
        uIntensity: { value: params.intensity },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      side: THREE.FrontSide, // 从太空看：渲染近侧壳层，覆盖行星盘面与边缘
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  parent.add(mesh);
  return {
    mesh,
    update(sunDirCam) {
      const mat = mesh.material as THREE.ShaderMaterial;
      // 相机相对：行星中心 = 父网格位置（父网格 position = 行星−相机）
      (mat.uniforms.uCenter.value as THREE.Vector3).copy(parent.position);
      (mat.uniforms.uSunDir.value as THREE.Vector3).set(sunDirCam.x, sunDirCam.y, sunDirCam.z).normalize();
    },
  };
}
