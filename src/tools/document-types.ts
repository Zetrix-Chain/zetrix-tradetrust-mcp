import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_KEYS,
  type DocumentTypeKey,
  type RenderTemplateName,
} from "../config/document-types.js";

export interface DocumentTypeListEntry {
  key: DocumentTypeKey;
  label: string;
  credentialSubjectType?: string;
  contextUrls: readonly string[];
  verified: boolean;
  templateName?: RenderTemplateName;
}

/**
 * Local lookup only -- no core-engine call. Lets an agent discover valid `documentType` values
 * for prepare_credential/prepare_mint_ebl (and their required JSON-LD context) before calling
 * either, instead of guessing at core-engine's context allowlist.
 */
export function listDocumentTypes(): DocumentTypeListEntry[] {
  return DOCUMENT_TYPE_KEYS.map((key) => ({ key, ...DOCUMENT_TYPES[key] }));
}
