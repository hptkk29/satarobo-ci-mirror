"use client";

// Bảng danh mục LOẠI CÔNG DẠY — sửa hệ số, bật/tắt, và THÊM dòng theo phân loại buổi.
//
// Vì sao đặt trên CHÍNH màn báo cáo chứ không tách sang tab Cấu hình: câu hỏi người dùng thật sự
// hỏi là "vì sao tháng này công dạy ra con số đó" — trả lời bằng cách bày hệ số ngay cạnh con số.
// Tách sang tab khác là bắt người ta nhớ hai chỗ để hiểu một số.
//
// HAI HẠNG DÒNG (xem `../_actions.ts`):
//  · BAO SÂN — cột Phân loại trống, nghĩa là "mọi phân loại chưa có dòng riêng". Không tắt, không
//    xoá được: nó là lưới đỡ cuối cùng của mọi buổi.
//  · RIÊNG — gắn một phân loại. Người vận hành tự thêm, tự xoá.
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { BTN_DANGER, BTN_OUTLINE, BTN_PRIMARY, FIELD, PILL } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import {
  createTeachingCreditTypeAction,
  deleteTeachingCreditTypeAction,
  saveTeachingCreditTypeAction,
} from "../_actions";

export type LoaiRow = {
  code: string;
  name: string;
  source: "CLASS" | "TRIAL" | "MAKEUP";
  role: "MAIN" | "SUBSTITUTE" | "ASSISTANT";
  basis: "PER_SESSION" | "PER_HOUR";
  factor: number;
  countsInPeriod: boolean;
  isActive: boolean;
  /** null = dòng BAO SÂN, áp cho mọi phân loại chưa có dòng riêng. */
  categoryCode: string | null;
  categoryName: string | null;
  /** Số buổi thuộc loại này trong kỳ đang xem — để người sửa thấy ngay mình đang động vào gì. */
  buoiTrongKy: number;
};

export type PhanLoaiChon = { code: string; name: string };

const CELL = "h-9 px-2 py-1 text-sm";
const NHAN_VAI: Record<LoaiRow["role"], string> = {
  MAIN: "Người dạy",
  SUBSTITUTE: "Dạy thay",
  ASSISTANT: "Trợ giảng",
};

export function LoaiCongDayTable({
  rows,
  phanLoai,
  canEdit,
}: {
  rows: LoaiRow[];
  phanLoai: PhanLoaiChon[];
  canEdit: boolean;
}) {
  const [themMoi, setThemMoi] = useState(false);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <PhanTrangBang cuonNgang tenDonVi="loại" khoaGhiNho="loai-cong-day">
          <table className="w-full min-w-[1020px] text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th scope="col" className={adminTh}>Loại công dạy</th>
                <th scope="col" className={adminTh}>Phân loại buổi</th>
                <th scope="col" className={adminTh}>Cách tính</th>
                <th scope="col" className={cn(adminTh, "text-right")}>Hệ số</th>
                <th scope="col" className={adminTh}>Cộng vào kỳ</th>
                <th scope="col" className={adminTh}>Đang dùng</th>
                <th scope="col" className={cn(adminTh, "text-right")}>Buổi trong kỳ</th>
                {canEdit && <th scope="col" className={cn(adminTh, "text-right")}>Hành động</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Dong key={r.code} row={r} canEdit={canEdit} />
              ))}
              {themMoi && <DongMoi phanLoai={phanLoai} onXong={() => setThemMoi(false)} />}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>

      {canEdit &&
        !themMoi &&
        (phanLoai.length > 0 ? (
          <button type="button" onClick={() => setThemMoi(true)} className={cn(BTN_OUTLINE, "h-9 px-3 text-xs")}>
            <Plus aria-hidden className="h-4 w-4" /> Thêm dòng theo phân loại buổi
          </button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Chưa có phân loại buổi nào đang dùng — khai ở tab <b>Cấu hình → Phân loại buổi</b> trước,
            rồi mới thêm được dòng hệ số riêng.
          </p>
        ))}
    </div>
  );
}

function Dong({ row, canEdit }: { row: LoaiRow; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(row);
  const [xacNhanXoa, setXacNhanXoa] = useState(false);
  const baoSan = row.categoryCode == null;

  const doi =
    draft.basis !== row.basis ||
    draft.factor !== row.factor ||
    draft.countsInPeriod !== row.countsInPeriod ||
    draft.isActive !== row.isActive;

  const luu = () =>
    start(async () => {
      const r = await saveTeachingCreditTypeAction({
        code: row.code,
        basis: draft.basis,
        factor: draft.factor,
        countsInPeriod: draft.countsInPeriod,
        isActive: draft.isActive,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Đã lưu ${row.name} — số công dạy tính lại theo hệ số mới`);
      router.refresh();
    });

  const xoa = () =>
    start(async () => {
      const r = await deleteTeachingCreditTypeAction({ code: row.code });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Đã xoá ${row.name} — buổi thuộc phân loại này trở lại dòng bao sân`);
      router.refresh();
    });

  return (
    <tr className={cn(adminTr, "h-11")}>
      <td className={cn(adminTd, "py-0 font-medium")}>
        {row.name}
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">{row.code}</span>
      </td>
      <td className={cn(adminTd, "py-0")}>
        {baoSan ? (
          <span className="text-xs text-muted-foreground">Mọi phân loại</span>
        ) : (
          <span className={cn(PILL, "bg-primary-soft text-primary-ink")}>{row.categoryName}</span>
        )}
      </td>
      <td className={cn(adminTd, "py-0")}>
        {canEdit ? (
          <select
            aria-label={`Cách tính của ${row.name}`}
            className={cn(FIELD, CELL, "w-32")}
            value={draft.basis}
            onChange={(e) => setDraft({ ...draft, basis: e.target.value as LoaiRow["basis"] })}
          >
            <option value="PER_SESSION">Theo buổi</option>
            <option value="PER_HOUR">Theo giờ</option>
          </select>
        ) : (
          <span className="text-muted-foreground">
            {row.basis === "PER_HOUR" ? "Theo giờ" : "Theo buổi"}
          </span>
        )}
      </td>
      <td className={cn(adminTd, "py-0 text-right")}>
        {canEdit ? (
          <input
            type="number"
            step="0.1"
            min={0}
            max={10}
            aria-label={`Hệ số của ${row.name}`}
            className={cn(FIELD, CELL, "w-20 text-right tabular-nums")}
            value={draft.factor}
            onChange={(e) => setDraft({ ...draft, factor: Number(e.target.value) })}
            onKeyDown={(e) => e.key === "Enter" && doi && luu()}
          />
        ) : (
          <span className="tabular-nums">{row.factor}</span>
        )}
      </td>
      <td className={cn(adminTd, "py-0")}>
        {canEdit ? (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={draft.countsInPeriod}
              onChange={(e) => setDraft({ ...draft, countsInPeriod: e.target.checked })}
            />
            Cộng
          </label>
        ) : draft.countsInPeriod ? (
          <span className={cn(PILL, "bg-state-success-soft text-state-success-ink")}>Có</span>
        ) : (
          <span className="text-xs text-muted-foreground">Chỉ theo dõi</span>
        )}
      </td>
      <td className={cn(adminTd, "py-0")}>
        {/* Dòng bao sân không tắt được — nó là lưới đỡ của mọi buổi. Khoá ô ngay tại đây thay vì
            để người ta bấm rồi ăn lỗi từ máy chủ. */}
        {canEdit && !baoSan ? (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={draft.isActive}
              onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
            />
            Dùng
          </label>
        ) : draft.isActive ? (
          <span className="text-xs text-foreground">Đang dùng</span>
        ) : (
          <span className="text-xs text-muted-foreground">Đã tắt</span>
        )}
      </td>
      <td className={cn(adminTd, "py-0 text-right tabular-nums")}>
        {row.buoiTrongKy || <span className="text-muted-foreground">–</span>}
      </td>
      {canEdit && (
        <td className={cn(adminTd, "py-0 text-right")}>
          {xacNhanXoa ? (
            <div className="flex justify-end gap-1">
              <button
                type="button"
                disabled={pending}
                onClick={xoa}
                className={cn(BTN_DANGER, "h-8 px-3 text-xs")}
              >
                Xoá thật
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setXacNhanXoa(false)}
                className={cn(BTN_OUTLINE, "h-8 px-2 text-xs")}
              >
                Thôi
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-1">
              <button
                type="button"
                disabled={!doi || pending}
                onClick={luu}
                className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
              >
                {pending ? "Đang lưu…" : "Lưu"}
              </button>
              {!baoSan && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setXacNhanXoa(true)}
                  className={cn(BTN_OUTLINE, "h-8 px-2 text-xs text-state-danger-ink")}
                >
                  Xoá
                </button>
              )}
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

function DongMoi({ phanLoai, onXong }: { phanLoai: PhanLoaiChon[]; onXong: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [role, setRole] = useState<LoaiRow["role"]>("MAIN");
  // Nguồn có phân loại: lớp chính + case dạy bù (29/09/2026). Trải nghiệm không mang phân loại.
  const [source, setSource] = useState<"CLASS" | "MAKEUP">("CLASS");
  const [categoryCode, setCategoryCode] = useState(phanLoai[0]?.code ?? "");
  const [factor, setFactor] = useState(1);
  const [countsInPeriod, setCountsInPeriod] = useState(true);

  const luu = () =>
    start(async () => {
      const r = await createTeachingCreditTypeAction({
        // Chỉ nguồn CÓ phân loại (lớp chính, học bù): buổi trải nghiệm không mang phân loại nên
        // dòng riêng cho nó sẽ không bao giờ khớp buổi nào. Máy chủ cũng chặn.
        source,
        role,
        categoryCode,
        basis: "PER_SESSION",
        factor,
        countsInPeriod,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Đã thêm dòng — buổi thuộc phân loại này tính theo hệ số mới");
      onXong();
      router.refresh();
    });

  return (
    <tr className={cn(adminTr, "h-11 bg-primary-soft/30")}>
      <td className={cn(adminTd, "flex items-center gap-1.5 py-1")}>
        <select
          aria-label="Nguồn buổi dạy"
          className={cn(FIELD, CELL, "w-28")}
          value={source}
          onChange={(e) => setSource(e.target.value as "CLASS" | "MAKEUP")}
        >
          <option value="CLASS">Lớp chính</option>
          <option value="MAKEUP">Học bù</option>
        </select>
        <select
          aria-label="Vai của người trong buổi"
          className={cn(FIELD, CELL, "w-36")}
          value={role}
          onChange={(e) => setRole(e.target.value as LoaiRow["role"])}
        >
          {(Object.keys(NHAN_VAI) as LoaiRow["role"][]).map((k) => (
            <option key={k} value={k}>
              {NHAN_VAI[k]}
            </option>
          ))}
        </select>
      </td>
      <td className={cn(adminTd, "py-0")}>
        <select
          aria-label="Phân loại buổi"
          className={cn(FIELD, CELL, "w-44")}
          value={categoryCode}
          onChange={(e) => setCategoryCode(e.target.value)}
        >
          {phanLoai.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td className={cn(adminTd, "py-0 text-xs text-muted-foreground")}>Theo buổi</td>
      <td className={cn(adminTd, "py-0 text-right")}>
        <input
          type="number"
          step="0.1"
          min={0}
          max={10}
          aria-label="Hệ số dòng mới"
          className={cn(FIELD, CELL, "w-20 text-right tabular-nums")}
          value={factor}
          onChange={(e) => setFactor(Number(e.target.value))}
        />
      </td>
      <td className={cn(adminTd, "py-0")}>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={countsInPeriod}
            onChange={(e) => setCountsInPeriod(e.target.checked)}
          />
          Cộng
        </label>
      </td>
      <td className={cn(adminTd, "py-0 text-xs text-muted-foreground")} colSpan={2}>
        Dòng mới luôn bật.
      </td>
      <td className={cn(adminTd, "py-0 text-right")}>
        <div className="flex justify-end gap-1">
          <button
            type="button"
            disabled={pending || !categoryCode}
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
