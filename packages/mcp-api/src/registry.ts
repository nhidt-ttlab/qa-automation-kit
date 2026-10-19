import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { DependencyEdgeSchema, DomainSchema, FieldDependencySchema, type DependencyEdge, type Domain, type FieldDependency, type Tool } from './types.js';

/** Every `*.yaml` / `*.yml` domain file in `domainsDir`; `[]` when the folder does not exist. */
export function loadDomains(domainsDir: string | undefined): Domain[] {
  if (!domainsDir || !existsSync(domainsDir)) return [];
  const files = readdirSync(domainsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  return files.map((file) => {
    const raw = parse(readFileSync(join(domainsDir, file), 'utf8'));
    const result = DomainSchema.safeParse(raw);
    if (!result.success) throw new Error(`Invalid domain config in ${file}: ${result.error.message}`);
    return result.data;
  });
}

export class DomainRegistry {
  private readonly byId = new Map<string, Domain>();

  constructor(domains: Domain[]) {
    for (const domain of domains) this.byId.set(domain.id, domain);
  }

  list(): Domain[] {
    return [...this.byId.values()];
  }

  get(domainId: string): Domain | undefined {
    return this.byId.get(domainId);
  }

  has(domainId: string): boolean {
    return this.byId.has(domainId);
  }

  searchByKeyword(keyword: string): Domain[] {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return this.list();
    return this.list().filter((domain) =>
      [domain.id, domain.displayName, domain.description, ...domain.tags, ...domain.capabilities.map((c) => `${c.id} ${c.summary}`)]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }
}

const BusinessGraphFileSchema = z.object({ edges: z.array(DependencyEdgeSchema).default([]) });

/** The `edges` of a business-graph file; `[]` when none is configured. */
export function loadEdges(file: string | undefined): DependencyEdge[] {
  if (!file || !existsSync(file)) return [];
  const result = BusinessGraphFileSchema.safeParse(parse(readFileSync(file, 'utf8')));
  if (!result.success) throw new Error(`Invalid business graph ${file}: ${result.error.message}`);
  return result.data.edges;
}

export type EdgeDirection = 'upstream' | 'downstream' | 'both';

/** Knows only domain-id strings — no knowledge of domain, source or capability shapes. */
export class BusinessGraph {
  private readonly outgoing = new Map<string, DependencyEdge[]>();
  private readonly incoming = new Map<string, DependencyEdge[]>();

  constructor(private readonly edges: DependencyEdge[]) {
    for (const edge of edges) {
      this.pushInto(this.outgoing, edge.from, edge);
      this.pushInto(this.incoming, edge.to, edge);
    }
  }

  private pushInto(map: Map<string, DependencyEdge[]>, key: string, edge: DependencyEdge): void {
    const list = map.get(key);
    if (list) list.push(edge);
    else map.set(key, [edge]);
  }

  getEdges(domainId: string, direction: EdgeDirection = 'both'): DependencyEdge[] {
    if (direction === 'upstream') return this.outgoing.get(domainId) ?? [];
    if (direction === 'downstream') return this.incoming.get(domainId) ?? [];
    return [...(this.outgoing.get(domainId) ?? []), ...(this.incoming.get(domainId) ?? [])];
  }

  allEdges(): DependencyEdge[] {
    return this.edges;
  }

  /** All domain ids reachable by following "requires/depends-on" edges outward from domainId. */
  resolveTransitiveClosure(domainId: string): string[] {
    const visited = new Set<string>();
    const queue = [domainId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const edge of this.outgoing.get(current) ?? []) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    return [...visited];
  }

  /** Sorts the ids (plus everything they depend on) so dependencies come first. Throws on a cycle. */
  topoSort(domainIds: string[]): string[] {
    const allIds = new Set<string>(domainIds);
    for (const id of domainIds) for (const dep of this.resolveTransitiveClosure(id)) allIds.add(dep);

    const visited = new Set<string>();
    const inProgress = new Set<string>();
    const sorted: string[] = [];
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (inProgress.has(id)) throw new Error(`Cycle detected in business graph at domain "${id}"`);
      inProgress.add(id);
      for (const edge of this.outgoing.get(id) ?? []) if (allIds.has(edge.to)) visit(edge.to);
      inProgress.delete(id);
      visited.add(id);
      sorted.push(id);
    };
    for (const id of allIds) visit(id);
    return sorted;
  }
}

const FieldDependenciesFileSchema = z.object({ entries: z.array(FieldDependencySchema).default([]) });

/** The `entries` of a field-dependencies file; `[]` when none is configured or generated yet. */
export function loadFieldDependencies(file: string | undefined): FieldDependency[] {
  if (!file || !existsSync(file)) return [];
  const result = FieldDependenciesFileSchema.safeParse(parse(readFileSync(file, 'utf8')));
  if (!result.success) throw new Error(`Invalid field dependencies ${file}: ${result.error.message}`);
  return result.data.entries;
}

/** Indexes field dependencies by bare field name for O(1) planner lookups. */
export function buildFieldDependencyIndex(entries: FieldDependency[]): Map<string, FieldDependency> {
  return new Map(entries.map((entry) => [entry.fieldName, entry]));
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;

/**
 * Tracks actionIds actually issued by `load_domain_api_registry` / `plan_task`, so
 * `execute_api_action` can only ever invoke an operation discovery or planning surfaced — never
 * an arbitrary caller-supplied path/method.
 */
export class ActionRegistry {
  private readonly entries = new Map<string, { tool: Tool; expiresAt: number }>();

  constructor(private readonly defaultTtlMs: number = DEFAULT_TTL_MS) {}

  register(tool: Tool, ttlMs: number = this.defaultTtlMs): void {
    this.entries.set(tool.actionId, { tool, expiresAt: Date.now() + ttlMs });
  }

  registerAll(tools: Tool[], ttlMs?: number): void {
    for (const tool of tools) this.register(tool, ttlMs);
  }

  resolve(actionId: string): Tool | undefined {
    const entry = this.entries.get(actionId);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(actionId);
      return undefined;
    }
    return entry.tool;
  }
}
