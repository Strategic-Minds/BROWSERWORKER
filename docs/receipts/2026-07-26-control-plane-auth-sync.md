# Governed Control-Plane Authentication Receipt

**Date:** 2026-07-26

- BrowserWorker continues to accept its dedicated `BROWSER_WORKER_SECRET`.
- BrowserWorker now also accepts the shared server-only `AUTO_BUILDER_OPERATOR_TOKEN`.
- The shared token was synchronized to Vercel production, preview, and development targets through a preview-only server-to-server operation.
- Secret values were never returned or committed.
- Production traffic was not changed by the synchronization.
- This commit triggers a fresh preview deployment that must pass authenticated and unauthenticated behavior checks before merge.
