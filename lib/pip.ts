// Kleinbild (Picture-in-Picture) für den In-App-Browser.
//
// Warum es diesen Umweg braucht:
//  - iOS WKWebView kennt die W3C-PiP-API nicht (kein document.pictureInPictureEnabled,
//    kein HTMLVideoElement.requestPictureInPicture). Ein PiP-Knopf *auf der Seite*
//    (YouTube & Co.) kann also nichts auslösen.
//  - Der einzige Weg ist die WebKit-eigene API video.webkitSetPresentationMode('picture-in-picture').
//    Die muss die App selbst aufrufen — deshalb injizieren wir ein Script und feuern es
//    über webviewRef.injectJavaScript().
//  - Damit das Script nicht gegen unendliche Grenzen läuft, ist es idempotent:
//    window.__pbPip wird beim ersten Lauf gesetzt, jeder weitere Aufruf startet nur PiP.
//  - Zusätzlich hängt sich das Script an visibilitychange (capture) und startet PiP selbst,
//    wenn die App in den Hintergrund geht — dort, wo iOS die Seite auf "hidden" setzt.

export const PIP_MESSAGE_TYPE = "pbPip";

export type PipResult = { ok: boolean; reason: string; via?: string };

/** Nachricht aus dem WebView robust einordnen (nur eigene pbPip-Meldungen). */
export function parsePipMessage(data: unknown): PipResult | null {
  if (typeof data !== "string") return null;
  if (data.length === 0 || data.length > 4096) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  if (m.type !== PIP_MESSAGE_TYPE) return null;
  const ok = m.ok === true;
  const rawReason = typeof m.reason === "string" ? m.reason.trim().slice(0, 120) : "";
  const reason = rawReason.length > 0 ? rawReason : ok ? "ok" : "unbekannt";
  const via = typeof m.via === "string" ? m.via.trim().slice(0, 24) : undefined;
  return via && via.length > 0 ? { ok, reason, via } : { ok, reason };
}

/** Kurzer Status für die Chrome-Zeile. */
export function pipStatusText(result: PipResult | null): string {
  if (!result) return "KLEINBILD: KEINE ANTWORT";
  if (result.ok) return "KLEINBILD AN";
  switch (result.reason) {
    case "kein-video":
      return "KLEINBILD: KEIN VIDEO";
    case "api-blockiert":
      return "KLEINBILD BLOCKIERT";
    case "kein-pip":
      return "KLEINBILD NICHT VERFÜGBAR";
    default:
      return `KLEINBILD: ${result.reason.toUpperCase()}`;
  }
}

/**
 * Script, das im WebView das gerade laufende Video sucht und PiP startet.
 * Idempotent: mehrfaches Injizieren installiert nichts doppelt.
 */
export function buildPipScript(): string {
  const lines = [
    "(function () {",
    "  'use strict';",
    "  function post(payload) {",
    "    try {",
    "      if (!window.ReactNativeWebView || typeof window.ReactNativeWebView.postMessage !== 'function') {",
    "        return false;",
    "      }",
    "      window.ReactNativeWebView.postMessage(JSON.stringify(payload));",
    "      return true;",
    "    } catch (e) {",
    "      return false;",
    "    }",
    "  }",
    "  function area(v) {",
    "    try { var r = v.getBoundingClientRect(); return (r.width || 0) * (r.height || 0); } catch (e) { return 0; }",
    "  }",
    "  function videos() {",
    "    try { return Array.prototype.slice.call(document.querySelectorAll('video')); } catch (e) { return []; }",
    "  }",
    "  function primary() {",
    "    var list = videos().filter(function (v) { return !!v && v.videoWidth > 0; });",
    "    var playing = list.filter(function (v) { return !v.paused && !v.ended; });",
    "    var pool = playing.length ? playing : list;",
    "    pool.sort(function (a, b) { return area(b) - area(a); });",
    "    return pool[0] || null;",
    "  }",
    "  function unlock(v) {",
    "    try { v.removeAttribute('disablePictureInPicture'); } catch (e) {}",
    "    try { v.removeAttribute('disablepictureinpicture'); } catch (e) {}",
    "    try {",
    "      Object.defineProperty(v, 'disablePictureInPicture', {",
    "        configurable: true,",
    "        get: function () { return false; },",
    "        set: function () {}",
    "      });",
    "    } catch (e) {}",
    "  }",
    "  // Zweitton vermeiden: der YouTube-Hintergrund-Hack spiegelt Audio auf ein",
    "  // verstecktes <video>. Sobald PiP läuft, dürfen alle anderen stumm sein.",
    "  function muteOthers(v) {",
    "    videos().forEach(function (o) {",
    "      if (o !== v) { try { o.muted = true; } catch (e) {} }",
    "    });",
    "  }",
    "  function attempt() {",
    "    // Bridge fehlt → degradieren: kein PiP-Versuch, sonst arbeitet das Script",
    "    // ins Leere (nichts kann zurück zur App).",
    "    if (!window.ReactNativeWebView || typeof window.ReactNativeWebView.postMessage !== 'function') {",
    "      return false;",
    "    }",
    "    var v = primary();",
    "    if (!v) { post({ type: 'pbPip', ok: false, reason: 'kein-video' }); return false; }",
    "    unlock(v);",
    "    // Autoplay-Block nicht still verschlucken: als Grund melden, PiP trotzdem versuchen.",
    "    try {",
    "      if (v.paused && typeof v.play === 'function') {",
    "        var p = v.play();",
    "        if (p && typeof p.catch === 'function') {",
    "          p.catch(function () {",
    "            post({ type: 'pbPip', ok: false, reason: 'autoplay-blockiert' });",
    "          });",
    "        }",
    "      }",
    "    } catch (e) {",
    "      post({ type: 'pbPip', ok: false, reason: 'autoplay-blockiert' });",
    "    }",
    "    // webkitSetPresentationMode: Aufruf ohne Exception = Erfolg. Der Übergang ist",
    "    // async — ein synchroner webkitPresentationMode-Check meldete fälschlich 'kein-pip'.",
    "    // Existiert das Feld, bestätigt ein einmaliger 'presentationmodechanged'-Listener",
    "    // (1200ms-Timeout + Cleanup) den präzisen Status. Kein doppeltes Posten.",
    "    var settled = false;",
    "    function announceOk() {",
    "      if (settled) return;",
    "      settled = true;",
    "      muteOthers(v);",
    "      post({ type: 'pbPip', ok: true, reason: 'ok', via: 'webkit' });",
    "    }",
    "    function announceFail(reason) {",
    "      if (settled) return;",
    "      settled = true;",
    "      post({ type: 'pbPip', ok: false, reason: reason });",
    "    }",
    "    try {",
    "      if (typeof v.webkitSetPresentationMode === 'function') {",
    "        v.webkitSetPresentationMode('picture-in-picture');",
    "        if ('webkitPresentationMode' in v) {",
    "          var onMode = function () {",
    "            if (v.webkitPresentationMode === 'picture-in-picture') announceOk();",
    "            else announceFail('kein-pip');",
    "          };",
    "          try { v.addEventListener('presentationmodechanged', onMode); } catch (e) {}",
    "          setTimeout(function () {",
    "            if (!settled) {",
    "              try { v.removeEventListener('presentationmodechanged', onMode); } catch (e) {}",
    "              announceOk();",
    "            }",
    "          }, 1200);",
    "        } else {",
    "          announceOk();",
    "        }",
    "        return true;",
    "      }",
    "    } catch (e) {",
    "      announceFail('piP-fehler');",
    "      return true;",
    "    }",
    "    try {",
    "      if (typeof v.requestPictureInPicture === 'function' && document.pictureInPictureEnabled) {",
    "        v.requestPictureInPicture().then(function () {",
    "          muteOthers(v);",
    "          post({ type: 'pbPip', ok: true, reason: 'ok', via: 'api' });",
    "        }, function (err) {",
    "          post({ type: 'pbPip', ok: false, reason: 'api-blockiert', via: String((err && err.name) || '').slice(0, 24) });",
    "        });",
    "        return true;",
    "      }",
    "    } catch (e) {}",
    "    post({ type: 'pbPip', ok: false, reason: 'kein-pip' });",
    "    return false;",
    "  }",
    "  window.__pbPip = attempt;",
    "  if (!window.__pbPipAuto) {",
    "    window.__pbPipAuto = true;",
    "    // capture: VOR dem Pause-Handler der Seite (YouTube pausiert bei hidden).",
    "    document.addEventListener('visibilitychange', function () {",
    "      if (document.hidden) attempt();",
    "    }, { capture: true, passive: true });",
    "  }",
    "  return attempt();",
    "})();",
    "true;",
  ];
  return lines.join("\n");
}

/** Nur den Trigger injizieren, wenn das Script schon geladen ist (spart Bytes/Zeit). */
export const PIP_TRIGGER_SCRIPT = "window.__pbPip && window.__pbPip(); true;";
