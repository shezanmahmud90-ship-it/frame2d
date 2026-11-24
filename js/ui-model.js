/* Frame2D Studio - model editor (left panel) */
(function () {
  "use strict";
  const App = window.App, st = App.state, h = App.h, E = () => window.Examples;

  App.supportKind = function (s) {
    if (s.incline) return "inclined";
    const k = `${+s.ux}${+s.uy}${+s.rz}`, springs = +s.kx || +s.ky || +s.kr, settle = +s.dx || +s.dy || +s.dr;
    if (springs) return "custom";
    return ({ "111": "fixed", "110": "pinned", "010": "rollerX", "100": "rollerY", "101": "guide" })[k] || (settle ? "custom" : "custom");
  };
  const SUPPORT_TYPES = [["fixed", "Fixed"], ["pinned", "Pinned"], ["rollerX", "Roller, slides in x"], ["rollerY", "Roller, slides in y"], ["guide", "Guide, slides in y"], ["inclined", "Roller on an incline"], ["custom", "Custom (springs)"]];
  const CASE_OPTS = [["D", "D dead"], ["L", "L live"], ["W", "W wind"], ["E", "E earthquake"], ["S", "S snow"], ["T", "T temperature"]];
  const caseOf = (l, isMember) => window.Adv ? window.Adv.loadCase(l, isMember) : "D";
  const DIRS = [["GY", "Global Y"], ["GX", "Global X"], ["local", "Perpendicular"], ["axial", "Along member"]];
  const PATS = [["R", "Scaled by λ"], ["G", "Constant"]];

  function num(key, value, onset, attrs) {
    return h("input", Object.assign({ type: "number", step: "any", value: value === null || value === undefined || value === "" ? "" : +(+value).toPrecision(10), "data-k": key,
      onchange: ev => { const raw = ev.target.value; onset(raw === "" ? null : +raw); } }, attrs || {}));
  }
  function sel(key, value, options, onset) {
    const s = h("select", { "data-k": key, onchange: ev => onset(ev.target.value) }, options.map(([v, t]) => h("option", { value: v }, t)));
    s.value = String(value); return s;
  }
  function nodeOptions() { return st.model.nodes.map((n, i) => [String(i), `${i + 1}`]); }
  function memberOptions() { return st.model.members.map((q, i) => [String(i), `${i + 1}`]); }
  const x = (title, fn) => h("button", { title, "aria-label": title, onclick: fn }, "×");

  // ------------------------------------------------------------------ tabs
  const tabs = {
    nodes() {
      const m = st.model, t = h("table", { class: "edit" },
        h("thead", null, h("tr", null, h("th", null, "#"), h("th", null, "x (m)"), h("th", null, "y (m)"), h("th"))));
      const tb = h("tbody");
      m.nodes.forEach((n, i) => tb.append(h("tr", { "data-kind": "node", "data-i": i },
        h("td", { class: "idx", onclick: () => select({ kind: "node", i }) }, i + 1),
        h("td", null, num(`n${i}x`, n.x, v => App.change(mm => { mm.nodes[i].x = v || 0; }))),
        h("td", null, num(`n${i}y`, n.y, v => App.change(mm => { mm.nodes[i].y = v || 0; }))),
        h("td", { class: "x" }, x(`Delete node ${i + 1}`, () => App.deleteNode(i))))));
      t.append(tb);
      return [t, h("div", { class: "row-actions" },
        h("button", { onclick: () => { const last = m.nodes[m.nodes.length - 1] || { x: 0, y: 0 }; App.change(mm => mm.nodes.push({ x: +last.x + (+App.$("#gridSize").value || 1), y: +last.y })); } }, "Add node"),
        h("span", { class: "help" }, "Or use the Node tool on the drawing."))];
    },
    members() {
      const m = st.model;
      const secOpts = m.sections.map((s, i) => [String(i), s.name || `Section ${i + 1}`]);
      const t = h("table", { class: "edit" }, h("thead", null, h("tr", null, h("th", null, "#"), h("th", null, "Start"), h("th", null, "End"), h("th", null, "Section"), h("th", null, "Type"), h("th", { title: "Moment release (pin) at the start" }, "Pin i"), h("th", { title: "Moment release (pin) at the end" }, "Pin j"), h("th"))));
      const tb = h("tbody");
      m.members.forEach((q, i) => {
        const truss = q.type === "truss";
        tb.append(h("tr", { "data-kind": "member", "data-i": i, title: q.removed ? "Removed in the damage study" : null },
          h("td", { class: "idx", onclick: () => select({ kind: "member", i }), style: q.removed ? "text-decoration:line-through;color:var(--compression)" : null }, i + 1),
          h("td", null, sel(`m${i}i`, q.i, nodeOptions(), v => App.change(mm => { mm.members[i].i = +v; }))),
          h("td", null, sel(`m${i}j`, q.j, nodeOptions(), v => App.change(mm => { mm.members[i].j = +v; }))),
          h("td", null, sel(`m${i}s`, q.sec, secOpts, v => { st.lastSection = +v; App.change(mm => { mm.members[i].sec = +v; }); })),
          h("td", null, sel(`m${i}t`, q.type, [["frame", "Frame"], ["truss", "Truss"]], v => App.change(mm => { mm.members[i].type = v; }))),
          h("td", { class: "chk" }, h("input", { type: "checkbox", checked: q.relI || truss, disabled: truss, "aria-label": "Pin at start", onchange: ev => App.change(mm => { mm.members[i].relI = ev.target.checked; }) })),
          h("td", { class: "chk" }, h("input", { type: "checkbox", checked: q.relJ || truss, disabled: truss, "aria-label": "Pin at end", onchange: ev => App.change(mm => { mm.members[i].relJ = ev.target.checked; }) })),
          h("td", { class: "x" }, x(`Delete member ${i + 1}`, () => App.deleteMember(i)))));
      });
      t.append(tb);
      return [h("p", { class: "help" }, "Frame members carry axial force, shear and moment. Truss members carry axial force only. A pin releases the end moment."), t, connectionPanel(),
        h("div", { class: "row-actions" }, h("span", { class: "help" }, "Draw members with the Member tool."))];
    },
    sections() {
      const m = st.model, U = App.U, out = [];
      out.push(h("p", { class: "help" }, "Plastic modulus Z and yield stress fy give Mp = fy Z for the plastic collapse analysis. W-shape values come from the AISC Shapes Database: check them before quoting results."));
      m.sections.forEach((s, i) => {
        const used = m.members.filter(q => q.sec === i).length;
        const f = (key, label) => h("label", null, `${label} (${U[key].u})`, num(`s${i}${key}`, s[key] === undefined ? 0 : App.toDisp(+s[key], key), v => App.change(mm => { mm.sections[i][key] = App.fromDisp(v || 0, key); })));
        out.push(h("div", { class: "card-row" },
          h("div", { class: "head" }, h("input", { value: s.name, "data-k": `s${i}n`, "aria-label": "Section name", style: "flex:1;font-weight:600", onchange: ev => App.change(mm => { mm.sections[i].name = ev.target.value; }) }),
            h("span", { class: "help", style: "margin:0" }, `${used} member${used === 1 ? "" : "s"}`),
            x(`Delete section ${s.name}`, () => { if (used) { App.toast("Reassign its members first"); return; } App.change(mm => { mm.sections.splice(i, 1); mm.members.forEach(q => { if (q.sec > i) q.sec--; }); }); })),
          h("div", { class: "line", style: "grid-template-columns:repeat(3,1fr)" }, f("E", "E"), f("A", "A"), f("I", "I")),
          h("div", { class: "line", style: "grid-template-columns:repeat(5,1fr)" }, f("Z", "Z"), f("fy", "fy"),
            h("label", { title: "Shear area for shear deformation (Timoshenko). Leave 0 to ignore shear deformation." }, "As (cm²)", num(`s${i}As`, (+s.As || 0) * 1e4, v => App.change(mm => { mm.sections[i].As = (v || 0) * 1e-4; }))),
            h("label", { title: "Mass density for modal analysis" }, "ρ (t/m³)", num(`s${i}rho`, s.rho === undefined || s.rho === null ? (s.E >= 1e8 ? 7.85 : 2.4) : s.rho, v => App.change(mm => { mm.sections[i].rho = v === null ? null : v; }))),
            h("label", null, "Mp (kN·m)", h("input", { value: App.fix((+s.Z || 0) * (+s.fy || 0)), disabled: true })))));
      });
      const lib = h("select", { "aria-label": "AISC W-shape" }, E().LIBRARY.map(s => h("option", { value: s.name }, s.name)));
      const b = h("input", { type: "number", value: 300, step: "any", "aria-label": "Width b in mm", style: "width:70px" });
      const d = h("input", { type: "number", value: 500, step: "any", "aria-label": "Depth h in mm", style: "width:70px" });
      out.push(h("h3", { class: "sub" }, "Add a section"),
        h("div", { class: "inline-form" }, lib, h("button", { onclick: () => App.change(mm => mm.sections.push(E().wSection(lib.value))) }, "Add W-shape")),
        h("div", { class: "inline-form" }, h("span", { class: "help", style: "margin:0" }, "Rectangle b × h (mm)"), b, d,
          h("button", { onclick: () => App.change(mm => mm.sections.push(E().rectSection(`Rect ${b.value}×${d.value}`, b.value / 1000, d.value / 1000, 30e6, 0))) }, "Add")));
      return out;
    },
    supports() {
      const m = st.model, out = [];
      out.push(h("p", { class: "help" }, "Supports can also be set with the Support tool. Custom supports take springs and prescribed settlements."));
      m.supports.forEach((s, i) => {
        const kind = App.supportKind(s);
        const upd = fn => App.change(mm => fn(mm.supports[i]));
        const card = h("div", { class: "card-row", "data-kind": "support", "data-i": s.node },
          h("div", { class: "line", style: "grid-template-columns:70px 1fr 24px" },
            h("label", null, "Node", sel(`p${i}n`, s.node, nodeOptions(), v => upd(q => { q.node = +v; }))),
            h("label", null, "Type", sel(`p${i}t`, kind, SUPPORT_TYPES, v => upd(q => {
              if (v === "inclined") { Object.assign(q, { incline: true, angle: q.angle || 30, ux: false, uy: false, rz: false, kx: 0, ky: 0, kr: 0, dx: 0, dy: 0 }); return; }
              q.incline = false;
              if (v !== "custom") { const t = E().sup(q.node, v); Object.assign(q, { ux: t.ux, uy: t.uy, rz: t.rz, kx: 0, ky: 0, kr: 0 }); } }))),
            h("div", { class: "head" }, x(`Remove support at node ${s.node + 1}`, () => App.change(mm => mm.supports.splice(i, 1))))),
          h("div", { class: "line", style: "grid-template-columns:repeat(3,1fr)" },
            h("label", null, "Settle x (mm)", num(`p${i}dx`, (+s.dx || 0) * 1000, v => upd(q => { q.dx = (v || 0) / 1000; }), { disabled: !s.ux })),
            h("label", null, "Settle y (mm)", num(`p${i}dy`, (+s.dy || 0) * 1000, v => upd(q => { q.dy = (v || 0) / 1000; }), { disabled: !s.uy })),
            h("label", null, "Rotate (rad)", num(`p${i}dr`, +s.dr || 0, v => upd(q => { q.dr = v || 0; }), { disabled: !s.rz }))));
        if (kind === "inclined") {
          card.children[1].remove();
          card.append(h("div", { class: "line", style: "grid-template-columns:1fr 1fr" },
            h("label", { title: "Angle of the rolling surface from the horizontal, counter-clockwise positive" }, "Surface angle (°)", num(`p${i}ang`, s.angle || 0, v => upd(q => { q.angle = v || 0; }))),
            h("label", { style: "flex-direction:row;align-items:center;gap:5px;color:var(--ink);margin-top:14px" }, h("input", { type: "checkbox", checked: s.rz, onchange: ev => upd(q => { q.rz = ev.target.checked; }) }), "Also fix rotation")));
        }
        if (kind === "custom") card.append(
          h("div", { class: "line", style: "grid-template-columns:repeat(3,1fr)" },
            ...[["ux", "kx", "Fix x", "kx (kN/m)"], ["uy", "ky", "Fix y", "ky (kN/m)"], ["rz", "kr", "Fix θ", "kθ (kN·m/rad)"]].map(([f, k, lf, lk]) =>
              h("div", null, h("label", { style: "flex-direction:row;align-items:center;gap:5px;color:var(--ink)" }, h("input", { type: "checkbox", checked: s[f], onchange: ev => upd(q => { q[f] = ev.target.checked; }) }), lf),
                h("label", null, lk, num(`p${i}${k}`, s[k], v => upd(q => { q[k] = v || 0; }), { disabled: s[f] }))))));
        out.push(card);
      });
      const free = m.nodes.map((_, i) => i).filter(i => !m.supports.some(s => s.node === i));
      out.push(h("div", { class: "row-actions" }, h("button", { disabled: !free.length, onclick: () => App.change(mm => mm.supports.push(E().sup(free[0], "pinned"))) }, "Add support")));
      return out;
    },
    loads() {
      const m = st.model, out = [];
      out.push(h("p", { class: "help" }, "Positive values act along +x, +y and counter-clockwise. Loads scaled by λ are increased in the nonlinear analyses; constant loads (gravity) are applied first and held."));
      out.push(h("h3", { class: "sub" }, "Nodal loads"));
      m.nodeLoads.forEach((l, i) => {
        const upd = fn => App.change(mm => fn(mm.nodeLoads[i]));
        out.push(h("div", { class: "card-row", "data-kind": "node", "data-i": l.node },
          h("div", { class: "line", style: "grid-template-columns:52px 1fr 1fr 1fr 24px" },
            h("label", null, "Node", sel(`l${i}n`, l.node, nodeOptions(), v => upd(q => { q.node = +v; }))),
            h("label", null, "Fx (kN)", num(`l${i}x`, l.fx, v => upd(q => { q.fx = v || 0; }))),
            h("label", null, "Fy (kN)", num(`l${i}y`, l.fy, v => upd(q => { q.fy = v || 0; }))),
            h("label", null, "M (kN·m)", num(`l${i}m`, l.mz, v => upd(q => { q.mz = v || 0; }))),
            h("div", { class: "head" }, x("Remove load", () => App.change(mm => mm.nodeLoads.splice(i, 1))))),
          h("div", { class: "line", style: "grid-template-columns:1fr 1fr" }, sel(`l${i}c`, caseOf(l, false), CASE_OPTS, v => upd(q => { q.lc = v; })), sel(`l${i}p`, l.pat, PATS, v => upd(q => { q.pat = v; })))));
      });
      out.push(h("div", { class: "row-actions" }, h("button", { disabled: !m.nodes.length, onclick: () => App.change(mm => mm.nodeLoads.push(E().nload(st.sel && st.sel.kind === "node" ? st.sel.i : 0, 0, -10))) }, "Add nodal load")));
      out.push(h("h3", { class: "sub" }, "Member loads"));
      m.memberLoads.forEach((l, i) => {
        const upd = fn => App.change(mm => fn(mm.memberLoads[i]));
        const point = l.kind === "point", thermal = l.kind === "thermal", misfit = l.kind === "misfit";
        const KINDS = [["udl", "Distributed"], ["point", "Point"], ["thermal", "Temperature"], ["misfit", "Misfit (lack of fit)"]];
        const setKind = v => upd(q => { q.kind = v;
          if (v === "point") { q.P = q.P || q.w1 || -10; q.a = q.a || 0; }
          else if (v === "thermal") { q.dT = q.dT || 30; q.dTg = q.dTg || 0; q.h = q.h || 0.5; q.alpha = q.alpha || 1.2e-5; q.lc = "T"; }
          else if (v === "misfit") { q.dL = q.dL || 0.005; q.lc = "T"; }
          else { q.w1 = q.w1 || q.P || -10; } });
        const body = thermal ? h("div", { class: "line", style: "grid-template-columns:repeat(4,1fr)" },
            h("label", { title: "Uniform temperature change" }, "ΔT (°C)", num(`w${i}dT`, l.dT, v => upd(q => { q.dT = v || 0; }))),
            h("label", { title: "Top (local +y face) minus bottom" }, "ΔT top−bot", num(`w${i}dTg`, l.dTg, v => upd(q => { q.dTg = v || 0; }))),
            h("label", null, "Depth h (m)", num(`w${i}h`, l.h, v => upd(q => { q.h = v || 0; }))),
            h("label", null, "α (1/°C)", num(`w${i}al`, l.alpha, v => upd(q => { q.alpha = v; }))))
          : misfit ? h("div", { class: "line", style: "grid-template-columns:1fr" },
            h("label", { title: "Positive: the member was made too long" }, "Too long by (mm)", num(`w${i}dL`, (+l.dL || 0) * 1000, v => upd(q => { q.dL = (v || 0) / 1000; }))))
          : null;
        out.push(h("div", { class: "card-row", "data-kind": "member", "data-i": l.member },
          h("div", { class: "line", style: "grid-template-columns:62px 1fr 1fr 24px" },
            h("label", null, "Member", sel(`w${i}m`, l.member, memberOptions(), v => upd(q => { q.member = +v; }))),
            h("label", null, "Type", sel(`w${i}k`, l.kind || "udl", KINDS, setKind)),
            (thermal || misfit) ? h("span") : h("label", null, "Direction", sel(`w${i}d`, l.dir, DIRS, v => upd(q => { q.dir = v; }))),
            h("div", { class: "head" }, x("Remove load", () => App.change(mm => mm.memberLoads.splice(i, 1))))),
          body ? body : point ? h("div", { class: "line", style: "grid-template-columns:1fr 1fr" },
            h("label", null, "P (kN)", num(`w${i}P`, l.P, v => upd(q => { q.P = v || 0; }))),
            h("label", null, "at a (m from start)", num(`w${i}a`, l.a, v => upd(q => { q.a = v || 0; }))))
            : h("div", { class: "line", style: "grid-template-columns:repeat(4,1fr)" },
              h("label", null, "w start", num(`w${i}w1`, l.w1, v => upd(q => { q.w1 = v || 0; }))),
              h("label", { title: "Leave blank for a uniform load" }, "w end", num(`w${i}w2`, l.w2, v => upd(q => { q.w2 = v; }), { placeholder: "same" })),
              h("label", null, "from (m)", num(`w${i}a`, l.a, v => upd(q => { q.a = v || 0; }))),
              h("label", { title: "Leave blank for the member end" }, "to (m)", num(`w${i}b`, l.b, v => upd(q => { q.b = v; }), { placeholder: "end" }))),
          h("div", { class: "line", style: "grid-template-columns:1fr 1fr" }, sel(`w${i}c`, caseOf(l, true), CASE_OPTS, v => upd(q => { q.lc = v; })), sel(`w${i}p`, l.pat, PATS, v => upd(q => { q.pat = v; })))));
      });
      out.push(h("div", { class: "row-actions" }, h("button", { disabled: !m.members.length, onclick: () => App.change(mm => mm.memberLoads.push(E().udl(st.sel && st.sel.kind === "member" ? st.sel.i : 0, -10))) }, "Add member load"),
        h("span", { class: "help", style: "margin:0" }, "kN/m for distributed loads")));
      out.push(h("h3", { class: "sub" }, "Nodal masses (modal analysis)"));
      out.push(h("p", { class: "help" }, "Added to the member self-weight (ρA). Constant loads can also count as mass: see the modal options."));
      (m.masses || []).forEach((q, i) => out.push(h("div", { class: "card-row", "data-kind": "node", "data-i": q.node },
        h("div", { class: "line", style: "grid-template-columns:70px 1fr 24px" },
          h("label", null, "Node", sel(`ms${i}n`, q.node, nodeOptions(), v => App.change(mm => { mm.masses[i].node = +v; }))),
          h("label", null, "Mass (t)", num(`ms${i}m`, q.m, v => App.change(mm => { mm.masses[i].m = v || 0; }))),
          h("div", { class: "head" }, x("Remove mass", () => App.change(mm => mm.masses.splice(i, 1))))))));
      out.push(h("div", { class: "row-actions" }, h("button", { disabled: !m.nodes.length, onclick: () => App.change(mm => { mm.masses = mm.masses || []; mm.masses.push({ node: st.sel && st.sel.kind === "node" ? st.sel.i : 0, m: 1 }); }) }, "Add nodal mass")));
      return out;
    }
  };

  /** Semi-rigid connection springs and design data of the selected member, with live fixity sliders. */
  function connectionPanel() {
    const m = st.model;
    const mi = st.sel && st.sel.kind === "member" ? st.sel.i : -1;
    const box = h("div", { class: "conn-panel" }, h("h3", { class: "sub" }, "Connections and design length"));
    if (mi < 0 || !m.members[mi]) { box.append(h("p", { class: "help" }, "Select a member (click it on the drawing or its number) to set semi-rigid connection springs and the effective length factor K.")); return box; }
    const q = m.members[mi], sec = m.sections[q.sec] || {}, a = m.nodes[q.i], b = m.nodes[q.j];
    const L = Math.hypot(b.x - a.x, b.y - a.y), EI = (sec.E || 0) * (sec.I || 0);
    // fixity factor r = 1 / (1 + 3EI/(kL)): 0 pinned, 1 rigid
    const toR = k => (!(k > 0) ? 1 : 1 / (1 + 3 * EI / (k * L)));
    const toK = r => (r >= 0.999 ? 0 : r <= 0.001 ? 1e-6 : 3 * EI * r / (L * (1 - r)));
    const end = (key, label, rel) => {
      const r = rel ? 0 : toR(+q[key]);
      const out = h("span", { class: "conn-val" });
      const show = rr => { out.textContent = rel ? "pinned (release)" : rr >= 0.999 ? "rigid" : `r = ${rr.toFixed(2)}, k = ${App.fmt(toK(rr), 3)} kN·m/rad`; };
      show(r);
      const slider = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: r, disabled: rel || q.type === "truss", "aria-label": `${label} fixity factor`,
        oninput: ev => {
          if (!ev.target._hist) { ev.target._hist = true; st.history.push({ json: App.snapshot(), refs: m.references, study: m.study }); st.future = []; }
          const rr = +ev.target.value; show(rr); q[key] = rr >= 0.999 ? 0 : toK(rr); App.modelChanged({ quick: true }); },
        onchange: () => { App.modelChanged(); } });
      return h("div", { class: "conn-row" }, h("label", null, `${label} (node ${key === "kI" ? q.i + 1 : q.j + 1})`), slider, out);
    };
    box.append(h("p", { class: "help" }, `Member ${mi + 1}. Fixity factor r = 1/(1 + 3EI/kL): 0 is a pin, 1 is rigid. Drag to see the moments redistribute.`),
      end("kI", "Start", q.relI), end("kJ", "End", q.relJ),
      h("div", { class: "inline-form" }, h("label", { class: "field", style: "max-width:150px" }, "Effective length factor K", num(`m${mi}K`, q.K || 1, v => App.change(mm => { mm.members[mi].K = v || 1; })))));
    return box;
  }

  function select(sel) { st.sel = sel; App.refreshSelection(); }

  App.renderLeft = function () {
    const body = App.$("#leftBody");
    const active = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
    const scroll = body.scrollTop;
    body.replaceChildren(...[].concat(tabs[st.leftTab]()));
    body.scrollTop = scroll;
    if (active) { const el = body.querySelector(`[data-k="${active}"]`); if (el) el.focus(); }
    document.querySelectorAll("#leftTabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === st.leftTab));
    App.$("#modelTitle").value = st.model.title;
    App.$("#modelDesc").textContent = st.model.description || "";
    App.refreshSelection(true);
    App.renderStatus();
  };

  App.showLeftFor = function (sel) {
    const tab = { node: "nodes", member: "members", support: "supports", load: "loads" }[sel.kind];
    if (tab && st.leftTab !== tab && !(st.leftTab === "loads" && (sel.kind === "node" || sel.kind === "member")) && !(st.leftTab === "supports" && sel.kind === "node")) { st.leftTab = tab; App.renderLeft(); }
  };

  App.refreshSelection = function (noRender) {
    const s = st.sel;
    if (!noRender && st.leftTab === "members" && st._panelSel !== JSON.stringify(s)) { st._panelSel = JSON.stringify(s); App.renderLeft(); App.render(); return; }
    document.querySelectorAll("#leftBody [data-kind]").forEach(r => {
      const on = !!s && ((r.dataset.kind === s.kind && +r.dataset.i === s.i) || (r.dataset.kind === "support" && s.kind === "node" && +r.dataset.i === s.i));
      r.classList.toggle("sel", on);
      if (on && !noRender) r.scrollIntoView({ block: "nearest" });
    });
    if (!noRender) App.render();
  };

  App.renderStatus = function () {
    const m = st.model, lin = st.lin, el = App.$("#modelStatus");
    const parts = [`${m.nodes.length} nodes, ${m.members.length} members, ${m.supports.length} supports`];
    if (lin && lin.det) {
      const d = lin.det.degree;
      parts.push(lin.unstable ? `<span class="bad">Unstable: the stiffness matrix [K]ff is singular (a mechanism). Check supports and releases.</span>`
        : d < 0 ? `<span class="bad">Too few restraints (degree ${d})</span>`
          : d === 0 ? "Statically determinate" : `Statically indeterminate to degree ${d}`);
    }
    (lin && lin.warnings || []).forEach(w => parts.push(`<span class="warn">${App.esc(w)}</span>`));
    el.innerHTML = parts.join("<br>");
  };

  // ------------------------------------------------------------------ deletion with re-indexing
  App.deleteNode = function (n) {
    App.change(m => {
      const dead = new Set(m.members.map((q, i) => (q.i === n || q.j === n) ? i : -1).filter(i => i >= 0));
      removeMembers(m, dead);
      m.nodes.splice(n, 1);
      const re = k => k > n ? k - 1 : k;
      m.members.forEach(q => { q.i = re(q.i); q.j = re(q.j); });
      m.supports = m.supports.filter(s => s.node !== n); m.supports.forEach(s => { s.node = re(s.node); });
      m.nodeLoads = m.nodeLoads.filter(l => l.node !== n); m.nodeLoads.forEach(l => { l.node = re(l.node); });
    });
    st.sel = null; App.refreshSelection();
  };
  function removeMembers(m, dead) {
    if (!dead.size) return;
    const map = []; let k = 0;
    m.members.forEach((q, i) => { map[i] = dead.has(i) ? -1 : k++; });
    m.members = m.members.filter((q, i) => !dead.has(i));
    m.memberLoads = m.memberLoads.filter(l => !dead.has(l.member)); m.memberLoads.forEach(l => { l.member = map[l.member]; });
    if (m.study) m.study = null;
  }
  App.deleteMember = function (i) { App.change(m => removeMembers(m, new Set([i]))); st.sel = null; App.refreshSelection(); };
  App.deleteSelection = function () {
    if (!st.sel) return;
    if (st.sel.kind === "node") App.deleteNode(st.sel.i); else if (st.sel.kind === "member") App.deleteMember(st.sel.i);
  };

  App.initModelPanel = function () {
    document.querySelectorAll("#leftTabs button").forEach(b => b.addEventListener("click", () => { st.leftTab = b.dataset.tab; App.renderLeft(); }));
    App.$("#modelTitle").addEventListener("change", ev => App.change(m => { m.title = ev.target.value; }, { noRun: true }));
  };
})();
