import type { IssueTracker } from './issue-tracker';
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, isAxiosError } from 'axios';
import type {
  CreateRedmineIssueRequestDto,
  RedmineCustomFieldValue,
  RedmineIssueResponseDto,
} from '@qakit/reporting-shared';
import {
  BUG_LINK_TYPE,
  InternalError,
  NotFoundError,
  ValidationError,
  isApiError,
} from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import { DefectsService } from '../defects/defects.service';
import {
  applyAutotestSubjectMarker,
  buildAutotestTags,
  buildRedmineDescription,
  enrichBugReportContent,
  type RunEnrichmentSource,
} from './redmine.mapper';

interface RedmineIssuePayload {
  id: number;
  subject: string;
  description?: string;
  status?: { name: string };
  priority?: { name: string };
  assigned_to?: { name: string };
  project?: { name: string };
}

@Injectable()
export class RedmineService
  implements IssueTracker<CreateRedmineIssueRequestDto, RedmineIssueResponseDto>
{
  readonly name = 'redmine';

  private readonly logger = new Logger(RedmineService.name);
  private readonly client: AxiosInstance | null;
  private projectIdsByKey = new Map<string, number>();
  private trackerIdsByName: Map<string, number> | null = null;
  private priorityIdsByName: Map<string, number> | null = null;
  private versionIdsByProject = new Map<string, Map<string, number>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly defects: DefectsService,
  ) {
    const baseURL = process.env.REDMINE_URL;
    const apiKey = process.env.REDMINE_API_KEY;

    this.client =
      baseURL && apiKey
        ? axios.create({
            baseURL,
            timeout: 10_000,
            headers: {
              'X-Redmine-API-Key': apiKey,
              'Content-Type': 'application/json',
            },
          })
        : null;
  }

  /**
   * Creates a Redmine issue for a test run, enriching template content from the run
   * record wherever the caller left fields unset.
   */
  async createIssueForRun(
    runId: string,
    dto: CreateRedmineIssueRequestDto,
  ): Promise<RedmineIssueResponseDto> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: { steps: true },
    });

    if (!run) {
      throw new NotFoundError('TestRun', runId);
    }

    const issue = await this.createIssue(dto, run);
    await this.persistBugLink(runId, issue, dto);
    return issue;
  }

  async createIssue(
    dto: CreateRedmineIssueRequestDto,
    run?: RunEnrichmentSource | null,
  ): Promise<RedmineIssueResponseDto> {
    this.validateDto(dto);
    const client = this.assertConfigured();

    const tags = buildAutotestTags(dto.tags);
    const subject = applyAutotestSubjectMarker(dto.subject);
    const content = enrichBugReportContent(dto, run);
    const description = buildRedmineDescription(dto.subject, content, tags);

    const versionName =
      dto.target_version ?? process.env.REDMINE_DEFAULT_VERSION;

    try {
      const [projectId, trackerId, priorityId, fixedVersionId] =
        await Promise.all([
          this.resolveProjectId(client, dto.project_key),
          this.resolveTrackerId(client, dto.tracker),
          dto.priority
            ? this.resolvePriorityId(client, dto.priority)
            : Promise.resolve(undefined),
          versionName
            ? this.resolveVersionId(client, dto.project_key, versionName)
            : Promise.resolve(undefined),
        ]);

      const customFields = this.mergeCustomFields(dto.custom_fields);

      const issuePayload: Record<string, unknown> = {
        // Must be the numeric id — Redmine assigns the project from the issue attributes
        // by primary key, so an identifier string yields no project at all. See
        // resolveProjectId().
        project_id: projectId,
        tracker_id: trackerId,
        subject,
        description,
        // Best-effort native tag support — silently ignored by Redmine installs that
        // don't have the "Issue Tags" plugin. See applyAutotestSubjectMarker() for the
        // guaranteed fallback this pairs with.
        tags: tags.join(','),
        ...(priorityId ? { priority_id: priorityId } : {}),
        ...(dto.assigned_to ? { assigned_to_id: dto.assigned_to } : {}),
        ...(fixedVersionId ? { fixed_version_id: fixedVersionId } : {}),
        // Trackers can make custom fields mandatory (a Bug tracker may require
        // Report By / ProjectCode / Actual-Expect Result / Bugs_step_to_reproduce), and
        // Redmine answers 422 when one is missing. There is no REST endpoint that lists
        // custom field definitions to a non-admin, so the values come from config.
        ...(customFields.length > 0 ? { custom_fields: customFields } : {}),
      };

      const response = await client.post<{ issue: RedmineIssuePayload }>(
        '/issues.json',
        { issue: issuePayload },
      );
      const issue = response.data.issue;

      return {
        id: issue.id,
        subject: issue.subject,
        description: issue.description,
        status: issue.status?.name ?? 'unknown',
        priority: issue.priority?.name ?? dto.priority ?? 'Normal',
        assigned_to: issue.assigned_to?.name,
        url: `${this.redmineBaseUrl()}/issues/${issue.id}`,
        project: issue.project?.name ?? dto.project_key,
        tags,
      };
    } catch (error) {
      throw this.toApiError(error, 'Failed to create Redmine issue');
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async getIssue(_issueId: number): Promise<any> {
    // TODO: Fetch issue from Redmine API
    return {};
  }

  /**
   * Records the created issue in `bug_links` so the run detail screen can show it and a
   * second person does not file the same bug twice.
   *
   * Never throws: the Redmine ticket already exists by the time this runs, so surfacing a
   * bookkeeping failure as a 500 would only prompt a retry and a duplicate ticket.
   */
  private async persistBugLink(
    runId: string,
    issue: RedmineIssueResponseDto,
    dto: CreateRedmineIssueRequestDto,
  ): Promise<void> {
    try {
      const defectSignatureId = await this.resolveDefectSignatureId(runId);

      await this.prisma.bugLink.upsert({
        where: {
          defectSignatureId_redmineIssueId: {
            defectSignatureId,
            redmineIssueId: issue.id,
          },
        },
        create: {
          defectSignatureId,
          createdFromRunId: runId,
          redmineIssueId: issue.id,
          redmineUrl: issue.url,
          // `project_key` is the identifier Redmine's REST API accepts; `issue.project`
          // is only the display name.
          redmineProject: dto.project_key,
          linkType: BUG_LINK_TYPE.CREATED_FROM_RUN,
        },
        update: {
          redmineUrl: issue.url,
          createdFromRunId: runId,
        },
      });
    } catch (error) {
      this.logger.error(
        `Redmine issue #${issue.id} was created but could not be linked to run ${runId}: ` +
          `${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /**
   * A bug link needs a defect signature. Prefer the one the run is already observed under —
   * the regression runner hashes signatures over failing-check labels while
   * DefectsService.createFromRun hashes over the defect statement, so the two never agree
   * and calling createFromRun blindly would mint a duplicate signature for the same run.
   */
  private async resolveDefectSignatureId(runId: string): Promise<number> {
    const observed = await this.prisma.defectObservation.findFirst({
      where: { runId },
      orderBy: { observedAt: 'desc' },
      select: { defectSignatureId: true },
    });

    if (observed) {
      return observed.defectSignatureId;
    }

    // No observation yet: an unsynced run, or a PASS run the runner skipped.
    return Number((await this.defects.createFromRun(runId)).id);
  }

  private validateDto(dto: CreateRedmineIssueRequestDto): void {
    const missing = (['project_key', 'tracker', 'subject'] as const).filter(
      (field) => !dto[field]?.trim(),
    );
    if (missing.length > 0) {
      throw new ValidationError(
        `Missing required field(s): ${missing.join(', ')}`,
        { missing },
      );
    }
  }

  private assertConfigured(): AxiosInstance {
    if (!this.client) {
      throw new InternalError(
        'Redmine integration is not configured: set REDMINE_URL and REDMINE_API_KEY',
      );
    }
    return this.client;
  }

  private redmineBaseUrl(): string {
    return (process.env.REDMINE_URL ?? '').replace(/\/+$/, '');
  }

  /**
   * Resolves a project *identifier* (e.g. "shop-erp") to its numeric id.
   *
   * `POST /issues.json` carries the project as an issue attribute, and Redmine assigns it
   * through `Issue#safe_attributes=`, which looks the project up by primary key. An
   * identifier string casts to no integer there, so the issue is built with no project
   * and Redmine answers 422 "Project cannot be blank; Tracker cannot be blank; Status
   * cannot be blank" — tracker and status are both derived from the project, so they
   * cascade. Path parameters (the versions lookup below) do accept identifiers; issue
   * attributes do not.
   */
  private async resolveProjectId(
    client: AxiosInstance,
    projectKey: string,
  ): Promise<number> {
    if (/^\d+$/.test(projectKey)) {
      return Number(projectKey);
    }

    const cached = this.projectIdsByKey.get(projectKey);
    if (cached !== undefined) {
      return cached;
    }

    let id: unknown;
    try {
      const response = await client.get<{ project?: { id: number } }>(
        `/projects/${encodeURIComponent(projectKey)}.json`,
      );
      id = response.data.project?.id;
    } catch (error) {
      // A 404 here means the caller sent something that is not a project identifier —
      // most often the display name ("SHOP_ERP") instead of the identifier from the
      // project's URL ("shop"). Name the valid ones so the fix is obvious.
      throw new ValidationError(
        `Unknown Redmine project "${projectKey}" (use the identifier from the project URL, ` +
          `not its display name). ${await this.describeAvailableProjects(client)}`,
        { cause: isAxiosError(error) ? error.message : 'lookup failed' },
      );
    }

    if (typeof id !== 'number') {
      throw new ValidationError(
        `Redmine did not return an id for project "${projectKey}"`,
      );
    }

    this.projectIdsByKey.set(projectKey, id);
    return id;
  }

  /**
   * Best-effort list of the project identifiers this API key can see, for the failed
   * lookup message. Never throws — it only decorates an error that is already being
   * raised, so a second failure must not replace the useful one.
   */
  private async describeAvailableProjects(
    client: AxiosInstance,
  ): Promise<string> {
    try {
      const response = await client.get<{
        projects: Array<{ identifier: string }>;
      }>('/projects.json', { params: { limit: 100 } });
      const identifiers = response.data.projects
        .map((project) => project.identifier)
        .filter(Boolean);
      return identifiers.length > 0
        ? `Available: ${identifiers.join(', ')}`
        : 'This API key cannot see any projects.';
    } catch {
      return 'Could not list the available projects.';
    }
  }

  private async resolveTrackerId(
    client: AxiosInstance,
    trackerName: string,
  ): Promise<number> {
    if (!this.trackerIdsByName) {
      const response = await client.get<{
        trackers: Array<{ id: number; name: string }>;
      }>('/trackers.json');
      this.trackerIdsByName = new Map(
        response.data.trackers.map((t) => [t.name.toLowerCase(), t.id]),
      );
    }

    const id = this.trackerIdsByName.get(trackerName.toLowerCase());
    if (id === undefined) {
      throw new ValidationError(
        `Unknown Redmine tracker "${trackerName}". Available: ${[...this.trackerIdsByName.keys()].join(', ')}`,
      );
    }
    return id;
  }

  private async resolvePriorityId(
    client: AxiosInstance,
    priorityName: string,
  ): Promise<number> {
    if (!this.priorityIdsByName) {
      const response = await client.get<{
        issue_priorities: Array<{ id: number; name: string }>;
      }>('/enumerations/issue_priorities.json');
      this.priorityIdsByName = new Map(
        response.data.issue_priorities.map((p) => [p.name.toLowerCase(), p.id]),
      );
    }

    const id = this.priorityIdsByName.get(priorityName.toLowerCase());
    if (id === undefined) {
      throw new ValidationError(
        `Unknown Redmine priority "${priorityName}". Available: ${[...this.priorityIdsByName.keys()].join(', ')}`,
      );
    }
    return id;
  }

  /**
   * Resolves a version *name* to its `fixed_version_id`. Versions are per-project, so the
   * cache is keyed by project — unlike trackers and priorities, which are global.
   */
  private async resolveVersionId(
    client: AxiosInstance,
    projectKey: string,
    versionName: string,
  ): Promise<number> {
    let cached = this.versionIdsByProject.get(projectKey);
    if (!cached) {
      const response = await client.get<{
        versions: Array<{ id: number; name: string }>;
      }>(`/projects/${encodeURIComponent(projectKey)}/versions.json`);
      cached = new Map(
        response.data.versions.map((v) => [v.name.toLowerCase(), v.id]),
      );
      this.versionIdsByProject.set(projectKey, cached);
    }

    const id = cached.get(versionName.toLowerCase());
    if (id === undefined) {
      throw new ValidationError(
        `Unknown Redmine version "${versionName}" in project "${projectKey}". Available: ${[...cached.keys()].join(', ')}`,
      );
    }
    return id;
  }

  /**
   * Caller-supplied custom fields win over the REDMINE_DEFAULT_CUSTOM_FIELDS baseline,
   * matched by field id.
   */
  private mergeCustomFields(
    supplied?: RedmineCustomFieldValue[],
  ): RedmineCustomFieldValue[] {
    const byId = new Map<number, RedmineCustomFieldValue>();
    for (const field of [...this.defaultCustomFields(), ...(supplied ?? [])]) {
      byId.set(field.id, field);
    }
    return [...byId.values()];
  }

  /**
   * REDMINE_DEFAULT_CUSTOM_FIELDS is a JSON array of `{ "id": number, "value": string }`.
   * A malformed value is logged and ignored rather than thrown: it would otherwise turn
   * every bug report into a 500, and Redmine's own 422 names the missing fields anyway.
   */
  private defaultCustomFields(): RedmineCustomFieldValue[] {
    const raw = process.env.REDMINE_DEFAULT_CUSTOM_FIELDS?.trim();
    if (!raw) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('expected a JSON array');
      }
      return parsed.filter(
        (entry): entry is RedmineCustomFieldValue =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as RedmineCustomFieldValue).id === 'number',
      );
    } catch (error) {
      this.logger.warn(
        `Ignoring malformed REDMINE_DEFAULT_CUSTOM_FIELDS: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return [];
    }
  }

  private toApiError(error: unknown, fallbackMessage: string): Error {
    if (isApiError(error)) {
      return error;
    }

    if (isAxiosError(error)) {
      const status = error.response?.status;
      const redmineErrors = (
        error.response?.data as { errors?: string[] } | undefined
      )?.errors;
      const detail = redmineErrors?.join('; ') ?? error.message;

      this.logger.error(`${fallbackMessage}: ${detail}`);

      if (status && status >= 400 && status < 500) {
        return new ValidationError(`${fallbackMessage}: ${detail}`, {
          status,
          redmineErrors,
        });
      }
      return new InternalError(`${fallbackMessage}: ${detail}`, { status });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    this.logger.error(`${fallbackMessage}: ${message}`);
    return new InternalError(`${fallbackMessage}: ${message}`);
  }
}
