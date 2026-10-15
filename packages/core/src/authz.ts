// Authorization. One pure function every surface calls. Permissions are data; identity is the caller's problem.
export type Capability =
  | 'model.read'          // see the model, values, questions, history
  | 'questions.answer'    // answer a question (writes a confirmed fact)
  | 'facts.confirm'       // confirm, reject or override any fact
  | 'config.import'       // import engineering files
  | 'config.connectors'   // add, remove, configure connectors
  | 'config.theme'        // set the site's starting theme and identity
  | 'record.intake'       // declare what the site should have on file and who owes it
  | 'record.export'       // take the whole record out, including the original artifacts
  | 'points.write'        // command a point through a connector (separate by design; no connector implements it yet)
  | 'admin.users'         // grant and revoke roles and scopes
  | 'admin.site';         // reset, retention, site-wide settings

export type Role = 'viewer' | 'operator' | 'technician' | 'engineer' | 'administrator';

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  viewer: ['model.read'],
  operator: ['model.read', 'questions.answer'],
  technician: ['model.read', 'questions.answer', 'facts.confirm', 'config.import'],
  engineer: ['model.read', 'questions.answer', 'facts.confirm', 'config.import', 'config.connectors', 'config.theme', 'record.intake', 'record.export'],
  administrator: ['model.read', 'questions.answer', 'facts.confirm', 'config.import', 'config.connectors', 'config.theme', 'record.intake', 'record.export', 'admin.users', 'admin.site'],
};
export const ALL_CAPABILITIES: Capability[] = ['model.read', 'questions.answer', 'facts.confirm', 'config.import', 'config.connectors', 'config.theme', 'record.intake', 'record.export', 'points.write', 'admin.users', 'admin.site'];

/** A role held over a scope. Scope '/' is everything; any other scope is an entity path prefix. */
export interface Grant { role: Role; scope: string; extra?: Capability[] }
export interface Principal { id: string; name: string; grants: Grant[] }

export const ANONYMOUS: Principal = { id: 'anonymous', name: 'anonymous', grants: [] };

function scopeCovers(scope: string, target: string): boolean {
  if (scope === '/' || scope === '') return true;
  return target === scope || target.startsWith(scope.endsWith('/') ? scope : scope + '/');
}

/** The one decision. `target` is the entity path the action touches; omit it for site-wide actions ('/'). */
export function can(p: Principal, capability: Capability, target = '/'): boolean {
  for (const g of p.grants) {
    if (!scopeCovers(g.scope, target)) continue;
    if (ROLE_CAPABILITIES[g.role].includes(capability) || g.extra?.includes(capability)) return true;
  }
  return false;
}

export class Forbidden extends Error { constructor(public capability: Capability, public target: string, public principal: string) { super(`${principal} lacks ${capability} on ${target}`); this.name = 'Forbidden'; } }
/** Throwing form, for servers and tools. */
export function require(p: Principal, capability: Capability, target = '/'): void { if (!can(p, capability, target)) throw new Forbidden(capability, target, p.name); }

/** What a principal may do at a given target: the UI uses this to decide what to render. The server still checks. */
export function capabilitiesAt(p: Principal, target = '/'): Capability[] { return ALL_CAPABILITIES.filter((c) => can(p, c, target)); }
