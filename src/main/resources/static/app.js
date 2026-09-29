const $ = (selector, root = document) => root.querySelector(selector);
const view = $("#view");
const state = { route: location.hash || "#/fleet", vehicles: [], selected: null, incidents: [], tests: [], tools: [], analysis: null, repoUrl: localStorage.getItem("webmcp-repo-url") || "", chatBusy: false };

const icon = {
  car: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 11 1.4-4.2A2 2 0 0 1 8.3 5.5h7.4a2 2 0 0 1 1.9 1.3L19 11l1.2 1.2c.5.5.8 1.2.8 1.9v3.4a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1V17h-11v1.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3.4c0-.7.3-1.4.8-1.9L5 11Zm1.1 0h11.8l-1.1-3.3a.6.6 0 0 0-.6-.4H7.8a.6.6 0 0 0-.6.4L6.1 11ZM6 14.5a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Zm12 0a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 1.5 7 7 3-7 2-1.5 8-2-8-7-2 7-3 2-7Z"/><path d="m19 2 .6 2.4L22 5l-2.4.6L19 8l-.6-2.4L16 5l2.4-.6L19 2Z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6 6-6-6 6-6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
};

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || body.message || `Request failed (${response.status})`);
  }
  return response.json();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function statusClass(value = "") { return value.toLowerCase().replaceAll(" ", "-"); }
function currentVin() { return state.route.match(/^#\/fleet\/([^/?#]+)/)?.[1] || null; }
function toast(message, kind = "success") {
  const node = $("#toast"); node.textContent = message; node.className = `toast show ${kind}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 3000);
}
function setCrumb(text) { $("#crumb-current").textContent = text; }

async function loadFleet() {
  state.vehicles = await api("/api/vehicles");
  const vin = currentVin();
  state.selected = vin ? await api(`/api/vehicles/${encodeURIComponent(vin)}`) : null;
  if (state.selected) {
    [state.incidents, state.tests, state.tools] = await Promise.all([
      api(`/api/vehicles/${vin}/incidents`), api(`/api/vehicles/${vin}/tests`), api("/api/platform/tools")
    ]);
  }
}

function renderVehicleRows() {
  return state.vehicles.map((vehicle, index) => `
    <button class="vehicle-row ${state.selected?.vin === vehicle.vin ? "selected" : ""}" data-vehicle="${escapeHtml(vehicle.vin)}">
      <span class="vehicle-logo logo-${index}">${vehicle.model.startsWith("Tesla") ? "T" : vehicle.model.startsWith("BMW") ? "B" : vehicle.model.startsWith("Audi") ? "A" : "V"}</span>
      <span class="vehicle-main"><strong>${escapeHtml(vehicle.model)}</strong><small>${escapeHtml(vehicle.vin)}</small></span>
      <span class="status-pill ${statusClass(vehicle.status)}"><i></i>${escapeHtml(vehicle.status)}</span>
      <span class="vehicle-row-arrow">${icon.chevron}</span>
    </button>`).join("");
}

function renderFleet() {
  const selected = state.selected;
  setCrumb(selected ? selected.model : "Fleet overview");
  view.innerHTML = `
    <section class="page-heading">
      <div><div class="eyebrow"><span class="live-dot"></span> LIVE FLEET DATA <span class="eyebrow-divider">·</span> UPDATED JUST NOW</div>
        <h1>${selected ? "Vehicle overview" : "Fleet overview"}</h1>
        <p>${selected ? "Monitor vehicle health, incidents and service history." : "A clear view of every vehicle in your operation."}</p></div>
      <div class="heading-actions">${selected ? `<button class="button secondary" id="back-fleet">${icon.back} All vehicles</button>` : `<button class="button secondary">↧ <span>Export</span></button><button class="button primary" id="add-vehicle">＋ Add vehicle</button>`}</div>
    </section>
    ${selected ? renderVehicleDetail(selected) : renderFleetDashboard()}`;
  bindFleetEvents();
}

function renderFleetDashboard() {
  const attention = state.vehicles.filter((v) => v.status !== "Active").length;
  return `<section class="stats-grid">
    <article class="stat-card"><div class="stat-top"><span>Vehicles in fleet</span><span class="stat-symbol blue">${icon.car}</span></div><strong>${state.vehicles.length}<small> / 15</small></strong><div class="stat-foot"><span class="trend-up">↑ 2.4%</span> <span>vs. last month</span></div></article>
    <article class="stat-card"><div class="stat-top"><span>Active vehicles</span><span class="stat-symbol green">◉</span></div><strong>${state.vehicles.length - attention}</strong><div class="stat-foot"><span class="trend-neutral">● On the road</span> <span>right now</span></div></article>
    <article class="stat-card"><div class="stat-top"><span>Need attention</span><span class="stat-symbol amber">!</span></div><strong>${attention}</strong><div class="stat-foot"><span class="trend-warn">${attention} vehicles</span> <span>need review</span></div></article>
    <article class="stat-card"><div class="stat-top"><span>Fleet health</span><span class="stat-symbol violet">⌁</span></div><strong>86<small>%</small></strong><div class="stat-foot"><span class="trend-up">↑ 4.8%</span> <span>vs. last month</span></div></article>
  </section>
  <section class="content-grid overview-grid">
    <article class="panel vehicles-panel"><div class="panel-heading"><div><h2>Your vehicles <span class="count-chip">${state.vehicles.length}</span></h2><p>Track status and open a vehicle profile</p></div><button class="text-button">View all ${icon.arrow}</button></div>
      <div class="table-head"><span>VEHICLE</span><span>STATUS</span><span></span></div><div class="vehicle-list">${renderVehicleRows()}</div>
      <div class="panel-foot"><span>Showing <b>${state.vehicles.length}</b> of <b>12</b> vehicles</span><button class="pagination-btn">← <span>1 of 3</span> →</button></div>
    </article>
    <article class="panel health-panel"><div class="panel-heading"><div><h2>Fleet health</h2><p>Vehicle status at a glance</p></div><button class="more-button">···</button></div>
      <div class="health-chart"><div class="donut"><div class="donut-hole"><strong>86%</strong><small>Healthy</small></div></div><div class="legend"><div><i class="legend-green"></i><span>Healthy</span><b>9</b></div><div><i class="legend-amber"></i><span>Attention</span><b>2</b></div><div><i class="legend-red"></i><span>Service due</span><b>1</b></div></div></div>
      <div class="health-note"><span class="note-check">✓</span><span><strong>Looking good</strong><small>Most of your fleet is performing well.</small></span></div>
    </article>
  </section>
  <section class="panel activity-panel"><div class="panel-heading"><div><h2>Recent activity</h2><p>Latest updates across your fleet</p></div><button class="text-button">See activity ${icon.arrow}</button></div>
    <div class="activity-row"><span class="activity-icon amber-soft">⚑</span><span><strong>New incident reported</strong><small>Tesla Model 3 · Battery range degradation</small></span><time>12 min ago</time><span class="activity-arrow">${icon.chevron}</span></div>
    <div class="activity-row"><span class="activity-icon green-soft">✓</span><span><strong>Vehicle service completed</strong><small>BMW iX3 · Scheduled maintenance</small></span><time>2 hours ago</time><span class="activity-arrow">${icon.chevron}</span></div>
  </section>`;
}

function renderIncidentRows() {
  if (!state.incidents.length) return `<div class="empty-state small-empty"><span>✓</span><strong>All clear</strong><small>No incidents recorded for this vehicle.</small></div>`;
  return state.incidents.map((incident) => `<div class="incident-row"><span class="incident-marker ${statusClass(incident.severity)}">${incident.severity === "HIGH" ? "↑" : incident.severity === "MEDIUM" ? "!" : "·"}</span><div class="incident-copy"><div><strong>${escapeHtml(incident.title)}</strong><span class="severity-pill ${statusClass(incident.severity)}">${escapeHtml(incident.severity)}</span></div><p>${escapeHtml(incident.description)}</p><small>${escapeHtml(incident.id)} <i>·</i> ${escapeHtml(incident.date)}</small></div><span class="incident-status ${statusClass(incident.status)}">${escapeHtml(incident.status)}</span></div>`).join("");
}

function renderVehicleDetail(vehicle) {
  const batteryClass = vehicle.battery < 45 ? "battery-low" : "";
  return `<section class="vehicle-hero">
    <div class="vehicle-identity"><div class="large-car-icon">${icon.car}</div><div><div class="vehicle-title-line"><h2>${escapeHtml(vehicle.model)}</h2><span class="status-pill ${statusClass(vehicle.status)}"><i></i>${escapeHtml(vehicle.status)}</span></div><p>${escapeHtml(vehicle.year)} <i>·</i> ${escapeHtml(vehicle.vin)} <i>·</i> ${escapeHtml(vehicle.fleet)}</p></div></div>
    <div class="vehicle-hero-actions"><button class="button secondary" id="open-incident">＋ Report issue</button><button class="more-button">···</button></div>
  </section>
  <section class="vehicle-kpis"><article><span>Battery health</span><div class="kpi-value ${batteryClass}"><strong>${vehicle.battery}%</strong><span class="battery-bar"><i style="width:${vehicle.battery}%"></i></span></div><small>${vehicle.battery < 45 ? "Below fleet average" : "Within healthy range"}</small></article><article><span>Location</span><strong class="kpi-location">⌖ ${escapeHtml(vehicle.location)}</strong><small>Last synced 4 min ago</small></article><article><span>Service plan</span><strong>${escapeHtml(vehicle.plan)}</strong><small>Next inspection in 42 days</small></article><article><span>Fleet status</span><strong class="kpi-status"><i class="live-dot"></i>${escapeHtml(vehicle.status)}</strong><small>Updated just now</small></article></section>
  <section class="detail-columns">
    <article class="panel incident-panel"><div class="panel-heading"><div><div class="heading-with-chip"><h2>Incidents</h2><span class="count-chip">${state.incidents.filter((i) => i.status === "Open").length} open</span></div><p>Issues and reports for this vehicle</p></div><button class="text-button" id="open-incident-link">+ New incident</button></div><div class="incident-list">${renderIncidentRows()}</div></article>
    <article class="panel summary-panel"><div class="panel-heading"><div><h2>Vehicle summary</h2><p>AI-ready page context</p></div><span class="context-ready">${icon.check} CONTEXT READY</span></div>
      <div class="summary-highlight"><span class="summary-icon">${icon.spark}</span><p>${escapeHtml(vehicle.summary)}</p></div>
      <div class="summary-facts"><div><span>Vehicle ID</span><strong>${escapeHtml(vehicle.vin)}</strong></div><div><span>Location</span><strong>${escapeHtml(vehicle.location)}, Spain</strong></div><div><span>Open incidents</span><strong>${state.incidents.filter((i) => i.status === "Open").length} active</strong></div></div>
      <div class="tag-status"><span class="tag-status-icon">&lt;/&gt;</span><div><strong>WebMCP tag active</strong><small>Page context attached to this session</small></div><span class="online-pill"><i></i> Live</span></div>
    </article>
  </section>
  <section class="panel tests-panel"><div class="panel-heading"><div><h2>Latest checks</h2><p>Recent diagnostics and inspection status</p></div><button class="text-button">View all ${icon.arrow}</button></div><div class="checks-grid">${state.tests.map((test) => `<div class="check-item"><span class="check-state ${statusClass(test.status)}">${test.status === "Passed" ? "✓" : "!"}</span><span><strong>${escapeHtml(test.name)}</strong><small>${escapeHtml(test.detail)}</small></span><time>${escapeHtml(test.updated)}</time></div>`).join("")}</div></section>
  ${renderAssistant(vehicle)}`;
}

function renderAssistant(vehicle) {
  return `<section class="assistant-banner"><div class="assistant-avatar">${icon.spark}</div><div class="assistant-copy"><div><span class="assistant-title">Ask Northstar</span><span class="beta-pill">AI ASSISTANT</span></div><p>Your assistant can use ${state.tools.length ? `<b>${state.tools.length} published capabilities</b>` : "published WebMCP capabilities"} with this vehicle's page context.</p><div class="suggestions"><button data-prompt="Summarize this vehicle and flag any important issues">Summarize vehicle health <span>↗</span></button><button data-prompt="What are the open issues on this vehicle?">Review open incidents <span>↗</span></button></div></div><div class="assistant-chat"><div id="chat-messages" class="chat-messages"><div class="assistant-message"><span class="message-avatar">✳</span><p>Hi! I have the context for <b>${escapeHtml(vehicle.model)}</b> (${escapeHtml(vehicle.vin)}). What would you like to know?</p></div></div><form id="chat-form" class="chat-form"><input id="chat-input" autocomplete="off" placeholder="Ask about this vehicle…" aria-label="Ask about this vehicle"><button aria-label="Send message">${icon.arrow}</button></form><div class="chat-foot"><span>↳ Tools run with your permission</span><span><i class="dot-green"></i> ${state.tools.length ? "Connected to WebMCP" : "Publish tools in Studio to connect"}</span></div></div></section>`;
}

function renderStudio() {
  setCrumb("WebMCP Studio");
  view.innerHTML = `<section class="studio-intro"><div><div class="studio-kicker"><span class="studio-spark">✳</span> WEBMCP STUDIO</div><h1>Make your app agent-ready.</h1><p>Analyze a public repository, match its capabilities to the connected app, and publish the tools you choose.</p></div><div class="studio-intro-decoration"><span>W</span><i>✳</i><i>⌘</i><i>↗</i></div></section>
  <div class="steps"><div class="step-item done"><span>1</span><b>Analyze repository</b></div><i class="step-line ${state.analysis ? "complete" : ""}"></i><div class="step-item ${state.analysis ? "done" : ""}"><span>2</span><b>Review capabilities</b></div><i class="step-line ${state.tools.length ? "complete" : ""}"></i><div class="step-item ${state.tools.length ? "done" : ""}"><span>3</span><b>Publish to app</b></div></div>
  <div class="studio-grid"><div class="studio-main">
    <article class="panel repo-panel"><div class="panel-heading"><div><div class="panel-title-icon repo-title-icon">⌘</div><div class="repo-heading-copy"><h2>Public GitHub repository</h2><p>Inspect Spring endpoints in the source; only routes available in the connected app can be published.</p></div></div><span class="repo-state"><i></i> ${state.analysis ? "Analyzed" : "Ready to analyze"}</span></div>
      <div class="repo-input-row"><span class="github-icon">⌘</span><input id="repo-url" value="${escapeHtml(state.repoUrl)}" placeholder="https://github.com/owner/repository" aria-label="Public GitHub repository URL"><button id="analyze-btn" class="button primary">${state.analysis ? "Re-analyze" : "Analyze repository"} ${icon.arrow}</button></div>
      <div class="repo-meta"><span><i>◉</i> Public GitHub API · read only</span><span>Stack <b>Spring Boot</b></span><span>Access <b>no token needed</b></span></div>
    </article>
    ${state.analysis ? renderCapabilities() : renderAnalyzerEmpty()}
    ${state.analysis ? renderPublishBar() : ""}
  </div>
  <aside class="studio-side"><article class="panel app-connected"><div class="side-panel-heading"><span class="connected-icon">↗</span><div><strong>Connected app</strong><small>Your WebMCP tag is installed</small></div><span class="online-pill"><i></i> Live</span></div><div class="connected-app-card"><span class="app-icon">N</span><span><strong>Northstar Fleet</strong><small>fleet.acme-mobility.com</small></span><button class="open-link" title="Open app" data-go="#/fleet">↗</button></div><div class="tag-installed"><div><span class="tag-mini-icon">&lt;/&gt;</span><span><b>One tag installed</b><small>Added to your app's index.html</small></span></div><code>&lt;script src="/tag.js"&gt;</code></div><button class="text-button full-button" data-go="#/fleet">Open connected app ${icon.arrow}</button></article>
    <article class="panel how-panel"><div class="how-top"><span class="how-spark">✳</span><span>THE WEBMCP FLOW</span></div><div class="how-steps"><div class="how-step"><span class="how-number">01</span><div><b>Analyze</b><small>Routes, APIs and schemas</small></div><i>✓</i></div><div class="how-step"><span class="how-number">02</span><div><b>Review</b><small>You choose what to expose</small></div><i>✓</i></div><div class="how-step"><span class="how-number">03</span><div><b>Publish</b><small>Agents can use your app</small></div><i>✓</i></div></div><div class="how-footer">Works with your existing application.</div></article>
    <div class="safe-note"><span>◈</span> Write actions always ask for approval before running.</div>
  </aside></div>`;
  bindStudioEvents();
}

function renderAnalyzerEmpty() {
  return `<article class="panel analyzer-empty"><div class="empty-graphic"><span class="graphic-window"><i></i><i></i><i></i><b>‹ / ›</b><span class="graphic-scan"></span></span><span class="graphic-spark">✳</span><span class="graphic-route">↗ /vehicles/:vin</span></div><h2>See what your app can do</h2><p>We'll inspect Spring endpoints in the public source and compare them with the connected app.</p><button id="empty-analyze" class="text-button">Analyze the GitHub repository above ${icon.arrow}</button></article>`;
}

function renderCapabilities() {
  const included = new Set(state.analysis?.selected || ["getVehicle", "getVehicleIncidents", "getVehicleTests", "createVehicleIncident"]);
  return `<article class="panel capabilities-panel"><div class="panel-heading"><div><h2>Discovered capabilities <span class="count-chip">${state.analysis.capabilities.length}</span></h2><p>Extracted from the repository; unavailable endpoints are disabled.</p></div><button id="select-all" class="text-button">Select safe tools</button></div>
    <div class="scan-summary"><span class="scan-check">✓</span><span><strong>Analysis complete</strong><small>Found ${state.analysis.endpointsFound} Spring endpoints across ${state.analysis.controllers.length} controller and ${state.analysis.routesFound} frontend routes.</small></span><button class="scan-detail" id="show-scan">View scan details ${icon.chevron}</button></div>
    <div class="capability-list">${state.analysis.capabilities.map((cap) => `<label class="capability-row ${cap.risk.toLowerCase()} ${!cap.publishable ? "disabled-capability" : ""}"><input type="checkbox" name="capability" value="${escapeHtml(cap.name)}" ${included.has(cap.name) ? "checked" : ""} ${cap.publishable ? "" : "disabled"}><span class="cap-check"></span><span class="capability-info"><strong>${escapeHtml(cap.name)}<small class="method-tag ${cap.method.toLowerCase()}">${escapeHtml(cap.method)}</small></strong><small>${escapeHtml(cap.description)}${!cap.publishable ? (cap.risk === "DESTRUCTIVE" ? " · Destructive action disabled" : " · Endpoint unavailable in connected app") : ""}</small><code>${escapeHtml(cap.method)} ${escapeHtml(cap.endpoint)}</code></span><span class="risk-tag ${cap.risk.toLowerCase()}">${cap.risk === "DESTRUCTIVE" ? "⚠ " : ""}${escapeHtml(cap.risk)}</span></label>`).join("")}</div>
    <div class="capability-foot"><span>✧ Names and schemas are generated from your actual API.</span><button class="subtle-button" id="show-scan-2">Inspect scanned files ↗</button></div>
  </article>`;
}

function renderPublishBar() {
  const count = state.analysis?.selected?.length ?? 0;
  return `<div class="publish-bar"><span><b>${count} tools selected</b><small>Safe read and write actions can be published.</small></span><button class="button primary" id="publish-btn">Publish capabilities ${icon.arrow}</button></div>`;
}
function $$(selector, root = document) { return [...root.querySelectorAll(selector)]; }

function bindFleetEvents() {
  $$("[data-vehicle]").forEach((button) => button.addEventListener("click", () => navigate(`#/fleet/${button.dataset.vehicle}`)));
  $("#back-fleet")?.addEventListener("click", () => navigate("#/fleet"));
  $("#open-incident")?.addEventListener("click", openIncidentModal);
  $("#open-incident-link")?.addEventListener("click", openIncidentModal);
  $("#add-vehicle")?.addEventListener("click", () => toast("Vehicle onboarding is outside this demo."));
  $$("[data-prompt]").forEach((button) => button.addEventListener("click", () => sendPrompt(button.dataset.prompt)));
  $("#chat-form")?.addEventListener("submit", (event) => { event.preventDefault(); const input = $("#chat-input"); const text = input.value.trim(); if (text) { input.value = ""; sendPrompt(text); } });
}

function bindStudioEvents() {
  $("#analyze-btn")?.addEventListener("click", analyzeRepository);
  $("#empty-analyze")?.addEventListener("click", analyzeRepository);
  $("#select-all")?.addEventListener("click", () => {
    const boxes = $$("input[name=capability]:not(:disabled)"); const shouldCheck = boxes.some((box) => !box.checked); boxes.forEach((box) => { box.checked = shouldCheck; }); updatePublishBar();
  });
  $$("input[name=capability]").forEach((input) => input.addEventListener("change", updatePublishBar));
  $("#publish-btn")?.addEventListener("click", publishTools);
  $("#show-scan")?.addEventListener("click", showScanModal);
  $("#show-scan-2")?.addEventListener("click", showScanModal);
  $$('[data-go="#/fleet"]').forEach((button) => button.addEventListener("click", () => navigate("#/fleet")));
}

async function analyzeRepository() {
  const button = $("#analyze-btn") || $("#empty-analyze"); if (!button) return;
  const repositoryUrl = $("#repo-url")?.value.trim();
  if (!repositoryUrl) { toast("Enter the public GitHub repository URL first.", "error"); $("#repo-url")?.focus(); return; }
  state.repoUrl = repositoryUrl; localStorage.setItem("webmcp-repo-url", repositoryUrl);
  button.disabled = true; button.classList.add("loading"); button.dataset.original = button.textContent; button.textContent = "Reading GitHub source…";
  try {
    state.analysis = await api("/api/platform/analyze-github", { method: "POST", body: JSON.stringify({ repositoryUrl }) });
    state.analysis.selected = state.analysis.capabilities.filter((cap) => cap.publishable).map((cap) => cap.name);
    renderStudio(); toast(`GitHub repository analyzed · ${state.analysis.capabilities.length} capabilities discovered`);
  } catch (error) { toast(error.message, "error"); }
}

function updatePublishBar() {
  const selected = $$("input[name=capability]:checked").map((input) => input.value);
  if (state.analysis) state.analysis.selected = selected;
  const oldBar = $(".publish-bar"); if (!oldBar) return;
  const count = oldBar.querySelector("#publish-btn");
  oldBar.querySelector("span b").textContent = `${selected.length} tools selected`;
  count.disabled = selected.length === 0;
}

async function publishTools() {
  const tools = $$("input[name=capability]:checked").map((input) => input.value);
  const button = $("#publish-btn"); button.disabled = true; button.textContent = "Publishing…";
  try {
    await api("/api/platform/publish", { method: "POST", body: JSON.stringify({ tools }) });
    await WebMCPTag.refresh();
    state.tools = await api("/api/platform/tools");
    toast(`${state.tools.length} capabilities published to Northstar Fleet`);
    renderStudio();
  } catch (error) { toast(error.message, "error"); button.disabled = false; button.textContent = "Publish capabilities →"; }
}

function showScanModal() {
  const endpointRows = state.analysis.capabilities.map((cap) => `<div class="tree-node indent">↳ <b>${escapeHtml(cap.method)} ${escapeHtml(cap.endpoint)}</b><span>${escapeHtml(cap.name)}${cap.publishable ? " · available" : " · not publishable"}</span></div>`).join("");
  const routeRows = state.analysis.routes.map((route) => `<div class="tree-node indent">↳ <b>${escapeHtml(route)}</b><span>page context</span></div>`).join("");
  openModal(`<div class="modal-kicker"><span class="studio-spark">✳</span> REPOSITORY SOURCE SCAN</div><h2>Endpoints found in source</h2><p class="modal-intro">Extracted from the public repository. A capability can be published only when the connected app exposes the same method and endpoint.</p><div class="scan-tree"><div class="tree-root">⌘ &nbsp; ${escapeHtml(state.analysis.repository)} <span>${escapeHtml(state.analysis.stack).toUpperCase()}</span></div><div class="tree-line"></div><div class="tree-node">▱ &nbsp; Spring MVC controller <b>${escapeHtml(state.analysis.controllers.join(", "))}</b></div>${endpointRows}<div class="tree-node">▱ &nbsp; Frontend page routes</div>${routeRows}</div><div class="modal-actions"><button class="button secondary" data-close>Close</button></div>`);
}

function openModal(content) {
  const root = $("#modal-root"); root.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true">${content}</section></div>`;
  root.querySelector(".modal-backdrop").addEventListener("click", (event) => { if (event.target.classList.contains("modal-backdrop") || event.target.closest("[data-close]")) root.innerHTML = ""; });
  root.querySelector(".modal")?.addEventListener("keydown", (event) => { if (event.key === "Escape") root.innerHTML = ""; });
}

function isVehicleDetailTool(tool) { return tool.method === "GET" && /^\/api\/vehicles\/\{[^/]+\}$/.test(tool.endpoint); }
function isVehicleListTool(tool) { return tool.method === "GET" && tool.endpoint === "/api/vehicles"; }
function isIncidentListTool(tool) { return tool.method === "GET" && /\/incidents\/?$/.test(tool.endpoint); }
function isChecksTool(tool) { return tool.method === "GET" && /\/(?:tests|checks|inspections)\/?$/.test(tool.endpoint); }
function isCreateIncidentTool(tool) { return tool.method === "POST" && /\/vehicles\/\{[^/]+\}\/incidents\/?$/.test(tool.endpoint) && tool.risk === "WRITE"; }

function openIncidentModal() {
  const vehicle = state.selected;
  const createTool = state.tools.find(isCreateIncidentTool);
  if (!createTool) {
    toast("Publish the create incident capability in Studio first.", "error"); return;
  }
  openModal(`<div class="modal-kicker"><span class="risk-dot"></span> CREATE INCIDENT</div><h2>Report an issue</h2><p class="modal-intro">This will create a new incident for <b>${escapeHtml(vehicle.model)}</b>. The action runs only after you confirm.</p><form id="incident-form" class="incident-form"><label>Title<input name="title" required value="Battery range below expected"></label><label>Severity<select name="severity"><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></label><label>Description<textarea name="description" rows="3">Energy consumption is above the expected range based on recent diagnostics.</textarea></label><div class="approval-note"><span>✓</span> Agent prepared this action. You control whether it runs.</div><div class="modal-actions"><button type="button" class="button secondary" data-close>Cancel</button><button type="submit" class="button primary">Confirm and create <span>→</span></button></div></form>`);
  $("#incident-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); const submit = form.querySelector('[type="submit"]'); submit.disabled = true; submit.textContent = "Creating…";
    try {
      await invokePublishedTool(createTool.name, { vin: vehicle.vin, ...data });
      $("#modal-root").innerHTML = ""; await renderCurrent(); toast("Incident created and added to the vehicle record");
    } catch (error) { toast(error.message, "error"); submit.disabled = false; submit.innerHTML = 'Confirm and create <span>→</span>'; }
  });
}

async function invokePublishedTool(name, args = {}) {
  const capability = state.tools.find((tool) => tool.name === name);
  if (!capability) throw new Error(`Capability ${name} is not published.`);
  if (!capability.endpoint.startsWith("/api/vehicles")) throw new Error("This capability is outside the connected app.");
  const pathKeys = [...capability.endpoint.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  const endpoint = capability.endpoint.replace(/\{([^}]+)\}/g, (_match, key) => {
    if (args[key] === undefined || args[key] === null) throw new Error(`Missing tool input: ${key}`);
    return encodeURIComponent(args[key]);
  });
  const method = capability.method.toUpperCase();
  const body = Object.fromEntries(Object.entries(args).filter(([key]) => !pathKeys.includes(key)));
  const options = { method };
  if (!["GET", "HEAD"].includes(method)) options.body = JSON.stringify(body);
  return api(endpoint, options);
}

function appendMessage(role, content) {
  const messages = $("#chat-messages"); if (!messages) return;
  const node = document.createElement("div"); node.className = role === "user" ? "user-message" : "assistant-message";
  node.innerHTML = role === "user" ? `<p>${escapeHtml(content)}</p><span class="user-message-avatar">JD</span>` : `<span class="message-avatar">✳</span><p>${content}</p>`;
  messages.append(node); messages.scrollTop = messages.scrollHeight;
}

async function sendPrompt(prompt) {
  if (state.chatBusy) return;
  appendMessage("user", prompt);
  if (!state.tools.length) {
    appendMessage("assistant", `I need published WebMCP capabilities to answer that. Open <a href="#/studio">WebMCP Studio</a> and publish the vehicle tools first.`); return;
  }
  state.chatBusy = true;
  const messages = $("#chat-messages");
  const thinking = document.createElement("div"); thinking.className = "assistant-message thinking-message"; thinking.innerHTML = '<span class="message-avatar">✳</span><p><span class="typing"><i></i><i></i><i></i></span> Checking vehicle data…</p>'; messages?.append(thinking); if (messages) messages.scrollTop = messages.scrollHeight;
  try {
    const query = prompt.toLowerCase();
    const asksFleet = /fleet|all vehicles|every vehicle|flota|todos los veh[ií]culos/i.test(query);
    const asksIncidents = /problem|issue|incident|health|summar|important|status|open|problema|incidenc|aver[ií]a|salud|resumen|estado/i.test(query);
    const asksChecks = /test|check|inspection|diagnostic|prueba|chequeo|revisi[oó]n|diagn[oó]stic/i.test(query);
    const requested = state.tools.filter((tool) => {
      if (isVehicleListTool(tool)) return asksFleet;
      if (isVehicleDetailTool(tool)) return !asksFleet;
      if (isIncidentListTool(tool)) return asksIncidents && !asksFleet;
      if (isChecksTool(tool)) return asksChecks && !asksFleet;
      return false;
    });
    if (!requested.length) throw new Error("No published read capability matches that question.");
    const results = await Promise.all(requested.map(async (tool) => [tool.name, await invokePublishedTool(tool.name, { vin: WebMCPTag.getContext().vin || state.selected.vin })]));
    const data = Object.fromEntries(results);
    const vehicleTool = requested.find(isVehicleDetailTool);
    const incidentTool = requested.find(isIncidentListTool);
    const checksTool = requested.find(isChecksTool);
    const listTool = requested.find(isVehicleListTool);
    const vehicle = vehicleTool ? data[vehicleTool.name] : null;
    const incidents = incidentTool ? data[incidentTool.name] : [];
    const tests = checksTool ? data[checksTool.name] : [];
    const fleet = listTool ? data[listTool.name] : [];
    const open = incidents.filter((incident) => incident.status === "Open");
    setTimeout(() => {
      thinking.remove();
      const summary = vehicle
        ? `${escapeHtml(vehicle.model)} (${vehicle.vin}) is <b>${escapeHtml(vehicle.status.toLowerCase())}</b> with ${vehicle.battery}% battery health.${incidentTool ? ` There ${open.length === 1 ? "is" : "are"} <b>${open.length} open incident${open.length === 1 ? "" : "s"}</b>${open[0] ? `, led by “${escapeHtml(open[0].title)}” (${open[0].severity.toLowerCase()} priority)` : ""}.` : ""} ${escapeHtml(vehicle.summary)}.`
        : fleet.length ? `The fleet has <b>${fleet.length} vehicles</b>: ${fleet.map((item) => `${escapeHtml(item.model)} (${escapeHtml(item.status)})`).join(", ")}.`
        : "I retrieved the published tool results.";
      const testSummary = tests.length ? `<br><br><b>Latest checks:</b> ${tests.map((test) => `${escapeHtml(test.name)}: ${escapeHtml(test.status)}`).join(" · ")}` : "";
      const toolNames = requested.map((tool) => `✓ ${escapeHtml(tool.name)}`).join(" &nbsp; ");
      const createAction = state.tools.some(isCreateIncidentTool)
        ? `<br><button class="inline-action" data-create-from-chat>＋ Create an incident</button>` : "";
      appendMessage("assistant", `<span class="tool-used">${toolNames}</span>${summary}${testSummary}${createAction}`);
      $$("[data-create-from-chat]").forEach((button) => button.addEventListener("click", openIncidentModal));
    }, 500);
  } catch (error) { thinking.remove(); appendMessage("assistant", `I couldn't load the vehicle right now: ${escapeHtml(error.message)}`); }
  finally { setTimeout(() => { state.chatBusy = false; }, 520); }
}

async function renderCurrent() {
  state.route = location.hash || "#/fleet"; WebMCPTag.setRoute(state.route);
  try {
    if (state.route.startsWith("#/studio")) {
      state.tools = await api("/api/platform/tools");
      if (state.analysis) state.analysis = { ...state.analysis, selected: state.analysis.selected };
      renderStudio();
    } else { await loadFleet(); renderFleet(); }
  } catch (error) { view.innerHTML = `<section class="load-error"><span>!</span><h1>Could not load the demo</h1><p>${escapeHtml(error.message)}</p><button class="button primary" onclick="location.reload()">Try again</button></section>`; }
  $$(".nav-item").forEach((item) => item.classList.toggle("active", state.route.startsWith("#/studio") ? item.textContent.includes("WebMCP Studio") : item.textContent.includes("Fleet overview")));
}

function navigate(route) { if (location.hash === route) renderCurrent(); else location.hash = route; }
window.addEventListener("hashchange", renderCurrent);
$$("[data-go]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.go)));
window.addEventListener("webmcp:ready", async () => {
  if (!state.route.startsWith("#/studio")) {
    state.tools = await api("/api/platform/tools").catch(() => []);
    if (state.selected) renderFleet();
  }
});
renderCurrent();
