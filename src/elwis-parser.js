// Liest Fragen und Antworten aus einer Seite des ELWIS-Fragenkatalogs SKS.
// Arbeitet auf einem DOM-Document (Browser: DOMParser, Node: linkedom),
// damit der Import in der App und im Node-Skript identisch ist.

export const CATEGORIES = [
  { id: 'navigation', name: 'Navigation', match: /navigation/i, prefix: 'NAV' },
  { id: 'recht', name: 'Schifffahrtsrecht', match: /recht/i, prefix: 'REC' },
  { id: 'wetter', name: 'Wetterkunde', match: /wetter/i, prefix: 'WET' },
  { id: 'seemannschaft2', name: 'Seemannschaft II', match: /seemannschaft\s*(ii|2)\b/i, prefix: 'SM2' },
  { id: 'seemannschaft1', name: 'Seemannschaft I', match: /seemannschaft\s*(i|1)?\b/i, prefix: 'SM1' },
];

export function categoryFromTitle(title) {
  const t = (title || '').replace(/\s+/g, ' ');
  return CATEGORIES.find((c) => c.match.test(t)) || null;
}

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'FIGURE', 'IMG', 'DL', 'BLOCKQUOTE']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NAV', 'HEADER', 'FOOTER', 'NOSCRIPT', 'FORM', 'BUTTON', 'svg']);
const CONTENT_SELECTORS = ['#content', '#main', 'main', '[role="main"]', 'article', '.content', 'body'];
const QUESTION_RE = /^\s*(\d{1,3})\s*[.)]\s*(\S[\s\S]*)$/;

export function cleanText(s) {
  return (s || '')
    .replace(/­/g, '') // weiche Trennstriche
    .replace(/[   ]/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function textOf(el) {
  if (el.tagName === 'UL' || el.tagName === 'OL') {
    return [...el.children]
      .filter((li) => li.tagName === 'LI')
      .map((li) => '– ' + cleanText(li.textContent).replace(/\n/g, ' '))
      .join('\n');
  }
  if (el.tagName === 'TABLE') {
    return [...el.querySelectorAll('tr')]
      .map((tr) => [...tr.children].map((td) => cleanText(td.textContent)).filter(Boolean).join(' | '))
      .filter(Boolean)
      .join('\n');
  }
  return cleanText(el.textContent);
}

function imagesOf(el, baseUrl) {
  const imgs = el.tagName === 'IMG' ? [el] : [...el.querySelectorAll('img')];
  return imgs
    .map((img) => img.getAttribute('src'))
    .filter(Boolean)
    .map((src) => {
      try { return new URL(src, baseUrl || 'https://www.elwis.de/').href; } catch { return src; }
    });
}

/** Zerlegt den Inhaltsbereich in eine flache Liste von Blöcken in Dokumentreihenfolge. */
function flattenBlocks(root, baseUrl) {
  const blocks = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const t = cleanText(child.textContent);
        if (t) blocks.push({ tag: 'TEXT', text: t, images: [] });
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toUpperCase();
      if (SKIP_TAGS.has(tag) || SKIP_TAGS.has(child.tagName)) continue;
      if (BLOCK_TAGS.has(tag)) {
        blocks.push({ tag, text: textOf(child), images: imagesOf(child, baseUrl), el: child });
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return blocks;
}

function findRoot(doc) {
  for (const sel of CONTENT_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el && QUESTION_RE.test(el.textContent || '') ) return el;
  }
  return doc.body || doc.documentElement;
}

function pageTitle(doc) {
  const h1 = doc.querySelector('h1');
  return cleanText(h1 ? h1.textContent : doc.title || '');
}

/**
 * Strategie A: Frage = Absatz/Überschrift, der mit „<Nr>.“ beginnt,
 * Antwort = alle folgenden Blöcke bis zur nächsten Frage.
 */
function parseSequential(blocks) {
  const out = [];
  let current = null;
  let last = 0;
  let headingSince = false;
  for (const b of blocks) {
    const isHeading = /^H\d$/.test(b.tag);
    const m = (b.tag === 'P' || b.tag === 'TEXT' || isHeading) ? b.text.match(QUESTION_RE) : null;
    const nr = m ? Number(m[1]) : NaN;
    const plausible = m && (last === 0 || nr === last + 1 || (nr === 1 && headingSince));
    if (plausible) {
      current = { nr, question: cleanText(m[2]), answerParts: [], images: [...b.images] };
      out.push(current);
      last = nr;
      headingSince = false;
      continue;
    }
    if (isHeading) { headingSince = true; if (current) current = null; continue; }
    if (current) {
      if (b.text) current.answerParts.push(b.text);
      current.images.push(...b.images);
    }
  }
  return out;
}

/** Strategie B: Fragen als <li> einer nummerierten Liste, Antwort im selben <li>. */
function parseListItems(root, baseUrl) {
  const out = [];
  for (const ol of root.querySelectorAll('ol')) {
    const items = [...ol.children].filter((li) => li.tagName === 'LI');
    if (items.length < 5) continue;
    const start = Number(ol.getAttribute('start') || 1);
    items.forEach((li, i) => {
      const blocks = flattenBlocks(li, baseUrl);
      if (!blocks.length) return;
      const [first, ...rest] = blocks;
      out.push({
        nr: start + i,
        question: first.text,
        answerParts: rest.map((b) => b.text).filter(Boolean),
        images: blocks.flatMap((b) => b.images),
      });
    });
    if (out.length) break;
  }
  return out;
}

/**
 * @param {Document} doc
 * @param {{url?: string, category?: {id:string,name:string,prefix:string}}} opts
 * @returns {{category: object|null, title: string, questions: object[], warnings: string[]}}
 */
export function parseElwisPage(doc, { url, category } = {}) {
  const title = pageTitle(doc);
  const cat = category || categoryFromTitle(title) || categoryFromTitle(url || '');
  const root = findRoot(doc);
  const blocks = flattenBlocks(root, url);
  let raw = parseSequential(blocks);
  if (raw.length < 5) {
    const alt = parseListItems(root, url);
    if (alt.length > raw.length) raw = alt;
  }

  const warnings = [];
  const seenNr = new Set();
  const questions = [];
  for (const r of raw) {
    if (seenNr.has(r.nr)) { warnings.push(`Nr. ${r.nr} doppelt – übersprungen`); continue; }
    seenNr.add(r.nr);
    const answer = r.answerParts.join('\n').trim();
    if (!answer) warnings.push(`Nr. ${r.nr}: keine Antwort gefunden`);
    questions.push({
      id: `${cat ? cat.prefix : 'SKS'}-${r.nr}`,
      nr: r.nr,
      category: cat ? cat.id : 'unbekannt',
      question: r.question,
      answer,
      images: [...new Set(r.images)],
    });
  }
  for (let i = 1; i < questions.length; i++) {
    const gap = questions[i].nr - questions[i - 1].nr;
    if (gap > 1) warnings.push(`Lücke zwischen Nr. ${questions[i - 1].nr} und ${questions[i].nr}`);
  }
  if (!cat) warnings.push(`Kein Schwerpunktgebiet erkannt für „${title || url}“`);
  return { category: cat, title, questions, warnings };
}

/** Findet auf der Übersichtsseite die Links zu den Teilkatalogen. */
export function findCatalogLinks(doc, baseUrl) {
  const links = new Map();
  for (const a of doc.querySelectorAll('a[href]')) {
    let href;
    try { href = new URL(a.getAttribute('href'), baseUrl).href; } catch { continue; }
    if (!/Fragenkatalog-SKS\//i.test(href)) continue;
    if (/Fragenkatalog-SKS-node\.html/i.test(href)) continue;
    if (!/\.html(\?|#|$)/i.test(href)) continue;
    const clean = href.replace(/#.*$/, '');
    const text = cleanText(a.textContent);
    if (!links.has(clean)) links.set(clean, text);
  }
  return [...links].map(([url, text]) => ({ url, text }));
}

/** Baut die Katalogdatei aus mehreren geparsten Seiten. */
export function buildCatalog(pages, { source = 'ELWIS – Fragenkatalog SKS', url = '' } = {}) {
  const byId = new Map();
  const cats = new Map();
  const warnings = [];
  for (const p of pages) {
    warnings.push(...p.warnings.map((w) => `${p.title || p.category?.name}: ${w}`));
    if (p.category) cats.set(p.category.id, { id: p.category.id, name: p.category.name });
    for (const q of p.questions) byId.set(q.id, q);
  }
  const order = CATEGORIES.map((c) => c.id);
  const questions = [...byId.values()].sort((a, b) =>
    (order.indexOf(a.category) - order.indexOf(b.category)) || (a.nr - b.nr));
  const categories = [...cats.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return {
    source,
    url,
    retrieved: new Date().toISOString().slice(0, 10),
    categories,
    questions,
    warnings,
  };
}
