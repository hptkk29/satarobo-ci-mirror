"use client";

// app/(admin)/admin/don-tu/_components/request-sheet.tsx — chi tiết MỘT đơn + chỗ quyết định.
//
// Vì sao file này tồn tại: bảng chỉ đủ chỗ cho thứ dùng để SO SÁNH các đơn với nhau. Thứ dùng để
// QUYẾT ĐỊNH một đơn (lý do người ta viết, giờ đề nghị, lỗi áp lần trước, ai đã duyệt) thì cần cả
// một khối văn bản — nên nó nằm ở đây, mở ra bên phải mà không rời khỏi hàng chờ.
//
// 06/10/2026 (chủ dự án: *"làm rõ hơn cho QLCS đọc dễ hiểu hơn"*) — thứ tự đọc từ trên xuống:
//   1. Câu tóm tắt (ai xin gì, ngày nào) — `tomTatDon`.
//   2. "Hiện trạng ngày đó" (ô ca + lượt quét CÒN TÍNH) đặt CẠNH "Đơn đề nghị" — người duyệt so
//      hai cột thay vì nhớ. Loại đơn không đụng lịch ca/lượt quét thì chỉ có cột đề nghị.
//   3. Lý do người nộp viết.
//   4. "Khi duyệt sẽ: …" + nút quyết định (`WorkRequestReview`).
// Tiêu đề mang biểu tượng + chữ "i" của loại đơn (`NhanLoaiDon`) — cùng lời giải thích form nộp in.
//
// Điều dễ vỡ: cụm nút duyệt/từ chối chỉ hiện với đơn PENDING. Đơn đã xử lý mở ra vẫn phải đọc được
// (đó là sổ tra cứu), nhưng không có đường bấm — server cũng chặn, đây chỉ là lớp thứ hai.
import { useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EFFECT_CLS, PILL } from "@/components/admin/cham-cong/classes";
import { NhanLoaiDon } from "@/components/cham-cong/ui/loai-don";
import { cn } from "@/lib/utils";
import type { DongThongTin } from "@/lib/cham-cong/tom-tat-don";
import type { WorkRequestStatusV } from "@/lib/work-request";
import type { QueueRow } from "./types";
import { WorkRequestReview } from "./work-request-review";
import { HuyDonReview } from "./huy-don-review";

const STATUS_CLS: Record<WorkRequestStatusV, string> = {
  PENDING: "bg-state-warning-soft text-state-warning-ink",
  APPROVED: "bg-state-success-soft text-state-success-ink",
  REJECTED: "bg-state-danger-soft text-state-danger-ink",
  WITHDRAWN: "bg-muted text-muted-foreground",
  CANCEL_REQUESTED: "bg-state-warning-soft text-state-warning-ink",
  CANCELLED: "bg-muted text-muted-foreground",
};

const NHAN_KHOI = "mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </>
  );
}

/** Một khối "nhãn: giá trị" — Hiện trạng / Đơn đề nghị dùng chung vỏ để hai cột so được. */
function KhoiSo({ tieuDe, dong, nhan }: { tieuDe: string; dong: DongThongTin[]; nhan?: string }) {
  return (
    <section className="min-w-0 rounded-lg border border-border p-3">
      <h3 className={NHAN_KHOI}>{tieuDe}</h3>
      {nhan && <p className="mb-1.5 text-xs text-muted-foreground">{nhan}</p>}
      {dong.length === 0 ? (
        <p className="text-sm text-muted-foreground">Không có trường riêng — xem lý do bên dưới.</p>
      ) : (
        <dl className="space-y-1.5">
          {dong.map((d) => (
            <div key={d.nhan}>
              <dt className="text-xs text-muted-foreground">{d.nhan}</dt>
              <dd className="text-sm font-semibold tabular-nums text-foreground [overflow-wrap:anywhere]">{d.giaTri}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function RequestSheet({ row, onClose }: { row: QueueRow | null; onClose: () => void }) {
  // Focus đầu tiên rơi vào CÂU TÓM TẮT, không vào nút đầu tiên của panel. Đo 06/10/2026 ở 375px:
  // để mặc định thì base-ui đặt focus vào chữ "i" ở tiêu đề ⇒ tooltip TỰ BUNG che kín nửa panel
  // ngay khi mở đơn. Tóm tắt là thứ cần đọc trước, và trình đọc màn hình đọc nó luôn.
  const tomTatRef = useRef<HTMLParagraphElement>(null);
  return (
    <Sheet
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl" initialFocus={tomTatRef}>
        {row && (
          <>
            <SheetHeader>
              <SheetTitle>
                {row.kind ? <NhanLoaiDon kind={row.kind} size="md" /> : row.kindLabel}
              </SheetTitle>
              <SheetDescription>
                {row.requesterName} · {row.centerLabel}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn(PILL, STATUS_CLS[row.status])}>{row.statusLabel}</span>
                {row.submittedLate && (
                  <span className={cn(PILL, "bg-state-warning-soft text-state-warning-ink")}>Nộp muộn</span>
                )}
                {row.applied && (
                  <span className={cn(PILL, "bg-state-success-soft text-state-success-ink")}>
                    Đã áp dụng
                  </span>
                )}
                {row.dueLabel && <span className="text-xs text-muted-foreground">Áp dụng {row.dueLabel}</span>}
                {row.khungDuyetOt && (
                  <span className="text-xs text-muted-foreground">OT được duyệt {row.khungDuyetOt}</span>
                )}
              </div>

              {/* 1. Câu tóm tắt — đọc một câu là biết đơn xin gì. */}
              <p
                ref={tomTatRef}
                tabIndex={-1}
                className="rounded-lg border-l-4 border-primary bg-muted/40 p-3 text-sm font-medium text-foreground focus:outline-none"
              >
                {row.tomTat}
              </p>

              {/* 2. So hai bên. Ở 375px thì xếp dọc (Sheet chiếm hết bề ngang). */}
              <div className={cn("grid grid-cols-1 gap-3", row.hienTrang && "sm:grid-cols-2")}>
                {row.hienTrang && (
                  <KhoiSo
                    tieuDe="Hiện trạng ngày đó"
                    nhan={row.status === "PENDING" ? "Đọc lúc mở trang." : "Đọc lúc mở trang — đơn đã xử lý nên có thể đã đổi theo đơn."}
                    dong={row.hienTrang}
                  />
                )}
                <KhoiSo tieuDe="Đơn đề nghị" dong={row.deNghi} />
              </div>

              {/* `[&>dd]:min-w-0`: ô giá trị là ô lưới, mặc định `min-width:auto` nên chuỗi
                  dài không ngắt đẩy cả lưới tràn khỏi panel. */}
              <dl className="grid grid-cols-[8rem_1fr] items-baseline gap-x-3 gap-y-2 [&>dd]:min-w-0">
                <Row label="Áp dụng">
                  <span className="tabular-nums">{row.applyTitle}</span>
                  {row.timeLabel && <span className="ml-2 font-mono text-muted-foreground">{row.timeLabel}</span>}
                </Row>
                <Row label="Thay đổi">
                  <span className={EFFECT_CLS[row.effectTone]}>{row.effectText}</span>
                </Row>
                <Row label="Gửi lúc">
                  <span className="tabular-nums">{row.createdAtLabel}</span>
                  <span className="ml-2 text-muted-foreground">· chờ {row.ageLabel}</span>
                </Row>
              </dl>

              {/* 3. Lý do. */}
              <div>
                <p className={NHAN_KHOI}>Lý do người nộp viết</p>
                <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm text-foreground">{row.reason}</p>
              </div>

              {row.status === "PENDING" && row.applyError && (
                <p className="rounded-lg bg-state-danger-soft p-3 text-sm text-state-danger-ink">
                  Lần duyệt trước không áp được: {row.applyError}
                </p>
              )}

              {row.status !== "PENDING" && (
                <div className="rounded-lg border border-border p-3">
                  <p className={NHAN_KHOI}>Đã xử lý</p>
                  <p className="text-sm text-foreground">
                    {row.reviewedByName ?? "—"}
                    {row.reviewedAtLabel && (
                      <span className="ml-2 text-muted-foreground tabular-nums">{row.reviewedAtLabel}</span>
                    )}
                  </p>
                  {row.reviewNote && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{row.reviewNote}</p>
                  )}
                </div>
              )}

              {/* Đợt 11 — yêu cầu huỷ đơn đã duyệt: lý do + kết quả quyết định huỷ. */}
              {row.huy && (
                <div className="rounded-lg border border-state-warning-soft p-3">
                  <p className={NHAN_KHOI}>Xin huỷ{row.huy.xinLuc ? ` · ${row.huy.xinLuc}` : ""}</p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{row.huy.lyDo ?? "—"}</p>
                  {row.huy.quyetDinhBoi && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {row.status === "CANCELLED" ? "Đã duyệt huỷ" : "Đã từ chối huỷ"} bởi {row.huy.quyetDinhBoi}
                      {row.huy.quyetDinhLuc ? ` · ${row.huy.quyetDinhLuc}` : ""}
                      {row.huy.ghiChu ? ` — ${row.huy.ghiChu}` : ""}
                    </p>
                  )}
                </div>
              )}
              {row.status === "CANCEL_REQUESTED" && row.huy && (
                <HuyDonReview requestId={row.id} khiDuyetHuy={row.huy.khiDuyetHuy} onDone={onClose} />
              )}

              {/* 4. Khi duyệt sẽ + quyết định. */}
              {row.status === "PENDING" && (
                <WorkRequestReview
                  requestId={row.id}
                  effectHint={row.khiDuyet}
                  effectCode={row.effectCode}
                  effectBlocked={row.effectBlocked}
                  subject={row.subject}
                  khungXinOt={row.khungXinOt}
                  onDone={onClose}
                />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
