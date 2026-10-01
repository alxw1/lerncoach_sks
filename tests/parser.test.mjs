import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { parseElwisPage, findCatalogLinks, buildCatalog, categoryFromTitle } from '../src/elwis-parser.js';

// Platzhalter-Inhalte – keine echten Katalogfragen.
const PAGE_A = `<!doctype html><html><head><title>Navigation</title></head><body>
<header><nav><a href="/x">Menü 1. Punkt</a></nav></header>
<div id="content"><h1>Navigation</h1>
<p>Stand: 2024</p>
<p>1. Testfrage eins?</p><p>Antwort eins.</p>
<p>2. Testfrage zwei?</p><ol class="elwisOL-lowerLiteral"><li>Teil A</li><li>Teil B</li></ol>
<p><strong>3.</strong> Testfrage drei mit Bild?</p><p><img src="/SharedDocs/Bilder/bild3.png" alt=""></p><p>Antwort drei.</p>
<p>4. Testfrage vier?</p><p>Antwort vier, Zeile 1.</p><p>Zeile 2 mit 5. Nummer im Text.</p>
<p>5. Testfrage fünf?</p><p>Antwort fünf.</p>
</div><footer>1. Impressum</footer></body></html>`;

const PAGE_B = `<html><body><main><h1>Seemannschaft II (Antriebsmaschine)</h1>
<ol><li><p>Frage A?</p><p>Antwort A.</p></li><li><p>Frage B?</p><p>Antwort B.</p></li><li><p>Frage C?</p><p>Antwort C.</p></li>
<li><p>Frage D?</p><p>Antwort D.</p></li><li><p>Frage E?</p><p>Antwort E.</p></li></ol></main></body></html>`;

const doc = (html) => parseHTML(html).document;

test('Gebiet aus Seitentitel', () => {
  assert.equal(categoryFromTitle('Seemannschaft I (Antriebsmaschine und unter Segel)').id, 'seemannschaft1');
  assert.equal(categoryFromTitle('Seemannschaft II').id, 'seemannschaft2');
  assert.equal(categoryFromTitle('Schifffahrtsrecht').id, 'recht');
  assert.equal(categoryFromTitle('Wetterkunde').id, 'wetter');
});

test('Absatz-Layout: Fragen, Antworten, Listen und Bilder', () => {
  const r = parseElwisPage(doc(PAGE_A), { url: 'https://www.elwis.de/DE/a.html' });
  assert.equal(r.category.id, 'navigation');
  assert.equal(r.questions.length, 5);
  const [q1, q2, q3, q4] = r.questions;
  assert.deepEqual([q1.id, q1.question, q1.answer], ['NAV-1', 'Testfrage eins?', 'Antwort eins.']);
  assert.equal(q2.answer, '– Teil A\n– Teil B');
  assert.equal(q3.question, 'Testfrage drei mit Bild?');
  assert.deepEqual(q3.images, ['https://www.elwis.de/SharedDocs/Bilder/bild3.png']);
  assert.equal(q4.answer, 'Antwort vier, Zeile 1.\nZeile 2 mit 5. Nummer im Text.');
  assert.deepEqual(r.warnings, []);
});

test('Listen-Layout als Rückfallstrategie', () => {
  const r = parseElwisPage(doc(PAGE_B));
  assert.equal(r.category.id, 'seemannschaft2');
  assert.equal(r.questions.length, 5);
  assert.equal(r.questions[4].id, 'SM2-5');
  assert.equal(r.questions[4].answer, 'Antwort E.');
});

test('Links zu Teilkatalogen und Katalogaufbau', () => {
  const base = 'https://www.elwis.de/DE/Sportschifffahrt/Sportbootfuehrerscheine/Fragenkatalog-SKS/Fragenkatalog-SKS-node.html';
  const index = doc(`<body><a href="Navigation/Navigation-node.html">Navigation</a>
    <a href="/DE/Sportschifffahrt/Sportbootfuehrerscheine/Fragenkatalog-SKS/Wetterkunde/Wetterkunde-node.html#x">Wetter</a>
    <a href="Fragenkatalog-SKS-node.html">Übersicht</a><a href="/DE/Impressum.html">Impressum</a></body>`);
  const links = findCatalogLinks(index, base);
  assert.equal(links.length, 2);
  assert.ok(links[1].url.endsWith('Wetterkunde-node.html'));

  const cat = buildCatalog([parseElwisPage(doc(PAGE_B)), parseElwisPage(doc(PAGE_A))]);
  assert.deepEqual(cat.categories.map((c) => c.id), ['navigation', 'seemannschaft2']);
  assert.equal(cat.questions[0].id, 'NAV-1');
  assert.equal(cat.questions.length, 10);
});

test('Katalog data/fragen.json ist vollständig', async () => {
  const { readFile } = await import('node:fs/promises');
  const catalog = JSON.parse(await readFile(new URL('../data/fragen.json', import.meta.url), 'utf8'));
  const expected = { navigation: 118, recht: 110, wetter: 101, seemannschaft1: 163, seemannschaft2: 146 };
  for (const [cat, n] of Object.entries(expected)) {
    const nrs = catalog.questions.filter((q) => q.category === cat).map((q) => q.nr);
    assert.deepEqual(nrs, Array.from({ length: n }, (_, i) => i + 1), cat);
  }
  for (const q of catalog.questions) {
    assert.ok(q.question.length > 5, `${q.id} ohne Frage`);
    assert.ok(q.answer.length > 1, `${q.id} ohne Antwort`);
  }
});
