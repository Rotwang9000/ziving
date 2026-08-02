/**
 * Is the signer donors actually load the signer we think it is?
 *
 *   node wallet/check-signer.mjs                    # repo vs WINBIT32
 *   node wallet/check-signer.mjs --docroot          # ... and /var/www/ziving.org
 *   node wallet/check-signer.mjs --live             # ... and what ziving.org serves
 *
 * Exits non-zero on any drift.
 *
 * There are four copies of the Zcash signer between WINBIT32 and a donor's
 * browser — WINBIT32 public/, ziving site/lib/, the docroot, and whatever
 * the browser has cached — and until now nothing compared them. The one
 * that bit was the last hop: the cache-busting query was hand-written, so
 * a rebuilt signer shipped under a URL browsers already had.
 *
 * A stale signer is not a cosmetic problem. It builds transactions against
 * the wrong consensus branch id, and the network rejects them; the donor
 * sees a send that fails for no reason they can act on.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
// Same override as wallet/build.mjs: CI has no sibling WINBIT32 checkout.
const winbit = process.env.WINBIT32_DIR || resolve(root, '..', 'WINBIT32');
const siteLib = resolve(root, 'site', 'lib');

const args = process.argv.slice(2);
const has = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name, fallback) => {
	const hit = args.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};

const wantAll = has('all');
const wantDocroot = wantAll || has('docroot');
// --url on its own implies you want the live check; forgetting --live and
// silently getting a repo-only pass is the kind of quiet no-op this script
// exists to prevent.
const wantLive = wantAll || has('live') || has('url');
const docroot = value('docroot', '/var/www/ziving.org');
const siteUrl = value('url', 'https://ziving.org');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const hashFile = (p) => (existsSync(p) ? sha256(readFileSync(p)) : null);
const short = (h) => (h ? h.slice(0, 12) : 'MISSING');

const problems = [];
const lines = [];

const compare = (label, expected, actual, hint) => {
	const ok = expected !== null && expected === actual;
	lines.push(`  ${ok ? 'ok  ' : 'DRIFT'} ${label.padEnd(34)} ${short(expected)} vs ${short(actual)}`);
	if (!ok) problems.push(`${label}: ${hint}`);
};

// ── 1. WINBIT32 (the source of truth) vs this repo's committed copies ──

const pairs = [
	{
		label: 'signer wasm',
		src: resolve(winbit, 'public/webzjs_keys_and_send_bg.wasm'),
		dst: resolve(siteLib, 'webzjs_keys_and_send_bg.wasm'),
	},
	{
		label: 'signer glue js',
		src: resolve(winbit, 'src/components/toolbox/zcash-extensions/utils/webzjs_keys_and_send_fixed.js'),
		dst: resolve(here, 'vendor/webzjs_keys_and_send_fixed.js'),
	},
	{
		label: 'orchard-frost wasm',
		src: resolve(winbit, 'public/orchard-frost/orchard_frost_wasm_bg.wasm'),
		dst: resolve(siteLib, 'orchard-frost/orchard_frost_wasm_bg.wasm'),
	},
	{
		label: 'orchard-frost glue js',
		src: resolve(winbit, 'public/orchard-frost/orchard_frost_wasm.js'),
		dst: resolve(siteLib, 'orchard-frost/orchard_frost_wasm.js'),
	},
];

lines.push('WINBIT32 → ziving repo');
for (const { label, src, dst } of pairs) {
	if (!existsSync(src)) {
		lines.push(`  skip  ${label.padEnd(34)} (not present in WINBIT32)`);
		continue;
	}
	compare(label, hashFile(src), hashFile(dst), 'run `npm run build:wallet` and commit the result');
}

// ── 2. The manifest must describe the files that are actually there ──

const manifestPath = resolve(siteLib, 'signer-manifest.json');
if (!existsSync(manifestPath)) {
	problems.push('signer-manifest.json missing: run `npm run build:wallet`');
	lines.push('\nmanifest\n  DRIFT signer-manifest.json               absent');
} else {
	const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
	lines.push('\nmanifest vs files on disk');
	compare('manifest signer sha256', m.signer?.sha256 ?? null, hashFile(resolve(siteLib, 'webzjs_keys_and_send_bg.wasm')),
		'the manifest was written by a different build than the wasm beside it');
	compare('manifest bundle sha256', m.bundle?.sha256 ?? null, hashFile(resolve(siteLib, 'zcash-wallet.js')),
		'the bundle changed after the manifest was written');

	// The bundle must ask for the signer by the token the manifest records.
	const bundle = readFileSync(resolve(siteLib, 'zcash-wallet.js'), 'utf8');
	const token = m.signer?.cacheToken;
	const tokenInBundle = token && bundle.includes(token);
	lines.push(`  ${tokenInBundle ? 'ok  ' : 'DRIFT'} bundle requests ?v=${token ?? '?'}`);
	if (!tokenInBundle) {
		problems.push('the bundle does not carry the signer cache token — donors may load a cached older signer');
	}
	lines.push(`  info  signer built at ${m.signer?.winbit32Commit ?? 'unknown'}`);
}

// ── 3. The docroot rsync actually happened ──

if (wantDocroot) {
	lines.push(`\nziving repo → ${docroot}`);
	for (const f of ['webzjs_keys_and_send_bg.wasm', 'zcash-wallet.js', 'orchard-frost/orchard_frost_wasm_bg.wasm']) {
		compare(f, hashFile(resolve(siteLib, f)), hashFile(resolve(docroot, 'lib', f)),
			`deploy has not run since the last build (rsync site/ → ${docroot})`);
	}
}

// ── 4. What the site actually serves, which is the only copy that matters ──

if (wantLive) {
	lines.push(`\n${siteUrl} (as a donor's browser sees it)`);
	// The token comes from the manifest, not from grepping the bundle: the
	// bundle is minified and esbuild is free to build the query string at
	// runtime, so a regex over it reports "no token" for a bundle that has
	// one — and then this check quietly fetches the un-versioned URL and
	// passes. It did exactly that on its first run.
	const token = existsSync(manifestPath)
		? JSON.parse(readFileSync(manifestPath, 'utf8')).signer?.cacheToken ?? null
		: null;

	const fetchHash = async (path) => {
		const res = await fetch(`${siteUrl}${path}`);
		if (!res.ok) return null;
		return sha256(Buffer.from(await res.arrayBuffer()));
	};

	compare('served bundle', hashFile(resolve(siteLib, 'zcash-wallet.js')), await fetchHash('/lib/zcash-wallet.js'),
		'the deployed bundle is not the built one');
	compare(
		`served signer ?v=${token ?? 'none'}`,
		hashFile(resolve(siteLib, 'webzjs_keys_and_send_bg.wasm')),
		await fetchHash(`/lib/webzjs_keys_and_send_bg.wasm${token ? `?v=${token}` : ''}`),
		'the URL the bundle requests does not return the signer we built',
	);
}

console.log(lines.join('\n'));

if (problems.length) {
	console.error(`\n${problems.length} problem(s):`);
	for (const p of problems) console.error(`  - ${p}`);
	process.exit(1);
}
console.log('\nSigner is current everywhere checked.');
