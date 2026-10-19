import axios from 'axios';
import {
  NotFoundError,
  ValidationError,
  InternalError,
  isApiError,
} from '@qakit/reporting-shared';
import type { CreateRedmineIssueRequestDto } from '@qakit/reporting-shared';
import { RedmineService } from './redmine.service';
import { AUTOTEST_SUBJECT_MARKER, AUTOTEST_TAG } from './redmine.mapper';
import type { PrismaService } from '../../prisma.service';
import type { DefectsService } from '../defects/defects.service';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return { ...actual, create: jest.fn() };
});

const baseDto: CreateRedmineIssueRequestDto = {
  project_key: 'shop',
  tracker: 'Bug',
  subject: 'PO save fails when qty is 0',
  priority: 'High',
};

function makeHttpMock() {
  return { post: jest.fn(), get: jest.fn() };
}

/** Redmine's numeric id for the `shop` identifier used by `baseDto`. */
const PROJECT_ID = 31;

/**
 * Answers the id lookups every create performs, so each test only has to describe the
 * lookup it actually cares about. Anything not handled here falls through to `rest`.
 */
function stubLookups(
  http: ReturnType<typeof makeHttpMock>,
  rest: (url: string) => Promise<unknown>,
) {
  http.get.mockImplementation((url: string) => {
    if (url === `/projects/${baseDto.project_key}.json`) {
      return Promise.resolve({ data: { project: { id: PROJECT_ID } } });
    }
    return rest(url);
  });
}

function makePrismaMock(findUniqueResult: unknown = null) {
  return {
    testRun: { findUnique: jest.fn().mockResolvedValue(findUniqueResult) },
    defectObservation: {
      findFirst: jest.fn().mockResolvedValue({ defectSignatureId: 7 }),
    },
    bugLink: { upsert: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
}

function makeDefectsMock() {
  return {
    createFromRun: jest.fn().mockResolvedValue({ id: '42' }),
  } as unknown as DefectsService;
}

function makeService(
  prisma: PrismaService = makePrismaMock(),
  defects: DefectsService = makeDefectsMock(),
) {
  return new RedmineService(prisma, defects);
}

describe('RedmineService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      REDMINE_URL: 'https://redmine.example.com',
      REDMINE_API_KEY: 'test-key',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('throws NotFoundError when the run does not exist', async () => {
    const service = makeService(makePrismaMock(null));
    await expect(
      service.createIssueForRun('missing-run', baseDto),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError for missing required fields', async () => {
    const service = makeService(makePrismaMock());
    await expect(
      service.createIssue({ ...baseDto, subject: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws InternalError when Redmine env vars are not configured', async () => {
    process.env.REDMINE_URL = '';
    process.env.REDMINE_API_KEY = '';
    const service = makeService(makePrismaMock());
    await expect(service.createIssue(baseDto)).rejects.toBeInstanceOf(
      InternalError,
    );
  });

  it('sends the Autotest tag natively and via the subject fallback, and maps the response', async () => {
    const http = makeHttpMock();
    (axios.create as jest.Mock).mockReturnValue(http);
    stubLookups(http, (url: string) => {
      if (url === '/trackers.json') {
        return Promise.resolve({
          data: { trackers: [{ id: 7, name: 'Bug' }] },
        });
      }
      if (url === '/enumerations/issue_priorities.json') {
        return Promise.resolve({
          data: { issue_priorities: [{ id: 3, name: 'High' }] },
        });
      }
      throw new Error(`unexpected GET ${url}`);
    });
    http.post.mockResolvedValue({
      data: {
        issue: {
          id: 123,
          subject: `${AUTOTEST_SUBJECT_MARKER} ${baseDto.subject}`,
          description: 'rendered description',
          status: { name: 'New' },
          priority: { name: 'High' },
          project: { name: 'Shop ERP' },
        },
      },
    });

    const service = makeService(makePrismaMock());
    const result = await service.createIssue(baseDto);

    expect(http.post).toHaveBeenCalledTimes(1);
    const [, body] = http.post.mock.calls[0];
    // Regression guard: sending the project *identifier* here makes Redmine build an
    // issue with no project and reject it with 422 "Project cannot be blank".
    expect(body.issue.project_id).toBe(PROJECT_ID);
    expect(body.issue.tracker_id).toBe(7);
    expect(body.issue.priority_id).toBe(3);
    expect(body.issue.subject).toBe(
      `${AUTOTEST_SUBJECT_MARKER} ${baseDto.subject}`,
    );
    expect(body.issue.tags).toBe(AUTOTEST_TAG);
    expect(body.issue.description).toContain('## 1. Basic Info');

    expect(result).toMatchObject({
      id: 123,
      subject: `${AUTOTEST_SUBJECT_MARKER} ${baseDto.subject}`,
      status: 'New',
      project: 'Shop ERP',
      tags: [AUTOTEST_TAG],
    });
  });

  it('enriches template content from the run when creating from a run id', async () => {
    const http = makeHttpMock();
    (axios.create as jest.Mock).mockReturnValue(http);
    stubLookups(http, () =>
      Promise.resolve({ data: { trackers: [{ id: 7, name: 'Bug' }] } }),
    );
    http.post.mockResolvedValue({
      data: {
        issue: {
          id: 55,
          subject: 'x',
          status: { name: 'New' },
          project: { name: 'p' },
        },
      },
    });

    const run = {
      id: 'run-1',
      testCaseId: 'TC-PO-001',
      scenarioKey: 'po-create-qty-zero',
      environment: 'Staging',
      errorSummary: 'Received 500 from /purchase-orders',
      conclusion: 'Should return 201',
      severity: 'Critical',
      steps: [{ title: 'Submit PO with qty 0' }],
    };
    const prisma = makePrismaMock(run);
    const service = makeService(prisma);

    await service.createIssueForRun('run-1', {
      ...baseDto,
      priority: undefined,
    });

    const [, body] = http.post.mock.calls[0];
    expect(body.issue.description).toContain(
      'Received 500 from /purchase-orders',
    );
    expect(body.issue.description).toContain('Should return 201');
    expect(body.issue.description).toContain('1. Submit PO with qty 0');
    // Traceability back to the run the ticket was filed from.
    expect(body.issue.description).toContain('- Run ID: run-1');
    expect(body.issue.description).toContain('- Test Case: TC-PO-001');
    expect(body.issue.description).toContain('- Scenario: po-create-qty-zero');
  });

  it('wraps a Redmine 4xx failure into an actionable ValidationError', async () => {
    const http = makeHttpMock();
    (axios.create as jest.Mock).mockReturnValue(http);
    stubLookups(http, (url: string) => {
      if (url === '/trackers.json') {
        return Promise.resolve({
          data: { trackers: [{ id: 7, name: 'Bug' }] },
        });
      }
      return Promise.resolve({
        data: { issue_priorities: [{ id: 3, name: 'High' }] },
      });
    });

    const axiosError = Object.assign(
      new Error('Request failed with status code 422'),
      {
        isAxiosError: true,
        response: {
          status: 422,
          data: { errors: ['Subject cannot be blank'] },
        },
      },
    );
    http.post.mockRejectedValue(axiosError);

    const service = makeService(makePrismaMock());
    const error = await service.createIssue(baseDto).catch((e) => e);

    expect(isApiError(error)).toBe(true);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('Subject cannot be blank');
  });

  // Regression guard: SHOP_ERP's Bug tracker makes Report By / ProjectCode /
  // Actual-Expect Result / Bugs_step_to_reproduce and Target version mandatory, and
  // Redmine answers 422 for every create that omits them.
  it('sends the configured default custom fields and target version', async () => {
    process.env.REDMINE_DEFAULT_CUSTOM_FIELDS = JSON.stringify([
      { id: 24, value: 'QA/BA' },
      { id: 43, value: 'SHOP_ERP_2026' },
    ]);
    process.env.REDMINE_DEFAULT_VERSION = 'Harderning-T8/2026';

    const http = makeHttpMock();
    (axios.create as jest.Mock).mockReturnValue(http);
    stubLookups(http, (url: string) => {
      if (url === '/trackers.json') {
        return Promise.resolve({
          data: { trackers: [{ id: 6, name: 'Bug' }] },
        });
      }
      if (url === '/enumerations/issue_priorities.json') {
        return Promise.resolve({
          data: { issue_priorities: [{ id: 21, name: 'High' }] },
        });
      }
      if (url === '/projects/shop/versions.json') {
        return Promise.resolve({
          data: { versions: [{ id: 214, name: 'Harderning-T8/2026' }] },
        });
      }
      throw new Error(`unexpected GET ${url}`);
    });
    http.post.mockResolvedValue({
      data: { issue: { id: 1, subject: 'x', project: { name: 'SHOP_ERP' } } },
    });

    const service = makeService(makePrismaMock());
    await service.createIssue(baseDto);

    const [, body] = http.post.mock.calls[0];
    expect(body.issue.fixed_version_id).toBe(214);
    expect(body.issue.custom_fields).toEqual([
      { id: 24, value: 'QA/BA' },
      { id: 43, value: 'SHOP_ERP_2026' },
    ]);
  });

  it('lets a caller-supplied custom field override the configured default', async () => {
    process.env.REDMINE_DEFAULT_CUSTOM_FIELDS = JSON.stringify([
      { id: 24, value: 'QA/BA' },
    ]);
    delete process.env.REDMINE_DEFAULT_VERSION;

    const http = makeHttpMock();
    (axios.create as jest.Mock).mockReturnValue(http);
    stubLookups(http, (url: string) =>
      url === '/trackers.json'
        ? Promise.resolve({ data: { trackers: [{ id: 6, name: 'Bug' }] } })
        : Promise.resolve({
            data: { issue_priorities: [{ id: 21, name: 'High' }] },
          }),
    );
    http.post.mockResolvedValue({
      data: { issue: { id: 2, subject: 'x', project: { name: 'SHOP_ERP' } } },
    });

    const service = makeService(makePrismaMock());
    await service.createIssue({
      ...baseDto,
      custom_fields: [{ id: 24, value: 'Customers' }],
    });

    const [, body] = http.post.mock.calls[0];
    expect(body.issue.custom_fields).toEqual([{ id: 24, value: 'Customers' }]);
    expect(body.issue.fixed_version_id).toBeUndefined();
  });

  it('rejects an unknown target version with the list of valid names', async () => {
    delete process.env.REDMINE_DEFAULT_CUSTOM_FIELDS;

    const http = makeHttpMock();
    (axios.create as jest.Mock).mockReturnValue(http);
    stubLookups(http, (url: string) => {
      if (url === '/trackers.json') {
        return Promise.resolve({
          data: { trackers: [{ id: 6, name: 'Bug' }] },
        });
      }
      if (url === '/enumerations/issue_priorities.json') {
        return Promise.resolve({
          data: { issue_priorities: [{ id: 21, name: 'High' }] },
        });
      }
      return Promise.resolve({
        data: { versions: [{ id: 214, name: 'Harderning-T8/2026' }] },
      });
    });

    const service = makeService(makePrismaMock());
    const error = await service
      .createIssue({ ...baseDto, target_version: 'Milestone 99' })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('harderning-t8/2026');
    expect(http.post).not.toHaveBeenCalled();
  });

  // A wrong project key used to surface as Redmine's opaque 422 "Project cannot be
  // blank; Tracker cannot be blank; Status cannot be blank". The identifier is easy to
  // confuse with the display name, so the error has to name the valid ones.
  it('lists the available project identifiers when the project key does not resolve', async () => {
    const http = makeHttpMock();
    (axios.create as jest.Mock).mockReturnValue(http);
    http.get.mockImplementation((url: string) => {
      if (url === '/projects/shop.json') {
        return Promise.reject(
          Object.assign(new Error('Request failed with status code 404'), {
            isAxiosError: true,
            response: { status: 404 },
          }),
        );
      }
      if (url === '/projects.json') {
        return Promise.resolve({
          data: {
            projects: [
              { identifier: 'shop' },
              { identifier: 'other-project' },
            ],
          },
        });
      }
      return Promise.resolve({
        data: {
          trackers: [{ id: 6, name: 'Bug' }],
          issue_priorities: [{ id: 21, name: 'High' }],
        },
      });
    });

    const service = makeService(makePrismaMock());
    const error = await service.createIssue(baseDto).catch((e) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('Unknown Redmine project "shop"');
    expect(error.message).toContain('Available: shop, other-project');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('still reports the unknown project when the project listing also fails', async () => {
    const http = makeHttpMock();
    (axios.create as jest.Mock).mockReturnValue(http);
    http.get.mockImplementation((url: string) =>
      url.startsWith('/projects')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({
            data: {
              trackers: [{ id: 6, name: 'Bug' }],
              issue_priorities: [{ id: 21, name: 'High' }],
            },
          }),
    );

    const service = makeService(makePrismaMock());
    const error = await service.createIssue(baseDto).catch((e) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('Unknown Redmine project "shop"');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('ignores a malformed REDMINE_DEFAULT_CUSTOM_FIELDS instead of failing the request', async () => {
    process.env.REDMINE_DEFAULT_CUSTOM_FIELDS = 'not json';
    delete process.env.REDMINE_DEFAULT_VERSION;

    const http = makeHttpMock();
    (axios.create as jest.Mock).mockReturnValue(http);
    stubLookups(http, (url: string) =>
      url === '/trackers.json'
        ? Promise.resolve({ data: { trackers: [{ id: 6, name: 'Bug' }] } })
        : Promise.resolve({
            data: { issue_priorities: [{ id: 21, name: 'High' }] },
          }),
    );
    http.post.mockResolvedValue({
      data: { issue: { id: 3, subject: 'x', project: { name: 'SHOP_ERP' } } },
    });

    const service = makeService(makePrismaMock());
    await expect(service.createIssue(baseDto)).resolves.toMatchObject({
      id: 3,
    });
    const [, body] = http.post.mock.calls[0];
    expect(body.issue.custom_fields).toBeUndefined();
  });
});

describe('RedmineService bug link persistence', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      REDMINE_URL: 'https://redmine.example.com',
      REDMINE_API_KEY: 'test-key',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  /** Stubs a Redmine that accepts the issue and returns it as #99. */
  function stubSuccessfulRedmine() {
    const http = makeHttpMock();
    (axios.create as jest.Mock).mockReturnValue(http);
    stubLookups(http, () =>
      Promise.resolve({ data: { trackers: [{ id: 7, name: 'Bug' }] } }),
    );
    http.post.mockResolvedValue({
      data: {
        issue: {
          id: 99,
          subject: 'x',
          status: { name: 'New' },
          project: { name: 'Shop ERP' },
        },
      },
    });
    return http;
  }

  const runRow = { environment: 'staging', scenarioKey: 'scenario', steps: [] };

  function upsertMock(prisma: PrismaService): jest.Mock {
    return (prisma.bugLink as unknown as { upsert: jest.Mock }).upsert;
  }

  function observationMock(prisma: PrismaService): jest.Mock {
    return (prisma.defectObservation as unknown as { findFirst: jest.Mock })
      .findFirst;
  }

  function createFromRunMock(defects: DefectsService): jest.Mock {
    return (defects as unknown as { createFromRun: jest.Mock }).createFromRun;
  }

  /** The arguments of the first `bugLink.upsert` call, typed so assertions stay checked. */
  function upsertArgs(prisma: PrismaService) {
    const [firstCall] = upsertMock(prisma).mock.calls as unknown[][];
    return firstCall[0] as {
      where: { defectSignatureId_redmineIssueId: Record<string, number> };
      create: Record<string, unknown>;
    };
  }

  it('links the issue to the signature the run is already observed under', async () => {
    stubSuccessfulRedmine();
    const prisma = makePrismaMock(runRow);
    const defects = makeDefectsMock();
    const service = new RedmineService(prisma, defects);

    await service.createIssueForRun('run-1', {
      ...baseDto,
      priority: undefined,
    });

    // The runner and DefectsService hash signatures differently, so reusing the observed
    // signature is what stops a duplicate being minted for the same run.
    expect(createFromRunMock(defects)).not.toHaveBeenCalled();
    const args = upsertArgs(prisma);
    expect(args.where.defectSignatureId_redmineIssueId).toEqual({
      defectSignatureId: 7,
      redmineIssueId: 99,
    });
    expect(args.create).toMatchObject({
      defectSignatureId: 7,
      createdFromRunId: 'run-1',
      redmineIssueId: 99,
      redmineUrl: 'https://redmine.example.com/issues/99',
      // the URL identifier, not the 'Shop ERP' display name Redmine echoed back
      redmineProject: 'shop',
      linkType: 'created_from_run',
    });
  });

  it('creates a defect signature when the run has no observation yet', async () => {
    stubSuccessfulRedmine();
    const prisma = makePrismaMock(runRow);
    observationMock(prisma).mockResolvedValue(null);
    const defects = makeDefectsMock();
    const service = new RedmineService(prisma, defects);

    await service.createIssueForRun('run-1', {
      ...baseDto,
      priority: undefined,
    });

    expect(createFromRunMock(defects)).toHaveBeenCalledWith('run-1');
    expect(upsertArgs(prisma).create).toMatchObject({ defectSignatureId: 42 });
  });

  it('still returns the issue when the link cannot be persisted', async () => {
    stubSuccessfulRedmine();
    const prisma = makePrismaMock(runRow);
    upsertMock(prisma).mockRejectedValue(new Error('unique constraint'));
    const service = new RedmineService(prisma, makeDefectsMock());

    // The ticket exists in Redmine by now; failing the request would only invite a
    // retry and a duplicate ticket.
    await expect(
      service.createIssueForRun('run-1', { ...baseDto, priority: undefined }),
    ).resolves.toMatchObject({ id: 99 });
  });

  it('does not persist a link for the run-less createIssue path', async () => {
    stubSuccessfulRedmine();
    const prisma = makePrismaMock();
    const service = new RedmineService(prisma, makeDefectsMock());

    await service.createIssue({ ...baseDto, priority: undefined });

    expect(upsertMock(prisma)).not.toHaveBeenCalled();
  });
});
