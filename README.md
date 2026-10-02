# SKS-Lerncoach

Ein sprachgesteuerter Lerncoach für den **Sportküstenschifferschein (SKS)**. Er macht aus Autofahrten kurze Lerneinheiten im Dialog:
Der Coach liest eine Frage aus dem **amtlichen ELWIS-Fragenkatalog** vor, hört deine Antwort, bewertet sie, gibt bei Bedarf eine Eselsbrücke,
liest die **richtige Antwort laut ELWIS** vor und sortiert die Frage nach dem **Leitner-System** neu ein.

Die App läuft im Browser (Handy oder Mac), im Design von macOS, und funktioniert nach dem ersten Laden auch offline.
Die Nutzung erfordert ein **Konto mit bestätigter E-Mail-Adresse**. Die Einstellungen sind nur für
**admin@weislogel.com** zugänglich. Einrichtung des Anmeldedienstes: siehe **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)**.

**▶ App öffnen: <https://alxw1.github.io/lerncoach_sks/>** – auf dem Handy öffnen und „Zum Startbildschirm hinzufügen“.

## So läuft eine Runde

1. **Frage** – „Navigation, Frage 12. …“
2. **Antwort** – du sprichst frei, der Coach wartet auf eine kurze Sprechpause.
3. **Bewertung** – Richtigkeit in Prozent als Statusbalken; **mehr als 80 % = richtig**, sonst falsch (kein „teilweise“).
4. **ELWIS-Antwort** – die offizielle Musterantwort, direkt unter der Frage.
5. **Lernhilfe** – bei falscher Antwort eine Eselsbrücke.
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

- **richtig** (mehr als 80 %) → eine Box höher · **falsch** → zurück in Box 1
- Fällige Fragen aus niedrigen Boxen werden stark bevorzugt (gewichteter Zufall); jede dritte Frage darf eine neue sein (Tageslimit einstellbar).
  Ist nichts fällig, kommen die Fragen mit der geringsten Sicherheit.
- **Antwortsicherheit (%)** je Frage: gleitender Mittelwert der gemessenen Richtigkeit (in Prozent) der Antworten.
- **Statistik je Schwerpunktgebiet** (Navigation, Schifffahrtsrecht, Wetterkunde, Seemannschaft I/II): Quote richtig, Ø Sicherheit,
  Abdeckung, Anzahl sicherer Fragen (Box 4–5), fällige Fragen, Box-Verteilung und die „Wackelkandidaten“.

Der Lernstand liegt im Browser (localStorage) und bleibt über alle Sitzungen erhalten. Für einen Gerätewechsel:
*Einstellungen → Lernstand → Exportieren / Importieren*.

## Konto und Sicherheit

- **Registrierung** mit E-Mail und Passwort direkt auf der Startseite. Das Konto ist erst nach Klick auf den Link in der
  **Bestätigungs-E-Mail** nutzbar. „Passwort vergessen“ schickt einen Link zum Neusetzen.
- **Passwortrichtlinie** nach BSI-/NIST-Empfehlungen: mindestens 12 Zeichen, Klein- und Großbuchstaben, Ziffer und
  Sonderzeichen, keine Teile der E-Mail-Adresse, keine bekannten Muster, nicht in bekannten Datenlecks (anonyme Prüfung per
  k-Anonymität). Ein **Balken wird grün**, sobald alle Kriterien erfüllt sind; ein Sicherheitshinweis erklärt die Regeln.
- **Einstellungen nur für admin@weislogel.com**, zusätzlich in der Datenbank per Row Level Security abgesichert.
- **Lernstand** bleibt im Browser, getrennt je Konto.

## Bewertung der Antworten

Jede Antwort bekommt eine **Richtigkeit in Prozent**, angezeigt als Statusbalken mit Markierung bei 80 %.
**Mehr als 80 % gilt als richtig, alles andere als falsch.**

- **KI-Bewertung (OpenAI) für alle angemeldeten Nutzer:** Die Server-Funktion `grade` vergleicht die transkribierte Antwort
  inhaltlich mit der ELWIS-Musterantwort (Inhalt, Vollständigkeit, Fachbegriffe – wie in der Prüfung) und liefert die
  Prozentzahl, eine kurze vorlesbare Rückmeldung und eine Eselsbrücke. Den OpenAI-Schlüssel hinterlegt der Admin unter
  *Einstellungen → KI-Bewertung für alle Nutzer*; er liegt nur auf dem Server. Ein Tageslimit je Nutzer begrenzt die Kosten.
- **Ohne KI (nicht eingerichtet, Limit erreicht oder Funkloch):** Die App schätzt die Prozentzahl per Stichwortabgleich, liest die Musterantwort vor und
  fragt: „richtig oder falsch – oder okay für meine Einschätzung?“

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

Die App wird über **GitHub Pages** aus dem Branch `main` (Ordner `/`) veröffentlicht: <https://alxw1.github.io/lerncoach_sks/>.
Jeder Merge nach `main` aktualisiert die Seite nach ein bis zwei Minuten. HTTPS ist nötig, weil der Browser sonst keinen Mikrofonzugriff erlaubt.

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
src/grader.js               Richtigkeit in Prozent per Stichwortabgleich (Rückfall ohne KI)
src/auth.js, src/ui-auth.js Anmeldung, Registrierung, E-Mail-Bestätigung, Passwort zurücksetzen (Supabase)
src/password.js             Passwortrichtlinie und anonyme Datenleck-Prüfung
src/config.js               Supabase-Projekt-URL und öffentlicher Schlüssel
src/vendor/supabase.js      gebündeltes supabase-js (npm run vendor)
supabase/schema.sql         Datenbank: Admin-Rolle, KI-Einstellungen, Tageslimit (Row Level Security)
supabase/functions/grade/   Server-Funktion: KI-Bewertung mit dem OpenAI-Schlüssel des Admins
src/hints.js                kuratierte Eselsbrücken
src/speech.js               Sprachausgabe/-erkennung, Sprachbefehle
src/elwis-parser.js         ELWIS-HTML → Fragen (Browser und Node)
scripts/import-pdf.py       erzeugt data/fragen.json aus dem ELWIS-PDF
scripts/import-elwis.mjs    alternativ aus den ELWIS-Webseiten
COACH_PROMPT.md             Systemprompt, um den Coach auch im Claude-Sprachmodus zu nutzen
```
