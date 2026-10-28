"use client";
// PR6 lưới phân công GV (chủ dự án 24/10/2026): giáo viên được chọn đang có ca TRỰC chứa buổi bù ⇒ hỏi "còn trực phần còn lại không".
// Dùng chung ở Tạo case · Sửa case · Duyệt case. Chỉ cho chọn khi máy chủ báo người đang thao tác quyết được (`coTheQuyet` — luật 12);
// không thì chỉ báo để biết, quyết định nằm ở lưới Phân công giáo viên. "Để quyết sau" là mặc định — không tự huỷ, không tự giữ trực.
import { cn } from "@/lib/utils";

export type QuyetTrucChon = { giu: boolean; lyDo: string | null } | null;
export type TrucTrung = { shiftCode: string; tu: string; den: string };

const TEN_CA: Record<string, string> = { S: "sáng", C: "chiều", T: "tối" };

/** Giá trị gửi lên máy chủ: "Không" mà chưa có lý do ⇒ coi như chưa quyết (máy chủ cũng đòi lý do). */
export function quyetTrucGui(v: QuyetTrucChon): QuyetTrucChon {
  if (!v) return null;
  if (!v.giu && (v.lyDo?.trim().length ?? 0) < 5) return null;
  return v;
}

export function HoiTruc({
  truc,
  coTheQuyet,
  value,
  onChange,
  idPrefix,
}: {
  truc: TrucTrung | null;
  coTheQuyet: boolean;
  value: QuyetTrucChon;
  onChange: (v: QuyetTrucChon) => void;
  idPrefix: string;
}) {
  if (!truc) return null;
  const ca = `ca ${TEN_CA[truc.shiftCode] ?? truc.shiftCode} ${truc.tu}–${truc.den}`;
  if (!coTheQuyet) {
    return (
      <p className="rounded-md bg-state-info-soft px-3 py-2 text-xs text-state-info-ink">
        Giáo viên này đang có <b>trực {ca}</b>. Quản lý cơ sở sẽ quyết GV còn trực phần còn lại hay không trên lưới Phân công giáo viên.
      </p>
    );
  }
  const chon = value == null ? "sau" : value.giu ? "giu" : "bo";
  const opt = (k: "giu" | "bo" | "sau", nhan: string, mo: string) => (
    <label
      htmlFor={`${idPrefix}-${k}`}
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
        chon === k ? "border-primary bg-primary-soft" : "border-border hover:bg-muted",
      )}
    >
      <input
        id={`${idPrefix}-${k}`}
        type="radio"
        name={`${idPrefix}-quyet-truc`}
        className="mt-1"
        checked={chon === k}
        onChange={() => onChange(k === "sau" ? null : k === "giu" ? { giu: true, lyDo: null } : { giu: false, lyDo: value && !value.giu ? value.lyDo : "" })}
      />
      <span>
        <span className="font-medium text-foreground">{nhan}</span>
        <span className="block text-xs text-muted-foreground">{mo}</span>
      </span>
    </label>
  );
  return (
    <fieldset className="space-y-2 rounded-lg border border-state-warning-ink/30 bg-state-warning-soft/60 p-3">
      <legend className="px-1 text-sm font-semibold text-state-warning-ink">Giáo viên đang trực {ca}</legend>
      <p className="text-sm text-foreground">Sau khi nhận buổi bù, giáo viên có tiếp tục đảm nhiệm nhiệm vụ trực trong phần còn lại của ca không?</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {opt("giu", "Có, giữ trực", "Ô lưới thành TD — tiết dạy + nửa ca trực.")}
        {opt("bo", "Không, chỉ dạy bù", "Dòng trực ca này bị huỷ — ô thành D.")}
        {opt("sau", "Để quyết sau", "Lưới chưa tính tiền trực, nhắc quyết trên lưới.")}
      </div>
      {value && !value.giu && (
        <label htmlFor={`${idPrefix}-ly-do`} className="block text-xs font-medium text-foreground">
          Lý do kết thúc trực (bắt buộc, tối thiểu 5 ký tự)
          <textarea
            id={`${idPrefix}-ly-do`}
            rows={2}
            maxLength={500}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={value.lyDo ?? ""}
            onChange={(e) => onChange({ giu: false, lyDo: e.target.value })}
          />
        </label>
      )}
    </fieldset>
  );
}
