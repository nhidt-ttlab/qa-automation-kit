import {
  AUTOTEST_SUBJECT_MARKER,
  AUTOTEST_TAG,
  applyAutotestSubjectMarker,
  buildAutotestTags,
  buildRedmineDescription,
  enrichBugReportContent,
} from './redmine.mapper';
import type { CreateRedmineIssueRequestDto } from '@qakit/reporting-shared';

const baseDto: CreateRedmineIssueRequestDto = {
  project_key: 'shop-erp',
  tracker: 'Bug',
  subject: '[PO][Create] Fails to save when qty is 0',
};

describe('buildAutotestTags', () => {
  it('always includes the Autotest tag when no tags are supplied', () => {
    expect(buildAutotestTags(undefined)).toEqual([AUTOTEST_TAG]);
  });

  it('merges caller-supplied tags with Autotest', () => {
    expect(buildAutotestTags(['regression'])).toEqual([
      'regression',
      AUTOTEST_TAG,
    ]);
  });

  it('de-duplicates when the caller already sent Autotest', () => {
    expect(buildAutotestTags(['Autotest', 'regression'])).toEqual([
      'Autotest',
      'regression',
    ]);
  });
});

describe('applyAutotestSubjectMarker', () => {
  it('prefixes the subject with the Autotest marker', () => {
    expect(applyAutotestSubjectMarker('Fails to save')).toBe(
      `${AUTOTEST_SUBJECT_MARKER} Fails to save`,
    );
  });

  it('does not double-prefix a subject that already carries the marker', () => {
    const subject = `${AUTOTEST_SUBJECT_MARKER} Fails to save`;
    expect(applyAutotestSubjectMarker(subject)).toBe(subject);
  });
});

describe('enrichBugReportContent', () => {
  it('prefers explicit dto fields over run data', () => {
    const content = enrichBugReportContent(
      {
        ...baseDto,
        environment: 'Staging',
        actual_result: 'Explicit actual result',
      },
      { environment: 'Production', errorSummary: 'Run error summary' },
    );

    expect(content.environment).toBe('Staging');
    expect(content.actual_result).toBe('Explicit actual result');
  });

  it('falls back to run data when the dto omits a field', () => {
    const content = enrichBugReportContent(baseDto, {
      environment: 'Production',
      errorSummary: 'Run error summary',
      conclusion: 'Should not error',
      severity: 'High',
      steps: [{ title: 'Open PO screen' }, { title: 'Set qty to 0' }],
    });

    expect(content.environment).toBe('Production');
    expect(content.actual_result).toBe('Run error summary');
    expect(content.expected_result).toBe('Should not error');
    expect(content.severity).toBe('High');
    expect(content.steps_to_reproduce).toEqual([
      'Open PO screen',
      'Set qty to 0',
    ]);
  });

  it('falls back to the legacy free-form description when no structured actual_result exists', () => {
    const content = enrichBugReportContent({
      ...baseDto,
      description: 'Legacy free-form description',
    });
    expect(content.actual_result).toBe('Legacy free-form description');
  });

  it('carries the run and test case identifiers through for traceability', () => {
    const content = enrichBugReportContent(baseDto, {
      id: 'run-mtqmh5fw-fb1zms',
      testCaseId: 'TC-KHO-001',
      scenarioKey: 'rol-enforce-print-import-export-confirm-at-api',
    });

    expect(content.run_id).toBe('run-mtqmh5fw-fb1zms');
    expect(content.test_case_id).toBe('TC-KHO-001');
    expect(content.scenario_key).toBe(
      'rol-enforce-print-import-export-confirm-at-api',
    );
  });

  it('leaves fields undefined when neither the dto nor the run provide them', () => {
    const content = enrichBugReportContent(baseDto);
    expect(content.environment).toBeUndefined();
    expect(content.steps_to_reproduce).toBeUndefined();
  });
});

describe('buildRedmineDescription', () => {
  it('renders every bug-report-template.md section in order', () => {
    const description = buildRedmineDescription(
      baseDto.subject,
      enrichBugReportContent(baseDto, {
        environment: 'Staging',
        errorSummary: 'API returns 500',
        conclusion: 'Should return 200',
        severity: 'Critical',
        steps: [{ title: 'Create PO with qty 0' }],
      }),
      buildAutotestTags(),
    );

    const sectionOrder = [
      '## 1. Basic Info',
      '## 2. Steps to Reproduce',
      '## 3. Actual Result',
      '## 4. Expected Result',
      '## 5. Impact',
      '## 6. Severity & Priority',
      '## 7. Notes',
    ];
    let cursor = -1;
    for (const heading of sectionOrder) {
      const index = description.indexOf(heading);
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }

    expect(description).toContain('API returns 500');
    expect(description).toContain('Should return 200');
    expect(description).toContain('1. Create PO with qty 0');
    expect(description).toContain('Tags: Autotest');
  });

  it('renders the run and test case identifiers in Basic Info', () => {
    const description = buildRedmineDescription(
      baseDto.subject,
      enrichBugReportContent(baseDto, {
        id: 'run-mtqmh5fw-fb1zms',
        testCaseId: 'TC-KHO-001',
        scenarioKey: 'rol-enforce-print-import-export-confirm-at-api',
      }),
      buildAutotestTags(),
    );

    expect(description).toContain('- Run ID: run-mtqmh5fw-fb1zms');
    expect(description).toContain('- Test Case: TC-KHO-001');
    expect(description).toContain(
      '- Scenario: rol-enforce-print-import-export-confirm-at-api',
    );
    // They belong to Basic Info, not to a later section.
    expect(description.indexOf('- Run ID:')).toBeLessThan(
      description.indexOf('## 2. Steps to Reproduce'),
    );
  });

  it('renders "Not provided" for missing optional fields instead of throwing', () => {
    const description = buildRedmineDescription(
      baseDto.subject,
      enrichBugReportContent(baseDto),
      buildAutotestTags(),
    );
    expect(description).toContain('_Not provided_');
  });
});
