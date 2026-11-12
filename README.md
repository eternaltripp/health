# health

Michael's personal health app. Cloudflare Worker + D1, exposed to Claude as a remote MCP connector.

- `GET /` liveness (no data)
- `POST /mcp` MCP server, `Authorization: Bearer <MCP_TOKEN>`
- Cron 6:00 a.m. Central: Oura + myAir CPAP ingest

Push to `main` deploys (Workers Builds). Schema applies itself on first request. See `BUILD-LOG.md`.
