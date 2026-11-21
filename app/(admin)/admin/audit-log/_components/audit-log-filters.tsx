"use client";

import { useState } from "react";
import { Filter, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { AuditFilters } from "../_types";

type Actor = { id: string; name: string | null; email: string | null };

export function AuditLogFilters({
  filters,
  actors,
  onApply,
}: {
  filters: AuditFilters;
  actors: Actor[];
  onApply: (f: AuditFilters) => void;
}) {
  const [draft, setDraft] = useState<AuditFilters>(filters);

  const selectClass =
    "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

  function update<K extends keyof AuditFilters>(key: K, value: AuditFilters[K]) {
    setDraft((prev) => ({ ...prev, [key]: value || undefined }));
  }

  function apply(e: React.FormEvent) {
    e.preventDefault();
    onApply(draft);
  }

  function clear() {
    setDraft({});
    onApply({});
  }

  return (
    <form
      onSubmit={apply}
      className="rounded-xl border border-border bg-muted/50 p-3"
    >
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="dateFrom" className="text-xs">
            Từ ngày
          </Label>
          <Input
            id="dateFrom"
            type="date"
            value={draft.dateFrom ?? ""}
            onChange={(e) => update("dateFrom", e.target.value)}
            className="h-9"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="dateTo" className="text-xs">
            Đến ngày
          </Label>
          <Input
            id="dateTo"
            type="date"
            value={draft.dateTo ?? ""}
            onChange={(e) => update("dateTo", e.target.value)}
            className="h-9"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="actorId" className="text-xs">
            Thực hiện bởi
          </Label>
          <select
            id="actorId"
            value={draft.actorId ?? ""}
            onChange={(e) => update("actorId", e.target.value)}
            className={selectClass}
          >
            <option value="">— Tất cả —</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? a.email ?? a.id}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="module" className="text-xs">
            Module
          </Label>
          <Input
            id="module"
            value={draft.module ?? ""}
            onChange={(e) => update("module", e.target.value)}
            placeholder="students, orders, rbac..."
            className="h-9"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="action" className="text-xs">
            Hành động
          </Label>
          <Input
            id="action"
            value={draft.action ?? ""}
            onChange={(e) => update("action", e.target.value)}
            placeholder="CREATE, UPDATE, DELETE..."
            className="h-9"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="entitySearch" className="text-xs">
            Đối tượng (loại / ID)
          </Label>
          <Input
            id="entitySearch"
            value={draft.entitySearch ?? ""}
            onChange={(e) => update("entitySearch", e.target.value)}
            placeholder="Student, Order, id..."
            className="h-9"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="freeText" className="text-xs">
            Tìm trong lý do
          </Label>
          <Input
            id="freeText"
            value={draft.freeText ?? ""}
            onChange={(e) => update("freeText", e.target.value)}
            placeholder="Lý do..."
            className="h-9"
          />
        </div>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clear}>
          <X className="h-4 w-4" />
          Xoá filter
        </Button>
        <Button type="submit" size="sm">
          <Filter className="h-4 w-4" />
          Áp dụng
        </Button>
      </div>
    </form>
  );
}
