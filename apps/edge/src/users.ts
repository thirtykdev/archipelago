// Principals and grants, stored as facts in the model so they replicate with it and every change has a name and
// a time. Identity (who is asking) is the server's concern; this file only answers "what may they do".
import { Model, type Grant, type Principal, type Provenance } from '@archipelago/core';

export const LOCAL_ADMIN: Principal = { id: 'local-admin', name: 'Local administrator', grants: [{ role: 'administrator', scope: '/' }] };

export class Users {
  constructor(private model: Model) {}
  private subject(id: string) { return `user|${id}`; }
  list(): Principal[] { return this.model.live('program').filter((e) => e.id.startsWith('user|')).map((e) => this.get(e.id.slice(5))!).filter(Boolean); }
  get(id: string): Principal | undefined {
    const s = this.subject(id); if (!this.model.entities.has(s) || this.model.retired.has(s)) return undefined;
    return { id, name: this.model.value<string>(s, 'name') ?? id, grants: this.model.value<Grant[]>(s, 'grants') ?? [] };
  }
  /** Create or update a principal. `by` is the administrator making the change; recorded on every fact. */
  set(id: string, name: string, grants: Grant[], by: Principal): Principal {
    const s = this.subject(id); const prov: Provenance = { kind: 'confirmed', by: by.name, at: new Date().toISOString() };
    this.model.addEntity({ id: s, kind: 'program', name, path: s });
    this.model.assert(s, 'name', name, prov); this.model.assert(s, 'grants', grants, prov);
    return this.get(id)!;
  }
  remove(id: string) { this.model.retire(this.subject(id)); }
  /** Preview seed: a few identities to switch between so the permission gates can be seen working. */
  seedPreview() {
    if (this.list().length) return;
    this.set('admin', 'Site administrator', [{ role: 'administrator', scope: '/' }], LOCAL_ADMIN);
    this.set('tech', 'Technician', [{ role: 'technician', scope: '/' }], LOCAL_ADMIN);
    this.set('ops-b', 'Night operator (BacnetNetwork only)', [{ role: 'viewer', scope: '/' }, { role: 'operator', scope: '/Drivers/BacnetNetwork' }], LOCAL_ADMIN);
    this.set('viewer', 'Viewer', [{ role: 'viewer', scope: '/' }], LOCAL_ADMIN);
  }
}
