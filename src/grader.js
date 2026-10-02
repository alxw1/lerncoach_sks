// Bewertung einer gesprochenen Antwort: Richtigkeit in Prozent, mehr als PASS_PERCENT gilt als richtig.
// Die KI-Bewertung läuft auf dem Server (supabase/functions/grade); hier liegt der lokale
// Stichwortabgleich für offline bzw. wenn die KI nicht verfügbar ist.

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
