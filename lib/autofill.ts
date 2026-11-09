// Injektions-Bausteine für den Passwort-Tresor.
//
// Zwei getrennte Skripte, bewusst asymmetrisch:
//  • Capture  — läuft im WebView und meldet bei einem echten Login-Submit die
//               eingegebenen Werte an die App. Gespeichert wird erst nach
//               Bestätigung im nativen Sheet (kein Auto-Save).
//  • Fill     — wird ausschließlich auf expliziten Tap im nativen Sheet
//               injiziert, prüft vorher die Domain und schreibt in die Felder.
// Eine Seite kann damit keine Secrets auslesen: sie kann höchstens ein
// Fill-Angebot anstoßen, das der Nutzer bestätigen muss.

import { baseDomain } from "./vault";

const BRIDGE = `function __pbPost(m){ try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch(e){} }`;

// Domain-Normalisierung identisch zu lib/vault.ts baseDomain() (inkl. Multi-Label-
// Suffixen) — sonst urteilt der Domain-Guard im WebView anders als die App.
const MULTI_SUFFIX = [
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "co.nz", "net.nz", "org.nz",
  "co.jp", "ne.jp", "or.jp", "co.kr", "co.in", "co.id", "co.za",
  "com.br", "com.mx", "com.ar", "com.tr", "com.tw", "com.sg", "com.hk",
  "com.cn", "com.pl", "com.ua", "com.ru",
  "github.io", "gitlab.io", "pages.dev", "workers.dev", "vercel.app",
  "netlify.app", "herokuapp.com", "appspot.com", "blogspot.com",
  "azurewebsites.net", "cloudfront.net", "s3.amazonaws.com",
];
// MUSS identisch zu baseDomain() in lib/vault.ts rechnen — sonst lehnt der
// WebView-Guard Hosts ab, die die App erlaubt (oder umgekehrt): IP-Literale
// atomar, LÄNGSTES passendes Suffix, ccTLD-Second-Level-Muster.
export const BASE_DOMAIN = `var __pbMulti = ${JSON.stringify(MULTI_SUFFIX)};
var __pbCc = /^(?:co|com|net|org|gov|gob|edu|ac|mil|sch|ne|or|go|nom)\\.[a-z]{2}$/;
function __pbBase(h){
  h = String(h||'').toLowerCase().replace(/^\\s+|\\s+$/g,'').replace(/:\\d+$/,'');
  if (!/^[a-z0-9.-]+$/.test(h)) return ''; // wie baseDomain(): fail-closed
  if (/^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(h)) return h;
  var p = h.split('.').filter(Boolean);
  if (!p.length) return '';
  if (p.length <= 2) return p.join('.');
  for (var i = 0; i < p.length - 1; i++) {
    var sfx = p.slice(i).join('.');
    if (__pbMulti.indexOf(sfx) >= 0 || __pbCc.test(sfx)) return p.slice(Math.max(0, i - 1)).join('.');
  }
  return p.slice(-2).join('.');
}`;

export function buildCaptureScript(): string {
  return `(function(){
  if (window.__pbVaultCapture) return;
  window.__pbVaultCapture = true;
  ${BRIDGE}
  ${BASE_DOMAIN}
  var lastSig = '';
  function usernameFor(pw, scope){
    var root = pw.form || scope || document;
    var inputs = (root.querySelectorAll ? root : document).querySelectorAll('input');
    var best = null;
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i] === pw) continue;
      var t = String(inputs[i].getAttribute('type') || 'text').toLowerCase();
      if (t !== 'text' && t !== 'email' && t !== 'tel') continue;
      if (inputs[i].value) best = inputs[i];
    }
    return best;
  }
  function offer(pw, scope){
    try {
      if (!pw || !pw.value) return;
      var u = usernameFor(pw, scope);
      if (!u || !u.value) return;
      var host = __pbBase(window.location.hostname);
      if (!host) return;
      var sig = host + '\\u0000' + u.value + '\\u0000' + pw.value;
      if (sig === lastSig) return;
      lastSig = sig;
      __pbPost({ type: 'pbVaultOffer', host: host, username: String(u.value).trim(), secret: String(pw.value) });
    } catch(e){}
  }
  function pwIn(scope){
    try { return scope && scope.querySelector ? scope.querySelector('input[type="password"]') : null; } catch(e){ return null; }
  }
  document.addEventListener('submit', function(ev){
    try { offer(pwIn(ev.target), ev.target); } catch(e){}
  }, true);
  document.addEventListener('click', function(ev){
    try {
      var el = ev.target;
      for (var depth = 0; el && el !== document.body && depth < 8; depth++) {
        var tag = el.tagName;
        var isSubmit = tag === 'BUTTON' ||
          (tag === 'INPUT' && /submit|button/i.test(String(el.type || ''))) ||
          el.getAttribute('role') === 'button';
        if (isSubmit) { offer(pwIn(el.closest('form') || document), el.closest('form')); return; }
        el = el.parentElement;
      }
    } catch(e){}
  }, true);
  return true;
})();`;
}

export function buildFillScript(host: string, username: string, secret: string): string {
  return `(function(){
  ${BASE_DOMAIN}
  var expected = ${JSON.stringify(baseDomain(String(host)))};
  if (__pbBase(window.location.hostname) !== expected) return false;
  function setValue(el, value){
    try {
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch(e){ try { el.value = value; } catch(_){} }
  }
  // Nur SICHTBARE Felder füllen: versteckte Honeypot-Felder würden das Secret
  // sonst an die Seite verraten, ohne dass der Nutzer etwas sieht.
  function __pbVisible(el){
    try {
      if (!el || el.disabled || el.readOnly) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      if (el.checkVisibility) {
        try { if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; } catch(e){}
      }
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      // Offscreen-Honeypots (left:-9999px / top:-9999px) abweisen, Felder unterhalb
      // des Folds aber erlauben (echte Logins stehen oft weit unten).
      if (r.right <= 0 || r.bottom <= 0) return false;
      if (r.left > (window.innerWidth || 0) + 2000) return false;
      var st = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (st && (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0')) return false;
      return true;
    } catch(e){ return false; }
  }
  var pw = null;
  var pws = document.querySelectorAll('input[type="password"]');
  for (var i = 0; i < pws.length; i++) { if (__pbVisible(pws[i])) { pw = pws[i]; break; } }
  if (!pw) return false;
  setValue(pw, ${JSON.stringify(String(secret))});
  var inputs = document.querySelectorAll('input');
  for (var j = 0; j < inputs.length; j++) {
    if (inputs[j] === pw || !__pbVisible(inputs[j])) continue;
    var t = String(inputs[j].getAttribute('type') || 'text').toLowerCase();
    if (t !== 'text' && t !== 'email' && t !== 'tel') continue;
    setValue(inputs[j], ${JSON.stringify(String(username))});
    break;
  }
  return true;
})();`;
}
