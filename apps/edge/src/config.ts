// Where Atoll keeps its things when installed as a program, and the site configuration the setup screen writes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

export interface AtollConfig {
  siteName: string;
  port: number;
  setupDone: boolean;
  simulate: boolean;
  bacnet: { enabled: boolean; broadcast: string; bind: string; port: number; pollMs: number; targets: string[] };
  adminName: string;
  /** folders on this machine to scan for records: a station folder, a backups folder, a programs folder */
  sources: Array<{ label: string; path: string; intervalMin: number }>;
}
export const DEFAULT_CONFIG: AtollConfig = { siteName: '', port: 2865, setupDone: false, simulate: false, bacnet: { enabled: false, broadcast: '255.255.255.255', bind: '0.0.0.0', port: 47808, pollMs: 5000, targets: [] }, adminName: '', sources: [] };

/** The per-user application folder: ~/Library/Application Support/Atoll, %APPDATA%\Atoll, or ~/.local/share/atoll. */
export function defaultDataDir(): string {
  const h = homedir();
  if (platform() === 'darwin') return join(h, 'Library', 'Application Support', 'Atoll');
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(h, 'AppData', 'Roaming'), 'Atoll');
  return join(process.env.XDG_DATA_HOME ?? join(h, '.local', 'share'), 'atoll');
}
export function loadConfig(dir: string): AtollConfig {
  const f = join(dir, 'config.json');
  if (!existsSync(f)) return { ...DEFAULT_CONFIG, bacnet: { ...DEFAULT_CONFIG.bacnet } };
  try { const j = JSON.parse(readFileSync(f, 'utf8')); return { ...DEFAULT_CONFIG, ...j, bacnet: { ...DEFAULT_CONFIG.bacnet, ...(j.bacnet ?? {}) }, sources: Array.isArray(j.sources) ? j.sources : [] }; } catch { return { ...DEFAULT_CONFIG }; }
}
export function saveConfig(dir: string, cfg: AtollConfig) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg, null, 2)); }
