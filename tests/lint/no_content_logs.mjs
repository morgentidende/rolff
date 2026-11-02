// CI guard: no console.* call may log message text or other user content.
// Flags console.(log|info|warn|error|debug) whose arguments (outside string literals) reference a
// content-like identifier. Run: node tests/lint/no_content_logs.mjs [files...]
import fs from 'fs'; import path from 'path';
const FORBIDDEN = ['body', 'text', 'msg', 'msgs', 'content', 'word', 'words', 'alias', 'email', 'password', 'pw', 'ctx', 'prompt', 'payload', 'messages', 'spans'];
const roots = ['supabase/functions', 'apps/web/src'];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : /\.(ts|tsx|mjs|js)$/.test(e.name) ? [path.join(d, e.name)] : []);
export function argsOf(src, start) { // src[start] === '('
  let depth = 0, i = start, q = null;
  for (; i < src.length; i++) { const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(') depth++; else if (c === ')' && --depth === 0) break; }
  return src.slice(start + 1, i);
}
export function stripStrings(s) {
  return s.replace(/`(?:\\.|[^`\\])*`/g, (t) => (t.match(/\$\{[^}]*\}/g) ?? []).join(' '))
          .replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
}
export function check(src) {
  const bad = []; const re = /console\.(log|info|warn|error|debug)\s*\(/g; let m;
  while ((m = re.exec(src))) {
    const args = stripStrings(argsOf(src, m.index + m[0].length - 1));
    const ids = args.match(/[A-Za-z_$][\w$]*/g) ?? [];
    const hit = ids.find((x) => FORBIDDEN.includes(x));
    if (hit) bad.push({ line: src.slice(0, m.index).split('\n').length, id: hit });
  }
  return bad;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : roots.flatMap(walk);
  let n = 0;
  for (const f of files) for (const b of check(fs.readFileSync(f, 'utf8'))) { n++; console.error(`${f}:${b.line}: console.* references "${b.id}" – logging user content is forbidden`); }
  if (n) process.exit(1); console.log(`no-content-logs: ${files.length} files OK`);
}
