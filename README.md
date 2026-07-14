# Ziving

**Private Zcash fundraising** — like [JustGiving](https://www.justgiving.com), but with a *z*.

Fundraisers create a campaign page, receive **shielded ZEC** directly to their own wallet, and show live donations on the page or in a stream overlay. Built on the [payments-gateway](https://github.com/Rotwang9000/payments-gateway) UFVK scanner and [Winbit32](https://winbit32.com) wallet-kit.

## Principles

| Principle | How |
|-----------|-----|
| **No custody** | Donors pay the fundraiser's shielded address. We never hold spend keys. |
| **Minimal data** | No accounts or email. Stored: encrypted UFVK, public address, optional label/story/goal, optional featured-until. |
| **Encrypted secrets** | UFVK at rest under AES-256-GCM. Owner token stored as SHA-256 hash only. |
| **On-chain billing** | Scanning **$0.10/day**, prepaid in ZEC. Homepage feature **$5/day** (separate quote). |
| **AI-ready** | Full REST + MCP tools (`*_ziving_*`) so agents can create, feature, top up, and cancel pages. |

## Pricing

| Product | Rate | Notes |
|---------|------|--------|
| UFVK scanning | $0.10 / day | Grace ~$0.15 (~1.5 days) at create |
| Homepage feature | $5.00 / day | 1–30 days; listed on `/` via `GET /v1/ziving/featured` |

## Repository layout

```
ziving/
  site/                 # Static site (no build) — deploy to ziving.org
    index.html          # Landing + multi-step create wizard + featured
    p.html              # Public campaign page (also /p/<slug>)
    manage.html         # Top-up / feature / cancel (wallet or token unlock)
    overlay.html        # OBS browser source
  ops/nginx/            # Example nginx vhost
  Jenkinsfile
  README.md
```

## API (payments-gateway)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/v1/ziving` | Metadata + pricing + MCP notes |
| `GET` | `/v1/ziving/featured` | Homepage-promoted campaigns |
| `POST` | `/v1/ziving/page` | Create campaign |
| `GET` | `/v1/ziving/page/:slug` | Public page + raised total |
| `GET` | `/v1/ziving/page/:slug/events` | Live donation feed |
| `POST` | `/v1/ziving/page/:slug/feature` | Homepage promo quote (`x-overlay-token`) |
| `POST` | `/v1/ziving/page/:slug/recover` | Re-present UFVK → fresh `ownerToken` |
| `POST` | `/v1/overlay/:id/topup` | Scanning top-up quote |
| `DELETE` | `/v1/overlay/:id` | Cancel |

Live base: `https://mcp.winbit32.com`

## MCP (AI setup)

On `https://mcp.winbit32.com/mcp` (prefix e.g. `winbit32`):

- `*_ziving_info` — pricing + how-to
- `*_ziving_create_page` — create + ZEC funding quote (keep `ownerToken`)
- `*_ziving_get_page` / `*_ziving_featured` — reads
- `*_ziving_feature` — homepage promo quote
- `*_ziving_recover` — unlock manage with the campaign UFVK
- `*_ziving_topup` / `*_ziving_cancel` — manage

Tools POST to the public REST base when `fetch` is available.

## On-page wallet

The create wizard can generate or open a donation wallet without leaving ziving.org:

| Mode | What it does |
|------|----------------|
| **Create** (default) | BIP-39 seed + UFVK/UA via WebZjs WASM in the browser |
| **Existing** | Paste a phrase / UFVK, or open `.txt`, `.wult`, locket `.png` |
| **Manual** | Paste UFVK + unified address yourself |

Built with WebZjs + [`@winbit32/wallet-kit`](https://github.com/FungeLLC/WINBIT32/tree/main/packages/wallet-kit) (`.wult` unwrap + Orchard FROST derive). Rebuild after kit/WASM changes:

```bash
npm install
npm run build:wallet   # → site/lib/zcash-wallet.js + WASM assets
```

Native multi-share `.vult` vaults still need Winbit32; export a `.wult`, locket photo, or seed phrase instead.

## Deploy

```bash
cd site && python3 -m http.server 8080
rsync -rl --delete site/ /var/www/ziving.org/
```

Gateway env:

```env
ZIVING_PAGE_URL_BASE=https://ziving.org
OVERLAY_PAGE_URL_BASE=https://ziving.org/overlay.html
```
