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

test('Eselsbrücken werden über Stichwörter gefunden', () => {
  assert.match(findHint('Wie sind Kardinalzeichen gekennzeichnet?', ''), /Wespentaille/);
  assert.match(findHint('Was ist die Missweisung?', ''), /Vom Kompass zur Karte/);
  assert.equal(findHint('Wie heißt das?', 'leer'), null);
  // "lee" darf nicht in "leer" treffen
  assert.equal(findHint('Ist der Tank leer?', ''), null);
});
