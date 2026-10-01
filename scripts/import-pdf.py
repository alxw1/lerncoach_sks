#!/usr/bin/env python3
"""Erzeugt data/fragen.json aus dem amtlichen ELWIS-PDF „Fragenkatalog SKS“.

    pip install pymupdf
    python3 scripts/import-pdf.py Fragenkatalog-SKS.pdf

Im PDF sind Fragen fett gesetzt (Georgia-Bold), Musterantworten in Verdana.
Abbildungen werden nach data/img/ exportiert und der jeweiligen Frage zugeordnet.
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'fragen.json'
IMG_DIR = ROOT / 'data' / 'img'

CATEGORIES = [
    ('Navigation', 'navigation', 'NAV'),
    ('Schifffahrtsrecht', 'recht', 'REC'),
    ('Wetterkunde', 'wetter', 'WET'),
    ('Seemannschaft I', 'seemannschaft1', 'SM1'),
    ('Seemannschaft II', 'seemannschaft2', 'SM2'),
]
EXPECTED = {'navigation': 118, 'recht': 110, 'wetter': 101, 'seemannschaft1': 163, 'seemannschaft2': 146}

NUMMER_RE = re.compile(r'^Nummer\s+(\d+)\s*:\s*$')
LIST_RE = re.compile(r'^\s*(\d{1,2}\.|[a-z]\)|[-–•])\s')
CONJUNCTIONS = {'und', 'oder', 'bzw', 'sowie', 'als', 'bis'}
DEBUG_JOINS = '--debug' in sys.argv
NOISE_RE = re.compile(r'^(Sie sind hier:|©|Stand:|Download Fragen)|(ELWIS\s+Sportschifffahrt)')


def span_text(s):
    # Tiefgestellte Zeichen (CO₂, Oₖ/O_b) liegen als winzige Spans auf eigener Zeile –
    # verwerfen und in fix_text() an der richtigen Stelle ergänzen.
    if s['size'] < 6:
        return ''
    return s['text']


def fix_text(t):
    t = re.sub(r'\bCO2?2?\s?-', 'CO₂-', t)
    t = t.replace('Koppelort (O )', 'Koppelort (Ok)').replace('beobachteten Ort (O )', 'beobachteten Ort (Ob)')
    return t.replace('INTInternational Hydrographic', 'INT')


def line_info(line):
    text = ''.join(span_text(s) for s in line['spans'])
    bold = sum(len(s['text']) for s in line['spans'] if 'Bold' in s['font'] and s['size'] < 11)
    total = sum(len(s['text'].strip()) for s in line['spans']) or 1
    heading = any(s['font'] == 'Verdana-Bold' and s['size'] > 10 for s in line['spans'])
    return text, bold / total > 0.5, heading


def join_lines(lines):
    """Zeilen zu Absätzen verbinden; Aufzählungspunkte bleiben eigene Zeilen."""
    out = []
    for raw in lines:
        t = re.sub(r'\s+', ' ', raw).strip()
        if not t:
            continue
        if out and not LIST_RE.match(t) and not out[-1].endswith(':'):
            # Silbentrennung am Zeilenende auflösen ("Schiff-\nfahrt"), Bindestrich-Komposita behalten
            first = t.split(' ', 1)[0].rstrip(',.')
            if out[-1].endswith('-') and t[:1].islower() and first not in CONJUNCTIONS:
                if DEBUG_JOINS:
                    print('  Trennung:', out[-1][-20:], '+', t[:20])
                out[-1] = out[-1][:-1] + t
            elif re.search(r'[A-Z]-$', out[-1]) and t[:1].isupper():
                out[-1] += t  # „UKW-\nHandsprechfunkgeräte“
            else:
                out[-1] += ' ' + t
        else:
            out.append(t)
    return '\n'.join(out)


def main(pdf_path):
    doc = pymupdf.open(pdf_path)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    for old in IMG_DIR.glob('*.png'):
        old.unlink()

    questions = []
    cat = None
    current = None
    seen_cats = set()

    # Grafiken, die mehrfach im Dokument vorkommen (Logo, Pfeil „nach oben“), sind Deko
    usage = {}
    for page in doc:
        for info in page.get_image_info(xrefs=True):
            usage[info['xref']] = usage.get(info['xref'], 0) + 1

    for pno, page in enumerate(doc):
        items = []
        for b in page.get_text('dict')['blocks']:
            if b['type'] == 0:
                for line in b['lines']:
                    items.append((line['bbox'][1], line['bbox'][0], 'text', line))
        for info in page.get_image_info(xrefs=True):
            if usage.get(info['xref'], 0) <= 2:
                items.append((info['bbox'][1], info['bbox'][0], 'img', info))
        items.sort(key=lambda it: (round(it[0]), it[1]))

        for _, _, kind, data in items:
            if kind == 'img':
                if current:
                    big = data['bbox'][3] - data['bbox'][1] >= 40
                    # Skizze nach einer großen Frage-Skizze oder nach Antworttext = Lösung
                    to_answer = bool(current['_a']) or (big and any(i[2] for i in current['_images'] if not i[3]))
                    current['_images'].append((pno, data, big, to_answer))
                continue
            text, bold, heading = line_info(data)
            t = text.strip()
            # Brotkrumen-Navigation am Seitenkopf: nur Verdana/Georgia 9 pt, nicht fett
            if all(sp['size'] > 8.5 and 'Bold' not in sp['font'] for sp in data['spans'] if sp['text'].strip()):
                continue
            if not t or NOISE_RE.search(t) or ('ELWIS' in t and 'Fragenkatalog SKS' in t):
                continue
            if heading:
                # „Seemannschaft II“ vor „Seemannschaft I“ prüfen
                match = next((c for c in sorted(CATEGORIES, key=lambda c: -len(c[0]))
                              if re.match(re.escape(c[0]) + r'(\s|\(|$)', t)), None)
                if match and match[1] not in seen_cats:
                    cat = match
                    seen_cats.add(match[1])
                    current = None
                continue
            m = NUMMER_RE.match(t)
            if m and cat:
                current = {'nr': int(m.group(1)), 'cat': cat, '_q': [], '_a': [], '_images': []}
                questions.append(current)
                continue
            if not current:
                continue
            # Fett = Frage, solange noch keine Antwortzeile kam
            if bold and not current['_a']:
                current['_q'].append(text)
            else:
                current['_a'].append(text)

    result = []
    warnings = []
    img_count = 0
    for q in questions:
        name, cid, prefix = q['cat']
        qid = f'{prefix}-{q["nr"]}'
        images, answer_images = [], []
        for i, (pno, info, big, to_answer) in enumerate(q['_images']):
            fname = f'{qid}-{i + 1}.png'
            # Ausschnitt rendern statt Rohbild: so passen Farbe, Maske und Skalierung
            pix = doc[pno].get_pixmap(clip=pymupdf.Rect(info['bbox']), dpi=220 if not big else 150)
            pix.save(IMG_DIR / fname)
            (answer_images if to_answer else images).append(f'data/img/{fname}')
            img_count += 1
        entry = {
            'id': qid,
            'nr': q['nr'],
            'category': cid,
            'question': fix_text(join_lines(q['_q'])),
            'answer': fix_text(join_lines(q['_a'])) or ('Siehe Lösungsskizze.' if answer_images else ''),
            'images': images,
        }
        if answer_images:
            entry['answerImages'] = answer_images
        if not entry['question']:
            warnings.append(f'{qid}: keine Frage erkannt')
        if not entry['answer']:
            warnings.append(f'{qid}: keine Antwort erkannt')
        result.append(entry)

    # Vollständigkeit prüfen
    for name, cid, prefix in CATEGORIES:
        nrs = [q['nr'] for q in result if q['category'] == cid]
        expected = list(range(1, EXPECTED[cid] + 1))
        if nrs != expected:
            missing = sorted(set(expected) - set(nrs))
            extra = sorted(set(nrs) - set(expected))
            warnings.append(f'{name}: {len(nrs)} statt {EXPECTED[cid]} Fragen, fehlend {missing[:10]}, zusätzlich {extra[:10]}')

    catalog = {
        'source': 'ELWIS – Fragen- und Antwortenkatalog Sportküstenschifferschein (Stand 01.07.2006)',
        'url': 'https://www.elwis.de/DE/Sportschifffahrt/Sportbootfuehrerscheine/Fragenkatalog-SKS/Fragenkatalog-SKS-node.html',
        'retrieved': date.today().isoformat(),
        'categories': [{'id': cid, 'name': name} for name, cid, _ in CATEGORIES],
        'questions': result,
    }
    OUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    print(f'{len(result)} Fragen, {img_count} Abbildungen → {OUT.relative_to(ROOT)}')
    for name, cid, _ in CATEGORIES:
        n = sum(1 for q in result if q['category'] == cid)
        k = sum(1 for q in result if q['category'] == cid and q['images'])
        print(f'  {name}: {n} (davon {k} mit Abbildung)')
    for w in warnings:
        print('  ⚠', w)
    return 1 if warnings else 0


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    sys.exit(main(args[0] if args else str(ROOT / 'Fragenkatalog-SKS.pdf')))
