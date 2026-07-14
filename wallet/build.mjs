/**
 * Bundle the on-page Zcash wallet helpers for ziving.org.
 *
 *   node wallet/build.mjs
 *
 * Writes site/lib/zcash-wallet.js (+ copies WASM assets).
 */

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const winbit = resolve(root, '..', 'WINBIT32');
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
	loader: {
		'.ts': 'ts',
	},
	logLevel: 'info',
});

console.log('Wrote', resolve(outDir, 'zcash-wallet.js'));
