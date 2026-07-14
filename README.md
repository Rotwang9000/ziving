# Ziving

**Private Zcash fundraising** — like [JustGiving](https://www.justgiving.com), but with a *z*.

Fundraisers create a campaign page, receive **shielded ZEC** directly to their own wallet, and show live donations on the page or in a stream overlay. Built on the [payments-gateway](https://github.com/FungeLLC/winbit32MCP) UFVK scanner and [Winbit32](https://winbit32.com) wallet-kit for address creation.

## Principles

| Principle | How |
|-----------|-----|
| **No custody** | Donors pay the fundraiser's shielded address. We never hold spend keys. |
| **Minimal data** | No accounts or email. Stored: encrypted UFVK, public address, optional label/story/goal. |
| **Encrypted secrets** | UFVK at rest under AES-256-GCM (gateway master key). Owner token stored as SHA-256 hash only. |
| **On-chain billing** | Scanning ~$0.02/day, prepaid in ZEC via memo quotes (same rail as donation overlay). |
| **User-controlled wallet** | Create a donation-only vault in Winbit32 (vault wizard, purse/locket, or receive wizard). |

## Repository layout

```
ziving/
  site/                 # Static site (no build) — deploy to ziving.org
    index.html          # Landing + create wizard
    p.html              # Public campaign page (also served at /p/<slug>)
    manage.html         # Owner top-up / cancel (token-gated)
    overlay.html        # OBS browser source
  ops/nginx/            # Example nginx vhost (pretty URLs)
  Jenkinsfile           # Multibranch CI → /var/www/ziving.org
  README.md
```

## URLs

| Path | Purpose |
|------|---------|
| `/` | Landing + start a page |
| `/p/<slug>` | Public campaign (pretty URL) |
| `/p.html?slug=` | Legacy query form |
| `/manage.html?slug=` | Owner manage (top-up / cancel / overlay link) |
| `/overlay.html?slug=` | OBS donation alerts |

## API (payments-gateway)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/v1/ziving` | Service metadata + Winbit32 deep links |
| `POST` | `/v1/ziving/page` | Create campaign |
| `GET` | `/v1/ziving/page/:slug` | Public page + raised total |
| `GET` | `/v1/ziving/page/:slug/events` | Live donation feed |
| `GET` | `/v1/overlay/:id/owner` | Prove owner token (manage UI) |
| `POST` | `/v1/overlay/:id/topup` | Fresh ZEC funding quote |
| `DELETE` | `/v1/overlay/:id` | Cancel |

## Winbit32 wallet flow

1. **Create vault** — `#winbit32.exe/createvault.exe` (2-of-2 recommended)
2. **Export UFVK + UA** — `#winbit32.exe/zcashrecv.exe`
3. **Submit** on ziving.org → pay ZEC funding quote → share `/p/your-slug`
4. **Manage** at `/manage.html` with the one-shot owner token

Use a **donation-only wallet**: a UFVK reveals all incoming amounts and memos to whoever holds it.

## Deploy

```bash
# Local preview
cd site && python3 -m http.server 8080

# Production docroot (owned by rotwang — Jenkins rsyncs here)
rsync -rl --delete site/ /var/www/ziving.org/
```

Gateway env:

```env
ZIVING_PAGE_URL_BASE=https://ziving.org
OVERLAY_PAGE_URL_BASE=https://ziving.org/overlay.html
```

## CI

Multibranch Jenkins job `ziving` (source `Rotwang9000/ziving`, cred `github-rotwang`,
5-min scan) — same pattern as `zecbus`. On `main`: validate → rsync `site/` →
`/var/www/ziving.org` → smoke-test home, assets, and `/p/<slug>` rewrite.

## OBS stream overlay

`https://ziving.org/overlay.html?slug=your-page`  
(or `?overlay=ov_…`)

Params: `&api=`, `&show=confirmed|seen`, `&hold=12`

## Licence

MIT — same family as payments-gateway / Winbit32.
