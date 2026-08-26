import { z } from "zod";
import type { CoreEngineClient } from "../client/types.js";
import { assertCapabilityEnabled, type Capability } from "../config/capabilities.js";
import {
  checkBaseContext,
  DOCUMENT_TYPE_KEYS,
  mergeDocumentTypeContext,
  resolveTemplateName,
  RENDER_TEMPLATE_NAMES,
  VC_V2_CONTEXT,
  type DocumentTypeKey,
  type RenderTemplateName,
} from "../config/document-types.js";
import { ContextValidationError, RenderMethodValidationError } from "../errors.js";

export type ToolCapabilities = Partial<Record<Capability, boolean>>;

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x + 20 bytes EVM address");

/** The preview a dryRun call returns instead of actually sending the request. */
export interface DryRunResult {
  dryRun: true;
  wouldSend: { method: "POST"; path: string; body: unknown };
}

export const transferHolderInputSchema = z.object({
  tokenId: z.string(),
  newHolder: addressSchema,
  from: addressSchema,
  tokenRegistry: addressSchema,
  dryRun: z.boolean().optional(),
});
export type TransferHolderInput = z.infer<typeof transferHolderInputSchema>;

export async function transferHolder(
  client: CoreEngineClient,
  input: TransferHolderInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  const { tokenId, newHolder, from, tokenRegistry, dryRun } = transferHolderInputSchema.parse(input);
  const path = `/ebl/${encodeURIComponent(tokenId)}/transfer-holder`;
  assertCapabilityEnabled(path, capabilities);
  const body = { newHolder, from, tokenRegistry };

  if (dryRun) {
    return { dryRun: true, wouldSend: { method: "POST", path, body } };
  }
  return client.post<Record<string, unknown>>(path, body);
}

export const beneficiaryInputSchema = z.object({
  tokenId: z.string(),
  newBeneficiary: addressSchema,
  from: addressSchema,
  tokenRegistry: addressSchema,
  dryRun: z.boolean().optional(),
});
export type BeneficiaryInput = z.infer<typeof beneficiaryInputSchema>;

async function postBeneficiaryAction(
  client: CoreEngineClient,
  routeSuffix: string,
  input: BeneficiaryInput,
  capabilities: ToolCapabilities | undefined
): Promise<Record<string, unknown> | DryRunResult> {
  const { tokenId, newBeneficiary, from, tokenRegistry, dryRun } = beneficiaryInputSchema.parse(input);
  const path = `/ebl/${encodeURIComponent(tokenId)}/${routeSuffix}`;
  assertCapabilityEnabled(path, capabilities);
  const body = { newBeneficiary, from, tokenRegistry };

  if (dryRun) {
    return { dryRun: true, wouldSend: { method: "POST", path, body } };
  }
  return client.post<Record<string, unknown>>(path, body);
}

export function transferBeneficiary(
  client: CoreEngineClient,
  input: BeneficiaryInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  return postBeneficiaryAction(client, "transfer-beneficiary", input, capabilities);
}

export function nominateBeneficiary(
  client: CoreEngineClient,
  input: BeneficiaryInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  return postBeneficiaryAction(client, "nominate", input, capabilities);
}

export const transferOwnersInputSchema = z.object({
  tokenId: z.string(),
  newBeneficiary: addressSchema,
  newHolder: addressSchema,
  from: addressSchema,
  tokenRegistry: addressSchema,
  dryRun: z.boolean().optional(),
});
export type TransferOwnersInput = z.infer<typeof transferOwnersInputSchema>;

export const renderMethodSchema = z.object({
  id: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  templateName: z.enum(RENDER_TEMPLATE_NAMES).optional(),
});
export const qrCodeSchema = z.object({ uri: z.string(), type: z.string() });

/**
 * undefined in -> undefined out: no renderMethod supplied means no rendering wanted, exactly
 * today's behavior. Any other value (including {}) means "I want rendering" -- fill in whatever
 * wasn't supplied. type always defaults to the one real value; id defaults to rendererBaseUrl, or
 * throws if neither the caller nor this deployment's resolved network supplies one; templateName
 * defaults via resolveTemplateName(documentType), or throws if that resolves to undefined too --
 * there is no content-agnostic default in core-engine's real allowlist, so neither field has a
 * third option to guess.
 */
function resolveRenderMethod(
  renderMethod: { id?: string; type?: string; templateName?: RenderTemplateName } | undefined,
  documentType: DocumentTypeKey | undefined,
  rendererBaseUrl: string | undefined
): { id: string; type: string; templateName: RenderTemplateName } | undefined {
  if (renderMethod === undefined) return undefined;
  const id = renderMethod.id ?? rendererBaseUrl;
  if (id === undefined) {
    throw new RenderMethodValidationError(
      "renderMethod.id was omitted and this deployment's baseUrl doesn't match a known " +
        "network (z2-testnet/z2-mainnet), so there's no default renderer URL to fill in -- " +
        "supply renderMethod.id explicitly for a custom deployment."
    );
  }
  const templateName = renderMethod.templateName ?? resolveTemplateName(documentType);
  if (templateName === undefined) {
    throw new RenderMethodValidationError(
      "renderMethod.templateName was omitted and documentType was omitted (or has no known " +
        "templateName mapping), so there's no content-agnostic default to fill in -- core-engine " +
        `has no "generic" template; supply renderMethod.templateName explicitly, one of: ` +
        `${RENDER_TEMPLATE_NAMES.join(", ")}.`
    );
  }
  return {
    id,
    type: renderMethod.type ?? "EMBEDDED_RENDERER",
    templateName,
  };
}

export const prepareCredentialInputSchema = z.object({
  issuerDid: z.string(),
  credentialSubject: z.record(z.string(), z.unknown()),
  type: z.array(z.string()).optional(),
  context: z.array(z.string()).optional(),
  documentType: z.enum(DOCUMENT_TYPE_KEYS as [DocumentTypeKey, ...DocumentTypeKey[]]).optional(),
  validFrom: z.string().optional(),
  statusPurpose: z.enum(["revocation", "suspension"]).optional(),
  renderMethod: renderMethodSchema.optional(),
  qrCode: qrCodeSchema.optional(),
  expirationDate: z.string().optional(),
  dryRun: z.boolean().optional(),
});
export type PrepareCredentialInput = z.infer<typeof prepareCredentialInputSchema>;

export async function prepareCredential(
  client: CoreEngineClient,
  input: PrepareCredentialInput,
  capabilities?: ToolCapabilities,
  rendererBaseUrl?: string
): Promise<Record<string, unknown> | DryRunResult> {
  const { dryRun, documentType, context, renderMethod, ...rest } = prepareCredentialInputSchema.parse(input);
  const mergedContext = mergeDocumentTypeContext(context, documentType);
  const path = "/credentials/prepare";
  assertCapabilityEnabled(path, capabilities);

  const contextIssue = checkBaseContext(mergedContext);
  if (contextIssue?.kind === "v1-context-unsupported") {
    throw new ContextValidationError(
      "the v1.1 base context pairs with issuanceDate, but core-engine currently emits validFrom " +
        "regardless of context version -- a v1.1 credential built here can never be signed. Use " +
        "https://www.w3.org/ns/credentials/v2 instead."
    );
  }
  // A missing/unrecognized base context is NOT rejected -- core-engine's own buildCredential
  // already defaults a missing context to [VC_V2_CONTEXT] itself (src/wrap/wrap.ts), so silently
  // matching that default here (rather than making the caller supply it) preserves the previously-
  // working omit-context call shape and lets documentType be used on its own, exactly like
  // prepare_mint_ebl already does on the eBL side. Only an explicit, confirmed-unsignable v1.1
  // context above is worth rejecting -- there's nothing "wrong" about an absent one.
  const finalContext = contextIssue?.kind === "missing-base-context" ? [VC_V2_CONTEXT, ...(mergedContext ?? [])] : mergedContext;

  const resolvedRenderMethod = resolveRenderMethod(renderMethod, documentType, rendererBaseUrl);
  const body = {
    ...rest,
    ...(finalContext ? { context: finalContext } : {}),
    ...(resolvedRenderMethod ? { renderMethod: resolvedRenderMethod } : {}),
  };

  if (dryRun) {
    return { dryRun: true, wouldSend: { method: "POST", path, body } };
  }
  return client.post<Record<string, unknown>>(path, body);
}

export const keyPairSchema = z.object({
  "@context": z.string().min(1),
  id: z.string().min(1),
  type: z.string().min(1),
  controller: z.string().min(1),
  publicKeyMultibase: z.string().min(1),
  secretKeyMultibase: z.string().min(1),
});

export const signCredentialInputSchema = z.object({
  preparationId: z.string(),
  keyPair: keyPairSchema,
  dryRun: z.boolean().optional(),
});
export type SignCredentialInput = z.infer<typeof signCredentialInputSchema>;

/** Redacts the secret half of a keyPair for previews -- never include it in a dryRun result,
 * which lands in the MCP host's transcript same as any other tool result. */
function redactKeyPair(keyPair: z.infer<typeof keyPairSchema>): z.infer<typeof keyPairSchema> {
  return { ...keyPair, secretKeyMultibase: "[redacted]" };
}

export async function signCredential(
  client: CoreEngineClient,
  input: SignCredentialInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  const { dryRun, ...body } = signCredentialInputSchema.parse(input);
  const path = "/credentials/sign";
  assertCapabilityEnabled(path, capabilities);

  if (dryRun) {
    return {
      dryRun: true,
      wouldSend: { method: "POST", path, body: { ...body, keyPair: redactKeyPair(body.keyPair) } },
    };
  }
  return client.post<Record<string, unknown>>(path, body);
}

export const buildRelayTxInputSchema = z.object({
  to: addressSchema,
  data: z.string(),
  value: z.string().optional(),
  chainId: z.number(),
  from: addressSchema,
  tokenRegistry: addressSchema,
  gas: z.string().optional(),
  deadlineSecondsFromNow: z.number().optional(),
  tokenId: z.string().optional(),
  dryRun: z.boolean().optional(),
});
export type BuildRelayTxInput = z.infer<typeof buildRelayTxInputSchema>;

export async function buildRelayTx(
  client: CoreEngineClient,
  input: BuildRelayTxInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  const { dryRun, ...body } = buildRelayTxInputSchema.parse(input);
  const path = "/ebl/relay/build";
  assertCapabilityEnabled(path, capabilities);

  if (dryRun) {
    return { dryRun: true, wouldSend: { method: "POST", path, body } };
  }
  return client.post<Record<string, unknown>>(path, body);
}

const forwardRequestSchema = z.object({
  from: addressSchema,
  to: addressSchema,
  value: z.string(),
  gas: z.string(),
  deadline: z.number(),
  data: z.string(),
  signature: z.string(),
});

export const submitRelayTxInputSchema = z.object({
  request: forwardRequestSchema,
  tokenRegistry: addressSchema,
  tokenId: z.string().optional(),
  dryRun: z.boolean().optional(),
});
export type SubmitRelayTxInput = z.infer<typeof submitRelayTxInputSchema>;

export async function submitRelayTx(
  client: CoreEngineClient,
  input: SubmitRelayTxInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  const { dryRun, ...body } = submitRelayTxInputSchema.parse(input);
  const path = "/ebl/relay/submit";
  assertCapabilityEnabled(path, capabilities);

  if (dryRun) {
    return { dryRun: true, wouldSend: { method: "POST", path, body } };
  }
  return client.post<Record<string, unknown>>(path, body);
}

export const onboardIssuerInputSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  admin: addressSchema,
  dryRun: z.boolean().optional(),
});
export type OnboardIssuerInput = z.infer<typeof onboardIssuerInputSchema>;

async function postOnboardIssuer(
  client: CoreEngineClient,
  path: string,
  input: OnboardIssuerInput,
  capabilities: ToolCapabilities | undefined
): Promise<Record<string, unknown> | DryRunResult> {
  const { dryRun, ...body } = onboardIssuerInputSchema.parse(input);
  assertCapabilityEnabled(path, capabilities);

  if (dryRun) {
    return { dryRun: true, wouldSend: { method: "POST", path, body } };
  }
  return client.post<Record<string, unknown>>(path, body);
}

export function onboardIssuer(
  client: CoreEngineClient,
  input: OnboardIssuerInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  return postOnboardIssuer(client, "/ebl/onboard-issuer", input, capabilities);
}

export function onboardIssuerRelay(
  client: CoreEngineClient,
  input: OnboardIssuerInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  return postOnboardIssuer(client, "/ebl/onboard-issuer/relay", input, capabilities);
}

export const bindIdentityInputSchema = z.object({
  did: z.string().regex(/^did:zid:/, "did must be a did:zid: identifier"),
  address: addressSchema,
  nonce: z.string(),
  ed25519Signature: z.string(),
  walletSignature: z.string(),
  dryRun: z.boolean().optional(),
});
export type BindIdentityInput = z.infer<typeof bindIdentityInputSchema>;

export async function bindIdentity(
  client: CoreEngineClient,
  input: BindIdentityInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  const { dryRun, ...body } = bindIdentityInputSchema.parse(input);
  const path = "/identity/bind";
  assertCapabilityEnabled(path, capabilities);

  if (dryRun) {
    return { dryRun: true, wouldSend: { method: "POST", path, body } };
  }
  return client.post<Record<string, unknown>>(path, body);
}

export const mutateStatusInputSchema = z.object({
  issuerId: z.string(),
  purpose: z.enum(["revocation", "suspension"]),
  index: z.number().int().nonnegative(),
  revoked: z.boolean(),
  nonce: z.string(),
  timestamp: z.string(),
  signature: z.string(),
  dryRun: z.boolean().optional(),
});
export type MutateStatusInput = z.infer<typeof mutateStatusInputSchema>;

export async function mutateStatus(
  client: CoreEngineClient,
  input: MutateStatusInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  const { issuerId, purpose, index, revoked, nonce, timestamp, signature, dryRun } = mutateStatusInputSchema.parse(input);
  const path = `/status/${encodeURIComponent(issuerId)}/${encodeURIComponent(purpose)}/${index}`;
  assertCapabilityEnabled(path, capabilities);
  const body = { revoked, nonce, timestamp, signature };

  if (dryRun) {
    return { dryRun: true, wouldSend: { method: "POST", path, body } };
  }
  return client.post<Record<string, unknown>>(path, body);
}

export const completeCredentialInputSchema = z.object({
  preparationId: z.string(),
  signedVerifiableCredential: z.record(z.string(), z.unknown()),
  dryRun: z.boolean().optional(),
});
export type CompleteCredentialInput = z.infer<typeof completeCredentialInputSchema>;

export async function completeCredential(
  client: CoreEngineClient,
  input: CompleteCredentialInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  const { dryRun, ...body } = completeCredentialInputSchema.parse(input);
  const path = "/credentials/complete";
  assertCapabilityEnabled(path, capabilities);

  if (dryRun) {
    return { dryRun: true, wouldSend: { method: "POST", path, body } };
  }
  return client.post<Record<string, unknown>>(path, body);
}

export const prepareMintEblInputSchema = z.object({
  issuerDid: z.string(),
  credentialSubject: z.record(z.string(), z.unknown()),
  tokenRegistry: addressSchema,
  chainId: z.number().optional(),
  chain: z.string().optional(),
  context: z.array(z.string()).optional(),
  documentType: z.enum(DOCUMENT_TYPE_KEYS as [DocumentTypeKey, ...DocumentTypeKey[]]).optional(),
  renderMethod: renderMethodSchema.optional(),
  qrCode: qrCodeSchema.optional(),
  expirationDate: z.string().optional(),
  dryRun: z.boolean().optional(),
});
export type PrepareMintEblInput = z.infer<typeof prepareMintEblInputSchema>;

export async function prepareMintEbl(
  client: CoreEngineClient,
  input: PrepareMintEblInput,
  capabilities?: ToolCapabilities,
  rendererBaseUrl?: string
): Promise<Record<string, unknown> | DryRunResult> {
  const { dryRun, documentType, context, renderMethod, ...rest } = prepareMintEblInputSchema.parse(input);
  const mergedContext = mergeDocumentTypeContext(context, documentType);
  const path = "/ebl/prepare-mint";
  assertCapabilityEnabled(path, capabilities);

  const resolvedRenderMethod = resolveRenderMethod(renderMethod, documentType, rendererBaseUrl);
  const body = {
    ...rest,
    ...(mergedContext ? { context: mergedContext } : {}),
    ...(resolvedRenderMethod ? { renderMethod: resolvedRenderMethod } : {}),
  };

  if (dryRun) {
    return { dryRun: true, wouldSend: { method: "POST", path, body } };
  }
  return client.post<Record<string, unknown>>(path, body);
}

export const completeMintEblInputSchema = z.object({
  preparationId: z.string(),
  signedVerifiableCredential: z.record(z.string(), z.unknown()),
  beneficiary: addressSchema.optional(),
  holder: addressSchema.optional(),
  from: addressSchema,
  dryRun: z.boolean().optional(),
});
export type CompleteMintEblInput = z.infer<typeof completeMintEblInputSchema>;

export async function completeMintEbl(
  client: CoreEngineClient,
  input: CompleteMintEblInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  const { dryRun, ...body } = completeMintEblInputSchema.parse(input);
  const path = "/ebl/complete-mint";
  assertCapabilityEnabled(path, capabilities);

  if (dryRun) {
    return { dryRun: true, wouldSend: { method: "POST", path, body } };
  }
  return client.post<Record<string, unknown>>(path, body);
}

export const fromAndRegistryInputSchema = z.object({
  tokenId: z.string(),
  from: addressSchema,
  tokenRegistry: addressSchema,
  dryRun: z.boolean().optional(),
});
export type FromAndRegistryInput = z.infer<typeof fromAndRegistryInputSchema>;

async function postFromAndRegistryAction(
  client: CoreEngineClient,
  routeSuffix: string,
  input: FromAndRegistryInput,
  capabilities: ToolCapabilities | undefined
): Promise<Record<string, unknown> | DryRunResult> {
  const { tokenId, from, tokenRegistry, dryRun } = fromAndRegistryInputSchema.parse(input);
  const path = `/ebl/${encodeURIComponent(tokenId)}/${routeSuffix}`;
  assertCapabilityEnabled(path, capabilities);
  const body = { from, tokenRegistry };

  if (dryRun) {
    return { dryRun: true, wouldSend: { method: "POST", path, body } };
  }
  return client.post<Record<string, unknown>>(path, body);
}

export function rejectTransferHolder(
  client: CoreEngineClient,
  input: FromAndRegistryInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  return postFromAndRegistryAction(client, "reject-transfer-holder", input, capabilities);
}

export function rejectTransferBeneficiary(
  client: CoreEngineClient,
  input: FromAndRegistryInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  return postFromAndRegistryAction(client, "reject-transfer-beneficiary", input, capabilities);
}

export function rejectTransferOwners(
  client: CoreEngineClient,
  input: FromAndRegistryInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  return postFromAndRegistryAction(client, "reject-transfer-owners", input, capabilities);
}

export function surrenderEbl(
  client: CoreEngineClient,
  input: FromAndRegistryInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  return postFromAndRegistryAction(client, "surrender", input, capabilities);
}

export function acceptSurrender(
  client: CoreEngineClient,
  input: FromAndRegistryInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  return postFromAndRegistryAction(client, "accept-surrender", input, capabilities);
}

export function rejectSurrender(
  client: CoreEngineClient,
  input: FromAndRegistryInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  return postFromAndRegistryAction(client, "reject-surrender", input, capabilities);
}

export async function transferOwners(
  client: CoreEngineClient,
  input: TransferOwnersInput,
  capabilities?: ToolCapabilities
): Promise<Record<string, unknown> | DryRunResult> {
  const { tokenId, newBeneficiary, newHolder, from, tokenRegistry, dryRun } = transferOwnersInputSchema.parse(input);
  const path = `/ebl/${encodeURIComponent(tokenId)}/transfer-owners`;
  assertCapabilityEnabled(path, capabilities);
  const body = { newBeneficiary, newHolder, from, tokenRegistry };

  if (dryRun) {
    return { dryRun: true, wouldSend: { method: "POST", path, body } };
  }
  return client.post<Record<string, unknown>>(path, body);
}
