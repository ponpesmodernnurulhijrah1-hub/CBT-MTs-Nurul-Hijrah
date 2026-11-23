import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const SCHEMA_VERSION = 7;

export function readSourceAppVersion(rootDir: string): string {
  try {
    const versionFile = path.resolve(rootDir, 'src/config/version.ts');
    const raw = fs.readFileSync(versionFile, 'utf8');
    const match = raw.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (match?.[1]) return match[1].trim();
  } catch {
    // Fallback below
  }
  return '2026.11.22-v7';
}

function collectSourceFiles(dirPath: string, out: string[]) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (!entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
}

/**
 * Computes a deterministic 16-char SHA-256 content hash across all non-test client/server
 * source files so Vite's baked-in __APP_BUILD_HASH__ and Express's /api/version manifest
 * always match byte-for-byte when up to date and diverge immediately on any edit.
 */
export function computeDeterministicSourceHash(rootDir: string, version: string): string {
  const hash = crypto.createHash('sha256').update(`v:${version}:s:${SCHEMA_VERSION}`);
  const files: string[] = [];
  collectSourceFiles(path.resolve(rootDir, 'src'), files);
  for (const rootFile of ['index.html', 'package.json', 'vite.config.ts']) {
    const p = path.resolve(rootDir, rootFile);
    if (fs.existsSync(p)) files.push(p);
  }
  files.sort();

  for (const file of files) {
    try {
      const rel = path.relative(rootDir, file).replace(/\\/g, '/');
      const content = fs.readFileSync(file);
      hash.update(`|${rel}:`);
      hash.update(content);
    } catch {
      // Ignore transient file reads during edits
    }
  }

  return hash.digest('hex').slice(0, 16);
}

export interface BuildManifest {
  version: string;
  buildHash: string;
  buildId: string;
  schemaVersion: number;
  builtAt?: string;
}

export function computeRuntimeVersionManifest(
  rootDir: string,
  preferDistManifest: boolean
): BuildManifest {
  if (preferDistManifest) {
    const distManifestPath = path.resolve(rootDir, 'dist/version.json');
    if (fs.existsSync(distManifestPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(distManifestPath, 'utf8')) as Partial<BuildManifest>;
        if (parsed.version && (parsed.buildHash || parsed.buildId)) {
          const hash = String(parsed.buildHash || parsed.buildId);
          return {
            version: String(parsed.version),
            buildHash: hash,
            buildId: hash,
            schemaVersion: Number(parsed.schemaVersion) || SCHEMA_VERSION,
            builtAt: parsed.builtAt,
          };
        }
      } catch {
        // Fallback to source hash below
      }
    }
  }

  const version = readSourceAppVersion(rootDir);
  const buildHash = computeDeterministicSourceHash(rootDir, version);
  return {
    version,
    buildHash,
    buildId: buildHash,
    schemaVersion: SCHEMA_VERSION,
  };
}
