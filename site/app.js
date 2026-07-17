// Ziving.org — static site (no build step). Talks to payments-gateway REST.

const API_BASE = (document.documentElement.dataset.api || 'https://mcp.winbit32.com').replace(/\/$/u, '');
const ZIVING_ORIGIN = location.origin.replace(/\/$/u, '');
const POLL_MS = 10_000;
const WIZARD_STEPS = 4;

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k === 'html') node.innerHTML = v;
		else if (k === 'style' && typeof v === 'string') node.setAttribute('style', v);
		else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
		else if (v != null) node.setAttribute(k, v);
	}
	for (const kid of kids) if (kid != null) node.append(kid);
	return node;
};

const fmtZec = (n) => {
	const v = Number(n);
	if (!Number.isFinite(v)) return '—';
	return v < 0.01 ? `${v.toFixed(4)} ZEC` : `${v.toFixed(3)} ZEC`;
};

const pageUrl = (slug) => `${ZIVING_ORIGIN}/p/${encodeURIComponent(slug)}`;
/** OBS browser-source URL (slug form — overlay.html also accepts ?overlay=ov_…). */
const overlayUrl = (slug) => `${ZIVING_ORIGIN}/overlay?slug=${encodeURIComponent(slug)}`;
const eventsApiUrl = (slug) => `${API_BASE}/v1/ziving/page/${encodeURIComponent(slug)}/events?sinceId=0`;

async function api(path, opts = {}) {
	// Merge headers LAST — spreading opts after headers let x-overlay-token
	// calls clobber the whole headers object, dropping content-type, so
	// Fastify ignored the JSON body (a $5 top-up fell back to the $2 minimum).
	const { headers, ...rest } = opts;
	const res = await fetch(`${API_BASE}${path}`, {
		...rest,
		headers: { 'content-type': 'application/json', ...(headers || {}) }
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		const msg = body?.error?.message || `HTTP ${res.status}`;
		throw new Error(msg);
	}
	return body;
}

function normaliseSlug(raw) {
	return String(raw || '').toLowerCase().trim()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function saveOwnerCredentials(slug, overlayId, ownerToken) {
	try {
		localStorage.setItem(`ziving:owner:${slug}`, JSON.stringify({ overlayId, ownerToken, savedAt: Date.now() }));
	} catch { /* private mode */ }
}

function loadOwnerCredentials(slug) {
	try {
		const raw = localStorage.getItem(`ziving:owner:${slug}`);
		if (!raw) return null;
		const o = JSON.parse(raw);
		if (o && typeof o.ownerToken === 'string' && o.ownerToken) return o;
	} catch { /* ignore */ }
	return null;
}

function clearOwnerCredentials(slug) {
	try { localStorage.removeItem(`ziving:owner:${slug}`); } catch { /* ignore */ }
}

let qrCodeLib = null;
async function loadQrCode() {
	if (qrCodeLib?.toCanvas) return qrCodeLib;
	if (globalThis.QRCode?.toCanvas) {
		qrCodeLib = globalThis.QRCode;
		return qrCodeLib;
	}
	const mod = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm');
	qrCodeLib = mod.default?.toCanvas ? mod.default : mod;
	if (!qrCodeLib?.toCanvas) throw new Error('QR library missing toCanvas');
	return qrCodeLib;
}

async function renderQr(canvas, payload, { width = 180 } = {}) {
	if (!canvas || !payload) return false;
	try {
		const QR = await loadQrCode();
		await QR.toCanvas(canvas, payload, {
			width,
			margin: 1,
			color: { dark: '#1a2420', light: '#ffffff' },
			errorCorrectionLevel: 'M'
		});
		canvas.hidden = false;
		return true;
	} catch (err) {
		console.warn('QR render failed', err);
		canvas.hidden = true;
		return false;
	}
}

async function copyText(text, btn) {
	try {
		await navigator.clipboard.writeText(text);
		if (!btn) return;
		if (btn.classList.contains('btn-icon')) {
			btn.classList.add('is-copied');
			btn.title = 'Copied!';
			setTimeout(() => {
				btn.classList.remove('is-copied');
				btn.title = btn.getAttribute('aria-label') || 'Copy';
			}, 1800);
			return;
		}
		const label = btn.textContent;
		btn.textContent = 'Copied!';
		setTimeout(() => { btn.textContent = label; }, 1800);
	} catch { /* clipboard blocked */ }
}

function zcashPayUri({ payTo, amountDisplay, memo }) {
	const parts = [`zcash:${payTo}`];
	const q = [];
	if (amountDisplay) q.push(`amount=${encodeURIComponent(amountDisplay)}`);
	if (memo) q.push(`memo=${encodeURIComponent(memo)}`);
	return q.length ? `${parts[0]}?${q.join('&')}` : parts[0];
}

/**
 * Render a tidy ZEC memo-quote payment card into `root`.
 * payment: { payTo, memo, amount: { display }, credit?, expiresAt?, confirmations? }
 */
function renderPaymentCard(root, payment, {
	title = 'Fund scanning',
	graceNote = '',
	extraLinks = null
} = {}) {
	if (!root) return;
	const payTo = payment?.payTo || '';
	const memo = payment?.memo || '';
	const amount = payment?.amount?.display || '';
	const credit = payment?.credit?.usd || '';
	const uri = zcashPayUri({ payTo, amountDisplay: amount, memo });

	const qrCanvas = el('canvas', { class: 'pay-card__qr', hidden: 'true' });
	const qrWrap = el('div', { class: 'pay-card__qr-wrap', hidden: 'true' }, qrCanvas);
	const qrFallback = el('p', { class: 'field__hint', hidden: 'true', text: 'QR unavailable — copy the address below.' });
	const copyAddrBtn = el('button', {
		type: 'button', class: 'btn-icon', title: 'Copy address', 'aria-label': 'Copy address',
		html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
	});
	const copyMemoBtn = el('button', {
		type: 'button', class: 'btn-icon', title: 'Copy memo', 'aria-label': 'Copy memo',
		html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
	});
	const copyAmtBtn = el('button', {
		type: 'button', class: 'btn btn--ghost btn--sm', text: 'Copy amount'
	});

	copyAddrBtn.addEventListener('click', () => copyText(payTo, copyAddrBtn));
	copyMemoBtn.addEventListener('click', () => copyText(memo, copyMemoBtn));
	copyAmtBtn.addEventListener('click', () => copyText(amount, copyAmtBtn));

	// Pay straight from the winbit32 wallet bar — any connected wallet works,
	// crediting is by memo, so a payer needn't be the page's owner wallet.
	const payWalletBtn = el('button', {
		type: 'button', class: 'btn btn--primary btn--sm', text: 'Pay with winbit32'
	});
	payWalletBtn.addEventListener('click', async () => {
		payWalletBtn.disabled = true;
		try {
			const bar = await ensureSiteWalletBar();
			bar.setSendDefaults({
				toAddress: payTo, amountZec: amount, memo,
				// This is a payment to the gateway (top-up / feature / unlock),
				// not a campaign gift — swap the bar's donate wording out.
				sendButtonLabel: 'Pay',
				memoFieldLabel: 'Memo (required — this attributes your payment)',
				sendToLabel: 'Paying the ziving gateway'
			});
			bar.open();
		} catch (err) {
			alert(err.message || String(err));
		} finally {
			payWalletBtn.disabled = false;
		}
	});

	root.hidden = false;
	root.className = 'pay-card';
	root.replaceChildren(...[
		el('h3', { class: 'pay-card__title', text: title }),
		el('p', { class: 'pay-card__amount' },
			el('span', { class: 'pay-card__amount-val', text: amount ? `${amount} ZEC` : 'ZEC' }),
			credit ? el('span', { class: 'pay-card__credit', text: `→ ${credit} scanning credit` }) : null,
			copyAmtBtn),
		el('div', { class: 'pay-card__body' },
			qrWrap,
			qrFallback,
			el('div', { class: 'pay-card__fields' },
				el('div', { class: 'pay-row' },
					el('span', { class: 'pay-row__label', text: 'Pay to' }),
					el('div', { class: 'pay-row__value' },
						el('code', { class: 'pay-row__code', text: payTo }),
						copyAddrBtn)),
				el('div', { class: 'pay-row' },
					el('span', { class: 'pay-row__label', text: 'Memo' }),
					el('div', { class: 'pay-row__value' },
						el('code', { class: 'pay-row__code pay-row__code--memo', text: memo }),
						copyMemoBtn)),
				payment?.expiresAt
					? el('p', { class: 'field__hint', text: `Quote expires ${new Date(payment.expiresAt).toLocaleString()}. Credit after ${payment?.confirmations?.required ?? 8} confirmations.` })
					: null)),
		el('div', { class: 'form-actions', style: 'justify-content:flex-start;align-items:center;gap:0.75rem;margin-top:0.75rem;flex-wrap:wrap;' },
			payWalletBtn,
			el('span', { class: 'field__hint', style: 'margin:0;', text: 'exact amount + memo prefilled — or scan the QR with any wallet' })),
		graceNote ? el('p', { class: 'pay-card__note', text: graceNote }) : null,
		extraLinks
	// replaceChildren coerces null to a literal "null" text node — filter it.
	].filter((kid) => kid != null));
	renderQr(qrCanvas, uri, { width: 200 }).then((ok) => {
		qrWrap.hidden = !ok;
		qrFallback.hidden = ok;
	});
}

function resolveCampaignSlug() {
	const params = new URLSearchParams(location.search);
	const fromQuery = normaliseSlug(params.get('slug'));
	if (fromQuery && fromQuery.length >= 3) return fromQuery;
	const m = location.pathname.match(/^\/p\/([a-z0-9-]{3,48})\/?$/u);
	return m ? normaliseSlug(m[1]) : '';
}

// ── Home / create wizard ────────────────────────────────────────────

let walletKit = null;
async function loadWalletKit() {
	if (walletKit) return walletKit;
	walletKit = await import('./lib/zcash-wallet.js');
	return walletKit;
}

/** Shared Winbit32 wallet bar — one instance per tab; strip appears only when connected. */
let siteWalletBar = null;
let siteWalletBarOpts = {};

/**
 * Best-effort ziving wallet login on connect: stashes the 24h session token
 * so /manage unlocks without re-connecting. Silent — most connects are
 * donors whose wallets own no pages (the gateway 404s, which is fine). The
 * wallet bar already sends the UFVK to winbit32 infra to scan the balance,
 * so this adds no new exposure.
 */
async function primeWalletSession(wallet) {
	if (!wallet?.ufvk) return;
	try {
		const login = await api('/v1/ziving/wallet/login', {
			method: 'POST',
			body: JSON.stringify({ ufvk: wallet.ufvk })
		});
		sessionStorage.setItem('ziving.walletSession', JSON.stringify(login));
	} catch { /* not an owner wallet, or offline — ignore */ }
}

async function ensureSiteWalletBar(extra = {}) {
	siteWalletBarOpts = { ...siteWalletBarOpts, ...extra };
	if (siteWalletBar) {
		if (extra.defaultToAddress) {
			siteWalletBar.setSendDefaults({ toAddress: extra.defaultToAddress });
		}
		return siteWalletBar;
	}
	const kit = await loadWalletKit();
	// Callbacks read siteWalletBarOpts at fire time, not mount time, so a page
	// can (re)register handlers after the bar exists — the header Connect and
	// the manage-page Connect share this one bar.
	const { onConnected: _c, onDisconnected: _d, onSendComplete: _s, ...mountOpts } = siteWalletBarOpts;
	siteWalletBar = kit.mountDonorWalletBar({
		...mountOpts,
		onConnected: (wallet) => {
			updateHeaderWalletUi(wallet);
			// Quietly open a manage session on any page, so navigating to
			// /manage after a header connect doesn't ask to connect again.
			// (The manage page runs its own login with visible UI instead.)
			if (document.body.dataset.page !== 'manage') primeWalletSession(wallet);
			siteWalletBarOpts.onConnected?.(wallet);
		},
		onDisconnected: () => {
			updateHeaderWalletUi(null);
			siteWalletBarOpts.onDisconnected?.();
		},
		onSendComplete: (txid) => siteWalletBarOpts.onSendComplete?.(txid),
	});
	return siteWalletBar;
}

function truncateAddr(addr, head = 8, tail = 4) {
	if (!addr || addr.length <= head + tail + 1) return addr || '';
	return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function updateHeaderWalletUi(wallet) {
	const btn = $('header-connect');
	if (!btn) return;
	if (wallet?.unifiedAddress) {
		btn.textContent = truncateAddr(wallet.unifiedAddress);
		btn.title = 'Wallet connected — open wallet';
		btn.classList.add('is-connected');
	} else {
		btn.textContent = 'Connect';
		btn.title = 'Connect your donation wallet';
		btn.classList.remove('is-connected');
	}
}

function initHeaderWallet() {
	const btn = $('header-connect');
	if (!btn) return;
	btn.addEventListener('click', async () => {
		btn.disabled = true;
		try {
			const bar = await ensureSiteWalletBar();
			bar.open();
		} catch (err) {
			alert(err.message || String(err));
		} finally {
			btn.disabled = false;
		}
	});
}

function getWalletCredentials() {
	const mode = document.querySelector('.wallet-mode.is-active')?.dataset.walletMode || 'create';
	if (mode === 'manual') {
		return {
			ufvk: ($('ufvk')?.value || '').trim(),
			address: ($('address')?.value || '').trim()
		};
	}
	return {
		ufvk: ($('ufvk-hidden')?.value || '').trim(),
		address: ($('address-hidden')?.value || '').trim()
	};
}

function setWalletCredentials(ufvk, address) {
	if ($('ufvk-hidden')) $('ufvk-hidden').value = ufvk || '';
	if ($('address-hidden')) $('address-hidden').value = address || '';
	if ($('ufvk')) $('ufvk').value = ufvk || '';
	if ($('address')) $('address').value = address || '';
}

function walletCredentialsReady() {
	const { ufvk, address } = getWalletCredentials();
	const mode = document.querySelector('.wallet-mode.is-active')?.dataset.walletMode || 'create';
	if (!ufvk.startsWith('uview') || !address.startsWith('u')) return false;
	if (mode === 'create' && !$('wallet-phrase-saved')?.checked) return false;
	return true;
}

async function loadFeatured() {
	const section = $('featured');
	const list = $('featured-list');
	if (!section || !list) return;
	try {
		const out = await api('/v1/ziving/featured');
		const campaigns = out.campaigns || [];
		if (!campaigns.length) {
			section.hidden = true;
			return;
		}
		section.hidden = false;
		list.replaceChildren(...campaigns.map((c) =>
			el('a', { class: 'featured-item', href: c.urls?.page || pageUrl(c.slug) },
				el('p', { class: 'featured-item__title', text: c.label || c.slug }),
				el('p', { class: 'featured-item__meta',
					text: `${fmtZec(c.raised?.zec)} raised · ${c.raised?.donationCount ?? 0} gifts` }))
		));
	} catch {
		section.hidden = true;
	}
}

function timeAgo(iso) {
	const ms = Date.now() - Date.parse(iso);
	if (!Number.isFinite(ms) || ms < 0) return '';
	const mins = Math.floor(ms / 60_000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return days === 1 ? 'yesterday' : `${days}d ago`;
}

/**
 * "Happening now" — latest confirmed gifts + newest pages from
 * /v1/ziving/activity. Degrades silently (section stays hidden) while the
 * gateway predates the endpoint or when there is nothing to show yet.
 */
async function loadActivity() {
	const section = $('activity');
	const giftsBox = $('activity-gifts');
	const pagesBox = $('activity-pages');
	if (!section || !giftsBox || !pagesBox) return;
	try {
		const out = await api('/v1/ziving/activity');
		const gifts = out.donations || [];
		const pages = out.pages || [];
		if (!gifts.length && !pages.length) {
			section.hidden = true;
			return;
		}
		giftsBox.replaceChildren(...(gifts.length
			? gifts.map((g) => el('a', { class: 'gift-row', href: g.pageUrl || pageUrl(g.slug) },
				el('span', { class: 'gift-row__amt', text: fmtZec(g.amountZec) }),
				el('span', { class: 'gift-row__what' },
					g.memo ? el('span', { text: `“${g.memo}” ` }) : null,
					el('span', { class: 'to', text: `→ ${g.label || g.slug}` })),
				el('span', { class: 'gift-row__when', text: timeAgo(g.at) })))
			: [el('p', { class: 'activity-empty', text: 'The next gift could be yours to receive…' })]));
		pagesBox.replaceChildren(...(pages.length
			? pages.map((p) => el('a', { class: 'page-card', href: p.urls?.page || pageUrl(p.slug) },
				el('p', { class: 'page-card__title', text: p.label || p.slug }),
				el('p', { class: 'page-card__meta' },
					el('span', { class: 'raised', text: fmtZec(p.raised?.zec) }),
					document.createTextNode(` raised · ${p.raised?.donationCount ?? 0} gift${(p.raised?.donationCount ?? 0) === 1 ? '' : 's'}`))))
			: [el('p', { class: 'activity-empty', text: 'Start the first page of the day!' })]));
		section.hidden = false;
	} catch {
		section.hidden = true;
	}
}

function initHome() {
	const dialog = $('create-dialog');
	const openBtn = $('open-create');
	const closeBtn = $('close-create');
	const form = $('create-form');
	const slugInput = $('slug');
	const slugPreview = $('slug-preview');
	let step = 1;
	let maxReached = 1;
	let walletMode = 'create';
	let pageCreated = false;

	loadFeatured();
	loadActivity();
	setInterval(loadActivity, 30_000);

	function setWalletMode(mode) {
		walletMode = mode;
		for (const btn of document.querySelectorAll('.wallet-mode')) {
			btn.classList.toggle('is-active', btn.dataset.walletMode === mode);
		}
		$('wallet-panel-create').hidden = mode !== 'create';
		$('wallet-panel-existing').hidden = mode !== 'existing';
		$('wallet-panel-manual').hidden = mode !== 'manual';
		updateCreateButton();
	}

	function updateCreateButton() {
		const submit = $('create-submit');
		if (!submit) return;
		if (pageCreated) {
			submit.hidden = true;
			submit.disabled = true;
			$('wizard-next').hidden = true;
			$('wizard-back').hidden = true;
			return;
		}
		const onLast = step >= WIZARD_STEPS;
		const ready = onLast && walletCredentialsReady() && validateStep(1, { silent: true });
		submit.hidden = !ready;
		submit.disabled = !ready;
		$('wizard-next').hidden = onLast;
	}

	function setStep(n, { force = false } = {}) {
		const target = Math.max(1, Math.min(WIZARD_STEPS, n));
		if (!force && target > step) {
			for (let s = step; s < target; s += 1) {
				if (!validateStep(s)) return false;
			}
		}
		step = target;
		maxReached = Math.max(maxReached, step);
		for (const pane of form.querySelectorAll('.wizard-pane')) {
			const id = Number(pane.dataset.pane);
			const on = id === step;
			pane.hidden = !on;
			pane.classList.toggle('is-active', on);
		}
		for (const li of document.querySelectorAll('#wizard-steps li')) {
			const s = Number(li.dataset.step);
			li.classList.toggle('is-active', s === step);
			li.classList.toggle('is-done', s < step);
			li.setAttribute('role', 'button');
			li.tabIndex = 0;
		}
		$('wizard-back').hidden = step <= 1;
		if (step === WIZARD_STEPS) {
			const review = $('create-review');
			const slug = normaliseSlug(slugInput.value) || 'your-slug';
			const { address } = getWalletCredentials();
			const usd = $('amountUsd').value;
			review.hidden = false;
			// Built with text nodes — the label is user input and must never
			// reach innerHTML.
			review.replaceChildren(...[
				el('p', {}, el('strong', { text: $('label').value.trim() || slug })),
				el('p', { text: 'URL: ' }, el('code', { text: pageUrl(slug) })),
				el('p', { text: 'Prepay scanning credit: ' }, el('strong', { text: `$${usd}` })),
				el('p', { class: 'field__hint', text: 'Receive: ' },
					el('code', { text: address ? `${address.slice(0, 18)}…` : '(missing)' })),
				walletMode === 'manual'
					? el('p', { class: 'field__hint field__hint--warn', role: 'note' },
						el('strong', { text: 'Manual wallet: ' }),
						document.createTextNode('after create you get a one-time owner token — copy it immediately. We only store a hash; it will not be shown again.'))
					: null,
				el('p', { class: 'field__hint' },
					document.createTextNode('Click '),
					el('strong', { text: 'Create page' }),
					document.createTextNode(` — you'll get a ZEC amount, pay-to address, and memo to fund the $${usd} scanning credit. The page is live on grace credit while that confirms.`))
			// replaceChildren coerces null to a literal "null" text node — filter it.
			].filter((kid) => kid != null));
		}
		updateCreateButton();
		return true;
	}

	function validateStep(n, { silent = false } = {}) {
		if (n === 1) {
			const slug = normaliseSlug(slugInput.value);
			if (slug.length < 5) {
				if (!silent) slugInput.focus();
				return false;
			}
			slugInput.value = slug;
			if (!$('label').value.trim()) {
				if (!silent) $('label').focus();
				return false;
			}
			return true;
		}
		if (n === 2) {
			if (!walletCredentialsReady()) {
				if (!silent) {
					const mode = walletMode;
					if (mode === 'create' && getWalletCredentials().ufvk && !$('wallet-phrase-saved')?.checked) {
						$('wallet-phrase-saved')?.focus();
					} else if (mode === 'manual') {
						$('ufvk')?.focus();
					} else if (mode === 'create') {
						$('wallet-generate')?.focus();
					} else {
						$('wallet-phrase-input')?.focus();
					}
				}
				return false;
			}
			return true;
		}
		return true;
	}

	function resetWizard() {
		pageCreated = false;
		maxReached = 1;
		setWalletCredentials('', '');
		if ($('wallet-created')) $('wallet-created').hidden = true;
		if ($('wallet-phrase')) $('wallet-phrase').textContent = '';
		if ($('wallet-phrase-saved')) $('wallet-phrase-saved').checked = false;
		if ($('wallet-phrase-input')) $('wallet-phrase-input').value = '';
		if ($('wallet-file')) $('wallet-file').value = '';
		if ($('wallet-password')) $('wallet-password').value = '';
		if ($('wallet-password-wrap')) $('wallet-password-wrap').hidden = true;
		if ($('wallet-create-status')) $('wallet-create-status').textContent = '';
		if ($('wallet-existing-status')) $('wallet-existing-status').textContent = '';
		if ($('create-result')) { $('create-result').hidden = true; $('create-result').innerHTML = ''; }
		if ($('create-review')) $('create-review').hidden = false;
		setWalletMode('create');
		setStep(1, { force: true });
	}

	openBtn?.addEventListener('click', () => {
		resetWizard();
		dialog?.showModal();
		// Warm the WASM while the user fills step 1.
		loadWalletKit().catch(() => {});
	});
	closeBtn?.addEventListener('click', () => dialog?.close());
	dialog?.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

	for (const li of document.querySelectorAll('#wizard-steps li')) {
		const go = () => {
			const target = Number(li.dataset.step);
			if (target === step) return;
			if (target < step) {
				setStep(target, { force: true });
				return;
			}
			setStep(target);
		};
		li.addEventListener('click', go);
		li.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
		});
	}

	$('wizard-next')?.addEventListener('click', () => {
		if (!validateStep(step)) return;
		setStep(step + 1);
	});
	$('wizard-back')?.addEventListener('click', () => setStep(step - 1, { force: true }));

	slugInput?.addEventListener('input', () => {
		const s = normaliseSlug(slugInput.value) || 'your-slug';
		if (slugPreview) slugPreview.textContent = s;
		updateCreateButton();
	});
	$('label')?.addEventListener('input', updateCreateButton);

	for (const btn of document.querySelectorAll('.wallet-mode')) {
		btn.addEventListener('click', () => setWalletMode(btn.dataset.walletMode));
	}

	$('wallet-generate')?.addEventListener('click', async () => {
		const status = $('wallet-create-status');
		const btn = $('wallet-generate');
		status.textContent = 'Generating…';
		btn.disabled = true;
		try {
			const kit = await loadWalletKit();
			const out = await kit.createDonationWallet();
			setWalletCredentials(out.ufvk, out.address);
			$('wallet-phrase').textContent = out.phrase;
			$('wallet-created').hidden = false;
			$('wallet-phrase-saved').checked = false;
			$('wallet-create-addr').textContent = `Address: ${out.address.slice(0, 22)}…`;
			status.textContent = 'Wallet ready — save the phrase before continuing.';
			updateCreateButton();
		} catch (err) {
			status.textContent = err.message || String(err);
		} finally {
			btn.disabled = false;
		}
	});

	$('wallet-copy-phrase')?.addEventListener('click', async () => {
		const phrase = $('wallet-phrase')?.textContent || '';
		if (!phrase) return;
		await navigator.clipboard.writeText(phrase);
		$('wallet-copy-phrase').textContent = 'Copied!';
		setTimeout(() => { $('wallet-copy-phrase').textContent = 'Copy phrase'; }, 2000);
	});

	$('wallet-download-phrase')?.addEventListener('click', () => {
		const phrase = $('wallet-phrase')?.textContent || '';
		if (!phrase) return;
		const blob = new Blob([`${phrase}\n`], { type: 'text/plain' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `ziving-donation-seed-${Date.now()}.txt`;
		a.click();
		URL.revokeObjectURL(a.href);
	});

	$('wallet-phrase-saved')?.addEventListener('change', updateCreateButton);
	$('ufvk')?.addEventListener('input', updateCreateButton);
	$('address')?.addEventListener('input', updateCreateButton);

	async function applyExistingWallet(loader) {
		const status = $('wallet-existing-status');
		status.textContent = 'Opening…';
		try {
			const kit = await loadWalletKit();
			const out = await loader(kit);
			setWalletCredentials(out.ufvk, out.address);
			status.textContent = `Ready — ${out.address.slice(0, 22)}…`;
			$('wallet-password-wrap').hidden = true;
			updateCreateButton();
		} catch (err) {
			if (err?.code === 'password_required') {
				$('wallet-password-wrap').hidden = false;
				$('wallet-password')?.focus();
				status.textContent = err.message;
				return;
			}
			status.textContent = err.message || String(err);
		}
	}

	$('wallet-open-existing')?.addEventListener('click', async () => {
		const phrase = ($('wallet-phrase-input')?.value || '').trim();
		const file = $('wallet-file')?.files?.[0];
		const password = ($('wallet-password')?.value || '').trim() || undefined;
		if (file) {
			await applyExistingWallet((kit) => kit.openFromFile(file, password));
			return;
		}
		if (phrase.startsWith('uview')) {
			await applyExistingWallet((kit) => kit.openFromUfvk(phrase));
			return;
		}
		if (phrase) {
			await applyExistingWallet((kit) => kit.openFromPhrase(phrase));
			return;
		}
		$('wallet-existing-status').textContent = 'Paste a seed phrase or choose a file.';
	});

	$('wallet-file')?.addEventListener('change', async () => {
		const file = $('wallet-file')?.files?.[0];
		if (!file) return;
		const password = ($('wallet-password')?.value || '').trim() || undefined;
		await applyExistingWallet((kit) => kit.openFromFile(file, password));
	});

	form?.addEventListener('submit', async (e) => {
		e.preventDefault();
		if (pageCreated) return;
		if (step !== WIZARD_STEPS) {
			if (validateStep(step)) setStep(step + 1);
			return;
		}
		if (!validateStep(1) || !validateStep(2)) {
			setStep(!validateStep(1, { silent: true }) ? 1 : 2, { force: true });
			return;
		}
		const result = $('create-result');
		const submit = $('create-submit');
		if (result) { result.hidden = true; result.replaceChildren(); }
		submit.disabled = true;
		try {
			const slug = normaliseSlug(slugInput.value);
			const amountUsd = Number($('amountUsd').value);
			const { ufvk, address } = getWalletCredentials();
			const payload = {
				slug,
				label: $('label').value.trim() || slug,
				story: $('story').value.trim() || undefined,
				goalZec: $('goalZec').value ? Number($('goalZec').value) : undefined,
				ufvk,
				address,
				amountUsdCents: Math.round(amountUsd * 100)
			};
			const out = await api('/v1/ziving/page', { method: 'POST', body: JSON.stringify(payload) });
			saveOwnerCredentials(slug, out.overlayId, out.ownerToken);
			pageCreated = true;
			const url = out.urls?.page || pageUrl(slug);
			$('create-review').hidden = true;
			if (result) {
				result.hidden = false;
				result.className = 'create-success';
				const token = out.ownerToken || '';
				const recoveryCode = out.recoveryCode || '';
				const isManual = walletMode === 'manual';
				const tokenCode = el('code', { id: 'owner-token-value', text: token });
				const copyTokenBtn = el('button', {
					type: 'button',
					class: 'btn btn--ghost btn--sm',
					text: 'Copy magic key',
				});
				copyTokenBtn.addEventListener('click', () => copyText(token, copyTokenBtn));
				const recoveryBits = recoveryCode ? [
					el('p', { class: 'field__hint', style: 'margin-top:0.7rem;', html:
						'<strong>Recovery code</strong> — your lost-key lifeline. If you ever lose the magic key, this code plus a small ZEC payment unlocks a new one.' }),
					el('code', { id: 'recovery-code-value', text: recoveryCode })
				] : [];

				const tokenBox = isManual
					? el('div', { class: 'create-success__token create-success__token--urgent', role: 'note' },
						el('p', { class: 'field__hint field__hint--warn', html:
							'<strong>Save your magic key + recovery code now — each shown only once.</strong> '
							+ 'We only keep hashes. Without them you cannot manage this page.' }),
						tokenCode,
						...recoveryBits,
						el('div', { class: 'form-actions', style: 'justify-content:flex-start;margin-top:0.5rem;' }, copyTokenBtn))
					: el('details', { class: 'create-success__token', open: '' },
						el('summary', { text: 'Magic key + recovery code — copy and save (shown only once)' }),
						el('p', { class: 'field__hint', text: 'We only keep hashes. Your connected wallet also unlocks Manage, but store these offline as backup.' }),
						tokenCode,
						...recoveryBits,
						el('div', { class: 'form-actions', style: 'justify-content:flex-start;margin-top:0.5rem;' }, copyTokenBtn));

				const actions = el('div', { class: 'create-success__actions' },
					el('a', { class: 'btn btn--primary', href: url, text: 'View page' }),
					el('a', { class: 'btn btn--ghost', href: `/manage?slug=${encodeURIComponent(slug)}`, text: 'Manage' }));
				const payHost = el('div');
				const kids = [
					el('p', { class: 'create-success__lede' },
						el('strong', { text: 'Page is live' }),
						document.createTextNode(' on grace credit — share it while you fund scanning.')),
				];
				// Manual: token first so they cannot miss the one-time secret.
				if (isManual) kids.push(tokenBox, actions, payHost);
				else kids.push(actions, tokenBox, payHost);
				result.replaceChildren(...kids);
				renderPaymentCard(payHost, out.payment, {
					title: 'Fund scanning',
					graceNote: out.graceNote || ''
				});
			}
			updateCreateButton();
		} catch (err) {
			const slug = normaliseSlug(slugInput.value);
			const saved = loadOwnerCredentials(slug);
			const taken = /already in use/i.test(err.message || '');
			if (result) {
				result.hidden = false;
				result.className = 'result-box result-box--warn';
				if (taken) {
					result.replaceChildren(
						el('p', { text: `Page "${slug}" already exists — no need to create it again.` }),
						el('div', { class: 'create-success__actions', style: 'margin-top:0.75rem;' },
							el('a', { class: 'btn btn--primary', href: pageUrl(slug), text: 'View page' }),
							el('a', { class: 'btn btn--ghost', href: `/manage?slug=${encodeURIComponent(slug)}`, text: 'Manage' })),
						saved
							? el('p', { class: 'field__hint', text: 'Owner credentials are still in this browser. Manage unlocks with the saved token or your wallet.' })
							: el('p', { class: 'field__hint', text: 'Unlock Manage with the wallet UFVK you used when creating the page.' })
					);
				} else {
					result.textContent = err.message;
				}
			}
			updateCreateButton();
		} finally {
			submit.disabled = pageCreated ? true : false;
			if (!pageCreated) updateCreateButton();
		}
	});

	setWalletMode('create');
	setStep(1, { force: true });
}

// ── Campaign page ───────────────────────────────────────────────────

async function loadCampaign(slug) {
	const root = $('campaign-root');
	try {
		const page = await api(`/v1/ziving/page/${encodeURIComponent(slug)}`);
		document.title = `${page.label || slug} — Ziving`;

		siteWalletBarOpts = {
			...siteWalletBarOpts,
			defaultToAddress: page.address,
			lockToAddress: true,
			showSendOnConnect: true,
			onSendComplete: () => { pollEvents().catch(() => {}); }
		};

		const pct = page.raised?.percentOfGoal;
		const progress = page.goalZec != null
			? el('div', { class: 'progress' },
				el('div', { class: 'progress__raised', text: fmtZec(page.raised.zec) }),
				el('div', { class: 'progress__bar' },
					el('div', { class: 'progress__fill', style: `width:${Math.min(100, pct ?? 0)}%` })),
				el('div', { class: 'progress__nums' },
					el('span', { text: `${page.raised.donationCount} donation${page.raised.donationCount === 1 ? '' : 's'}` }),
					el('span', { text: `Goal ${fmtZec(page.goalZec)}` })))
			: el('p', { class: 'progress__raised', text: `${fmtZec(page.raised.zec)} raised · ${page.raised.donationCount} gifts` });

		const statusClass = page.active ? 'status-pill status-pill--active' : 'status-pill status-pill--paused';

		const qrCanvas = el('canvas', { class: 'donate-card__qr', id: 'donate-qr', hidden: 'true' });
		const qrWrap = el('div', { class: 'donate-card__qr-wrap', id: 'donate-qr-wrap', hidden: 'true' }, qrCanvas);
		const copyAddrBtn = el('button', {
			class: 'btn btn--ghost btn--sm', type: 'button', id: 'copy-addr', text: 'Copy address'
		});
		const connectWalletBtn = el('button', {
			type: 'button', class: 'btn btn--ghost btn--sm', id: 'donate-connect',
			text: 'Pay in browser'
		});

		const donateCard = el('aside', { class: 'donate-card' },
			el('h3', { text: 'Donate shielded ZEC' }),
			el('p', {
				class: 'donate-card__hint',
				text: 'Use your own Zcash wallet — scan or copy the address below. Add a memo so your gift shows in Recent gifts.'
			}),
			qrWrap,
			el('p', { class: 'donate-card__addr', id: 'donate-addr', text: page.address }),
			el('div', { class: 'donate-card__copy-row' }, copyAddrBtn),
			el('p', {
				class: 'donate-card__hint donate-card__hint--sm',
				text: 'Ziving never holds funds — gifts go wallet-to-wallet.'
			}),
			el('div', { class: 'donate-card__sep' },
				el('span', { text: 'or' })),
			el('div', { class: 'donate-card__actions' }, connectWalletBtn));

		const donationsBox = el('section', { class: 'donations' },
			el('h2', { class: 'section-title', html: 'Recent <span class="accent">gifts</span>' }),
			el('div', { id: 'donation-list' }));

		const campaignMain = el('div', { class: 'campaign-main' },
			el('span', { class: statusClass, text: page.active ? 'Live' : 'Paused' }),
			page.featured ? el('span', { class: 'status-pill', style: 'margin-left:0.4rem;color:var(--gold);', text: 'Featured' }) : null,
			el('h1', { class: 'campaign-title', text: page.label || slug }),
			page.story ? el('p', { class: 'campaign-story', text: page.story }) : null,
			el('p', { class: 'campaign-unverified', text: 'Unverified campaign — Ziving does not check identity or cause. You are paying this wallet directly.' }),
			progress,
			donationsBox);

		root.replaceChildren(
			el('div', { class: 'campaign-layout' },
				campaignMain,
				donateCard));

		const uri = zcashPayUri({ payTo: page.address });
		const qrOk = await renderQr(qrCanvas, uri, { width: 200 });
		qrWrap.hidden = !qrOk;
		copyAddrBtn.addEventListener('click', () => copyText(page.address, copyAddrBtn));

		const renderDonations = (events) => {
			const list = $('donation-list');
			if (!list) return;
			if (!events.length) {
				list.replaceChildren(el('p', { class: 'empty-state', text: 'No gifts yet — be the first!' }));
				return;
			}
			const rows = [...events].reverse().map((ev) => {
				const pending = ev.status !== 'confirmed';
				const meta = pending
					? `pending · ${ev.confirmations || 0} conf`
					: 'confirmed';
				return el('div', { class: pending ? 'donation-row donation-row--pending' : 'donation-row' },
					el('span', { class: 'donation-row__amt', text: fmtZec(ev.amountZec) }),
					el('span', { class: 'donation-row__memo', text: ev.memo || '—' }),
					el('span', { class: 'donation-row__meta', text: meta }));
			});
			list.replaceChildren(...rows);
		};

		const pollEvents = async () => {
			try {
				const full = await api(`/v1/ziving/page/${encodeURIComponent(slug)}/events?sinceId=0`);
				// Show unconfirmed (seen) gifts too — styled pending/italic — for
				// an instant "it landed" vibe. The raised total below stays
				// confirmed-only (server-computed) so the headline can't retreat.
				renderDonations(full.events || []);
				const fresh = await api(`/v1/ziving/page/${encodeURIComponent(slug)}`);
				const raisedEl = root.querySelector('.progress__raised');
				if (raisedEl) raisedEl.textContent = fmtZec(fresh.raised.zec);
				const fill = root.querySelector('.progress__fill');
				if (fill && fresh.raised?.percentOfGoal != null) {
					fill.style.width = `${Math.min(100, fresh.raised.percentOfGoal)}%`;
				}
			} catch { /* silent poll */ }
		};

		connectWalletBtn.addEventListener('click', async () => {
			connectWalletBtn.disabled = true;
			try {
				const bar = await ensureSiteWalletBar();
				bar.setSendDefaults({
					toAddress: page.address,
					// Restore donate wording in case a gateway payment (top-up
					// etc.) switched the bar to its "Pay" labels earlier.
					sendButtonLabel: 'Donate',
					memoFieldLabel: 'Memo (optional — shows on the campaign)',
					sendToLabel: 'Sending to this campaign'
				});
				bar.open();
			} catch (err) {
				alert(err.message || String(err));
			} finally {
				connectWalletBtn.disabled = false;
			}
		});

		await pollEvents();
		setInterval(pollEvents, POLL_MS);
	} catch (err) {
		root.replaceChildren(el('p', { class: 'empty-state', text: err.message || 'Campaign not found' }));
	}
}

// ── Manage page (winbit32 wallet connect, magic key, or lost-key) ───

function initManage() {
	const unlockForm = $('unlock-form');
	const panel = $('manage-panel');
	const errBox = $('unlock-error');
	const slugField = $('m-slug');
	const tokenField = $('m-token');

	const preSlug = normaliseSlug(new URLSearchParams(location.search).get('slug'));
	if (preSlug) {
		if (slugField) slugField.value = preSlug;
		if ($('r-slug')) $('r-slug').value = preSlug;
		const saved = loadOwnerCredentials(preSlug);
		if (saved?.ownerToken && tokenField) tokenField.value = saved.ownerToken;
	}

	let session = { slug: '', overlayId: '', ownerToken: '' };
	// Wallet-login session (24h, covers every page of the connected wallet).
	let walletSession = null;
	try { walletSession = JSON.parse(sessionStorage.getItem('ziving.walletSession') || 'null'); } catch { /* ignore */ }
	let unlockMode = 'wallet';

	function setUnlockMode(mode) {
		unlockMode = mode;
		for (const btn of document.querySelectorAll('.unlock-mode')) {
			btn.classList.toggle('is-active', btn.dataset.unlockMode === mode);
		}
		for (const m of ['wallet', 'token', 'recover']) {
			const el2 = $(`unlock-panel-${m}`);
			if (el2) el2.hidden = mode !== m;
		}
		if (tokenField) tokenField.required = mode === 'token';
		if (slugField) slugField.required = mode === 'token';
	}

	for (const btn of document.querySelectorAll('.unlock-mode')) {
		btn.addEventListener('click', () => setUnlockMode(btn.dataset.unlockMode));
	}
	setUnlockMode(tokenField?.value ? 'token' : 'wallet');

	async function enterSession(slug, overlayId, ownerToken, { remember = true } = {}) {
		session = { slug, overlayId, ownerToken };
		if (remember && $('m-remember')?.checked) saveOwnerCredentials(slug, overlayId, ownerToken);
		unlockForm.hidden = true;
		panel.hidden = false;
		await refreshStatus();
		history.replaceState(null, '', `${location.pathname}?slug=${encodeURIComponent(slug)}`);
	}

	// ── Wallet connect → page list ──────────────────────────────────
	function renderPagesList(login) {
		const box = $('m-pages-list');
		if (!box) return;
		box.hidden = false;
		const items = (login.pages || []).map((p) => {
			const manageBtn = el('button', { type: 'button', class: 'btn btn--primary btn--sm', text: 'Manage' });
			manageBtn.addEventListener('click', async () => {
				manageBtn.disabled = true;
				try { await enterSession(p.slug, p.overlayId, login.sessionToken, { remember: false }); }
				catch (err) { errBox.hidden = false; errBox.textContent = err.message; }
				finally { manageBtn.disabled = false; }
			});
			const state = p.cancelled ? 'cancelled' : (p.active ? 'active' : 'out of credit');
			return el('div', { class: 'card', style: 'display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap;padding:0.75rem 1rem;margin:0 0 0.5rem;' },
				el('div', {},
					el('strong', { text: p.label || p.slug }),
					el('p', { class: 'field__hint', style: 'margin:0.2rem 0 0;', text: `/p/${p.slug} · ${state} · raised ${fmtZec(p.raised?.zec)}` })),
				manageBtn);
		});
		box.replaceChildren(
			el('p', { class: 'field__hint', text: `This wallet owns ${items.length} page${items.length === 1 ? '' : 's'}:` }),
			...items
		);
	}

	async function walletLogin(ufvk) {
		const status = $('m-wallet-status');
		if (status) { status.hidden = false; status.textContent = 'Looking up your pages…'; }
		const login = await api('/v1/ziving/wallet/login', {
			method: 'POST',
			body: JSON.stringify({ ufvk })
		});
		walletSession = login;
		try { sessionStorage.setItem('ziving.walletSession', JSON.stringify(login)); } catch { /* ignore */ }
		if (status) status.textContent = 'Wallet connected.';
		renderPagesList(login);
	}

	function showLoginError(err) {
		errBox.hidden = false;
		errBox.textContent = err.message === 'no pages found for this wallet'
			? 'No pages found for this wallet — did you create the page with a different wallet?'
			: err.message;
	}

	// Register up-front so the header Connect button logs into manage too —
	// the site shares one wallet bar, and callbacks are late-bound.
	siteWalletBarOpts = {
		...siteWalletBarOpts,
		onConnected: (wallet) => {
			if (!wallet?.ufvk) return;
			walletLogin(wallet.ufvk)
				.then(() => {
					// Still on the unlock form → close the modal so the page
					// list is visible. Mid-payment connects (Pay with winbit32
					// from a quote card) keep the send form open instead.
					if (panel.hidden) siteWalletBar?.close();
				})
				.catch((err) => {
					// A non-owner wallet connecting just to PAY a quote is
					// fine — only surface login errors on the unlock form.
					if (panel.hidden) showLoginError(err);
				});
		}
	};

	$('m-wallet-connect')?.addEventListener('click', async () => {
		errBox.hidden = true;
		const btn = $('m-wallet-connect');
		btn.disabled = true;
		try {
			const bar = await ensureSiteWalletBar();
			const wallet = bar.getWallet();
			// Already connected (e.g. via the header button) — no need to ask
			// again, go straight to the page list.
			if (wallet?.ufvk) await walletLogin(wallet.ufvk);
			else bar.open();
		} catch (err) {
			showLoginError(err);
		} finally {
			btn.disabled = false;
		}
	});

	// Restore a still-valid wallet session (page reload within 24h).
	if (walletSession?.sessionToken && new Date(walletSession.expires_at || 0).getTime() > Date.now()) {
		renderPagesList(walletSession);
	}

	async function refreshStatus() {
		const page = await api(`/v1/ziving/page/${encodeURIComponent(session.slug)}`);
		session.overlayId = page.overlayId;
		const card = $('status-card');
		const pill = page.active ? 'status-pill status-pill--active' : 'status-pill status-pill--paused';
		const featLine = page.featured
			? `Featured until ${page.featured_until ? new Date(page.featured_until).toLocaleString() : '—'}`
			: 'Not currently featured on the homepage';
		card.replaceChildren(
			el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap;' },
				el('h3', { style: 'margin:0;font-family:var(--display);font-weight:500;', text: page.label || session.slug }),
				el('span', { class: pill, text: page.state || (page.active ? 'active' : 'paused') })),
			el('p', { style: 'color:var(--muted);margin:0.75rem 0 0;font-size:0.9rem;' },
				el('a', { href: pageUrl(session.slug), text: pageUrl(session.slug) })),
			el('p', { style: 'color:var(--muted);margin:0.5rem 0 0;font-size:0.9rem;',
				text: `Credit: $${page.credit?.remaining_usd ?? '?'} · ~${page.credit?.days_remaining ?? '?'} days · raised ${fmtZec(page.raised?.zec)}` }),
			el('p', { style: 'color:var(--muted);margin:0.35rem 0 0;font-size:0.82rem;', text: featLine }),
			el('p', { style: 'color:var(--muted);margin:0.35rem 0 0;font-size:0.82rem;',
				text: `Expires ${page.expires_at ? new Date(page.expires_at).toLocaleString() : '—'}` })
		);
		$('obs-url').textContent = page.urls?.obsPage || overlayUrl(session.slug);
		const obsOpen = $('obs-open');
		if (obsOpen) obsOpen.href = $('obs-url').textContent;
		const eventsUrl = page.urls?.events
			? (page.urls.events.startsWith('http') ? page.urls.events : `${API_BASE}${page.urls.events}${page.urls.events.includes('?') ? '&' : '?'}sinceId=0`)
			: eventsApiUrl(session.slug);
		if ($('api-events-url')) $('api-events-url').textContent = eventsUrl;
		const apiOpen = $('api-events-open');
		if (apiOpen) apiOpen.href = eventsUrl;
		return page;
	}

	async function unlockWithToken(slug, ownerToken) {
		const page = await api(`/v1/ziving/page/${encodeURIComponent(slug)}`);
		await api(`/v1/overlay/${encodeURIComponent(page.overlayId)}/owner`, {
			headers: { 'x-overlay-token': ownerToken }
		});
		await enterSession(slug, page.overlayId, ownerToken);
	}

	// Auto-unlock when this browser already has a saved token for the slug.
	(async () => {
		if (!preSlug) return;
		const saved = loadOwnerCredentials(preSlug);
		if (!saved?.ownerToken) return;
		try {
			await unlockWithToken(preSlug, saved.ownerToken);
		} catch { /* stay on unlock form */ }
	})();

	unlockForm?.addEventListener('submit', async (e) => {
		e.preventDefault();
		if (unlockMode !== 'token') return;
		errBox.hidden = true;
		const slug = normaliseSlug(slugField.value);
		if (!slug) return;
		const btn = $('unlock-submit');
		btn.disabled = true;
		try {
			const ownerToken = String(tokenField.value || '').trim();
			if (!ownerToken) throw new Error('Paste your magic key, or connect the wallet instead');
			await unlockWithToken(slug, ownerToken);
		} catch (err) {
			errBox.hidden = false;
			errBox.textContent = err.message;
		} finally {
			btn.disabled = false;
		}
	});

	// ── Lost-key recovery: code → small ZEC payment → claim new key ──
	function recoverInputs() {
		const slug = normaliseSlug($('r-slug')?.value);
		const recoveryCode = String($('r-code')?.value || '').trim();
		if (!slug) throw new Error('Enter the page slug');
		if (!recoveryCode) throw new Error('Enter the recovery code from page creation (zrk-…)');
		return { slug, recoveryCode };
	}

	$('recover-start')?.addEventListener('click', async () => {
		errBox.hidden = true;
		const box = $('recover-result');
		const btn = $('recover-start');
		btn.disabled = true;
		try {
			const { slug, recoveryCode } = recoverInputs();
			const out = await api(`/v1/ziving/page/${encodeURIComponent(slug)}/recover`, {
				method: 'POST',
				body: JSON.stringify({ recoveryCode })
			});
			box.hidden = false;
			box.replaceChildren();
			renderPaymentCard(box, out.payment, {
				title: 'Unlock payment',
				graceNote: out.note || 'Once it confirms, press “I’ve paid — claim new key”.'
			});
		} catch (err) {
			errBox.hidden = false;
			errBox.textContent = err.message;
		} finally {
			btn.disabled = false;
		}
	});

	$('recover-claim')?.addEventListener('click', async () => {
		errBox.hidden = true;
		const box = $('recover-result');
		const btn = $('recover-claim');
		btn.disabled = true;
		try {
			const { slug, recoveryCode } = recoverInputs();
			const out = await api(`/v1/ziving/page/${encodeURIComponent(slug)}/recover/claim`, {
				method: 'POST',
				body: JSON.stringify({ recoveryCode })
			});
			box.hidden = false;
			box.className = '';
			box.replaceChildren(
				el('div', { class: 'result-box' },
					el('p', { html: '<strong>Save these now — shown only once.</strong>' }),
					el('p', { class: 'field__hint', text: 'New magic key (owner token):' }),
					el('code', { style: 'word-break:break-all;', text: out.ownerToken }),
					el('p', { class: 'field__hint', style: 'margin-top:0.6rem;', text: 'New recovery code:' }),
					el('code', { text: out.recoveryCode }))
			);
			saveOwnerCredentials(slug, out.overlayId, out.ownerToken);
			await enterSession(slug, out.overlayId, out.ownerToken);
		} catch (err) {
			errBox.hidden = false;
			errBox.textContent = /payment_required|not confirmed/iu.test(err.message)
				? 'The unlock payment has not confirmed yet — give it a few minutes, then try again.'
				: err.message;
		} finally {
			btn.disabled = false;
		}
	});

	// ── Recovery code rotation (inside the unlocked panel) ───────────
	$('rotate-recovery')?.addEventListener('click', async () => {
		const box = $('recovery-result');
		const btn = $('rotate-recovery');
		if (!globalThis.confirm('Generate a new recovery code? The old one stops working immediately.')) return;
		btn.disabled = true;
		try {
			const out = await api(`/v1/ziving/page/${encodeURIComponent(session.slug)}/recovery-code`, {
				method: 'POST',
				headers: { 'x-overlay-token': session.ownerToken }
			});
			box.hidden = false;
			box.className = 'result-box';
			box.replaceChildren(
				el('p', { html: '<strong>New recovery code — shown only once. Store it offline.</strong>' }),
				el('code', { text: out.recoveryCode })
			);
		} catch (err) {
			box.hidden = false;
			box.className = 'result-box result-box--warn';
			box.textContent = err.message;
		} finally {
			btn.disabled = false;
		}
	});

	$('copy-obs')?.addEventListener('click', async () => {
		await copyText($('obs-url').textContent, $('copy-obs'));
	});
	$('copy-api-events')?.addEventListener('click', async () => {
		await copyText($('api-events-url').textContent, $('copy-api-events'));
	});

	$('topup-form')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const box = $('topup-result');
		const btn = $('topup-submit');
		box.hidden = true;
		btn.disabled = true;
		try {
			const cents = Math.round(Number($('topup-usd').value) * 100);
			const quote = await api(`/v1/overlay/${encodeURIComponent(session.overlayId)}/topup`, {
				method: 'POST',
				headers: { 'x-overlay-token': session.ownerToken },
				body: JSON.stringify({ amountUsdCents: cents })
			});
			renderPaymentCard(box, quote, {
				title: 'Top-up quote',
				graceNote: `Credit (${quote.credit?.usd || ''}) lands after ${quote.confirmations?.required ?? 8} confirmations.`
			});
		} catch (err) {
			box.hidden = false;
			box.className = 'result-box result-box--warn';
			box.textContent = err.message;
		} finally {
			btn.disabled = false;
		}
	});

	$('feature-form')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const box = $('feature-result');
		const btn = $('feature-submit');
		box.hidden = true;
		btn.disabled = true;
		try {
			const days = Math.floor(Number($('feature-days').value));
			const quote = await api(`/v1/ziving/page/${encodeURIComponent(session.slug)}/feature`, {
				method: 'POST',
				headers: { 'x-overlay-token': session.ownerToken },
				body: JSON.stringify({ days })
			});
			renderPaymentCard(box, quote.payment, {
				title: `Homepage feature — ${days} day${days === 1 ? '' : 's'}`,
				graceNote: quote.note || ''
			});
		} catch (err) {
			box.hidden = false;
			box.className = 'result-box result-box--warn';
			box.textContent = err.message;
		} finally {
			btn.disabled = false;
		}
	});

	$('cancel-btn')?.addEventListener('click', async () => {
		if (!globalThis.confirm(`Cancel campaign "${session.slug}"? This stops scanning and cannot be undone.`)) return;
		const box = $('cancel-result');
		box.hidden = true;
		try {
			await api(`/v1/overlay/${encodeURIComponent(session.overlayId)}`, {
				method: 'DELETE',
				headers: { 'x-overlay-token': session.ownerToken }
			});
			clearOwnerCredentials(session.slug);
			box.hidden = false;
			box.className = 'result-box result-box--warn';
			box.textContent = 'Campaign cancelled. Scanning has stopped.';
			$('cancel-btn').disabled = true;
			$('topup-submit').disabled = true;
			if ($('feature-submit')) $('feature-submit').disabled = true;
			await refreshStatus().catch(() => {});
		} catch (err) {
			box.hidden = false;
			box.className = 'result-box result-box--warn';
			box.textContent = err.message;
		}
	});
}

// ── Boot ────────────────────────────────────────────────────────────

const page = document.body.dataset.page;
initHeaderWallet();
if (page === 'home') initHome();
if (page === 'campaign') {
	const slug = resolveCampaignSlug();
	if (!slug || slug.length < 3) {
		$('campaign-root').textContent = 'Missing campaign slug — use /p/your-slug';
	} else {
		loadCampaign(slug);
	}
}
if (page === 'manage') initManage();
