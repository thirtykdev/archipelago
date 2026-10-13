// Run the test suite with the network turned off. On Linux: a user+network namespace with loopback only.
// Elsewhere: the in-process tripwire (vitest.setup.ts) still fails any socket, DNS lookup or fetch.
import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
if (platform() === 'linux') {
  const probe = spawnSync('unshare', ['-rn', 'true']);
  if (probe.status === 0) {
    const r = spawnSync('unshare', ['-rn', '--', npm, 'test'], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  console.warn('offline-test: unshare -rn unavailable here; falling back to the in-process tripwire');
} else {
  console.warn(`offline-test: no network namespace on ${platform()}; running with the in-process tripwire only`);
}
const r = spawnSync(npm, ['test'], { stdio: 'inherit', env: { ...process.env, ARCHIPELAGO_TRIPWIRE: 'strict' } });
process.exit(r.status ?? 1);
