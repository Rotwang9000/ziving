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
const overlayUrl = (slug) => `${ZIVING_ORIGIN}/overlay.html?slug=${encodeURIComponent(slug)}`;

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

async function renderQr(canvas, address) {
	if (!globalThis.QRCode) return;
	await QRCode.toCanvas(canvas, `zcash:${address}`, { width: 180, margin: 1, color: { dark: '#1a2420' } });
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

	loadFeatured();

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
			review.innerHTML = `
				<p><strong>${($('label').value.trim() || slug)}</strong></p>
				<p>URL: <code>${pageUrl(slug)}</code></p>
				<p>Prepay scanning credit: <strong>$${usd}</strong></p>
				<p class="field__hint">Receive: <code>${address ? `${address.slice(0, 18)}…` : '(missing)'}</code></p>
				<p class="field__hint">Click <strong>Create page</strong> — you'll get a ZEC amount, pay-to address, and memo to fund the $${usd} scanning credit. The page is live on grace credit while that confirms.</p>
			`;
		}
		updateCreateButton();
		return true;
	}

	function validateStep(n, { silent = false } = {}) {
		if (n === 1) {
			const slug = normaliseSlug(slugInput.value);
			if (slug.length < 3) {
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
		if (result) { result.hidden = true; result.innerHTML = ''; }
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
			const url = out.urls?.page || pageUrl(slug);
			$('create-review').hidden = true;
			if (result) {
				result.hidden = false;
				result.className = 'result-box';
				result.innerHTML = `
					<p><strong>Page created!</strong> <a href="${url}">${url}</a></p>
					<p class="field__hint">Owner token (save now — shown once):</p>
					<p><code>${out.ownerToken}</code></p>
					<p><a href="/manage.html?slug=${encodeURIComponent(slug)}">Open manage page</a>
					· <a href="${overlayUrl(slug)}">Stream overlay</a></p>
					<p><strong>Fund scanning</strong> — send ${out.payment?.amount?.display || 'ZEC'} to
					<code>${out.payment?.payTo}</code> with memo <code>${out.payment?.memo}</code></p>
					<p class="field__hint">${out.graceNote || ''}</p>
				`;
			}
			$('create-submit').hidden = true;
			$('wizard-back').hidden = true;
		} catch (err) {
			if (result) {
				result.hidden = false;
				result.className = 'result-box result-box--warn';
				result.textContent = err.message;
			}
			updateCreateButton();
		} finally {
			submit.disabled = false;
			updateCreateButton();
		}
	});

	setWalletMode('create');
	setStep(1, { force: true });
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
					page.featured ? el('span', { class: 'status-pill', style: 'margin-left:0.4rem;color:var(--gold);', text: 'Featured' }) : null,
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

		if (obsLink) {
			obsLink.hidden = false;
			obsLink.href = page.urls?.obsPage || overlayUrl(slug);
		}

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
				const full = await api(`/v1/ziving/page/${encodeURIComponent(slug)}/events?sinceId=0`);
				renderDonations((full.events || []).filter((e) => e.status === 'confirmed'));
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

// ── Manage page (owner token) ───────────────────────────────────────

function initManage() {
	const unlockForm = $('unlock-form');
	const panel = $('manage-panel');
	const errBox = $('unlock-error');
	const slugField = $('m-slug');
	const tokenField = $('m-token');

	const preSlug = normaliseSlug(new URLSearchParams(location.search).get('slug'));
	if (preSlug && slugField) {
		slugField.value = preSlug;
		const saved = loadOwnerCredentials(preSlug);
		if (saved?.ownerToken && tokenField) tokenField.value = saved.ownerToken;
	}

	let session = { slug: '', overlayId: '', ownerToken: '' };

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
		$('obs-url').textContent = overlayUrl(session.slug);
		return page;
	}

	unlockForm?.addEventListener('submit', async (e) => {
		e.preventDefault();
		errBox.hidden = true;
		const slug = normaliseSlug(slugField.value);
		const ownerToken = String(tokenField.value || '').trim();
		if (!slug || !ownerToken) return;
		try {
			const page = await api(`/v1/ziving/page/${encodeURIComponent(slug)}`);
			await api(`/v1/overlay/${encodeURIComponent(page.overlayId)}/owner`, {
				headers: { 'x-overlay-token': ownerToken }
			});
			session = { slug, overlayId: page.overlayId, ownerToken };
			if ($('m-remember')?.checked) saveOwnerCredentials(slug, page.overlayId, ownerToken);
			else clearOwnerCredentials(slug);
			unlockForm.hidden = true;
			panel.hidden = false;
			await refreshStatus();
			history.replaceState(null, '', `/manage.html?slug=${encodeURIComponent(slug)}`);
		} catch (err) {
			errBox.hidden = false;
			errBox.textContent = err.message;
		}
	});

	$('copy-obs')?.addEventListener('click', async () => {
		await navigator.clipboard.writeText($('obs-url').textContent);
		$('copy-obs').textContent = 'Copied!';
		setTimeout(() => { $('copy-obs').textContent = 'Copy overlay URL'; }, 2000);
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
			box.hidden = false;
			box.className = 'result-box';
			box.innerHTML = `
				<p><strong>Send ${quote.amount?.display || 'ZEC'}</strong> to <code>${quote.payTo}</code></p>
				<p>Memo: <code>${quote.memo}</code></p>
				<p class="field__hint">Quote expires ${quote.expiresAt ? new Date(quote.expiresAt).toLocaleString() : 'soon'}.
				Credit (${quote.credit?.usd || ''}) lands after ${quote.confirmations?.required ?? 8} confirmations.</p>
			`;
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
			box.hidden = false;
			box.className = 'result-box';
			box.innerHTML = `
				<p><strong>Homepage feature — ${days} day${days === 1 ? '' : 's'}</strong></p>
				<p>Send ${quote.payment?.amount?.display || 'ZEC'} to <code>${quote.payment?.payTo}</code></p>
				<p>Memo: <code>${quote.payment?.memo}</code></p>
				<p class="field__hint">${quote.note || ''}</p>
			`;
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
