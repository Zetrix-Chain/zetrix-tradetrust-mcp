import { z } from "zod";
import type { CoreEngineClient } from "../client/types.js";
import type { Capability } from "../config/capabilities.js";
import { DOCUMENT_TYPE_KEYS, type DocumentTypeKey } from "../config/document-types.js";
import {
  completeCredential,
  completeMintEbl,
  keyPairSchema,
  prepareCredential,
  prepareMintEbl,
  qrCodeSchema,
  renderMethodSchema,
  type DryRunResult,
} from "./write.js";

export type WorkflowCapabilities = Partial<Record<Capability, boolean>>;

export interface UnsignedMintResult {
  preparationId: string;
  unsignedVerifiableCredential: Record<string, unknown>;
  signingSpec: Record<string, unknown>;
  note: string;
}

interface PreparedCredential {
  preparationId: string;
  unsignedVerifiableCredential: Record<string, unknown>;
  signingSpec: Record<string, unknown>;
}

type KeyPair = z.infer<typeof keyPairSchema>;

/**
 * Shared by every prepare -> sign? -> complete workflow (mintEbl, issueDocument): with no keyPair,
 * return the unsigned VC + a note pointing at the matching complete_* tool; with one, call
 * /credentials/sign and return the signed VC. Same signing primitive either way -- only what
 * happens after signing differs per caller, so that part stays there.
 */
async function resolveSignedCredential(
  client: CoreEngineClient,
  prepared: PreparedCredential,
  keyPair: KeyPair | undefined,
  externalSignNote: string,
  capabilities: WorkflowCapabilities | undefined
): Promise<UnsignedMintResult | { preparationId: string; signedVerifiableCredential: Record<string, unknown> }> {
  const { preparationId, unsignedVerifiableCredential, signingSpec } = prepared;

  if (!keyPair || capabilities?.allowIssuerSigning === false) {
    return { preparationId, unsignedVerifiableCredential, signingSpec, note: externalSignNote };
  }

  const { signedVerifiableCredential } = await client.post<{ signedVerifiableCredential: Record<string, unknown> }>(
    "/credentials/sign",
    { preparationId, keyPair }
  );
  return { preparationId, signedVerifiableCredential };
}

export const mintEblInputSchema = z.object({
  issuerDid: z.string(),
  credentialSubject: z.record(z.string(), z.unknown()),
  tokenRegistry: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x + 20 bytes EVM address"),
  chainId: z.number().optional(),
  chain: z.string().optional(),
  context: z.array(z.string()).optional(),
  documentType: z.enum(DOCUMENT_TYPE_KEYS as [DocumentTypeKey, ...DocumentTypeKey[]]).optional(),
  renderMethod: renderMethodSchema.optional(),
  qrCode: qrCodeSchema.optional(),
  expirationDate: z.string().optional(),
  beneficiary: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  holder: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  from: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  keyPair: keyPairSchema.optional(),
  dryRun: z.boolean().optional(),
});
export type MintEblInput = z.infer<typeof mintEblInputSchema>;

export async function mintEbl(
  client: CoreEngineClient,
  input: MintEblInput,
  capabilities?: WorkflowCapabilities,
  rendererBaseUrl?: string
): Promise<Record<string, unknown> | UnsignedMintResult | DryRunResult> {
  const { beneficiary, holder, from, keyPair, dryRun, ...prepareFields } = mintEblInputSchema.parse(input);

  const prepared = await prepareMintEbl(client, { ...prepareFields, dryRun }, undefined, rendererBaseUrl);
  if ("dryRun" in prepared) {
    return prepared;
  }

  const signed = await resolveSignedCredential(
    client,
    prepared as unknown as PreparedCredential,
    keyPair,
    "sign externally, then call completeMintEbl with this preparationId",
    capabilities
  );
  if ("note" in signed) {
    return signed;
  }

  return completeMintEbl(client, { ...signed, beneficiary, holder, from });
}

export const issueDocumentInputSchema = z.object({
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
  keyPair: keyPairSchema.optional(),
  dryRun: z.boolean().optional(),
});
export type IssueDocumentInput = z.infer<typeof issueDocumentInputSchema>;

export async function issueDocument(
  client: CoreEngineClient,
  input: IssueDocumentInput,
  capabilities?: WorkflowCapabilities,
  rendererBaseUrl?: string
): Promise<Record<string, unknown> | UnsignedMintResult | DryRunResult> {
  const { keyPair, dryRun, ...prepareFields } = issueDocumentInputSchema.parse(input);

  const prepared = await prepareCredential(client, { ...prepareFields, dryRun }, undefined, rendererBaseUrl);
  if ("dryRun" in prepared) {
    return prepared;
  }

  const signed = await resolveSignedCredential(
    client,
    prepared as unknown as PreparedCredential,
    keyPair,
    "sign externally, then call completeCredential with this preparationId",
    capabilities
  );
  if ("note" in signed) {
    return signed;
  }

  return completeCredential(client, signed);
}
