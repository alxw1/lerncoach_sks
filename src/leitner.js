// Leitner-Lernbox: reine Logik ohne DOM, damit sie in Node getestet werden kann.

export const BOXES = 5;
const DAY = 24 * 60 * 60 * 1000;
// Wiedervorlage je Box in Tagen. Box 1 = jede Sitzung.
export const INTERVAL_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 };
// Wie viele andere Fragen mindestens dazwischen liegen, bevor eine Frage in
// derselben Sitzung erneut kommt.
const SESSION_GAP = 4;

export const SCORE = { richtig: 1, teilweise: 0.5, falsch: 0 };

export function emptyState() {
  return { version: 1, cards: {}, sessions: 0, createdAt: Date.now() };
}

export function newCard() {
  return {
    box: 0, // 0 = noch nie gefragt
    seen: 0,
    richtig: 0,
    teilweise: 0,
    falsch: 0,
    confidence: 0, // 0–100 %
    lastSeen: 0,
    due: 0,
    history: [],
  };
}

export function getCard(state, id) {
  return state.cards[id] || newCard();
}

/**
 * Wendet eine Bewertung auf eine Karte an und gibt die neue Karte zurück.
 * richtig  → eine Box höher (max. 5)
 * teilweise → eine Box tiefer (min. 1), bald wieder dran
 * falsch   → zurück in Box 1
 */
export function applyGrade(card, grade, now = Date.now()) {
  if (!(grade in SCORE)) throw new Error(`Unbekannte Bewertung: ${grade}`);
  const c = { ...card, history: [...card.history] };
  const score = SCORE[grade];
  const prevBox = c.box || 1;

  if (grade === 'richtig') c.box = c.box === 0 ? 2 : Math.min(BOXES, c.box + 1);
  else if (grade === 'teilweise') c.box = Math.max(1, prevBox - 1);
  else c.box = 1;

  // Antwortsicherheit: gleitender Mittelwert. Die erste Antwort zählt
  // vorsichtig, damit ein Zufallstreffer nicht gleich 100 % ergibt.
  c.confidence = c.seen === 0
    ? Math.round(score * 60)
    : Math.round(c.confidence * 0.6 + score * 100 * 0.4);

  c.seen += 1;
  c[grade] += 1;
  c.lastSeen = now;
  c.due = now + INTERVAL_DAYS[c.box] * DAY;
  c.history.push(grade[0]); // r / t / f
  if (c.history.length > 12) c.history.shift();
  return c;
}

export function recordAnswer(state, id, grade, now = Date.now()) {
  const before = getCard(state, id);
  const after = applyGrade(before, grade, now);
  state.cards[id] = after;
  return { before, after };
}

/**
 * Wählt die nächste Frage.
 * Priorität: fällige Karten (niedrige Box zuerst, gewichteter Zufall),
 * dazwischen neue Karten, bis das Tageslimit erreicht ist. Ist nichts mehr
 * fällig, kommen die Karten mit der geringsten Sicherheit.
 *
 * @param {object} opts
 * @param {Array<{id:string}>} opts.questions  bereits gefilterte Fragen
 * @param {object} opts.state
 * @param {string[]} opts.recent  IDs der zuletzt gestellten Fragen (neueste zuletzt)
 * @param {number} opts.newAllowed wie viele neue Fragen noch eingeführt werden dürfen
 * @param {number} opts.askedCount Anzahl bereits gestellter Fragen in der Sitzung
 */
export function pickNext({ questions, state, recent = [], newAllowed = 10, askedCount = 0, now = Date.now(), rng = Math.random }) {
  if (!questions.length) return null;
  const gap = Math.min(SESSION_GAP, Math.max(0, questions.length - 1));
  const blocked = new Set(recent.slice(-gap));
  const pool = questions.filter((q) => !blocked.has(q.id));
  const candidates = pool.length ? pool : questions;

  const due = [];
  const fresh = [];
  const rest = [];
  for (const q of candidates) {
    const card = state.cards[q.id];
    if (!card || card.box === 0) fresh.push(q);
    else if (card.due <= now) due.push(q);
    else rest.push(q);
  }

  // Jede dritte Frage darf neu sein – oder jede, wenn nichts fällig ist.
  const wantNew = fresh.length > 0 && newAllowed > 0 && (due.length === 0 || askedCount % 3 === 2);
  if (wantNew) return { question: fresh[Math.floor(rng() * fresh.length)], reason: 'neu' };

  if (due.length) {
    const weights = due.map((q) => {
      const c = state.cards[q.id];
      const overdueDays = Math.max(0, (now - c.due) / DAY);
      return (BOXES + 1 - c.box) ** 2 * (1 + Math.min(overdueDays, 10) * 0.1);
    });
    return { question: weightedPick(due, weights, rng), reason: 'fällig' };
  }

  if (fresh.length) return { question: fresh[Math.floor(rng() * fresh.length)], reason: 'neu' };

  // Nichts fällig: unsicherste Karten zur Vertiefung.
  const sorted = [...rest].sort((a, b) => state.cards[a.id].confidence - state.cards[b.id].confidence);
  const top = sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.2)));
  return { question: top[Math.floor(rng() * top.length)], reason: 'vertiefen' };
}

function weightedPick(items, weights, rng) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/** Statistik je Schwerpunktgebiet und gesamt. */
export function computeStats(questions, categories, state, now = Date.now()) {
  const make = (id, name) => ({
    id, name, total: 0, seen: 0, mastered: 0, due: 0,
    answers: 0, points: 0, confidenceSum: 0,
    boxes: [0, 0, 0, 0, 0, 0],
  });
  const byCat = new Map(categories.map((c) => [c.id, make(c.id, c.name)]));
  const all = make('gesamt', 'Gesamt');

  for (const q of questions) {
    const s = byCat.get(q.category) || byCat.set(q.category, make(q.category, q.category)).get(q.category);
    const card = state.cards[q.id];
    for (const t of [s, all]) {
      t.total += 1;
      if (!card || card.box === 0) { t.boxes[0] += 1; continue; }
      t.seen += 1;
      t.boxes[card.box] += 1;
      if (card.box >= 4) t.mastered += 1;
      if (card.due <= now) t.due += 1;
      t.answers += card.seen;
      t.points += card.richtig + card.teilweise * 0.5;
      t.confidenceSum += card.confidence;
    }
  }

  const finish = (t) => ({
    ...t,
    // Anteil richtig beantworteter Versuche (teilweise = halb)
    correctRate: t.answers ? Math.round((t.points / t.answers) * 100) : null,
    // Durchschnittliche Sicherheit über alle Fragen des Gebiets (ungesehene = 0)
    confidence: t.total ? Math.round(t.confidenceSum / t.total) : 0,
    coverage: t.total ? Math.round((t.seen / t.total) * 100) : 0,
  });
  return { categories: [...byCat.values()].map(finish), total: finish(all) };
}
