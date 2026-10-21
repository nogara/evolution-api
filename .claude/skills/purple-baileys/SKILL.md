---
name: purple-baileys
description: >
  Landmarks and invariants of the Baileys channel in evolution-in-purple:
  whatsapp.baileys.service.ts entry points, onWhatsApp guards, the on-WhatsApp cache,
  createJid, @lid (LID) addressing rules, QR / pairing code flow and the Baileys version pin.
  Read BEFORE touching message receive/send, JID handling or connection logic.
  Trigger: change in whatsapp.baileys.service.ts, onWhatsappCache.ts, createJid.ts, @lid / remoteJidAlt handling, QR or pairing, Baileys upgrade.
---

# Skill: purple-baileys

File: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` (~5k lines).
Baileys is pinned exactly: `"baileys": "7.0.0-rc.9"` (`package.json:80`). Never use a caret;
an upgrade is its own task with manual QR + send/receive verification.

## Landmarks (verify line numbers before citing; they drift)

| Area | Location |
|---|---|
| QR / pairing in `connectionUpdate` | `:334`, pairing code `:375-380`, QR limit `:336` |
| Auth state selection (Redis / Prisma / provider files) | `defineAuthState` `:556` |
| Socket creation | `createClient` `:576` |
| Public connect entry | `connectToWhatsapp` `:723` |
| Inbound handler | `messageHandle['messages.upsert']` `:1082` |
| LID → PN swap before emit | `:1478-1480` |
| Contact upsert using `remoteJidAlt` | `:1512-1517` |
| Event dispatch (`connection.update`, `messages.upsert`) | `:1902-1919` |
| Outbound core | `sendMessageWithTyping` `:2289` |
| onWhatsApp guards (throw 400 when `!exists`) | `:2297`, `sendPresence` `:2571`, `blockUser` `:4118` |
| Number verification | `whatsappNumber` `:3507` (cache → Baileys `onWhatsApp` `:3566`) |

Helpers: `src/utils/onWhatsappCache.ts` (`saveOnWhatsappCache` `:73`, `getOnWhatsappCache`
`:182`, `normalizeJid` `:68`) and `src/utils/createJid.ts` (`createJid` `:35`).

## @lid rules (hard)

1. **LID → PN is NOT derivable.** A `<digits>@lid` carries no phone number. Never compute,
   guess or strip the suffix to obtain one.
2. **PN is only learned** from: `key.remoteJidAlt` / `participantAlt` on received messages,
   group participant metadata, or history sync. Persist the mapping when observed
   (contact upsert at `:1512-1517`, `saveOnWhatsappCache`).
3. **Never strip `@lid` on outbound.** `createJid` returns `@lid` JIDs unchanged
   (`createJid.ts:38-40`); `whatsappNumber` skips Baileys verification for `@lid` and treats an
   uncached LID as existing (`:3562`, `:3586-3594`). Keep both behaviors.
4. The inbound swap at `:1478-1480` rewrites `remoteJid` to `remoteJidAlt` only when the alt is
   present. Consumers (orbit, stenfar) also read `remoteJidAlt`/`addressingMode` themselves —
   changing this is a contract change (`purple-contract`).

Detail, failure modes and examples: `references/lid.md`.

## onWhatsApp guards

`sendMessageWithTyping`, `sendPresence` and `blockUser` all call `whatsappNumber` and throw
`BadRequestException(isWA)` when `!isWA.exists` and the JID is not a group/broadcast. The 400
body (the `OnWhatsAppDto`) is what consumers see on "number not on WhatsApp". Do not bypass the
guard; fix the cache or the JID instead.

## QR / pairing

- `connectToWhatsapp(number?)` — passing a number enables pairing-code mode
  (`this.phoneNumber`, `:375-380`); otherwise only QR.
- QR emits `qrcode.updated` with `{ pairingCode, code, base64 }` (`:392`, `:400`); the count is
  capped by `QRCODE.LIMIT` (`:336`), after which the instance stops retrying.

## Verification

No automated tests. After changes: `npx tsc --noEmit`, `npm run build`, then a manual run
with a test instance — QR scan, inbound 1:1 (PN and LID contact), inbound group, outbound text.
