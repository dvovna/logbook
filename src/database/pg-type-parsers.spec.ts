import { types } from 'pg';
import {
  POSTGREST_COMPATIBLE_TYPES,
  toJsonTimestamp,
} from 'src/database/pg-type-parsers';

describe('the types of the direct connection', () => {
  it('writes timestamps as PostgREST does', () => {
    expect(toJsonTimestamp('2026-06-17 10:00:00.123456+00')).toBe(
      '2026-06-17T10:00:00.123456+00:00',
    );
    expect(toJsonTimestamp('2026-06-17 10:00:00+05:30')).toBe(
      '2026-06-17T10:00:00+05:30',
    );
    expect(toJsonTimestamp('2026-06-17 10:00:00')).toBe('2026-06-17T10:00:00');
    expect(toJsonTimestamp('infinity')).toBe('infinity');
  });

  it('keeps dates as text and reads counts and numerics as numbers', () => {
    const parse = (oid: number, value: string) =>
      (
        POSTGREST_COMPATIBLE_TYPES.getTypeParser(oid, 'text') as (
          value: string,
        ) => unknown
      )(value);

    expect(parse(types.builtins.DATE, '2026-06-17')).toBe('2026-06-17');
    expect(parse(types.builtins.INT8, '1001')).toBe(1001);
    expect(parse(types.builtins.NUMERIC, '12.50')).toBe(12.5);
    expect(parse(types.builtins.BOOL, 't')).toBe(true);
  });
});
