#!/usr/bin/env -S npx tsx
// archipelago: the command line. `inspect` reads one file and prints what it contains. Nothing leaves the machine.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { inspect, renderText, CapExceeded, Refused } from '@archipelago/importer-station-file';
import { createEdge } from '@archipelago/edge';

const HELP = `archipelago <command> [options]

  inspect <file>      what a station backup (.bog, .dist) contains: devices, points, histories, alarms,
                      links, native addresses, unknown types, redacted secrets. Offline. Writes nothing.
      --json          machine-readable output
  serve [files...]    start the Atoll preview runtime on 127.0.0.1 and open the web UI. Files given are imported
                      at start. Everything stays in memory on this machine.
      --port <n>      default 2865
      --simulate      a simulated connector invents live values for every native address (no building needed)
      --data <dir>    keep the model on disk in this folder (event log + artifacts encrypted at rest); omit for memory only

Examples
  archipelago inspect backup.dist
  archipelago inspect config.bog --json
  archipelago serve --simulate backup.dist VAV_01.caf
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: { json: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false }, port: { type: 'string', default: '2865' }, simulate: { type: 'boolean', default: false }, data: { type: 'string' } }, allowPositionals: true });
  const [cmd, file] = positionals;
  if (values.help || !cmd) { process.stdout.write(HELP); return cmd ? 0 : 2; }
  if (cmd === 'serve') {
    const edge = createEdge({ port: Number(values.port), simulate: values.simulate, ...(values.data ? { dataDir: values.data } : {}) });
    for (const f of positionals.slice(1)) { try { const a = await edge.preload(f.split(/[\\/]/).pop() ?? f, readFileSync(f)); process.stdout.write(`imported ${a.name} (${a.kind}, ${a.format})\n`); } catch (e) { process.stderr.write(`${f}: ${(e as Error).message}\n`); } }
    const { port, host } = await edge.listen();
    process.stdout.write(`Atoll preview listening on http://${host}:${port}  (local only · ${values.simulate ? 'simulated connector on' : 'no connector'} · ${values.data ? 'data in ' + values.data : 'in-memory'})\n`);
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
