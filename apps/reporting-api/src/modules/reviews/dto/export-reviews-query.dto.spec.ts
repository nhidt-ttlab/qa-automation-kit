// The decorators need the metadata polyfill; Nest loads it at bootstrap, a unit test must not assume that.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ExportReviewsQuery } from './export-reviews-query.dto';

/**
 * These run the real validation pipeline, because the interesting question is not what the types
 * say but what `ValidationPipe` actually does with a querystring — in particular whether
 * `should_improve_testcase=false` survives, which the `@Type(() => Boolean)` idiom used by the
 * other query DTOs here cannot express.
 */
function validate(query: Record<string, unknown>) {
  const instance = plainToInstance(ExportReviewsQuery, query, {
    enableImplicitConversion: false,
  });
  return { instance, errors: validateSync(instance) };
}

describe('ExportReviewsQuery', () => {
  it('accepts an empty query — the default is every reviewed run', () => {
    expect(validate({}).errors).toHaveLength(0);
  });

  it('parses both boolean strings, not just "true"', () => {
    const yes = validate({ should_improve_testcase: 'true' });
    expect(yes.errors).toHaveLength(0);
    expect(yes.instance.should_improve_testcase).toBe(true);

    const no = validate({ should_improve_testcase: 'false' });
    expect(no.errors).toHaveLength(0);
    expect(no.instance.should_improve_testcase).toBe(false);
  });

  it('rejects a non-boolean for should_improve_testcase', () => {
    expect(
      validate({ should_improve_testcase: 'maybe' }).errors.map(
        (e) => e.property,
      ),
    ).toEqual(['should_improve_testcase']);
  });

  it('accepts a known verdict and rejects an unknown one', () => {
    expect(validate({ verdict: 'rejected' }).errors).toHaveLength(0);
    expect(validate({ verdict: 'nope' }).errors.map((e) => e.property)).toEqual(
      ['verdict'],
    );
  });

  it('accepts a known run_type and rejects an unknown one', () => {
    expect(validate({ run_type: 'ui' }).errors).toHaveLength(0);
    expect(
      validate({ run_type: 'smoke' }).errors.map((e) => e.property),
    ).toEqual(['run_type']);
  });

  it('leaves module and domain as open vocabularies', () => {
    const { errors, instance } = validate({
      module: 'a-suite-added-after-this-release',
      domain: 'a-domain-added-after-this-release',
    });
    expect(errors).toHaveLength(0);
    expect(instance.module).toBe('a-suite-added-after-this-release');
  });
});
