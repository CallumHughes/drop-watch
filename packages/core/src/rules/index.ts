// Alert rule evaluation. Pure — no DB or network calls; the worker orchestrates.
// Implementations land in Epic 7.

export const ALERT_RULES = ["target", "drop_percent", "restock"] as const;

export type AlertRule = (typeof ALERT_RULES)[number];
