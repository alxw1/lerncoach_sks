import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../supabase/functions/grade/index.ts';

const USER = { id: 'u1', email: 'alex@example.com', email_confirmed_at: '2026-10-01T00:00:00Z' };
const ADMIN = { id: 'a1', email: 'Admin@Weislogel.com', email_confirmed_at: '2026-10-01T00:00:00Z' };
const CFG = { openai_api_key: 'sk-secret', openai_model: 'gpt-5-mini', daily_limit: 2 };

function deps({ user = USER, cfg = CFG, allow = true, openai } = {}) {
  const calls = { openai: [], consume: 0 };
  return {
    calls,
    getUser: async (jwt) => (jwt === 'good' ? user : null),
    getConfig: async () => cfg,
    consume: async () => { calls.consume++; return allow; },
    fetch: async (url, init) => {
      calls.openai.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
      return openai ? openai() : new Response(JSON.stringify({
        model: 'gpt-5-mini-x',
        choices: [{ message: { content: JSON.stringify({ richtigkeit: 85, rueckmeldung: 'Gut.', lernhilfe: '' }) } }],
      }));
    },
  };
}
const req = (body, jwt = 'good') => new Request('https://x/functions/v1/grade', {
  method: 'POST',
  headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const Q = { question: 'F?', officialAnswer: 'A.', userAnswer: 'A' };

test('Bewertung: nur angemeldet, Schlüssel bleibt auf dem Server', async () => {
  const d = deps();
  const res = await handle(req(Q), d);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual([out.percent, out.grade, out.model, out.hint], [85, 'richtig', 'gpt-5-mini-x', null]);
  assert.equal(JSON.stringify(out).includes('sk-secret'), false);
  assert.equal(d.calls.openai[0].auth, 'Bearer sk-secret');
  assert.equal(d.calls.openai[0].body.response_format.json_schema.strict, true);
  assert.equal(d.calls.consume, 1);
  assert.equal((await handle(req(Q, 'bad'), deps())).status, 401);
});

test('Unbestätigte E-Mail, Tageslimit und fehlende Einrichtung', async () => {
  assert.equal((await handle(req(Q), deps({ user: { ...USER, email_confirmed_at: null } }))).status, 403);
  const limited = await handle(req(Q), deps({ allow: false }));
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).message, /Tageslimit von 2/);
  assert.equal((await handle(req(Q), deps({ cfg: { ...CFG, openai_api_key: null } }))).status, 503);
});

test('Admin: kein Limit, Verbindungstest nur für Admin', async () => {
  const d = deps({ user: ADMIN, allow: false });
  assert.equal((await handle(req({ ...Q, test: true }), d)).status, 200);
  assert.equal(d.calls.consume, 0);
  assert.equal((await handle(req({ ...Q, test: true }), deps())).status, 403);
});

test('80 % ist falsch, OpenAI-Fehler werden weitergereicht', async () => {
  const reply = (n) => () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ richtigkeit: n, rueckmeldung: '', lernhilfe: '' }) } }] }));
  assert.equal((await (await handle(req(Q), deps({ openai: reply(80) }))).json()).grade, 'falsch');
  const err = await handle(req(Q), deps({ openai: () => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }) }));
  assert.equal(err.status, 502);
  assert.deepEqual(await err.json(), { error: 'openai_error', status: 429, message: 'OpenAI 429: quota' });
});

test('CORS-Vorabanfrage und ungültige Eingaben', async () => {
  const pre = await handle(new Request('https://x', { method: 'OPTIONS' }), deps());
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await handle(req({ userAnswer: 'x' }), deps())).status, 400);
});
