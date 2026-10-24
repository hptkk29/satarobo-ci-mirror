"use client";

import { useMemo, useState } from "react";
import { Inbox, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ListToolbar,
  type SelectFilter,
} from "../../_components/ui/list-toolbar";
import { EmptyState } from "../../_components/ui/empty-state";
import {
  WORK_REQUEST_KINDS,
  WR_KIND_LABEL,
  WR_STATUS_LABEL,
  wrCategoryOf,
  type WorkRequestKindV,
  type WorkRequestStatusV,
} from "@/lib/work-request";
import { RequestForm } from "@/components/cham-cong/request-form";
import { NhanLoaiDon } from "@/components/cham-cong/ui/loai-don";
import { NutThuHoiDon } from "@/components/cham-cong/nut-thu-hoi-don";
import { NutXinHuyDon } from "@/components/cham-cong/nut-xin-huy-don";
import type { RequestFormOptions } from "@/lib/cham-cong/request-form-data";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export interface WorkRequestRow {
  id: string;
  kind: WorkRequestKindV;
  status: WorkRequestStatusV;
  fromLabel: string | null;
  toLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  hours: number | null;
  className: string | null;
  detail: string | null;
  reason: string;
  reviewNote: string | null;
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
}

const STATUS_CLS: Record<WorkRequestStatusV, string> = {
  PENDING:
    "border-state-warning-soft bg-state-warning-soft text-state-warning-ink dark:border-state-warning",
  APPROVED:
    "border-state-success-soft bg-state-success-soft text-state-success-ink dark:border-state-success",
  REJECTED:
    "border-state-danger-soft bg-state-danger-soft text-state-danger-ink dark:border-state-danger",
  WITHDRAWN: "border-border bg-muted text-muted-foreground",
  CANCEL_REQUESTED:
    "border-state-warning-soft bg-state-warning-soft text-state-warning-ink dark:border-state-warning",
  CANCELLED: "border-border bg-muted text-muted-foreground",
};

const ALL = "ALL";

export function DonTuClient({
  rows,
  options,
  presetKind,
  presetSwap,
  presetDate,
}: {
  rows: WorkRequestRow[];
  options: RequestFormOptions;
  presetKind: string | null;
  presetSwap: string | null;
  /** `?date=` — điền sẵn ngày vào form. */
  presetDate?: string | null;
}) {
  const preset = (WORK_REQUEST_KINDS as readonly string[]).includes(
    presetKind ?? "",
  )
    ? (presetKind as WorkRequestKindV)
    : presetSwap
      ? "SHIFT_SWAP"
      : null;
  const [open, setOpen] = useState(Boolean(preset));
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);

  const kindOptions: SelectFilter["options"] = [
    { value: ALL, label: "Mọi loại đơn" },
    ...WORK_REQUEST_KINDS.map((k) => ({ value: k, label: WR_KIND_LABEL[k] })),
  ];
  const statusOptions: SelectFilter["options"] = [
    { value: ALL, label: "Mọi trạng thái" },
    { value: "PENDING", label: "Chờ duyệt" },
    { value: "APPROVED", label: "Đã duyệt" },
    { value: "REJECTED", label: "Từ chối" },
    { value: "WITHDRAWN", label: "Đã thu hồi" },
    { value: "CANCEL_REQUESTED", label: "Chờ duyệt huỷ" },
    { value: "CANCELLED", label: "Đã huỷ" },
  ];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter !== ALL && r.kind !== kindFilter) return false;
      if (statusFilter !== ALL && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.reason.toLowerCase().includes(q) ||
        r.tomTat.toLowerCase().includes(q) ||
        WR_KIND_LABEL[r.kind].toLowerCase().includes(q) ||
        (r.className ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, kindFilter, statusFilter]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Đơn từ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gửi và theo dõi đơn theo nhóm: lớp học (đổi lớp dạy, dạy thay…), ca
            làm (đổi ca, OT…), nghỉ phép &amp; khác. Quản lý cơ sở duyệt đơn.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setOpen((v) => !v)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Tạo đơn
        </Button>
      </div>

      {open && (
        <RequestForm
          className="mb-5"
          options={options}
          preset={preset}
          presetDate={presetDate}
          onClose={() => setOpen(false)}
        />
      )}

      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm theo lý do, loại đơn, lớp..."
        filters={[
          { value: kindFilter, onChange: setKindFilter, options: kindOptions },
          {
            value: statusFilter,
            onChange: setStatusFilter,
            options: statusOptions,
          },
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Chưa có đơn nào"
          description="Bấm “Tạo đơn” để gửi đơn mới."
        />
      ) : (
        <div className="t-card overflow-hidden">
          <PhanTrangBang cuonNgang
          khoaGhiNho="gv-don-tu">
            <table className="min-w-[1000px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <th scope="col" className="px-5 py-3">
                    Loại đơn
                  </th>
                  <th scope="col" className="px-5 py-3">
                    Nhóm
                  </th>
                  <th scope="col" className="px-5 py-3">
                    Thời gian
                  </th>
                  <th scope="col" className="px-5 py-3">
                    Nội dung
                  </th>
                  <th scope="col" className="px-5 py-3">
                    Trạng thái
                  </th>
                  <th scope="col" className="px-5 py-3">
                    Ngày gửi
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <RequestRow key={r.id} r={r} />
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}
    </div>
  );
}

function RequestRow({ r }: { r: WorkRequestRow }) {
  const cat = wrCategoryOf(r.kind);
  const period =
    r.fromLabel && r.toLabel && r.fromLabel !== r.toLabel
      ? `${r.fromLabel} → ${r.toLabel}`
      : (r.fromLabel ?? r.toLabel ?? "—");
  const time =
    r.startTime && r.endTime
      ? `${r.startTime}-${r.endTime}`
      : r.startTime
        ? r.startTime
        : null;
  return (
    <tr className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40">
      <td className="whitespace-nowrap px-5 py-3.5">
        {/* Nhãn + chữ "i" dùng chung với form nộp và màn duyệt — một nguồn giải thích. */}
        <NhanLoaiDon kind={r.kind} className="font-semibold text-foreground" />
        {r.className && (
          <p className="mt-0.5 pl-9 text-xs text-muted-foreground">Lớp {r.className}</p>
        )}
      </td>
      <td className="px-5 py-3.5 whitespace-nowrap">
        <span className="text-xs font-medium text-muted-foreground">
          {cat.label}
        </span>
      </td>
      <td className="px-5 py-3.5 whitespace-nowrap text-foreground">
        <p>{period}</p>
        {(time || r.hours != null) && (
          <p className="text-xs text-muted-foreground">
            {time ?? ""}
            {r.hours != null ? `${time ? " · " : ""}${r.hours}h` : ""}
          </p>
        )}
      </td>
      {/* `min-w`: câu tóm tắt + lý do dài — không chặn đáy thì bảng tự động bóp cột này còn
          vài chữ một dòng và mỗi dòng đơn cao cả màn hình (đo 375px, 06/10/2026). */}
      <td className="min-w-[18rem] max-w-sm px-5 py-3.5">
        <p className="font-medium text-foreground">{r.tomTat}</p>
        <p className="text-xs text-muted-foreground">Lý do: {r.reason}</p>
        {r.status === "REJECTED" && r.reviewNote && (
          <p className="text-xs text-state-danger-ink">
            Lý do từ chối: {r.reviewNote}
          </p>
        )}
      </td>
      <td className="px-5 py-3.5">
        <Badge variant="outline" className={STATUS_CLS[r.status]}>
          {WR_STATUS_LABEL[r.status]}
        </Badge>
        {/* Chỉ người nộp, chỉ đơn còn chờ (chốt Q-2) — server kiểm lại cả hai. */}
        {r.status === "PENDING" && <NutThuHoiDon id={r.id} className="mt-2" />}
        {/* Đợt 11 — chỉ đơn đã duyệt mà server nhận huỷ (`coTheXinHuy`). */}
        {r.xinHuy && <NutXinHuyDon id={r.id} khiDuyetHuy={r.xinHuy} className="mt-2" />}
        {r.lyDoHuy && <p className="mt-2 max-w-[16rem] whitespace-pre-wrap text-xs text-muted-foreground">Xin huỷ: {r.lyDoHuy}{r.ghiChuHuy ? ` · Quản lý: ${r.ghiChuHuy}` : ""}</p>}
      </td>
      <td className="px-5 py-3.5 whitespace-nowrap text-muted-foreground">
        {r.createdAtLabel}
      </td>
    </tr>
  );
}
