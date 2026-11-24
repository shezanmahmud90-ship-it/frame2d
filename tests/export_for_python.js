// Writes models and JS results to tests/crosscheck.json for python/crosscheck.py
const path = require("path"), fs = require("fs");
global.LA = require(path.join(__dirname, "../js/linalg.js"));
global.Solver = require(path.join(__dirname, "../js/solver.js"));
const Ex = require(path.join(__dirname, "../js/examples.js"));
const S = global.Solver, out = [];
const pick = (key, mut) => { const m = Ex.examples.find(e => e.key === key).build(); if (mut) mut(m); return m; };
const cases = [
  ["building", pick("building")],
  ["portal", pick("portal", m => { m.settings.interaction = true; })],
  ["gable", pick("gable", m => { m.memberLoads.forEach(l => { l.dir = "local"; l.pat = "G"; }); })],
  ["twoSpan", pick("twoSpan")],
];
for (const [name, m] of cases) {
  const rec = { name, model: m, nsub: 2 };
  const o = { nsub: 2 };
  rec.linear = Array.from(S.linear(m, o).u);
  rec.second = Array.from(S.secondOrder(m, { ...o, lamMax: 1, steps: 10 }).u);
  const b = S.buckling(m, o); rec.lamCr = b.lamCr;
  for (const geometric of [false, true]) {
    const p = S.pushover(m, { ...o, geometric, lamMax: 10, dlam: 0.05 });
    rec["push_" + geometric] = { lam: p.lamLim, events: p.events.map(e => [e.el, e.end]), note: p.note };
  }
  out.push(rec);
}
fs.writeFileSync(path.join(__dirname, "crosscheck.json"), JSON.stringify(out));
console.log("wrote", out.length, "cases");
