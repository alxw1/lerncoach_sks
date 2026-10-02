import test from 'node:test';
import assert from 'node:assert/strict';
import { localGrade, keywordScore, tokens, gradeFor } from '../src/grader.js';
import { parseCommand, parseGrade } from '../src/speech.js';
import { findHint } from '../src/hints.js';

test('Tokenisierung entfernt Füllwörter und normalisiert Umlaute', () => {
  assert.deepEqual(tokens('Die Fähre fährt über drei Seemeilen'), ['faehre', 'faehrt', '3', 'seemeilen']);
});

test('Richtigkeit in Prozent: mehr als 80 % ist richtig, sonst falsch', () => {
  const official = 'Rechtweisender Kurs, Missweisung und Ablenkung des Magnetkompasses.';
  const full = localGrade('man braucht den rechtweisenden Kurs, die Missweisung und die Ablenkung vom Magnetkompass', official);
  assert.equal(full.percent, 100);
  assert.equal(full.grade, 'richtig');
  const half = localGrade('die Missweisung', official);
  assert.equal(half.percent, 20);
  assert.equal(half.grade, 'falsch');
  assert.equal(gradeFor(80), 'falsch');
  assert.equal(gradeFor(81), 'richtig');
});

test('Zahlwörter werden als Ziffern erkannt', () => {
  const r = keywordScore('drei kurze Töne', '3 kurze Töne');
  assert.equal(r.score, 1);
});

test('Sprachbefehle', () => {
  assert.equal(parseCommand('Nochmal'), 'wiederholen');
  assert.equal(parseCommand('weiß ich nicht'), 'weissnicht');
  assert.equal(parseCommand('Pause.'), 'pause');
  assert.equal(parseCommand(''), 'stille');
  assert.equal(parseCommand('Statistik'), 'statistik');
  assert.equal(parseCommand('man muss nach Steuerbord ausweichen'), null);
});

test('Selbsteinschätzung per Sprache', () => {
  assert.equal(parseGrade('das war richtig'), 'richtig');
  assert.equal(parseGrade('nur teilweise'), 'falsch');
  assert.equal(parseGrade('leider falsch'), 'falsch');
  assert.equal(parseGrade('okay'), 'ok');
  assert.equal(parseGrade('hmm'), null);
});

test('Eselsbrücken sind fest Fragen zugeordnet', () => {
  assert.match(findHint('NAV-64'), /Wespentaille/);
  assert.match(findHint('REC-22'), /Rot über Rot/);
  assert.equal(findHint('NAV-1'), null);
});

test('Eselsbrücken verweisen nur auf existierende Katalogfragen', async () => {
  const { readFile } = await import('node:fs/promises');
  const { HINTS } = await import('../src/hints.js');
  const catalog = JSON.parse(await readFile(new URL('../data/fragen.json', import.meta.url), 'utf8'));
  const ids = new Set(catalog.questions.map((q) => q.id));
  for (const h of HINTS) for (const id of h.ids) assert.ok(ids.has(id), `${id} fehlt im Katalog`);
});

test('Abkürzungen werden zum Vorlesen ausgeschrieben', async () => {
  const { sayable } = await import('../src/speech.js');
  assert.equal(sayable('Ggf. FdW mit 5 kn, z. B. 200 m.'), 'gegebenenfalls Fahrt durchs Wasser mit 5 Knoten, zum Beispiel 200 Meter.');
  assert.equal(sayable('Abl + Mw = Fw'), 'Ablenkung + Missweisung = Fehlweisung');
  assert.equal(sayable('Kurs 030°'), 'Kurs 030 Grad');
});

test('OpenAI-Bewertung: Anfrage mit JSON-Schema, Ergebnis ab mehr als 80 % richtig', async () => {
  const { openaiGrade } = await import('../src/grader.js');
  const calls = [];
  const realFetch = globalThis.fetch;
  const reply = (richtigkeit) => async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ richtigkeit, rueckmeldung: 'Gut.', lernhilfe: '' }) } }],
    }), { status: 200 });
  };
  try {
    const settings = { apiKey: 'sk-test', model: 'gpt-5-mini' };
    globalThis.fetch = reply(85);
    const ok = await openaiGrade({ question: 'F?', officialAnswer: 'A.', userAnswer: 'A', settings });
    assert.deepEqual([ok.grade, ok.percent, ok.source, ok.hint], ['richtig', 85, 'openai', null]);
    const { url, init, body } = calls[0];
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer sk-test');
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.reasoning_effort, 'low');

    globalThis.fetch = reply(80);
    assert.equal((await openaiGrade({ question: 'F?', officialAnswer: 'A.', userAnswer: 'A', settings })).grade, 'falsch');

    globalThis.fetch = reply(70);
    await openaiGrade({ question: 'F?', officialAnswer: 'A.', userAnswer: 'A', settings: { apiKey: 'k', model: 'gpt-4o-mini' } });
    assert.equal(calls.at(-1).body.reasoning_effort, undefined);

    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Incorrect API key' } }), { status: 401 });
    await assert.rejects(openaiGrade({ question: 'F?', officialAnswer: 'A.', userAnswer: 'A', settings }), /OpenAI 401: Incorrect API key/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Verständliche Fehlermeldungen für den Verbindungstest', async () => {
  const { explainOpenAIError } = await import('../src/grader.js');
  const withStatus = (status) => Object.assign(new Error('x'), { status });
  assert.match(explainOpenAIError(withStatus(401)), /Schlüssel ungültig/);
  assert.match(explainOpenAIError(withStatus(404)), /Modell nicht gefunden/);
  assert.match(explainOpenAIError(withStatus(429)), /Guthaben/);
  assert.match(explainOpenAIError(new TypeError('Failed to fetch')), /Keine Verbindung/);
});
