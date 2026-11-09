// Tests für die In-App-URL-Policy (kein Handoff, keine Redirect-Umgehung).
import assert from "node:assert/strict";
import { test } from "node:test";
import { isInAppAllowed } from "./urlPolicy.ts";

test("normale Plattform-URLs bleiben in der App", () => {
  for (const u of [
    "https://m.youtube.com/watch?v=abc",
    "https://www.instagram.com/reel/xyz/",
    "https://m.facebook.com/home.php",
    "https://x.com/home",
    "https://www.reddit.com/r/all",
    "http://192.168.0.10:8080/admin",
  ]) {
    assert.equal(isInAppAllowed(u), true, u);
  }
});

test("Login-/Consent-Subdomains bleiben erlaubt", () => {
  assert.equal(isInAppAllowed("https://accounts.google.com/o/oauth2/auth"), true);
  assert.equal(isInAppAllowed("https://consent.youtube.com/m?continue=x"), true);
});

test("Custom Schemes werden verworfen (kein App-Handoff)", () => {
  for (const u of [
    "youtube://watch?v=1",
    "instagram://media?id=1",
    "intent://scan#Intent;end",
    "itms-apps://apps.apple.com/de/app/x",
    "tel:+4915112345678",
    "mailto:a@b.c",
    "javascript:alert(1)",
    "data:text/html,<h1>x</h1>",
    "about:blank",
    "file:///etc/passwd",
    "ftp://example.com/x",
  ]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
});

test("Trailing-Dot / ideographischer Punkt umgehen den Host-Block nicht", () => {
  for (const u of [
    "https://apps.apple.com./de/app/x",
    "https://apps.apple.com../de/app/x",
    "https://apps.apple.com%2e/de/app/x",
    "https://apps.apple.com\u3002/de/app/x",
    "https://PLAY.GOOGLE.COM./store/apps/details?id=x",
    "https://t.co./abc",
  ]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
});

test("Weiterleitungs-Hosts (Shortener/Ausgangs-Hops) werden geblockt", () => {
  for (const u of [
    "https://t.co/abc",
    "https://out.reddit.com/t3_xyz",
    "https://l.facebook.com/l.php?u=https://evil.tld",
    "https://lm.facebook.com/x",
    "https://goo.gl/x",
    "https://bit.ly/x",
    "https://tinyurl.com/x",
  ]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
  // youtu.be ist ein legitimer Kurz-Link auf YouTube → bleibt erlaubt.
  assert.equal(isInAppAllowed("https://youtu.be/dQw4w9WgXcQ"), true);
});

test("Store-/Geräte-Hosts werden geblockt (auch als Subdomain)", () => {
  for (const u of [
    "https://apps.apple.com/de/app/blockphone/id123",
    "https://itunes.apple.com/de/app/x",
    "https://testflight.apple.com/join/abc",
    "https://play.google.com/store/apps/details?id=x",
    "https://appgallery.huawei.com/app/C123",
  ]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
  // Ähnliche, aber fremde Hosts bleiben erlaubt.
  assert.equal(isInAppAllowed("https://apps.apple.com.evil.tld/x"), true);
});

test("Redirect-Endpunkte werden geblockt", () => {
  for (const u of [
    "https://m.youtube.com/redirect?q=https://evil.tld",
    "https://m.youtube.com/redirect/abc",
    "https://m.facebook.com/l.php?u=https://evil.tld",
    "https://l.facebook.com/l.php?u=x",
    "https://www.reddit.com/away?to=x",
    "https://x.com/redirect?q=x",
    "https://x.com/linkshim/x",
    "https://x.com/flx/warn/?u=x",
    "https://x.com/exit?to=x",
  ]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
});

test("attribution_link (YouTube-Ausgang) wird geblockt", () => {
  assert.equal(
    isInAppAllowed("https://www.youtube.com/attribution_link?a=1&u=https%3A%2F%2Fevil.tld"),
    false,
  );
  assert.equal(isInAppAllowed("https://www.youtube.com/attribution_link?u=x"), false);
});

test("NUL- und Steuerzeichen verschieben die Pfad-Grenze nicht", () => {
  assert.equal(isInAppAllowed("https://m.youtube.com/redirect%00?q=x"), false);
  assert.equal(isInAppAllowed("https://m.youtube.com/redirect%2500?q=x"), false);
  assert.equal(isInAppAllowed("https://m.youtube.com/re%09direct?q=x"), false);
});

test("benigne Subpfade werden NICHT geblockt (keine False Positives)", () => {
  for (const u of [
    "https://example.com/foo/away/bar",
    "https://example.com/path/redirect/page",
    "https://m.youtube.com/watch?v=redirect",
    "https://www.reddit.com/r/redirect",
    "https://x.com/exitpoll",
    "https://example.com/linkshimfoo",
  ]) {
    assert.equal(isInAppAllowed(u), true, u);
  }
});

test("Doppelt kodierte Redirect-Pfade werden ebenfalls geblockt", () => {
  assert.equal(isInAppAllowed("https://m.youtube.com/%252Fredirect%253Fq%253Dx"), false);
  assert.equal(isInAppAllowed("https://m.youtube.com/re%64irect?q=x"), false);
});

test("Breitzeichen (NFKC) umgehen den Redirect-Block nicht", () => {
  assert.equal(isInAppAllowed("https://m.youtube.com/\uFF0Fredirect?q=x"), false);
  // Fail-closed: ein reiner Redirect-Pfad wird auch auf fremden Hosts geblockt.
  assert.equal(isInAppAllowed("https://evil.com/\uFF52\uFF45\uFF44\uFF49\uFF52\uFF45\uFF43\uFF54"), false);
  assert.equal(isInAppAllowed("https://m.youtube.com/\uFF52\uFF45\uFF44\uFF49\uFF52\uFF45\uFF43\uFF54?q=x"), false);
});

test("kaputte Prozentfolge wird als Literal behandelt, nicht als Block", () => {
  assert.equal(isInAppAllowed("https://m.youtube.com/%E0%A4%A"), true);
  assert.equal(isInAppAllowed("https://m.youtube.com/watch?v=%E0%A4%A"), true);
});

test("literales Prozentzeichen blockt die URL nicht (kein False Positive)", () => {
  for (const u of [
    "https://example.com/50%25off",
    "https://example.com/100%25",
    "https://example.com/a%25b/redirect",
  ]) {
    assert.equal(isInAppAllowed(u), true, u);
  }
  // Redirect bleibt auch mit kaputter Prozentfolge dahinter erkannt.
  assert.equal(isInAppAllowed("https://m.youtube.com/redirect?q=%zz"), false);
});

test("Müll und kaputte Kodierung → fail-closed", () => {
  // "%40" in der Autorität ist kein Userinfo-Trick, sondern schlicht ungültig.
  for (const u of ["", " ", "nicht eine url", "//", "https://", "https://play.google.com%40evil.tld/x"]) {
    assert.equal(isInAppAllowed(u), false, JSON.stringify(u));
  }
  assert.equal(isInAppAllowed(undefined as never), false);
  assert.equal(isInAppAllowed(null as never), false);
});

test("Groß-/Kleinschreibung und Ports ändern nichts", () => {
  assert.equal(isInAppAllowed("HTTPS://M.YOUTUBE.COM/REDIRECT?Q=x"), false);
  assert.equal(isInAppAllowed("https://m.youtube.com:443/redirect?q=x"), false);
  assert.equal(isInAppAllowed("https://m.youtube.com:443/watch?v=1"), true);
});

test("Open-Redirect-Endpunkte mit Datei-Endung werden geblockt", () => {
  for (const u of [
    "https://evil.tld/redirect.php?url=https://apps.apple.com",
    "https://evil.tld/redir.html",
    "https://evil.tld/exit.jsp?u=https://evil.tld",
    "https://evil.tld/away.aspx",
    "https://evil.tld/l.php?u=https://evil.tld",
    "https://evil.tld/linkshim.cgi",
    "https://evil.tld/redirect.do",
  ]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
  // Normale Pfade mit denselben Wörtern bleiben erlaubt.
  for (const u of ["https://news.tld/exit-polls", "https://news.tld/redirectory"]) {
    assert.equal(isInAppAllowed(u), true, u);
  }
});

test("Userinfo (Store-Host als Lockvogel) wird geblockt", () => {
  for (const u of [
    "https://apps.apple.com@evil.tld/x",
    "https://user:pw@evil.tld/x",
  ]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
});

test("Backslash wird wie im Browser als Pfadtrenner bewertet", () => {
  // Normalisiert man NICHT, parst new URL() den Host hinter dem Backslash
  // (nach "@") — also z. B. evil.tld — und der Handoff-Host bleibt unsichtbar.
  // Mit Normalisierung sieht die Policy denselben Host wie die WebView.
  for (const u of [
    "https://apps.apple.com\\@evil.tld/x",
    "https://play.google.com\\@evil.tld/store",
    "https://t.co\\\\@evil.tld/abc",
  ]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
  // Host vor dem Backslash bleibt der echte Host -> erlaubt (kein Handoff).
  assert.equal(isInAppAllowed("https://m.youtube.com\\@apps.apple.com/x"), true);
  assert.equal(isInAppAllowed("https://m.youtube.com/watch?v=1&t=a\\b"), true);
});

test("Absurd lange / tief kodierte Pfade werden gedeckelt (kein JS-Freeze)", () => {
  // Quadratisches Nachdekodieren war ein DoS: Deckel + Längengrenze greifen.
  assert.equal(isInAppAllowed("https://evil.tld/" + "%25".repeat(20000)), false);
  assert.equal(isInAppAllowed("https://evil.tld/" + "a".repeat(9000)), false);
  // Realistische Kodierungstiefe bleibt erkannt.
  assert.equal(isInAppAllowed("https://m.youtube.com/%25252Fredirect?q=x"), false);
  assert.equal(isInAppAllowed("https://m.youtube.com/" + "a".repeat(200)), true);
});

test("Tief kodierte Redirect-Pfade bleiben geblockt (Dekodier-Deckel = fail-closed)", () => {
  for (const enc of ["%25252F", "%2525252F", "%252525252F", "%25252525252F", "%2525252525252F"]) {
    assert.equal(isInAppAllowed(`https://evil.tld/${enc}redirect`), false, enc);
  }
  // Harmlose kodierte Pfade bleiben erlaubt (kein Overblocking).
  assert.equal(isInAppAllowed("https://x.com/%2520share"), true);
  assert.equal(isInAppAllowed("https://x.com/100%25"), true);
  assert.equal(isInAppAllowed("https://x.com/a%2Fb"), true);
});

test("Vollbreit-% wird vor dem Kodierungs-Check gefaltet (fail-closed)", () => {
  for (const u of ["https://evil.tld/％2fredirect", "https://evil.tld/％252Fredirect"]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
  assert.equal(isInAppAllowed("https://evil.tld/％20share"), true);
});

test("Kodierte Einzelzeichen und kodierter Backslash bleiben geblockt", () => {
  // "%72edirect" = "/redirect", vom Server dekodiert; tief kodiert bleibt es als
  // Prozent-Escape stehen → fail-closed.
  assert.equal(isInAppAllowed("https://evil.tld/%252525252525252572edirect"), false);
  assert.equal(isInAppAllowed("https://evil.tld/%72edirect"), false); // dekodiert sofort zu /redirect
  // "%5c" dekodiert zu "\" und muss wie "/" behandelt werden.
  assert.equal(isInAppAllowed("https://evil.tld/%5credirect"), false);
  assert.equal(isInAppAllowed("https://evil.tld/%255credirect"), false);
  // Literale Prozentzeichen in harmlosen Pfaden blocken weiterhin nicht.
  assert.equal(isInAppAllowed("https://x.com/100%25"), true);
  assert.equal(isInAppAllowed("https://x.com/rabatt-50%"), true);
});

test("Vollbreit-Hosts umgehen die Host-Blöcke nicht", () => {
  // React Natives URL-Polyfill normalisiert IDNA nicht — die Policy muss falten.
  for (const u of [
    "https://apps．apple.com/de/app/x",
    "https://ａｐｐｓ．ａｐｐｌｅ．ｃｏｍ/",
    "https://t．co/abc",
    "https://ｐｌａｙ．ｇｏｏｇｌｅ．ｃｏｍ/store",
  ]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
});

test("Sehr tief kodierter Redirect-Pfad rutscht nicht durch (Deckel 96)", () => {
  const enc = (depth: number, s = "/redirect") => {
    let out = s;
    for (let i = 0; i < depth; i++) out = out.replace(/%/g, "%25").replace(/\//g, "%2F");
    return out;
  };
  for (const d of [13, 16, 17, 20, 30, 40]) {
    assert.equal(isInAppAllowed(`https://evil.tld${enc(d)}`), false, `Tiefe ${d}`);
  }
});

test("IDNA-Dotvarianten (。｡) umgehen die Host-Blöcke nicht", () => {
  for (const u of [
    "https://apps。apple。com/de/app/x",
    "https://apps｡apple｡com/de/app/x",
    "https://out。reddit。com/t3_xyz",
    "https://t。co/abc",
  ]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
  // Node/IDNA wandelt IDN in Punycode (ASCII) -> erlaubt. Im RN-Polyfill bleibt der
  // Host non-ASCII und wird von ASCII_HOST fail-closed abgelehnt (hier nicht
  // erzwingbar, weil Node vorher normalisiert).
  assert.equal(isInAppAllowed("https://münchen.example/x"), true);
  assert.equal(isInAppAllowed("https://xn--mnchen-3ya.example/x"), true);
  assert.equal(isInAppAllowed("http://192.168.0.10:8080/admin"), true);
});

test("Dot-Segmente aus Prozent-Kodierung hebeln den Anker nicht aus", () => {
  for (const u of [
    "https://evil.tld/%2e%2e%2fredirect",
    "https://evil.tld/%2E./redirect?to=x",
    "https://evil.tld/..%2fredirect",
    "https://evil.tld/./redirect",
    "https://evil.tld/%252e%252e%252fredirect",
  ]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
  // Normale Pfade mit Dots bleiben erlaubt.
  assert.equal(isInAppAllowed("https://www.reddit.com/./r/all?x=1"), true);
});

test("Ein kaputtes %-Escape legt die Dekodierkette nicht lahm", () => {
  // Doppelt kodierte Redirects hinter einem kaputten Escape: die gültigen
  // %XX-Sequenzen müssen trotzdem dekodiert werden (vorher fail-open).
  for (const u of [
    "https://evil.tld/%252Fredirect%zz",
    "https://evil.tld/%25252Fredirect%zz",
  ]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
  // Ein unauflösbares Segment ist ein anderes Pfadsegment, kein Redirect —
  // der Pfad beginnt nicht mit dem Redirect-Token, also kein Overblocking.
  for (const u of ["https://evil.tld/%zz%2fredirect", "https://evil.tld/%E0%A4%A/redirect"]) {
    assert.equal(isInAppAllowed(u), true, u);
  }
  // Ungültige Kodierung ohne Redirect bleibt erlaubt (kein Overblocking).
  assert.equal(isInAppAllowed("https://www.instagram.com/p/%zzabc/"), true);
});

test("Universal-Link-/Deep-Link-Brücken bleiben NICHT in der App (Handoff)", () => {
  for (const u of [
    "https://t.me/somechannel",
    "https://wa.me/4915112345678",
    "https://open.spotify.com/track/abc",
    "https://music.apple.com/de/album/x",
    "https://maps.apple.com/?q=dresden",
  ]) {
    assert.equal(isInAppAllowed(u), false, u);
  }
});

test("Absurd lange URLs/Hosts werden verworfen (kein Durchlauf über Riesenstrings)", () => {
  assert.equal(isInAppAllowed(`https://www.reddit.com/${"a".repeat(20000)}`), false);
  assert.equal(isInAppAllowed(`https://${"a".repeat(300)}.com/`), false);
  assert.equal(isInAppAllowed(""), false);
});

test("Steuerzeichen im Pfad = fail-closed (kein /redirect\\0evil-Trick)", () => {
  assert.equal(isInAppAllowed("https://evil.tld/redirect\u0000evil"), false);
  assert.equal(isInAppAllowed("https://evil.tld/%2fredirect%0aevil"), false);
  // Unauffällige Pfade bleiben erlaubt.
  assert.equal(isInAppAllowed("https://www.reddit.com/r/all"), true);
});
