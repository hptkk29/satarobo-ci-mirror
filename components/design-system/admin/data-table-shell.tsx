import type { ReactNode } from "react";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface Props {
  /** Optional header above table (filters, actions, search) */
  header?: ReactNode;
  /** Optional footer (pagination, batch actions) */
  footer?: ReactNode;
  /** The `<table>` content (or any other element) */
  children: ReactNode;
  className?: string;
}

// Polished wrapper cho admin data tables. Consistent border + bg + responsive overflow.
export function DataTableShell({ header, footer, children, className }: Props) {
  return (
    <div
      className={cn(
        "bg-card overflow-hidden",
        tokens.radius.card,
        tokens.borders.subtle,
        className,
      )}
    >
      {header && (
        <div className="border-b border-border px-4 py-3 md:px-6 md:py-4 bg-muted">
          {header}
        </div>
      )}
      <div className="overflow-x-auto">{children}</div>
      {footer && (
        <div className="border-t border-border px-4 py-3 md:px-6 md:py-4 bg-muted">
          {footer}
        </div>
      )}
    </div>
  );
}
