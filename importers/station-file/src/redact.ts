// Replace secrets in the object graph before anything is read from it. The value is dropped, not carried.
import type { Redaction } from '@archipelago/core';
import type { GraphNode } from './graph.ts';
import { walk } from './graph.ts';

const SECRET_TYPE = /:(Password|Passphrase|Secret|Credential|ApiKey|Token)$/i;
const SECRET_NAME = /^(password|passphrase|secret|apiKey|apiToken|token|clientSecret|privateKey|storepass|keypass)$/i;

export function redactGraph(root: GraphNode): Redaction[] {
  const out: Redaction[] = [];
  for (const n of walk(root)) {
    if (n.value === undefined) continue;
    const kind = n.type && SECRET_TYPE.test(n.type) ? n.type : SECRET_NAME.test(n.name) ? 'named-secret' : null;
    if (kind) { n.value = '[redacted]'; out.push({ locator: n.path, kind }); }
  }
  return out;
}
