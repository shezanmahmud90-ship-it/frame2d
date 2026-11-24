/* Frame2D Studio - interface for the v3 analyses: influence lines, load combinations, earthquake time
 * history, AISC member checks, baseline comparison, corrosion Monte Carlo and the animated assembly. */
(function () {
  "use strict";
  const App = window.App, st = App.state, h = App.h, S = () => window.Solver, Adv = () => window.Adv;
  const fix = App.fix, fmt = App.fmt;

  App.ADV_NOTES = {
    il: "A unit load crosses the chosen members; each position is a linear analysis. Müller-Breslau: the influence line has the shape of the structure deflected by a unit release of the chosen quantity.",
    combo: "Each load gets a case (D, L, W, E, S, T). The strength combinations are solved and enveloped; member checks use the worst combination.",
    th: "Newmark average-acceleration integration of [M]ü + [C]u̇ + [K]u = −[M]{r}ag(t), Rayleigh damping, mass from ρA, nodal masses and gravity loads ÷ g."
  };

  // ------------------------------------------------------------------ analysis options
  App.advancedOpts = function (kind, s, items, set, numF) {
    const m = st.model;
    const txt = (label, val, title, onset) => h("label", { class: "field" }, label, h("input", { value: val, title, onchange: ev => { onset(ev.target.value); st.stale = true; App.renderRunMsg(); } }));
    if (kind === "il") {
      if (!s.path || !s.path.length) s.path = App.defaultPath(m);
      const q = s.ilQuantity || (s.ilQuantity = { type: "reaction", node: (m.supports[0] || { node: 0 }).node, dir: 1 });
      items.push(txt("Path members (in order)", (s.path || []).map(i => i + 1).join(", "), "Members the unit load travels along", v => { s.path = v.split(/[,; ]+/).map(Number).filter(x => x >= 1).map(x => x - 1); }));
      items.push(numF("Positions", "ilPositions", s.ilPositions || 200, { min: 20, step: 1 }));
      const tsel = h("select", { onchange: ev => { s.ilQuantity = ev.target.value === "reaction" ? { type: "reaction", node: (m.supports[0] || { node: 0 }).node, dir: 1 } : { type: "internal", member: s.path[0] || 0, x: 0, comp: "M" }; App.renderAnalysisOpts(); st.stale = true; App.renderRunMsg(); } }, h("option", { value: "reaction" }, "Support reaction"), h("option", { value: "internal" }, "Internal force at a section"));
      tsel.value = q.type; items.push(h("label", { class: "field" }, "Quantity", tsel));
      if (q.type === "reaction") {
        const ns = h("select", { onchange: ev => { q.node = +ev.target.value; st.stale = true; App.renderRunMsg(); } }, m.supports.map(sp => h("option", { value: sp.node }, `Node ${sp.node + 1}`))); ns.value = q.node;
        const ds = h("select", { onchange: ev => { q.dir = +ev.target.value; st.stale = true; App.renderRunMsg(); } }, h("option", { value: 0 }, "Rx"), h("option", { value: 1 }, "Ry"), h("option", { value: 2 }, "M")); ds.value = q.dir;
        items.push(h("label", { class: "field" }, "Support", ns), h("label", { class: "field" }, "Component", ds));
      } else {
        const ms = h("select", { onchange: ev => { q.member = +ev.target.value; st.stale = true; App.renderRunMsg(); } }, m.members.map((_, i) => h("option", { value: i }, `Member ${i + 1}`))); ms.value = q.member;
        const cs = h("select", { onchange: ev => { q.comp = ev.target.value; st.stale = true; App.renderRunMsg(); } }, h("option", { value: "M" }, "Moment M"), h("option", { value: "V" }, "Shear V"), h("option", { value: "N" }, "Axial N")); cs.value = q.comp;
        items.push(h("label", { class: "field" }, "Member", ms), h("label", { class: "field" }, "Component", cs), txt("Section at x (m from start)", q.x, "", v => { q.x = +v || 0; }));
      }
    }
    if (kind === "combo") {
      const list = Adv().activeCombos(m);
      const ta = h("textarea", { rows: Math.max(3, list.length), class: "combo-text", "aria-label": "Load combinations, one per line",
        onchange: ev => { try { m.combos = parseCombos(ev.target.value); st.stale = true; App.renderRunMsg(); } catch (e) { App.toast(e.message); } } },
        list.map(c => c.name).join("\n"));
      items.push(h("label", { class: "field wide-field" }, "Combinations (one per line, e.g. 1.2D + 1.6L)", ta));
      const present = [...new Set([...(m.nodeLoads || []).map(l => Adv().loadCase(l, false)), ...(m.memberLoads || []).map(l => Adv().loadCase(l, true))])];
      items.push(h("p", { class: "note", style: "grid-column:span 2;margin:0" }, `Load cases in this model: ${present.map(c => `${c} (${Adv().CASES[c]})`).join(", ") || "none"}. Set each load's case in the Loads tab.`));
      items.push(h("button", { class: "small", style: "grid-column:span 2;justify-self:start", onclick: () => { m.combos = null; App.renderAnalysisOpts(); st.stale = true; } }, "Use the default ASCE 7 combinations"));
    }
    if (kind === "th") {
      const rs = h("select", { onchange: ev => { s.thRecord = ev.target.value; App.renderAnalysisOpts(); st.stale = true; App.renderRunMsg(); } },
        h("option", { value: "synthetic" }, "Synthetic earthquake (Kanai–Tajimi)"), h("option", { value: "harmonic" }, "Harmonic at the first frequency"), h("option", { value: "file" }, "Import a record (.csv/.txt)"));
      rs.value = s.thRecord || "synthetic";
      items.push(h("label", { class: "field", style: "grid-column:span 2" }, "Ground motion", rs));
      if ((s.thRecord || "synthetic") !== "file") {
        items.push(numF("Peak ground acceleration (g)", "thPga", s.thPga || 0.3, { min: 0, step: 0.05 }), numF("Duration (s)", "thDuration", s.thDuration || 15, { min: 1 }));
        if ((s.thRecord || "synthetic") === "synthetic") items.push(numF("Random seed", "thSeed", s.thSeed || 7, { step: 1 }));
      } else {
        const fi = h("input", { type: "file", accept: ".csv,.txt,.dat,.at2", onchange: ev => { const f = ev.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { st.thRecord = Adv().parseRecord(rd.result, s.thDt); st.thRecord.name = f.name; App.toast(`Loaded ${f.name}: ${st.thRecord.a.length} points at ${st.thRecord.dt.toFixed(4)} s`); st.stale = true; App.renderRunMsg(); } catch (e) { App.toast(e.message); } }; rd.readAsText(f); } });
        items.push(h("label", { class: "field", style: "grid-column:span 2" }, "Record: time and acceleration (g) in two columns, or one column with the time step", fi), numF("Time step for one-column files (s)", "thDt", s.thDt || 0.01, { min: 0.0001 }));
      }
      items.push(numF("Damping ratio ζ (%)", "zetaPct", (s.zeta === undefined ? 0.05 : s.zeta) * 100, { min: 0, step: 0.5 }));
      const ds = h("select", { onchange: ev => { s.thDir = ev.target.value; st.stale = true; } }, h("option", { value: "x" }, "Horizontal (x)"), h("option", { value: "y" }, "Vertical (y)")); ds.value = s.thDir || "x";
      items.push(h("label", { class: "field" }, "Direction", ds));
      const mt = h("select", { onchange: ev => { s.massType = ev.target.value; st.stale = true; } }, h("option", { value: "consistent" }, "Consistent mass"), h("option", { value: "lumped" }, "Lumped mass")); mt.value = s.massType || "consistent";
      items.push(h("label", { class: "field" }, "Mass matrix", mt));
      setTimeout(() => { const z = [...document.querySelectorAll("#analysisOpts input")].find(i => i.parentElement.textContent.startsWith("Damping")); if (z) z.onchange = ev => { s.zeta = (+ev.target.value || 0) / 100; st.stale = true; App.renderRunMsg(); }; }, 0);
    }
  };
  function parseCombos(text) {
    return text.split(/\n/).map(x => x.trim()).filter(Boolean).map(line => {
      const f = {};
      line.replace(/−/g, "-").split("+").forEach(tok => { const mt = tok.trim().match(/^(-?\d*\.?\d*)\s*([DLWEST])$/i); if (!mt) throw new Error(`Cannot read "${tok.trim()}" in "${line}"`); const c = mt[2].toUpperCase(); f[c] = (f[c] || 0) + (mt[1] === "" || mt[1] === "-" ? (mt[1] === "-" ? -1 : 1) : +mt[1]); });
      return { name: line, f };
    });
  }

  App.runAdvanced = function (kind, m, o) {
    const s = m.settings;
    if (kind === "il") { if (!s.path || !s.path.length) s.path = App.defaultPath(m); return Adv().influenceLine(m, { ...o, path: s.path, quantity: s.ilQuantity, positions: s.ilPositions || 200 }); }
    if (kind === "combo") return Adv().combinations(m, o);
    if (kind === "th") {
      let rec;
      const kindRec = s.thRecord || "synthetic";
      if (kindRec === "file") { if (!st.thRecord) throw new Error("Import a ground-motion record first"); rec = st.thRecord; }
      else if (kindRec === "harmonic") {
        const md = window.Dyn.modal(m, { nsub: o.nsub, nmodes: 1, lumped: s.massType === "lumped" });
        if (md.unstable || !md.modes.length) throw new Error("No vibration mode found");
        rec = Adv().harmonicMotion({ amp: s.thPga || 0.05, f: md.modes[0].f, duration: s.thDuration || 10, dt: Math.min(0.01, 1 / (md.modes[0].f * 40)) });
      } else rec = Adv().syntheticQuake({ pga: s.thPga || 0.3, duration: s.thDuration || 15, seed: s.thSeed || 7, dt: 0.01 });
      return Adv().timeHistory(m, { ...o, record: rec, zeta: s.zeta === undefined ? 0.05 : s.zeta, dir: s.thDir || "x", lumped: s.massType === "lumped" });
    }
  };

  // ------------------------------------------------------------------ results
  const table = (head, rows, opts) => {
    opts = opts || {};
    const t = h("table", { class: "data" }, h("thead", null, h("tr", null, head.map(x => h("th", null, x)))));
    const tb = h("tbody");
    rows.forEach((r, i) => { const tr = h("tr", { class: (opts.onclick ? "click" : "") + (opts.active === i ? " on" : "") }, r.map(c => (c && c.nodeType) ? h("td", null, c) : (c && typeof c === "object" && "v" in c) ? h("td", { class: c.cls || null }, c.v) : h("td", null, c))); if (opts.onclick) tr.addEventListener("click", () => opts.onclick(i)); tb.append(tr); });
    t.append(tb); return h("div", { class: "scroll-x" }, t);
  };
  const tiles = list => h("div", { class: "tiles" }, list.map(t => h("div", { class: "tile" + (t.big ? " big" : "") }, h("div", { class: "v", style: t.color ? `color:${t.color}` : null }, t.v), h("div", { class: "k" }, t.k), t.w ? h("div", { class: "w" }, t.w) : null)));

  App.advancedResults = function (res, out) {
    if (res.kind === "il") {
      out.push(tiles([{ v: fmt(res.max.v, 4), k: "Largest positive ordinate", w: `unit load at ${fix(res.max.s, 2)} m` }, { v: fmt(res.min.v, 4), k: "Largest negative ordinate", w: `unit load at ${fix(res.min.s, 2)} m` }]));
      out.push(h("h3", null, `Influence line: ${res.label}`));
      out.push(App.chart([{ x: res.posH, y: res.values, color: "var(--action)" }], { xlabel: "unit load position along the path (m)", ylabel: res.unit, marker: { x: res.posH[st.step], y: res.values[st.step] } }));
      const area = res.values.reduce((a, v, i) => i ? a + 0.5 * (v + res.values[i - 1]) * (res.posH[i] - res.posH[i - 1]) : 0, 0);
      const pos = res.values.reduce((a, v, i) => i ? a + 0.5 * (Math.max(v, 0) + Math.max(res.values[i - 1], 0)) * (res.posH[i] - res.posH[i - 1]) : 0, 0);
      out.push(h("dl", { class: "kv" }, h("dt", null, "Area under the influence line"), h("dd", null, `${fmt(area, 4)} (× w gives the response to a full uniform load)`),
        h("dt", null, "Positive area only"), h("dd", null, `${fmt(pos, 4)} (worst pattern loading)`)));
      out.push(h("p", { class: "note" }, "Use: response = Σ P·ordinate for point loads, w·area for distributed loads. Press play under the drawing to move the unit load."));
      return true;
    }
    if (res.kind === "combo") {
      out.push(tiles([{ v: `${fix(res.maxM.v)} kN·m`, k: "Largest sagging moment", w: res.maxM.combo !== undefined ? res.combos[res.maxM.combo].name : "" }, { v: `${fix(res.minM.v)} kN·m`, k: "Largest hogging moment", w: res.minM.combo !== undefined ? res.combos[res.minM.combo].name : "" }]));
      out.push(h("h3", null, "Combinations"));
      out.push(table(["Combination", "max |M|", "max |N|", "max Δ (mm)"], res.summary.map(r => [r.name, fix(r.maxM), fix(r.maxN), App.mm(r.maxD)]), { onclick: i => { st.step = i; App.updateStepbar(); App.render(); App.renderRight(); }, active: st.step }));
      out.push(h("h3", null, "Reaction envelope"));
      out.push(table(["Support", "max", "min"], res.reactions.map(r => [`${["Rx", "Ry", "M"][r.dof % 3]} node ${Math.floor(r.dof / 3) + 1}`, fix(r.max), fix(r.min)])));
      out.push(h("p", { class: "note" }, "Moment and Shear views draw the envelopes (dashed) with the diagram of the combination chosen above or with the slider."));
      out.push(App.aiscPanel(res));
      return true;
    }
    if (res.kind === "th") {
      const maxDrift = Math.max(...res.drift, 0);
      out.push(tiles([{ v: `${App.mm(res.peak.u)} mm`, k: `Peak ${App.dofName(res.ctrl)}`, w: `at t = ${fix(res.peak.t, 2)} s` }, { v: `${fix(res.peakV.v)} kN`, k: "Peak base shear", w: `at t = ${fix(res.peakV.t, 2)} s` },
        { v: `${fix(100 * maxDrift, 2)} %`, k: "Largest interstory drift" }, { v: `${fmt(res.modal.modes[0].f, 4)} Hz`, k: "First mode", w: `ζ = ${fix(100 * res.zeta, 1)} %, T₁ = ${fmt(res.modal.modes[0].T, 3)} s` }]));
      out.push(h("h3", null, "Ground acceleration"));
      const dec = (arr, n) => { const k = Math.max(1, Math.floor(arr.length / n)); return arr.filter((_, i) => i % k === 0); };
      out.push(App.chart([{ x: dec(res.tH, 600), y: dec(res.ag, 600), color: "#8A949C", width: 1 }], { xlabel: "t (s)", ylabel: "g", height: 130 }));
      out.push(h("h3", null, "Roof response"));
      const tm = res.frameT[Math.min(st.step, res.frameT.length - 1)];
      out.push(App.chart([{ x: dec(res.tH, 800), y: dec(res.ctrlH.map(v => v * 1000), 800), color: "var(--deformed)", width: 1.5 }], { xlabel: "t (s)", ylabel: "mm", height: 160, marker: { x: tm, y: res.ctrlH[Math.round(tm / res.record.dt)] * 1000 } }));
      out.push(h("h3", null, "Base shear"));
      out.push(App.chart([{ x: dec(res.tH, 800), y: dec(res.shearH, 800), color: "var(--shear)", width: 1.5 }], { xlabel: "t (s)", ylabel: "kN", height: 150 }));
      if (res.levels.length > 1) {
        out.push(h("h3", null, "Peak interstory drift"));
        out.push(table(["Level", "Height (m)", "Drift ratio", ""], res.drift.map((d, i) => [i + 1, fix(res.levels[i + 1].y, 2), `${fix(100 * d, 3)} %`, h("div", { class: "bar" + (d > 0.01 ? " red" : ""), style: `width:${Math.min(120, d * 8000)}px` })])));
        out.push(h("p", { class: "note" }, "ASCE 7 allows about 2 % drift for typical buildings; this check uses elastic response without the deflection amplification factor."));
      }
      out.push(h("p", { class: "note" }, `${App.esc(res.record.name)}: ${res.record.a.length} points at Δt = ${res.record.dt} s. Rayleigh coefficients a₀ = ${fmt(res.a0, 3)} s⁻¹, a₁ = ${fmt(res.a1, 3)} s from modes 1 and 2.`));
      return true;
    }
    return false;
  };

  // ------------------------------------------------------------------ AISC 360 checks
  App.aiscPanel = function (res) {
    const box = h("div", { class: "aisc" }, h("h3", null, "Member checks (AISC 360-16, LRFD)"));
    if (!res || !["linear", "second", "combo"].includes(res.kind)) { box.append(h("p", { class: "note" }, "Run a linear, second-order or load-combination analysis to check members.")); return box; }
    const rows = Adv().aiscCheck(st.model, res);
    st.aiscRows = rows;
    if (!rows.length) { box.append(h("p", { class: "note" }, "Give the sections a yield stress fy to check members.")); return box; }
    box.append(h("p", { class: "note" }, "In-plane check: compression by E3 with K from the Members tab, tension D2, flexure φMn = 0.9 Fy Z (members assumed laterally braced, compact), interaction H1-1. Use the second-order analysis for required strengths per the direct analysis method."));
    box.append(table(["Member", "Pr (kN)", "φPn (kN)", "Mr (kN·m)", "φMn (kN·m)", "KL/r", "Ratio", ""], rows.map(r => [r.member + 1, `${fix(r.Pr)} ${r.comp ? "C" : "T"}`, fix(r.Pc), fix(r.Mr), Number.isFinite(r.Mc) ? fix(r.Mc) : "–", fix(r.KLr, 1), { v: fix(r.ratio, 3), cls: r.ratio <= 1 ? "pass" : "fail" }, r.eq + (res.kind === "combo" ? `, ${r.combo}` : "")]),
      { onclick: i => { st.sel = { kind: "member", i: rows[i].member }; st.sheetMember = rows[i].member; st.sheetAuto = false; App.refreshSelection(); } }));
    const worst = rows.reduce((a, b) => (b.ratio > a.ratio ? b : a));
    box.append(h("p", { class: "note" + (worst.ratio > 1 ? " bad" : "") }, `Governing: member ${worst.member + 1}, ratio ${fix(worst.ratio, 3)} (${worst.ratio <= 1 ? "adequate" : "overstressed"}).`));
    box.append(h("div", { class: "row-actions" }, h("button", { onclick: () => { st.utilMode = "aisc"; App.setView("U"); } }, "Colour members by AISC ratio"), h("button", { onclick: () => App.openSheet() }, "Show the hand check")));
    return box;
  };
  App.aiscUtilSVG = function (res, stt, legend, toS) {
    const rows = st.aiscRows && st.aiscRows.length ? st.aiscRows : Adv().aiscCheck(st.model, res);
    const out = [], A = stt.A, byM = new Map(rows.map(r => [r.member, r]));
    st.model.members.forEach((q, mi) => {
      const r = byM.get(mi); const els = A.memberEls[mi]; if (!els || !els.length) return;
      const a = A.X[A.els[els[0]].i], b = A.X[A.els[els[els.length - 1]].j], p0 = toS(a[0], a[1]), p1 = toS(b[0], b[1]);
      out.push(`<line x1="${p0[0]}" y1="${p0[1]}" x2="${p1[0]}" y2="${p1[1]}" stroke="${r ? App.utilColor(r.ratio * App.growFactor()) : "#B8C0C6"}" stroke-width="8" stroke-linecap="round"/>`);
      if (r && st.showValues) { const x = (p0[0] + p1[0]) / 2, y = (p0[1] + p1[1]) / 2; out.push(`<rect x="${x - 19}" y="${y - 22}" width="38" height="15" rx="7" fill="#fff" opacity=".92"/><text class="dia-txt" x="${x}" y="${y - 11}" text-anchor="middle" style="fill:${App.utilColor(r.ratio)};stroke:none">${r.ratio.toFixed(2)}</text>`); }
    });
    legend.push(`<span class="ubar"></span><span>AISC 360 interaction ratio (H1-1)${res.kind === "combo" ? ", worst combination" : ""}. <a href="#" onclick="App.state.utilMode='plastic';App.render();return false">Show plastic utilization</a></span>`);
    return out.join("");
  };

  // ------------------------------------------------------------------ baseline comparison
  App.setBaseline = function () {
    const r = App.shownResult();
    if (!r || !["linear", "second", "combo"].includes(r.kind)) { App.toast("Compare works with linear, second-order and combination results"); return; }
    const stt = App.stateOf(r);
    st.baseline = { title: st.model.title, nodes: st.model.nodes.length, kind: r.kind, stt, A: stt.A, summary: summarize(stt), when: new Date() };
    App.toast("Saved as the baseline. Change the model and compare."); App.renderRight(); App.render();
  };
  function summarize(stt) {
    let D = 0, Mx = 0, Nx = 0;
    for (let n = 0; n < stt.A.nOrig; n++) D = Math.max(D, Math.hypot(stt.u[3 * n], stt.u[3 * n + 1]));
    stt.A.els.forEach((el, e) => { const smp = S().sampleElement(el, stt.infos[e], S().elemLoads(el, stt.g, stt.lam), S().elemQ(el, stt.g, stt.lam), 12); smp.M.forEach(v => { Mx = Math.max(Mx, Math.abs(v)); }); smp.N.forEach(v => { Nx = Math.max(Nx, Math.abs(v)); }); });
    const P = new Float64Array(stt.A.ndof); for (let d = 0; d < P.length; d++) P[d] = stt.g * stt.A.P0[d] + stt.lam * stt.A.Pr[d];
    const R = new Map(); stt.A.fixedList.forEach(d => { if (d < 3 * stt.A.nOrig) R.set(d, stt.F[d] - P[d]); });
    return { D, Mx, Nx, R };
  }
  App.comparePanel = function (res) {
    const box = h("div", { class: "compare" }, h("h3", null, "Compare with a baseline"));
    if (!st.baseline) {
      box.append(h("p", { class: "note" }, "Save the current results as a baseline, change the model (supports, sections, connections, loads), and see the differences side by side and drawn over the new results."),
        h("button", { onclick: App.setBaseline }, "Save as baseline"));
      return box;
    }
    const b = st.baseline, stt = res && ["linear", "second", "combo"].includes(res.kind) ? App.stateOf(res) : null;
    const cur = stt ? summarize(stt) : null;
    const pct = (x, y) => (Math.abs(y) > 1e-12 ? `${fix(100 * (x - y) / Math.abs(y), 1)} %` : "–");
    const rows = [["Largest displacement (mm)", App.mm(b.summary.D), cur ? App.mm(cur.D) : "–", cur ? pct(cur.D, b.summary.D) : ""],
      ["Largest |M| (kN·m)", fix(b.summary.Mx), cur ? fix(cur.Mx) : "–", cur ? pct(cur.Mx, b.summary.Mx) : ""], ["Largest |N| (kN)", fix(b.summary.Nx), cur ? fix(cur.Nx) : "–", cur ? pct(cur.Nx, b.summary.Nx) : ""]];
    b.summary.R.forEach((v, d) => { const c = cur && cur.R.has(d) ? cur.R.get(d) : null; rows.push([`${["Rx", "Ry", "M"][d % 3]} node ${Math.floor(d / 3) + 1}`, fix(v), c === null ? "–" : fix(c), c === null ? "" : pct(c, v)]); });
    box.append(h("p", { class: "note" }, `Baseline: ${App.esc(b.title)} (${b.kind}), saved ${b.when.toLocaleTimeString()}. Its deformed shape and diagrams are drawn in grey under the current ones.`));
    box.append(table(["Quantity", "Baseline", "Current", "Change"], rows));
    box.append(h("div", { class: "row-actions" }, h("button", { onclick: App.setBaseline }, "Replace with current"), h("button", { onclick: () => { st.baseline = null; App.renderRight(); App.render(); } }, "Clear baseline")));
    return box;
  };
  App.baselineSVG = function (view, toS) {
    const b = st.baseline; if (!b || b.nodes !== st.model.nodes.length) return "";
    const stt = b.stt, A = stt.A, out = [];
    if (view === "deformed") {
      let mx = 0; for (let n = 0; n < A.X.length; n++) mx = Math.max(mx, Math.hypot(stt.u[3 * n], stt.u[3 * n + 1]));
      const cur = App.shownResult(), cs = cur ? App.stateOf(cur) : null; let mc = 0;
      if (cs) for (let n = 0; n < cs.A.X.length; n++) mc = Math.max(mc, Math.hypot(cs.u[3 * n], cs.u[3 * n + 1]));
      const xs = A.X.map(p => p[0]), ys = A.X.map(p => p[1]), size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-6);
      const sc = 0.09 * size / (Math.max(mc, 1e-12)) * Math.pow(10, st.scale);   // same scale as the current shape
      A.els.forEach((el, e) => { const pts = S().elementShape(A, el, stt.u, stt.infos[e], S().elemLoads(el, stt.g, stt.lam), S().elemQ(el, stt.g, stt.lam), sc, true); out.push(`<polyline points="${pts.map(p => toS(p[0], p[1]).map(v => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="#7D8A95" stroke-width="2" stroke-dasharray="6 4"/>`); });
      void mx;
    } else if (view === "M" || view === "V") {
      out.push("");
    }
    return out.join("");
  };

  // ------------------------------------------------------------------ corrosion Monte Carlo (Damage tab)
  App.corrosionPanel = function () {
    const m = st.model, s = m.settings, box = h("div", { class: "corrosion" }, h("h3", null, "Section-loss uncertainty (corrosion)"));
    box.append(h("p", { class: "note" }, "Each sample removes a random fraction of the section (uniform between the limits) from each chosen member, scaling A, I and Z, and reruns the collapse analysis. The spread shows how uncertain the remaining capacity is."));
    const cols = m.members.map((q, i) => ({ q, i })).filter(({ q }) => Math.abs(m.nodes[q.i].x - m.nodes[q.j].x) < 1e-9).map(x => x.i);
    const cs = st.corr || (st.corr = { members: (cols.length ? cols : m.members.map((_, i) => i)).map(i => i + 1).join(", "), lo: 0, hi: 30, n: 100, seed: 1, thr: 90 });
    const inp = (label, key, attrs) => h("label", { class: "field" }, label, h("input", Object.assign({ value: cs[key], onchange: ev => { cs[key] = ev.target.value; } }, attrs || {})));
    box.append(h("div", { class: "inline-form" }, inp("Members", "members", { title: "Member numbers, e.g. 1, 2, 3 (default: the columns)" }), inp("Loss from (%)", "lo", { type: "number", style: "width:70px" }), inp("to (%)", "hi", { type: "number", style: "width:70px" })),
      h("div", { class: "inline-form" }, inp("Samples", "n", { type: "number", style: "width:80px" }), inp("Seed", "seed", { type: "number", style: "width:70px" }), inp("Threshold (% of intact)", "thr", { type: "number", style: "width:80px" }),
        h("button", { class: "primary", style: "padding:5px 12px", onclick: () => runCorrosion() }, "Run samples")));
    const R = st.corrResult;
    if (R && R.key === App.snapshot()) {
      const sts = R.stats, thrAbs = R.intact * (+cs.thr / 100);
      const below = R.lams.filter(v => v < thrAbs).length / R.lams.length;
      box.append(h("div", { class: "tiles" }, ...[
        { v: fmt(sts.mean, 4), k: "Mean λlim", w: `intact ${fmt(R.intact, 4)}` }, { v: `${fix(100 * sts.cov, 1)} %`, k: "Coefficient of variation", w: `σ = ${fmt(sts.sd, 3)}` },
        { v: fmt(sts.p05, 4), k: "5th percentile", w: `${fix(100 * sts.p05 / R.intact, 1)} % of intact` }, { v: `${fix(100 * below, 1)} %`, k: `P(λ < ${cs.thr} % of intact)`, w: `${R.lams.length} samples` }]
        .map(t => h("div", { class: "tile" }, h("div", { class: "v" }, t.v), h("div", { class: "k" }, t.k), h("div", { class: "w" }, t.w)))));
      box.append(histogram(R.lams, R.intact, thrAbs));
    }
    return box;
  };
  function histogram(vals, intact, thr) {
    const lo = Math.min(...vals), hi = Math.max(...vals, intact), nb = 20, w = (hi - lo) / nb || 1, bins = new Array(nb).fill(0);
    vals.forEach(v => { bins[Math.min(nb - 1, Math.floor((v - lo) / w))]++; });
    const W = 380, H = 180, pl = 34, pb = 30, mx = Math.max(...bins), bw = (W - pl - 10) / nb;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" style="height:${H}px">`;
    bins.forEach((c, i) => { const x = pl + i * bw, hh = (H - pb - 10) * c / mx, mid = lo + (i + 0.5) * w; s += `<rect x="${x + 1}" y="${H - pb - hh}" width="${bw - 2}" height="${hh}" fill="${mid < thr ? "rgba(201,42,42,.75)" : "rgba(31,95,191,.7)"}" rx="2"/>`; });
    const X = v => pl + (v - lo) / (w * nb) * (W - pl - 10);
    s += `<line x1="${X(intact)}" x2="${X(intact)}" y1="8" y2="${H - pb}" stroke="#23282C" stroke-dasharray="4 3"/><text x="${X(intact) - 4}" y="16" text-anchor="end">intact</text>`;
    s += `<line x1="${X(thr)}" x2="${X(thr)}" y1="8" y2="${H - pb}" stroke="var(--compression)" stroke-dasharray="2 3"/>`;
    for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; s += `<text x="${X(v)}" y="${H - pb + 14}" text-anchor="middle">${fmt(v, 3)}</text>`; }
    s += `<text x="${(pl + W) / 2}" y="${H - 3}" text-anchor="middle">collapse load factor λlim</text><text transform="translate(11 ${(H - pb) / 2}) rotate(-90)" text-anchor="middle">count</text></svg>`;
    const d = h("div"); d.innerHTML = s; return d;
  }
  function runCorrosion() {
    const m = st.model, cs = st.corr, msg = App.$("#runMsg");
    const members = String(cs.members).split(/[,; ]+/).map(Number).filter(v => v >= 1 && v <= m.members.length).map(v => v - 1);
    if (!members.length) { App.toast("List the members that corrode"); return; }
    const basis = App.analysisOptions({ lamMax: m.settings.lamMax || 10 });
    const intact = S().pushover(m, basis);
    if (intact.status !== "collapse") { App.toast("The intact structure does not reach a mechanism: raise the maximum load factor"); return; }
    const rng = Adv().mulberry32(+cs.seed || 1), n = Math.max(5, Math.min(2000, +cs.n || 100)), lams = [];
    const opts = { members, lossMin: (+cs.lo || 0) / 100, lossMax: (+cs.hi || 0) / 100, basis };
    let k = 0;
    const step = () => {
      const t0 = performance.now();
      while (k < n && performance.now() - t0 < 60) { lams.push(Adv().corrosionSample(m, opts, rng).lam); k++; }
      msg.className = "runmsg"; msg.textContent = `Corrosion samples: ${k} of ${n}…`;
      if (k < n) { setTimeout(step, 0); return; }
      st.corrResult = { key: App.snapshot(), lams, intact: intact.lamLim, stats: Adv().stats(lams) };
      msg.textContent = `Ran ${n} samples.`; App.renderRight();
    };
    setTimeout(step, 20);
  }

  // ------------------------------------------------------------------ play the method (animated assembly)
  App.playMethodPanel = function () {
    const res = st.lin;
    const box = h("div", { class: "playbox" });
    if (!res || !res.K || res.unstable) return box;
    const A = res.A, order = [...A.free, ...A.fixedList], n = order.length, nf = A.free.length;
    const size = Math.min(380, Math.max(160, n * 12)), cell = size / n;
    const cv = h("canvas", { width: size * 2, height: size * 2, style: `width:${size}px;height:${size}px`, class: "play-k", "aria-label": "Animated assembly of the global stiffness matrix" });
    const cap = h("p", { class: "note play-cap" }, "Press play: each element's [k] is added into [K] at its code numbers, then the free block is solved.");
    const btn = h("button", { class: "primary", onclick: () => run() }, "▶ Play the direct stiffness method");
    box.append(h("h3", null, "Watch it assemble"), btn, cap, cv);
    const g = cv.getContext("2d"); g.scale(2, 2);
    const idx = new Map(order.map((d, i) => [d, i]));
    const draw = (partial, flash) => {
      g.clearRect(0, 0, size, size);
      let mx = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) mx = Math.max(mx, Math.abs(res.K[order[i]][order[j]]));
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const v = partial[i][j];
        if (v === 0) { g.fillStyle = "#FAFBF9"; } else { const a = 0.25 + 0.75 * Math.pow(Math.abs(v) / mx, 0.3); g.fillStyle = v > 0 ? `rgba(45,108,223,${a})` : `rgba(201,42,42,${a})`; }
        g.fillRect(j * cell, i * cell, cell - (cell > 4 ? 0.6 : 0), cell - (cell > 4 ? 0.6 : 0));
        if (flash && flash.has(i) && flash.has(j)) { g.strokeStyle = "#E8590C"; g.lineWidth = Math.max(1, cell / 6); g.strokeRect(j * cell + 0.5, i * cell + 0.5, cell - 1, cell - 1); }
      }
      g.strokeStyle = "#23282C"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(nf * cell, 0); g.lineTo(nf * cell, size); g.moveTo(0, nf * cell); g.lineTo(size, nf * cell); g.stroke();
    };
    const empty = () => Array.from({ length: n }, () => new Float64Array(n));
    draw(empty());
    let running = false;
    function run() {
      if (running) return; running = true; btn.disabled = true;
      const partial = empty();
      const mats = A.els.map((el, e) => ({ el, d: S().elemDofs(el), k: S().elementMatrices(res, e).kGlobal }));
      let e = 0;
      const prevView = st.view; App.setView("model", true);
      const tick = () => {
        if (e < mats.length) {
          const { el, d, k } = mats[e], flash = new Set();
          d.forEach((r, a) => { if (!idx.has(r)) return; flash.add(idx.get(r)); d.forEach((c, b) => { if (idx.has(c)) partial[idx.get(r)][idx.get(c)] += k[a][b]; }); });
          draw(partial, flash);
          st.methodHL = el.parent; App.render();
          cap.textContent = `Element ${el.nsub > 1 ? `${el.parent + 1}.${el.k + 1}` : el.parent + 1}: [k] = [Γ]ᵀ[k′][Γ] goes into rows and columns ${d.map(x => idx.has(x) ? idx.get(x) + 1 : "–").join(", ")}.`;
          e++; setTimeout(tick, Math.max(160, Math.min(700, 5000 / mats.length)));
          return;
        }
        st.methodHL = null; draw(partial, null);
        cap.textContent = `[K] assembled (${n} × ${n}). The top-left block [K]ff (${nf} × ${nf}) is solved for the displacements…`;
        setTimeout(() => {
          App.setView(prevView === "model" ? "deformed" : prevView); App.startGrow();
          cap.textContent = "Solved: {Δ}f = [K]ff⁻¹({P}f − [K]fs{Δ}s). Reactions follow from the support rows; member forces from [k′][Γ]{Δ}.";
          running = false; btn.disabled = false;
        }, 900);
      };
      tick();
    }
    return box;
  };
})();
