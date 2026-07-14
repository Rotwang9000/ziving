/**
 * Browser donation-wallet helpers for ziving.org.
 *
 * Create / open a Zcash UFVK + unified address without leaving the page:
 *   - Create: BIP-39 seed via WebZjs WASM
 *   - Phrase / plaintext: WebZjs
 *   - .wult / locket PNG: @winbit32/wallet-kit (unwrap + Orchard FROST derive)
 *
 * Spending keys never leave the browser. Only the UFVK is later POSTed
 * (encrypted) to the gateway for scanning.
 */

import { mnemonicToSeedSync, generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import wasmInit, {
	derive_usk_from_mnemonic,
	ufvk_from_usk,
	UnifiedSpendingKey,
	UnifiedFullViewingKey,
} from './vendor/webzjs_keys_and_send_fixed.js';
import {
	unwrapVaultShare,
	isWrappedVault,
	deriveOrchardAddressFromBundle,
	loadOrchardFrostWasm,
	resolveCosignConfig,
	deriveZcashSeedFromVaultIdentity,
} from '@winbit32/wallet-kit';
import { extractLocketShareText } from './locket-chunk.mjs';

const NETWORK = 'main';
// Resolved against the bundled module URL (site/lib/zcash-wallet.js).
const WASM_URL = new URL('./webzjs_keys_and_send_bg.wasm', import.meta.url).href;
const ORCHARD_WASM_BASE = new URL('./orchard-frost', import.meta.url).href;

let webzjsReady = null;

async function ensureWebZjs() {
	if (!webzjsReady) {
		webzjsReady = (async () => {
			const res = await fetch(WASM_URL);
			if (!res.ok) throw new Error(`Failed to load WebZjs WASM (${res.status})`);
			const bytes = await res.arrayBuffer();
			await wasmInit(bytes);
			return true;
		})();
	}
	return webzjsReady;
}

function credentials(ufvk, address, extra = {}) {
	if (typeof ufvk !== 'string' || !ufvk.startsWith('uview')) {
		throw new Error('Could not derive a UFVK (uview1…) from this wallet.');
	}
	if (typeof address !== 'string' || !address.startsWith('u')) {
		throw new Error('Could not derive a unified address (u1…) from this wallet.');
	}
	return Object.freeze({ ufvk, address, ...extra });
}

async function fromMnemonic(mnemonic, { revealPhrase = false } = {}) {
	const normalised = String(mnemonic || '').trim().toLowerCase().replace(/\s+/gu, ' ');
	if (!validateMnemonic(normalised, wordlist)) {
		throw new Error('That does not look like a valid BIP-39 seed phrase (12 or 24 English words).');
	}
	await ensureWebZjs();
	const usk = derive_usk_from_mnemonic(NETWORK, normalised, 0);
	const ufvk = ufvk_from_usk(usk, NETWORK);
	const ufvkObj = usk.to_unified_full_viewing_key();
	const address = ufvkObj.to_unified_address(NETWORK, 0);
	return credentials(ufvk, address, revealPhrase ? { phrase: normalised } : {});
}

async function fromSeedBytes(seedBytes) {
	await ensureWebZjs();
	const usk = new UnifiedSpendingKey(NETWORK, seedBytes, 0);
	const ufvk = ufvk_from_usk(usk, NETWORK);
	const ufvkObj = usk.to_unified_full_viewing_key();
	const address = ufvkObj.to_unified_address(NETWORK, 0);
	return credentials(ufvk, address);
}

async function fromUfvk(ufvkRaw) {
	const ufvk = String(ufvkRaw || '').trim();
	await ensureWebZjs();
	const ufvkObj = new UnifiedFullViewingKey(NETWORK, ufvk);
	try {
		const address = ufvkObj.to_unified_address(NETWORK, 0);
		return credentials(ufvk, address);
	} finally {
		ufvkObj.free?.();
	}
}

async function fromWultContent(content, password) {
	let share;
	try {
		share = await unwrapVaultShare(content, password);
	} catch (err) {
		const msg = err?.message ?? String(err);
		if (/password-protected/i.test(msg)) {
			const e = new Error(msg);
			e.code = 'password_required';
			throw e;
		}
		throw err;
	}

	if (share.orchardFrost) {
		const config = resolveCosignConfig({ wasmBaseUrl: ORCHARD_WASM_BASE.replace(/\/$/u, '') });
		const wasm = await loadOrchardFrostWasm(config);
		const addr = deriveOrchardAddressFromBundle(wasm, share.orchardFrost);
		if (!addr?.ufvk || !addr?.unifiedAddress) {
			throw new Error('This share has Orchard FROST keys but address derivation failed.');
		}
		return credentials(addr.ufvk, addr.unifiedAddress, { source: 'wult-frost' });
	}

	if (share.crossChainIdentity) {
		const seed = await deriveZcashSeedFromVaultIdentity(
			share.crossChainIdentity.hexChainCode,
			share.crossChainIdentity.publicKeyEcdsa,
		);
		const out = await fromSeedBytes(seed);
		return credentials(out.ufvk, out.address, { source: 'wult-identity' });
	}

	throw new Error('This .wult has no Orchard keys or vault identity we can turn into a donation address.');
}

function looksLikePhrase(text) {
	const words = String(text || '').trim().toLowerCase().split(/\s+/u).filter(Boolean);
	return (words.length === 12 || words.length === 24) && words.every((w) => /^[a-z]+$/u.test(w));
}

/**
 * Create a fresh donation-only wallet. Returns UFVK, address, and the
 * one-time seed phrase (must be shown to the user to save).
 */
export async function createDonationWallet() {
	const phrase = generateMnemonic(wordlist, 128);
	return fromMnemonic(phrase, { revealPhrase: true });
}

/** Open from a BIP-39 phrase typed or pasted. */
export async function openFromPhrase(phrase) {
	return fromMnemonic(phrase);
}

/** Open from a pasted UFVK (derives the receive address). */
export async function openFromUfvk(ufvk) {
	return fromUfvk(ufvk);
}

/**
 * Open from a File: plain text (phrase / UFVK / .wult JSON), .wult,
 * .bak, or locket .png (wbZt chunk). Native multi-share .vult needs
 * Winbit32 — we surface a clear error.
 */
export async function openFromFile(file, password) {
	if (!file) throw new Error('No file selected.');
	const name = String(file.name || '').toLowerCase();

	if (/\.vult$/u.test(name)) {
		throw new Error('Native Vultisig .vult vaults need Winbit32 (multi-share). Export a .wult, locket photo, or seed phrase instead.');
	}

	let text = '';
	if (/\.png$/u.test(name) || file.type === 'image/png') {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const shareText = extractLocketShareText(bytes);
		if (!shareText) {
			throw new Error('No locket piece found in this PNG (try the original photo with the sparkly border).');
		}
		text = shareText;
	} else {
		text = (await file.text()).trim();
	}

	if (!text) throw new Error('That file is empty.');

	if (text.startsWith('uview1') || text.startsWith('uviewtest1')) {
		return fromUfvk(text.split(/\s+/u)[0]);
	}

	if (looksLikePhrase(text)) {
		return fromMnemonic(text);
	}

	// Detect winbit32-vault-v2 even if isWrappedVault helper differs.
	let parsed = null;
	try { parsed = JSON.parse(text); } catch { /* not json */ }
	if (parsed && (parsed.type === 'winbit32-vault-v2' || (typeof isWrappedVault === 'function' && isWrappedVault(text)))) {
		return fromWultContent(text, password);
	}
	if (/\.(wult|bak|json)$/u.test(name)) {
		return fromWultContent(text, password);
	}

	throw new Error('Unrecognised file. Use a seed phrase, UFVK, .wult share, or locket PNG.');
}

export const WALLET_READY = true;
