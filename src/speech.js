// Sprachausgabe (Web Speech Synthesis) und Spracherkennung (Web Speech Recognition).

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export const canSpeak = !!synth;
export const canListen = !!Recognition;

let voice = null;
let rate = 1.0;

export function setRate(r) { rate = r; }

export function germanVoices() {
  if (!synth) return [];
  return synth.getVoices().filter((v) => /^de(-|_|$)/i.test(v.lang));
}

export function chooseVoice(name) {
  const voices = germanVoices();
  voice = voices.find((v) => v.name === name)
    || voices.find((v) => /de-DE/i.test(v.lang) && /(google|premium|enhanced|anna|petra|markus|helena)/i.test(v.name))
    || voices[0]
    || null;
  return voice;
}

if (synth) synth.addEventListener?.('voiceschanged', () => { if (!voice) chooseVoice(); });

// Lange Texte in Sätze teilen: Chrome bricht Äußerungen über ~15 s sonst ab.
function chunks(text) {
  const parts = text
    .replace(/^\s*–\s*/gm, '')
    .replace(/\s+–\s+/g, ', ')
    .replace(/\n+/g, '. ')
    .split(/(?<=[.!?;:])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (out.length && (out[out.length - 1] + ' ' + p).length < 180) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
}

let speakToken = 0;

/** Liest Text vor. Resolved, wenn fertig oder abgebrochen. */
export function speak(text) {
  if (!synth || !text) return Promise.resolve();
  const token = ++speakToken;
  synth.cancel();
  return chunks(sayable(text)).reduce((p, part) => p.then(() => new Promise((resolve) => {
    if (token !== speakToken) return resolve();
    const u = new SpeechSynthesisUtterance(part);
    u.lang = 'de-DE';
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = resolve;
    u.onerror = resolve;
    synth.speak(u);
  })), Promise.resolve());
}

export function stopSpeaking() {
  speakToken++;
  synth?.cancel();
}

/** Abkürzungen ausschreiben, damit sie sinnvoll vorgelesen werden. */
export function sayable(text) {
  return text
    .replace(/\bz\.\s?B\./g, 'zum Beispiel')
    .replace(/\bu\.\s?a\./g, 'unter anderem')
    .replace(/\bd\.\s?h\./g, 'das heißt')
    .replace(/\bbzw\./g, 'beziehungsweise')
    .replace(/\bggf\./g, 'gegebenenfalls')
    .replace(/\bca\./g, 'circa')
    .replace(/\bsm\b/g, 'Seemeilen')
    .replace(/\bkn\b/g, 'Knoten')
    .replace(/\bhPa\b/g, 'Hektopascal')
    .replace(/\bKVR\b/g, 'K V R')
    .replace(/\bSeeSchStrO\b/g, 'Seeschifffahrtsstraßen-Ordnung')
    .replace(/(\d)\s?°/g, '$1 Grad')
    .replace(/\bNr\.\s?/g, 'Nummer ')
    .replace(/\bkm\b/g, 'Kilometer')
    .replace(/\bm\b(?=[\s.,;])/g, 'Meter');
}

let activeRecognition = null;

/**
 * Hört zu, bis nach dem Sprechen eine Pause entsteht.
 * @returns {Promise<string>} Transkript ('' bei Stille)
 */
export function listen({ silenceMs = 2200, maxMs = 45000, onPartial } = {}) {
  if (!Recognition) return Promise.reject(new Error('Spracherkennung wird von diesem Browser nicht unterstützt'));
  stopListening();
  return new Promise((resolve, reject) => {
    const rec = new Recognition();
    activeRecognition = rec;
    rec.lang = 'de-DE';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = '';
    let interim = '';
    let silenceTimer = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(silenceTimer);
      clearTimeout(maxTimer);
      try { rec.stop(); } catch { /* schon beendet */ }
      if (activeRecognition === rec) activeRecognition = null;
      resolve((finalText + ' ' + interim).trim());
    };
    const armSilence = (ms) => { clearTimeout(silenceTimer); silenceTimer = setTimeout(finish, ms); };
    const maxTimer = setTimeout(finish, maxMs);
    rec.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += ' ' + r[0].transcript;
        else interim += r[0].transcript;
      }
      onPartial?.((finalText + ' ' + interim).trim());
      armSilence(silenceMs);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return finish();
      done = true;
      clearTimeout(silenceTimer);
      clearTimeout(maxTimer);
      reject(new Error(e.error === 'not-allowed' ? 'Mikrofon-Zugriff verweigert' : `Spracherkennung: ${e.error}`));
    };
    rec.onend = finish;
    // Wer gar nichts sagt, bekommt etwas länger Zeit als nach einer Sprechpause.
    armSilence(Math.max(silenceMs * 4, 9000));
    rec.start();
  });
}

export function stopListening() {
  if (activeRecognition) {
    try { activeRecognition.abort(); } catch { /* ignorieren */ }
    activeRecognition = null;
  }
}

/** Sprachbefehle erkennen. Gibt null zurück, wenn es eine inhaltliche Antwort ist. */
export function parseCommand(text) {
  const t = (text || '').toLowerCase().trim().replace(/[.!?]/g, '');
  if (!t) return 'stille';
  const is = (...words) => words.some((w) => t === w || t.startsWith(w + ' ') || t.endsWith(' ' + w));
  if (/^(stopp?|stop|pause|ende|beenden|aufhören|schluss)$/.test(t)) return 'pause';
  if (/^(nochmal|noch mal|wiederholen|wiederhole|wie bitte|bitte wiederholen|frage wiederholen)$/.test(t)) return 'wiederholen';
  if (/^(überspringen|skip|nächste frage|weiter)$/.test(t)) return 'ueberspringen';
  if (/^(statistik|stand|fortschritt|wie stehe ich)$/.test(t)) return 'statistik';
  if (is('weiß nicht', 'weiß ich nicht', 'keine ahnung', 'keine idee', 'passe', 'ich passe', 'auflösung', 'lösung')) return 'weissnicht';
  return null;
}

/** Selbsteinschätzung per Sprache. */
export function parseGrade(text) {
  const t = (text || '').toLowerCase();
  if (/\b(teilweise|halb|teils|so halb|fast|ungefähr)\b/.test(t)) return 'teilweise';
  if (/\b(falsch|nein|nicht gewusst|leider nicht|daneben)\b/.test(t)) return 'falsch';
  if (/\b(okay|ok|einverstanden|passt)\b/.test(t)) return 'ok';
  if (/\b(richtig|ja|stimmt|korrekt|gewusst|genau)\b/.test(t)) return 'richtig';
  return null;
}
