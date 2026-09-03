import { it } from "vitest";
import { MakeTime, HelioVector, Body } from "astronomy-engine";
import { helioJ2000 } from "../src/ephemeris/ephemeris.js";
import { lambert, norm, sub } from "../src/physics/kepler.js";
import { bodyStateKm } from "../src/physics/ship.js";
import { GM } from "../src/ephemeris/bodies.js";
import { AU_KM } from "../src/core/constants.js";

it("cross-check AE", () => {
  const jd = 2461367.5; // 2026-11-30 12:00 UTC
  const time = MakeTime(new Date(Date.parse("2026-11-30T12:00:00Z")));
  const aeE = HelioVector(Body.Earth, time);
  const aeM = HelioVector(Body.Mars, time);
  const mineE = helioJ2000("earth", jd);
  const mineM = helioJ2000("mars", jd);
  console.log("Earth mine:", mineE.x.toFixed(1), mineE.y.toFixed(1), mineE.z.toFixed(1));
  console.log("Earth AE  :", (aeE.x * AU_KM).toFixed(1), (aeE.y * AU_KM).toFixed(1), (aeE.z * AU_KM).toFixed(1));
  console.log("Mars  mine:", mineM.x.toFixed(1), mineM.y.toFixed(1), mineM.z.toFixed(1));
  console.log("Mars  AE  :", (aeM.x * AU_KM).toFixed(1), (aeM.y * AU_KM).toFixed(1), (aeM.z * AU_KM).toFixed(1));

  // 用 AE 的端点跑我的 Lambert
  const r1 = { x: aeE.x * AU_KM, y: aeE.y * AU_KM, z: aeE.z * AU_KM };
  const r2 = { x: aeM.x * AU_KM, y: aeM.y * AU_KM, z: aeM.z * AU_KM };
  const dt = 220 * 86400;
  const { v1 } = lambert(r1, r2, dt, GM.sun);
  const aeE1 = HelioVector(Body.Earth, MakeTime(new Date(Date.parse("2026-11-30T11:59:00Z"))));
  const vEm = {
    x: ((aeE.x - aeE1.x) * AU_KM) / 60,
    y: ((aeE.y - aeE1.y) * AU_KM) / 60,
    z: ((aeE.z - aeE1.z) * AU_KM) / 60,
  };
  const vInf = norm(sub(v1, vEm));
  console.log("v∞ (AE 端点 + 我的 Lambert) =", vInf.toFixed(3), "km/s");

  const rEm = bodyStateKm("earth", jd);
  const rMm = bodyStateKm("mars", jd + 220);
  const { v1: v1m } = lambert(rEm.r, rMm.r, 220 * 86400, GM.sun);
  console.log("v∞ (我的端点 + 我的 Lambert) =", norm(sub(v1m, rEm.v)).toFixed(3), "km/s");
});
