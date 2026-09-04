/**
 * M9 · 打磨：键位帮助覆盖层、照片模式（隐藏 UI + 截图下载）、localStorage 存档、
 * WebAudio 合成环境音（舱内嗡嗡 + 曲速音，默认关闭）。
 */

export function makeHelpOverlay(items: Array<[string, string]>): void {
  const d = document.createElement("div");
  d.id = "help-overlay";
  const rows = items.map(([k, v]) => `<tr><td style="padding:0 14px 0 0;color:#9fd8ff">${k}</td><td>${v}</td></tr>`).join("");
  d.innerHTML = `<table>${rows}</table><div style="margin-top:6px;opacity:0.7">按 H 收起/展开</div>`;
  d.style.cssText =
    "position:fixed;right:12px;bottom:12px;z-index:20;font:12px/1.7 ui-monospace,monospace;color:#cde8ff;" +
    "background:rgba(0,10,30,0.6);padding:10px 14px;border-radius:8px;user-select:none";
  container_root().appendChild(d);
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "h") {
      const el = document.getElementById("help-overlay");
      if (el) el.style.display = el.style.display === "none" ? "block" : "none";
    }
  });
  function container_root(): HTMLElement {
    return document.body;
  }
}

/** 照片模式：P 隐藏全部 HUD；O 下载当前画面 PNG。 */
export function enablePhotoMode(renderer: CanvasLike, hideables: HTMLElement[]): void {
  let hidden = false;
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "p") {
      hidden = !hidden;
      for (const el of hideables) el.style.display = hidden ? "none" : "";
      // help 覆盖层一并隐藏
      const h = document.getElementById("help-overlay");
      if (h) h.style.display = hidden ? "none" : "block";
    }
    if (e.key.toLowerCase() === "o") {
      renderer.domElement.toBlob?.call(renderer.domElement, () => {
        /* 由下方通用下载替代 */
      });
      const url = (renderer as unknown as { domElement: HTMLCanvasElement }).domElement.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `solar-odyssey-${Date.now()}.png`;
      a.click();
    }
  });
}

interface CanvasLike {
  domElement: HTMLCanvasElement;
}

/** localStorage 存档：保存/恢复模拟时刻。 */
export function makeSaveLoad(getJD: () => number, setJD: (v: number) => void, key = "solar-odyssey-save"): void {
  const saved = localStorage.getItem(key);
  if (saved) {
    const v = parseFloat(saved);
    if (Number.isFinite(v) && v > 1e6) setJD(v);
  }
  window.setInterval(() => {
    try {
      localStorage.setItem(key, String(getJD()));
    } catch {
      /* 隐私模式忽略 */
    }
  }, 5000);
}

/** WebAudio 合成音（默认静音；M 开关）：舱内嗡嗡 + 曲速上升音。 */
export function makeAmbientAudio(): { toggle(): boolean; warp(on: boolean): void; on(): boolean } {
  let ctx: AudioContext | null = null;
  let osc: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let warpOsc: OscillatorNode | null = null;
  let on = false;
  return {
    on: () => on,
    toggle() {
      if (!ctx) {
        ctx = new AudioContext();
        gain = ctx.createGain();
        gain.gain.value = 0.02;
        gain.connect(ctx.destination);
        osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = 55;
        osc.connect(gain);
        osc.start();
      }
      on = !on;
      if (gain) gain.gain.value = on ? 0.02 : 0;
      if (ctx.state === "suspended") void ctx.resume();
      return on;
    },
    warp(active: boolean) {
      if (!ctx || !on) return;
      if (active && !warpOsc) {
        warpOsc = ctx.createOscillator();
        const wg = ctx.createGain();
        wg.gain.value = 0.015;
        warpOsc.type = "sine";
        warpOsc.frequency.value = 220;
        warpOsc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 1.2);
        warpOsc.connect(wg);
        wg.connect(ctx.destination);
        warpOsc.start();
        window.setTimeout(() => {
          try {
            warpOsc?.stop();
          } catch {
            /* noop */
          }
          warpOsc = null;
        }, 1400);
      }
    },
  };
}
