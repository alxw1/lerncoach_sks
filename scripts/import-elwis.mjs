#!/usr/bin/env node
// Erzeugt data/fragen.json aus dem offiziellen ELWIS-Fragenkatalog SKS.
//
//   npm run import:elwis                     # lädt live von elwis.de
//   npm run import:elwis -- --from-dir DIR   # nutzt gespeicherte HTML-Seiten
//
// Hinter einem Proxy: NODE_USE_ENV_PROXY=1 npm run import:elwis

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { parseElwisPage, findCatalogLinks, buildCatalog } from '../src/elwis-parser.js';

const INDEX_URL = 'https://www.elwis.de/DE/Sportschifffahrt/Sportbootfuehrerscheine/Fragenkatalog-SKS/Fragenkatalog-SKS-node.html';
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'data', 'fragen.json');

const args = process.argv.slice(2);
const fromDir = args.includes('--from-dir') ? args[args.indexOf('--from-dir') + 1] : null;
const saveDir = args.includes('--save-html') ? args[args.indexOf('--save-html') + 1] : null;

const toDoc = (html) => parseHTML(html).document;

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SKS-Lerncoach (privates Lernprojekt)' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} für ${url}`);
  return res.text();
}

async function fromWeb() {
  console.log(`Lade Übersicht: ${INDEX_URL}`);
  const indexHtml = await fetchHtml(INDEX_URL);
  const indexDoc = toDoc(indexHtml);
  let links = findCatalogLinks(indexDoc, INDEX_URL);
  console.log(`${links.length} Unterseiten gefunden`);
  const pages = [];
  // Falls die Fragen direkt auf der Übersichtsseite stehen
  const self = parseElwisPage(indexDoc, { url: INDEX_URL });
  if (self.questions.length >= 5) pages.push(self);
  for (const { url, text } of links) {
    const html = await fetchHtml(url);
    if (saveDir) {
      await mkdir(saveDir, { recursive: true });
      await writeFile(path.join(saveDir, path.basename(new URL(url).pathname)), html);
    }
    const page = parseElwisPage(toDoc(html), { url });
    console.log(`  ${text || url}: ${page.questions.length} Fragen${page.category ? ` → ${page.category.name}` : ''}`);
    if (page.questions.length) pages.push(page);
  }
  return pages;
}

async function fromFiles(dir) {
  const files = (await readdir(dir)).filter((f) => /\.html?$/i.test(f)).sort();
  const pages = [];
  for (const f of files) {
    const html = await readFile(path.join(dir, f), 'utf8');
    const page = parseElwisPage(toDoc(html), { url: `https://www.elwis.de/${f}` });
    console.log(`  ${f}: ${page.questions.length} Fragen${page.category ? ` → ${page.category.name}` : ''}`);
    if (page.questions.length) pages.push(page);
  }
  return pages;
}

const pages = fromDir ? await fromFiles(fromDir) : await fromWeb();
const catalog = buildCatalog(pages, { url: INDEX_URL });
if (!catalog.questions.length) {
  console.error('Keine Fragen gefunden – hat sich das Seitenlayout von ELWIS geändert?');
  process.exit(1);
}
await writeFile(OUT, JSON.stringify(catalog, null, 1) + '\n');
console.log(`\n${catalog.questions.length} Fragen in ${catalog.categories.length} Gebieten → ${path.relative(process.cwd(), OUT)}`);
for (const c of catalog.categories) {
  console.log(`  ${c.name}: ${catalog.questions.filter((q) => q.category === c.id).length}`);
}
if (catalog.warnings.length) {
  console.log(`\n${catalog.warnings.length} Hinweise:`);
  for (const w of catalog.warnings.slice(0, 30)) console.log(`  - ${w}`);
}
