// A station file's object graph as a generic tree. Format knowledge recorded from observation of synthetic
// stations: the root element is <bajaObjectGraph>; every slot or component is <p> with n (name), h (handle),
// t (type as prefix:Name), v (value), f (flags); m="prefix=module ..." binds a type prefix. Observed: a binding
// is document-global from the element that declares it onward, in document order, not scoped to its subtree
// (a prefix declared on one branch is used on later sibling branches). A later declaration overrides.
import { Refused } from './caps.ts';
import type { XmlElement } from './xml.ts';

export interface GraphNode {
  name: string;
  path: string;            // slash path from the root, '/' for the root
  handle?: string;
  type?: string;           // resolved 'module:Name'
  rawType?: string;        // as written, when the prefix could not be resolved
  value?: string;
  flags?: string;
  children: GraphNode[];
  line: number;
}
export interface Graph { root: GraphNode; version: string; nodes: number; warnings: string[] }

function bind(attr: string | undefined, m: Map<string, string>): void {
  if (!attr) return;
  for (const part of attr.split(/[\s,;]+/)) { const eq = part.indexOf('='); if (eq > 0) m.set(part.slice(0, eq), part.slice(eq + 1)); }
}

export function toGraph(root: XmlElement): Graph {
  if (root.name !== 'bajaObjectGraph') throw new Refused(`not a station object graph: root element is <${root.name}>`);
  const warnings: string[] = [];
  let nodes = 0;
  const seen = new Set<string>();
  const b = new Map<string, string>();
  const conv = (el: XmlElement, path: string): GraphNode => {
    nodes++;
    bind(el.attrs.m, b);
    const node: GraphNode = { name: el.attrs.n ?? '', path, children: [], line: el.line };
    if (el.attrs.h !== undefined) node.handle = el.attrs.h;
    if (el.attrs.v !== undefined) node.value = el.attrs.v;
    if (el.attrs.f !== undefined) node.flags = el.attrs.f;
    if (el.attrs.t !== undefined) {
      const t = el.attrs.t; const c = t.indexOf(':');
      if (c < 0) node.type = t;
      else {
        const mod = b.get(t.slice(0, c));
        if (mod) node.type = `${mod}:${t.slice(c + 1)}`;
        else { node.rawType = t; if (!seen.has(t.slice(0, c))) { seen.add(t.slice(0, c)); warnings.push(`unbound type prefix "${t.slice(0, c)}" at ${path}`); } }
      }
    }
    for (const ch of el.children) if (ch.name === 'p') node.children.push(conv(ch, path === '/' ? `/${ch.attrs.n ?? ''}` : `${path}/${ch.attrs.n ?? ''}`));
    return node;
  };
  const first = root.children.find((c) => c.name === 'p');
  if (!first) throw new Refused('station object graph has no root component');
  const g = conv(first, '/');
  return { root: g, version: root.attrs.version ?? '', nodes, warnings };
}

export function child(n: GraphNode, name: string): GraphNode | undefined { return n.children.find((c) => c.name === name); }
export function* walk(n: GraphNode): Generator<GraphNode> { yield n; for (const c of n.children) yield* walk(c); }
