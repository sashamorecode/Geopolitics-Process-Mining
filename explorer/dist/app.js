import { loadCatalog, computeGraph, HALF_LIFE_DAYS, lagWeight } from "./graph.js";

const $ = (id) => document.getElementById(id);
const icons = {
  network:
    '<path d="m5 12 12-7m-12 7 12 7"/><circle cx="4" cy="12" r="2"/><circle cx="18" cy="4" r="2"/><circle cx="18" cy="20" r="2"/>',
  table:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
  fit: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5"/>',
  arrow: '<path d="M2 12h18m-5-5 5 5-5 5"/>',
};
document
  .querySelectorAll("[data-icon]")
  .forEach(
    (el) =>
      (el.innerHTML =
        '<svg aria-hidden="true" viewBox="0 0 24 24">' +
        icons[el.dataset.icon] +
        "</svg>"),
  );
const option = (value, label) => new Option(label, value);
const defaults = {
  mode: "direct",
  days: 30,
  timeDecay: false,
  halfLifeDays: HALF_LIFE_DAYS,
  normalization: "none",
  denoise: false,
  minWeight: 0,
  limit: 8,
};
let catalog,
  dataset,
  filters,
  config = { ...defaults },
  result,
  selectedNode,
  request = 0,
  zoom = 1,
  panX = 0,
  panY = 0,
  tab = "graph";
const fmt = (number) =>
  Number(number).toLocaleString(undefined, { maximumFractionDigits: 3 });
const weightFormatter = new Intl.NumberFormat(undefined, {
  minimumSignificantDigits: 2, maximumSignificantDigits: 2,
});
const formatWeight = weight => weightFormatter.format(weight);
const settingsKey = "geopolitics-explorer:view-v1";
function rememberView() {
  if (!filters) return;
  try {
    sessionStorage.setItem(settingsKey, JSON.stringify({
      filters, config: {...config, timeDecay: $("timeDecay").checked}, tab,
    }));
  } catch { /* Storage may be disabled in private browsing. */ }
}
function readView() {
  try { return JSON.parse(sessionStorage.getItem(settingsKey)) || {}; }
  catch { return {}; }
}
function selectAvailable(id, value, fallback) {
  const field = $(id);
  field.value = value;
  if (field.selectedIndex < 0) field.value = fallback;
}
function country(code) {
  return dataset.countries.find((c) => c.code === code)?.name || code;
}
function routeCountries() {
  return [...$("chainCountries").querySelectorAll("select")].map(select => select.value);
}
function addCountry(preferred) {
  const used = new Set([$("source").value, $("target").value, ...routeCountries()]);
  const options = dataset.countries;
  const next = [preferred, "GBR", "FRA", ...options.map(c => c.code)]
    .find(code => !used.has(code) && options.some(c => c.code === code));
  if (!next) return;
  const row = document.createElement("div");
  row.className = "chain-stop";
  const label = document.createElement("label");
  const select = document.createElement("select");
  select.autocomplete = "off";
  select.replaceChildren(...options.map(c => option(c.code, c.name)));
  select.value = next;
  label.append("Next country", select);
  row.append(label);
  if (routeCountries().length) {
    const remove = document.createElement("button");
    remove.className = "link";
    remove.textContent = "Remove";
    remove.onclick = () => { row.remove(); refresh(); };
    row.append(remove);
  }
  $("chainCountries").append(row);
}
function syncRouteControls() {
  $("chainControls").hidden = config.mode !== "chain";
  $("bothLabel").hidden = config.mode !== "reaction";
  if (config.mode === "chain" && !routeCountries().length) addCountry();
}
$("addCountry").onclick = () => { addCountry(); refresh(); };
$("chainCountries").onchange = refresh;
$("bothDirections").onchange = refresh;
$("closeChain").onchange = refresh;

function selectDataset(saved = {}) {
  dataset = catalog.datasets.find((d) => d.id === $("dataset").value);
  for (const id of ["source", "target"]) {
    $(id).replaceChildren(
      ...dataset.countries
        .map((c) => option(c.code, c.name))
        .sort((a, b) => a.text.localeCompare(b.text)),
    );
    selectAvailable(id, saved[id], id === "source" ? dataset.defaultSource : dataset.defaultTarget);
  }
  for (const id of ["start", "end"]) {
    $(id).replaceChildren(
      ...Array.from({ length: dataset.maxYear - dataset.minYear + 1 }, (_, i) =>
        option(dataset.minYear + i, dataset.minYear + i),
      ),
    );
  }
  const firstYear = dataset.maxYear < 2000 ? dataset.minYear : Math.max(dataset.minYear, 2000);
  selectAvailable("start", saved.startYear, firstYear);
  selectAvailable("end", saved.endYear, dataset.maxYear);
  if (+$("end").value < +$("start").value) $("end").value = $("start").value;
  $("citation").textContent = dataset.description;
  $("sourceLink").href = dataset.sourceUrl;
  $("chainCountries").replaceChildren();
  if (Array.isArray(saved.nextCountries)) {
    for (const code of saved.nextCountries) addCountry(code);
  }
  syncRouteControls();
  const selected = Array.isArray(saved.actions) ? new Set(saved.actions) : null;
  for (const input of $("choices").querySelectorAll("input")) {
    input.checked = !selected || selected.has(+input.value);
  }
  refresh();
}
function setActions(checked) {
  $("choices")
    .querySelectorAll("input")
    .forEach((input) => (input.checked = checked));
  refresh();
}
function refresh() {
  if (!dataset) return;
  filters = {
    dataset: dataset.id,
    nextCountries: routeCountries(),
    closeChain: $("closeChain").checked,
    bothDirections: $("bothDirections").checked,
    source: $("source").value,
    target: $("target").value,
    startYear: +$("start").value,
    endYear: +$("end").value,
    actions: [...$("choices").querySelectorAll("input:checked")].map((input) =>
      Number(input.value),
    ),
  };
  rememberView();
  run();
}
async function run() {
  const token = ++request;
  const route = [filters.source, filters.target];
  if (config.mode === "chain") route.push(...filters.nextCountries);
  const reciprocal = config.mode === "reaction" && filters.bothDirections;
  if ((config.mode === "reaction" && !reciprocal) || (config.mode === "chain" && filters.closeChain)) route.push(filters.source);
  $("pair").textContent = route.map(country).join(reciprocal ? " ↔ " : " → ");
  $("metadata").textContent =
    dataset.name + " · " + filters.startYear + "–" + filters.endYear;
  result = null;
  $("nodeDetails").hidden = true;
  $("nodeTables").replaceChildren();
  $("network").replaceChildren();
  $("inspection").hidden = true;
  $("summary").textContent = "";
  $("status").hidden = false;
  $("status").textContent = "Loading graph…";
  $("tableWrap").textContent = "Loading transitions…";
  try {
    const next = await computeGraph({ ...filters, ...config });
    if (token !== request) return;
    result = next;
    zoom = 1;
    panX = 0;
    panY = 0;
    $("metadata").textContent =
      dataset.name +
      " · " +
      filters.startYear +
      "–" +
      filters.endYear +
      " · " +
      fmt(result.events) +
      " events";
    if (selectedNode) {
      const current = result.nodes.find(n => n.id === selectedNode.id &&
        n.from === selectedNode.from && n.to === selectedNode.to);
      if (current) {
        populateDetails(current);
        $("nodeDetails").hidden = false;
      }
      else closeDetails();
    }
    render();
    makeTable();
  } catch (error) {
    if (token === request) {
      closeDetails();
      $("status").textContent = "Unable to load graph. " + error.message;
      $("tableWrap").textContent = $("status").textContent;
    }
  }
}
const modeNotes = {
  direct: "Links each event to the next selected event in the same direction, regardless of the time between them. The time window is unused.",
  eventual: "Links an event to every later selected event in the same direction within the time window. Same-day events follow their order in the dataset.",
  reaction: "Links an action to responses in the opposite country direction, starting the next day and ending on the last day of the window. Both directions also counts responses to the other country’s actions.",
  chain: "Matches events on consecutive legs of your route, starting the next day and ending on the last day of the window. Close the loop to include the return leg. Each arrow counts matches for its own pair of legs.",
};
const weightNotes = {
  none: "Weight is the number of matching event pairs.",
  source: "Weight is the share of the source action’s outgoing transitions. A weight of 0.1 means 10% of its outgoing transitions.",
  target: "Weight is the share of the target action’s incoming transitions. A weight of 0.1 means 10% of its incoming transitions.",
};
// Use the same contextual description for pointer, keyboard, and touch.
const helpTip = $("helpTip");
let helpAnchor;
function showHelp(anchor) {
  helpAnchor = anchor;
  helpTip.textContent = $(anchor.getAttribute("aria-describedby")).textContent;
  if (!helpTip.matches(":popover-open")) helpTip.showPopover();
  const box = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(box.left, innerWidth - helpTip.offsetWidth - 8));
  const top = box.bottom + helpTip.offsetHeight + 8 <= innerHeight
    ? box.bottom + 4 : Math.max(4, box.top - helpTip.offsetHeight - 4);
  helpTip.style.left = left + "px";
  helpTip.style.top = top + "px";
}
function hideHelp() {
  helpAnchor = null;
  if (helpTip.matches(":popover-open")) helpTip.hidePopover();
}
for (const anchor of document.querySelectorAll("[aria-describedby]")) {
  const area = anchor.closest("label") || anchor;
  area.addEventListener("pointerenter", e => { if (e.pointerType !== "touch") showHelp(anchor); });
  area.addEventListener("pointerleave", e => {
    if (helpAnchor === anchor && e.relatedTarget !== helpTip && document.activeElement !== anchor) hideHelp();
  });
  anchor.addEventListener("focus", () => showHelp(anchor));
  anchor.addEventListener("blur", () => { if (helpAnchor === anchor) hideHelp(); });
  if (anchor.matches(".help-trigger")) anchor.addEventListener("click", () => showHelp(anchor));
}
helpTip.addEventListener("pointerleave", e => {
  if (!helpAnchor?.contains(e.relatedTarget) && document.activeElement !== helpAnchor) hideHelp();
});
document.addEventListener("pointerdown", e => {
  if (helpAnchor && !helpAnchor.contains(e.target) && !helpTip.contains(e.target)) hideHelp();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && helpAnchor) {
    e.preventDefault();
    hideHelp();
  }
});
document.addEventListener("scroll", hideHelp, true);
window.addEventListener("resize", hideHelp);

function drawLagCurve() {
  $("decayControl").hidden = config.mode === "direct";
  $("halfLifeControl").hidden = !config.timeDecay;
  if ($("decayControl").hidden) return;
  const start = config.mode === "eventual" ? 0 : 1;
  const cutoff = config.days;
  const end = config.timeDecay
    ? Math.max(cutoff, Math.min(Number.MAX_VALUE, 2 * config.halfLifeDays)) : cutoff;
  const contribution = day => config.timeDecay ? lagWeight(day, config.halfLifeDays) : 1;
  const x = day => end === start ? 36 : 36 + 276 * ((day - start) / (end - start));
  function curvePoints(from, to) {
    if (!config.timeDecay) return [[x(from), 8], [x(to), 8]].join(" ");
    // Beyond 16 half-lives the remaining falloff is less than a pixel.
    const bendEnd = Math.min(to, from + 16 * config.halfLifeDays);
    const sample = Array.from({length: 101}, (_, i) => from + (bendEnd - from) * (i / 100));
    if (from < config.halfLifeDays && config.halfLifeDays < to) sample.push(config.halfLifeDays);
    sample.push(to);
    return sample.sort((a, b) => a - b).map(day => [x(day), 52 - 44 * contribution(day)]).join(" ");
  }
  $("lagLine").setAttribute("points", curvePoints(start, cutoff));
  const extended = end > cutoff;
  $("lagTail").setAttribute("points", extended ? curvePoints(cutoff, end) : "");
  $("windowMark").style.display = extended ? "" : "none";
  if (extended) {
    $("windowMark").setAttribute("x1", x(cutoff));
    $("windowMark").setAttribute("x2", x(cutoff));
  }
  $("lagWindowNote").hidden = !extended;
  $("lagWindowNote").textContent = extended ? `Dashed curve beyond the ${cutoff}-day matching window` : "";
  const showHalf = config.timeDecay && config.halfLifeDays >= start && config.halfLifeDays <= end;
  $("halfMark").style.display = showHalf ? "" : "none";
  if (showHalf) $("halfMark").setAttribute("cx", x(config.halfLifeDays));
  $("firstLag").textContent = "Day " + start;
  $("lastLag").textContent = end === start ? "" : "Day " + end;
  $("lagCaption").textContent = config.timeDecay
    ? `Pair weight · ${config.halfLifeDays}-day half-life` : "Pair weight · equal across the window";
  $("lagDescription").textContent = `Day ${start} contributes ${formatWeight(contribution(start))}. Day ${cutoff} contributes ${formatWeight(contribution(cutoff))}. Later events are excluded.` +
    (extended ? ` The dashed curve reaches ${formatWeight(contribution(end))} at day ${end}.` : "");
}

function weightExplanation() {
  if (!config.timeDecay) return weightNotes[config.normalization];
  if (config.normalization === "none") return "Weight sums the time-decayed contributions of matching pairs.";
  return config.normalization === "source"
    ? "Weight is the share of the source action’s total time-decayed outgoing weight."
    : "Weight is the share of the target action’s total time-decayed incoming weight.";
}

function explainSettings() {
  drawLagCurve();
  $("norm").options[0].text = config.timeDecay ? "Weighted sum" : "Raw counts";
  $("modeHelp").textContent = modeNotes[config.mode];
  $("weightHelp").textContent = weightExplanation() + " Minimum weight hides edges below the threshold.";
  $("settingsHelp").textContent = [modeNotes[config.mode], $("weightHelp").textContent,
    $("denoiseHelp").textContent].join(" ");
  if (helpAnchor) showHelp(helpAnchor);
}
function updateConfig(redraw = true) {
  $("days").disabled = $("mode").value === "direct";
  config = {
    mode: $("mode").value,
    days: config.days,
    halfLifeDays: config.halfLifeDays,
    timeDecay: !$("days").disabled && $("timeDecay").checked,
    normalization: $("norm").value,
    minWeight: config.minWeight,
    limit: +$("limit").value,
    denoise: $("denoise").checked,
  };
  $("limitValue").value = config.limit;
  explainSettings();
  if (redraw) {
    syncRouteControls();
    refresh();
  }
}
for (const id of ["mode", "norm", "denoise", "timeDecay"])
  $(id).addEventListener("change", updateConfig);
$("limit").oninput = () => {
  config.limit = +$("limit").value;
  $("limitValue").value = $("limit").value;
  rememberView();
  render();
};
const halfLifeInput = $("halfLifeDays");
halfLifeInput.value = defaults.halfLifeDays;
halfLifeInput.addEventListener("input", () => {
  const days = halfLifeInput.valueAsNumber;
  if (!Number.isFinite(days) || days <= 0) {
    halfLifeInput.setCustomValidity("Enter a half-life greater than zero.");
    halfLifeInput.reportValidity();
    return;
  }
  halfLifeInput.setCustomValidity("");
  config.halfLifeDays = days;
  updateConfig();
});
halfLifeInput.addEventListener("blur", () => {
  halfLifeInput.value = config.halfLifeDays;
  halfLifeInput.setCustomValidity("");
});
for (const [id, key] of [["days", "days"], ["weight", "minWeight"]]) {
  const input = $(id);
  input.addEventListener("input", () => {
    if (!input.reportValidity()) return;
    config[key] = input.valueAsNumber;
    updateConfig();
  });
  input.addEventListener("blur", () => { input.value = config[key]; });
}
function stepWeight(step) {
  const field = $("weight");
  const next = Math.max(0, config.minWeight + step);
  if (next === config.minWeight) return;
  field.value = Number(next.toPrecision(15));
  field.dispatchEvent(new Event("input"));
}
$("weightDown").onclick = () => stepWeight(-0.1);
$("weightUp").onclick = () => stepWeight(0.1);
$("weight").onkeydown = event => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    stepWeight(event.key === "ArrowUp" ? 0.1 : -0.1);
  }
};
$("choices").onchange = refresh;
$("all").onclick = () => setActions(true);
$("clear").onclick = () => setActions(false);
for (const id of ["source", "target"]) $(id).onchange = refresh;
$("swap").onclick = () => {
  const s = $("source").value;
  $("source").value = $("target").value;
  $("target").value = s;
  refresh();
};
$("start").onchange = () => {
  if (+$("start").value > +$("end").value) $("end").value = $("start").value;
  refresh();
};
$("end").onchange = () => {
  if (+$("end").value < +$("start").value) $("start").value = $("end").value;
  refresh();
};

$("dataset").onchange = () => selectDataset();
function applySettings(saved = {}, route = {}) {
  selectAvailable("mode", saved.mode, defaults.mode);
  selectAvailable("norm", saved.normalization, defaults.normalization);
  config.days = Number.isInteger(saved.days) && saved.days >= 1 ? saved.days : defaults.days;
  $("days").value = config.days;
  $("weight").value = Number.isFinite(saved.minWeight) && saved.minWeight >= 0 ? saved.minWeight : defaults.minWeight;
  config.minWeight = $("weight").validity.valid ? $("weight").valueAsNumber : defaults.minWeight;
  $("weight").value = config.minWeight;
  $("limit").value = Number.isInteger(saved.limit) ? saved.limit : defaults.limit;
  $("timeDecay").checked = saved.timeDecay === true;
  $("denoise").checked = saved.denoise === true;
  config.halfLifeDays = Number.isFinite(saved.halfLifeDays) && saved.halfLifeDays > 0
    ? saved.halfLifeDays : defaults.halfLifeDays;
  halfLifeInput.value = config.halfLifeDays;
  halfLifeInput.setCustomValidity("");
  $("closeChain").checked = route.closeChain === true;
  $("bothDirections").checked = route.bothDirections === true;
  updateConfig(false);
}
$("reset").onclick = () => {
  applySettings();
  selectDataset();
};
function showTab(value) {
  tab = value;
  rememberView();
  for (const t of ["graph", "table"]) {
    const b = $(t + "Tab");
    b.classList.toggle("active", t === tab);
    b.setAttribute("aria-pressed", String(t === tab));
  }
  $("tableWrap").hidden = tab !== "table";
  $("graphLayout").hidden = tab !== "graph";
  if (result) render();
}
$("graphTab").onclick = () => showTab("graph");
$("tableTab").onclick = () => showTab("table");
const nodeName = (id) =>
  result.nodes.find((n) => n.id === id)?.name || String(id);
function storyCitation(event, phoenix) {
  const citation = document.createElement("div");
  const date = new Date(event.day * 86400000).toISOString().slice(0, 10);
  citation.append(date + " · ");
  if (!event.story) {
    citation.append("No article metadata available");
  } else if (phoenix) {
    const [title, url] = event.story;
    if (url?.startsWith("https://advance.lexis.com/")) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = title || "Open article in Lexis";
      citation.append(link);
    } else citation.append(title || "Article link unavailable");
  } else {
    const [publisher, storyId] = event.story;
    citation.append([publisher, storyId && "Story " + storyId].filter(Boolean).join(" · ") || "Unknown story");
  }
  return citation;
}

function attachSources(row, edge, graph, phoenix) {
  const button = document.createElement("button");
  button.className = "link";
  button.textContent = "View";
  button.setAttribute("aria-label", "View sources for " + nodeName(edge.source) + " → " + nodeName(edge.target));
  button.setAttribute("aria-expanded", "false");
  row.insertCell().append(button);
  let expanded;
  button.onclick = async () => {
    if (expanded) {
      expanded.remove();
      expanded = null;
      button.setAttribute("aria-expanded", "false");
      button.textContent = "View";
      return;
    }
    const details = row.parentNode.insertRow(row.sectionRowIndex + 1);
    expanded = details;
    button.setAttribute("aria-expanded", "true");
    button.textContent = "Hide";
    const content = details.insertCell();
    content.colSpan = row.cells.length;
    content.className = "source-matches";
    content.textContent = "Loading story references…";
    try {
      const matches = await graph.articleMatches(edge);
      if (expanded !== details || !details.isConnected) return;
      const note = document.createElement("p");
      note.textContent = phoenix ? "New York Times articles via Lexis. Access may require a subscription." :
        "ICEWS provides publisher names and story IDs. Article URLs are withheld by the dataset.";
      const list = document.createElement("ol");
      const more = document.createElement("button");
      more.className = "link";
      more.textContent = "Show more matches";
      let shown = 0;
      function nextPage() {
        for (let n = 0; n < 10 && shown < edge.count; n++) {
          const {value, done} = matches.next();
          if (done) break;
          const entry = document.createElement("li");
          for (const [index, event] of value.entries()) {
            const label = document.createElement("strong");
            label.textContent = index === 0 ? "Source event" : "Following event";
            entry.append(label, storyCitation(event, phoenix));
          }
          list.append(entry);
          shown++;
        }
        more.hidden = shown >= edge.count;
      }
      more.onclick = nextPage;
      content.replaceChildren(note, list, more);
      nextPage();
    } catch {
      content.textContent = "Could not load the source records. Close and reopen this row to retry.";
    }
  };
}

function transitionTable(columns, edges, actionColumns) {
  const table = document.createElement("table");
  const header = table.createTHead().insertRow();
  for (const title of [...columns, "Count", "Weight", "Sources"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = title;
    header.append(cell);
  }
  const body = table.createTBody();
  for (const edge of edges) {
    const row = body.insertRow();
    for (const value of [...actionColumns(edge), fmt(edge.count), formatWeight(edge.weight)]) {
      row.insertCell().textContent = value;
    }
    attachSources(row, edge, result, dataset.id === "phoenix");
  }
  return table;
}
function makeTable() {
  $("tableWrap").replaceChildren(result.edges.length
    ? transitionTable(["Source action", "Target action"], result.edges,
        edge => [nodeName(edge.source), nodeName(edge.target)])
    : document.createTextNode("No matching transitions."));
}
function populateDetails(node) {
  selectedNode = node;
  $("nodeTitle").textContent = node.name;
  $("nodeContext").textContent = fmt(node.count) + " events in the selection";
  $("nodeHelp").textContent = "Count is the number of matching event pairs. " + weightExplanation();
  $("nodeTables").replaceChildren();
  for (const incoming of [true, false]) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = incoming ? "Incoming transitions" : "Outgoing transitions";
    section.append(heading);
    const edges = result.edges.filter(edge => (incoming ? edge.target : edge.source) === node.id);
    if (edges.length) {
      const table = transitionTable([incoming ? "From action" : "To action"], edges,
        edge => [nodeName(incoming ? edge.source : edge.target)]);
      table.setAttribute("aria-label", heading.textContent);
      section.append(table);
    } else {
      section.append("No matching transitions.");
    }
    $("nodeTables").append(section);
  }
}
function inspectNode(node) {
  populateDetails(node);
  $("nodeDetails").hidden = false;
  $("nodeDetails").scrollTop = 0;
  $("closeNode").focus({preventScroll: true});
  const layout = $("graphLayout");
  layout.scrollLeft = layout.scrollWidth - layout.clientWidth;
  render();
}
function closeDetails() {
  selectedNode = null;
  $("nodeDetails").hidden = true;
  $("graphLayout").scrollLeft = 0;
}
function dismissDetails() {
  const id = selectedNode?.id;
  closeDetails();
  render();
  $("network").querySelector(`[data-node-id="${id}"]`)?.focus({preventScroll: true});
}
$("closeNode").onclick = dismissDetails;
$("nodeDetails").addEventListener("keydown", e => {
  if (e.key === "Escape" && !helpAnchor) dismissDetails();
});
function inspect(message) {
  $("inspection").replaceChildren(document.createTextNode(message));
  const close = document.createElement("button");
  close.textContent = "×";
  close.setAttribute("aria-label", "Close details");
  close.onclick = () => ($("inspection").hidden = true);
  $("inspection").append(close);
  $("inspection").hidden = false;
}
const ns = "http://www.w3.org/2000/svg";
function svg(tag, attrs, parent) {
  const el = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.append(el);
  return el;
}
function clickable(el, message, open = () => inspect(message)) {
  el.setAttribute("tabindex", "0");
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", message);
  el.onclick = open;
  el.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
  svg("title", {}, el).textContent = message;
}
const shortNames = [
  "",
  "Public statement",
  "Appeal",
  "Intent to cooperate",
  "Consultation",
  "Diplomatic cooperation",
  "Material cooperation",
  "Provide aid",
  "Yield",
  "Investigate",
  "Demand",
  "Disapprove",
  "Reject",
  "Threaten",
  "Protest",
  "Force posture",
  "Reduce relations",
  "Coerce",
  "Assault",
  "Fight",
  "Mass violence",
];
function render() {
  if (!result) return;
  const root = $("network");
  root.replaceChildren();
  const actorView = config.mode === "reaction" || config.mode === "chain";
  let nodes = [...result.nodes]
    .filter((n) => n.count > 0)
    .sort((a, b) => b.count - a.count || a.id - b.id)
    .slice(0, config.limit);
  const legHighlights = new Set();
  if (actorView) {
    // Reserve space for the strongest transition of each observed leg, then fill by weight.
    const byId = new Map(result.nodes.map(n => [n.id, n]));
    const strongest = new Map();
    for (const edge of result.edges) {
      const leg = byId.get(edge.source).from;
      if (!strongest.has(leg)) strongest.set(leg, edge);
    }
    for (const edge of strongest.values()) legHighlights.add(edge);
    const visible = new Set();
    for (const edge of [...strongest.values(), ...result.edges]) {
      const candidates = [edge.source, edge.target].filter(id => !visible.has(id));
      if (visible.size + candidates.length <= config.limit) candidates.forEach(id => visible.add(id));
      if (visible.size >= config.limit) break;
    }
    nodes = [...visible].map(id => byId.get(id)).sort((a, b) => b.count - a.count);
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges = [...result.edges]
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .sort((a, b) => Number(legHighlights.has(b)) - Number(legHighlights.has(a)) || b.weight - a.weight)
    .slice(0, Math.max(9, nodes.length * 2))
    .sort((a, b) => b.weight - a.weight);
  $("summary").textContent =
    tab === "graph"
      ? nodes.length + " actions · " + edges.length + " transitions"
      : result.edges.length + " transitions";
  $("status").hidden = Boolean(nodes.length);
  $("status").textContent = actorView && result.events ? "No reactions match these settings." : "No events match these filters.";
  if (!nodes.length || tab !== "graph") return;
  const width = Math.max(400, root.clientWidth),
    height = Math.max(340, root.clientHeight),
    cx = width / 2,
    cy = height / 2;
  root.setAttribute("viewBox", "0 0 " + width + " " + height);
  const defs = svg("defs", {}, root),
    marker = svg(
      "marker",
      {
        id: "arrowhead",
        viewBox: "0 0 8 8",
        refX: 7,
        refY: 4,
        markerWidth: 7,
        markerHeight: 7,
        orient: "auto",
        markerUnits: "userSpaceOnUse",
      },
      defs,
    );
  svg("path", { d: "M0 0 L8 4 L0 8Z", fill: "#789383" }, marker);
  const g = svg(
    "g",
    {
      transform:
        "translate(" +
        (cx + panX) +
        " " +
        (cy + panY) +
        ") scale(" +
        zoom +
        ") translate(" +
        -cx +
        " " +
        -cy +
        ")",
    },
    root,
  );
  const pos = new Map(),
    max = nodes[0].count;
  nodes.forEach((n, i) => {
    const ring = i === 0 ? 0 : i < 8 ? 1 : 2,
      peers = ring === 1 ? Math.min(nodes.length - 1, 7) : nodes.length - 8;
    const angle =
      -Math.PI * 0.85 +
      (2 * Math.PI * (ring === 1 ? i - 1 : i - 8)) / Math.max(1, peers);
    const spread = nodes.length > 8 && ring === 1 ? 0.58 : 1;
    const x = ring ? cx + Math.cos(angle) * (width * 0.39 - 12) * spread : cx,
      y = ring ? cy + Math.sin(angle) * (height * 0.32) * spread : cy - 7;
    pos.set(n.id, { x, y, r: 11 + Math.sqrt(n.count / max) * 12 });
  });
  const weightPaths = [];
  const occupied = [];
  edges
    .slice()
    .reverse()
    .forEach((e) => {
      const a = pos.get(e.source),
        b = pos.get(e.target);
      let d;
      if (a === b) {
        const { x, y, r } = a;
        d =
          "M" +
          (x - r * 0.65) +
          " " +
          (y - r * 0.78) +
          " C" +
          (x - r * 2.3) +
          " " +
          (y - r * 3.2) +
          " " +
          (x + r * 2.3) +
          " " +
          (y - r * 3.2) +
          " " +
          (x + r * 0.65) +
          " " +
          (y - r * 0.78);
      } else {
        const dx = b.x - a.x,
          dy = b.y - a.y,
          len = Math.hypot(dx, dy) || 1,
          bend = Math.min(33, len * 0.18);
        const qx = (a.x + b.x) / 2 - (dy / len) * bend,
          qy = (a.y + b.y) / 2 + (dx / len) * bend;
        const la = Math.hypot(qx - a.x, qy - a.y) || 1,
          lb = Math.hypot(qx - b.x, qy - b.y) || 1;
        d =
          "M" +
          (a.x + ((qx - a.x) / la) * a.r) +
          " " +
          (a.y + ((qy - a.y) / la) * a.r) +
          " Q" +
          qx +
          " " +
          qy +
          " " +
          (b.x + ((qx - b.x) / lb) * (b.r + 2)) +
          " " +
          (b.y + ((qy - b.y) / lb) * (b.r + 2));
      }
      const hit = svg(
        "path",
        {
          d,
          fill: "none",
          stroke: "transparent",
          "stroke-width": 11,
          class: "edge-hit",
        },
        g,
      );
      weightPaths.push({path: hit, weight: e.weight});
      clickable(
        hit,
        nodeName(e.source) +
          " → " +
          nodeName(e.target) +
          " · " +
          fmt(e.count) +
          " transitions · weight " +
          formatWeight(e.weight),
      );
      svg(
        "path",
        {
          d,
          fill: "none",
          stroke: "#8ca594",
          "stroke-opacity": 0.8,
          "stroke-width":
            0.8 + 2 * Math.sqrt(e.weight / (edges[0]?.weight || 1)),
          "marker-end": "url(#arrowhead)",
          class: "edge",
        },
        g,
      );
    });
  const colors = [
    "#c5dfad",
    "#d0e3d2",
    "#ecdcb6",
    "#bad5c2",
    "#d3dfb9",
    "#d0e2dc",
    "#e6d5ba",
    "#dce7bc",
  ];
  nodes.forEach((n, i) => {
    const { x, y, r } = pos.get(n.id),
      group = svg(
        "g",
        { class: "node", transform: "translate(" + x + " " + y + ")" },
        g,
      );
    svg(
      "circle",
      {
        r,
        fill: colors[i % colors.length],
        stroke: "#73957b",
        "stroke-width": 1.4,
      },
      group,
    );
    const label = svg("text", { "text-anchor": "middle", y: r + 16 }, group);
    const actionName = shortNames[n.action] || n.name;
    label.textContent = actorView ? n.from + " · " + actionName : actionName;
    const half = label.getComputedTextLength() / 2;
    label.setAttribute(
      "x",
      Math.max(half + 5, Math.min(width - half - 5, x)) - x,
    );
    // Reserve the circle and its caption before placing edge weights.
    occupied.push({x: x-r-2, y: y-r-2, width: 2*r+4, height: 2*r+4});
    const caption = label.getBBox();
    occupied.push({x: x+caption.x-2, y: y+caption.y-2, width: caption.width+4, height: caption.height+4});
    group.dataset.nodeId = n.id;
    group.setAttribute("aria-controls", "nodeDetails");
    group.setAttribute("aria-expanded", String(n.id === selectedNode?.id));
    clickable(group, n.name + " · " + fmt(n.count) + " events", () => inspectNode(n));
  });
  // Try positions along each curve, including loops and reciprocal edges.
  for (const {path, weight} of weightPaths.reverse()) {
    const length = path.getTotalLength();
    const label = svg("text", {class: "edge-weight", "text-anchor": "middle",
      "dominant-baseline": "central", "aria-hidden": "true"}, g);
    label.textContent = formatWeight(weight);
    const bounds = label.getBBox();
    let best, bestOverlap = Infinity;
    for (const fraction of [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85]) {
      const point = path.getPointAtLength(length * fraction);
      const box = {x: point.x + bounds.x - 2, y: point.y + bounds.y - 2,
        width: bounds.width + 4, height: bounds.height + 4};
      const overlap = occupied.reduce((sum, rect) => sum +
        Math.max(0, Math.min(box.x+box.width, rect.x+rect.width) - Math.max(box.x, rect.x)) *
        Math.max(0, Math.min(box.y+box.height, rect.y+rect.height) - Math.max(box.y, rect.y)), 0);
      if (overlap < bestOverlap) { best = {point, box}; bestOverlap = overlap; }
      if (overlap === 0) break;
    }
    label.setAttribute("x", best.point.x);
    label.setAttribute("y", best.point.y);
    occupied.push(best.box);
  }
}
$("plus").onclick = () => {
  zoom = Math.min(2.4, zoom + 0.2);
  render();
};
$("minus").onclick = () => {
  zoom = Math.max(0.5, zoom - 0.2);
  render();
};
$("fit").onclick = () => {
  zoom = 1;
  panX = 0;
  panY = 0;
  render();
};
let drag;
const network = $("network");
network.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target.closest('[role="button"]')) return;
  drag = { x: e.clientX, y: e.clientY, startX: panX, startY: panY };
  network.setPointerCapture(e.pointerId);
});
network.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const scale =
    network.viewBox.baseVal.width / network.getBoundingClientRect().width;
  panX = drag.startX + (e.clientX - drag.x) * scale;
  panY = drag.startY + (e.clientY - drag.y) * scale;
  render();
});
network.addEventListener("lostpointercapture", () => {
  drag = null;
});
new ResizeObserver(() => {
  if (result && tab === "graph") render();
}).observe($("canvas"));
async function init() {
  try {
    catalog = await loadCatalog();
    for (const action of catalog.actions) {
      const label = document.createElement("label");
      label.className = "check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.autocomplete = "off";
      input.value = action.id;
      label.append(input, action.name);
      $("choices").append(label);
    }
    $("dataset").replaceChildren(
      ...catalog.datasets.map((d) => option(d.id, d.name)),
    );
    const phoenix = catalog.datasets.find((d) =>
      /phoenix|pheonix/i.test(d.name),
    );
    const saved = readView();
    const route = saved.filters || {};
    selectAvailable("dataset", route.dataset, (phoenix || catalog.datasets[0]).id);
    applySettings(saved.config || {}, route);
    showTab(saved.tab === "table" ? "table" : "graph");
    selectDataset(route.dataset === $("dataset").value ? route : {});
  } catch (e) {
    $("metadata").textContent = "Dataset unavailable";
    $("status").textContent = e.message;
  }
}
// History traversal can restore form fields after pageshow without dispatching input events.
// Hydrate once after that step so controls, visibility, labels and graph share one snapshot.
if (document.readyState === "complete") setTimeout(init, 0);
else window.addEventListener("pageshow", () => setTimeout(init, 0), {once: true});
