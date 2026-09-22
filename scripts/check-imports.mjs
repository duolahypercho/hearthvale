#!/usr/bin/env node
/**
 * Architecture lint: systems must not import sibling systems (talk via game.events /
 * game.services instead). Also forbids world/, render/, entities/ importing from systems/.
 *   node scripts/check-imports.mjs   (npm run lint)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.ts$/.test(f)) files.push(p);
  }
})(src);

const IMPORT = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const errors = [];
for (const file of files) {
  const rel = relative(src, file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT)) {
    const spec = m[1] ?? m[2];
    if (!spec || !spec.startsWith('.')) continue;
    const target = relative(src, resolve(dirname(file), spec));
    const fromSystems = rel.startsWith('systems/');
    const toSystems = target.startsWith('systems/');
    if (fromSystems && toSystems) errors.push(`${rel}: imports sibling system "${spec}" (use game.events / game.services)`);
    if (toSystems && /^(world|render|entities|data|ui)\//.test(rel)) errors.push(`${rel}: lower layer imports a system "${spec}"`);
  }
}
if (errors.length) {
  console.error(`✗ ${errors.length} import rule violation(s):\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log(`✓ import rules OK (${files.length} files)`);
