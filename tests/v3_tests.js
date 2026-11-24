// Closed-form tests for the v3 element features: temperature, misfit, inclined supports,
// shear deformation (Timoshenko) and semi-rigid connections.
const path = require("path");
global.LA = require(path.join(__dirname, "../js/linalg.js"));
global.Solver = require(path.join(__dirname, "../js/solver.js"));
global.window = { Solver: global.Solver };
const Ex = require(path.join(__dirname, "../js/examples.js"));
const S = global.Solver; let fail = 0;
const check = (name, v, ref, tol) => { const err = Math.abs(v - ref) / Math.max(Math.abs(ref), 1e-12); const ok = err <= (tol || 1e-6); if (!ok) fail++; console.log(ok ? "PASS" : "FAIL", name.padEnd(62), S.fmtNum(v, 7), S.fmtNum(ref, 7)); };
const R = (r, d) => { const q = r.reactions.filter(x => x.dof === d); return q.reduce((s, x) => s + x.value, 0); };
const vwOK = (name, r, node, dir) => { const vw = S.virtualWork(r, node, dir); if (vw) check(name + ": virtual work = stiffness", vw.delta, vw.stiffness, 1e-6); };
const sec = Ex.wSection("W18x50"), EA = sec.E * sec.A, EI = sec.E * sec.I, alpha = 1.2e-5;
function beam(sup1, sup2, L, extra) {
  const m = Ex.base("t"); m.sections.push({ ...sec, ...(extra || {}) });
  m.nodes.push({ x: 0, y: 0 }, { x: L, y: 0 }); m.members.push(Ex.mem(0, 1));
  m.supports.push(Ex.sup(0, sup1)); if (sup2) m.supports.push(Ex.sup(1, sup2)); return m;
}
// 1 temperature in a fixed-fixed beam
{ const m = beam("fixed", "fixed", 6); m.memberLoads.push({ member: 0, kind: "thermal", dT: 30, dTg: 20, h: 0.457, alpha, pat: "R" });
  const r = S.linear(m), e = S.elementMatrices(r, 0).endForces;
  check("Fixed beam, ΔT = 30 °C: N = −EAαΔT", -e[0], -EA * alpha * 30);
  check("Fixed beam, gradient 20 °C: |M| = EIαΔTg/h", Math.abs(R(r, 2)), EI * alpha * 20 / 0.457);
  check("Fixed beam, gradient: no vertical reaction", Math.abs(R(r, 1)) + 1, 1, 1e-9); }
// 2 free cantilever: no stress, free thermal deformation
{ const m = beam("fixed", null, 4); m.memberLoads.push({ member: 0, kind: "thermal", dT: 25, dTg: 15, h: 0.457, alpha, pat: "R" });
  const r = S.linear(m);
  check("Cantilever, ΔT: tip u = αΔT L", r.u[3], alpha * 25 * 4);
  check("Cantilever, gradient (top hotter): tip v = −αΔTg L²/(2h)", r.u[4], -alpha * 15 * 16 / (2 * 0.457));
  vwOK("Cantilever thermal", r, 1, 1); }
// 3 misfit: bar between two pins, 5 mm too long
{ const m = beam("pinned", "pinned", 5); m.members[0].type = "truss"; m.memberLoads.push({ member: 0, kind: "misfit", dL: 0.005, pat: "R" });
  const r = S.linear(m), e = S.elementMatrices(r, 0).endForces; check("Misfit bar 5 mm long: N = −EA ΔL/L", -e[0], -EA * 0.005 / 5); }
// 4 inclined roller (30°) on the right, P at midspan
{ const m = beam("pinned", null, 8); m.nodes.splice(1, 0, { x: 4, y: 0 }); m.members = [Ex.mem(0, 1), Ex.mem(1, 2)]; m.supports = [Ex.sup(0, "pinned"), { ...Ex.sup(2, "pinned"), ux: false, uy: false, rz: false, incline: true, angle: 30 }];
  m.nodeLoads.push(Ex.nload(1, 0, -100)); const r = S.linear(m);
  check("Inclined roller 30°: vertical reaction = P/2", R(r, 7), 50, 1e-6);
  check("Inclined roller 30°: horizontal reaction = −(P/2)tan30°", R(r, 6), -50 * Math.tan(Math.PI / 6), 1e-6);
  check("Inclined roller 30°: left pin Rx = +(P/2)tan30°", R(r, 0), 50 * Math.tan(Math.PI / 6), 1e-6);
  const eq = S.equilibrium(r); check("Inclined roller: ΣFx = 0", eq.residual.fx + 1, 1, 1e-6); }
// 5 Timoshenko cantilever
{ const As = 0.0045, m = beam("fixed", null, 1.5, { As }); m.nodeLoads.push(Ex.nload(1, 0, -200));
  const G = sec.E / 2.6, r = S.linear(m);
  check("Timoshenko cantilever: δ = PL³/3EI + PL/(G As)", r.u[4], -(200 * 1.5 ** 3 / (3 * EI) + 200 * 1.5 / (G * As)));
  vwOK("Timoshenko cantilever", r, 1, 1);
  const m2 = beam("fixed", "fixed", 3, { As }); m2.nodes.splice(1, 0, { x: 1.5, y: 0 }); m2.members = [Ex.mem(0, 1), Ex.mem(1, 2)]; m2.supports = [Ex.sup(0, "fixed"), Ex.sup(2, "fixed")]; m2.nodeLoads.push(Ex.nload(1, 0, -100));
  const r2 = S.linear(m2); check("Timoshenko fixed beam, central P: δ = PL³/192EI + PL/(4GAs)", r2.u[4], -(100 * 27 / (192 * EI) + 100 * 3 / (4 * G * As)));
  vwOK("Timoshenko fixed beam", r2, 1, 1); }
// 6 semi-rigid connections
{ const L = 6, w = 20;
  for (const k of [1e4, 5e4, 2e5]) {
    const m = beam("fixed", "fixed", L); m.members[0].kI = k; m.members[0].kJ = k; m.memberLoads.push(Ex.udl(0, -w));
    const r = S.linear(m), M = Math.abs(S.elementMatrices(r, 0).endForces[2]);
    check(`Semi-rigid beam k = ${k}: M = (wL²/12)/(1 + 2EI/kL)`, M, w * L * L / 12 / (1 + 2 * EI / (k * L)));
  }
  const m = beam("fixed", "fixed", L); m.nodes.splice(1, 0, { x: 3, y: 0 }); m.members = [Ex.mem(0, 1, 0, { kI: 3e4 }), Ex.mem(1, 2, 0, { kJ: 3e4 })]; m.supports = [Ex.sup(0, "fixed"), Ex.sup(2, "fixed")];
  m.nodeLoads.push(Ex.nload(1, 0, -50)); vwOK("Semi-rigid beam with point load", S.linear(m), 1, 1);
  // second order + springs runs
  const pm = Ex.examples.find(e => e.key === "portal").build(); pm.members[1].kI = 2e4; pm.members[1].kJ = 2e4; const s2 = S.secondOrder(pm, { nsub: 2, lamMax: 1, steps: 5 }); check("Semi-rigid portal: second order runs", s2.lam, 1, 1e-9); }
console.log(fail ? `${fail} FAILURES` : "ALL V3 ELEMENT TESTS PASS"); process.exit(fail ? 1 : 0);
