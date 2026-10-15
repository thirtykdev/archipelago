// Atoll preview UI. Vanilla, no framework, no inline code (strict CSP). Talks only to its own origin.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const refKey = (ref) => Object.keys(ref).filter((k) => k !== 'connector').sort().map((k) => `${k}=${ref[k]}`).join('|');
const state = { model: null, view: 'overview', selectedDevice: null, filter: '', simulate: false, changed: new Set(), showAnswered: false, diffFrom: null, diffTo: null, me: null, user: (() => { try { return localStorage.getItem('atoll-user') || 'admin'; } catch { return 'admin'; } })() };
// Every request names the acting principal. Preview identity; the first release replaces this header with a session.
const _fetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => _fetch(input, { ...init, headers: { ...(init.headers || {}), 'x-atoll-user': state.user } });
const may = (cap) => !!state.me?.capabilities?.includes(cap);

// ---- theme ----
try { const t = localStorage.getItem('atoll-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch {}
$('[data-theme-toggle]').addEventListener('click', () => { const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', cur); try { localStorage.setItem('atoll-theme', cur); } catch {} });

// ---- navigation ----
function nav(view) { state.view = view; $$('[data-nav]').forEach((a) => a.classList.toggle('is-current', a.dataset.nav === view)); $$('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== view; }); render(); }
$$('[data-nav]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); location.hash = a.dataset.nav; }));
window.addEventListener('hashchange', () => nav(location.hash.slice(1) || 'overview'));

// ---- import ----
async function importFiles(files) {
  for (const f of files) {
    toast(`Reading ${f.name}…`);
    const res = await fetch('/api/import', { method: 'POST', headers: { 'x-filename': encodeURIComponent(f.name) }, body: await f.arrayBuffer() });
    const j = await res.json();
    if (!res.ok) toast(`${f.name}: ${j.error}`, true); else toast(`${f.name}: ${j.artifact.kind} (${j.artifact.format})`);
  }
  await load();
}
$('[data-file-input]').addEventListener('change', (e) => importFiles([...e.target.files]));
$('[data-reset]').addEventListener('click', async () => { await fetch('/api/reset', { method: 'POST' }); state.selectedDevice = null; await load(); });
const drop = $('[data-drop]');
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; drop.hidden = false; });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.hidden = true; } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; drop.hidden = true; importFiles([...e.dataTransfer.files]); });
let toastTimer;
function toast(msg, err = false) { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.classList.toggle('err', err); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), err ? 6000 : 2500); }

// ---- data ----
async function loadMe() { state.me = await (await fetch('/api/me')).json(); const sel = $('[data-user]'); sel.innerHTML = state.me.users.map((u) => `<option value="${esc(u.id)}" ${u.id === state.user ? 'selected' : ''}>${esc(u.name)}</option>`).join(''); $('[data-caps]').textContent = state.me.capabilities.join(' · ') || 'no capabilities'; $$('[data-needs]').forEach((el) => el.toggleAttribute('data-denied', !may(el.dataset.needs))); }
async function load() { await loadMe(); const r = await fetch('/api/model'); if (r.status === 403) { state.model = null; const err = (await r.json()).error; $$('[data-view]').forEach((v) => { if (!v.hidden) v.innerHTML = `<div class="panel"><div class="empty"><b>No access</b>${esc(err)}</div></div>`; }); return; } state.model = await r.json(); render(); }
$('[data-user]').addEventListener('change', (e) => { state.user = e.target.value; try { localStorage.setItem('atoll-user', state.user); } catch {} load(); });
const es = new EventSource('/api/events');
es.addEventListener('hello', (e) => { state.simulate = JSON.parse(e.data).simulate; renderConn(); });
es.addEventListener('model', () => load());
es.addEventListener('reading', (e) => { const r = JSON.parse(e.data); if (!state.model) return; const k = refKey(r.ref); state.model.readings[k] = r; state.changed.add(k); patchValue(k, r); });
es.onerror = () => { $('[data-status]').textContent = 'event stream disconnected'; };
function renderConn() { const c = $('[data-conn]'); c.textContent = state.simulate ? 'simulated connector' : 'no connector'; c.dataset.on = String(state.simulate); }

// ---- render ----
function prov(kind, title) { return `<span class="prov prov-${kind}" title="${esc(title ?? '')}">${kind}</span>`; }
function valueCell(ref, kind) {
  if (!ref) return `<td class="val muted">·</td>`;
  const r = state.model?.readings?.[refKey(ref)];
  if (!r) return `<td class="val muted" data-val="${esc(refKey(ref))}">${state.simulate || (state.model?.atoll?.connectors || []).length ? '…' : 'no connector'}</td>`;
  return `<td class="val" data-val="${esc(refKey(ref))}">${r.status === 'ok' ? fmt(r.value, kind) : `<span class="prov prov-question">${esc(r.status)}</span>`} ${prov(r.source === 'simulated' ? 'simulated' : 'observed', `${r.source} · ${r.at}`)}</td>`;
}
function fmt(v, kind) { if (v === null || v === undefined) return '—'; if (typeof v === 'boolean') return v ? 'on' : 'off'; if (typeof v === 'number') return kind === 'enum' ? String(v) : v.toFixed(1); return esc(v); }
function patchValue(k, r) { for (const td of $$(`[data-val="${CSS.escape(k)}"]`)) { td.classList.remove('muted'); td.innerHTML = `${r.status === 'ok' ? fmt(r.value) : `<span class="prov prov-question">${esc(r.status)}</span>`} ${prov(r.source === 'simulated' ? 'simulated' : 'observed', `${r.source} · ${r.at}`)}`; td.classList.remove('changed'); void td.offsetWidth; td.classList.add('changed'); } }
function bindingText(b) { return b ? `${b.objectType ?? '?'}:${b.instance ?? '?'} @ ${b.device ?? '?'}` : ''; }

function render() {
  const m = state.model; if (!m) return;
  if (m.config && !m.config.setupDone && may('admin.site')) { $$('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== 'setup'; }); setup(); return; }
  if (state.view === 'setup') { state.view = 'overview'; $$('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== 'overview'; }); }
  const s = m.station;
  $('[data-site]').innerHTML = s ? `${esc(s.stationName || 'station')} <span class="muted">· ${s.artifact.format} · ${s.components} components</span>` : 'No station imported';
  const open = m.questions.filter((q) => !q.answered); const qc = $('[data-qcount]'); qc.textContent = open.length; qc.toggleAttribute('data-zero', !open.length);
  $('[data-status]').textContent = `${m.artifacts.length} artifact${m.artifacts.length === 1 ? '' : 's'} · ${m.model.entities} entities · ${m.model.assertions} facts (${m.model.superseded} superseded) · ${m.snapshots.length} snapshots · ${Object.keys(m.readings).length} live values · ${m.atoll.storage}`;
  renderConn();
  ({ overview, devices, points, controllers, questions, changes, documents, artifacts, setup })[state.view]?.();

  function setup() {
    const v = $('[data-view="setup"]'); const c = m.config;
    v.innerHTML = `<div class="setup"><div class="panel"><div class="panel-head"><div><h2>Welcome to Atoll</h2><span class="muted">Three answers and you are running. Everything stays on this machine, in <span class="mono">${esc(c.dataDir ?? '')}</span>. You can change all of this later.</span></div></div>
      <form class="panel-body setup-form" data-setup>
        <label><span>What is this site called?</span><input name="siteName" required placeholder="e.g. North campus, Home lab" value="${esc(c.siteName)}" /></label>
        <label><span>Your name (you are the administrator)</span><input name="adminName" required placeholder="e.g. Kyle" value="${esc(c.adminName)}" /><small class="muted">Accounts and sign-in come with the first release. For now, Atoll listens only on this machine, and your name goes on every change you make.</small></label>
        <fieldset><legend>Read the network</legend>
          <label class="row"><input type="checkbox" name="bacnetEnabled" ${c.bacnet.enabled ? 'checked' : ''} /><span>BACnet/IP, read-only. Atoll will ask who is out there and read what they expose. It cannot write.</span></label>
          <div class="grid2"><label><span>Broadcast address</span><input name="broadcast" value="${esc(c.bacnet.broadcast)}" placeholder="255.255.255.255 or 192.168.1.255" /></label><label><span>UDP port</span><input name="bacnetPort" value="${c.bacnet.port}" /></label></div>
          <label><span>Also ask these addresses directly (optional, one per line; a JACE, a router, a device on another subnet)</span><textarea name="targets" rows="2" placeholder="192.168.1.50">${esc((c.bacnet.targets || []).join('\n'))}</textarea></label>
          <label><span>Poll every (ms)</span><input name="pollMs" value="${c.bacnet.pollMs}" /></label>
        </fieldset>
        <label class="row"><input type="checkbox" name="simulate" ${c.simulate ? 'checked' : ''} /><span>No hardware here: invent values for every address so I can see the screens work (labeled simulated).</span></label>
        <div class="setup-actions"><button class="btn btn-primary" type="submit">Start Atoll</button><span class="muted">You can import station backups and controller files right after.</span></div>
      </form></div>
      <div class="note">What Atoll will not do: write to any point, contact anything outside this machine, or guess a fact it could not read. Every fact is labeled with where it came from.</div></div>`;
    $('[data-setup]', v).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      const body = { siteName: f.get('siteName'), adminName: f.get('adminName'), simulate: f.get('simulate') === 'on', bacnet: { enabled: f.get('bacnetEnabled') === 'on', broadcast: f.get('broadcast'), port: Number(f.get('bacnetPort')) || 47808, pollMs: Number(f.get('pollMs')) || 5000, targets: String(f.get('targets') || '').split(/\n/).map((x) => x.trim()).filter(Boolean) } };
      const r = await fetch('/api/setup', { method: 'POST', body: JSON.stringify(body) }); const j = await r.json();
      if (!r.ok) toast(j.error, true); else { toast(`Welcome, ${j.config.adminName}. ${j.config.siteName} is running.`); state.view = 'overview'; location.hash = 'overview'; await load(); }
    });
  }

  function overview() {
    const v = $('[data-view="overview"]');
    if (!s && !m.controllers.length) { v.innerHTML = `<div class="panel"><div class="empty"><b>Import the engineering you already have</b>Drop a station backup (.bog or .dist) and the controller files for the same job (.caf, .gfx). Everything is read on this machine, in memory. Passwords are replaced before anything is shown.</div></div>${principles()}`; return; }
    const pts = s?.points ?? [], bound = pts.filter((p) => p.binding).length;
    const missing = m.controllers.reduce((n, c) => n + c.correlation.onlyController.length, 0);
    v.innerHTML = `
      <div class="tiles">
        ${tile(s?.devices.length ?? 0, 'devices', s ? `${s.networks.length} network${s.networks.length === 1 ? '' : 's'}` : 'no station')}
        ${tile(pts.length, 'points', `${bound} with a native address`)}
        ${tile(s?.extensions.filter((e) => e.kind === 'history').length ?? 0, 'histories', 'configured on the station')}
        ${tile(s?.extensions.filter((e) => e.kind === 'alarm').length ?? 0, 'alarms', 'extensions on the station')}
        ${tile(m.controllers.length, 'controller files', `${m.controllers.filter((c) => c.matchedDevice).length} matched to a device`)}
        ${tile(missing, 'not in the station', 'exposed by controllers, never pulled in', missing ? 'q' : '')}
        ${tile(open.length, 'open questions', `${m.questions.length - open.length} answered`, open.length ? 'q' : '')}
      </div>
      <div class="split">
        <div class="panel"><div class="panel-head"><h3>Coverage</h3><span class="muted mono">${s ? s.elapsedMs + ' ms' : ''}</span></div><div class="panel-body bars">${s ? Object.entries(s.coverage).map(([k, c]) => bar(k, c)).join('') : '<span class="muted">no station</span>'}</div></div>
        <div class="panel"><div class="panel-head"><h3>Connectors</h3></div><div class="panel-body">${(m.atoll.connectors || []).map((c) => `<div class="conn"><b>${esc(c.label)}</b> <span class="mono muted">${c.capabilities.write ? '' : 'read-only'}${c.discovered !== undefined ? ` · ${c.discovered} objects discovered` : ''}${c.health ? ` · ${c.health.connected ? 'connected' : 'closed'}${c.health.lastSeen ? ' · last seen ' + c.health.lastSeen.slice(11, 19) : ''}` : ''}</span>${c.error ? `<div class="prov prov-question">${esc(c.error)}</div>` : ''}${c.config ? `<div class="mono muted small">broadcast ${esc(c.config.broadcast)} · port ${c.config.port} · poll ${c.config.pollMs} ms${c.config.targets?.length ? ' · also ' + esc(c.config.targets.join(', ')) : ''}</div>` : ''}</div>`).join('') || '<span class="muted">No connector. Start with --simulate, --bacnet, or run setup.</span>'}</div></div>
        <div class="panel"><div class="panel-head"><h3>What the connector would read</h3>${state.simulate ? prov('simulated', 'values are invented by the simulated connector') : '<span class="muted mono">no connector</span>'}</div><div class="panel-body">
          <p class="lede">Every native address in the model: ${bound} from the station's proxy points, ${missing} from controller files that the station never pulled in. A local Atoll reads all of them, read-only, if the network routes to the controllers. No add-points step.</p>
          <p class="note">${state.simulate ? 'Simulation is on: values below are invented, labeled <b>simulated</b>, and exist so the model and this screen can be exercised with no building.' : 'Start with <code>--simulate</code> to see live values invented for every address.'}</p>
        </div></div>
      </div>
      ${principles()}`;
  }
  function principles() { return `<div class="note">Read-only by type · nothing leaves this machine · every fact labeled imported, observed, inferred, or a question · synthetic fixtures only in the repository.</div>`; }
  function tile(n, l, sub, cls = '') { return `<div class="tile ${cls ? 'tile-' + cls : ''}"><div class="n">${n}</div><div class="l">${l}</div><div class="sub">${esc(sub)}</div></div>`; }
  function bar(k, c) { const pct = c.of ? Math.round((100 * c.have) / c.of) : 0; return `<div class="bar"><span>${esc(k)}</span><span class="mono">${c.have}/${c.of} · ${pct}%</span><div class="track"><i data-w="${pct}"></i></div></div>`; }

  function devices() {
    const v = $('[data-view="devices"]');
    if (!s) { v.innerHTML = `<div class="panel"><div class="empty"><b>No station imported</b>Devices come from a station backup; devices seen on the network appear below.</div></div>${discoveredPanel()}`; return; }
    const sel = state.selectedDevice ?? s.devices[0]?.path; state.selectedDevice = sel;
    const d = s.devices.find((x) => x.path === sel);
    const ctl = m.controllers.find((c) => c.matchedDevice === sel);
    v.innerHTML = `<div class="split">
      <div class="panel"><div class="panel-head"><h3>Devices · ${s.devices.length}</h3></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Driver</th><th class="mono">Instance</th><th class="num">Points</th><th>Controller file</th></tr></thead><tbody>
        ${s.devices.map((x) => `<tr class="clickable ${x.path === sel ? 'is-selected' : ''}" data-dev="${esc(x.path)}"><td><b>${esc(x.name)}</b></td><td class="kind">${esc(x.type)}</td><td class="mono">${x.instance ?? '<span class="muted">none</span>'}</td><td class="num">${x.points}</td><td>${m.controllers.filter((c) => c.matchedDevice === x.path).map((c) => `<span class="tag">${esc(c.artifact.name)}</span>`).join('') || '<span class="muted">—</span>'}</td></tr>`).join('')}
      </tbody></table></div></div>
      ${d ? devicePanel(d, ctl) : ''}
    </div>${discoveredPanel()}`;
    $$('[data-dev]', v).forEach((tr) => tr.addEventListener('click', () => { state.selectedDevice = tr.dataset.dev; devices(); }));
  }
  function discoveredPanel() {
    const disc = m.discovered || []; if (!disc.length) return '';
    return `<div class="panel"><div class="panel-head"><div><h3>Seen on the network · ${disc.length} device${disc.length === 1 ? '' : 's'}</h3><span class="muted">Everything the BACnet/IP connector found, read-only. Objects the station already pulls in are marked; the rest are read anyway (no add-points step).</span></div>${prov('observed', 'read live')}</div>
      ${disc.map((dv) => `<div class="panel-body"><h3>${esc(dv.name)} <span class="muted mono">· device ${dv.instance} · ${esc(dv.address)} · ${dv.objects.length} objects</span></h3>
      <div class="table-wrap"><table><thead><tr><th>Object</th><th>Kind</th><th>Units</th><th class="mono">Address</th><th>Value</th><th>In station</th></tr></thead><tbody>
      ${dv.objects.map((o) => `<tr><td><b>${esc(o.name)}</b></td><td class="kind">${o.kind}${o.writable ? ' <span class="tag tag-w">writable</span>' : ''}</td><td class="mono">${esc(o.units ?? '')}</td><td class="mono">${esc(bindingText(o.ref))}</td>${valueCell(o.ref, o.kind)}<td>${o.inStation ? prov('imported', 'also in the station backup') : '<span class="muted">no</span>'}</td></tr>`).join('')}
      </tbody></table></div></div>`).join('')}</div>`;
  }
  function devicePanel(d, ctl) {
    const pts = s.points.filter((p) => p.device === d.path);
    return `<div class="panel"><div class="panel-head"><div><h3>${esc(d.name)} <span class="muted">· ${esc(d.type)}</span></h3><span class="muted mono">${esc(d.path)}</span></div>${prov('imported', 'from the station backup')}</div>
      <div class="panel-body"><dl class="dl"><dt>instance</dt><dd class="mono">${d.instance ?? 'none'}</dd><dt>address</dt><dd class="mono">${esc(d.address ?? '—')}</dd><dt>controller file</dt><dd>${ctl ? `${esc(ctl.artifact.name)} · ${ctl.correlation.matched} matched · <span class="${ctl.correlation.onlyController.length ? 'prov prov-question' : 'muted'}">${ctl.correlation.onlyController.length} not pulled in</span>` : '<span class="muted">none imported for this device</span>'}</dd></dl></div>
      <div class="table-wrap"><table><thead><tr><th>Point</th><th>Kind</th><th>Units</th><th class="mono">Address</th><th>Value</th><th>Ext</th><th>Source</th></tr></thead><tbody>
        ${pts.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td class="kind">${p.kind}${p.writable ? ' <span class="tag tag-w">writable</span>' : ''}</td><td class="mono">${esc(p.units ?? '')}</td><td class="mono">${esc(bindingText(p.binding))}</td>${valueCell(p.binding, p.kind)}<td>${p.histories.length ? `<span class="tag">H×${p.histories.length}</span>` : ''}${p.alarms.length ? `<span class="tag">A×${p.alarms.length}</span>` : ''}</td><td>${prov('imported', p.path)}</td></tr>`).join('')}
        ${ctl ? ctl.correlation.onlyController.map((p) => `<tr><td><b>${esc(p.name)}</b> <span class="tag">controller only</span></td><td class="kind">${p.kind}${p.writable ? ' <span class="tag tag-w">writable</span>' : ''}</td><td></td><td class="mono">${esc(bindingText(p.ref))}</td>${valueCell(p.ref, p.kind)}<td></td><td>${prov('question', 'exposed by the controller, not in the station')}</td></tr>`).join('') : ''}
      </tbody></table></div></div>`;
  }

  function points() {
    const v = $('[data-view="points"]');
    const all = [...(s?.points ?? []).map((p) => ({ ...p, dev: s.devices.find((d) => d.path === p.device)?.name ?? '', src: 'imported', via: p.path, ref: p.binding })), ...m.controllers.flatMap((c) => c.correlation.onlyController.map((p) => ({ name: p.name, kind: p.kind, writable: p.writable, units: '', dev: c.deviceName, src: 'question', via: `${c.artifact.name} · not in the station`, ref: p.ref, histories: [], alarms: [] })))];
    const f = state.filter.toLowerCase();
    const rows = all.filter((p) => !f || `${p.name} ${p.dev} ${p.kind} ${p.units}`.toLowerCase().includes(f));
    v.innerHTML = `<div class="panel"><div class="panel-head"><h3>Points · ${rows.length}${f ? ` of ${all.length}` : ''}</h3><div class="filter"><input type="search" placeholder="filter by name, device, kind, units" value="${esc(state.filter)}" data-filter /></div></div>
      <div class="table-wrap"><table><thead><tr><th>Point</th><th>Device</th><th>Kind</th><th>Units</th><th class="mono">Address</th><th>Value</th><th>Source</th></tr></thead><tbody>
      ${rows.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.dev)}</td><td class="kind">${p.kind}${p.writable ? ' <span class="tag tag-w">writable</span>' : ''}</td><td class="mono">${esc(p.units ?? '')}</td><td class="mono">${esc(bindingText(p.ref))}</td>${valueCell(p.ref, p.kind)}<td>${prov(p.src, p.via)}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">No points. Import a station backup or a controller file.</td></tr>`}
      </tbody></table></div></div>`;
    const inp = $('[data-filter]', v); inp.addEventListener('input', () => { state.filter = inp.value; const pos = inp.selectionStart; points(); const n = $('[data-filter]', v); n.focus(); n.setSelectionRange(pos, pos); });
  }

  function controllers() {
    const v = $('[data-view="controllers"]');
    if (!m.controllers.length) { v.innerHTML = `<div class="panel"><div class="empty"><b>No controller files imported</b>Drop the .caf or .gfx files for the controllers on this job. Each is matched to a station device by its device instance; what the controller exposes but the station lacks is listed with its address.</div></div>`; return; }
    v.innerHTML = m.controllers.map((c) => `<div class="panel"><div class="panel-head"><div><h3>${esc(c.artifact.name)} <span class="muted">· ${c.format} · device ${c.deviceInstance ?? 'unknown'} · ${esc(c.deviceName || 'unnamed')}</span></div><span class="muted mono">${c.matchedDevice ? 'matched ' + esc(c.matchedDevice) : 'no matching station device'} · importer validated on synthetic fixtures only</span></div>${prov('imported', c.artifact.sha256)}</div>
      <div class="panel-body three">
        <div><h3>In both <span class="muted">${c.correlation.matched}</span></h3><ul class="list">${c.correlation.matchedPairs.map((p) => `<li><span>${esc(p.controller)}</span><span class="mono muted">${esc(p.station)}</span></li>`).join('') || '<li class="muted">none</li>'}</ul></div>
        <div><h3>Controller only <span class="prov prov-question">${c.correlation.onlyController.length}</span></h3><ul class="list">${c.correlation.onlyController.map((p) => `<li><span>${esc(p.name)}${p.exposed ? '' : ' <span class="tag">not exposed</span>'}</span><span class="mono muted">${esc(bindingText(p.ref))}</span></li>`).join('') || '<li class="muted">none</li>'}</ul><p class="note">Readable directly by Atoll if the network routes to the controller. Never added to the station by this tool.</p></div>
        <div><h3>Station only <span class="muted">${c.correlation.onlyStation.length}</span></h3><ul class="list">${c.correlation.onlyStation.map((p) => `<li><span>${esc(p.name)}</span><span class="mono muted">${esc(p.path)}</span></li>`).join('') || '<li class="muted">none</li>'}</ul></div>
      </div>${c.warnings.length ? `<div class="panel-body"><div class="note">${c.warnings.map(esc).join('<br>')}</div></div>` : ''}</div>`).join('');
  }

  function questions() {
    const v = $('[data-view="questions"]');
    const list = state.showAnswered ? m.questions : m.questions.filter((q) => !q.answered);
    v.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Questions · ${open.length} open <span class="muted">· ${m.questions.length - open.length} answered</span></h3><span class="muted">What Atoll could not establish from the files. It asks; it does not invent. An answer is a confirmed fact that supersedes the inference and is kept with your name and the time.</span></div>
      <div class="filter"><span class="muted">answering as <b>${esc(state.me?.principal?.name ?? '')}</b></span><label class="muted"><input type="checkbox" data-show-answered ${state.showAnswered ? 'checked' : ''}/> show answered</label></div></div></div>
      ${list.map((q) => `<div class="q ${q.answered ? 'q-done' : ''}"><div class="who">${esc(q.kind)} · ${esc(q.subject)}</div><div>${esc(q.text)}</div><div class="ev">${q.evidence.map(esc).join('\n')}</div>
        ${q.answered ? `<div class="ans"><span class="prov prov-confirmed">confirmed</span> <b>${esc(q.answered.answer)}</b> <span class="muted mono">· ${esc(q.answered.by)} · ${esc(q.answered.at.slice(0, 19).replace('T', ' '))}</span></div>` : (may('questions.answer') ? `<div class="ans">${q.options.map((o) => `<button type="button" class="btn btn-sm" data-answer="${esc(q.id)}" data-option="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : `<div class="ans muted">answering needs the questions.answer capability${q.target ? ' on ' + esc(q.target) : ''}</div>`)}</div>`).join('') || `<div class="panel"><div class="empty"><b>No open questions</b>Everything imported so far was understood, or nothing is imported yet.</div></div>`}`;
    $('[data-show-answered]', v).addEventListener('change', (e) => { state.showAnswered = e.target.checked; questions(); });
    $$('[data-answer]', v).forEach((b) => b.addEventListener('click', async () => { const r = await fetch(`/api/questions/${encodeURIComponent(b.dataset.answer)}/answer`, { method: 'POST', body: JSON.stringify({ answer: b.dataset.option }) }); const j = await r.json(); if (!r.ok) toast(j.error, true); else toast(`Recorded: ${j.question.answered.answer}`); }));
  }

  function changes() {
    const v = $('[data-view="changes"]');
    const snaps = m.snapshots;
    if (snaps.length < 2) { v.innerHTML = `<div class="panel"><div class="empty"><b>Nothing to compare yet</b>Every import and every answer takes a snapshot. Import a changed backup of the same station and the difference appears here: added, removed, re-identified, and changed facts.</div></div>${snapTable()}`; return; }
    const from = state.diffFrom ?? snaps[snaps.length - 2].id, to = state.diffTo ?? snaps[snaps.length - 1].id;
    const opt = (sel) => snaps.map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.label)} · ${x.at.slice(11, 19)} · ${x.id.slice(0, 8)}</option>`).join('');
    v.innerHTML = `<div class="panel"><div class="panel-head"><h3>Changes</h3><div class="filter"><select data-from>${opt(from)}</select><span class="muted">→</span><select data-to>${opt(to)}</select></div></div><div class="panel-body" data-diff><span class="muted">loading…</span></div></div>${snapTable()}`;
    const load = async () => { const d = await (await fetch(`/api/diff?from=${encodeURIComponent($('[data-from]', v).value)}&to=${encodeURIComponent($('[data-to]', v).value)}`)).json(); state.diffFrom = d.from; state.diffTo = d.to; $('[data-diff]', v).innerHTML = diffHtml(d); };
    $('[data-from]', v).addEventListener('change', load); $('[data-to]', v).addEventListener('change', load); load();
    function snapTable() { return `<div class="panel"><div class="panel-head"><h3>Snapshots · ${snaps.length}</h3><span class="muted mono">content-addressed · identical states share an id</span></div><div class="table-wrap"><table><thead><tr><th>When</th><th>Label</th><th class="mono">Id</th><th class="num">Entities</th><th class="num">Facts</th></tr></thead><tbody>${snaps.slice().reverse().map((x) => `<tr><td class="mono">${x.at.slice(0, 19).replace('T', ' ')}</td><td>${esc(x.label)}</td><td class="mono">${x.id}</td><td class="num">${x.entities}</td><td class="num">${x.assertions}</td></tr>`).join('')}</tbody></table></div></div>`; }
    function diffHtml(d) {
      const n = d.added.length + d.removed.length + d.changed.length + d.renamed.length;
      if (!n) return `<span class="muted">No difference between these two snapshots.</span>`;
      const ent = (e) => `<li><span><b>${esc(e.name)}</b> <span class="kind">${esc(e.kind)}</span></span><span class="mono muted">${esc(e.path ?? e.id)}</span></li>`;
      return `<div class="three">
        <div><h3>Added <span class="prov prov-observed">${d.added.length}</span></h3><ul class="list">${d.added.map(ent).join('') || '<li class="muted">none</li>'}</ul></div>
        <div><h3>Removed <span class="prov prov-question">${d.removed.length}</span></h3><ul class="list">${d.removed.map(ent).join('') || '<li class="muted">none</li>'}</ul></div>
        <div><h3>Re-identified <span class="muted">${d.renamed.length}</span></h3><ul class="list">${d.renamed.map((r) => `<li><span><b>${esc(r.entity.name)}</b></span><span class="mono muted">${esc(r.from)} → ${esc(r.to)}</span></li>`).join('') || '<li class="muted">none</li>'}</ul></div>
      </div>
      <h3>Changed facts <span class="prov prov-inferred">${d.changed.length}</span></h3>
      <div class="table-wrap"><table><thead><tr><th>Entity</th><th>Fact</th><th>From</th><th>To</th></tr></thead><tbody>${d.changed.map((c) => `<tr><td><b>${esc(c.name)}</b> <span class="mono muted">${esc(c.subject)}</span></td><td class="mono">${esc(c.key)}</td><td class="mono">${esc(JSON.stringify(c.from) ?? '—')}</td><td class="mono">${esc(JSON.stringify(c.to) ?? '—')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">none</td></tr>'}</tbody></table></div>`;
    }
  }

  function documents() {
    const v = $('[data-view="documents"]');
    const docs = m.documents ?? [];
    const targets = [{ id: '', name: 'the site (unattached)' }, ...(s ? s.devices.map((d) => ({ id: `${s.stationName}|h:${s.handles[d.path] ?? ''}`, name: d.name })) : [])];
    v.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Drawings and submittals · ${docs.length}</h3><span class="muted">Floor plans, mechanical sheets, submittals, photos. Recognised by content (PDF, PNG, JPEG, SVG, DXF, DWG), kept encrypted with the other artifacts, served only to someone who may read this site, never by a public link. Attach one to a device so it travels with the equipment.</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>Document</th><th>Type</th><th class="num">Bytes</th><th>Kind</th><th>Attached to</th><th>By</th><th></th></tr></thead><tbody>
      ${docs.map((d) => `<tr class="doc-row"><td><b>${esc(d.name)}</b></td><td class="mono">${esc(d.mime)}</td><td class="num">${d.size.toLocaleString()}</td><td>${may('facts.confirm') ? `<select data-kind="${esc(d.sha256)}">${['drawing', 'mechanical', 'electrical', 'floor plan', 'submittal', 'sequence', 'photo', 'other'].map((k) => `<option ${k === d.kind ? 'selected' : ''}>${k}</option>`).join('')}</select>` : esc(d.kind)}</td><td>${may('facts.confirm') ? `<select data-attach="${esc(d.sha256)}">${targets.map((t) => `<option value="${esc(t.id)}" ${t.id === (d.attachedTo ?? '') ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : esc(d.attachedToName ?? 'the site')}</td><td>${d.by ? prov('confirmed', d.by) + ' ' + esc(d.by) : prov('imported', d.importedAt)}</td><td><a href="/api/documents/${esc(d.sha256)}" target="_blank" rel="noopener">open</a></td></tr>`).join('') || `<tr><td colspan="7" class="empty">No drawings yet. Drop a PDF or an image on the page.</td></tr>`}
      </tbody></table></div></div>`;
    const save = async (sha) => { const kind = $(`[data-kind="${CSS.escape(sha)}"]`, v)?.value; const entity = $(`[data-attach="${CSS.escape(sha)}"]`, v)?.value || null; const r = await fetch(`/api/documents/${sha}/attach`, { method: 'POST', body: JSON.stringify({ entity, kind }) }); const j = await r.json(); if (!r.ok) toast(j.error, true); else toast(`Attached ${j.document.name} to ${j.document.attachedToName ?? 'the site'}`); };
    $$('[data-kind], [data-attach]', v).forEach((el) => el.addEventListener('change', () => save(el.dataset.kind ?? el.dataset.attach)));
  }

  function artifacts() {
    const v = $('[data-view="artifacts"]');
    v.innerHTML = `<div class="panel"><div class="panel-head"><h3>Artifacts · ${m.artifacts.length}</h3><span class="muted mono">in memory · never written to disk</span></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Kind</th><th>Format</th><th class="num">Bytes</th><th class="mono">SHA-256</th><th>Imported</th></tr></thead><tbody>
      ${m.artifacts.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td>${a.kind}</td><td class="mono">${a.format}</td><td class="num">${a.size.toLocaleString()}</td><td class="mono">${a.sha256.slice(0, 20)}…</td><td class="mono">${a.importedAt.slice(11, 19)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nothing imported.</td></tr>'}
      </tbody></table></div></div>
      ${s ? `<div class="split"><div class="panel"><div class="panel-head"><h3>Redacted · ${s.redactions.length}</h3><span class="muted mono">values never read</span></div><div class="panel-body"><ul class="list">${s.redactions.map((r) => `<li><span class="mono">${esc(r.locator)}</span><span class="muted">${esc(r.kind)}</span></li>`).join('') || '<li class="muted">none found</li>'}</ul></div></div>
      <div class="panel"><div class="panel-head"><h3>Unknown types · ${Object.keys(s.unknownTypes).length}</h3><span class="muted mono">counted, not guessed</span></div><div class="panel-body"><ul class="list">${Object.entries(s.unknownTypes).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<li><span class="mono">${esc(t)}</span><span class="mono muted">×${n}</span></li>`).join('') || '<li class="muted">none</li>'}</ul></div></div></div>` : ''}`;
  }
  $$('.bar .track i').forEach((i) => i.style.setProperty('width', i.dataset.w + '%'));
}

nav(location.hash.slice(1) || 'overview');
load();
fetch('/api/me').catch(() => {});
