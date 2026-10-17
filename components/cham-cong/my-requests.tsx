"use client";

// components/cham-cong/my-requests.tsx — "ĐƠN CỦA TÔI" của người dùng site admin (tư vấn, giáo vụ,
// kế toán, người Hội sở…). Site GV giữ danh sách riêng (`don-tu-client.tsx`) vì đã có bộ lọc và
// EmptyState theo vỏ site GV; FORM thì dùng chung một bản (`request-form.tsx`).
//
// Vì sao màn này tồn tại: nhân viên cần thấy đơn mình nộp ĐANG Ở ĐÂU — chờ ai duyệt, bị từ chối vì
// lý do gì, hay đã duyệt mà hệ thống KHÔNG áp được (cột "Phản hồi"). Không có nó thì mỗi lần thắc
// mắc là một tin nhắn cho Quản lý.
//
// DỄ VỠ: file nằm trong `components/cham-cong/**` — thư mục dùng chung với site giáo viên ⇒ KHÔNG
// import `components/admin/**` và CHỈ dùng token `:root` (không `primary-soft`/`primary-ink`).
//
// BỘ LỌC LÀ CHIP, KHÔNG PHẢI TAB. Bản trước vẽ bộ lọc trạng thái bằng đúng vỏ tab gạch chân của
// MeNav, nên `/don-tu/cua-toi` có HAI hàng gạch chân giống hệt xếp chồng — hàng trên là điều hướng,
// hàng dưới là bộ lọc — đọc như hai cấp điều hướng. Chip là idiom LỌC của cả module (`/don-tu`,
// `/cham-cong`, `/danh-muc-ca`); gạch chân dành riêng cho điều hướng.
import { useMemo, useState } from "react";
import { Inbox, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  WR_STATUS_LABEL,
  type WorkRequestKindV,
  type WorkRequestStatusV,
} from "@/lib/work-request";
import type { RequestFormOptions } from "@/lib/cham-cong/request-form-data";
import { RequestForm } from "./request-form";
import { NhanLoaiDon } from "./ui/loai-don";
import { NutThuHoiDon } from "./nut-thu-hoi-don";
import { NutXinHuyDon } from "./nut-xin-huy-don";

export type MyRequestRow = {
  id: string;
  kind: WorkRequestKindV;
  status: WorkRequestStatusV;
  centerLabel: string;
  fromLabel: string | null;
  toLabel: string | null;
  time: string | null;
  detail: string | null;
  reason: string;
  submittedLate: boolean;
  applyError: string | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  createdAtLabel: string;
  /** "Xin nghỉ phép năm 2 ngày (12–13/10)…" — `tomTatDon`, cùng câu màn duyệt của QLCS đọc. */
  tomTat: string;
  /**
   * Đợt 11 — câu "nếu duyệt huỷ hệ thống sẽ…" khi đơn XIN HUỶ ĐƯỢC (`coTheXinHuy`); null ⇒ không vẽ nút.
   */
  xinHuy: string | null;
  /** Lý do người nộp xin huỷ + ghi chú quyết định huỷ (nếu đã từng xin). */
  lyDoHuy: string | null;
  ghiChuHuy: string | null;
};

const PILL = "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold";
const TH = "whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const TD = "px-5 py-3.5 text-sm text-foreground";
const TR = "border-b border-border/60 align-top transition-colors last:border-0 hover:bg-muted/50";

/** Chip lọc. Bản sao CÓ CHỦ ĐÍCH của `CHIP` trong `components/admin/cham-cong/classes.ts` — thư mục
 *  dùng chung không được nhập file admin. Khác một điểm và CHỈ một điểm: chip đang chọn dùng
 *  `border/ring/text-primary` thay cho `bg-primary-soft text-primary-ink`, vì hai token đó chỉ tồn
 *  tại trong `.admin-scope` (site GV mount file này thì chúng rơi về trong suốt). Chọn `ring-1` chứ
 *  không `font-semibold`: đổi độ đậm là chip đổi bề ngang, hàng lọc nhảy mỗi lần bấm. */
const CHIP =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const CHIP_ACTIVE = "border-primary bg-card text-primary ring-1 ring-primary";
const CHIP_IDLE = "border-border bg-card text-muted-foreground hover:bg-muted";

const STATUS_CLS: Record<WorkRequestStatusV, string> = {
  PENDING: "bg-state-warning-soft text-state-warning-ink",
  APPROVED: "bg-state-success-soft text-state-success-ink",
  REJECTED: "bg-state-danger-soft text-state-danger-ink",
  WITHDRAWN: "bg-muted text-muted-foreground",
  CANCEL_REQUESTED: "bg-state-warning-soft text-state-warning-ink",
  CANCELLED: "bg-muted text-muted-foreground",
};

type Filter = "ALL" | WorkRequestStatusV;

export function MyRequests({
  rows,
  options,
  presetKind,
  presetDate,
  presetStatus,
}: {
  rows: MyRequestRow[];
  options: RequestFormOptions;
  presetKind: WorkRequestKindV | null;
  /** `?date=` từ lịch ca — điền sẵn ngày vào form. */
  presetDate?: string | null;
  /** `?status=` — chỉ là trạng thái BAN ĐẦU của bộ lọc; lọc chạy ở client, không tải lại trang. */
  presetStatus?: Filter | null;
}) {
  const [open, setOpen] = useState(Boolean(presetKind));
  const [filter, setFilter] = useState<Filter>(presetStatus ?? "ALL");

  const counts = useMemo(() => {
    const c: Record<WorkRequestStatusV, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, WITHDRAWN: 0, CANCEL_REQUESTED: 0, CANCELLED: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const shown = filter === "ALL" ? rows : rows.filter((r) => r.status === filter);

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "ALL", label: "Tất cả", count: rows.length },
    { key: "PENDING", label: "Chờ duyệt", count: counts.PENDING },
    { key: "APPROVED", label: "Đã duyệt", count: counts.APPROVED },
    { key: "REJECTED", label: "Từ chối", count: counts.REJECTED },
    // Chip "Đã thu hồi" chỉ hiện khi CÓ đơn thu hồi — chip đếm 0 thường trực là nhiễu.
    ...(counts.WITHDRAWN > 0 ? [{ key: "WITHDRAWN" as const, label: "Đã thu hồi", count: counts.WITHDRAWN }] : []),
    // Đợt 11 — cùng luật: chỉ hiện khi có.
    ...(counts.CANCEL_REQUESTED > 0 ? [{ key: "CANCEL_REQUESTED" as const, label: "Chờ duyệt huỷ", count: counts.CANCEL_REQUESTED }] : []),
    ...(counts.CANCELLED > 0 ? [{ key: "CANCELLED" as const, label: "Đã huỷ", count: counts.CANCELLED }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Lọc theo trạng thái đơn" className="flex flex-wrap gap-2">
          {tabs.map((t) => {
            const on = filter === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(t.key)}
                className={cn(CHIP, on ? CHIP_ACTIVE : CHIP_IDLE)}
              >
                {t.label}
                <b className="tabular-nums text-foreground">{t.count}</b>
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" aria-hidden /> Tạo đơn
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-12 text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Inbox className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm font-semibold text-foreground">
            {rows.length === 0
              ? "Bạn chưa nộp đơn nào"
              : `Không có đơn nào ở bộ lọc “${tabs.find((t) => t.key === filter)?.label}”`}
          </p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {rows.length === 0
              ? "Đổi ca, nghỉ phép, chỉnh công (quên quét), tăng ca, đi muộn/về sớm, công tác — đều nộp ở đây."
              : "Chọn “Tất cả” để xem lại toàn bộ đơn bạn đã nộp."}
          </p>
        </div>
      ) : (
        // Vỏ thẻ bọc ngoài bảng: `TableSkeleton` của khung chờ luôn vẽ vỏ này, nên bảng trần là
        // người dùng thấy một khung bo góc hiện ra rồi BIẾN MẤT lúc dữ liệu về.
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang cuonNgang tenDonVi="đơn" khoaGhiNho="cua-toi">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th scope="col" className={TH}>Loại</th>
                  <th scope="col" className={TH}>Ngày / giờ</th>
                  <th scope="col" className={TH}>Cơ sở nhận</th>
                  <th scope="col" className={TH}>Lý do</th>
                  <th scope="col" className={TH}>Trạng thái</th>
                  <th scope="col" className={TH}>Phản hồi</th>
                  <th scope="col" className={TH}>Gửi lúc</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={TR}>
                    <td className={cn(TD, "font-medium")}>
                      {/* Nhãn + chữ "i" dùng chung với form nộp và màn duyệt. */}
                      <NhanLoaiDon kind={r.kind} />
                      <div className="mt-1 max-w-[18rem] whitespace-normal text-xs font-normal text-muted-foreground">
                        {r.tomTat}
                      </div>
                    </td>
                    <td className={cn(TD, "whitespace-nowrap tabular-nums")}>
                      {r.fromLabel ?? "—"}
                      {r.toLabel && r.toLabel !== r.fromLabel ? ` → ${r.toLabel}` : ""}
                      {r.time ? <div className="font-mono text-xs text-muted-foreground">{r.time}</div> : null}
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>{r.centerLabel}</td>
                    <td className={cn(TD, "max-w-[20rem] whitespace-pre-wrap")}>{r.reason}</td>
                    <td className={cn(TD, "whitespace-normal")}>
                      <span className={cn(PILL, STATUS_CLS[r.status])}>{WR_STATUS_LABEL[r.status]}</span>
                      {r.submittedLate && <span className={cn(PILL, STATUS_CLS.PENDING, "ml-1")}>Nộp muộn</span>}
                      {r.status === "PENDING" && r.applyError && (
                        <span className={cn(PILL, STATUS_CLS.REJECTED, "ml-1")} title={r.applyError}>
                          không áp được
                        </span>
                      )}
                      {/* Chỉ người nộp, chỉ đơn còn chờ (chốt Q-2) — server kiểm lại cả hai. */}
                      {r.status === "PENDING" && <NutThuHoiDon id={r.id} className="mt-2" />}
                      {/* Đợt 11 — chỉ đơn đã duyệt mà server nhận huỷ (`coTheXinHuy`). */}
                      {r.xinHuy && <NutXinHuyDon id={r.id} khiDuyetHuy={r.xinHuy} className="mt-2" />}
                      {r.lyDoHuy && <p className="mt-2 max-w-[16rem] whitespace-pre-wrap text-xs text-muted-foreground">Xin huỷ: {r.lyDoHuy}{r.ghiChuHuy ? ` · Quản lý: ${r.ghiChuHuy}` : ""}</p>}
                    </td>
                    <td className={cn(TD, "max-w-[16rem] whitespace-pre-wrap text-muted-foreground")}>
                      {r.reviewNote ? (
                        <>
                          {r.reviewedByName ? <span className="font-medium text-foreground">{r.reviewedByName}: </span> : null}
                          {r.reviewNote}
                        </>
                      ) : (
                        "—"
                      )}
                      {r.status === "PENDING" && r.applyError && (
                        <div className="mt-1 text-xs text-state-danger-ink">
                          Lần duyệt gần nhất không áp được: {r.applyError}
                        </div>
                      )}
                    </td>
                    <td className={cn(TD, "whitespace-nowrap text-xs text-muted-foreground")}>{r.createdAtLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}

      {/* Form nằm trong Sheet phải: bảng đơn cũ vẫn đọc được trong lúc điền, và form dài không
          đẩy bảng xuống dưới màn hình. `showCloseButton={false}` vì RequestForm đã có nút Đóng
          riêng — hai chữ X chồng nhau ở một góc là mời bấm nhầm. */}
      <Sheet open={open} onOpenChange={setOpen}>
        {/* 3xl chứ không xl: đây là mặt NHẬP LIỆU chính của module — một rail chọn loại đơn
            13rem cộng lưới hai cột ngày/giờ/mã ca. Ở 576px thì mỗi ô còn ~190px, ngày và mã ca
            chen nhau; 768px cho mỗi ô ~236px. Vẫn bị `w-3/4` chặn trên nên máy nhỏ không bị
            panel chiếm hết màn. */}
        <SheetContent side="right" showCloseButton={false} className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetTitle className="sr-only">Tạo đơn mới</SheetTitle>
          <RequestForm
            options={options}
            preset={presetKind}
            presetDate={presetDate}
            onClose={() => setOpen(false)}
            className="rounded-none border-0 shadow-none"
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
