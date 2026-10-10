"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// `lib/validators/role` chỉ import zod (KHÔNG kéo Prisma runtime) nên client
// component nhập trực tiếp được — khỏi phải bơm danh sách scope qua props.
import { SCOPE_TYPES } from "@/lib/validators/role";
import { setRolePermissionsAction } from "../actions";

/** action → scopeType đang chọn. Không có key = không cấp quyền đó. */
type Selected = Record<string, string>;

const SCOPE_LABELS: Record<string, string> = {
  GLOBAL: "GLOBAL — toàn hệ thống",
  CENTER: "CENTER — trong cơ sở",
  CLASS: "CLASS — trong lớp",
  OWN: "OWN — của chính mình",
  CHILDREN: "CHILDREN — đơn vị con",
  ASSIGNED: "ASSIGNED — được phân công",
};

const DEFAULT_SCOPE = "GLOBAL";

export function RolePermissionsEditor({
  roleId,
  allActions,
  current,
}: {
  roleId: string;
  allActions: readonly string[];
  current: { action: string; scopeType: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");

  const initial = useMemo(() => {
    const m: Selected = {};
    for (const p of current) m[p.action] = p.scopeType;
    return m;
  }, [current]);

  const [selected, setSelected] = useState<Selected>(() => ({ ...initial }));

  // Nhóm theo tiền tố trước dấu ":" (leads / students / trials...). Lọc TRƯỚC khi
  // gom nhóm để ô tìm nhanh giấu luôn cả nhóm rỗng.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, string[]>();
    for (const action of allActions) {
      if (q && !action.toLowerCase().includes(q)) continue;
      const i = action.indexOf(":");
      const prefix = i > 0 ? action.slice(0, i) : "khác";
      const arr = map.get(prefix);
      if (arr) arr.push(action);
      else map.set(prefix, [action]);
    }
    return Array.from(map, ([name, actions]) => ({
      name,
      actions: actions.slice().sort((a, b) => a.localeCompare(b)),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allActions, query]);

  const diff = useMemo(() => {
    let added = 0;
    let removed = 0;
    let scopeChanged = 0;
    for (const action of Object.keys(selected)) {
      const before = initial[action];
      if (before === undefined) added += 1;
      else if (before !== selected[action]) scopeChanged += 1;
    }
    for (const action of Object.keys(initial)) {
      if (selected[action] === undefined) removed += 1;
    }
    return { added, removed, scopeChanged };
  }, [selected, initial]);

  const chosenCount = Object.keys(selected).length;
  const dirty = diff.added + diff.removed + diff.scopeChanged > 0;

  function toggle(action: string, on: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      // Bật lại giữ nguyên scope cũ nếu có (đỡ mất lựa chọn khi lỡ tay bỏ tick).
      if (on) next[action] = next[action] ?? DEFAULT_SCOPE;
      else delete next[action];
      return next;
    });
  }

  function setScope(action: string, scopeType: string) {
    setSelected((prev) => ({ ...prev, [action]: scopeType }));
  }

  /** Chọn/bỏ cả nhóm — chỉ tác động lên các action ĐANG HIỆN (sau khi lọc). */
  function setGroup(actions: string[], on: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      for (const action of actions) {
        if (on) next[action] = next[action] ?? DEFAULT_SCOPE;
        else delete next[action];
      }
      return next;
    });
  }

  function reset() {
    setSelected({ ...initial });
  }

  function save() {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("Nhập lý do thay đổi");
      return;
    }
    const permissions = Object.entries(selected).map(([action, scopeType]) => ({
      action,
      scopeType,
    }));
    startTransition(async () => {
      const res = await setRolePermissionsAction(roleId, {
        permissions,
        reason: trimmed,
      });
      if (res.ok) {
        toast.success("Đã lưu quyền của vai");
        setReason("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 rounded-lg border bg-card p-3 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-foreground">
            <span className="font-semibold">
              Đang chọn {chosenCount}/{allActions.length} quyền
            </span>
            <span className="ml-2 text-muted-foreground">
              {dirty
                ? `+${diff.added} thêm · −${diff.removed} bớt · ${diff.scopeChanged} đổi phạm vi`
                : "chưa thay đổi gì"}
            </span>
          </div>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm nhanh action..."
              className="pl-8"
              aria-label="Tìm nhanh action"
            />
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-lg border bg-muted p-4 text-sm text-muted-foreground">
          Không có action nào khớp &quot;{query}&quot;.
        </p>
      ) : (
        groups.map((g) => {
          const allOn = g.actions.every((a) => selected[a] !== undefined);
          return (
            <div key={g.name} className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-mono text-sm font-bold text-foreground">
                  {g.name}
                  <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">
                    {g.actions.filter((a) => selected[a] !== undefined).length}/
                    {g.actions.length}
                  </span>
                </h2>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setGroup(g.actions, true)}
                    disabled={pending || allOn}
                  >
                    Chọn hết nhóm
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setGroup(g.actions, false)}
                    disabled={pending}
                  >
                    Bỏ hết nhóm
                  </Button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {g.actions.map((action) => {
                  const scope = selected[action];
                  const on = scope !== undefined;
                  return (
                    <div
                      key={action}
                      className="flex flex-col gap-2 rounded-lg border border-border p-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <label className="flex items-start gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={on}
                          disabled={pending}
                          onChange={(e) => toggle(action, e.target.checked)}
                        />
                        <span className="font-mono break-all">{action}</span>
                      </label>
                      {on ? (
                        <select
                          value={scope}
                          disabled={pending}
                          onChange={(e) => setScope(action, e.target.value)}
                          aria-label={`Phạm vi của ${action}`}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm sm:w-44"
                        >
                          {SCOPE_TYPES.map((s) => (
                            <option key={s} value={s}>
                              {SCOPE_LABELS[s] ?? s}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      <div className="rounded-lg border bg-muted p-4">
        <Label htmlFor="perm-reason">Lý do thay đổi (bắt buộc)</Label>
        <Input
          id="perm-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Vì sao đổi quyền của vai này"
          className="mt-1"
        />

        <p className="mt-3 text-xs text-orange-700">
          Lưu ý: chạy lại seed vai (pnpm db:seed:roles hoặc workflow Seed Production
          RolePermission) sẽ GHI ĐÈ toàn bộ thay đổi ở đây bằng nội dung trong code.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={save} disabled={pending}>
            {pending ? "Đang lưu..." : "Lưu"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={reset}
            disabled={pending || !dirty}
          >
            Hoàn tác
          </Button>
        </div>
      </div>
    </div>
  );
}
