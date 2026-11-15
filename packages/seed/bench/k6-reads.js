// §6: API p95 under 300 ms for reads. Families read their card and activity; a physician works
// the desk queue. Run through `pnpm --filter @tomoni/seed bench:api` (seeded DB, real RLS).
import http from 'k6/http';
import crypto from 'k6/crypto';
import { check, sleep } from 'k6';

const API = __ENV.API;
const ORIGIN = __ENV.ORIGIN;
const PW = __ENV.PW;
const json = { headers: { 'content-type': 'application/json', origin: ORIGIN } };

export const options = {
  scenarios: {
    family: { executor: 'constant-vus', vus: 40, duration: '60s', exec: 'family' },
    desk: { executor: 'constant-vus', vus: 1, duration: '60s', exec: 'desk' },
  },
  thresholds: {
    'http_req_duration{kind:read}': ['p(95)<300'],
    'checks{kind:read}': ['rate>0.99'],
    'http_reqs{kind:read}': ['count>2000'], // no vacuous pass
  },
};

function base32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '')) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out.buffer;
}
function totp(secret, step) {
  const msg = new Uint8Array(8);
  for (let i = 7, n = step; i >= 0; i--, n = Math.floor(n / 256)) msg[i] = n & 0xff;
  const h = new Uint8Array(crypto.hmac('sha1', base32(secret), msg.buffer, 'binary'));
  const o = h[19] & 0xf;
  const v = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(v % 1e6).padStart(6, '0');
}
// __Host- cookies are Secure-only, so over plain http the jar won't send them: pass them by hand.
function session(r) {
  const c = r.cookies;
  const sid = c['__Host-tomoni_sid']?.[0]?.value;
  const csrf = c['__Host-tomoni_csrf']?.[0]?.value;
  return {
    origin: ORIGIN,
    cookie: `__Host-tomoni_sid=${sid}; __Host-tomoni_csrf=${csrf}`,
    'x-csrf-token': csrf,
  };
}
function login(email) {
  const r = http.post(`${API}/api/auth/login`, JSON.stringify({ email, password: PW }), json);
  check(r, { 'login ok': (x) => x.status === 200 });
  return session(r);
}
const post = (h, path, body) =>
  http.post(`${API}${path}`, JSON.stringify(body), { headers: { ...h, 'content-type': 'application/json' } });

export function setup() {
  // The physician enrols MFA once and the desk VU reuses that session.
  const h = login('dr.rao@demo.tomoni.test');
  const e = post(h, '/api/auth/mfa/enroll', {});
  if (!check(e, { 'enroll ok': (x) => x.status === 200 })) throw new Error(`enroll ${e.status}`);
  const code = totp(e.json('secret'), Math.floor(Date.now() / 30000));
  const m = post(h, '/api/auth/mfa/enroll/confirm', { code });
  if (!check(m, { 'mfa ok': (x) => x.status === 204 })) throw new Error(`mfa ${m.status}`);
  // MFA rotates the session (fixation defence): carry on with the new cookies when it does.
  return { desk: m.cookies['__Host-tomoni_sid'] ? session(m) : h };
}

const read = (h, path) => {
  const r = http.get(`${API}${path}`, { headers: h, tags: { kind: 'read', name: path } });
  check(r, { 'read 200': (x) => x.status === 200 }, { kind: 'read' });
};

let me;
export function family() {
  me ??= login(__VU % 2 ? 'asha@demo.tomoni.test' : 'priya@demo.tomoni.test');
  read(me, '/api/family/card');
  read(me, '/api/family/activity');
  read(me, '/api/me');
  sleep(1);
}

export function desk(data) {
  read(data.desk, '/api/desk/queue');
  read(data.desk, '/api/desk/patients');
  sleep(0.5);
}
