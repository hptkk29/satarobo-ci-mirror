"use client";

// Danh mục loại nghỉ — sửa NGAY TRÊN HÀNG. Trước đây bấm "Sửa" mở một khối form 6 ô ở đầu trang,
// nên mắt phải nhảy giữa form và hàng đang sửa để đối chiếu; danh mục chỉ ~8 dòng nên sửa tại chỗ
// là đủ và không mất ngữ cảnh.
//
// Điều dễ vỡ:
//  · Ô "Tỷ lệ lương" nhập theo % cho người thường đọc, nhưng server nhận 0–1 ⇒ chia 100 khi gửi.
//    Gửi thẳng 100 là Zod chửi "phải ≤ 1".
//  · `code` khoá khi sửa: nó là mã đối chiếu với Sheet/MISA, đổi là gãy đối soát (server KHÔNG chặn
//    — chốt chặn nằm ở đây).
//  · Bảng nằm trong `<PhanTrangBang>` với ĐÚNG MỘT `<tbody>`; hàng "thêm mới" cũng phải nằm trong
//    tbody đó, đừng dựng bảng thứ hai.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { EmptyState } from "@/components/admin/ui/states";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, PILL } from "@/components/admin/cham-cong/classes";
import { saveLeaveTypeAction } from "../_actions";

export type LeaveTypeRow = {
  id: string;
  code: string;
  name: string;
  paidRatio: number;
  maxDaysPerYear: number | null;
  noticeDays: number | null;
  countsAsWorked: boolean;
  isActive: boolean;
};

/** Bản nháp đang sửa. `id = null` ⇒ dòng thêm mới. `paidPct` là % (server nhận 0–1). */
type Draft = {
  id: string | null;
  code: string;
  name: string;
  paidPct: number;
  maxDaysPerYear: number | null;
  noticeDays: number | null;
  countsAsWorked: boolean;
  isActive: boolean;
};

const EMPTY: Draft = {
  id: null,
  code: "",
  name: "",
  paidPct: 100,
  maxDaysPerYear: null,
  noticeDays: null,
  countsAsWorked: false,
  isActive: true,
};

const CELL_FIELD = "h-8 w-full px-2 text-sm";

function draftOf(r: LeaveTypeRow): Draft {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    paidPct: Math.round(r.paidRatio * 100),
    maxDaysPerYear: r.maxDaysPerYear,
    noticeDays: r.noticeDays,
    countsAsWorked: r.countsAsWorked,
    isActive: r.isActive,
  };
}

/** Tỷ lệ lương + hệ quả trên lưới: 100% trọn lương, 0% thành mã X, giữa chừng thành P. */
function RatioPill({ pct }: { pct: number }) {
  const tone =
    pct >= 100
      ? "bg-state-success-soft text-state-success-ink"
      : pct <= 0
        ? "bg-muted text-muted-foreground"
        : "bg-state-warning-soft text-state-warning-ink";
  return (
    <span
      className={cn(PILL, tone, "tabular-nums")}
      title={pct <= 0 ? "Duyệt đơn ghi mã X lên lưới" : "Duyệt đơn ghi mã P lên lưới"}
    >
      {pct}% · {pct <= 0 ? "X" : "P"}
    </span>
  );
}

export function LeaveTypeList({ rows, canEdit }: { rows: LeaveTypeRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);

  function save() {
    if (!draft) return;
    start(async () => {
      const r = await saveLeaveTypeAction(draft.id, {
        code: draft.code,
        name: draft.name,
        paidRatio: draft.paidPct / 100,
        maxDaysPerYear: draft.maxDaysPerYear,
        noticeDays: draft.noticeDays,
        countsAsWorked: draft.countsAsWorked,
        isActive: draft.isActive,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(draft.id ? `Đã lưu ${draft.code}` : `Đã thêm ${draft.code}`);
      setDraft(null);
      router.refresh();
    });
  }

  const canSave = !!draft && !!draft.code.trim() && !!draft.name.trim();

  // Hàng đang sửa (hoặc hàng thêm mới) — cùng bố cục cột với hàng thường.
  // CỐ Ý là HÀM TRẢ JSX, không phải component con: khai component bên trong thân render thì mỗi
  // lần gõ một ký tự React coi là kiểu mới ⇒ tháo và dựng lại ô nhập ⇒ mất con trỏ sau mỗi chữ.
  function editRow(isNew: boolean, key: string) {
    if (!draft) return null;
    return (
      <tr key={key} className={cn(adminTr, "bg-primary-soft align-top")}>
        <td className={adminTd}>
          {isNew ? (
            <input
              autoFocus
              aria-label="Mã loại nghỉ"
              className={cn(FIELD, CELL_FIELD, "w-24 font-mono uppercase")}
              value={draft.code}
              maxLength={24}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
              onKeyDown={(e) => e.key === "Enter" && canSave && save()}
            />
          ) : (
            <span className="font-mono font-semibold" title="Mã đối chiếu Sheet/MISA — không sửa được">
              {draft.code}
            </span>
          )}
        </td>
        <td className={adminTd}>
          <input
            autoFocus={!isNew}
            aria-label="Tên loại nghỉ"
            className={cn(FIELD, CELL_FIELD)}
            value={draft.name}
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && canSave && save()}
          />
        </td>
        <td className={cn(adminTd, "text-right")}>
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            aria-label="Tỷ lệ lương (%)"
            className={cn(FIELD, CELL_FIELD, "w-20 text-right tabular-nums")}
            value={draft.paidPct}
            onChange={(e) => setDraft({ ...draft, paidPct: Number(e.target.value) })}
            onKeyDown={(e) => e.key === "Enter" && canSave && save()}
          />
        </td>
        <td className={cn(adminTd, "text-right")}>
          <input
            type="number"
            min={0}
            max={366}
            aria-label="Trần ngày mỗi năm"
            placeholder="∞"
            className={cn(FIELD, CELL_FIELD, "w-20 text-right tabular-nums")}
            value={draft.maxDaysPerYear ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, maxDaysPerYear: e.target.value === "" ? null : Number(e.target.value) })
            }
            onKeyDown={(e) => e.key === "Enter" && canSave && save()}
          />
        </td>
        <td className={cn(adminTd, "text-right")}>
          {/* Hạn báo trước THEO LOẠI. Để trống = không đòi — dành cho việc đột xuất (ma chay,
              ốm, thai sản). Nộp muộn hơn hạn KHÔNG bị chặn, nhưng phải chỉ định người làm thay. */}
          <input
            type="number"
            min={0}
            max={60}
            aria-label="Ngày phải báo trước"
            placeholder="—"
            className={cn(FIELD, CELL_FIELD, "w-20 text-right tabular-nums")}
            value={draft.noticeDays ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, noticeDays: e.target.value === "" ? null : Number(e.target.value) })
            }
            onKeyDown={(e) => e.key === "Enter" && canSave && save()}
          />
        </td>
        <td className={adminTd}>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={draft.countsAsWorked}
              onChange={(e) => setDraft({ ...draft, countsAsWorked: e.target.checked })}
            />
            Tính như đi làm
          </label>
        </td>
        <td className={adminTd}>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={draft.isActive}
              onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
            />
            Đang dùng
          </label>
        </td>
        <td className={cn(adminTd, "text-right")}>
          <span className="inline-flex items-center justify-end gap-2">
            <button
              type="button"
              className={cn(BTN_PRIMARY, "h-8 px-3 text-xs")}
              disabled={pending || !canSave}
              onClick={save}
            >
              Lưu
            </button>
            <button
              type="button"
              className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
              disabled={pending}
              onClick={() => setDraft(null)}
            >
              Huỷ
            </button>
          </span>
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          <b className="tabular-nums text-foreground">{rows.filter((r) => r.isActive).length}</b> loại đang
          dùng / {rows.length} loại
        </span>
        {canEdit && (
          <button
            type="button"
            className={cn(BTN_PRIMARY, "ml-auto")}
            disabled={!!draft}
            onClick={() => setDraft(EMPTY)}
          >
            <Plus className="h-4 w-4" aria-hidden /> Thêm loại nghỉ
          </button>
        )}
      </div>

      {rows.length === 0 && !draft ? (
        <EmptyState
          title="Chưa có loại nghỉ"
          description="Danh mục rỗng thì màn nộp đơn không có gì để chọn. Thêm loại đầu tiên (nghỉ phép năm, nghỉ ốm, nghỉ không lương…) rồi đặt tỷ lệ lương cho từng loại."
          action={
            canEdit ? (
              <button type="button" className={BTN_PRIMARY} onClick={() => setDraft(EMPTY)}>
                <Plus className="h-4 w-4" aria-hidden /> Thêm loại nghỉ
              </button>
            ) : undefined
          }
        />
      ) : (
        // Vỏ thẻ chuẩn của bảng danh sách trong module (giống `period-table` và
        // `request-queue-table`): `TableSkeleton` lúc chờ cũng vẽ đúng vỏ này.
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang tenDonVi="loại nghỉ" khoaGhiNho="cham-cong-loai-nghi" cuonNgang>
            <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th scope="col" className={adminTh}>Mã</th>
                <th scope="col" className={adminTh}>Tên</th>
                <th scope="col" className={cn(adminTh, "text-right")}>Tỷ lệ lương</th>
                <th scope="col" className={cn(adminTh, "text-right")}>Trần ngày/năm</th>
                <th scope="col" className={cn(adminTh, "text-right")} title="Để trống = không đòi báo trước (việc đột xuất)">
                  Báo trước
                </th>
                <th scope="col" className={adminTh}>Tính như đi làm</th>
                <th scope="col" className={adminTh}>Trạng thái</th>
                <th scope="col" className={cn(adminTh, "text-right")}>
                  {canEdit ? "Hành động" : <span className="sr-only">Hành động</span>}
                </th>
              </tr>
            </thead>
            <tbody>
              {draft?.id === null && editRow(true, "moi")}
              {rows.map((r) =>
                draft?.id === r.id ? (
                  editRow(false, r.id)
                ) : (
                  <tr key={r.id} className={cn(adminTr, !r.isActive && "opacity-60")}>
                    <td className={cn(adminTd, "font-mono font-semibold")}>{r.code}</td>
                    <td className={adminTd}>
                      <span className="block max-w-[20rem] truncate" title={r.name}>{r.name}</span>
                    </td>
                    <td className={cn(adminTd, "text-right")}>
                      <RatioPill pct={Math.round(r.paidRatio * 100)} />
                    </td>
                    <td className={cn(adminTd, "text-right tabular-nums")}>
                      {r.maxDaysPerYear ?? <span className="text-muted-foreground">Không giới hạn</span>}
                    </td>
                    <td className={cn(adminTd, "text-right tabular-nums")}>
                      {r.noticeDays == null ? (
                        <span
                          className="text-xs text-muted-foreground"
                          title="Việc đột xuất — không ai hẹn trước được, nên không đòi báo trước"
                        >
                          Không đòi
                        </span>
                      ) : (
                        <>
                          {r.noticeDays} <span className="text-xs text-muted-foreground">ngày</span>
                        </>
                      )}
                    </td>
                    <td className={adminTd}>
                      {r.countsAsWorked ? (
                        <span className={cn(PILL, "bg-state-info-soft text-state-info-ink")}>Có</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Không</span>
                      )}
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
                        {r.isActive ? "Đang dùng" : "Ngưng"}
                      </span>
                    </td>
                    <td className={cn(adminTd, "text-right")}>
                      {canEdit ? (
                        <button
                          type="button"
                          className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
                          disabled={!!draft}
                          onClick={() => setDraft(draftOf(r))}
                        >
                          Sửa
                        </button>
                      ) : (
                        <span className="sr-only">Chỉ xem</span>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}

      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          Bạn đang ở chế độ chỉ xem. Sửa danh mục dùng chung cần quyền{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            hr_attendance:config
          </code>{" "}
          tại Hội sở.
        </p>
      )}
    </div>
  );
}
