import { startEarthDemo } from "./render/m0demo.js";
import { startM1Demo } from "./ui/m1demo.js";

const app = document.getElementById("app");
const hud = document.getElementById("hud");
if (!app || !hud) throw new Error("missing #app / #hud");

const mode = new URLSearchParams(window.location.search).get("m");
if (mode === "m1") {
  hud.style.whiteSpace = "pre";
  hud.style.fontSize = "12px";
  const hooks = startM1Demo(app, hud);
  (window as unknown as Record<string, unknown>).__odysseyM1 = hooks;
} else {
  startEarthDemo(app, hud);
}
