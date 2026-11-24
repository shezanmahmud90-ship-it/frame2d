/* Frame2D Studio - Validation Center: the three external validation cases (linear, second order, modal)
 * with Frame2D results, closed-form theory where it exists, STAAD.Pro values entered by the user,
 * differences against target tolerances, saved in the browser, exportable as CSV. */
(function () {
  "use strict";
  const App = window.App, st = App.state;
  const KEY = "f2d-staad-values";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } };
  const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* ignore */ } };

  function runCase(v) {
    const m = App.normalize(v.build()), s = m.settings;
    let res;
    if (v.analysis === "linear") res = window.Solver.linear(m, { nsub: s.nsub || 1 });
    else if (v.analysis === "second") res = window.Solver.secondOrder(m, { nsub: s.nsub || 1, lamMax: s.lamMax || 1, steps: s.steps || 10 });
    else res = window.Dyn.modal(m, { lumped: s.massType === "lumped", nmodes: 6 });
    const rows = v.quantities.map(q => {
      let val = NaN, th = null;
      try { val = q.get(res, m); } catch (e) { console.error(e); }
      try { th = q.theory ? q.theory(m) : null; } catch (e) { th = null; }
      return { q, val, th };
    });
    return { m, res, rows };
  }

  let cache = null, active = 0;
  App.openValidation = function (tab) {
    if (tab !== undefined) active = tab;
    const el = App.$("#valcenter");
    if (!cache) cache = window.Examples.validations.map(runCase);
    const stored = load();
    const V = window.Examples.validations;
    const status = (row, vk) => {
      const sv = stored[vk] && stored[vk][row.q.key];
      if (sv === undefined || sv === null || sv === "") return { cls: "wait", txt: "Enter STAAD value", diff: null };
      const d = 100 * (row.val - sv) / Math.abs(sv || 1e-30);
      return { cls: Math.abs(d) <= row.q.target ? "pass" : "fail", txt: Math.abs(d) <= row.q.target ? "Within target" : "Outside target", diff: d };
    };
    const summary = (c, k) => { const vk = V[k].key; const s = c.rows.map(r => status(r, vk)); const done = s.filter(x => x.cls !== "wait").length, ok = s.filter(x => x.cls === "pass").length; return { done, ok, n: s.length }; };
    const tabs = V.map((v, k) => { const s = summary(cache[k], k); return `<button class="vtab ${k === active ? "on" : ""}" data-k="${k}"><span class="vkey">${v.key}</span><span class="vtitle">${App.esc(v.title)}</span><span class="vsum">${s.done ? `${s.ok} of ${s.n} within target` : `${s.n} quantities`}</span></button>`; }).join("");
    const v = V[active], c = cache[active], vk = v.key;
    const rows = c.rows.map(r => {
      const s = status(r, vk), sv = stored[vk] && stored[vk][r.q.key];
      const thErr = 100 * (r.val - r.th) / Math.abs(r.th); const thTxt = r.th === null ? "–" : `${App.fmt(r.th, 6)}<small>${Math.abs(thErr) < 1e-9 ? "0" : App.fmt(thErr, 3)} %</small>`;
      return `<tr><td>${App.esc(r.q.label)}${r.q.theorySource ? `<small>${App.esc(r.q.theorySource)}</small>` : ""}</td><td>${App.esc(r.q.unit)}</td><td class="num">${App.fmt(r.val, 6)}</td><td class="num">${thTxt}</td>
        <td><input type="number" step="any" data-q="${r.q.key}" value="${sv === undefined || sv === null ? "" : sv}" placeholder="from STAAD" aria-label="STAAD.Pro value for ${App.esc(r.q.label)}"></td>
        <td class="num">${s.diff === null ? "–" : App.fmt(s.diff, 3) + " %"}</td><td class="num">${r.q.target} %</td><td><span class="vchip ${s.cls}">${s.txt}</span></td></tr>`;
    }).join("");
    el.innerHTML = `<div class="sheet-bar"><strong>Validation against STAAD.Pro</strong><span class="sheet-bar-model">Three independent checks: linear, second order and modal</span><span class="grow"></span>
        <button id="valCsv">Export table (.csv)</button><button id="valClose" class="primary">Back to the model</button></div>
      <div class="val-body"><p class="val-intro">Each case is solved here and in STAAD.Pro with the same geometry, sections, supports and loads. Download the STAAD.Pro input, run it, and type STAAD's numbers into the table: the difference and the pass mark update at once and are saved in this browser.</p>
      <div class="vtabs">${tabs}</div>
      <div class="vcase">
        <aside class="vside">${App.thumb(c.m, 300, 190)}<h3>${v.key}. ${App.esc(v.title)}</h3><p>${App.esc(c.m.description)}</p><p class="muted">${App.esc(v.purpose)}</p>
          <div class="vbtns"><button id="valOpen" class="primary">Open in the workspace</button><button id="valStd">Download STAAD.Pro input</button></div>
          <div class="vstaad"><b>In STAAD.Pro</b><p>${App.esc(v.staad)}</p></div></aside>
        <div class="vtable"><table><thead><tr><th>Quantity</th><th>Unit</th><th>Frame2D</th><th>Theory</th><th>STAAD.Pro</th><th>Difference</th><th>Target</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        <p class="muted">Difference = (Frame2D − STAAD.Pro) / STAAD.Pro. Theory gives closed-form values where they exist; the small number under it is Frame2D's difference from theory.${v.key === "V3" ? " STAAD.Pro lumps masses at the joints, so this case uses Frame2D's lumped mass matrix too." : ""}${v.key === "V2" ? " STAAD's P-Delta method is approximate, so a 1 % target is used for the second-order values." : ""}</p></div>
      </div></div>`;
    el.hidden = false;
    el.querySelectorAll(".vtab").forEach(b => b.onclick = () => App.openValidation(+b.dataset.k));
    el.querySelectorAll("input[data-q]").forEach(inp => inp.onchange = () => {
      const all = load(); all[vk] = all[vk] || {}; all[vk][inp.dataset.q] = inp.value === "" ? null : +inp.value; save(all); App.openValidation();
      const again = App.$(`#valcenter input[data-q="${inp.dataset.q}"]`); if (again) again.focus();
    });
    App.$("#valClose").onclick = () => { el.hidden = true; };
    App.$("#valOpen").onclick = () => { el.hidden = true; App.$("#exampleSelect").value = vk; history.replaceState(null, "", "#" + vk); App.loadModel(v.build()); };
    App.$("#valStd").onclick = () => App.download(`${vk}-${App.slug(v.title)}.std`, window.STAAD.toSTD(c.m, { analysis: v.analysis }), "text/plain");
    App.$("#valCsv").onclick = () => {
      const L = ["case,quantity,unit,frame2d,theory,staad,difference_percent,target_percent"];
      V.forEach((vv, k) => cache[k].rows.forEach(r => { const sv = stored[vv.key] && stored[vv.key][r.q.key]; const d = sv ? 100 * (r.val - sv) / Math.abs(sv) : ""; L.push([vv.key, `"${r.q.label}"`, r.q.unit, r.val, r.th === null ? "" : r.th, sv === undefined || sv === null ? "" : sv, d, r.q.target].join(",")); }));
      App.download("frame2d-staad-validation.csv", L.join("\n"), "text/csv");
    };
  };
  App.invalidateValidation = () => { cache = null; };
})();
