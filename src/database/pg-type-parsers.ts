import { CustomTypesConfig, types } from 'pg';

// Postgres writes a timestamp as text `2026-06-17 10:00:00.123456+00`, and as
// JSON (what PostgREST returns) `2026-06-17T10:00:00.123456+00:00`. The view
// models were written against PostgREST's strings, so the direct connection
// gives the same ones, microseconds included, instead of node-postgres's Date.
export const toJsonTimestamp = (value: string) =>
  value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');

const keepText = (value: string) => value;

// Values as PostgREST returns them, so that rows match the generated types:
// dates and timestamps stay strings, bigint (count(*)) and numeric are numbers.
const PARSERS: Record<number, (value: string) => unknown> = {
  [types.builtins.DATE]: keepText,
  [types.builtins.TIMESTAMP]: toJsonTimestamp,
  [types.builtins.TIMESTAMPTZ]: toJsonTimestamp,
  [types.builtins.INT8]: Number,
  [types.builtins.NUMERIC]: Number,
};

// For this app's pool only: pg-boss shares the pg module and expects Dates.
export const POSTGREST_COMPATIBLE_TYPES: CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    (format ?? 'text') === 'text' && PARSERS[oid]
      ? PARSERS[oid]
      : types.getTypeParser(oid, format)) as CustomTypesConfig['getTypeParser'],
};
