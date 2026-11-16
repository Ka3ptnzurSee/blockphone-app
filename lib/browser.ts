// Dull-Browser-Konfiguration + Injektions-Builder.
// Portiert aus der Dull-App (com.getdull.app): die uBlock-Stil Feed-Filter laufen
// in einem WKWebView (react-native-webview) und werden über window.__dullConfig
// mit Feature-Flags gesteuert.
import { PLATFORM_FILTERS } from "./filters.generated";

// Feature-Flags je Plattform (siehe assets/filters/*/manifest.json "notes").
// true = blockieren/entfernen (maximal "dull").
export type FilterConfig = {
  // YouTube
  shorts?: boolean; // Shorts-Shelves + /shorts/ URLs
  watchRecommendations?: boolean; // Empfehlungs-Rail auf /watch
  bottomNav?: boolean; // untere Navigationsleiste
  ads?: boolean; // Ads (json-prune + Auto-Skip)
  subscriptionsLockdown?: boolean; // Abo-Feed ohne Empfehlungen
  ytBackground?: boolean; // YouTube: Audio läuft im Hintergrund weiter (Komfort, default aus)
  // Instagram
  reels?: boolean; // Reels-Tab + Reel-Links + Einzel-Reel-Lock
  suggested?: boolean; // "Suggested for you" / "Vorgeschlagen"
  friendsOnly?: boolean; // Friends-Only-Feed (nur Following)
  stories?: boolean; // Story-Leiste
  messagesOnly?: boolean; // nur DMs
  forYou?: boolean; // For-You-Tab
  explore?: boolean; // Explore-Feed
  // Facebook
  feedsOnly?: boolean; // nur chronologischer Follow-Feed
  feedVideoHomeRedirect?: boolean; // Reel-/Video-Links auf Home umbiegen
  // X
  grok?: boolean; // Grok-KI entfernen
  trending?: boolean; // Trends entfernen
  suggestions?: boolean; // "Wem folgen"/Vorschlags-Zellen (X liest cfg.suggestions)
  premium?: boolean; // Premium-/Upsell-Werbung entfernen (X)
  // Reddit
  popular?: boolean; // Popular/All → Home
  // Lokalisierung: Labels in der App-Sprache (Dull übergibt sie als cfg.strings)
  strings?: Record<string, string>;
};

export type Platform = keyof typeof PLATFORM_FILTERS;

// Basis-URLs (Mobile-Web-Versionen — identisch zu Dull).
export const PLATFORM_URLS: Record<string, string> = {
  youtube: "https://m.youtube.com",
  instagram: "https://www.instagram.com",
  facebook: "https://m.facebook.com",
  x: "https://x.com",
  reddit: "https://www.reddit.com",
};

// Standard: alles blockieren (maximal "dull").
export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  shorts: true,
  watchRecommendations: true,
  bottomNav: true,
  ads: true,
  subscriptionsLockdown: true,
  ytBackground: false, // Komfort-Feature, nicht Teil von "maximal dull"
  reels: true,
  suggested: true,
  friendsOnly: true, // nur Following statt For-You
  stories: true, // Story-Leiste weg (Reels-Nachbar)
  messagesOnly: false, // DMs bleiben nutzbar
  forYou: true,
  explore: true,
  feedsOnly: true, // chronologischer Follow-Feed
  feedVideoHomeRedirect: true,
  grok: true,
  trending: true,
  suggestions: true,
  premium: true, // Upsell-Werbung weg
  popular: true,
};

// Shim: Dull filter.js spricht über window.webkit.messageHandlers mit Swift.
// In react-native-webview gibt es das nicht → auf ReactNativeWebView.postMessage
// umleiten (als {type:...} JSON, landet in onMessage).
const BRIDGE_SHIM = `(function(){
  try {
    var post = function(m){ try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch(e){} };
    window.webkit = window.webkit || {};
    window.webkit.messageHandlers = window.webkit.messageHandlers || {};
    window.webkit.messageHandlers.dullFilterCount = { postMessage: post };
    window.webkit.messageHandlers.dullReinject = { postMessage: post };
  } catch(e){}
})();`;

// Läuft VOR dem Seiten-Rendering: Config + Bridge setzen (kein DOM-Zugriff).
export function buildBeforeContentScript(cfg: FilterConfig): string {
  return (
    BRIDGE_SHIM +
    "\n" +
    `window.__dullConfig = ${JSON.stringify(cfg)};` +
    "\ntrue;"
  );
}

// Läuft VOR dem Parsen des Bodys: blockierendes CSS sofort setzen, damit
// Werbung/Reels nicht erst sichtbar aufblitzen (die späte Injektion kommt
// zusätzlich nach DOM-ready). Idempotent über #dull-filter.
export function buildEarlyCssScript(platform: Platform): string {
  const f = PLATFORM_FILTERS[platform];
  if (!f || !f.css) return "true;";
  return `(function(){
  var css = ${JSON.stringify(f.css)};
  function apply(){
    try {
      var root = document.head || document.documentElement;
      if (!root) return false;
      var el = document.getElementById('dull-filter');
      if (!el) { el = document.createElement('style'); el.id = 'dull-filter'; root.appendChild(el); }
      if (el.textContent !== css) el.textContent = css;
      return true;
    } catch(e){ return false; }
  }
  if (!apply()) document.addEventListener('DOMContentLoaded', apply, { once: true });
  true;
})();`;
}

// Läuft NACH DOM-ready: CSS injizieren (<style id="dull-filter">) + filter.js ausführen.
// filter.js erwartet window.__dullConfig und prüft periodisch document.getElementById('dull-filter').
export function buildInjectedScript(platform: Platform, cfg: FilterConfig): string {
  const f = PLATFORM_FILTERS[platform];
  if (!f) return "true;";
  const css = f.css || "";
  const js = f.js || "";
  const bg = f.bg || "";

  const injectCss = `(function(){
    var css = ${JSON.stringify(css)};
    var el = document.getElementById('dull-filter') || document.createElement('style');
    el.id = 'dull-filter';
    el.textContent = css;
    if (!el.parentNode && document.head) document.head.appendChild(el);
  })();`;

  // Background-Playback nur wenn Flag gesetzt (YouTube).
  const bgBlock = cfg.ytBackground && bg ? `\n;(function(){ try { ${bg} } catch(e){} })();` : "";

  return `${injectCss}\n;(function(){ try { ${js} } catch(e){} })();${bgBlock}\ntrue;`;
}

// ─── Brücken-Nachrichten (WebView → RN) ───────────────────────────────────────
// Obergrenze für onMessage-Payloads: alles Größere wird verworfen, BEVOR es
// JSON.parse erreicht (RAM-/DoS-Schutz gegen feindliche WebView-Inhalte).
export const MAX_BRIDGE_MESSAGE_BYTES = 65536;

export function parseBridgeMessage(data: string): Record<string, unknown> | null {
  if (typeof data !== "string" || data.length === 0 || data.length > MAX_BRIDGE_MESSAGE_BYTES) {
    return null;
  }
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* kein JSON / kaputt → verwerfen */
  }
  return null;
}

// ─── Unsaved-Usage-Ledger ─────────────────────────────────────────────────────
// Ein fehlgeschlagenes addUsage darf keine Sekunden verlieren: verbrauchte Zeit
// wird gepuffert und beim nächsten Flush nachgeliefert (statt still verworfen).
export type UsageLedger = { pending: number };

export function ledgerAccrue(ledger: UsageLedger, elapsed: number): number {
  const total = Math.max(0, ledger.pending + Math.max(0, elapsed));
  ledger.pending = total;
  return total;
}

export function ledgerSettle(ledger: UsageLedger, total: number, ok: boolean): void {
  if (ok) ledger.pending = Math.max(0, ledger.pending - total);
  // ok=false: pending bleibt → Sekunden werden beim nächsten Flush nachgeliefert.
}

// ─── Browser-Tab verlassen ─────────────────────────────────────────────────────
// KLEIN/Verlassen darf nie im Browser-Tab enden, sonst bleibt der Layer fullscreen
// und KLEIN wäre ein No-op. Immer auf einen existierenden Nicht-Browser-Tab.
export const BROWSER_TAB = "browser";

/** Tab, zu dem der Vollbild-Browser beim Schließen zurückkehrt ("sperren"). */
export function browserExitTab<T extends string>(activeTab: T): T | "sperren" {
  return activeTab === BROWSER_TAB ? "sperren" : activeTab;
}
