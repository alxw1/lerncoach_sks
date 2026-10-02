# Anmeldung einrichten (Supabase)

Die App nutzt [Supabase](https://supabase.com) für Registrierung, E-Mail-Bestätigung und Login sowie für die
KI-Bewertung auf dem Server. Der OpenAI-Schlüssel liegt dort nur in der Datenbank und ist für niemanden
auslesbar, auch nicht im Browser. Einmalig einzurichten, Dauer etwa 20 Minuten.

> Bis `src/config.js` ausgefüllt ist, zeigt die App nur den Hinweis „Anmeldedienst noch nicht eingerichtet“
> und ist nicht nutzbar.

Die Bezeichnungen im Supabase-Dashboard können sich leicht ändern. Die Suche (⌘K) im Dashboard findet die Seiten auch über die Stichworte.

## 1. Projekt anlegen

1. Auf <https://supabase.com> mit GitHub oder E-Mail anmelden → **New project**.
2. Name z. B. `lerncoach-sks`, sicheres Datenbank-Passwort (wird hier nicht weiter gebraucht), Region **Frankfurt (eu-central-1)**.

## 2. Datenbank einrichten

**SQL Editor** → **New query** → den kompletten Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen → **Run**.

Das legt an:
- `app_config`: Einstellungen der KI-Bewertung. Nur der Admin darf ändern, der Schlüssel ist nicht auslesbar.
- `grade_usage` und `consume_grade`: Tageslimit an KI-Bewertungen je Nutzer.
- `is_admin()`: Admin ist nur `admin@weislogel.com` mit bestätigter E-Mail-Adresse.

## 3. Server-Funktion „grade“ anlegen

**Edge Functions** → **Deploy a new function** → **Via Editor**:
- Name: **`grade`** (genau so)
- Inhalt: kompletter Inhalt von [`supabase/functions/grade/index.ts`](supabase/functions/grade/index.ts)
- **Deploy**. Die Option „Verify JWT“ bleibt **eingeschaltet**.

Alternativ mit der Supabase-CLI: `npx supabase functions deploy grade --project-ref <projekt-id>`.

## 4. Anmeldung konfigurieren (Authentication)

**Authentication → Sign In / Providers → Email**
- **Enable Email provider**: an
- **Confirm email**: **an**, damit Konten erst nach Bestätigung der E-Mail-Adresse nutzbar sind
- **Secure password change**: an
- **Minimum password length**: **12**
- **Password requirements**: **Lowercase, uppercase letters, digits and symbols**
- **Leaked password protection** (nur im Pro-Tarif): an, falls verfügbar. Die App prüft Datenlecks zusätzlich selbst.

**Authentication → URL Configuration**
- **Site URL**: `https://alxw1.github.io/lerncoach_sks/`
- **Redirect URLs**: `https://alxw1.github.io/lerncoach_sks/**` hinzufügen

**Authentication → Emails → SMTP Settings**: **wichtig!** Ohne eigenen Mailserver verschickt Supabase
Bestätigungs-Mails nur an Mitglieder deines Supabase-Teams und nur wenige pro Stunde. Damit sich andere
registrieren können, einen SMTP-Dienst eintragen, z. B. [Resend](https://resend.com), [Brevo](https://www.brevo.com)
oder den Mailserver deiner Domain `weislogel.com`. Absender z. B. `SKS-Lerncoach <noreply@weislogel.com>`.

**Authentication → Emails → Templates** (optional, auf Deutsch):

*Confirm signup*, Betreff `Bitte bestätige deine E-Mail-Adresse – SKS-Lerncoach`:
```html
<h2>Willkommen beim SKS-Lerncoach</h2>
<p>Bitte bestätige deine E-Mail-Adresse, um dein Konto zu aktivieren:</p>
<p><a href="{{ .ConfirmationURL }}">E-Mail-Adresse bestätigen</a></p>
<p>Wenn du dich nicht registriert hast, kannst du diese E-Mail ignorieren.</p>
```

*Reset password*, Betreff `Neues Passwort festlegen – SKS-Lerncoach`:
```html
<h2>Passwort zurücksetzen</h2>
<p>Über diesen Link kannst du ein neues Passwort festlegen:</p>
<p><a href="{{ .ConfirmationURL }}">Neues Passwort festlegen</a></p>
<p>Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.</p>
```

## 5. App mit dem Projekt verbinden

**Project Settings → API Keys** (bzw. **Data API**): die **Project URL** und den **anon/public** bzw.
**publishable** Key kopieren und in [`src/config.js`](src/config.js) eintragen:

```js
export const SUPABASE_URL = 'https://<projekt-id>.supabase.co';
export const SUPABASE_ANON_KEY = '<anon- bzw. publishable-key>';
```

Diese beiden Werte sind öffentlich und dürfen im Repository stehen. Den **service_role**- bzw. **secret**-Key
**niemals** in die App eintragen oder weitergeben.

## 6. Admin-Konto anlegen und KI einschalten

1. In der App mit **admin@weislogel.com** registrieren und den Link in der Bestätigungs-E-Mail öffnen.
2. Anmelden → Reiter **Einstellungen** (nur für dieses Konto sichtbar) → **KI-Bewertung für alle Nutzer**:
   OpenAI-Schlüssel eintragen, Modell (Standard `gpt-5-mini`) und Tageslimit je Nutzer wählen → **Speichern** →
   **Verbindung testen**.

## Was wo geschützt ist

| Was | Schutz |
|-----|--------|
| App benutzen (Lernen, Statistik) | nur nach Anmeldung mit bestätigter E-Mail-Adresse |
| Einstellungen | Reiter nur für admin@weislogel.com; Änderungen zusätzlich in der Datenbank per Row Level Security nur für dieses Konto |
| OpenAI-Schlüssel | nur in der Datenbank; Browser bekommen nur eine Kurzform (`sk-…abcd`) |
| KI-Kosten | Tageslimit je Nutzer (einstellbar); Admin ohne Limit |
| Passwörter | Richtlinie in App **und** Supabase (mind. 12 Zeichen, alle Zeichenarten); Prüfung gegen bekannte Datenlecks; gespeichert nur als Hash bei Supabase |
| Lernstand | im Browser, getrennt je Konto |

Der Programmcode und der Fragenkatalog (ohnehin öffentlich bei ELWIS) liegen im öffentlichen Repository.
Wer die Adresse kennt, kann sie dort lesen, die App aber ohne Konto nicht benutzen.
