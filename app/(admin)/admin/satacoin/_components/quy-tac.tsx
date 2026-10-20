"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createRule, toggleRule } from "../_actions";

type QuyTac = { id: string; code: string; label: string; amount: number; isActive: boolean };

// QUY TẮC THƯỞNG (01/10/2026 — thiết kế lại). Mỗi quy tắc một thẻ bật/tắt; ô thêm mới đặt
// cuối, không chen giữa danh sách đang dùng.
export function QuyTacThuong({ quyTac }: { quyTac: QuyTac[] }) {
  const router = useRouter();
  const [dang, start] = useTransition();
  const [ma, setMa] = useState("");
  const [ten, setTen] = useState("");
  const [so, setSo] = useState("5");

  function them() {
    start(async () => {
      const kq = await createRule({ code: ma, label: ten, amount: so });
      if (!kq.ok) {
        toast.error(kq.error ?? "Không tạo được quy tắc");
        return;
      }
      toast.success("Đã thêm quy tắc");
      setMa("");
      setTen("");
      setSo("5");
      router.refresh();
    });
  }
  function batTat(r: QuyTac) {
    start(async () => {
      const kq = await toggleRule(r.id);
      if (!kq.ok) toast.error("Không đổi được trạng thái");
      else router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {quyTac.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          Chưa có quy tắc thưởng nào. Thêm quy tắc để cấp coin nhanh theo một chạm.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {quyTac.map((r) => (
            <li
              key={r.id}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm",
                r.isActive ? "border-border" : "border-dashed border-border opacity-75",
              )}
            >
              <div className="min-w-0">
                <p className="font-mono text-xs text-muted-foreground">{r.code}</p>
                <p className="truncate font-medium text-foreground">{r.label}</p>
                <p
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    r.amount > 0 ? "text-state-success-ink" : "text-state-danger-ink",
                  )}
                >
                  {r.amount > 0 ? `+${r.amount}` : r.amount} coin
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={r.isActive}
                aria-label={`${r.isActive ? "Tắt" : "Bật"} quy tắc ${r.label}`}
                disabled={dang}
                onClick={() => batTat(r)}
                className={cn(
                  "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60",
                  r.isActive ? "bg-primary" : "bg-muted-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-5 rounded-full bg-background shadow transition-transform",
                    r.isActive ? "translate-x-[22px]" : "translate-x-0.5",
                  )}
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5" aria-label="Thêm quy tắc">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Thêm quy tắc</h2>
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_7rem_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Mã</span>
            <input
              value={ma}
              onChange={(e) => setMa(e.target.value.toUpperCase())}
              placeholder="ATTENDANCE"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm focus:border-primary focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Tên hiển thị</span>
            <input
              value={ten}
              onChange={(e) => setTen(e.target.value)}
              placeholder="Đi học đầy đủ"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Số coin</span>
            <input
              value={so}
              onChange={(e) => setSo(e.target.value)}
              type="number"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm tabular-nums focus:border-primary focus:outline-none"
            />
          </label>
          <Button onClick={them} disabled={dang || ma.trim().length < 2 || ten.trim().length < 2}>
            <Plus className="size-4" aria-hidden />
            Thêm
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Mã chỉ gồm A–Z, 0–9 và dấu gạch dưới.</p>
      </section>
    </div>
  );
}
