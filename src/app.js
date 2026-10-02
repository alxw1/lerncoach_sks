import { emptyState, getCard, recordAnswer, pickNext, computeStats } from './leitner.js';
import { localGrade, PASS_PERCENT } from './grader.js';
import * as auth from './auth.js';
import { initAuth } from './ui-auth.js';
import { findHint } from './hints.js';
import { parseElwisPage, buildCatalog, CATEGORIES } from './elwis-parser.js';
import * as speech from './speech.js';

// Bei jeder Veröffentlichung anpassen (auch CACHE in sw.js) – wird unter „Lernen“ angezeigt.
export const APP_VERSION = '2026-10-03 · Anmeldung & macOS-Design';

// ---------- Speicher ----------
// Lernstand je Konto (sks.state.<user-id>), Einstellungen und Katalog je Gerät
const KEYS = { state: 'sks.state', settings: 'sks.settings', catalog: 'sks.catalog' };
const DEFAULT_SETTINGS = {
  categories: null, // null = alle
  audioOnly: true,
  newPerDay: 15,
  reportEvery: 10,
  voice: '',
  rate: 1.0,
  silence: 2.2,
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('Speichern fehlgeschlagen', e); }
}

let user = null; // angemeldetes Supabase-Konto
let state = emptyState();
let settings = { ...DEFAULT_SETTINGS, ...load(KEYS.settings, {}) };
// Früher lagen API-Schlüssel im Browser – heute liegt der Schlüssel nur noch auf dem Server.
if ('apiKey' in settings || 'model' in settings) {
  delete settings.apiKey;
  delete settings.model;
  save(KEYS.settings, settings);
}
let catalog = null;

const stateKey = () => `${KEYS.state}.${user.id}`;
const saveState = () => { if (user) save(stateKey(), state); };
const saveSettings = () => save(KEYS.settings, settings);

/** Lernstand des Kontos laden; ein älterer Lernstand ohne Konto wird beim ersten Login übernommen. */
function loadUserState() {
  const own = load(stateKey(), null);
  const legacy = load(KEYS.state, null);
  if (own) return own;
  if (legacy) {
    save(stateKey(), legacy);
    localStorage.removeItem(KEYS.state);
    return legacy;
  }
  return emptyState();
}

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const el = {
  card: $('#card'), startPanel: $('#start-panel'), noCatalog: $('#no-catalog'), today: $('#today'),
  voiceWarning: $('#voice-warning'),
  qCat: $('#q-cat'), qNr: $('#q-nr'), qBox: $('#q-box'), qConf: $('#q-conf'), qReason: $('#q-reason'),
  qText: $('#q-text'), qImages: $('#q-images'),
  status: $('#status'), transcript: $('#transcript'), form: $('#answer-form'), input: $('#answer-input'),
  answerArea: $('#answer-area'), result: $('#result'), verdict: $('#verdict'), feedback: $('#feedback'),
  hint: $('#hint'), officialBox: $('#official'), official: $('#official-answer'), boxChange: $('#box-change'),
  scoreValue: $('#score-value'), scoreFill: $('#score-fill'), scoreBar: $('#score-bar'), scoreSource: $('#score-source'),
  btnNext: $('#btn-next'),
};

// ---------- Katalog ----------
async function loadCatalog() {
  const imported = load(KEYS.catalog, null);
  if (imported?.questions?.length) return imported;
  try {
    const res = await fetch('data/fragen.json', { cache: 'no-cache' });
    if (res.ok) return await res.json();
  } catch { /* offline oder nicht vorhanden */ }
  return null;
}

function categoryName(id) {
  return catalog?.categories?.find((c) => c.id === id)?.name || CATEGORIES.find((c) => c.id === id)?.name || id;
}

function activeQuestions({ forVoice }) {
  if (!catalog) return [];
  return catalog.questions.filter((q) =>
    (!settings.categories || settings.categories.includes(q.category))
    && q.answer
    && !(forVoice && settings.audioOnly && (q.images?.length || q.answerImages?.length)));
}

// ---------- Tageszähler für neue Fragen ----------
function todayKey() { return new Date().toISOString().slice(0, 10); }
function newAllowedToday() {
  if (state.daily?.date !== todayKey()) state.daily = { date: todayKey(), newCount: 0, answered: 0 };
  return Math.max(0, settings.newPerDay - state.daily.newCount);
}

// ---------- Sitzung ----------
class Cancelled extends Error {}
const session = {
  gen: 0,
  mode: null, // 'auto' | 'manual'
  recent: [],
  asked: 0,
  answered: 0,
  current: null, // { q, reason, suggested, grade }
  waiter: null, // Promise-Resolver für manuelle Eingaben
};

function guard(gen) { if (gen !== session.gen) throw new Cancelled(); }

async function say(text, gen) {
  if (session.mode !== 'auto') return;
  guard(gen);
  await speech.speak(text);
  guard(gen);
}

async function hear(gen, opts = {}) {
  guard(gen);
  setStatus('🎤 Ich höre zu …');
  el.transcript.textContent = '';
  const text = await speech.listen({
    silenceMs: settings.silence * 1000,
    onPartial: (t) => { el.transcript.textContent = t; },
    ...opts,
  });
  guard(gen);
  el.transcript.textContent = text;
  setStatus('');
  return text;
}

function setStatus(t) { el.status.textContent = t; }

/** Wartet im manuellen Modus auf einen Klick/Submit. */
function waitForUser(gen) {
  return new Promise((resolve, reject) => {
    session.waiter = (value) => {
      session.waiter = null;
      if (gen !== session.gen) reject(new Cancelled()); else resolve(value);
    };
  });
}
function resolveWaiter(value) { session.waiter?.(value); }

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* nicht unterstützt */ }
}

async function startSession(mode) {
  if (!catalog) return;
  if (mode === 'auto' && !speech.canListen) {
    alert('Dieser Browser unterstützt keine Spracherkennung. Bitte Chrome (Android) oder Safari (iOS) verwenden.');
    return;
  }
  const gen = ++session.gen;
  Object.assign(session, { mode, recent: [], asked: 0, answered: 0, current: null });
  state.sessions = (state.sessions || 0) + 1;
  saveState();
  el.startPanel.hidden = true;
  el.card.hidden = false;
  el.form.hidden = mode === 'auto';
  document.body.classList.toggle('drive', mode === 'auto');
  if (mode === 'auto') {
    keepAwake(true);
    const due = computeStats(activeQuestions({ forVoice: true }), [], state).total.due;
    try {
      await say(`Los geht's. ${due ? `${due} Fragen sind zur Wiederholung fällig.` : ''} Du kannst jederzeit „nochmal“, „überspringen“, „weiß nicht“, „Statistik“ oder „Pause“ sagen.`, gen);
    } catch (e) { if (e instanceof Cancelled) return; throw e; }
  }
  loop(gen);
}

function stopSession(message) {
  session.gen++;
  speech.stopSpeaking();
  speech.stopListening();
  resolveWaiter(null);
  keepAwake(false);
  document.body.classList.remove('drive');
  el.card.hidden = true;
  el.startPanel.hidden = false;
  renderToday(message);
}

async function loop(gen) {
  try {
    while (gen === session.gen) {
      const questions = activeQuestions({ forVoice: session.mode === 'auto' });
      const pick = pickNext({
        questions, state, recent: session.recent, newAllowed: newAllowedToday(), askedCount: session.asked,
      });
      if (!pick) { stopSession('Keine Fragen in der Auswahl.'); return; }
      session.asked++;
      session.recent.push(pick.question.id);
      await round(pick.question, pick.reason, gen);
      if (settings.reportEvery && session.answered && session.answered % settings.reportEvery === 0) {
        await say(progressSentence(), gen);
      }
    }
  } catch (e) {
    if (e instanceof Cancelled) return;
    console.error(e);
    setStatus(`⚠️ ${e.message}`);
    if (session.mode === 'auto') {
      await speech.speak(`Es gab ein Problem: ${e.message}. Ich pausiere.`);
      stopSession(`Pausiert: ${e.message}`);
    }
  }
}

function showQuestion(q, reason) {
  const card = getCard(state, q.id);
  el.qCat.textContent = categoryName(q.category);
  el.qNr.textContent = `Nr. ${q.nr}`;
  el.qBox.textContent = card.box ? `Box ${card.box}` : 'neu';
  el.qBox.dataset.box = card.box;
  el.qConf.textContent = card.seen ? `Sicherheit ${card.confidence} %` : '';
  el.qConf.hidden = !card.seen;
  el.qReason.textContent = reason === 'fällig' ? 'Wiederholung' : reason === 'vertiefen' ? 'Vertiefung' : 'neue Frage';
  el.qText.textContent = q.question;
  el.qImages.replaceChildren(...(q.images || []).map((src) => {
    const img = document.createElement('img');
    img.src = src; img.alt = 'Abbildung zur Frage'; img.loading = 'lazy';
    return img;
  }));
  el.answerArea.hidden = false;
  el.form.hidden = session.mode === 'auto';
  el.officialBox.hidden = true;
  el.result.hidden = true;
  el.btnNext.hidden = true;
  el.input.value = '';
  el.transcript.textContent = '';
  setStatus('');
  for (const b of document.querySelectorAll('.grade')) b.classList.remove('selected');
}

/** Eine Frage-Antwort-Runde. */
async function round(q, reason, gen) {
  session.current = { q, reason };
  showQuestion(q, reason);
  const intro = `${categoryName(q.category)}, Frage ${q.nr}.`;

  // 1. Frage stellen und Antwort einholen
  let userAnswer = '';
  let dontKnow = false;
  if (session.mode === 'auto') {
    await say(`${intro} ${q.question}`, gen);
    let silentTries = 0;
    for (;;) {
      const heard = await hear(gen);
      const cmd = speech.parseCommand(heard);
      if (cmd === 'pause') { await say('Pause. Gute Fahrt!', gen); stopSession('Pausiert.'); throw new Cancelled(); }
      if (cmd === 'wiederholen') { await say(q.question, gen); continue; }
      if (cmd === 'ueberspringen') { await say('Okay, nächste Frage.', gen); return; }
      if (cmd === 'statistik') { await say(progressSentence(true), gen); await say(`Zurück zur Frage: ${q.question}`, gen); continue; }
      if (cmd === 'stille') {
        if (++silentTries >= 2) { await say('Ich höre nichts mehr. Ich pausiere – tippe auf Fortsetzen, wenn du weitermachen willst.', gen); stopSession('Pausiert (keine Antwort).'); throw new Cancelled(); }
        await say('Ich habe nichts gehört. Deine Antwort bitte – oder sag „weiß nicht“.', gen);
        continue;
      }
      if (cmd === 'weissnicht') dontKnow = true;
      userAnswer = dontKnow ? '' : heard;
      break;
    }
  } else {
    el.input.focus();
    const value = await waitForUser(gen);
    if (value === 'skip') return;
    if (value === 'dontknow') dontKnow = true;
    else userAnswer = String(value || '');
    el.transcript.textContent = userAnswer;
  }

  // 2. Bewerten
  el.answerArea.hidden = false; // eigene Antwort bleibt zum Vergleich sichtbar
  el.form.hidden = true;
  let evaluation;
  if (dontKnow) {
    evaluation = { grade: 'falsch', feedback: 'Kein Problem – genau dafür üben wir.', source: 'weissnicht' };
  } else if (user && userAnswer.trim() && navigator.onLine !== false) {
    setStatus('⏳ KI bewertet …');
    try {
      evaluation = await auth.serverGrade({ question: q.question, officialAnswer: q.answer, userAnswer });
    } catch (e) {
      console.warn('KI-Bewertung nicht möglich, nutze Stichwortabgleich', e);
      evaluation = { ...localGrade(userAnswer, q.answer), error: explainGradeError(e) };
    }
    guard(gen);
    setStatus('');
  } else {
    evaluation = localGrade(userAnswer, q.answer);
  }
  if (!userAnswer.trim() && !dontKnow) evaluation = { grade: 'falsch', feedback: 'Keine Antwort erkannt.', source: 'leer' };
  if (evaluation.percent == null) evaluation.percent = 0;

  const hint = evaluation.grade !== 'richtig' ? (evaluation.hint || findHint(q.id)) : (evaluation.hint || null);
  const final = evaluation.source !== 'lokal';
  showResult(q, evaluation, hint, final);

  // 3. Rückmeldung, Lernhilfe, ELWIS-Antwort
  if (session.mode === 'auto') {
    const verdictText = evaluation.source === 'weissnicht' ? evaluation.feedback
      : final ? `${verdictPhrase(evaluation.grade)} ${evaluation.percent} Prozent. ${evaluation.feedback || ''}`
        : `Mein Eindruck: etwa ${evaluation.percent} Prozent, also ${tentativePhrase(evaluation.grade)}`;
    await say(verdictText, gen);
    await say(`Die Antwort laut ELWIS: ${q.answer}`, gen);
    if (hint) await say(`Eselsbrücke: ${hint}`, gen);
  }

  // 4. Bewertung festlegen
  let grade = evaluation.grade;
  if (session.mode === 'auto') {
    if (!final) grade = await askSelfGrade(evaluation.grade, gen);
  } else {
    el.btnNext.hidden = false;
    const picked = await waitForUser(gen);
    if (['richtig', 'falsch'].includes(picked)) grade = picked;
  }

  // 5. Leitner aktualisieren
  const wasNew = getCard(state, q.id).box === 0;
  // Bei eigener Korrektur der Einschätzung zählt die Entscheidung, nicht der Schätzwert
  const percent = grade === evaluation.grade ? evaluation.percent : null;
  const { before, after } = recordAnswer(state, q.id, grade, Date.now(), percent);
  newAllowedToday();
  if (wasNew) state.daily.newCount++;
  state.daily.answered++;
  saveState();
  session.answered++;
  const boxText = boxChangeText(before, after);
  el.boxChange.textContent = `${boxText} · Sicherheit ${after.confidence} %`;
  if (session.mode === 'auto') await say(boxText, gen);
}

async function askSelfGrade(suggested, gen) {
  await say('Wie war deine Antwort? Sag richtig oder falsch – oder okay für meine Einschätzung.', gen);
  for (let i = 0; i < 2; i++) {
    const heard = await hear(gen, { silenceMs: 1200, maxMs: 12000 });
    const cmd = speech.parseCommand(heard);
    if (cmd === 'pause') { await say('Pause. Gute Fahrt!', gen); stopSession('Pausiert.'); throw new Cancelled(); }
    const g = speech.parseGrade(heard);
    if (g === 'ok' || (cmd === 'stille' && i === 1)) return suggested;
    if (g) { markGrade(g); return g; }
    if (i === 0) await say('Richtig oder falsch?', gen);
  }
  return suggested;
}

function markGrade(g) {
  for (const b of document.querySelectorAll('.grade')) b.classList.toggle('selected', b.dataset.grade === g);
}

function showResult(q, ev, hint, final) {
  el.result.hidden = false;
  el.verdict.className = `verdict v-${ev.grade}`;
  el.verdict.textContent = final ? verdictPhrase(ev.grade) : `Einschätzung: ${tentativePhrase(ev.grade)} (bitte bestätigen)`;
  const missing = ev.missing?.length && ev.grade !== 'richtig' ? `Fehlende Stichworte z. B.: ${ev.missing.slice(0, 6).join(', ')}` : '';
  el.feedback.textContent = ev.source === 'lokal' ? missing : ev.feedback;
  showScore(ev);
  el.hint.hidden = !hint;
  el.hint.querySelector('span').textContent = hint || '';
  el.officialBox.hidden = false;
  el.official.replaceChildren(
    ...q.answer.split('\n').map((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      return p;
    }),
    ...(q.answerImages || []).map((src) => {
      const img = document.createElement('img');
      img.src = src; img.alt = 'Lösungsskizze laut ELWIS'; img.className = 'answer-img';
      return img;
    }),
  );
  el.boxChange.textContent = '';
  markGrade(ev.grade);
}

/** Statusbalken für die Richtigkeit in Prozent, mit Markierung der 80-%-Grenze. */
function showScore(ev) {
  const pct = ev.percent ?? 0;
  el.scoreValue.textContent = `${pct} %`;
  el.scoreFill.style.width = `${pct}%`;
  el.scoreBar.dataset.pass = String(pct > PASS_PERCENT);
  el.scoreBar.setAttribute('aria-valuenow', String(pct));
  el.scoreSource.textContent = {
    openai: `Bewertung durch KI (OpenAI) · richtig ab mehr als ${PASS_PERCENT} %`,
    lokal: `Schätzung per Stichwortabgleich${ev.error ? ` – ${ev.error}` : ''} · richtig ab mehr als ${PASS_PERCENT} %`,
    weissnicht: 'Keine Antwort gegeben',
    leer: 'Keine Antwort erkannt',
  }[ev.source] || '';
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function verdictPhrase(g) {
  return {
    richtig: pick(['Richtig, sehr gut!', 'Stimmt genau!', 'Klasse, richtig!']),
    falsch: pick(['Das war leider nicht richtig.', 'Nicht ganz – das schauen wir uns an.']),
  }[g];
}
function tentativePhrase(g) {
  return { richtig: 'richtig.', falsch: 'eher nicht richtig.' }[g];
}
function boxChangeText(before, after) {
  if (!before.box) return `Neu einsortiert in Box ${after.box}.`;
  if (after.box > before.box) return `Aufgestiegen in Box ${after.box}.`;
  if (after.box < before.box) return `Zurück in Box ${after.box}.`;
  return `Bleibt in Box ${after.box}.`;
}

function progressSentence(detailed = false) {
  const stats = computeStats(catalog.questions, catalog.categories, state);
  const t = stats.total;
  let s = `Zwischenstand: ${session.answered} Fragen in dieser Sitzung. Gesamt hast du ${t.coverage} Prozent des Katalogs gesehen, Quote richtig ${t.correctRate ?? 0} Prozent.`;
  if (detailed) {
    const seen = stats.categories.filter((c) => c.seen);
    if (seen.length) {
      const weakest = [...seen].sort((a, b) => a.confidence - b.confidence)[0];
      s += ` ${seen.map((c) => `${c.name}: ${c.correctRate} Prozent richtig`).join('. ')}. Am meisten Übung braucht ${weakest.name}.`;
    }
  }
  return s;
}

// ---------- Statistik ----------
function renderStats() {
  if (!catalog) return;
  const stats = computeStats(catalog.questions, catalog.categories, state);
  const t = stats.total;
  $('#stats-total').innerHTML = `
    <div class="kpi"><span>${t.coverage} %</span><small>Katalog gesehen</small></div>
    <div class="kpi"><span>${t.correctRate ?? '–'}${t.correctRate != null ? ' %' : ''}</span><small>Quote richtig</small></div>
    <div class="kpi"><span>${t.confidence} %</span><small>Ø Sicherheit</small></div>
    <div class="kpi"><span>${t.mastered}/${t.total}</span><small>sicher (Box 4–5)</small></div>`;
  const row = (c, cls = '') => `<tr class="${cls}">
      <td>${esc(c.name)}</td><td>${c.total}</td><td>${c.seen}</td>
      <td>${bar(c.correctRate)}</td><td>${bar(c.confidence)}</td><td>${c.mastered}</td><td>${c.due}</td></tr>`;
  $('#stats-body').innerHTML = stats.categories.map((c) => row(c)).join('') + row(t, 'total');
  const labels = ['neu', 'Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5'];
  $('#stats-boxes').innerHTML = t.boxes.map((n, i) =>
    `<div class="box b${i}"><span>${n}</span><small>${labels[i]}</small></div>`).join('');
  const weak = catalog.questions
    .map((q) => ({ q, c: state.cards[q.id] }))
    .filter((x) => x.c && x.c.seen)
    .sort((a, b) => a.c.confidence - b.c.confidence || a.c.box - b.c.box)
    .slice(0, 10);
  $('#stats-weak').innerHTML = weak.length
    ? weak.map(({ q, c }) => `<li><strong>${esc(categoryName(q.category))} ${q.nr}</strong> – ${esc(q.question)} <em>(Box ${c.box}, ${c.confidence} %)</em></li>`).join('')
    : '<li class="muted">Noch keine Antworten.</li>';
}

function bar(pct) {
  if (pct == null) return '<span class="muted">–</span>';
  return `<div class="bar" title="${pct} %"><div style="width:${pct}%"></div><span>${pct} %</span></div>`;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderVersion() {
  const v = document.querySelector('#app-version');
  if (v) v.textContent = `Version ${APP_VERSION}`;
}

function renderToday(message) {
  if (!catalog) return;
  const qs = activeQuestions({ forVoice: false });
  const stats = computeStats(qs, [], state);
  const parts = [
    `${qs.length} Fragen ausgewählt`,
    `${stats.total.due} fällig`,
    `${newAllowedToday()} neue heute möglich`,
  ];
  el.today.textContent = (message ? message + ' · ' : '') + parts.join(' · ');
  $('#btn-drive').textContent = message?.startsWith('Pausiert') ? '🚗 Fortsetzen' : '🚗 Autofahrt starten';
}

// ---------- Einstellungen ----------
function renderSettings() {
  const cats = catalog?.categories?.length ? catalog.categories : CATEGORIES;
  const box = $('#cat-filter');
  box.innerHTML = cats.map((c) => {
    const n = catalog ? catalog.questions.filter((q) => q.category === c.id).length : 0;
    const checked = !settings.categories || settings.categories.includes(c.id);
    return `<label><span>${esc(c.name)} <span class="muted">(${n})</span></span><input type="checkbox" value="${c.id}" ${checked ? 'checked' : ''}></label>`;
  }).join('');
  $('#opt-audio-only').checked = settings.audioOnly;
  $('#opt-new').value = settings.newPerDay;
  $('#opt-report').value = settings.reportEvery;
  $('#opt-rate').value = settings.rate;
  $('#opt-rate-val').textContent = `${settings.rate.toFixed(2)}×`;
  $('#opt-silence').value = settings.silence;
  renderVoices();
  const info = catalog
    ? `${catalog.questions.length} Fragen · Quelle: ${catalog.source}${catalog.retrieved ? `, Stand ${catalog.retrieved}` : ''}${load(KEYS.catalog, null) ? ' (importiert)' : ''}`
    : 'Kein Katalog geladen.';
  $('#catalog-info').textContent = info;
}

function renderVoices() {
  const sel = $('#opt-voice');
  const voices = speech.germanVoices();
  sel.innerHTML = voices.length
    ? voices.map((v) => `<option ${v.name === settings.voice ? 'selected' : ''}>${esc(v.name)}</option>`).join('')
    : '<option value="">Standardstimme</option>';
  const v = speech.chooseVoice(settings.voice);
  if (v && !settings.voice) sel.value = v.name;
}

function bindSettings() {
  $('#cat-filter').addEventListener('change', () => {
    const all = [...document.querySelectorAll('#cat-filter input')];
    const on = all.filter((i) => i.checked).map((i) => i.value);
    settings.categories = on.length === all.length ? null : on;
    saveSettings(); renderToday();
  });
  const num = (id, key, parse = Number) => $(id).addEventListener('change', (e) => { settings[key] = parse(e.target.value); saveSettings(); renderToday(); });
  num('#opt-new', 'newPerDay');
  num('#opt-report', 'reportEvery');
  num('#opt-silence', 'silence');
  $('#opt-audio-only').addEventListener('change', (e) => { settings.audioOnly = e.target.checked; saveSettings(); });
  $('#opt-rate').addEventListener('input', (e) => {
    settings.rate = Number(e.target.value);
    speech.setRate(settings.rate);
    $('#opt-rate-val').textContent = `${settings.rate.toFixed(2)}×`;
    saveSettings();
  });
  $('#opt-voice').addEventListener('change', (e) => { settings.voice = e.target.value; speech.chooseVoice(settings.voice); saveSettings(); });
  $('#btn-test-voice').addEventListener('click', () => speech.speak('Steuerbord ist rechts, Backbord ist links. Gute Fahrt!'));
  $('#btn-save-ai').addEventListener('click', () => saveAiSettings());
  $('#btn-test-key').addEventListener('click', testOpenAI);
  window.speechSynthesis?.addEventListener?.('voiceschanged', renderVoices);

  $('#catalog-file').addEventListener('change', (e) => importCatalogFiles([...e.target.files]));
  $('#btn-catalog-reset').addEventListener('click', async () => {
    localStorage.removeItem(KEYS.catalog);
    await refreshCatalog();
  });

  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'sks-lerncoach', exported: new Date().toISOString(), state }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sks-lernstand-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#state-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const imported = data.state || data;
      if (!imported.cards) throw new Error('Keine Lernstand-Datei');
      if (!confirm(`Lernstand mit ${Object.keys(imported.cards).length} Karten importieren? Der aktuelle Stand wird ersetzt.`)) return;
      state = imported;
      saveState(); renderStats(); renderToday();
    } catch (err) { alert(`Import fehlgeschlagen: ${err.message}`); }
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Gesamten Lernstand löschen? Das kann nicht rückgängig gemacht werden.')) return;
    state = emptyState();
    saveState(); renderStats(); renderToday();
  });
}

/** Erklärt, warum die KI-Bewertung nicht ging (wird unter dem Balken bzw. im Verbindungstest angezeigt). */
function explainGradeError(e) {
  switch (e.code) {
    case 'limit': return e.message || 'Tageslimit für KI-Bewertungen erreicht.';
    case 'not_configured': return 'KI-Bewertung ist noch nicht eingerichtet (Admin: Einstellungen).';
    case 'unauthorized': return 'Anmeldung abgelaufen – bitte neu anmelden.';
    case 'email_not_confirmed': return 'E-Mail-Adresse noch nicht bestätigt.';
    case 'forbidden': return 'Nur für den Admin.';
    case 'openai_unreachable': return 'OpenAI ist gerade nicht erreichbar.';
    case 'openai_error':
      switch (e.status) {
        case 401: return 'OpenAI-Schlüssel ungültig oder gelöscht – Schlüssel auf platform.openai.com prüfen.';
        case 403: return 'Der OpenAI-Schlüssel hat keine Berechtigung für dieses Modell.';
        case 404: return 'Modell nicht gefunden oder für den Schlüssel nicht freigeschaltet – anderes Modell eintragen.';
        case 429: return 'Kein OpenAI-Guthaben oder Limit erreicht – unter Billing aufladen bzw. Limit prüfen.';
        case 400: return 'OpenAI hat die Anfrage abgelehnt – das Modell unterstützt sie evtl. nicht.';
        default: return 'OpenAI hat einen Fehler gemeldet.';
      }
    default:
      return /fetch|network|Failed/i.test(e.message || '') ? 'Keine Verbindung zum Server.' : (e.message || 'Unbekannter Fehler.');
  }
}

/** Admin: KI-Einstellungen vom Server laden und anzeigen. */
async function renderAiSettings() {
  const status = $('#key-status');
  try {
    const cfg = await auth.loadAiConfig();
    $('#opt-model').value = cfg.openai_model || '';
    $('#opt-limit').value = cfg.daily_limit;
    status.textContent = cfg.key_hint
      ? `Hinterlegt: ${cfg.key_hint} · zuletzt geändert ${new Date(cfg.updated_at).toLocaleString('de-DE')}. Feld leer lassen, um ihn zu behalten.`
      : 'Noch kein Schlüssel hinterlegt – bis dahin wird per Stichwortabgleich bewertet.';
  } catch (e) {
    status.textContent = `Einstellungen konnten nicht geladen werden: ${auth.explainAuthError(e)}`;
  }
}

async function saveAiSettings({ quiet = false } = {}) {
  const box = $('#key-test-result');
  const apiKey = $('#opt-key').value.trim();
  if (apiKey && !/^sk-/.test(apiKey)) {
    box.hidden = false;
    box.className = 'key-test fail';
    box.textContent = 'Das sieht nicht nach einem OpenAI-Schlüssel aus – er beginnt mit „sk-“.';
    return false;
  }
  try {
    await auth.saveAiConfig({
      apiKey,
      model: $('#opt-model').value.trim() || 'gpt-5-mini',
      dailyLimit: Math.max(0, Math.round(Number($('#opt-limit').value) || 0)),
    });
    $('#opt-key').value = '';
    await renderAiSettings();
    if (!quiet) {
      box.hidden = false;
      box.className = 'key-test ok';
      box.textContent = '✓ Gespeichert.';
    }
    return true;
  } catch (e) {
    box.hidden = false;
    box.className = 'key-test fail';
    box.textContent = `Speichern fehlgeschlagen: ${auth.explainAuthError(e)}`;
    return false;
  }
}

/** Admin: Testbewertung über die Server-Funktion (Frage NAV-1 mit der ELWIS-Antwort als Antwort). */
async function testOpenAI() {
  const box = $('#key-test-result');
  const btn = $('#btn-test-key');
  // Ungespeicherte Eingaben zuerst sichern, damit genau diese getestet werden
  if ($('#opt-key').value.trim() && !(await saveAiSettings({ quiet: true }))) return;
  const q = catalog?.questions?.find((x) => x.id === 'NAV-1') || { question: 'Was ist Wind?', answer: 'Bewegte Luft.' };
  btn.disabled = true;
  box.hidden = false;
  box.className = 'key-test';
  box.textContent = '⏳ Teste die KI-Bewertung über den Server …';
  const start = performance.now();
  try {
    const r = await auth.serverGrade({ question: q.question, officialAnswer: q.answer, userAnswer: q.answer, test: true });
    const secs = ((performance.now() - start) / 1000).toFixed(1).replace('.', ',');
    const plausible = r.grade === 'richtig';
    box.classList.add(plausible ? 'ok' : 'warn');
    box.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: '✓ Verbindung funktioniert' }),
      document.createElement('br'),
      `Modell ${r.model} · Antwortzeit ${secs} s`,
      document.createElement('br'),
      `Testbewertung der ELWIS-Musterantwort: ${r.percent} % (${r.grade})`,
      ...(plausible ? [] : [document.createElement('br'), 'Hinweis: Die Musterantwort sollte über 80 % erreichen – evtl. ein stärkeres Modell wählen.']),
    );
  } catch (e) {
    box.classList.add('fail');
    box.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: '✕ Test fehlgeschlagen' }),
      document.createElement('br'),
      explainGradeError(e),
      document.createElement('br'),
      Object.assign(document.createElement('small'), { textContent: `Details: ${e.message}` }),
    );
  } finally {
    btn.disabled = false;
  }
}

async function importCatalogFiles(files) {
  const log = $('#import-log');
  log.hidden = false;
  const lines = [];
  try {
    const json = files.find((f) => /\.json$/i.test(f.name));
    let result;
    if (json) {
      result = JSON.parse(await json.text());
      if (!result.questions?.length) throw new Error('Datei enthält keine Fragen');
      lines.push(`${json.name}: ${result.questions.length} Fragen`);
    } else {
      const pages = [];
      for (const f of files) {
        const doc = new DOMParser().parseFromString(await f.text(), 'text/html');
        const page = parseElwisPage(doc, { url: `https://www.elwis.de/${f.name}` });
        lines.push(`${f.name}: ${page.questions.length} Fragen${page.category ? ` → ${page.category.name}` : ''}`);
        if (page.questions.length) pages.push(page);
      }
      result = buildCatalog(pages);
      if (!result.questions.length) throw new Error('Keine Fragen erkannt');
      lines.push(...result.warnings.slice(0, 20).map((w) => `Hinweis: ${w}`));
    }
    save(KEYS.catalog, result);
    lines.push('✔ Katalog übernommen.');
    log.textContent = lines.join('\n');
    await refreshCatalog();
  } catch (e) {
    lines.push(`✘ ${e.message}`);
    log.textContent = lines.join('\n');
  }
}

// ---------- Ereignisse ----------
function bindLearn() {
  $('#btn-drive').addEventListener('click', () => startSession('auto'));
  $('#btn-manual').addEventListener('click', () => startSession('manual'));
  $('#btn-stop').addEventListener('click', () => stopSession('Pausiert.'));
  $('#btn-skip').addEventListener('click', () => {
    if (session.mode === 'auto') { const gen = ++session.gen; speech.stopSpeaking(); speech.stopListening(); loop(gen); } else resolveWaiter('skip');
  });
  $('#btn-repeat').addEventListener('click', () => {
    const q = session.current?.q;
    if (q) speech.speak(q.question);
  });
  el.form.addEventListener('submit', (e) => { e.preventDefault(); resolveWaiter(el.input.value); });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); resolveWaiter(el.input.value); }
  });
  $('#btn-dontknow').addEventListener('click', () => resolveWaiter('dontknow'));
  el.btnNext.addEventListener('click', () => resolveWaiter('weiter'));
  for (const b of document.querySelectorAll('.grade')) {
    b.addEventListener('click', () => {
      if (session.mode === 'manual') resolveWaiter(b.dataset.grade);
    });
  }
  $('#btn-mic').addEventListener('click', async () => {
    if (!speech.canListen) { alert('Spracherkennung wird hier nicht unterstützt.'); return; }
    try {
      setStatus('🎤 Ich höre zu …');
      const text = await speech.listen({ silenceMs: settings.silence * 1000, onPartial: (t) => { el.input.value = t; } });
      el.input.value = text;
    } catch (err) { alert(err.message); } finally { setStatus(''); }
  });
  document.addEventListener('keydown', (e) => {
    if (session.mode !== 'manual' || el.result.hidden || e.target === el.input) return;
    const map = { 1: 'richtig', 2: 'falsch', r: 'richtig', f: 'falsch', Enter: 'weiter', ' ': 'weiter' };
    if (map[e.key]) { e.preventDefault(); resolveWaiter(map[e.key]); }
  });
}

function showView(name) {
  // Einstellungen nur für den Admin (zusätzlich serverseitig per Row Level Security geschützt)
  if (name === 'einstellungen' && !auth.isAdmin(user)) name = 'lernen';
  for (const t of document.querySelectorAll('.tabs [role="tab"]')) t.setAttribute('aria-selected', String(t.dataset.view === name));
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${name}`;
  if (name === 'statistik') renderStats();
  if (name === 'einstellungen') { renderSettings(); renderAiSettings(); }
}

function bindTabs() {
  for (const tab of document.querySelectorAll('.tabs [role="tab"]')) tab.addEventListener('click', () => showView(tab.dataset.view));
}

function bindAccount() {
  const btn = $('#btn-account');
  const menu = $('#account-menu');
  const toggle = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(menu.hidden); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) toggle(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
  $('#btn-logout').addEventListener('click', async () => { toggle(false); await auth.signOut(); });
}

function onSignedIn(u) {
  user = u;
  state = loadUserState();
  const admin = auth.isAdmin(u);
  $('#app').hidden = false;
  $('#tab-settings').hidden = !admin;
  $('#account-initial').textContent = (u.email || '?')[0].toUpperCase();
  $('#account-email').textContent = u.email;
  $('#account-role').textContent = admin ? 'Administrator' : 'Lernende/r';
  showView('lernen');
  renderToday();
}

function onSignedOut() {
  if (session.mode) stopSession();
  user = null;
  state = emptyState();
  $('#app').hidden = true;
  $('#tab-settings').hidden = true;
}

async function refreshCatalog() {
  catalog = await loadCatalog();
  el.noCatalog.hidden = !!catalog;
  el.startPanel.hidden = !catalog;
  renderToday();
  if (auth.isAdmin(user)) renderSettings();
}

async function init() {
  await refreshCatalog();
  speech.setRate(settings.rate);
  speech.chooseVoice(settings.voice);
  const warn = [];
  if (!speech.canListen) warn.push('Spracherkennung ist in diesem Browser nicht verfügbar – der Autofahrt-Modus braucht Chrome (Android) oder Safari (iOS).');
  if (!speech.canSpeak) warn.push('Sprachausgabe ist nicht verfügbar.');
  el.voiceWarning.hidden = !warn.length;
  el.voiceWarning.textContent = warn.join(' ');
  await initAuth({ onSignedIn, onSignedOut });
}

renderVersion();
bindTabs();
bindAccount();
bindLearn();
bindSettings();
init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // Ersetzt ein neuer Service Worker einen alten, einmal neu laden – so ist sofort die neue Version aktiv.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded && !session.mode) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => reg.update()).catch(() => {});
}
