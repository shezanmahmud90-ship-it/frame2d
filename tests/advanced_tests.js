// Tests for influence lines, load combinations, AISC checks, corrosion sampling and time history.
const path = require("path");
global.LA = require(path.join(__dirname, "../js/linalg.js"));
global.Solver = require(path.join(__dirname, "../js/solver.js"));
global.window = { Solver: global.Solver };
const Ex = require(path.join(__dirname, "../js/examples.js"));
const Dyn = require(path.join(__dirname, "../js/dynamics.js"));
const Adv = require(path.join(__dirname, "../js/advanced.js"));
const S = global.Solver; let fail = 0;
const check = (name, v, ref, tol) => { const err = Math.abs(v - ref) / Math.max(Math.abs(ref), 1e-12); const ok = err <= (tol || 1e-6); if (!ok) fail++; console.log(ok ? "PASS" : "FAIL", name.padEnd(62), S.fmtNum(v, 7), S.fmtNum(ref, 7)); };
// influence lines
{ const m = Ex.examples.find(e => e.key === "twoSpan").build(); m.memberLoads = [];
  const il = Adv.influenceLine(m, { path: [0, 1], quantity: { type: "reaction", node: 1, dir: 1 }, positions: 200 });
  const at = s => il.values[il.posH.findIndex(p => Math.abs(p - s) < 1e-9)];
  check("IL interior reaction, two-span beam, load at 0.5L: ξ(3−ξ²)/2", at(3), 0.5 * (3 - 0.25) / 2);
  check("IL interior reaction at the support = 1", at(6), 1);
  const mb = Ex.examples.find(e => e.key === "movingBeam").build();
  const im = Adv.influenceLine(mb, { path: [0], quantity: { type: "internal", member: 0, x: 5, comp: "M" }, positions: 100 });
  check("IL midspan moment, simple span: peak L/4", im.max.v, 2.5);
  const ir = Adv.influenceLine(mb, { path: [0], quantity: { type: "reaction", node: 0, dir: 1 }, positions: 100 });
  check("IL left reaction, simple span: 1 at the support", ir.values[0], 1); check("IL left reaction: 0.3 at x = 0.7L", ir.values[70], 0.3); }
// load combinations
{ const m = Ex.validations[0].build();   // V1: D (beam UDL, G) + W (lateral, R)
  const c = Adv.combinations(m, {});
  console.log("     combos:", c.combos.map(x => x.name).join(" | "));
  const lin = S.linear(m), linD = S.linear(Adv.combinedModel(m, { f: { D: 1 } })), linW = S.linear(Adv.combinedModel(m, { f: { W: 1 } }));
  const k = c.combos.findIndex(x => x.name === "0.9D + 1.0W");
  check("Combination 0.9D + 1.0W = superposition of the cases (roof drift)", c.cases[k].u[12], 0.9 * linD.u[12] + linW.u[12]);
  check("Case D + case W = all loads", linD.u[12] + linW.u[12], lin.u[12]);
  const e = c.env[5]; check("Envelope max ≥ every combination (beam end moment)", Math.max(...c.cases.map(r => S.elementMatrices(r, 5).endForces[2] * -1)) <= Math.max(...e.Mmax) + 1e-9 ? 1 : 0, 1); }
// AISC check of an axially loaded pinned column: hand calculation
{ const m = Ex.examples.find(e => e.key === "euler").build(); m.nodeLoads[0].fy = -1000;
  const r = S.linear(m, { nsub: 1 }); const row = Adv.aiscCheck(m, r)[0];
  const s = m.sections[0], rg = Math.sqrt(s.I / s.A), Fe = Math.PI ** 2 * s.E / (5 / rg) ** 2, Fcr = Math.pow(0.658, s.fy / Fe) * s.fy;
  check("AISC E3: φPn = 0.9 Fcr Ag (W14x90, L = 5 m, strong axis)", row.Pc, 0.9 * Fcr * s.A);
  check("AISC H1-1b ratio for pure compression = Pr/(2φPn)… or H1-1a", row.ratio, 1000 / (0.9 * Fcr * s.A) >= 0.2 ? 1000 / (0.9 * Fcr * s.A) : 1000 / (0.9 * Fcr * s.A) / 2); }
// corrosion sampling: zero loss reproduces the intact capacity
{ const m = Ex.examples.find(e => e.key === "portal").build(); const basis = { geometric: false, lamMax: 10 };
  const s0 = Adv.corrosionSample(m, { members: [0, 2], lossMin: 0, lossMax: 0, basis }, Adv.mulberry32(1));
  check("Corrosion sample with zero loss = intact λ (4.0)", s0.lam, 4, 1e-4);
  const s1 = Adv.corrosionSample(m, { members: [0, 2], lossMin: 0.25, lossMax: 0.25, basis }, Adv.mulberry32(1));
  check("25 % section loss on both columns: λ = 0.75 × 4", s1.lam, 3, 1e-4); }
// time history: undamped SDOF (massless axially rigid cantilever + tip mass) under harmonic ground motion
{ const m = Ex.base("sdof"); const L = 3, s = { name: "c", E: 200e6, A: 10, I: 1e-4, Z: 0, fy: 0, rho: 0 };
  m.sections.push(s); m.nodes.push({ x: 0, y: 0 }, { x: 0, y: L }); m.members.push(Ex.mem(0, 1)); m.supports.push(Ex.sup(0, "fixed"));
  m.masses = [{ node: 1, m: 2 }]; m.settings.selfMass = false;
  const k = 3 * s.E * s.I / L ** 3, w = Math.sqrt(k / 2), f = w / (2 * Math.PI);
  const Om = 0.6 * w, A0 = 0.1;   // g
  const rec = Adv.harmonicMotion({ amp: A0, f: Om / (2 * Math.PI), duration: 4, dt: 0.0005 });
  const th = Adv.timeHistory(m, { record: rec, zeta: 0, lumped: true, selfMass: false });
  let err = 0, pk = 0;
  th.tH.forEach((t, i) => { const ex = -(A0 * 9.80665 / (w * w - Om * Om)) * (Math.sin(Om * t) - Om / w * Math.sin(w * t)); err = Math.max(err, Math.abs(th.ctrlH[i] - ex)); pk = Math.max(pk, Math.abs(ex)); });
  console.log(`     SDOF f = ${f.toFixed(3)} Hz, peak exact ${pk.toExponential(4)} m, max Newmark error ${(100 * err / pk).toFixed(3)} % of peak`);
  check("Newmark vs exact SDOF response (error < 0.5 % of peak)", err / pk < 0.005 ? 1 : 0, 1);
  check("Modal frequency of the SDOF model = √(k/m)/2π", th.modal.modes[0].f, f, 1e-6);
  const q = Adv.timeHistory(Ex.examples.find(e => e.key === "building").build(), { record: Adv.syntheticQuake({ duration: 8 }), zeta: 0.05 });
  console.log(`     3-story frame, synthetic quake: peak roof ${(1000 * q.peak.u).toFixed(1)} mm at ${q.peak.t.toFixed(2)} s, peak base shear ${q.peakV.v.toFixed(0)} kN, drifts ${q.drift.map(d => (100 * d).toFixed(2) + "%").join(", ")}`); }
console.log(fail ? `${fail} FAILURES` : "ALL ADVANCED TESTS PASS"); process.exit(fail ? 1 : 0);
