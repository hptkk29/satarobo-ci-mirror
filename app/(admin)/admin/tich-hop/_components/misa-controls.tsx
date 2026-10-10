"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { toggleMisa, testMisaSync } from "../_actions";

export function MisaControls({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const [pending, start] = useTransition();

  function toggle() {
    start(async () => {
      const res = await toggleMisa();
      if (res.ok) toast.success(res.enabled ? "Đã bật MISA sync" : "Đã tắt MISA sync");
      else toast.error(res.error ?? "Lỗi");
    });
  }

  function test() {
    start(async () => {
      const res = await testMisaSync();
      if (res.ok) toast.success(`Sync thử: ${res.status}`);
      else toast.error(res.error ?? "Lỗi");
    });
  }

  if (!canEdit) return null;

  return (
    <div className="flex gap-2">
      <button
        onClick={toggle}
        disabled={pending}
        className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${ enabled ? "bg-state-danger-ink" : "bg-state-success-ink" }`}
      >
        {enabled ? "Tắt sync" : "Bật sync"}
      </button>
      <button
        onClick={test}
        disabled={pending}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
      >
        Chạy thử
      </button>
    </div>
  );
}
