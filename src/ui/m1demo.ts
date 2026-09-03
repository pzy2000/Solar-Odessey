/**
 * M1 演示：时间控制面板 + 全行星真实位置。
 * 黄道俯视图（2D canvas）+ HUD 数据表 + 时间加速控制。
 * 通过 ?m1=1 启用；?test=1 使用定时器驱动（自动化验收环境 rAF 冻结）。
 */
import { formatUTC, TimeWarp, WARP_RATES } from "../core/time.js";
import { astrometricGeo, lightTimeMin, ALL_BODIES, type BodyName } from "../ephemeris/ephemeris.js";
import { helioJ2000 } from "../ephemeris/ephemeris.js";

const BODY_LABEL: Record<BodyName, string> = {
  sun: "太阳", mercury: "水星", venus: "金星", earth: "地球", mars: "火星",
  jupiter: "木星", saturn: "土星", uranus: "天王星", neptune: "海王星",
  moon: "月球", pluto: "冥王星",
};
const BODY_COLOR: Record<BodyName, string> = {
  sun: "#ffd27d", mercury: "#b9a48f", venus: "#e8c98f", earth: "#6fa8ff", mars: "#ff8a5c",
  jupiter: "#e0b08a", saturn: "#e8d8a8", uranus: "#9fdce8", neptune: "#6f8fe8",
  moon: "#c8c8c8", pluto: "#d8c8b8",
};
const MAP_ORDER: BodyName[] = ["sun", "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
const AU_VIEW = 40; // 地图半径（AU）

export interface M1Hooks {
  setJD(jd: number): void;
  getJD(): number;
  faster(): void;
  slower(): void;
  togglePause(): void;
  toggleReverse(): void;
  tableRows(): string[];
}

export function startM1Demo(container: HTMLElement, hud: HTMLElement): M1Hooks {
  const consoleErrors: string[] = [];
  const warp = new TimeWarp(Date.now() / 86400000 + 2440587.5); // 当前时刻
  warp.paused = false;

  // 2D 地图 canvas（黄道俯视，X→右，−Y→上 使其逆时针公转方向正确）
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  container.appendChild(canvas);

  function draw(): void {
    const w = (canvas.width = window.innerWidth * devicePixelRatio);
    const h = (canvas.height = window.innerHeight * devicePixelRatio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const scale = (Math.min(w, h) / 2 - 30) / AU_VIEW;

    // 轨道参考圈
    ctx.strokeStyle = "rgba(120,160,255,0.18)";
    for (const au of [1, 5, 10, 20, 30, 40]) {
      ctx.beginPath();
      ctx.arc(cx, cy, au * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const body of MAP_ORDER) {
      const p = helioJ2000(body, warp.jd);
      const px = cx + p.x * scale;
      const py = cy - p.y * scale;
      ctx.fillStyle = BODY_COLOR[body];
      const size = body === "sun" ? 9 : body === "jupiter" || body === "saturn" ? 5 : 3.5;
      ctx.beginPath();
      ctx.arc(px, py, size * devicePixelRatio, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `${12 * devicePixelRatio}px ui-monospace, monospace`;
      ctx.fillText(BODY_LABEL[body], px + 8 * devicePixelRatio, py - 6 * devicePixelRatio);
    }
  }

  // 时间面板
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;right:12px;top:12px;z-index:10;display:flex;flex-direction:column;gap:6px;" +
    "font:12px/1.5 ui-monospace,monospace;color:#9fd8ff;background:rgba(0,10,30,0.55);" +
    "padding:10px 12px;border-radius:8px;user-select:none;";
  panel.innerHTML = `
    <b style="color:#cde8ff">时间控制</b>
    <div id="m1-date" style="min-width:210px"></div>
    <div>速率: <span id="m1-rate"></span> <span id="m1-rev" style="color:#ff9f9f"></span></div>
    <div style="display:flex;gap:6px;margin-top:2px">
      <button data-act="slower">≪</button>
      <button data-act="pause">⏸/▶</button>
      <button data-act="faster">≫</button>
      <button data-act="rev">⇄</button>
    </div>
    <div style="opacity:0.75;margin-top:4px">日期框可输入 YYYY-MM-DD</div>
    <input id="m1-input" placeholder="2026-09-04" spellcheck="false"
      style="background:rgba(255,255,255,0.08);border:1px solid rgba(140,200,255,0.35);color:#cde8ff;
      font:inherit;padding:3px 6px;border-radius:4px;width:130px" />
  `;
  container.appendChild(panel);
  panel.querySelectorAll("button").forEach((b) => {
    b.style.cssText =
      "background:rgba(120,180,255,0.15);color:#cde8ff;border:1px solid rgba(140,200,255,0.35);" +
      "border-radius:4px;cursor:pointer;font:inherit;padding:2px 8px";
    b.addEventListener("click", () => {
      const act = (b as HTMLElement).dataset.act;
      if (act === "faster") warp.faster();
      else if (act === "slower") warp.slower();
      else if (act === "pause") warp.paused = !warp.paused;
      else if (act === "rev") warp.reverse = !warp.reverse;
      syncPanel();
    });
  });
  const dateDiv = panel.querySelector("#m1-date") as HTMLElement;
  const rateSpan = panel.querySelector("#m1-rate") as HTMLElement;
  const revSpan = panel.querySelector("#m1-rev") as HTMLElement;
  const input = panel.querySelector("#m1-input") as HTMLInputElement;
  input.addEventListener("change", () => {
    const ms = Date.parse(input.value.trim() + "T12:00:00Z");
    if (!Number.isNaN(ms)) warp.jd = ms / 86400000 + 2440587.5;
  });

  function syncPanel(): void {
    rateSpan.textContent = `${WARP_RATES[warp.rateIndex]}×`;
    revSpan.textContent = warp.reverse ? "逆向" : "";
  }
  syncPanel();

  function renderHud(): void {
    syncPanel();
    const lines: string[] = [
      `M1 · 星历引擎（此刻的真实天空）`,
      `${formatUTC(warp.jd)}`,
      `天体        距离(百万km)   光行时    RA(°)    Dec(°)`,
    ];
    for (const body of ALL_BODIES) {
      const a = astrometricGeo(body, warp.jd);
      const dist = (a.distKm / 1e6).toFixed(1).padStart(9);
      const lt = lightTimeMin(body, warp.jd);
      const ltS = lt < 60 ? `${lt.toFixed(1)}m` : `${(lt / 60).toFixed(2)}h`;
      lines.push(
        `${BODY_LABEL[body]}       ${dist}  ${ltS.padStart(7)}  ${a.raDeg.toFixed(2).padStart(7)}  ${a.decDeg.toFixed(2).padStart(7)}`,
      );
    }
    hud.textContent = lines.join("\n");
    dateDiv.textContent = formatUTC(warp.jd);
  }

  const testMode = new URLSearchParams(window.location.search).has("test");
  let lastT = performance.now();
  let acc = 0;
  function tick(t: number): void {
    if (!testMode) requestAnimationFrame(tick);
    try {
      const dt = Math.min(0.25, (t - lastT) / 1000);
      lastT = t;
      warp.advance(dt);
      acc += dt;
      if (acc > 0.25) {
        acc = 0;
        draw();
        renderHud();
      }
    } catch (e) {
      if (consoleErrors.length < 10) consoleErrors.push(String(e));
    }
  }
  requestAnimationFrame(tick);
  if (testMode) window.setInterval(() => tick(performance.now()), 33);
  window.addEventListener("resize", () => draw());

  return {
    setJD(jd: number) {
      warp.jd = jd;
    },
    getJD: () => warp.jd,
    faster: () => warp.faster(),
    slower: () => warp.slower(),
    togglePause: () => {
      warp.paused = !warp.paused;
    },
    toggleReverse: () => {
      warp.reverse = !warp.reverse;
    },
    tableRows: () => (hud.textContent ?? "").split("\n"),
  };
}
