/* Frame2D Studio - modal analysis and moving loads.
 *
 * Modal:   [K]ff {φ} = ω² [M]ff {φ}, consistent or lumped mass (McGuire et al., 2000; Clough & Penzien).
 *          Mass from member self-weight (ρA), nodal masses and, optionally, constant (gravity) loads / g.
 *          Solved as [L]⁻¹[M][L]⁻ᵀ {y} = (1/ω²){y} with [K]ff = [L][L]ᵀ.
 * Moving:  linear analysis repeated for each position of an axle group travelling along a chain of
 *          members; force envelopes, reaction and displacement histories (influence-line approach).
 * Units: kN, m, t (tonne = kN·s²/m), s.
 */
(function (root) {
  "use strict";
  const LA = (typeof module !== "undefined" && module.exports) ? require("./linalg.js") : root.LA;
  const S = (typeof module !== "undefined" && module.exports) ? require("./solver.js") : root.Solver;
  const G_ACC = 9.80665;

  // ------------------------------------------------------------------------------------ mass
  /** Mass per unit length of every element and lumped nodal masses. */
  function massData(model, A, opts) {
    const st = model.settings || {};
    const selfMass = opts.selfMass !== undefined ? opts.selfMass : st.selfMass !== false;
    const fromLoads = opts.massFromLoads !== undefined ? opts.massFromLoads : st.massFromLoads !== false;
    const mpl = A.els.map(el => selfMass ? (el.rho || 0) * el.A : 0);
    const nodal = new Float64Array(A.X.length);
    for (const m of model.masses || []) if (m.node >= 0 && m.node < A.nOrig) nodal[m.node] += +m.m || 0;
    if (fromLoads) {
      for (const l of model.nodeLoads || []) if (l.pat === "G" && l.node < A.nOrig) nodal[l.node] += Math.hypot(+l.fx || 0, +l.fy || 0) / G_ACC;
      A.els.forEach((el, e) => {
        for (const ld of el.loadsG) {
          if (ld.type === "pt") {
            const P = Math.hypot(ld.px, ld.py) / G_ACC, t = ld.a / el.L0;
            nodal[el.i] += P * (1 - t); nodal[el.j] += P * t;
          } else {
            const w = (Math.hypot(ld.qx1, ld.qy1) + Math.hypot(ld.qx2, ld.qy2)) / 2 / G_ACC;
            mpl[e] += w * (ld.x2 - ld.x1) / el.L0;   // spread over the element
          }
        }
      });
    }
    return { mpl, nodal, selfMass, fromLoads };
  }

  /** Global mass matrix (consistent or lumped). */
  function massMatrix(A, md, lumped) {
    const n = A.ndof, M = LA.zeros(n);
    A.els.forEach((el, e) => {
      const m = md.mpl[e] * el.L0, L = el.L0;
      let ml;
      if (lumped || el.truss) {
        if (lumped) ml = [[m / 2, 0, 0, 0, 0, 0], [0, m / 2, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, m / 2, 0, 0], [0, 0, 0, 0, m / 2, 0], [0, 0, 0, 0, 0, 0]];
        else { const a = m / 3, b = m / 6; ml = [[a, 0, 0, b, 0, 0], [0, a, 0, 0, b, 0], [0, 0, 0, 0, 0, 0], [b, 0, 0, a, 0, 0], [0, b, 0, 0, a, 0], [0, 0, 0, 0, 0, 0]]; }
      } else {
        const r = m / 420, ax = m / 6;
        ml = [[2 * ax, 0, 0, ax, 0, 0],
          [0, 156 * r, 22 * L * r, 0, 54 * r, -13 * L * r],
          [0, 22 * L * r, 4 * L * L * r, 0, 13 * L * r, -3 * L * L * r],
          [ax, 0, 0, 2 * ax, 0, 0],
          [0, 54 * r, 13 * L * r, 0, 156 * r, -22 * L * r],
          [0, -13 * L * r, -3 * L * L * r, 0, -22 * L * r, 4 * L * L * r]];
      }
      const mg = LA.btab(S.gammaMatrix(el.c0, el.s0n), ml);
      const d = S.elemDofs(el);
      for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) M[d[a]][d[b]] += mg[a][b];
    });
    md.nodal.forEach((m, k) => { M[3 * k][3 * k] += m; M[3 * k + 1][3 * k + 1] += m; });
    return M;
  }

  /** Natural frequencies and mode shapes with modal participation. */
  function modal(model, opts) {
    opts = opts || {};
    const st = model.settings || {};
    const A = S.prepare(model, opts);
    const lumped = opts.lumped !== undefined ? opts.lumped : st.massType === "lumped";
    const md = massData(model, A, opts);
    const hinges = A.hinges0.map(h => h.slice());
    const { K } = S.assemble(A, new Float64Array(A.ndof), hinges, 0, 0, true);
    const M = massMatrix(A, md, lumped);
    const free = A.free, n = free.length;
    const res = { kind: "modal", A, M, K, lumped, md, warnings: A.warn.slice(), det: S.determinacy(A), g: 0, lam: 0 };
    const Kff = LA.sub(K, free, free), Mff = LA.sub(M, free, free);
    const L = LA.cholesky(Kff, 1e-11);
    if (!L) { const lin = S.linear(model, { ...opts, A }); return { ...res, unstable: true, mode: lin.mode }; }
    // C = L^-1 M L^-T
    const X = LA.zeros(n);
    for (let j = 0; j < n; j++) { const col = new Float64Array(n); for (let i = 0; i < n; i++) col[i] = Mff[i][j]; const y = LA.forwardSub(L, col); for (let i = 0; i < n; i++) X[i][j] = y[i]; }
    const C = LA.zeros(n);
    for (let j = 0; j < n; j++) { const col = new Float64Array(n); for (let i = 0; i < n; i++) col[i] = X[j][i]; const y = LA.forwardSub(L, col); for (let i = 0; i < n; i++) C[i][j] = y[i]; }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const v = 0.5 * (C[i][j] + C[j][i]); C[i][j] = v; C[j][i] = v; }
    const eg = LA.eigSym(C);
    let mx = 0; for (const v of eg.values) mx = Math.max(mx, Math.abs(v));
    // influence vectors and total mass (free DOFs)
    const rx = free.map(d => d % 3 === 0 ? 1 : 0), ry = free.map(d => d % 3 === 1 ? 1 : 0);
    const Mr = r => LA.matvec(Mff, Float64Array.from(r));
    const Mrx = Mr(rx), Mry = Mr(ry);
    const totX = LA.dot(rx, Mrx), totY = LA.dot(ry, Mry);
    const nmodes = Math.min(opts.nmodes || st.nmodes || 6, n);
    const modes = [];
    for (let k = eg.values.length - 1; k >= 0 && modes.length < nmodes; k--) {
      const mu = eg.values[k];
      if (mu <= 1e-12 * mx) break;
      const phiF = LA.backSubT(L, eg.vectors[k]);
      const Mphi = LA.matvec(Mff, phiF), gm = LA.dot(phiF, Mphi);
      const Lx = LA.dot(phiF, Mrx), Ly = LA.dot(phiF, Mry);
      const omega = 1 / Math.sqrt(mu);
      const phi = new Float64Array(A.ndof); free.forEach((d, i) => { phi[d] = phiF[i]; });
      modes.push({ omega, f: omega / (2 * Math.PI), T: 2 * Math.PI / omega, mode: S.normalizeMode(phi),
        effX: totX > 0 ? Lx * Lx / gm / totX : 0, effY: totY > 0 ? Ly * Ly / gm / totY : 0 });
    }
    const total = md.mpl.reduce((s, m, e) => s + m * A.els[e].L0, 0) + md.nodal.reduce((a, b) => a + b, 0);
    return { ...res, modes, mode: modes.length ? modes[0].mode : null, f1: modes.length ? modes[0].f : null, totalMass: total, massX: totX, massY: totY };
  }

  // ------------------------------------------------------------------------------------ moving load
  /** Ordered chain geometry of the path members: [{member, forward, s0, L}] and total length. */
  function pathGeometry(model, path) {
    const segs = [];
    if (!path || !path.length) throw new Error("Choose the members the load travels along");
    const ms = path.map(i => { const q = model.members[i]; if (!q) throw new Error(`Member ${i + 1} does not exist`); return q; });
    let node;
    if (ms.length === 1) node = ms[0].i;
    else { const a = ms[0], b = ms[1]; node = (a.j === b.i || a.j === b.j) ? a.i : a.j; }
    let s = 0;
    ms.forEach((q, k) => {
      const forward = q.i === node;
      if (!forward && q.j !== node) throw new Error(`Path members must connect end to end (member ${path[k] + 1})`);
      const a = model.nodes[q.i], b = model.nodes[q.j], L = Math.hypot(b.x - a.x, b.y - a.y);
      segs.push({ member: path[k], forward, s0: s, L });
      s += L; node = forward ? q.j : q.i;
    });
    return { segs, length: s };
  }

  function parseAxles(txtP, txtD) {
    const P = String(txtP || "100").split(/[,; ]+/).map(Number).filter(v => Number.isFinite(v) && v !== 0);
    const D = String(txtD || "").split(/[,; ]+/).map(Number).filter(Number.isFinite);
    let d = 0;
    return P.map((p, k) => { if (k > 0) d += D[k - 1] !== undefined ? D[k - 1] : D[D.length - 1] || 0; return { P: p, d }; });
  }

  /** Put the axle loads for front-axle position s onto the analysis model A. Returns active axles. */
  function applyPosition(A, geo, axles, s) {
    A.els.forEach(el => { el.loadsR = []; el.loadsG = []; el.qR = new Float64Array(6); el.qG = new Float64Array(6); });
    A.Pr.fill(0); A.P0.fill(0);
    const active = [];
    for (const ax of axles) {
      const p = s - ax.d;
      if (p < -1e-9 || p > geo.length + 1e-9) continue;
      const seg = geo.segs.find(g => p >= g.s0 - 1e-9 && p <= g.s0 + g.L + 1e-9);
      if (!seg) continue;
      const along = Math.min(Math.max(p - seg.s0, 0), seg.L), a = seg.forward ? along : seg.L - along;
      const els = A.memberEls[seg.member];
      if (!els || !els.length) continue;   // member removed
      let e = els.find(k => a >= A.els[k].s0 - 1e-9 && a <= A.els[k].s0 + A.els[k].L0 + 1e-9);
      if (e === undefined) e = els[els.length - 1];
      const el = A.els[e];
      // gravity-direction axle load (global −y)
      el.loadsR.push({ type: "pt", a: Math.min(Math.max(a - el.s0, 0), el.L0), px: el.s0n * -ax.P, py: el.c0 * -ax.P });
      active.push({ P: ax.P, s: p, member: seg.member, a });
    }
    A.els.forEach(el => { if (el.loadsR.length) { el.qR = S.equivalentLoads(el.L0, el.loadsR); S.addElemLoad(A, el, el.qR, A.Pr); } });
    return active;
  }

  function movingLoad(model, opts) {
    opts = opts || {};
    const st = model.settings || {};
    const base = JSON.parse(JSON.stringify(model, (k, v) => (k === "references" || k === "study") ? undefined : v));
    base.nodeLoads = []; base.memberLoads = [];
    const A = S.prepare(base, opts);
    A.presc.fill(0);   // live load only: no support settlement
    const path = opts.path || st.path || [];
    const geo = pathGeometry(model, path);
    const axles = opts.axles || parseAxles(st.axleLoads, st.axleSpacing);
    if (!axles.length) throw new Error("Enter at least one axle load");
    const span = axles[axles.length - 1].d;
    const nstep = Math.max(10, Math.min(1000, Math.round(opts.positions || st.positions || 120)));
    const ds = (geo.length + span) / nstep;
    const NS = 16;
    const env = A.els.map(el => ({ x: Array.from({ length: NS + 1 }, (_, k) => el.L0 * k / NS), Mmax: new Float64Array(NS + 1).fill(-Infinity), Mmin: new Float64Array(NS + 1).fill(Infinity), Vmax: new Float64Array(NS + 1).fill(-Infinity), Vmin: new Float64Array(NS + 1).fill(Infinity), Nmax: new Float64Array(NS + 1).fill(-Infinity), Nmin: new Float64Array(NS + 1).fill(Infinity) }));
    const posH = [], uH = [], loadsH = [], reacH = [], axH = [];
    let maxM = { v: 0 }, minM = { v: 0 }, unstable = false;
    for (let k = 0; k <= nstep; k++) {
      const s = k * ds;
      const active = applyPosition(A, geo, axles, s);
      const r = S.linear(base, { ...opts, A, g: 0, lam: 1 });
      if (r.unstable) { unstable = true; break; }
      posH.push(s); uH.push(Float64Array.from(r.u)); axH.push(active);
      loadsH.push(A.els.map(el => el.loadsR.slice()));
      reacH.push(new Map(r.reactions.map(q => [q.dof, q.value])));
      A.els.forEach((el, e) => {
        const fn = S.fieldFn(el, r.infos[e], el.loadsR, el.qR), E = env[e];
        for (let i = 0; i <= NS; i++) {
          const x = Math.min(Math.max(E.x[i], 1e-9), el.L0 - 1e-9), v = fn(x);
          if (v.M > E.Mmax[i]) E.Mmax[i] = v.M; if (v.M < E.Mmin[i]) E.Mmin[i] = v.M;
          if (v.V > E.Vmax[i]) E.Vmax[i] = v.V; if (v.V < E.Vmin[i]) E.Vmin[i] = v.V;
          if (v.N > E.Nmax[i]) E.Nmax[i] = v.N; if (v.N < E.Nmin[i]) E.Nmin[i] = v.N;
          if (v.M > maxM.v) maxM = { v: v.M, member: el.parent, s, x: el.s0 + E.x[i] };
          if (v.M < minM.v) minM = { v: v.M, member: el.parent, s, x: el.s0 + E.x[i] };
        }
      });
    }
    if (unstable) { const lin = S.linear(base, opts); return { kind: "moving", A, unstable: true, mode: lin.mode, warnings: A.warn.slice() }; }
    // control DOF: largest vertical displacement anywhere along the path history
    let ctrl = 1, best = -1;
    uH.forEach(u => { for (let d = 1; d < A.ndof; d += 3) if (Math.abs(u[d]) > best && d < 3 * A.nOrig) { best = Math.abs(u[d]); ctrl = d; } });
    if (opts.ctrlNode !== undefined && opts.ctrlNode >= 0) ctrl = 3 * opts.ctrlNode + (opts.ctrlDir || 1);
    const reactions = A.fixedList.filter(d => d < 3 * A.nOrig).map(d => ({ dof: d, hist: reacH.map(m => m.get(d) || 0) }));
    reactions.forEach(r => { r.max = Math.max(...r.hist); r.min = Math.min(...r.hist); });
    const res = { kind: "moving", A, base, geo, axles, posH, uH, loadsH, axH, env, reactions, ctrl, ctrlH: uH.map(u => u[ctrl]), maxM, minM,
      lamH: posH, g: 0, lam: 1, warnings: A.warn.slice(), det: S.determinacy(A) };
    res.u = uH[uH.length - 1];
    res.peakDisp = Math.max(1e-12, ...uH.map(u => { let m = 0; for (let n = 0; n < A.X.length; n++) m = Math.max(m, Math.hypot(u[3 * n], u[3 * n + 1])); return m; }));
    return res;
  }

  /** Infos for step k of a moving-load result (restores that step's loads on the analysis model). */
  function movingState(res, k) {
    const A = res.A;
    A.els.forEach((el, e) => { el.loadsR = res.loadsH[k][e]; el.loadsG = []; el.qR = S.equivalentLoads(el.L0, el.loadsR); el.qG = new Float64Array(6); });
    A.Pr.fill(0); A.P0.fill(0); A.els.forEach(el => { if (el.loadsR.length) S.addElemLoad(A, el, el.qR, A.Pr); });
    const { F, infos } = S.assemble(A, res.uH[k], A.hinges0, 0, 1, true);
    return { u: res.uH[k], infos, F, lam: 1, hinges: A.hinges0, axles: res.axH[k], pos: res.posH[k] };
  }

  const Dyn = { modal, massMatrix, massData, movingLoad, movingState, pathGeometry, parseAxles, applyPosition, G_ACC };
  if (typeof module !== "undefined" && module.exports) module.exports = Dyn; else root.Dyn = Dyn;
})(typeof self !== "undefined" ? self : this);
