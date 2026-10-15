// Atoll preview UI. Vanilla, no framework, no inline code (strict CSP). Talks only to its own origin.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const refKey = (ref) => Object.keys(ref).filter((k) => k !== 'connector').sort().map((k) => `${k}=${ref[k]}`).join('|');
const state = { model: null, view: 'overview', selectedDevice: null, filter: '', simulate: false, changed: new Set() };

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
async function load() { state.model = await (await fetch('/api/model')).json(); render(); }
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
  if (!r) return `<td class="val muted" data-val="${esc(refKey(ref))}">${state.simulate ? '…' : 'no connector'}</td>`;
  return `<td class="val" data-val="${esc(refKey(ref))}">${fmt(r.value, kind)} ${prov(r.source === 'simulated' ? 'simulated' : 'observed', r.at)}</td>`;
}
function fmt(v, kind) { if (v === null || v === undefined) return '—'; if (typeof v === 'boolean') return v ? 'on' : 'off'; if (typeof v === 'number') return kind === 'enum' ? String(v) : v.toFixed(1); return esc(v); }
function patchValue(k, r) { for (const td of $$(`[data-val="${CSS.escape(k)}"]`)) { td.classList.remove('muted'); td.innerHTML = `${fmt(r.value)} ${prov(r.source === 'simulated' ? 'simulated' : 'observed', r.at)}`; td.classList.remove('changed'); void td.offsetWidth; td.classList.add('changed'); } }
function bindingText(b) { return b ? `${b.objectType ?? '?'}:${b.instance ?? '?'} @ ${b.device ?? '?'}` : ''; }

function render() {
  const m = state.model; if (!m) return;
  const s = m.station;
  $('[data-site]').innerHTML = s ? `${esc(s.stationName || 'station')} <span class="muted">· ${s.artifact.format} · ${s.components} components</span>` : 'No station imported';
  const qc = $('[data-qcount]'); qc.textContent = m.questions.length; qc.toggleAttribute('data-zero', !m.questions.length);
  $('[data-status]').textContent = `${m.artifacts.length} artifact${m.artifacts.length === 1 ? '' : 's'} · ${Object.keys(m.readings).length} live values`;
  renderConn();
  ({ overview, devices, points, controllers, questions, artifacts })[state.view]?.();

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
        ${tile(m.questions.length, 'questions', 'for a technician', m.questions.length ? 'q' : '')}
      </div>
      <div class="split">
        <div class="panel"><div class="panel-head"><h3>Coverage</h3><span class="muted mono">${s ? s.elapsedMs + ' ms' : ''}</span></div><div class="panel-body bars">${s ? Object.entries(s.coverage).map(([k, c]) => bar(k, c)).join('') : '<span class="muted">no station</span>'}</div></div>
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
    if (!s) { v.innerHTML = `<div class="panel"><div class="empty"><b>No station imported</b>Devices come from the station backup.</div></div>`; return; }
    const sel = state.selectedDevice ?? s.devices[0]?.path; state.selectedDevice = sel;
    const d = s.devices.find((x) => x.path === sel);
    const ctl = m.controllers.find((c) => c.matchedDevice === sel);
    v.innerHTML = `<div class="split">
      <div class="panel"><div class="panel-head"><h3>Devices · ${s.devices.length}</h3></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Driver</th><th class="mono">Instance</th><th class="num">Points</th><th>Controller file</th></tr></thead><tbody>
        ${s.devices.map((x) => `<tr class="clickable ${x.path === sel ? 'is-selected' : ''}" data-dev="${esc(x.path)}"><td><b>${esc(x.name)}</b></td><td class="kind">${esc(x.type)}</td><td class="mono">${x.instance ?? '<span class="muted">none</span>'}</td><td class="num">${x.points}</td><td>${m.controllers.filter((c) => c.matchedDevice === x.path).map((c) => `<span class="tag">${esc(c.artifact.name)}</span>`).join('') || '<span class="muted">—</span>'}</td></tr>`).join('')}
      </tbody></table></div></div>
      ${d ? devicePanel(d, ctl) : ''}
    </div>`;
    $$('[data-dev]', v).forEach((tr) => tr.addEventListener('click', () => { state.selectedDevice = tr.dataset.dev; devices(); }));
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
    v.innerHTML = m.questions.length ? `<p class="lede">What Atoll could not establish from the files. It asks; it does not invent. Answering is the next slice (confirm or reject writes a new fact that supersedes the inference).</p>` + m.questions.map((q) => `<div class="q"><div class="who">${esc(q.kind)} · ${esc(q.subject)}</div><div>${esc(q.text)}</div><div class="ev">${q.evidence.map(esc).join('\n')}</div></div>`).join('') : `<div class="panel"><div class="empty"><b>No open questions</b>Everything imported so far was understood, or nothing is imported yet.</div></div>`;
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
