# Backend (Convex) — optionaler Server-Teil

Blockphone ist **client-only by design**: Sperren, DNS-Filter, Limits und
Streaks laufen komplett auf dem Gerät. Der **einzige** Server-Bestandteil ist
der Freunde-/Leaderboard-Teil in `convex/`.

## Ist-Zustand (16.11.2026)

| Punkt | Status |
|---|---|
| Schema + Funktionen | fertig: `convex/schema.ts` (users, friendships, streakReports), `convex/leaderboard.ts` (list, reportStreak, friendsOf, requestFriend) |
| Deployment | **nicht deployt** — `~/.convex` existiert nicht, kein Account-Login hinterlegt |
| Build-Verdrahtung | `EXPO_PUBLIC_CONVEX_URL` ist **nirgends** gesetzt → `convexConfigured() === false` |
| App-Verhalten | Leaderboard-Tab zeigt „Nicht konfiguriert"; kein Crash, kein Netzwerk-Call |

Deshalb gibt es aktuell **null Server-Traffic** aus der App.

## Einschalten (2 Schritte)

```bash
# 1) einmalig: Login + Deployment anlegen (interaktiv, Browser/Device-Flow)
npx convex dev --once          # legt Deployment an, schreibt convex/_generated/

# 2) URL in den Build hängen (schreibt eas.json + .env.local)
node scripts/convex-deploy.mjs
```

`scripts/convex-deploy.mjs` liest die Deployment-URL aus
`npx convex deployment info` (bzw. aus `CONVEX_URL`) und trägt sie als
`EXPO_PUBLIC_CONVEX_URL` in `eas.json → build.{preview,production}.env` ein.
Damit landet sie beim Build im Bundle (Expo inlined `EXPO_PUBLIC_*`).

## Wenn kein Server gewünscht ist

Dann bleibt es wie jetzt. Der Code schadet nicht: er ist lazy, ohne URL
passiert nichts, und `convexConfigured()` schaltet die UI ehrlich auf
„nicht konfiguriert". Alternative wäre, `convex/`, `lib/convexClient.ts` und
`components/Leaderboard.tsx` zu löschen — dann fällt der Freunde-Tab weg.
