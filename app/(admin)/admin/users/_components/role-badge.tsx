import type { Role } from "@prisma/client";
import { ROLE_LABELS, roleColor, getRoleOptions } from "@/lib/labels";

export function RoleBadge({
  role,
  primary = false,
}: {
  role: Role;
  primary?: boolean;
}) {
  return (
    <span
      title={primary ? "Vai trò chính" : undefined}
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleColor(role)} ${ primary ? "ring-2 ring-primary ring-offset-1" : "" }`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

/** Đợt 3B — render toàn bộ vai trò (union), vai trò chính có viền nổi bật. */
export function RoleBadges({
  role,
  roles,
}: {
  role: Role;
  roles?: Role[] | null;
}) {
  const effective = roles && roles.length > 0 ? roles : [role];
  // Vai trò chính lên đầu cho dễ nhìn.
  const ordered = [
    ...effective.filter((r) => r === role),
    ...effective.filter((r) => r !== role),
  ];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {ordered.map((r) => (
        <RoleBadge key={r} role={r} primary={r === role} />
      ))}
    </div>
  );
}

// Single source: gồm mọi role (kể cả PARENT) cho bộ lọc/hiển thị users.
export const ROLE_OPTIONS: Array<{ value: Role; label: string }> = getRoleOptions(
  Object.keys(ROLE_LABELS) as Role[],
);
