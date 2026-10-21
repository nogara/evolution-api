---
name: purple-contract
description: >
  The external contract of evolution-in-purple as consumed by orbit, canal-whatsapp and
  stenfar: webhook payload envelope, event naming (MESSAGES_UPSERT vs messages-upsert with
  webhookByEvents), and the REST routes each consumer calls. Read BEFORE changing any route,
  DTO, response shape, webhook event or payload field.
  Trigger: change to a REST route, request/response shape, webhook event name or payload, message key fields (remoteJid, remoteJidAlt), or instance/webhook config.
---

# Skill: purple-contract

This engine replaces Evolution API 2.3.7 for three consumers. **The contract is "behaves
exactly like Evolution 2.3.7"** unless a versioned breaking change says otherwise.
Consumer matrix (endpoint/event × consumer, with source paths): `references/consumer-matrix.md`.

## Webhook envelope

Built in `src/api/integrations/event/webhook/webhook.controller.ts:93-103`:

```ts
{ ...extra, event, instance, data, destination, date_time, sender, server_url, apikey }
```

- `event` is the dotted lowercase name (`messages.upsert`, `connection.update`, ...).
- Enabled-events list is stored uppercase with underscores (`MESSAGES_UPSERT`), derived at
  `webhook.controller.ts:88`.
- With `webhookByEvents: true` the URL becomes `${url}/${event-kebab}` — e.g.
  `/messages-upsert` (`webhook.controller.ts:89`, `:109-110`). orbit depends on this
  (routes `whatsapp/messages-upsert`, `qrcode-updated`, `connection-update`).
- canal-whatsapp and stenfar use a single URL (`byEvents: false`) and switch on `event`.

## Message key fields consumers read

`data.key.remoteJid`, `remoteJidAlt`, `participant`, `participantAlt`, `addressingMode`,
`fromMe`, `id`. The LID → PN swap (`whatsapp.baileys.service.ts:1478-1480`) is part of the
contract (see `purple-baileys`).

## REST surface consumers use

Union of all consumers (details per consumer in the matrix):
`/instance/{create,fetchInstances,connect,connectionState,logout}`,
`/message/{sendText,sendMedia,sendWhatsAppAudio,sendReaction}`,
`/chat/{markMessageAsRead,sendPresence,getBase64FromMediaMessage,findMessages,findContacts}`,
`/group/findGroupInfos`, `/webhook/{set,find}`. Auth: `apikey` header.
canal also calls `/group/findGroupByJid`, which does **not** exist here (see matrix §Open questions).

## Rules

1. **Non-breaking by default.** Additive fields are allowed; renaming, removing, retyping a
   field, changing a status code, an event name or a URL suffix is breaking.
2. **Breaking change ⇒ all of:** (a) new fork MAJOR/MINOR per `purple-release`, (b) a
   `CHANGELOG.md` entry under the `evolution-in-purple` section with a migration note,
   (c) a consumer check: grep each consumer listed in the matrix for the affected
   route/event/field and record positives/negatives in the task doc.
3. Update `references/consumer-matrix.md` in the same change whenever a consumer starts or
   stops using a route/event.
4. Consumers are read-only from this repo. Never edit orbit, canal-whatsapp or stenfar from
   here; open a task in the consumer instead.

## Consumer check (procedure)

```bash
rg -n '<route-or-event-or-field>' \
  ../../orbit/orbit-backend/src \
  ../../canal-whatsapp/canal-whatsapp-backend/src \
  ../../stenfar/canal-stenfar/src
```

Paths are relative to a checkout under `~/Programacion/evolution/<worktree>`; adjust if the
layout differs. canal-whatsapp calls REST through `@alien-2-0-llc/sdk-evolution-api`, so also
grep that SDK's method names (`sendText`, `setWebhook`, ...).
