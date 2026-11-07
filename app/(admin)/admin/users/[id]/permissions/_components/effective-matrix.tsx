"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search, Check, Ban } from "lucide-react";
import type { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { ALL_ACTIONS, isSuperAdmin } from "@/lib/auth/permissions";
import { getActionMeta, groupActionsByCategory } from "@/lib/auth/action-labels";

type UserGrant = { action: string; grant: "ALLOW" | "DENY" };

interface Props {
  role: Role;
  grants: UserGrant[];
  roleMatrix: Record<string, Role[]>;
}

type Source = "role" | "override_allow" | "override_deny" | "super_admin";

function getEffective(
  action: string,
  role: Role,
  grants: UserGrant[],
  roleMatrix: Record<string, Role[]>,
): { allowed: boolean; source: Source } {
  if (isSuperAdmin(role)) {
    return {
      allowed: roleMatrix[action]?.includes("SUPER_ADMIN") ?? false,
      source: "super_admin",
    };
  }
  const grant = grants.find((g) => g.action === action);
  if (grant?.grant === "DENY") return { allowed: false, source: "override_deny" };
  if (grant?.grant === "ALLOW") return { allowed: true, source: "override_allow" };
  return {
    allowed: roleMatrix[action]?.includes(role) ?? false,
    source: "role",
  };
}

const SOURCE_LABEL: Record<Source, string> = {
  role: "Theo role",
  override_allow: "Override ALLOW",
  override_deny: "Override DENY",
  super_admin: "Bypass (SUPER_ADMIN)",
};

const SOURCE_COLOR: Record<Source, string> = {
  role: "text-muted-foreground",
  override_allow: "text-state-success-ink font-semibold",
  override_deny: "text-state-danger-ink font-semibold",
  super_admin: "text-primary font-semibold",
};

export function EffectiveMatrix({ role, grants, roleMatrix }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyOverride, setOnlyOverride] = useState(false);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = ALL_ACTIONS.filter((a) => {
      const meta = getActionMeta(a);
      if (onlyOverride) {
        const eff = getEffective(a, role, grants, roleMatrix);
        if (eff.source !== "override_allow" && eff.source !== "override_deny") {
          return false;
        }
      }
      if (!q) return true;
      return (
        a.toLowerCase().includes(q) ||
        meta.label.toLowerCase().includes(q) ||
        meta.category.toLowerCase().includes(q)
      );
    });
    return groupActionsByCategory(filtered);
  }, [search, onlyOverride, role, grants, roleMatrix]);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Xem effective permissions
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tổng hợp quyền cuối cùng của user — kết hợp role + overrides
          </p>
        </div>
        <ChevronDown
          className={`h-5 w-5 text-muted-foreground transition-transform ${ open ? "rotate-180" : "" }`}
        />
      </button>

      {open && (
        <div className="border-t border-border p-5 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Tìm theo tên quyền, category, hoặc action key..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={onlyOverride}
                onChange={(e) => setOnlyOverride(e.target.checked)}
              />
              Chỉ hiện override
            </label>
          </div>

          {grouped.size === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Không có quyền nào khớp filter.
            </p>
          ) : (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
              {Array.from(grouped.entries()).map(([category, actions]) => (
                <div key={category}>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {category}
                  </h4>
                  <div className="space-y-1.5">
                    {actions.map((a) => {
                      const meta = getActionMeta(a);
                      const eff = getEffective(a, role, grants, roleMatrix);
                      return (
                        <div
                          key={a}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-foreground">
                              {meta.label}
                            </div>
                            <code className="text-[10px] text-muted-foreground">
                              {a}
                            </code>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`text-[10px] ${SOURCE_COLOR[eff.source]}`}
                            >
                              {SOURCE_LABEL[eff.source]}
                            </span>
                            {eff.allowed ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-state-success-soft px-2 py-0.5 text-xs font-semibold text-state-success-ink">
                                <Check className="h-3 w-3" />
                                Cho phép
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-state-danger-soft px-2 py-0.5 text-xs font-semibold text-state-danger-ink">
                                <Ban className="h-3 w-3" />
                                Từ chối
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
