/* Frame2D Studio - presentation mode: a guided, full-screen demo that drives the app step by step.
 * Edit STEPS to change the order or the captions. Keys: → / Space next, ← back, F full screen, Esc exit. */
(function () {
  "use strict";
  const App = window.App, st = App.state;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const closeAll = () => { document.querySelectorAll(".overlay").forEach(o => { o.hidden = true; }); const d = App.$("#dlg"); if (d.open) d.close(); App.stopPlay && App.stopPlay(); };
  const tab = t => { const b = App.$(`#rightTabs [data-tab=${t}]`); if (b) b.click(); };
  const open = key => { closeAll(); App.openExample(key); };

  const STEPS = [
    { title: "Frame2D Studio", text: "Matrix structural analysis of plane frames and trusses in the browser, built on McGuire, Gallagher and Ziemian. No installation: open the link and go.", run: () => { closeAll(); App.openWelcome(); } },
    { title: "Build and solve", text: "A fixed-base portal frame. Supports, members and loads are drawn on the grid; the direct stiffness solution updates as the model is edited.", run: async () => { open("portal"); await wait(300); App.$("#analysisType").value = "linear"; App.$("#analysisType").dispatchEvent(new Event("change")); App.setView("M"); tab("results"); } },
    { title: "The direct stiffness method, animated", text: "Each element matrix [k] = [Γ]ᵀ[k′][Γ] is added into the global [K] at its code numbers; the free block [K]ff is then solved for the displacements.", run: async () => { tab("method"); await wait(400); const b = [...document.querySelectorAll("#rightBody button")].find(x => /Play/.test(x.textContent)); if (b) b.click(); } },
    { title: "Every step as a hand calculation", text: "The same solution written out the way it is done by hand: formulas, numbers substituted and results boxed, ready to print.", run: async () => { App.openSheet(); await wait(300); const t = document.querySelector("#calc-2"); if (t) t.scrollIntoView({ behavior: "smooth" }); } },
    { title: "Validation against STAAD.Pro", text: "Three independent cases from the proposal: linear, second order and modal. Frame2D, closed-form theory and STAAD.Pro side by side.", run: () => { closeAll(); App.openValidation(0); } },
    { title: "Second-order effects", text: "Heavy gravity load amplifies the sway: the corotational Newton–Raphson solution against the first-order line, checked against B₂ = 1/(1 − 1/λcr).", run: async () => { open("V2"); tab("results"); } },
    { title: "Elastic buckling and the finite element mesh", text: "([K]e + λ[K]g){φ} = 0. One element per member overestimates the Euler load by 22 %; four elements are within 0.05 %.", run: async () => { open("euler"); tab("results"); } },
    { title: "Plastic collapse", text: "Hinges form one by one where |M| reaches Mp until a mechanism forms. The portal collapses at H = 4Mp/h = 400 kN, as the hand calculation predicts.", run: async () => { open("portal"); tab("results"); } },
    { title: "Damage and strengthening", text: "Removing the beam drops the capacity to 25 %; doubling the loaded column restores it by 100 %. C and η from the proposal.", run: async () => { open("portal"); await wait(900); tab("damage"); await wait(300); const b = [...document.querySelectorAll("#rightBody button")].find(x => x.textContent === "Compare"); if (b) b.click(); } },
    { title: "Corrosion uncertainty", text: "Random section loss on the columns, many collapse analyses: the spread of the remaining capacity and the chance of falling below a threshold.", run: async () => { open("building"); await wait(1200); tab("damage"); await wait(300); if (st.corr) st.corr.n = 60; App.renderRight(); await wait(200); const b = [...document.querySelectorAll("#rightBody button")].find(x => x.textContent === "Run samples"); if (b) b.click(); } },
    { title: "Natural vibration", text: "[K]{φ} = ω²[M]{φ}. The cantilever's first frequencies match exact beam theory within 0.03 %.", run: () => { open("cantFreq"); tab("results"); } },
    { title: "Earthquake response", text: "A synthetic ground motion shakes the three-story frame: Newmark integration, Rayleigh damping, roof drift and base shear in time.", run: () => { open("quake"); tab("results"); } },
    { title: "Moving loads", text: "A three-axle truck crosses a continuous girder; the moment envelope builds up position by position.", run: () => { open("bridge"); tab("results"); } },
    { title: "Influence lines", text: "Müller-Breslau in action: the influence line of the interior reaction, ξ(3 − ξ²)/2, traced by a unit load.", run: () => { open("influence"); tab("results"); } },
    { title: "Semi-rigid connections", text: "Rotational springs between beam and columns: from pinned to rigid, the beam moments redistribute.", run: async () => { open("semirigid"); await wait(400); App.setView("M"); for (let k = 0; k <= 30; k++) { const r = k / 30, m = st.model, q = m.members[1], sec = m.sections[q.sec], EI = sec.E * sec.I, L = 6; const kk = r >= 0.999 ? 0 : r <= 0.001 ? 1e-6 : 3 * EI * r / (L * (1 - r)); q.kI = kk; q.kJ = kk; App.modelChanged({ quick: true }); await wait(70); } App.modelChanged(); } },
    { title: "Load combinations and member design", text: "ASCE 7 strength combinations, envelopes and AISC 360 interaction checks, with the hand check for any member.", run: async () => { open("combos"); await wait(500); tab("results"); } },
    { title: "Try it yourself", text: "Scan the code to open this model on your phone.", run: async () => { closeAll(); await App.openShare(); } }
  ];

  let idx = 0, bar = null;
  function render() {
    if (!bar) return;
    const s = STEPS[idx];
    bar.querySelector(".pr-title").textContent = s.title;
    bar.querySelector(".pr-text").textContent = s.text;
    bar.querySelector(".pr-count").textContent = `${idx + 1} / ${STEPS.length}`;
    bar.querySelector(".pr-dots").innerHTML = STEPS.map((_, i) => `<i class="${i === idx ? "on" : i < idx ? "done" : ""}"></i>`).join("");
  }
  async function go(i) {
    idx = Math.max(0, Math.min(STEPS.length - 1, i)); render();
    try { await STEPS[idx].run(); } catch (e) { console.error(e); }
  }
  function key(ev) {
    if (!document.body.classList.contains("presenting")) return;
    const tag = (ev.target.tagName || "").toLowerCase(); if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (ev.key === "ArrowRight" || ev.key === " " || ev.key === "PageDown") { ev.preventDefault(); ev.stopImmediatePropagation(); go(idx + 1); }
    else if (ev.key === "ArrowLeft" || ev.key === "PageUp") { ev.preventDefault(); ev.stopImmediatePropagation(); go(idx - 1); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopImmediatePropagation(); App.stopPresentation(); }
    else if (ev.key.toLowerCase() === "f") { ev.preventDefault(); ev.stopImmediatePropagation(); toggleFull(); }
  }
  function toggleFull() { if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); else document.exitFullscreen && document.exitFullscreen(); }
  App.startPresentation = function () {
    document.body.classList.add("presenting");
    if (!bar) {
      bar = document.createElement("div"); bar.className = "present-bar"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Presentation");
      bar.innerHTML = `<div class="pr-main"><div class="pr-title"></div><div class="pr-text"></div></div><div class="pr-side"><div class="pr-dots"></div><div class="pr-ctrl"><button class="pr-prev" aria-label="Previous">←</button><span class="pr-count"></span><button class="pr-next primary" aria-label="Next">→</button><button class="pr-full" title="Full screen (F)">⤢</button><button class="pr-exit" title="Exit (Esc)">Exit</button></div></div>`;
      document.body.append(bar);
      bar.querySelector(".pr-prev").onclick = () => go(idx - 1);
      bar.querySelector(".pr-next").onclick = () => go(idx + 1);
      bar.querySelector(".pr-full").onclick = toggleFull;
      bar.querySelector(".pr-exit").onclick = () => App.stopPresentation();
      document.addEventListener("keydown", key, true);
    }
    bar.hidden = false;
    toggleFull();
    go(0);
  };
  App.stopPresentation = function () {
    document.body.classList.remove("presenting"); if (bar) bar.hidden = true;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  };
  App.PRESENT_STEPS = STEPS;
})();
