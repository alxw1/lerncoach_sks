import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePassword, breachCount } from '../src/password.js';

test('Passwortrichtlinie: alle Kriterien nötig für Grün', () => {
  const strong = evaluatePassword('Kompass-Rose!42Nord', 'alex@example.com');
  assert.equal(strong.ok, true);
  assert.ok(strong.score >= 86);
  const short = evaluatePassword('Ab1!xyz', 'alex@example.com');
  assert.equal(short.ok, false);
  assert.equal(short.checks.find((c) => c.id === 'length').ok, false);
  assert.equal(evaluatePassword('', '').score, 0);
});

test('Passwortrichtlinie: keine persönlichen Daten, keine Muster', () => {
  const personal = evaluatePassword('Alexander!2026Segel', 'alexander@example.com');
  assert.equal(personal.checks.find((c) => c.id === 'personal').ok, false);
  assert.equal(evaluatePassword('Passwort!2026Kurs', 'x@y.de').checks.find((c) => c.id === 'common').ok, false);
  assert.equal(evaluatePassword('Abcd!9876Zugvogel', 'x@y.de').checks.find((c) => c.id === 'common').ok, false); // Folge abcd
  assert.equal(evaluatePassword('Kurs!!!!7Anker', 'x@y.de').checks.find((c) => c.id === 'common').ok, false); // !!!!
});

test('Leck-Prüfung sendet nur die ersten 5 Hash-Zeichen', async () => {
  // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  let url = '';
  const fake = async (u) => { url = u; return new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:9659365\r\nABCDEF:0'); };
  assert.equal(await breachCount('password', fake), 9659365);
  assert.equal(url, 'https://api.pwnedpasswords.com/range/5BAA6');
  assert.equal(await breachCount('anders', async () => new Response('ABC:1')), 0);
  assert.equal(await breachCount('x', async () => { throw new Error('offline'); }), null);
});
