# bot-service-01

Checkout Pulse is a full-stack demo service for the RCA/rollback platform.

It intentionally looks like a small commerce checkout product:

- React/Vite web UI
- FastAPI backend
- PostgreSQL database
- Kubernetes manifests for API, web, DB, HPA, and LoadBalancer
- bounded incident scenarios for load, database stress, lock contention, error spikes, crash loops, and bad rollout behavior
- stable, bad-config, and rollback release overlays

The service is designed to be deployed to `cluster-1` and exposed as:

```text
https://bot-01.woonyong.org
```

## Local API

```bash
cd apps/api
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bot_service_01 uvicorn main:app --reload
```

## Scenario API

```text
POST /api/scenarios/load/start
POST /api/scenarios/load/stop
POST /api/scenarios/db-bulk-insert/start
POST /api/scenarios/db-lock/start
POST /api/scenarios/db-slow-query/start
POST /api/scenarios/error-spike/start
POST /api/scenarios/crashloop/start
POST /api/scenarios/recover
```

## Kubernetes Deploy

The manifests do not commit real secret values. Create the DB secret at deploy time:

```bash
DB_PASSWORD='change-me' ./scripts/deploy.sh cluster-1 stable
```

Bad rollout:

```bash
DB_PASSWORD='change-me' ./scripts/deploy.sh cluster-1 bad-config
```

Rollback:

```bash
DB_PASSWORD='change-me' ./scripts/deploy.sh cluster-1 rollback
```

## Images

GitHub Actions builds:

```text
ghcr.io/jungle-303-04/bot-service-01-api:latest
ghcr.io/jungle-303-04/bot-service-01-web:latest
```

