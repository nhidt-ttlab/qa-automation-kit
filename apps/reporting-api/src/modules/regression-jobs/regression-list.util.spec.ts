/**
 * Parser for the runner's `--list` output. The fixture is real output, npm preamble included,
 * because that preamble is exactly the kind of line a parser must ignore rather than choke on.
 */
import { parseListOutput } from './regression-list.util';

const REAL_OUTPUT = [
  '',
  '> demo-runner@0.1.0 suite:list',
  '> tsx src/entrypoints/run-suite.ts --list --module don-hang',
  '',
  'TC-DH-F01        api  don-hang                     po-perm-create-by-project',
  'TC-DH-L01        api  don-hang                     po-list-keyword-search',
  'TC-DH-U09        ui   don-hang                     ui-po-detail-tabs',
  '',
  '3 scenario(s) selected  [don-hang]',
  '',
  'module tokens: boq, boq-acceptance, don-hang, kho, warehouse',
  '',
].join('\n');

describe('parseListOutput', () => {
  it('parses the four fixed-width columns', () => {
    const parsed = parseListOutput(REAL_OUTPUT);
    expect(parsed.items).toHaveLength(3);
    expect(parsed.items[0]).toEqual({
      test_case_id: 'TC-DH-F01',
      kind: 'api',
      domain: 'don-hang',
      scenario: 'po-perm-create-by-project',
    });
    expect(parsed.items[2].kind).toBe('ui');
  });

  it('takes the total from the runner summary line, not from the rows it recognised', () => {
    // The summary line is what the runner will actually execute. A row this parser failed to
    // recognise must not silently shrink the count a user is about to confirm.
    const truncated = REAL_OUTPUT.replace(
      'TC-DH-L01        api  don-hang                     po-list-keyword-search\n',
      '',
    );
    const parsed = parseListOutput(truncated);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.total).toBe(3);
  });

  it('reads the label and the module tokens', () => {
    const parsed = parseListOutput(REAL_OUTPUT);
    expect(parsed.label).toBe('don-hang');
    expect(parsed.moduleTokens).toContain('kho');
    expect(parsed.moduleTokens).toHaveLength(5);
  });

  it('ignores the npm preamble rather than treating it as a row', () => {
    expect(
      parseListOutput(REAL_OUTPUT).items.some((i) => i.test_case_id.startsWith('>')),
    ).toBe(false);
  });

  it('handles CRLF, which is what a Windows child process actually emits', () => {
    const parsed = parseListOutput(REAL_OUTPUT.split('\n').join('\r\n'));
    expect(parsed.items).toHaveLength(3);
    expect(parsed.total).toBe(3);
  });

  it('reports an empty selection as zero rather than guessing', () => {
    const parsed = parseListOutput('\n0 scenario(s) selected  [TC-NOPE]\n');
    expect(parsed.total).toBe(0);
    expect(parsed.items).toEqual([]);
    expect(parsed.label).toBe('TC-NOPE');
  });
});
