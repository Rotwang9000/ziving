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
  site/           # Static site (no build) — deploy to ziving.org
  ops/nginx/      # Example nginx vhost
  README.md
```

## API (payments-gateway)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/v1/ziving` | Service metadata + Winbit32 deep links |
| `POST` | `/v1/ziving/page` | Create campaign (slug, UFVK, address, story?, goal?) |
| `GET` | `/v1/ziving/page/:slug` | Public page + raised total |
| `GET` | `/v1/ziving/page/:slug/events` | Live donation feed |

Management (top-up, cancel) reuses overlay routes with `x-overlay-token`:

- `POST /v1/overlay/:overlayId/topup`
- `DELETE /v1/overlay/:id`

## Winbit32 wallet flow

1. **Create vault** — `#winbit32.exe/createvault.exe` (2-of-2 recommended)
2. **Export UFVK + UA** — `#winbit32.exe/zcashrecv.exe`
3. **Submit** on ziving.org → pay ZEC funding quote → share page URL

Use a **donation-only wallet**: a UFVK reveals all incoming amounts and memos to whoever holds it.

## Deploy static site

```bash
# From this repo — serve locally
cd site && python3 -m http.server 8080

# Production: copy site/ to /var/www/ziving.org and point nginx at it.
# Set on the gateway host:
#   ZIVING_PAGE_URL_BASE=https://ziving.org
#   OVERLAY_PAGE_URL_BASE=https://ziving.org/overlay.html
```

## OBS stream overlay

Add browser source: `https://ziving.org/overlay.html?slug=your-page`  
(or `?overlay=ov_…` for capability URL without slug)

Params: `&api=`, `&show=confirmed|seen`, `&hold=12`

## Environment

Gateway (`payments-gateway`):

```env
ZIVING_PAGE_URL_BASE=https://ziving.org
OVERLAY_PAGE_URL_BASE=https://ziving.org/overlay.html
PRIVATE_WATCH_ENCRYPTION_KEY=<64-char-hex>
NFPT_BASE_URL=...
ZEC_RECV_ADDRESS=...
```

## Licence

MIT — same family as payments-gateway / Winbit32.
