// Ziving.org — static site (no build step). Talks to payments-gateway REST.

const API_BASE = (document.documentElement.dataset.api || 'https://mcp.winbit32.com').replace(/\/$/u, '');
const WINBIT32 = 'https://winbit32.com';
const ZIVING_ORIGIN = location.origin.replace(/\/$/u, '');
const POLL_MS = 10_000;

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k === 'html') node.innerHTML = v;
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

async function api(path, opts = {}) {
	const res = await fetch(`${API_BASE}${path}`, {
		headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
		...opts
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

async function renderQr(canvas, address) {
	if (!globalThis.QRCode) return;
	await QRCode.toCanvas(canvas, `zcash:${address}`, { width: 180, margin: 1, color: { dark: '#14121f' } });
}

// ── Home / create ───────────────────────────────────────────────────

function initHome() {
	const dialog = $('create-dialog');
	const openBtn = $('open-create');
	const closeBtn = $('close-create');
	const form = $('create-form');
	const slugInput = $('slug');
	const slugPreview = $('slug-preview');

	$('link-vault').href = `${WINBIT32}/#winbit32.exe/createvault.exe`;
	$('link-receive').href = `${WINBIT32}/#winbit32.exe/zcashrecv.exe`;
	$('link-purse').href = `${WINBIT32}/#winbit32.exe/purse.exe`;

	openBtn?.addEventListener('click', () => dialog?.showModal());
	closeBtn?.addEventListener('click', () => dialog?.close());
	dialog?.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

	slugInput?.addEventListener('input', () => {
		const s = normaliseSlug(slugInput.value) || 'your-slug';
		if (slugPreview) slugPreview.textContent = s;
	});

	form?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const result = $('create-result');
		const submit = $('create-submit');
		if (result) { result.hidden = true; result.innerHTML = ''; }
		submit.disabled = true;
		try {
			const slug = normaliseSlug(slugInput.value);
			const amountUsd = Number($('amountUsd').value);
			const payload = {
				slug,
				label: $('label').value.trim() || slug,
				story: $('story').value.trim() || undefined,
				goalZec: $('goalZec').value ? Number($('goalZec').value) : undefined,
				ufvk: $('ufvk').value.trim(),
				address: $('address').value.trim(),
				amountUsdCents: Math.round(amountUsd * 100)
			};
			const out = await api('/v1/ziving/page', { method: 'POST', body: JSON.stringify(payload) });
			saveOwnerCredentials(slug, out.overlayId, out.ownerToken);
			const pageUrl = out.urls?.page || `${ZIVING_ORIGIN}/p.html?slug=${encodeURIComponent(slug)}`;
			if (result) {
				result.hidden = false;
				result.className = 'result-box';
				result.innerHTML = `
					<p><strong>Page created!</strong> <a href="${pageUrl}">${pageUrl}</a></p>
					<p class="field__hint">Owner token (save now — shown once):</p>
					<p><code>${out.ownerToken}</code></p>
					<p><strong>Fund scanning</strong> — send ${out.payment?.amount?.display || 'ZEC'} to
					<code>${out.payment?.payTo}</code> with memo <code>${out.payment?.memo}</code></p>
					<p class="field__hint">${out.graceNote || ''}</p>
				`;
			}
		} catch (err) {
			if (result) {
				result.hidden = false;
				result.className = 'result-box result-box--warn';
				result.textContent = err.message;
			}
		} finally {
			submit.disabled = false;
		}
	});
}

// ── Campaign page ───────────────────────────────────────────────────

async function loadCampaign(slug) {
	const root = $('campaign-root');
	const obsLink = $('obs-link');
	try {
		const page = await api(`/v1/ziving/page/${encodeURIComponent(slug)}`);
		document.title = `${page.label || slug} — Ziving`;

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
		const donateCard = el('aside', { class: 'donate-card' },
			el('h3', { text: 'Donate shielded ZEC' }),
			el('canvas', { class: 'donate-card__qr', id: 'donate-qr' }),
			el('p', { class: 'donate-card__addr', id: 'donate-addr', text: page.address }),
			el('button', { class: 'btn btn--primary btn--sm', type: 'button', id: 'copy-addr', text: 'Copy address' }),
			el('p', { class: 'donate-card__hint', text: 'Add an optional memo — it may appear on the page or stream.' }));

		const donationsBox = el('section', { class: 'donations' },
			el('h2', { class: 'section-title', html: 'Recent <span class="accent">gifts</span>' }),
			el('div', { id: 'donation-list' }));

		root.replaceChildren(
			el('div', { class: 'campaign-hero' },
				el('div', {},
					el('span', { class: statusClass, text: page.active ? 'Live' : 'Paused' }),
					el('h1', { class: 'campaign-title', text: page.label || slug }),
					page.story ? el('p', { class: 'campaign-story', text: page.story }) : null,
					progress),
				donateCard),
			donationsBox);

		const canvas = $('donate-qr');
		if (canvas) await renderQr(canvas, page.address);
		$('copy-addr')?.addEventListener('click', async () => {
			await navigator.clipboard.writeText(page.address);
			$('copy-addr').textContent = 'Copied!';
			setTimeout(() => { $('copy-addr').textContent = 'Copy address'; }, 2000);
		});

		if (obsLink && page.urls?.obsPage) {
			obsLink.hidden = false;
			obsLink.href = page.urls.obsPage;
		} else if (obsLink && page.overlayId) {
			obsLink.hidden = false;
			obsLink.href = `${ZIVING_ORIGIN}/overlay.html?overlay=${encodeURIComponent(page.overlayId)}`;
		}

		let sinceId = 0;
		const renderDonations = (events) => {
			const list = $('donation-list');
			if (!list) return;
			if (!events.length) {
				list.replaceChildren(el('p', { class: 'empty-state', text: 'No confirmed gifts yet — be the first!' }));
				return;
			}
			const rows = [...events].reverse().map((ev) =>
				el('div', { class: 'donation-row' },
					el('span', { class: 'donation-row__amt', text: fmtZec(ev.amountZec) }),
					el('span', { class: 'donation-row__memo', text: ev.memo || '—' }),
					el('span', { class: 'donation-row__meta', text: ev.status })));
			list.replaceChildren(...rows);
		};

		const pollEvents = async () => {
			try {
				const feed = await api(`/v1/ziving/page/${encodeURIComponent(slug)}/events?sinceId=${sinceId}`);
				const confirmed = (feed.events || []).filter((e) => e.status === 'confirmed');
				if (confirmed.length) sinceId = confirmed[confirmed.length - 1].id;
				// Always show full list from 0 for simplicity on page load refresh
				const full = await api(`/v1/ziving/page/${encodeURIComponent(slug)}/events?sinceId=0`);
				renderDonations((full.events || []).filter((e) => e.status === 'confirmed'));
				// Refresh totals
				const fresh = await api(`/v1/ziving/page/${encodeURIComponent(slug)}`);
				const raisedEl = root.querySelector('.progress__raised');
				if (raisedEl) raisedEl.textContent = fmtZec(fresh.raised.zec);
				const fill = root.querySelector('.progress__fill');
				if (fill && fresh.raised?.percentOfGoal != null) {
					fill.style.width = `${Math.min(100, fresh.raised.percentOfGoal)}%`;
				}
			} catch { /* silent poll */ }
		};
		await pollEvents();
		setInterval(pollEvents, POLL_MS);
	} catch (err) {
		root.replaceChildren(el('p', { class: 'empty-state', text: err.message || 'Campaign not found' }));
	}
}

// ── Boot ────────────────────────────────────────────────────────────

const page = document.body.dataset.page;
if (page === 'home') initHome();
if (page === 'campaign') {
	const slug = normaliseSlug(new URLSearchParams(location.search).get('slug'));
	if (!slug || slug.length < 3) {
		$('campaign-root').textContent = 'Missing ?slug= on the URL';
	} else {
		loadCampaign(slug);
	}
}
