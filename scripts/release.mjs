#!/usr/bin/env node
/**
 * release.mjs — bump the version, tag, and push.
 *
 * Exists because the version lived in two files that drifted apart. The
 * committed package-lock.json said 2.0.0 while package.json said 3.7.0, and
 * npm rewrites the lockfile's version to match on every install — so step 2
 * of the documented install ("npm install") dirtied the tree by itself, and
 * the updater's dirty-tree guard then refused every future update on an
 * install nobody had touched. A demo VPS bricked its own updates that way.
 *
 * Bumping both files together is the only thing that keeps them honest.
 *
 * Usage:
 *   npm run release -- 3.9.0          # bump, commit, tag, push
 *   npm run release -- 3.9.0 --dry    # show what would happen
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const version = args.find(a => /^\d+\.\d+\.\d+$/.test(a));

if (!version) {
  console.error('usage: npm run release -- <x.y.z> [--dry]');
  process.exit(2);
}

function git(...a) {
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a[0]} failed: ${(r.stderr || r.stdout || '').trim()}`);
  return (r.stdout || '').trim();
}

// Refuse on a dirty tree for the same reason the updater does: a release
// should describe a known commit, not whatever happens to be lying around.
const dirty = git('status', '--porcelain');
if (dirty && !dry) {
  console.error('Working tree is dirty. Commit or discard first:\n' + dirty);
  process.exit(1);
}

const pkgPath = path.join(ROOT, 'package.json');
const lockPath = path.join(ROOT, 'package-lock.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const from = pkg.version;
pkg.version = version;

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
lock.version = version;
if (lock.packages && lock.packages['']) lock.packages[''].version = version;

console.log(`${from} -> ${version}`);
if (dry) {
  console.log('(dry run: nothing written)');
  process.exit(0);
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');

git('add', 'package.json', 'package-lock.json');
git('commit', '-m', `chore: v${version}`);
git('tag', `v${version}`);
git('push', 'origin', 'main');
git('push', 'origin', `v${version}`);

console.log(`tagged and pushed v${version}`);
