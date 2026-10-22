# evolution-in-purple developer entry points.
# Production deploy targets are intentionally absent until the deploy story is defined.

IMAGE ?= evolution-in-purple:dev

.PHONY: help install dev build lint test typecheck check-docs hooks-install docker-build _guard-not-prod

help: ## Show available targets
	@grep -hE '^[a-zA-Z][a-zA-Z_-]*:.*## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN { FS = ":.*## " } { printf "  %-14s %s\n", $$1, $$2 }'

install: ## Install dependencies from package-lock.json (npm ci)
	npm ci

dev: _guard-not-prod ## Run the API with hot reload (npm run dev:server)
	npm run dev:server

build: ## Typecheck and build to dist/ (npm run build)
	npm run build

lint: ## ESLint with auto-fix (npm run lint)
	npm run lint

test: ## Run the unit tests once (npm test)
	npm test

typecheck: ## TypeScript check without emit (src, then src + test)
	npx --no tsc --noEmit
	npm run typecheck:test

check-docs: ## Validate agent docs (AGENTS.md, CLAUDE.md, skills, links)
	bash scripts/check-docs.sh

hooks-install: ## Install Husky git hooks (.husky/)
	npx --no husky

docker-build: _guard-not-prod ## Build the local Docker image (default tag evolution-in-purple:dev)
	docker build -t $(IMAGE) .

# Refuses dev-only targets on a host that looks like production.
# Override with FORCE_DEV=1.
_guard-not-prod:
	@if [ "$$FORCE_DEV" = "1" ]; then \
		echo "FORCE_DEV=1 - skipping prod-host guard"; \
		exit 0; \
	fi; \
	if [ "$$NODE_ENV" = "production" ]; then \
		echo "Refusing to run: NODE_ENV=production. Set FORCE_DEV=1 to override."; \
		exit 1; \
	fi; \
	if docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^evolution-in-purple(-prod|-blue|-green)'; then \
		echo "Refusing to run: production evolution-in-purple containers detected on this host."; \
		echo "Set FORCE_DEV=1 to override."; \
		exit 1; \
	fi
