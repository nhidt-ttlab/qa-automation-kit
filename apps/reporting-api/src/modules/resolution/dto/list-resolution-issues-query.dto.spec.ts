// The decorators need the metadata polyfill; Nest loads it at bootstrap, a unit test must not assume that.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ExportResolutionIssuesQuery,
  ListResolutionIssuesQuery,
} from './list-resolution-issues-query.dto';

/**
 * These run the real validation pipeline, because the interesting question is not what the types
 * say but what `ValidationPipe` actually does with a querystring — in particular whether the
 * export DTO really did make `page`/`limit` optional, or whether the decorators were dropped when
 * the properties were re-declared.
 */

function validate<T extends object>(
  cls: new () => T,
  query: Record<string, unknown>,
) {
  const instance = plainToInstance(cls, query, {
    enableImplicitConversion: false,
  });
  return { instance, errors: validateSync(instance as object) };
}

const properties = (errors: ReturnType<typeof validateSync>) =>
  errors.map((e) => e.property).sort();

describe('ListResolutionIssuesQuery', () => {
  it('accepts a fully specified query', () => {
    const { instance, errors } = validate(ListResolutionIssuesQuery, {
      q: 'BL-03',
      kind: 'SPEC_DECISION',
      workflow_status: 'VERIFIED',
      priority: 'High',
      observed_result: 'NOT_EVALUATED',
      sort_by: 'last_seen_at',
      sort_order: 'DESC',
      page: '2',
      limit: '20',
    });

    expect(errors).toHaveLength(0);
    // Querystrings are strings; @Type(() => Number) has to convert them.
    expect(instance.page).toBe(2);
    expect(instance.limit).toBe(20);
  });

  it('requires pagination', () => {
    const { errors } = validate(ListResolutionIssuesQuery, { q: 'BL-03' });
    expect(properties(errors)).toEqual(['limit', 'page']);
  });

  it('rejects a value outside a closed vocabulary', () => {
    const { errors } = validate(ListResolutionIssuesQuery, {
      kind: 'NONSENSE',
      workflow_status: 'ALMOST_DONE',
      page: '1',
      limit: '20',
    });
    expect(properties(errors)).toEqual(['kind', 'workflow_status']);
  });

  it('leaves the open vocabularies open', () => {
    // A new suite folder or documentation module must not need a release here.
    const { errors } = validate(ListResolutionIssuesQuery, {
      module: 'brand-new-suite',
      domain: 'brand-new-module',
      page: '1',
      limit: '20',
    });
    expect(errors).toHaveLength(0);
  });
});

describe('ExportResolutionIssuesQuery', () => {
  it('does not require pagination — the export returns everything the filters select', () => {
    const { errors } = validate(ExportResolutionIssuesQuery, {
      workflow_status: 'VERIFIED',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts no filters at all', () => {
    expect(validate(ExportResolutionIssuesQuery, {}).errors).toHaveLength(0);
  });

  it('still inherits the filter validation from the list query', () => {
    const { errors } = validate(ExportResolutionIssuesQuery, {
      kind: 'NONSENSE',
    });
    expect(properties(errors)).toEqual(['kind']);
  });

  it('still validates pagination when it is supplied', () => {
    expect(
      validate(ExportResolutionIssuesQuery, { page: '0' }).errors,
    ).toHaveLength(1);
    expect(
      validate(ExportResolutionIssuesQuery, { page: '3' }).errors,
    ).toHaveLength(0);
  });
});
