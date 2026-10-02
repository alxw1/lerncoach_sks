// Anmeldebildschirm: Anmelden, Registrieren (mit Passwortstärke), E-Mail-Bestätigung,
// Passwort zurücksetzen. Ruft onSignedIn(user) / onSignedOut() auf.

import * as auth from './auth.js';
import { isConfigured } from './config.js';
import { evaluatePassword, breachCount } from './password.js';

const $ = (sel) => document.querySelector(sel);
let pendingEmail = '';

function show(view) {
  for (const v of document.querySelectorAll('[data-auth-view]')) v.hidden = v.dataset.authView !== view;
  const tabs = $('#auth-tabs');
  tabs.hidden = !['login', 'register'].includes(view);
  for (const t of tabs.querySelectorAll('[data-auth]')) t.setAttribute('aria-selected', String(t.dataset.auth === view));
  if (view !== 'verify') message('');
  document.querySelector(`[data-auth-view="${view}"] input`)?.focus();
}

function message(text, kind = 'info') {
  const m = $('#auth-message');
  m.hidden = !text;
  m.textContent = text;
  m.className = `auth-message ${kind}`;
}

async function busy(form, fn) {
  const buttons = form.querySelectorAll('button');
  buttons.forEach((b) => { b.dataset.wasDisabled = b.disabled; b.disabled = true; });
  try { await fn(); } catch (e) { message(auth.explainAuthError(e), 'error'); } finally {
    buttons.forEach((b) => { b.disabled = b.dataset.wasDisabled === 'true'; });
  }
}

// ---------- Passwortstärke ----------
/**
 * Baut Balken, Kriterienliste und Sicherheitshinweis in ein .pw-meter-Element und
 * aktualisiert sie bei jeder Eingabe. Gibt eine Funktion zurück, die meldet, ob alles erfüllt ist.
 */
export function attachMeter(meter, pwInput, pw2Input, getEmail, submitBtn, extraInputs = []) {
  meter.innerHTML = `
    <div class="pw-bar" role="meter" aria-label="Passwortsicherheit" aria-valuemin="0" aria-valuemax="100"><div class="pw-fill"></div></div>
    <p class="pw-label small" aria-live="polite"></p>
    <ul class="pw-checks small"></ul>
    <p class="pw-hint small">🔒 <strong>Sicherheitshinweis:</strong> Nutze ein Passwort, das du nirgendwo sonst verwendest – am besten eine
      Passphrase aus mehreren Wörtern oder ein Passwort aus deinem Passwort-Manager. Es wird nur verschlüsselt (gehasht) gespeichert.
      Ob es in bekannten Datenlecks vorkommt, prüfen wir anonym: Nur die ersten 5 Zeichen seines Hash-Werts verlassen dein Gerät.</p>`;
  const fill = meter.querySelector('.pw-fill');
  const bar = meter.querySelector('.pw-bar');
  const label = meter.querySelector('.pw-label');
  const list = meter.querySelector('.pw-checks');
  let breach = { pw: null, count: null, pending: false };
  let timer = null;

  const update = () => {
    const pw = pwInput.value;
    const res = evaluatePassword(pw, getEmail() || '');
    const match = pw.length > 0 && pw === pw2Input.value;
    const checks = [...res.checks, { id: 'match', label: 'Beide Eingaben stimmen überein', ok: match }];
    const breachKnown = breach.pw === pw && !breach.pending;
    const breached = breachKnown && breach.count > 0;
    checks.push({
      id: 'breach',
      label: breach.pw === pw && breach.pending ? 'Prüfe bekannte Datenlecks …'
        : breached ? `In bekannten Datenlecks gefunden (${breach.count.toLocaleString('de-DE')}×) – bitte ein anderes Passwort wählen`
          : breachKnown && breach.count === null ? 'Datenleck-Prüfung gerade nicht möglich (offline)'
            : 'Nicht in bekannten Datenlecks',
      ok: res.ok && breachKnown && !breached,
      soft: breachKnown && breach.count === null,
    });
    const allOk = res.ok && match && breachKnown && !breached;
    const score = breached ? Math.min(res.score, 40) : allOk ? Math.max(res.score, 90) : Math.min(res.score, 85);
    fill.style.width = `${score}%`;
    bar.dataset.level = allOk ? 'strong' : score >= 60 ? 'medium' : 'weak';
    bar.setAttribute('aria-valuenow', String(score));
    label.textContent = !pw ? 'Passwortsicherheit' : allOk ? 'Sicher – alle Kriterien erfüllt' : score >= 60 ? 'Fast geschafft' : 'Zu schwach';
    list.replaceChildren(...checks.map((c) => {
      const li = document.createElement('li');
      li.className = c.ok || c.soft ? 'ok' : 'todo';
      li.textContent = c.label;
      return li;
    }));
    submitBtn.disabled = !allOk;

    // Leck-Prüfung erst, wenn die lokalen Kriterien erfüllt sind (spart Anfragen)
    if (res.ok && breach.pw !== pw) {
      breach = { pw, count: null, pending: true };
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const count = await breachCount(pw);
        if (breach.pw === pw) { breach = { pw, count, pending: false }; update(); }
      }, 400);
    }
    return allOk;
  };
  for (const i of [pwInput, pw2Input, ...extraInputs]) i.addEventListener('input', update);
  update();
  return update;
}

// ---------- Ablauf ----------
export async function initAuth({ onSignedIn, onSignedOut }) {
  const screen = $('#auth-screen');
  if (!isConfigured()) {
    screen.hidden = false;
    $('#auth-setup').hidden = false;
    for (const b of screen.querySelectorAll('button, input')) b.disabled = true;
    return;
  }
  const client = auth.getClient();

  // Fehler aus Bestätigungs-/Reset-Links (z. B. abgelaufen) stehen im URL-Hash
  const hash = new URLSearchParams(location.hash.slice(1));
  const linkError = hash.get('error_description') || hash.get('error');
  let recovering = hash.get('type') === 'recovery';
  let recoveryEmail = '';
  let current = null;

  for (const t of document.querySelectorAll('#auth-tabs [data-auth]')) t.addEventListener('click', () => show(t.dataset.auth));
  for (const b of document.querySelectorAll('[data-goto]')) b.addEventListener('click', () => show(b.dataset.goto));

  const checkReg = attachMeter(document.querySelector('[data-meter="reg"]'), $('#reg-password'), $('#reg-password2'),
    () => $('#reg-email').value, $('#btn-register'), [$('#reg-email')]);
  const checkNew = attachMeter(document.querySelector('[data-meter="new"]'), $('#new-password'), $('#new-password2'),
    () => recoveryEmail, $('#btn-newpw'));

  $('#form-login').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#login-email').value.trim();
    busy(e.target, async () => {
      try {
        await auth.signIn(email, $('#login-password').value);
      } catch (err) {
        if (/not confirmed/i.test(err.message) || err.code === 'email_not_confirmed') {
          pendingEmail = email;
          $('#verify-email').textContent = email;
          show('verify');
        }
        throw err;
      }
    });
  });

  $('#form-register').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!checkReg()) return;
    const email = $('#reg-email').value.trim();
    busy(e.target, async () => {
      await auth.signUp(email, $('#reg-password').value);
      pendingEmail = email;
      $('#verify-email').textContent = email;
      e.target.reset();
      checkReg();
      show('verify');
      message('Konto angelegt. Bitte bestätige jetzt deine E-Mail-Adresse.', 'success');
    });
  });

  $('#btn-resend').addEventListener('click', (e) => busy(e.target.closest('.auth-form'), async () => {
    await auth.resendConfirmation(pendingEmail);
    message(`Bestätigungs-E-Mail erneut an ${pendingEmail} gesendet.`, 'success');
  }));

  $('#form-reset').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#reset-email').value.trim();
    busy(e.target, async () => {
      await auth.requestPasswordReset(email);
      show('login');
      message(`Falls ein Konto für ${email} existiert, ist ein Link zum Zurücksetzen unterwegs.`, 'success');
    });
  });

  $('#form-newpw').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!checkNew()) return;
    busy(e.target, async () => {
      await auth.updatePassword($('#new-password').value);
      e.target.reset();
      recovering = false;
      const { data } = await client.auth.getUser();
      if (data.user) enter(data.user);
    });
  });

  const enter = (user) => {
    if (current?.id === user.id) return;
    current = user;
    screen.hidden = true;
    history.replaceState(null, '', location.pathname); // Token-Reste aus der Adresszeile entfernen
    onSignedIn(user);
  };
  const leave = () => {
    current = null;
    screen.hidden = false;
    show('login');
    onSignedOut();
  };

  client.auth.onAuthStateChange((event, session) => {
    // Supabase empfiehlt, hier nicht direkt weitere Supabase-Aufrufe zu machen
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY' || (recovering && session)) {
        recovering = true;
        recoveryEmail = session?.user?.email || '';
        checkNew();
        screen.hidden = false;
        show('newpw');
        message('Bitte lege ein neues Passwort fest.', 'info');
        return;
      }
      if (recovering) return;
      if (session?.user?.email_confirmed_at) enter(session.user);
      else if (event === 'SIGNED_OUT') leave();
    }, 0);
  });

  const { data } = await client.auth.getSession();
  if (data.session?.user?.email_confirmed_at && !recovering) {
    enter(data.session.user);
  } else if (!recovering) {
    screen.hidden = false;
    show('login');
    if (linkError) {
      message(/expired|invalid/i.test(linkError)
        ? 'Der Link ist abgelaufen oder wurde schon benutzt. Bitte melde dich an oder fordere einen neuen Link an.'
        : `Anmeldung über den Link fehlgeschlagen: ${linkError}`, 'error');
      history.replaceState(null, '', location.pathname);
    }
  }
}
