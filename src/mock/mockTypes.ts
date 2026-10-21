/**
 * Prangon Lite — mock backend types (dev/testing only).
 */
export type Row = Record<string, any>;

export interface MockRelation {
  /** FK column on one of the two tables. */
  column: string;
  /** Related table name (defaults to the name used in the select). */
  tableName?: string;
  /** PK column on the other side (defaults to "id"). */
  parentColumn?: string;
  /**
   * "out" = this table's `column` points at the related table's PK
   * (embedded as a single object). "in" = the related table's `column`
   * points at this table's PK (embedded as an array).
   */
  kind: "out" | "in";
}

export interface MockSeed {
  /** Bump to force a reseed of the local mock database. */
  version: string;
  /** email -> mock auth user object (same shape supabase-js expects). */
  authUsers: Record<string, Row>;
  /** demo identity id -> auth email, used to restore sessions on reload. */
  identities: Record<string, string>;
  /** Fresh seed rows per table. */
  tables: () => Record<string, Row[]>;
  /** How embedded selects (e.g. profiles(...)) resolve per table. */
  relations?: Record<string, Record<string, MockRelation>>;
  /** PostgREST rpc handlers, keyed by function name. */
  rpcs?: Record<
    string,
    (args: Row, tables: Record<string, Row[]>, ctx: any) => any
  >;
  /** Hook to add defaults (ids, timestamps) to incoming rows. */
  prepareRow?: (table: string, row: Row) => Row;
}

// ---------------------------------------------------------------- mock-only
// The official announcement account and the post the mock always returns
// first. Declared here (no side effects) so both mockDb and mockBackend can
// import them without pulling the seed builder into the interceptor.
export const PINNED_POST_ID = "p-000";
export const MOCK_OFFICIAL_USERNAME = "pl_team";
