/* Frame2D Studio - STAAD.Pro input (.std) writer for independent verification.
 * Writes a STAAD PLANE model in kN and m with prismatic sections (AX, IZ), so shear deformation is
 * not included, matching the Euler-Bernoulli elements of this tool. Review the generated file in
 * STAAD.Pro before running it; command syntax follows the STAAD.Pro Technical Reference. */
(function (root) {
  "use strict";
  const f = v => { const x = +v; if (!Number.isFinite(x)) return "0"; if (x === 0) return "0"; const a = Math.abs(x); return (a >= 1e5 || a < 1e-4) ? x.toExponential(6).replace("e+", "E") .replace("e-", "E-") : (+x.toPrecision(8)).toString(); };

  function list(nums) {
    // compress consecutive numbers as "a TO b"
    const s = [...new Set(nums)].sort((a, b) => a - b), out = [];
    for (let i = 0; i < s.length; i++) {
      let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
      out.push(j - i >= 2 ? `${s[i]} TO ${s[j]}` : (j > i ? `${s[i]} ${s[j]}` : `${s[i]}`)); i = j;
    }
    return out.join(" ");
  }

  function toSTD(model, opts) {
    opts = opts || {};
    const L = [];
    const active = model.members.map((m, i) => ({ m, n: i + 1 })).filter(x => !x.m.removed);
    L.push("STAAD PLANE");
    L.push(`* ${model.title || "Frame2D Studio model"}`);
    L.push("* Exported by Frame2D Studio. Units kN, m. Sections are prismatic (AX, IZ): no shear deformation.");
    L.push("* Load case 1 = all loads (constant + variable at load factor 1).");
    L.push("START JOB INFORMATION");
    L.push(`ENGINEER DATE ${new Date().toISOString().slice(0, 10)}`);
    L.push("END JOB INFORMATION");
    L.push("INPUT WIDTH 79");
    L.push("UNIT METER KN");
    L.push("JOINT COORDINATES");
    model.nodes.forEach((n, i) => L.push(`${i + 1} ${f(n.x)} ${f(n.y)} 0;`));
    L.push("MEMBER INCIDENCES");
    active.forEach(({ m, n }) => L.push(`${n} ${m.i + 1} ${m.j + 1};`));
    // materials: one per distinct (E, density)
    const rhoOf = sec => (sec.rho === undefined || sec.rho === null || sec.rho === "") ? (sec.E >= 1e8 ? 7.85 : 2.4) : +sec.rho;
    const mats = [];
    const matOf = sec => { let k = mats.findIndex(x => x.E === sec.E && x.rho === rhoOf(sec)); if (k < 0) { mats.push({ E: sec.E, rho: rhoOf(sec) }); k = mats.length - 1; } return k; };
    model.sections.forEach(matOf);
    L.push("DEFINE MATERIAL START");
    mats.forEach((mt, k) => { L.push(`ISOTROPIC MAT${k + 1}`); L.push(`E ${f(mt.E)}`); L.push("POISSON 0.3"); L.push(`DENSITY ${f(mt.rho * 9.80665)}`); L.push("ALPHA 1.2E-5"); });
    L.push("END DEFINE MATERIAL");
    L.push("MEMBER PROPERTY");
    model.sections.forEach((s, si) => {
      const ms = active.filter(x => x.m.sec === si).map(x => x.n);
      if (!ms.length) return;
      const fac = active.filter(x => x.m.sec === si && x.m.factor && x.m.factor !== 1);
      const plain = ms.filter(n => !fac.find(x => x.n === n));
      const ay = +s.As > 0 ? ` AY ${f(s.As)}` : "";
      if (plain.length) L.push(`${list(plain)} PRIS AX ${f(s.A)} IZ ${f(s.I || 1e-12)}${ay}`);
      fac.forEach(x => L.push(`${x.n} PRIS AX ${f(s.A * x.m.factor)} IZ ${f((s.I || 1e-12) * x.m.factor)}${+s.As > 0 ? ` AY ${f(s.As * x.m.factor)}` : ""}`));
    });
    L.push("CONSTANTS");
    mats.forEach((mt, k) => {
      const ms = active.filter(x => model.sections[x.m.sec] && matOf(model.sections[x.m.sec]) === k).map(x => x.n);
      if (ms.length) L.push(`MATERIAL MAT${k + 1} MEMB ${list(ms)}`);
    });
    const truss = active.filter(x => x.m.type === "truss").map(x => x.n);
    if (truss.length) { L.push("MEMBER TRUSS"); L.push(list(truss)); }
    const rel = active.filter(x => x.m.type !== "truss" && (x.m.relI || x.m.relJ || +x.m.kI > 0 || +x.m.kJ > 0));
    if (rel.length) {
      L.push("MEMBER RELEASE");
      rel.forEach(({ m, n }) => {
        if (m.relI) L.push(`${n} START MZ`); else if (+m.kI > 0) L.push(`${n} START KMZ ${f(m.kI)}`);
        if (m.relJ) L.push(`${n} END MZ`); else if (+m.kJ > 0) L.push(`${n} END KMZ ${f(m.kJ)}`);
      });
      if (rel.some(x => +x.m.kI > 0 || +x.m.kJ > 0)) L.push("* KMZ = rotational spring of a semi-rigid connection (kN-m/rad). Check the syntax in your STAAD.Pro version.");
    }
    // supports
    const settle = [];
    L.push("SUPPORTS");
    for (const s of model.supports) {
      const n = s.node + 1;
      if (s.incline) {
        const b = (+s.angle || 0) * Math.PI / 180;
        L.push(`* Node ${n}: roller on a surface at ${s.angle || 0} deg. Inclined support, local x along the surface normal.`);
        L.push(`${n} INCLINED ${f(-Math.sin(b))} ${f(Math.cos(b))} 0 FIXED BUT FY MZ${s.rz ? "" : ""}`);
        continue;
      }
      const fixedDirs = [s.ux, s.uy, s.rz], names = ["FX", "FY", "MZ"], springs = [s.kx, s.ky, s.kr], kn = ["KFX", "KFY", "KMZ"];
      const hasSettle = [s.dx, s.dy, s.dr].some(v => +v);
      const released = names.filter((_, k) => !fixedDirs[k]);
      const springTxt = springs.map((k, i) => (!fixedDirs[i] && +k > 0) ? `${kn[i]} ${f(k)}` : "").filter(Boolean).join(" ");
      if (!fixedDirs.some(Boolean) && !springTxt) continue;
      if (hasSettle) {
        L.push(`${n} ENFORCED${released.length ? " BUT " + released.join(" ") : ""}${springTxt ? " " + springTxt : ""}`);
        [s.dx, s.dy, s.dr].forEach((v, k) => { if (+v) settle.push(`${n} ${names[k]} ${f(v)}`); });
      } else if (fixedDirs.every(Boolean)) L.push(`${n} FIXED`);
      else if (fixedDirs[0] && fixedDirs[1] && !fixedDirs[2] && !springTxt) L.push(`${n} PINNED`);
      else L.push(`${n} FIXED BUT ${released.join(" ")}${springTxt ? " " + springTxt : ""}`);
    }
    const kind = opts.analysis || "linear";
    if (kind === "modal") {
      const st = model.settings || {};
      L.push("CUT OFF MODE SHAPE 6");
      L.push("* Masses: self-weight (density x area) converted to mass in X and Y. STAAD lumps masses at the joints;");
      L.push("* compare with Frame2D's lumped-mass option. Frequencies appear under CALCULATED FREQUENCIES.");
      L.push("LOAD 1 LOADTYPE None TITLE MASSES");
      if (st.selfMass !== false) { L.push("SELFWEIGHT X 1"); L.push("SELFWEIGHT Y 1"); }
      const jm = [];
      (model.masses || []).forEach(q => { if (+q.m) jm.push([q.node + 1, +q.m * 9.80665]); });
      if (st.massFromLoads !== false) model.nodeLoads.filter(l => l.pat === "G").forEach(l => jm.push([l.node + 1, Math.hypot(+l.fx || 0, +l.fy || 0)]));
      if (jm.length) { L.push("JOINT LOAD"); jm.forEach(([n, w]) => L.push(`${n} FX ${f(w)} FY ${f(w)}`)); }
      if (st.massFromLoads !== false) {
        const gl = model.memberLoads.filter(l => l.pat === "G" && l.kind !== "point" && model.members[l.member] && !model.members[l.member].removed);
        if (gl.length) { L.push("MEMBER LOAD"); gl.forEach(l => { const w = Math.abs(+l.w1 || 0); L.push(`${l.member + 1} UNI GX ${f(w)}`); L.push(`${l.member + 1} UNI GY ${f(w)}`); }); }
      }
      L.push("MODAL CALCULATION REQUESTED");
      L.push("PERFORM ANALYSIS");
      L.push("PRINT JOINT DISPLACEMENTS ALL");
      L.push("FINISH");
      return L.join("\r\n") + "\r\n";
    }
    L.push("LOAD 1 LOADTYPE None TITLE ALL LOADS");
    const jl = model.nodeLoads.filter(l => +l.fx || +l.fy || +l.mz);
    if (jl.length) {
      L.push("JOINT LOAD");
      jl.forEach(l => { const p = []; if (+l.fx) p.push(`FX ${f(l.fx)}`); if (+l.fy) p.push(`FY ${f(l.fy)}`); if (+l.mz) p.push(`MZ ${f(l.mz)}`); L.push(`${l.node + 1} ${p.join(" ")}`); });
    }
    const ml = model.memberLoads.filter(l => l.kind !== "thermal" && l.kind !== "misfit" && model.members[l.member] && !model.members[l.member].removed);
    if (ml.length) {
      L.push("MEMBER LOAD");
      ml.forEach(l => {
        const m = model.members[l.member], a = model.nodes[m.i], b = model.nodes[m.j];
        const Lm = Math.hypot(b.x - a.x, b.y - a.y);
        const dir = l.dir === "GX" ? "GX" : l.dir === "GY" ? "GY" : l.dir === "axial" ? "X" : "Y";
        if (l.kind === "point") L.push(`${l.member + 1} CON ${dir} ${f(l.P)} ${f(l.a)}`);
        else {
          const w1 = +l.w1, w2 = (l.w2 === null || l.w2 === "" || l.w2 === undefined) ? w1 : +l.w2;
          const d1 = +l.a || 0, d2 = (l.b === null || l.b === "" || l.b === undefined) ? Lm : +l.b;
          const full = d1 <= 1e-9 && Math.abs(d2 - Lm) <= 1e-9;
          if (w1 === w2) L.push(`${l.member + 1} UNI ${dir} ${f(w1)}${full ? "" : ` ${f(d1)} ${f(d2)}`}`);
          else L.push(`${l.member + 1} TRAP ${dir} ${f(w1)} ${f(w2)} ${f(d1)} ${f(d2)}`);
        }
      });
    }
    if (settle.length) { L.push("SUPPORT DISPLACEMENT LOAD"); settle.forEach(s => L.push(s)); }
    const th = model.memberLoads.filter(l => (l.kind === "thermal" || l.kind === "misfit") && model.members[l.member] && !model.members[l.member].removed);
    if (th.length) {
      L.push("TEMPERATURE LOAD");
      th.forEach(l => {
        if (l.kind === "thermal") L.push(`${l.member + 1} TEMP ${f(+l.dT || 0)} ${f(+l.dTg || 0)}`);
        else L.push(`${l.member + 1} STRAIN ${f(+l.dL || 0)}`);
      });
      L.push("* TEMP f1 f2: f1 uniform change, f2 = T(top, local +y) - T(bottom). STRAIN f1: initial elongation (misfit).");
    }
    if (kind === "second" || kind === "arc") {
      L.push("* Second-order check. STAAD's P-Delta option is an approximate geometric method:");
      L.push("* compare it with the Frame2D second-order result at load factor 1.");
      L.push("PDELTA 30 ANALYSIS SMALLDELTA PRINT ALL");
    } else if (kind === "buckling") {
      L.push("* Elastic buckling: needs the advanced solver; the factor multiplies load case 1.");
      L.push("PERFORM BUCKLING ANALYSIS");
    } else {
      L.push("PERFORM ANALYSIS PRINT STATICS CHECK");
    }
    L.push("PRINT JOINT DISPLACEMENTS ALL");
    L.push("PRINT SUPPORT REACTION ALL");
    L.push("PRINT MEMBER FORCES ALL");
    L.push("FINISH");
    return L.join("\r\n") + "\r\n";
  }

  const STAAD = { toSTD };
  if (typeof module !== "undefined" && module.exports) module.exports = STAAD; else root.STAAD = STAAD;
})(typeof self !== "undefined" ? self : this);
