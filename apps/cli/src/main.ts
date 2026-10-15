#!/usr/bin/env -S npx tsx
// archipelago: the command line. `inspect` reads one file and prints what it contains. Nothing leaves the machine.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { inspect, renderText, CapExceeded, Refused } from '@archipelago/importer-station-file';
import { createEdge, defaultDataDir, loadConfig, saveConfig } from '@archipelago/edge';
import { spawn } from 'node:child_process';
import { startSimDevice, LAB_VAV } from '@archipelago/connector-bacnet-ip/testdevice';

const HELP = `archipelago <command> [options]

  inspect <file>      what a station backup (.bog, .dist) contains: devices, points, histories, alarms,
                      links, native addresses, unknown types, redacted secrets. Offline. Writes nothing.
      --json          machine-readable output
  serve [files...]    start the Atoll preview runtime on 127.0.0.1 and open the web UI. Files given are imported
                      at start. Everything stays in memory on this machine.
      --port <n>      default 2865
      --simulate      a simulated connector invents live values for every native address (no building needed)
      --data <dir>    keep the model on disk in this folder (event log + artifacts encrypted at rest); omit for memory only
      --installed     use the per-user application folder for data and configuration, and run first-time setup
      --bacnet <bcast> turn on the BACnet/IP read-only connector with this broadcast address (e.g. 192.168.1.255)
      --lab-device    start two synthetic BACnet devices on this machine so discovery has something to find
      --open          open the web UI in the default browser

Examples
  archipelago inspect backup.dist
  archipelago inspect config.bog --json
  archipelago serve --simulate backup.dist VAV_01.caf
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: { json: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false }, port: { type: 'string' }, simulate: { type: 'boolean', default: false }, data: { type: 'string' }, installed: { type: 'boolean', default: false }, bacnet: { type: 'string' }, 'lab-device': { type: 'boolean', default: false }, open: { type: 'boolean', default: false } }, allowPositionals: true });
  let [cmd, file] = positionals;
  let isSea = false; try { isSea = !!(process as any).getBuiltinModule?.('node:sea')?.isSea?.(); } catch {}
  if (!cmd && isSea) { cmd = 'serve'; values.installed = true; values.open = true; }   // double-clicked or run bare: the installed experience
  if (values.help || !cmd) { process.stdout.write(HELP); return cmd ? 0 : 2; }
  if (cmd === 'serve') {
    const dataDir = values.data ?? (values.installed ? defaultDataDir() : undefined);
    const config = dataDir && values.installed ? loadConfig(dataDir) : undefined;
    if (config && !config.setupDone) saveConfig(dataDir!, config);
    const labs: Array<{ close: () => Promise<void> }> = [];
    if (values['lab-device']) { for (const [inst, name] of [[2001, 'VAV_01'], [2002, 'VAV_02']] as const) { const d = await startSimDevice({ ...LAB_VAV(inst, name), bind: '0.0.0.0', port: inst === 2001 ? 47809 : 47810 }); labs.push(d); process.stdout.write(`lab device ${name} (instance ${inst}) answering on UDP ${d.port}\n`); } }
    const bacnet = values.bacnet ? { broadcast: values.bacnet, targets: values['lab-device'] ? ['127.0.0.1:47809', '127.0.0.1:47810'] : [] } : values['lab-device'] ? { broadcast: '127.0.0.1', targets: ['127.0.0.1:47809', '127.0.0.1:47810'] } : undefined;
    if (config && values['lab-device'] && !config.bacnet.targets.length) config.bacnet.targets = ['127.0.0.1:47809', '127.0.0.1:47810'];
    const edge = createEdge({ port: values.port ? Number(values.port) : config?.port ?? 2865, simulate: config?.simulate ?? values.simulate, ...(dataDir ? { dataDir } : {}), ...(config ? { config } : {}), ...(bacnet ? { bacnet } : {}) });
    for (const f of positionals.slice(1)) { try { const a = await edge.preload(f.split(/[\\/]/).pop() ?? f, readFileSync(f)); process.stdout.write(`imported ${a.name} (${a.kind}, ${a.format})\n`); } catch (e) { process.stderr.write(`${f}: ${(e as Error).message}\n`); } }
    const { port, host } = await edge.listen();
    const url = `http://${host}:${port}`;
    process.stdout.write(`\n  Atoll ${config ? (config.setupDone ? `· ${config.siteName}` : '· first-time setup') : 'preview'}\n  ${url}\n  local only · ${dataDir ? 'data in ' + dataDir : 'in-memory'} · ${values.simulate || config?.simulate ? 'simulated connector · ' : ''}${bacnet || config?.bacnet.enabled ? 'BACnet/IP read-only' : 'no live connector'}\n  Ctrl+C to stop. Nothing leaves this machine.\n\n`);
    if (values.open) { const o = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]; try { spawn(o[0] as string, o[1] as string[], { detached: true, stdio: 'ignore' }).unref(); } catch {} }
    const stop = async () => { for (const l of labs) await l.close(); await edge.close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    await new Promise(() => {});
    return 0;
  }
  if (cmd !== 'inspect') { process.stderr.write(`unknown command: ${cmd}\n\n${HELP}`); return 2; }
  if (!file) { process.stderr.write('inspect: a file path is required\n'); return 2; }
  let bytes: Uint8Array;
  try { bytes = readFileSync(file); } catch (e) { process.stderr.write(`cannot read ${file}: ${(e as Error).message}\n`); return 1; }
  try {
    const r = inspect(bytes);
    process.stdout.write(values.json ? JSON.stringify(r, null, 2) + '\n' : renderText(r) + '\n');
    return 0;
  } catch (e) {
    if (e instanceof Refused || e instanceof CapExceeded) { process.stderr.write(`${e.name}: ${e.message}\n`); return 3; }
    throw e;
  }
}
main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
