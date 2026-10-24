"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { cn } from "@/lib/utils";
import { formatDateVN } from "@/lib/format/date";
import type { DongDaHuy } from "@/lib/hoc-bu/danh-sach-db";
import { khoiPhucBuoiCanBuAction } from "../_actions";

// Tab ĐÃ HUỶ — buổi đã chọn "không bù nữa". Khôi phục = quay lại danh sách cần bù (phụ huynh
// đổi ý). Nút chỉ vẽ cho người có quyền huỷ (cùng quyền), người khác chỉ xem lý do.
export function BangDaHuy({
  dong,
  coTheKhoiPhuc,
  tenCoSo,
}: {
  dong: DongDaHuy[];
  coTheKhoiPhuc: boolean;
  /** ≥2 cơ sở trong tầm nhìn ⇒ in cột Cơ sở. */
  tenCoSo: Record<string, string> | null;
}) {
  const router = useRouter();
  const [dang, setDang] = useState<string | null>(null);
  const [, start] = useTransition();

  function khoiPhuc(d: DongDaHuy) {
    setDang(d.id);
    start(async () => {
      try {
        const kq = await khoiPhucBuoiCanBuAction(d.id);
        if (!kq.ok) toast.error(kq.error);
        else {
          toast.success(`Đã khôi phục — ${d.hocVien} quay lại danh sách cần bù`);
          router.refresh();
        }
      } finally {
        setDang(null);
      }
    });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className={adminTh}>Học viên</th>
              {tenCoSo && <th className={adminTh}>Cơ sở</th>}
              <th className={adminTh}>Buổi vắng</th>
              <th className={adminTh}>Lý do huỷ</th>
              <th className={adminTh}>Người huỷ</th>
              {coTheKhoiPhuc && <th className={cn(adminTh, "text-right")}>Thao tác</th>}
            </tr>
          </thead>
          <tbody>
            {dong.map((d) => (
              <tr key={d.id} className={adminTr}>
                <td className={cn(adminTd, "max-w-[200px]")}>
                  <p className="truncate font-medium">{d.hocVien}</p>
                  <p className="truncate text-xs text-muted-foreground">{d.lop}</p>
                </td>
                {tenCoSo && <td className={adminTd}>{(d.centerId && tenCoSo[d.centerId]) || "—"}</td>}
                <td className={cn(adminTd, "max-w-[220px]")}>
                  <p className="tabular-nums">{d.ngayVang ? formatDateVN(d.ngayVang) : "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">{d.buoiVang ?? "—"}</p>
                </td>
                <td className={cn(adminTd, "max-w-[280px]")}>
                  <p className="truncate" title={d.lyDo ?? undefined}>
                    {d.lyDo ?? "—"}
                  </p>
                </td>
                <td className={adminTd}>
                  <p className="truncate">{d.nguoiHuy ?? "—"}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{d.luc ? formatDateVN(d.luc) : ""}</p>
                </td>
                {coTheKhoiPhuc && (
                  <td className={cn(adminTd, "text-right")}>
                    <Button size="sm" variant="outline" className="h-8" disabled={dang === d.id} onClick={() => khoiPhuc(d)}>
                      <RotateCcw aria-hidden /> {dang === d.id ? "Đang khôi phục…" : "Khôi phục"}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
