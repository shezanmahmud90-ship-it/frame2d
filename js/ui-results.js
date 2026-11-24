/* Frame2D Studio - analysis controls, results, method walkthrough, checks and damage study */
(function () {
  "use strict";
  const App = window.App, st = App.state, h = App.h, S = () => window.Solver;
  const fix = App.fix, fmt = App.fmt;

  const NOTES = {
    linear: "Direct stiffness method: [K]ff {Δ}f = {P}f − [K]fs {Δ}s. Updates as you edit.",
    second: "Corotational frame element solved by incremental Newton–Raphson under load control. Constant loads first, then λ × the variable loads.",
    buckling: "Eigenvalue problem ([K]e + λ[K]g){Δ} = 0 with [K]g from the first-order axial forces. λ multiplies all loads.",
    pushover: "Event-to-event plastic hinge analysis: a hinge forms where |M| reaches Mp = fy Z. Stops when a collapse mechanism forms.",
    arc: "Crisfield's cylindrical arc-length method follows the equilibrium path through limit points (snap-through).",
    modal: "Generalized eigenproblem [K]{φ} = ω²[M]{φ}. Mass from member self-weight (ρA), nodal masses and constant loads ÷ g.",
    moving: "An axle group crosses the chosen members in small steps; each position is a linear analysis. Gives force envelopes and reaction histories."
  };

  // ------------------------------------------------------------------ analysis options
  App.renderAnalysisOpts = function () {
    const m = st.model, s = m.settings, kind = st.analysis, box = App.$("#analysisOpts");
    App.$("#analysisType").value = kind;
    App.$("#analysisNote").textContent = NOTES[kind] || App.ADV_NOTES[kind] || "";
    const set = (k, v) => { s[k] = v; st.stale = st.res && st.res.kind !== "linear" ? true : st.stale; if (k === "nsub" || k === "interaction") App.modelChanged({ noHistory: true }); else App.renderRunMsg(); };
    const numF = (label, key, val, attrs) => h("label", { class: "field" }, label, h("input", Object.assign({ type: "number", step: "any", value: val, onchange: ev => set(key, ev.target.value === "" ? null : +ev.target.value) }, attrs || {})));
    const items = [];
    items.push(numF("Elements per member", "nsub", s.nsub || 1, { min: 1, max: 32, step: 1, title: "Subdivide every frame member into this many elements (finite element refinement)" }));
    if (kind === "second" || kind === "pushover") items.push(numF("Maximum load factor λ", "lamMax", s.lamMax || (kind === "pushover" ? 10 : 1), { min: 0 }));
    if (kind === "second") items.push(numF("Load steps", "steps", s.steps || 20, { min: 1, step: 1 }));
    if (kind === "pushover") items.push(numF("Load step Δλ", "dlam", s.dlam || 0.05, { min: 0.001 }));
    if (kind === "arc") items.push(numF("Displacement limit (mm)", "dispLimitMM", s.dispLimit ? s.dispLimit * 1000 : "", { min: 0, title: "Stop when the control displacement reaches this value" }));
    if (["second", "pushover", "arc"].includes(kind)) {
      const nodeSel = h("select", { onchange: ev => set("ctrlNode", +ev.target.value) }, h("option", { value: -1 }, "Largest load"), m.nodes.map((n, i) => h("option", { value: i }, `Node ${i + 1}`)));
      nodeSel.value = s.ctrlNode === undefined || s.ctrlNode === null ? -1 : s.ctrlNode;
      const dirSel = h("select", { onchange: ev => set("ctrlDir", +ev.target.value) }, h("option", { value: 0 }, "x"), h("option", { value: 1 }, "y"));
      dirSel.value = s.ctrlDir || 0;
      items.push(h("label", { class: "field" }, "Control node", nodeSel), h("label", { class: "field" }, "Control direction", dirSel));
    }
    if (kind === "modal") {
      const mt = h("select", { onchange: ev => set("massType", ev.target.value) }, h("option", { value: "consistent" }, "Consistent"), h("option", { value: "lumped" }, "Lumped (as STAAD.Pro)"));
      mt.value = s.massType || "consistent";
      items.push(h("label", { class: "field" }, "Mass matrix", mt), numF("Modes", "nmodes", s.nmodes || 6, { min: 1, max: 12, step: 1 }));
      items.push(h("label", { class: "check" }, h("input", { type: "checkbox", checked: s.massFromLoads !== false, onchange: ev => set("massFromLoads", ev.target.checked) }), "Add constant (gravity) loads ÷ g as mass"));
    }
    if (kind === "moving") {
      const txt = (label, key, val, title) => h("label", { class: "field" }, label, h("input", { value: val, title, onchange: ev => { s[key] = ev.target.value; st.stale = true; App.renderRunMsg(); } }));
      items.push(txt("Path members (in order)", "pathText", (s.path || []).map(i => i + 1).join(", "), "Members the vehicle travels along, e.g. 1, 2, 3"));
      items.push(numF("Positions", "positions", s.positions || 120, { min: 10, step: 1 }));
      items.push(txt("Axle loads (kN)", "axleLoads", s.axleLoads || "100", "e.g. 35, 145, 145"));
      items.push(txt("Axle spacings (m)", "axleSpacing", s.axleSpacing || "", "e.g. 4.3, 4.3"));
      const pin = box => { const inp = box.querySelector("input[title^='Members']"); if (inp) inp.onchange = ev => { s.path = ev.target.value.split(/[,; ]+/).map(Number).filter(v => v >= 1).map(v => v - 1); st.stale = true; App.renderRunMsg(); }; };
      setTimeout(() => pin(box), 0);
    }
    if (kind === "pushover") {
      items.push(h("label", { class: "check" }, h("input", { type: "checkbox", checked: s.geometric !== false, onchange: ev => set("geometric", ev.target.checked) }), "Include P-Δ (second-order) effects"));
      items.push(h("label", { class: "check" }, h("input", { type: "checkbox", checked: s.interaction !== false, onchange: ev => App.change(mm => { mm.settings.interaction = ev.target.checked; }) }), "Reduce Mp for axial force (P–M interaction)"));
    }
    if (App.advancedOpts) App.advancedOpts(kind, s, items, set, numF);
    box.replaceChildren(...items);
    // keep arc displacement limit in metres
    const dl = box.querySelector("input[title^='Stop']");
    if (dl) dl.onchange = ev => { s.dispLimit = ev.target.value === "" ? null : +ev.target.value / 1000; App.renderRunMsg(); };
  };

  App.analysisOptions = function (extra) {
    const s = st.model.settings;
    return Object.assign({ nsub: s.nsub || 1, lamMax: s.lamMax || undefined, steps: s.steps || 20, dlam: s.dlam || 0.05, geometric: s.geometric !== false,
      dispLimit: s.dispLimit || undefined, ctrlNode: s.ctrlNode === undefined || s.ctrlNode === null || s.ctrlNode < 0 ? undefined : s.ctrlNode, ctrlDir: s.ctrlDir || 0 }, extra || {});
  };

  App.runKind = function (kind, model, extra) {
    const o = App.analysisOptions(extra), m = model || st.model;
    if (kind === "linear") return S().linear(m, o);
    if (kind === "second") return S().secondOrder(m, { ...o, lamMax: o.lamMax || 1 });
    if (kind === "buckling") return S().buckling(m, o);
    if (kind === "pushover") return S().pushover(m, { ...o, lamMax: o.lamMax || 10 });
    if (kind === "arc") return S().arcLength(m, o);
    if (kind === "modal") { const s = m.settings; return window.Dyn.modal(m, { ...o, lumped: s.massType === "lumped", nmodes: s.nmodes || 6 }); }
    if (kind === "il" || kind === "combo" || kind === "th") return App.runAdvanced(kind, m, o);
    if (kind === "moving") {
      const s = m.settings;
      if (!s.path || !s.path.length) s.path = defaultPath(m);
      return window.Dyn.movingLoad(m, { ...o, path: s.path, positions: s.positions || 120, ctrlNode: o.ctrlNode });
    }
  };
  /** Longest chain of horizontal members at the highest level that carries members (deck guess). */
  App.defaultPath = m => defaultPath(m);
  function defaultPath(m) {
    const hor = m.members.map((q, i) => ({ q, i })).filter(({ q }) => Math.abs(m.nodes[q.i].y - m.nodes[q.j].y) < 1e-9);
    if (!hor.length) return m.members.length ? [0] : [];
    const y = Math.max(...hor.map(({ q }) => m.nodes[q.i].y));
    return hor.filter(({ q }) => Math.abs(m.nodes[q.i].y - y) < 1e-9).sort((a, b) => Math.min(m.nodes[a.q.i].x, m.nodes[a.q.j].x) - Math.min(m.nodes[b.q.i].x, m.nodes[b.q.j].x)).map(x => x.i);
  }

  App.run = function () {
    const kind = st.analysis, msg = App.$("#runMsg");
    if (!st.model.members.length) { msg.className = "runmsg bad"; msg.textContent = "Add members before running an analysis."; return; }
    msg.className = "runmsg"; msg.textContent = "Running…";
    App.$("#btnRun").disabled = true;
    setTimeout(() => {
      const t0 = performance.now();
      try {
        const res = App.runKind(kind);
        res.time = performance.now() - t0;
        st.res = res; st.stale = false; st.scenario = null;
        st.step = res.uH ? res.uH.length - 1 : 0;
        if (res.unstable || kind === "modal" || kind === "buckling") st.view = "mode";
        else if (kind === "moving") st.view = st.view === "deformed" ? "deformed" : "M";
        else if (kind === "il" || kind === "th") st.view = "deformed";
        else if (kind === "combo") st.view = "M";
        else if (st.view === "model" || st.view === "mode") st.view = kind === "linear" ? "M" : "deformed";
        if (kind === "modal" || kind === "buckling") res.modeIndex = 0;
      } catch (err) {
        console.error(err);
        st.res = null; msg.className = "runmsg bad"; msg.textContent = `The analysis stopped: ${err.message}. Check supports, releases and section properties.`;
      }
      App.$("#btnRun").disabled = false;
      App.setView(st.view, true);
      App.afterRun();
    }, 20);
  };

  App.afterRun = function () {
    App.stopPlay();
    App.renderRunMsg(); App.updateStepbar(); App.renderRight();
    const r = st.res;
    if (r && r.uH && r.uH.length > 1 && r.kind !== "combo" && !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) { st.step = 0; App.updateStepbar(); App.play(true); }
    else App.startGrow();
    App.ensureLoop(); App.render();
  };

  App.renderRunMsg = function () {
    const msg = App.$("#runMsg"), r = st.res;
    msg.className = "runmsg";
    if (!r) { msg.textContent = st.analysis === "linear" && !st.live ? "Press Run analysis to solve." : ""; return; }
    if (st.stale && r.kind !== "linear") { msg.className = "runmsg stale"; msg.textContent = "The model or settings changed. Run the analysis again to update these results."; return; }
    if (r.unstable) { msg.className = "runmsg bad"; msg.textContent = "The structure is unstable: [K]ff is singular. The Mode view shows the mechanism."; return; }
    const t = r.time ? ` in ${r.time < 1000 ? Math.round(r.time) + " ms" : (r.time / 1000).toFixed(1) + " s"}` : "";
    const scen = st.scenario ? ` Showing scenario: ${st.scenario}.` : "";
    msg.textContent = `${{ linear: "Linear analysis", second: "Second-order analysis", buckling: "Buckling analysis", pushover: "Plastic collapse analysis", arc: "Arc-length analysis", modal: "Modal analysis", moving: "Moving-load analysis", il: "Influence line", combo: "Load combinations", th: "Time-history analysis" }[r.kind]} finished${t}.${scen}` + (r.note ? ` ${r.note}.` : "");
    if (r.note && /no convergence|failed|stopped/i.test(r.note) && r.kind !== "pushover") msg.className = "runmsg warn";
  };

  // ------------------------------------------------------------------ step bar
  App.updateStepbar = function () {
    const r = App.shownResult(), bar = App.$("#stepbar");
    if (!r || !r.uH || r.uH.length < 2 || st.view === "model" || st.view === "mode") { bar.hidden = true; return; }
    bar.hidden = false;
    const sl = App.$("#stepSlider"); sl.max = r.uH.length - 1; sl.value = Math.min(st.step, r.uH.length - 1);
    App.$("#stepLabel").textContent = r.kind === "il" ? `Unit load at ${fix(r.posH[sl.value], 2)} m, ordinate ${fmt(r.values[sl.value], 4)}` : r.kind === "combo" ? `${r.combos[sl.value].name}` : r.kind === "th" ? `t = ${fix(r.frameT[sl.value], 2)} s of ${fix(r.tH[r.tH.length - 1], 1)} s` : r.kind === "moving" ? `Front axle at ${fix(r.posH[sl.value], 2)} m of ${fix(r.geo.length, 2)} m` : `Step ${sl.value} of ${r.uH.length - 1}, λ = ${fmt(r.lamH[sl.value], 4)}`;
  };

  // ------------------------------------------------------------------ right tabs
  App.renderRight = function () {
    const body = App.$("#rightBody");
    document.querySelectorAll("#rightTabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === st.rightTab));
    const scroll = body.scrollTop;
    let kids;
    try { kids = [].concat({ results: resultsTab, method: methodTab, checks: checksTab, damage: damageTab }[st.rightTab]()); }
    catch (err) { console.error(err); kids = [h("p", { class: "note bad" }, `Could not show this panel: ${err.message}`)]; }
    body.replaceChildren(...kids.filter(Boolean));
    body.scrollTop = scroll;
  };

  function tiles(list) { return h("div", { class: "tiles" }, list.map(t => h("div", { class: "tile" + (t.big ? " big" : "") }, h("div", { class: "v", style: t.color ? `color:${t.color}` : null }, t.v), h("div", { class: "k" }, t.k), t.w ? h("div", { class: "w" }, t.w) : null))); }
  function table(head, rows, opts) {
    opts = opts || {};
    const t = h("table", { class: "data" }, h("thead", null, h("tr", null, head.map(x => h("th", null, x)))));
    const tb = h("tbody");
    rows.forEach((r, i) => {
      const tr = h("tr", { class: (opts.onclick ? "click" : "") + (opts.active === i ? " on" : "") }, r.map(c => (c && c.nodeType) ? h("td", null, c) : (c && typeof c === "object" && "v" in c) ? h("td", { class: c.cls || null }, c.v) : h("td", null, c)));
      if (opts.onclick) tr.addEventListener("click", () => opts.onclick(i));
      tb.append(tr);
    });
    t.append(tb);
    return h("div", { class: "scroll-x" }, t);
  }

  /** Internal N, V, M at the ends of every original member for a state. */
  function memberEndTable(stt) {
    const A = stt.A, rows = [];
    st.model.members.forEach((q, mi) => {
      const els = A.memberEls[mi]; if (!els || !els.length) return;
      [[els[0], 0], [els[els.length - 1], 1]].forEach(([e, end]) => {
        const el = A.els[e], loads = S().elemLoads(el, stt.g, stt.lam), qv = S().elemQ(el, stt.g, stt.lam);
        const fn = S().fieldFn(el, stt.infos[e], loads, qv), x = end === 0 ? 1e-9 : el.L0 - 1e-9, r = fn(x);
        rows.push([end === 0 ? `${mi + 1}` : "", end === 0 ? `i (node ${q.i + 1})` : `j (node ${q.j + 1})`, fix(r.N), fix(r.V), fix(r.M)]);
      });
    });
    return rows;
  }
  function extremes(stt) {
    const A = stt.A, out = { N: [0, -1], V: [0, -1], M: [0, -1], Nt: 0, Nc: 0 };
    A.els.forEach((el, e) => {
      const smp = S().sampleElement(el, stt.infos[e], S().elemLoads(el, stt.g, stt.lam), S().elemQ(el, stt.g, stt.lam), 16);
      for (const k of ["N", "V", "M"]) smp[k].forEach(v => { if (Math.abs(v) > Math.abs(out[k][0])) out[k] = [v, el.parent]; });
      smp.N.forEach(v => { out.Nt = Math.max(out.Nt, v); out.Nc = Math.min(out.Nc, v); });
    });
    let du = [0, -1]; for (let n = 0; n < st.model.nodes.length; n++) { const d = Math.hypot(stt.u[3 * n], stt.u[3 * n + 1]); if (d > du[0]) du = [d, n]; }
    out.D = du; return out;
  }
  function stateTables(stt, res) {
    const out = [];
    const nn = st.model.nodes.length;
    out.push(h("h3", null, "Node displacements"));
    const rows = []; for (let n = 0; n < nn; n++) rows.push([n + 1, App.mm(stt.u[3 * n]), App.mm(stt.u[3 * n + 1]), fix(stt.u[3 * n + 2] * 1000, 3)]);
    out.push(table(["Node", "u (mm)", "v (mm)", "θ (mrad)"], rows));
    out.push(h("h3", null, "Support reactions"));
    const P = new Float64Array(stt.A.ndof); for (let d = 0; d < P.length; d++) P[d] = stt.g * stt.A.P0[d] + stt.lam * stt.A.Pr[d];
    const rr = new Map();
    stt.A.fixedList.forEach(d => { const n = Math.floor(d / 3); if (n >= nn) return; if (!rr.has(n)) rr.set(n, ["", "", ""]); rr.get(n)[d % 3] = fix(stt.F[d] - P[d]); });
    stt.A.springs.forEach((k, d) => { const n = Math.floor(d / 3); if (stt.A.fixed.has(d)) return; if (!rr.has(n)) rr.set(n, ["", "", ""]); rr.get(n)[d % 3] = fix(-k * stt.u[d]) + " (spring)"; });
    out.push(table(["Node", "Rx (kN)", "Ry (kN)", "M (kN·m)"], [...rr.entries()].sort((a, b) => a[0] - b[0]).map(([n, v]) => [n + 1, ...v])));
    out.push(h("h3", null, "Member end forces"));
    out.push(h("p", { class: "note" }, "Internal forces at the member ends: N tension positive, M sagging positive (tension on the local −y side)."));
    out.push(table(["Member", "End", "N (kN)", "V (kN)", "M (kN·m)"], memberEndTable(stt)));
    void res;
    return out;
  }

  // ------------------------------------------------------------------ Results tab
  /** Sign so the control displacement plots positive in the direction of the load. */
  function ctrlSign(res) { const A = res.A, d = res.ctrl; const p = A.Pr[d] || A.P0[d]; if (p) return Math.sign(p); const last = res.ctrlH[res.ctrlH.length - 1]; return last < 0 ? -1 : 1; }
  function ctrlLabel(res) { return `${ctrlSign(res) < 0 ? "−" : ""}${App.dofName(res.ctrl)} (mm)`; }
  App.ctrlSign = ctrlSign;
  function resultsTab() {
    const res = App.shownResult();
    if (!res) return [h("p", { class: "note" }, st.model.members.length ? "Run an analysis to see results." : "Start from an example or a template, or draw nodes and members on the grid.")];
    const out = [];
    if (res.unstable) {
      out.push(h("p", { class: "note bad" }, "The structure is unstable. The stiffness matrix of the free degrees of freedom is singular, so there is a mechanism. Add supports or remove pins; the Mode view shows the mechanism."));
      out.push(h("button", { onclick: () => App.setView("mode") }, "Show the mechanism"));
      return out;
    }
    const stt = App.stateOf(res);
    if (App.advancedResults && App.advancedResults(res, out)) {
      out.push(App.comparePanel(res));
      if (stt) { out.push(h("p", { class: "note" }, res.kind === "combo" ? `Tables below are for ${res.combos[stt.k].name}.` : res.kind === "th" ? `Tables below are at t = ${fix(res.frameT[stt.k], 2)} s (dynamic forces, no gravity).` : `Tables below are for the unit load at ${fix(res.posH[stt.k], 2)} m.`)); out.push(...stateTables(stt, res)); }
      return out;
    }
    if (res.kind === "linear") {
      const ex = extremes(stt);
      const allTruss = st.model.members.every(q => q.type === "truss");
      if (allTruss) out.push(tiles([{ v: `${App.mm(ex.D[0])} mm`, k: "Largest displacement", w: ex.D[1] >= 0 ? `node ${ex.D[1] + 1}` : "" }, { v: `${fix(ex.Nt)} / ${fix(-ex.Nc)}`, k: "Max tension / compression (kN)", w: "axial force" }]));
      else out.push(tiles([
        { v: `${App.mm(ex.D[0])} mm`, k: "Largest displacement", w: ex.D[1] >= 0 ? `node ${ex.D[1] + 1}` : "" },
        { v: `${fix(Math.abs(ex.M[0]))} kN·m`, k: "Largest moment", w: ex.M[1] >= 0 ? `member ${ex.M[1] + 1}` : "" },
        { v: `${fix(Math.abs(ex.V[0]))} kN`, k: "Largest shear", w: ex.V[1] >= 0 ? `member ${ex.V[1] + 1}` : "" },
        { v: `${fix(ex.Nt)} / ${fix(-ex.Nc)}`, k: "Max tension / compression (kN)", w: "axial force" }]));
    } else if (res.kind === "second") {
      const k = res.lamH.length - 1, lin = res.linCtrl[k], non = res.ctrlH[k];
      out.push(tiles([
        { v: fmt(res.lam, 4), k: "Load factor reached", w: res.note ? "stopped early" : "target reached", big: false },
        { v: `${App.mm(non)} mm`, k: `Control displacement, ${App.dofName(res.ctrl)}` },
        { v: Math.abs(lin) > 1e-15 ? `${fix(non / lin, 3)}` : "–", k: "Second-order amplification", w: "second-order ÷ first-order" },
        { v: `${Math.max(...res.itH)}`, k: "Most Newton–Raphson iterations in a step" }]));
      out.push(h("h3", null, "Load–displacement path"));
      const sg = ctrlSign(res);
      out.push(App.chart([{ x: res.ctrlH.map(v => sg * v * 1000), y: res.lamH, color: "var(--deformed)", label: "Second order" }, { x: res.linCtrl.map(v => sg * v * 1000), y: res.lamH, color: "#8A949C", dash: "5 4", label: "First order" }],
        { xlabel: ctrlLabel(res), ylabel: "λ", marker: { x: sg * res.ctrlH[Math.min(st.step, k)] * 1000, y: res.lamH[Math.min(st.step, k)] } }));
    } else if (res.kind === "modal") {
      const m0 = res.modes[0] || {};
      out.push(tiles([{ v: `${fmt(m0.f, 4)} Hz`, k: "Fundamental frequency f₁", w: `period T₁ = ${fmt(m0.T, 4)} s`, big: true },
        { v: `${fmt(res.totalMass, 4)} t`, k: "Total mass", w: res.lumped ? "lumped mass matrix" : "consistent mass matrix" },
        { v: `${res.modes.length}`, k: "Modes found" }]));
      out.push(h("h3", null, "Natural frequencies"));
      let cx = 0, cy = 0;
      out.push(table(["Mode", "f (Hz)", "T (s)", "ω (rad/s)", "Mass x %", "Mass y %"], res.modes.map((md, i) => { cx += md.effX; cy += md.effY; return [i + 1, fmt(md.f, 5), fmt(md.T, 4), fmt(md.omega, 5), fix(100 * md.effX, 1), fix(100 * md.effY, 1)]; }),
        { onclick: i => { res.mode = res.modes[i].mode; res.modeIndex = i; App.setView("mode"); App.renderRight(); }, active: res.modeIndex || 0 }));
      out.push(h("p", { class: "note" }, `Cumulative effective mass: ${fix(100 * cx, 1)} % in x, ${fix(100 * cy, 1)} % in y. Click a row to animate that mode.`));
      const fs = res.modes.map((md, i) => ({ x: i + 1, y: md.f }));
      out.push(App.chart([{ x: fs.map(p => p.x), y: fs.map(p => p.y), color: "var(--moment)", points: fs.map(p => ({ ...p, r: 4 })) }], { xlabel: "mode", ylabel: "f (Hz)", height: 170 }));
      return out;
    } else if (res.kind === "moving") {
      const rmax = res.reactions.reduce((a, r) => Math.abs(r.max) > Math.abs(a.v) ? { v: r.max, d: r.dof } : a, { v: 0, d: -1 });
      out.push(tiles([
        { v: `${fix(res.maxM.v)} kN·m`, k: "Largest sagging moment", w: res.maxM.member !== undefined ? `member ${res.maxM.member + 1}, axle front at ${fix(res.maxM.s, 2)} m` : "" },
        { v: `${fix(res.minM.v)} kN·m`, k: "Largest hogging moment", w: res.minM.member !== undefined ? `member ${res.minM.member + 1}` : "" },
        { v: `${fix(rmax.v)} kN`, k: "Largest reaction", w: rmax.d >= 0 ? App.dofName(rmax.d).replace("u", "Rx at node ").replace("v", "Ry at node ").replace("θ", "M at node ") : "" },
        { v: `${App.mm(Math.max(...res.ctrlH.map(Math.abs)))} mm`, k: `Largest |${App.dofName(res.ctrl)}|` }]));
      out.push(h("h3", null, "Reaction histories (influence lines × axle loads)"));
      const cols = ["var(--action)", "var(--compression)", "var(--reaction)", "var(--moment)", "var(--shear)", "var(--deformed)"];
      const vr = res.reactions.filter(r => r.dof % 3 === 1);
      out.push(App.chart(vr.map((r, i) => ({ x: res.posH, y: r.hist, color: cols[i % cols.length], label: `Ry node ${Math.floor(r.dof / 3) + 1}` })), { xlabel: "front axle position (m)", ylabel: "kN", marker: { x: res.posH[st.step], y: vr.length ? vr[0].hist[st.step] : 0 } }));
      out.push(h("h3", null, `Displacement history, ${App.dofName(res.ctrl)}`));
      out.push(App.chart([{ x: res.posH, y: res.ctrlH.map(v => v * 1000), color: "var(--deformed)" }], { xlabel: "front axle position (m)", ylabel: "mm", height: 170, marker: { x: res.posH[st.step], y: res.ctrlH[st.step] * 1000 } }));
      out.push(h("p", { class: "note" }, "The Moment and Shear views show the envelopes (dashed) with the diagram for the current position. Press play under the drawing to drive the vehicle across."));
    } else if (res.kind === "buckling") {
      out.push(tiles([{ v: fmt(res.lamCr, 5), k: "Elastic critical load factor λcr", w: "critical loads = λcr × applied loads", big: true }]));
      out.push(h("h3", null, "Buckling modes"));
      out.push(table(["Mode", "λcr"], res.modes.map((md, i) => [i + 1, fmt(md.lam, 6)]), { onclick: i => { res.mode = res.modes[i].mode; res.modeIndex = i; App.setView("mode"); App.renderRight(); }, active: res.modeIndex || 0 }));
      out.push(h("p", { class: "note" }, `Each frame member is split into ${st.model.settings.nsub || 1} element(s). Buckling loads converge from above as the mesh is refined; the Checks tab runs a convergence study.`));
      return out;
    } else if (res.kind === "pushover") {
      const ok = res.status === "collapse";
      out.push(tiles([
        { v: fmt(res.lamLim, 5), k: ok ? "Collapse load factor λ" : "Last load factor reached", w: ok ? "mechanism formed" : "inconclusive: no mechanism yet", color: ok ? null : "var(--warn)", big: true },
        { v: `${res.events.length}`, k: "Plastic hinges formed" }, { v: `${App.mm(res.ctrlH[res.ctrlH.length - 1])} mm`, k: `Final ${App.dofName(res.ctrl)}` }]));
      out.push(h("h3", null, "Load–displacement path"));
      const sg = ctrlSign(res);
      const pts = res.events.map((ev, i) => ({ x: sg * res.ctrlH[ev.step] * 1000, y: ev.lam, color: "var(--hinge)", label: i < 12 ? String(i + 1) : "" }));
      out.push(App.chart([{ x: res.ctrlH.map(v => sg * v * 1000), y: res.lamH, color: "var(--deformed)", points: pts }], { xlabel: ctrlLabel(res), ylabel: "λ", marker: { x: sg * res.ctrlH[st.step] * 1000, y: res.lamH[st.step] } }));
      out.push(h("h3", null, "Hinge sequence"));
      out.push(table(["#", "λ", "Member", "Node"], res.events.map((ev, i) => [i + 1, fmt(ev.lam, 5), ev.member + 1, ev.node < st.model.nodes.length ? ev.node + 1 : `inside`]), { onclick: i => { st.step = res.events[i].step; App.updateStepbar(); App.render(); App.renderRight(); } }));
    } else if (res.kind === "arc") {
      out.push(tiles([{ v: res.lamPeak ? fmt(res.lamPeak, 5) : "–", k: "Limit load factor (first peak)", w: res.lamPeak ? `step ${res.peakStep}` : "no limit point on the traced path", big: true },
        { v: `${res.lamH.length - 1}`, k: "Arc-length steps" }, { v: `${App.mm(res.ctrlH[res.ctrlH.length - 1])} mm`, k: `Final ${App.dofName(res.ctrl)}` }]));
      out.push(h("h3", null, "Equilibrium path"));
      const sg = ctrlSign(res);
      out.push(App.chart([{ x: res.ctrlH.map(v => sg * v * 1000), y: res.lamH, color: "var(--deformed)", points: res.peakStep ? [{ x: sg * res.ctrlH[res.peakStep] * 1000, y: res.lamPeak, color: "var(--hinge)", label: "limit point" }] : [] }],
        { xlabel: ctrlLabel(res), ylabel: "λ", marker: { x: sg * res.ctrlH[st.step] * 1000, y: res.lamH[st.step] } }));
      out.push(h("p", { class: "note" }, "Under load control the solution would jump past the limit point; the arc-length constraint lets λ decrease so the unstable branch can be traced."));
    }
    if (res.kind === "moving") out.push(h("p", { class: "note" }, `Tables below are for the vehicle position shown (front axle at ${fix(res.posH[stt.k], 2)} m).`));
    else if (res.kind !== "linear") out.push(h("p", { class: "note" }, `Tables below are at step ${stt.k !== undefined ? stt.k : 0}, λ = ${fmt(stt.lam, 4)}. Move the step slider under the drawing to change it.`));
    if (res.kind === "linear" || res.kind === "second") out.push(App.aiscPanel(res), App.comparePanel(res));
    out.push(...stateTables(stt, res));
    return out;
  }

  // ------------------------------------------------------------------ Method tab
  function numbering(A) {
    const order = [...A.free, ...A.fixedList];
    const num = new Map(); order.forEach((d, k) => num.set(d, k + 1));
    return { order, num, nf: A.free.length };
  }
  function matrixTable(M, rowLab, colLab, opts) {
    opts = opts || {};
    const n = M.length, m = n ? M[0].length : 0;
    let mx = 0; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) mx = Math.max(mx, Math.abs(M[i][j]));
    const t = h("table", { class: "mat" });
    t.append(h("tr", null, h("th", { class: "rowh" }, ""), colLab.map(c => h("th", null, c))));
    for (let i = 0; i < n; i++) {
      const tr = h("tr", { class: opts.partRow === i + 1 ? "part-b" : null }, h("th", { class: "rowh" }, rowLab[i]));
      for (let j = 0; j < m; j++) {
        const v = M[i][j], a = mx > 0 ? Math.abs(v) / mx : 0;
        const bg = v === 0 ? "" : `background:${v > 0 ? `rgba(45,108,223,${(0.08 + 0.35 * Math.sqrt(a)).toFixed(3)})` : `rgba(201,42,42,${(0.08 + 0.35 * Math.sqrt(a)).toFixed(3)})`}`;
        const cls = [opts.partCol === j + 1 ? "part-r" : "", opts.hl && opts.hl(i, j) ? "hl" : ""].join(" ").trim();
        tr.append(h("td", { class: cls || null, style: bg || null }, v === 0 ? "0" : (opts.fmt || fmtM)(v)));
      }
      t.append(tr);
    }
    return h("div", { class: "mat-wrap" }, t);
  }
  const fmtM = v => { const a = Math.abs(v); if (a >= 1e4 || a < 1e-2) return v.toExponential(3).replace("e+", "e"); return (+v.toPrecision(5)).toString(); };
  function heatmap(M, nf, hl) {
    const n = M.length, c = document.createElement("canvas"); c.width = n; c.height = n; c.className = "heat";
    const g = c.getContext("2d"), img = g.createImageData(n, n);
    let mx = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) mx = Math.max(mx, Math.abs(M[i][j]));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = M[i][j], a = v === 0 ? 0 : 0.25 + 0.75 * Math.pow(Math.abs(v) / mx, 0.25), p = 4 * (i * n + j);
      const col = v === 0 ? [250, 251, 249] : v > 0 ? [45, 108, 223] : [201, 42, 42];
      const isHl = hl && hl(i, j);
      for (let k = 0; k < 3; k++) img.data[p + k] = isHl ? [232, 89, 12][k] : Math.round(255 - (255 - col[k]) * a);
      img.data[p + 3] = 255;
      if (i === nf || j === nf) { img.data[p] = 35; img.data[p + 1] = 40; img.data[p + 2] = 44; }
    }
    g.putImageData(img, 0, 0); return c;
  }

  function methodTab() {
    const res = st.lin;
    if (!res || !res.K) return [h("p", { class: "note" }, "The method walkthrough needs a model with members and supports.")];
    const A = res.A, out = [];
    if (App.playMethodPanel) out.push(App.playMethodPanel());
    out.push(h("p", { class: "note" }, "The direct stiffness method for this model, step by step (McGuire, Gallagher and Ziemian, Ch. 2–5 and 7). Values are for the linear analysis with all loads at λ = 1."));
    if (res.unstable) out.push(h("p", { class: "note bad" }, "This model is unstable, so step 5 cannot be solved. Steps 1–4 still show how [K] is built."));
    const { order, num, nf } = numbering(A);
    const lab = d => `${num.get(d) || "–"}`;
    const dofTxt = d => `${App.dofName(d)}`;
    // element choice
    const elOpts = A.els.map((el, e) => h("option", { value: e }, el.nsub > 1 ? `Member ${el.parent + 1}, element ${el.k + 1} of ${el.nsub}` : `Member ${el.parent + 1}`));
    if (st.methodEl >= A.els.length) st.methodEl = 0;
    const e = st.methodEl, em = S().elementMatrices(res, e), el = em.el;
    const pick = h("select", { onchange: ev => { st.methodEl = +ev.target.value; const pe = A.els[st.methodEl].parent; st.sel = { kind: "member", i: pe }; App.renderRight(); App.render(); } }, elOpts);
    pick.value = e;

    // 1 DOF numbering
    const s1 = h("div", { class: "step", "data-n": 1 }, h("h4", null, "Number the degrees of freedom"),
      h("p", null, `Each node has u, v and θ. Free DOFs are numbered first (1–${nf}), restrained DOFs after them (${nf + 1}–${order.length}), so [K] partitions into free and support blocks.` +
        (A.removedDofs.size ? ` ${A.removedDofs.size} rotation(s) at pin-only joints have no stiffness and are left out.` : "")));
    const rows = []; for (let n = 0; n < A.X.length; n++) rows.push([n < A.nOrig ? `${n + 1}` : `${n + 1} (internal)`, lab(3 * n), lab(3 * n + 1), lab(3 * n + 2)]);
    s1.append(table(["Node", "u", "v", "θ"], rows));
    out.push(s1);

    // 2 element stiffness
    const code = em.dofs.map(lab);
    const s2 = h("div", { class: "step", "data-n": 2 }, h("h4", null, "Element stiffness and transformation"),
      h("div", { class: "inline-form" }, h("label", { class: "field" }, "Element", pick)),
      h("dl", { class: "kv" }, h("dt", null, "Length L"), h("dd", null, `${fix(el.L0, 4)} m`), h("dt", null, "cos θ, sin θ"), h("dd", null, `${fix(el.c0, 4)}, ${fix(el.s0n, 4)}`),
        h("dt", null, "EA/L, EI/L"), h("dd", null, `${fmt(el.E * el.A / el.L0, 4)} kN/m, ${fmt(el.E * el.I / el.L0, 4)} kN·m`),
        h("dt", null, "Code numbers"), h("dd", null, code.join(", "))),
      h("p", null, el.truss ? "Truss element: axial stiffness only (both ends released)." : (el.relI || el.relJ) ? "Frame element with a moment release: the released rotation is condensed out, so the matrix has a zero row and column there." : "Frame element: axial terms EA/L and Hermitian bending terms 12EI/L³, 6EI/L², 4EI/L, 2EI/L."),
      h("div", { class: "eq" }, "[k′] local"), matrixTable(em.kLocal, ["u1", "v1", "θ1", "u2", "v2", "θ2"], ["u1", "v1", "θ1", "u2", "v2", "θ2"]),
      h("div", { class: "eq" }, "[Γ] transformation, {Δ′} = [Γ]{Δ}"), matrixTable(em.Gamma, ["1", "2", "3", "4", "5", "6"], ["1", "2", "3", "4", "5", "6"], { fmt: v => fix(v, 4) }),
      h("div", { class: "eq" }, "[k] = [Γ]ᵀ[k′][Γ] global, rows and columns are code numbers"), matrixTable(em.kGlobal, code, code));
    out.push(s2);

    // 3 assembly
    const Kp = order.map(r => order.map(c => res.K[r][c]));
    const elSet = new Set(em.dofs.map(d => order.indexOf(d)));
    const hl = (i, j) => elSet.has(i) && elSet.has(j);
    const s3 = h("div", { class: "step", "data-n": 3 }, h("h4", null, "Assemble the global stiffness matrix"),
      h("p", null, `Each [k] is added into [K] at its code numbers (outlined cells for the chosen element). [K] is ${order.length} × ${order.length}; the lines separate [K]ff, [K]fs, [K]sf and [K]ss.`));
    if (order.length <= 42) s3.append(matrixTable(Kp, order.map(d => `${num.get(d)} ${dofTxt(d)}`), order.map(d => `${num.get(d)}`), { partRow: nf, partCol: nf, hl }));
    else s3.append(h("p", null, "Too large to list: each pixel below is one coefficient (blue positive, red negative, orange the chosen element)."), heatmap(Kp, nf, hl));
    out.push(s3);

    // 4 load vector
    const Pn = new Float64Array(A.ndof);
    st.model.nodeLoads.forEach(l => { if (l.node < A.nOrig) { Pn[3 * l.node] += +l.fx || 0; Pn[3 * l.node + 1] += +l.fy || 0; Pn[3 * l.node + 2] += +l.mz || 0; } });
    const Peff = A.free.map(d => res.P[d] - res.F0[d]);
    const s4 = h("div", { class: "step", "data-n": 4 }, h("h4", null, "Form the load vector"),
      h("p", null, "Member loads enter as equivalent nodal loads {F}d = ∫[N]ᵀ q dx (Sec. 7.5), computed with the Hermitian shape functions. At released ends they are condensed like the stiffness."),
      table(["DOF", "Nodal", "Equivalent", "{P}f"], A.free.map((d, k) => [`${num.get(d)} ${dofTxt(d)}`, fix(Pn[d]), fix(Peff[k] - Pn[d]), fix(Peff[k])])));
    if (el.loadsG.length || el.loadsR.length) s4.append(h("p", null, "Fixed-end forces {F′}fixed of the chosen element (local):"), matrixTable([em.fef], ["F′f"], ["Fx1", "Fy1", "M1", "Fx2", "Fy2", "M2"]));
    if (A.presc.some(v => v)) s4.append(h("p", null, "Prescribed support movements {Δ}s: " + A.fixedList.filter(d => A.presc[d]).map(d => `${num.get(d)} ${dofTxt(d)} = ${App.mm(A.presc[d])} mm`).join(", ")));
    out.push(s4);
    if (res.unstable) return out;

    // 5 solve
    const s5 = h("div", { class: "step", "data-n": 5 }, h("h4", null, "Solve for the free displacements"),
      h("div", { class: "eq" }, "{Δ}f = [K]ff⁻¹ ({P}f − [K]fs {Δ}s)"),
      h("p", null, "[K]ff is symmetric and positive definite for a stable structure, so it is factored by Cholesky decomposition."),
      table(["DOF", "Δ", "Unit"], A.free.map(d => [`${num.get(d)} ${dofTxt(d)}`, d % 3 === 2 ? fix(res.u[d] * 1000, 4) : App.mm(res.u[d]), d % 3 === 2 ? "mrad" : "mm"])));
    out.push(s5);
    // 6 reactions
    const s6 = h("div", { class: "step", "data-n": 6 }, h("h4", null, "Recover the reactions"), h("div", { class: "eq" }, "{R}s = [K]sf {Δ}f + [K]ss {Δ}s − {P}s"),
      table(["DOF", "Reaction"], A.fixedList.map(d => [`${num.get(d)} ${dofTxt(d)}`, fix(res.F[d] - res.P[d])])));
    out.push(s6);
    // 7 member forces
    const s7 = h("div", { class: "step", "data-n": 7 }, h("h4", null, "Member end forces"), h("div", { class: "eq" }, "{F′} = [k′][Γ]{Δ} + {F′}fixed"),
      h("p", null, "For the chosen element (local axes, forces acting on the member ends, counter-clockwise moments positive):"),
      matrixTable([Array.from(em.dGlobal), Array.from(em.dLocal), Array.from(em.endForces)], ["{Δ} global", "{Δ′} local", "{F′}"], ["1", "2", "3", "4", "5", "6"]));
    out.push(s7);
    return out;
  }

  // ------------------------------------------------------------------ Checks tab
  function checksTab() {
    const out = [], lin = st.lin, m = st.model;
    if (m.references && m.references.length) {
      out.push(h("h3", null, "Comparison with closed-form solutions"));
      const cache = st.refCache = st.refCache && st.refCache.model === m && !st.refCache.dirty ? st.refCache : { model: m, rows: null };
      if (cache.rows) {
        out.push(table(["Quantity", "Frame2D", "Reference", "Error"], cache.rows.map(r => [h("span", { title: r.source }, r.label), fmt(r.v, 6), h("span", { title: r.source }, fmt(r.ref, 6)), { v: `${(Math.abs(r.err) < 5e-5 ? 0 : r.err).toFixed(Math.abs(r.err) < 0.01 ? 4 : 3)} %`, cls: Math.abs(r.err) <= (r.tol || 0.1) ? "pass" : "fail" }])));
        out.push(h("p", { class: "note" }, cache.rows.map(r => `${r.label}: ${r.source}`).join(". ") + "."));
      } else out.push(h("p", { class: "note" }, "Closed-form references are available for this example."));
      out.push(h("button", { onclick: () => { runReferences(); App.renderRight(); } }, cache.rows ? "Run the checks again" : "Run the reference checks"));
    }
    if (!lin || lin.unstable || !lin.K) { out.push(h("p", { class: "note" }, lin && lin.unstable ? "The model is unstable, so the equilibrium and stiffness checks are not available." : "Build a model to see the checks.")); return out; }
    // equilibrium
    const eq = S().equilibrium(lin), sc = Math.max(1, Math.abs(eq.applied.fx), Math.abs(eq.applied.fy));
    const okEq = Math.max(Math.abs(eq.residual.fx), Math.abs(eq.residual.fy)) <= 1e-8 * sc;
    out.push(h("h3", null, "Global equilibrium (linear)"));
    out.push(table(["", "Applied", "Applied + reactions"], [["ΣFx (kN)", fix(eq.applied.fx), fmt(eq.residual.fx, 3)], ["ΣFy (kN)", fix(eq.applied.fy), fmt(eq.residual.fy, 3)], ["ΣM about origin (kN·m)", fix(eq.applied.m), fmt(eq.residual.m, 3)]]));
    out.push(h("p", { class: "note" }, h("span", { class: "badge " + (okEq ? "ok" : "bad") }, okEq ? "Satisfied" : "Not satisfied"), " Loads and reactions balance to round-off."));
    // stiffness properties
    const kp = S().stiffnessProperties(lin);
    out.push(h("h3", null, "Properties of the stiffness matrix"));
    const yes = (b, t, f) => h("span", { class: "badge " + (b ? "ok" : "bad") }, b ? t : f);
    out.push(h("dl", { class: "kv" },
      h("dt", null, "Symmetric, [K] = [K]ᵀ (Maxwell–Betti)"), h("dd", null, yes(kp.symmetric, "Yes", "No")),
      h("dt", null, "Positive diagonal terms"), h("dd", null, yes(kp.diagPositive, "Yes", "No")),
      kp.zeroModes !== undefined ? [h("dt", null, "Zero eigenvalues of [K] before supports"), h("dd", null, `${kp.zeroModes}`)] : null,
      kp.posDef !== undefined ? [h("dt", null, "[K]ff positive definite after supports"), h("dd", null, yes(kp.posDef, "Yes", "No"))] : null,
      kp.cond !== undefined ? [h("dt", null, "Condition number of [K]ff"), h("dd", null, fmt(kp.cond, 3))] : null,
      h("dt", null, "Size of [K], free / restrained"), h("dd", null, `${kp.n}, ${kp.nf} / ${kp.ns}`)));
    if (kp.zeroModes !== undefined) out.push(h("p", { class: "note" }, `The unsupported structure has ${kp.zeroModes} zero-energy modes: three rigid-body motions in the plane${kp.zeroModes > 3 ? " plus internal mechanisms that the supports must prevent" : ""}. Applying the supports removes them, which is why [K] is singular but [K]ff is not.`));
    // flexibility
    const fl = S().flexibility(lin);
    if (fl) {
      out.push(h("h3", null, "Flexibility and stiffness"));
      out.push(h("p", { class: "note" }, "The flexibility matrix [F] = [K]ff⁻¹: column j holds the displacements caused by a unit load at DOF j."));
      out.push(h("dl", { class: "kv" }, h("dt", null, "max |[K]ff[F] − [I]|"), h("dd", null, fmt(fl.identityError, 2)), h("dt", null, "Reciprocity max |Fij − Fji| / max |F|"), h("dd", null, fmt(fl.reciprocity, 2))));
      if (fl.F.length <= 10) { const { num } = numbering(lin.A); const labs = lin.A.free.map(d => `${num.get(d)}`); out.push(matrixTable(fl.F, labs, labs)); }
    }
    // virtual work
    out.push(h("h3", null, "Unit-load method (principle of virtual work)"));
    out.push(h("p", { class: "note" }, "An independent displacement check: δ = Σ∫ M m / EI dx + Σ∫ N n / EA dx, with m and n from a unit load at the chosen DOF, integrated by Gauss quadrature along every member."));
    const vwNode = st.vwNode === undefined ? defaultVW(lin) : st.vwNode;
    const nodeSel = h("select", { onchange: ev => { st.vwNode = +ev.target.value; App.renderRight(); } }, m.nodes.map((n, i) => h("option", { value: i }, `Node ${i + 1}`)));
    nodeSel.value = vwNode[0];
    const dirSel = h("select", { onchange: ev => { st.vwNode = [vwNode[0], +ev.target.value]; App.renderRight(); } }, h("option", { value: 0 }, "u (x)"), h("option", { value: 1 }, "v (y)"), h("option", { value: 2 }, "θ"));
    dirSel.value = vwNode[1];
    nodeSel.onchange = ev => { st.vwNode = [+ev.target.value, vwNode[1]]; App.renderRight(); };
    out.push(h("div", { class: "inline-form" }, h("label", { class: "field" }, "Node", nodeSel), h("label", { class: "field" }, "Direction", dirSel)));
    const vw = S().virtualWork(lin, vwNode[0], vwNode[1]);
    if (!vw) out.push(h("p", { class: "note" }, "That DOF is restrained. Pick a free one."));
    else {
      const unit = vwNode[1] === 2 ? "mrad" : "mm", k = 1000;
      const r = [["∫ M m / EI dx", fix(vw.bending * k, 5)], ["∫ N n / EA dx", fix(vw.axial * k, 5)]];
      if (vw.spring) r.push(["Springs", fix(vw.spring * k, 5)]);
      if (vw.settle) r.push(["Support movement −Σ R̄ Δs", fix(-vw.settle * k, 5)]);
      r.push([h("strong", null, "Virtual work δ"), h("strong", null, fix(vw.delta * k, 5))], ["Stiffness method Δ", fix(vw.stiffness * k, 5)],
        ["Difference", fmt(Math.abs(vw.delta - vw.stiffness) / Math.max(Math.abs(vw.stiffness), 1e-15) * 100, 2) + " %"]);
      out.push(table(["Term", unit], r));
    }
    // FEM convergence
    out.push(h("h3", null, "Mesh refinement (introduction to FEM)"));
    out.push(h("p", { class: "note" }, "Linear results are exact with one element per member because the Hermitian cubic matches the beam solution. Buckling and second-order results depend on the mesh: split members and watch them converge."));
    if (st.conv && st.conv.key === App.snapshot()) {
      out.push(table(["Elements per member", st.conv.label, "Change"], st.conv.rows.map((r, i) => [r.n, fmt(r.v, 6), i ? fmt(100 * (r.v / st.conv.rows[i - 1].v - 1), 3) + " %" : "–"])));
      if (st.conv.ref) out.push(h("p", { class: "note" }, `Closed form: ${fmt(st.conv.ref, 6)}.`));
    }
    out.push(h("button", { onclick: () => { runConvergence(); App.renderRight(); } }, "Run a buckling convergence study"));
    return out;
  }
  function defaultVW(lin) {
    let best = -1, bd = 0;
    lin.A.free.forEach(d => { if (d % 3 !== 2 && d < 3 * lin.A.nOrig && Math.abs(lin.u[d]) > best) { best = Math.abs(lin.u[d]); bd = d; } });
    return [Math.floor(bd / 3), bd % 3];
  }
  function runReferences() {
    const m = st.model, cache = {}, rows = [];
    for (const ref of m.references) {
      const kind = ref.analysis || "linear";
      try {
        const r = cache[kind] || (cache[kind] = App.runKind(kind, m));
        const v = ref.get(r);
        rows.push({ ...ref, v, err: 100 * (v - ref.ref) / Math.abs(ref.ref) });
      } catch (e) { rows.push({ ...ref, v: NaN, err: NaN }); }
    }
    st.refCache = { model: m, rows };
  }
  function runConvergence() {
    const rows = [];
    const ref = (st.model.references || []).find(r => r.analysis === "buckling");
    for (const n of [1, 2, 4, 8, 16]) {
      const r = S().buckling(st.model, App.analysisOptions({ nsub: n }));
      rows.push({ n, v: ref ? ref.get(r) : r.lamCr });
    }
    st.conv = { key: App.snapshot(), rows, label: ref ? ref.label + ` (${ref.unit})` : "λcr", ref: ref ? ref.ref : null };
  }

  // ------------------------------------------------------------------ Damage tab
  function damageTab() {
    const m = st.model, s = m.settings, out = [];
    out.push(h("p", { class: "note" }, "Remove or strengthen members and compare collapse capacity under the same reference loads (proposal Eqs. 1 and 2):"));
    out.push(h("div", null, h("div", { class: "eq" }, "C = λlim, damaged / λlim, intact")), h("div", null, h("div", { class: "eq" }, "η = (λlim, strengthened − λlim, damaged) / λlim, damaged")));
    out.push(h("p", { class: "note" }, `Capacity comes from the plastic collapse analysis (${s.geometric !== false ? "with" : "without"} P-Δ, λ up to ${s.lamMax || 10}). A run that ends without a mechanism is labelled inconclusive and gets no ratio.`));
    if (!m.members.length) return out;
    const opts = () => App.analysisOptions({ lamMax: s.lamMax || 10 });
    const memOpts = m.members.map((q, i) => h("option", { value: i }, `Member ${i + 1}`));
    const study = m.study || (m.study = { remove: 0, strengthen: 0, factor: 1.5 });
    const rm = h("select", { onchange: ev => { study.remove = +ev.target.value; } }, memOpts.map(o => o.cloneNode(true))); rm.value = study.remove;
    const sg = h("select", { onchange: ev => { study.strengthen = +ev.target.value; } }, memOpts.map(o => o.cloneNode(true))); sg.value = study.strengthen;
    const fc = h("input", { type: "number", step: "any", min: 0.1, value: study.factor, onchange: ev => { study.factor = +ev.target.value || 1; } });
    out.push(h("h3", null, "Intact, damaged and strengthened"));
    out.push(h("div", { class: "inline-form" }, h("label", { class: "field" }, "Remove", rm), h("label", { class: "field" }, "Strengthen", sg), h("label", { class: "field", style: "max-width:90px" }, "A, I, Z ×", fc),
      h("button", { class: "primary", style: "padding:5px 12px", onclick: () => busy("Running three collapse analyses…", () => { st.retro = S().retrofitStudy(m, opts(), study.remove, study.strengthen, study.factor); st.retro.key = App.snapshot(); }) }, "Compare")));
    if (st.retro && st.retro.key === App.snapshot()) {
      const r = st.retro, lab = x => x.status === "collapse" ? fmt(x.lam, 5) : `${fmt(x.lam, 4)} (${x.status})`;
      out.push(table(["Scenario", "λlim", "Ratio to intact"], [
        ["Intact", lab(r.intact), "1"], [`Member ${study.remove + 1} removed`, lab(r.damaged), r.C === null ? "inconclusive" : fix(r.C, 3)],
        [`… and member ${study.strengthen + 1} ×${study.factor}`, lab(r.retrofit), r.Cretrofit === null ? "inconclusive" : fix(r.Cretrofit, 3)]],
        { onclick: i => showScenario([r.intact, r.damaged, r.retrofit][i].res, ["intact", `member ${study.remove + 1} removed`, `member ${study.remove + 1} removed, member ${study.strengthen + 1} ×${study.factor}`][i]) }));
      out.push(tiles([{ v: r.C === null ? "–" : fix(r.C, 3), k: "Capacity ratio C" }, { v: r.eta === null ? "–" : `${fix(100 * r.eta, 1)} %`, k: "Gain from strengthening η" }]));
      const ser = [[r.intact, "Intact", "var(--action)"], [r.damaged, "Damaged", "var(--compression)"], [r.retrofit, "Strengthened", "var(--reaction)"]].filter(([x]) => x.res && x.res.lamH);
      if (ser.length) out.push(App.chart(ser.map(([x, l, c]) => ({ x: x.res.ctrlH.map(v => ctrlSign(x.res) * v * 1000), y: x.res.lamH, color: c, label: l })), { xlabel: "control displacement (mm)", ylabel: "λ" }));
      out.push(h("p", { class: "note" }, "Click a row to show that scenario on the drawing."));
    }
    out.push(h("h3", null, "Rank members by consequence of removal"));
    out.push(h("p", { class: "note" }, "Removes each member in turn (its member loads go with it) and reruns the collapse analysis. Low C means a critical member."));
    out.push(h("button", { onclick: () => rankAll(opts()) }, "Rank all members"));
    if (st.rank && st.rank.key === App.snapshot()) {
      const r = st.rank.data;
      out.push(h("p", { class: "note" }, `Intact λlim = ${fmt(r.intact.lam, 5)} (${r.intact.status}).`));
      out.push(table(["Member", "λlim", "C", ""], r.rows.map(x => [x.member + 1, x.status === "collapse" ? fmt(x.lam, 4) : x.status, x.C === null ? "–" : fix(x.C, 3),
        h("div", { class: "bar" + (x.C !== null && x.C < 0.5 ? " red" : ""), style: `width:${x.C === null ? 0 : Math.max(2, Math.min(100, 100 * x.C))}px` })]),
        { onclick: i => { const x = r.rows[i]; showScenario(S().pushover(m, { ...opts(), removed: new Set([x.member]) }), `member ${x.member + 1} removed`); } }));
    }
    if (App.corrosionPanel) out.push(App.corrosionPanel());
    out.push(h("h3", null, "Member state for all analyses"));
    out.push(h("p", { class: "note" }, "These settings change the model itself, so every analysis uses them."));
    out.push(table(["Member", "In model", "A, I, Z factor"], m.members.map((q, i) => [i + 1,
      h("input", { type: "checkbox", checked: !q.removed, onchange: ev => App.change(mm => { mm.members[i].removed = !ev.target.checked; }) }),
      h("input", { type: "number", step: "any", value: q.factor || 1, style: "width:70px", onchange: ev => App.change(mm => { mm.members[i].factor = +ev.target.value || 1; }) })])));
    return out;
  }
  function busy(text, fn) {
    const msg = App.$("#runMsg"); msg.className = "runmsg"; msg.textContent = text;
    setTimeout(() => { const t0 = performance.now(); try { fn(); msg.textContent = `Done in ${Math.round(performance.now() - t0)} ms.`; } catch (e) { console.error(e); msg.className = "runmsg bad"; msg.textContent = e.message; } App.renderRight(); }, 20);
  }
  function rankAll(opts) {
    const m = st.model, list = m.members.map((_, i) => i).filter(i => !m.members[i].removed), msg = App.$("#runMsg");
    const intact = S().capacity(m, opts), rows = [];
    let k = 0;
    const stepFn = () => {
      if (k >= list.length) {
        rows.sort((a, b) => (a.C === null ? 2 : a.C) - (b.C === null ? 2 : b.C));
        st.rank = { key: App.snapshot(), data: { intact: { lam: intact.lam, status: intact.status }, rows } };
        msg.textContent = `Ranked ${list.length} members.`; App.renderRight(); return;
      }
      const mi = list[k++];
      const c = S().capacity(m, { ...opts, removed: new Set([mi]) });
      const ok = intact.status === "collapse" && c.status === "collapse" && intact.lam > 0;
      rows.push({ member: mi, lam: c.lam, status: c.status, C: ok ? c.lam / intact.lam : (c.status === "unstable" ? 0 : null) });
      msg.className = "runmsg"; msg.textContent = `Removing member ${mi + 1} (${k} of ${list.length})…`;
      setTimeout(stepFn, 0);
    };
    setTimeout(stepFn, 20);
  }
  function showScenario(res, label) {
    if (!res) return;
    st.res = res; st.stale = false; st.scenario = label; st.analysis = "pushover";
    st.step = res.uH ? res.uH.length - 1 : 0;
    App.renderAnalysisOpts();
    if (st.view === "model") st.view = "deformed";
    App.setView(st.view, true); App.renderRunMsg(); App.updateStepbar(); App.render();
  }

  App.initResults = function () {
    document.querySelectorAll("#rightTabs button").forEach(b => b.addEventListener("click", () => { st.rightTab = b.dataset.tab; App.renderRight(); }));
    App.$("#analysisType").addEventListener("change", ev => {
      st.analysis = ev.target.value; st.model.settings.analysis = st.analysis;
      if (st.res && st.res.kind !== st.analysis) { st.res = st.analysis === "linear" ? st.lin : null; }
      App.renderAnalysisOpts(); App.renderRunMsg(); App.updateStepbar(); App.renderRight(); App.render();
    });
    App.$("#btnRun").addEventListener("click", App.run);
    App.$("#optLive").addEventListener("change", ev => { st.live = ev.target.checked; App.modelChanged({ noHistory: true }); });
  };
})();
