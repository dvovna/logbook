// SQL functions called through PostgREST. The repositories call theirs over
// the direct connection (callFunction, src/database/sql-functions.ts), by the
// names `pnpm db:types` generated.
export enum RpcFunctionName {
  AppliedMigrations = 'applied_migrations',
}
