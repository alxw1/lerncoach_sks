// Öffentliche Konfiguration des Anmeldedienstes (Supabase).
// Projekt-URL und „anon“/„publishable“ Key sind für den Browser bestimmt und dürfen
// im Repository stehen – geschützt wird über Row Level Security und die Server-Funktion.
// Den geheimen „service_role“-Key NIEMALS hier eintragen.
export const SUPABASE_URL = '';      // z. B. 'https://abcdefgh.supabase.co'
export const SUPABASE_ANON_KEY = ''; // „anon public“ bzw. „publishable“ Key

// Nur dieses Konto (mit bestätigter E-Mail) darf die Einstellungen öffnen.
// Muss mit ADMIN_EMAIL in supabase/schema.sql und supabase/functions/grade/index.ts übereinstimmen.
export const ADMIN_EMAIL = 'admin@weislogel.com';

export const isConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
