// Tests of features added beyond core.py: member loads, virtual work, equilibrium, K properties, damage study.
const path = require("path");
global.LA = require(path.join(__dirname, "../js/linalg.js"));
global.Solver = require(path.join(__dirname, "../js/solver.js"));
const Ex = require(path.join(__dirname, "../js/examples.js"));
const S = global.Solver; let fail = 0;
const check = (name, v, ref, tol) => { const err = Math.abs(v - ref) / Math.max(Math.abs(ref), 1e-12); const ok = err <= (tol || 1e-6); if (!ok) fail++; console.log(ok ? "PASS" : "FAIL", name.padEnd(58), S.fmtNum(v, 7), S.fmtNum(ref, 7)); };

// fixed-fixed beam: point load at a, linearly varying load, partial UDL -> end moments vs textbook formulas
const L = 6, P = 80, a = 2, b = L - a;
function ffBeam(loads) {
  const m = Ex.base("ff"); m.sections.push(Ex.wSection("W18x50"));
  m.nodes.push({ x: 0, y: 0 }, { x: L, y: 0 }); m.members.push(Ex.mem(0, 1));
  m.supports.push(Ex.sup(0, "fixed"), Ex.sup(1, "fixed")); m.memberLoads = loads; return S.linear(m);
}
let r = ffBeam([Ex.pload(0, -P, a, "GY")]);
check("Point load: M_A = Pab²/L²", r.reactions.find(q => q.dof === 2).value, P * a * b * b / L ** 2);
check("Point load: R_A = Pb²(3a+b)/L³", r.reactions.find(q => q.dof === 1).value, P * b * b * (3 * a + b) / L ** 3);
const w = 30;
r = ffBeam([{ member: 0, kind: "udl", dir: "GY", w1: 0, w2: -w, a: 0, b: null, pat: "R" }]);
check("Triangular load: M_A = wL²/30", r.reactions.find(q => q.dof === 2).value, w * L * L / 30);
check("Triangular load: M_B = wL²/20", -r.reactions.find(q => q.dof === 5).value, w * L * L / 20);
r = ffBeam([{ member: 0, kind: "udl", dir: "local", w1: -w, w2: null, a: 0, b: L / 2, pat: "R" }]);
check("Half-span UDL: M_A = 11wL²/192", r.reactions.find(q => q.dof === 2).value, 11 * w * L * L / 192);
// subdivision must not change linear results for member loads
const m2 = Ex.base("ff2"); m2.sections.push(Ex.wSection("W18x50")); m2.nodes.push({ x: 0, y: 0 }, { x: L, y: 0 }); m2.members.push(Ex.mem(0, 1));
m2.supports.push(Ex.sup(0, "fixed"), Ex.sup(1, "fixed")); m2.memberLoads = [Ex.pload(0, -P, a, "GY"), { member: 0, kind: "udl", dir: "GY", w1: -10, w2: -40, a: 1, b: 5, pat: "R" }];
const r1 = S.linear(m2, { nsub: 1 }), r5 = S.linear(m2, { nsub: 5 });
check("Subdivision 1 vs 5 elements: M_A identical", r5.reactions.find(q => q.dof === 2).value, r1.reactions.find(q => q.dof === 2).value, 1e-9);

// virtual work and equilibrium on every example (linear)
for (const e of Ex.examples) {
  const m = e.build(); const res = S.linear(m, { nsub: m.settings.nsub });
  if (res.unstable) continue;
  const eq = S.equilibrium(res);
  const scale = Math.max(1, Math.abs(eq.applied.fx), Math.abs(eq.applied.fy));
  const resid = Math.max(Math.abs(eq.residual.fx), Math.abs(eq.residual.fy)) / scale;
  check(`Equilibrium ΣF residual: ${m.title.slice(0, 34)}`, resid + 1, 1, 1e-9);
  // largest translation DOF
  let best = -1, bd = 0; res.A.free.forEach(d => { if (d % 3 !== 2 && d < 3 * res.A.nOrig && Math.abs(res.u[d]) > best) { best = Math.abs(res.u[d]); bd = d; } });
  const vw = S.virtualWork(res, Math.floor(bd / 3), bd % 3);
  if (vw) check(`Unit-load virtual work δ: ${m.title.slice(0, 34)}`, vw.delta, vw.stiffness, 1e-6);
  const kp = S.stiffnessProperties(res);
  if (kp.zeroModes !== undefined && !kp.symmetric) { fail++; console.log("FAIL K not symmetric", m.title); }
}
// unsupported free frame: 3 rigid-body modes
{ const m = Ex.examples.find(e => e.key === "portal").build(); m.supports = []; const res = S.linear(m); const kp = S.stiffnessProperties(res);
  check("Unsupported portal: zero eigenvalues of K = 3 rigid-body modes", kp.zeroModes, 3, 0); check("Unsupported portal flagged unstable", res.unstable ? 1 : 0, 1, 0); }
// determinacy
{ const m = Ex.examples.find(e => e.key === "truss").build(); const d = S.linear(m).det; check("Pratt truss determinacy m + r − 2j = 0", d.degree, 0, 0); }
{ const m = Ex.examples.find(e => e.key === "portal").build(); const d = S.linear(m).det; check("Fixed portal: degree of indeterminacy 3", d.degree, 3, 0); }
{ const m = Ex.examples.find(e => e.key === "twoSpan").build(); const d = S.linear(m).det; check("Two-span beam: degree 1", d.degree, 1, 0); }
// flexibility = K^-1, reciprocity
{ const m = Ex.examples.find(e => e.key === "portal").build(); const f = S.flexibility(S.linear(m)); check("Flexibility: K·F = I", f.identityError + 1, 1, 1e-9); check("Maxwell reciprocity F = Fᵀ", f.reciprocity + 1, 1, 1e-9); }
// damage study on the portal (proposal values 400 / 100 / 200 kN)
{ const m = Ex.examples.find(e => e.key === "portal").build();
  const st = S.retrofitStudy(m, { geometric: false, lamMax: 10 }, 1, 0, 2);
  check("Portal intact λ = 4 (H = 400 kN)", st.intact.lam, 4, 1e-4); check("Beam removed λ = 1 (H = 100 kN)", st.damaged.lam, 1, 1e-4);
  check("Loaded column strengthened ×2: λ = 2 (H = 200 kN)", st.retrofit.lam, 2, 1e-4); check("C = 0.25", st.C, 0.25, 1e-4); check("η = 1.0", st.eta, 1, 1e-4);
  const rk = S.removalRanking(m, { geometric: false, lamMax: 10 });
  console.log("     ranking:", rk.rows.map(x => `M${x.member + 1}:${x.status}:${S.fmtNum(x.C)}`).join("  "));
}
// buckling convergence (intro to FEM)
{ for (const n of [1, 2, 4, 8]) { const m = Ex.examples.find(e => e.key === "euler").build(); const b = S.buckling(m, { nsub: n }); const ref = m.references[0].ref; console.log(`     Euler column, ${n} element(s): Pcr = ${S.fmtNum(b.lamCr * 1000, 6)}  error ${(100 * (b.lamCr * 1000 / ref - 1)).toFixed(3)}%`); } }
console.log(fail ? `${fail} FAILURES` : "ALL FEATURE TESTS PASS"); process.exit(fail ? 1 : 0);
