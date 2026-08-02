/**
 * Bundle the on-page Zcash wallet helpers for ziving.org.
 *
 *   node wallet/build.mjs
 *
 * Writes site/lib/zcash-wallet.js (+ copies WASM assets).
 */

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
// A Jenkins workspace is not a sibling of the WINBIT32 checkout, so CI
// passes the path in rather than relying on the developer's layout.
const winbit = process.env.WINBIT32_DIR || resolve(root, '..', 'WINBIT32');
const outDir = resolve(root, 'site', 'lib');
const orchardOut = resolve(outDir, 'orchard-frost');

const webzjsSrc = resolve(winbit, 'src/components/toolbox/zcash-extensions/utils/webzjs_keys_and_send_fixed.js');
const webzjsWasm = resolve(winbit, 'public/webzjs_keys_and_send_bg.wasm');
const orchardDir = resolve(winbit, 'public/orchard-frost');
const kitEntry = resolve(winbit, 'packages/wallet-kit/src/index.ts');
const bip39 = resolve(winbit, 'node_modules/@scure/bip39');

mkdirSync(resolve(here, 'vendor'), { recursive: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(orchardOut, { recursive: true });

copyFileSync(webzjsSrc, resolve(here, 'vendor/webzjs_keys_and_send_fixed.js'));
copyFileSync(webzjsWasm, resolve(outDir, 'webzjs_keys_and_send_bg.wasm'));
for (const f of ['orchard_frost_wasm.js', 'orchard_frost_wasm_bg.wasm', 'orchard_frost_wasm.d.ts', 'package.json']) {
	const src = resolve(orchardDir, f);
	if (existsSync(src)) copyFileSync(src, resolve(orchardOut, f));
}

if (!existsSync(bip39)) {
	throw new Error(`@scure/bip39 not found at ${bip39} — run npm install in WINBIT32 first`);
}

/**
 * The signer's cache-busting token is its own content hash.
 *
 * It used to be a hand-written `?v=nu63`, bumped in a separate commit from
 * the rebuild. That is a step someone eventually forgets, and when they do
 * the deploy succeeds while donors keep the old signer for a day —
 * nginx serves .wasm with max-age=86400 and the URL never changed. A
 * consensus-critical signer that silently does not update is the same
 * failure mode as an RNG that silently degrades: the operation reports
 * success and nobody is told.
 *
 * Deriving the token from the bytes makes forgetting impossible: change
 * the signer and the URL changes with it; change nothing and browsers
 * rightly keep what they have.
 */
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const gitCommitFor = (repo, path) => {
	try {
		const out = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%h %ad %s', '--date=short', '--', path], {
			encoding: 'utf8',
		}).trim();
		// Empty means the file is untracked: WINBIT32 gitignores
		// public/orchard-frost, which ci/build-frost-wasm.sh regenerates.
		// Say so rather than leaving a blank that reads like a bug.
		return out || 'untracked in WINBIT32 (built by ci/build-frost-wasm.sh)';
	} catch {
		return 'unknown';
	}
};

const signerHash = sha256(webzjsWasm);
const signerToken = signerHash.slice(0, 12);

const banner = `/* GENERATED — do not edit.
 * Rebuild: npm run build:wallet (from ziving/)
 * On-page Zcash donation wallet: WebZjs create/phrase + @winbit32/wallet-kit .wult/locket.
 */`;

await build({
	entryPoints: [resolve(here, 'index.mjs')],
	outfile: resolve(outDir, 'zcash-wallet.js'),
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: ['es2020'],
	minify: true,
	sourcemap: true,
	legalComments: 'none',
	banner: { js: banner },
	alias: {
		'@winbit32/wallet-kit': kitEntry,
		'@scure/bip39': resolve(bip39, 'index.js'),
		'@scure/bip39/wordlists/english': resolve(bip39, 'wordlists/english.js'),
	},
	define: {
		__SIGNER_TOKEN__: JSON.stringify(signerToken),
	},
	loader: {
		'.ts': 'ts',
	},
	logLevel: 'info',
});

/**
 * Provenance, so "is the live signer current?" has an answer that is not
 * `ls -la`. wallet/check-signer.mjs reads this; so can a human.
 */
const manifest = {
	// Deliberately no build timestamp: the manifest is a pure function of
	// its inputs, so rebuilding without changing anything produces no diff.
	// A timestamp would make every rebuild look like a change and train
	// everyone to ignore changes to this file, which is the one file whose
	// changes matter. When it was built is in the git history and the
	// Jenkins build record.
	source: 'WINBIT32 (built from the working tree, not a release)',
	signer: {
		file: 'webzjs_keys_and_send_bg.wasm',
		sha256: signerHash,
		bytes: readFileSync(webzjsWasm).length,
		cacheToken: signerToken,
		winbit32Commit: gitCommitFor(winbit, 'public/webzjs_keys_and_send_bg.wasm'),
	},
	glue: {
		file: 'wallet/vendor/webzjs_keys_and_send_fixed.js',
		sha256: sha256(webzjsSrc),
		winbit32Commit: gitCommitFor(winbit, 'src/components/toolbox/zcash-extensions/utils/webzjs_keys_and_send_fixed.js'),
	},
	orchardFrost: {
		file: 'orchard-frost/orchard_frost_wasm_bg.wasm',
		sha256: existsSync(resolve(orchardDir, 'orchard_frost_wasm_bg.wasm'))
			? sha256(resolve(orchardDir, 'orchard_frost_wasm_bg.wasm'))
			: null,
		winbit32Commit: gitCommitFor(winbit, 'public/orchard-frost/orchard_frost_wasm_bg.wasm'),
	},
	bundle: {
		file: 'zcash-wallet.js',
		sha256: sha256(resolve(outDir, 'zcash-wallet.js')),
	},
};

writeFileSync(resolve(outDir, 'signer-manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);

console.log('Wrote', resolve(outDir, 'zcash-wallet.js'));
console.log(`Signer ${signerToken} (${manifest.signer.bytes} bytes) — ${manifest.signer.winbit32Commit}`);
