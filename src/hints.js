// Kuratierte Eselsbrücken. Sie ergänzen die ELWIS-Antwort als Lernhilfe,
// ersetzen sie aber nie. Zuordnung über Stichwörter in Frage + Antwort.

import { norm } from './grader.js';

export const HINTS = [
  {
    keys: ['backbord', 'steuerbord', 'seitenlicht', 'seitenlaterne'],
    text: 'Backbord ist links und rot – wie Portwein, denn Backbord heißt auf Englisch „port“. Steuerbord ist rechts und grün.',
  },
  {
    keys: ['kardinal'],
    text: 'Bei Kardinalzeichen zeigen die Kegelspitzen, wo das Schwarz ist: Nord beide nach oben, Süd beide nach unten, Ost auseinander wie ein Ei, West zueinander wie eine Wespentaille. Das Feuer geht wie die Uhr: Ost 3 Blitze, Süd 6 plus ein langer, West 9, Nord funkelt ununterbrochen.',
  },
  {
    keys: ['lateralzeichen', 'lateral', 'fahrwasserseite'],
    text: 'Betonnungssystem A, von See kommend: Backbordseite rot und stumpf, Steuerbordseite grün und spitz. Rot bleibt links – wie das rote Backbordlicht.',
  },
  {
    keys: ['backbordbug', 'steuerbordbug', 'lee vor luv', 'luvseite', 'leeseite', 'luvwaert', 'leewaert'],
    text: 'Segler unter sich: Backbordbug weicht Steuerbordbug. Bei gleichem Bug gilt „Lee vor Luv“ – der Luvwärtige weicht.',
  },
  {
    keys: ['missweisung', 'deviation', 'ablenkung', 'kompasskurs', 'rechtweisend', 'magnetkompass', 'kursumwandlung'],
    text: 'Vom Kompass zur Karte: Ablenkung und Missweisung mit ihrem Vorzeichen addieren – rechtweisender Kurs gleich Magnetkompasskurs plus Ablenkung plus Missweisung. Von der Karte zum Kompass mit umgekehrtem Vorzeichen. Ost ist plus, West ist minus.',
  },
  {
    keys: ['buys', 'barisches windgesetz', 'tiefdruckgebiet', 'tiefdruck'],
    text: 'Nordhalbkugel: Rücken zum Wind, dann liegt das Tief links und etwas vorn. Ums Tief weht der Wind gegen den Uhrzeigersinn.',
  },
  {
    keys: ['zwoelftel', 'tidenhub', 'steigdauer', 'falldauer'],
    text: 'Zwölftelregel: In den sechs Stunden steigt oder fällt das Wasser um 1, 2, 3, 3, 2, 1 Zwölftel des Tidenhubs – in der Mitte am schnellsten.',
  },
  {
    keys: ['springzeit', 'nippzeit', 'springtide', 'nipptide'],
    text: 'Springzeit: Sonne und Mond ziehen in einer Linie, bei Voll- und Neumond – großer Tidenhub. Nippzeit: Halbmond, die Kräfte stehen quer – kleiner Tidenhub.',
  },
  {
    keys: ['mayday', 'pan pan', 'securite', 'notmeldung', 'dringlichkeitsmeldung', 'sicherheitsmeldung'],
    text: 'Rangfolge: MAYDAY bei Lebensgefahr, PAN PAN bei Dringlichkeit, SÉCURITÉ für Sicherheitsmeldungen wie Navigationswarnungen oder Wetter.',
  },
  {
    keys: ['topplicht', 'hecklicht'],
    text: 'Sektoren: Topplicht 225 Grad, Hecklicht 135 Grad – zusammen 360. Jedes Seitenlicht 112,5 Grad, also die Hälfte des Topplichts.',
  },
  {
    keys: ['rot ueber weiss', 'gruen ueber weiss', 'weiss ueber rot', 'rot ueber rot', 'fischend', 'trawl', 'lotsenfahrzeug', 'manoevrierunfaehig'],
    text: 'Rundumlichter: Grün über Weiß – Trawler. Rot über Weiß – anderer Fischer. Weiß über Rot – Lotse an Bord. Rot über Rot – manövrierunfähig.',
  },
  {
    keys: ['kurzer ton', 'kurze toene', 'manoeversignal', 'schallsignal'],
    text: 'Manöversignale: ein kurzer Ton – ich ändere Kurs nach Steuerbord, zwei kurze – nach Backbord, drei kurze – Maschine läuft rückwärts. Fünf kurze heißt Zweifel.',
  },
  {
    keys: ['kreuzende kurse', 'kurse kreuzen', 'kreuzen sich'],
    text: 'Maschinenfahrzeuge auf kreuzenden Kursen: Wer den anderen an seiner Steuerbordseite hat, muss ausweichen – rechts vor links wie im Straßenverkehr.',
  },
  {
    keys: ['manoevrierbehindert', 'tiefgangbehindert', 'ausweichpflicht'],
    text: 'Rangfolge der Ausweichpflicht von oben nach unten: manövrierunfähig, manövrierbehindert, tiefgangbehindert, fischend, Segler, Maschinenfahrzeug. Weiter unten weicht nach oben aus.',
  },
  {
    keys: ['rechtsdrehend', 'rueckdrehend', 'linksdrehend'],
    text: 'Rechtsdrehend heißt mit dem Uhrzeigersinn, zum Beispiel von Südwest auf West. Rückdrehend heißt gegen den Uhrzeigersinn.',
  },
  {
    keys: ['kaltfront'],
    text: 'Kaltfront: Druck steigt schnell, Böen und Schauer, der Wind dreht rechts, danach wird die Sicht gut.',
  },
];

export function findHint(question, answer) {
  const text = ` ${norm(question)} ${norm(answer)} `;
  let best = null;
  let bestHits = 0;
  for (const h of HINTS) {
    const hits = h.keys.filter((k) => text.includes(' ' + norm(k))).length; // Wortanfang
    if (hits > bestHits) { best = h; bestHits = hits; }
  }
  return best ? best.text : null;
}
