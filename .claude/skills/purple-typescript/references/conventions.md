# purple-typescript — conventions detail

## Adding an endpoint (checklist)

1. DTO in `src/api/dto/<feature>.dto.ts` — plain class, optional fields with `?`.
2. Schema in `src/validate/<feature>.schema.ts` — `JSONSchema7` with `$id: v4()`; export it from
   `src/validate/validate.schema.ts`.
3. Service method (or channel-service method on `ChannelStartupService` subclasses when it
   depends on the WhatsApp provider).
4. Controller method — one line delegating to the service.
5. Router — `this.router.post(this.routerPath('name'), ...guards, async (req, res) => {
   const response = await this.dataValidate<Dto>({ request: req, schema, ClassRef: Dto,
   execute: (instance, data) => controller.method(instance, data) }); res.status(201).json(response); })`.
6. If it is a new router, mount it in `src/api/routes/index.router.ts:217-230`.
7. If it is a new service/controller, instantiate it in `src/api/server.module.ts` next to its
   siblings and export the controller.
8. Run `npx tsc --noEmit`, `npm run build`, `npm run lint:check`.
9. Update `purple-contract/references/consumer-matrix.md` if a consumer will call it.

## RouterBroker details

- `routerPath(path, param = true)` — pass `false` for routes without `:instanceName`.
- `dataValidate` special-cases `/instance/create` by merging the body into the instance DTO
  (`src/api/abstract/abstract.router.ts:40-42`).
- `groupNoValidate` / `groupValidate` variants exist for group routes (`abstract.router.ts:65+`).
- Validation error messages come from the schema `description` when present.

## server.module.ts

- Order matters: `configService`, caches (`:52-56`), `providerFiles` (`:60`),
  `prismaRepository` (`:63`), `waMonitor` (`:65`), then services/controllers.
- Chatbot integrations share `openaiService` (`:119`) as a constructor arg.

## Prisma

- Edit the three schema files consistently; types differ by provider (`@db.JsonB` vs `@db.Json`,
  `@db.Integer` vs `@db.Int`).
- Generate migrations with `npm run db:migrate:dev` per provider; the script copies
  `prisma/migrations` back into the provider folder.
- Destructive migrations require explicit user approval.

## Logging

`new Logger('Context')` from `@config/logger.config`; use `verbose` for chatty paths.
