import type { ReactNode } from "react";
import { EmptyStateIllustration } from "@/components/design-system/illustrations/empty-state";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description?: string;
  /** Optional action button (e.g. <Link href="/.../new">Thêm mới</Link>) */
  action?: ReactNode;
  /** Hide illustration if you want compact empty state */
  hideIllustration?: boolean;
  className?: string;
}

// Polished empty state cho admin list views.
export function EmptyStateAdmin({
  title,
  description,
  action,
  hideIllustration = false,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-16 px-4",
        "bg-card border border-dashed border-border",
        tokens.radius.card,
        className,
      )}
    >
      {!hideIllustration && (
        <EmptyStateIllustration className="max-w-[200px] md:max-w-[280px] mb-4" />
      )}
      <h3 className={cn(tokens.typography.heading.h5, "mb-2")}>{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-md mb-4 leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
