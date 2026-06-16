# Platform Docker deployment

This deployment starts only:

- `platform`: the Next.js JustSoc Platform app
- `platform-db`: PostgreSQL for Platform state

ELK/Elasticsearch is intentionally not included. Point `SELK_ELASTICSEARCH_URL` at your own ELK stack in `.env`.

## Quick start

```powershell
Copy-Item .env.docker.example .env
notepad .env
.\deploy-platform.ps1 -Build
```

Open:

```text
http://localhost:3000
```

## Common commands

```powershell
.\deploy-platform.ps1 -Build
.\deploy-platform.ps1 -Logs
.\deploy-platform.ps1 -Down
```

Or use Docker Compose directly:

```powershell
docker compose --env-file .env -f docker-compose.platform.yml up -d --build
docker compose --env-file .env -f docker-compose.platform.yml logs -f platform
docker compose --env-file .env -f docker-compose.platform.yml down
```

PostgreSQL data is stored in the `platform_pg_data` Docker volume.

