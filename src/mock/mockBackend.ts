/**
 * Prangon Lite — in-browser mock Supabase backend (dev/testing only).
 *
 * Patches window.fetch so that calls to the configured (placeholder) Supabase
 * URL are answered locally with seeded demo data — no database is contacted
 * and no existing application code changes. Enabled only when
 * VITE_USE_MOCK_DATA === 'true'; when disabled this module is a no-op.
 *
 * What it emulates:
 *  - PostgREST: /rest/v1/<table> GET/POST/PATCH/DELETE incl. simple filters,
 *    ordering, pagination, count, .single()/.maybeSingle(), upserts, and
 *    resource embedding declared in the seed's relation map.
 *  - Auth: /auth/v1/token (password + refresh), /auth/v1/user, /auth/v1/logout.
 *  - Realtime: a silent WebSocket stub (no network).
 *  - Storage: /storage/v1/* returns canned success (uploads) or 404 (reads).
 *  - Edge functions: /functions/v1/* returns {}.
 *  - RPC: handlers declared in the seed; unknown functions return null.
 *
 * Writes go to an in-memory store persisted to localStorage so test edits
 * survive reloads. `window.__prangonResetMockData()` restores the seed.
 */
import type { MockSeed } from "./mockTypes";

const MOCK_DB_KEY = "prangon-lite-mock-db-v1";

type Row = Record<string, any>;

interface Ctx {
  seed: MockSeed;
  tables: Record<string, Row[]>;
  currentEmail: string | null;
  refreshTokenToEmail: Record<string, string>;
  host: string;
  /** uuid of the currently signed-in demo user (from the stored session). */
  getUserId: () => string | null;
}

let installed = false;

export function installMockBackend(getSeed: () => MockSeed): void {
  if (installed) return;
  installed = true;

  // Must fall back to the SAME placeholder host the Supabase client uses
  // (see src/integrations/supabase/client.ts). When VITE_SUPABASE_URL is unset
  // the client still dials this host expecting the mock to answer it — but
  // new URL("") throws, so the old code returned early and no interceptor was
  // installed, sending those requests to the real internet.
  const supabaseUrl =
    (import.meta.env.VITE_SUPABASE_URL as string) ||
    "https://your-lite-project.supabase.co";
  let host = "";
  try {
    host = new URL(supabaseUrl).host;
  } catch {
    return; // unparseable URL — nothing to intercept
  }
  if (!host || host.includes("supabase.co") === false) {
    // Only intercept the placeholder host, never a real project URL.
    if (!/your-lite-project/i.test(host)) return;
  }

  const ctx: Ctx = {
    seed: getSeed(),
    tables: loadOrSeed(getSeed),
    currentEmail: null,
    refreshTokenToEmail: {},
    host,
    getUserId: () => resolveUserId(host, ctx),
  };

  patchWebSocket(host);
  patchFetch(ctx, host);
  exposeHelpers(ctx, getSeed);
}

function loadOrSeed(getSeed: () => MockSeed): Record<string, Row[]> {
  try {
    const raw = localStorage.getItem(MOCK_DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === getSeed().version && parsed.tables) {
        return parsed.tables;
      }
    }
  } catch {
    /* fall through to fresh seed */
  }
  const tables = getSeed().tables();
  persistTables(tables);
  return tables;
}

function persistTables(tables: Record<string, Row[]>) {
  try {
    localStorage.setItem(
      MOCK_DB_KEY,
      JSON.stringify({ version: "handled-by-seed", tables }),
    );
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------- WebSocket

function patchWebSocket(host: string) {
  const OriginalWebSocket = window.WebSocket;
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    CONNECTING = 0;
    OPEN = 1;
    CLOSING = 2;
    CLOSED = 3;
    url: string;
    readyState = 1;
    onopen: any = null;
    onclose: any = null;
    onerror: any = null;
    onmessage: any = null;
    constructor(url: string) {
      this.url = url;
      // Keep supabase-js realtime happy and silent.
      setTimeout(() => this.onopen?.({ type: "open", target: this }), 0);
    }
    send() {}
    close() {
      this.readyState = 3;
    }
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return false;
    }
  }
  const Guarded = function (this: any, url: string | URL, ...rest: any[]) {
    const u = String(url);
    if (u.includes(host) && u.includes("/realtime/")) {
      return new MockWebSocket(u) as any;
    }
    return new (OriginalWebSocket as any)(url, ...rest);
  } as unknown as typeof WebSocket;
  Guarded.prototype = OriginalWebSocket.prototype;
  Object.assign(Guarded, {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  });
  (window as any).WebSocket = Guarded;
}

// -------------------------------------------------------------------- fetch

function patchFetch(ctx: Ctx, host: string) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: any, init?: any) => {
    let url: URL;
    try {
      url = new URL(typeof input === "string" ? input : input.url);
    } catch {
      return originalFetch(input, init);
    }
    if (url.host !== host) return originalFetch(input, init);

    const method = (init?.method ?? "GET").toUpperCase();
    const body = parseBody(init?.body);

    if (url.pathname.startsWith("/auth/v1/")) {
      return handleAuth(ctx, url, method, body, init);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const res = await handleRest(ctx, url, method, body, init);
      schedulePersist(ctx);
      return res;
    }
    if (url.pathname.startsWith("/storage/v1/")) {
      return handleStorage(url, method, init);
    }
    if (url.pathname.startsWith("/functions/v1/")) {
      return jsonResponse({});
    }
    return originalFetch(input, init);
  };
}

function parseBody(raw: any): any {
  if (raw == null) return undefined;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function jsonResponse(data: any, status = 200, headers: Record<string, string> = {}) {
  return new Response(data === undefined ? "" : JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// --------------------------------------------------------------------- auth

function handleAuth(ctx: Ctx, url: URL, method: string, body: any, init: any): Response {
  const path = url.pathname;

  if (path === "/auth/v1/token" && method === "POST") {
    const grant = url.searchParams.get("grant_type") ?? "password";
    if (grant === "password") {
      const email = String(body?.email ?? "").toLowerCase();
      const password = String(body?.password ?? "");
      const demoPassword =
        (import.meta.env.VITE_DEMO_PASSWORD as string) || "prangon-lite-demo";
      if (!ctx.seed.authUsers[email] || password !== demoPassword) {
        return jsonResponse(
          { error: "invalid_grant", error_description: "Invalid login credentials" },
          400,
        );
      }
      ctx.currentEmail = email;
      const refreshToken = `mock-refresh-${ctx.seed.authUsers[email].id}-${Date.now()}`;
      ctx.refreshTokenToEmail[refreshToken] = email;
      return jsonResponse(tokenResponse(ctx, email, refreshToken));
    }
    if (grant === "refresh_token") {
      const email = ctx.refreshTokenToEmail[String(body?.refresh_token ?? "")];
      if (!email) {
        // Fall back to the identity the app stored, so reloads keep the session.
        const fallback = readStoredIdentity(ctx);
        if (!fallback) {
          return jsonResponse(
            { error: "invalid_grant", error_description: "Invalid Refresh Token" },
            400,
          );
        }
        return jsonResponse(tokenResponse(ctx, fallback, `mock-refresh-${Date.now()}`));
      }
      return jsonResponse(tokenResponse(ctx, email, String(body.refresh_token)));
    }
    return jsonResponse({ error: "unsupported_grant_type" }, 400);
  }

  if (path === "/auth/v1/logout" && method === "POST") {
    ctx.currentEmail = null;
    return new Response(null, { status: 204 });
  }

  if (path === "/auth/v1/user") {
    const email = ctx.currentEmail ?? readStoredIdentity(ctx);
    if (!email || !ctx.seed.authUsers[email]) {
      return jsonResponse(
        { error: "no_session", error_description: "Not signed in" },
        401,
      );
    }
    if (method === "GET") return jsonResponse(ctx.seed.authUsers[email]);
    if (method === "PUT") {
      const user = ctx.seed.authUsers[email];
      if (body?.data?.user_metadata) {
        user.user_metadata = { ...user.user_metadata, ...body.data.user_metadata };
      }
      return jsonResponse(user);
    }
  }

  if (path === "/auth/v1/signup" && method === "POST") {
    return jsonResponse(
      { error: "signup_disabled", error_description: "Lite uses demo accounts" },
      403,
    );
  }

  return jsonResponse({ message: "ok" });
}

function resolveUserId(host: string, ctx: Ctx): string | null {
  if (ctx.currentEmail && ctx.seed.authUsers[ctx.currentEmail]) {
    return ctx.seed.authUsers[ctx.currentEmail].id;
  }
  try {
    const ref = host.split(".")[0];
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const email = parsed?.user?.email;
    if (email && ctx.seed.authUsers[email]) return ctx.seed.authUsers[email].id;
    // Seeded uuids map 1:1 to identities; also match by uuid.
    const id = parsed?.user?.id;
    if (id) return id;
  } catch {
    /* ignore */
  }
  return null;
}

function readStoredIdentity(ctx: Ctx): string | null {
  try {
    const id = localStorage.getItem("prangon-lite-identity");
    const identity = ctx.seed.identities[id ?? ""];
    return identity ?? null;
  } catch {
    return null;
  }
}

function tokenResponse(ctx: Ctx, email: string, refreshToken: string) {
  const user = ctx.seed.authUsers[email];
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: `mock-access-${user.id}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: refreshToken,
    user,
  };
}

// --------------------------------------------------------------------- rest

async function handleRest(
  ctx: Ctx,
  url: URL,
  method: string,
  body: any,
  init: any,
): Promise<Response> {
  const path = url.pathname.replace(/^\/rest\/v1\//, "");

  if (path.startsWith("rpc/")) {
    const fn = path.slice(4);
    const handler = ctx.seed.rpcs?.[fn];
    const result = handler ? await handler(body ?? {}, ctx.tables, ctx) : null;
    return jsonResponse(result ?? null);
  }

  const table = decodeURIComponent(path.split("?")[0]);
  let rows = ctx.tables[table];
  if (!rows) {
    // Unknown table: treat as empty instead of erroring so secondary
    // features degrade gracefully in mock mode.
    rows = [];
    ctx.tables[table] = rows;
  }

  const params = url.searchParams;
  const selectParam = params.get("select") ?? "*";
  const prefer = String(init?.headers?.Prefer ?? init?.headers?.prefer ?? "");
  const wantsRepresentation = prefer.includes("return=representation");
  const wantsCount = prefer.includes("count=exact") || prefer.includes("count=planned");
  const acceptObject = String(init?.headers?.Accept ?? "").includes(
    "vnd.pgrst.object+json",
  );

  const filters = parseFilters(params);

  if (method === "GET" || method === "HEAD") {
    let result = rows.filter((r) => matchesFilters(r, filters));
    const order = params.get("order");
    result = applyOrder(result, order);
    const offset = Number(params.get("offset") ?? 0) || 0;
    const limitParam = params.get("limit");
    const limit = limitParam == null ? Infinity : Number(limitParam);
    const total = result.length;
    const page = result.slice(offset, offset === 0 && limit === Infinity ? Infinity : offset + limit);
    const shaped = page.map((r) => shapeRow(ctx, table, r, selectParam));
    const headers: Record<string, string> = {};
    if (wantsCount) headers["content-range"] = `${total ? 0 : 0}-${Math.max(total - 1, 0)}/${total}`;
    if (acceptObject) {
      if (shaped.length === 0) {
        return jsonResponse(
          { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: null, hint: null },
          406,
          headers,
        );
      }
      return jsonResponse(shaped[0], 200, headers);
    }
    return jsonResponse(shaped, 200, headers);
  }

  if (method === "POST") {
    const onConflict = params.get("on_conflict");
    const conflictCols = onConflict ? onConflict.split(",").map((c) => c.trim()) : null;
    const isUpsert = prefer.includes("resolution=merge-duplicates") || prefer.includes("resolution=ignore-duplicates");
    const incoming: Row[] = (Array.isArray(body) ? body : [body]).map((r) =>
      ctx.seed.prepareRow ? ctx.seed.prepareRow(table, r) : r,
    );
    const inserted: Row[] = [];
    for (const row of incoming) {
      if (isUpsert && conflictCols) {
        const existing = rows.find((r) =>
          conflictCols.every((c) => String(r[c]) === String(row[c])),
        );
        if (existing) {
          if (prefer.includes("merge-duplicates")) Object.assign(existing, row);
          inserted.push(existing);
          continue;
        }
      }
      rows.push(row);
      inserted.push(row);
    }
    // Side effect: accepting a friend request is a follow, so notify the
    // recipient the way Instagram does — "X started following you".
    if (table === "friend_requests") {
      for (const row of inserted) {
        if (row.status !== "accepted") continue;
        const notes = ctx.tables["notifications"] ?? (ctx.tables["notifications"] = []);
        const dupe = notes.some(
          (n) =>
            n.type === "follow" &&
            n.user_id === row.to_user_id &&
            n.from_user_id === row.from_user_id,
        );
        if (dupe) continue;
        const fromProfile = (ctx.tables["profiles"] ?? []).find(
          (p) => p.id === row.from_user_id,
        );
        notes.push({
          id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          user_id: row.to_user_id,
          from_user_id: row.from_user_id,
          type: "follow",
          title: "New follower",
          message: "started following you",
          action_url: fromProfile ? `/profile/${fromProfile.username}` : null,
          is_read: false,
          created_at: new Date().toISOString(),
        });
      }
    }

    const shaped = inserted.map((r) => shapeRow(ctx, table, r, selectParam));
    return jsonResponse(wantsRepresentation ? (acceptObject ? shaped[0] ?? null : shaped) : null, 201);
  }

  if (method === "PATCH") {
    const updated: Row[] = [];
    for (const row of rows) {
      if (matchesFilters(row, filters)) {
        Object.assign(row, body);
        updated.push(row);
      }
    }
    const shaped = updated.map((r) => shapeRow(ctx, table, r, selectParam));
    return jsonResponse(wantsRepresentation ? (acceptObject ? shaped[0] ?? null : shaped) : null, 200);
  }

  if (method === "DELETE") {
    const remaining: Row[] = [];
    const removed: Row[] = [];
    for (const row of rows) {
      if (matchesFilters(row, filters)) removed.push(row);
      else remaining.push(row);
    }
    ctx.tables[table] = remaining;
    const shaped = removed.map((r) => shapeRow(ctx, table, r, selectParam));
    return jsonResponse(wantsRepresentation ? shaped : null, 200);
  }

  return jsonResponse({ message: `unsupported method ${method}` }, 405);
}

// ------------------------------------------------------------------ filters

type Filter = { column: string; op: string; value: string };
type FilterSet = { filters: Filter[]; orGroups: Filter[][] };

function parseFilters(params: URLSearchParams): FilterSet {
  const reserved = new Set([
    "select", "order", "limit", "offset", "on_conflict", "columns",
  ]);
  const set: FilterSet = { filters: [], orGroups: [] };
  params.forEach((rawValue, key) => {
    if (reserved.has(key)) return;
    const value = rawValue;
    if (key === "or") {
      // Minimal support: or=(col.eq.v,col.eq.v)
      const group: Filter[] = [];
      const inner = value.replace(/^\(|\)$/g, "");
      for (const clause of inner.split(",")) {
        const m = clause.match(/^([a-zA-Z0-9_.]+)\.(eq|neq|is|in|gte|lte|gt|lt|like|ilike)\.(.*)$/s);
        if (m) group.push({ column: m[1], op: m[2], value: m[3] });
      }
      if (group.length) set.orGroups.push(group);
      return;
    }
    let negate = false;
    let v = value;
    if (v.startsWith("not.")) {
      negate = true;
      v = v.slice(4);
    }
    const m = v.match(/^(eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|ov)\.(.*)$/s);
    if (m) {
      set.filters.push({ column: key, op: negate ? `not.${m[1]}` : m[1], value: m[2] });
    }
  });
  return set;
}

function compare(a: any, b: any): number {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  const an = Number(a);
  const bn = Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && typeof a !== "boolean") {
    return an - bn;
  }
  return String(a).localeCompare(String(b));
}

function matchesFilters(row: Row, set: FilterSet): boolean {
  for (const f of set.filters) {
    if (f.op.startsWith("not.")) {
      if (matchOne(row[f.column], f.op.slice(4), f.value)) return false;
      continue;
    }
    if (!matchOne(row[f.column], f.op, f.value)) return false;
  }
  for (const group of set.orGroups) {
    if (!group.some((f) => matchOne(row[f.column], f.op, f.value))) return false;
  }
  return true;
}

function matchOne(cell: any, op: string, rawValue: string): boolean {
  switch (op) {
    case "eq":
      if (rawValue === "null" && (cell === null || cell === undefined)) return true;
      return String(cell) === rawValue;
    case "neq":
      return String(cell) !== rawValue;
    case "gt":
      return compare(cell, rawValue) > 0;
    case "gte":
      return compare(cell, rawValue) >= 0;
    case "lt":
      return compare(cell, rawValue) < 0;
    case "lte":
      return compare(cell, rawValue) <= 0;
    case "like":
    case "ilike": {
      const pattern = rawValue.replace(/^\*|\*$/g, (m) => m).split("*").join(".*");
      const re = new RegExp(`^${pattern}$`, op === "ilike" ? "i" : "");
      return re.test(String(cell ?? ""));
    }
    case "is":
      if (rawValue === "null") return cell === null || cell === undefined;
      if (rawValue === "true") return cell === true;
      if (rawValue === "false") return cell === false;
      return String(cell) === rawValue;
    case "in": {
      const list = rawValue.replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
      return list.includes(String(cell));
    }
    case "cs": {
      if (Array.isArray(cell)) return rawValue.replace(/[{}]/g, "").split(",").every((x) => cell.map(String).includes(x));
      return String(cell ?? "").includes(rawValue.replace(/[{}"]/g, ""));
    }
    case "cd": {
      if (Array.isArray(cell)) return rawValue.replace(/[{}]/g, "").split(",").some((x) => cell.map(String).includes(x));
      return String(cell ?? "").includes(rawValue.replace(/[{}"]/g, ""));
    }
    case "ov": {
      if (Array.isArray(cell)) return rawValue.replace(/[{}]/g, "").split(",").some((x) => cell.map(String).includes(x));
      return false;
    }
    default:
      return true;
  }
}

function applyOrder(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const parts = order.split(".").map((p) => p.trim());
  const column = parts[0];
  const desc = parts.includes("desc");
  const nullsFirst = parts.some((p) => p.startsWith("nullsfirst"));
  const result = [...rows].sort((a, b) => {
    const av = a[column];
    const bv = b[column];
    if (av == null && bv == null) return 0;
    if (av == null) return nullsFirst ? -1 : 1;
    if (bv == null) return nullsFirst ? 1 : -1;
    const c = compare(av, bv);
    return desc ? -c : c;
  });
  return result;
}

function shapeRow(ctx: Ctx, table: string, row: Row, selectParam: string): Row {
  if (selectParam === "*") return { ...row };
  const out: Row = {};
  for (const item of parseSelectList(selectParam)) {
    applySelectItem(ctx, table, row, item, out);
  }
  return out;
}

type SelectItem = {
  raw: string;
  name: string;
  alias?: string;
  relation?: string;
  embed?: SelectItem[];
};

function parseSelectList(select: string): SelectItem[] {
  const items: SelectItem[] = [];
  let depth = 0;
  let current = "";
  const flush = () => {
    if (current.trim()) items.push(parseSelectItem(current));
    current = "";
  };
  for (const ch of select) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      flush();
      continue;
    }
    current += ch;
  }
  flush();
  return items;
}

function parseSelectItem(raw: string): SelectItem {
  const s = raw.trim();
  // alias:relation!hint(cols)  |  relation!hint(cols)  |  relation(cols)  |  col | alias:col
  const embedMatch = s.match(/^(?:(.+?):)?([a-zA-Z0-9_!]+)(?:\((.*)\))?$/s);
  if (embedMatch && embedMatch[3] !== undefined) {
    const relation = embedMatch[2].split("!")[0];
    const explicitAlias = embedMatch[1];
    return {
      raw: s,
      name: explicitAlias ?? relation,
      alias: explicitAlias ?? relation,
      relation,
      embed: parseSelectList(embedMatch[3]),
    };
  }
  if (s.includes(":")) {
    // PostgREST rename syntax: alias:column
    const [alias, column] = s.split(":");
    return { raw: s, name: column.trim(), alias: alias.trim() };
  }
  return { raw: s, name: s };
}

function applySelectItem(
  ctx: Ctx,
  table: string,
  row: Row,
  item: SelectItem,
  out: Row,
): void {
  if (item.embed) {
    const relName = item.relation ?? item.name;
    const relTable = ctx.seed.relations?.[table] ?? {};
    let rel = relTable[relName] ?? (item.alias ? relTable[item.alias] : undefined);
    let parentTable = relName;
    if (!rel && item.alias && ctx.tables[item.alias] && relName.endsWith("_id") && row[relName] != null) {
      // Generic FK-column embedding (e.g. profiles:user_id(...)): the parent
      // table is the alias, the FK column is the relation name.
      rel = { column: relName, kind: "out", parentColumn: "id" };
      parentTable = item.alias;
    }
    if (!rel) {
      out[item.alias ?? relName] = null;
      return;
    }
    const relRows = ctx.tables[rel.tableName ?? parentTable] ?? [];
    if (rel.kind === "out") {
      const parent = relRows.find(
        (r) => String(r[rel.parentColumn ?? "id"]) === String(row[rel.column]),
      );
      out[item.alias ?? relName] = parent
        ? shapeSubset(parent, item.embed)
        : null;
    } else {
      const children = relRows.filter(
        (r) => String(r[rel.column]) === String(row[rel.parentColumn ?? "id"]),
      );
      out[item.alias ?? relName] = children.map((c) => shapeSubset(c, item.embed));
    }
    return;
  }
  if (item.name === "*") {
    Object.assign(out, row);
    return;
  }
  if (item.name.startsWith("count()")) {
    return; // aggregate columns are not emulated
  }
  out[item.alias ?? item.name] = row[item.name] ?? null;
}

function shapeSubset(row: Row, items: SelectItem[]): Row {
  const out: Row = {};
  for (const item of items) {
    if (item.name === "*") {
      Object.assign(out, row);
      continue;
    }
    out[item.alias ?? item.name] = row[item.name] ?? null;
  }
  return out;
}

// ------------------------------------------------------------------ storage

function handleStorage(url: URL, method: string, init: any): Response {
  if (method === "POST" && url.pathname.endsWith("/object/list")) {
    return jsonResponse([]);
  }
  if (method === "POST") {
    return jsonResponse({ Key: url.pathname.replace("/storage/v1/object/", "") }, 200);
  }
  if (method === "DELETE") {
    return jsonResponse([]);
  }
  return jsonResponse(
    { error: "not_found", message: "Mock storage has no objects", statusCode: "404" },
    404,
  );
}

// ----------------------------------------------------------------- plumbing

let persistTimer: any = null;
function schedulePersist(ctx: Ctx) {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistTables(ctx.tables);
  }, 300);
}

function exposeHelpers(ctx: Ctx, getSeed: () => MockSeed) {
  (window as any).__prangonResetMockData = () => {
    const tables = getSeed().tables();
    ctx.tables = tables;
    persistTables(tables);
    try {
      localStorage.removeItem("sb-your-lite-project-auth-token");
    } catch {
      /* ignore */
    }
    location.reload();
  };
}
