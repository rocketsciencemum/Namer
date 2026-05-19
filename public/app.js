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

let STD = {};
async function loadStandards() {
  try {
    const { standards } = await api.get("/api/standards");
    STD = standards || {};
  } catch {
    STD = {};
  }
}

async function enterApp() {
  await api.get("/api/me");
  $("dash-user").textContent = "";
  await loadAbnSamples();
  await loadStandards();
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
    const pl = d.payload || {};
    const ds = Array.isArray(pl.sheets) ? pl.sheets.find((s) => s.type === "drawing") : null;
    const dn = ds?.titleBlock?.drawingNumber || pl.titleBlock?.drawingNumber || "no number";
    const sheetCount = Array.isArray(pl.sheets) ? pl.sheets.length : 1;
    li.querySelector("b").textContent = pl.projectName || d.title;
    li.querySelector("span").textContent =
      `${dn} · ${sheetCount} sheet${sheetCount === 1 ? "" : "s"} · updated ${new Date(d.updatedAt).toLocaleString()}`;
    li.querySelector('[data-act="open"]').addEventListener("click", () => openEditor(d.id));
    li.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (!confirm(`Delete "${d.title}"?`)) return;
      await api.del(`/api/drawings/${d.id}`);
      openDashboard();
    });
    list.appendChild(li);
  }
}

const DISCIPLINES = {
  template: { name: "Template only", desc: "Title block, company & revisions — no components.", kinds: [] },
  civils: { name: "Civils (pit & pipe)", desc: "Rack, pit, conduit, demarcation.", kinds: ["rack", "pit", "conduit", "demarc"] },
  equipment: { name: "Equipment / optical", desc: "FOBOT, patch, FIST/Apex splice, tray, fibre, connector.", kinds: ["rack", "patch", "splice", "tray", "cable", "connector"] },
  active: { name: "Active equipment", desc: "Rack, patch, connector (active layer to come).", kinds: ["rack", "patch", "connector"] },
  blank: { name: "Blank", desc: "Full component palette, nothing preset.", kinds: [] },
};

function chooseDrawingType() {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "modal-ov";
    const box = document.createElement("div");
    box.className = "modal-box";
    box.innerHTML = "<h3>New drawing — pick a type</h3>";
    for (const [key, d] of Object.entries(DISCIPLINES)) {
      const b = document.createElement("button");
      b.className = "modal-choice";
      b.innerHTML = `<b>${d.name}</b><span>${d.desc}</span>`;
      b.addEventListener("click", () => { ov.remove(); resolve(key); });
      box.appendChild(b);
    }
    const cancel = document.createElement("button");
    cancel.className = "ghost small";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => { ov.remove(); resolve(null); });
    box.appendChild(cancel);
    ov.appendChild(box);
    ov.addEventListener("click", (e) => { if (e.target === ov) { ov.remove(); resolve(null); } });
    document.body.appendChild(ov);
  });
}

$("new-drawing-btn").addEventListener("click", async () => {
  const disc = await chooseDrawingType();
  if (!disc) return;
  const pl = defaultPayload();
  const ds = pl.sheets.find((s) => s.type === "drawing");
  ds.discipline = disc;
  ds.name = DISCIPLINES[disc].name;
  const { drawing } = await api.post("/api/drawings", {
    title: "Untitled drawing",
    payload: pl,
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
function newTitleBlock() {
  return {
    abn: "", noAbn: false, company: "", address: "", logo: "",
    title: "", drawingNumber: "", revision: "A", scale: "1:1", units: "mm",
    projection: "Third angle", sheetNo: 1, sheetOf: 1,
    date: new Date().toISOString().slice(0, 10),
    drawnBy: "", checkedBy: "", approvedBy: "",
  };
}
function newDrawingSheet(name, ref) {
  return {
    id: uid(),
    type: "drawing",
    name: name || "Drawing",
    ref: ref || "001",
    discipline: "blank",
    sheet: "A3",
    orientation: "landscape",
    titleBlock: newTitleBlock(),
    revisions: [
      { rev: "A", date: new Date().toISOString().slice(0, 10), description: "Initial issue", by: "" },
    ],
    standard: "AARNet",
    shapes: [],
    components: [],
    links: [],
  };
}
function defaultPayload() {
  const d = newDrawingSheet("Drawing 1", "001");
  return {
    projectName: "",
    activeSheetId: d.id,
    sheets: [
      { id: uid(), type: "cover", name: "Cover sheet", ref: "000" },
      d,
    ],
  };
}

// Migrate a legacy single-sheet payload into the sheets[] container.
function migratePayload(pl) {
  if (pl && Array.isArray(pl.sheets) && pl.sheets.length) return pl;
  const d = newDrawingSheet("Drawing 1", "001");
  if (pl && pl.titleBlock) {
    Object.assign(d, {
      sheet: pl.sheet || "A3",
      orientation: pl.orientation || "landscape",
      titleBlock: { ...newTitleBlock(), ...pl.titleBlock },
      revisions: Array.isArray(pl.revisions) ? pl.revisions : d.revisions,
      standard: pl.standard || "AARNet",
      shapes: Array.isArray(pl.shapes) ? pl.shapes : [],
      components: Array.isArray(pl.components) ? pl.components : [],
      links: Array.isArray(pl.links) ? pl.links : [],
    });
  }
  return {
    projectName: pl?.titleBlock?.title || "",
    activeSheetId: d.id,
    sheets: [{ id: uid(), type: "cover", name: "Cover sheet", ref: "000" }, d],
  };
}

function aSheet() {
  const pl = current.payload;
  return pl.sheets.find((s) => s.id === pl.activeSheetId) || pl.sheets[0];
}
// Active sheet if it is a drawing, else the first drawing sheet.
function dsheet() {
  const a = aSheet();
  if (a && a.type === "drawing") return a;
  return current.payload.sheets.find((s) => s.type === "drawing");
}

let current = null; // { id, title, payload }
let dirty = false;
let tool = "select";
let selectedId = null;
let selectedCid = null;
let selectedLid = null;
let placeKind = null;
let linkKind = null;
let pendingA = null;

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
  current.payload = migratePayload(current.payload);
  for (const s of current.payload.sheets) {
    if (s.type !== "drawing") continue;
    if (!Array.isArray(s.shapes)) s.shapes = [];
    if (!Array.isArray(s.components)) s.components = [];
    if (!Array.isArray(s.links)) s.links = [];
    if (!["AARNet", "Generic"].includes(s.standard)) s.standard = "AARNet";
  }
  selectedId = null;
  selectedCid = null;
  placeKind = null;
  dirty = false;
  show("editor");
  $("save-state").textContent = "Saved";
  fillForm();
  buildPalette();
  buildSheetTabs();
  $("f-standard").value = dsheet().standard;
  updateStdNote();
  renderInspector();
  activeView = "drawing";
  $("canvas-wrap").hidden = false;
  $("tables-wrap").hidden = true;
  $("checks-wrap").hidden = true;
  $("tab-drawing").classList.add("active");
  $("tab-tables").classList.remove("active");
  $("tab-checks").classList.remove("active");
  render();
}

function fillForm() {
  const p = dsheet();
  const t = p.titleBlock;
  $("editor-title").textContent = current.title;
  $("f-project").value = current.payload.projectName || "";
  $("f-discipline").value = p.discipline || "blank";
  $("f-sheet").value = p.sheet;
  $("f-orientation").value = p.orientation;
  $("f-abn").value = t.abn || "";
  $("f-noabn").checked = !!t.noAbn;
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
  const p = dsheet();
  current.payload.projectName = $("f-project").value;
  p.sheet = $("f-sheet").value;
  p.orientation = $("f-orientation").value;
  for (const [el, key] of Object.entries(FORM_MAP)) {
    let v = $(el).value;
    if (el === "f-sheetno" || el === "f-sheetof") v = parseInt(v, 10) || 1;
    p.titleBlock[key] = v;
  }
  p.titleBlock.noAbn = $("f-noabn").checked;
  current.title = current.payload.projectName?.trim() ||
    p.titleBlock.title?.trim() || "Untitled drawing";
  $("editor-title").textContent = current.title;
  markDirty();
  render();
}
$("f-noabn").addEventListener("change", syncFromForm);
$("f-project").addEventListener("input", syncFromForm);

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
    dsheet().titleBlock.logo = reader.result;
    updateLogoPreview();
    markDirty();
    render();
  };
  reader.readAsDataURL(file);
});
$("logo-clear-btn").addEventListener("click", () => {
  dsheet().titleBlock.logo = "";
  $("f-logo").value = "";
  updateLogoPreview();
  markDirty();
  render();
});
function updateLogoPreview() {
  const logo = dsheet()?.titleBlock?.logo;
  $("logo-preview").hidden = !logo;
  if (logo) $("logo-img").src = logo;
}

// ---------- Revision editor ----------
function renderRevEditor() {
  const tb = $("rev-rows");
  tb.innerHTML = "";
  dsheet().revisions.forEach((r, i) => {
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
        dsheet().revisions[i][inp.dataset.k] = inp.value;
        markDirty();
        render();
      })
    );
    tr.querySelector("[data-del]").addEventListener("click", () => {
      dsheet().revisions.splice(i, 1);
      renderRevEditor();
      markDirty();
      render();
    });
    tb.appendChild(tr);
  });
}
$("add-rev-btn").addEventListener("click", () => {
  dsheet().revisions.push({
    rev: "", date: new Date().toISOString().slice(0, 10), description: "", by: "",
  });
  renderRevEditor();
  markDirty();
  render();
});

// ---------- Tools ----------
function clearPaletteActive() {
  document.querySelectorAll("#palette button, #link-palette button")
    .forEach((x) => x.classList.remove("active"));
}
document.querySelectorAll("#link-palette button").forEach((b) =>
  b.addEventListener("click", () => {
    clearPaletteActive();
    b.classList.add("active");
    linkKind = b.dataset.link;
    placeKind = null;
    pendingA = null;
    selectedId = selectedCid = selectedLid = null;
    setTool("link");
    $("link-hint").textContent = `Click the FIRST component for the ${linkKind} run…`;
    renderInspector();
    render();
  })
);
function setTool(name) {
  tool = name;
  document.querySelectorAll(".tool").forEach((x) =>
    x.classList.toggle("active", x.dataset.tool === name)
  );
}
document.querySelectorAll(".tool").forEach((b) =>
  b.addEventListener("click", () => {
    setTool(b.dataset.tool);
    placeKind = null;
    linkKind = null;
    pendingA = null;
    clearPaletteActive();
    selectedId = null;
    selectedCid = null;
    selectedLid = null;
    renderInspector();
    render();
  })
);
$("delete-shape-btn").addEventListener("click", deleteSelected);
function deleteSelected() {
  if (selectedId) {
    dsheet().shapes = dsheet().shapes.filter((s) => s.id !== selectedId);
    selectedId = null;
  } else if (selectedCid) {
    const ds = dsheet();
    ds.components = ds.components.filter((c) => c.id !== selectedCid);
    ds.links = ds.links.filter((l) => l.aId !== selectedCid && l.bId !== selectedCid);
    selectedCid = null;
    renderInspector();
  } else if (selectedLid) {
    dsheet().links = dsheet().links.filter((l) => l.id !== selectedLid);
    selectedLid = null;
    renderInspector();
  } else return;
  markDirty();
  render();
}
document.addEventListener("keydown", (e) => {
  if ((e.key === "Delete" || e.key === "Backspace") && (selectedId || selectedCid || selectedLid) &&
      views.editor.hidden === false &&
      !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    e.preventDefault();
    deleteSelected();
  }
});

$("f-standard").addEventListener("change", () => {
  dsheet().standard = $("f-standard").value;
  updateStdNote();
  renderInspector();
  render();
  markDirty();
});

$("f-discipline").addEventListener("change", () => {
  dsheet().discipline = $("f-discipline").value;
  buildPalette();
  markDirty();
});
$("f-allcomp").addEventListener("change", buildPalette);

function updateStdNote() {
  const name = dsheet()?.standard;
  const s = STD[name];
  const note = $("std-note");
  if (!s) { note.textContent = ""; return; }
  note.textContent =
    (s.unverified ? "⚠ Indicative only — verify. " : "") + "Source: " + s.source;
  note.className = "tiny " + (s.unverified ? "label-hint bad" : "muted");
}

// ---------- Fibre component catalog ----------
const STANDARDS = {
  AARNet: { fibreType: "OS2 (G.652.D)", polish: "APC", connector: "SC", fibreCount: 48 },
  NBN: { fibreType: "OS2 (G.657.A1)", polish: "APC", connector: "SC", fibreCount: 24 },
  Generic: { fibreType: "OS2 (G.652.D)", polish: "UPC", connector: "LC", fibreCount: 12 },
};
const OPT = {
  fibreType: ["OS2 (G.652.D)", "OS2 (G.657.A1)", "OM4", "OM5"],
  polish: ["APC", "UPC"],
  connector: ["LC", "MPO", "SC", "FC"],
  fibreCount: [2, 4, 6, 8, 12, 24, 48, 72, 96, 144, 288, 360],
  pitSize: ["P1", "P2", "P3", "P4", "P5", "P6", "P8", "P9", "P10", "FP-PIT", "JP-PIT"],
  conduitDia: ["20mm", "32mm", "50mm", "63mm", "100mm", "HDPE 32mm", "HDPE 50mm"],
  rackWidth: ['19" EIA', '21" ETSI', '23" telco'],
  rackRU: [12, 18, 24, 27, 36, 42, 45, 47],
  pitMaterial: ["Plastic", "Concrete"],
  lidType: ["Composite Class B", "Class A", "Class B", "Class D"],
  conduitLocation: ["Footpath", "Road shoulder", "Carriageway", "Other"],
};
const FIELD_META = {
  equipment: { label: "Equipment", type: "text" },
  ref: { label: "Ref / ID", type: "text" },
  fibreType: { label: "Fibre type", type: "select", opts: OPT.fibreType },
  polish: { label: "Polish", type: "select", opts: OPT.polish },
  connector: { label: "Connector", type: "select", opts: OPT.connector },
  fibreCount: { label: "Fibre count", type: "select", opts: OPT.fibreCount },
  pitSize: { label: "Pit size / type", type: "select", opts: OPT.pitSize },
  conduitDia: { label: "Conduit Ø", type: "select", opts: OPT.conduitDia },
  material: { label: "Material", type: "text" },
  lengthM: { label: "Length (m)", type: "number" },
  rackWidth: { label: "Rack width", type: "select", opts: OPT.rackWidth },
  rackRU: { label: "Rack height (RU)", type: "select", opts: OPT.rackRU },
  pitMaterial: { label: "Pit material", type: "select", opts: OPT.pitMaterial },
  lidType: { label: "Lid type", type: "select", opts: OPT.lidType },
  lidQty: { label: "Lid quantity", type: "number" },
  pitWeightKg: { label: "Pit weight (kg)", type: "number" },
  conduitDepthMm: { label: "Min depth / cover (mm)", type: "number" },
  conduitLocation: { label: "Location", type: "select", opts: OPT.conduitLocation },
};
const KIND_FIELDS = {
  rack: ["equipment", "ref", "rackWidth", "rackRU"],
  patch: ["equipment", "ref", "connector", "polish", "fibreCount"],
  splice: ["equipment", "ref", "fibreCount"],
  tray: ["ref", "fibreCount"],
  pit: ["pitSize", "ref", "pitMaterial", "lidType", "lidQty", "pitWeightKg"],
  conduit: ["conduitDia", "material", "lengthM", "conduitDepthMm", "conduitLocation", "ref"],
  cable: ["fibreType", "fibreCount", "lengthM", "ref"],
  connector: ["connector", "polish", "ref"],
  demarc: ["ref", "equipment", "pitSize", "pitMaterial", "lidType", "lidQty", "pitWeightKg"],
};
const CATALOG = {
  rack: { name: "User rack / ODF", w: 26, h: 40 },
  patch: { name: "Patch panel", w: 32, h: 10 },
  splice: { name: "Splice enclosure", w: 26, h: 16 },
  tray: { name: "Splice tray", w: 22, h: 9 },
  pit: { name: "Pit", w: 24, h: 18 },
  conduit: { name: "Conduit / duct", w: 44, h: 7 },
  cable: { name: "Fibre cable", w: 48, h: 6 },
  connector: { name: "Connector", w: 12, h: 12 },
  demarc: { name: "Demarcation pit", w: 24, h: 20 },
};
const ORDER = ["rack", "patch", "splice", "tray", "pit", "conduit", "cable", "connector", "demarc"];

function newLink(kind, aId, bId) {
  const std = STANDARDS[dsheet().standard] || STANDARDS.Generic;
  const props =
    kind === "cable"
      ? { ref: "", fibreType: std.fibreType, fibreCount: std.fibreCount, lengthM: 50, partNo: "" }
      : { ref: "", conduitDia: "100mm", material: "HDPE", lengthM: 50, conduitDepthMm: 450, conduitLocation: "Footpath" };
  return { id: uid(), kind, aId, bId, label: kind === "cable" ? "Cable run" : "Conduit run", props, io: [] };
}
// Which component kinds a run type may connect.
const CONNECT_RULES = {
  cable: ["rack", "patch", "splice", "tray", "demarc"],
  conduit: ["rack", "pit", "demarc", "conduit"],
};
function linkAllows(linkKind, compKind) {
  return (CONNECT_RULES[linkKind] || []).includes(compKind);
}
function validTargets(linkKind, excludeId) {
  return dsheet().components.filter(
    (c) => c.id !== excludeId && linkAllows(linkKind, c.kind)
  );
}

function autoLinkKind(kA, kB) {
  if (linkAllows("cable", kA) && linkAllows("cable", kB)) return "cable";
  if (linkAllows("conduit", kA) && linkAllows("conduit", kB)) return "conduit";
  return null;
}
// On drop, snap a moved component beside the nearest connectable one and
// create the valid run between them if not already linked.
function dockAndConnect(cid) {
  const ds = dsheet();
  const c = ds.components.find((x) => x.id === cid);
  if (!c) return false;
  const pc = compCentre(c);
  const radius = 30 * sheetScale(ds);
  let best = null, bestD = Infinity, bestKind = null;
  for (const t of ds.components) {
    if (t.id === c.id) continue;
    const lk = autoLinkKind(c.kind, t.kind);
    if (!lk) continue;
    const pt = compCentre(t);
    const d = Math.hypot(pt.x - pc.x, pt.y - pc.y);
    if (d < bestD) { bestD = d; best = t; bestKind = lk; }
  }
  if (!best || bestD > radius) return false;
  const exists = ds.links.some(
    (l) => l.kind === bestKind &&
      ((l.aId === c.id && l.bId === best.id) || (l.bId === c.id && l.aId === best.id))
  );
  // Dock: place c adjacent to the target, centres aligned on the cross axis.
  const pt = compCentre(best);
  const gap = 8 * sheetScale(ds);
  if (Math.abs(pt.x - pc.x) >= Math.abs(pt.y - pc.y)) {
    c.y = best.y + best.h / 2 - c.h / 2;
    c.x = pc.x >= pt.x ? best.x + best.w + gap : best.x - gap - c.w;
  } else {
    c.x = best.x + best.w / 2 - c.w / 2;
    c.y = pc.y >= pt.y ? best.y + best.h + gap : best.y - gap - c.h;
  }
  if (!exists) {
    const lk = newLink(bestKind, c.id, best.id);
    ds.links.push(lk);
    selectedLid = lk.id;
    selectedCid = null;
  }
  return true;
}

function nearestValidComponent(linkKind, x, y, excludeId) {
  let best = null;
  let bestD = Infinity;
  const radius = 22 * sheetScale(dsheet());
  for (const c of validTargets(linkKind, excludeId)) {
    const p = compCentre(c);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best && bestD <= radius ? best : null;
}

function compById(id) {
  return dsheet().components.find((c) => c.id === id) || null;
}
function compCentre(c) {
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
}

function sheetScale(p) {
  // Keep symbols a consistent visual fraction of the sheet regardless of
  // size (A4..A0). Reference is the A3-landscape frame width (390 mm).
  const [W] = sheetDims(p);
  const fw = W - 30;
  return Math.max(0.7, Math.min(3, fw / 390));
}

function newComponent(kind, cx, cy) {
  const def = CATALOG[kind];
  const std = STANDARDS[dsheet().standard] || STANDARDS.Generic;
  const k = sheetScale(dsheet());
  const w = +(def.w * k).toFixed(1);
  const h = +(def.h * k).toFixed(1);
  return {
    id: uid(),
    kind,
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
    label: def.name,
    props: {
      equipment: "",
      ref: "",
      material: "HDPE",
      lengthM: kind === "conduit" || kind === "cable" ? 50 : "",
      pitSize: kind === "demarc" ? "P6" : "P3",
      conduitDia: "100mm",
      conduitDepthMm: kind === "conduit" ? 450 : "",
      conduitLocation: "Footpath",
      rackWidth: '19" EIA',
      rackRU: 45,
      pitMaterial: "Plastic",
      lidType: "Composite Class B",
      lidQty: 2,
      pitWeightKg: "",
      fibreType: std.fibreType,
      polish: std.polish,
      connector: std.connector,
      fibreCount: std.fibreCount,
    },
    io: [],
  };
}

const TIA = [
  ["Blue", "#1f4ed8"], ["Orange", "#e67e22"], ["Green", "#1e8b3a"], ["Brown", "#7b4a12"],
  ["Slate", "#7a8aa0"], ["White", "#e5e7eb"], ["Red", "#d6283b"], ["Black", "#111827"],
  ["Yellow", "#f4d03f"], ["Violet", "#7d3cc8"], ["Rose", "#e58fb0"], ["Aqua", "#37c9c9"],
];
function coreColour(n) {
  // TIA-598-C: 12 base colours; every second group of 12 carries a black
  // tracer stripe (fibres 13-24, 37-48, ...). Beyond 12 fibres are grouped
  // into 12-fibre buffer tubes (tube colours follow the same scheme).
  const idx = (n - 1) % 12;
  const group = Math.floor((n - 1) / 12);
  const stripe = group % 2 === 1;
  const [base, hex] = TIA[idx];
  const tubeNo = group + 1;
  const [tubeName, tubeHex] = TIA[group % 12];
  const tubeStripe = Math.floor(group / 12) % 2 === 1;
  return {
    name: base + (stripe ? " / black tracer" : ""),
    hex,
    stripe,
    tubeNo,
    tubeName: tubeName + (tubeStripe ? " / black tracer" : ""),
    tubeHex,
    tubeStripe,
  };
}
function swatchHtml(hex, stripe) {
  const bg = stripe
    ? `background:repeating-linear-gradient(90deg,${hex} 0 5px,#111 5px 7px)`
    : `background:${hex}`;
  return `<span class="swatch" style="${bg}"></span>`;
}
function ioCoreCount(c) {
  const p = c.props || {};
  const n = parseInt(p.fibreCount, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function ensureIo(c, count) {
  if (!Array.isArray(c.io)) c.io = [];
  if (count == null) count = c.io.length;
  while (c.io.length < count) c.io.push({ a: "", b: "", status: "" });
  if (c.io.length > count) c.io.length = count;
  return c.io;
}

function specLine(c) {
  const p = c.props;
  switch (c.kind) {
    case "cable": return `${p.fibreCount}F ${p.fibreType}` + (p.lengthM ? ` · ${p.lengthM} m` : "");
    case "conduit": return `${p.conduitDia} ${p.material}` + (p.lengthM ? ` · ${p.lengthM} m` : "") + (p.conduitDepthMm ? ` · ${p.conduitDepthMm}mm cover` : "");
    case "connector": return `${p.connector}/${p.polish}`;
    case "patch": return `${p.fibreCount}F · ${p.connector}/${p.polish}`;
    case "splice":
    case "tray": return `${p.fibreCount}F`;
    case "rack": return `${p.rackWidth || ""} · ${p.rackRU || ""}RU`;
    case "pit":
    case "demarc": return `${p.pitSize} · ${p.pitMaterial || ""}` + (p.lidQty ? ` · ${p.lidQty}× ${p.lidType || "lid"}` : "");
    default: return p.ref || "";
  }
}

function curStd() {
  return STD[dsheet()?.standard] || null;
}
function labelFmtFor(kind) {
  const s = curStd();
  if (!s || !s.labels) return null;
  if (kind === "pit" || kind === "demarc") return s.labels.pit;
  if (kind === "patch") return s.labels.ftp;
  return null;
}
const RANK = { green: 0, na: 0, yellow: 1, red: 2 };

function assess(c) {
  const s = curStd();
  if (!s) return { status: "na", messages: ["No ruleset loaded."] };
  const p = c.props;
  const msgs = [];
  let worst = "green";
  const down = (lvl, m) => { msgs.push(m); if (RANK[lvl] > RANK[worst]) worst = lvl; };

  const countCheck = (count) => {
    if (count && s.fibre.approvedCounts?.length && !s.fibre.approvedCounts.includes(Number(count)))
      down("yellow", `${count}F is not an approved core count (${s.fibre.approvedCounts.join("/")}) — verify.`);
  };
  const connCheck = (conn, pol) => {
    if (s.connector.required && conn && conn !== s.connector.required)
      down("yellow", `Connector ${conn} differs from required ${s.connector.required}/${s.connector.requiredPolish} — verify.`);
    if (s.connector.requiredPolish && pol && pol !== s.connector.requiredPolish)
      down("red", `${pol} polish not permitted; ${s.connector.requiredPolish} required.`);
  };

  switch (c.kind) {
    case "cable": {
      const type = p.fibreType;
      if (s.fibre.requiredType && type && type !== s.fibre.requiredType) {
        if (/OM\d/.test(type)) down("red", `${type} is multimode; ${s.fibre.requiredType} required.`);
        else down("yellow", `${type} differs from required ${s.fibre.requiredType} — verify.`);
      }
      countCheck(p.fibreCount);
      if (p.partNo && s.fibre.approvedCables?.length) {
        const m = s.fibre.approvedCables.find((a) => a.partNo === p.partNo);
        if (m) msgs.push(`Matched approved cable ${m.partNo} (${m.cores}F ${m.construction}, ${m.use}).`);
        else down("yellow", `Part ${p.partNo} not in the approved cable list — verify.`);
      }
      break;
    }
    case "patch": {
      connCheck(p.connector, p.polish);
      if (s.ftp.sizes?.length && p.fibreCount && !s.ftp.sizes.includes(Number(p.fibreCount)))
        down("yellow", `${p.fibreCount}-port is not a standard FTP size (${s.ftp.sizes.join("/")}).`);
      if (p.partNo && s.ftp.approved?.length) {
        const m = s.ftp.approved.find((a) => a.partNo === p.partNo);
        if (m) msgs.push(`Matched approved FTP ${m.partNo} (${m.supplier}, ${m.ports} port).`);
        else down("yellow", `FTP part ${p.partNo} not in approved supplier list — verify.`);
      }
      break;
    }
    case "connector":
      connCheck(p.connector, p.polish);
      break;
    case "conduit": {
      const MIN = { Footpath: 450, "Road shoulder": 600, Carriageway: 750, Other: 450 };
      const need = MIN[p.conduitLocation] ?? 450;
      const d = parseFloat(p.conduitDepthMm);
      if (!Number.isFinite(d) || d <= 0)
        down("yellow", `Set conduit depth/cover to verify minimum (${need} mm for ${p.conduitLocation || "Footpath"}).`);
      else if (d < need)
        down("red", `Cover ${d} mm is below ${need} mm minimum for ${p.conduitLocation || "Footpath"}.`);
      else
        msgs.push(`Cover ${d} mm meets ${need} mm minimum for ${p.conduitLocation || "Footpath"}.`);
      break;
    }
    case "splice":
    case "tray": {
      if (s.splice?.method)
        msgs.push(`Must be ${s.splice.method}; splice loss ≤ ${s.splice.maxLossDb} dB (≤ ${s.splice.maxAvg1550Db} dB avg @1550).`);
      if (c.kind === "splice" && s.splice?.approved?.length) {
        const m = s.splice.approved.find((a) => (a.partNo || a.model) === p.partNo || a.model === p.equipment);
        if (m) {
          msgs.push(`${m.model} — ${m.note}`);
          const fc = parseInt(p.fibreCount, 10);
          if (Number.isFinite(fc) && fc > m.maxSingleFusion)
            down("red", `${fc} cores exceed ${m.model} single-fusion capacity (${m.maxSingleFusion}).`);
        } else if (p.partNo) {
          down("yellow", `Closure ${p.partNo} not in the approved list — verify capacity/seal rating.`);
        }
      }
      break;
    }
    case "pit":
    case "demarc": {
      const ap = s.pit.approved?.find((a) => a.name === p.pitSize);
      if (ap) msgs.push(`${ap.name} (${ap.dims} mm, part ${ap.partNo}) — ${ap.role}.`);
      else if (s.pit.accepted?.length && p.pitSize && !s.pit.accepted.includes(p.pitSize))
        down("yellow", `Pit ${p.pitSize} not in accepted set (${s.pit.accepted.join("/")}) — verify.`);
      if (p.pitMaterial)
        msgs.push(`${p.pitMaterial} pit` + (p.lidQty ? `, ${p.lidQty}× ${p.lidType || "lid"}` : "") + (p.pitWeightKg ? `, ${p.pitWeightKg} kg` : "") + ".");
      break;
    }
    default:
      return { status: "na", messages: ["No compliance rule for this item."] };
  }

  const lf = labelFmtFor(c.kind);
  if (lf && lf.regex && p.ref && !new RegExp(lf.regex).test(p.ref))
    down("yellow", `Ref "${p.ref}" does not match required label format ${lf.format}.`);

  if (s.unverified && worst === "green") worst = "yellow";
  if (!msgs.length) msgs.push("Meets the selected standard.");
  return { status: worst, messages: msgs };
}

function equipmentOptions(kind) {
  const s = curStd();
  if (!s) return [];
  if (kind === "cable")
    return (s.fibre.approvedCables || []).map((a) => ({
      label: `${a.partNo} — ${a.cores}F ${a.construction}`,
      apply: (p) => { p.partNo = a.partNo; p.fibreCount = a.cores; p.fibreType = s.fibre.requiredType; },
    }));
  if (kind === "patch")
    return (s.ftp.approved || []).map((a) => ({
      label: `${a.partNo} — ${a.supplier} ${a.ports}P`,
      apply: (p) => { p.partNo = a.partNo; p.fibreCount = a.ports; p.connector = s.connector.required; p.polish = s.connector.requiredPolish; },
    }));
  if (kind === "splice")
    return (s.splice?.approved || []).map((a) => ({
      label: `${a.model} — ≤${a.maxSingleFusion} single-fusion`,
      apply: (p) => { p.partNo = a.partNo || a.model; p.equipment = a.model; },
    }));
  if (kind === "pit" || kind === "demarc")
    return (s.pit.approved || []).map((a) => ({
      label: `${a.name} — ${a.dims} (part ${a.partNo})`,
      apply: (p) => {
        p.pitSize = a.name;
        p.partNo = a.partNo;
        p.pitMaterial = "Plastic";
        p.lidType = "Composite Class B";
        p.lidQty = a.name === "P8" ? 2 : 1;
      },
    }));
  return [];
}

function applyStandardRef(c) {
  const lf = labelFmtFor(c.kind);
  if (!lf || !lf.format) return;
  const digits = String(c.props.ref || "").replace(/\D/g, "");
  if (c.kind === "pit" || c.kind === "demarc")
    c.props.ref = "APL-PT-" + digits.padStart(8, "0").slice(-8);
  else if (c.kind === "patch")
    c.props.ref = "APL-TP-" + (String(c.props.ref || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "00000000").padStart(8, "0").slice(-8);
}

function buildPalette() {
  const pal = $("palette");
  pal.innerHTML = "";
  const disc = dsheet()?.discipline || "blank";
  const all = $("f-allcomp")?.checked;
  const allowed = DISCIPLINES[disc]?.kinds || [];
  const kinds = all || !allowed.length ? ORDER : ORDER.filter((k) => allowed.includes(k));
  for (const kind of kinds) {
    const b = document.createElement("button");
    b.textContent = CATALOG[kind].name;
    b.dataset.kind = kind;
    b.addEventListener("click", () => {
      clearPaletteActive();
      b.classList.add("active");
      placeKind = kind;
      setTool("place");
    });
    pal.appendChild(b);
  }
}

function renderInspector() {
  const body = $("insp-body");
  const ds = current ? dsheet() : null;
  const mk = (labelText, input) => {
    const l = document.createElement("label");
    l.textContent = labelText;
    l.appendChild(input);
    return l;
  };

  if (selectedLid && ds) {
    const lk = ds.links.find((l) => l.id === selectedLid);
    if (lk) return renderLinkInspector(body, lk, mk);
  }

  const c = ds ? ds.components.find((x) => x.id === selectedCid) : null;
  if (!c) {
    body.innerHTML =
      '<p class="muted tiny">Nothing selected. Click a component or a run with the Select tool.</p>';
    return;
  }
  body.innerHTML = "";
  const kindP = document.createElement("p");
  kindP.className = "insp-kind";
  kindP.textContent = CATALOG[c.kind].name;
  body.appendChild(kindP);

  const onEdit = () => { markDirty(); render(); };
  const refreshCompliance = () => {
    const r = assess(c);
    chip.className = "chip " + r.status;
    chip.textContent =
      { green: "✓ Meets standard", yellow: "⚠ Verify", red: "✗ Not compatible", na: "— No rule" }[r.status];
    ul.innerHTML = "";
    for (const m of r.messages) {
      const li = document.createElement("li");
      li.textContent = m;
      ul.appendChild(li);
    }
  };

  const chip = document.createElement("span");
  body.appendChild(chip);
  const ul = document.createElement("ul");
  ul.className = "compliance-msgs";
  body.appendChild(ul);

  const eqOpts = equipmentOptions(c.kind);
  if (eqOpts.length) {
    const sel = document.createElement("select");
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = c.props.partNo ? `Current: ${c.props.partNo}` : "— pick approved equipment —";
    sel.appendChild(blank);
    eqOpts.forEach((o, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => {
      const o = eqOpts[Number(sel.value)];
      if (o) { o.apply(c.props); markDirty(); render(); renderInspector(); }
    });
    body.appendChild(mk("Equipment (approved)", sel));
  }
  if (c.props.partNo) {
    const pn = document.createElement("p");
    pn.className = "label-hint";
    pn.textContent = "Part No: " + c.props.partNo;
    body.appendChild(pn);
  }
  refreshCompliance();

  const labelInput = document.createElement("input");
  labelInput.value = c.label || "";
  labelInput.addEventListener("input", () => { c.label = labelInput.value; onEdit(); });
  body.appendChild(mk("Label", labelInput));

  const dimRow = document.createElement("div");
  dimRow.className = "row";
  for (const dim of ["w", "h"]) {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "2";
    inp.value = c[dim];
    inp.addEventListener("input", () => {
      const v = parseFloat(inp.value);
      if (v > 0) { c[dim] = v; onEdit(); }
    });
    dimRow.appendChild(mk(dim === "w" ? "Width (mm)" : "Height (mm)", inp));
  }
  body.appendChild(dimRow);

  for (const key of KIND_FIELDS[c.kind] || []) {
    const meta = FIELD_META[key];
    let inp;
    if (meta.type === "select") {
      inp = document.createElement("select");
      for (const o of meta.opts) {
        const opt = document.createElement("option");
        opt.value = String(o);
        opt.textContent = String(o);
        inp.appendChild(opt);
      }
      inp.value = String(c.props[key] ?? "");
    } else {
      inp = document.createElement("input");
      inp.type = meta.type === "number" ? "number" : "text";
      inp.value = c.props[key] ?? "";
    }
    inp.addEventListener("input", () => {
      let v = inp.value;
      if (meta.type === "number") v = v === "" ? "" : parseFloat(v);
      else if (key === "fibreCount") v = parseInt(v, 10);
      c.props[key] = v;
      onEdit();
      refreshCompliance();
    });
    body.appendChild(mk(meta.label, inp));
  }

  const lf = labelFmtFor(c.kind);
  if (lf && lf.format) {
    const hint = document.createElement("p");
    hint.className = "label-hint";
    hint.textContent = `Required label format: ${lf.format}`;
    body.appendChild(hint);
  }

  const actions = document.createElement("div");
  actions.className = "insp-actions";
  const mkBtn = (txt, fn) => {
    const btn = document.createElement("button");
    btn.className = "ghost small";
    btn.textContent = txt;
    btn.addEventListener("click", fn);
    return btn;
  };
  if (lf && lf.format)
    actions.appendChild(mkBtn("Apply standard ref", () => {
      applyStandardRef(c);
      markDirty();
      render();
      renderInspector();
    }));
  actions.appendChild(mkBtn("I/O table →", () => {
    showView("tables");
    const t = document.getElementById("io-" + c.id);
    if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  actions.appendChild(mkBtn("Bring to front", () => reorderComponent(c, "front")));
  actions.appendChild(mkBtn("Send to back", () => reorderComponent(c, "back")));
  actions.appendChild(mkBtn("Delete", deleteSelected));
  body.appendChild(actions);
}

function reorderComponent(c, where) {
  const arr = dsheet().components;
  const i = arr.indexOf(c);
  if (i === -1) return;
  arr.splice(i, 1);
  if (where === "front") arr.push(c);
  else arr.unshift(c);
  markDirty();
  render();
}

function renderLinkInspector(body, lk, mk) {
  body.innerHTML = "";
  const a = compById(lk.aId);
  const b = compById(lk.bId);
  const title = document.createElement("p");
  title.className = "insp-kind";
  title.textContent = (lk.kind === "cable" ? "Cable run" : "Conduit run");
  body.appendChild(title);

  const ep = document.createElement("p");
  ep.className = "io-meta";
  ep.textContent = `${a ? a.label : "?"} → ${b ? b.label : "?"}`;
  body.appendChild(ep);

  const chip = document.createElement("span");
  body.appendChild(chip);
  const ul = document.createElement("ul");
  ul.className = "compliance-msgs";
  body.appendChild(ul);
  const refresh = () => {
    const r = assess({ kind: lk.kind, props: lk.props });
    chip.className = "chip " + r.status;
    chip.textContent =
      { green: "✓ Meets standard", yellow: "⚠ Verify", red: "✗ Not compatible", na: "— No rule" }[r.status];
    ul.innerHTML = "";
    for (const m of r.messages) {
      const li = document.createElement("li");
      li.textContent = m;
      ul.appendChild(li);
    }
  };

  const onEdit = () => { markDirty(); render(); };

  const labelInput = document.createElement("input");
  labelInput.value = lk.label || "";
  labelInput.addEventListener("input", () => { lk.label = labelInput.value; onEdit(); });
  body.appendChild(mk("Label", labelInput));

  const eqOpts = equipmentOptions(lk.kind);
  if (eqOpts.length) {
    const sel = document.createElement("select");
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = lk.props.partNo ? `Current: ${lk.props.partNo}` : "— pick approved equipment —";
    sel.appendChild(blank);
    eqOpts.forEach((o, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => {
      const o = eqOpts[Number(sel.value)];
      if (o) { o.apply(lk.props); markDirty(); render(); renderInspector(); }
    });
    body.appendChild(mk("Equipment (approved)", sel));
  }

  for (const key of KIND_FIELDS[lk.kind] || []) {
    const meta = FIELD_META[key];
    if (!meta) continue;
    let inp;
    if (meta.type === "select") {
      inp = document.createElement("select");
      for (const o of meta.opts) {
        const opt = document.createElement("option");
        opt.value = String(o);
        opt.textContent = String(o);
        inp.appendChild(opt);
      }
      inp.value = String(lk.props[key] ?? "");
    } else {
      inp = document.createElement("input");
      inp.type = meta.type === "number" ? "number" : "text";
      inp.value = lk.props[key] ?? "";
    }
    inp.addEventListener("input", () => {
      let v = inp.value;
      if (meta.type === "number") v = v === "" ? "" : parseFloat(v);
      else if (key === "fibreCount") v = parseInt(v, 10);
      lk.props[key] = v;
      onEdit();
      refresh();
    });
    body.appendChild(mk(meta.label, inp));
  }

  const actions = document.createElement("div");
  actions.className = "insp-actions";
  const mkBtn = (txt, fn) => {
    const x = document.createElement("button");
    x.className = "ghost small";
    x.textContent = txt;
    x.addEventListener("click", fn);
    return x;
  };
  if (lk.kind === "cable")
    actions.appendChild(mkBtn("I/O table →", () => {
      showView("tables");
      const t = document.getElementById("io-" + lk.id);
      if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  actions.appendChild(mkBtn("Delete run", deleteSelected));
  body.appendChild(actions);
  refresh();
}

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
  const svg = buildSvg(dsheet(), { export: true });
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

  const linkLayer = el("g", { "clip-path": `url(#${clipId})` });
  for (const lk of p.links || []) {
    const n = linkNode(lk, opts);
    if (n) linkLayer.appendChild(n);
  }
  svg.appendChild(linkLayer);

  const compLayer = el("g", { "clip-path": `url(#${clipId})` });
  for (const c of p.components || []) compLayer.appendChild(componentNode(c, opts));
  svg.appendChild(compLayer);

  // title block + revision table, bottom-right (scaled with the sheet)
  const tbW = 180, tbH = 46;
  const k = sheetScale(p);
  const tbX = fx + fw - tbW * k;
  const tbY = fy + fh - tbH * k;
  const tg = el("g", { transform: `translate(${tbX} ${tbY}) scale(${k})` });
  drawRevisionTable(tg, p, 0, 0, tbW);
  drawTitleBlock(tg, p, 0, 0, tbW, tbH);
  svg.appendChild(tg);
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

function add(g, name, attrs, text) {
  g.appendChild(el(name, attrs, text));
}
const SW = 0.4;
const SYMBOL = {
  rack(g, w, h) {
    add(g, "rect", { x: 0, y: 0, width: w, height: h, fill: "none", stroke: "#000", "stroke-width": SW });
    add(g, "rect", { x: 0, y: 0, width: w, height: h * 0.16, fill: "#e8e8e8", stroke: "#000", "stroke-width": 0.3 });
    add(g, "text", { x: w / 2, y: h * 0.12, "font-size": 2.6, "text-anchor": "middle", "font-family": "sans-serif" }, "ODF");
    const rows = 5;
    for (let i = 1; i <= rows; i++)
      add(g, "line", { x1: 1, y1: h * 0.16 + (h * 0.84 * i) / (rows + 1), x2: w - 1, y2: h * 0.16 + (h * 0.84 * i) / (rows + 1), stroke: "#000", "stroke-width": 0.25 });
  },
  patch(g, w, h) {
    add(g, "rect", { x: 0, y: 0, width: w, height: h, fill: "none", stroke: "#000", "stroke-width": SW });
    const n = 8, r = Math.min(h * 0.22, w / (n * 2.6));
    for (let i = 0; i < n; i++)
      add(g, "circle", { cx: (w * (i + 0.5)) / n, cy: h / 2, r, fill: "none", stroke: "#000", "stroke-width": 0.3 });
  },
  splice(g, w, h) {
    add(g, "rect", { x: 0, y: 0, width: w, height: h, rx: 2, ry: 2, fill: "none", stroke: "#000", "stroke-width": SW });
    add(g, "line", { x1: -3, y1: h / 2, x2: 0, y2: h / 2, stroke: "#000", "stroke-width": 0.3 });
    add(g, "line", { x1: w, y1: h / 2, x2: w + 3, y2: h / 2, stroke: "#000", "stroke-width": 0.3 });
    add(g, "line", { x1: w * 0.5, y1: 1.5, x2: w * 0.5, y2: h - 1.5, stroke: "#000", "stroke-width": 0.25, "stroke-dasharray": "1 1" });
  },
  tray(g, w, h) {
    add(g, "rect", { x: 0, y: 0, width: w, height: h, fill: "none", stroke: "#000", "stroke-width": SW });
    add(g, "path", { d: `M2 ${h - 1.5} C ${w * 0.3} 1, ${w * 0.7} 1, ${w - 2} ${h - 1.5}`, fill: "none", stroke: "#000", "stroke-width": 0.3 });
  },
  pit(g, w, h) {
    add(g, "rect", { x: 0, y: 0, width: w, height: h, rx: 1.5, ry: 1.5, fill: "none", stroke: "#000", "stroke-width": SW });
    add(g, "rect", { x: 2, y: 2, width: w - 4, height: h - 4, fill: "none", stroke: "#000", "stroke-width": 0.25 });
    add(g, "line", { x1: 2, y1: 2, x2: 5, y2: 5, stroke: "#000", "stroke-width": 0.25 });
    add(g, "line", { x1: w - 2, y1: 2, x2: w - 5, y2: 5, stroke: "#000", "stroke-width": 0.25 });
  },
  conduit(g, w, h) {
    add(g, "line", { x1: 0, y1: h * 0.3, x2: w, y2: h * 0.3, stroke: "#000", "stroke-width": 0.35 });
    add(g, "line", { x1: 0, y1: h * 0.7, x2: w, y2: h * 0.7, stroke: "#000", "stroke-width": 0.35 });
    add(g, "line", { x1: 0, y1: h * 0.3, x2: 0, y2: h * 0.7, stroke: "#000", "stroke-width": 0.3 });
    add(g, "line", { x1: w, y1: h * 0.3, x2: w, y2: h * 0.7, stroke: "#000", "stroke-width": 0.3 });
  },
  cable(g, w, h) {
    add(g, "line", { x1: 0, y1: h / 2, x2: w, y2: h / 2, stroke: "#000", "stroke-width": 0.45 });
    const ticks = Math.max(3, Math.round(w / 8));
    for (let i = 1; i < ticks; i++) {
      const x = (w * i) / ticks;
      add(g, "line", { x1: x, y1: h * 0.2, x2: x, y2: h * 0.8, stroke: "#000", "stroke-width": 0.3 });
    }
  },
  connector(g, w, h, c) {
    const apc = c?.props?.polish === "APC";
    add(g, "line", { x1: 0, y1: h / 2, x2: w * 0.45, y2: h / 2, stroke: "#000", "stroke-width": 0.4 });
    if (apc)
      add(g, "path", { d: `M${w * 0.45} ${h * 0.2} L${w} ${h / 2} L${w * 0.45} ${h * 0.8} Z`, fill: "none", stroke: "#000", "stroke-width": 0.4 });
    else
      add(g, "rect", { x: w * 0.45, y: h * 0.25, width: w * 0.45, height: h * 0.5, fill: "none", stroke: "#000", "stroke-width": 0.4 });
  },
  demarc(g, w, h) {
    add(g, "rect", { x: 0, y: 0, width: w, height: h, rx: 1.5, ry: 1.5, fill: "none", stroke: "#000", "stroke-width": 0.5 });
    add(g, "rect", { x: -1.5, y: -1.5, width: w + 3, height: h + 3, fill: "none", stroke: "#000", "stroke-width": 0.3, "stroke-dasharray": "1.5 1.2" });
    add(g, "path", { d: `M${w / 2} ${h * 0.28} L${w * 0.66} ${h / 2} L${w / 2} ${h * 0.72} L${w * 0.34} ${h / 2} Z`, fill: "#000" });
    add(g, "text", { x: w / 2, y: h - 2.5, "font-size": 2.6, "text-anchor": "middle", "font-family": "sans-serif", fill: "#fff" }, "DP");
  },
};

function componentNode(c, opts) {
  const g = el("g", { transform: `translate(${c.x} ${c.y})` });
  add(g, "rect", { x: -2, y: -2, width: c.w + 4, height: c.h + 4, fill: "transparent" });
  (SYMBOL[c.kind] || SYMBOL.rack)(g, c.w, c.h, c);
  if (c.label)
    add(g, "text", { x: c.w / 2, y: c.h + 3.2, "font-size": 2.8, "font-weight": 600, "text-anchor": "middle", "font-family": "sans-serif" }, c.label);
  const spec = specLine(c);
  if (spec)
    add(g, "text", { x: c.w / 2, y: c.h + 6, "font-size": 2.3, "text-anchor": "middle", "font-family": "sans-serif", fill: "#555" }, spec);
  if (c.props && c.props.ref)
    add(g, "text", { x: c.w / 2, y: c.h + 9, "font-size": 2.3, "text-anchor": "middle", "font-family": "monospace", fill: "#000" }, c.props.ref);
  const r = assess(c);
  if (r.status !== "na") {
    const col = { green: "#16a34a", yellow: "#eab308", red: "#dc2626" }[r.status];
    add(g, "circle", { cx: c.w - 1, cy: 1, r: 1.6, fill: col, stroke: "#fff", "stroke-width": 0.3 });
  }
  if (!opts.export) {
    g.dataset.cid = c.id;
    g.style.cursor = tool === "select" ? "move" : "default";
    if (tool === "link" && linkKind && c.id !== pendingA) {
      const ok = linkAllows(linkKind, c.kind);
      if (ok)
        add(g, "rect", {
          x: -2, y: -2, width: c.w + 4, height: c.h + 4, fill: "none",
          stroke: "#16a34a", "stroke-width": 0.6, "stroke-dasharray": "2 1.5",
        });
      else g.setAttribute("opacity", "0.35");
    }
    if (c.id === selectedCid)
      add(g, "rect", {
        class: "cmp-sel", x: -2, y: -2, width: c.w + 4, height: c.h + 4,
        fill: "none", stroke: "#2563eb", "stroke-width": 0.5, "stroke-dasharray": "2 1.5",
      });
  }
  return g;
}

function endConn(comp) {
  const s = curStd();
  return {
    conn: comp?.props?.connector || (s && s.connector && s.connector.required) || "SC",
    pol: comp?.props?.polish || (s && s.connector && s.connector.requiredPolish) || "APC",
  };
}
function connGlyph(parent, x, y, ux, uy, conn, pol, sc) {
  const ang = (Math.atan2(uy, ux) * 180) / Math.PI;
  const grp = el("g", { transform: `translate(${x} ${y}) rotate(${ang})` });
  const col = pol === "APC" ? "#1e8b3a" : "#1f4ed8";
  grp.appendChild(el("rect", { x: -2.4 * sc, y: -1.6 * sc, width: 3 * sc, height: 3.2 * sc, fill: "#fff", stroke: "#000", "stroke-width": 0.3 }));
  if (pol === "APC")
    grp.appendChild(el("path", { d: `M${0.6 * sc} ${-1.4 * sc} L${2.4 * sc} 0 L${0.6 * sc} ${1.4 * sc} Z`, fill: col }));
  else
    grp.appendChild(el("rect", { x: 0.6 * sc, y: -1.2 * sc, width: 1.8 * sc, height: 2.4 * sc, fill: col }));
  grp.appendChild(el("text", { x: -0.9 * sc, y: -2.4 * sc, "font-size": 2.1, "text-anchor": "middle", "font-family": "sans-serif", fill: "#333" }, conn));
  parent.appendChild(grp);
}

function linkNode(lk, opts) {
  const a = compById(lk.aId);
  const b = compById(lk.bId);
  if (!a || !b) return null; // endpoint deleted
  const pa = compCentre(a);
  const pb = compCentre(b);
  const sel = !opts.export && lk.id === selectedLid;
  const g = el("g", {});
  const colour = sel ? "#2563eb" : lk.kind === "conduit" ? "#6b7280" : "#000";
  if (lk.kind === "conduit") {
    g.appendChild(el("line", { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, stroke: colour, "stroke-width": sel ? 1.4 : 1.1, "stroke-dasharray": "3 2" }));
  } else {
    g.appendChild(el("line", { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, stroke: colour, "stroke-width": sel ? 1.0 : 0.6 }));
    // connector glyphs where the cable meets each endpoint
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const ux = (pb.x - pa.x) / len, uy = (pb.y - pa.y) / len;
    const sc = 0.9 * sheetScale(dsheet());
    const offA = Math.min(a.w, a.h) / 2 + 3;
    const offB = Math.min(b.w, b.h) / 2 + 3;
    const ca = endConn(a), cb = endConn(b);
    connGlyph(g, pa.x + ux * offA, pa.y + uy * offA, ux, uy, ca.conn, ca.pol, sc);
    connGlyph(g, pb.x - ux * offB, pb.y - uy * offB, -ux, -uy, cb.conn, cb.pol, sc);
  }
  const mx = (pa.x + pb.x) / 2;
  const my = (pa.y + pb.y) / 2;
  const lab =
    lk.kind === "cable"
      ? `${lk.props.fibreCount || "?"}F` + (lk.props.lengthM ? ` · ${lk.props.lengthM} m` : "")
      : `${lk.props.conduitDia || ""}` + (lk.props.lengthM ? ` · ${lk.props.lengthM} m` : "");
  g.appendChild(el("rect", { x: mx - 13, y: my - 4.5, width: 26, height: 6, fill: "#fff", stroke: "none", opacity: 0.85 }));
  g.appendChild(el("text", { x: mx, y: my, "font-size": 3, "text-anchor": "middle", "font-family": "sans-serif", fill: colour }, lab));
  const r = assess({ kind: lk.kind, props: lk.props });
  if (r.status !== "na") {
    const col = { green: "#16a34a", yellow: "#eab308", red: "#dc2626" }[r.status];
    g.appendChild(el("circle", { cx: mx + 14, cy: my - 1.5, r: 1.6, fill: col, stroke: "#fff", "stroke-width": 0.3 }));
  }
  if (!opts.export) {
    g.dataset.lid = lk.id;
    g.style.cursor = "pointer";
    // wide invisible hit line for easy selection
    g.appendChild(el("line", { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, stroke: "transparent", "stroke-width": 4 }));
  }
  return g;
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
  const showAbn = !t.noAbn && (t.abn || "").trim() !== "";
  if (showAbn) {
    cell(svg, x, y + 26, colA, 8, "ABN", t.abn);
    cell(svg, x, y + 34, colA, h - 34, "", t.address || "");
  } else {
    cell(svg, x, y + 26, colA, h - 26, "", t.address || "");
  }

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
  const a = aSheet();
  if (a && a.type === "cover") {
    host.appendChild(buildCover());
    $("delete-shape-btn").disabled = true;
    return;
  }
  const svg = buildSvg(dsheet());
  host.appendChild(svg);
  attachCanvasHandlers(svg);
  $("delete-shape-btn").disabled = !selectedId && !selectedCid;
}

function buildCover() {
  const pl = current.payload;
  const [W, H] = sheetDims(dsheet());
  const svg = el("svg", { xmlns: SVGNS, viewBox: `0 0 ${W} ${H}`, width: `${W}mm`, height: `${H}mm` });
  const k = Math.min(1100 / W, 760 / H, 4);
  svg.setAttribute("width", `${Math.round(W * k)}`);
  svg.setAttribute("height", `${Math.round(H * k)}`);
  svg.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
  svg.appendChild(el("rect", { x: 12, y: 12, width: W - 24, height: H - 24, fill: "none", stroke: "#000", "stroke-width": 0.7 }));
  const ds = pl.sheets.find((s) => s.type === "drawing");
  const tb = ds ? ds.titleBlock : newTitleBlock();
  if (tb.logo)
    svg.appendChild(el("image", { href: tb.logo, x: W / 2 - 35, y: H * 0.12, width: 70, height: 24, preserveAspectRatio: "xMidYMid meet" }));
  svg.appendChild(el("text", { x: W / 2, y: H * 0.30, "font-size": 11, "font-weight": 700, "text-anchor": "middle", "font-family": "sans-serif" }, pl.projectName || "Untitled project"));
  if (tb.company)
    svg.appendChild(el("text", { x: W / 2, y: H * 0.30 + 8, "font-size": 5, "text-anchor": "middle", "font-family": "sans-serif", fill: "#444" }, tb.company + (tb.noAbn || !tb.abn ? "" : `  ·  ABN ${tb.abn}`)));
  // Drawing register / index
  const ix = W * 0.18, iy = H * 0.42, iw = W * 0.64;
  svg.appendChild(el("text", { x: ix, y: iy - 3, "font-size": 5, "font-weight": 700, "font-family": "sans-serif" }, "DRAWING REGISTER"));
  const cols = [iw * 0.14, iw * 0.56, iw * 0.3];
  const head = ["REF", "SHEET NAME", "TYPE"];
  let hx = ix;
  const rh = 8;
  head.forEach((hh, i) => {
    svg.appendChild(el("rect", { x: hx, y: iy, width: cols[i], height: rh, fill: "#eee", stroke: "#000", "stroke-width": 0.3 }));
    svg.appendChild(el("text", { x: hx + 2, y: iy + 5.4, "font-size": 3.4, "font-weight": 700, "font-family": "sans-serif" }, hh));
    hx += cols[i];
  });
  pl.sheets.forEach((s, r) => {
    const ry = iy + rh * (r + 1);
    let rx = ix;
    const vals = [s.ref || "", s.name || "", s.type === "cover" ? "Cover" : "Drawing"];
    cols.forEach((cw, i) => {
      svg.appendChild(el("rect", { x: rx, y: ry, width: cw, height: rh, fill: "none", stroke: "#000", "stroke-width": 0.25 }));
      svg.appendChild(el("text", { x: rx + 2, y: ry + 5.4, "font-size": 3.4, "font-family": "sans-serif" }, String(vals[i])));
      rx += cw;
    });
  });
  const tbRow = iy + rh * (pl.sheets.length + 1) + 4;
  svg.appendChild(el("text", { x: ix, y: tbRow, "font-size": 3.2, "font-family": "sans-serif", fill: "#555" }, `Standard: ${ds ? ds.standard : "—"}   ·   Date: ${tb.date || ""}   ·   Rev: ${tb.revision || ""}`));
  return svg;
}

function buildSheetTabs() {
  const wrap = $("sheet-tabs");
  wrap.innerHTML = "";
  for (const s of current.payload.sheets) {
    const b = document.createElement("button");
    b.className = s.id === current.payload.activeSheetId ? "active" : "";
    b.innerHTML = `${s.ref || ""} ${s.name || s.type} <span class="stype">${s.type}</span>`;
    b.addEventListener("click", () => selectSheet(s.id));
    wrap.appendChild(b);
  }
}

function selectSheet(id) {
  current.payload.activeSheetId = id;
  selectedId = null;
  selectedCid = null;
  placeKind = null;
  clearPaletteActive();
  buildSheetTabs();
  fillForm();
  $("f-standard").value = dsheet().standard;
  updateStdNote();
  renderInspector();
  if (activeView === "tables") renderTables();
  else if (activeView === "checks") renderChecks();
  else render();
}

function nextDrawingRef() {
  let max = 0;
  for (const s of current.payload.sheets) {
    const n = parseInt(s.ref, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1).padStart(3, "0");
}

$("add-sheet-btn").addEventListener("click", () => {
  const n = current.payload.sheets.filter((s) => s.type === "drawing").length + 1;
  const d = newDrawingSheet(`Drawing ${n}`, nextDrawingRef());
  d.standard = dsheet().standard;
  current.payload.sheets.push(d);
  markDirty();
  selectSheet(d.id);
});

$("rename-sheet-btn").addEventListener("click", () => {
  const s = aSheet();
  const name = prompt("Sheet name:", s.name || "");
  if (name == null) return;
  s.name = name.trim() || s.name;
  const ref = prompt("Sheet reference:", s.ref || "");
  if (ref != null) s.ref = ref.trim();
  markDirty();
  buildSheetTabs();
  render();
});

$("del-sheet-btn").addEventListener("click", () => {
  const s = aSheet();
  if (s.type === "cover") return alert("The cover sheet can't be deleted.");
  if (current.payload.sheets.filter((x) => x.type === "drawing").length <= 1)
    return alert("At least one drawing sheet is required.");
  if (!confirm(`Delete sheet "${s.name}"?`)) return;
  current.payload.sheets = current.payload.sheets.filter((x) => x.id !== s.id);
  current.payload.activeSheetId = current.payload.sheets.find((x) => x.type === "drawing").id;
  markDirty();
  selectSheet(current.payload.activeSheetId);
});

let activeView = "drawing";
function showView(name) {
  activeView = name;
  $("canvas-wrap").hidden = name !== "drawing";
  $("tables-wrap").hidden = name !== "tables";
  $("checks-wrap").hidden = name !== "checks";
  $("tab-drawing").classList.toggle("active", name === "drawing");
  $("tab-tables").classList.toggle("active", name === "tables");
  $("tab-checks").classList.toggle("active", name === "checks");
  if (name === "drawing") render();
  else if (name === "tables") renderTables();
  else renderChecks();
}
$("tab-drawing").addEventListener("click", () => showView("drawing"));
$("tab-tables").addEventListener("click", () => showView("tables"));
$("tab-checks").addEventListener("click", () => showView("checks"));

// ---------- Validation ----------
function fibreAtten() {
  const s = curStd();
  return (s && s.fibre && s.fibre.maxAttenuation1550) || 0.21;
}
function spliceLoss() {
  const s = curStd();
  return (s && s.splice && s.splice.maxLossDb) || 0.1;
}
function cableRunLoss(lk) {
  const len = parseFloat(lk.props.lengthM) || 0;
  return (len / 1000) * fibreAtten();
}

// BFS over cable links; returns path of component ids or null.
function findPath(ds, fromId, isGoal) {
  const adj = {};
  for (const lk of ds.links) {
    if (lk.kind !== "cable") continue;
    (adj[lk.aId] = adj[lk.aId] || []).push(lk.bId);
    (adj[lk.bId] = adj[lk.bId] || []).push(lk.aId);
  }
  const q = [[fromId]];
  const seen = new Set([fromId]);
  while (q.length) {
    const path = q.shift();
    const last = path[path.length - 1];
    if (isGoal(last) && path.length > 0) return path;
    for (const n of adj[last] || []) {
      if (seen.has(n)) continue;
      seen.add(n);
      q.push([...path, n]);
    }
  }
  return null;
}

function validateSheet(ds) {
  const out = { Completeness: [], Labels: [], Continuity: [], Feasibility: [] };
  const add = (grp, level, msg) => out[grp].push({ level, msg });
  const comps = ds.components || [];
  const links = ds.links || [];
  const byKind = (k) => comps.filter((c) => c.kind === k);

  // Completeness
  if (!current.payload.projectName?.trim()) add("Completeness", "warn", "Project name is empty.");
  const tb = ds.titleBlock || {};
  if (!tb.drawingNumber?.trim()) add("Completeness", "warn", `Sheet "${ds.name}": drawing number is blank.`);
  if (!tb.revision?.trim()) add("Completeness", "warn", `Sheet "${ds.name}": revision is blank.`);
  if (!tb.date) add("Completeness", "warn", `Sheet "${ds.name}": date is blank.`);
  const racks = byKind("rack");
  const demarcs = byKind("demarc");
  racks.length ? add("Completeness", "pass", `${racks.length} rack/ODF present.`)
    : add("Completeness", "fail", "No rack/ODF — the customer end is missing.");
  demarcs.length ? add("Completeness", "pass", `${demarcs.length} demarcation point present.`)
    : add("Completeness", "fail", "No demarcation point — the ISP boundary is missing.");
  const cableRuns = links.filter((l) => l.kind === "cable");
  cableRuns.length ? add("Completeness", "pass", `${cableRuns.length} cable run(s).`)
    : add("Completeness", "warn", "No cable runs drawn.");

  // Labels
  let labelIssues = 0;
  for (const c of comps) {
    const lf = labelFmtFor(c.kind);
    if (!lf || !lf.format) continue;
    if (!c.props.ref) { add("Labels", "warn", `${c.label || c.kind} has no reference (expected ${lf.format}).`); labelIssues++; }
    else if (lf.regex && !new RegExp(lf.regex).test(c.props.ref)) {
      add("Labels", "fail", `${c.label || c.kind} ref "${c.props.ref}" ≠ ${lf.format}.`); labelIssues++;
    }
  }
  if (!labelIssues) add("Labels", "pass", "All standardised labels present and well-formed.");

  // Continuity
  const opticalKinds = ["rack", "patch", "splice", "tray", "demarc"];
  for (const c of comps.filter((x) => opticalKinds.includes(x.kind))) {
    const linked = links.some((l) => l.aId === c.id || l.bId === c.id);
    if (!linked) add("Continuity", "warn", `${c.label || CATALOG[c.kind].name} is not connected to any run.`);
  }
  if (racks.length && demarcs.length) {
    const demarcSet = new Set(demarcs.map((d) => d.id));
    let path = null;
    for (const r of racks) {
      path = findPath(ds, r.id, (id) => demarcSet.has(id));
      if (path) break;
    }
    if (path) {
      const names = path.map((id) => compById(id)?.label || id).join(" → ");
      add("Continuity", "pass", `Continuous cable path: ${names}.`);
      // Feasibility — loss budget along that path
      let loss = 0;
      const segs = [];
      for (let i = 0; i < path.length - 1; i++) {
        const lk = links.find(
          (l) => l.kind === "cable" &&
            ((l.aId === path[i] && l.bId === path[i + 1]) || (l.bId === path[i] && l.aId === path[i + 1]))
        );
        if (lk) { const sl = cableRunLoss(lk); loss += sl; segs.push(`${(parseFloat(lk.props.lengthM) || 0)} m`); }
        const mid = compById(path[i + 1]);
        if (mid && (mid.kind === "splice" || mid.kind === "tray")) loss += spliceLoss();
      }
      loss += 0.3 * 2; // assumed mated connector pair at each terminating end
      const txt = `Estimated end-to-end loss ≈ ${loss.toFixed(2)} dB (cable @ ${fibreAtten()} dB/km + splices ${spliceLoss()} dB + 2× connector 0.3 dB).`;
      if (loss > 5) add("Feasibility", "fail", txt + " Exceeds a typical 5 dB ceiling.");
      else if (loss > 3) add("Feasibility", "warn", txt + " Above a 3 dB guideline — confirm against agreed budget.");
      else add("Feasibility", "pass", txt);
    } else {
      add("Continuity", "fail", "No continuous cable path from a rack/ODF to a demarcation point.");
    }
  }

  // Feasibility — per-run + standards compliance
  for (const lk of cableRuns) {
    if (!lk.props.lengthM) add("Feasibility", "warn", `${lk.label}: length not set — loss can't be estimated.`);
    const r = assess({ kind: lk.kind, props: lk.props });
    if (r.status === "red") add("Feasibility", "fail", `${lk.label}: ${r.messages[0]}`);
  }
  for (const c of comps) {
    const r = assess(c);
    if (r.status === "red") add("Feasibility", "fail", `${c.label || CATALOG[c.kind].name}: ${r.messages.find((m) => /exceed|not permitted|below|multimode/i.test(m)) || r.messages[0]}`);
  }
  if (!out.Feasibility.length) add("Feasibility", "pass", "No technical feasibility issues detected.");

  return out;
}

function renderChecks() {
  const host = $("checks-host");
  host.innerHTML = "";
  const ds = current ? dsheet() : null;
  if (!ds) { host.textContent = "No drawing sheet."; return; }
  const res = validateSheet(ds);
  let fails = 0, warns = 0, passes = 0;
  for (const g of Object.values(res))
    for (const it of g) (it.level === "fail" ? fails++ : it.level === "warn" ? warns++ : passes++);

  const sum = document.createElement("p");
  sum.className = "check-summary";
  sum.textContent = `Sheet "${ds.name}" — ${fails} fail · ${warns} warning · ${passes} ok`;
  host.appendChild(sum);

  for (const [grp, items] of Object.entries(res)) {
    if (!items.length) continue;
    const wrap = document.createElement("div");
    wrap.className = "check-group";
    const h = document.createElement("h3");
    h.textContent = grp;
    wrap.appendChild(h);
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "check " + it.level;
      const ic = document.createElement("span");
      ic.className = "ic";
      ic.textContent = it.level === "pass" ? "✓" : it.level === "warn" ? "⚠" : "✗";
      const tx = document.createElement("span");
      tx.textContent = it.msg;
      row.appendChild(ic);
      row.appendChild(tx);
      wrap.appendChild(row);
    }
    host.appendChild(wrap);
  }
}

function ioBlock(host, ent) {
  // ent: { id, title, status, meta, entity, defCount, aDef, bDef }
  const block = document.createElement("div");
  block.className = "io-block";
  block.id = "io-" + ent.id;
  const h = document.createElement("h3");
  h.textContent = ent.title;
  if (ent.status && ent.status !== "na") {
    const b = document.createElement("span");
    b.className = "badge " + ent.status;
    h.appendChild(b);
  }
  block.appendChild(h);
  const meta = document.createElement("p");
  meta.className = "io-meta";
  meta.textContent = ent.meta;
  block.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "io-actions";
  const lbl = document.createElement("label");
  lbl.className = "chk";
  lbl.textContent = "Cores/ports:";
  const num = document.createElement("input");
  num.type = "number";
  num.min = "0";
  num.value = ent.entity.io?.length || 0;
  lbl.appendChild(num);
  actions.appendChild(lbl);
  const syncBtn = document.createElement("button");
  syncBtn.className = "ghost small";
  syncBtn.textContent = `Set to count (${ent.defCount || "—"})`;
  syncBtn.addEventListener("click", () => {
    ensureIo(ent.entity, ent.defCount || 0);
    markDirty();
    renderTables();
  });
  actions.appendChild(syncBtn);
  num.addEventListener("change", () => {
    ensureIo(ent.entity, Math.max(0, parseInt(num.value, 10) || 0));
    markDirty();
    renderTables();
  });
  block.appendChild(actions);

  const rows = ensureIo(ent.entity, ent.entity.io?.length || 0);
  const table = document.createElement("table");
  table.className = "io";
  table.innerHTML =
    "<thead><tr><th>Core</th><th>Tube</th><th>Fibre colour</th><th>A-end</th><th>B-end</th><th>Status</th></tr></thead>";
  const tb = document.createElement("tbody");
  rows.forEach((row, i) => {
    const cc = coreColour(i + 1);
    const tr = document.createElement("tr");
    const tdN = document.createElement("td");
    tdN.textContent = String(i + 1);
    const tdT = document.createElement("td");
    tdT.innerHTML = `${swatchHtml(cc.tubeHex, cc.tubeStripe)}T${cc.tubeNo} ${cc.tubeName}`;
    const tdC = document.createElement("td");
    tdC.innerHTML = `${swatchHtml(cc.hex, cc.stripe)}${cc.name}`;
    tr.appendChild(tdN);
    tr.appendChild(tdT);
    tr.appendChild(tdC);
    for (const key of ["a", "b", "status"]) {
      const td = document.createElement("td");
      const inp = document.createElement("input");
      const placeholder = key === "a" ? ent.aDef : key === "b" ? ent.bDef : "";
      inp.value = row[key] || "";
      if (placeholder) inp.placeholder = placeholder;
      inp.addEventListener("input", () => { row[key] = inp.value; markDirty(); });
      td.appendChild(inp);
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  block.appendChild(table);
  host.appendChild(block);
}

function renderTables() {
  const host = $("tables-host");
  host.innerHTML = "";
  const ds = current ? dsheet() : null;
  const comps = ds?.components || [];
  const links = ds?.links || [];
  const cableLinks = links.filter((l) => l.kind === "cable");
  const intro = document.createElement("p");
  intro.className = "io-meta";
  intro.textContent = "Input / Output connection tables. Core colours follow TIA-598.";
  host.appendChild(intro);
  if (!comps.length && !cableLinks.length) {
    const e = document.createElement("p");
    e.textContent = "No components or cable runs yet.";
    host.appendChild(e);
    return;
  }
  for (const c of comps) {
    const r = assess(c);
    ioBlock(host, {
      id: c.id,
      title: `${c.label || CATALOG[c.kind].name}` + (c.props.ref ? ` — ${c.props.ref}` : ""),
      status: r.status,
      meta: `${CATALOG[c.kind].name} · ${specLine(c)}` + (c.props.partNo ? ` · ${c.props.partNo}` : ""),
      entity: c,
      defCount: ioCoreCount(c),
      aDef: "",
      bDef: "",
    });
  }
  for (const lk of cableLinks) {
    const a = compById(lk.aId);
    const b = compById(lk.bId);
    const r = assess({ kind: lk.kind, props: lk.props });
    const aName = a ? a.props.ref || a.label : "?";
    const bName = b ? b.props.ref || b.label : "?";
    ioBlock(host, {
      id: lk.id,
      title: `${lk.label || "Cable run"} (${aName} → ${bName})`,
      status: r.status,
      meta: `Cable run · ${lk.props.fibreCount || "?"}F ${lk.props.fibreType || ""}` +
        (lk.props.lengthM ? ` · ${lk.props.lengthM} m` : ""),
      entity: lk,
      defCount: parseInt(lk.props.fibreCount, 10) || 0,
      aDef: aName,
      bDef: bName,
    });
  }
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
  $("delete-shape-btn").disabled = !selectedId && !selectedCid;
}

function highlightComponent(svg) {
  svg.querySelectorAll(".cmp-sel").forEach((n) => n.remove());
  if (!selectedCid) return;
  const g = svg.querySelector(`[data-cid="${selectedCid}"]`);
  const c = dsheet().components.find((x) => x.id === selectedCid);
  if (!g || !c) return;
  g.appendChild(el("rect", {
    class: "cmp-sel", x: -2, y: -2, width: c.w + 4, height: c.h + 4,
    fill: "none", stroke: "#2563eb", "stroke-width": 0.5, "stroke-dasharray": "2 1.5",
  }));
}

function attachCanvasHandlers(svg) {
  let draft = null;
  let moving = null;

  svg.addEventListener("pointerdown", (e) => {
    const { x, y } = svgPoint(svg, e);

    if (tool === "place" && placeKind) {
      const c = newComponent(placeKind, x, y);
      dsheet().components.push(c);
      selectedCid = c.id;
      selectedId = null;
      placeKind = null;
      clearPaletteActive();
      setTool("select");
      markDirty();
      renderInspector();
      render();
      return;
    }

    if (tool === "link" && linkKind) {
      const cg = e.target.closest && e.target.closest("[data-cid]");
      let comp = cg ? compById(cg.dataset.cid) : null;
      if (!comp || !linkAllows(linkKind, comp.kind)) {
        const snapped = nearestValidComponent(linkKind, x, y, pendingA);
        if (snapped) comp = snapped;
      }
      if (!comp) {
        $("link-hint").textContent = `No valid ${linkKind} endpoint near here.`;
        return;
      }
      if (!linkAllows(linkKind, comp.kind)) {
        $("link-hint").textContent =
          `A ${linkKind} run can't connect to ${CATALOG[comp.kind].name}. Valid: ${CONNECT_RULES[linkKind].map((k) => CATALOG[k].name).join(", ")}.`;
        return;
      }
      if (!pendingA) {
        pendingA = comp.id;
        selectedCid = comp.id;
        selectedId = selectedLid = null;
        $("link-hint").textContent = "Now click the SECOND component (valid ones are outlined green)…";
        render();
        return;
      }
      if (comp.id === pendingA) return;
      const lk = newLink(linkKind, pendingA, comp.id);
      dsheet().links.push(lk);
      pendingA = null;
      linkKind = null;
      selectedLid = lk.id;
      selectedCid = selectedId = null;
      clearPaletteActive();
      setTool("select");
      $("link-hint").textContent = "Run created. Pick a run type to add another.";
      markDirty();
      renderInspector();
      render();
      return;
    }

    if (tool === "select") {
      const lg = e.target.closest && e.target.closest("[data-lid]");
      if (lg) {
        selectedLid = lg.dataset.lid;
        selectedCid = selectedId = null;
        renderInspector();
        render();
        return;
      }
      const cg = e.target.closest && e.target.closest("[data-cid]");
      if (cg) {
        selectedCid = cg.dataset.cid;
        selectedId = null;
        const c = dsheet().components.find((cc) => cc.id === selectedCid);
        moving = { cid: c.id, node: cg, start: { x, y }, origin: { x: c.x, y: c.y } };
        svg.setPointerCapture(e.pointerId);
        applySelectionHighlight(svg);
        highlightComponent(svg);
        renderInspector();
        return;
      }
      const id = e.target?.dataset?.id;
      if (id) {
        selectedId = id;
        selectedCid = null;
        const s = dsheet().shapes.find((sh) => sh.id === id);
        moving = { id, node: e.target, start: { x, y }, origin: JSON.parse(JSON.stringify(s)) };
        svg.setPointerCapture(e.pointerId);
      } else {
        selectedId = null;
        selectedCid = null;
      }
      applySelectionHighlight(svg);
      highlightComponent(svg);
      renderInspector();
      return;
    }
    if (tool === "text") {
      const text = prompt("Text:");
      if (text) {
        dsheet().shapes.push({ id: uid(), type: "text", x, y, text, size: 5 });
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
      if (moving.cid) {
        const c = dsheet().components.find((cc) => cc.id === moving.cid);
        c.x = moving.origin.x + dx;
        c.y = moving.origin.y + dy;
        moving.node.setAttribute("transform", `translate(${c.x} ${c.y})`);
        return;
      }
      const s = dsheet().shapes.find((sh) => sh.id === moving.id);
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
    if (moving) {
      const cid = moving.cid;
      moving = null;
      markDirty();
      if (cid && dockAndConnect(cid)) {
        renderInspector();
        render();
      }
      return;
    }
    if (!draft) return;
    const s = draftToShape(draft);
    draft = null;
    const old = svg.querySelector("#__draft");
    if (old) old.remove();
    if (s) {
      dsheet().shapes.push(s);
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
  await enterApp();
})();
