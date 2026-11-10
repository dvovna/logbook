import { ColumnType, Insertable, Selectable, Updateable } from 'kysely';
import { Database } from '@common/types/database.types';

type PublicTables = Database['public']['Tables'];

interface ISupabaseTable {
  Row: object;
  Insert: object;
  Update: object;
}

// One table in Kysely's terms, taken from the types `pnpm db:types` generates:
// a column reads as its Row type, is written as its Insert and Update types,
// and is optional on insert where Supabase made it optional (it has a default
// or takes null). So the repositories are typed by the generated file, which
// CI checks against the migrations.
type KyselyTable<Table extends ISupabaseTable> = {
  [Column in keyof Table['Row']]: ColumnType<
    Table['Row'][Column],
    Column extends keyof Table['Insert'] ? Table['Insert'][Column] : never,
    Column extends keyof Table['Update'] ? Table['Update'][Column] : never
  >;
};

export type SqlDatabase = {
  [Table in keyof PublicTables]: KyselyTable<PublicTables[Table]>;
};

export type SqlTableName = keyof SqlDatabase & string;

export type SqlRow<Table extends SqlTableName> = Selectable<SqlDatabase[Table]>;
export type SqlInsert<Table extends SqlTableName> = Insertable<
  SqlDatabase[Table]
>;
export type SqlUpdate<Table extends SqlTableName> = Updateable<
  SqlDatabase[Table]
>;
