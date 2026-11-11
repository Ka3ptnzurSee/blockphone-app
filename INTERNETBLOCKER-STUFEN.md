# Wie weit kann ein „richtiger" Internetblocker auf iOS gehen?

Vier Stufen, aufsteigend nach Härte. Jede Stufe hat eine andere
Genehmigungs-/Signaturanforderung — das ist der eigentliche Knackpunkt, nicht der Code.

| Stufe | Technik | Sieht | Blockt | Apple-Anforderung | Status hier |
|---|---|---|---|---|---|
| 1 | `NEPacketTunnelProvider` (DNS) | DNS-Pakete | Domains | Network-Extension-Entitlement (**self-serve**) | ✅ gebaut |
| 2 | `NEDNSProxyProvider` | alle DNS-Queries | Domains, Allowlist | dito, **self-serve** | offen |
| 3 | `NEFilterDataProvider` (Content Filter) | **jeden TCP/UDP-Flow** | Host, IP, Port, **pro App** | `get-task-allow` (Dev-Build) **oder supervised Gerät** | offen |
| 4 | `FamilyControls` + `ManagedSettings` (Shield) | App-Starts | ganze Apps, Löschschutz | **Apple-Freigabe pro Bundle-ID** | Antrag offen |

## Stufe 1 — was jetzt läuft

Paket-Tunnel mit eigenem DNS-Server auf `10.8.0.1`. Der Tunnel parst rohe
IP/UDP-Pakete, beantwortet geblockte Namen mit NXDOMAIN und leitet den Rest per
DoT (Port 853) weiter, mit UDP/53 als Fallback.

**Grenzen, ehrlich:**
- Blockt nur DNS. Eine App mit eigener DoH-Auflösung (Chrome „Secure DNS",
  WhatsApp, TikTok) oder mit hartkodierter IP kommt durch.
- IPv6 wird nicht bedient (nur IPv4-Routen im Tunnel).
- Der Paket-Parser ist der fragilste Teil des ganzen Systems.

**Neu: Allowlist-Modus.** `mode: "allowlist"` dreht die Logik um — alles wird
gesperrt, was nicht ausdrücklich erlaubt ist. Das ist der echte
„Internet-aus"-Schalter, ohne dass eine einzige Domain geblockt werden muss.

## Stufe 2 — DNS-Proxy statt Paket-Tunnel

`NEDNSProxyProvider` bekommt jede DNS-Anfrage als `NEAppProxyUDPFlow`
hingereicht. Kein virtuelles Interface, kein MTU, kein Paket-Parsing, kein
IPv4/IPv6-Problem. Konfiguration kommt über `startProxy(options:)` — also
derselbe Trick wie heute, ohne App Group.

Gleiche Wirkung wie Stufe 1, aber deutlich robuster. **Der Umstieg lohnt sich,
sobald Stufe 1 zickt.**

## Stufe 3 — der echte Blocker (Content Filter)

`NEFilterDataProvider.handleNewFlow(_:)` bekommt **jede** Verbindung:
`NEFilterSocketFlow` liefert `remoteHostname`, `remoteEndpoint` und über
`sourceAppAuditToken`/`sourceAppIdentifier` die **App, die die Verbindung
aufbaut**. Damit ist pro-App-Blocking möglich — Instagram kann kein Netz mehr
bekommen, egal über welchen Resolver.

Apple-Doku, wörtlich:

> „In product builds for distribution, Network Content Filter configurations can
> be created only on supervised devices. During development and testing you can
> temporarily override this restriction by signing your build with the
> `get-task-allow` entitlement."

Daraus folgen zwei Wege:

- **Für dein eigenes iPhone:** Dev-signierter Build (`get-task-allow = true`,
  also ein *Development*-Profil, nicht Ad-Hoc). Läuft auf einem normalen,
  nicht-supervisierten Gerät. Genau das haben wir gerade nicht — unser
  Ad-Hoc-Profil hat `get-task-allow = false`.
- **Für den App Store:** nur mit supervisierten Geräten (MDM/Apple Configurator).
  Für eine Selbstkontroll-App ist das keine Option.

**Was dafür noch fehlt:** ein App Group (`group.com.meister.blockphone`), weil
der Filter-Data-Provider in einer Sandbox ohne Netzzugriff läuft und seine Regeln
nur über einen geteilten Container bekommt. App Groups lassen sich **nicht** über
die App-Store-Connect-API anlegen — nur im Developer-Portal.

## Stufe 4 — Shield

Blockt die App selbst (eigener Sperrbildschirm) und kann mit `.child`-Autorisierung
sogar das Löschen verhindern. Braucht Apples Family-Controls-Freigabe pro
Bundle-ID. Auf iOS 26.4+ schützt zusätzlich der Screen-Time-Code die
App-Berechtigung — das ist der praktikabelste „nicht löschbar"-Weg.

## Reihenfolge, die ich empfehle

1. Stufe 1 mit Allowlist-Modus ausprobieren (ist gebaut).
2. Wenn das im Alltag hält: Stufe 2 als Ersatz für den Paket-Parser.
3. Stufe 3 nur, wenn pro-App-Blocking wirklich gebraucht wird — kostet
   Dev-Signing + App Group im Portal.
4. Stufe 4 parallel: Anträge bei Apple stellen, das dauert am längsten.
