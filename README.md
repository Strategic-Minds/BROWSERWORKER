# Browser Worker V1

Production-grade Chromium browser execution service for Xtreme AI Builder.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | None | Lightweight readiness check |
| GET | `/api/health/deep` | Required | Launches Chromium to verify |
| POST | `/api/run` | Required | Execute a browser job |
| GET | `/api/capabilities` | None | List supported actions and limits |
| GET | `/api/version` | None | Worker version and deployment info |
| POST | `/api/validate-url` | Required | Validate a URL without launching browser |

## Authentication

All protected endpoints require one of:
- `Authorization: Bearer <BROWSER_WORKER_SECRET>`
- `X-Browser-Worker-Secret: <BROWSER_WORKER_SECRET>`

## Environment Variables

See `.env.example` for all configuration options.

Required:
- `BROWSER_WORKER_SECRET` — secret key for authenticating requests

## Integration with Xtreme AI Builder

Set in Xtreme AI Builder's Vercel environment:
```
BROWSER_WORKER_URL=https://browserworker.vercel.app
BROWSER_WORKER_SECRET=<same-secret>
```

Use the client adapter in `lib/browserWorkerClient.ts` (server-side only).

## Job Request Format

```json
{
  "version": "1.0",
  "job_id": "uuid",
  "correlation_id": "uuid",
  "objective": "Validate the homepage",
  "url": "https://www.autobuilderos.com",
  "viewport": { "width": 1440, "height": 1200 },
  "timeout_ms": 60000,
  "capture": { "screenshot": true, "console": true, "network_errors": true },
  "steps": [
    { "action": "goto", "url": "https://www.autobuilderos.com" },
    { "action": "get_title" },
    { "action": "screenshot" }
  ]
}
```

## Job Types

- `launch-check` — verify Chromium launches
- `website-generator-proof` — validate Xtreme AI Builder workflow
- `generated-site-validation` — QA a generated website

## Security

- SSRF protection blocks all private IPs, metadata endpoints, and non-HTTP(S) schemes
- Constant-time auth comparison
- No raw JavaScript execution from callers
- Strict CORS headers
- Downloads and uploads blocked by default
