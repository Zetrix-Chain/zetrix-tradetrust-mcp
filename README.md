# zetrix-tradetrust-mcp

**MCP (Model Context Protocol) server** exposing TradeTrust document/eBL operations on the Zetrix
L2 as MCP tools — a thin, HMAC-signed client over `core-engine`'s REST API. Read tools (verify,
status, finality lookups) work with just a `baseUrl`; write/workflow tools (issue, mint, transfer,
sign) are opt-in and need a caller identity.

## Install

```bash
npm install
```

Published on npm: [`zetrix-tradetrust-mcp`](https://www.npmjs.com/package/zetrix-tradetrust-mcp).

## Zero-config quick start

`Z2TT_CALLER_ID`/`Z2TT_HMAC_SECRET` are optional. With neither set, the server still starts and
registers `health_check`, `verify_credential`, `verify_ebl`, and `list_document_types` — the
routes `core-engine` itself treats as unauthenticated, plus a local document-type lookup with no
network call at all. `Z2TT_BASE_URL`/`Z2TT_ENV` default to the `z2-testnet` sandbox. This is
enough to verify documents or check liveness with zero configuration:

```bash
npm run build
node dist/index.js
```

Add credentials any time (below) to unlock the full read/write tool set.

## Configure

```bash
export Z2TT_ENV="z2-testnet"       # or "z2-mainnet" -- shortcut for the known core-engine deployments
# export Z2TT_BASE_URL="https://core-engine.example/api/z2-core-engine"  # custom deployment instead
export Z2TT_CALLER_ID="zetrix-tradetrust-mcp"
export Z2TT_HMAC_SECRET="…"        # issued out-of-band by whoever operates the deployment
export Z2TT_ALLOW_WRITES="true"    # omit/false to register read-only tools
```

Or point `Z2TT_PROFILE` at a JSON file instead:

```jsonc
{
  "baseUrl": "https://core-engine.example/api/z2-core-engine",
  "callerId": "zetrix-tradetrust-mcp",
  "hmacSecret": "…"
}
```

## Preparing documents: `documentType`

`prepare_credential`, `prepare_mint_ebl`, `issue_document`, and `mint_ebl` accept an optional
`documentType` (e.g. `"certificateOfOrigin"`, `"billOfLading"`, `"commercialInvoice"`) that
auto-fills the JSON-LD `@context` a document type needs for `core-engine`'s signing to succeed —
call `list_document_types` first (no auth needed) to see every known type, its expected
`credentialSubject.type`, whether its shape is proven against `core-engine`, and (if known) the
`templateName` it implies for rendering. Supplying `context` directly still works exactly as
before; `documentType` is purely additive. `prepare_credential`'s `context[0]` defaults to
`https://www.w3.org/ns/credentials/v2` when omitted, matching `core-engine`'s own default; the
older v1.1 base context is rejected outright since `core-engine` can no longer sign against it.

Passing `renderMethod` (even `{}`) opts a document into rendering: `id` defaults to this
deployment's renderer URL, `type` defaults to `EMBEDDED_RENDERER`, and `templateName` defaults to
whatever `documentType` implies — supply any field yourself to override just that one. If
`documentType` is omitted (or has no known `templateName` mapping), `templateName` must be
supplied explicitly; there's no content-agnostic default in `core-engine`'s real template
allowlist.

## Run

```bash
npm run build
node dist/index.js
```

Or run from source directly with `npm run dev` (no build step). Either way, the process listens on
stdio — it doesn't print anything on success, since MCP clients spawn it and speak the protocol
over stdin/stdout, not a human terminal session.

## Register with an MCP client

```jsonc
{
  "mcpServers": {
    "zetrix-tradetrust-mcp": {
      "command": "node",
      "args": ["/abs/path/dist/index.js"],
      "env": {
        "Z2TT_BASE_URL": "https://core-engine.example/api/z2-core-engine",
        "Z2TT_CALLER_ID": "zetrix-tradetrust-mcp",
        "Z2TT_HMAC_SECRET": "…",
        "Z2TT_ALLOW_WRITES": "false"
      }
    }
  }
}
```

### OpenClaw

If the client is [OpenClaw](https://openclaw.dev), skip the manual `mcpServers` wiring and install
[`openclaw-plugin/`](openclaw-plugin) instead — `openclaw plugins install ./openclaw-plugin`
self-registers this server and exposes the same config as plugin settings
(`network`/`baseUrl`/`callerId`/`hmacSecret`/`allowWrites`, all optional).

## License

MIT — see [LICENSE](LICENSE).
