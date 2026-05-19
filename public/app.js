// ---------- API ----------
const api = {
  async req(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  },
  get: (p) => api.req("GET", p),
  post: (p, b) => api.req("POST", p, b),
  put: (p, b) => api.req("PUT", p, b),
  del: (p) => api.req("DELETE", p),
};

const $ = (id) => document.getElementById(id);
const views = {
  auth: $("view-auth"),
  dash: $("view-dash"),
  editor: $("view-editor"),
};
function show(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
}

// ---------- Auth ----------
let authMode = "login";
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    authMode = t.dataset.tab;
    $("auth-submit").textContent = authMode === "login" ? "Log in" : "Create account";
    $("auth-err").hidden = true;
  })
);

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api.post(`/api/${authMode === "login" ? "login" : "register"}`, {
      username: fd.get("username"),
      password: fd.get("password"),
    });
    await enterApp();
  } catch (err) {
    $("auth-err").textContent = err.message;
    $("auth-err").hidden = false;
  }
});

$("logout-btn").addEventListener("click", async () => {
  await api.post("/api/logout");
  location.reload();
});

async function enterApp() {
  const { user } = await api.get("/api/me");
  $("dash-user").textContent = user.username;
  await loadAbnSamples();
  await openDashboard();
}

// ---------- Dashboard ----------
async function openDashboard() {
  show("dash");
  const { drawings } = await api.get("/api/drawings");
  const list = $("drawing-list");
  list.innerHTML = "";
  $("dash-empty").hidden = drawings.length > 0;
  for (const d of drawings) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="meta">
        <b></b>
        <span></span>
      </div>
      <button class="ghost small" data-act="open">Open</button>
      <button class="ghost small" data-act="del">Delete</button>`;
    li.querySelector("b").textContent = d.title;
    li.querySelector("span").textContent =
      `${d.payload?.titleBlock?.drawingNumber || "no number"} · updated ${new Date(d.updatedAt).toLocaleString()}`;
    li.querySelector('[data-act="open"]').addEventListener("click", () => openEditor(d.id));
    li.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (!confirm(`Delete "${d.title}"?`)) return;
      await api.del(`/api/drawings/${d.id}`);
      openDashboard();
    });
    list.appendChild(li);
  }
}

$("new-drawing-btn").addEventListener("click", async () => {
  const { drawing } = await api.post("/api/drawings", {
    title: "Untitled drawing",
    payload: defaultPayload(),
  });
  openEditor(drawing.id);
});
$("back-btn").addEventListener("click", openDashboard);

// ---------- ABN ----------
async function loadAbnSamples() {
  try {
    const { businesses } = await api.get("/api/abn");
    const dl = $("abn-samples");
    dl.innerHTML = "";
    for (const b of businesses) {
      const o = document.createElement("option");
      o.value = b.abn;
      o.label = b.entityName;
      dl.appendChild(o);
    }
  } catch {}
}

$("abn-lookup-btn").addEventListener("click", async () => {
  const abn = $("f-abn").value.replace(/\s+/g, "");
  $("abn-err").hidden = true;
  try {
    const { business } = await api.get(`/api/abn/${encodeURIComponent(abn)}`);
    $("f-company").value = business.tradingName || business.entityName;
    $("f-address").value = business.address || "";
    syncFromForm();
  } catch (err) {
    $("abn-err").textContent = err.message;
    $("abn-err").hidden = false;
  }
});

// ---------- Editor state ----------
function defaultPayload() {
  return {
    sheet: "A3",
    orientation: "landscape",
    titleBlock: {
      abn: "",
      company: "",
      address: "",
      logo: "",
      title: "",
      drawingNumber: "",
      revision: "A",
      scale: "1:1",
      units: "mm",
      projection: "Third angle",
      sheetNo: 1,
      sheetOf: 1,
      date: new Date().toISOString().slice(0, 10),
      drawnBy: "",
      checkedBy: "",
      approvedBy: "",
    },
    revisions: [
      { rev: "A", date: new Date().toISOString().slice(0, 10), description: "Initial issue", by: "" },
    ],
    shapes: [],
  };
}

let current = null; // { id, title, payload }
let dirty = false;
let tool = "select";
let selectedId = null;

const SHEETS = {
  A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841],
};

function markDirty() {
  dirty = true;
  $("save-state").textContent = "Unsaved changes";
}

async function openEditor(id) {
  const { drawing } = await api.get(`/api/drawings/${id}`);
  current = drawing;
  if (!current.payload || !current.payload.titleBlock) current.payload = defaultPayload();
  selectedId = null;
  dirty = false;
  show("editor");
  $("save-state").textContent = "Saved";
  fillForm();
  render();
}

function fillForm() {
  const p = current.payload;
  const t = p.titleBlock;
  $("editor-title").textContent = current.title;
  $("f-sheet").value = p.sheet;
  $("f-orientation").value = p.orientation;
  $("f-abn").value = t.abn || "";
  $("f-company").value = t.company || "";
  $("f-address").value = t.address || "";
  $("f-title").value = t.title || "";
  $("f-number").value = t.drawingNumber || "";
  $("f-rev").value = t.revision || "";
  $("f-scale").value = t.scale || "";
  $("f-units").value = t.units || "";
  $("f-projection").value = t.projection || "Third angle";
  $("f-sheetno").value = t.sheetNo || 1;
  $("f-sheetof").value = t.sheetOf || 1;
  $("f-date").value = t.date || "";
  $("f-drawn").value = t.drawnBy || "";
  $("f-checked").value = t.checkedBy || "";
  $("f-approved").value = t.approvedBy || "";
  updateLogoPreview();
  renderRevEditor();
}

const FORM_MAP = {
  "f-abn": "abn", "f-company": "company", "f-address": "address",
  "f-title": "title", "f-number": "drawingNumber", "f-rev": "revision",
  "f-scale": "scale", "f-units": "units", "f-projection": "projection",
  "f-sheetno": "sheetNo", "f-sheetof": "sheetOf", "f-date": "date",
  "f-drawn": "drawnBy", "f-checked": "checkedBy", "f-approved": "approvedBy",
};

function syncFromForm() {
  if (!current) return;
  const p = current.payload;
  p.sheet = $("f-sheet").value;
  p.orientation = $("f-orientation").value;
  for (const [el, key] of Object.entries(FORM_MAP)) {
    let v = $(el).value;
    if (el === "f-sheetno" || el === "f-sheetof") v = parseInt(v, 10) || 1;
    p.titleBlock[key] = v;
  }
  current.title = p.titleBlock.title?.trim() || "Untitled drawing";
  $("editor-title").textContent = current.title;
  markDirty();
  render();
}

for (const elId of [
  "f-sheet", "f-orientation", "f-abn", "f-company", "f-address", "f-title",
  "f-number", "f-rev", "f-scale", "f-units", "f-projection", "f-sheetno",
  "f-sheetof", "f-date", "f-drawn", "f-checked", "f-approved",
]) {
  $(elId).addEventListener("input", syncFromForm);
}

// ---------- Logo upload ----------
$("f-logo").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) {
    alert("Logo too large (max 1.5 MB).");
    e.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    current.payload.titleBlock.logo = reader.result;
    updateLogoPreview();
    markDirty();
    render();
  };
  reader.readAsDataURL(file);
});
$("logo-clear-btn").addEventListener("click", () => {
  current.payload.titleBlock.logo = "";
  $("f-logo").value = "";
  updateLogoPreview();
  markDirty();
  render();
});
function updateLogoPreview() {
  const logo = current?.payload?.titleBlock?.logo;
  $("logo-preview").hidden = !logo;
  if (logo) $("logo-img").src = logo;
}

// ---------- Revision editor ----------
function renderRevEditor() {
  const tb = $("rev-rows");
  tb.innerHTML = "";
  current.payload.revisions.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input value="" data-k="rev" style="width:36px"></td>
      <td><input value="" data-k="date" type="date"></td>
      <td><input value="" data-k="description"></td>
      <td><input value="" data-k="by" style="width:46px"></td>
      <td><button class="ghost small" data-del>×</button></td>`;
    tr.querySelector('[data-k="rev"]').value = r.rev || "";
    tr.querySelector('[data-k="date"]').value = r.date || "";
    tr.querySelector('[data-k="description"]').value = r.description || "";
    tr.querySelector('[data-k="by"]').value = r.by || "";
    tr.querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("input", () => {
        current.payload.revisions[i][inp.dataset.k] = inp.value;
        markDirty();
        render();
      })
    );
    tr.querySelector("[data-del]").addEventListener("click", () => {
      current.payload.revisions.splice(i, 1);
      renderRevEditor();
      markDirty();
      render();
    });
    tb.appendChild(tr);
  });
}
$("add-rev-btn").addEventListener("click", () => {
  current.payload.revisions.push({
    rev: "", date: new Date().toISOString().slice(0, 10), description: "", by: "",
  });
  renderRevEditor();
  markDirty();
  render();
});

// ---------- Tools ----------
document.querySelectorAll(".tool").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tool").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    tool = b.dataset.tool;
    selectedId = null;
    render();
  })
);
$("delete-shape-btn").addEventListener("click", deleteSelected);
function deleteSelected() {
  if (!selectedId) return;
  current.payload.shapes = current.payload.shapes.filter((s) => s.id !== selectedId);
  selectedId = null;
  markDirty();
  render();
}
document.addEventListener("keydown", (e) => {
  if ((e.key === "Delete" || e.key === "Backspace") && selectedId &&
      views.editor.hidden === false &&
      !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    e.preventDefault();
    deleteSelected();
  }
});

// ---------- Save / export ----------
$("save-btn").addEventListener("click", saveCurrent);
async function saveCurrent() {
  syncFromForm();
  const { drawing } = await api.put(`/api/drawings/${current.id}`, {
    title: current.title,
    payload: current.payload,
  });
  current = drawing;
  dirty = false;
  $("save-state").textContent = "Saved";
}

$("export-svg-btn").addEventListener("click", () => {
  const svg = buildSvg(current.payload, { export: true });
  const blob = new Blob(
    ['<?xml version="1.0" encoding="UTF-8"?>\n' + svg.outerHTML],
    { type: "image/svg+xml" }
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(current.title || "drawing").replace(/[^\w.-]+/g, "_")}.svg`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("export-pdf-btn").addEventListener("click", () => window.print());

// ---------- SVG renderer ----------
const SVGNS = "http://www.w3.org/2000/svg";
function el(name, attrs = {}, text) {
  const n = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}
function esc(s) {
  return String(s ?? "");
}

function sheetDims(p) {
  let [w, h] = SHEETS[p.sheet] || SHEETS.A3;
  if (p.orientation === "portrait") [w, h] = [h, w];
  return [w, h];
}

function buildSvg(p, opts = {}) {
  const [W, H] = sheetDims(p);
  const svg = el("svg", {
    xmlns: SVGNS,
    viewBox: `0 0 ${W} ${H}`,
    width: `${W}mm`,
    height: `${H}mm`,
  });
  if (!opts.export) {
    const k = Math.min(1100 / W, 760 / H, 4);
    svg.setAttribute("width", `${Math.round(W * k)}`);
    svg.setAttribute("height", `${Math.round(H * k)}`);
  }
  svg.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));

  // border frame (binding margin left)
  const m = { l: 20, t: 10, r: 10, b: 10 };
  const fx = m.l, fy = m.t, fw = W - m.l - m.r, fh = H - m.t - m.b;
  svg.appendChild(el("rect", {
    x: fx, y: fy, width: fw, height: fh,
    fill: "none", stroke: "#000", "stroke-width": 0.7,
  }));
  svg.appendChild(el("rect", {
    x: 5, y: 5, width: W - 10, height: H - 10,
    fill: "none", stroke: "#000", "stroke-width": 0.3,
  }));
  drawZones(svg, W, H, fx, fy, fw, fh);

  // user shapes (clipped to frame)
  const clipId = "frameClip";
  const defs = el("defs");
  const cp = el("clipPath", { id: clipId });
  cp.appendChild(el("rect", { x: fx, y: fy, width: fw, height: fh }));
  defs.appendChild(cp);
  svg.appendChild(defs);
  const shapeLayer = el("g", { "clip-path": `url(#${clipId})` });
  for (const s of p.shapes || []) shapeLayer.appendChild(shapeNode(s, opts));
  svg.appendChild(shapeLayer);

  // title block + revision table, bottom-right
  const tbW = Math.min(180, fw * 0.55);
  const tbH = 46;
  const tbX = fx + fw - tbW;
  const tbY = fy + fh - tbH;
  drawRevisionTable(svg, p, tbX, tbY, tbW);
  drawTitleBlock(svg, p, tbX, tbY, tbW, tbH);
  return svg;
}

function drawZones(svg, W, H, fx, fy, fw, fh) {
  const cols = 8, rows = 6;
  for (let i = 1; i < cols; i++) {
    const x = fx + (fw * i) / cols;
    svg.appendChild(el("line", { x1: x, y1: fy - 4, x2: x, y2: fy, stroke: "#000", "stroke-width": 0.3 }));
    svg.appendChild(el("line", { x1: x, y1: fy + fh, x2: x, y2: fy + fh + 4, stroke: "#000", "stroke-width": 0.3 }));
  }
  for (let i = 0; i < cols; i++) {
    const cx = fx + fw * (i + 0.5) / cols;
    svg.appendChild(el("text", { x: cx, y: fy - 1.3, "font-size": 3, "text-anchor": "middle", "font-family": "sans-serif" }, String(cols - i)));
  }
  for (let i = 1; i < rows; i++) {
    const y = fy + (fh * i) / rows;
    svg.appendChild(el("line", { x1: fx - 4, y1: y, x2: fx, y2: y, stroke: "#000", "stroke-width": 0.3 }));
    svg.appendChild(el("line", { x1: fx + fw, y1: y, x2: fx + fw + 4, y2: y, stroke: "#000", "stroke-width": 0.3 }));
  }
  for (let i = 0; i < rows; i++) {
    const cy = fy + fh * (i + 0.5) / rows + 1;
    svg.appendChild(el("text", { x: fx - 2, y: cy, "font-size": 3, "text-anchor": "middle", "font-family": "sans-serif" }, String.fromCharCode(65 + i)));
  }
}

function shapeNode(s, opts) {
  const sel = !opts.export && s.id === selectedId;
  const stroke = sel ? "#2563eb" : "#000";
  const sw = 0.35;
  let n;
  if (s.type === "line") {
    n = el("line", { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, stroke, "stroke-width": sw });
  } else if (s.type === "rect") {
    n = el("rect", { x: s.x, y: s.y, width: s.w, height: s.h, fill: "none", stroke, "stroke-width": sw });
  } else if (s.type === "circle") {
    n = el("circle", { cx: s.cx, cy: s.cy, r: s.r, fill: "none", stroke, "stroke-width": sw });
  } else if (s.type === "text") {
    n = el("text", { x: s.x, y: s.y, "font-size": s.size || 5, fill: stroke, "font-family": "sans-serif" }, s.text);
  }
  if (n && !opts.export) {
    n.dataset.id = s.id;
    n.style.cursor = tool === "select" ? "move" : "crosshair";
  }
  return n;
}

function cell(svg, x, y, w, h, label, value, opts = {}) {
  svg.appendChild(el("rect", { x, y, width: w, height: h, fill: "none", stroke: "#000", "stroke-width": 0.3 }));
  if (label)
    svg.appendChild(el("text", { x: x + 1.4, y: y + 3.2, "font-size": 2.4, fill: "#444", "font-family": "sans-serif" }, label));
  if (value)
    svg.appendChild(el("text", {
      x: opts.center ? x + w / 2 : x + 1.4,
      y: y + (label ? h - 2 : h / 2 + 1.6),
      "font-size": opts.big ? 4.4 : 3,
      "font-weight": opts.bold ? 700 : 400,
      "text-anchor": opts.center ? "middle" : "start",
      "font-family": "sans-serif",
    }, value));
}

function drawTitleBlock(svg, p, x, y, w, h) {
  const t = p.titleBlock;
  svg.appendChild(el("rect", { x, y, width: w, height: h, fill: "none", stroke: "#000", "stroke-width": 0.6 }));
  const colA = w * 0.34; // company/logo
  const colMid = w * 0.42; // title etc
  const colB = w - colA - colMid;

  // Left: logo + company
  if (t.logo) {
    svg.appendChild(el("image", {
      href: t.logo, x: x + 1, y: y + 1, width: colA - 2, height: 14,
      preserveAspectRatio: "xMidYMid meet",
    }));
  }
  cell(svg, x, y + 16, colA, 10, "", t.company || "Company", { bold: true });
  cell(svg, x, y + 26, colA, 8, "ABN", t.abn || "");
  cell(svg, x, y + 34, colA, h - 34, "", t.address || "");

  // Middle: title + number
  const mx = x + colA;
  cell(svg, mx, y, colMid, 18, "DRAWING TITLE", t.title || "", { bold: true });
  cell(svg, mx, y + 18, colMid, 10, "DRAWING NUMBER", t.drawingNumber || "", { bold: true });
  const q = colMid / 3;
  cell(svg, mx, y + 28, q, h - 28, "SCALE", t.scale || "");
  cell(svg, mx + q, y + 28, q, h - 28, "UNITS", t.units || "");
  cell(svg, mx + 2 * q, y + 28, colMid - 2 * q, h - 28, "PROJ", t.projection || "");

  // Right: rev / sheet / people
  const bx = x + colA + colMid;
  cell(svg, bx, y, colB, 12, "REV", t.revision || "", { center: true, big: true, bold: true });
  cell(svg, bx, y + 12, colB / 2, 9, "SHEET", String(t.sheetNo || 1));
  cell(svg, bx + colB / 2, y + 12, colB / 2, 9, "OF", String(t.sheetOf || 1));
  cell(svg, bx, y + 21, colB, 8, "DATE", t.date || "");
  cell(svg, bx, y + 29, colB, 6, "DRAWN", t.drawnBy || "");
  cell(svg, bx, y + 35, colB, 6, "CHK", t.checkedBy || "");
  cell(svg, bx, y + 41, colB, h - 41, "APPR", t.approvedBy || "");
}

function drawRevisionTable(svg, p, x, yBottom, w) {
  const revs = p.revisions || [];
  const rowH = 5;
  const headH = 5;
  const n = Math.max(revs.length, 1);
  const totalH = headH + n * rowH;
  const y = yBottom - totalH;
  const cRev = w * 0.1, cDate = w * 0.2, cBy = w * 0.12;
  const cDesc = w - cRev - cDate - cBy;
  svg.appendChild(el("rect", { x, y, width: w, height: totalH, fill: "none", stroke: "#000", "stroke-width": 0.5 }));
  const head = ["REV", "DESCRIPTION", "DATE", "BY"];
  const cols = [cRev, cDesc, cDate, cBy];
  let cx = x;
  cols.forEach((cw, i) => {
    svg.appendChild(el("rect", { x: cx, y, width: cw, height: headH, fill: "#eee", stroke: "#000", "stroke-width": 0.3 }));
    svg.appendChild(el("text", { x: cx + 1.2, y: y + 3.4, "font-size": 2.4, "font-weight": 700, "font-family": "sans-serif" }, head[i]));
    cx += cw;
  });
  revs.forEach((r, i) => {
    const ry = y + headH + i * rowH;
    let rx = x;
    const vals = [r.rev, r.description, r.date, r.by];
    cols.forEach((cw, j) => {
      svg.appendChild(el("rect", { x: rx, y: ry, width: cw, height: rowH, fill: "none", stroke: "#000", "stroke-width": 0.25 }));
      svg.appendChild(el("text", { x: rx + 1.2, y: ry + 3.4, "font-size": 2.5, "font-family": "sans-serif" }, esc(vals[j])));
      rx += cw;
    });
  });
}

// ---------- Render + interaction ----------
function render() {
  if (!current) return;
  const host = $("sheet-host");
  host.innerHTML = "";
  const svg = buildSvg(current.payload);
  host.appendChild(svg);
  attachCanvasHandlers(svg);
  $("delete-shape-btn").disabled = !selectedId;
}

function svgPoint(svg, evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const m = svg.getScreenCTM().inverse();
  const r = pt.matrixTransform(m);
  return { x: r.x, y: r.y };
}

function applySelectionHighlight(svg) {
  svg.querySelectorAll("[data-id]").forEach((n) => {
    const isSel = n.dataset.id === selectedId;
    const color = isSel ? "#2563eb" : "#000";
    if (n.tagName === "text") n.setAttribute("fill", color);
    else n.setAttribute("stroke", color);
  });
  $("delete-shape-btn").disabled = !selectedId;
}

function attachCanvasHandlers(svg) {
  let draft = null;
  let moving = null;

  svg.addEventListener("pointerdown", (e) => {
    const { x, y } = svgPoint(svg, e);
    if (tool === "select") {
      const id = e.target?.dataset?.id;
      if (id) {
        selectedId = id;
        const s = current.payload.shapes.find((sh) => sh.id === id);
        moving = { id, node: e.target, start: { x, y }, origin: JSON.parse(JSON.stringify(s)) };
        svg.setPointerCapture(e.pointerId);
      } else {
        selectedId = null;
      }
      applySelectionHighlight(svg);
      return;
    }
    if (tool === "text") {
      const text = prompt("Text:");
      if (text) {
        current.payload.shapes.push({ id: uid(), type: "text", x, y, text, size: 5 });
        markDirty();
        render();
      }
      return;
    }
    draft = { type: tool, sx: x, sy: y, x, y };
    svg.setPointerCapture(e.pointerId);
  });

  svg.addEventListener("pointermove", (e) => {
    if (moving) {
      const { x, y } = svgPoint(svg, e);
      const dx = x - moving.start.x, dy = y - moving.start.y;
      const s = current.payload.shapes.find((sh) => sh.id === moving.id);
      const o = moving.origin;
      const n = moving.node;
      if (s.type === "line") {
        s.x1 = o.x1 + dx; s.y1 = o.y1 + dy; s.x2 = o.x2 + dx; s.y2 = o.y2 + dy;
        n.setAttribute("x1", s.x1); n.setAttribute("y1", s.y1);
        n.setAttribute("x2", s.x2); n.setAttribute("y2", s.y2);
      } else if (s.type === "rect") {
        s.x = o.x + dx; s.y = o.y + dy;
        n.setAttribute("x", s.x); n.setAttribute("y", s.y);
      } else if (s.type === "circle") {
        s.cx = o.cx + dx; s.cy = o.cy + dy;
        n.setAttribute("cx", s.cx); n.setAttribute("cy", s.cy);
      } else if (s.type === "text") {
        s.x = o.x + dx; s.y = o.y + dy;
        n.setAttribute("x", s.x); n.setAttribute("y", s.y);
      }
      return;
    }
    if (!draft) return;
    const { x, y } = svgPoint(svg, e);
    draft.x = x; draft.y = y;
    renderDraft(svg, draft);
  });

  function finish(e) {
    if (moving) { moving = null; markDirty(); return; }
    if (!draft) return;
    const s = draftToShape(draft);
    draft = null;
    const old = svg.querySelector("#__draft");
    if (old) old.remove();
    if (s) {
      current.payload.shapes.push(s);
      markDirty();
      render();
    }
  }
  svg.addEventListener("pointerup", finish);
  svg.addEventListener("pointerleave", finish);
}

function renderDraft(svg, d) {
  const old = svg.querySelector("#__draft");
  if (old) old.remove();
  const s = draftToShape(d);
  if (!s) return;
  const n = shapeNode(s, {});
  n.id = "__draft";
  n.setAttribute("stroke", "#2563eb");
  svg.appendChild(n);
}

function draftToShape(d) {
  const minX = Math.min(d.sx, d.x), minY = Math.min(d.sy, d.y);
  const w = Math.abs(d.x - d.sx), h = Math.abs(d.y - d.sy);
  if (d.type === "line") {
    if (w < 0.5 && h < 0.5) return null;
    return { id: uid(), type: "line", x1: d.sx, y1: d.sy, x2: d.x, y2: d.y };
  }
  if (d.type === "rect") {
    if (w < 1 || h < 1) return null;
    return { id: uid(), type: "rect", x: minX, y: minY, w, h };
  }
  if (d.type === "circle") {
    const r = Math.hypot(d.x - d.sx, d.y - d.sy);
    if (r < 1) return null;
    return { id: uid(), type: "circle", cx: d.sx, cy: d.sy, r };
  }
  return null;
}

function uid() {
  return "s" + Math.random().toString(36).slice(2, 9);
}

// ---------- Boot ----------
(async function boot() {
  try {
    await enterApp();
  } catch {
    show("auth");
  }
})();
