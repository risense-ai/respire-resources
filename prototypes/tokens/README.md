# prototypes/tokens — Shared Visual Design Tokens

Aligned with `apps/client2` visual conventions (extracted into CSS variables during Change `005`):

- **Fluid Root Scale**: `clamp(14px, 0.5rem + 0.62vw, 18.8px)` — all spacing, sizing, and font tokens use `rem` rather than fixed `px`.
- **Bilingual Layout Support**: Validates both `en` and `zh` UI locales (loading localized strings from dedicated i18n bundles) without overflow or clipping.
- **State Indicators**: Consistent status dots or swatches only (no colored left-border stripes).
