import { emptyState, getCard, recordAnswer, pickNext, computeStats } from './leitner.js';
import { localGrade, claudeGrade } from './grader.js';
import { findHint } from './hints.js';
import { parseElwisPage, buildCatalog, CATEGORIES } from './elwis-parser.js';
import * as speech from './speech.js';

// ---------- Speicher ----------
const KEYS = { state: 'sks.state', settings: 'sks.settings', catalog: 'sks.catalog' };
const DEFAULT_SETTINGS = {
  categories: null, // null = alle
  audioOnly: true,
  newPerDay: 15,
  reportEvery: 10,
  voice: '',
  rate: 1.0,
  silence: 2.2,
  apiKey: '',
  model: 'claude-opus-5-5',
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

let state = load(KEYS.state, null) || emptyState();
let settings = { ...DEFAULT_SETTINGS, ...load(KEYS.settings, {}) };
let catalog = null;

const saveState = () => save(KEYS.state, state);
const saveSettings = () => save(KEYS.settings, settings);

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const el = {
  card: $('#card'), startPanel: $('#start-panel'), noCatalog: $('#no-catalog'), today: $('#today'),
  voiceWarning: $('#voice-warning'),
  qCat: $('#q-cat'), qNr: $('#q-nr'), qBox: $('#q-box'), qConf: $('#q-conf'), qReason: $('#q-reason'),
  qText: $('#q-text'), qImages: $('#q-images'),
  status: $('#status'), transcript: $('#transcript'), form: $('#answer-form'), input: $('#answer-input'),
  answerArea: $('#answer-area'), result: $('#result'), verdict: $('#verdict'), feedback: $('#feedback'),
  hint: $('#hint'), official: $('#official-answer'), boxChange: $('#box-change'),
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
    && !(forVoice && settings.audioOnly && q.images?.length));
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
  el.answerArea.hidden = session.mode !== 'auto';
  el.form.hidden = true;
  let evaluation;
  if (dontKnow) {
    evaluation = { grade: 'falsch', feedback: 'Kein Problem – genau dafür üben wir.', source: 'weissnicht' };
  } else if (settings.apiKey) {
    setStatus('⏳ Claude bewertet …');
    try {
      evaluation = await claudeGrade({ question: q.question, officialAnswer: q.answer, userAnswer, settings });
    } catch (e) {
      console.warn('Claude-Bewertung fehlgeschlagen, nutze Stichwortabgleich', e);
      evaluation = localGrade(userAnswer, q.answer);
    }
    guard(gen);
    setStatus('');
  } else {
    evaluation = localGrade(userAnswer, q.answer);
  }
  if (!userAnswer.trim() && !dontKnow) evaluation = { grade: 'falsch', feedback: 'Keine Antwort erkannt.', source: 'leer' };

  const hint = evaluation.grade !== 'richtig' ? (evaluation.hint || findHint(q.question, q.answer)) : (evaluation.hint || null);
  const final = evaluation.source === 'claude' || evaluation.source === 'weissnicht' || evaluation.source === 'leer';
  showResult(q, evaluation, hint, final);

  // 3. Rückmeldung, Lernhilfe, ELWIS-Antwort
  if (session.mode === 'auto') {
    const verdictText = evaluation.source === 'weissnicht' ? evaluation.feedback
      : final ? `${verdictPhrase(evaluation.grade)} ${evaluation.feedback || ''}`
        : `Mein Eindruck: ${tentativePhrase(evaluation.grade)}`;
    await say(verdictText, gen);
    if (hint) await say(`Eselsbrücke: ${hint}`, gen);
    await say(`Die Antwort laut ELWIS: ${q.answer}`, gen);
  }

  // 4. Bewertung festlegen
  let grade = evaluation.grade;
  if (session.mode === 'auto') {
    if (!final) grade = await askSelfGrade(evaluation.grade, gen);
  } else {
    el.btnNext.hidden = false;
    const picked = await waitForUser(gen);
    if (['richtig', 'teilweise', 'falsch'].includes(picked)) grade = picked;
  }

  // 5. Leitner aktualisieren
  const wasNew = getCard(state, q.id).box === 0;
  const { before, after } = recordAnswer(state, q.id, grade);
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
  await say('Wie war deine Antwort? Sag richtig, teilweise oder falsch – oder okay für meine Einschätzung.', gen);
  for (let i = 0; i < 2; i++) {
    const heard = await hear(gen, { silenceMs: 1200, maxMs: 12000 });
    const cmd = speech.parseCommand(heard);
    if (cmd === 'pause') { await say('Pause. Gute Fahrt!', gen); stopSession('Pausiert.'); throw new Cancelled(); }
    const g = speech.parseGrade(heard);
    if (g === 'ok' || (cmd === 'stille' && i === 1)) return suggested;
    if (g) { markGrade(g); return g; }
    if (i === 0) await say('Richtig, teilweise oder falsch?', gen);
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
  el.feedback.textContent = ev.source === 'claude' || ev.source === 'leer' || ev.source === 'weissnicht' ? ev.feedback : missing;
  el.hint.hidden = !hint;
  el.hint.querySelector('span').textContent = hint || '';
  el.official.replaceChildren(...q.answer.split('\n').map((line) => {
    const p = document.createElement('p');
    p.textContent = line;
    return p;
  }));
  el.boxChange.textContent = '';
  markGrade(ev.grade);
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function verdictPhrase(g) {
  return {
    richtig: pick(['Richtig, sehr gut!', 'Stimmt genau!', 'Klasse, richtig!']),
    teilweise: pick(['Teilweise richtig.', 'Fast – da fehlt noch etwas.']),
    falsch: pick(['Das war leider nicht richtig.', 'Nicht ganz – das schauen wir uns an.']),
  }[g];
}
function tentativePhrase(g) {
  return { richtig: 'richtig.', teilweise: 'teilweise richtig.', falsch: 'eher nicht richtig.' }[g];
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
    return `<label class="check"><input type="checkbox" value="${c.id}" ${checked ? 'checked' : ''}> ${esc(c.name)} <span class="muted">(${n})</span></label>`;
  }).join('');
  $('#opt-audio-only').checked = settings.audioOnly;
  $('#opt-new').value = settings.newPerDay;
  $('#opt-report').value = settings.reportEvery;
  $('#opt-rate').value = settings.rate;
  $('#opt-rate-val').textContent = `${settings.rate.toFixed(2)}×`;
  $('#opt-silence').value = settings.silence;
  $('#opt-key').value = settings.apiKey;
  $('#opt-model').value = settings.model;
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
  $('#opt-key').addEventListener('change', (e) => { settings.apiKey = e.target.value.trim(); saveSettings(); });
  $('#opt-model').addEventListener('change', (e) => { settings.model = e.target.value.trim() || DEFAULT_SETTINGS.model; saveSettings(); });
  window.speechSynthesis?.addEventListener?.('voiceschanged', renderVoices);

  $('#catalog-file').addEventListener('change', (e) => importCatalogFiles([...e.target.files]));
  $('#btn-catalog-reset').addEventListener('click', async () => {
    localStorage.removeItem(KEYS.catalog);
    await init();
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
    await init();
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
    const map = { 1: 'richtig', 2: 'teilweise', 3: 'falsch', r: 'richtig', t: 'teilweise', f: 'falsch', Enter: 'weiter', ' ': 'weiter' };
    if (map[e.key]) { e.preventDefault(); resolveWaiter(map[e.key]); }
  });
}

function bindTabs() {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('[role="tab"]')) t.setAttribute('aria-selected', String(t === tab));
      for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${tab.dataset.view}`;
      if (tab.dataset.view === 'statistik') renderStats();
      if (tab.dataset.view === 'einstellungen') renderSettings();
    });
  }
}

async function init() {
  catalog = await loadCatalog();
  speech.setRate(settings.rate);
  speech.chooseVoice(settings.voice);
  el.noCatalog.hidden = !!catalog;
  el.startPanel.hidden = !catalog;
  const warn = [];
  if (!speech.canListen) warn.push('Spracherkennung ist in diesem Browser nicht verfügbar – der Autofahrt-Modus braucht Chrome (Android) oder Safari (iOS).');
  if (!speech.canSpeak) warn.push('Sprachausgabe ist nicht verfügbar.');
  el.voiceWarning.hidden = !warn.length;
  el.voiceWarning.textContent = warn.join(' ');
  renderToday();
  renderSettings();
}

bindTabs();
bindLearn();
bindSettings();
init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
