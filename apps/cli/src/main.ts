#!/usr/bin/env -S npx tsx
// archipelago: the command line. `inspect` reads one file and prints what it contains. Nothing leaves the machine.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { inspect, renderText, CapExceeded, Refused } from '@archipelago/importer-station-file';

const HELP = `archipelago <command> [options]

  inspect <file>      what a station backup (.bog, .dist) contains: devices, points, histories, alarms,
                      links, native addresses, unknown types, redacted secrets. Offline. Writes nothing.
      --json          machine-readable output

Examples
  archipelago inspect backup.dist
  archipelago inspect config.bog --json
`;

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({ args: argv, options: { json: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false } }, allowPositionals: true });
  const [cmd, file] = positionals;
  if (values.help || !cmd) { process.stdout.write(HELP); return cmd ? 0 : 2; }
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
process.exitCode = main(process.argv.slice(2));
