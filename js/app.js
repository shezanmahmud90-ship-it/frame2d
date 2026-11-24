/* Frame2D Studio - application wiring */
(function () {
  "use strict";
  const App = window.App, st = App.state, h = App.h, Ex = window.Examples, S = window.Solver;

  App.modelChanged = function (opts) {
    opts = opts || {};
    const m = st.model;
    try { st.lin = m.members.length ? S.linear(m, { nsub: m.settings.nsub || 1 }) : null; }
    catch (err) { console.error(err); st.lin = null; }
    if (st.res && st.res.kind !== "linear") st.stale = true;
    if (st.analysis === "linear") { if (st.live || !st.res) st.res = st.live ? st.lin : null; else st.stale = true; if (st.live) st.stale = false; }
    if (st.refCache) st.refCache.dirty = true;
    if (!opts.quick) App.renderLeft(); else App.renderStatus();
    App.renderRunMsg(); App.updateStepbar();
    if (!opts.quick) App.renderRight();
    App.render();
    App.$("#btnUndo").disabled = !st.history.length; App.$("#btnRedo").disabled = !st.future.length;
    clearTimeout(App._saveT);
    App._saveT = setTimeout(() => { try { localStorage.setItem("f2d-autosave", App.snapshot()); localStorage.setItem("f2d-autosave-time", new Date().toISOString()); } catch (e) { /* storage unavailable */ } }, 400);
  };

  App.loadModel = function (m, opts) {
    opts = opts || {};
    st.model = App.normalize(m);
    st.sel = null; st.res = null; st.stale = false; st.history = []; st.future = []; st.step = 0; st.scenario = null;
    st.refCache = null; st.conv = null; st.retro = null; st.rank = null; st.methodEl = 0; st.sheetAuto = true; st.corr = null; st.corrResult = null; st.aiscRows = null; st.utilMode = "plastic"; st.methodHL = null; st.thRecord = st.thRecord || null; st.vwNode = undefined; st.chainFrom = null;
    st.analysis = opts.analysis || st.model.settings.analysis || "linear";
    App.renderAnalysisOpts();
    App.modelChanged({ noHistory: true });
    App.fit();
    if (opts.run !== false && st.analysis !== "linear") App.run();
    else { st.view = st.lin && !st.lin.unstable && m.members.length ? (opts.view || "M") : "model"; App.setView(st.view, true); App.renderRight(); App.startGrow(); }
  };

  App.setView = function (v, silent) {
    const r0 = App.shownResult();
    if (v === "mode" && !(r0 && r0.mode)) v = r0 ? "deformed" : "model";
    if (r0 && r0.kind === "modal" && v !== "model") v = "mode";
    const changed = st.view !== v;
    st.view = v;
    if (changed && v !== "model" && !silent) App.startGrow();
    if (v === "mode") App.ensureLoop();
    document.querySelectorAll(".toolbar.views [data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === v));
    const r = App.shownResult();
    App.$('.toolbar.views [data-view="mode"]').disabled = !(r && r.mode);
    const mb = App.$('.toolbar.views [data-view="U"]'); if (mb) mb.disabled = !!(r0 && r0.kind === "modal");
    App.updateStepbar(); App.render();
  };

  // ------------------------------------------------------------------ examples and templates
  function buildExampleMenu() {
    const sel = App.$("#exampleSelect");
    sel.append(h("option", { value: "" }, "Choose an example"));
    const groups = {};
    Ex.examples.forEach(e => { (groups[e.group] = groups[e.group] || []).push(e); });
    Object.entries(groups).forEach(([g, list]) => sel.append(h("optgroup", { label: g }, list.map(e => h("option", { value: e.key }, e.build().title)))));
    sel.addEventListener("change", () => { if (sel.value) openExample(sel.value); });
  }
  App.openExample = key => openExample(key);
  function openExample(key) {
    const e = Ex.examples.find(x => x.key === key); if (!e) return;
    App.$("#exampleSelect").value = key;
    history.replaceState(null, "", "#" + key);
    App.loadModel(e.build());
  }

  App.templateDialog = () => templateDialog();
  function templateDialog() {
    const dlg = App.$("#dlg"), form = App.$("#dlgForm");
    let cur = Object.keys(Ex.templates)[0];
    const draw = () => {
      const t = Ex.templates[cur], vals = {};
      const fields = t.params.map(p => {
        let input;
        if (p.type === "select") input = h("select", { name: p.key }, p.options.map(o => h("option", { value: o }, o)));
        else if (p.type === "section") input = h("select", { name: p.key }, Ex.LIBRARY.map(s => h("option", { value: s.name }, s.name)));
        else if (p.type === "bool") input = h("input", { type: "checkbox", name: p.key, checked: p.value });
        else if (p.type === "text") input = h("input", { name: p.key, value: p.value });
        else input = h("input", { type: "number", step: p.int ? 1 : "any", name: p.key, value: p.value });
        if (p.type === "select" || p.type === "section") input.value = p.value;
        vals[p.key] = input;
        return h("label", { class: "field" }, p.label, input, p.help ? h("span", { class: "help", style: "margin:2px 0 0" }, p.help) : null);
      });
      form.replaceChildren(
        h("h2", null, "New model from a template"),
        h("p", { class: "note" }, "Pick a structure, set its size and loads, then edit anything afterwards."),
        h("div", { class: "template-pick" }, Object.entries(Ex.templates).map(([k, tt]) => h("button", { type: "button", class: k === cur ? "on" : "", onclick: () => { cur = k; draw(); } }, tt.label))),
        h("div", { class: "grid2" }, fields),
        h("div", { class: "actions" }, h("button", { value: "cancel" }, "Cancel"), h("button", { class: "primary", value: "ok", onclick: ev => {
          ev.preventDefault();
          const p = {}; for (const [k, inp] of Object.entries(vals)) p[k] = inp.type === "checkbox" ? inp.checked : inp.value;
          try { const m = Ex.templates[cur].build(p); dlg.close(); App.$("#exampleSelect").value = ""; history.replaceState(null, "", location.pathname); App.loadModel(m, { analysis: "linear" }); }
          catch (err) { App.toast(err.message); }
        } }, "Create model")));
    };
    draw(); dlg.className = ""; dlg.showModal();
  }

  function helpDialog() {
    const dlg = App.$("#dlg"), form = App.$("#dlgForm");
    form.innerHTML = `<h2>Guide</h2><div class="guide">
      <h3>Build a model</h3><ul>
      <li>Open an example or <b>New from template</b>, or draw: <b>Node</b> (N) places nodes on the grid, <b>Member</b> (M) connects nodes, <b>Support</b> (S) cycles the support at a node, <b>Load</b> (L) adds a load to a node or member.</li>
      <li><b>Select</b> (V) picks and drags nodes; drag the background to pan and scroll to zoom. <b>F</b> fits the view, <b>Delete</b> removes the selection, <b>Ctrl+Z</b> undoes.</li>
      <li>Exact values go in the tables on the left. Units are kN and m; sections use GPa, cm², cm⁴, cm³ and MPa.</li></ul>
      <h3>Sign conventions</h3><ul>
      <li>Global x to the right, y up, rotations and moments counter-clockwise positive. A downward load is negative Fy (or negative w in Global Y).</li>
      <li>Local x runs from the start node to the end node; local y is 90° counter-clockwise from it.</li>
      <li>Diagrams: axial force tension positive (blue), compression red; bending moment drawn on the tension side.</li></ul>
      <h3>Analyses</h3><ul>
      <li><b>Linear static</b>: direct stiffness method; updates while you edit.</li>
      <li><b>Second order</b>: corotational element with Newton–Raphson iterations; constant loads first, then λ × variable loads.</li>
      <li><b>Elastic buckling</b>: ([K]e + λ[K]g){Δ} = 0. Use 4 or more elements per member.</li>
      <li><b>Plastic collapse</b>: hinges form at member ends when |M| = Mp until a mechanism forms. Put a node where a hinge may form inside a span.</li>
      <li><b>Snap-through</b>: arc-length path following through limit points.</li>
      <li><b>Natural frequencies</b>: [K]{φ} = ω²[M]{φ} with consistent or lumped mass from ρA, nodal masses and constant loads ÷ g. Modes animate in the Mode view.</li>
      <li><b>Moving load</b>: an axle group crosses a chain of members; envelopes, reaction histories and an animated crossing.</li></ul>
      <h3>Hand calculations and validation</h3><ul>
      <li><b>Hand calculations</b> (top bar) opens a worked solution of the current model: DOF numbering, element matrices with numbers substituted, fixed-end forces, assembly, load vector, solution, member forces, reactions and checks. Print it or save it as a PDF.</li>
      <li><b>Validation</b> (top bar) holds the three STAAD.Pro cases (linear, second order, modal): download each STAAD input, type in STAAD's results, and see the differences.</li>
      <li><b>Utilization</b> view colours members by demand ÷ plastic capacity, or by the AISC 360 interaction ratio.</li></ul>
      <h3>More analyses and loads</h3><ul>
      <li><b>Influence line</b>: a unit load crosses the path members; choose a reaction or the M, V or N at a section.</li>
      <li><b>Load combinations</b>: give each load a case (D, L, W, E, S, T) in the Loads tab; edit the combinations as text (e.g. 1.2D + 1.6L). Envelopes and AISC member checks follow.</li>
      <li><b>Earthquake time history</b>: synthetic, harmonic or imported ground motion; Newmark integration with Rayleigh damping.</li>
      <li><b>Temperature and misfit</b> member loads, <b>inclined rollers</b>, <b>shear deformation</b> (section shear area As) and <b>semi-rigid connections</b> (select a member, then drag its fixity sliders in the Members tab).</li>
      <li><b>Damage tab</b>: corrosion Monte Carlo of the collapse capacity.</li></ul>
      <h3>Sharing and presenting</h3><ul>
      <li><b>Share</b> puts the whole model in a link and a QR code. <b>Present</b> runs a guided demo: arrow keys to move, F for full screen, Esc to leave.</li>
      <li><b>Export</b> also writes an Excel workbook and a DXF drawing for CAD.</li>
      <li>In Results, <b>Save as baseline</b> compares two versions of a model.</li></ul>
      <h3>Panels</h3><ul>
      <li><b>Method</b> shows each step of the direct stiffness method for this model: DOF numbering, [k′], [Γ], assembly, loads, solution, reactions and member forces.</li>
      <li><b>Checks</b> compares with closed-form solutions, equilibrium, stiffness matrix properties, flexibility, the unit-load method and mesh convergence.</li>
      <li><b>Damage</b> removes or strengthens members and compares collapse capacity.</li>
      <li><b>Export → STAAD.Pro input</b> writes a .std file of the model for independent verification.</li></ul>
      <h3>Reference</h3><p>W. McGuire, R. H. Gallagher and R. D. Ziemian, <i>Matrix Structural Analysis</i>, 2nd ed., Wiley, 2000.</p></div>
      <div class="actions"><button class="primary" value="ok">Close</button></div>`;
    dlg.className = "wide"; dlg.showModal();
  }

  // ------------------------------------------------------------------ files and export
  function save() { App.download(`${App.slug(st.model.title)}.json`, JSON.stringify(App.cleanForSave(st.model), null, 1), "application/json"); App.toast("Saved the model file"); }
  function open(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try { const m = JSON.parse(rd.result); if (!Array.isArray(m.nodes) || !Array.isArray(m.members)) throw new Error("not a Frame2D model"); App.$("#exampleSelect").value = ""; App.loadModel(m, { run: false }); App.toast(`Opened ${file.name}`); }
      catch (err) { App.toast(`Could not open ${file.name}: ${err.message}`); }
    };
    rd.readAsText(file);
  }
  function exportCSV() {
    const res = App.shownResult(), stt = res ? App.stateOf(res) : null;
    if (!stt) { App.toast("Run an analysis first"); return; }
    const L = [`# ${st.model.title}`, `# ${res.kind} analysis, load factor ${stt.lam}`, "", "Node displacements", "node,u (m),v (m),theta (rad)"];
    for (let n = 0; n < st.model.nodes.length; n++) L.push([n + 1, stt.u[3 * n], stt.u[3 * n + 1], stt.u[3 * n + 2]].join(","));
    L.push("", "Reactions", "node,dof,value (kN or kN m)");
    const P = new Float64Array(stt.A.ndof); for (let d = 0; d < P.length; d++) P[d] = stt.g * stt.A.P0[d] + stt.lam * stt.A.Pr[d];
    stt.A.fixedList.forEach(d => { if (d < 3 * st.model.nodes.length) L.push([Math.floor(d / 3) + 1, ["Rx", "Ry", "M"][d % 3], stt.F[d] - P[d]].join(",")); });
    L.push("", "Member end internal forces (N tension +, M sagging +)", "member,end,N (kN),V (kN),M (kN m)");
    st.model.members.forEach((q, mi) => {
      const els = stt.A.memberEls[mi]; if (!els || !els.length) return;
      [[els[0], 0], [els[els.length - 1], 1]].forEach(([e, end]) => {
        const el = stt.A.els[e], fn = S.fieldFn(el, stt.infos[e], S.elemLoads(el, stt.g, stt.lam), S.elemQ(el, stt.g, stt.lam)), r = fn(end ? el.L0 - 1e-9 : 1e-9);
        L.push([mi + 1, end ? "j" : "i", r.N, r.V, r.M].join(","));
      });
    });
    App.download(`${App.slug(st.model.title)}-results.csv`, L.join("\n"), "text/csv");
  }
  function exportImage(kind) {
    const { str, W, H } = App.svgString();
    if (kind === "svg") { App.download(`${App.slug(st.model.title)}.svg`, str, "image/svg+xml"); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = W * 2; c.height = H * 2;
      const g = c.getContext("2d"); g.scale(2, 2); g.drawImage(img, 0, 0);
      c.toBlob(b => App.download(`${App.slug(st.model.title)}.png`, b));
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(str);
  }

  // ------------------------------------------------------------------ playback of load steps / vehicle positions
  let playT = null;
  App.stopPlay = function () { if (playT) { clearInterval(playT); playT = null; } const b = App.$("#btnPlay"); if (b) b.textContent = "▶"; };
  App.play = function (fromStart) {
    const r = App.shownResult(); if (!r || !r.uH || r.uH.length < 2) return;
    if (playT) { App.stopPlay(); return; }
    if (fromStart || st.step >= r.uH.length - 1) st.step = 0;
    App.$("#btnPlay").textContent = "❚❚";
    const dt = r.kind === "moving" ? Math.max(25, Math.min(80, 6000 / r.uH.length)) : Math.max(30, Math.min(120, 3500 / r.uH.length));
    playT = setInterval(() => {
      if (st.step >= r.uH.length - 1 || App.shownResult() !== r) { App.stopPlay(); App.renderRight(); return; }
      st.step++; App.updateStepbar(); App.render();
    }, dt);
  };

  // ------------------------------------------------------------------ init
  function init() {
    buildExampleMenu();
    App.initCanvas(); App.initModelPanel(); App.initResults();
    document.querySelectorAll(".toolbar.tools [data-tool]").forEach(b => b.addEventListener("click", () => App.setTool(b.dataset.tool)));
    document.querySelectorAll(".toolbar.views [data-view]").forEach(b => b.addEventListener("click", () => App.setView(b.dataset.view)));
    App.$("#btnFit").addEventListener("click", App.fit);
    App.$("#gridSize").addEventListener("change", () => App.render());
    App.$("#optValues").addEventListener("change", ev => { st.showValues = ev.target.checked; App.render(); });
    App.$("#optLabels").addEventListener("change", ev => { st.showLabels = ev.target.checked; App.render(); });
    App.$("#optScale").addEventListener("input", ev => { st.scale = +ev.target.value; App.render(); });
    st.animate = true;
    App.$("#optAnimate").addEventListener("change", ev => { st.animate = ev.target.checked; App.ensureLoop(); App.render(); });
    App.$("#btnValidation").addEventListener("click", () => App.openValidation());
    App.$("#btnSheet").addEventListener("click", () => App.openSheet());
    App.$("#btnShare").addEventListener("click", () => App.openShare());
    App.$("#btnPresent").addEventListener("click", () => App.startPresentation());
    App.$("#brand").addEventListener("click", () => App.openWelcome());
    App.$("#brand").addEventListener("keydown", ev => { if (ev.key === "Enter") App.openWelcome(); });
    App.$("#stepSlider").addEventListener("input", ev => { st.step = +ev.target.value; App.updateStepbar(); App.render(); if (st.rightTab === "results") App.renderRight(); });
    App.$("#btnPlay").addEventListener("click", () => App.play());
    App.$("#btnNew").addEventListener("click", templateDialog);
    App.$("#btnHelp").addEventListener("click", helpDialog);
    App.$("#btnSave").addEventListener("click", save);
    App.$("#btnOpen").addEventListener("click", () => App.$("#fileInput").click());
    App.$("#fileInput").addEventListener("change", ev => { if (ev.target.files[0]) open(ev.target.files[0]); ev.target.value = ""; });
    App.$("#btnUndo").addEventListener("click", App.undo);
    App.$("#btnRedo").addEventListener("click", App.redo);
    const menu = App.$("#exportMenu");
    App.$("#btnExport").addEventListener("click", ev => { ev.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener("click", () => { menu.hidden = true; });
    menu.addEventListener("click", ev => {
      const k = ev.target.dataset.export; if (!k) return;
      if (k === "staad") { App.download(`${App.slug(st.model.title)}.std`, window.STAAD.toSTD(st.model, { analysis: st.analysis }), "text/plain"); App.toast("Exported the STAAD.Pro input file"); }
      else if (k === "csv") exportCSV(); else if (k === "xlsx") App.exportXLSX(); else if (k === "dxf") App.exportDXF(); else exportImage(k);
    });
    document.addEventListener("keydown", ev => {
      const tag = (ev.target.tagName || "").toLowerCase();
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && tag !== "input") { ev.preventDefault(); ev.shiftKey ? App.redo() : App.undo(); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y" && tag !== "input") { ev.preventDefault(); App.redo(); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); save(); return; }
      if (ev.key === "Escape" && document.querySelector(".overlay:not([hidden])")) { document.querySelectorAll(".overlay").forEach(o => { o.hidden = true; }); return; }
      if (tag === "input" || tag === "select" || tag === "textarea" || App.$("#dlg").open || document.querySelector(".overlay:not([hidden])")) return;
      const k = ev.key.toLowerCase();
      const tools = { v: "select", n: "node", m: "member", s: "support", l: "load" };
      if (tools[k] && !ev.ctrlKey && !ev.metaKey) App.setTool(tools[k]);
      else if (k === "f") App.fit();
      else if (k === "delete" || k === "backspace") { ev.preventDefault(); App.deleteSelection(); }
      else if (k === "escape") { st.chainFrom = null; st.drag = null; st.sel = null; App.refreshSelection(); }
      else if (k === "enter" && ev.target === document.body) App.run();
    });
    App.setTool("select");
    const key = location.hash.slice(1);
    if (/^[mj]=/.test(key)) { App.loadModel(Ex.examples.find(e => e.key === "portal").build(), { analysis: "linear", view: "M" }); App.loadFromHash(); }
    else if (Ex.examples.some(e => e.key === key)) openExample(key);
    else {
      App.$("#exampleSelect").value = "portal";
      App.loadModel(Ex.examples.find(e => e.key === "portal").build(), { analysis: "linear", view: "M" });
      let show = true; try { show = localStorage.getItem("f2d-welcome") !== "off"; } catch (e) { /* ignore */ }
      if (show || !key) App.openWelcome();
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
