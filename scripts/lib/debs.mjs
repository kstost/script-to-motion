/**
 * debs.mjs — fetch Ubuntu/Debian packages into a user-space root, without sudo.
 *
 * Used by setup_browser.mjs (missing Chromium libraries) and setup_blender.mjs (an x86_64 runtime for
 * Blender on arm64 hosts). Packages come from the distro's official archive, are checked against the
 * SHA256 in the signed Packages index, and are unpacked with `dpkg-deb -x` — nothing is installed
 * system-wide. Library → package resolution: a caller-supplied table first, then the archive's
 * Contents index (preferring files in the standard library directory).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';

export function osRelease() {
  try {
    return Object.fromEntries(fs.readFileSync('/etc/os-release', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
    }));
  } catch {
    return {};
  }
}

export const TRIPLET = { amd64: 'x86_64-linux-gnu', arm64: 'aarch64-linux-gnu', armhf: 'arm-linux-gnueabihf', i386: 'i386-linux-gnu' };

/** archive location for this distro and a (possibly foreign) architecture; null if unsupported */
export function archiveFor(osr, arch) {
  if (osr.ID === 'ubuntu' || (osr.ID_LIKE || '').includes('ubuntu')) {
    const code = osr.UBUNTU_CODENAME || osr.VERSION_CODENAME;
    return {
      name: 'ubuntu', arch, code,
      base: ['amd64', 'i386'].includes(arch) ? 'http://archive.ubuntu.com/ubuntu' : 'http://ports.ubuntu.com/ubuntu-ports',
      pockets: [code, `${code}-updates`, `${code}-security`], comps: ['main', 'universe'],
    };
  }
  if (osr.ID === 'debian' || (osr.ID_LIKE || '').includes('debian')) {
    const code = osr.VERSION_CODENAME;
    return { name: 'debian', arch, code, base: 'http://deb.debian.org/debian', pockets: [code, `${code}-updates`], comps: ['main'] };
  }
  return null;
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf;
}
const vkey = (v) => v.split(/[^0-9A-Za-z]+/).map((x) => (/^\d+$/.test(x) ? x.padStart(10, '0') : x)).join('.');

export class DebRepo {
  /** @param {{archive: object, cacheDir: string, log?: (m: string) => void}} o */
  constructor({ archive, cacheDir, log = console.log }) {
    this.a = archive;
    this.cache = cacheDir;
    this.log = log;
    this.index = null;
  }

  async packages() {
    if (this.index) return this.index;
    this.index = {};
    const { a } = this;
    for (const pocket of a.pockets) {
      for (const comp of a.comps) {
        const file = path.join(this.cache, `Packages-${a.name}-${pocket}-${comp}-${a.arch}.gz`);
        const buf = fs.existsSync(file) ? fs.readFileSync(file) : await download(`${a.base}/dists/${pocket}/${comp}/binary-${a.arch}/Packages.gz`, file);
        if (!buf) continue;
        for (const block of zlib.gunzipSync(buf).toString('utf8').split('\n\n')) {
          const f = Object.fromEntries(block.split('\n').filter((l) => /^[A-Za-z0-9-]+:/.test(l)).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
          if (f.Package && (!this.index[f.Package] || vkey(f.Version) > vkey(this.index[f.Package].Version))) this.index[f.Package] = f;
        }
      }
    }
    return this.index;
  }

  /** library file names → package names via the Contents index (standard lib dir preferred) */
  async contents(libs) {
    const { a } = this;
    const file = path.join(this.cache, `Contents-${a.name}-${a.code}-${a.arch}.gz`);
    if (!fs.existsSync(file)) {
      this.log(`  • downloading the ${a.name} ${a.arch} Contents index (file → package map, 15–60 MB)…`);
      let ok = false;
      for (const u of [`${a.base}/dists/${a.code}/Contents-${a.arch}.gz`, `${a.base}/dists/${a.code}/main/Contents-${a.arch}.gz`]) {
        if (await download(u, file)) { ok = true; break; }
      }
      if (!ok) return {};
    }
    const want = new Set(libs);
    const std = {};
    const other = {};
    const t = TRIPLET[a.arch] || '';
    const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()) });
    for await (const line of rl) {
      const sp = line.lastIndexOf(' ');
      if (sp < 0) continue;
      const p = line.slice(0, sp).trim();
      const base = p.slice(p.lastIndexOf('/') + 1);
      if (!want.has(base)) continue;
      const pkg = line.slice(sp + 1).split(',')[0].split('/').pop();
      if (p === `usr/lib/${t}/${base}` || p === `lib/${t}/${base}`) std[base] = std[base] || pkg;
      else if (/(^|\/)(usr\/)?lib\//.test(p)) other[base] = other[base] || pkg;
    }
    return Object.fromEntries(libs.map((l) => [l, std[l] || other[l]]).filter(([, v]) => v));
  }

  /** libraries → packages: table first ({lib: [candidates]}), Contents index for the rest */
  async resolve(libs, table = {}) {
    const idx = await this.packages();
    const pkgs = new Set();
    const unknown = [];
    for (const l of libs) {
      const hit = (table[l] || []).find((p) => idx[p]);
      if (hit) pkgs.add(hit); else unknown.push(l);
    }
    if (unknown.length) {
      const found = await this.contents(unknown);
      for (const l of unknown) {
        if (found[l] && idx[found[l]]) pkgs.add(found[l]);
        else this.log(`  ⚠ no package found for ${l}`);
      }
    }
    return [...pkgs];
  }

  /** download (SHA256-checked) and unpack packages into root; returns the names actually fetched */
  async fetch(names, root, debDir) {
    const idx = await this.packages();
    const done = [];
    for (const name of names) {
      const p = idx[name];
      if (!p) throw new Error(`package ${name} not in the ${this.a.name} ${this.a.arch} archive`);
      const deb = path.join(debDir, path.basename(p.Filename));
      if (!fs.existsSync(deb)) {
        const buf = Buffer.from(await (await fetch(`${this.a.base}/${p.Filename}`)).arrayBuffer());
        if (crypto.createHash('sha256').update(buf).digest('hex') !== p.SHA256) throw new Error(`SHA256 mismatch for ${p.Filename}`);
        fs.mkdirSync(debDir, { recursive: true });
        fs.writeFileSync(deb, buf);
      }
      fs.mkdirSync(root, { recursive: true });
      execFileSync('dpkg-deb', ['-x', deb, root]);
      this.log(`  ✓ ${name} ${p.Version} (sha256 ok)`);
      done.push(name);
    }
    return done;
  }
}
