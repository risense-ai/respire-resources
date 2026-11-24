# prototypes — High-Fidelity HTML Prototype Gallery

This directory holds offline-interactive HTML prototypes, shared fluid `rem` design tokens, and the deterministic Mock Runtime server serving as the **single visual & interaction truth source** for `apps/client2` (see OpenSpec `005`).

- **[tokens/](tokens/README.md)** — Typography, fluid `rem` spacing scale, palette, and dot status tokens.
- **[mock-api/](mock-api/README.md)** — OpenAPI-aligned Mock Runtime with deterministic multi-state seed datasets.
- **`pages/`** — Interactive HTML prototypes covering all 16 Client2 views.

Open [Overview](pages/overview.html) directly for a standalone walkthrough. Each
file opening starts a fresh scenario. To keep changes when moving between
screens, run `node prototypes/mock-api/server.mjs` from the repository root
and open `http://127.0.0.1:4173/`. Restart the server to restore all seeds.

The scenario menu travels with navigation links. On Models, select
`downloading-sse` to cancel the seeded download, or `switch-rollback-error`
and activate Archive Small to inspect a failed switch. On Workspace, change
the view and advance through the collection. Select `multi-account` on
Accounts to switch between the Studio notebook and Personal archive.

Workspace supports editing and soft-deleting selected notes. Organize offers
on-demand suggestions, confirmed splits and reviewed deepen plans. Accounts
supports space creation, rename, activation and deletion, plus synthetic sync.
Members selects any fixture space. Storage exports real synthetic archive
bytes and restores the last export without reading user files. Grants and
Statistics expose owner metadata only after explicit synthetic authorization.
Recall supports Enter to search; Quick Panel supports Ctrl/Cmd+Enter to recall.

The shared fixture keeps these interactions available on `file:` previews.
Each file opening resets state; the loopback server retains state per scenario.
No external fonts, libraries, model downloads or remote identity providers are
used. Browser rendering and real TCP acceptance remain independent checks;
see [mock-api/README.md](mock-api/README.md) for exact offline test commands.
