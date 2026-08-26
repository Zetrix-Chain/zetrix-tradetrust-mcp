import { z } from "zod";
import { Wallet } from "ethers";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x + 20 bytes EVM address");

/** Matches core-engine's own FORWARD_REQUEST_TYPES exactly -- the EIP-712 schema the real
 * ERC2771Forwarder expects. Hardcoded, not caller-supplied: accepting an arbitrary types/primaryType
 * here would let a caller who already has the private key (it's a per-call argument, not
 * server-held) get a valid signature over ANY typed data, not just a ForwardRequest -- e.g. a
 * Permit or an approve, steered by a later prompt injection. */
const FORWARD_REQUEST_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
};

/** Known ERC2771Forwarder deployments, keyed by chainId -- the only ones this tool will sign
 * against. An unlisted chainId is rejected rather than trusting whatever verifyingContract the
 * caller supplied. */
const KNOWN_FORWARDERS: Record<number, string> = {
  938748: "0x5C4C188C28dff98A0b4f96Ed9C509Cfc4ce4B44C", // z2-testnet
};

const eip712DomainSchema = z.object({
  name: z.string(),
  version: z.string(),
  chainId: z.number(),
  verifyingContract: addressSchema,
});

/** The exact ForwardRequest message shape -- matches FORWARD_REQUEST_TYPES's fields. Anything else
 * the caller's typedData carries (types, primaryType, extra message fields) is stripped by zod's
 * default object parsing and never reaches signTypedData. */
const forwardRequestMessageSchema = z.object({
  from: addressSchema,
  to: addressSchema,
  value: z.string(),
  gas: z.string(),
  nonce: z.string(),
  deadline: z.number(),
  data: z.string(),
});

export const signRelayRequestInputSchema = z.object({
  typedData: z.object({
    domain: eip712DomainSchema,
    message: forwardRequestMessageSchema,
  }),
  privateKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x + 32 bytes hex private key"),
});
export type SignRelayRequestInput = z.infer<typeof signRelayRequestInputSchema>;

export interface SignRelayRequestResult {
  signature: string;
}

/** Signs an EIP-712 ForwardRequest (as returned by build_relay_tx) purely locally -- no network
 * call, no gas, no chain access. The type set and primaryType are always the real
 * ERC2771Forwarder's ForwardRequest schema, regardless of what `typedData.types`/`primaryType` the
 * caller passes -- this tool signs ForwardRequests, not arbitrary EIP-712 data. Also requires
 * `domain.verifyingContract` to match the known forwarder for `domain.chainId`. */
export async function signRelayRequest(input: SignRelayRequestInput): Promise<SignRelayRequestResult> {
  const { typedData, privateKey } = signRelayRequestInputSchema.parse(input);

  const knownForwarder = KNOWN_FORWARDERS[typedData.domain.chainId];
  if (!knownForwarder) {
    throw new Error(`no known ERC2771Forwarder for chainId ${typedData.domain.chainId}`);
  }
  if (typedData.domain.verifyingContract.toLowerCase() !== knownForwarder.toLowerCase()) {
    throw new Error(
      `domain.verifyingContract (${typedData.domain.verifyingContract}) does not match the known forwarder ` +
        `for chainId ${typedData.domain.chainId} (${knownForwarder})`
    );
  }

  const wallet = new Wallet(privateKey);
  const signature = await wallet.signTypedData(typedData.domain, FORWARD_REQUEST_TYPES, typedData.message);

  return { signature };
}
