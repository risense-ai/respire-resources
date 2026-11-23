# Automated PR UI Preview Specification (`prototypes/UI_PREVIEW_SPEC.md`)

> Directly adapted from `yetone/magpie`'s `.github/ui-preview/` pipeline: **reviewers and the Maintainer inspect rendered `en`/`zh` screenshots and MP4 demos directly inside every Client2 UI PR without compiling Go/Wails locally**.

---

## 1. Privilege-Separated Three-Job Architecture (`ui-preview.yml`)

Never execute untrusted PR code with repository write credentials:

| Job | Permissions | Code Checked Out | Responsibility |
| --- | --- | --- | --- |
| **`detect`** | `contents: read`, `pull-requests: write` | Default branch (`main`) | Trigger when PR changes `apps/client2/**/frontend/**`, `apps/client2/**/desktop/**`, or has `ui-preview` label; post `"Recording..."` placeholder in PR description and export diff metadata |
| **`record`** | **`{}` (zero write tokens)** | PR head (untrusted code isolated) + `respire-resources/prototypes/mock-api` | Start deterministic Mock Runtime + compiled Client2 WebUI, run Playwright across affected pages in `en` and `zh`, capture PNGs + MP4 (with cursor overlay), abort if any token pattern appears on screen, upload artifact |
| **`publish`** | `contents: write`, `pull-requests: write` | Default branch ONLY (never PR code) | Download artifact, push to `ui-previews` branch (`pr-<n>/<sha>/`), rewrite `<!-- respire-ui-preview:begin -->` ... `<!-- respire-ui-preview:end -->` in PR body with inline screenshots and MP4 poster links |

---

## 2. Deterministic Mock Runtime Seeds (`prototypes/mock-api/`)

To surface edge-case states reliably without downloading real GB-scale models in CI, `mock-api/server.mjs` implements five deterministic scenarios selectable via query/header:
1. **`empty`**: Fresh workspace onboarding (`wizard.html`)
2. **`rich-1k`**: Populated workspace (tree/list/card/graph views, diary entries, multi-space grants)
3. **`downloading-sse`**: Active model download emitting throttled SSE progress + cancel button test
4. **`switch-rollback-error`**: Failed model switch returning RFC 9457 `ProblemDetails` and `unchanged` rollback state
5. **`multi-account`**: Multiple accounts and sync outbox indicators

---

## 3. Media & Interaction Rules (Learned from `magpie`)

- Always capture both `en` and `zh` screenshots at canonical desktop viewport (`1440x900`) plus `quickpanel` viewport.
- Record **MP4 (never GIF)** via Playwright + `ffmpeg` whenever interactions span tabs, modals, or SSE progress transitions, using a visible simulated cursor trail.
- Any screenshot change violating `prototypes/pages/` layout invariants or `i18n` completeness fails `client2-e2e` before merge.
