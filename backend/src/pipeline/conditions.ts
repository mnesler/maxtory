// Condition expression evaluator for edge conditions
// Supports: outcome=success, outcome!=fail, key=value, key!=value, key contains value

import type { Outcome, PipelineContext } from "./types.js";

export function evaluateCondition(
  condition: string,
  outcome: Outcome,
  context: PipelineContext,
): boolean {
  if (!condition || condition.trim() === "") return true;

  const trimmed = condition.trim();

  // AND/OR composition
  if (trimmed.includes(" AND ")) {
    return trimmed.split(" AND ").every((c) => evaluateCondition(c.trim(), outcome, context));
  }
  if (trimmed.includes(" OR ")) {
    return trimmed.split(" OR ").some((c) => evaluateCondition(c.trim(), outcome, context));
  }

  // Contains operator
  const containsMatch = trimmed.match(/^(\w[\w.]*)\s+contains\s+(.+)$/i);
  if (containsMatch) {
    const [, key, val] = containsMatch;
    const contextVal = String(resolveKey(key, outcome, context));
    return contextVal.toLowerCase().includes(val.toLowerCase().replace(/^["']|["']$/g, ""));
  }

  // Not-equals
  const neMatch = trimmed.match(/^(\w[\w.]*)\s*!=\s*(.+)$/);
  if (neMatch) {
    const [, key, val] = neMatch;
    return !valuesEqual(resolveKey(key, outcome, context), val.trim().replace(/^["']|["']$/g, ""));
  }

  // Equals
  const eqMatch = trimmed.match(/^(\w[\w.]*)\s*=\s*(.+)$/);
  if (eqMatch) {
    const [, key, val] = eqMatch;
    return valuesEqual(resolveKey(key, outcome, context), val.trim().replace(/^["']|["']$/g, ""));
  }

  // Boolean (just a key name — truthy check)
  const resolved = resolveKey(trimmed, outcome, context);
  return Boolean(resolved);
}

function resolveKey(key: string, outcome: Outcome, context: PipelineContext): unknown {
  // Special outcome key
  if (key === "outcome") {
    return outcome.status.toLowerCase();
  }
  if (key === "preferred_label") {
    return outcome.preferredLabel ?? context.getString("preferred_label");
  }
  // Context keys
  return context.get(key, "");
}

function valuesEqual(a: unknown, b: string): boolean {
  return String(a).toLowerCase() === b.toLowerCase();
}

export function normalizeLabel(label: string): string {
  // Lowercase, trim whitespace, strip accelerator prefixes: [K] / K) / K -
  return label
    .toLowerCase()
    .trim()
    .replace(/^\[.\]\s*/i, "")
    .replace(/^.\)\s*/i, "")
    .replace(/^.\s*-\s*/i, "");
}

export function parseAcceleratorKey(label: string): string {
  const bracketMatch = label.match(/^\[([A-Za-z0-9])\]/);
  if (bracketMatch) return bracketMatch[1].toUpperCase();

  const parenMatch = label.match(/^([A-Za-z0-9])\)/);
  if (parenMatch) return parenMatch[1].toUpperCase();

  const dashMatch = label.match(/^([A-Za-z0-9])\s*-/);
  if (dashMatch) return dashMatch[1].toUpperCase();

  return label.charAt(0).toUpperCase();
}
