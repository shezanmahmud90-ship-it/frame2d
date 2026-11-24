/* Frame2D Studio - drawing canvas: model, loads, results and interactive editing */
(function () {
  "use strict";
  const App = window.App, S = () => window.Solver;
  const st = App.state;
  const cam = st.cam = { cx: 0, cy: 0, s: 40 };
  let svg, W = 800, H = 600;
  const toS = (x, y) => [W / 2 + (x - cam.cx) * cam.s, H / 2 - (y - cam.cy) * cam.s];
  const toW = (px, py) => [cam.cx + (px - W / 2) / cam.s, cam.cy - (py - H / 2) / cam.s];
  const r1 = v => Math.round(v * 10) / 10;

  App.fit = function () {
    const n = st.model.nodes;
    if (!n.length) { cam.cx = 5; cam.cy = 3; cam.s = 50; App.render(); return; }
    const xs = n.map(p => +p.x), ys = n.map(p => +p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6);
    cam.cx = (x0 + x1) / 2; cam.cy = (y0 + y1) / 2;
    const padX = 150, padTop = 150, padBot = 120;
    const sx = (W - 2 * padX) / w, sy = (H - padTop - padBot) / h;
    cam.s = Math.max(0.5, Math.min(sx, sy, 20000));
    if (!Number.isFinite(cam.s) || w < 1e-3 && h < 1e-3) cam.s = 60;
    cam.cy -= (padTop - padBot) / 2 / cam.s * -1;
    App.render();
  };

  // ------------------------------------------------------------------ results access
  /** Result shown on the drawing: current analysis if valid, otherwise the live linear result. */
  App.shownResult = function () {
    if (st.res && !st.stale) return st.res;
    return st.lin;
  };
  App.stateOf = function (res) {
    if (!res || res.unstable && !res.u) return null;
    if (res.kind === "modal") return null;
    if (res.kind === "combo") { const k = Math.min(st.step, res.cases.length - 1); const s0 = App.stateOf(res.cases[k]); if (s0) s0.k = k; return s0; }
    if (res.kind === "th") {
      const k = Math.min(st.step, res.uH.length - 1), u = res.uH[k];
      const { F, infos } = S().assemble(res.A, u, res.A.hinges0, 0, 0, true);
      return { A: res.A, u, infos, hinges: null, F, g: 0, lam: 0, k, linear: true };
    }
    if (res.kind === "moving" || res.kind === "il") {
      const k = Math.min(st.step, res.uH.length - 1), s = window.Dyn.movingState(res, k);
      return { A: res.A, u: s.u, infos: s.infos, hinges: null, F: s.F, g: 0, lam: 1, k, linear: true, axles: s.axles, moving: true };
    }
    if (res.uH && res.uH.length) {
      const k = Math.min(st.step, res.uH.length - 1);
      const s = S().stateAt(res, k);
      return { A: res.A, u: s.u, infos: s.infos, hinges: s.hinges, F: s.F, g: 1, lam: s.lam, k, linear: res.kind === "pushover" && !res.geometric };
    }
    if (!res.infos || !res.infos.length) return null;
    return { A: res.A, u: res.u, infos: res.infos, hinges: res.hinges, F: res.F || S().assemble(res.A, res.u, res.hinges || res.A.hinges0, res.g, res.lam, true).F, g: res.g, lam: res.lam, linear: true };
  };

  // ------------------------------------------------------------------ animation
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let rafOn = false;
  App.startGrow = function () { if (reduceMotion) return; st.growT0 = performance.now(); App.ensureLoop(); };
  App.growFactor = function () {
    if (st.growT0 === undefined || st.growT0 === null) return 1;
    const t = Math.min(1, (performance.now() - st.growT0) / 1100);
    if (t >= 1) { st.growT0 = null; return 1; }
    return 1 - Math.pow(1 - t, 3);
  };
  App.oscOn = () => !!st.animate && st.view === "mode" && !reduceMotion;
  App.oscFactor = () => App.oscOn() ? Math.sin(2 * Math.PI * performance.now() / 1700) : 1;
  App.ensureLoop = function () {
    if (rafOn) return; rafOn = true;
    const tick = () => {
      const busy = (st.growT0 !== null && st.growT0 !== undefined) || App.oscOn();
      if (!busy) { rafOn = false; App.render(); return; }
      App.render(); requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // ------------------------------------------------------------------ drawing primitives
  function arrow(x1, y1, x2, y2, cls, head) {
    head = head || 8;
    const a = Math.atan2(y2 - y1, x2 - x1), hx = x2 - head * Math.cos(a), hy = y2 - head * Math.sin(a);
    const w = head * 0.45;
    return `<line class="${cls}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(hx)}" y2="${r1(hy)}"/>` +
      `<path class="${cls}" style="stroke-width:1" d="M${r1(x2)},${r1(y2)}L${r1(hx - w * Math.sin(a))},${r1(hy + w * Math.cos(a))}L${r1(hx + w * Math.sin(a))},${r1(hy - w * Math.cos(a))}Z"/>`;
  }
  function momentArrow(x, y, val, cls, rad) {
    rad = rad || 17;
    const ccw = val > 0; // positive moment counter-clockwise
    const a0 = ccw ? -0.3 : Math.PI + 0.3, a1 = ccw ? Math.PI * 1.25 : -Math.PI * 0.25;
    const p0 = [x + rad * Math.cos(a0), y - rad * Math.sin(a0)], p1 = [x + rad * Math.cos(a1), y - rad * Math.sin(a1)];
    const large = 1, sweep = ccw ? 0 : 1;
    const tang = ccw ? a1 + Math.PI / 2 : a1 - Math.PI / 2;
    const tx = p1[0] + 7 * Math.cos(tang), ty = p1[1] - 7 * Math.sin(tang);
    return `<path class="${cls}" fill="none" d="M${r1(p0[0])},${r1(p0[1])}A${rad},${rad} 0 ${large} ${sweep} ${r1(p1[0])},${r1(p1[1])}" style="fill:none"/>` +
      arrow(tx, ty, p1[0], p1[1], cls, 7).replace(/<line[^>]*\/>/, "");
  }
  function text(x, y, t, cls, anchor, extra) { return `<text class="${cls}" x="${r1(x)}" y="${r1(y)}" text-anchor="${anchor || "middle"}" ${extra || ""}>${App.esc(t)}</text>`; }

  function supportSVG(sp, x, y) {
    const f = [sp.ux, sp.uy, sp.rz];
    let s = "";
    if (sp.incline) {
      const b = (+sp.angle || 0), rot = `rotate(${-b} ${x} ${y})`;
      s += `<g transform="${rot}"><path class="support" d="M${x},${y}L${x - 10},${y + 14}L${x + 10},${y + 14}Z"/><circle class="support" cx="${x - 6}" cy="${y + 18}" r="3.2"/><circle class="support" cx="${x + 6}" cy="${y + 18}" r="3.2"/><line class="support" x1="${x - 20}" y1="${y + 22}" x2="${x + 20}" y2="${y + 22}"/>`;
      for (let k = -18; k <= 18; k += 6) s += `<line class="hatch" x1="${x + k}" y1="${y + 23}" x2="${x + k - 5}" y2="${y + 29}"/>`;
      s += `</g>` + text(x + 24, y + 30, `${b}°`, "lbl-node", "start");
      if (f[2]) s += `<rect class="support-fill" x="${x - 3}" y="${y + 3}" width="6" height="6"/>`;
      return s;
    }
    const hatch = (x0, y0, len, vertical) => { let h = ""; for (let k = 0; k <= len; k += 6) h += vertical ? `<line class="hatch" x1="${x0}" y1="${y0 + k - len / 2}" x2="${x0 - 6}" y2="${y0 + k - len / 2 + 6}"/>` : `<line class="hatch" x1="${x0 + k - len / 2}" y1="${y0}" x2="${x0 + k - len / 2 - 6}" y2="${y0 + 6}"/>`; return h; };
    if (f[0] && f[1] && f[2]) {
      s += `<line class="support" style="stroke-width:3" x1="${x - 16}" y1="${y}" x2="${x + 16}" y2="${y}"/>` + hatch(x + 3, y + 1, 30, false);
    } else if (f[0] && f[1]) {
      s += `<path class="support" d="M${x},${y}L${x - 11},${y + 17}L${x + 11},${y + 17}Z"/><line class="support" x1="${x - 16}" y1="${y + 17}" x2="${x + 16}" y2="${y + 17}"/>` + hatch(x + 3, y + 18, 30, false);
    } else if (f[1] && !f[0]) {
      s += `<path class="support" d="M${x},${y}L${x - 10},${y + 14}L${x + 10},${y + 14}Z"/><circle class="support" cx="${x - 6}" cy="${y + 18}" r="3.2"/><circle class="support" cx="${x + 6}" cy="${y + 18}" r="3.2"/><line class="support" x1="${x - 16}" y1="${y + 22}" x2="${x + 16}" y2="${y + 22}"/>`;
      if (f[2]) s += `<rect class="support-fill" x="${x - 3}" y="${y + 3}" width="6" height="6"/>`;
    } else if (f[0] && !f[1]) {
      s += `<path class="support" d="M${x},${y}L${x - 14},${y - 10}L${x - 14},${y + 10}Z"/><circle class="support" cx="${x - 18}" cy="${y - 6}" r="3.2"/><circle class="support" cx="${x - 18}" cy="${y + 6}" r="3.2"/><line class="support" x1="${x - 22}" y1="${y - 16}" x2="${x - 22}" y2="${y + 16}"/>`;
      if (f[2]) s += `<rect class="support-fill" x="${x - 9}" y="${y - 3}" width="6" height="6"/>`;
    } else if (f[2]) {
      s += `<rect class="support" x="${x - 7}" y="${y - 7}" width="14" height="14"/><line class="support" x1="${x - 7}" y1="${y - 7}" x2="${x + 7}" y2="${y + 7}"/>`;
    }
    const spring = (dir, k) => {
      if (!(+k > 0)) return "";
      if (dir === 2) return `<path class="support" d="M${x + 9},${y}a9,9 0 1 1 -3,-7l4,-3" />`;
      let p = `M${x},${y}`, n = 6;
      for (let i = 1; i <= n; i++) { const t = i / n * 26, o = (i % 2 ? 5 : -5); p += dir === 1 ? `L${x + o},${y + t}` : `L${x - t},${y + o}`; }
      p += dir === 1 ? `L${x},${y + 30}` : `L${x - 30},${y}`;
      return `<path class="support" d="${p}"/>` + (dir === 1 ? `<line class="support" style="stroke-width:2.5" x1="${x - 9}" y1="${y + 31}" x2="${x + 9}" y2="${y + 31}"/>` : `<line class="support" style="stroke-width:2.5" x1="${x - 31}" y1="${y - 9}" x2="${x - 31}" y2="${y + 9}"/>`);
    };
    if (!f[0]) s += spring(0, sp.kx);
    if (!f[1]) s += spring(1, sp.ky);
    if (!f[2]) s += spring(2, sp.kr);
    if (+sp.dx || +sp.dy || +sp.dr) s += text(x + 18, y + 34, `Δ ${[+sp.dx ? `x ${App.mm(sp.dx)}` : "", +sp.dy ? `y ${App.mm(sp.dy)}` : "", +sp.dr ? `θ ${App.fmt(sp.dr, 3)}` : ""].filter(Boolean).join(", ")}${+sp.dr ? "" : " mm"}`, "lbl-node", "start");
    return s;
  }

  // ------------------------------------------------------------------ main render
  App.render = function () {
    if (!svg || !st.model) return;
    const rect = svg.getBoundingClientRect(); W = rect.width || 800; H = rect.height || 600;
    const m = st.model, out = [];
    out.push(gridSVG());
    const res = App.shownResult();
    const view = st.view;
    const showRes = view !== "model" && res;
    const stt = showRes ? App.stateOf(res) : null;
    const P = m.nodes.map(n => toS(+n.x, +n.y));
    const legend = [];

    // members (ghost when showing results)
    const memSVG = [];
    m.members.forEach((q, i) => {
      if (!P[q.i] || !P[q.j]) return;
      const [x1, y1] = P[q.i], [x2, y2] = P[q.j];
      let cls = "member" + (q.type === "truss" ? " truss" : "") + (q.removed ? " removed" : "");
      const gone = showRes && res.A && res.A.memberEls && res.A.memberEls[i] && !res.A.memberEls[i].length;
      if (showRes && !q.removed) cls = gone ? "member removed" : "member ghost";
      if (st.sel && st.sel.kind === "member" && st.sel.i === i) cls += " sel";
      if (st.methodHL === i) cls += " hl";
      if (st.hover && st.hover.kind === "member" && st.hover.i === i) cls += " hover";
      memSVG.push(`<line class="${cls}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`);
      if (!showRes) {
        const L = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / L, uy = (y2 - y1) / L;
        const springSym = (px, py, dx, dy) => { const nx = -dy, ny = dx; let d = `M${r1(px)},${r1(py)}`; for (let k = 1; k <= 5; k++) { const t = 4 + k * 3, o = (k % 2 ? 4 : -4); d += `L${r1(px + dx * t + nx * o)},${r1(py + dy * t + ny * o)}`; } d += `L${r1(px + dx * 22)},${r1(py + dy * 22)}`; return `<path d="${d}" fill="none" stroke="var(--action)" stroke-width="1.6"/>`; };
        if (+q.kI > 0 && !q.relI && q.type !== "truss") memSVG.push(springSym(x1, y1, ux, uy));
        if (+q.kJ > 0 && !q.relJ && q.type !== "truss") memSVG.push(springSym(x2, y2, -ux, -uy));
        if (q.relI || q.type === "truss") memSVG.push(`<circle class="release" cx="${r1(x1 + ux * 9)}" cy="${r1(y1 + uy * 9)}" r="3.6"/>`);
        if (q.relJ || q.type === "truss") memSVG.push(`<circle class="release" cx="${r1(x2 - ux * 9)}" cy="${r1(y2 - uy * 9)}" r="3.6"/>`);
        if (q.factor && q.factor !== 1) memSVG.push(text((x1 + x2) / 2 + 12 * -uy, (y1 + y2) / 2 + 12 * ux + 14, `×${q.factor}`, "lbl-mem", "middle", 'style="fill:#2F9E44;font-weight:600"'));
      }
    });
    if (showRes) out.push(memSVG.join(""));

    // results layer
    let resultSVG = "";
    if (showRes) {
      if (view === "mode") resultSVG = modeSVG(res, legend);
      else if (res.kind === "modal") legend.push("Open the Mode view to see the vibration modes");
      else if (stt) {
        if (view === "deformed") resultSVG = deformedSVG(stt, legend);
        else if (view === "U") resultSVG = st.utilMode === "aisc" && App.aiscUtilSVG ? App.aiscUtilSVG(res, stt, legend, toS) : utilSVG(stt, legend);
        else resultSVG = ((res.kind === "moving" || res.kind === "combo") && view !== "N" ? envelopeSVG(res, view) : "") + diagramSVG(stt, view, legend);
        if (stt.axles) resultSVG += vehicleSVG(res, stt);
        if (res.kind === "il") resultSVG = ilSVG(res, legend) + resultSVG;
        if (st.baseline && App.baselineSVG) resultSVG = App.baselineSVG(view, toS, cam) + resultSVG;
        resultSVG += reactionsSVG(res, stt);
        if (stt.hinges && res.events) resultSVG += hingesSVG(res, stt);
      } else if (res.unstable) legend.push("The structure is unstable: open the Mode view to see the mechanism");
    }
    out.push(resultSVG);
    if (!showRes) out.push(memSVG.join(""));

    // supports
    m.supports.forEach(sp => { if (P[sp.node]) out.push(supportSVG(sp, P[sp.node][0], P[sp.node][1])); });
    // loads (model and deformed views)
    if (view === "model" || view === "deformed") out.push(loadsSVG(P, view !== "model"));
    // nodes and labels
    m.nodes.forEach((n, i) => {
      const [x, y] = P[i];
      let cls = "node";
      if (st.sel && st.sel.kind === "node" && st.sel.i === i) cls += " sel";
      if (st.hover && st.hover.kind === "node" && st.hover.i === i) cls += " hover";
      out.push(`<circle class="${cls}" cx="${r1(x)}" cy="${r1(y)}" r="${showRes ? 2.6 : 4}"/>`);
      if (st.showLabels) out.push(text(x + 7, y - 7, String(i + 1), "lbl-node", "start"));
    });
    if (st.showLabels && !showRes) m.members.forEach((q, i) => {
      if (!P[q.i] || !P[q.j]) return;
      const x = (P[q.i][0] + P[q.j][0]) / 2, y = (P[q.i][1] + P[q.j][1]) / 2, t = String(i + 1), w = 7 * t.length + 8;
      out.push(`<rect class="lbl-mem-bg" x="${r1(x - w / 2)}" y="${r1(y - 8)}" width="${w}" height="15" rx="7"/>` + text(x, y + 4, t, "lbl-mem"));
    });
    // interaction overlay
    if (st.drag && st.drag.kind === "rubber" && P[st.drag.from]) {
      const [x1, y1] = P[st.drag.from]; out.push(`<line class="rubber" x1="${x1}" y1="${y1}" x2="${st.drag.px}" y2="${st.drag.py}"/>`);
    }
    if (st.preview) out.push(`<circle class="preview-node" cx="${st.preview[0]}" cy="${st.preview[1]}" r="6"/>`);
    svg.innerHTML = out.join("");
    renderLegend(legend, showRes, res, stt);
  };

  function gridSVG() {
    const g = +App.$("#gridSize").value || 1;
    let step = g * cam.s; let mult = 1;
    while (step * mult < 9) mult *= 2;
    const s = step * mult, out = [];
    const [wx0, wy1] = toW(0, 0), [wx1, wy0] = toW(W, H);
    const gx0 = Math.floor(wx0 / (g * mult)), gx1 = Math.ceil(wx1 / (g * mult)), gy0 = Math.floor(wy0 / (g * mult)), gy1 = Math.ceil(wy1 / (g * mult));
    if ((gx1 - gx0) * (gy1 - gy0) > 400000) return "";
    for (let k = gx0; k <= gx1; k++) { const [x] = toS(k * g * mult, 0); out.push(`<line x1="${r1(x)}" y1="0" x2="${r1(x)}" y2="${H}" stroke="${k % 5 === 0 ? "var(--grid-major)" : "var(--grid)"}" stroke-width="1"/>`); }
    for (let k = gy0; k <= gy1; k++) { const [, y] = toS(0, k * g * mult); out.push(`<line x1="0" y1="${r1(y)}" x2="${W}" y2="${r1(y)}" stroke="${k % 5 === 0 ? "var(--grid-major)" : "var(--grid)"}" stroke-width="1"/>`); }
    const [ox, oy] = toS(0, 0);
    out.push(`<line x1="${ox}" y1="${oy - 14}" x2="${ox}" y2="${oy + 14}" stroke="#9DB58E"/><line x1="${ox - 14}" y1="${oy}" x2="${ox + 14}" y2="${oy}" stroke="#9DB58E"/>`);
    void s;
    return out.join("");
  }

  function loadsSVG(P, faint) {
    const m = st.model, out = [];
    let wmax = 0; m.memberLoads.forEach(l => { if (l.kind !== "point") wmax = Math.max(wmax, Math.abs(+l.w1 || 0), Math.abs(l.w2 === null || l.w2 === "" ? 0 : +l.w2 || 0)); });
    const op = faint ? ' opacity="0.45"' : "";
    out.push(`<g${op}>`);
    m.nodeLoads.forEach(l => {
      if (!P[l.node]) return;
      const [x, y] = P[l.node], c = l.pat === "G" ? "load const" : "load", tc = l.pat === "G" ? "load-txt const" : "load-txt";
      const fx = +l.fx || 0, fy = +l.fy || 0;
      if (fx || fy) {
        const mag = Math.hypot(fx, fy), dx = fx / mag, dy = -fy / mag, len = 46;
        out.push(arrow(x - dx * (len + 6), y - dy * (len + 6), x - dx * 6, y - dy * 6, c, 9));
        out.push(text(x - dx * (len + 14), y - dy * (len + 14) + 4, `${App.fmt(mag, 3)} kN`, tc, dx > 0.3 ? "end" : dx < -0.3 ? "start" : "middle"));
      }
      if (+l.mz) { out.push(momentArrow(x, y, +l.mz, c)); out.push(text(x + 22, y - 20, `${App.fmt(Math.abs(+l.mz), 3)} kN·m`, tc, "start")); }
    });
    m.memberLoads.forEach(l => {
      const q = m.members[l.member]; if (!q || !P[q.i] || !P[q.j] || q.removed) return;
      const a = m.nodes[q.i], b = m.nodes[q.j], Lm = Math.hypot(b.x - a.x, b.y - a.y); if (Lm <= 0) return;
      const c = (b.x - a.x) / Lm, s = (b.y - a.y) / Lm;
      const dirOf = v => l.dir === "GX" ? [Math.sign(v), 0] : l.dir === "GY" ? [0, Math.sign(v)] : l.dir === "axial" ? [c * Math.sign(v), s * Math.sign(v)] : [-s * Math.sign(v), c * Math.sign(v)];
      const pt = t => toS(a.x + c * t, a.y + s * t);
      const cls = l.pat === "G" ? "load const" : "load", lcls = l.pat === "G" ? "load-line const" : "load-line", tc = l.pat === "G" ? "load-txt const" : "load-txt";
      if (l.kind === "thermal" || l.kind === "misfit") {
        const [mx, my] = pt(Lm / 2), lab = l.kind === "thermal" ? `ΔT ${App.fmt(+l.dT || 0, 3)}°${+l.dTg ? `, grad ${App.fmt(+l.dTg, 3)}°` : ""}` : `misfit ${App.fmt((+l.dL || 0) * 1000, 3)} mm`;
        const w = 7 * lab.length + 14, off = 16;
        out.push(`<rect x="${r1(mx - w / 2 + (-s) * off)}" y="${r1(my - 9 - c * off)}" width="${r1(w)}" height="17" rx="8" fill="${l.kind === "thermal" ? "#FDE8E1" : "#E9E4FA"}" stroke="${l.kind === "thermal" ? "#E8590C" : "#6B4BC4"}"/>`);
        out.push(text(mx + (-s) * off, my + 4 - c * off, lab, "lbl-mem", "middle", `style="fill:${l.kind === "thermal" ? "#B23B07" : "#4B2FA0"};font-weight:600"`));
        return;
      }
      if (l.kind === "point") {
        const v = +l.P || 0; if (!v) return;
        const [dx, dy] = dirOf(v), [x, y] = pt(Math.min(Math.max(+l.a || 0, 0), Lm));
        out.push(arrow(x - dx * 44, y + dy * 44, x - dx * 3, y + dy * 3, cls, 9));
        out.push(text(x - dx * 52, y + dy * 52 + (dy < 0 ? -2 : 10) * (dy ? 1 : 0) + 4, `${App.fmt(Math.abs(v), 3)} kN`, tc));
        return;
      }
      const x1 = Math.max(0, +l.a || 0), x2 = Math.min(Lm, (l.b === null || l.b === "" || l.b === undefined) ? Lm : +l.b);
      if (x2 <= x1) return;
      const w1 = +l.w1 || 0, w2 = (l.w2 === null || l.w2 === "" || l.w2 === undefined) ? w1 : +l.w2;
      const npx = Math.hypot(...[0, 1].map(k => pt(x2)[k] - pt(x1)[k]));
      const n = Math.max(2, Math.round(npx / 26));
      const len = v => wmax > 0 ? 10 + 26 * Math.abs(v) / wmax : 20;
      const sgn = Math.sign(w1 || w2) || -1;
      const [dx, dy] = dirOf(sgn);
      const tails = [];
      for (let k = 0; k <= n; k++) {
        const t = x1 + (x2 - x1) * k / n, w = w1 + (w2 - w1) * k / n, [x, y] = pt(t), Lp = len(w);
        const tx = x - dx * Lp, ty = y + dy * Lp; tails.push([tx, ty]);
        if (Math.abs(w) > 1e-12) out.push(arrow(tx, ty, x - dx * 2, y + dy * 2, cls, 6));
      }
      out.push(`<polyline class="${lcls}" points="${tails.map(p => p.map(r1).join(",")).join(" ")}"/>`);
      const mid = tails[Math.floor(tails.length / 2)];
      const lab = w1 === w2 ? `${App.fmt(Math.abs(w1), 3)} kN/m` : `${App.fmt(Math.abs(w1), 3)}–${App.fmt(Math.abs(w2), 3)} kN/m`;
      out.push(text(mid[0] - dx * 10, mid[1] + dy * 10 + (dy > 0 ? 10 : -3), lab, tc));
    });
    out.push("</g>");
    return out.join("");
  }

  // ---------- results drawing
  function autoScaleDisp(A, u) {
    let mx = 0; for (let n = 0; n < A.X.length; n++) mx = Math.max(mx, Math.hypot(u[3 * n], u[3 * n + 1]));
    const xs = A.X.map(p => p[0]), ys = A.X.map(p => p[1]);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-6);
    if (mx <= 0) return 1;
    return 0.09 * size / mx * Math.pow(10, st.scale);
  }

  function deformedSVG(stt, legend) {
    const A = stt.A, out = [];
    let sc = autoScaleDisp(A, stt.u);
    const res = App.shownResult();
    if (res && res.kind === "moving" && res.peakDisp) sc = 0.09 * modelSize(A) / res.peakDisp * Math.pow(10, st.scale);
    if (res && res.kind !== "linear" && st.trueScale) sc = Math.pow(10, st.scale);
    const gf = App.growFactor(); sc *= gf;
    A.els.forEach((el, e) => {
      const loads = S().elemLoads(el, stt.g, stt.lam), q = S().elemQ(el, stt.g, stt.lam);
      const pts = S().elementShape(A, el, stt.u, stt.infos[e], loads, q, sc, stt.linear);
      out.push(`<polyline class="deformed" points="${pts.map(p => toS(p[0], p[1]).map(r1).join(",")).join(" ")}"/>`);
    });
    // displacement labels at the node with the largest translation
    if (st.showValues) {
      let best = -1, bn = -1;
      for (let n = 0; n < st.model.nodes.length; n++) { const d = Math.hypot(stt.u[3 * n], stt.u[3 * n + 1]); if (d > best) { best = d; bn = n; } }
      if (bn >= 0 && best > 0) {
        const [x, y] = toS(A.X[bn][0] + sc * stt.u[3 * bn], A.X[bn][1] + sc * stt.u[3 * bn + 1]);
        out.push(text(x + 10, y - 10, `${App.mm(stt.u[3 * bn])}, ${App.mm(stt.u[3 * bn + 1])} mm`, "dia-txt", "start", 'style="fill:var(--deformed)"'));
      }
    }
    legend.push(`<span><i style="background:var(--deformed)"></i>Deformed shape, displacements ×${App.fmt(sc / (gf || 1), 3)}</span>`);
    return out.join("");
  }

  function modeSVG(res, legend) {
    const A = res.A, mode = res.mode;
    if (!mode) { legend.push("No mode to show: run an elastic buckling analysis"); return ""; }
    const sc = autoScaleDisp(A, mode) * 1.6 * App.growFactor() * App.oscFactor(), out = [];
    A.els.forEach(el => {
      const d = S().elemDofs(el).map(k => mode[k]), c = el.c0, s = el.s0n, L = el.L0;
      const ui = [c * d[0] + s * d[1], -s * d[0] + c * d[1]], uj = [c * d[3] + s * d[4], -s * d[3] + c * d[4]];
      const pts = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16, N = S().shape(t * L, L);
        const v = el.truss ? ui[1] * (1 - t) + uj[1] * t : N[1] * ui[1] + N[2] * d[2] + N[4] * uj[1] + N[5] * d[5];
        const ux = ui[0] * (1 - t) + uj[0] * t, lx = t * L + sc * ux, ly = sc * v;
        pts.push(toS(A.X[el.i][0] + c * lx - s * ly, A.X[el.i][1] + s * lx + c * ly));
      }
      out.push(`<polyline class="deformed" style="stroke:var(--moment)" points="${pts.map(p => p.map(r1).join(",")).join(" ")}"/>`);
    });
    const mi = res.modeIndex || 0;
    if (res.kind === "modal") legend.push(`<span><i style="background:var(--moment)"></i>Mode ${mi + 1}: f = ${App.fmt(res.modes[mi].f, 4)} Hz, T = ${App.fmt(res.modes[mi].T, 4)} s</span>`);
    else if (res.kind === "buckling" && res.modes && res.modes.length) legend.push(`<span><i style="background:var(--moment)"></i>Buckling mode ${mi + 1}, λcr = ${App.fmt(res.modes[mi].lam, 4)}</span>`);
    else legend.push(`<span><i style="background:var(--moment)"></i>Mechanism (zero-stiffness mode of [K]ff)</span>`);
    return out.join("");
  }

  function diagramSVG(stt, key, legend) {
    const A = stt.A, samples = [];
    let mx = 0;
    A.els.forEach((el, e) => {
      const loads = S().elemLoads(el, stt.g, stt.lam), q = S().elemQ(el, stt.g, stt.lam);
      const smp = S().sampleElement(el, stt.infos[e], loads, q, 16);
      samples.push(smp); smp[key].forEach(v => { mx = Math.max(mx, Math.abs(v)); });
    });
    if (mx < 1e-9) { legend.push(`<span>${{ N: "Axial force", V: "Shear", M: "Bending moment" }[key]} is zero everywhere</span>`); return ""; }
    if (key === "N") return axialSVG(A, samples, mx, legend);
    const xs = A.X.map(p => p[0]), ys = A.X.map(p => p[1]);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-6);
    let refMax = mx;
    const resNow = App.shownResult();
    if (resNow && (resNow.kind === "moving" || resNow.kind === "combo")) refMax = envelopeMax(resNow, key) || mx;
    const hpx = Math.min(70, Math.max(30, 0.12 * size * cam.s)) * Math.pow(10, st.scale);
    const k = hpx / refMax * App.growFactor(), out = [], labels = [];
    // sign: N, V drawn on local +y; M (sagging +) drawn on local −y (tension side)
    const sgn = key === "M" ? -1 : 1;
    A.els.forEach((el, e) => {
      const smp = samples[e], c = el.c0, s = el.s0n, [X0, Y0] = A.X[el.i];
      const base = x => toS(X0 + c * x, Y0 + s * x);
      const off = (x, v) => { const [bx, by] = base(x); const o = sgn * v * k; return [bx + (-s) * o, by - c * o]; };
      // split polygon by sign for the axial diagram colours
      const cls = key === "N" ? null : `dia-${key}`;
      if (key === "N") {
        const v = smp.N.reduce((a, b) => a + b, 0) / smp.N.length;
        const pts = smp.x.map((x, i) => off(x, smp.N[i]));
        const poly = [base(0), ...pts, base(el.L0)];
        out.push(`<path class="${v >= 0 ? "dia-N-pos" : "dia-N-neg"}" d="M${poly.map(p => p.map(r1).join(",")).join("L")}Z"/>`);
      } else {
        const pts = smp.x.map((x, i) => off(x, smp[key][i]));
        const poly = [base(0), ...pts, base(el.L0)];
        out.push(`<path class="${cls}" d="M${poly.map(p => p.map(r1).join(",")).join("L")}Z"/>`);
      }
      // labels per original member: ends and interior extremum
      if (st.showValues) {
        const vals = smp[key];
        const cand = [];
        if (el.k === 0) cand.push(0);
        if (el.k === el.nsub - 1) cand.push(vals.length - 1);
        let imax = 0, imin = 0; vals.forEach((v, i) => { if (v > vals[imax]) imax = i; if (v < vals[imin]) imin = i; });
        const endMax = Math.max(vals[0], vals[vals.length - 1]), endMin = Math.min(vals[0], vals[vals.length - 1]);
        if (imax > 0 && imax < vals.length - 1 && vals[imax] > endMax + 0.02 * mx) cand.push(imax);
        if (imin > 0 && imin < vals.length - 1 && vals[imin] < endMin - 0.02 * mx) cand.push(imin);
        cand.forEach(i => { if (Math.abs(vals[i]) >= 0.04 * mx && k > 0) labels.push({ p: off(smp.x[i], vals[i] * 1.12 + Math.sign(vals[i]) * 7 / k), v: vals[i], parent: el.parent, x: smp.x[i] }); });
      }
    });
    // de-clutter labels
    const placed = [];
    labels.sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).forEach(l => {
      if (placed.some(p => Math.hypot(p.p[0] - l.p[0], p.p[1] - l.p[1]) < 26)) return;
      placed.push(l);
      const col = key === "N" ? (l.v >= 0 ? "var(--tension)" : "var(--compression)") : key === "V" ? "var(--shear)" : "var(--moment)";
      out.push(text(l.p[0], l.p[1] + 4, App.fmt(l.v, 3), "dia-txt", "middle", `style="fill:${col}"`));
    });
    const name = { N: "Axial force (kN), tension blue, compression red", V: "Shear force (kN)", M: "Bending moment (kN·m), drawn on the tension side" }[key];
    legend.push(`<span><i style="background:${key === "N" ? "var(--tension)" : key === "V" ? "var(--shear)" : "var(--moment)"}"></i>${name}, max |${key}| = ${App.fmt(mx, 4)}</span>`);
    return out.join("");
  }

  function modelSize(A) { const xs = A.X.map(p => p[0]), ys = A.X.map(p => p[1]); return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-6); }

  function utilColor(r) {
    const stops = [[0, [47, 158, 68]], [0.5, [224, 176, 0]], [0.85, [232, 89, 12]], [1, [201, 42, 42]], [1.5, [120, 20, 20]]];
    r = Math.max(0, Math.min(r, 1.5));
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) if (r >= stops[i][0] && r <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
    const t = (r - a[0]) / ((b[0] - a[0]) || 1), c = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * t));
    return `rgb(${c.join(",")})`;
  }
  App.utilColor = utilColor;
  /** Demand/capacity ratio along an element: |M|/Mp (reduced for N) for frames, |N|/(A fy) for trusses. */
  App.utilization = function (A, el, info, loads, q) {
    const smp = S().sampleElement(el, info, loads, q, 16);
    const interaction = A.interaction;
    const Mp = el.Z * el.fy, Py = el.A * el.fy;
    return smp.x.map((x, i) => {
      const N = smp.N[i], M = smp.M[i];
      if (el.truss) return Py > 0 ? Math.abs(N) / Py : null;
      if (!(Mp > 0)) return null;
      if (!interaction || !(Py > 0)) return Math.abs(M) / Mp;
      const p = Math.abs(N) / Py, m = Math.abs(M) / Mp;
      return p < 0.2 ? p / 2 + m : p + (8 / 9) * m;      // bilinear P–M interaction, same as the plastic analysis
    });
  };
  function utilSVG(stt, legend) {
    const A = stt.A, out = [], per = new Map();
    let any = false, mx = 0;
    A.els.forEach((el, e) => {
      const loads = S().elemLoads(el, stt.g, stt.lam), q = S().elemQ(el, stt.g, stt.lam);
      const u = App.utilization(A, el, stt.infos[e], loads, q);
      const n = u.length - 1;
      for (let i = 0; i < n; i++) {
        const a = A.X[el.i], b = A.X[el.j], t0 = i / n, t1 = (i + 1) / n;
        const p0 = toS(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0), p1 = toS(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1);
        const r = u[i] === null ? null : Math.max(u[i], u[i + 1]);
        out.push(`<line x1="${r1(p0[0])}" y1="${r1(p0[1])}" x2="${r1(p1[0])}" y2="${r1(p1[1])}" stroke="${r === null ? "#B8C0C6" : utilColor(r * App.growFactor())}" stroke-width="7" stroke-linecap="round"/>`);
        if (r !== null) { any = true; mx = Math.max(mx, r); const cur = per.get(el.parent); if (!cur || r > cur.r) per.set(el.parent, { r, p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2] }); }
      }
    });
    if (st.showValues) per.forEach(v => { out.push(`<rect x="${r1(v.p[0] - 18)}" y="${r1(v.p[1] - 21)}" width="36" height="15" rx="7" fill="#fff" opacity="0.92"/>` + text(v.p[0], v.p[1] - 10, v.r.toFixed(2), "dia-txt", "middle", `style="fill:${utilColor(v.r)};stroke:none"`)); });
    if (!any) legend.push("Utilization needs Z and fy in the sections");
    else legend.push(`<span class="ubar"></span><span>Demand ÷ plastic capacity: |M|/Mp${A.interaction ? " with P–M interaction" : ""} (|N|/Py for trusses). Max ${mx.toFixed(2)}</span>`);
    return out.join("");
  }

  /** Influence line drawn along the load path (positive ordinates upward). */
  function ilSVG(res, legend) {
    const mx = Math.max(...res.values.map(Math.abs)) || 1, hpx = 70 * Math.pow(10, st.scale);
    const pts = res.posH.map((p, i) => {
      const seg = res.geo.segs.find(g => p >= g.s0 - 1e-9 && p <= g.s0 + g.L + 1e-9) || res.geo.segs[res.geo.segs.length - 1];
      const q = st.model.members[seg.member], a = st.model.nodes[q.i], b = st.model.nodes[q.j];
      let t = (p - seg.s0) / seg.L; if (!seg.forward) t = 1 - t;
      const [x, y] = toS(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      return { x, y, yy: y - res.values[i] / mx * hpx * App.growFactor(), v: res.values[i] };
    });
    const poly = `M${r1(pts[0].x)},${r1(pts[0].y)}` + pts.map(q => `L${r1(q.x)},${r1(q.yy)}`).join("") + `L${r1(pts[pts.length - 1].x)},${r1(pts[pts.length - 1].y)}Z`;
    let out = `<path d="${poly}" fill="rgba(31,95,191,.16)" stroke="var(--action)" stroke-width="2"/>`;
    if (st.showValues) {
      const ext = [pts.reduce((a, b) => (b.v > a.v ? b : a)), pts.reduce((a, b) => (b.v < a.v ? b : a))];
      ext.forEach(q => { if (Math.abs(q.v) > 1e-9) out += text(q.x, q.yy + (q.v > 0 ? -7 : 15), App.fmt(q.v, 4), "dia-txt", "middle", 'style="fill:var(--action)"'); });
    }
    legend.push(`<span><i style="background:var(--action)"></i>Influence line of ${App.esc(res.label)} (${res.unit}), positive upward</span>`);
    return out;
  }

  function envelopeMax(res, key) {
    let m = 0; res.env.forEach(E => { const a = key === "V" ? [E.Vmax, E.Vmin] : [E.Mmax, E.Mmin]; a.forEach(arr => arr.forEach(v => { if (Number.isFinite(v)) m = Math.max(m, Math.abs(v)); })); });
    return m;
  }
  function envelopeSVG(res, key) {
    if (key !== "M" && key !== "V") return "";
    const A = res.A, mx = envelopeMax(res, key); if (!mx) return "";
    const xs = A.X.map(p => p[0]), ys = A.X.map(p => p[1]);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-6);
    const hpx = Math.min(70, Math.max(30, 0.12 * size * cam.s)) * Math.pow(10, st.scale), k = hpx / mx, sgn = key === "M" ? -1 : 1;
    const out = [];
    A.els.forEach((el, e) => {
      const E = res.env[e], c = el.c0, s = el.s0n, [X0, Y0] = A.X[el.i];
      const off = (x, v) => { const [bx, by] = toS(X0 + c * x, Y0 + s * x); const o = sgn * v * k; return [bx - s * o, by - c * o]; };
      for (const arr of key === "M" ? [E.Mmax, E.Mmin] : [E.Vmax, E.Vmin]) {
        const pts = E.x.map((x, i) => off(x, arr[i]));
        out.push(`<polyline points="${pts.map(p => p.map(r1).join(",")).join(" ")}" fill="none" stroke="${key === "M" ? "var(--moment)" : "var(--shear)"}" stroke-width="1.6" stroke-dasharray="5 3" opacity="0.9"/>`);
      }
    });
    if (st.showValues && key === "M" && res.maxM) {
      const lab = (v, member, x) => { const el = A.els[A.memberEls[member].find(q => x >= A.els[q].s0 - 1e-9 && x <= A.els[q].s0 + A.els[q].L0 + 1e-9) ?? A.memberEls[member][0]]; const p = off2(el, x - el.s0, v); return text(p[0], p[1], `${App.fmt(v, 4)} max`, "dia-txt", "middle", 'style="fill:var(--moment)"'); };
      const off2 = (el, x, v) => { const [bx, by] = toS(A.X[el.i][0] + el.c0 * x, A.X[el.i][1] + el.s0n * x); const o = sgn * v * k * 1.15 + sgn * Math.sign(v) * 12; return [bx - el.s0n * o, by - el.c0 * o + 4]; };
      if (res.maxM.member !== undefined) out.push(lab(res.maxM.v, res.maxM.member, res.maxM.x));
      if (res.minM.member !== undefined && Math.abs(res.minM.v) > 0.05 * mx) out.push(lab(res.minM.v, res.minM.member, res.minM.x));
    }
    return `<g class="envelope">${out.join("")}</g>`;
  }
  function vehicleSVG(res, stt) {
    const A = res.A, out = [];
    const pts = stt.axles.map(ax => {
      const seg = res.geo.segs.find(g => g.member === ax.member), q = st.model.members[ax.member];
      const a = st.model.nodes[q.i], b = st.model.nodes[q.j], L = Math.hypot(b.x - a.x, b.y - a.y);
      return { P: ax.P, p: toS(a.x + (b.x - a.x) * ax.a / L, a.y + (b.y - a.y) * ax.a / L), seg };
    });
    if (!pts.length) return "";
    const top = Math.min(...pts.map(p => p.p[1])) - 58;
    const xs = pts.map(p => p.p[0]), x0 = Math.min(...xs) - 16, x1 = Math.max(...xs) + 16;
    out.push(`<rect x="${r1(x0)}" y="${r1(top)}" width="${r1(x1 - x0)}" height="18" rx="5" fill="#23282C" opacity="0.85"/>`);
    const tight = pts.some((p, k) => k > 0 && Math.abs(p.p[0] - pts[k - 1].p[0]) < 46);
    pts.forEach(p => {
      out.push(arrow(p.p[0], top + 18, p.p[0], p.p[1] - 3, "load", 8));
      if (!tight) out.push(text(p.p[0], top - 5, `${App.fmt(p.P, 3)} kN`, "load-txt", "middle"));
    });
    if (tight) out.push(text((x0 + x1) / 2, top - 6, `${pts.map(p => App.fmt(p.P, 3)).join(" + ")} kN`, "load-txt", "middle"));
    void A;
    return out.join("");
  }

  function axialSVG(A, samples, mx, legend) {
    const out = [], labels = [];
    A.els.forEach((el, e) => {
      const smp = samples[e], v = smp.N.reduce((a, b) => a + b, 0) / smp.N.length;
      const [x1, y1] = toS(...A.X[el.i]), [x2, y2] = toS(...A.X[el.j]);
      const rel = Math.abs(v) / mx, w = 2 + 9 * rel * Math.pow(10, st.scale * 0.5);
      const col = rel < 1e-6 ? "#9AA3AB" : v > 0 ? "var(--tension)" : "var(--compression)";
      out.push(`<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${col}" stroke-width="${r1(w)}" stroke-linecap="butt" ${rel < 1e-6 ? 'stroke-dasharray="4 4"' : 'opacity="0.85"'}/>`);
      if (st.showValues && el.k === Math.floor((el.nsub - 1) / 2)) {
        const parentEls = A.memberEls[el.parent], first = A.els[parentEls[0]], last = A.els[parentEls[parentEls.length - 1]];
        const [ax, ay] = toS(...A.X[first.i]), [bx, by] = toS(...A.X[last.j]);
        labels.push({ x: (ax + bx) / 2, y: (ay + by) / 2, v, col });
      }
    });
    labels.forEach(l => { if (Math.abs(l.v) < 1e-9 * mx) l.v = 0; out.push(`<rect x="${r1(l.x - 19)}" y="${r1(l.y - 8)}" width="38" height="15" rx="7" fill="#fff" opacity="0.92"/>` + text(l.x, l.y + 4, App.fmt(l.v, 3), "dia-txt", "middle", `style="fill:${l.col};stroke:none"`)); });
    legend.push(`<span><i style="background:var(--tension)"></i>Tension</span><span><i style="background:var(--compression)"></i>Compression (kN), line width ∝ |N|, max |N| = ${App.fmt(mx, 4)}</span>`);
    return out.join("");
  }

  function reactionsSVG(res, stt) {
    if (st.view === "mode" || !st.showValues) return "";
    const A = stt.A, out = [];
    // reactions at the current state
    const P = new Float64Array(A.ndof); for (let d = 0; d < A.ndof; d++) P[d] = stt.g * A.P0[d] + stt.lam * A.Pr[d];
    A.fixedList.forEach(d => {
      const n = Math.floor(d / 3), k = d % 3; if (n >= st.model.nodes.length) return;
      const v = stt.F[d] - P[d];
      if (Math.abs(v) < 1e-9) return;
      const [x, y] = toS(A.X[n][0], A.X[n][1]);
      if (k === 2) { out.push(momentArrow(x, y, v, "react", 24)); out.push(text(x - 26, y + 34, `${App.fmt(Math.abs(v), 3)} kN·m`, "react-txt", "end")); return; }
      const dx = k === 0 ? Math.sign(v) : 0, dy = k === 1 ? -Math.sign(v) : 0, off = 30, len = 34;
      const tipx = x - dx * (k === 1 ? 0 : off - 14), tipy = y - dy * off;
      const tx = tipx - dx * len, ty = tipy - dy * len;
      out.push(arrow(tx, ty, tipx, tipy, "react", 8));
      out.push(text(tx - dx * 4, ty - dy * 4 + (dy > 0 ? -2 : 12), `${App.fmt(Math.abs(v), 3)}`, "react-txt", dx > 0 ? "end" : dx < 0 ? "start" : "middle"));
    });
    return out.join("");
  }

  function hingesSVG(res, stt) {
    if (!res.events) return "";
    const A = stt.A, out = [];
    const order = new Map(); res.events.forEach((ev, k) => { const key = ev.el + ":" + ev.end; if (!order.has(key)) order.set(key, k + 1); });
    stt.hinges.forEach((h, e) => {
      [0, 1].forEach(end => {
        if (h[end] === null || h[end] === 0) return;
        const el = A.els[e], n = end === 0 ? el.i : el.j, o = end === 0 ? el.j : el.i;
        const [x, y] = toS(A.X[n][0], A.X[n][1]), [x2, y2] = toS(A.X[o][0], A.X[o][1]);
        const L = Math.hypot(x2 - x, y2 - y) || 1, px = x + (x2 - x) / L * 11, py = y + (y2 - y) / L * 11;
        out.push(`<circle class="hinge" cx="${r1(px)}" cy="${r1(py)}" r="7"/>` + text(px, py + 3.5, String(order.get(e + ":" + end) || ""), "hinge-txt"));
      });
    });
    return out.join("");
  }

  function renderLegend(items, showRes, res, stt) {
    const el = App.$("#legend");
    const parts = items.slice();
    if (!showRes) {
      const hasG = st.model.nodeLoads.some(l => l.pat === "G") || st.model.memberLoads.some(l => l.pat === "G");
      const hasR = st.model.nodeLoads.some(l => l.pat !== "G") || st.model.memberLoads.some(l => l.pat !== "G");
      if (hasR) parts.push(`<span><i style="background:var(--load)"></i>Loads scaled by λ</span>`);
      if (hasG) parts.push(`<span><i style="background:var(--load-const)"></i>Constant loads</span>`);
    } else if (stt && st.showValues && st.view !== "mode") parts.push(`<span><i style="background:var(--reaction)"></i>Reactions (kN, kN·m)</span>`);
    if (showRes && stt && stt.hinges && res && res.events && res.events.length) parts.push(`<span><i style="background:var(--hinge);height:8px;width:8px;border-radius:50%"></i>Plastic hinges, numbered in order of formation</span>`);
    if (showRes && res && res !== st.res && st.res && st.stale) parts.push(`<span style="color:var(--warn)">Showing live linear results; the ${res.kind} run is out of date</span>`);
    el.innerHTML = parts.join("");
  }

  // ------------------------------------------------------------------ interaction
  function snap(wx, wy) { const g = +App.$("#gridSize").value || 1; return [Math.round(wx / g) * g, Math.round(wy / g) * g].map(v => +v.toFixed(6)); }
  function hit(px, py) {
    const m = st.model; let best = null, bd = 10;
    m.nodes.forEach((n, i) => { const [x, y] = toS(+n.x, +n.y), d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = { kind: "node", i }; } });
    if (best) return best;
    bd = 7;
    m.members.forEach((q, i) => {
      if (!m.nodes[q.i] || !m.nodes[q.j]) return;
      const [x1, y1] = toS(+m.nodes[q.i].x, +m.nodes[q.i].y), [x2, y2] = toS(+m.nodes[q.j].x, +m.nodes[q.j].y);
      const L2 = (x2 - x1) ** 2 + (y2 - y1) ** 2; if (!L2) return;
      const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / L2));
      const d = Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
      if (d < bd) { bd = d; best = { kind: "member", i, t }; }
    });
    return best;
  }
  function findNodeAt(x, y) { return st.model.nodes.findIndex(n => Math.abs(+n.x - x) < 1e-6 && Math.abs(+n.y - y) < 1e-6); }
  function ensureSection(m) {
    if (!m.sections.length) m.sections.push(window.Examples.wSection("W14x90"));
    return Math.min(st.lastSection || 0, m.sections.length - 1);
  }

  const HINTS = {
    select: "Click a node or member to select it. Drag a node to move it. Drag the background to pan, scroll to zoom.",
    node: "Click on the grid to add a node.",
    member: "Click a start node, then an end node. Clicking empty grid adds a node. Esc ends the chain.",
    support: "Click a node to cycle: fixed, pinned, roller, vertical roller, none.",
    load: "Click a node to add a nodal load, or a member to add a distributed load. Edit values in the Loads tab."
  };
  App.setTool = function (t) {
    st.tool = t; st.drag = null; st.chainFrom = null;
    document.querySelectorAll(".toolbar.tools [data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
    App.$("#hint").textContent = HINTS[t];
    if (t !== "select" && st.view !== "model") App.setView("model");
    App.render();
  };

  App.initCanvas = function () {
    svg = App.$("#canvas");
    let down = null;
    const pos = ev => { const r = svg.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    svg.addEventListener("pointerdown", ev => {
      svg.focus();
      const [px, py] = pos(ev);
      const h = hit(px, py);
      down = { px, py, h, moved: false, button: ev.button, cam: { ...cam } };
      svg.setPointerCapture(ev.pointerId);
      if (ev.button === 1 || ev.button === 2 || (st.tool === "select" && !h)) down.mode = "pan";
      else if (st.tool === "select" && h && h.kind === "node") down.mode = "movenode";
      else down.mode = "click";
    });
    svg.addEventListener("pointermove", ev => {
      const [px, py] = pos(ev);
      const [wx, wy] = toW(px, py), [sx, sy] = snap(wx, wy);
      App.$("#coords").textContent = `x ${App.fix(sx, 2)} m, y ${App.fix(sy, 2)} m`;
      if (down) {
        if (Math.hypot(px - down.px, py - down.py) > 3) down.moved = true;
        if (down.mode === "pan" && down.moved) { cam.cx = down.cam.cx - (px - down.px) / cam.s; cam.cy = down.cam.cy + (py - down.py) / cam.s; App.render(); return; }
        if (down.mode === "movenode" && down.moved) {
          if (!down.started) { st.history.push({ json: App.snapshot(), refs: st.model.references, study: st.model.study }); st.future = []; down.started = true; }
          const n = st.model.nodes[down.h.i];
          if (n.x !== sx || n.y !== sy) { n.x = sx; n.y = sy; App.modelChanged({ quick: true }); }
          return;
        }
      }
      // hover + previews
      const h = hit(px, py);
      const hv = h ? { kind: h.kind, i: h.i } : null;
      st.preview = (st.tool === "node" || st.tool === "member") && !h ? toS(sx, sy) : null;
      if (st.tool === "member" && st.chainFrom !== null && st.chainFrom !== undefined) st.drag = { kind: "rubber", from: st.chainFrom, px: h && h.kind === "node" ? toS(+st.model.nodes[h.i].x, +st.model.nodes[h.i].y)[0] : toS(sx, sy)[0], py: h && h.kind === "node" ? toS(+st.model.nodes[h.i].x, +st.model.nodes[h.i].y)[1] : toS(sx, sy)[1] };
      if (JSON.stringify(hv) !== JSON.stringify(st.hover) || st.tool !== "select") { st.hover = hv; App.render(); }
      svg.style.cursor = h ? "pointer" : (st.tool === "select" ? "grab" : "crosshair");
    });
    svg.addEventListener("pointerup", ev => {
      if (!down) return;
      const d = down; down = null;
      if (d.mode === "movenode" && d.started) { App.modelChanged(); return; }
      if (d.moved && d.mode === "pan") return;
      if (d.button !== 0) return;
      const [px, py] = pos(ev), [sx, sy] = snap(...toW(px, py));
      onClick(d.h, sx, sy);
    });
    svg.addEventListener("contextmenu", ev => ev.preventDefault());
    svg.addEventListener("wheel", ev => {
      ev.preventDefault();
      const [px, py] = pos(ev), [wx, wy] = toW(px, py);
      const f = Math.exp(-ev.deltaY * 0.0015);
      cam.s = Math.max(0.5, Math.min(50000, cam.s * f));
      cam.cx = wx - (px - W / 2) / cam.s; cam.cy = wy + (py - H / 2) / cam.s;
      App.render();
    }, { passive: false });
    svg.addEventListener("pointerleave", () => { st.preview = null; st.hover = null; App.render(); });
    new ResizeObserver(() => App.render()).observe(svg);
  };

  function onClick(h, sx, sy) {
    const m = st.model;
    if (st.tool === "select") {
      st.sel = h ? { kind: h.kind, i: h.i } : null;
      if (h) App.showLeftFor(st.sel);
      App.refreshSelection(); return;
    }
    if (st.tool === "node") {
      if (h && h.kind === "node") { st.sel = { kind: "node", i: h.i }; App.refreshSelection(); return; }
      if (findNodeAt(sx, sy) >= 0) return;
      App.change(mm => { mm.nodes.push({ x: sx, y: sy }); });
      st.sel = { kind: "node", i: m.nodes.length - 1 }; App.showLeftFor(st.sel); App.refreshSelection(); return;
    }
    if (st.tool === "member") {
      let target = h && h.kind === "node" ? h.i : findNodeAt(sx, sy);
      if (target < 0 || target === undefined || target === null) {
        if (h && h.kind === "member") return;
        App.change(mm => { mm.nodes.push({ x: sx, y: sy }); }); target = m.nodes.length - 1;
      }
      if (st.chainFrom === null || st.chainFrom === undefined) { st.chainFrom = target; st.sel = { kind: "node", i: target }; App.render(); return; }
      if (target === st.chainFrom) return;
      const from = st.chainFrom;
      const exists = m.members.some(q => (q.i === from && q.j === target) || (q.j === from && q.i === target));
      if (!exists) App.change(mm => { const sec = ensureSection(mm); mm.members.push(window.Examples.mem(from, target, sec)); });
      st.chainFrom = target; st.sel = { kind: "member", i: m.members.length - 1 }; App.showLeftFor(st.sel); App.refreshSelection(); return;
    }
    if (st.tool === "support") {
      if (!h || h.kind !== "node") return;
      const cycle = ["fixed", "pinned", "rollerX", "rollerY", null];
      App.change(mm => {
        const k = mm.supports.findIndex(s => s.node === h.i);
        const cur = k >= 0 ? App.supportKind(mm.supports[k]) : null;
        const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
        if (k >= 0) mm.supports.splice(k, 1);
        if (next) mm.supports.push(window.Examples.sup(h.i, next));
      });
      st.sel = { kind: "node", i: h.i }; App.showLeftFor({ kind: "support", i: h.i }); App.refreshSelection(); return;
    }
    if (st.tool === "load") {
      if (!h) return;
      if (h.kind === "node") App.change(mm => { mm.nodeLoads.push(window.Examples.nload(h.i, 0, -10)); });
      else App.change(mm => { mm.memberLoads.push(window.Examples.udl(h.i, -10)); });
      st.sel = { kind: h.kind, i: h.i }; App.showLeftFor({ kind: "load" }); App.refreshSelection();
    }
  }

  App.svgString = function () {
    const clone = svg.cloneNode(true);
    const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText); } catch (e) { return []; } }).join("\n");
    const rootVars = getComputedStyle(document.documentElement);
    const vars = ["--pad", "--grid", "--grid-major", "--ink", "--muted", "--tension", "--compression", "--moment", "--shear", "--deformed", "--load", "--load-const", "--reaction", "--hinge", "--action"].map(v => `${v}:${rootVars.getPropertyValue(v)}`).join(";");
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", W); clone.setAttribute("height", H); clone.setAttribute("viewBox", `0 0 ${W} ${H}`);
    clone.insertAdjacentHTML("afterbegin", `<style>svg{${vars};font-family:Segoe UI,Arial,sans-serif}${css}</style><rect width="${W}" height="${H}" fill="#F2F6EE"/>`);
    return { str: new XMLSerializer().serializeToString(clone), W, H };
  };
})();
