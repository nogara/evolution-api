# purple-baileys — @lid detail

## What a LID is

WhatsApp privacy addressing: some 1:1 and group participants appear as `<digits>@lid`
(`key.addressingMode === 'lid'`) instead of `<phone>@s.whatsapp.net`. The digits are an opaque
identifier, not a phone number.

## Where the phone number (PN) can come from

| Source | Field | Code |
|---|---|---|
| Received message key | `key.remoteJidAlt` (1:1), `key.participantAlt` (groups) | `whatsapp.baileys.service.ts:159-160` (key type), `:1250-1251`, `:1478`, `:1516-1517` |
| Group metadata | participant entries returned by Baileys group metadata | group fetch paths (shape depends on Baileys version — verify) |
| History sync | message keys in `messaging-history.set` | `whatsapp.baileys.service.ts:927` |
| On-WhatsApp cache | `jidOptions`, `lid` | `src/utils/onWhatsappCache.ts:73`, `:182` |

If none of these has been observed, the PN is unknown. Reply to the LID JID.

## Outbound

- `createJid` keeps `@lid`, `@g.us`, `@s.whatsapp.net`, `@broadcast` untouched
  (`src/utils/createJid.ts:38-44`); only bare numbers get normalized (BR/MX/AR rules at `:2`, `:17`).
- `whatsappNumber` (`whatsapp.baileys.service.ts:3507`) resolves users from the cache first, then
  calls `client.onWhatsApp` only for non-LID JIDs (`:3562-3566`). An uncached LID returns
  `exists: true` with `lid: 'lid'` (`:3586-3594`).

## Known failure modes

- Stripping `@lid` and sending to `<digits>@s.whatsapp.net` → 400 "exists: false" from the guard
  or delivery to the wrong account.
- Treating `remoteJid` as the stable chat key: the swap at `:1478-1480` means the same chat can
  arrive as PN or LID depending on whether `remoteJidAlt` was present.
- Persisting a LID as a phone number in consumer CRMs. Consumers must read `remoteJidAlt`
  (orbit: `orbit-backend/src/evolution-api-webhook/evolution-api-webhook.service.ts:227-231`;
  stenfar: `canal-stenfar/src/services/whatsapp/phoneExtractor.js:35-44`).

## Manual verification matrix

1. 1:1 inbound from a PN contact → `remoteJid` is `@s.whatsapp.net`.
2. 1:1 inbound from a LID contact with alt → `remoteJid` swapped to PN, `remoteJidAlt` kept.
3. Group inbound with LID participant → `participant` LID, `participantAlt` PN when present.
4. Outbound to a LID JID → delivered; no 400.
5. Outbound to an unknown PN → `onWhatsApp` check, 400 when not registered.
