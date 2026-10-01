// Kuratierte Eselsbrücken, fest zugeordnet zu Fragen des ELWIS-Katalogs.
// Sie ergänzen die Musterantwort als Lernhilfe und dürfen ihr nie widersprechen.
// Fragen ohne Eintrag bekommen eine Lernhilfe nur über die Claude-Bewertung.

export const HINTS = [
  // ---------- Navigation ----------
  {
    ids: ['NAV-22', 'NAV-24', 'NAV-26', 'NAV-27'],
    text: 'Tragweite hängt am Licht: Lichtstärke und Sichtwert der Luft. Sichtweite hängt an der Höhe: Feuerhöhe, Augeshöhe und Erdkrümmung. Für „Feuer in der Kimm“ muss das Licht weit genug tragen – Tragweite mindestens gleich Sichtweite.',
  },
  {
    ids: ['NAV-57', 'NAV-58', 'NAV-62'],
    text: 'Reihenfolge der Nordrichtungen: rechtweisend, missweisend, Magnetkompass. Zwischen rwN und mwN liegt die Missweisung, zwischen mwN und MgN die Ablenkung. Beide zusammen sind die Fehlweisung: Abl plus Mw gleich Fw. Vom Kompass zur Karte also erst die Ablenkung, dann die Missweisung anbringen.',
  },
  {
    ids: ['NAV-41', 'NAV-59'],
    text: 'Die Missweisung altert: Wert aus der Seekarte für das angegebene Jahr nehmen und mit der jährlichen Änderung auf das aktuelle Jahr hochrechnen.',
  },
  {
    ids: ['NAV-51', 'NAV-60', 'NAV-61', 'NAV-116'],
    text: 'Die Ablenkung ist schiffseigen und kursabhängig: Jedes Schiff hat seine eigene Steuertafel, und der Wert gilt für den anliegenden Kurs. Ändert sich das Eisen an Bord, ändert sich die Ablenkung.',
  },
  {
    ids: ['NAV-70', 'NAV-71', 'NAV-80', 'NAV-81', 'NAV-82'],
    text: 'Springzeit: Sonne, Mond und Erde in einer Linie – die Kräfte addieren sich, das Wasser „springt“: hohe Hochwasser, niedrige Niedrigwasser, starker Strom. Nippzeit: rechter Winkel – die Kräfte arbeiten gegeneinander, alles fällt schwächer aus.',
  },
  {
    ids: ['NAV-64'],
    text: 'Kardinalzeichen zeigen die Himmelsrichtung, in der das freie Wasser liegt. Toppzeichen: Nord beide Spitzen nach oben, Süd beide nach unten, Ost auseinander wie ein Ei, West zueinander wie eine Wespentaille.',
  },

  // ---------- Schifffahrtsrecht ----------
  {
    ids: ['REC-8', 'REC-9', 'REC-10', 'REC-14', 'REC-15', 'REC-22', 'REC-23', 'REC-52'],
    text: 'Manövrier-UN-fähig heißt: kann nicht, zum Beispiel Ruderbruch – zwei rote Lichter, am Tag zwei Bälle. „Rot über Rot – das Schiff hat Not.“ Manövrier-BE-hindert heißt: ist bei der Arbeit, zum Beispiel Bagger oder Kabelleger – Rot-Weiß-Rot, am Tag Ball-Rhombus-Ball.',
  },
  {
    ids: ['REC-44', 'REC-50'],
    text: 'Rangfolge „Un – Be – Fisch – Segel – Motor“: manövrierunfähig, manövrierbehindert, fischend, Segler, Maschinenfahrzeug. Wer weiter hinten steht, weicht allen davor aus.',
  },
  {
    ids: ['REC-49', 'REC-51'],
    text: 'Kreuzende Maschinenfahrzeuge: Wer den anderen an seiner Steuerbordseite hat, weicht aus. Merksatz wie an der Ampel: Siehst du sein rotes Licht, musst du ausweichen; siehst du Grün, bist du Kurshalter.',
  },
  {
    ids: ['REC-48'],
    text: 'Entgegenkommende Maschinenfahrzeuge: beide nach Steuerbord, also „Rot an Rot“ passieren – und dabei einen kurzen Ton geben: ein kurzer Ton heißt „ich ändere meinen Kurs nach Steuerbord“.',
  },
  {
    ids: ['REC-42', 'REC-43'],
    text: 'Kurshalter heißt: Kurs und Geschwindigkeit halten. Maßgeblich ist der Moment des ersten Insichtkommens. Reagiert der andere nicht, darf und muss der Kurshalter selbst manövrieren, um den Zusammenstoß abzuwenden.',
  },
  {
    ids: ['REC-31'],
    text: 'Ausweichpflichtiger reagiert nicht – Reihenfolge „Funk, Fünf, vorletzter, letzter“: Funk, mindestens fünf kurze Töne, Manöver des vorletzten und des letzten Augenblicks. Pflicht sind die fünf kurzen Töne und das Manöver des letzten Augenblicks.',
  },
  {
    ids: ['REC-38', 'REC-39'],
    text: 'Segler unter sich: Wind von Backbord weicht Wind von Steuerbord. Bei Wind von derselben Seite gilt „Lee vor Luv“ – der Luvwärtige weicht. Rotes Licht ist die Backbordseite – wie Portwein, denn Backbord heißt englisch „port“.',
  },
  {
    ids: ['REC-40', 'REC-41'],
    text: 'Wer aus dem Hecklichtsektor kommt, ist Überholer – und der Überholer weicht immer aus, selbst ein manövrierbehindertes Fahrzeug.',
  },
  {
    ids: ['REC-62'],
    text: 'Bleib-weg-Signal: kurz-lang, zwei Silben wie „Ab-stand!“ – möglichst weit weg, keine elektrischen Schalter, kein offenes Feuer.',
  },

  // ---------- Wetterkunde ----------
  {
    ids: ['WET-21'],
    text: 'Nordhalbkugel: Aus dem Hoch weht es rechtsherum heraus, ins Tief linksherum hinein. Rücken zum Wind – das Tief liegt links.',
  },
  {
    ids: ['WET-23', 'WET-32'],
    text: 'Die Kaltfront räumt auf: An der Front ist der Druck am tiefsten, danach steigt er deutlich. Hinter der Kaltfront gute Sicht, aber Schauer und Böen.',
  },
  {
    ids: ['WET-61'],
    text: 'Rechtdrehend heißt rechtsherum wie der Uhrzeiger, rückdrehend heißt zurück, also gegen den Uhrzeiger.',
  },

  // ---------- Seemannschaft ----------
  {
    ids: ['SM1-110', 'SM2-91'],
    text: 'Die ersten drei Sekunden: Rufen, Werfen, Gucken – „Mensch über Bord“ rufen, Rettungsmittel zuwerfen, die Person nie aus den Augen lassen. Danach Maschine, Manöver, Notmeldung.',
  },
];

const BY_ID = new Map(HINTS.flatMap((h) => h.ids.map((id) => [id, h.text])));

export function findHint(questionId) {
  return BY_ID.get(questionId) || null;
}
