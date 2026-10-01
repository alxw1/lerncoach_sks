// Bewertung einer gesprochenen Antwort.
// 1. Lokal: Schlüsselwort-Abgleich mit der ELWIS-Antwort (offline, sofort).
// 2. Optional: Claude bewertet inhaltlich und liefert eine Eselsbrücke.

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
  const grade = score >= 0.55 ? 'richtig' : score >= 0.2 ? 'teilweise' : 'falsch';
  return { grade, score, matched, missing, source: 'lokal' };
}

const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    bewertung: { type: 'string', enum: ['richtig', 'teilweise', 'falsch'] },
    rueckmeldung: { type: 'string', description: 'Ein bis zwei kurze Sätze: was stimmte, was fehlte. Vorlesbar, ohne Aufzählungszeichen.' },
    lernhilfe: { type: 'string', description: 'Kurze Eselsbrücke oder Merkhilfe (max. 2 Sätze), leer wenn richtig und keine nötig.' },
  },
  required: ['bewertung', 'rueckmeldung', 'lernhilfe'],
  additionalProperties: false,
};

const SYSTEM = `Du bist Prüfer und Lerncoach für den deutschen Sportküstenschifferschein (SKS).
Du bewertest eine mündliche Antwort, die per Spracherkennung transkribiert wurde (Tippfehler, fehlende Satzzeichen und falsch erkannte Fachbegriffe sind möglich – bewerte den Inhalt wohlwollend, aber fachlich streng).
Maßstab ist ausschließlich die offizielle ELWIS-Musterantwort. Bewertung:
- "richtig": alle wesentlichen Inhalte der Musterantwort sind genannt (andere Formulierung ist ok).
- "teilweise": ein Teil der wesentlichen Inhalte fehlt oder ist ungenau.
- "falsch": wesentliche Inhalte fehlen oder sind falsch.
Die Rückmeldung wird während einer Autofahrt vorgelesen: kurz, klar, motivierend, keine Listen, keine Sonderzeichen.
Die Lernhilfe ist eine Eselsbrücke oder ein Merksatz, der beim Behalten der Musterantwort hilft. Erfinde keine neuen Prüfungsinhalte, die über die Musterantwort hinausgehen.`;

let sdkPromise = null;
function loadSdk() {
  // Das SDK wird nur geladen, wenn ein API-Schlüssel hinterlegt ist.
  sdkPromise ||= import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm');
  return sdkPromise;
}

/**
 * @param {{apiKey: string, model: string}} settings
 */
export async function claudeGrade({ question, officialAnswer, userAnswer, settings, signal }) {
  const { default: Anthropic } = await loadSdk();
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 30_000 });
  const response = await client.beta.messages.create({
    model: settings.model || 'claude-opus-5-5',
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: {
      effort: 'low', // kurze Wartezeit im Auto ist wichtiger als Tiefe
      format: { type: 'json_schema', schema: GRADE_SCHEMA },
    },
    messages: [{
      role: 'user',
      content: `Frage: ${question}\n\nELWIS-Musterantwort:\n${officialAnswer}\n\nAntwort des Prüflings (transkribiert):\n${userAnswer || '(keine Antwort)'}`,
    }],
  }, { signal });

  if (response.stop_reason === 'refusal') throw new Error('Claude hat die Bewertung abgelehnt');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const data = JSON.parse(text);
  return {
    grade: data.bewertung,
    feedback: data.rueckmeldung,
    hint: data.lernhilfe,
    source: 'claude',
  };
}
