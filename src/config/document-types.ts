/**
 * The `templateName` values TradeTrust's renderer apps actually recognize. Mirrored by hand from
 * core-engine's own template allowlist -- this repo has no dependency on that one, so keep both
 * lists in sync deliberately when core-engine's allowlist changes. There is no content-agnostic
 * "generic" entry in the real allowlist -- a templateName that can't be resolved from either the
 * caller or documentType has no safe default (see resolveTemplateName below).
 */
export const RENDER_TEMPLATE_NAMES = [
  "BILL_OF_LADING",
  "BILL_OF_LADING_GENERIC",
  "BILL_OF_LADING_CARRIER",
  "BILL_OF_LADING_MAERSK_PILOT",
  "BILL_OF_LADING_MAERSK_TPAC",
  "CHAFTA_COO",
  "SIMPLE_COO",
  "COVERING_LETTER",
  "CERTIFICATE_OF_NON_MANIPULATION",
  "W3C_BROCHURE",
  "INVOICE",
  "WAREHOUSE_RECEIPT",
  "PROMISSORY_NOTE",
] as const;
export type RenderTemplateName = (typeof RENDER_TEMPLATE_NAMES)[number];

/**
 * JSON-LD context URL(s) a document type needs so its credentialSubject fields resolve under
 * core-engine's safe-mode signing. Mirrored by hand from core-engine's own context allowlist --
 * this repo has no dependency on that one, so keep both lists in sync deliberately when
 * core-engine's allowlist changes.
 */
export interface DocumentTypeSpec {
  label: string;
  /** The credentialSubject.type value core-engine/TrustVC expects, when confirmed. */
  credentialSubjectType?: string;
  contextUrls: readonly string[];
  /** false = context URL is allowlisted in core-engine but no worked example/fixture exists
   * anywhere yet -- the exact required credentialSubject shape for this type is unconfirmed. */
  verified: boolean;
  /** The renderMethod.templateName this document type implies, when known -- lets
   * resolveRenderMethod() (src/tools/write.ts) pick a templateName that actually matches the
   * document's content, instead of trusting the caller to choose a consistent one themselves. */
  templateName?: RenderTemplateName;
}

export const DOCUMENT_TYPES = {
  certificateOfOrigin: {
    label: "Certificate of Origin",
    credentialSubjectType: "Coo",
    contextUrls: ["https://trustvc.io/context/coo.json"],
    verified: true,
    templateName: "SIMPLE_COO",
  },
  commercialInvoice: {
    label: "Commercial Invoice",
    credentialSubjectType: "Invoice",
    contextUrls: ["https://trustvc.io/context/invoice.json"],
    verified: true,
    templateName: "INVOICE",
  },
  billOfLading: {
    label: "Bill of Lading (transferable eBL)",
    credentialSubjectType: "BillOfLading",
    contextUrls: ["https://trustvc.io/context/bill-of-lading.json"],
    verified: true,
    templateName: "BILL_OF_LADING",
  },
  billOfLadingCarrier: {
    label: "Bill of Lading (carrier variant)",
    contextUrls: ["https://trustvc.io/context/bill-of-lading-carrier.json"],
    verified: false,
    templateName: "BILL_OF_LADING_CARRIER",
  },
  promissoryNote: {
    label: "Promissory Note",
    contextUrls: ["https://trustvc.io/context/promissory-note.json"],
    verified: false,
    templateName: "PROMISSORY_NOTE",
  },
  warehouseReceipt: {
    label: "Warehouse Receipt",
    contextUrls: ["https://trustvc.io/context/warehouse-receipt.json"],
    verified: false,
    templateName: "WAREHOUSE_RECEIPT",
  },
  // openCerts removed 2026-08-24: its context URL (https://trustvc.io/context/opencerts-context.json)
  // is confirmed dead -- returns HTTP 403 serving the trustvc.io website's own SPA shell, not
  // JSON-LD (verified live, contrasted against coo.json's real 200 JSON-LD response via the
  // identical request). core-engine's own allowlist still lists this URL -- that's out of this
  // repo's control to fix; this catalog deliberately diverges from it here.
} as const satisfies Record<string, DocumentTypeSpec>;

export type DocumentTypeKey = keyof typeof DOCUMENT_TYPES;

export const DOCUMENT_TYPE_KEYS = Object.keys(DOCUMENT_TYPES) as DocumentTypeKey[];

/**
 * Merges a document type's required context URL(s) into a caller-supplied context array, deduped
 * and order-preserving. Returns `existing` unchanged (including `undefined`) when `documentType`
 * is omitted, so callers who don't use this feature see no behavior change at all.
 */
export function mergeDocumentTypeContext(
  existing: readonly string[] | undefined,
  documentType: DocumentTypeKey | undefined
): string[] | undefined {
  if (!documentType) return existing ? [...existing] : existing;
  const base = existing ?? [];
  const additions = DOCUMENT_TYPES[documentType].contextUrls.filter((url) => !base.includes(url));
  return additions.length === 0 ? [...base] : [...base, ...additions];
}

export const VC_V1_CONTEXT = "https://www.w3.org/2018/credentials/v1";
export const VC_V2_CONTEXT = "https://www.w3.org/ns/credentials/v2";

export type BaseContextIssue =
  | { kind: "missing-base-context" }
  | { kind: "v1-context-unsupported" };

/**
 * Checks only context[0], matching core-engine's own "first element of @context" framing for
 * prepare_credential -- this is not a JSON-LD engine, just a check against the two base URIs
 * core-engine accepts as the first element.
 */
export function checkBaseContext(context: readonly string[] | undefined): BaseContextIssue | undefined {
  const first = context?.[0];
  if (first !== VC_V1_CONTEXT && first !== VC_V2_CONTEXT) return { kind: "missing-base-context" };
  if (first === VC_V1_CONTEXT) return { kind: "v1-context-unsupported" };
  return undefined;
}

/**
 * The templateName a renderMethod should use for this documentType, when the caller didn't
 * specify one explicitly. Returns undefined -- there is no content-agnostic default in
 * core-engine's real allowlist (see RENDER_TEMPLATE_NAMES above) -- when documentType is omitted
 * or has no known templateName mapping. Callers must treat undefined as "must be supplied
 * explicitly", not silently guess a value.
 */
export function resolveTemplateName(documentType: DocumentTypeKey | undefined): RenderTemplateName | undefined {
  if (!documentType) return undefined;
  return DOCUMENT_TYPES[documentType].templateName;
}
