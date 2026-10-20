"use client";

// Bảng PHÂN LOẠI BUỔI — sửa tại chỗ, thêm dòng mới ở cuối.
//
// Không có nút Xoá: một phân loại đã bị buổi cũ trỏ tới mà xoá đi là mất dấu vì sao buổi đó từng
// có hệ số riêng. Tắt thì buổi cũ rơi về dòng mặc định và vẫn lần lại được.
//
// Cột "Buổi trách nhiệm" CHỈ ĐỌC (chốt chủ dự án 07/09 — phương án (b)): bộ đếm định mức 50/30/20
// chưa chạy, và thiết kế hiện tại của nó có lỗ quyền (phải đọc `contractType`, vốn chỉ SUPER_ADMIN
// và HR xem được). Ô nhập gỡ khỏi cả giao diện LẪN schema đầu vào của action; dữ liệu đã khai vẫn
// hiện nguyên để không mất thông tin người vận hành đã bỏ công nhập.
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, PILL } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import { saveSessionCategoryAction } from "../_actions";

export type CategoryRow = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  countsTowardQuota: boolean;
  isActive: boolean;
  /** Số buổi đang mang phân loại này — để người sửa thấy mình đang động vào bao nhiêu buổi. */
  buoi: number;
  /** Số dòng công dạy đang gắn phân loại này. */
  dongCongDay: number;
};

const CELL = "h-9 px-2 py-1 text-sm";

export function CategoryList({ rows, canEdit }: { rows: CategoryRow[]; canEdit: boolean }) {
  const [themMoi, setThemMoi] = useState(false);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <PhanTrangBang cuonNgang tenDonVi="phân loại" khoaGhiNho="phan-loai-buoi">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th scope="col" className={adminTh}>Phân loại buổi</th>
                <th scope="col" className={adminTh}>Mã</th>
                <th
                  scope="col"
                  title="Chưa có hiệu lực — bộ đếm định mức 50/30/20 chưa chạy. Ô nhập tạm ẩn, dữ liệu đã khai vẫn giữ."
                  className={adminTh}
                >
                  Buổi trách nhiệm
                </th>
                <th scope="col" className={adminTh}>Mặc định</th>
                <th scope="col" className={adminTh}>Đang dùng</th>
                <th scope="col" className={cn(adminTh, "text-right")}>Buổi đã gán</th>
                <th scope="col" className={cn(adminTh, "text-right")}>Dòng công dạy</th>
                {canEdit && <th scope="col" className={cn(adminTh, "text-right")}>Hành động</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Dong key={r.id} row={r} canEdit={canEdit} />
              ))}
              {themMoi && <DongMoi onXong={() => setThemMoi(false)} />}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>

      {canEdit && !themMoi && (
        <button type="button" onClick={() => setThemMoi(true)} className={cn(BTN_OUTLINE, "h-9 px-3 text-xs")}>
          <Plus aria-hidden className="h-4 w-4" /> Thêm phân loại
        </button>
      )}
    </div>
  );
}

function Dong({ row, canEdit }: { row: CategoryRow; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [d, setD] = useState(row);

  const doi = d.name !== row.name || d.isDefault !== row.isDefault || d.isActive !== row.isActive;

  const luu = () =>
    start(async () => {
      const r = await saveSessionCategoryAction(row.id, {
        code: row.code,
        name: d.name,
        isDefault: d.isDefault,
        isActive: d.isActive,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Đã lưu ${d.name}`);
      router.refresh();
    });

  return (
    <tr className={cn(adminTr, "h-11")}>
      <td className={cn(adminTd, "py-0 font-medium")}>
        {canEdit ? (
          <input
            type="text"
            aria-label={`Tên của ${row.code}`}
            className={cn(FIELD, CELL, "w-56")}
            value={d.name}
            onChange={(e) => setD({ ...d, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && doi && luu()}
          />
        ) : (
          row.name
        )}
      </td>
      <td className={cn(adminTd, "py-0 font-mono text-[11px] text-muted-foreground")}>{row.code}</td>
      <td className={cn(adminTd, "py-0")}>
        {/* CHỈ ĐỌC — xem chú thích đầu file. Không dùng <O> vì `canEdit` ở đây luôn là false. */}
        {row.countsTowardQuota ? (
          <span className={cn(PILL, "bg-muted text-muted-foreground")}>Buổi trách nhiệm</span>
        ) : (
          <span className="text-xs text-muted-foreground">–</span>
        )}
      </td>
      <td className={cn(adminTd, "py-0")}>
        {row.isDefault ? (
          <span className={cn(PILL, "bg-primary-soft text-primary-ink")}>Mặc định</span>
        ) : canEdit ? (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={d.isDefault}
              onChange={(e) => setD({ ...d, isDefault: e.target.checked, isActive: e.target.checked ? true : d.isActive })}
            />
            Đặt
          </label>
        ) : (
          <span className="text-xs text-muted-foreground">–</span>
        )}
      </td>
      <td className={cn(adminTd, "py-0")}>
        <O
          canEdit={canEdit && !row.isDefault}
          checked={d.isActive}
          onChange={(v) => setD({ ...d, isActive: v })}
          nhan="Dùng"
          batNhan="Đang dùng"
        />
      </td>
      <td className={cn(adminTd, "py-0 text-right tabular-nums")}>
        {row.buoi || <span className="text-muted-foreground">–</span>}
      </td>
      <td className={cn(adminTd, "py-0 text-right tabular-nums")}>
        {row.dongCongDay || <span className="text-muted-foreground">–</span>}
      </td>
      {canEdit && (
        <td className={cn(adminTd, "py-0 text-right")}>
          <button
            type="button"
            disabled={!doi || pending}
            onClick={luu}
            className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
          >
            {pending ? "Đang lưu…" : "Lưu"}
          </button>
        </td>
      )}
    </tr>
  );
}

function DongMoi({ onXong }: { onXong: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  const luu = () =>
    start(async () => {
      const r = await saveSessionCategoryAction(null, { code, name, isDefault: false, isActive: true });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Đã thêm ${name}`);
      onXong();
      router.refresh();
    });

  return (
    <tr className={cn(adminTr, "h-11 bg-primary-soft/30")}>
      <td className={cn(adminTd, "py-0")}>
        <input
          type="text"
          autoFocus
          aria-label="Tên phân loại mới"
          placeholder="Ví dụ: Lớp hè tăng cường"
          className={cn(FIELD, CELL, "w-56")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </td>
      <td className={cn(adminTd, "py-0")}>
        <input
          type="text"
          aria-label="Mã phân loại mới"
          placeholder="LOP_HE"
          className={cn(FIELD, CELL, "w-32 font-mono text-xs uppercase")}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </td>
      <td className={cn(adminTd, "py-0 text-xs text-muted-foreground")} colSpan={5}>
        Dòng mới luôn bật, chưa phải mặc định.
      </td>
      <td className={cn(adminTd, "py-0 text-right")}>
        <div className="flex justify-end gap-1">
          <button
            type="button"
            disabled={pending || !code.trim() || !name.trim()}
            onClick={luu}
            className={cn(BTN_PRIMARY, "h-8 px-3 text-xs")}
          >
            {pending ? "Đang lưu…" : "Thêm"}
          </button>
          <button type="button" onClick={onXong} disabled={pending} className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}>
            Huỷ
          </button>
        </div>
      </td>
    </tr>
  );
}

function O({
  canEdit,
  checked,
  onChange,
  nhan,
  batNhan,
}: {
  canEdit: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
  nhan: string;
  batNhan: string;
}) {
  if (canEdit) {
    return (
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {nhan}
      </label>
    );
  }
  return checked ? (
    <span className="text-xs text-foreground">{batNhan}</span>
  ) : (
    <span className="text-xs text-muted-foreground">–</span>
  );
}
