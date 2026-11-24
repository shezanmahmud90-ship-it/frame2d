/* Frame2D Studio - welcome screen */
(function () {
  "use strict";
  const App = window.App;

  /** Hero drawing: a three-story frame draws itself, takes its loads, then sways in its first mode. */
  function heroSVG() {
    const W = 520, H = 440, bx = [90, 260, 430], ly = [380, 270, 160, 50];
    let i = 0, s = `<svg viewBox="0 0 ${W} ${H}" class="hero-svg" aria-hidden="true">`;
    // grid
    for (let x = 10; x < W; x += 20) s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" class="hg${(x - 10) % 100 === 0 ? " major" : ""}"/>`;
    for (let y = 0; y < H; y += 20) s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="hg${y % 100 === 0 ? " major" : ""}"/>`;
    // undeformed frame (draws itself)
    const seg = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="hm" pathLength="1" style="--i:${i++}"/>`;
    for (let lv = 0; lv < 3; lv++) for (const x of bx) s += seg(x, ly[lv], x, ly[lv + 1]);
    for (let lv = 1; lv <= 3; lv++) for (let k = 0; k < 2; k++) s += seg(bx[k], ly[lv], bx[k + 1], ly[lv]);
    // supports
    for (const x of bx) s += `<g class="hs"><path d="M${x - 16},${ly[0]}h32"/><path d="M${x - 14},${ly[0] + 2}l-6,8M${x - 4},${ly[0] + 2}l-6,8M${x + 6},${ly[0] + 2}l-6,8M${x + 16},${ly[0] + 2}l-6,8"/></g>`;
    // lateral loads
    [1, 2, 3].forEach(lv => { const len = 22 + lv * 12; s += `<g class="hl" style="--k:${lv}"><line x1="${bx[0] - 14 - len}" y1="${ly[lv]}" x2="${bx[0] - 16}" y2="${ly[lv]}"/><path d="M${bx[0] - 8},${ly[lv]}l-10,-5v10z"/></g>`; });
    // deformed shape (first-mode-like sway, cubic columns)
    const sway = [0, 26, 50, 64];
    let d = "";
    for (const x of bx) {
      d += `M${x},${ly[0]}`;
      for (let lv = 0; lv < 3; lv++) {
        const a = sway[lv], c = sway[lv + 1], y1 = ly[lv], y2 = ly[lv + 1], dy = y2 - y1;
        d += `C${x + a + (c - a) * 0.1},${y1 + dy * 0.45} ${x + c - (c - a) * 0.1},${y2 - dy * 0.45} ${x + c},${y2}`;
      }
    }
    for (let lv = 1; lv <= 3; lv++) d += `M${bx[0] + sway[lv]},${ly[lv]}C${bx[0] + sway[lv] + 50},${ly[lv] + 9} ${bx[1] + sway[lv] - 50},${ly[lv] - 9} ${bx[1] + sway[lv]},${ly[lv]}S${bx[2] + sway[lv] - 50},${ly[lv] + 9} ${bx[2] + sway[lv]},${ly[lv]}`;
    s += `<g class="hd-g"><path d="${d}" class="hd"/>`;
    // hinge dots appear last
    [[bx[0], ly[0]], [bx[1], ly[0]], [bx[2], ly[0]], [bx[0] + 26, ly[1]], [bx[2] + 26, ly[1]]].forEach(([x, y], k) => { s += `<circle cx="${x}" cy="${y - 10}" r="6" class="hh" style="--k:${k}"/>`; });
    return s + `</g></svg>`;
  }

  App.openWelcome = function () {
    const el = App.$("#welcome"), Ex = window.Examples;
    let auto = null, autoTime = null;
    try { auto = JSON.parse(localStorage.getItem("f2d-autosave") || "null"); autoTime = localStorage.getItem("f2d-autosave-time"); } catch (e) { auto = null; }
    let show = true; try { show = localStorage.getItem("f2d-welcome") !== "off"; } catch (e) { /* ignore */ }
    const groups = {};
    Ex.examples.filter(e => e.group !== "Validation cases").forEach(e => { (groups[e.group] = groups[e.group] || []).push(e); });
    const nRefs = Ex.examples.filter(e => e.group !== "Validation cases").reduce((s, e) => s + (e.build().references || []).length, 0);
    const card = e => { const m = e.build(); return `<button class="ex-card" data-key="${e.key}">${App.thumb(m, 220, 120)}<span class="ex-title">${App.esc(m.title)}</span><span class="ex-desc">${App.esc((m.description || "").split(". ")[0])}</span></button>`; };
    const vcards = Ex.validations.map((v, k) => { const m = v.build(); return `<button class="ex-card val" data-val="${k}">${App.thumb(m, 220, 120)}<span class="ex-title">${v.key}. ${App.esc(v.title)}</span><span class="ex-desc">${App.esc(v.purpose)}</span></button>`; }).join("");
    el.innerHTML = `<div class="welcome"><button class="w-skip" data-act="skip">Go to the workspace</button>
      <section class="w-hero">
        <div class="w-copy">
          <div class="w-brand"><svg viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="currentColor"/><path d="M7 26V9h18v17" fill="none" stroke="#fff" stroke-width="3"/><path d="M4 26h8M20 26h8" stroke="#fff" stroke-width="2"/></svg>Frame2D Studio</div>
          <h1>Plane frames and trusses, solved the way you learned them.</h1>
          <p class="w-lede">Draw a structure, run it, and follow every step of the direct stiffness method, from the element matrix to the reactions, with the numbers worked out like a hand calculation. Then push it further: second-order effects, buckling, plastic collapse, vibration, earthquakes, moving loads and member design.</p>
          <div class="w-actions">
            <button class="primary big" data-act="portal">Open the portal frame demo</button>
            <button class="big" data-act="new">Start a new model</button>
            <button class="big" data-act="validate">Validation cases</button>
            <button class="big" data-act="present">Start the presentation</button>
          </div>
          ${auto && auto.nodes && auto.nodes.length ? `<button class="w-continue" data-act="continue">${App.thumb(auto, 96, 56, { loads: false })}<span><b>Continue where you left off</b><span>${App.esc(auto.title || "Untitled model")}${autoTime ? `, saved ${new Date(autoTime).toLocaleString()}` : ""}</span></span></button>` : ""}
          <ul class="w-feats">
            <li><b>Ten analyses</b> linear, second order, buckling, plastic collapse, snap-through, modal, moving load, influence lines, load combinations, earthquake time history</li>
            <li><b>Hand calculations</b> formulas with the model's numbers substituted, ready to print</li>
            <li><b>Verified</b> ${nRefs} closed-form benchmarks and three STAAD.Pro validation cases</li>
            <li><b>Damage and design</b> member removal, corrosion uncertainty and AISC 360 member checks</li>
          </ul>
        </div>
        <div class="w-art">${heroSVG()}</div>
      </section>
      <section class="w-gallery"><h2>Validation cases</h2><div class="ex-grid">${vcards}</div>
        ${Object.entries(groups).map(([g, list]) => `<h2>${App.esc(g)}</h2><div class="ex-grid">${list.map(card).join("")}</div>`).join("")}</section>
      <footer class="w-foot"><label><input type="checkbox" id="wShow" ${show ? "checked" : ""}> Show this screen when the app opens</label><span>CE 7405 Statically Indeterminate Structures, Louisiana State University, Fall 2026. Method: McGuire, Gallagher and Ziemian, Matrix Structural Analysis, 2nd ed.</span></footer>
    </div>`;
    el.hidden = false;
    el.scrollTop = 0;
    const close = () => { el.hidden = true; };
    el.querySelectorAll("[data-key]").forEach(b => b.onclick = () => { close(); App.openExample(b.dataset.key); });
    el.querySelectorAll("[data-val]").forEach(b => b.onclick = () => { close(); App.openValidation(+b.dataset.val); });
    el.querySelector('[data-act="skip"]').onclick = close;
    el.querySelector('[data-act="portal"]').onclick = () => { close(); App.openExample("portal"); };
    el.querySelector('[data-act="present"]').onclick = () => { close(); App.startPresentation(); };
    el.querySelector('[data-act="new"]').onclick = () => { close(); App.templateDialog(); };
    el.querySelector('[data-act="validate"]').onclick = () => { close(); App.openValidation(0); };
    const cont = el.querySelector('[data-act="continue"]');
    if (cont) cont.onclick = () => { close(); App.$("#exampleSelect").value = ""; App.loadModel(auto, { run: false }); };
    App.$("#wShow").onchange = ev => { try { localStorage.setItem("f2d-welcome", ev.target.checked ? "on" : "off"); } catch (e) { /* ignore */ } };
  };
})();
