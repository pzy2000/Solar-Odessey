/**
 * M8 · 任务重演模式（?m=m8）。
 * 复用太阳系场景，叠加任务面板：选择任务 → 时间拨到历史时刻 →
 * 事件时间线浏览（每个事件：时间拨转 + 相机预设 + 历史简报卡）。
 */
import { startSolarScene, type M2Hooks } from "./solarScene.js";
import { MISSIONS, missionStartJD, eventJD, type MissionDef } from "../gameplay/missions.js";
import { formatUTC } from "../core/time.js";

export function startMissionScene(container: HTMLElement, hud: HTMLElement): M2Hooks {
  const hooks = startSolarScene(container, hud, false);

  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;left:12px;top:12px;z-index:10;font:12px/1.6 ui-monospace,monospace;color:#ffe0b0;" +
    "background:rgba(30,16,4,0.7);padding:12px 14px;border-radius:8px;max-width:400px;user-select:none";
  panel.innerHTML = `
    <b style="color:#ffd9a0">任务重演</b>
    <div id="ms-list" style="display:flex;gap:6px;margin:6px 0;flex-wrap:wrap"></div>
    <div id="ms-body"></div>
  `;
  container.appendChild(panel);

  const list = panel.querySelector("#ms-list") as HTMLElement;
  const body = panel.querySelector("#ms-body") as HTMLElement;
  let current: MissionDef | null = null;
  let eventIdx = -1;

  for (const m of MISSIONS) {
    const b = document.createElement("button");
    b.textContent = m.name;
    b.style.cssText = "background:rgba(255,200,120,0.14);color:#ffe0b0;border:1px solid rgba(255,200,120,0.4);border-radius:4px;cursor:pointer;font:inherit;padding:2px 8px";
    b.addEventListener("click", () => startMission(m));
    list.appendChild(b);
  }

  function startMission(m: MissionDef): void {
    current = m;
    eventIdx = -1;
    hooks.setJD(missionStartJD(m));
    hooks.setTarget("sun");
    hooks.setDist(3e12);
    renderBody();
  }

  function renderBody(): void {
    if (!current) return;
    const rows = current.events
      .map((e, i) => {
        const done = i <= eventIdx;
        return `<div style="margin:3px 0;${done ? "color:#8fdc8f" : "opacity:0.85"}">${done ? "✓" : "○"} ${e.t.slice(0, 16)} — ${e.title}</div>`;
      })
      .join("");
    const ev = eventIdx >= 0 && eventIdx < current.events.length ? current.events[eventIdx] : null;
    body.innerHTML = `
      <b>${current.name}</b> — ${current.subtitle}
      <div style="margin:4px 0">起点: ${formatUTC(missionStartJD(current))}</div>
      ${rows}
      <div style="display:flex;gap:6px;margin:6px 0">
        <button data-ms="prev">‹ 上一事件</button>
        <button data-ms="next">下一事件 ›</button>
      </div>
      ${ev ? `<div style="border-top:1px solid rgba(255,200,120,0.3);padding-top:6px"><b>${ev.title}</b><br/>${formatUTC(eventJD(ev))}<br/>${ev.text}</div>` : ""}
    `;
    body.querySelectorAll("button").forEach((b) => {
      b.style.cssText = "background:rgba(255,200,120,0.14);color:#ffe0b0;border:1px solid rgba(255,200,120,0.4);border-radius:4px;cursor:pointer;font:inherit;padding:2px 8px";
      b.addEventListener("click", () => {
        const ms = (b as HTMLElement).dataset.ms;
        if (!current) return;
        if (ms === "next" && eventIdx < current.events.length - 1) {
          eventIdx++;
          jumpTo(eventIdx);
        } else if (ms === "prev" && eventIdx >= 0) {
          eventIdx--;
          if (eventIdx >= 0) jumpTo(eventIdx);
          else hooks.setJD(missionStartJD(current));
        }
        renderBody();
      });
    });
  }

  function jumpTo(idx: number): void {
    if (!current) return;
    const e = current.events[idx];
    hooks.setJD(eventJD(e));
    if (e.target) {
      hooks.setTarget(e.target);
      if (e.distM) hooks.setDist(e.distM);
    }
  }

  // 初始：默认进入第一个任务
  startMission(MISSIONS[0]);

  return hooks;
}
