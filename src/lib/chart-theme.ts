/**
 * Chart colours.
 *
 * These mirror the --chart-* tokens in styles.css and the accents in the
 * landing page topology, so a series in a panel is the same colour family as
 * the marketing site. Kept as concrete hex rather than var(--chart-1) because
 * Recharts passes these straight into SVG stroke/fill attributes and into
 * <linearGradient> stops, where CSS custom properties don't resolve.
 */
export const SERIES_PALETTE = [
  "#7ee6c2", // teal   — healthy pulse
  "#7fc7ff", // blue
  "#ffd27f", // amber
  "#c39dff", // purple
  "#ff8fa3", // pink
  "#5fd4b4",
  "#9fd8ff",
  "#ffc2d1",
] as const;

export const ACCENT = SERIES_PALETTE[0];

/** Status colours, matching --destructive and the amber chart token. */
export const STATUS_CRITICAL = "#f76f6f";
export const STATUS_WARNING = "#ffd27f";
export const STATUS_OK = "#7ee6c2";

/** Chart chrome, matching --border / --muted-foreground / --card. */
export const CHART_GRID = "#1d2f42";
export const CHART_AXIS = "#6b7c93";
export const CHART_TOOLTIP_BG = "#0a1420";
