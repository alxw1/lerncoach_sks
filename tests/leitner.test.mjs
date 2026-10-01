import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, newCard, applyGrade, recordAnswer, pickNext, computeStats } from '../src/leitner.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 1);

test('richtig steigt eine Box, falsch fällt auf Box 1', () => {
  let c = applyGrade(newCard(), 'richtig', NOW);
  assert.equal(c.box, 2);
  c = applyGrade(c, 'richtig', NOW);
  assert.equal(c.box, 3);
  assert.equal(c.due, NOW + 3 * DAY);
  c = applyGrade(c, 'falsch', NOW);
  assert.equal(c.box, 1);
  assert.equal(c.due, NOW);
});

test('teilweise fällt eine Box, aber nie unter 1', () => {
  let c = applyGrade(newCard(), 'teilweise', NOW);
  assert.equal(c.box, 1);
  c = { ...c, box: 4 };
  assert.equal(applyGrade(c, 'teilweise', NOW).box, 3);
});

test('Box 5 ist das Maximum', () => {
  let c = newCard();
  for (let i = 0; i < 10; i++) c = applyGrade(c, 'richtig', NOW);
  assert.equal(c.box, 5);
});

test('Sicherheit wächst mit richtigen Antworten und sinkt bei Fehlern', () => {
  let c = applyGrade(newCard(), 'richtig', NOW);
  assert.equal(c.confidence, 60);
  c = applyGrade(c, 'richtig', NOW);
  assert.equal(c.confidence, 76);
  const after = applyGrade(c, 'falsch', NOW);
  assert.ok(after.confidence < c.confidence);
  assert.equal(after.history.join(''), 'rrf');
});

test('unbekannte Bewertung wirft', () => {
  assert.throws(() => applyGrade(newCard(), 'vielleicht', NOW));
});

const qs = (n) => Array.from({ length: n }, (_, i) => ({ id: `Q-${i + 1}`, category: i % 2 ? 'wetter' : 'navigation' }));

test('fällige Karten aus niedrigen Boxen werden bevorzugt', () => {
  const state = emptyState();
  const questions = qs(6);
  // Q-1 in Box 1 (fällig), Q-2 in Box 5 (fällig), Rest nicht fällig
  state.cards['Q-1'] = { ...newCard(), box: 1, seen: 1, due: NOW - DAY };
  state.cards['Q-2'] = { ...newCard(), box: 5, seen: 1, due: NOW - DAY };
  for (const id of ['Q-3', 'Q-4', 'Q-5', 'Q-6']) state.cards[id] = { ...newCard(), box: 3, seen: 1, due: NOW + DAY };
  let low = 0;
  for (let i = 0; i < 400; i++) {
    const r = pickNext({ questions, state, now: NOW, newAllowed: 0, rng: Math.random });
    assert.equal(r.reason, 'fällig');
    if (r.question.id === 'Q-1') low++;
  }
  // Gewicht 25 : 1 → deutlich über 85 %
  assert.ok(low > 340, `Box-1-Karte nur ${low}/400 gewählt`);
});

test('kürzlich gestellte Fragen werden nicht sofort wiederholt', () => {
  const state = emptyState();
  const questions = qs(6);
  const recent = ['Q-1', 'Q-2', 'Q-3', 'Q-4'];
  for (let i = 0; i < 50; i++) {
    const r = pickNext({ questions, state, recent, now: NOW, newAllowed: 10 });
    assert.ok(!recent.includes(r.question.id));
  }
});

test('ohne fällige Karten kommen neue, ohne Kontingent die unsichersten', () => {
  const state = emptyState();
  const questions = qs(4);
  assert.equal(pickNext({ questions, state, now: NOW }).reason, 'neu');
  for (const [i, q] of questions.entries()) state.cards[q.id] = { ...newCard(), box: 3, seen: 2, confidence: 90 - i * 20, due: NOW + DAY };
  const r = pickNext({ questions, state, now: NOW, newAllowed: 0, rng: () => 0 });
  assert.equal(r.reason, 'vertiefen');
  assert.equal(r.question.id, 'Q-4');
});

test('Statistik je Gebiet', () => {
  const state = emptyState();
  const questions = qs(4); // navigation: Q-1, Q-3 · wetter: Q-2, Q-4
  recordAnswer(state, 'Q-1', 'richtig', NOW);
  recordAnswer(state, 'Q-1', 'falsch', NOW);
  recordAnswer(state, 'Q-2', 'teilweise', NOW);
  const s = computeStats(questions, [{ id: 'navigation', name: 'Navigation' }, { id: 'wetter', name: 'Wetterkunde' }], state, NOW);
  const nav = s.categories.find((c) => c.id === 'navigation');
  const wet = s.categories.find((c) => c.id === 'wetter');
  assert.equal(nav.total, 2);
  assert.equal(nav.seen, 1);
  assert.equal(nav.correctRate, 50);
  assert.equal(nav.coverage, 50);
  assert.equal(wet.correctRate, 50);
  assert.equal(s.total.answers, 3);
  assert.equal(s.total.boxes[0], 2);
});
