// Prints one version's section of CHANGELOG.md (for the GitHub release body).
//   node scripts/release-notes.mjs 1.0.0
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] || '').replace(/^v/, '');
const text = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const m = new RegExp(`^## v${version.replace(/\./g, '\\.')}\\s*\\n([\\s\\S]*?)(?=^## v|$(?![\\s\\S]))`, 'm').exec(text);
if (!m) { console.error(`No changelog entry for v${version}`); process.exit(1); }
console.log(m[1].trim());
