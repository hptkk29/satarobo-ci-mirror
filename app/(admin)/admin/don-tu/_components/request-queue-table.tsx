"use client";

// app/(admin)/admin/don-tu/_components/request-queue-table.tsx — hàng chờ duyệt dạng BẢNG.
//
// Vì sao file này tồn tại: bản cũ xếp 200 thẻ dọc, mỗi thẻ 8 dòng chữ nhỏ — không so được đơn nào
// gấp hơn đơn nào. Bảng cho phép liếc một cột (Áp dụng / Tuổi đơn) là thấy thứ tự việc; chi tiết
// đầy đủ và nút quyết định dời sang Sheet bên phải.
//
// Điều dễ vỡ:
//  · Mọi ô đã được ĐỊNH DẠNG SẴN Ở SERVER (chuỗi ngày, giờ VN). Component này không nhận `Date`
//    và không tự format — format ở client là lệch múi giờ (Vercel chạy UTC).
//  · Bảng phải bọc `<PhanTrangBang cuonNgang>` với ĐÚNG MỘT `<tbody>`; tách thân làm hai là mất
//    phân trang IM LẶNG (fail-safe của PhanTrangBang không kêu).
//  · Cả dòng bấm được, nhưng vẫn phải có `<button>` thật ở cột cuối — dòng `<tr onClick>` không
//    dùng được bằng bàn phím.
//  · ĐẢO 06/10/2026 — dòng HAI tầng (~56px): cột đầu là "Đơn" = tên người nộp + CÂU TÓM TẮT
//    (`tomTatDon`, chủ dự án: "làm rõ hơn cho QLCS đọc dễ hiểu hơn"). ~~Dòng 44px `h-11` + `py-0`
//    cho khớp mật độ `/cham-cong`~~: một dòng 44px không chứa nổi câu tóm tắt, và câu đó chính là
//    thứ người duyệt cần đọc để quyết. `py-2` thay `py-0`.
//  · Cột "Loại" có chữ "i" (`NhanLoaiDon`) — nút "i" tự `stopPropagation`, nên chạm để đọc giải
//    thích KHÔNG mở panel của dòng.
//  · Ô chữ dài cắt bằng `<span className="block max-w-[…] truncate">` BÊN TRONG `<td>`, không đắp
//    `max-w` thẳng lên `<td>`: bảng này là `table-layout: auto` ⇒ trình duyệt bỏ qua `max-width`
//    trên ô bảng, mà `adminTd` đã có `whitespace-nowrap` nên ô không cắt, nó nở ra kéo cả cột.
//  · Trạng thái RỖNG thuộc về page (`don-tu/page.tsx` dựng `<EmptyState>` khi `rows.length === 0`),
//    nên ở đây không có nhánh rỗng — một dòng `<td colSpan>` trần vừa không nói vì sao rỗng vừa
//    không cho đường đi tiếp.
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { EFFECT_CLS, PILL } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import type { WorkRequestStatusV } from "@/lib/work-request";
import { NhanLoaiDon } from "@/components/cham-cong/ui/loai-don";
import type { QueueRow } from "./types";

export type { QueueRow };
import { RequestSheet } from "./request-sheet";

/** Một dòng đơn — TOÀN chuỗi đã format, để component chạy được ở client mà không đụng múi giờ. */
const STATUS_CLS: Record<WorkRequestStatusV, string> = {
  PENDING: "bg-state-warning-soft text-state-warning-ink",
  APPROVED: "bg-state-success-soft text-state-success-ink",
  REJECTED: "bg-state-danger-soft text-state-danger-ink",
  WITHDRAWN: "bg-muted text-muted-foreground",
  CANCEL_REQUESTED: "bg-state-warning-soft text-state-warning-ink",
  CANCELLED: "bg-muted text-muted-foreground",
};

const DUE_CLS = {
  danger: "text-state-danger-ink font-semibold",
  warning: "text-state-warning-ink font-semibold",
  muted: "text-muted-foreground",
} as const;

export function RequestQueueTable({
  rows,
  initialId,
}: {
  rows: QueueRow[];
  /** `?id=` — thông báo/liên kết ngoài mở thẳng một đơn. */
  initialId?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(
    initialId && rows.some((r) => r.id === initialId) ? initialId : null,
  );
  const selected = rows.find((r) => r.id === openId) ?? null;

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <PhanTrangBang cuonNgang tenDonVi="đơn" khoaGhiNho="don-tu">
          <table className="w-full min-w-[1100px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={adminTh}>Đơn</th>
                <th scope="col" className={adminTh}>Loại</th>
                <th scope="col" className={adminTh}>Áp dụng</th>
                <th scope="col" className={adminTh}>Thay đổi</th>
                <th scope="col" className={adminTh}>Cơ sở</th>
                <th scope="col" className={adminTh}>Tuổi đơn</th>
                <th scope="col" className={adminTh}>Trạng thái</th>
                <th scope="col" className={adminTh}>
                  <span className="sr-only">Mở chi tiết đơn</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  className={cn(adminTr, "cursor-pointer", openId === r.id && "bg-muted/50")}
                >
                  <td className={cn(adminTd, "py-2")} title={r.tomTat}>
                    <span className="block max-w-[22rem] truncate font-medium">{r.requesterName}</span>
                    <span className="block max-w-[22rem] truncate text-xs text-muted-foreground">{r.tomTat}</span>
                  </td>
                  <td className={cn(adminTd, "py-2")}>
                    {r.kind ? <NhanLoaiDon kind={r.kind} /> : r.kindLabel}
                    {r.submittedLate && (
                      <span className={cn(PILL, "ml-2 bg-state-warning-soft text-state-warning-ink")}>
                        Nộp muộn
                      </span>
                    )}
                  </td>
                  <td className={cn(adminTd, "py-2")} title={r.applyTitle}>
                    <span className="tabular-nums">{r.applyLabel}</span>
                    {r.timeLabel && (
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground">{r.timeLabel}</span>
                    )}
                    {r.dueLabel && (
                      <span className={cn("ml-1.5 text-xs", DUE_CLS[r.dueTone])}>· {r.dueLabel}</span>
                    )}
                  </td>
                  <td className={cn(adminTd, "py-2", EFFECT_CLS[r.effectTone])} title={r.effectText}>
                    <span className="block max-w-[18rem] truncate">{r.effectText}</span>
                  </td>
                  <td className={cn(adminTd, "py-2 text-muted-foreground")} title={r.centerLabel}>
                    {r.centerCode}
                  </td>
                  <td
                    className={cn(
                      adminTd,
                      "py-2 tabular-nums",
                      r.stale && "font-semibold text-state-danger-ink",
                    )}
                  >
                    {r.ageLabel}
                  </td>
                  <td className={cn(adminTd, "py-2")}>
                    <span className={cn(PILL, STATUS_CLS[r.status])}>{r.statusLabel}</span>
                    {r.applyError && (
                      <span className={cn(PILL, "ml-1.5 bg-state-danger-soft text-state-danger-ink")}>
                        Áp thất bại
                      </span>
                    )}
                  </td>
                  <td className={cn(adminTd, "w-10 py-2 text-right")}>
                    <button
                      type="button"
                      onClick={() => setOpenId(r.id)}
                      aria-label={`Mở đơn ${r.kindLabel} của ${r.requesterName}`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRight aria-hidden className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>

      <RequestSheet row={selected} onClose={() => setOpenId(null)} />
    </>
  );
}
