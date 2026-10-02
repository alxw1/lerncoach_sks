// Passwortrichtlinie nach aktuellen Empfehlungen (BSI IT-Grundschutz ORP.4, NIST SP 800-63B):
// ausreichende Länge, gemischte Zeichenarten, keine naheliegenden Bestandteile und
// kein Passwort aus bekannten Datenlecks.

export const MIN_LENGTH = 12;

// Häufigste Passwörter bzw. Bestandteile – ergänzt die Leck-Prüfung, wenn offline.
const COMMON = [
  'passwort', 'password', 'qwertz', 'qwerty', 'asdf', 'yxcv', 'hallo', 'letmein', 'welcome', 'willkommen',
  'admin', 'login', 'geheim', 'secret', 'iloveyou', 'ichliebedich', 'sommer', 'winter', 'fussball', 'football',
  'monkey', 'dragon', 'master', 'schatz', 'abc123', '123456', '654321', '111111', '000000', 'segeln', 'sks',
];

function hasSequence(pw) {
  const s = pw.toLowerCase();
  for (let i = 0; i + 3 < s.length; i++) {
    const a = s.charCodeAt(i);
    const up = [1, 2, 3].every((k) => s.charCodeAt(i + k) === a + k);
    const down = [1, 2, 3].every((k) => s.charCodeAt(i + k) === a - k);
    if (up || down) return true;
  }
  return /(.)\1{3,}/.test(s); // vier gleiche Zeichen hintereinander
}

/**
 * Prüft ein Passwort gegen die Richtlinie.
 * @returns {{checks: {id: string, label: string, ok: boolean}[], ok: boolean, score: number}}
 *   score 0–100 für den Balken; ok nur, wenn alle Kriterien erfüllt sind.
 */
export function evaluatePassword(pw, email = '') {
  pw = pw || '';
  const lower = pw.toLowerCase();
  const name = (email.split('@')[0] || '').toLowerCase();
  const nameParts = name.split(/[._\-+]/).filter((p) => p.length >= 3);
  const checks = [
    { id: 'length', label: `Mindestens ${MIN_LENGTH} Zeichen`, ok: pw.length >= MIN_LENGTH },
    { id: 'lower', label: 'Kleinbuchstabe (a–z)', ok: /[a-zäöüß]/.test(pw) },
    { id: 'upper', label: 'Großbuchstabe (A–Z)', ok: /[A-ZÄÖÜ]/.test(pw) },
    { id: 'digit', label: 'Ziffer (0–9)', ok: /\d/.test(pw) },
    { id: 'symbol', label: 'Sonderzeichen (z. B. ! ? # % &)', ok: /[^A-Za-z0-9äöüÄÖÜß\s]/.test(pw) },
    {
      id: 'personal',
      label: 'Enthält nicht deine E-Mail-Adresse oder Teile davon',
      ok: pw.length > 0 && !nameParts.some((p) => lower.includes(p)) && !(name && lower.includes(name)),
    },
    {
      id: 'common',
      label: 'Keine bekannten Muster (z. B. „Passwort“, „1234“, „qwertz“)',
      ok: pw.length > 0 && !COMMON.some((c) => lower.includes(c)) && !hasSequence(pw),
    },
  ];
  const passed = checks.filter((c) => c.ok).length;
  // Länge über das Minimum hinaus belohnen (bis 20 Zeichen), damit der Balken weiter wächst
  const lengthBonus = Math.min(1, Math.max(0, pw.length - MIN_LENGTH) / 8);
  const ok = checks.every((c) => c.ok);
  let score = Math.round((passed / checks.length) * 85 + (ok ? 15 * lengthBonus : 0));
  if (ok) score = Math.max(score, 86);
  if (!pw) score = 0;
  return { checks, ok, score };
}

async function sha1Hex(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Prüft anonym (k-Anonymität), ob das Passwort in bekannten Datenlecks vorkommt:
 * Nur die ersten 5 Zeichen des SHA-1-Hashes verlassen das Gerät.
 * @returns {Promise<number|null>} Anzahl Funde, 0 = nicht gefunden, null = Prüfung nicht möglich
 */
export async function breachCount(pw, fetchFn = fetch) {
  try {
    const hash = await sha1Hex(pw);
    // Ohne Zusatz-Header, damit keine CORS-Vorabanfrage nötig ist
    const res = await fetchFn(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    if (!res.ok) return null;
    const suffix = hash.slice(5);
    for (const line of (await res.text()).split('\n')) {
      const [s, n] = line.trim().split(':');
      if (s === suffix) return Number(n) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}
