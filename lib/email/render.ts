/**
 * Render template với variables + formatters.
 *
 * Syntax:
 *   {{var_name}}              — raw substitution (string/number)
 *   {{var_name:currency}}     — format as VND (e.g. "1.500.000 đ")
 *   {{var_name:date}}         — format as dd/MM/yyyy (Vietnamese)
 *   {{var_name:datetime}}     — format as dd/MM/yyyy HH:mm
 *   {{var_name:raw}}          — same as no formatter
 *
 * Variables of complex types (HTML chunks) should be pre-rendered.
 */
import { formatVndPlain } from "@/lib/format/money";

export type FormatterName = "currency" | "date" | "datetime" | "raw";

type VarValue = string | number | Date | null | undefined;

export function renderTemplate(
  template: string,
  vars: Record<string, VarValue>,
): string {
  return template.replace(
    /\{\{(\w+)(?::(\w+))?\}\}/g,
    (_match, name, formatter) => {
      const val = vars[name];
      if (val == null)
        return `{{${name}${formatter ? `:${formatter}` : ""}}}`;
      return applyFormatter(val, (formatter as FormatterName) ?? "raw");
    },
  );
}

function applyFormatter(val: VarValue, formatter: FormatterName): string {
  if (val == null) return "";

  switch (formatter) {
    case "currency": {
      const num = typeof val === "number" ? val : Number(val);
      if (isNaN(num)) return String(val);
      return formatVndPlain(num);
    }
    case "date": {
      const d = val instanceof Date ? val : new Date(String(val));
      if (isNaN(d.getTime())) return String(val);
      return d.toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    }
    case "datetime": {
      const d = val instanceof Date ? val : new Date(String(val));
      if (isNaN(d.getTime())) return String(val);
      return d.toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    case "raw":
    default:
      return String(val);
  }
}

/**
 * Extract variable names (without formatters) from a template.
 */
export function extractVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)(?::\w+)?\}\}/g);
  const seen = new Set<string>();
  for (const m of matches) seen.add(m[1]);
  return Array.from(seen);
}
