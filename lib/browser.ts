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
  premium?: boolean; // Premium-Background-Playback
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
  // X
  grok?: boolean; // Grok-KI entfernen
  trending?: boolean; // Trends entfernen
  // Reddit
  popular?: boolean; // Popular/All → Home
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
  premium: false, // Background-Playback ist ein "Premium"-Komfort, default aus
  reels: true,
  suggested: true,
  friendsOnly: false,
  stories: false,
  messagesOnly: false,
  forYou: true,
  explore: true,
  feedsOnly: false,
  grok: true,
  trending: true,
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

  // Premium-Background-Playback nur wenn Flag gesetzt (YouTube).
  const bgBlock = cfg.premium && bg ? `\n;(function(){ try { ${bg} } catch(e){} })();` : "";

  return `${injectCss}\n;(function(){ try { ${js} } catch(e){} })();${bgBlock}\ntrue;`;
}
