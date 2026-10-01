# ⚓ SKS-Lerncoach

Ein sprachgesteuerter Lerncoach für den **Sportküstenschifferschein (SKS)**. Er macht aus Autofahrten kurze Lerneinheiten im Dialog:
Der Coach liest eine Frage aus dem **amtlichen ELWIS-Fragenkatalog** vor, hört deine Antwort, bewertet sie, gibt bei Bedarf eine Eselsbrücke,
liest die **richtige Antwort laut ELWIS** vor und sortiert die Frage nach dem **Leitner-System** neu ein.

Die App läuft komplett im Browser (Handy), braucht keinen Server und funktioniert nach dem ersten Laden auch offline.

## So läuft eine Runde

1. **Frage** – „Navigation, Frage 12. …“
2. **Antwort** – du sprichst frei, der Coach wartet auf eine kurze Sprechpause.
3. **Bewertung** – richtig / teilweise / falsch.
4. **Lernhilfe** – bei Lücken eine Eselsbrücke.
5. **ELWIS-Antwort** – die offizielle Musterantwort.
6. **Leitner-Update** – „Aufgestiegen in Box 3.“

Sprachbefehle jederzeit: **„nochmal“**, **„überspringen“**, **„weiß nicht“**, **„Statistik“**, **„Pause“**.

## Leitner-System

| Box | Wiedervorlage | Bedeutung |
|-----|---------------|-----------|
| 1 | jede Sitzung | noch nicht sicher – kommt am häufigsten |
| 2 | nach 1 Tag | |
| 3 | nach 3 Tagen | |
| 4 | nach 7 Tagen | sicher |
| 5 | nach 14 Tagen | sehr sicher – kommt nur noch selten |

- **richtig** → eine Box höher · **teilweise** → eine Box tiefer · **falsch** → zurück in Box 1
- Fällige Fragen aus niedrigen Boxen werden stark bevorzugt (gewichteter Zufall); jede dritte Frage darf eine neue sein (Tageslimit einstellbar).
  Ist nichts fällig, kommen die Fragen mit der geringsten Sicherheit.
- **Antwortsicherheit (%)** je Frage: gleitender Mittelwert der Bewertungen (richtig = 100, teilweise = 50, falsch = 0).
- **Statistik je Schwerpunktgebiet** (Navigation, Schifffahrtsrecht, Wetterkunde, Seemannschaft I/II): Quote richtig, Ø Sicherheit,
  Abdeckung, Anzahl sicherer Fragen (Box 4–5), fällige Fragen, Box-Verteilung und die „Wackelkandidaten“.

Der Lernstand liegt im Browser (localStorage) und bleibt über alle Sitzungen erhalten. Für einen Gerätewechsel:
*Einstellungen → Lernstand → Exportieren / Importieren*.

## Bewertung der Antworten

- **Ohne API-Schlüssel (Standard, offline):** Stichwortabgleich mit der ELWIS-Antwort. Der Coach nennt seine Einschätzung, liest die
  Musterantwort vor und fragt: „richtig, teilweise oder falsch – oder okay für meine Einschätzung?“
- **Mit Anthropic API-Schlüssel (optional):** Claude bewertet den Inhalt der transkribierten Antwort gegen die ELWIS-Musterantwort und
  formuliert eine kurze, vorlesbare Rückmeldung samt Eselsbrücke. Schlägt der Aufruf fehl (z. B. Funkloch), greift automatisch der Stichwortabgleich.
  Der Schlüssel wird nur lokal im Browser gespeichert und direkt an die Anthropic API gesendet.

Zusätzlich gibt es kuratierte Eselsbrücken (`src/hints.js`), fest zugeordnet zu 46 Katalogfragen – z. B. Nordrichtungen und
Fehlweisung, Spring-/Nippzeit, manövrierunfähig vs. manövrierbehindert, Ausweichregeln, Mensch über Bord.
Sie sind **Lernhilfen**, abgestimmt auf die Musterantworten – maßgeblich ist immer die ELWIS-Antwort.

## Fragenkatalog

`data/fragen.json` enthält alle **638 Fragen** des amtlichen Katalogs (Stand 01.07.2006), erzeugt aus dem ELWIS-PDF
`Fragenkatalog-SKS.pdf`:

| Gebiet | Fragen | davon mit Abbildung |
|--------|-------:|--------------------:|
| Navigation | 118 | 0 |
| Schifffahrtsrecht | 110 | 9 |
| Wetterkunde | 101 | 2 |
| Seemannschaft I (Antriebsmaschine und unter Segel) | 163 | 4 |
| Seemannschaft II (Antriebsmaschine) | 146 | 2 |

Abbildungen und Lösungsskizzen liegen in `data/img/`. Fragen mit Abbildung werden im Autofahrt-Modus standardmäßig ausgelassen
und nur am Bildschirm gestellt.

Neuen Katalog einlesen (z. B. wenn ELWIS eine neue Fassung veröffentlicht):

```bash
pip install pymupdf
python3 scripts/import-pdf.py Fragenkatalog-SKS.pdf    # aus dem PDF (empfohlen)
npm install && npm run import:elwis                    # alternativ aus den ELWIS-Webseiten
```

Der PDF-Importer trennt Frage und Antwort über die Schrift (Fragen fett), prüft die Vollständigkeit je Gebiet und exportiert die Abbildungen.
In der App lässt sich unter *Einstellungen → Fragenkatalog* außerdem eine `fragen.json` oder gespeicherte ELWIS-HTML-Seiten importieren.

## Starten

```bash
npm start            # http://localhost:8080
npm test             # Unit-Tests (Leitner, Bewertung, Parser)
```

Für das Handy die App per HTTPS bereitstellen (Mikrofon-Zugriff verlangt HTTPS), z. B. über **GitHub Pages**
(*Settings → Pages → Branch: main, Ordner: / (root)*). Dann im Browser „Zum Startbildschirm hinzufügen“.

Unterstützte Browser für den Autofahrt-Modus: **Chrome (Android)** und **Safari (iOS)** – beide bieten Spracherkennung auf Deutsch.

## Sicherheit im Auto

Der Autofahrt-Modus ist komplett freihändig gedacht: Handy in die Halterung, „Autofahrt starten“ antippen, dann nur noch sprechen.
Der Bildschirm bleibt an, zeigt aber nur große Elemente. Bitte während der Fahrt nicht auf den Bildschirm schauen oder tippen.

## Hinweis

Keine rechtsverbindlichen Auskünfte zur Prüfungsordnung. Maßgeblich sind die amtlichen Veröffentlichungen auf ELWIS.

## Aufbau

```
index.html, styles.css      Oberfläche
src/app.js                  Ablauf (Frage → Antwort → Bewertung → Lernhilfe → ELWIS-Antwort → Leitner)
src/leitner.js              Lernboxen, Fragenauswahl, Statistik (ohne DOM, getestet)
src/grader.js               Stichwortabgleich + optionale Claude-Bewertung
src/hints.js                kuratierte Eselsbrücken
src/speech.js               Sprachausgabe/-erkennung, Sprachbefehle
src/elwis-parser.js         ELWIS-HTML → Fragen (Browser und Node)
scripts/import-pdf.py       erzeugt data/fragen.json aus dem ELWIS-PDF
scripts/import-elwis.mjs    alternativ aus den ELWIS-Webseiten
COACH_PROMPT.md             Systemprompt, um den Coach auch im Claude-Sprachmodus zu nutzen
```
