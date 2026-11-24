/* Frame2D Studio - matrix structural analysis kernel for plane frames and trusses.
 *
 * JavaScript port of frame2d/core.py (the Python reference solver in /python), extended with
 * general member loads, truss members, element subdivision and the intermediate matrices used
 * by the "Method" and "Checks" panels.
 *
 * Notation follows McGuire, Gallagher & Ziemian, Matrix Structural Analysis, 2nd ed. (2000):
 *   local element DOFs {Δ'} = [u1 v1 θ1 u2 v2 θ2]^T, [k] = [Γ]^T [k'] [Γ]   (Ch. 4-5)
 *   {P} = [K]{Δ},  [K]ff {Δ}f = {P}f - [K]fs {Δ}s                         (Ch. 3)
 *   equivalent nodal loads {F}d = ∫ [N]^T q dx                              (Sec. 7.5)
 *   incremental Newton-Raphson, corotational element                       (Ch. 12)
 *   elastic critical load ([K]e + λ[K]g){Δ} = 0                            (Sec. 12.8)
 *   concentrated plastic hinges, Mp = σy Z                                  (Ch. 10)
 * Units: any consistent set; the GUI uses kN and m.
 */
(function (root) {
  "use strict";
  const LA = (typeof module !== "undefined" && module.exports) ? require("./linalg.js") : root.LA;
  const { zeros, vec } = LA;

  // ------------------------------------------------------------------------------------------
  // Shape functions (Hermitian cubic for bending, linear for axial)
  // ------------------------------------------------------------------------------------------
  function shape(x, L) {
    const t = x / L;
    return [1 - t, 1 - 3 * t * t + 2 * t ** 3, L * (t - 2 * t * t + t ** 3), t, 3 * t * t - 2 * t ** 3, L * (-t * t + t ** 3)];
  }
  const GP = [[-Math.sqrt(3 / 5), 5 / 9], [0, 8 / 9], [Math.sqrt(3 / 5), 5 / 9]];

  /** Work-equivalent nodal loads (local, fixed-fixed element) for a list of local loads. */
  function equivalentLoads(L, loads) {
    const q = new Float64Array(6);
    for (const ld of loads) {
      if (ld.type === "strain") continue;
      if (ld.type === "pt") {
        const N = shape(ld.a, L);
        q[0] += N[0] * ld.px; q[3] += N[3] * ld.px;
        q[1] += N[1] * ld.py; q[2] += N[2] * ld.py; q[4] += N[4] * ld.py; q[5] += N[5] * ld.py;
      } else {
        const h = (ld.x2 - ld.x1) / 2, m = (ld.x1 + ld.x2) / 2;
        if (h <= 0) continue;
        for (const [g, w] of GP) {
          const x = m + g * h, r = (x - ld.x1) / (ld.x2 - ld.x1);
          const qx = ld.qx1 + (ld.qx2 - ld.qx1) * r, qy = ld.qy1 + (ld.qy2 - ld.qy1) * r;
          const N = shape(x, L), f = w * h;
          q[0] += f * N[0] * qx; q[3] += f * N[3] * qx;
          q[1] += f * N[1] * qy; q[2] += f * N[2] * qy; q[4] += f * N[4] * qy; q[5] += f * N[5] * qy;
        }
      }
    }
    return q;
  }

  /** Coordinate transformation [Γ] (6x6), {Δ'} = [Γ]{Δ}. */
  function gammaMatrix(c, s) {
    const G = zeros(6);
    for (const o of [0, 3]) { G[o][o] = c; G[o][o + 1] = s; G[o + 1][o] = -s; G[o + 1][o + 1] = c; G[o + 2][o + 2] = 1; }
    return G;
  }

  // ------------------------------------------------------------------------------------------
  // Model preparation: user model -> analysis model (subdivision, DOFs, loads)
  // ------------------------------------------------------------------------------------------
  function sectionOf(model, m) {
    const s = model.sections[m.sec];
    if (!s) throw new Error(`Member ${model.members.indexOf(m) + 1} uses a missing section`);
    const f = m.factor && m.factor > 0 ? m.factor : 1;
    return { E: s.E, A: s.A * f, I: s.I * f, Z: (s.Z || 0) * f, fy: s.fy || 0, As: (+s.As || 0) * f, nu: s.nu === undefined || s.nu === null || s.nu === "" ? 0.3 : +s.nu, name: s.name, rho: (s.rho === undefined || s.rho === null || s.rho === "") ? (s.E >= 1e8 ? 7.85 : 2.4) : +s.rho };
  }

  function localComponents(dir, val, c, s) {
    if (dir === "GX") return [c * val, -s * val];
    if (dir === "GY") return [s * val, c * val];
    if (dir === "axial") return [val, 0];
    return [0, val]; // local y (perpendicular)
  }

  /** Convert user member loads to local loads on a member of length L. Returns {G:[...], R:[...]} */
  function memberLocalLoads(model, mi, L, c, s, warn) {
    const out = { G: [], R: [] };
    for (const ld of model.memberLoads || []) {
      if (ld.member !== mi) continue;
      const pat = ld.pat === "G" ? "G" : "R";
      if (ld.kind === "thermal") {
        // uniform change dT and gradient dTg = T(top, local +y) − T(bottom) over depth h
        const alpha = ld.alpha === undefined || ld.alpha === null || ld.alpha === "" ? 1.2e-5 : +ld.alpha;
        const h = +ld.h || 0, dTg = +ld.dTg || 0;
        out[pat].push({ type: "strain", e0: alpha * (+ld.dT || 0), k0: h > 0 ? -alpha * dTg / h : 0, src: "thermal" });
        continue;
      }
      if (ld.kind === "misfit") {
        // member fabricated too long by dL (positive) or too short (negative)
        out[pat].push({ type: "strain", e0: (+ld.dL || 0) / L, k0: 0, src: "misfit" });
        continue;
      }
      if (ld.kind === "point") {
        const a = +ld.a || 0;
        if (a < -1e-9 || a > L + 1e-9) { warn.push(`Point load on member ${mi + 1} lies outside the member`); continue; }
        const [px, py] = localComponents(ld.dir, +ld.P || 0, c, s);
        out[pat].push({ type: "pt", a: Math.min(Math.max(a, 0), L), px, py });
      } else {
        const x1 = Math.max(0, +ld.a || 0), x2 = Math.min(L, (ld.b === null || ld.b === undefined || ld.b === "") ? L : +ld.b);
        if (x2 <= x1) { warn.push(`Distributed load on member ${mi + 1} has an empty range`); continue; }
        const w1 = +ld.w1 || 0, w2 = (ld.w2 === null || ld.w2 === undefined || ld.w2 === "") ? w1 : +ld.w2;
        const [qx1, qy1] = localComponents(ld.dir, w1, c, s), [qx2, qy2] = localComponents(ld.dir, w2, c, s);
        out[pat].push({ type: "dist", x1, x2, qx1, qy1, qx2, qy2 });
      }
    }
    return out;
  }

  /** Restrict a member load list to the sub-element [s0, s1] and shift to element coordinates. */
  function sliceLoads(loads, s0, s1, isLast) {
    const out = [];
    for (const ld of loads) {
      if (ld.type === "strain") { out.push({ ...ld }); continue; }
      if (ld.type === "pt") {
        if ((ld.a >= s0 - 1e-12 && ld.a < s1 - 1e-12) || (isLast && Math.abs(ld.a - s1) < 1e-9)) out.push({ ...ld, a: ld.a - s0 });
      } else {
        const a = Math.max(ld.x1, s0), b = Math.min(ld.x2, s1);
        if (b - a <= 1e-12) continue;
        const f = x => (x - ld.x1) / (ld.x2 - ld.x1);
        out.push({ type: "dist", x1: a - s0, x2: b - s0,
          qx1: ld.qx1 + (ld.qx2 - ld.qx1) * f(a), qx2: ld.qx1 + (ld.qx2 - ld.qx1) * f(b),
          qy1: ld.qy1 + (ld.qy2 - ld.qy1) * f(a), qy2: ld.qy1 + (ld.qy2 - ld.qy1) * f(b) });
      }
    }
    return out;
  }

  /**
   * Build the analysis model.
   * opts.nsub      : elements per frame member (truss members are never subdivided)
   * opts.removed   : Set of member indices removed (damage scenarios)
   * opts.factors   : Map member index -> stiffness/strength factor (strengthening)
   * opts.allRef    : treat every load as reference load (used by buckling)
   */
  function prepare(model, opts) {
    opts = opts || {};
    const warn = [];
    const nsub = Math.max(1, Math.min(32, Math.round(opts.nsub || (model.settings && model.settings.nsub) || 1)));
    const X = model.nodes.map(n => [+n.x, +n.y]);
    const nOrig = X.length;
    const els = [];
    const memberEls = [];
    model.members.forEach((m, mi) => {
      memberEls.push([]);
      const removed = (opts.removed && opts.removed.has(mi)) || m.removed;
      if (removed) return;
      if (m.i === m.j || m.i < 0 || m.j < 0 || m.i >= nOrig || m.j >= nOrig) { warn.push(`Member ${mi + 1} has invalid end nodes`); return; }
      const [xi, yi] = X[m.i], [xj, yj] = X[m.j];
      const Lm = Math.hypot(xj - xi, yj - yi);
      if (Lm < 1e-9) { warn.push(`Member ${mi + 1} has zero length`); return; }
      const c = (xj - xi) / Lm, s = (yj - yi) / Lm;
      let sec = sectionOf(model, m);
      if (opts.factors && opts.factors.has(mi)) {
        const f = opts.factors.get(mi); sec = { ...sec, A: sec.A * f, I: sec.I * f, Z: sec.Z * f };
      }
      const truss = m.type === "truss";
      const n = truss ? 1 : nsub;
      const loads = memberLocalLoads(model, mi, Lm, c, s, warn);
      if (truss && (loads.G.length || loads.R.length)) {
        const hasTransverse = [...loads.G, ...loads.R].some(l => (l.type === "strain" ? l.k0 : l.type === "pt" ? l.py : (l.qy1 || l.qy2)));
        if (hasTransverse) warn.push(`Member ${mi + 1} is a truss member: transverse member loads are carried to its end nodes as simple-beam reactions`);
      }
      let prev = m.i;
      for (let k = 0; k < n; k++) {
        let next;
        if (k === n - 1) next = m.j;
        else { next = X.length; X.push([xi + (xj - xi) * (k + 1) / n, yi + (yj - yi) * (k + 1) / n]); }
        const s0 = Lm * k / n, s1 = Lm * (k + 1) / n;
        const el = {
          i: prev, j: next, parent: mi, k, nsub: n, s0, L0: s1 - s0, c0: c, s0n: s, a0: Math.atan2(s, c),
          E: sec.E, A: sec.A, I: truss ? Math.max(sec.I, 0) : sec.I, Z: sec.Z, fy: sec.fy, rho: sec.rho, truss,
          relI: truss || (k === 0 && !!m.relI), relJ: truss || (k === n - 1 && !!m.relJ),
          loadsG: sliceLoads(loads.G, s0, s1, k === n - 1), loadsR: sliceLoads(loads.R, s0, s1, k === n - 1)
        };
        // semi-rigid connection springs (kN·m/rad) at the member's own ends
        el.kI = !truss && k === 0 && !m.relI && +m.kI > 0 ? +m.kI : 0;
        el.kJ = !truss && k === n - 1 && !m.relJ && +m.kJ > 0 ? +m.kJ : 0;
        // shear deformation (Timoshenko): φ = 12EI/(G As L²)
        const useShear = !(model.settings && model.settings.shear === false);
        el.GAs = useShear && !truss && sec.As > 0 ? sec.E / (2 * (1 + sec.nu)) * sec.As : 0;
        el.phi = el.GAs > 0 ? 12 * sec.E * el.I / (el.GAs * el.L0 * el.L0) : 0;
        el.qG = elementQ(el, el.loadsG); el.qR = elementQ(el, el.loadsR);
        el.e0G = strainSum(el.loadsG, "e0"); el.e0R = strainSum(el.loadsR, "e0");
        els.push(el); memberEls[mi].push(els.length - 1);
        prev = next;
      }
    });

    const nn = X.length, ndof = 3 * nn;
    // supports
    const fixed = new Set(), presc = vec(ndof), springs = new Map();
    const coupled = [];
    let kref = 0; els.forEach(el => { kref = Math.max(kref, el.E * el.A / el.L0, 12 * el.E * el.I / el.L0 ** 3); });
    for (const sp of model.supports || []) {
      if (sp.node < 0 || sp.node >= nOrig) continue;
      if (sp.incline) {
        // roller on a surface inclined at β: the displacement normal to the surface is suppressed (penalty)
        const b = (+sp.angle || 0) * Math.PI / 180, nrm = [-Math.sin(b), Math.cos(b)];
        coupled.push({ node: sp.node, dofs: [3 * sp.node, 3 * sp.node + 1], n: nrm, k: 1e7 * (kref || 1), angle: +sp.angle || 0 });
        if (sp.rz) { fixed.add(3 * sp.node + 2); presc[3 * sp.node + 2] = +sp.dr || 0; }
        continue;
      }
      const flags = [sp.ux, sp.uy, sp.rz], ks = [sp.kx, sp.ky, sp.kr], ds = [sp.dx, sp.dy, sp.dr];
      for (let k = 0; k < 3; k++) {
        const d = 3 * sp.node + k;
        if (flags[k]) { fixed.add(d); presc[d] = +ds[k] || 0; }
        else if (+ks[k] > 0) springs.set(d, (springs.get(d) || 0) + (+ks[k]));
      }
    }
    // connectivity, isolated nodes and rotation DOFs without stiffness (all ends pinned)
    const conn = Array.from({ length: nn }, () => []);
    els.forEach((el, e) => { conn[el.i].push([e, 0]); conn[el.j].push([e, 1]); });
    const isolated = [], removedDofs = new Set();
    for (let n = 0; n < nn; n++) {
      if (conn[n].length === 0) {
        if (n < nOrig) isolated.push(n);
        for (let k = 0; k < 3; k++) if (!fixed.has(3 * n + k)) removedDofs.add(3 * n + k);
      }
    }
    const hinges0 = els.map(el => [el.relI ? 0 : null, el.relJ ? 0 : null]);
    const orphans = orphanRotations(nn, els, hinges0, fixed, springs);
    orphans.forEach(d => removedDofs.add(d));

    // load vectors
    const P0 = vec(ndof), Pr = vec(ndof);
    for (const ld of model.nodeLoads || []) {
      if (ld.node < 0 || ld.node >= nOrig) continue;
      const P = ld.pat === "G" ? P0 : Pr;
      P[3 * ld.node] += +ld.fx || 0; P[3 * ld.node + 1] += +ld.fy || 0; P[3 * ld.node + 2] += +ld.mz || 0;
      if ((+ld.mz || 0) !== 0 && removedDofs.has(3 * ld.node + 2)) warn.push(`Moment at node ${ld.node + 1} acts on a pin-only joint and is ignored`);
    }
    const A = { X, nOrig, els, memberEls, ndof, fixed, presc, springs, coupled, removedDofs, isolated, orphans,
      P0, Pr, hinges0, interaction: model.settings ? model.settings.interaction !== false : true, warn, nsub };
    // add equivalent nodal loads
    els.forEach(el => {
      addElemLoad(A, el, el.qG, P0);
      addElemLoad(A, el, el.qR, Pr);
    });
    if (opts.allRef) {
      for (let d = 0; d < ndof; d++) { Pr[d] += P0[d]; P0[d] = 0; }
      els.forEach(el => { el.qR = el.qR.map((v, k) => v + el.qG[k]); el.qG = new Float64Array(6); el.loadsR = [...el.loadsR, ...el.loadsG]; el.loadsG = []; });
    }
    A.free = [];
    for (let d = 0; d < ndof; d++) if (!fixed.has(d) && !removedDofs.has(d)) A.free.push(d);
    A.fixedList = [...fixed].sort((a, b) => a - b);
    return A;
  }

  const strainSum = (loads, key) => loads.reduce((s, l) => s + (l.type === "strain" ? l[key] : 0), 0);
  /** Equivalent nodal loads of an element: member loads plus the bending part of temperature gradients. */
  function elementQ(el, loads) {
    const q = equivalentLoads(el.L0, loads);
    const k0 = strainSum(loads, "k0");
    if (k0) { q[2] += -el.E * el.I * k0; q[5] += el.E * el.I * k0; }
    return q;
  }

  function addElemLoad(A, el, q, P) {
    const c = el.c0, s = el.s0n;
    const d = [3 * el.i, 3 * el.j];
    for (let e = 0; e < 2; e++) {
      const lx = q[3 * e], ly = q[3 * e + 1];
      P[d[e]] += c * lx - s * ly; P[d[e] + 1] += s * lx + c * ly; P[d[e] + 2] += q[3 * e + 2];
    }
  }

  function orphanRotations(nn, els, hinges, fixed, springs) {
    const ends = Array.from({ length: nn }, () => []);
    els.forEach((el, e) => { ends[el.i].push(hinges[e][0] !== null); ends[el.j].push(hinges[e][1] !== null); });
    const out = new Set();
    for (let n = 0; n < nn; n++) {
      const d = 3 * n + 2;
      if (ends[n].length && ends[n].every(Boolean) && !fixed.has(d) && !springs.has(d)) out.add(d);
    }
    return out;
  }

  const elemDofs = el => [3 * el.i, 3 * el.i + 1, 3 * el.i + 2, 3 * el.j, 3 * el.j + 1, 3 * el.j + 2];

  /** Current (scaled) equivalent loads of an element for load state (g, lam). */
  function elemQ(el, g, lam) { const q = new Float64Array(6); for (let k = 0; k < 6; k++) q[k] = g * el.qG[k] + lam * el.qR[k]; q.e0 = g * (el.e0G || 0) + lam * (el.e0R || 0); return q; }
  function elemLoads(el, g, lam) {
    const sc = (ld, f) => ld.type === "strain" ? { ...ld, e0: ld.e0 * f, k0: ld.k0 * f } : ld.type === "pt" ? { ...ld, px: ld.px * f, py: ld.py * f }
      : { ...ld, qx1: ld.qx1 * f, qx2: ld.qx2 * f, qy1: ld.qy1 * f, qy2: ld.qy2 * f };
    return [...el.loadsG.map(l => sc(l, g)), ...el.loadsR.map(l => sc(l, lam))];
  }

  // ------------------------------------------------------------------------------------------
  // Element routine (port of core.element): internal forces and tangent stiffness
  // ------------------------------------------------------------------------------------------
  function mpEff(el, N, interaction) {
    const Mp = el.Z * el.fy;
    const Py = el.A * el.fy;
    if (!interaction || Py <= 0) return Mp;
    const p = Math.min(Math.abs(N) / Py, 1);
    const m = p < 0.2 ? 1 - p / 2 : (9 / 8) * (1 - p);
    return Mp * Math.max(m, 0);
  }
  const wrap = a => { let r = (a + Math.PI) % (2 * Math.PI); if (r < 0) r += 2 * Math.PI; return r - Math.PI; };

  function element(A, el, ue, hinge, q, linear) {
    const L0 = el.L0, EA = el.E * el.A / L0, EI = el.E * el.I;
    let c, s, Ln, ub, th1, th2;
    if (linear) {
      c = el.c0; s = el.s0n; Ln = L0;
      const dux = ue[3] - ue[0], duy = ue[4] - ue[1];
      ub = c * dux + s * duy;
      const rot = (-s * dux + c * duy) / L0;
      th1 = ue[2] - rot; th2 = ue[5] - rot;
    } else {
      const dxn = A.X[el.j][0] - A.X[el.i][0] + ue[3] - ue[0];
      const dyn = A.X[el.j][1] - A.X[el.i][1] + ue[4] - ue[1];
      Ln = Math.hypot(dxn, dyn); c = dxn / Ln; s = dyn / Ln;
      ub = Ln - L0;
      const dal = wrap(Math.atan2(dyn, dxn) - el.a0);
      th1 = ue[2] - dal; th2 = ue[5] - dal;
    }
    const z = [-s, c];
    const a = [z[0] / Ln, z[1] / Ln, 0, -z[0] / Ln, -z[1] / Ln, 0];
    const B = [[-c, -s, 0, c, s, 0], a.slice(), a.slice()];
    B[1][2] += 1; B[2][5] += 1;
    const N = EA * (ub - (q.e0 || 0) * L0);
    const fem1 = -q[2], fem2 = -q[5];
    // bending stiffness with shear deformation (φ = 0 for Euler–Bernoulli)
    const ph = el.phi || 0;
    const k11 = EI * (4 + ph) / (L0 * (1 + ph)), k12 = EI * (2 - ph) / (L0 * (1 + ph));
    const rr = (2 - ph) / (4 + ph), kc = 12 * EI / (L0 * (4 + ph));
    const h1 = hinge[0], h2 = hinge[1];
    const target = h => h === 0 ? 0 : h * mpEff(el, N, A.interaction);
    const kb = [[EA, 0, 0], [0, 0, 0], [0, 0, 0]];
    let M1, M2;
    const sI = el.kI > 0 ? 1 / el.kI : 0, sJ = el.kJ > 0 ? 1 / el.kJ : 0;
    if (h1 === null && h2 === null) {
      if (sI || sJ) {
        // springs in series: M = (I + kb S)^-1 (kb θ + fem), elastic part Me = M − fem
        const a11 = 1 + k11 * sI, a12 = k12 * sJ, a21 = k12 * sI, a22 = 1 + k11 * sJ, det = a11 * a22 - a12 * a21;
        const i11 = a22 / det, i12 = -a12 / det, i21 = -a21 / det, i22 = a11 / det;
        const r1 = k11 * th1 + k12 * th2 + fem1, r2 = k12 * th1 + k11 * th2 + fem2;
        M1 = i11 * r1 + i12 * r2 - fem1; M2 = i21 * r1 + i22 * r2 - fem2;
        kb[1][1] = i11 * k11 + i12 * k12; kb[1][2] = i11 * k12 + i12 * k11; kb[2][1] = i21 * k11 + i22 * k12; kb[2][2] = i21 * k12 + i22 * k11;
      } else {
        M1 = k11 * th1 + k12 * th2; M2 = k12 * th1 + k11 * th2;
        kb[1][1] = k11; kb[1][2] = k12; kb[2][1] = k12; kb[2][2] = k11;
      }
    } else if (h1 !== null && h2 === null) {
      const f = 1 / (1 + kc * sJ);
      M1 = target(h1) - fem1; M2 = f * (rr * M1 + kc * th2); kb[2][2] = f * kc;
    } else if (h1 === null && h2 !== null) {
      const f = 1 / (1 + kc * sI);
      M2 = target(h2) - fem2; M1 = f * (rr * M2 + kc * th1); kb[1][1] = f * kc;
    } else {
      M1 = target(h1) - fem1; M2 = target(h2) - fem2;
    }
    const qb = [N, M1, M2];
    const f = new Float64Array(6);
    for (let k = 0; k < 6; k++) f[k] = B[0][k] * qb[0] + B[1][k] * qb[1] + B[2][k] * qb[2];
    const K = zeros(6);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      let v = 0;
      for (let p = 0; p < 3; p++) for (let r = 0; r < 3; r++) v += B[p][i] * kb[p][r] * B[r][j];
      K[i][j] = v;
    }
    if (!linear) {
      const w = [-z[0], -z[1], 0, z[0], z[1], 0];
      const r = [c, s];
      const S2 = [[2 * r[0] * z[0], r[0] * z[1] + z[0] * r[1]], [r[1] * z[0] + z[1] * r[0], 2 * r[1] * z[1]]];
      const g = (M1 + M2) / (Ln * Ln);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) K[i][j] += (N / Ln) * w[i] * w[j];
      const blocks = [[0, 0, 1], [0, 3, -1], [3, 0, -1], [3, 3, 1]];
      for (const [bi, bj, sg] of blocks) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) K[bi + i][bj + j] += g * sg * S2[i][j];
    }
    const info = { N, M1: M1 + fem1, M2: M2 + fem2, M1e: M1, M2e: M2, L0, Ln, c, s };
    return { f, K, info };
  }

  function assemble(A, u, hinges, g, lam, linear) {
    const n = A.ndof, F = vec(n), K = zeros(n), infos = [];
    A.els.forEach((el, e) => {
      const d = elemDofs(el), ue = d.map(k => u[k]);
      const { f, K: ke, info } = element(A, el, ue, hinges[e], elemQ(el, g, lam), linear);
      for (let a = 0; a < 6; a++) { F[d[a]] += f[a]; const Ka = K[d[a]]; for (let b = 0; b < 6; b++) Ka[d[b]] += ke[a][b]; }
      infos.push(info);
    });
    A.springs.forEach((k, d) => { F[d] += k * u[d]; K[d][d] += k; });
    (A.coupled || []).forEach(cs => { const [a, b] = cs.dofs; const un = cs.n[0] * u[a] + cs.n[1] * u[b];
      F[a] += cs.k * un * cs.n[0]; F[b] += cs.k * un * cs.n[1];
      K[a][a] += cs.k * cs.n[0] * cs.n[0]; K[a][b] += cs.k * cs.n[0] * cs.n[1]; K[b][a] += cs.k * cs.n[0] * cs.n[1]; K[b][b] += cs.k * cs.n[1] * cs.n[1]; });
    return { F, K, infos };
  }

  function loadVector(A, g, lam) { const P = vec(A.ndof); for (let d = 0; d < A.ndof; d++) P[d] = g * A.P0[d] + lam * A.Pr[d]; return P; }

  function solveFree(A, K, rhs, regularize) {
    const free = A.free;
    const Kff = LA.sub(K, free, free);
    if (regularize) {
      let sc = 0; for (let i = 0; i < free.length; i++) sc = Math.max(sc, Math.abs(Kff[i][i]));
      free.forEach((d, i) => { if (d % 3 === 2) Kff[i][i] += 1e-9 * sc; });
    }
    return LA.solve(Kff, LA.subv(rhs, free));
  }

  /** Newton-Raphson for K_T du = P - F_int(u) (port of core.newton). */
  function newton(A, u0, hinges, g, lam, linear, tol, maxit) {
    tol = tol || 1e-9; maxit = maxit === undefined ? 40 : maxit;
    const free = A.free, u = Float64Array.from(u0), P = loadVector(A, g, lam);
    const Pn = LA.norm(LA.subv(P, free));
    for (let it = 0; it <= maxit; it++) {
      const { F, K } = assemble(A, u, hinges, g, lam, linear);
      const R = vec(A.ndof); for (let d = 0; d < A.ndof; d++) R[d] = P[d] - F[d];
      const err = LA.norm(LA.subv(R, free));
      if (err <= tol * (1 + Pn)) return { u, ok: true, it };
      if (it === maxit) break;
      let du;
      try { du = solveFree(A, K, R, true); } catch (e) { return { u, ok: false, it }; }
      free.forEach((d, k) => { u[d] += du[k]; });
      if (!u.every(Number.isFinite)) return { u, ok: false, it };
    }
    return { u, ok: false, it: maxit };
  }

  // ------------------------------------------------------------------------------------------
  // Post-processing helpers
  // ------------------------------------------------------------------------------------------
  /** Local member-end forces (acting on the element) {F'} = [k']{Δ'} + {F'}fixed. */
  function endForces(info, q) {
    const V = (info.M1e + info.M2e) / info.Ln;
    return [-info.N - q[0], V - q[1], info.M1, info.N - q[3], -V - q[4], info.M2];
  }

  /** Internal force functions along an element: N (tension +), V, M (sagging +). */
  function fieldFn(el, info, loads, q) {
    const F = endForces(info, q);
    return function (x) {
      let N = -F[0], V = F[1], M = -F[2] + F[1] * x;
      for (const ld of loads) {
        if (ld.type === "strain") continue;
        if (ld.type === "pt") {
          if (x > ld.a + 1e-12) { N -= ld.px; V += ld.py; M += ld.py * (x - ld.a); }
        } else {
          if (x <= ld.x1) continue;
          const xe = Math.min(x, ld.x2), h = (xe - ld.x1) / 2, mid = (xe + ld.x1) / 2;
          if (h <= 0) continue;
          for (const [g, w] of GP) {
            const t = mid + g * h, r = (t - ld.x1) / (ld.x2 - ld.x1);
            const qx = ld.qx1 + (ld.qx2 - ld.qx1) * r, qy = ld.qy1 + (ld.qy2 - ld.qy1) * r;
            N -= w * h * qx; V += w * h * qy; M += w * h * qy * (x - t);
          }
        }
      }
      return { N, V, M };
    };
  }

  function breakpoints(el, loads) {
    const pts = new Set([0, el.L0]);
    for (const ld of loads) {
      if (ld.type === "strain") continue;
      if (ld.type === "pt") pts.add(ld.a); else { pts.add(ld.x1); pts.add(ld.x2); }
    }
    return [...pts].filter(x => x >= 0 && x <= el.L0).sort((a, b) => a - b);
  }

  /** Sampled diagram along an element; duplicates points at concentrated loads to show jumps. */
  function sampleElement(el, info, loads, q, nseg) {
    nseg = nseg || 24;
    const fn = fieldFn(el, info, loads, q), bp = breakpoints(el, loads);
    const xs = [];
    for (let k = 0; k < bp.length - 1; k++) {
      const a = bp[k], b = bp[k + 1], m = Math.max(2, Math.ceil(nseg * (b - a) / el.L0));
      for (let t = 0; t <= m; t++) xs.push(a + (b - a) * t / m);
    }
    const out = { x: [], N: [], V: [], M: [] };
    const eps = 1e-9 * el.L0;
    xs.forEach((x, idx) => {
      // evaluate slightly to the left at the end of a segment and to the right at its start
      const isEnd = idx < xs.length - 1 && Math.abs(xs[idx + 1] - x) < 1e-12;
      const xe = isEnd ? Math.max(0, x - eps) : Math.min(el.L0, x + (idx > 0 && Math.abs(xs[idx - 1] - x) < 1e-12 ? eps : 0));
      const r = fn(x === el.L0 ? x : xe);
      out.x.push(x); out.N.push(r.N); out.V.push(r.V); out.M.push(r.M);
    });
    return out;
  }

  /** Elastic curve of an element: integrate curvature M/EI twice and fit end displacements. */
  function elementShape(A, el, u, info, loads, q, scale, linear) {
    const d = elemDofs(el).map(k => u[k]);
    const c = el.c0, s = el.s0n;
    const ui = [c * d[0] + s * d[1], -s * d[0] + c * d[1]], uj = [c * d[3] + s * d[4], -s * d[3] + c * d[4]];
    const n = 24, L = el.L0, fn = fieldFn(el, info, loads, q);
    const xs = [], kap = [];
    const k0 = loads.reduce((a, l) => a + (l.type === "strain" ? l.k0 : 0), 0);
    for (let k = 0; k <= n; k++) { const x = L * k / n; xs.push(x); kap.push(el.truss || el.I <= 0 ? 0 : fn(Math.min(Math.max(x, 1e-12), L - 1e-12)).M / (el.E * el.I) + k0); }
    // double integration (trapezoid) with v(0)=0, v'(0)=0 then add rigid line to match ends
    const slope = [0], v = [0];
    for (let k = 1; k <= n; k++) {
      const h = xs[k] - xs[k - 1];
      slope.push(slope[k - 1] + 0.5 * h * (kap[k] + kap[k - 1]));
      v.push(v[k - 1] + 0.5 * h * (slope[k] + slope[k - 1]));
    }
    const vL = v[n];
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const t = xs[k] / L;
      const vv = v[k] - vL * t + ui[1] * (1 - t) + uj[1] * t;
      const ux = ui[0] * (1 - t) + uj[0] * t;
      const lx = xs[k] + scale * ux, ly = scale * vv;
      pts.push([A.X[el.i][0] + c * lx - s * ly, A.X[el.i][1] + s * lx + c * ly]);
    }
    return pts;
  }

  function reactionsFrom(A, F, P, u) {
    const R = [];
    A.fixedList.forEach(d => R.push({ dof: d, value: F[d] - P[d] }));
    A.springs.forEach((k, d) => { if (!A.fixed.has(d)) R.push({ dof: d, value: -k * u[d], spring: true }); });
    (A.coupled || []).forEach(cs => { const un = cs.n[0] * u[cs.dofs[0]] + cs.n[1] * u[cs.dofs[1]], Rn = -cs.k * un;
      R.push({ dof: cs.dofs[0], value: Rn * cs.n[0], inclined: true, normal: Rn }); R.push({ dof: cs.dofs[1], value: Rn * cs.n[1], inclined: true, normal: Rn }); });
    return R;
  }

  /** Static (in)determinacy and simple stability counts for the original model. */
  function determinacy(A) {
    let unknownsMembers = 0;
    const counted = new Set();
    A.els.forEach(el => {
      if (el.k !== 0 && el.nsub > 1) return; // count each original member once
      if (counted.has(el.parent)) return; counted.add(el.parent);
      const rel = (el.relI ? 1 : 0) + (el.relJ ? 1 : 0);
      unknownsMembers += 3 - (el.truss ? 2 : rel);
    });
    const nodesUsed = new Set();
    A.els.forEach(el => { if (el.i < A.nOrig) nodesUsed.add(el.i); if (el.j < A.nOrig) nodesUsed.add(el.j); });
    let r = 0;
    A.fixed.forEach(d => { if (nodesUsed.has(Math.floor(d / 3))) r++; });
    A.springs.forEach((k, d) => { if (!A.fixed.has(d) && nodesUsed.has(Math.floor(d / 3))) r++; });
    (A.coupled || []).forEach(cs => { if (nodesUsed.has(cs.node)) r++; });
    let orph = 0; A.orphans.forEach(d => { if (Math.floor(d / 3) < A.nOrig) orph++; });
    // original members that are frame members without subdivision artefacts
    const eq = 3 * nodesUsed.size - orph;
    return { m: counted.size, j: nodesUsed.size, r, equations: eq, unknowns: unknownsMembers + r, degree: unknownsMembers + r - eq };
  }

  // ------------------------------------------------------------------------------------------
  // Analyses
  // ------------------------------------------------------------------------------------------
  function packStates(A, u, hinges, g, lam, linear) {
    const { F, infos } = assemble(A, u, hinges, g, lam, linear);
    return { F, infos };
  }

  /** First-order (linear) analysis with every intermediate quantity of the direct stiffness method. */
  function linear(model, opts) {
    opts = opts || {};
    const A = opts.A || prepare(model, opts);
    const g = opts.g === undefined ? 1 : opts.g, lam = opts.lam === undefined ? 1 : opts.lam;
    const hinges = A.hinges0.map(h => h.slice());
    const zero = vec(A.ndof);
    const { F: F0, K } = assemble(A, zero, hinges, g, lam, true);
    const P = loadVector(A, g, lam);
    const u = Float64Array.from(A.presc);
    // rhs = P - F0 - K * presc
    const Ku = LA.matvec(K, u);
    const rhs = vec(A.ndof); for (let d = 0; d < A.ndof; d++) rhs[d] = P[d] - F0[d] - Ku[d];
    const res = { kind: "linear", A, P, F0, K, g, lam, warnings: A.warn.slice() };
    res.det = determinacy(A);
    if (A.free.length === 0) { res.u = u; }
    else {
      const Kff = LA.sub(K, A.free, A.free);
      const L = LA.cholesky(Kff, 1e-11);
      if (!L) {
        res.unstable = true;
        if (A.free.length <= 400) {
          const eg = LA.eigSym(Kff);
          const mode = vec(A.ndof); A.free.forEach((d, k) => { mode[d] = eg.vectors[0][k]; });
          res.mode = normalizeMode(mode);
        }
        res.u = u; res.infos = []; res.reactions = [];
        return res;
      }
      const uf = LA.backSubT(L, LA.forwardSub(L, LA.subv(rhs, A.free)));
      A.free.forEach((d, k) => { u[d] = uf[k]; });
    }
    res.u = u;
    const { F, infos } = assemble(A, u, hinges, g, lam, true);
    res.F = F; res.infos = infos; res.hinges = hinges;
    res.reactions = reactionsFrom(A, F, P, u);
    return res;
  }

  function normalizeMode(mode) {
    let mx = 0; for (let d = 0; d < mode.length; d++) if (d % 3 !== 2) mx = Math.max(mx, Math.abs(mode[d]));
    if (mx === 0) for (let d = 0; d < mode.length; d++) mx = Math.max(mx, Math.abs(mode[d]));
    if (mx > 0) for (let d = 0; d < mode.length; d++) mode[d] /= mx;
    // sign: make the largest translation positive
    let big = 0, bi = 0; for (let d = 0; d < mode.length; d++) if (d % 3 !== 2 && Math.abs(mode[d]) > big) { big = Math.abs(mode[d]); bi = d; }
    if (mode[bi] < 0) for (let d = 0; d < mode.length; d++) mode[d] = -mode[d];
    return mode;
  }

  function controlDof(A, opts) {
    if (opts && opts.ctrlNode !== undefined && opts.ctrlNode !== null && opts.ctrlNode >= 0) return 3 * opts.ctrlNode + (opts.ctrlDir || 0);
    let best = 0, bd = A.free[0] || 0;
    for (let d = 0; d < A.ndof; d++) if (d % 3 !== 2 && Math.abs(A.Pr[d]) > best) { best = Math.abs(A.Pr[d]); bd = d; }
    if (best === 0) for (let d = 0; d < A.ndof; d++) if (d % 3 !== 2 && Math.abs(A.P0[d]) > best) { best = Math.abs(A.P0[d]); bd = d; }
    return bd;
  }

  function hasRef(A) { return A.Pr.some(v => v !== 0) || A.els.some(el => el.loadsR.length); }

  /** Geometrically nonlinear analysis by incremental Newton-Raphson, load control (core.second_order). */
  function secondOrder(model, opts) {
    opts = opts || {};
    const A = prepare(model, opts.allRef || !hasRef(prepare(model, opts)) ? { ...opts, allRef: true } : opts);
    const lamMax = opts.lamMax || 1, steps = opts.steps || 20, gsteps = opts.gravitySteps || 4;
    const hinges = A.hinges0.map(h => h.slice());
    const ctrl = controlDof(A, opts);
    let u = Float64Array.from(A.presc);
    let note = "";
    const hasG = A.P0.some(v => v !== 0) || A.els.some(el => el.loadsG.length);
    if (hasG) {
      for (let k = 1; k <= gsteps; k++) {
        const r = newton(A, u, hinges, k / gsteps, 0, false);
        u = r.u; if (!r.ok) { note = "Newton-Raphson failed during the constant-load stage"; break; }
      }
    }
    const lamH = [0], ctrlH = [u[ctrl]], uH = [Float64Array.from(u)], itH = [0];
    let lam = 0;
    const dlam = lamMax / steps;
    while (lam < lamMax - 1e-12 && !note) {
      let trial = Math.min(dlam, lamMax - lam), r;
      for (let k = 0; k < 12; k++) { r = newton(A, u, hinges, 1, lam + trial, false); if (r.ok) break; trial *= 0.5; }
      if (!r.ok) { note = `No convergence beyond load factor ${fmtNum(lam)} (limit point or instability)`; break; }
      u = r.u; lam += trial;
      lamH.push(lam); ctrlH.push(u[ctrl]); uH.push(Float64Array.from(u)); itH.push(r.it);
    }
    const { F, infos } = assemble(A, u, hinges, 1, lam, false);
    const P = loadVector(A, 1, lam);
    // first-order comparison by superposition
    const lin0 = linear(model, { ...opts, A, g: hasG ? 1 : 0, lam: 0 });
    const lin1 = linear(model, { ...opts, A: prepareLike(model, opts, A), g: 0, lam: 1 });
    const linCtrl = lamH.map(l => (lin0.u ? lin0.u[ctrl] : 0) + l * (lin1.u ? lin1.u[ctrl] - lin1.A.presc[ctrl] : 0));
    return { kind: "second", A, u, infos, hinges, F, P, g: 1, lam, reactions: reactionsFrom(A, F, P, u), lamH, ctrlH, uH, itH,
      ctrl, linCtrl, note, warnings: A.warn.slice(), det: determinacy(A) };
  }
  function prepareLike(model, opts, A) {
    // same analysis model but without prescribed displacements (for superposition of the reference case)
    const B = prepare(model, opts.allRef || !hasRef(A) ? { ...opts, allRef: true } : opts);
    B.presc = vec(B.ndof);
    return B;
  }

  /** Consistent geometric stiffness [k_g] from a reference force state (core.geometric_stiffness_linear). */
  function geometricStiffness(A, infos) {
    const K = zeros(A.ndof);
    A.els.forEach((el, e) => {
      const info = infos[e], L = el.L0, c = el.c0, s = el.s0n, N = info.N;
      let kg;
      if (!(el.relI || el.relJ)) {
        const r = N / L;
        const kl = [[1, 0, 0, -1, 0, 0], [0, 6 / 5, L / 10, 0, -6 / 5, L / 10], [0, L / 10, 2 * L * L / 15, 0, -L / 10, -L * L / 30],
          [-1, 0, 0, 1, 0, 0], [0, -6 / 5, -L / 10, 0, 6 / 5, -L / 10], [0, L / 10, -L * L / 30, 0, -L / 10, 2 * L * L / 15]].map(row => row.map(v => v * r));
        kg = LA.btab(gammaMatrix(c, s), kl);
      } else {
        const z = [-s, c], w = [-z[0], -z[1], 0, z[0], z[1], 0];
        kg = zeros(6); for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) kg[i][j] = N / L * w[i] * w[j];
      }
      const rr = [c, s], z = [-s, c];
      const S2 = [[2 * rr[0] * z[0], rr[0] * z[1] + z[0] * rr[1]], [rr[1] * z[0] + z[1] * rr[0], 2 * rr[1] * z[1]]];
      const gg = (info.M1 + info.M2) / (L * L);
      for (const [bi, bj, sg] of [[0, 0, 1], [0, 3, -1], [3, 0, -1], [3, 3, 1]]) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) kg[bi + i][bj + j] += gg * sg * S2[i][j];
      const d = elemDofs(el);
      for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) K[d[a]][d[b]] += kg[a][b];
    });
    return K;
  }

  /** Elastic critical load factors from ([K]e + λ[K]g){φ} = 0 (all loads scaled by λ). */
  function buckling(model, opts) {
    opts = opts || {};
    const A = prepare(model, { ...opts, allRef: true });
    const base = linear(model, { ...opts, A, g: 0, lam: 1 });
    if (base.unstable) return { kind: "buckling", A, unstable: true, mode: base.mode, warnings: A.warn.slice(), det: base.det };
    const KG = geometricStiffness(A, base.infos);
    const free = A.free;
    const KEf = LA.sub(base.K, free, free), KGf = LA.sub(KG, free, free);
    const L = LA.cholesky(KEf, 1e-11);
    const n = free.length;
    // C = L^-1 (-KG) L^-T
    const X = zeros(n);
    for (let j = 0; j < n; j++) { const col = vec(n); for (let i = 0; i < n; i++) col[i] = -KGf[i][j]; const y = LA.forwardSub(L, col); for (let i = 0; i < n; i++) X[i][j] = y[i]; }
    const C = zeros(n);
    for (let j = 0; j < n; j++) { const col = vec(n); for (let i = 0; i < n; i++) col[i] = X[j][i]; const y = LA.forwardSub(L, col); for (let i = 0; i < n; i++) C[i][j] = y[i]; }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const m = 0.5 * (C[i][j] + C[j][i]); C[i][j] = m; C[j][i] = m; }
    const eg = LA.eigSym(C);
    let mx = 0; for (const v of eg.values) mx = Math.max(mx, Math.abs(v));
    const modes = [];
    for (let k = eg.values.length - 1; k >= 0 && modes.length < 4; k--) {
      const mu = eg.values[k];
      if (mu <= 1e-10 * mx) break;
      const phiF = LA.backSubT(L, eg.vectors[k]);
      const phi = vec(A.ndof); free.forEach((d, i) => { phi[d] = phiF[i]; });
      modes.push({ lam: 1 / mu, mode: normalizeMode(phi) });
    }
    return { kind: "buckling", A, u: base.u, infos: base.infos, reactions: base.reactions, P: base.P, g: 0, lam: 1,
      lamCr: modes.length ? modes[0].lam : null, mode: modes.length ? modes[0].mode : null, modes, warnings: A.warn.slice(), det: base.det };
  }

  function yieldRatios(A, infos, hinges) {
    const out = [];
    infos.forEach((info, e) => {
      const el = A.els[e];
      if (el.Z * el.fy <= 0 || el.truss) return;
      const lim = mpEff(el, info.N, A.interaction);
      if (lim <= 0) return;
      if (hinges[e][0] === null) out.push([Math.abs(info.M1) / lim, e, 0, Math.sign(info.M1) || 1]);
      if (hinges[e][1] === null) out.push([Math.abs(info.M2) / lim, e, 1, Math.sign(info.M2) || 1]);
    });
    return out;
  }

  /** Event-to-event plastic hinge analysis in load control (core.pushover). */
  function pushover(model, opts) {
    opts = opts || {};
    const A0 = prepare(model, opts);
    const A = hasRef(A0) ? A0 : prepare(model, { ...opts, allRef: true });
    const linearK = !opts.geometric;
    const lamMax = opts.lamMax || 10, dlam = opts.dlam || 0.05, gsteps = opts.gravitySteps || 4, maxEvents = opts.maxEvents || 200;
    const hinges = A.hinges0.map(h => h.slice());
    const ctrl = controlDof(A, opts);
    const free = A.free;
    let u = Float64Array.from(A.presc), note = "", status = "";
    if (A.free.length) {
      const chk = linear(model, { ...opts, A, g: 1, lam: 0 });
      if (chk.unstable) return { kind: "pushover", A, unstable: true, mode: chk.mode, status: "unstable", note: "Structure is unstable (mechanism) before any load is applied", lamLim: 0, warnings: A.warn.slice(), det: chk.det };
    }
    const hasG = A.P0.some(v => v !== 0) || A.els.some(el => el.loadsG.length);
    if (hasG) for (let k = 1; k <= gsteps; k++) { const r = newton(A, u, hinges, k / gsteps, 0, linearK); u = r.u; if (!r.ok) note = "Constant-load stage did not converge"; }
    let lam = 0;
    const lamH = [0], ctrlH = [u[ctrl]], uH = [Float64Array.from(u)], events = [], hingeH = [hinges.map(h => h.slice())];
    const ratiosAt = uu => { const { infos } = assemble(A, uu, hinges, 1, lam, linearK); return yieldRatios(A, infos, hinges); };
    let rPrev = Math.max(0, ...ratiosAt(u).map(r => r[0]));
    if (rPrev > 1 + 1e-6) note = "Constant (gravity) load alone exceeds a plastic moment";
    let step = dlam;
    const tolY = 1e-4;
    let collapse = false;
    while (lam < lamMax - 1e-12 && events.length < maxEvents && !note && !collapse) {
      let trial = Math.min(step, lamMax - lam), accepted = false, un = u;
      for (let k = 0; k < 60; k++) {
        const r = newton(A, u, hinges, 1, lam + trial, linearK);
        if (!r.ok) { trial *= 0.5; if (trial < 1e-10) break; continue; }
        un = r.u;
        const { infos } = assemble(A, un, hinges, 1, lam + trial, linearK);
        const rs = yieldRatios(A, infos, hinges);
        const rmax = Math.max(0, ...rs.map(x => x[0]));
        if (rmax <= 1 + tolY) { accepted = true; break; }
        const frac = rmax > rPrev ? (1 - rPrev) / (rmax - rPrev) : 0.5;
        trial *= Math.min(Math.max(frac, 0.02), 0.9);
        if (trial < 1e-10) { accepted = true; break; }
      }
      if (!accepted) { note = "Stopped: no convergence (mechanism or instability)"; collapse = true; status = "collapse"; break; }
      u = un; lam += trial;
      lamH.push(lam); ctrlH.push(u[ctrl]); uH.push(Float64Array.from(u));
      const { infos } = assemble(A, u, hinges, 1, lam, linearK);
      const rs = yieldRatios(A, infos, hinges);
      const newly = rs.filter(r => r[0] >= 1 - tolY);
      for (const [, e, k, sg] of newly) {
        hinges[e][k] = sg;
        const el = A.els[e];
        events.push({ lam, step: lamH.length - 1, el: e, member: el.parent, end: k, node: k === 0 ? el.i : el.j, sign: sg });
      }
      hingeH.push(hinges.map(h => h.slice()));
      if (newly.length) {
        const { K } = assemble(A, u, hinges, 1, lam, linearK);
        const orphan = orphanRotations(A.X.length, A.els, hinges, A.fixed, A.springs);
        const keep = free.filter(d => !orphan.has(d));
        const Kff = LA.sub(K, keep, keep);
        for (let i = 0; i < keep.length; i++) for (let j = i + 1; j < keep.length; j++) { const m = 0.5 * (Kff[i][j] + Kff[j][i]); Kff[i][j] = m; Kff[j][i] = m; }
        let sc = 0; for (let i = 0; i < keep.length; i++) sc = Math.max(sc, Math.abs(Kff[i][i]));
        let minEv;
        if (keep.length <= 150) minEv = LA.eigSym(Kff).values[0];
        else minEv = LA.cholesky(Kff, 1e-7) ? 1 : -1;
        if (minEv <= 1e-7 * sc) { note = "Collapse mechanism formed"; collapse = true; status = "collapse"; }
      } else step = Math.min(step * 1.5, dlam);
      rPrev = Math.max(0, ...ratiosAt(u).map(r => r[0]));
    }
    if (!status) status = note ? "inconclusive" : (lam >= lamMax - 1e-9 ? "inconclusive" : "inconclusive");
    const { F, infos } = assemble(A, u, hinges, 1, lam, linearK);
    const P = loadVector(A, 1, lam);
    return { kind: "pushover", A, u, infos, hinges, F, P, g: 1, lam, reactions: reactionsFrom(A, F, P, u), lamH, ctrlH, uH, hingeH,
      events, ctrl, note: note || (lam >= lamMax - 1e-9 ? `Reached the maximum load factor ${fmtNum(lamMax)} without a mechanism` : ""),
      status, lamLim: lam, geometric: !linearK, warnings: A.warn.slice(), det: determinacy(A) };
  }

  /** Crisfield cylindrical arc-length method for elastic limit points (core.arc_length). */
  function arcLength(model, opts) {
    opts = opts || {};
    const A0 = prepare(model, opts);
    const A = hasRef(A0) ? A0 : prepare(model, { ...opts, allRef: true });
    const hinges = A.hinges0.map(h => h.slice());
    const free = A.free, ctrl = controlDof(A, opts);
    const nsteps = opts.arcSteps || 400, maxit = 30, tol = 1e-8;
    let u = Float64Array.from(A.presc);
    const hasG = A.P0.some(v => v !== 0) || A.els.some(el => el.loadsG.length);
    if (hasG) for (let k = 1; k <= 4; k++) u = newton(A, u, hinges, k / 4, 0, false).u;
    // default arc length from the first-order response to the reference load
    let ds = opts.ds;
    const ksolve = (K, rhs) => solveFree(A, K, rhs, true);
    if (!ds) {
      const { K } = assemble(A, u, hinges, 1, 0, false);
      const dut = ksolve(K, A.Pr);
      const kc = A.free.indexOf(ctrl), uc = kc >= 0 ? Math.abs(dut[kc]) : 0;
      // aim for about 60 steps to reach the displacement limit (or λ = lamGuess when no limit is given)
      ds = (opts.dispLimit && uc > 0) ? LA.norm(dut) * (opts.dispLimit / uc) / 60 : LA.norm(dut) * (opts.lamGuess || 1) / 25;
    }
    let lam = 0;
    const lamH = [0], ctrlH = [u[ctrl]], uH = [Float64Array.from(u)];
    let duPrev = null, dsCur = ds, note = "";
    const lamLimit = opts.lamMax || null, dispLimit = opts.dispLimit || null;
    for (let step = 0; step < nsteps; step++) {
      let converged = false, ut = null, lamT = 0, dtot = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const { K } = assemble(A, u, hinges, 1, lam, false);
        let dut = ksolve(K, A.Pr);
        const sgn = duPrev === null ? 1 : (LA.dot(dut, duPrev) >= 0 ? 1 : -1);
        const dlamInc = sgn * dsCur / Math.sqrt(LA.dot(dut, dut));
        dtot = dut.map(v => v * dlamInc);
        lamT = lam + dlamInc;
        ut = Float64Array.from(u); free.forEach((d, k) => { ut[d] += dtot[k]; });
        let ok = false;
        for (let it = 0; it < maxit; it++) {
          const a = assemble(A, ut, hinges, 1, lamT, false);
          const P = loadVector(A, 1, lamT);
          const R = vec(A.ndof); for (let d = 0; d < A.ndof; d++) R[d] = P[d] - a.F[d];
          if (LA.norm(LA.subv(R, free)) <= tol * (1 + LA.norm(LA.subv(P, free)))) { ok = true; break; }
          dut = ksolve(a.K, A.Pr);
          const dur = ksolve(a.K, R);
          const ddu = dtot.map((v, k) => v + dur[k]);
          const aa = LA.dot(dut, dut), bb = 2 * LA.dot(ddu, dut), cc = LA.dot(ddu, ddu) - dsCur * dsCur;
          const disc = bb * bb - 4 * aa * cc;
          if (disc < 0) break;
          const r1 = (-bb + Math.sqrt(disc)) / (2 * aa), r2 = (-bb - Math.sqrt(disc)) / (2 * aa);
          const ref = LA.norm(dtot) > 0 ? dtot : dut;
          const d1 = ddu.map((v, k) => v + r1 * dut[k]), d2 = ddu.map((v, k) => v + r2 * dut[k]);
          const pick = LA.dot(d1, ref) >= LA.dot(d2, ref) ? r1 : r2;
          dtot = Float64Array.from(ddu.map((v, k) => v + pick * dut[k]));
          lamT += pick;
          ut = Float64Array.from(u); free.forEach((d, k) => { ut[d] += dtot[k]; });
        }
        if (ok) { converged = true; break; }
        dsCur *= 0.5;
      }
      if (!converged) { note = `Arc-length stopped at step ${step} (no convergence)`; break; }
      duPrev = Float64Array.from(dtot); u = ut; lam = lamT;
      lamH.push(lam); ctrlH.push(u[ctrl]); uH.push(Float64Array.from(u));
      dsCur = Math.min(dsCur * 1.2, ds);
      if (lamLimit !== null && lam >= lamLimit) break;
      if (dispLimit !== null && Math.abs(u[ctrl]) >= dispLimit) break;
    }
    const { F, infos } = assemble(A, u, hinges, 1, lam, false);
    const P = loadVector(A, 1, lam);
    // limit point = first local maximum of λ along the path
    let peak = null, peakStep = null;
    for (let k = 1; k < lamH.length - 1; k++) if (lamH[k] >= lamH[k - 1] && lamH[k + 1] < lamH[k]) { peak = lamH[k]; peakStep = k; break; }
    return { kind: "arc", A, u, infos, hinges, F, P, g: 1, lam, reactions: reactionsFrom(A, F, P, u), lamH, ctrlH, uH, ctrl, note,
      lamPeak: peak, peakStep, warnings: A.warn.slice(), det: determinacy(A) };
  }

  /** Infos/forces for a stored step of a nonlinear history. */
  function stateAt(res, k) {
    const A = res.A, u = res.uH[k], lam = res.lamH[k];
    const hinges = res.hingeH ? res.hingeH[k] : res.hinges;
    const linearK = res.kind === "pushover" && !res.geometric;
    const { F, infos } = assemble(A, u, hinges, 1, lam, linearK);
    return { u, lam, hinges, infos, F };
  }

  // ------------------------------------------------------------------------------------------
  // Teaching quantities: element matrices, K properties, flexibility, virtual work
  // ------------------------------------------------------------------------------------------
  function elementMatrices(res, e) {
    const A = res.A, el = A.els[e];
    const zero = new Float64Array(6);
    const { K: kg } = element(A, el, zero, A.hinges0[e], new Float64Array(6), true);
    const G = gammaMatrix(el.c0, el.s0n);
    const kl = LA.matmul(G, LA.matmul(kg, LA.transpose(G)));
    const q = elemQ(el, res.g, res.lam);
    const d = elemDofs(el);
    const dg = d.map(k => res.u[k]);
    const dl = LA.matvec(G, dg);
    const ef = endForces(res.infos[e], q);
    return { el, kLocal: kl, Gamma: G, kGlobal: kg, dofs: d, q, fef: Array.from(q, v => -v), dGlobal: dg, dLocal: dl, endForces: ef };
  }

  function stiffnessProperties(res) {
    const A = res.A, K = res.K, n = A.ndof;
    const active = [];
    for (let d = 0; d < n; d++) if (!A.removedDofs.has(d)) active.push(d);
    const Ka = LA.sub(K, active, active);
    let asym = 0, mx = 0;
    for (let i = 0; i < Ka.length; i++) for (let j = 0; j < Ka.length; j++) { asym = Math.max(asym, Math.abs(Ka[i][j] - Ka[j][i])); mx = Math.max(mx, Math.abs(Ka[i][j])); }
    const out = { n: active.length, nf: A.free.length, ns: A.fixedList.length, symmetric: asym <= 1e-10 * mx, asym: asym / (mx || 1),
      diagPositive: active.every(d => K[d][d] > 0) };
    if (active.length <= 240) {
      const ev = LA.eigSym(Ka).values; const emax = Math.max(...ev.map(Math.abs));
      out.zeroModes = ev.filter(v => Math.abs(v) <= 1e-9 * emax).length;
      out.eigK = { min: ev[0], max: ev[ev.length - 1] };
    }
    if (A.free.length && A.free.length <= 240 && !res.unstable) {
      const Kff = LA.sub(K, A.free, A.free), ev = LA.eigSym(Kff).values;
      out.kffMin = ev[0]; out.kffMax = ev[ev.length - 1]; out.cond = ev[ev.length - 1] / ev[0]; out.posDef = ev[0] > 0;
    }
    return out;
  }

  function flexibility(res) {
    const A = res.A; if (res.unstable || !A.free.length || A.free.length > 120) return null;
    const Kff = LA.sub(res.K, A.free, A.free);
    const Fm = LA.inverse(Kff);
    let asym = 0, mx = 0; for (let i = 0; i < Fm.length; i++) for (let j = 0; j < Fm.length; j++) { asym = Math.max(asym, Math.abs(Fm[i][j] - Fm[j][i])); mx = Math.max(mx, Math.abs(Fm[i][j])); }
    const KF = LA.matmul(Kff, Fm); let idErr = 0; for (let i = 0; i < KF.length; i++) for (let j = 0; j < KF.length; j++) idErr = Math.max(idErr, Math.abs(KF[i][j] - (i === j ? 1 : 0)));
    return { F: Fm, reciprocity: asym / (mx || 1), identityError: idErr };
  }

  /** Integrate f(x) over an element with 3-point Gauss on 8 sub-intervals between breakpoints. */
  function integrate(el, loads, f) {
    const bp = breakpoints(el, loads); let s = 0;
    for (let k = 0; k < bp.length - 1; k++) {
      const a = bp[k], b = bp[k + 1], m = 8;
      for (let i = 0; i < m; i++) {
        const x0 = a + (b - a) * i / m, x1 = a + (b - a) * (i + 1) / m, h = (x1 - x0) / 2, c = (x0 + x1) / 2;
        for (const [g, w] of GP) s += w * h * f(c + g * h);
      }
    }
    return s;
  }

  /** Unit-load (virtual work) displacement at an original node DOF, using the linear result res. */
  function virtualWork(res, node, dir) {
    const A = res.A, dof = 3 * node + dir;
    if (res.unstable || !A.free.includes(dof)) return null;
    // virtual (unit) load case: no member loads, no settlement
    const Pu = vec(A.ndof); Pu[dof] = 1;
    const hinges = A.hinges0.map(h => h.slice());
    const zero = vec(A.ndof);
    const uf = LA.solve(LA.sub(res.K, A.free, A.free), LA.subv(Pu, A.free));
    const u1 = vec(A.ndof); A.free.forEach((d, k) => { u1[d] = uf[k]; });
    const { F: F1, infos: inf1 } = assemble(A, u1, hinges, 0, 0, true);
    let internal = 0, axial = 0, bending = 0, spring = 0, shear = 0, initial = 0, connection = 0;
    const perMember = [];
    A.els.forEach((el, e) => {
      const loads = elemLoads(el, res.g, res.lam), q = elemQ(el, res.g, res.lam);
      const real = fieldFn(el, res.infos[e], loads, q), virt = fieldFn(el, inf1[e], [], new Float64Array(6));
      const b = el.truss || el.I <= 0 ? 0 : integrate(el, loads, x => real(x).M * virt(x).M / (el.E * el.I));
      const a = integrate(el, loads, x => real(x).N * virt(x).N / (el.E * el.A));
      const sh = el.GAs > 0 ? integrate(el, loads, x => real(x).V * virt(x).V / el.GAs) : 0;
      // temperature / misfit strains: ∫ (κ0 m + ε0 n) dx
      const e0 = loads.reduce((t, l) => t + (l.type === "strain" ? l.e0 : 0), 0), k0 = loads.reduce((t, l) => t + (l.type === "strain" ? l.k0 : 0), 0);
      const ini = (e0 ? e0 * integrate(el, loads, x => virt(x).N) : 0) + (k0 ? k0 * integrate(el, loads, x => virt(x).M) : 0);
      // semi-rigid connection springs: M m / k at each spring end
      let con = 0;
      if (el.kI > 0 && res.hinges && res.hinges[e] && res.hinges[e][0] === null) con += res.infos[e].M1 * inf1[e].M1 / el.kI;
      if (el.kJ > 0 && res.hinges && res.hinges[e] && res.hinges[e][1] === null) con += res.infos[e].M2 * inf1[e].M2 / el.kJ;
      bending += b; axial += a; shear += sh; initial += ini; connection += con;
      perMember.push({ parent: el.parent, bending: b, axial: a, shear: sh });
    });
    A.springs.forEach((k, d) => { if (!A.fixed.has(d)) spring += k * res.u[d] * u1[d]; });
    (A.coupled || []).forEach(cs => { const a = cs.n[0] * res.u[cs.dofs[0]] + cs.n[1] * res.u[cs.dofs[1]], b = cs.n[0] * u1[cs.dofs[0]] + cs.n[1] * u1[cs.dofs[1]]; spring += cs.k * a * b; });
    internal = bending + axial + spring + shear + initial + connection;
    // support movement term: 1·δ + Σ R̄ Δs = internal
    let settle = 0;
    A.fixedList.forEach(d => { if (A.presc[d] !== 0) settle += (F1[d] - Pu[d]) * A.presc[d]; });
    const delta = internal - settle;
    return { dof, delta, stiffness: res.u[dof], bending, axial, spring, shear, initial, connection, settle, perMember };
  }

  function equilibrium(res) {
    const A = res.A; let fx = 0, fy = 0, m = 0;
    // applied: nodal loads + member loads (exact resultants), reactions
    const add = (x, y, Fx, Fy, Mz) => { fx += Fx; fy += Fy; m += Mz + x * Fy - y * Fx; };
    let afx = 0, afy = 0;
    const g = res.g, lam = res.lam;
    // nodal loads from the analysis vectors minus equivalent element loads
    const Pn = loadVector(A, g, lam);
    A.els.forEach(el => {
      const q = elemQ(el, g, lam), c = el.c0, s = el.s0n, dd = [3 * el.i, 3 * el.j];
      for (let k = 0; k < 2; k++) { const lx = q[3 * k], ly = q[3 * k + 1]; Pn[dd[k]] -= c * lx - s * ly; Pn[dd[k] + 1] -= s * lx + c * ly; Pn[dd[k] + 2] -= q[3 * k + 2]; }
    });
    for (let n = 0; n < A.X.length; n++) add(A.X[n][0], A.X[n][1], Pn[3 * n], Pn[3 * n + 1], Pn[3 * n + 2]);
    A.els.forEach(el => {
      for (const ld of elemLoads(el, g, lam)) {
        if (ld.type === "strain") continue;
        const c = el.c0, s = el.s0n;
        let fxl, fyl, xc;
        if (ld.type === "pt") { fxl = ld.px; fyl = ld.py; xc = ld.a; }
        else {
          const L = ld.x2 - ld.x1;
          fxl = (ld.qx1 + ld.qx2) / 2 * L;
          const Ry = (ld.qy1 + ld.qy2) / 2 * L;
          fyl = Ry;
          const mom = ld.qy1 * L * L / 2 + (ld.qy2 - ld.qy1) * L * L / 3; // first moment about x1 of qy
          xc = Ry !== 0 ? ld.x1 + mom / Ry : (ld.x1 + ld.x2) / 2;
          // axial component acts along the member axis: its moment arm is perpendicular, so placement does not matter
        }
        const gx = c * fxl - s * fyl, gy = s * fxl + c * fyl;
        const px = A.X[el.i][0] + c * xc, py = A.X[el.i][1] + s * xc;
        add(px, py, gx, gy, 0);
      }
    });
    afx = fx; afy = fy; const am = m;
    for (const r of res.reactions) { const n = Math.floor(r.dof / 3), k = r.dof % 3; const [x, y] = A.X[n]; add(x, y, k === 0 ? r.value : 0, k === 1 ? r.value : 0, k === 2 ? r.value : 0); }
    return { applied: { fx: afx, fy: afy, m: am }, residual: { fx, fy, m } };
  }

  // ------------------------------------------------------------------------------------------
  // Damage and retrofit studies (proposal Eqs. 1-2)
  // ------------------------------------------------------------------------------------------
  function capacity(model, opts) {
    const r = pushover(model, opts);
    return { lam: r.lamLim || 0, status: r.unstable ? "unstable" : r.status, note: r.note, res: r };
  }

  function removalRanking(model, opts, members, progress) {
    const intact = capacity(model, opts);
    const rows = [];
    const list = members || model.members.map((_, i) => i).filter(i => !model.members[i].removed);
    list.forEach((mi, k) => {
      const removed = new Set(opts.removed || []); removed.add(mi);
      const c = capacity(model, { ...opts, removed });
      const ok = intact.status === "collapse" && c.status === "collapse" && intact.lam > 0;
      rows.push({ member: mi, lam: c.lam, status: c.status, C: ok ? c.lam / intact.lam : (c.status === "unstable" ? 0 : null), note: c.note });
      if (progress) progress(k + 1, list.length);
    });
    rows.sort((a, b) => (a.C === null ? 2 : a.C) - (b.C === null ? 2 : b.C));
    return { intact: { lam: intact.lam, status: intact.status, note: intact.note }, rows };
  }

  function retrofitStudy(model, opts, removeMember, strengthenMember, factor) {
    const base = capacity(model, opts);
    const rem = new Set([removeMember]);
    const dam = capacity(model, { ...opts, removed: rem });
    const fac = new Map([[strengthenMember, factor]]);
    const ret = capacity(model, { ...opts, removed: rem, factors: fac });
    const resolved = x => x.status === "collapse";
    const C = resolved(base) && resolved(dam) && base.lam > 0 ? dam.lam / base.lam : (dam.status === "unstable" ? 0 : null);
    const eta = resolved(dam) && resolved(ret) && dam.lam > 0 ? (ret.lam - dam.lam) / dam.lam : null;
    const Cr = resolved(base) && resolved(ret) && base.lam > 0 ? ret.lam / base.lam : null;
    return { intact: base, damaged: dam, retrofit: ret, C, eta, Cretrofit: Cr };
  }

  // ------------------------------------------------------------------------------------------
  function fmtNum(v, d) {
    d = d || 4;
    if (v === null || v === undefined || !Number.isFinite(v)) return "–";
    if (v === 0) return "0";
    const a = Math.abs(v);
    if (a >= 1e5 || a < 1e-3) return v.toExponential(d - 1).replace("e+", "e");
    return (+v.toPrecision(d)).toString();
  }

  const Solver = { addElemLoad, orphanRotations, reactionsFrom, loadVector, hasRef, controlDof, normalizeMode, prepare, linear, secondOrder, buckling, pushover, arcLength, stateAt, assemble, element, elemDofs, elemQ, elemLoads,
    endForces, fieldFn, sampleElement, elementShape, elementMatrices, stiffnessProperties, flexibility, virtualWork, equilibrium,
    geometricStiffness, gammaMatrix, equivalentLoads, shape, determinacy, removalRanking, retrofitStudy, capacity, fmtNum };
  if (typeof module !== "undefined" && module.exports) module.exports = Solver; else root.Solver = Solver;
})(typeof self !== "undefined" ? self : this);
