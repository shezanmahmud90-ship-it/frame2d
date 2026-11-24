/* Frame2D Studio - share links with QR codes, DXF drawing export and Excel workbook export. */
(function () {
  "use strict";
  const App = window.App, st = App.state, h = App.h;

  // ------------------------------------------------------------------ share link
  const b64url = bytes => { let s = ""; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const fromB64url = str => { const s = atob(str.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, c => c.charCodeAt(0)); };
  async function deflate(text) {
    if (!window.CompressionStream) return { z: false, data: new TextEncoder().encode(text) };
    const cs = new CompressionStream("deflate-raw");
    const buf = await new Response(new Blob([text]).stream().pipeThrough(cs)).arrayBuffer();
    return { z: true, data: new Uint8Array(buf) };
  }
  async function inflate(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    return await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
  }
  App.encodeModel = async function (m) {
    const json = JSON.stringify(App.cleanForSave(m));
    const r = await deflate(json);
    return (r.z ? "m=" : "j=") + b64url(r.data);
  };
  App.loadFromHash = async function () {
    const hs = location.hash.slice(1);
    try {
      let json;
      if (hs.startsWith("m=")) json = await inflate(fromB64url(hs.slice(2)));
      else if (hs.startsWith("j=")) json = new TextDecoder().decode(fromB64url(hs.slice(2)));
      else return false;
      const m = JSON.parse(json);
      App.$("#exampleSelect").value = "";
      App.loadModel(m, { run: m.settings && m.settings.analysis && m.settings.analysis !== "linear" });
      App.toast(`Opened the shared model: ${m.title || "untitled"}`);
      return true;
    } catch (e) { console.error(e); App.toast("This share link could not be read"); return false; }
  };
  const baseURL = () => {
    if (/^https?:/.test(location.protocol)) return location.origin + location.pathname;
    try { return localStorage.getItem("f2d-base") || "https://YOUR-USERNAME.github.io/frame2d-studio/"; } catch (e) { return "https://YOUR-USERNAME.github.io/frame2d-studio/"; }
  };
  App.qrSVG = function (text, size) {
    const qr = window.qrcode(0, "L"); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), q = 4, cell = (size || 280) / (n + 2 * q);
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${((c + q) * cell).toFixed(2)},${((r + q) * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    const S = (n + 2 * q) * cell;
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S.toFixed(1)} ${S.toFixed(1)}" width="${S.toFixed(0)}" height="${S.toFixed(0)}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#23282C"/></svg>`, modules: n };
  };
  App.openShare = async function (opts) {
    opts = opts || {};
    const dlg = App.$("#dlg"), form = App.$("#dlgForm");
    const frag = await App.encodeModel(st.model);
    const render = () => {
      const base = baseURL(), link = `${base}#${frag}`, onFile = !/^https?:/.test(location.protocol);
      let qrHtml = "", modules = 0;
      try { const q = App.qrSVG(link, 300); qrHtml = q.svg; modules = q.modules; } catch (e) { qrHtml = `<p class="note bad">This model is too large for a QR code (${link.length} characters). Share the link instead.</p>`; }
      form.innerHTML = `<h2>Share this model</h2>
        <p class="note">Anyone who opens the link gets this exact model, results recomputed in their browser. Put the QR code on a slide and the class can open it on their phones.</p>
        ${onFile ? `<label class="field">Published address of the app (GitHub Pages)<input id="shBase" value="${App.esc(base)}"></label>` : ""}
        <div class="share-grid"><div class="share-qr">${qrHtml}</div>
          <div><label class="field">Link (${link.length} characters${modules ? `, QR ${modules}×${modules}` : ""})<textarea id="shLink" rows="6" readonly>${App.esc(link)}</textarea></label>
          <div class="row-actions"><button type="button" class="primary" id="shCopy">Copy link</button><button type="button" id="shSvg" ${modules ? "" : "disabled"}>Download QR (.svg)</button></div>
          ${onFile ? `<p class="note warn">You opened the app from a file, so the link uses the published address above. It works once the app is on GitHub Pages.</p>` : ""}</div></div>
        <div class="actions"><button value="ok" class="primary">Done</button></div>`;
      App.$("#shCopy").onclick = async () => { try { await navigator.clipboard.writeText(link); App.toast("Link copied"); } catch (e) { App.$("#shLink").select(); document.execCommand("copy"); App.toast("Link copied"); } };
      const sv = App.$("#shSvg"); if (sv) sv.onclick = () => App.download(`${App.slug(st.model.title)}-qr.svg`, App.qrSVG(link, 600).svg, "image/svg+xml");
      const bi = App.$("#shBase"); if (bi) bi.onchange = ev => { try { localStorage.setItem("f2d-base", ev.target.value.trim()); } catch (e) { /* ignore */ } render(); };
    };
    render(); dlg.className = "wide"; if (!dlg.open) dlg.showModal();
    void opts;
  };

  // ------------------------------------------------------------------ DXF (AutoCAD R12 ASCII)
  App.exportDXF = function () {
    const m = st.model, L = [];
    const g = (code, val) => { L.push(String(code)); L.push(String(val)); };
    g(0, "SECTION"); g(2, "HEADER"); g(9, "$INSUNITS"); g(70, 6); g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "TABLES"); g(0, "TABLE"); g(2, "LAYER"); g(70, 5);
    [["MEMBERS", 7], ["TRUSS", 8], ["SUPPORTS", 3], ["LOADS", 30], ["LABELS", 5]].forEach(([nm, col]) => { g(0, "LAYER"); g(2, nm); g(70, 0); g(62, col); g(6, "CONTINUOUS"); });
    g(0, "ENDTAB"); g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "ENTITIES");
    const line = (layer, x1, y1, x2, y2) => { g(0, "LINE"); g(8, layer); g(10, x1); g(20, y1); g(30, 0); g(11, x2); g(21, y2); g(31, 0); };
    const textE = (layer, x, y, hgt, s) => { g(0, "TEXT"); g(8, layer); g(10, x); g(20, y); g(30, 0); g(40, hgt); g(1, s); };
    const xs = m.nodes.map(n => +n.x), ys = m.nodes.map(n => +n.y), size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1), th = size / 60;
    m.members.forEach((q, i) => {
      const a = m.nodes[q.i], b = m.nodes[q.j]; if (!a || !b) return;
      line(q.type === "truss" ? "TRUSS" : "MEMBERS", a.x, a.y, b.x, b.y);
      textE("LABELS", (a.x + b.x) / 2 + th * 0.4, (a.y + b.y) / 2 + th * 0.4, th, `M${i + 1}`);
    });
    m.nodes.forEach((n, i) => { g(0, "CIRCLE"); g(8, "LABELS"); g(10, n.x); g(20, n.y); g(30, 0); g(40, th * 0.25); textE("LABELS", n.x + th * 0.5, n.y + th * 0.5, th * 0.8, `${i + 1}`); });
    m.supports.forEach(sp => { const n = m.nodes[sp.node]; if (!n) return; const s = th * 1.4; line("SUPPORTS", n.x, n.y, n.x - s, n.y - s * 1.4); line("SUPPORTS", n.x, n.y, n.x + s, n.y - s * 1.4); line("SUPPORTS", n.x - s * 1.4, n.y - s * 1.4, n.x + s * 1.4, n.y - s * 1.4); });
    m.nodeLoads.forEach(l => { const n = m.nodes[l.node]; if (!n) return; const mag = Math.hypot(+l.fx || 0, +l.fy || 0); if (!mag) return; const dx = (+l.fx || 0) / mag, dy = (+l.fy || 0) / mag, len = th * 4; line("LOADS", n.x - dx * len, n.y - dy * len, n.x, n.y); textE("LOADS", n.x - dx * len, n.y - dy * len + th * 0.3, th * 0.8, `${App.fmt(mag, 3)} kN`); });
    g(0, "ENDSEC"); g(0, "EOF");
    App.download(`${App.slug(m.title)}.dxf`, L.join("\r\n"), "application/dxf");
    App.toast("Exported the DXF drawing (units: m)");
  };

  // ------------------------------------------------------------------ Excel workbook (.xlsx, written directly)
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    files.forEach(f => {
      const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 0, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + data.length;
    });
    const csize = central.reduce((s, a) => s + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const xesc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const colName = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  function sheetXML(rows) {
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`, st0 = ri === 0 ? ' s="1"' : "";
      if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${st0}><v>${v}</v></c>`;
      if (v === null || v === undefined || v === "") return "";
      return `<c r="${ref}" t="inlineStr"${st0}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
    }).join("")}</row>`).join("");
    const widths = rows[0] ? rows[0].map((_, ci) => Math.min(42, Math.max(10, ...rows.map(r => String(r[ci] === undefined ? "" : (typeof r[ci] === "number" ? r[ci].toPrecision(6) : r[ci])).length + 2)))) : [];
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData></worksheet>`;
  }
  App.exportXLSX = function () {
    const m = st.model, res = App.shownResult(), stt = res ? App.stateOf(res) : null, S = window.Solver;
    const sheets = [];
    sheets.push(["Nodes", [["Node", "x (m)", "y (m)"], ...m.nodes.map((n, i) => [i + 1, +n.x, +n.y])]]);
    sheets.push(["Members", [["Member", "Start node", "End node", "Section", "Type", "Pin i", "Pin j", "k i (kN·m/rad)", "k j (kN·m/rad)", "K"], ...m.members.map((q, i) => [i + 1, q.i + 1, q.j + 1, (m.sections[q.sec] || {}).name || "", q.type, q.relI ? "yes" : "", q.relJ ? "yes" : "", +q.kI || "", +q.kJ || "", +q.K || 1])]]);
    sheets.push(["Sections", [["Section", "E (GPa)", "A (cm²)", "I (cm⁴)", "Z (cm³)", "fy (MPa)", "As (cm²)", "ρ (t/m³)"], ...m.sections.map(s => [s.name, s.E / 1e6, s.A * 1e4, s.I * 1e8, (s.Z || 0) * 1e6, (s.fy || 0) / 1e3, (+s.As || 0) * 1e4, s.rho === undefined || s.rho === null ? "" : +s.rho])]]);
    sheets.push(["Loads", [["Kind", "Node/member", "Case", "Pattern", "Values"], ...m.nodeLoads.map(l => ["nodal", l.node + 1, window.Adv ? window.Adv.loadCase(l, false) : "", l.pat === "G" ? "constant" : "×λ", `Fx ${l.fx}, Fy ${l.fy}, M ${l.mz}`]), ...m.memberLoads.map(l => [l.kind, l.member + 1, window.Adv ? window.Adv.loadCase(l, true) : "", l.pat === "G" ? "constant" : "×λ", l.kind === "point" ? `P ${l.P} at ${l.a} m (${l.dir})` : l.kind === "thermal" ? `ΔT ${l.dT}, gradient ${l.dTg}, h ${l.h}` : l.kind === "misfit" ? `ΔL ${l.dL} m` : `w ${l.w1}${l.w2 !== null && l.w2 !== undefined && l.w2 !== "" ? ` to ${l.w2}` : ""} (${l.dir})`])]]);
    if (stt) {
      sheets.push(["Displacements", [["Node", "u (m)", "v (m)", "θ (rad)"], ...m.nodes.map((n, i) => [i + 1, stt.u[3 * i], stt.u[3 * i + 1], stt.u[3 * i + 2]])]]);
      const P = new Float64Array(stt.A.ndof); for (let d = 0; d < P.length; d++) P[d] = stt.g * stt.A.P0[d] + stt.lam * stt.A.Pr[d];
      sheets.push(["Reactions", [["Node", "Component", "Value (kN, kN·m)"], ...stt.A.fixedList.filter(d => d < 3 * m.nodes.length).map(d => [Math.floor(d / 3) + 1, ["Rx", "Ry", "M"][d % 3], stt.F[d] - P[d]])]]);
      const mf = [["Member", "End", "N (kN)", "V (kN)", "M (kN·m)"]];
      m.members.forEach((q, mi) => { const els = stt.A.memberEls[mi]; if (!els || !els.length) return; [[els[0], 0], [els[els.length - 1], 1]].forEach(([e, end]) => { const el = stt.A.els[e], fn = S.fieldFn(el, stt.infos[e], S.elemLoads(el, stt.g, stt.lam), S.elemQ(el, stt.g, stt.lam)), r = fn(end ? el.L0 - 1e-9 : 1e-9); mf.push([mi + 1, end ? "j" : "i", r.N, r.V, r.M]); }); });
      sheets.push(["Member forces", mf]);
    }
    if (res && res.kind === "modal") sheets.push(["Modes", [["Mode", "f (Hz)", "T (s)", "ω (rad/s)", "Mass x", "Mass y"], ...res.modes.map((md, i) => [i + 1, md.f, md.T, md.omega, md.effX, md.effY])]]);
    if (res && res.kind === "combo") sheets.push(["Combinations", [["Combination", "max |M| (kN·m)", "max |N| (kN)", "max Δ (m)"], ...res.summary.map(r => [r.name, r.maxM, r.maxN, r.maxD])]]);
    if (res && res.kind === "th") sheets.push(["Time history", [["t (s)", "ag (g)", "roof (m)", "base shear (kN)"], ...res.tH.map((t, i) => [t, res.ag[i], res.ctrlH[i], res.shearH[i]])]]);
    if (res && res.kind === "il") sheets.push(["Influence line", [["Position (m)", res.label], ...res.posH.map((p, i) => [p, res.values[i]])]]);
    if (st.aiscRows && st.aiscRows.length) sheets.push(["AISC checks", [["Member", "Pr (kN)", "C/T", "φPn (kN)", "Mr (kN·m)", "φMn (kN·m)", "KL/r", "Ratio", "Equation"], ...st.aiscRows.map(r => [r.member + 1, r.Pr, r.comp ? "C" : "T", r.Pc, r.Mr, Number.isFinite(r.Mc) ? r.Mc : "", r.KLr, r.ratio, r.eq])]]);
    const names = sheets.map(([n]) => n.replace(/[\\/?*[\]:]/g, "").slice(0, 31));
    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xesc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
      ...sheets.map(([, rows], i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXML(rows) }))
    ];
    App.download(`${App.slug(m.title)}.xlsx`, zip(files));
    App.toast(`Exported ${sheets.length} sheets to Excel`);
  };
})();
