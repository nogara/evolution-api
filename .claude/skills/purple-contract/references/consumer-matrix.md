# Consumer matrix — evolution-in-purple

Snapshot taken 2026-10-21 by reading the consumers (read-only). Re-verify before relying on a
row; consumers evolve independently.

Consumer roots:
- **orbit** — `orbit/orbit-backend/src/channels/evolution-api.service.ts` (REST, axios) and
  `orbit/orbit-backend/src/evolution-api-webhook/` (webhook receiver).
- **canal** — `canal-whatsapp/canal-whatsapp-backend/src/evolution-client/` plus
  `@alien-2-0-llc/sdk-evolution-api@^0.11.0` (REST) and `src/inbound-webhook/inbound-webhook.controller.ts`
  (`POST /evolution/webhook`).
- **stenfar** — `stenfar/canal-stenfar/src/services/whatsapp/evolution.service.js`,
  `src/routes/widget.routes.js` (REST, fetch) and `src/routes/whatsapp.routes.js`
  (`POST /webhook/whatsapp`).

## REST routes

| Route | orbit | canal | stenfar |
|---|---|---|---|
| `POST /instance/create` | yes (`evolution-api.service.ts:38`, with `webhook` body) | yes (`evolution-client.service.ts:139`) | — |
| `GET /instance/fetchInstances` | yes (`:20`) | yes (`evolution-client.service.ts:109`) | yes (`widget.routes.js:29`) |
| `GET /instance/connect/:instance` | yes (`:107`) | yes (`:116`) | yes (`widget.routes.js:74`) |
| `GET /instance/connectionState/:instance` | yes (`:212`) | — | yes (`evolution.service.js:299`) |
| `DELETE /instance/logout/:instance` | yes (`:233`) | yes (`:123`) | — |
| `POST /webhook/set/:instance` | — | yes (`:181`) | — |
| `GET /webhook/find/:instance` | — | yes (`:215`) | — |
| `POST /message/sendText/:instance` | yes (`:183`) | yes (SDK `sendText`) | yes (`evolution.service.js:23`) |
| `POST /message/sendMedia/:instance` | yes (`:248`) | yes (SDK `sendMedia`) | yes (`evolution.service.js:83`) |
| `POST /message/sendWhatsAppAudio/:instance` | — | yes (SDK `sendAudio`) | yes (`evolution.service.js:148`) |
| `POST /message/sendReaction/:instance` | — | yes (SDK `sendReaction`) | — |
| `POST /chat/markMessageAsRead/:instance` | yes (`:135`) | yes (SDK) | — |
| `POST /chat/sendPresence/:instance` | yes (`:155`) | in SDK, no call site seen | — |
| `POST /chat/getBase64FromMediaMessage/:instance` | — | yes (`inbound-worker.service.ts:2981`) | yes (`evolution.service.js:204`) |
| `POST /chat/findMessages/:instance` | — | in SDK, no call site seen | yes (`evolution.service.js:340`) |
| `POST /chat/findContacts/:instance` | — | — | yes (`evolution.service.js:254`) |
| `GET /group/findGroupInfos/:instance` | — | yes (SDK `findGroupInfos`) | — |
| `GET /group/findGroupByJid/:instance` (**not a route in this repo**) | — | yes (`evolution-group.client.ts:82`) | — |

## Webhook delivery

| Aspect | orbit | canal | stenfar |
|---|---|---|---|
| Mode | `byEvents: true` (`evolution-api.service.ts:46`) | `byEvents: false` (`evolution-client.service.ts:188`) | single URL (config not set from code — verify) |
| Receiver | `POST /evolution-api-webhook/whatsapp/<event-kebab>` | `POST /evolution/webhook` | `POST /webhook/whatsapp` |

## Webhook events

| Event | orbit | canal | stenfar |
|---|---|---|---|
| `messages.upsert` / `MESSAGES_UPSERT` | handled (`/messages-upsert`) | subscribed (`webhook-config.ts:31`) | handled (`whatsapp.controller.js:73`) |
| `messages.update` / `MESSAGES_UPDATE` | subscribed | subscribed (`:32`) | handled (acks, `mensaje.service.js:114-132`) |
| `connection.update` / `CONNECTION_UPDATE` | handled (`/connection-update`) | subscribed (`:33`) | handled (`whatsapp.controller.js:67`) |
| `qrcode.updated` / `QRCODE_UPDATED` | handled (`/qrcode-updated`) | — | — |
| `logout.instance` / `LOGOUT_INSTANCE` | — | subscribed (`:34`) | handled (`whatsapp.controller.js:67`) |
| `send.message` / `SEND_MESSAGE` | subscribed | — | referenced |
| Others (`MESSAGES_SET`, `MESSAGES_DELETE`, `CONTACTS_*`, `PRESENCE_UPDATE`, `CHATS_SET`, ...) | subscribed in create body (`evolution-api.service.ts:47+`) | — | — |

## Payload fields relied on

| Field | orbit | canal | stenfar |
|---|---|---|---|
| `data.key.remoteJid` / `remoteJidAlt` / `addressingMode` | yes (`evolution-api-webhook.service.ts:227-231`, dto `whatsapp-message-event.dto.ts:14-17`) | yes (inbound worker; exact call sites not audited) | yes (`phoneExtractor.js:35-44`) |
| `messages.update` numeric status | — | yes | yes (`mensaje.service.js:132`: ints in update, strings in upsert) |

## Open questions

- canal comments (`webhook-config.ts:8`) state that 2.3.7 `/instance/create` ignores the
  `webhook` field, while orbit relies on it and this repo calls
  `eventManager.setInstance(...)` from create (`src/api/controllers/instance.controller.ts:88`).
  Verify before changing either path.
- canal calls `GET /group/findGroupByJid/:instance` (`evolution-group.client.ts:39`, "ASSUMED RESPONSE SHAPE"), but
  `src/api/routes/group.router.ts` only defines `findGroupInfos` (`:79`) and similar. The call
  likely 404s today; decide whether to add the route or fix canal.
- stenfar's webhook registration is not visible in code (likely manual / manager UI).
