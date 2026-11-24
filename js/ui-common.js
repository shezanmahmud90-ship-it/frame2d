/* Frame2D Studio - shared UI state and helpers */
(function () {
  "use strict";
  const App = window.App = {
    state: {
      model: null, sel: null, tool: "select", view: "model", res: null, lin: null, stale: false,
      step: 0, scale: 0, showValues: true, showLabels: true, leftTab: "nodes", rightTab: "results",
      history: [], future: [], methodEl: 0, live: true, analysis: "linear"
    },
    hooks: {}
  };

  // ---------- DOM helpers ----------
  App.$ = s => document.querySelector(s);
  App.h = function (tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "html") el.innerHTML = v;
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  };
  App.esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- numbers and units ----------
  App.fmt = (v, d) => window.Solver.fmtNum(v, d || 4);
  App.fix = (v, d) => {                     // fixed-ish formatting for tables
    if (v === null || v === undefined || !Number.isFinite(v)) return "–";
    if (Math.abs(v) < 1e-9) v = 0;
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(2).replace("e+", "e");
    const dd = d === undefined ? (a >= 100 ? 1 : a >= 10 ? 2 : 3) : d;
    const s = v.toFixed(dd);
    return s === "-0" || /^-0\.0+$/.test(s) ? s.slice(1) : s;
  };
  // display units for section properties
  App.U = {
    E: { k: 1e6, u: "GPa" }, A: { k: 1e-4, u: "cm²" }, I: { k: 1e-8, u: "cm⁴" }, Z: { k: 1e-6, u: "cm³" }, fy: { k: 1e3, u: "MPa" },
    disp: { k: 1e-3, u: "mm" }
  };
  App.toDisp = (v, key) => v / App.U[key].k;
  App.fromDisp = (v, key) => v * App.U[key].k;
  App.dofName = d => ["u", "v", "θ"][d % 3] + (Math.floor(d / 3) + 1);
  App.mm = v => App.fix(v * 1000, Math.abs(v * 1000) >= 100 ? 1 : 2);

  // ---------- model ----------
  App.normalize = function (m) {
    m.title = m.title || "Untitled model";
    m.description = m.description || "";
    for (const k of ["nodes", "members", "sections", "supports", "nodeLoads", "memberLoads", "masses"]) m[k] = m[k] || [];
    m.settings = Object.assign({ nsub: 1, interaction: true, analysis: "linear", geometric: true, lamMax: null, steps: 20 }, m.settings || {});
    m.members.forEach(q => { q.type = q.type || "frame"; q.factor = q.factor || 1; q.removed = !!q.removed; q.relI = !!q.relI; q.relJ = !!q.relJ; });
    m.supports.forEach(s => { for (const k of ["kx", "ky", "kr", "dx", "dy", "dr"]) s[k] = +s[k] || 0; s.ux = !!s.ux; s.uy = !!s.uy; s.rz = !!s.rz; });
    m.nodeLoads.forEach(l => { l.pat = l.pat === "G" ? "G" : "R"; });
    m.memberLoads.forEach(l => { l.pat = l.pat === "G" ? "G" : "R"; l.dir = l.dir || "GY"; });
    m.references = m.references || [];
    return m;
  };
  App.cleanForSave = m => {
    const c = JSON.parse(JSON.stringify(m, (k, v) => (k === "references" || k === "study") ? undefined : v));
    c.format = "frame2d-studio/1";
    return c;
  };
  App.snapshot = () => JSON.stringify(App.cleanForSave(App.state.model));

  /** Apply a model change with undo support. fn(model) mutates the model. */
  App.change = function (fn, opts) {
    const st = App.state;
    st.history.push({ json: App.snapshot(), refs: st.model.references, study: st.model.study });
    if (st.history.length > 120) st.history.shift();
    st.future = [];
    fn(st.model);
    App.modelChanged(opts);
  };
  App.undo = function () {
    const st = App.state; if (!st.history.length) return;
    st.future.push({ json: App.snapshot(), refs: st.model.references, study: st.model.study });
    const h = st.history.pop(); st.model = App.normalize(JSON.parse(h.json)); st.model.references = h.refs || []; st.model.study = h.study;
    st.sel = null; App.modelChanged();
  };
  App.redo = function () {
    const st = App.state; if (!st.future.length) return;
    st.history.push({ json: App.snapshot(), refs: st.model.references, study: st.model.study });
    const h = st.future.pop(); st.model = App.normalize(JSON.parse(h.json)); st.model.references = h.refs || []; st.model.study = h.study;
    st.sel = null; App.modelChanged();
  };

  // ---------- misc ----------
  let toastT = null;
  App.toast = function (msg) {
    const t = App.$("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600);
  };
  App.download = function (name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  App.slug = s => (s || "model").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "model";

  /** Simple SVG line chart. series: [{x:[], y:[], color, label, dash, points}] */
  App.chart = function (series, opt) {
    opt = opt || {};
    const W = 380, H = opt.height || 220, pl = 52, pr = 12, pt = 12, pb = 34;
    let xs = [], ys = [];
    series.forEach(s => { xs = xs.concat(s.x); ys = ys.concat(s.y); });
    xs = xs.filter(Number.isFinite); ys = ys.filter(Number.isFinite);
    if (!xs.length) return App.h("p", { class: "note" }, "No data to plot.");
    let x0 = Math.min(0, ...xs), x1 = Math.max(0, ...xs), y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys);
    if (x1 - x0 < 1e-15) x1 = x0 + 1; if (y1 - y0 < 1e-15) y1 = y0 + 1;
    const nice = (a, b) => { const span = b - a, st = Math.pow(10, Math.floor(Math.log10(span / 4))); const m = [1, 2, 2.5, 5, 10].find(k => span / (k * st) <= 6) * st; return { lo: Math.floor(a / m) * m, hi: Math.ceil(b / m) * m, step: m }; };
    const nx = nice(x0, x1), ny = nice(y0, y1);
    const X = v => pl + (v - nx.lo) / (nx.hi - nx.lo) * (W - pl - pr), Y = v => H - pb - (v - ny.lo) / (ny.hi - ny.lo) * (H - pt - pb);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">`;
    for (let v = ny.lo; v <= ny.hi + ny.step * 1e-6; v += ny.step) s += `<line class="gridl" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pl - 6}" y="${Y(v) + 3.5}" text-anchor="end">${App.fmt(+v.toPrecision(6), 3)}</text>`;
    for (let v = nx.lo; v <= nx.hi + nx.step * 1e-6; v += nx.step) s += `<text x="${X(v)}" y="${H - pb + 15}" text-anchor="middle">${App.fmt(+v.toPrecision(6), 3)}</text>`;
    s += `<line class="axis" x1="${pl}" x2="${W - pr}" y1="${Y(Math.max(ny.lo, Math.min(0, ny.hi)))}" y2="${Y(Math.max(ny.lo, Math.min(0, ny.hi)))}"/><line class="axis" x1="${X(Math.max(nx.lo, 0))}" x2="${X(Math.max(nx.lo, 0))}" y1="${pt}" y2="${H - pb}"/>`;
    series.forEach(se => {
      const d = se.x.map((x, k) => `${k ? "L" : "M"}${X(x).toFixed(1)},${Y(se.y[k]).toFixed(1)}`).join("");
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.width || 2}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""} stroke-linejoin="round"/>`;
      (se.points || []).forEach(p => { s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.r || 3.5}" fill="${p.color || se.color}" stroke="#fff" stroke-width="1"/>`; if (p.label) s += `<text x="${X(p.x) + 6}" y="${Y(p.y) - 6}" style="fill:${p.color || se.color};font-weight:600">${App.esc(p.label)}</text>`; });
    });
    if (opt.marker) s += `<circle cx="${X(opt.marker.x)}" cy="${Y(opt.marker.y)}" r="5" fill="none" stroke="#23282C" stroke-width="1.5"/>`;
    s += `<text x="${(pl + W - pr) / 2}" y="${H - 4}" text-anchor="middle">${App.esc(opt.xlabel || "")}</text>`;
    s += `<text transform="translate(11 ${(pt + H - pb) / 2}) rotate(-90)" text-anchor="middle">${App.esc(opt.ylabel || "")}</text></svg>`;
    const wrap = App.h("div"); wrap.innerHTML = s;
    if (series.length > 1 || series[0].label) {
      const lg = App.h("div", { class: "note", style: "display:flex;gap:14px;flex-wrap:wrap;margin-top:0" });
      series.filter(se => se.label).forEach(se => lg.append(App.h("span", null, App.h("i", { style: `display:inline-block;width:16px;height:0;border-top:2.5px ${se.dash ? "dashed" : "solid"} ${se.color};vertical-align:middle;margin-right:5px` }), se.label)));
      wrap.append(lg);
    }
    return wrap;
  };
})();

/* Small static drawing of a model (members, supports, loads) for galleries and cards. */
(function () {
  "use strict";
  const App = window.App;
  App.thumb = function (m, W, H, opts) {
    opts = opts || {};
    W = W || 220; H = H || 130;
    if (!m.nodes.length) return `<svg viewBox="0 0 ${W} ${H}" class="thumb"></svg>`;
    const xs = m.nodes.map(p => +p.x), ys = m.nodes.map(p => +p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = 18, w = Math.max(x1 - x0, 1e-9), h = Math.max(y1 - y0, 1e-9);
    const s = Math.min((W - 2 * pad) / w, (H - 2 * pad - 8) / h);
    const T = (x, y) => [(W - w * s) / 2 + (x - x0) * s, (H + h * s) / 2 - (y - y0) * s + 2];
    let out = `<svg viewBox="0 0 ${W} ${H}" class="thumb" aria-hidden="true">`;
    m.members.forEach(q => {
      if (!m.nodes[q.i] || !m.nodes[q.j]) return;
      const [ax, ay] = T(m.nodes[q.i].x, m.nodes[q.i].y), [bx, by] = T(m.nodes[q.j].x, m.nodes[q.j].y);
      out += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${q.removed ? "#C92A2A" : "#23282C"}" stroke-width="${q.type === "truss" ? 1.4 : 2.2}" stroke-linecap="round"/>`;
    });
    m.supports.forEach(sp => { const n = m.nodes[sp.node]; if (!n) return; const [x, y] = T(n.x, n.y); out += `<path d="M${x.toFixed(1)},${y.toFixed(1)}l-5,8h10z" fill="#5C6B7A"/>`; });
    if (opts.loads !== false) {
      m.nodeLoads.forEach(l => { const n = m.nodes[l.node]; if (!n || !(+l.fx || +l.fy)) return; const [x, y] = T(n.x, n.y); const mag = Math.hypot(+l.fx || 0, +l.fy || 0), dx = (+l.fx || 0) / mag, dy = -(+l.fy || 0) / mag; out += `<line x1="${(x - dx * 16).toFixed(1)}" y1="${(y - dy * 16).toFixed(1)}" x2="${(x - dx * 3).toFixed(1)}" y2="${(y - dy * 3).toFixed(1)}" stroke="#B7791F" stroke-width="1.4"/>`; });
      m.memberLoads.forEach(l => { const q = m.members[l.member]; if (!q) return; const a = m.nodes[q.i], b = m.nodes[q.j]; const [ax, ay] = T(a.x, a.y), [bx, by] = T(b.x, b.y); out += `<line x1="${ax.toFixed(1)}" y1="${(ay - 7).toFixed(1)}" x2="${bx.toFixed(1)}" y2="${(by - 7).toFixed(1)}" stroke="#B7791F" stroke-width="1" opacity="0.8"/>`; });
    }
    return out + "</svg>";
  };
})();
