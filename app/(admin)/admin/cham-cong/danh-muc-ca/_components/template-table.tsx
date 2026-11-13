"use client";

// Bảng danh mục mã ca. Đây là chỗ người vận hành ĐỌC nhanh: mã nào còn dùng, ca nào gãy, mã nào
// riêng cơ sở — nên cột "Giờ" vẽ thành vạch thời gian thay vì hai cột "Sáng/Chiều" rời nhau.
//
// Điều dễ vỡ:
//  · Mã "Dùng chung" hiện với MỌI người (ShiftTemplate ∈ NULL_IS_GLOBAL_MODELS) nhưng chỉ Hội sở
//    sửa được ⇒ `canGlobal = false` phải ẨN nút Sửa/Ngưng, không phải để bấm rồi server chửi.
//  · Bảng phải nằm trong `<PhanTrangBang cuonNgang>` với ĐÚNG MỘT `<tbody>` — `bang-coverage.test`
//    quét mọi file có `<table`. Trạng thái rỗng vẽ NGOÀI bảng.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { EmptyState } from "@/components/admin/ui/states";
import {
  BTN_DANGER,
  BTN_OUTLINE,
  BTN_PRIMARY,
  CHIP,
  CHIP_ACTIVE,
  CHIP_IDLE,
  PILL,
} from "@/components/admin/cham-cong/classes";
import { plannedMinutes, type ShiftSegment } from "@/lib/cham-cong/catalog";
import { toggleShiftTemplateAction } from "../_actions";
import { TemplateSheet } from "./template-sheet";
import {
  ATTENDANCE_LABEL,
  KIND_LABEL,
  placeLabel,
  type TemplateCenter,
  type TemplateEditorValue,
} from "./template-editor";

export type TemplateRow = TemplateEditorValue & { id: string; centerName: string | null };

type Filter = "all" | "active" | "off";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "active", label: "Đang dùng" },
  { key: "off", label: "Đã ngưng" },
];

/** Vạch giờ 06:00–22:00, mỗi ô 30 phút ⇒ 32 ô. */
const DAY_START = 6 * 60;
const SLOT = 30;
const SLOTS = 32;

function slotIndex(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const idx = Math.round(((h * 60 + m) - DAY_START) / SLOT);
  return Math.max(0, Math.min(SLOTS, idx));
}

function fmtMinutes(m: number): string {
  if (!m) return "—";
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

function segmentsLabel(segs: ShiftSegment[]): string {
  if (segs.length === 0) return "Không khai giờ";
  return segs.map((s) => `${s.start}–${s.end}`).join(", ");
}

/** Vạch thời gian của một mã ca: làm việc đậm, nghỉ giữa giờ nhạt. */
function TimeBar({ segs }: { segs: ShiftSegment[] }) {
  const label = segmentsLabel(segs);
  if (segs.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      className="grid h-3 w-48 grid-cols-[repeat(32,minmax(0,1fr))] overflow-hidden rounded border border-border bg-background"
      title={`${label} (vạch 06:00–22:00)`}
    >
      {segs.map((s, i) => {
        const from = slotIndex(s.start);
        const to = Math.max(from + 1, slotIndex(s.end));
        return (
          <span
            key={i}
            style={{ gridColumnStart: from + 1, gridColumnEnd: to + 1 }}
            className={s.kind === "WORK" ? "bg-primary-soft" : "bg-muted"}
          />
        );
      })}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function TemplateTable({
  rows,
  centers,
  canGlobal,
}: {
  rows: TemplateRow[];
  centers: TemplateCenter[];
  canGlobal: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [open, setOpen] = useState(false);
  /** Bấm "Ngưng" lần một chỉ hỏi lại; lần hai mới gọi server. */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const shown = rows.filter((r) => (filter === "all" ? true : filter === "active" ? r.isActive : !r.isActive));
  const countActive = rows.filter((r) => r.isActive).length;

  function openNew() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(row: TemplateRow) {
    setEditing(row);
    setOpen(true);
  }

  function toggle(row: TemplateRow) {
    if (row.isActive && confirmId !== row.id) {
      setConfirmId(row.id);
      return;
    }
    setConfirmId(null);
    start(async () => {
      const r = await toggleShiftTemplateAction(row.id, !row.isActive);
      if (!r.ok) toast.error(r.error);
      else toast.success(row.isActive ? `Đã ngưng mã ${row.code}` : `Đã bật lại mã ${row.code}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            className={cn(CHIP, filter === f.key ? CHIP_ACTIVE : CHIP_IDLE)}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className="tabular-nums">
              {f.key === "all" ? rows.length : f.key === "active" ? countActive : rows.length - countActive}
            </span>
          </button>
        ))}
        <button type="button" className={cn(BTN_PRIMARY, "ml-auto")} onClick={openNew}>
          <Plus className="h-4 w-4" aria-hidden /> Thêm mã ca
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Chưa có mã ca"
          description="Chưa khai mã nào nên lưới phân ca không xếp được ô và import từ Sheet sẽ báo “mã lạ”. Thêm các mã đang dùng trên Sheet trước: S, C, T, CG, X, P."
          action={
            <button type="button" className={BTN_PRIMARY} onClick={openNew}>
              <Plus className="h-4 w-4" aria-hidden /> Thêm mã ca
            </button>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title="Không có mã nào ở bộ lọc này"
          description={filter === "off" ? "Chưa mã nào bị ngưng." : "Mọi mã đang ở trạng thái ngưng."}
          action={
            <button type="button" className={BTN_OUTLINE} onClick={() => setFilter("all")}>
              Xem tất cả
            </button>
          }
        />
      ) : (
        // Vỏ thẻ chuẩn của bảng danh sách trong module (giống `period-table` và
        // `request-queue-table`): `TableSkeleton` lúc chờ cũng vẽ đúng vỏ này, thiếu nó là khung bo
        // góc hiện ra rồi biến mất khi dữ liệu về.
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang cuonNgang tenDonVi="mã ca" khoaGhiNho="cham-cong-danh-muc-ca">
            <table className="w-full min-w-[1120px] text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th scope="col" className={adminTh}>Mã</th>
                <th scope="col" className={adminTh}>Tên</th>
                <th scope="col" className={adminTh}>Loại</th>
                <th scope="col" className={adminTh}>Giờ</th>
                <th scope="col" className={cn(adminTh, "text-right")}>Giờ KH</th>
                <th scope="col" className={cn(adminTh, "text-right")}>Công</th>
                <th scope="col" className={adminTh}>Nơi làm</th>
                <th scope="col" className={adminTh}>Phạm vi</th>
                <th scope="col" className={adminTh}>Trạng thái</th>
                <th scope="col" className={cn(adminTh, "text-right")}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const segs = r.segments as ShiftSegment[];
                const shared = r.centerId === null;
                const canEdit = shared ? canGlobal : true;
                const isEditing = open && editing?.id === r.id;
                return (
                  <tr
                    key={r.id}
                    className={cn(adminTr, isEditing && "bg-primary-soft", !r.isActive && "opacity-60")}
                  >
                    <td className={cn(adminTd, "font-mono font-semibold")}>{r.code}</td>
                    <td className={adminTd}>
                      <span className="block max-w-[16rem] truncate" title={r.name}>{r.name}</span>
                      {r.note && (
                        <span className="block max-w-[16rem] truncate text-xs text-muted-foreground" title={r.note}>
                          {r.note}
                        </span>
                      )}
                    </td>
                    <td className={cn(adminTd, "text-xs text-muted-foreground")}>
                      {KIND_LABEL[r.kind]}
                      {r.kind !== "OFF" && r.kind !== "LEAVE" && ` · ${ATTENDANCE_LABEL[r.attendanceMode]}`}
                    </td>
                    <td className={adminTd}>
                      <TimeBar segs={segs} />
                    </td>
                    <td className={cn(adminTd, "text-right tabular-nums")}>
                      {fmtMinutes(plannedMinutes({ segments: segs, nominalMinutes: r.nominalMinutes }))}
                    </td>
                    <td className={cn(adminTd, "text-right tabular-nums")}>{r.dayCredit}</td>
                    <td className={cn(adminTd, "text-xs text-muted-foreground")}>
                      <span className="block max-w-[12rem] truncate" title={r.defaultPlace}>
                        {placeLabel(r.defaultPlace, centers)}
                      </span>
                    </td>
                    <td className={adminTd}>
                      <span
                        className={cn(
                          PILL,
                          shared ? "bg-state-info-soft text-state-info-ink" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {r.centerName ?? "Dùng chung"}
                      </span>
                    </td>
                    <td className={adminTd}>
                      <span
                        className={cn(
                          PILL,
                          r.isActive
                            ? "bg-state-success-soft text-state-success-ink"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {r.isActive ? "Đang dùng" : "Đã ngưng"}
                      </span>
                    </td>
                    <td className={cn(adminTd, "text-right")}>
                      {canEdit ? (
                        <span className="inline-flex items-center justify-end gap-2">
                          {/* Nút trên HÀNG dùng cùng cỡ ở cả 4 màn danh mục (mã ca · loại nghỉ ·
                              điểm chấm · ghi chú): `h-8 px-3 text-xs`, bản icon là `h-8 w-8 px-0`. */}
                          <button
                            type="button"
                            aria-label={`Sửa mã ca ${r.code}`}
                            className={cn(BTN_OUTLINE, "h-8 w-8 justify-center px-0")}
                            onClick={() => openEdit(r)}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            className={cn(
                              confirmId === r.id ? BTN_DANGER : BTN_OUTLINE,
                              "h-8 px-3 text-xs",
                            )}
                            onClick={() => toggle(r)}
                            onBlur={() => setConfirmId((id) => (id === r.id ? null : id))}
                          >
                            {r.isActive ? (confirmId === r.id ? "Xác nhận ngưng?" : "Ngưng") : "Bật lại"}
                          </button>
                        </span>
                      ) : (
                        <span
                          className="text-xs text-muted-foreground"
                          title="Mã dùng chung — cần quyền cấu hình tại Hội sở mới sửa được"
                        >
                          Chỉ xem
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}

      <TemplateSheet
        open={open}
        onOpenChange={setOpen}
        value={editing}
        centers={centers}
        canGlobal={canGlobal}
        onSaved={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}
