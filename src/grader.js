// Bewertung einer gesprochenen Antwort: Richtigkeit in Prozent, ab PASS_PERCENT gilt sie als richtig.
// 1. Mit OpenAI-API-Schlüssel: Die KI vergleicht inhaltlich mit der ELWIS-Antwort.
// 2. Ohne Schlüssel oder offline: Stichwortabgleich mit der ELWIS-Antwort.

/** Mehr als 80 % Richtigkeit = richtig, sonst falsch. */
export const PASS_PERCENT = 80;
export const gradeFor = (percent) => (percent > PASS_PERCENT ? 'richtig' : 'falsch');

const STOPWORDS = new Set(`
aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes auch auf aus bei beim bin bis bist da dabei damit
dann das dass dem den denn der des die dies diese diesem diesen dieser dieses doch dort du durch ein eine einem einen einer eines einmal er es
etwa etwas euer für gegen gibt hat hatte hier ich ihr im in ins ist ja jede jedem jeden jeder jedes kann kein keine können man mehr mit muss
müssen nach nicht noch nur ob oder ohne sein seine sich sie sind so soll sollte sowie über um und uns unter vom von vor wann war was weil wenn
wer werden wie wird wo wurde zu zum zur zwischen sowie bzw ggf usw etc sehr wird werden worden kann können also beziehungsweise
`.trim().split(/\s+/).map(norm));

export function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9°,.\s-]/g, ' ')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBER_WORDS = {
  null: '0', eins: '1', ein: '1', eine: '1', einen: '1', zwei: '2', drei: '3', vier: '4', fuenf: '5', sechs: '6', sieben: '7', acht: '8',
  neun: '9', zehn: '10', elf: '11', zwoelf: '12', zwanzig: '20', dreissig: '30', hundert: '100',
};

export function tokens(s) {
  return norm(s)
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .map((t) => NUMBER_WORDS[t] || t)
    .filter((t) => t && !STOPWORDS.has(t) && (t.length >= 4 || /\d/.test(t)));
}

function stem(t) {
  return /\d/.test(t) ? t : t.slice(0, Math.max(4, Math.min(6, t.length - 1)));
}

/**
 * Anteil der Schlüsselwörter der Musterantwort, die in der Antwort vorkommen.
 * Komposita werden über Präfix-/Teilwort-Treffer berücksichtigt.
 */
export function keywordScore(userAnswer, officialAnswer) {
  const keys = [...new Set(tokens(officialAnswer))];
  if (!keys.length) return { score: 0, matched: [], missing: [] };
  const user = tokens(userAnswer);
  const userJoined = user.join(' ');
  const matched = [];
  const missing = [];
  for (const k of keys) {
    const s = stem(k);
    const hit = user.some((u) => u.startsWith(s) || stem(u) === s || (u.length >= 6 && k.includes(u))) || (s.length >= 5 && userJoined.includes(s));
    (hit ? matched : missing).push(k);
  }
  return { score: matched.length / keys.length, matched, missing };
}

export function localGrade(userAnswer, officialAnswer) {
  const { score, matched, missing } = keywordScore(userAnswer, officialAnswer);
  const percent = Math.round(score * 100);
  return { grade: gradeFor(percent), percent, matched, missing, source: 'lokal' };
}

const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    richtigkeit: { type: 'integer', description: 'Inhaltliche Übereinstimmung mit der ELWIS-Musterantwort in Prozent, 0 bis 100.' },
    rueckmeldung: { type: 'string', description: 'Ein bis zwei kurze Sätze: was stimmte, was fehlte. Vorlesbar, ohne Aufzählungszeichen.' },
    lernhilfe: { type: 'string', description: 'Kurze Eselsbrücke oder Merkhilfe (max. 2 Sätze); leerer Text, wenn keine nötig ist.' },
  },
  required: ['richtigkeit', 'rueckmeldung', 'lernhilfe'],
  additionalProperties: false,
};

const SYSTEM = `Du bist Prüfer und Lerncoach für den deutschen Sportküstenschifferschein (SKS).
Du bewertest eine mündliche Antwort, die per Spracherkennung transkribiert wurde (Tippfehler, fehlende Satzzeichen und falsch erkannte Fachbegriffe sind möglich – bewerte den Inhalt wohlwollend, aber fachlich streng).
Maßstab ist ausschließlich die offizielle ELWIS-Musterantwort. Wie in der Prüfung zählt, in welchem Umfang die Antwort mit dem sachlichen Inhalt, der Vollständigkeit und der Fachterminologie der Musterantwort übereinstimmt; wörtliche Übereinstimmung ist nicht nötig.
Gib die Richtigkeit in Prozent an (0 = nichts Zutreffendes, 100 = alle wesentlichen Inhalte korrekt). Fehlende Teile einer mehrteiligen Musterantwort senken die Prozentzahl anteilig, sachliche Fehler deutlich.
Die Rückmeldung wird während einer Autofahrt vorgelesen: kurz, klar, motivierend, keine Listen, keine Sonderzeichen.
Die Lernhilfe ist eine Eselsbrücke oder ein Merksatz, der beim Behalten der Musterantwort hilft. Erfinde keine Prüfungsinhalte, die über die Musterantwort hinausgehen.`;

export const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';

/**
 * Bewertung über die OpenAI Chat Completions API mit strukturierter JSON-Ausgabe.
 * @param {{apiKey: string, model: string}} settings
 */
export async function openaiGrade({ question, officialAnswer, userAnswer, settings, signal }) {
  const model = settings.model || DEFAULT_OPENAI_MODEL;
  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Frage: ${question}\n\nELWIS-Musterantwort:\n${officialAnswer}\n\nAntwort des Prüflings (transkribiert):\n${userAnswer || '(keine Antwort)'}`,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'bewertung', strict: true, schema: GRADE_SCHEMA },
    },
  };
  // Reasoning-Modelle (gpt-5…, o…): kurze Denkzeit, damit im Auto keine lange Pause entsteht
  if (/^(gpt-5|o\d)/.test(model)) body.reasoning_effort = 'low';

  const timeout = AbortSignal.timeout(30_000);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch { /* kein JSON */ }
    const err = new Error(`OpenAI ${res.status}${detail ? `: ${detail}` : ''}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  if (!msg || msg.refusal) throw new Error('OpenAI hat die Bewertung abgelehnt');
  const out = JSON.parse(msg.content);
  const percent = Math.max(0, Math.min(100, Math.round(Number(out.richtigkeit))));
  if (!Number.isFinite(percent)) throw new Error('Ungültige Antwort von OpenAI');
  return {
    grade: gradeFor(percent),
    percent,
    feedback: out.rueckmeldung,
    hint: out.lernhilfe || null,
    source: 'openai',
    model: data.model || model,
  };
}

/** Verständliche Erklärung für Fehler beim OpenAI-Aufruf (für den Verbindungstest). */
export function explainOpenAIError(e) {
  if (e.name === 'TimeoutError') return 'Zeitüberschreitung – OpenAI hat nicht innerhalb von 30 Sekunden geantwortet.';
  if (e instanceof TypeError) return 'Keine Verbindung zu api.openai.com – Internetverbindung prüfen.';
  switch (e.status) {
    case 401: return 'API-Schlüssel ungültig oder gelöscht – Schlüssel auf platform.openai.com prüfen.';
    case 403: return 'Kein Zugriff – Schlüssel oder Projekt hat keine Berechtigung für dieses Modell.';
    case 404: return 'Modell nicht gefunden oder für diesen Schlüssel nicht freigeschaltet – anderes Modell eintragen.';
    case 429: return 'Kein Guthaben oder Limit erreicht – unter Billing Guthaben aufladen bzw. Limit prüfen.';
    case 400: return 'Anfrage abgelehnt – das Modell unterstützt diese Art der Anfrage evtl. nicht.';
    default: return e.status >= 500 ? 'OpenAI hat gerade ein Problem – später erneut versuchen.' : 'Unbekannter Fehler.';
  }
}
