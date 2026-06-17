# Browser Worker

Chromium-capable worker for AUTO BUILDER validation.

## Endpoints

- `GET /api/health`
- `POST /api/run`

## Notes

- Uses `playwright-core` plus `@sparticuz/chromium`.
- Intended for Vercel deployment.
- Keep the worker separate from the main app repo.
BROWSER WORKER
