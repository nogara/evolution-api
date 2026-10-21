---
name: purple-typescript
description: >
  Codebase conventions for evolution-in-purple (Evolution API 2.3.7 fork): RouterBroker
  routes, thin controllers, services, plain DTOs, JSONSchema7 validation, manual singletons
  in server.module.ts, ConfigService env, three Prisma schemas, cache engine, and the
  verification commands. Read BEFORE editing anything under src/ or prisma/.
  Trigger: new or changed endpoint, controller, service, DTO, schema, env var, Prisma model, or cache usage.
---

# Skill: purple-typescript

TypeScript + Express + Prisma. No DI container, no decorators. Follow the existing shape of
the nearest sibling file; do not introduce new patterns.

## Request flow

1. **Router** extends `RouterBroker` (`src/api/abstract/abstract.router.ts:20`).
   - `routerPath(path)` appends `/:instanceName` by default (`abstract.router.ts:22-26`).
   - `dataValidate<T>({ request, schema, ClassRef, execute })` (`abstract.router.ts:29`)
     merges `params` + `query` into an `InstanceDto`, `Object.assign`s the body into a new
     `ClassRef`, validates with `jsonschema` and throws `BadRequestException` on failure.
   - Routers are mounted in `src/api/routes/index.router.ts:217-230` (`/instance`, `/message`,
     `/chat`, `/group`, ... plus `''` for channel/event/chatbot/storage routers).
2. **Controller** — thin, delegates to a service or to `waMonitor.waInstances[instanceName]`.
3. **Service** — business logic; channel-specific behavior lives in
   `src/api/integrations/channel/**` (see `purple-baileys`).
4. **DTO** — plain classes in `src/api/dto/` (no class-validator).
5. **Schema** — `JSONSchema7` objects in `src/validate/*.schema.ts`, re-exported by
   `src/validate/validate.schema.ts`.

## Wiring (manual singletons)

`src/api/server.module.ts` instantiates everything once and exports it:
`cache` (`:55`), `prismaRepository` (`:63`), `waMonitor` (`:65`), controllers (`:90-139`).
A new service/controller is added there with explicit constructor args; routers import the
exported controller. Detail and a checklist: `references/conventions.md`.

## Config

`ConfigService.get<T>(key)` (`src/config/env.config.ts:443`) returns typed sections loaded from
env. New env vars: add the type + loader in `env.config.ts` and document in `.env.example`.
Never read `process.env` directly in services.

## Database

- Three schemas: `prisma/postgresql-schema.prisma`, `prisma/mysql-schema.prisma`,
  `prisma/psql_bouncer-schema.prisma`. A model change must land in **all** of them.
- Migrations per provider: `prisma/postgresql-migrations/`, `prisma/mysql-migrations/`.
- Scripts resolve the provider via `runWithProvider.js` and `DATABASE_PROVIDER`
  (`package.json:17-22`). Always scope queries by `instanceId`.

## Cache

`CacheEngine` (`src/cache/cacheengine.ts:10`) picks Redis when `CACHE.REDIS.ENABLED` and a
URI are set, else local node-cache (`cacheengine.ts:19-25`). Wrap it in `CacheService` with a
module name, as `server.module.ts:55-56` does.

## Commands

| Purpose | Command |
|---|---|
| Typecheck | `npx tsc --noEmit` |
| Build (typecheck + tsup) | `npm run build` (`package.json:8`) |
| Lint check / fix | `npm run lint:check` / `npm run lint` (`package.json:13-14`) |
| Dev server | `npm run dev:server` |
| Prisma client | `npm run db:generate` (needs `DATABASE_PROVIDER`) |

There is **no test suite** (`package.json:12` points at a non-existent `test/all.test.ts`).
Verification = `tsc --noEmit` + `npm run build` + `npm run lint:check` + manual run.

## Rules

- Style: ESLint + Prettier, 2 spaces, single quotes, 120 cols, `simple-import-sort`.
- Path aliases (`@api/*`, `@config/*`, `@utils/*`, `@exceptions`) — never deep relative imports.
- Keep diffs minimal: this is a fork; every unnecessary change costs on upstream cherry-picks
  (see `purple-upstream-sync`).
- Any change to a REST route or webhook payload is a contract change: read `purple-contract`.
