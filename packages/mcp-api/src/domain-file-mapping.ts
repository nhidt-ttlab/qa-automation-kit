import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

/**
 * The domain-file mapping: which generated metadata file (`<repository>/<file>.yaml`, one per
 * OpenAPI tag) belongs to which business domain. Read by `qakit-api domains --from-metadata`
 * (to emit domain files) and by docgen's domain lookup (keyed by `<repository>/<slugified-tag>`).
 */

const MergeEntrySchema = z.object({
  suffixes: z.array(z.string().min(1)).min(1),
  capabilityId: z.string().min(1),
  summary: z.string().optional(),
});

const SharedFileClaimSchema = z.object({
  domain: z.string().min(1),
  suffixes: z.array(z.string().min(1)).min(1),
  note: z.string().optional(),
});

const SharedFileRuleSchema = z.object({
  file: z.string().min(1),
  defaultDomain: z.string().min(1),
  claims: z.array(SharedFileClaimSchema).default([]),
});

const MergeGroupRuleSchema = z.object({
  file: z.string().min(1),
  merge: z.array(MergeEntrySchema).min(1),
});

const SummaryOverrideSchema = z.object({
  file: z.string().min(1),
  summary: z.string().min(1),
});

const NewDomainSpecSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
  tier: z.enum(['a', 'b']),
  apiSourceIds: z.array(z.string()).default([]),
  files: z.array(z.string().min(1)).min(1),
});

export const DomainFileMappingSchema = z.object({
  version: z.number(),
  existingDomainFiles: z.record(z.string(), z.array(z.string())).default({}),
  sharedFiles: z.array(SharedFileRuleSchema).default([]),
  mergeGroups: z.array(MergeGroupRuleSchema).default([]),
  summaryOverrides: z.array(SummaryOverrideSchema).default([]),
  newDomains: z.array(NewDomainSpecSchema),
});

export type SharedFileClaim = z.infer<typeof SharedFileClaimSchema>;
export type NewDomainSpec = z.infer<typeof NewDomainSpecSchema>;
export type DomainFileMapping = z.infer<typeof DomainFileMappingSchema>;

/** Loads the mapping table; `null` when the file is absent so callers can degrade gracefully. */
export function loadDomainFileMapping(mappingPath: string | undefined): DomainFileMapping | null {
  if (!mappingPath || !existsSync(mappingPath)) return null;
  const result = DomainFileMappingSchema.safeParse(parse(readFileSync(mappingPath, 'utf8')));
  if (!result.success) throw new Error(`Invalid domain-file mapping in ${mappingPath}: ${result.error.message}`);
  return result.data;
}

/** Strips `/api/{app,}/<file-slug>/` leading segments and `{param}` segments from a path. */
export function stripResourceSuffix(path: string, fileSlug: string): string {
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment.startsWith('{') && segment.endsWith('}') ? '' : segment))
    .filter(Boolean);
  if (segments[0] === 'api') segments.shift();
  if (segments[0] === 'app') segments.shift();
  if (segments[0] === fileSlug) segments.shift();
  return segments.join('/');
}

/**
 * Canonicalizes a controller-ish name for comparison against a tag:
 * "IPurchaseOrderAppService" -> "purchaseorder", "SpecController" -> "spec", "InvoiceCredit.cs" -> "invoicecredit".
 */
export function canonicalControllerName(value: string): string {
  let name = value.trim().replace(/\.(cs|ts)$/i, '');
  if (/^I[A-Z]/.test(name)) name = name.slice(1);
  name = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return name.replace(/appservice$/, '').replace(/controller$/, '').replace(/service$/, '');
}

interface FileKeyedRule {
  defaultDomain?: string;
  claims?: SharedFileClaim[];
}

const normalizeFileKey = (file: string): string => file.replace(/\.yaml$/i, '').replace(/\\/g, '/');

function buildFileIndex(mapping: DomainFileMapping): Map<string, FileKeyedRule> {
  const index = new Map<string, FileKeyedRule>();
  for (const [domainId, files] of Object.entries(mapping.existingDomainFiles)) {
    for (const file of files) index.set(file, { defaultDomain: domainId });
  }
  for (const shared of mapping.sharedFiles) index.set(shared.file, { defaultDomain: shared.defaultDomain, claims: shared.claims });
  for (const domain of mapping.newDomains) {
    for (const file of domain.files) {
      const key = normalizeFileKey(file);
      // Shared entries keep their claim rules; plain entries must not overwrite them.
      if (!index.has(key)) index.set(key, { defaultDomain: domain.id });
    }
  }
  return index;
}

/** The owning domain for a specific endpoint, applying shared-file claim rules. */
export function resolveDomainForEndpoint(mapping: DomainFileMapping, repo: string, fileSlug: string, path: string): string | undefined {
  const rule = buildFileIndex(mapping).get(`${repo}/${fileSlug}`);
  if (!rule) return undefined;
  if (rule.claims && rule.claims.length > 0) {
    const suffix = stripResourceSuffix(path, fileSlug);
    for (const claim of rule.claims) if (claim.suffixes.includes(suffix)) return claim.domain;
  }
  return rule.defaultDomain;
}

/** Merge overrides declared for a file, keyed by exact resource suffix. */
export function getMergeEntriesForFile(mapping: DomainFileMapping, repo: string, fileSlug: string) {
  const key = `${repo}/${fileSlug}`;
  return mapping.mergeGroups.filter((group) => group.file === key).flatMap((group) => group.merge);
}

/** The hand-authored summary override for a file's default `manage-<resource>` capability, if declared. */
export function getSummaryOverrideForFile(mapping: DomainFileMapping, repo: string, fileSlug: string): string | undefined {
  const key = `${repo}/${fileSlug}`;
  return mapping.summaryOverrides.find((override) => override.file === key)?.summary;
}
