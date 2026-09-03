import { startEarthDemo } from "./render/m0demo.js";

const app = document.getElementById("app");
const hud = document.getElementById("hud");
if (!app || !hud) throw new Error("missing #app / #hud");

startEarthDemo(app, hud);
