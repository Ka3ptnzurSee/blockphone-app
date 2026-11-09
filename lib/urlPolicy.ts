// In-App-URL-Policy für den eingebauten Browser (pure, testbar).
// Ziel: ALLES bleibt in der App. Kein Handoff an Safari/native Apps, keine
// Umgehung der Prüfung über window.open/target=_blank oder Redirect-Endpunkte.

// Plattform-Redirect-Endpunkte (immer TOP-LEVEL, deshalb `^`-verankert —
// sonst würde z. B. "/foo/redirect/page" fälschlich geblockt).
// `attribution_link` ist YouTubes Ausgangs-Redirector.
// Datei-Endungen (`/redirect.php`, `/redir.html`, `/exit.jsp?u=`) sind der Regelfall
// bei selbstgebauten Open-Redirect-Endpunkten und müssen mit abgedeckt sein.
// `%` als Terminator: ein hier verbliebenes Prozentzeichen ist ein unauflösbares
// Escape (`/redirect%zz`) — fail-closed statt durchrutschen lassen.
export const REDIRECT_PATH_RE =
  /^\/(redirect|redir|away|l\.php|flx\/warn|linkshim|exit|attribution_link)(?:\.(?:php|html?|aspx?|jsp|do|cgi))?(?:[/;?#%]|$)/i;

// Hosts, die reine Weiterleitungen sind (Shortener / Ausgangs-Hops). Sie laden
// ein Ziel außerhalb der WebView und umgehen damit die Policy.
export const REDIRECT_HOST_RE =
  /^(t\.co|out\.reddit\.com|l\.facebook\.com|lm\.facebook\.com|out\.facebook\.com|goo\.gl|tinyurl\.com|bit\.ly)$/i;

// Hosts, die garantiert zu einer anderen App gehören (Stores, Geräte-Apps,
// Universal-Links/Deep-Link-Brücken). WKWebView öffnet Associated Domains
// direkt in der nativen App — das würde die In-App-Blockade umgehen.
export const HANDOFF_HOST_RE =
  /(^|\.)(apps\.apple\.com|itunes\.apple\.com|testflight\.apple\.com|play\.google\.com|appgallery\.huawei\.com|music\.apple\.com|maps\.apple\.com|open\.spotify\.com|t\.me|telegram\.me|wa\.me)$/i;

// Trailing-Dots variieren je Parser ("apps.apple.com.", "apps.apple.com。") und
// würden den `$`-Anker aushebeln. Ebenso Steuerzeichen im Pfad ("/redirect\0").
const TRAILING_DOTS = /[.\u3002\uff0e\uff61]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
// Nur für den Test (globales RegExp hat lastIndex-Zustand).
const HAS_CONTROL = /[\u0000-\u001f\u007f]/;
// UTS46-Dotvarianten, die WKWebView/IDNA zu "." macht und die NFKC NICHT faltet.
// Ohne diese Faltung sähe die Policy "apps。apple。com" als fremden Host.
// (U+30FB "・" gehört NICHT dazu — UTS46 mappt es nicht auf ".".)
const IDNA_DOTS = /[\u3002\uff0e\uff61]/g;
// Nach der Faltung muss ein Host ASCII sein: alles andere wäre ein Host, den der
// native Parser anders liest als die WebView → fail-closed.
const ASCII_HOST = /^[a-z0-9.-]+$/;

// WKWebView/Safari behandeln einen rohen Backslash in http(s)-URLs wie "/"
// (WHATWG "special URL"). Wird die URL unverändert geparst, kann die Policy einen
// anderen Host sehen als der Browser. Deshalb vor dem Parsen auf "/" normieren:
// dann bewertet die Policy exakt die Browser-Sicht.
const BACKSLASHES = /\\/g;
const LEADING_SLASHES = /^\/{2,}/;

// Grenzen gegen Denial-of-Service über absurd lange bzw. tief kodierte Pfade.
// Ungebremstes Nachdekodieren ist quadratisch (ein 40-KB-Pfad aus verschachtelten
// "%25"-Folgen fror den JS-Thread ~0,5 s ein, 2 MB Minuten).
const MAX_PATH_LEN = 8192;
// Auch die Roh-URL und der Hostname werden gedeckelt: NFKC/Lowercase laufen über
// diese Strings, und eine mehrere MB lange URL aus einem Link ist kein Browserziel.
const MAX_URL_LEN = 16384;
const MAX_HOST_LEN = 253;
const MAX_DECODE_PASSES = 8;
// Für die Nachkontrolle reicht der Pfadanfang: REDIRECT_PATH_RE ist `^`-verankert.
// Der Deckel richtet sich nach der Länge, damit auch absurd tief kodierte
// Anfänge ("%2525…2572edirect") noch aufgelöst werden — Arbeit bleibt O(1).
const HEAD_LEN = 256;
const MAX_HEAD_DECODE_PASSES = 96;

// Einzelne %XX-Sequenz (auch überlappend wie "%25xx" → nächster Pass).
const PERCENT_SEQ = /%([0-9a-fA-F]{2})/g;

// Dekodiert iterativ, aber gedeckelt. Wichtig: EIN ungültiges Byte (z. B. "%zz"
// oder ein abgeschnittenes UTF-8-Fragment) darf die Kette NICHT anhalten —
// vorher blieb dadurch "%252Fredirect%zz" kodiert und der Redirect-Endpunkt
// unentdeckt (fail-open). Deshalb: Ganzstring-Dekodierung versuchen, bei Fehler
// jede gültige %XX-Sequenz einzeln ersetzen und weiterdekodieren.
function decodeCapped(value: string, maxPasses: number = MAX_DECODE_PASSES): string {
  let out = value;
  let prev = "";
  for (let i = 0; i < maxPasses && out !== prev; i++) {
    prev = out;
    let next: string | null = null;
    try {
      next = decodeURIComponent(out);
    } catch {
      next = null;
    }
    if (next === null) {
      // Einzelsequenzen dekodieren; multibyte UTF-8 bleibt stehen, ASCII-Token
      // ("%2f", "%72", "%25") kommen durch.
      next = out.replace(PERCENT_SEQ, (m) => {
        try {
          return decodeURIComponent(m);
        } catch {
          return m;
        }
      });
      if (next === out) break;
    }
    out = next;
  }
  return out;
}

// "./redirect", "../redirect", "..\u2215redirect": der URL-Parser löst nur
// literale Dot-Segmente auf, nicht "%2e%2e%2f". Nach dem Dekodieren kann der
// Pfad also mit Dots beginnen und den `^`-Anker von REDIRECT_PATH_RE aushebeln.
const LEADING_DOT_SEGMENTS = /^\/{0,2}(?:\.{1,2}\/)+/;

// Führende "./"-/"../"-Segmente entfernen, damit der `^`-Anker wieder greift.
// Der Pfad beginnt immer mit "/" — die Slashes werden mitgeschluckt.
function collapseLeadingDots(value: string): string {
  let rest = value;
  for (let i = 0; i < 32 && LEADING_DOT_SEGMENTS.test(rest); i++) {
    rest = rest.replace(LEADING_DOT_SEGMENTS, "");
  }
  return `/${rest.replace(/^\/+/, "")}`;
}

// Backslash → "/", Breitzeichen falten, Steuerzeichen entfernen, doppelte
// Schrägstriche am Anfang zusammenziehen ("//redirect" nach Doppel-Dekodierung).
// Reihenfolge: NFKC zuerst (macht aus "／" ein "/" und aus Vollbreit-"％" ein "%"),
// dann Steuerzeichen weg, dann führende Schrägstriche zusammenziehen.
function normalizePath(value: string): string {
  let out = value;
  // NFKC kann unter Hermes ohne Intl-Unterstützung fehlen/werfen — dann bleibt der
  // Pfad unnormalisiert; das darf die Navigation nicht crashen lassen.
  try {
    out = out.normalize("NFKC");
  } catch {
    /* Hermes ohne Intl: unnormalisiert weiterprüfen */
  }
  return out.replace(CONTROL_CHARS, "").replace(BACKSLASHES, "/").replace(LEADING_SLASHES, "/");
}

export function isInAppAllowed(raw: string): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LEN) return false;
  let u: URL;
  try {
    u = new URL(raw.replace(BACKSLASHES, "/"));
  } catch {
    return false;
  }
  // Custom schemes (youtube://, instagram://, intent://, itms-apps:, tel:, …)
  // und alles außer http/https würden die App verlassen.
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  // "https://apps.apple.com@evil.com" zeigt in der Adressleiste den Store, lädt
  // aber evil.com. Userinfo hat in einer Link-Policy nichts zu suchen.
  if (u.username || u.password) return false;

  // Der Host wird in React Native von einem eigenen, IDNA-freien URL-Polyfill
  // geliefert ("apps．apple.com" bleibt dort Vollbreite), während WKWebView per
  // UTS46 zu "apps.apple.com" normalisiert und die native App öffnet. Deshalb
  // auch den Host falten, bevor die Muster greifen — inklusive der Dot-Varianten,
  // die NFKC stehen lässt.
  const host = normalizePath(u.hostname)
    .replace(IDNA_DOTS, ".")
    .toLowerCase()
    .replace(TRAILING_DOTS, "");
  if (!host || host.length > MAX_HOST_LEN || !ASCII_HOST.test(host)) return false;
  if (HANDOFF_HOST_RE.test(host)) return false;
  if (REDIRECT_HOST_RE.test(host)) return false;

  if (u.pathname.length > MAX_PATH_LEN) return false;
  // Steuerzeichen im Pfad NIE entfernen und weiterprüfen: "/redirect\0evil"
  // würde sonst zu "/redirectevil" und der Redirect-Token entkäme (fail-open).
  // Gilt auch für kodierte Varianten ("%0a") — deshalb nach dem Dekodieren erneut.
  if (HAS_CONTROL.test(u.pathname)) return false;
  const decodedPath = decodeCapped(u.pathname);
  if (HAS_CONTROL.test(decodedPath)) return false;
  const path = collapseLeadingDots(normalizePath(decodedPath));
  if (REDIRECT_PATH_RE.test(path)) return false;

  // Nach dem Dekodier-Deckel kann der Anfang noch kodiert sein ("/%72edirect",
  // "/%5credirect"). Nur diesen Anfang weiterdekodieren — Arbeit bleibt O(1),
  // deckt aber jede innerhalb der Pfadlänge erreichbare Kodierungstiefe ab.
  const head = collapseLeadingDots(
    normalizePath(decodeCapped(path.slice(0, HEAD_LEN), MAX_HEAD_DECODE_PASSES)),
  );
  if (REDIRECT_PATH_RE.test(head)) return false;

  // Alle erlaubten http(s)-Origins bleiben in der WebView (Login-/Consent-
  // Subdomains müssen laden, die Filter aktivieren sich per Hostname).
  return true;
}
