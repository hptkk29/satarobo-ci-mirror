"use client";
// Ô ĐỔI TRẠNG THÁI LEAD — dùng ở TRANG CHI TIẾT lead.
//
// 30/08/2026 — chủ dự án chốt: đổi trạng thái CHỈ làm trong trang chi tiết, bảng danh
// sách chỉ còn hiển thị nhãn. Lý do đứng sau: đổi bậc phễu là quyết định cần nhìn cả
// hồ sơ (đã gọi chưa, con mấy tuổi, ghi chú gì) — làm được ngay trên một dòng bảng thì
// dễ bấm nhầm, mà bấm nhầm ở đây là lead rơi khỏi phễu.
//
// Tách ra file riêng vì `leads-table.tsx` từng giữ bản gốc: để nguyên trong đó rồi
// import ngược là kéo cả bảng (và mọi state của nó) vào trang chi tiết.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { LeadStatus } from "@prisma/client";
import { updateLeadStatus } from "../actions";
import { LyDoRotDialog } from "./ly-do-rot-dialog";
import {
  KANBAN_COLUMNS,
  LEAD_DROP_STATUSES,
  LEAD_STATUS_BADGE as STATUS_COLORS,
  LEAD_STATUS_LABEL as STATUS_LABELS,
} from "@/lib/leads/status";

export function LeadStatusSelect({
  leadId,
  status,
  parentName,
  canChangeStatus,
}: {
  leadId: string;
  status: string;
  parentName: string;
  /** 27/08 — `leads:change-status` (chỉ Sale), KHÔNG phải `leads:edit`. */
  canChangeStatus: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** Bậc rơi đang chờ lý do. `null` = không có gì đang chờ. */
  const [choLyDo, setChoLyDo] = useState<LeadStatus | null>(null);

  function doiTrangThai(next: LeadStatus, lyDo?: string) {
    startTransition(async () => {
      const res = await updateLeadStatus(leadId, next, lyDo);
      if (!res.ok) {
        // Guard pipeline (R7-01) chặn có lý do — nói rõ lý do cho sale.
        toast.error(res.error ?? "Không đổi được trạng thái");
        return;
      }
      setChoLyDo(null);
      toast.success("Đã đổi trạng thái");
      // Trang chi tiết là Server Component: không refresh thì nhãn ở khối thông tin,
      // dòng lịch sử và mốc "đổi trạng thái" vẫn là số cũ.
      router.refresh();
    });
  }

  const nhan = STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status;
  const mau =
    STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? "bg-muted text-muted-foreground";

  if (!canChangeStatus) {
    return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${mau}`}>{nhan}</span>;
  }

  return (
    <div className="flex items-center gap-1.5">
      <LyDoRotDialog
        status={choLyDo}
        tenLead={parentName}
        dangGui={pending}
        onHuy={() => setChoLyDo(null)}
        onXacNhan={(lyDo) => choLyDo && doiTrangThai(choLyDo, lyDo)}
      />
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      <select
        // `value` chứ không `defaultValue`: server TỪ CHỐI chuyển bậc thì ô phải quay
        // về trạng thái THẬT. Bản cũ dùng defaultValue + bỏ qua kết quả action ⇒ chọn
        // "Đã đăng ký" trên lead chưa đủ điều kiện thì ô vẫn hiện "Đã đăng ký" trong
        // khi DB không đổi gì, và không báo một chữ nào.
        value={status}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as LeadStatus;
          // Bậc rơi phải kèm lý do — hỏi trước, ghi sau (server cũng kiểm lại).
          if (LEAD_DROP_STATUSES.includes(next)) {
            setChoLyDo(next);
            return;
          }
          doiTrangThai(next);
        }}
        className={`cursor-pointer rounded-lg border-0 py-2 pl-3 pr-8 text-sm font-semibold focus:ring-2 focus:ring-primary/20 disabled:opacity-50 ${mau}`}
      >
        {KANBAN_COLUMNS.map((value) => (
          <option key={value} value={value}>
            {STATUS_LABELS[value]}
          </option>
        ))}
      </select>
    </div>
  );
}
