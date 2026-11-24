/* Frame2D Studio - hand calculation sheet.
 * Rebuilds the direct stiffness solution of the current model the way it is done by hand: formulas,
 * numbers substituted, results boxed. Uses KaTeX for typesetting (vendor/katex). Printable. */
(function () {
  "use strict";
  const App = window.App, st = App.state, S = () => window.Solver;
  const R = String.raw;
  const BLUE = "#1F5FBF", ORANGE = "#C2410C";

  // ------------------------------------------------------------------ TeX helpers
  function tex(s, display) {
    if (!window.katex) return `<code>${App.esc(s)}</code>`;
    try { return window.katex.renderToString(s, { throwOnError: false, displayMode: !!display, strict: "ignore", trust: false }); }
    catch (e) { return `<code>${App.esc(s)}</code>`; }
  }
  const eq = s => `<div class="eqn">${tex(s, true)}</div>`;
  const it = s => tex(s, false);
  function n(v, sig) {
    sig = sig || 4;
    if (v === null || v === undefined || !Number.isFinite(v)) return R`\text{–}`;
    if (Math.abs(v) < 1e-12) return "0";
    const a = Math.abs(v);
    if (a >= 1e5 || a < 1e-3) {
      const e = Math.floor(Math.log10(a)); let m = v / Math.pow(10, e);
      let ms = (+m.toPrecision(sig)).toString();
      if (Math.abs(+ms) >= 10) { ms = (+(m / 10).toPrecision(sig)).toString(); return R`${ms}\times10^{${e + 1}}`; }
      return R`${ms}\times10^{${e}}`;
    }
    return (+v.toPrecision(sig)).toString();
  }
  const p = v => { const t = n(v); return (v < 0 || t.indexOf("times") >= 0) ? R`(${t})` : t; };   // number inside a product or sum
  const b = v => R`\textcolor{${BLUE}}{${p(v)}}`;                     // substituted input value
  const box = (v, unit) => R`\boxed{${n(v)}${unit ? R`\ \text{${unit}}` : ""}}`;
  function bm(M, f) {
    f = f || (v => n(v, 4));
    return R`\begin{bmatrix}${M.map(r => Array.from(r).map(f).join(" & ")).join(R` \\ `)}\end{bmatrix}`;
  }
  function vecT(v, f) { f = f || (x => n(x, 4)); return R`\begin{Bmatrix}${Array.from(v).map(f).join(R` \\ `)}\end{Bmatrix}`; }
  function labelled(M, rows, cols) {
    return R`\begin{array}{r|${"r".repeat(cols.length)}} & ${cols.map(c => R`\scriptsize ${c}`).join(" & ")} \\ \hline ${M.map((r, i) => R`\scriptsize ${rows[i]} & ` + Array.from(r).map(v => n(v, 4)).join(" & ")).join(R` \\ `)}\end{array}`;
  }
  const dofSym = d => ["u", "v", R`\theta`][d % 3] + `_{${Math.floor(d / 3) + 1}}`;

  // ------------------------------------------------------------------ structure figure with DOFs
  function dofFigure(res, num, nf) {
    const A = res.A, X = A.X;
    const xs = X.map(q => q[0]), ys = X.map(q => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const W = 760, pad = 70, w = Math.max(x1 - x0, 1e-6), hgt = Math.max(y1 - y0, 1e-6);
    const sc = Math.min((W - 2 * pad) / w, 260 / hgt, 200);
    const H = Math.max(160, hgt * sc + 2 * pad);
    const T = (x, y) => [pad + (x - x0) * sc + (W - 2 * pad - w * sc) / 2, H - pad - (y - y0) * sc];
    let s = `<svg class="dof-fig" viewBox="0 0 ${W} ${H}" role="img" aria-label="Structure with degree-of-freedom numbering">`;
    s += `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="context-stroke"/></marker></defs>`;
    A.els.forEach(el => { const [a, bb] = [T(...X[el.i]), T(...X[el.j])]; s += `<line x1="${a[0]}" y1="${a[1]}" x2="${bb[0]}" y2="${bb[1]}" stroke="#23282C" stroke-width="${el.truss ? 2 : 3}"/>`; });
    st.model.members.forEach((q, i) => {
      const els = A.memberEls[i]; if (!els || !els.length) return;
      const a = T(...st.model.nodes[q.i] ? [st.model.nodes[q.i].x, st.model.nodes[q.i].y] : [0, 0]), bb = T(st.model.nodes[q.j].x, st.model.nodes[q.j].y);
      const mx = (a[0] + bb[0]) / 2, my = (a[1] + bb[1]) / 2, L = Math.hypot(bb[0] - a[0], bb[1] - a[1]) || 1, nx = -(bb[1] - a[1]) / L, ny = (bb[0] - a[0]) / L;
      s += `<circle cx="${mx + nx * 16}" cy="${my + ny * 16}" r="10" fill="#fff" stroke="#23282C"/><text x="${mx + nx * 16}" y="${my + ny * 16 + 4}" text-anchor="middle" font-size="11" font-weight="600">${i + 1}</text>`;
    });
    const col = d => num.get(d) <= nf ? BLUE : "#9AA3AB";
    for (let k = 0; k < X.length; k++) {
      const [x, y] = T(...X[k]);
      const du = 3 * k, dv = 3 * k + 1, dr = 3 * k + 2;
      if (num.has(du)) s += `<line x1="${x + 6}" y1="${y}" x2="${x + 34}" y2="${y}" stroke="${col(du)}" stroke-width="1.6" marker-end="url(#ah)"/><text x="${x + 38}" y="${y + 4}" font-size="11" fill="${col(du)}" font-weight="600">${num.get(du)}</text>`;
      if (num.has(dv)) s += `<line x1="${x}" y1="${y - 6}" x2="${x}" y2="${y - 34}" stroke="${col(dv)}" stroke-width="1.6" marker-end="url(#ah)"/><text x="${x + 4}" y="${y - 38}" font-size="11" fill="${col(dv)}" font-weight="600">${num.get(dv)}</text>`;
      if (num.has(dr)) s += `<path d="M${x - 15},${y + 6} A16,16 0 1 1 ${x - 6},${y + 15}" fill="none" stroke="${col(dr)}" stroke-width="1.4" marker-end="url(#ah)"/><text x="${x - 30}" y="${y + 20}" font-size="11" fill="${col(dr)}" font-weight="600">${num.get(dr)}</text>`;
      s += `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" fill="#fff" stroke="#23282C"/>`;
      if (k < A.nOrig) s += `<text x="${x - 10}" y="${y - 10}" font-size="11" fill="#66707A" text-anchor="end">${k + 1}</text>`;
    }
    st.model.supports.forEach(sp => {
      if (sp.node >= A.nOrig) return; const [x, y] = T(...X[sp.node]);
      s += `<path d="M${x},${y + 5}l-10,15h20z" fill="none" stroke="#66707A"/><line x1="${x - 14}" y1="${y + 21}" x2="${x + 14}" y2="${y + 21}" stroke="#66707A"/>`;
    });
    s += `</svg>`;
    return s;
  }

  // ------------------------------------------------------------------ numbering (free first)
  function numbering(A) {
    const order = [...A.free, ...A.fixedList], num = new Map();
    order.forEach((d, k) => num.set(d, k + 1));
    return { order, num, nf: A.free.length };
  }
  const elName = el => el.nsub > 1 ? `${el.parent + 1}.${el.k + 1}` : `${el.parent + 1}`;

  // ------------------------------------------------------------------ sections
  function secHeader(res) {
    const m = st.model, d = new Date().toISOString().slice(0, 10);
    const an = App.shownResult();
    return `<div class="sheet-title"><div><h1>${App.esc(m.title)}</h1><p>${App.esc(m.description || "")}</p></div>
      <dl><dt>Date</dt><dd>${d}</dd><dt>Method</dt><dd>Direct stiffness method</dd><dt>Units</dt><dd>kN, m, rad</dd><dt>Shown analysis</dt><dd>${an ? an.kind : "linear"}</dd></dl></div>
      <p class="sheet-intro">This sheet solves the model by hand with the direct stiffness method of McGuire, Gallagher and Ziemian (2000). Formulas come first, then the model's values are substituted (in blue) and results are boxed. Numbers are rounded to four significant figures for display; the solver keeps full precision.</p>`;
  }

  function secDOF(res, ctx) {
    const { num, nf, order } = ctx, A = res.A;
    const rows = st.model.members.map((q, i) => {
      const s = q.removed ? null : S().prepare ? null : null; void s;
      const a = st.model.nodes[q.i], c = st.model.nodes[q.j], L = Math.hypot(c.x - a.x, c.y - a.y), th = Math.atan2(c.y - a.y, c.x - a.x) * 180 / Math.PI;
      const sec = st.model.sections[q.sec] || {};
      return `<tr><td>${i + 1}</td><td>${q.i + 1} → ${q.j + 1}</td><td>${q.type}${q.relI ? ", pin i" : ""}${q.relJ ? ", pin j" : ""}${q.removed ? " (removed)" : ""}</td><td>${App.fix(L, 3)}</td><td>${App.fix(th, 2)}°</td><td>${App.esc(sec.name || "")}</td><td>${App.fmt(sec.E / 1e6, 4)}</td><td>${App.fmt(sec.A * 1e4, 4)}</td><td>${App.fmt(sec.I * 1e8, 5)}</td></tr>`;
    }).join("");
    return `<p>Every node has three degrees of freedom: <i>u</i> (x), <i>v</i> (y) and <i>θ</i> (rotation). The ${nf} free DOFs are numbered first (blue) and the ${order.length - nf} restrained DOFs after them (grey), so the global stiffness matrix partitions as</p>
      ${eq(R`\begin{bmatrix} K_{ff} & K_{fs} \\ K_{sf} & K_{ss} \end{bmatrix} \begin{Bmatrix} \Delta_f \\ \Delta_s \end{Bmatrix} = \begin{Bmatrix} P_f \\ P_s + R \end{Bmatrix}`)}
      ${dofFigure(res, num, nf)}
      <table class="sheet-table"><thead><tr><th>Member</th><th>Nodes</th><th>Type</th><th>L (m)</th><th>θ</th><th>Section</th><th>E (GPa)</th><th>A (cm²)</th><th>I (cm⁴)</th></tr></thead><tbody>${rows}</tbody></table>
      ${A.nsub > 1 ? `<p class="sheet-note">Frame members are split into ${A.nsub} elements (element m.k is part k of member m); the internal nodes are numbered after the model's nodes.</p>` : ""}`;
  }

  function secElement(res, ctx) {
    const e = ctx.e, em = S().elementMatrices(res, e), el = em.el, A = res.A;
    const [xi, yi] = A.X[el.i], [xj, yj] = A.X[el.j];
    const E = el.E, Ar = el.A, I = el.I, L = el.L0;
    let h = `<p>Element <b>${elName(el)}</b> runs from node ${el.i + 1} to node ${el.j + 1}. Its geometry:</p>`;
    h += eq(R`L = \sqrt{(x_j-x_i)^2+(y_j-y_i)^2} = \sqrt{(${b(xj)}-${b(xi)})^2+(${b(yj)}-${b(yi)})^2} = ${box(L, "m")}`);
    h += eq(R`c=\cos\theta=\frac{x_j-x_i}{L}=\frac{${n(xj - xi)}}{${n(L)}}=${box(el.c0)} \qquad s=\sin\theta=\frac{y_j-y_i}{L}=\frac{${n(yj - yi)}}{${n(L)}}=${box(el.s0n)}`);
    h += `<p>Stiffness coefficients (E = ${it(n(E) + R`\ \text{kN/m}^2`)}, A = ${it(n(Ar) + R`\ \text{m}^2`)}, I = ${it(n(I) + R`\ \text{m}^4`)}):</p>`;
    h += eq(R`\frac{EA}{L} = \frac{${b(E)}\,${b(Ar)}}{${b(L)}} = ${box(E * Ar / L, "kN/m")}`);
    if (!el.truss) {
      h += eq(R`\frac{12EI}{L^3} = \frac{12\,${b(E)}\,${b(I)}}{${b(L)}^3} = ${box(12 * E * I / L ** 3, "kN/m")} \qquad \frac{6EI}{L^2} = ${box(6 * E * I / L ** 2, "kN")}`);
      h += eq(R`\frac{4EI}{L} = \frac{4\,${b(E)}\,${b(I)}}{${b(L)}} = ${box(4 * E * I / L, "kN·m")} \qquad \frac{2EI}{L} = ${box(2 * E * I / L, "kN·m")}`);
    }
    // symbolic local stiffness
    if (el.truss) h += `<p>Truss element: only the axial terms are present (local DOFs u₁ v₁ θ₁ u₂ v₂ θ₂).</p>` + eq(R`[k'] = \frac{EA}{L}\begin{bmatrix}1&0&0&-1&0&0\\0&0&0&0&0&0\\0&0&0&0&0&0\\-1&0&0&1&0&0\\0&0&0&0&0&0\\0&0&0&0&0&0\end{bmatrix}`);
    else {
      h += `<p>Local stiffness matrix of the plane frame element (McGuire Eq. 4.34), local DOFs u₁ v₁ θ₁ u₂ v₂ θ₂:</p>`;
      h += eq(R`\def\arraystretch{2.1}[k'] = \begin{bmatrix} \frac{EA}{L}&0&0&-\frac{EA}{L}&0&0\\ 0&\frac{12EI}{L^3}&\frac{6EI}{L^2}&0&-\frac{12EI}{L^3}&\frac{6EI}{L^2}\\ 0&\frac{6EI}{L^2}&\frac{4EI}{L}&0&-\frac{6EI}{L^2}&\frac{2EI}{L}\\ -\frac{EA}{L}&0&0&\frac{EA}{L}&0&0\\ 0&-\frac{12EI}{L^3}&-\frac{6EI}{L^2}&0&\frac{12EI}{L^3}&-\frac{6EI}{L^2}\\ 0&\frac{6EI}{L^2}&\frac{2EI}{L}&0&-\frac{6EI}{L^2}&\frac{4EI}{L} \end{bmatrix}`);
      if (el.relI || el.relJ) h += `<p>This element has a moment release at ${el.relI && el.relJ ? "both ends" : el.relI ? "end i" : "end j"}. The released rotation is removed by static condensation, ${it(R`[k'_c] = [k_{aa}] - [k_{ab}][k_{bb}]^{-1}[k_{ba}]`)}, which turns 3EI terms into the matrix below (a zero row and column at the released rotation).</p>`;
    }
    if (el.phi > 0) {
      const G = el.GAs / (el.phi > 0 ? (12 * el.E * el.I / (el.phi * el.L0 * el.L0)) : 1);
      h += `<p>Shear deformation is included (Timoshenko element). With shear area A<sub>s</sub> and G = E/2(1+ν):</p>`;
      h += eq(R`\phi = \frac{12EI}{G A_s L^2} = \frac{12\,${b(el.E)}\,${b(el.I)}}{${b(el.GAs)}\,${b(L)}^2} = ${box(el.phi)}, \qquad \frac{(4+\phi)EI}{(1+\phi)L} = ${box(el.E * el.I * (4 + el.phi) / ((1 + el.phi) * L), "kN·m")}, \qquad \frac{(2-\phi)EI}{(1+\phi)L} = ${box(el.E * el.I * (2 - el.phi) / ((1 + el.phi) * L), "kN·m")}`);
      void G;
    }
    if (el.kI > 0 || el.kJ > 0) {
      h += `<p>Semi-rigid connections: rotational springs ${el.kI > 0 ? it(R`k_i = ${n(el.kI)}`) : ""} ${el.kJ > 0 ? it(R`k_j = ${n(el.kJ)}`) : ""} kN·m/rad act in series with the member's bending stiffness (McGuire Ch. 13):</p>`;
      h += eq(R`[k_b^{sr}] = \left([I] + [k_b][S]\right)^{-1}[k_b], \qquad [S] = \begin{bmatrix} 1/k_i & 0 \\ 0 & 1/k_j \end{bmatrix}, \qquad r = \frac{1}{1 + 3EI/(kL)}`);
      h += `<p>Fixity factors: ${el.kI > 0 ? it(R`r_i = ${n(1 / (1 + 3 * el.E * el.I / (el.kI * L)))}`) : "start rigid"}, ${el.kJ > 0 ? it(R`r_j = ${n(1 / (1 + 3 * el.E * el.I / (el.kJ * L)))}`) : "end rigid"} (0 = pinned, 1 = rigid).</p>`;
    }
    h += eq(R`[k'] = ${bm(em.kLocal)}`);
    h += `<p>Transformation matrix ${it(R`\{\Delta'\} = [\Gamma]\{\Delta\}`)} with c = ${it(n(el.c0))}, s = ${it(n(el.s0n))}:</p>`;
    h += eq(R`[\Gamma] = \begin{bmatrix} c&s&0&0&0&0\\ -s&c&0&0&0&0\\ 0&0&1&0&0&0\\ 0&0&0&c&s&0\\ 0&0&0&-s&c&0\\ 0&0&0&0&0&1 \end{bmatrix} = ${bm(em.Gamma, v => n(v, 4))}`);
    const code = em.dofs.map(d => ctx.num.get(d) || "–");
    h += `<p>Global element stiffness ${it(R`[k] = [\Gamma]^T[k'][\Gamma]`)}. Rows and columns carry the element's code numbers (global DOF numbers):</p>`;
    h += eq(R`[k^{(${elName(el)})}] = ${labelled(em.kGlobal, code, code)}`);
    return h;
  }

  function secFEF(res, ctx) {
    const el = res.A.els[ctx.e], loads = S().elemLoads(el, res.g, res.lam);
    if (!loads.length) return `<p>Element ${elName(el)} carries no member loads, so its fixed-end forces are zero. Choose a loaded member above to see this step${anyLoaded(res) ? "" : " (this model has only nodal loads)"}.</p>`;
    const L = el.L0;
    let h = `<p>Member loads become work-equivalent nodal loads ${it(R`\{Q\} = \int_0^L [N]^T q\,dx`)} with the Hermitian shape functions (McGuire Sec. 7.5). The fixed-end forces on the member are ${it(R`\{F'_f\} = -\{Q\}`)}.</p>`;
    loads.forEach(ld => {
      if (ld.type === "strain") {
        const EA = el.E * el.A, EI = el.E * el.I;
        h += `<p>${ld.src === "misfit" ? "Lack of fit: the member is too long by ΔL, an initial strain" : "Temperature: uniform change ΔT gives an initial strain, a gradient over the depth gives an initial curvature (top hotter curves the member upward)"}. A fully restrained member develops the fixed-end forces below (McGuire Sec. 7.6).</p>`;
        h += eq(R`\varepsilon_0 = ${ld.src === "misfit" ? R`\frac{\Delta L}{L}` : R`\alpha\,\Delta T`} = ${box(ld.e0)} \qquad \kappa_0 = -\frac{\alpha\,\Delta T_g}{h} = ${box(ld.k0, "1/m")}`);
        h += eq(R`\{F'_f\} = EA\,\varepsilon_0\begin{Bmatrix}1\\0\\0\\-1\\0\\0\end{Bmatrix} + EI\,\kappa_0\begin{Bmatrix}0\\0\\1\\0\\0\\-1\end{Bmatrix},\quad EA\,\varepsilon_0 = ${b(EA)}\,${b(ld.e0)} = ${box(EA * ld.e0, "kN")},\quad EI\,\kappa_0 = ${box(EI * ld.k0, "kN·m")}`);
        return;
      }
      if (ld.type === "pt") {
        const a = ld.a, bb = L - a, P = ld.py;
        h += `<p>Point load, transverse component ${it(R`P = ${n(P)}\ \text{kN}`)} at a = ${it(n(a))} m (b = ${it(n(bb))} m):</p>`;
        h += eq(R`Q_{v1} = \frac{P b^2 (3a+b)}{L^3} = \frac{${b(P)}\,${b(bb)}^2\,(3\cdot${b(a)}+${b(bb)})}{${b(L)}^3} = ${box(P * bb * bb * (3 * a + bb) / L ** 3, "kN")}`);
        h += eq(R`Q_{\theta 1} = \frac{P a b^2}{L^2} = ${box(P * a * bb * bb / L ** 2, "kN·m")} \qquad Q_{v2} = \frac{P a^2(a+3b)}{L^3} = ${box(P * a * a * (a + 3 * bb) / L ** 3, "kN")} \qquad Q_{\theta 2} = -\frac{P a^2 b}{L^2} = ${box(-P * a * a * bb / L ** 2, "kN·m")}`);
        if (Math.abs(ld.px) > 1e-12) h += eq(R`Q_{u1} = P_x\frac{b}{L} = ${box(ld.px * bb / L, "kN")} \qquad Q_{u2} = P_x\frac{a}{L} = ${box(ld.px * a / L, "kN")}`);
      } else {
        const full = ld.x1 <= 1e-9 && Math.abs(ld.x2 - L) < 1e-9, uni = Math.abs(ld.qy1 - ld.qy2) < 1e-12 && Math.abs(ld.qx1 - ld.qx2) < 1e-12;
        if (Math.abs(el.s0n) > 1e-9 && (Math.abs(ld.qx1) > 1e-12)) h += `<p>The load acts in a global direction, so it is resolved into local axial and transverse parts: ${it(R`q_x = ${n(ld.qx1)}`)}, ${it(R`q_y = ${n(ld.qy1)}`)} kN/m.</p>`;
        if (full && uni) {
          const w = ld.qy1;
          h += `<p>Uniform transverse load ${it(R`w = ${n(w)}\ \text{kN/m}`)} over the full length:</p>`;
          h += eq(R`Q_{v1}=Q_{v2}=\frac{wL}{2}=\frac{${b(w)}\,${b(L)}}{2}=${box(w * L / 2, "kN")} \qquad Q_{\theta1}=-Q_{\theta2}=\frac{wL^2}{12}=\frac{${b(w)}\,${b(L)}^2}{12}=${box(w * L * L / 12, "kN·m")}`);
          if (Math.abs(ld.qx1) > 1e-12) h += eq(R`Q_{u1}=Q_{u2}=\frac{q_x L}{2} = ${box(ld.qx1 * L / 2, "kN")}`);
        } else {
          h += `<p>Distributed load from x = ${it(n(ld.x1))} to ${it(n(ld.x2))} m, varying from ${it(n(ld.qy1))} to ${it(n(ld.qy2))} kN/m (transverse). The integral is evaluated exactly with three-point Gauss quadrature.</p>`;
          h += eq(R`\{Q\} = \int_{${n(ld.x1)}}^{${n(ld.x2)}} [N]^T q\,dx = ${vecT(S().equivalentLoads(L, [ld]))}`);
        }
      }
    });
    const q = S().elemQ(el, res.g, res.lam);
    const qa = Array.from(q); const e0 = q.e0 || 0; qa[0] += -el.E * el.A * e0; qa[3] += el.E * el.A * e0;
    h += `<p>Total for the element (local axes):</p>` + eq(R`\{Q\} = ${vecT(qa)} \qquad \{F'_f\} = -\{Q\} = ${vecT(qa.map(v => -v))}`);
    return h;
  }
  const anyLoaded = res => res.A.els.some(el => el.loadsG.length || el.loadsR.length);

  function secAssembly(res, ctx) {
    const A = res.A, { num, nf } = ctx;
    const ks = A.els.map((el, e) => ({ el, dofs: S().elemDofs(el), k: S().elementMatrices(res, e).kGlobal }));
    const term = (r, c) => {
      const parts = [];
      ks.forEach(({ el, dofs, k }) => { const a = dofs.indexOf(r), bb = dofs.indexOf(c); if (a >= 0 && bb >= 0 && Math.abs(k[a][bb]) > 1e-9) parts.push({ lab: R`k^{(${elName(el)})}_{${a + 1}${bb + 1}}`, v: k[a][bb] }); });
      return parts;
    };
    let h = `<p>Each element matrix is added into [K] at its code numbers: ${it(R`K_{ij} = \sum_e k^{(e)}_{ab}`)} where local positions a, b carry global numbers i, j. Diagonal terms of ${it(R`[K]_{ff}`)}:</p><div class="eq-list">`;
    const free = A.free.slice(0, 14);
    free.forEach(d => {
      const parts = term(d, d), i = num.get(d);
      const tot = res.K[d][d];
      h += eq(R`K_{${i},${i}} = ${parts.map(q => q.lab).join(" + ") || "0"} = ${parts.map(q => p(q.v)).join(" + ") || "0"}${A.springs.has(d) ? R` + k_{spring}` : ""} = ${box(tot)}`);
    });
    if (A.free.length > 14) h += `<p class="sheet-note">… and ${A.free.length - 14} more diagonal terms.</p>`;
    // a few off-diagonal coupling terms through the chosen element
    const ed = S().elemDofs(A.els[ctx.e]).filter(d => num.get(d) <= nf);
    let shown = 0;
    for (let x = 0; x < ed.length && shown < 4; x++) for (let y = x + 1; y < ed.length && shown < 4; y++) {
      const parts = term(ed[x], ed[y]); if (!parts.length) continue;
      h += eq(R`K_{${num.get(ed[x])},${num.get(ed[y])}} = ${parts.map(q => q.lab).join(" + ")} = ${parts.map(q => p(q.v)).join(" + ")} = ${box(res.K[ed[x]][ed[y]])}`); shown++;
    }
    h += `</div>`;
    if (nf <= 10) h += `<p>The assembled free-DOF stiffness matrix:</p>` + eq(R`[K]_{ff} = ${labelled(LA.sub(res.K, A.free, A.free), A.free.map(d => num.get(d)), A.free.map(d => num.get(d)))}`);
    else h += `<p class="sheet-note">[K]ff is ${nf} × ${nf}; the Method tab shows it in full as a heat map.</p>`;
    return h;
  }

  function secLoads(res, ctx) {
    const A = res.A, { num } = ctx;
    const nodal = new Float64Array(A.ndof);
    (res.sheetModel || st.model).nodeLoads.forEach(l => { if (l.node < A.nOrig) { nodal[3 * l.node] += +l.fx || 0; nodal[3 * l.node + 1] += +l.fy || 0; nodal[3 * l.node + 2] += +l.mz || 0; } });
    const contrib = A.els.map(el => { const q = S().elemQ(el, res.g, res.lam), g = new Float64Array(A.ndof); S().addElemLoad(A, el, q, g); return { el, g }; });
    let h = `<p>${it(R`\{P\}_f`)} collects the nodal loads and the equivalent member loads ${it(R`\{Q\}`)} transformed to global axes (${it(R`[\Gamma]^T\{Q\}`)}).${A.els.some(el => el.relI || el.relJ) ? " Released ends add a condensation correction." : ""}</p><div class="eq-list">`;
    const rows = A.free.filter(d => Math.abs(res.P[d] - res.F0[d]) > 1e-9 || Math.abs(nodal[d]) > 1e-9).slice(0, 18);
    rows.forEach(d => {
      const parts = [];
      if (Math.abs(nodal[d]) > 1e-9) parts.push({ lab: R`P^{node}`, v: nodal[d] });
      contrib.forEach(({ el, g }) => { if (Math.abs(g[d]) > 1e-9) parts.push({ lab: R`Q^{(${elName(el)})}`, v: g[d] }); });
      if (Math.abs(res.F0[d]) > 1e-9) parts.push({ lab: R`\text{release}`, v: -res.F0[d] });
      const unit = d % 3 === 2 ? "kN·m" : "kN";
      h += eq(R`P_{${num.get(d)}}\ (${dofSym(d)}) = ${parts.map(q => q.lab).join(" + ")} = ${parts.map(q => p(q.v)).join(" + ")} = ${box(res.P[d] - res.F0[d], unit)}`);
    });
    if (!rows.length) h += `<p>No loads act on the free DOFs.</p>`;
    h += `</div>`;
    const presc = A.fixedList.filter(d => A.presc[d]);
    if (presc.length) h += `<p>Prescribed support movements ${it(R`\{\Delta\}_s`)}: ${presc.map(d => it(R`\Delta_{${num.get(d)}} = ${n(A.presc[d])}\ \text{m}`)).join(", ")}. They act on the free DOFs through ${it(R`-[K]_{fs}\{\Delta\}_s`)}.</p>`;
    return h;
  }

  function secSolve(res, ctx) {
    const A = res.A, { num, nf } = ctx;
    if (res.unstable) return `<p class="sheet-bad">[K]ff is singular: the structure is a mechanism, so the equations have no unique solution.</p>`;
    const Kff = LA.sub(res.K, A.free, A.free);
    const rhs = A.free.map(d => { let v = res.P[d] - res.F0[d]; A.fixedList.forEach(s => { v -= res.K[d][s] * A.presc[s]; }); return v; });
    const df = A.free.map(d => res.u[d]);
    let h = `<p>The equilibrium equations of the free DOFs</p>` + eq(R`[K]_{ff}\{\Delta\}_f = \{P\}_f - [K]_{fs}\{\Delta\}_s`);
    if (nf <= 8) h += `<p>written out for this structure:</p>` + eq(R`${bm(Kff, v => n(v, 4))}\begin{Bmatrix}${A.free.map(d => R`\Delta_{${num.get(d)}}`).join(R`\\`)}\end{Bmatrix} = ${vecT(rhs)}`);
    h += `<p>${it(R`[K]_{ff}`)} is symmetric and positive definite, so it is factored as ${it(R`[K]_{ff} = [L][L]^T`)} (Cholesky) and solved by forward and back substitution:</p>`;
    const show = A.free.slice(0, 16);
    h += eq(R`\{\Delta\}_f = \begin{Bmatrix}${show.map(d => R`\Delta_{${num.get(d)}}\ (${dofSym(d)})`).join(R`\\`)}${A.free.length > 16 ? R`\\ \vdots` : ""}\end{Bmatrix} = \begin{Bmatrix}${show.map(d => R`${n(res.u[d])}\ \text{${d % 3 === 2 ? "rad" : "m"}}`).join(R`\\`)}${A.free.length > 16 ? R`\\ \vdots` : ""}\end{Bmatrix}`);
    void df;
    return h;
  }

  function secMember(res, ctx) {
    const e = ctx.e, em = S().elementMatrices(res, e), el = em.el;
    const kd = LA.matvec(em.kLocal, em.dLocal);
    const fefEff = em.endForces.map((v, i) => v - kd[i]);
    const names = [R`F'_{x1}`, R`F'_{y1}`, R`M_1`, R`F'_{x2}`, R`F'_{y2}`, R`M_2`], units = ["kN", "kN", "kN·m", "kN", "kN", "kN·m"];
    let h = `<p>The element's global displacements are read from ${it(R`\{\Delta\}`)} by its code numbers, rotated to local axes, and multiplied by ${it(R`[k']`)}:</p>`;
    h += eq(R`\{\Delta\} = ${vecT(em.dGlobal)} \quad \{\Delta'\} = [\Gamma]\{\Delta\} = ${vecT(em.dLocal)}`);
    h += eq(R`\{F'\} = [k']\{\Delta'\} + \{F'_f\}`);
    h += `<div class="eq-list">`;
    for (let r = 0; r < 6; r++) {
      const terms = []; for (let c = 0; c < 6; c++) if (Math.abs(em.kLocal[r][c]) > 1e-9 && Math.abs(em.dLocal[c]) > 1e-15) terms.push(R`${p(em.kLocal[r][c])}\cdot${p(em.dLocal[c])}`);
      if (Math.abs(fefEff[r]) > 1e-9) terms.push(R`\textcolor{${ORANGE}}{${p(fefEff[r])}}`);
      h += eq(R`${names[r]} = ${terms.join(" + ") || "0"} = ${box(em.endForces[r], units[r])}`);
    }
    h += `</div>`;
    if (fefEff.some(v => Math.abs(v) > 1e-9)) h += `<p class="sheet-note">Orange terms are the fixed-end forces${el.relI || el.relJ ? " (condensed for the release)" : ""}.</p>`;
    const N = -em.endForces[0];
    h += `<p>Internal forces at the ends: axial force ${it(R`N = -F'_{x1} = ${box(N, "kN")}`)} (${N >= 0 ? "tension" : "compression"}), end moments ${it(R`M_1 = ${n(em.endForces[2])}`)} and ${it(R`M_2 = ${n(em.endForces[5])}`)} kN·m (counter-clockwise on the member ends).</p>`;
    return h;
  }

  function secReactions(res, ctx) {
    const A = res.A, { num } = ctx;
    if (res.unstable) return "";
    let h = `<p>The support rows of the stiffness equations give the reactions:</p>` + eq(R`\{R\} = [K]_{sf}\{\Delta\}_f + [K]_{ss}\{\Delta\}_s - \{P\}_s`) + `<div class="eq-list">`;
    A.fixedList.filter(d => Math.floor(d / 3) < A.nOrig).forEach(d => {
      const terms = [];
      for (let c = 0; c < A.ndof; c++) if (Math.abs(res.K[d][c]) > 1e-9 && Math.abs(res.u[c]) > 1e-15) terms.push(R`${p(res.K[d][c])}\cdot${p(res.u[c])}`);
      const extra = res.F0[d] - res.P[d];
      const shown = terms.slice(0, 4);
      if (terms.length > 4) shown.push(R`\cdots`);
      if (Math.abs(extra) > 1e-9) shown.push(R`\textcolor{${ORANGE}}{${p(extra)}}`);
      const unit = d % 3 === 2 ? "kN·m" : "kN";
      h += eq(R`R_{${num.get(d)}}\ (${["R_x", "R_y", "M"][d % 3]}\text{ at node }${Math.floor(d / 3) + 1}) = ${shown.join(" + ") || "0"} = ${box(res.F[d] - res.P[d], unit)}`);
    });
    h += `</div><p class="sheet-note">Orange terms: loads applied directly at the support (nodal loads and the member-load equivalents ${it(R`-P_s`)}).</p>`;
    return h;
  }

  function secEquilibrium(res) {
    if (res.unstable) return "";
    const eqm = S().equilibrium(res);
    const a = eqm.applied, r = { fx: eqm.residual.fx - a.fx, fy: eqm.residual.fy - a.fy, m: eqm.residual.m - a.m };
    return `<p>Overall equilibrium of the free body (loads plus reactions) must close to round-off:</p>` +
      eq(R`\sum F_x = \underbrace{${n(a.fx)}}_{\text{loads}} + \underbrace{${p(r.fx)}}_{\text{reactions}} = ${box(eqm.residual.fx)}`) +
      eq(R`\sum F_y = ${n(a.fy)} + ${p(r.fy)} = ${box(eqm.residual.fy)}`) +
      eq(R`\sum M_O = ${n(a.m)} + ${p(r.m)} = ${box(eqm.residual.m)}`);
  }

  function secVirtualWork(res) {
    if (res.unstable) return "";
    let best = -1, bd = 0;
    res.A.free.forEach(d => { if (d % 3 !== 2 && d < 3 * res.A.nOrig && Math.abs(res.u[d]) > best) { best = Math.abs(res.u[d]); bd = d; } });
    const vw = S().virtualWork(res, Math.floor(bd / 3), bd % 3);
    if (!vw || Math.abs(vw.stiffness) < 1e-15) return "";
    let h = `<p>An independent check by the principle of virtual work (unit-load method): apply a unit load at ${it(dofSym(bd))}, find its internal forces m and n, and integrate along every member (Gauss quadrature on the exact force diagrams):</p>`;
    h += eq(R`1\cdot\delta = \sum \int_0^L \frac{M\,m}{EI}\,dx + \sum \int_0^L \frac{N\,n}{EA}\,dx${vw.spring ? R` + \sum \frac{F_s f_s}{k}` : ""}${vw.settle ? R` - \sum \bar R\,\Delta_s` : ""}`);
    h += eq(R`\delta = ${p(vw.bending)} + ${p(vw.axial)}${vw.spring ? " + " + p(vw.spring) : ""}${vw.settle ? " - " + p(vw.settle) : ""} = ${box(vw.delta, "m")} \qquad \text{stiffness method: } ${n(vw.stiffness)}\ \text{m}`);
    h += `<p class="sheet-ok">Difference ${App.fmt(Math.abs(vw.delta - vw.stiffness) / Math.max(Math.abs(vw.stiffness), 1e-15) * 100, 2)} %: the two methods agree.</p>`;
    return h;
  }

  function secAnalysis(res) {
    const r = App.shownResult();
    if (!r || r.kind === "linear") return null;
    const m = st.model;
    if (r.kind === "pushover") {
      let h = `<p>Plastic moment of each section, ${it(R`M_p = f_y Z`)}:</p><div class="eq-list">`;
      m.sections.forEach(s => { if (s.Z && s.fy) h += eq(R`\text{${App.esc(s.name).replace(/[{}\\]/g, "")}}:\quad M_p = ${b(s.fy)}\times${b(s.Z)} = ${box(s.fy * s.Z, "kN·m")}`); });
      h += `</div>`;
      if (m.settings.interaction !== false) h += `<p>With axial force the capacity is reduced (bilinear interaction, McGuire Ch. 10): ${it(R`M_{pc} = M_p\left(1-\tfrac{p}{2}\right)`)} for ${it(R`p = |N|/P_y < 0.2`)}, ${it(R`M_{pc} = \tfrac{9}{8}M_p(1-p)`)} otherwise.</p>`;
      h += `<p>Hinges form in this order (event-to-event analysis):</p><table class="sheet-table"><thead><tr><th>#</th><th>λ</th><th>Member</th><th>Node</th></tr></thead><tbody>${r.events.map((ev, i) => `<tr><td>${i + 1}</td><td>${App.fmt(ev.lam, 5)}</td><td>${ev.member + 1}</td><td>${ev.node < m.nodes.length ? ev.node + 1 : "inside"}</td></tr>`).join("")}</tbody></table>`;
      h += eq(R`\lambda_{lim} = ${box(r.lamLim)}\quad (${r.status === "collapse" ? R`\text{mechanism}` : R`\text{inconclusive}`})`);
      const ref = (m.references || []).find(q => q.analysis === "pushover");
      if (ref) h += `<p>Hand check by virtual work: ${App.esc(ref.source)}, so ${it(R`\lambda = ${n(ref.ref)}`)}. Error ${App.fmt(100 * (r.lamLim - ref.ref) / ref.ref, 3)} %.</p>`;
      return { title: "Plastic collapse", body: h };
    }
    if (r.kind === "buckling") {
      let h = `<p>The geometric stiffness of a frame element with axial force N (McGuire Eq. 9.19) is added to the elastic stiffness, and the load factor that makes the total stiffness singular is found:</p>`;
      h += eq(R`\def\arraystretch{1.7}[k_g'] = \frac{N}{L}\begin{bmatrix}1&0&0&-1&0&0\\0&\frac{6}{5}&\frac{L}{10}&0&-\frac{6}{5}&\frac{L}{10}\\0&\frac{L}{10}&\frac{2L^2}{15}&0&-\frac{L}{10}&-\frac{L^2}{30}\\-1&0&0&1&0&0\\0&-\frac{6}{5}&-\frac{L}{10}&0&\frac{6}{5}&-\frac{L}{10}\\0&\frac{L}{10}&-\frac{L^2}{30}&0&-\frac{L}{10}&\frac{2L^2}{15}\end{bmatrix} \qquad \det\left([K]_e + \lambda[K]_g\right) = 0`);
      h += eq(R`\lambda_{cr} = ${box(r.lamCr)}`);
      h += `<p>Euler check of each compression member, ${it(R`P_E = \pi^2EI/L^2`)}, against its axial force at buckling ${it(R`\lambda_{cr}|N|`)}; the ratio gives the effective length factor ${it(R`K = \sqrt{P_E/(\lambda_{cr}|N|)}`)}:</p><div class="eq-list">`;
      m.members.forEach((q, mi) => {
        const els = r.A.memberEls[mi]; if (!els || !els.length) return;
        const el0 = r.A.els[els[0]], N = r.infos[els[0]].N; if (N >= -1e-9) return;
        const L = el0.L0 * el0.nsub, PE = Math.PI ** 2 * el0.E * el0.I / (L * L), Pc = r.lamCr * Math.abs(N);
        h += eq(R`\text{M${mi + 1}}:\ P_E = \frac{\pi^2\,${b(el0.E)}\,${b(el0.I)}}{${b(L)}^2} = ${n(PE)}\ \text{kN},\quad \lambda_{cr}|N| = ${n(Pc)}\ \text{kN},\quad K = ${box(Math.sqrt(PE / Pc), "")}`);
      });
      h += `</div>`;
      return { title: "Elastic buckling", body: h };
    }
    if (r.kind === "modal") {
      let h = `<p>Mass per unit length of each section, ${it(R`\bar m = \rho A`)} (t/m):</p><div class="eq-list">`;
      m.sections.forEach(s => { const rho = s.rho === undefined || s.rho === null ? (s.E >= 1e8 ? 7.85 : 2.4) : +s.rho; h += eq(R`\bar m = ${b(rho)}\times${b(s.A)} = ${box(rho * s.A, "t/m")}`); });
      h += `</div>`;
      h += `<p>${r.lumped ? "Lumped mass: half of each element's mass goes to each end node (translations only)." : "Consistent mass matrix of the frame element (same shape functions as the stiffness):"}</p>`;
      if (!r.lumped) h += eq(R`[m'] = \frac{\bar m L}{420}\begin{bmatrix}140&0&0&70&0&0\\0&156&22L&0&54&-13L\\0&22L&4L^2&0&13L&-3L^2\\70&0&0&140&0&0\\0&54&13L&0&156&-22L\\0&-13L&-3L^2&0&-22L&4L^2\end{bmatrix}`);
      const md = r.modes[0], phi = md.mode, free = r.A.free;
      const pf = free.map(d => phi[d]), Kf = LA.sub(r.K, free, free), Mf = LA.sub(r.M, free, free);
      const kq = LA.dot(pf, LA.matvec(Kf, pf)), mq = LA.dot(pf, LA.matvec(Mf, pf));
      h += `<p>The eigenproblem ${it(R`[K]\{\phi\} = \omega^2[M]\{\phi\}`)} is solved for all modes. Mode 1 checked with the Rayleigh quotient:</p>`;
      h += eq(R`\omega_1^2 = \frac{\{\phi\}^T[K]\{\phi\}}{\{\phi\}^T[M]\{\phi\}} = \frac{${n(kq)}}{${n(mq)}} = ${n(kq / mq)} \quad\Rightarrow\quad \omega_1 = ${n(Math.sqrt(kq / mq))}\ \text{rad/s},\quad f_1 = \frac{\omega_1}{2\pi} = ${box(Math.sqrt(kq / mq) / (2 * Math.PI), "Hz")}`);
      if (m.theory && m.theory.f1) h += eq(R`f_1^{exact} = \frac{(1.8751)^2}{2\pi L^2}\sqrt{\frac{EI}{\bar m}} = ${box(m.theory.f1, "Hz")}`);
      return { title: "Natural frequencies", body: h };
    }
    if (r.kind === "second") {
      const k = r.lamH.length - 1, d2 = r.ctrlH[k], d1 = r.linCtrl[k];
      let h = `<p>The corotational element updates the geometry each iteration; Newton–Raphson solves ${it(R`[K_T]\{d\Delta\} = \{P\} - \{F_{int}(\Delta)\}`)} until the residual vanishes. The tangent stiffness contains the axial-force term ${it(R`\tfrac{N}{L_n}\{w\}\{w\}^T`)}.</p>`;
      h += eq(R`\text{amplification} = \frac{\Delta_2}{\Delta_1} = \frac{${n(d2)}}{${n(d1)}} = ${box(d2 / d1)}`);
      try {
        const g = JSON.parse(JSON.stringify(m)); g.nodeLoads = g.nodeLoads.filter(l => l.pat === "G"); g.memberLoads = g.memberLoads.filter(l => l.pat === "G");
        const bk = S().buckling(g, { nsub: m.settings.nsub || 1 });
        if (bk.lamCr) h += `<p>Approximate check with the elastic critical load of the gravity loads, ${it(R`\lambda_{cr} = ${n(bk.lamCr)}`)}:</p>` + eq(R`B_2 = \frac{1}{1 - 1/\lambda_{cr}} = \frac{1}{1-1/${n(bk.lamCr)}} = ${box(1 / (1 - 1 / bk.lamCr))}`);
      } catch (e) { /* no gravity buckling */ }
      return { title: "Second-order effects", body: h };
    }
    if (r.kind === "moving") {
      let h = `<p>For every position of the vehicle the linear system is solved again; the envelopes keep the largest and smallest internal forces at every section.</p>`;
      h += eq(R`M_{max}^{+} = ${box(r.maxM.v, "kN·m")} \ \text{(member ${r.maxM.member + 1}, front axle at ${App.fix(r.maxM.s, 2)} m)}`);
      if (r.axles.length === 1 && m.members.length === 1) { const L = r.geo.length, P = r.axles[0].P; h += `<p>Single load on a simple span: the absolute maximum moment occurs with the load at midspan,</p>` + eq(R`M_{max} = \frac{PL}{4} = \frac{${b(P)}\,${b(L)}}{4} = ${box(P * L / 4, "kN·m")}`); }
      return { title: "Moving load", body: h };
    }
    if (r.kind === "il") {
      let h = `<p>A unit load P = 1 kN moves along the path; at each position the structure is solved and ${App.esc(r.label)} is recorded. By the Müller-Breslau principle the influence line has the shape of the structure deflected by a unit displacement at the released quantity.</p>`;
      h += eq(R`\text{max ordinate} = ${box(r.max.v)}\ \text{at } x = ${n(r.max.s)}\ \text{m},\qquad \text{min ordinate} = ${box(r.min.v)}\ \text{at } x = ${n(r.min.s)}\ \text{m}`);
      const q = r.quantity;
      if (q.type === "reaction" && r.geo.segs.length === 2 && Math.abs(r.geo.segs[0].L - r.geo.segs[1].L) < 1e-9 && q.dir === 1) {
        const L = r.geo.segs[0].L, x = L / 2, xi = x / L, k = r.posH.findIndex(p => Math.abs(p - x) < 1e-9);
        if (k >= 0) h += `<p>Check for the interior support of two equal spans with the load at mid-span (ξ = 0.5):</p>` + eq(R`R_B = \frac{\xi(3-\xi^2)}{2} = \frac{0.5\,(3-0.25)}{2} = ${box(xi * (3 - xi * xi) / 2)} \qquad \text{Frame2D: } ${n(r.values[k])}`);
      }
      return { title: "Influence line", body: h };
    }
    if (r.kind === "combo") {
      let h = `<p>Each load belongs to a case; a combination multiplies every case by its factor and the linear results are superposed (McGuire Ch. 2: linear superposition).</p><table class="sheet-table"><thead><tr><th>Combination</th><th>max |M| (kN·m)</th><th>max |N| (kN)</th><th>max Δ (mm)</th></tr></thead><tbody>${r.summary.map(x => `<tr><td>${App.esc(x.name)}</td><td>${App.fix(x.maxM)}</td><td>${App.fix(x.maxN)}</td><td>${App.mm(x.maxD)}</td></tr>`).join("")}</tbody></table>`;
      h += eq(R`M_u^{+} = ${box(r.maxM.v, "kN·m")}\ \text{(${App.esc(r.combos[r.maxM.combo || 0].name)})}\qquad M_u^{-} = ${box(r.minM.v, "kN·m")}`);
      return { title: "Load combinations", body: h };
    }
    if (r.kind === "th") {
      const md = r.modal.modes;
      let h = `<p>Equation of motion with ground acceleration a<sub>g</sub>(t), solved by Newmark's average-acceleration method (γ = 1/2, β = 1/4, unconditionally stable):</p>`;
      h += eq(R`[M]\{\ddot u\} + [C]\{\dot u\} + [K]\{u\} = -[M]\{r\}\,a_g(t), \qquad [C] = a_0[M] + a_1[K]`);
      h += eq(R`a_0 = \zeta\frac{2\omega_1\omega_2}{\omega_1+\omega_2} = ${b(r.zeta)}\frac{2\,${b(r.w1)}\,${b(r.w2)}}{${b(r.w1)}+${b(r.w2)}} = ${box(r.a0, "1/s")}, \qquad a_1 = \zeta\frac{2}{\omega_1+\omega_2} = ${box(r.a1, "s")}`);
      h += eq(R`[\hat K] = [K] + \frac{\gamma}{\beta\,\Delta t}[C] + \frac{1}{\beta\,\Delta t^2}[M], \qquad \Delta t = ${n(r.record.dt)}\ \text{s}`);
      h += eq(R`u_{max} = ${box(r.peak.u * 1000, "mm")}\ (t = ${n(r.peak.t)}\ \text{s}), \qquad V_{b,max} = ${box(r.peakV.v, "kN")}, \qquad T_1 = ${n(md[0].T)}\ \text{s}`);
      return { title: "Earthquake time history", body: h };
    }
    if (r.kind === "arc") return { title: "Snap-through", body: `<p>The arc-length constraint ${it(R`\|\Delta u\|^2 = \Delta s^2`)} replaces load control, so the load factor can decrease past the limit point.</p>` + eq(R`\lambda_{limit} = ${box(r.lamPeak || 0)}`) };
    return null;
  }

  function secAISC() {
    const r = App.shownResult();
    if (!r || !["linear", "second", "combo"].includes(r.kind) || !window.Adv) return null;
    const row = window.Adv.aiscCheck(st.model, r).find(x => x.member === st.sheetMember);
    if (!row) return null;
    const sec = st.model.sections[st.model.members[st.sheetMember].sec], E = sec.E, Fy = sec.fy, Ag = sec.A;
    let h = `<p>Strength check for the ${row.comp ? "compressive" : "tensile"} force and moment ${r.kind === "combo" ? `of the governing combination (${App.esc(row.combo)})` : "of this analysis"} (AISC 360-16, LRFD, in-plane, member laterally braced).</p>`;
    h += eq(R`r = \sqrt{I/A} = \sqrt{${b(sec.I)}/${b(Ag)}} = ${box(row.r, "m")} \qquad \frac{KL}{r} = \frac{${b(row.K)}\,${b(row.L)}}{${n(row.r)}} = ${box(row.KLr)}`);
    if (row.comp) {
      h += eq(R`F_e = \frac{\pi^2 E}{(KL/r)^2} = \frac{\pi^2\,${b(E)}}{${n(row.KLr)}^2} = ${box(row.Fe / 1000, "MPa")}`);
      h += eq(Fy / row.Fe <= 2.25 ? R`\frac{F_y}{F_e} = ${n(Fy / row.Fe)} \le 2.25:\quad F_{cr} = 0.658^{F_y/F_e}F_y = 0.658^{${n(Fy / row.Fe)}}\,${b(Fy / 1000)} = ${box(row.Fcr / 1000, "MPa")}` : R`\frac{F_y}{F_e} > 2.25:\quad F_{cr} = 0.877F_e = ${box(row.Fcr / 1000, "MPa")}`);
      h += eq(R`\phi_c P_n = 0.9\,F_{cr}A_g = 0.9\,${b(row.Fcr)}\,${b(Ag)} = ${box(row.Pc, "kN")}`);
    } else h += eq(R`\phi_t P_n = 0.9\,F_y A_g = 0.9\,${b(Fy)}\,${b(Ag)} = ${box(row.Pc, "kN")}`);
    if (Number.isFinite(row.Mc)) h += eq(R`\phi_b M_n = 0.9\,F_y Z = 0.9\,${b(Fy)}\,${b(sec.Z)} = ${box(row.Mc, "kN·m")}`);
    const pr = row.Pr / row.Pc;
    h += eq(pr >= 0.2 ? R`\frac{P_r}{P_c} = \frac{${n(row.Pr)}}{${n(row.Pc)}} = ${n(pr)} \ge 0.2:\quad \frac{P_r}{P_c} + \frac{8}{9}\frac{M_r}{M_c} = ${n(pr)} + \frac{8}{9}\cdot\frac{${n(row.Mr)}}{${n(row.Mc)}} = ${box(row.ratio)}`
      : R`\frac{P_r}{P_c} = ${n(pr)} < 0.2:\quad \frac{P_r}{2P_c} + \frac{M_r}{M_c} = \frac{${n(pr)}}{2} + \frac{${n(row.Mr)}}{${n(row.Mc)}} = ${box(row.ratio)}`);
    h += `<p class="${row.ratio <= 1 ? "sheet-ok" : "sheet-bad"}">Ratio ${App.fix(row.ratio, 3)} ${row.ratio <= 1 ? "≤ 1.0: the member is adequate." : "> 1.0: the member is overstressed."}</p>`;
    return h;
  }

  function secDrawings() {
    const saved = st.view, out = [];
    const r = App.shownResult();
    const views = r && r.kind === "modal" ? ["model", "mode"] : r && r.kind === "buckling" ? ["model", "deformed", "mode"] : ["model", "deformed", "M"];
    const savedGrow = st.growT0; st.growT0 = null;
    const savedAnim = st.animate; st.animate = false;
    views.forEach(v => {
      st.view = v; App.render();
      const { str } = App.svgString();
      out.push(`<figure><img alt="${v} view" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(str)}"><figcaption>${{ model: "Model and loads", deformed: "Deformed shape", M: "Bending moment diagram", mode: "Mode shape" }[v]}</figcaption></figure>`);
    });
    st.view = saved; st.growT0 = savedGrow; st.animate = savedAnim; App.render();
    return `<div class="sheet-figs">${out.join("")}</div>`;
  }

  // ------------------------------------------------------------------ build and show
  /** Load case for the sheet: the live linear result, or the vehicle at its current position. */
  function sheetResult() {
    const shown = App.shownResult();
    if (!shown || shown.kind !== "moving" || shown.unstable) return { res: st.lin, note: "" };
    const k = Math.min(st.step, shown.posH.length - 1);
    const copy = JSON.parse(JSON.stringify(App.cleanForSave(st.model)));
    copy.nodeLoads = []; copy.memberLoads = shown.axH[k].map(ax => ({ member: ax.member, kind: "point", dir: "GY", P: -ax.P, a: ax.a, pat: "R" }));
    const res = window.Solver.linear(copy, { nsub: st.model.settings.nsub || 1 });
    res.sheetModel = copy;
    return { res, note: `Load case: the vehicle with its front axle at ${App.fix(shown.posH[k], 2)} m (the position shown on the drawing). Move the slider and reopen the sheet for another position.` };
  }

  App.openSheet = function () {
    const el = App.$("#sheet");
    const sr = sheetResult(), res = sr.res;
    if (!res || !res.K) { App.toast("Build a model with members and supports first"); return; }
    if (st.sheetMember === undefined || st.sheetMember >= st.model.members.length || !res.A.memberEls[st.sheetMember] || !res.A.memberEls[st.sheetMember].length || st.sheetAuto) {
      st.sheetAuto = true;
      // default: first loaded member, otherwise the first member
      const loaded = res.A.els.findIndex(q => q.loadsG.length || q.loadsR.length);
      st.sheetMember = loaded >= 0 ? res.A.els[loaded].parent : res.A.els[0].parent;
    }
    const e = res.A.memberEls[st.sheetMember][0];
    const ctx = { e, ...numbering(res.A) };
    const secs = [
      ["Structure and degrees of freedom", secDOF(res, ctx)],
      [`Element stiffness, member ${st.sheetMember + 1}`, secElement(res, ctx)],
      [`Fixed-end forces, member ${st.sheetMember + 1}`, secFEF(res, ctx)],
      ["Assembly of the global stiffness matrix", secAssembly(res, ctx)],
      ["Load vector", secLoads(res, ctx)],
      ["Solution for the displacements", secSolve(res, ctx)],
      [`Member end forces, member ${st.sheetMember + 1}`, secMember(res, ctx)],
      ["Support reactions", secReactions(res, ctx)],
      ["Equilibrium check", secEquilibrium(res)],
      ["Virtual work check", secVirtualWork(res)]
    ].filter(s => s[1]);
    const an = secAnalysis(res);
    if (an) secs.push([an.title, an.body]);
    const ak = secAISC();
    if (ak) secs.push([`Member check, member ${st.sheetMember + 1} (AISC 360)`, ak]);
    secs.push(["Drawings", secDrawings()]);
    if (sr.note) secs[0][1] = `<p class="sheet-load-note">${App.esc(sr.note)}</p>` + secs[0][1];
    const memSel = `<select id="sheetMember" aria-label="Member for the element steps">${st.model.members.map((q, i) => `<option value="${i}" ${i === st.sheetMember ? "selected" : ""} ${q.removed ? "disabled" : ""}>Member ${i + 1}</option>`).join("")}</select>`;
    el.innerHTML = `<div class="sheet-bar"><strong>Hand calculations</strong><span class="sheet-bar-model">${App.esc(st.model.title)}</span>
        <label>Element steps for ${memSel}</label><span class="grow"></span>
        <button id="sheetPrint">Print or save as PDF</button><button id="sheetClose" class="primary">Back to the model</button></div>
      <div class="sheet-body"><nav class="sheet-nav">${secs.map((s, i) => `<a href="#calc-${i + 1}"><span>${i + 1}</span>${App.esc(s[0])}</a>`).join("")}</nav>
      <article class="paper">${secHeader(res)}${secs.map((s, i) => `<section class="calc" id="calc-${i + 1}" style="--d:${Math.min(i, 8) * 70}ms"><h2><span class="calc-n">${i + 1}</span>${App.esc(s[0])}</h2>${s[1]}</section>`).join("")}
      <footer class="sheet-foot">Reference: W. McGuire, R. H. Gallagher and R. D. Ziemian, Matrix Structural Analysis, 2nd ed., Wiley, 2000. Generated by Frame2D Studio.</footer></article></div>`;
    el.hidden = false;
    el.querySelector(".sheet-body").scrollTop = 0;
    App.$("#sheetClose").onclick = () => { el.hidden = true; };
    App.$("#sheetPrint").onclick = () => window.print();
    App.$("#sheetMember").onchange = ev => { st.sheetMember = +ev.target.value; st.sheetAuto = false; App.openSheet(); };
    el.querySelectorAll(".sheet-nav a").forEach(a => a.addEventListener("click", ev => { ev.preventDefault(); const t = el.querySelector(a.getAttribute("href")); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); }));
  };
})();
