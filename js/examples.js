/* Frame2D Studio - section library, structure templates and verification examples.
 * Units: kN, m (E, fy in kN/m^2; A in m^2; I in m^4; Z in m^3). */
(function (root) {
  "use strict";
  const E_STEEL = 200e6, FY = 345e3, IN = 0.0254;

  /* W-shape properties (A [in^2], Ix [in^4], Zx [in^3]) as listed in the AISC Shapes Database v16.
   * Check them against the database before quoting results in the report. */
  const W_US = {
    "W8x31": [9.13, 110, 30.4], "W10x33": [9.71, 171, 38.8], "W12x26": [7.65, 204, 37.2], "W14x90": [26.5, 999, 157],
    "W14x145": [42.7, 1710, 260], "W16x26": [7.68, 301, 44.2], "W18x50": [14.7, 800, 101], "W21x44": [13.0, 843, 95.4],
    "W24x55": [16.2, 1350, 134], "W24x76": [22.4, 2100, 200]
  };
  function wSection(name) {
    const [a, i, z] = W_US[name];
    return { name, E: E_STEEL, A: a * IN ** 2, I: i * IN ** 4, Z: z * IN ** 3, fy: FY };
  }
  function rectSection(name, b, h, E, fy) {
    return { name, E: E || E_STEEL, A: b * h, I: b * h ** 3 / 12, Z: b * h * h / 4, fy: fy === undefined ? FY : fy };
  }
  const LIBRARY = Object.keys(W_US).map(wSection);

  const sup = (node, kind, extra) => {
    const t = { fixed: [1, 1, 1], pinned: [1, 1, 0], rollerX: [0, 1, 0], rollerY: [1, 0, 0], guide: [1, 0, 1] }[kind];
    return { node, ux: !!t[0], uy: !!t[1], rz: !!t[2], kx: 0, ky: 0, kr: 0, dx: 0, dy: 0, dr: 0, ...(extra || {}) };
  };
  const mem = (i, j, sec, extra) => ({ i, j, sec: sec || 0, type: "frame", relI: false, relJ: false, removed: false, factor: 1, ...(extra || {}) });
  const nload = (node, fx, fy, mz, pat) => ({ node, fx: fx || 0, fy: fy || 0, mz: mz || 0, pat: pat || "R" });
  const udl = (member, w, dir, pat, extra) => ({ member, kind: "udl", dir: dir || "GY", w1: w, w2: null, a: 0, b: null, pat: pat || "R", ...(extra || {}) });
  const pload = (member, P, a, dir, pat) => ({ member, kind: "point", dir: dir || "GY", P, a, pat: pat || "R" });

  function base(title, desc) {
    return { title, description: desc || "", nodes: [], members: [], sections: [], supports: [], nodeLoads: [], memberLoads: [],
      settings: { nsub: 1, interaction: true, analysis: "linear" }, references: [] };
  }

  // ---------------------------------------------------------------------------------------
  // Templates (parametric generators)
  // ---------------------------------------------------------------------------------------
  const templates = {
    blank: {
      label: "Empty grid", params: [{ key: "section", label: "Default section", type: "section", value: "W14x90" }],
      build(p) { const m = base("New model"); m.sections.push(wSection(p.section)); return m; }
    },
    beam: {
      label: "Continuous beam", params: [
        { key: "spans", label: "Span lengths (m, comma separated)", type: "text", value: "6, 6" },
        { key: "w", label: "Uniform load w (kN/m, downward)", value: 20 },
        { key: "section", label: "Section", type: "section", value: "W18x50" },
        { key: "leftFixed", label: "Left end fixed", type: "bool", value: false }],
      build(p) {
        const m = base("Continuous beam");
        const spans = String(p.spans).split(/[,; ]+/).map(Number).filter(v => v > 0);
        m.sections.push(wSection(p.section));
        let x = 0; m.nodes.push({ x: 0, y: 0 });
        spans.forEach(L => { x += L; m.nodes.push({ x, y: 0 }); });
        spans.forEach((L, k) => { m.members.push(mem(k, k + 1)); if (+p.w) m.memberLoads.push(udl(k, -Math.abs(+p.w))); });
        m.supports.push(sup(0, p.leftFixed ? "fixed" : "pinned"));
        for (let k = 1; k <= spans.length; k++) m.supports.push(sup(k, "rollerX"));
        return m;
      }
    },
    portal: {
      label: "Portal frame", params: [
        { key: "span", label: "Span (m)", value: 6 }, { key: "h", label: "Height (m)", value: 4 },
        { key: "w", label: "Beam gravity load (kN/m)", value: 20 }, { key: "H", label: "Lateral load H (kN)", value: 50 },
        { key: "base", label: "Base", type: "select", options: ["fixed", "pinned"], value: "fixed" },
        { key: "col", label: "Columns", type: "section", value: "W14x90" }, { key: "beam", label: "Beam", type: "section", value: "W18x50" }],
      build(p) {
        const m = base("Portal frame");
        m.sections.push(wSection(p.col), wSection(p.beam));
        m.nodes.push({ x: 0, y: 0 }, { x: 0, y: +p.h }, { x: +p.span, y: +p.h }, { x: +p.span, y: 0 });
        m.members.push(mem(0, 1, 0), mem(1, 2, 1), mem(3, 2, 0));
        m.supports.push(sup(0, p.base), sup(3, p.base));
        if (+p.w) m.memberLoads.push(udl(1, -Math.abs(+p.w), "GY", "G"));
        if (+p.H) m.nodeLoads.push(nload(1, +p.H, 0, 0, "R"));
        return m;
      }
    },
    building: {
      label: "Multistory frame", params: [
        { key: "stories", label: "Stories", value: 3, int: true }, { key: "bays", label: "Bays", value: 2, int: true },
        { key: "h", label: "Story height (m)", value: 3.8 }, { key: "bw", label: "Bay width (m)", value: 6 },
        { key: "w", label: "Beam gravity load (kN/m)", value: 25 }, { key: "F", label: "Lateral force at level 1 (kN), level k gets k·F", value: 50 },
        { key: "col", label: "Columns", type: "section", value: "W14x90" }, { key: "beam", label: "Beams", type: "section", value: "W18x50" }],
      build(p) {
        const m = base("Multistory frame");
        const S = Math.max(1, Math.round(+p.stories)), B = Math.max(1, Math.round(+p.bays));
        m.sections.push(wSection(p.col), wSection(p.beam));
        const id = (s, b) => s * (B + 1) + b;
        for (let s = 0; s <= S; s++) for (let b = 0; b <= B; b++) m.nodes.push({ x: b * +p.bw, y: s * +p.h });
        for (let s = 0; s < S; s++) for (let b = 0; b <= B; b++) m.members.push(mem(id(s, b), id(s + 1, b), 0));
        for (let s = 1; s <= S; s++) for (let b = 0; b < B; b++) { m.members.push(mem(id(s, b), id(s, b + 1), 1)); if (+p.w) m.memberLoads.push(udl(m.members.length - 1, -Math.abs(+p.w), "GY", "G")); }
        for (let b = 0; b <= B; b++) m.supports.push(sup(id(0, b), "fixed"));
        if (+p.F) for (let s = 1; s <= S; s++) m.nodeLoads.push(nload(id(s, 0), s * +p.F, 0, 0, "R"));
        return m;
      }
    },
    truss: {
      label: "Plane truss", params: [
        { key: "type", label: "Type", type: "select", options: ["Pratt", "Howe", "Warren"], value: "Pratt", help: "Warren is drawn with verticals" },
        { key: "panels", label: "Panels (even)", value: 6, int: true }, { key: "L", label: "Span (m)", value: 24 }, { key: "h", label: "Height (m)", value: 4 },
        { key: "P", label: "Load at each bottom joint (kN, downward)", value: 50 },
        { key: "A", label: "Member area (cm²)", value: 40 }],
      build(p) {
        const m = base(p.type + " truss");
        const n = Math.max(2, 2 * Math.round(+p.panels / 2)), L = +p.L, h = +p.h, dx = L / n;
        m.sections.push({ name: `Bar ${p.A} cm²`, E: E_STEEL, A: +p.A * 1e-4, I: 0, Z: 0, fy: FY });
        for (let k = 0; k <= n; k++) m.nodes.push({ x: k * dx, y: 0 });
        const top = []; for (let k = 1; k < n; k++) { top[k] = m.nodes.length; m.nodes.push({ x: k * dx, y: h }); }
        const T = { type: "truss" };
        for (let k = 0; k < n; k++) m.members.push(mem(k, k + 1, 0, T));
        for (let k = 1; k < n - 1; k++) m.members.push(mem(top[k], top[k + 1], 0, T));
        m.members.push(mem(0, top[1], 0, T), mem(n, top[n - 1], 0, T));
        for (let k = 1; k < n; k++) m.members.push(mem(k, top[k], 0, T));
        for (let k = 1; k < n - 1; k++) {
          let downToRight;  // diagonal from top[k] down to bottom k+1
          if (p.type === "Warren") downToRight = k % 2 === 1;
          else downToRight = (k < n / 2) === (p.type === "Pratt");
          if (downToRight) m.members.push(mem(top[k], k + 1, 0, T)); else m.members.push(mem(k, top[k + 1], 0, T));
        }
        m.supports.push(sup(0, "pinned"), sup(n, "rollerX"));
        if (+p.P) for (let k = 1; k < n; k++) m.nodeLoads.push(nload(k, 0, -Math.abs(+p.P)));
        return m;
      }
    },
    gable: {
      label: "Gable frame", params: [
        { key: "span", label: "Span (m)", value: 12 }, { key: "eave", label: "Eave height (m)", value: 5 }, { key: "ridge", label: "Ridge height (m)", value: 7 },
        { key: "w", label: "Roof gravity load (kN/m, per member length)", value: 10 }, { key: "H", label: "Lateral load at eave (kN)", value: 20 },
        { key: "col", label: "Columns", type: "section", value: "W14x90" }, { key: "raf", label: "Rafters", type: "section", value: "W18x50" }],
      build(p) {
        const m = base("Gable frame");
        m.sections.push(wSection(p.col), wSection(p.raf));
        const S = +p.span;
        m.nodes.push({ x: 0, y: 0 }, { x: 0, y: +p.eave }, { x: S / 2, y: +p.ridge }, { x: S, y: +p.eave }, { x: S, y: 0 });
        m.members.push(mem(0, 1, 0), mem(1, 2, 1), mem(2, 3, 1), mem(4, 3, 0));
        m.supports.push(sup(0, "pinned"), sup(4, "pinned"));
        if (+p.w) { m.memberLoads.push(udl(1, -Math.abs(+p.w), "GY", "G"), udl(2, -Math.abs(+p.w), "GY", "G")); }
        if (+p.H) m.nodeLoads.push(nload(1, +p.H, 0, 0, "R"));
        return m;
      }
    },
    column: {
      label: "Column", params: [
        { key: "L", label: "Length (m)", value: 5 }, { key: "P", label: "Axial load P (kN, compression)", value: 1000 },
        { key: "ends", label: "End conditions", type: "select", options: ["pinned-pinned", "fixed-free", "fixed-pinned", "fixed-fixed"], value: "pinned-pinned" },
        { key: "section", label: "Section", type: "section", value: "W14x90" }, { key: "nsub", label: "Elements per member", value: 4, int: true }],
      build(p) {
        const m = base("Column");
        m.sections.push(wSection(p.section));
        m.nodes.push({ x: 0, y: 0 }, { x: 0, y: +p.L });
        m.members.push(mem(0, 1));
        const e = p.ends;
        m.supports.push(sup(0, e === "pinned-pinned" ? "pinned" : "fixed"));
        if (e === "pinned-pinned" || e === "fixed-pinned") m.supports.push(sup(1, "rollerY"));
        if (e === "fixed-fixed") m.supports.push(sup(1, "guide"));
        m.nodeLoads.push(nload(1, 0, -Math.abs(+p.P)));
        m.settings.nsub = Math.max(1, Math.round(+p.nsub)); m.settings.analysis = "buckling";
        return m;
      }
    }
  };

  // ---------------------------------------------------------------------------------------
  // Verification examples with closed-form references (proposal Table 4 and McGuire et al.)
  // ---------------------------------------------------------------------------------------
  const ex = {};
  const node = (r, n) => r.u ? r.u.slice(3 * n, 3 * n + 3) : [0, 0, 0];
  const reac = (r, n, k) => { const x = r.reactions.find(q => q.dof === 3 * n + k); return x ? x.value : 0; };
  const endF = (r, member, end) => {
    const els = r.A.memberEls[member], e = end === 0 ? els[0] : els[els.length - 1];
    const Sv = (typeof Solver !== "undefined") ? Solver : root.Solver;
    const ef = Sv.endForces(r.infos[e], Sv.elemQ(r.A.els[e], r.g, r.lam));
    return end === 0 ? ef.slice(0, 3) : ef.slice(3);
  };

  ex.ssBeam = () => {
    const m = base("Simply supported beam, central point load", "Two beam elements, P at midspan. Checks deflection PL³/48EI, moment PL/4 and reactions P/2.");
    const L = 8, P = 100, s = wSection("W18x50");
    m.sections.push(s);
    m.nodes.push({ x: 0, y: 0 }, { x: L / 2, y: 0 }, { x: L, y: 0 });
    m.members.push(mem(0, 1), mem(1, 2));
    m.supports.push(sup(0, "pinned"), sup(2, "rollerX"));
    m.nodeLoads.push(nload(1, 0, -P));
    const EI = s.E * s.I;
    m.references = [
      { label: "Midspan deflection", unit: "m", ref: -P * L ** 3 / (48 * EI), source: "−PL³/48EI", get: r => node(r, 1)[1] },
      { label: "Midspan moment (sagging)", unit: "kN·m", ref: P * L / 4, source: "PL/4", get: r => -endF(r, 1, 0)[2] },
      { label: "Left reaction", unit: "kN", ref: P / 2, source: "P/2", get: r => reac(r, 0, 1) }];
    return m;
  };

  ex.twoSpan = () => {
    const m = base("Two-span continuous beam, UDL", "Equal spans and EI, UDL on both spans. Indeterminate to the first degree.");
    const L = 6, w = 25;
    m.sections.push(wSection("W18x50"));
    m.nodes.push({ x: 0, y: 0 }, { x: L, y: 0 }, { x: 2 * L, y: 0 });
    m.members.push(mem(0, 1), mem(1, 2));
    m.supports.push(sup(0, "pinned"), sup(1, "rollerX"), sup(2, "rollerX"));
    m.memberLoads.push(udl(0, -w), udl(1, -w));
    m.references = [
      { label: "Interior reaction", unit: "kN", ref: 5 * w * L / 4, source: "5wL/4", get: r => reac(r, 1, 1) },
      { label: "Interior support moment (hogging)", unit: "kN·m", ref: w * L * L / 8, source: "wL²/8", get: r => -endF(r, 0, 1)[2] },
      { label: "End reaction", unit: "kN", ref: 3 * w * L / 8, source: "3wL/8", get: r => reac(r, 0, 1) }];
    return m;
  };

  ex.settlement = () => {
    const m = base("Fixed-fixed beam, support settlement", "Right support settles 12 mm. Fixed-end moment 6EIΔ/L², shear 12EIΔ/L³.");
    const L = 6, d = 0.012, s = wSection("W18x50");
    m.sections.push(s);
    m.nodes.push({ x: 0, y: 0 }, { x: L, y: 0 });
    m.members.push(mem(0, 1));
    m.supports.push(sup(0, "fixed"), sup(1, "fixed", { dy: -d }));
    const EI = s.E * s.I;
    m.references = [
      { label: "End moment at A", unit: "kN·m", ref: 6 * EI * d / L ** 2, source: "6EIΔ/L²", get: r => reac(r, 0, 2) },
      { label: "Vertical reaction at A", unit: "kN", ref: 12 * EI * d / L ** 3, source: "12EIΔ/L³", get: r => reac(r, 0, 1) }];
    return m;
  };

  ex.truss = () => {
    const m = templates.truss.build({ type: "Pratt", panels: 6, L: 24, h: 4, P: 50, A: 40 });
    m.title = "Pratt truss, 6 panels"; m.description = "Truss elements (axial only). Method-of-sections check of the top chord next to midspan and the support reaction.";
    // top chord member between x = 8 and x = 12
    const tc = m.members.findIndex(q => { const a = m.nodes[q.i], b = m.nodes[q.j]; return a.y === 4 && b.y === 4 && Math.min(a.x, b.x) === 8; });
    m.references = [
      { label: "Top chord force, panel 3 (compression)", unit: "kN", ref: -18 * 50 / 4, source: "−M(12 m)/h = −18P/h", get: r => -endF(r, tc, 0)[0] },
      { label: "Left reaction", unit: "kN", ref: 2.5 * 50, source: "5P/2", get: r => reac(r, 0, 1) }];
    return m;
  };

  ex.portal = () => {
    const m = base("Portal frame, plastic collapse and member removal",
      "Proposal case: fixed bases, h = 4 m, column Mp = 400 kN·m, beam Mp = 1200 kN·m, reference lateral load 100 kN. First-order plastic analysis without axial interaction.");
    const h = 4, span = 6;
    m.sections.push({ name: "Column (Mp = 400 kN·m)", E: E_STEEL, A: 0.0171, I: 4.158e-4, Z: 400 / FY, fy: FY },
      { name: "Beam (Mp = 1200 kN·m)", E: E_STEEL, A: 0.01445, I: 8.74e-4, Z: 1200 / FY, fy: FY });
    m.nodes.push({ x: 0, y: 0 }, { x: 0, y: h }, { x: span, y: h }, { x: span, y: 0 });
    m.members.push(mem(0, 1, 0), mem(1, 2, 1), mem(3, 2, 0));
    m.supports.push(sup(0, "fixed"), sup(3, "fixed"));
    m.nodeLoads.push(nload(1, 100, 0, 0, "R"));
    m.settings.interaction = false; m.settings.analysis = "pushover"; m.settings.geometric = false; m.settings.lamMax = 10;
    m.references = [{ label: "Collapse load factor (sway mechanism)", unit: "×100 kN", ref: 4, source: "Hh = 4Mp → H = 400 kN", get: r => r.lamLim, analysis: "pushover" }];
    m.study = { remove: 1, strengthen: 0, factor: 2, expect: { intact: 4, damaged: 1, retrofit: 2 } };
    return m;
  };

  ex.euler = () => {
    const m = templates.column.build({ L: 5, P: 1000, ends: "pinned-pinned", section: "W14x90", nsub: 4 });
    m.title = "Euler column, pinned ends"; m.description = "Elastic critical load π²EI/L². Try 1, 2, 4 and 8 elements to see the finite element solution converge.";
    const s = m.sections[0], Pcr = Math.PI ** 2 * s.E * s.I / 25;
    m.references = [{ label: "Critical load", unit: "kN", ref: Pcr, source: "π²EI/L²", get: r => r.lamCr * 1000, analysis: "buckling" }];
    return m;
  };

  ex.beamColumn = () => {
    const m = base("Cantilever beam-column, second order", "Constant axial load P = 0.3 Pcr and lateral tip load H. Exact elastic solution δ = H/(Pk)·(tan kL − kL). The area is set very large because the closed form assumes an axially rigid member.");
    const L = 4, s = { name: "Column (A large: axially rigid)", E: E_STEEL, A: 10, I: 4e-4, Z: 0, fy: 0 };
    m.sections.push(s);
    m.nodes.push({ x: 0, y: 0 }, { x: 0, y: L });
    m.members.push(mem(0, 1));
    m.supports.push(sup(0, "fixed"));
    const EI = s.E * s.I, Pcr = Math.PI ** 2 * EI / (4 * L * L), P = 0.3 * Pcr, H = 10, k = Math.sqrt(P / EI);
    m.nodeLoads.push(nload(1, 0, -P, 0, "G"), nload(1, H, 0, 0, "R"));
    m.settings.nsub = 16; m.settings.analysis = "second"; m.settings.lamMax = 1; m.settings.steps = 10;
    m.references = [
      { label: "Tip deflection, second order", unit: "m", ref: H / (P * k) * (Math.tan(k * L) - k * L), source: "H/(Pk)(tan kL − kL)", get: r => node(r, 1)[0], analysis: "second" },
      { label: "Tip deflection, first order", unit: "m", ref: H * L ** 3 / (3 * EI), source: "HL³/3EI", get: r => node(r, 1)[0], analysis: "linear" }];
    return m;
  };

  ex.gable = () => {
    const m = templates.gable.build({ span: 12, eave: 5, ridge: 7, w: 10, H: 20, col: "W14x90", raf: "W18x50" });
    m.title = "Gable frame, inclined members"; m.description = "Inclined rafters show the coordinate transformation [Γ]. Gravity load per member length (GY) is resolved into local axial and transverse parts.";
    return m;
  };

  ex.building = () => {
    const m = templates.building.build({ stories: 3, bays: 2, h: 3.8, bw: 6, w: 25, F: 50, col: "W14x90", beam: "W18x50" });
    m.title = "3-story, 2-bay steel frame"; m.description = "Damage study frame: constant gravity on the beams, inverted-triangle lateral load scaled by λ. Use the Damage tab to rank member removal.";
    m.settings.analysis = "pushover"; m.settings.geometric = true; m.settings.lamMax = 10;
    m.study = { remove: 0, strengthen: 3, factor: 1.5 };
    return m;
  };

  ex.toggle = () => {
    const m = base("Williams toggle, snap-through", "Shallow two-member toggle with rigid joints (Williams, 1964). Arc-length analysis traces the path past the limit point near 34 lb.");
    const LB = 4.4482216e-3, PSI = 6.894757;
    const half = 12.943 * IN, rise = 0.386 * IN;
    m.sections.push({ name: "Toggle bar 0.753 × 0.243 in", E: 10.3e6 * PSI, A: 0.183 * IN ** 2, I: 9.0e-4 * IN ** 4, Z: 0, fy: 0 });
    m.nodes.push({ x: 0, y: 0 }, { x: half, y: rise }, { x: 2 * half, y: 0 });
    m.members.push(mem(0, 1), mem(1, 2));
    m.supports.push(sup(0, "fixed"), sup(2, "fixed"));
    m.nodeLoads.push(nload(1, 0, -10 * LB));
    m.settings.nsub = 16; m.settings.analysis = "arc"; m.settings.dispLimit = 2.2 * rise;
    m.references = [{ label: "Limit load", unit: "lb", ref: 33.87, source: "33.87 lb, exact extensible elastica (python/elastica_toggle.py)", get: r => r.lamPeak * 10, analysis: "arc", tol: 1.5 }];
    return m;
  };


  // ---------------------------------------------------------------------------------------
  // Dynamics and moving-load examples
  // ---------------------------------------------------------------------------------------
  function cantileverColumn(n, title) {
    const m = base(title || "Cantilever column, natural frequencies",
      "Steel W14x90 cantilever, L = 4 m, self-weight mass only, " + n + " members. Exact Euler–Bernoulli frequencies f = (βL)²/(2πL²)·√(EI/ρA).");
    const L = 4, s = wSection("W14x90"); s.rho = 7.85;
    m.sections.push(s);
    for (let k = 0; k <= n; k++) m.nodes.push({ x: 0, y: L * k / n });
    for (let k = 0; k < n; k++) m.members.push(mem(k, k + 1));
    m.supports.push(sup(0, "fixed"));
    m.settings.analysis = "modal"; m.settings.massType = "consistent"; m.settings.massFromLoads = false;
    const EI = s.E * s.I, c = Math.sqrt(EI / (s.rho * s.A));
    const fb = b => b * b / (2 * Math.PI * L * L) * c, fax = Math.sqrt(s.E / s.rho) / (4 * L);
    m.theory = { f1: fb(1.87510407), f2: fb(4.69409113), fax, f3: fb(7.85475744) };
    m.references = [
      { label: "Mode 1, bending", unit: "Hz", ref: m.theory.f1, source: "(1.8751)²/(2πL²)·√(EI/ρA)", get: r => r.modes[0].f, analysis: "modal", tol: 0.5 },
      { label: "Mode 2, bending", unit: "Hz", ref: m.theory.f2, source: "(4.6941)²/(2πL²)·√(EI/ρA)", get: r => r.modes[1].f, analysis: "modal", tol: 0.5 },
      { label: "Mode 3, axial", unit: "Hz", ref: m.theory.fax, source: "√(E/ρ)/(4L)", get: r => r.modes[2].f, analysis: "modal", tol: 0.5 },
      { label: "Mode 4, bending", unit: "Hz", ref: m.theory.f3, source: "(7.8548)²/(2πL²)·√(EI/ρA)", get: r => r.modes[3].f, analysis: "modal", tol: 0.5 }];
    return m;
  }
  ex.cantFreq = () => cantileverColumn(10);

  ex.movingBeam = () => {
    const m = base("Simply supported beam, moving point load", "A 100 kN point load crosses a 10 m span. The moment envelope peaks at PL/4 when the load is at midspan; each reaction peaks at P.");
    m.sections.push(wSection("W18x50"));
    m.nodes.push({ x: 0, y: 0 }, { x: 10, y: 0 });
    m.members.push(mem(0, 1));
    m.supports.push(sup(0, "pinned"), sup(1, "rollerX"));
    Object.assign(m.settings, { analysis: "moving", path: [0], axleLoads: "100", axleSpacing: "", positions: 100 });
    m.references = [
      { label: "Maximum moment (envelope)", unit: "kN·m", ref: 250, source: "PL/4", get: r => r.maxM.v, analysis: "moving" },
      { label: "Maximum left reaction", unit: "kN", ref: 100, source: "P", get: r => r.reactions.find(q => q.dof === 1).max, analysis: "moving" }];
    return m;
  };

  ex.bridge = () => {
    const m = base("Three-span bridge girder, truck crossing", "Continuous steel plate girder 20 + 25 + 20 m with a three-axle truck (35, 145, 145 kN at 4.3 m). Play the crossing and read the moment envelope.");
    // built-up plate girder: web 1500 × 16 mm, flanges 450 × 40 mm
    const bf = 0.45, tf = 0.04, hw = 1.5, tw = 0.016, H = hw + 2 * tf;
    const I = (bf * H ** 3 - (bf - tw) * hw ** 3) / 12, Z = bf * tf * (H - tf) + tw * hw * hw / 4;
    m.sections.push({ name: "Plate girder 1580 mm", E: E_STEEL, A: 2 * bf * tf + hw * tw, I, Z, fy: FY, rho: 7.85 });
    const xs = [0, 5, 10, 15, 20, 26.25, 32.5, 38.75, 45, 50, 55, 60, 65];
    xs.forEach(x => m.nodes.push({ x, y: 0 }));
    for (let k = 0; k < xs.length - 1; k++) m.members.push(mem(k, k + 1));
    m.supports.push(sup(0, "pinned"), sup(4, "rollerX"), sup(8, "rollerX"), sup(12, "rollerX"));
    Object.assign(m.settings, { analysis: "moving", path: m.members.map((_, i) => i), axleLoads: "35, 145, 145", axleSpacing: "4.3, 4.3", positions: 160 });
    return m;
  };

  // ---------------------------------------------------------------------------------------
  // The three external validation cases (STAAD.Pro): linear, second order and modal
  // ---------------------------------------------------------------------------------------
  const nodeU = (r, n, k) => r.u[3 * n + k];
  const R = (r, n, k) => { const q = r.reactions.find(x => x.dof === 3 * n + k); return q ? q.value : 0; };
  const endM = (r, member, end) => {
    const Sv = (typeof Solver !== "undefined") ? Solver : root.Solver;
    const els = r.A.memberEls[member], e = end === 0 ? els[0] : els[els.length - 1];
    return Sv.endForces(r.infos[e], Sv.elemQ(r.A.els[e], r.g, r.lam))[end === 0 ? 2 : 5];
  };

  function valLinear() {
    const m = base("V1. Two-story frame, linear static", "Fixed-base steel frame, 6 m bay, 3.5 m stories. UDL 30 kN/m on both beams, lateral loads 25 kN (level 1) and 50 kN (roof). First-order elastic analysis.");
    m.sections.push(wSection("W14x90"), wSection("W18x50"));
    m.nodes.push({ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 3.5 }, { x: 6, y: 3.5 }, { x: 0, y: 7 }, { x: 6, y: 7 });
    m.members.push(mem(0, 2, 0), mem(1, 3, 0), mem(2, 4, 0), mem(3, 5, 0), mem(2, 3, 1), mem(4, 5, 1));
    m.supports.push(sup(0, "fixed"), sup(1, "fixed"));
    m.memberLoads.push(udl(4, -30, "GY", "G"), udl(5, -30, "GY", "G"));
    m.nodeLoads.push(nload(2, 25, 0, 0, "R"), nload(4, 50, 0, 0, "R"));
    m.settings.analysis = "linear";
    return m;
  }
  function valSecond() {
    const m = base("V2. Portal frame, second order (P-Δ)", "Fixed-base portal, h = 4 m, span 6 m. 2000 kN on each column (constant) and 50 kN lateral at the roof. Columns split into 4 elements so P-δ is captured.");
    m.sections.push(wSection("W14x90"), wSection("W18x50"));
    m.nodes.push({ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 0 });
    m.members.push(mem(0, 1, 0), mem(1, 2, 1), mem(3, 2, 0));
    m.supports.push(sup(0, "fixed"), sup(3, "fixed"));
    m.nodeLoads.push(nload(1, 0, -2000, 0, "G"), nload(2, 0, -2000, 0, "G"), nload(1, 50, 0, 0, "R"));
    Object.assign(m.settings, { analysis: "second", nsub: 4, lamMax: 1, steps: 10 });
    return m;
  }
  function valModal() {
    const m = cantileverColumn(20, "V3. Cantilever column, natural frequencies");
    m.settings.massType = "lumped";
    m.description = "Steel W14x90 cantilever, L = 4 m, 20 members, self-weight mass (ρ = 7.85 t/m³). Lumped masses at the joints, as in STAAD.Pro.";
    m.references = [];
    return m;
  }

  const validations = [
    { key: "V1", title: "Linear static", build: valLinear, analysis: "linear",
      purpose: "Checks geometry, supports, member loads, assembly and force recovery for an indeterminate frame (degree 6).",
      staad: "PERFORM ANALYSIS. Compare joint displacements, support reactions and member end moments.",
      quantities: [
        { key: "u5", label: "Roof drift, node 5 (x)", unit: "mm", get: r => nodeU(r, 4, 0) * 1000, target: 0.5 },
        { key: "u3", label: "Level 1 drift, node 3 (x)", unit: "mm", get: r => nodeU(r, 2, 0) * 1000, target: 0.5 },
        { key: "v5", label: "Vertical displacement, node 5", unit: "mm", get: r => nodeU(r, 4, 1) * 1000, target: 0.5 },
        { key: "Rx1", label: "Base shear, node 1", unit: "kN", get: r => R(r, 0, 0), target: 0.5 },
        { key: "Ry1", label: "Vertical reaction, node 1", unit: "kN", get: r => R(r, 0, 1), target: 0.5 },
        { key: "M1", label: "Base moment, node 1", unit: "kN·m", get: r => R(r, 0, 2), target: 0.5 },
        { key: "M2", label: "Base moment, node 2", unit: "kN·m", get: r => R(r, 1, 2), target: 0.5 },
        { key: "Mb", label: "Roof beam end moment at node 5", unit: "kN·m", get: r => endM(r, 5, 0), target: 0.5 },
        { key: "sumRx", label: "Σ base shear (equilibrium)", unit: "kN", get: r => R(r, 0, 0) + R(r, 1, 0), theory: () => -75, theorySource: "−(25 + 50)", target: 0.1 },
        { key: "sumRy", label: "Σ vertical reactions (equilibrium)", unit: "kN", get: r => R(r, 0, 1) + R(r, 1, 1), theory: () => 360, theorySource: "2 × 30 × 6", target: 0.1 }] },
    { key: "V2", title: "Second order (P-Δ)", build: valSecond, analysis: "second",
      purpose: "Checks the geometric stiffness and the Newton–Raphson solution: sway amplification of a heavily loaded portal.",
      staad: "PDELTA 30 ANALYSIS SMALLDELTA (includes P-δ). Compare the roof drift and base moments with the second-order values.",
      quantities: [
        { key: "d1", label: "Roof drift, first order", unit: "mm", get: (r, m) => (window.Solver || Solver).linear(m, { nsub: m.settings.nsub }).u[3] * 1000, target: 0.5 },
        { key: "d2", label: "Roof drift, second order", unit: "mm", get: r => nodeU(r, 1, 0) * 1000, target: 1 },
        { key: "amp", label: "Amplification Δ₂/Δ₁", unit: "", get: (r, m) => nodeU(r, 1, 0) / (window.Solver || Solver).linear(m, { nsub: m.settings.nsub }).u[3], theory: m => { const g = JSON.parse(JSON.stringify(m)); g.nodeLoads = g.nodeLoads.filter(l => l.pat === "G"); const b = (window.Solver || Solver).buckling(g, { nsub: m.settings.nsub }); return 1 / (1 - 1 / b.lamCr); }, theorySource: "B₂ = 1/(1 − 1/λcr), λcr of the gravity loads", target: 1 },
        { key: "M1", label: "Base moment, node 1 (second order)", unit: "kN·m", get: r => R(r, 0, 2), target: 1 },
        { key: "M4", label: "Base moment, node 4 (second order)", unit: "kN·m", get: r => R(r, 3, 2), target: 1 },
        { key: "lcr", label: "Elastic critical load factor λcr", unit: "", get: (r, m) => (window.Solver || Solver).buckling(m, { nsub: m.settings.nsub }).lamCr, target: 2, note: "PERFORM BUCKLING ANALYSIS (optional)" }] },
    { key: "V3", title: "Modal (natural frequencies)", build: valModal, analysis: "modal",
      purpose: "Checks the mass matrix and the generalized eigenvalue solution against exact beam theory and STAAD.Pro.",
      staad: "MODAL CALCULATION REQUESTED with self-weight converted to mass in X and Y. Compare the first four frequencies.",
      quantities: [
        { key: "f1", label: "Mode 1, bending", unit: "Hz", get: r => r.modes[0].f, theory: m => m.theory.f1, theorySource: "(1.8751)²/(2πL²)·√(EI/ρA)", target: 1 },
        { key: "f2", label: "Mode 2, bending", unit: "Hz", get: r => r.modes[1].f, theory: m => m.theory.f2, theorySource: "(4.6941)²/(2πL²)·√(EI/ρA)", target: 1 },
        { key: "f3", label: "Mode 3, axial", unit: "Hz", get: r => r.modes[2].f, theory: m => m.theory.fax, theorySource: "√(E/ρ)/(4L)", target: 1 },
        { key: "f4", label: "Mode 4, bending", unit: "Hz", get: r => r.modes[3].f, theory: m => m.theory.f3, theorySource: "(7.8548)²/(2πL²)·√(EI/ρA)", target: 2 }] }
  ];


  // ---------------------------------------------------------------------------------------
  // v3 feature examples
  // ---------------------------------------------------------------------------------------
  const memEnd = (r, member, end, k) => { const Sv = (typeof Solver !== "undefined") ? Solver : root.Solver; const els = r.A.memberEls[member], e = end === 0 ? els[0] : els[els.length - 1]; return Sv.endForces(r.infos[e], Sv.elemQ(r.A.els[e], r.g, r.lam))[3 * end + k]; };
  ex.thermal = () => {
    const m = base("Fixed beam, temperature change", "W18x50 fixed at both ends, 30 °C uniform rise and a 20 °C gradient (top hotter) over the 457 mm depth. α = 1.2×10⁻⁵ /°C.");
    const s = wSection("W18x50"); m.sections.push(s);
    m.nodes.push({ x: 0, y: 0 }, { x: 6, y: 0 }); m.members.push(mem(0, 1));
    m.supports.push(sup(0, "fixed"), sup(1, "fixed"));
    m.memberLoads.push({ member: 0, kind: "thermal", dT: 30, dTg: 20, h: 0.457, alpha: 1.2e-5, pat: "R", lc: "T" });
    m.references = [
      { label: "Axial force", unit: "kN", ref: -s.E * s.A * 1.2e-5 * 30, source: "−EAαΔT", get: r => -memEnd(r, 0, 0, 0) },
      { label: "End moment (magnitude)", unit: "kN·m", ref: s.E * s.I * 1.2e-5 * 20 / 0.457, source: "EIαΔTg/h", get: r => Math.abs(memEnd(r, 0, 0, 2)) }];
    return m;
  };
  ex.misfit = () => {
    const m = base("Braced frame, misfit diagonal", "Pin-jointed braced bay: the diagonal was fabricated 6 mm too long and forced into place. Lack of fit induces forces with no external load.");
    m.sections.push({ name: "Bar 30 cm²", E: E_STEEL, A: 30e-4, I: 0, Z: 0, fy: FY });
    m.nodes.push({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 });
    const T = { type: "truss" };
    m.members.push(mem(0, 1, 0, T), mem(1, 2, 0, T), mem(2, 3, 0, T), mem(3, 0, 0, T), mem(0, 2, 0, T), mem(1, 3, 0, T));
    m.supports.push(sup(0, "pinned"), sup(1, "rollerX"));
    m.memberLoads.push({ member: 4, kind: "misfit", dL: 0.006, pat: "R", lc: "T" });
    return m;
  };
  ex.inclined = () => {
    const m = base("Beam on an inclined roller", "8 m beam, pinned on the left and on a roller sliding on a 30° slope on the right. The inclined reaction has a horizontal component that the pin must balance.");
    m.sections.push(wSection("W18x50"));
    m.nodes.push({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 }); m.members.push(mem(0, 1), mem(1, 2));
    m.supports.push(sup(0, "pinned"), { ...sup(2, "pinned"), ux: false, uy: false, incline: true, angle: 30 });
    m.nodeLoads.push(nload(1, 0, -100));
    const t = Math.tan(Math.PI / 6);
    m.references = [
      { label: "Vertical reaction at the roller", unit: "kN", ref: 50, source: "P/2", get: r => r.reactions.filter(q => q.dof === 7).reduce((a, q) => a + q.value, 0) },
      { label: "Horizontal reaction at the pin", unit: "kN", ref: 50 * t, source: "(P/2) tan 30°", get: r => r.reactions.filter(q => q.dof === 0).reduce((a, q) => a + q.value, 0) }];
    return m;
  };
  ex.shear = () => {
    const m = base("Deep cantilever, shear deformation", "Short 1.5 m cantilever of a deep section with shear area As = 45 cm². Timoshenko element: δ = PL³/3EI + PL/(G As).");
    const s = wSection("W18x50"); s.As = 45e-4; m.sections.push(s);
    m.nodes.push({ x: 0, y: 0 }, { x: 1.5, y: 0 }); m.members.push(mem(0, 1));
    m.supports.push(sup(0, "fixed")); m.nodeLoads.push(nload(1, 0, -200));
    const EI = s.E * s.I, G = s.E / 2.6;
    m.references = [
      { label: "Tip deflection (bending + shear)", unit: "m", ref: -(200 * 1.5 ** 3 / (3 * EI) + 200 * 1.5 / (G * s.As)), source: "PL³/3EI + PL/(G As)", get: r => r.u[4] },
      { label: "Shear share of the deflection", unit: "%", ref: 100 * (200 * 1.5 / (G * s.As)) / (200 * 1.5 ** 3 / (3 * EI) + 200 * 1.5 / (G * s.As)), source: "(PL/GAs)/δ", get: r => 100 * (1 - (200 * 1.5 ** 3 / (3 * EI)) / -r.u[4]) }];
    return m;
  };
  ex.semirigid = () => {
    const m = base("Portal frame, semi-rigid connections", "Beam-to-column connections modelled as rotational springs (kN·m/rad). Drag the connection sliders in the Members tab to go from pinned to rigid and watch the moments redistribute.");
    m.sections.push(wSection("W14x90"), wSection("W18x50"));
    m.nodes.push({ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 0 });
    m.members.push(mem(0, 1, 0), mem(1, 2, 1, { kI: 30000, kJ: 30000 }), mem(3, 2, 0));
    m.supports.push(sup(0, "pinned"), sup(3, "pinned"));
    m.memberLoads.push(udl(1, -30, "GY", "G")); m.nodeLoads.push(nload(1, 20, 0, 0, "R"));
    const s = wSection("W18x50"), EI = s.E * s.I, k = 30000, L = 6, w = 30;
    const b = base("Fixed-ended beam with spring connections"); void b;
    m.references = [];
    m.springRef = { w, L, k, EI };
    return m;
  };
  ex.springBeam = () => {
    const m = base("Beam with semi-rigid end connections", "Beam built into rigid walls through rotational springs k = 30 000 kN·m/rad. End moment M = (wL²/12)/(1 + 2EI/kL) runs from 0 (pinned) to wL²/12 (rigid).");
    const s = wSection("W18x50"); m.sections.push(s);
    m.nodes.push({ x: 0, y: 0 }, { x: 6, y: 0 }); m.members.push(mem(0, 1, 0, { kI: 30000, kJ: 30000 }));
    m.supports.push(sup(0, "fixed"), sup(1, "fixed")); m.memberLoads.push(udl(0, -20, "GY", "R"));
    const EI = s.E * s.I;
    m.references = [{ label: "End moment", unit: "kN·m", ref: 20 * 36 / 12 / (1 + 2 * EI / (30000 * 6)), source: "(wL²/12)/(1 + 2EI/kL)", get: r => Math.abs(memEnd(r, 0, 0, 2)) }];
    return m;
  };
  ex.influence = () => {
    const m = ex.twoSpan(); m.memberLoads = [];
    m.title = "Two-span beam, influence lines"; m.description = "Unit load crossing two equal spans. The influence line of the interior reaction is ξ(3 − ξ²)/2 in the first span; Müller-Breslau: it has the shape of the deflected beam when that support is pushed up by one unit.";
    Object.assign(m.settings, { analysis: "il", path: [0, 1], ilQuantity: { type: "reaction", node: 1, dir: 1 }, ilPositions: 120 });
    m.references = [{ label: "Interior reaction, unit load at 0.5L", unit: "kN/kN", ref: 0.6875, source: "ξ(3 − ξ²)/2 with ξ = 0.5", get: r => r.values[r.posH.findIndex(p => Math.abs(p - 3) < 1e-9)], analysis: "il" }];
    return m;
  };
  ex.combos = () => {
    const m = valLinear();
    m.title = "Two-story frame, load combinations"; m.description = "Dead load (D), live load on the beams (L) and wind (W). ASCE 7 strength combinations, envelopes and AISC 360 member checks.";
    m.memberLoads.forEach(l => { l.lc = "D"; l.w1 = -18; });
    m.memberLoads.push({ ...udl(4, -12, "GY", "R"), lc: "L" }, { ...udl(5, -6, "GY", "R"), lc: "L" });
    m.nodeLoads.forEach(l => { l.lc = "W"; });
    m.settings.analysis = "combo";
    return m;
  };
  ex.quake = () => {
    const m = templates.building.build({ stories: 3, bays: 2, h: 3.8, bw: 6, w: 25, F: 50, col: "W14x90", beam: "W18x50" });
    m.title = "3-story frame, earthquake time history"; m.description = "Synthetic ground motion (PGA 0.3 g) on the 3-story frame. Mass from self-weight and the gravity loads, 5 % Rayleigh damping, Newmark average acceleration.";
    m.nodeLoads = [];
    Object.assign(m.settings, { analysis: "th", thRecord: "synthetic", thPga: 0.3, thDuration: 15, zeta: 0.05, massFromLoads: true });
    return m;
  };

  const examples = [
    { key: "ssBeam", group: "Beams", build: ex.ssBeam }, { key: "twoSpan", group: "Beams", build: ex.twoSpan },
    { key: "settlement", group: "Beams", build: ex.settlement }, { key: "truss", group: "Trusses", build: ex.truss },
    { key: "portal", group: "Frames", build: ex.portal }, { key: "gable", group: "Frames", build: ex.gable },
    { key: "building", group: "Frames", build: ex.building }, { key: "euler", group: "Stability", build: ex.euler },
    { key: "beamColumn", group: "Stability", build: ex.beamColumn }, { key: "toggle", group: "Stability", build: ex.toggle },
    { key: "cantFreq", group: "Dynamics", build: ex.cantFreq }, { key: "movingBeam", group: "Moving loads", build: ex.movingBeam },
    { key: "bridge", group: "Moving loads", build: ex.bridge }, { key: "influence", group: "Moving loads", build: ex.influence },
    { key: "thermal", group: "Special loads and connections", build: ex.thermal }, { key: "misfit", group: "Special loads and connections", build: ex.misfit },
    { key: "inclined", group: "Special loads and connections", build: ex.inclined }, { key: "shear", group: "Special loads and connections", build: ex.shear },
    { key: "springBeam", group: "Special loads and connections", build: ex.springBeam }, { key: "semirigid", group: "Special loads and connections", build: ex.semirigid },
    { key: "combos", group: "Design", build: ex.combos }, { key: "quake", group: "Dynamics", build: ex.quake },
    ...validations.map(v => ({ key: v.key, group: "Validation cases", build: v.build }))
  ];

  const Examples = { validations, templates, examples, LIBRARY, wSection, rectSection, E_STEEL, FY, base, mem, sup, nload, udl, pload };
  if (typeof module !== "undefined" && module.exports) module.exports = Examples; else root.Examples = Examples;
})(typeof self !== "undefined" ? self : this);
