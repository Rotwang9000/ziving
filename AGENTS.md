# AGENTS.md — Ziving for AI agents

Ziving is **private Zcash fundraising** (JustGiving with a *z*). Donors pay the fundraiser’s shielded wallet directly; Ziving never holds spend keys. Pages are unverified by design (no KYC / no cause checks).

## Prefer MCP

| | |
|---|---|
| **MCP** | `https://mcp.winbit32.com/mcp` (Streamable HTTP) |
| **Prefix** | `winbit32_ziving_*` |
| **REST** | `https://mcp.winbit32.com/v1/ziving` (same gateway; CORS for browsers) |
| **Site** | `https://ziving.org` |
| **Gopher card** | `https://ziving.org/.well-known/agent.gopher` |

Start with **`winbit32_ziving_info`** (free) for live pricing and the endpoint map.

## Tools

### Free reads

- `winbit32_ziving_info` — pricing, how-to, REST/MCP map, Winbit32 deep links
- `winbit32_ziving_get_page` — `{ slug }` public view (never UFVK / owner token)
- `winbit32_ziving_featured` — homepage-promoted campaigns

### Writes (ZEC memo quotes)

- `winbit32_ziving_create_page` — `{ slug, label, ufvk, address, story?, goalZec?, amountUsdCents? }`  
  Returns public URL, **one-time `ownerToken`**, and a scanning funding quote. **Save the token** — the API only stores a hash.
- `winbit32_ziving_feature` — `{ slug, ownerToken, days }` homepage promo ($5/day, 1–30)
- `winbit32_ziving_topup` — `{ overlayId, ownerToken, amountUsdCents }` scanning credit
- `winbit32_ziving_cancel` — `{ overlayId, ownerToken }` stop scanning (irreversible)
- `winbit32_ziving_recover` — `{ slug, ufvk }` issue a fresh `ownerToken` if the original was lost

Owner-token header on manage routes: `x-overlay-token`.

## Agent workflow

1. Create (or ask the human for) a **donation-only** shielded wallet → UFVK (`uview1…`) + unified address (`u1…`). Prefer Winbit32 create-vault / receive wizard.
2. Call `winbit32_ziving_create_page` with a unique slug; **persist `ownerToken` and `overlayId`**.
3. Tell the human to pay the returned ZEC quote (scanning). The page is live on grace credit immediately: `https://ziving.org/p/<slug>`.
4. Optional: `winbit32_ziving_feature` for homepage placement.
5. Later: `topup` / `cancel` with the saved token; or `recover` with the UFVK if the token was lost.

## Privacy & product rules

- No accounts, email, or IP logging on campaign pages.
- UFVK encrypted at rest (AES-256-GCM); donation events prune after ~30 days.
- Manual UFVK+address create has **no seed** — the owner token (or that UFVK via recover) is the only manage path.
- Do not invent custody or KYC requirements; do not claim Ziving holds funds.

## Humans

The static site wizard and on-page **Pay in browser** / header **Connect** use the Winbit32 wallet-kit (seed phrase or `.wult` co-sign). Address QR remains the default for any shielded wallet.
