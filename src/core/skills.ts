import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SkillEntry {
  /** Filename slug (e.g. "ritual-dapp-http") */
  id: string;
  /** Human title from frontmatter `name:` if present, else id */
  name: string;
  /** Short description from frontmatter `description:` */
  description: string;
  /** Full markdown body (everything after the frontmatter) */
  body: string;
  /** Absolute path on disk */
  path: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Locate the bundled skills directory. Works both in development (running
 * src/ via tsx) and after `tsc` (running dist/), since we copy src/skills
 * into dist/skills at build time via the package.json `files` field.
 */
function resolveSkillsDir(subdir: string): string {
  const candidates = [
    path.resolve(__dirname, '..', 'skills', subdir),
    path.resolve(__dirname, '..', '..', 'src', 'skills', subdir),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Skills directory not found. Tried: ${candidates.join(', ')}`
  );
}

interface ParsedSkill {
  frontmatter: Record<string, string>;
  body: string;
}

function parseFrontmatter(raw: string): ParsedSkill {
  if (!raw.startsWith('---')) {
    return { frontmatter: {}, body: raw };
  }
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { frontmatter: {}, body: raw };

  const yaml = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, '');

  const frontmatter: Record<string, string> = {};
  for (const line of yaml.split('\n')) {
    const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (m) frontmatter[m[1]!] = m[2]!.trim();
  }
  return { frontmatter, body };
}

let cached: { skills: Map<string, SkillEntry>; rules: string | null } | null = null;

export function loadRitualSkills(): Map<string, SkillEntry> {
  if (cached) return cached.skills;

  const dir = resolveSkillsDir('ritual');
  const skills = new Map<string, SkillEntry>();

  for (const filename of fs.readdirSync(dir)) {
    if (!filename.endsWith('.md')) continue;
    const id = filename.replace(/\.md$/, '');
    const filePath = path.join(dir, filename);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(raw);

    skills.set(id, {
      id,
      name: frontmatter.name ?? id,
      description: frontmatter.description ?? '',
      body,
      path: filePath,
    });
  }

  // Eagerly load rules too so first MCP request is fast
  const rulesPath = path.resolve(dir, '..', 'RULES.md');
  const rules = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf-8') : null;

  cached = { skills, rules };
  return skills;
}

export function getRitualSkill(id: string): SkillEntry | undefined {
  return loadRitualSkills().get(id);
}

export function listRitualSkills(): Array<Pick<SkillEntry, 'id' | 'name' | 'description'>> {
  return Array.from(loadRitualSkills().values()).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
  }));
}

export function getRitualRules(): string {
  loadRitualSkills(); // populate cache
  if (!cached?.rules) {
    throw new Error('RULES.md not found in skills directory');
  }
  return cached.rules;
}

/** Test-only: clear cache so a different skills dir layout can be loaded. */
export function _resetSkillsCache(): void {
  cached = null;
}
