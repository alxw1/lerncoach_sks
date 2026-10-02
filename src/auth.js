// Anmeldung über Supabase Auth: Registrierung mit E-Mail-Bestätigung, Login,
// Passwort zurücksetzen, Rolle „Admin“ und Aufruf der Server-Funktion „grade“.

import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, isConfigured } from './config.js';

let client = null;

export function getClient() {
  if (!isConfigured()) return null;
  client ||= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
  return client;
}

/** Adresse, auf die Bestätigungs- und Zurücksetzen-Links führen (diese Seite ohne Hash/Query). */
export const appUrl = () => location.origin + location.pathname;

export const isAdmin = (user) =>
  Boolean(user?.email_confirmed_at) && (user.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();

/** Übersetzt Fehlermeldungen von Supabase für die Anzeige. */
export function explainAuthError(error) {
  const msg = error?.message || String(error || '');
  const code = error?.code || '';
  if (/email not confirmed/i.test(msg) || code === 'email_not_confirmed') return 'Deine E-Mail-Adresse ist noch nicht bestätigt. Bitte den Link in der Bestätigungs-E-Mail öffnen.';
  if (/invalid login credentials/i.test(msg) || code === 'invalid_credentials') return 'E-Mail-Adresse oder Passwort ist falsch.';
  if (/already registered|already exists/i.test(msg) || code === 'user_already_exists') return 'Für diese E-Mail-Adresse gibt es bereits ein Konto. Bitte anmelden.';
  if (/rate limit|too many/i.test(msg) || code === 'over_email_send_rate_limit') return 'Zu viele Versuche. Bitte in ein paar Minuten erneut probieren.';
  if (/weak|pwned|password should/i.test(msg) || code === 'weak_password') return 'Das Passwort erfüllt die Sicherheitsanforderungen nicht.';
  if (/same.*password|different from the old/i.test(msg) || code === 'same_password') return 'Das neue Passwort muss sich vom alten unterscheiden.';
  if (/invalid.*email|unable to validate email/i.test(msg) || code === 'email_address_invalid') return 'Bitte eine gültige E-Mail-Adresse eingeben.';
  if (/failed to fetch|network/i.test(msg)) return 'Keine Verbindung zum Anmeldedienst. Bitte Internetverbindung prüfen.';
  return msg || 'Unbekannter Fehler.';
}

export async function signUp(email, password) {
  const { data, error } = await getClient().auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
  if (error) throw error;
  // Supabase verrät aus Datenschutzgründen nicht, ob die Adresse schon existiert:
  // Ein „Nutzer“ ohne Identitäten bedeutet „bereits registriert“.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw Object.assign(new Error('User already registered'), { code: 'user_already_exists' });
  }
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await getClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function resendConfirmation(email) {
  const { error } = await getClient().auth.resend({ type: 'signup', email, options: { emailRedirectTo: appUrl() } });
  if (error) throw error;
}

export async function requestPasswordReset(email) {
  const { error } = await getClient().auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  if (error) throw error;
}

export async function updatePassword(password) {
  const { error } = await getClient().auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  await getClient()?.auth.signOut();
}

/** Ruft die Server-Funktion „grade“ auf (OpenAI-Bewertung mit dem Schlüssel des Admins). */
export async function serverGrade({ question, officialAnswer, userAnswer, test = false }) {
  const { data, error } = await getClient().functions.invoke('grade', {
    body: { question, officialAnswer, userAnswer, test },
  });
  if (error) {
    // Fehlertext der Funktion auslesen (z. B. Tageslimit, nicht eingerichtet)
    let detail = null;
    try { detail = await error.context?.json(); } catch { /* kein JSON */ }
    const err = new Error(detail?.message || error.message);
    err.code = detail?.error || 'function_error';
    err.status = detail?.status ?? error.context?.status;
    throw err;
  }
  return { ...data, source: 'openai' };
}

/** Admin: Einstellungen der KI-Bewertung lesen (ohne Schlüssel, nur dessen Kurzform). */
export async function loadAiConfig() {
  const { data, error } = await getClient().from('app_config').select('key_hint, openai_model, daily_limit, updated_at').eq('id', 1).single();
  if (error) throw error;
  return data;
}

/** Admin: Einstellungen speichern. Leerer Schlüssel = Schlüssel unverändert lassen. */
export async function saveAiConfig({ apiKey, model, dailyLimit }) {
  const patch = { openai_model: model, daily_limit: dailyLimit, updated_at: new Date().toISOString() };
  if (apiKey) patch.openai_api_key = apiKey;
  const { error } = await getClient().from('app_config').update(patch).eq('id', 1);
  if (error) throw error;
}
