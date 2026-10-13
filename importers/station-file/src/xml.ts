// A small non-validating XML reader. Refuses DOCTYPE. Resolves only the five predefined entities and numeric
// character references; any other reference is kept literally and reported. No external anything.
import { Caps, CapExceeded, Refused, DEFAULT_CAPS } from './caps.ts';

export interface XmlElement { name: string; attrs: Record<string, string>; children: XmlElement[]; text: string; line: number }
export interface XmlDoc { root: XmlElement; warnings: string[]; elements: number }

const PREDEF: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeText(s: string, warnings: string[]): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) { warnings.push(`invalid character reference ${m}`); return m; }
      return String.fromCodePoint(code);
    }
    if (ref in PREDEF) return PREDEF[ref]!;
    warnings.push(`unresolved entity ${m} kept literally`);
    return m;
  });
}

export function parseXml(input: string, caps: Caps = DEFAULT_CAPS): XmlDoc {
  const warnings: string[] = [];
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let elements = 0, line = 1, i = 0;
  const n = input.length;
  const err = (msg: string) => new Refused(`xml line ${line}: ${msg}`);
  const countLines = (from: number, to: number) => { for (let k = from; k < to; k++) if (input.charCodeAt(k) === 10) line++; };

  while (i < n) {
    const lt = input.indexOf('<', i);
    if (lt < 0) { if (stack.length && input.slice(i).trim()) stack[stack.length - 1]!.text += decodeText(input.slice(i), warnings); countLines(i, n); break; }
    if (lt > i && stack.length) stack[stack.length - 1]!.text += decodeText(input.slice(i, lt), warnings);
    countLines(i, lt);
    i = lt;
    if (input.startsWith('<!--', i)) { const e = input.indexOf('-->', i + 4); if (e < 0) throw err('unterminated comment'); countLines(i, e); i = e + 3; continue; }
    if (input.startsWith('<![CDATA[', i)) { const e = input.indexOf(']]>', i + 9); if (e < 0) throw err('unterminated CDATA'); if (stack.length) stack[stack.length - 1]!.text += input.slice(i + 9, e); countLines(i, e); i = e + 3; continue; }
    if (input.startsWith('<?', i)) { const e = input.indexOf('?>', i + 2); if (e < 0) throw err('unterminated processing instruction'); countLines(i, e); i = e + 2; continue; }
    if (input.startsWith('<!', i)) {
      if (/^<!DOCTYPE/i.test(input.slice(i, i + 9))) throw err('DOCTYPE is not allowed');
      throw err('unsupported declaration');
    }
    if (input.startsWith('</', i)) {
      const e = input.indexOf('>', i + 2); if (e < 0) throw err('unterminated end tag');
      const name = input.slice(i + 2, e).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw err(`mismatched end tag </${name}>`);
      i = e + 1; continue;
    }
    // start tag
    let j = i + 1;
    while (j < n && !/[\s/>]/.test(input[j]!)) j++;
    const name = input.slice(i + 1, j);
    if (!name) throw err('empty tag name');
    const attrs: Record<string, string> = {};
    let selfClose = false;
    for (;;) {
      while (j < n && /\s/.test(input[j]!)) { if (input[j] === '\n') line++; j++; }
      if (j >= n) throw err('unterminated start tag');
      if (input[j] === '>') { j++; break; }
      if (input[j] === '/') { if (input[j + 1] !== '>') throw err('bad self-closing tag'); selfClose = true; j += 2; break; }
      let k = j;
      while (k < n && !/[\s=]/.test(input[k]!)) k++;
      const an = input.slice(j, k);
      while (k < n && /\s/.test(input[k]!)) k++;
      if (input[k] !== '=') throw err(`attribute ${an} has no value`);
      k++;
      while (k < n && /\s/.test(input[k]!)) k++;
      const q = input[k];
      if (q !== '"' && q !== "'") throw err(`attribute ${an} is not quoted`);
      const e = input.indexOf(q, k + 1); if (e < 0) throw err(`unterminated attribute ${an}`);
      const raw = input.slice(k + 1, e);
      countLines(k, e);
      attrs[an] = decodeText(raw, warnings);
      j = e + 1;
    }
    elements++;
    if (elements > caps.maxXmlElements) throw new CapExceeded(`more than ${caps.maxXmlElements} elements`);
    const el: XmlElement = { name, attrs, children: [], text: '', line };
    if (stack.length) stack[stack.length - 1]!.children.push(el);
    else if (root) throw err('more than one root element');
    else root = el;
    if (!selfClose) { stack.push(el); if (stack.length > caps.maxXmlDepth) throw new CapExceeded(`nesting deeper than ${caps.maxXmlDepth}`); }
    i = j;
  }
  if (stack.length) throw new Refused(`xml: unclosed element <${stack[stack.length - 1]!.name}>`);
  if (!root) throw new Refused('xml: no root element');
  return { root, warnings, elements };
}
