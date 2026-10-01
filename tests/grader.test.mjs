import test from 'node:test';
import assert from 'node:assert/strict';
import { localGrade, keywordScore, tokens } from '../src/grader.js';
import { parseCommand, parseGrade } from '../src/speech.js';
import { findHint } from '../src/hints.js';

test('Tokenisierung entfernt Füllwörter und normalisiert Umlaute', () => {
  assert.deepEqual(tokens('Die Fähre fährt über drei Seemeilen'), ['faehre', 'faehrt', '3', 'seemeilen']);
});

test('vollständige Antwort mit anderer Formulierung ist richtig', () => {
  const official = 'Rechtweisender Kurs, Missweisung und Ablenkung des Magnetkompasses.';
  const r = localGrade('man braucht den rechtweisenden Kurs, die Missweisung und die Ablenkung vom Magnetkompass', official);
  assert.equal(r.grade, 'richtig');
});

test('halbe Antwort ist teilweise, falsche ist falsch', () => {
  const official = 'Rechtweisender Kurs, Missweisung und Ablenkung des Magnetkompasses.';
  assert.equal(localGrade('die Missweisung', official).grade, 'teilweise');
  assert.equal(localGrade('keine Ahnung vom Wetter', official).grade, 'falsch');
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
  assert.equal(parseGrade('nur teilweise'), 'teilweise');
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
