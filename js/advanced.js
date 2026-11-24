/* Frame2D Studio - advanced analyses built on the linear kernel:
 *   influence lines (unit load along a member path, Müller-Breslau principle)
 *   load combinations with envelopes (ASCE 7 LRFD style factors)
 *   AISC 360 member checks (E3 compression, D2 tension, F2 plastic moment, H1-1 interaction)
 *   section-loss (corrosion) Monte Carlo on collapse capacity
 *   earthquake time history by Newmark's average-acceleration method with Rayleigh damping
 * Units: kN, m, t, s.
 */
(function (root) {
  "use strict";
  const isNode = typeof module !== "undefined" && module.exports;
  const LA = isNode ? require("./linalg.js") : root.LA;
  const S = isNode ? require("./solver.js") : root.Solver;
  const Dyn = isNode ? require("./dynamics.js") : root.Dyn;
  const G_ACC = 9.80665;
  const clone = m => JSON.parse(JSON.stringify(m, (k, v) => (k === "references" || k === "study" || k === "theory") ? undefined : v));

  // ------------------------------------------------------------------------------- influence lines
  /** quantity: {type:"reaction", node, dir} or {type:"internal", member, x, comp:"M"|"V"|"N"} */
  function influenceLine(model, opts) {
    opts = opts || {};
    const st = model.settings || {};
    const base = clone(model); base.nodeLoads = []; base.memberLoads = [];
    const A = S.prepare(base, opts); A.presc.fill(0);
    const geo = Dyn.pathGeometry(model, opts.path || st.path || []);
    const q = opts.quantity || st.ilQuantity || { type: "reaction", node: 0, dir: 1 };
    const n = Math.max(20, Math.min(800, Math.round(opts.positions || st.ilPositions || 200)));
    const posH = [], values = [], uH = [], loadsH = [], axH = [];
    let label, unit;
    if (q.type === "reaction") { label = `${["Rx", "Ry", "M"][q.dir]} at node ${q.node + 1}`; unit = q.dir === 2 ? "kN·m per kN" : "kN per kN"; }
    else { label = `${q.comp} in member ${q.member + 1} at x = ${(+q.x).toFixed(2)} m`; unit = q.comp === "M" ? "kN·m per kN" : "kN per kN"; }
    for (let k = 0; k <= n; k++) {
      const s = geo.length * k / n;
      const active = Dyn.applyPosition(A, geo, [{ P: 1, d: 0 }], s);
      const r = S.linear(base, { ...opts, A, g: 0, lam: 1 });
      if (r.unstable) return { kind: "il", A, unstable: true, mode: r.mode, warnings: A.warn.slice() };
      let v = 0;
      if (q.type === "reaction") v = r.reactions.filter(x => x.dof === 3 * q.node + q.dir).reduce((a, x) => a + x.value, 0);
      else {
        const els = A.memberEls[q.member];
        if (!els || !els.length) throw new Error(`Member ${q.member + 1} is not in the model`);
        const xx = Math.min(Math.max(+q.x, 0), A.els[els[els.length - 1]].s0 + A.els[els[els.length - 1]].L0);
        let e = els.find(i => xx >= A.els[i].s0 - 1e-9 && xx <= A.els[i].s0 + A.els[i].L0 + 1e-9);
        if (e === undefined) e = els[0];
        const el = A.els[e], fn = S.fieldFn(el, r.infos[e], el.loadsR, el.qR);
        const xl = Math.min(Math.max(xx - el.s0, 1e-9), el.L0 - 1e-9);
        v = fn(xl)[q.comp];
      }
      posH.push(s); values.push(v); uH.push(Float64Array.from(r.u)); loadsH.push(A.els.map(el => el.loadsR.slice())); axH.push(active);
    }
    let imax = 0, imin = 0; values.forEach((v, i) => { if (v > values[imax]) imax = i; if (v < values[imin]) imin = i; });
    return { kind: "il", A, base, geo, quantity: q, label, unit, posH, values, uH, loadsH, axH, lamH: posH, axles: [{ P: 1, d: 0 }],
      max: { v: values[imax], s: posH[imax] }, min: { v: values[imin], s: posH[imin] }, g: 0, lam: 1, u: uH[uH.length - 1], warnings: A.warn.slice(), det: S.determinacy(A) };
  }

  // ------------------------------------------------------------------------------- load combinations
  const CASES = { D: "Dead", L: "Live", W: "Wind", E: "Earthquake", S: "Snow", T: "Temperature" };
  /** Load case of a load (explicit lc, else inferred from its pattern and type). */
  function loadCase(l, isMember) {
    if (l.lc && CASES[l.lc]) return l.lc;
    if (isMember && (l.kind === "thermal" || l.kind === "misfit")) return "T";
    if (l.pat === "G") return "D";
    if (!isMember && (+l.fx || 0) !== 0 && !(+l.fy)) return "W";
    return "L";
  }
  const DEFAULT_COMBOS = [
    { name: "1.4D", f: { D: 1.4 } },
    { name: "1.2D + 1.6L + 0.5S", f: { D: 1.2, L: 1.6, S: 0.5 } },
    { name: "1.2D + 1.6S + L", f: { D: 1.2, S: 1.6, L: 1.0 } },
    { name: "1.2D + 1.0W + L + 0.5S", f: { D: 1.2, W: 1.0, L: 1.0, S: 0.5 } },
    { name: "0.9D + 1.0W", f: { D: 0.9, W: 1.0 } },
    { name: "1.2D + 1.0E + L + 0.2S", f: { D: 1.2, E: 1.0, L: 1.0, S: 0.2 } },
    { name: "0.9D + 1.0E", f: { D: 0.9, E: 1.0 } },
    { name: "1.2D + 1.2T + 0.5L", f: { D: 1.2, T: 1.2, L: 0.5 } }
  ];
  function casesPresent(model) {
    const set = new Set();
    (model.nodeLoads || []).forEach(l => set.add(loadCase(l, false)));
    (model.memberLoads || []).forEach(l => set.add(loadCase(l, true)));
    return set;
  }
  /** Combinations that act on this model: the user's list, or the default ones that involve its load cases. */
  function activeCombos(model) {
    if (model.combos && model.combos.length) return model.combos;
    const present = casesPresent(model);
    return DEFAULT_COMBOS.filter(c => {
      const vars = Object.entries(c.f).filter(([k]) => k !== "D");
      if (!vars.length) return present.has("D");
      const principal = vars.sort((a, b) => b[1] - a[1])[0][0];
      return present.has(principal);
    });
  }
  /** Model with every load multiplied by the factor of its case in the combination. */
  function combinedModel(model, combo) {
    const m = clone(model);
    const scale = (l, isMember) => { const f = combo.f[loadCase(l, isMember)] || 0; return f; };
    m.nodeLoads = (model.nodeLoads || []).map(l => ({ l, f: scale(l, false) })).filter(x => x.f).map(({ l, f }) => ({ ...l, fx: (+l.fx || 0) * f, fy: (+l.fy || 0) * f, mz: (+l.mz || 0) * f }));
    m.memberLoads = (model.memberLoads || []).map(l => ({ l, f: scale(l, true) })).filter(x => x.f).map(({ l, f }) => {
      const o = { ...l };
      for (const k of ["w1", "w2", "P", "dT", "dTg", "dL"]) if (o[k] !== null && o[k] !== undefined && o[k] !== "") o[k] = +o[k] * f;
      return o;
    });
    return m;
  }
  function combinations(model, opts) {
    opts = opts || {};
    const combos = activeCombos(model);
    if (!combos.length) throw new Error("No load combination applies: give the loads cases (D, L, W, E, S, T)");
    const NS = 16;
    const cases = combos.map(c => { const m = combinedModel(model, c); const r = S.linear(m, opts); r.comboName = c.name; r.comboModel = m; return r; });
    if (cases.some(r => r.unstable)) return { kind: "combo", unstable: true, A: cases[0].A, mode: cases.find(r => r.unstable).mode, warnings: [] };
    const A = cases[0].A;
    const env = A.els.map(el => ({ x: Array.from({ length: NS + 1 }, (_, k) => el.L0 * k / NS), Mmax: new Float64Array(NS + 1).fill(-Infinity), Mmin: new Float64Array(NS + 1).fill(Infinity), Vmax: new Float64Array(NS + 1).fill(-Infinity), Vmin: new Float64Array(NS + 1).fill(Infinity), Nmax: new Float64Array(NS + 1).fill(-Infinity), Nmin: new Float64Array(NS + 1).fill(Infinity) }));
    const summary = [];
    let maxM = { v: 0 }, minM = { v: 0 };
    cases.forEach((r, ci) => {
      let mM = 0, mD = 0, mN = 0;
      r.A.els.forEach((el, e) => {
        const loads = S.elemLoads(el, r.g, r.lam), q = S.elemQ(el, r.g, r.lam), fn = S.fieldFn(el, r.infos[e], loads, q), E = env[e];
        for (let i = 0; i <= NS; i++) {
          const v = fn(Math.min(Math.max(E.x[i], 1e-9), el.L0 - 1e-9));
          E.Mmax[i] = Math.max(E.Mmax[i], v.M); E.Mmin[i] = Math.min(E.Mmin[i], v.M);
          E.Vmax[i] = Math.max(E.Vmax[i], v.V); E.Vmin[i] = Math.min(E.Vmin[i], v.V);
          E.Nmax[i] = Math.max(E.Nmax[i], v.N); E.Nmin[i] = Math.min(E.Nmin[i], v.N);
          mM = Math.max(mM, Math.abs(v.M)); mN = Math.max(mN, Math.abs(v.N));
          if (v.M > maxM.v) maxM = { v: v.M, member: el.parent, combo: ci, x: el.s0 + E.x[i] };
          if (v.M < minM.v) minM = { v: v.M, member: el.parent, combo: ci, x: el.s0 + E.x[i] };
        }
      });
      for (let n = 0; n < A.nOrig; n++) mD = Math.max(mD, Math.hypot(r.u[3 * n], r.u[3 * n + 1]));
      summary.push({ name: r.comboName, maxM: mM, maxN: mN, maxD: mD });
    });
    const reactions = A.fixedList.filter(d => d < 3 * A.nOrig).map(d => { const vals = cases.map(r => r.reactions.filter(x => x.dof === d).reduce((a, x) => a + x.value, 0)); return { dof: d, vals, max: Math.max(...vals), min: Math.min(...vals) }; });
    return { kind: "combo", A, cases, combos, env, summary, reactions, maxM, minM, posH: cases.map((_, i) => i), lamH: cases.map((_, i) => i), uH: cases.map(r => r.u), u: cases[0].u, g: 1, lam: 1, warnings: A.warn.slice(), det: S.determinacy(A) };
  }

  // ------------------------------------------------------------------------------- AISC 360 checks
  /** Check every original member for the force state of a linear-type result (or each combination). */
  function aiscCheck(model, res, opts) {
    opts = opts || {};
    const states = res.kind === "combo" ? res.cases.map((r, i) => ({ r, name: res.combos[i].name })) : [{ r: res, name: res.kind }];
    const rows = [];
    model.members.forEach((q, mi) => {
      let worst = null;
      for (const { r, name } of states) {
        const A = r.A, els = A.memberEls[mi]; if (!els || !els.length) continue;
        const el0 = A.els[els[0]];
        if (!(el0.fy > 0)) continue;
        let Nc = 0, Nt = 0, Mmax = 0;
        els.forEach(e => {
          const el = A.els[e], g = r.g === undefined ? 1 : r.g, lam = r.lam === undefined ? 1 : r.lam;
          const smp = S.sampleElement(el, r.infos[e], S.elemLoads(el, g, lam), S.elemQ(el, g, lam), 16);
          smp.N.forEach(v => { Nc = Math.min(Nc, v); Nt = Math.max(Nt, v); }); smp.M.forEach(v => { Mmax = Math.max(Mmax, Math.abs(v)); });
        });
        const E = el0.E, Fy = el0.fy, Ag = el0.A, I = el0.I, Z = el0.Z, rg = Math.sqrt(I / Ag);
        const L = els.reduce((s, e) => s + A.els[e].L0, 0), K = +q.K > 0 ? +q.K : (opts.K || 1);
        const slender = K * L / rg, Fe = Math.PI ** 2 * E / (slender * slender);
        const Fcr = Fy / Fe <= 2.25 ? Math.pow(0.658, Fy / Fe) * Fy : 0.877 * Fe;
        const phiPnc = 0.9 * Fcr * Ag, phiPnt = 0.9 * Fy * Ag, phiMn = el0.truss ? Infinity : 0.9 * Fy * Z;
        const comp = -Nc >= Nt, Pr = comp ? -Nc : Nt, Pc = comp ? phiPnc : phiPnt, Mr = el0.truss ? 0 : Mmax;
        const pr = Pr / Pc, mr = Mr / phiMn;
        const ratio = pr >= 0.2 ? pr + 8 / 9 * mr : pr / 2 + mr;
        const row = { member: mi, combo: name, comp, Pr, Pc, Mr, Mc: phiMn, KLr: slender, Fcr, Fe, ratio, eq: pr >= 0.2 ? "H1-1a" : "H1-1b", K, L, r: rg };
        if (!worst || row.ratio > worst.ratio) worst = row;
      }
      if (worst) rows.push(worst);
    });
    return rows;
  }

  // ------------------------------------------------------------------------------- corrosion Monte Carlo
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  /** One sample: each listed member loses a random fraction of its section (A, I, Z scale by 1 − loss). */
  function corrosionSample(model, opts, rng) {
    const factors = new Map(), losses = [];
    for (const mi of opts.members) { const loss = opts.lossMin + (opts.lossMax - opts.lossMin) * rng(); factors.set(mi, 1 - loss); losses.push(loss); }
    const r = S.pushover(model, { ...opts.basis, factors });
    return { lam: r.unstable ? 0 : r.lamLim, status: r.unstable ? "unstable" : r.status, losses };
  }
  function stats(values) {
    const v = values.slice().sort((a, b) => a - b), n = v.length;
    const mean = v.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
    const pct = p => { const x = (n - 1) * p, i = Math.floor(x), f = x - i; return i + 1 < n ? v[i] * (1 - f) + v[i + 1] * f : v[i]; };
    return { n, mean, sd, cov: mean ? sd / mean : 0, min: v[0], max: v[n - 1], p05: pct(0.05), p50: pct(0.5), p95: pct(0.95) };
  }

  // ------------------------------------------------------------------------------- earthquake time history
  /** Synthetic ground motion: white noise through a Kanai–Tajimi filter, Jennings-type envelope, scaled to PGA (g). */
  function syntheticQuake(o) {
    o = Object.assign({ pga: 0.3, duration: 20, dt: 0.01, seed: 7, fg: 2.5, zg: 0.6 }, o || {});
    const rng = mulberry32(o.seed), n = Math.round(o.duration / o.dt) + 1, wg = 2 * Math.PI * o.fg;
    const gauss = () => { let u = 0, v = 0; while (u === 0) u = rng(); v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    let x = 0, xd = 0; const a = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const w = gauss() / Math.sqrt(o.dt);
      const xdd = -2 * o.zg * wg * xd - wg * wg * x - w;     // filter: ẍ + 2ζgωg ẋ + ωg² x = −w
      xd += xdd * o.dt; x += xd * o.dt;
      const t = i * o.dt, env = t < 2 ? (t / 2) ** 2 : t < 10 ? 1 : Math.exp(-0.35 * (t - 10));
      a[i] = (-2 * o.zg * wg * xd - wg * wg * x) * env;       // absolute ground acceleration = −(2ζgωg ẋ + ωg² x)
    }
    let pk = 0; a.forEach(v => { pk = Math.max(pk, Math.abs(v)); });
    for (let i = 0; i < n; i++) a[i] *= o.pga / (pk || 1);
    a[0] = 0;
    return { dt: o.dt, a: Array.from(a), name: `Synthetic earthquake (Kanai–Tajimi), PGA ${o.pga} g` };
  }
  function harmonicMotion(o) {
    o = Object.assign({ amp: 0.05, f: 2, duration: 10, dt: 0.005 }, o || {});
    const n = Math.round(o.duration / o.dt) + 1, a = [];
    for (let i = 0; i < n; i++) a.push(o.amp * Math.sin(2 * Math.PI * o.f * i * o.dt));
    return { dt: o.dt, a, name: `Harmonic ground motion, ${o.amp} g at ${(+o.f).toFixed(2)} Hz` };
  }
  /** Parse a CSV/text record: two columns (t, a in g) or one column (a in g) with dt given. */
  function parseRecord(text, dtGiven) {
    const rows = text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^[#a-df-z]/i.test(s)).map(s => s.split(/[,;\s]+/).map(Number).filter(Number.isFinite));
    if (!rows.length) throw new Error("No numbers found in the record");
    if (rows[0].length >= 2) { const t = rows.map(r => r[0]), a = rows.map(r => r[1]); const dt = (t[t.length - 1] - t[0]) / (t.length - 1); return { dt, a: t[0] > 0 ? [0, ...a] : a, name: "Imported record" }; }
    const a = rows.flat(); if (!(dtGiven > 0)) throw new Error("Give the time step for a single-column record"); return { dt: dtGiven, a: [0, ...a], name: "Imported record" };
  }

  function timeHistory(model, opts) {
    opts = opts || {};
    const st = model.settings || {};
    const base = clone(model); base.nodeLoads = (model.nodeLoads || []).filter(l => l.pat === "G"); base.memberLoads = (model.memberLoads || []).filter(l => l.pat === "G" && l.kind !== "thermal" && l.kind !== "misfit");
    const A = S.prepare(base, opts);
    const md = Dyn.massData(base, A, { massFromLoads: opts.massFromLoads !== undefined ? opts.massFromLoads : st.massFromLoads !== false, selfMass: opts.selfMass });
    const lumped = opts.lumped !== undefined ? opts.lumped : st.massType === "lumped";
    const Mf = Dyn.massMatrix(A, md, lumped);
    const { K } = S.assemble(A, new Float64Array(A.ndof), A.hinges0, 0, 0, true);
    const free = A.free, n = free.length;
    const Kff = LA.sub(K, free, free), Mff = LA.sub(Mf, free, free);
    const rec = opts.record || syntheticQuake();
    const dt = rec.dt, ag = rec.a.map(v => v * G_ACC), N = ag.length;
    const dir = opts.dir === "y" ? 1 : 0;
    const r = free.map(d => d % 3 === dir ? 1 : 0);
    const Mr = LA.matvec(Mff, Float64Array.from(r));
    // Rayleigh damping from modes 1 and 2 (or ζ = 0)
    const zeta = opts.zeta === undefined ? (st.zeta === undefined ? 0.05 : +st.zeta) : +opts.zeta;
    const modal = Dyn.modal(base, { ...opts, lumped, nmodes: 3 });
    if (modal.unstable) return { kind: "th", A, unstable: true, mode: modal.mode, warnings: A.warn.slice() };
    const w1 = modal.modes[0] ? modal.modes[0].omega : 1, w2 = modal.modes[1] ? modal.modes[1].omega : 3 * w1;
    const a0 = zeta * 2 * w1 * w2 / (w1 + w2), a1 = zeta * 2 / (w1 + w2);
    const C = LA.zeros(n); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) C[i][j] = a0 * Mff[i][j] + a1 * Kff[i][j];
    // Newmark average acceleration (γ = 1/2, β = 1/4)
    const gam = 0.5, bet = 0.25;
    const c1 = 1 / (bet * dt * dt), c2 = gam / (bet * dt), c3 = 1 / (bet * dt), c4 = 1 / (2 * bet) - 1, c5 = gam / bet - 1, c6 = dt * (gam / (2 * bet) - 1);
    const Kh = LA.zeros(n); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Kh[i][j] = Kff[i][j] + c1 * Mff[i][j] + c2 * C[i][j];
    const L = LA.cholesky(Kh, 1e-14);
    if (!L) throw new Error("The effective stiffness is not positive definite");
    let u = new Float64Array(n), v = new Float64Array(n), a = new Float64Array(n);
    // control DOF: top node in the excitation direction (largest |φ1| participation)
    const phi1 = modal.modes[0] ? modal.modes[0].mode : null;
    let ctrl = free.find(d => d % 3 === dir) || 0, best = -1;
    if (phi1) for (let k = 0; k < A.nOrig; k++) { const d = 3 * k + dir; if (free.includes(d) && Math.abs(phi1[d]) > best) { best = Math.abs(phi1[d]); ctrl = d; } }
    const ci = free.indexOf(ctrl);
    const supportX = A.fixedList.filter(d => d % 3 === dir && d < 3 * A.nOrig);
    const frames = Math.min(N, opts.frames || 360), every = Math.max(1, Math.floor(N / frames));
    const tH = [], ctrlH = [], shearH = [], uH = [], frameT = [];
    let peak = { u: 0, t: 0 }, peakV = { v: 0, t: 0 };
    const full = new Float64Array(A.ndof);
    const levels = levelNodes(A);
    const drift = levels.slice(1).map(() => 0);
    for (let i = 0; i < N; i++) {
      if (i > 0) {
        const p = new Float64Array(n);
        for (let k = 0; k < n; k++) p[k] = -Mr[k] * ag[i];
        const tm = new Float64Array(n), tc = new Float64Array(n);
        for (let k = 0; k < n; k++) { tm[k] = c1 * u[k] + c3 * v[k] + c4 * a[k]; tc[k] = c2 * u[k] + c5 * v[k] + c6 * a[k]; }
        const pm = LA.matvec(Mff, tm), pc = LA.matvec(C, tc);
        for (let k = 0; k < n; k++) p[k] += pm[k] + pc[k];
        const un = LA.backSubT(L, LA.forwardSub(L, p));
        const vn = new Float64Array(n), an = new Float64Array(n);
        for (let k = 0; k < n; k++) { vn[k] = c2 * (un[k] - u[k]) + (1 - gam / bet) * v[k] + dt * (1 - gam / (2 * bet)) * a[k]; an[k] = c1 * (un[k] - u[k]) - c3 * v[k] - c4 * a[k]; }
        u = un; v = vn; a = an;
      }
      full.fill(0); free.forEach((d, k) => { full[d] = u[k]; });
      let Vb = 0; supportX.forEach(d => { let s = 0; const row = K[d]; for (let j = 0; j < A.ndof; j++) s += row[j] * full[j]; Vb += s; });
      const t = i * dt;
      tH.push(t); ctrlH.push(u[ci]); shearH.push(-Vb);
      if (Math.abs(u[ci]) > Math.abs(peak.u)) peak = { u: u[ci], t };
      if (Math.abs(Vb) > Math.abs(peakV.v)) peakV = { v: -Vb, t };
      for (let k = 1; k < levels.length; k++) { const d = (avgLevel(levels[k], full, dir) - avgLevel(levels[k - 1], full, dir)) / (levels[k].y - levels[k - 1].y); drift[k - 1] = Math.max(drift[k - 1], Math.abs(d)); }
      if (i % every === 0 || i === N - 1) { uH.push(Float64Array.from(full)); frameT.push(t); }
    }
    return { kind: "th", A, record: rec, tH, ag: rec.a, ctrl, ctrlH, shearH, uH, lamH: frameT, frameT, peak, peakV, zeta, a0, a1, w1, w2, modal,
      levels, drift, dir, g: 0, lam: 0, u: uH[uH.length - 1], warnings: A.warn.slice(), det: S.determinacy(A) };
  }
  function levelNodes(A) {
    const ys = [...new Set(A.X.slice(0, A.nOrig).map(p => +p[1].toFixed(6)))].sort((a, b) => a - b);
    return ys.map(y => ({ y, nodes: A.X.slice(0, A.nOrig).map((p, i) => (Math.abs(p[1] - y) < 1e-6 ? i : -1)).filter(i => i >= 0) }));
  }
  const avgLevel = (lv, u, dir) => lv.nodes.reduce((s, n) => s + u[3 * n + dir], 0) / lv.nodes.length;

  const Adv = { influenceLine, combinations, combinedModel, activeCombos, loadCase, CASES, DEFAULT_COMBOS, aiscCheck, corrosionSample, stats, mulberry32,
    syntheticQuake, harmonicMotion, parseRecord, timeHistory, G_ACC };
  if (isNode) module.exports = Adv; else root.Adv = Adv;
})(typeof self !== "undefined" ? self : this);
