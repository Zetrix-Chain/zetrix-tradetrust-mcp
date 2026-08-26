import { z, ZodError } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CoreEngineError, ServiceDisabledError } from "./errors.js";
import type { CoreEngineClient } from "./client/types.js";
import type { Capability } from "./config/capabilities.js";
import { createCoreEngineClient } from "./client/core-engine.js";
import { createElicitingSecretProvider } from "./secret-elicitation.js";
import type { Profile } from "./config/profile.js";
import { resolveRendererUrl } from "./config/profile.js";
import { registeredToolNames, filterForCredentials } from "./tools/registry.js";
import { healthCheck } from "./tools/utility.js";
import { listDocumentTypes } from "./tools/document-types.js";
import {
  getFinality,
  verifyCredential,
  verifyEbl,
  getStatusList,
  getEblOwner,
  getEndorsementChain,
  resolveIdentity,
  txHashSchema,
  verifyInputSchema,
  getStatusListInputSchema,
  tokenAndRegistrySchema,
  resolveIdentityInputSchema,
} from "./tools/query.js";
import {
  prepareCredential,
  signCredential,
  completeCredential,
  mutateStatus,
  prepareMintEbl,
  completeMintEbl,
  transferHolder,
  transferBeneficiary,
  transferOwners,
  nominateBeneficiary,
  rejectTransferHolder,
  rejectTransferBeneficiary,
  rejectTransferOwners,
  surrenderEbl,
  acceptSurrender,
  rejectSurrender,
  onboardIssuer,
  onboardIssuerRelay,
  buildRelayTx,
  submitRelayTx,
  bindIdentity,
  prepareCredentialInputSchema,
  signCredentialInputSchema,
  completeCredentialInputSchema,
  mutateStatusInputSchema,
  prepareMintEblInputSchema,
  completeMintEblInputSchema,
  transferHolderInputSchema,
  beneficiaryInputSchema,
  transferOwnersInputSchema,
  fromAndRegistryInputSchema,
  onboardIssuerInputSchema,
  buildRelayTxInputSchema,
  submitRelayTxInputSchema,
  bindIdentityInputSchema,
} from "./tools/write.js";
import { issueDocument, mintEbl, issueDocumentInputSchema, mintEblInputSchema } from "./tools/workflows.js";
import { createIssuerKey, createIssuerKeyInputSchema } from "./tools/keys.js";
import { signRelayRequest, signRelayRequestInputSchema } from "./tools/relay-signing.js";

const SAFE_MODE_VALIDATION_ERROR_HINT =
  " -- likely cause: a context/property mismatch (context[0] must match the VC version of any " +
  "date property used) or a credentialSubject field not defined by an allowlisted context. Call " +
  "list_document_types and recheck context[0].";

export function formatError(err: unknown): { type: string; message: string; capability?: string } {
  if (err instanceof ServiceDisabledError) {
    return { type: err.name, message: err.message, capability: err.capability };
  }
  if (err instanceof CoreEngineError) {
    const message = /safe mode validation error/i.test(err.message)
      ? `${err.message}${SAFE_MODE_VALIDATION_ERROR_HINT}`
      : err.message;
    return { type: err.name, message };
  }
  if (err instanceof ZodError) {
    return { type: "ValidationError", message: err.message };
  }
  return { type: "Error", message: err instanceof Error ? err.message : String(err) };
}

export interface ToolDescriptor {
  description: string;
  schema: z.ZodType;
  handler: (args: unknown) => Promise<unknown>;
}

const EMPTY_SCHEMA = z.object({});

export function buildToolDescriptors(
  client: CoreEngineClient,
  capabilities: Partial<Record<Capability, boolean>> | undefined,
  allowWrites: boolean,
  hasCredentials: boolean = true,
  rendererBaseUrl?: string
): Record<string, ToolDescriptor> {
  const all: Record<string, ToolDescriptor> = {
    health_check: {
      description: "Liveness probe. No auth needed even by core-engine.",
      schema: EMPTY_SCHEMA,
      handler: () => healthCheck(client),
    },
    list_document_types: {
      description:
        "Lists known document types with their required TrustVC extension context URL(s) (not the " +
        "base VC context) and whether the shape is proven against core-engine. Call this before " +
        "prepare_credential/prepare_mint_ebl and pass the key as documentType to auto-fill the " +
        "extension context. prepare_credential defaults context[0] to " +
        "https://www.w3.org/ns/credentials/v2 when you omit it entirely, matching core-engine's " +
        "own default -- supply it yourself only to override, and never as the v1.1 base context " +
        "(rejected there, see prepare_credential); prepare_mint_ebl adds its own base context " +
        "automatically too, so it never needs one from you either.",
      schema: EMPTY_SCHEMA,
      handler: () => Promise.resolve(listDocumentTypes()),
    },
    verify_credential: {
      description: "Full verification of a verifiable-document credential.",
      schema: verifyInputSchema,
      handler: (args) => verifyCredential(client, args as never, capabilities),
    },
    verify_ebl: {
      description: "Same as verify_credential, plus on-chain minted/active status and current owner.",
      schema: verifyInputSchema,
      handler: (args) => verifyEbl(client, args as never, capabilities),
    },
    get_status_list: {
      description: "Fetch a signed status-list VC for a purpose (revocation/suspension).",
      schema: getStatusListInputSchema,
      handler: (args) => getStatusList(client, args as never, capabilities),
    },
    get_ebl_owner: {
      description: "Current on-chain owner (beneficiary/holder pair) of a token.",
      schema: tokenAndRegistrySchema,
      handler: (args) => getEblOwner(client, args as never, capabilities),
    },
    get_endorsement_chain: {
      description: "Full ownership-change history for a token.",
      schema: tokenAndRegistrySchema,
      handler: (args) => getEndorsementChain(client, args as never, capabilities),
    },
    resolve_identity: {
      description: "Resolve a bound did:zid for a wallet address.",
      schema: resolveIdentityInputSchema,
      handler: (args) => resolveIdentity(client, args as never, capabilities),
    },
    get_finality: {
      description: "Finality status of a transaction.",
      schema: txHashSchema,
      handler: (args) => getFinality(client, args as never, capabilities),
    },
    prepare_credential: {
      description:
        "Builds an unsigned VC + the signing spec the caller's signer needs -- first step of " +
        "prepare -> sign? -> complete (see issue_document for the combined flow). If context[0] " +
        "is missing or unrecognized, it defaults to https://www.w3.org/ns/credentials/v2 (pairs " +
        "with validFrom) -- matching core-engine's own default, so omitting context entirely, or " +
        "using documentType alone, both still work. The one context[0] value actually rejected is " +
        "the v1.1 base context (https://www.w3.org/2018/credentials/v1, pairs with issuanceDate): " +
        "core-engine currently emits validFrom regardless of context version, so a v1.1 credential " +
        "built here can never be signed -- that's the only case worth failing before it reaches " +
        "core-engine. Use documentType (see list_document_types) to auto-fill the TrustVC " +
        "extension context for credentialSubject fields. " +
        "renderMethod, if used, is a single object {id, type, templateName} here -- core-engine " +
        "wraps it into a one-element array in the signed document itself (matching TrustVC's own " +
        "DocumentBuilder convention), so sending an array as input is rejected; qrCode stays a " +
        "plain object in both places. Never supply a top-level id -- it's signer-generated and " +
        "rejected if you do; it appears in the final signed VC without your involvement. " +
        "render-method-context-v2.json / qrcode-context.json are added to context automatically " +
        "by core-engine when renderMethod/qrCode are present -- no need to add them yourself. " +
        "renderMethod's fields each have defaults: supplying any part of it (even {}) means you " +
        "want rendering -- id defaults to this deployment's renderer URL, type defaults to " +
        "EMBEDDED_RENDERER, and templateName defaults to whatever documentType implies; if " +
        "documentType is omitted or has no known templateName mapping, templateName must be " +
        "supplied explicitly -- core-engine's allowlist has no content-agnostic default. Supply " +
        "any field explicitly to override just that one.",
      schema: prepareCredentialInputSchema,
      handler: (args) => prepareCredential(client, args as never, capabilities, rendererBaseUrl),
    },
    sign_credential: {
      description:
        "core-engine signs on the issuer's behalf, given the raw key. Opt-in, off by default. A " +
        "'Safe mode validation error' here means the unsigned VC's context and properties " +
        "disagree, or a credentialSubject field isn't defined by an allowlisted context -- not a " +
        "problem with the signing key. Call list_document_types and recheck the context " +
        "prepare_credential was given.",
      schema: signCredentialInputSchema,
      handler: (args) => signCredential(client, args as never, capabilities),
    },
    complete_credential: {
      description:
        "Verifies the signed VC and finalizes it against the earlier prepare call. Rejects if the " +
        "signing key's controller doesn't match the earlier signingSpec.expectedIssuerDid, or if " +
        "mandatoryPointers were reconstructed instead of taken from signingSpec verbatim (that " +
        "silently drops decorations like renderMethod/qrCode/expirationDate from the signed proof).",
      schema: completeCredentialInputSchema,
      handler: (args) => completeCredential(client, args as never, capabilities),
    },
    issue_document: {
      description:
        "Intent-driven front door for Pillar 1: prepare_credential -> sign_credential? -> " +
        "complete_credential, calling prepare_credential internally (so its base-context and " +
        "renderMethod-defaulting behavior both apply here too -- see prepare_credential). " +
        "Omitting keyPair returns the unsigned VC plus a note to sign externally, then call " +
        "complete_credential with the same preparationId.",
      schema: issueDocumentInputSchema,
      handler: (args) => issueDocument(client, args as never, capabilities, rendererBaseUrl),
    },
    create_issuer_key: {
      description:
        "Generates a fresh signing key locally -- no core-engine call, never persisted BY THIS SERVER. " +
        "For kind: \"vc\", omit issuerDid to get a correctly self-resolving did:key identity derived " +
        "from the generated key itself -- this is the identity that will actually pass signature " +
        "verification later. Passing a did:key string as issuerDid is rejected: a did:key identity " +
        "is self-derived from its own public key, so a freshly generated key pair can never resolve " +
        "under someone else's did:key. Supply issuerDid only for a caller-owned did:web. keyId, if " +
        "supplied, must name a verification method on the same controller (issuerDid, or the " +
        "auto-derived did:key when issuerDid is omitted) -- a keyId naming a different DID is " +
        "rejected for the same reason. The returned secretKeyMultibase / privateKey is still the " +
        "tool's result, so it lands in the calling MCP host's transcript same as any other output " +
        "-- store it yourself if you need it again.",
      schema: createIssuerKeyInputSchema,
      handler: (args) => createIssuerKey(args as never, capabilities),
    },
    mutate_status: {
      description: "Revoke or suspend (unrevoke) a credential's status-list entry.",
      schema: mutateStatusInputSchema,
      handler: (args) => mutateStatus(client, args as never, capabilities),
    },
    prepare_mint_ebl: {
      description:
        "Builds the unsigned mint VC for a transferable record. Unlike prepare_credential, " +
        "core-engine prepends the base VC context automatically here -- context/documentType are " +
        "only for the TrustVC extension URL(s) (see list_document_types); don't add a base context " +
        "yourself, even if you're used to supplying it for prepare_credential -- doing so produces " +
        "a harmless but wrong duplicated context entry in the signed output. renderMethod, if " +
        "used, is a single object {id, type, templateName} here too -- core-engine wraps it into a " +
        "one-element array in the signed document itself, so sending an array as input is " +
        "rejected. Never supply a top-level id -- it's signer-generated and rejected if you do. " +
        "renderMethod's fields have the same defaults as prepare_credential's -- see there for " +
        "details.",
      schema: prepareMintEblInputSchema,
      handler: (args) => prepareMintEbl(client, args as never, capabilities, rendererBaseUrl),
    },
    complete_mint_ebl: {
      description:
        "Finalizes the mint: verifies the signed VC and returns the unsigned mint tx. Same " +
        "signingSpec.expectedIssuerDid/mandatoryPointers constraints as complete_credential apply " +
        "here.",
      schema: completeMintEblInputSchema,
      handler: (args) => completeMintEbl(client, args as never, capabilities),
    },
    mint_ebl: {
      description:
        "Intent-driven front door for Pillar 2: prepare_mint_ebl -> sign_credential? -> " +
        "complete_mint_ebl, calling prepare_mint_ebl internally (so its renderMethod-defaulting " +
        "behavior applies here too -- see prepare_mint_ebl). Omitting keyPair returns the " +
        "unsigned VC plus a note to sign externally, then call complete_mint_ebl with the same " +
        "preparationId.",
      schema: mintEblInputSchema,
      handler: (args) => mintEbl(client, args as never, capabilities, rendererBaseUrl),
    },
    transfer_holder: {
      description: "Transfers the holder of an eBL.",
      schema: transferHolderInputSchema,
      handler: (args) => transferHolder(client, args as never, capabilities),
    },
    transfer_beneficiary: {
      description: "Transfers the beneficiary of an eBL.",
      schema: beneficiaryInputSchema,
      handler: (args) => transferBeneficiary(client, args as never, capabilities),
    },
    transfer_owners: {
      description: "Combined beneficiary + holder transfer in one call.",
      schema: transferOwnersInputSchema,
      handler: (args) => transferOwners(client, args as never, capabilities),
    },
    nominate_beneficiary: {
      description: "Nominates a new beneficiary for an eBL.",
      schema: beneficiaryInputSchema,
      handler: (args) => nominateBeneficiary(client, args as never, capabilities),
    },
    reject_transfer_holder: {
      description: "Rejects a pending holder transfer.",
      schema: fromAndRegistryInputSchema,
      handler: (args) => rejectTransferHolder(client, args as never, capabilities),
    },
    reject_transfer_beneficiary: {
      description: "Rejects a pending beneficiary transfer.",
      schema: fromAndRegistryInputSchema,
      handler: (args) => rejectTransferBeneficiary(client, args as never, capabilities),
    },
    reject_transfer_owners: {
      description: "Rejects a pending combined owners transfer.",
      schema: fromAndRegistryInputSchema,
      handler: (args) => rejectTransferOwners(client, args as never, capabilities),
    },
    surrender_ebl: {
      description: "Surrenders an eBL back to the issuer.",
      schema: fromAndRegistryInputSchema,
      handler: (args) => surrenderEbl(client, args as never, capabilities),
    },
    accept_surrender: {
      description: "Accepts a surrendered eBL -- end of life.",
      schema: fromAndRegistryInputSchema,
      handler: (args) => acceptSurrender(client, args as never, capabilities),
    },
    reject_surrender: {
      description: "Rejects a surrender -- eBL goes back to active.",
      schema: fromAndRegistryInputSchema,
      handler: (args) => rejectSurrender(client, args as never, capabilities),
    },
    onboard_issuer: {
      description: "Deploys a brand-new token registry for a new issuer.",
      schema: onboardIssuerInputSchema,
      handler: (args) => onboardIssuer(client, args as never, capabilities),
    },
    onboard_issuer_relay: {
      description: "Same as onboard_issuer, but gasless -- core-engine's relayer pays gas.",
      schema: onboardIssuerInputSchema,
      handler: (args) => onboardIssuerRelay(client, args as never, capabilities),
    },
    build_relay_tx: {
      description: "Wraps an already-built unsigned tx as a signable EIP-712 ForwardRequest.",
      schema: buildRelayTxInputSchema,
      handler: (args) => buildRelayTx(client, args as never, capabilities),
    },
    submit_relay_tx: {
      description: "Submits a signed ForwardRequest -- core-engine's relayer wallet relays it.",
      schema: submitRelayTxInputSchema,
      handler: (args) => submitRelayTx(client, args as never, capabilities),
    },
    sign_relay_request: {
      description: "Signs the EIP-712 ForwardRequest build_relay_tx returns, purely locally.",
      schema: signRelayRequestInputSchema,
      handler: (args) => signRelayRequest(args as never),
    },
    bind_identity: {
      description: "Binds a did:zid to a wallet address via a dual signature.",
      schema: bindIdentityInputSchema,
      handler: (args) => bindIdentity(client, args as never, capabilities),
    },
  };

  const names = filterForCredentials(
    registeredToolNames({ Z2TT_ALLOW_WRITES: allowWrites ? "true" : undefined }),
    hasCredentials
  );
  return Object.fromEntries(names.map((name) => [name, all[name]]));
}

export function buildServer(profile: Profile, allowWrites: boolean): McpServer {
  const server = new McpServer({ name: "zetrix-tradetrust-mcp", version: "0.1.0" });
  const hasCredentials =
    profile.callerId !== undefined && (profile.hmacSecret !== undefined || profile.allowSecretPrompt === true);

  if (!hasCredentials) {
    const missing: string[] = [];
    if (profile.callerId === undefined) missing.push("Z2TT_CALLER_ID");
    if (profile.hmacSecret === undefined && profile.allowSecretPrompt !== true) missing.push("Z2TT_HMAC_SECRET");
    const missingList = missing.join("/");
    console.error(
      `[z2-trade-trust-mcp] no ${missingList} configured -- only health_check, ` +
        `verify_credential, verify_ebl, list_document_types are available. Set ${missingList} (or _FILE) to enable the rest.`
    );
  }
  if (profile.baseUrlDefaulted) {
    console.error("[z2-trade-trust-mcp] no Z2TT_BASE_URL/Z2TT_ENV set -- defaulting to z2-testnet sandbox.");
  }

  // Safe: hasCredentials being true is only possible when profile.callerId !== undefined, per the
  // formula above -- TypeScript can't see that correlation across the two separate expressions.
  const getSecret =
    hasCredentials && profile.hmacSecret === undefined
      ? createElicitingSecretProvider(server.server, profile.callerId as string)
      : undefined;
  const client = createCoreEngineClient(profile, { getSecret, authenticated: hasCredentials });
  const rendererBaseUrl = resolveRendererUrl(profile.baseUrl);
  const descriptors = buildToolDescriptors(client, profile.capabilities, allowWrites, hasCredentials, rendererBaseUrl);

  for (const [name, { description, schema, handler }] of Object.entries(descriptors)) {
    server.registerTool(name, { description, inputSchema: schema }, async (args: unknown) => {
      try {
        const result = await handler(args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: formatError(err) }) }] };
      }
    });
  }

  return server;
}
