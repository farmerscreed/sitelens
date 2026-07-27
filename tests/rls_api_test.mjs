// ═══════════════════════════════════════════════════════════════════════════
// AC-6 — RLS isolation test, API route (through PostgREST, as the API sees it).
// "Org A cannot read a single row of org B by any route."
//
// Mints an HS256 JWT with the LOCAL jwt secret (role=authenticated + our custom
// active_org_id claim), then queries the REST endpoint and asserts Org A's token
// never returns an Org B row — and does return its own (positive control).
//
// Env: API_URL (e.g. http://127.0.0.1:54321), ANON_KEY, JWT_SECRET
// Run:  node tests/rls_api_test.mjs   (exits non-zero on any leak)
// No external deps — Node's built-in crypto only. Never calls a paid API.
// ═══════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';

const API_URL    = process.env.API_URL   || 'http://127.0.0.1:54321';
// Kong fronts PostgREST at /rest/v1/ ; a bare PostgREST serves tables at / .
const REST_PREFIX = process.env.REST_PREFIX ?? '/rest/v1';
const ANON_KEY   = process.env.ANON_KEY || '';   // apikey header (Kong path); ignored by bare PostgREST
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET env (from `supabase status`, or the local default).');
  process.exit(2);
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function mintJwt({ sub, activeOrgId }) {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now     = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    role: 'authenticated', aud: 'authenticated', sub,
    active_org_id: activeOrgId, iat: now, exp: now + 3600,
  }));
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

const ORG_A = 'a0000000-0000-0000-0000-0000000000aa';
const ORG_B = 'b0000000-0000-0000-0000-0000000000bb';
const USER_A = 'a1111111-1111-1111-1111-111111111111';
const USER_B = 'b2222222-2222-2222-2222-222222222222';

// table -> { a: id owned by Org A, b: id owned by Org B }
const MATRIX = {
  organizations:         { a: ORG_A, b: ORG_B },
  projects:              { a: 'a5555555-5555-5555-5555-555555555555', b: 'b6666666-6666-6666-6666-666666666666' },
  materials_catalog:     { a: 'a7777777-7777-7777-7777-777777777777', b: 'b8888888-8888-8888-8888-888888888888' },
  building_types:        { a: 'aaaa0000-0000-0000-0000-0000000000a1', b: 'bbbb0000-0000-0000-0000-0000000000b1' },
  buildings:             { a: 'aabb0000-0000-0000-0000-0000000000a1', b: 'aabb0000-0000-0000-0000-0000000000b1' },
  expenses:              { a: 'a1a1a1a1-0000-0000-0000-0000000000a1', b: 'b1b1b1b1-0000-0000-0000-0000000000b1' },
  material_transactions: { a: 'a2a2a2a2-0000-0000-0000-0000000000a1', b: 'b2b2b2b2-0000-0000-0000-0000000000b1' },
  daily_reports:         { a: 'a3a3a3a3-0000-0000-0000-0000000000a1', b: 'b3b3b3b3-0000-0000-0000-0000000000b1' },
};

async function fetchIds(table, jwt) {
  const headers = { Authorization: `Bearer ${jwt}` };
  if (ANON_KEY) headers.apikey = ANON_KEY;
  const res = await fetch(`${API_URL}${REST_PREFIX}/${table}?select=id`, { headers });
  if (!res.ok) throw new Error(`GET ${table} -> ${res.status} ${await res.text()}`);
  return (await res.json()).map((row) => row.id);
}

let leaks = 0, checks = 0;

async function checkPerspective(label, jwt, ownKey, otherKey) {
  for (const [table, ids] of Object.entries(MATRIX)) {
    const seen = new Set(await fetchIds(table, jwt));
    checks += 2;
    if (seen.has(ids[otherKey])) {
      console.error(`LEAK: ${label} token returned ${table} row ${ids[otherKey]} (other org)`);
      leaks++;
    }
    if (!seen.has(ids[ownKey])) {
      console.error(`VISIBILITY: ${label} token did NOT return its own ${table} row ${ids[ownKey]}`);
      leaks++;
    }
  }
}

const jwtA = mintJwt({ sub: USER_A, activeOrgId: ORG_A });
const jwtB = mintJwt({ sub: USER_B, activeOrgId: ORG_B });

await checkPerspective('OrgA', jwtA, 'a', 'b');
await checkPerspective('OrgB', jwtB, 'b', 'a');

if (leaks > 0) {
  console.error(`\nAC-6 FAILED (API): ${leaks} isolation violation(s) across ${checks} checks.`);
  process.exit(1);
}
console.log(`AC-6 PASS (API): ${checks} checks, 0 leaks. PostgREST enforces org isolation.`);
