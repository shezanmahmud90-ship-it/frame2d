// Node test runner: every verification example against its closed-form reference.
const path = require("path");
global.LA = require(path.join(__dirname, "../js/linalg.js"));
global.Solver = require(path.join(__dirname, "../js/solver.js"));
global.window = { Solver: global.Solver };
const Dyn = require(path.join(__dirname, "../js/dynamics.js"));
const Adv = require(path.join(__dirname, "../js/advanced.js"));
const Ex = require(path.join(__dirname, "../js/examples.js"));
const S = global.Solver;
function run(model, kind) {
  const st = model.settings;
  const o = { nsub: st.nsub, lamMax: st.lamMax, steps: st.steps, geometric: st.geometric, dispLimit: st.dispLimit, axles: kind === "moving" ? Dyn.parseAxles(st.axleLoads, st.axleSpacing) : undefined };
  if (kind === "linear") return S.linear(model, o);
  if (kind === "second") return S.secondOrder(model, o);
  if (kind === "buckling") return S.buckling(model, o);
  if (kind === "pushover") return S.pushover(model, o);
  if (kind === "arc") return S.arcLength(model, o);
  if (kind === "modal") return Dyn.modal(model, { ...o, lumped: st.massType === "lumped" });
  if (kind === "il") return Adv.influenceLine(model, { ...o, path: st.path, quantity: st.ilQuantity, positions: st.ilPositions });
  if (kind === "moving") return Dyn.movingLoad(model, { ...o, path: st.path, positions: st.positions });
}
let fail = 0; const rows = [];
for (const e of Ex.examples.filter(x => x.group !== "Validation cases")) {
  const m = e.build();
  const t0 = Date.now();
  const cache = {};
  for (const ref of m.references) {
    const kind = ref.analysis || "linear";
    const r = cache[kind] || (cache[kind] = run(m, kind));
    const v = ref.get(r), err = 100 * (v - ref.ref) / Math.abs(ref.ref);
    const tol = ref.tol || 0.1;
    const ok = Math.abs(err) <= tol; if (!ok) fail++;
    rows.push([ok ? "PASS" : "FAIL", m.title.slice(0, 44).padEnd(44), ref.label.slice(0, 40).padEnd(40), S.fmtNum(v, 6).padStart(12), S.fmtNum(ref.ref, 6).padStart(12), err.toExponential(2).padStart(10)]);
  }
  // smoke: all analyses run
  for (const k of ["linear", "second", "buckling", "pushover", "modal"]) { try { const r = run(m, k); if (r.unstable) rows.push(["NOTE", m.title, k + " unstable"]); } catch (err) { fail++; rows.push(["ERR ", m.title, k, err.message]); } }
  rows.push(["time", m.title, (Date.now() - t0) + " ms"]);
}
// the three validation cases must run and match their closed-form rows
for (const v of Ex.validations) {
  const m = v.build(); const r = run(m, v.analysis);
  for (const q of v.quantities) {
    const val = q.get(r, m); if (!Number.isFinite(val)) { fail++; rows.push(["FAIL", v.key, q.label, "not finite"]); continue; }
    if (q.theory) { const th = q.theory(m), err = 100 * (val - th) / Math.abs(th), ok = Math.abs(err) <= q.target; if (!ok) fail++; rows.push([ok ? "PASS" : "FAIL", (v.key + " " + v.title).padEnd(44), q.label.slice(0, 40).padEnd(40), S.fmtNum(val, 6).padStart(12), S.fmtNum(th, 6).padStart(12), err.toExponential(2).padStart(10)]); }
  }
}
rows.forEach(r => console.log(r.join(" ")));
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
