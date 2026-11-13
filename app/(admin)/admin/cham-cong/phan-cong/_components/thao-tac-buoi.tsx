"use client";

// Khối dùng CHUNG của "Bảng theo buổi" (`?xem=buoi`) và panel màn Phân công gộp (GĐ7): chip bằng chứng chấm công, "Sửa buổi đã qua",
// nhật ký sửa, lịch sử phân công. MỘT bản — hai màn import, không chép (luật 12b: cùng ô, cùng chữ).
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { ClipboardCheck, History } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BuoiTrongTuan, DongPhanCong } from "@/lib/parttime/bang-phan-cong";
import type { NhanBangChung } from "@/lib/parttime/nhan-bang-chung";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, PILL } from "@/components/admin/cham-cong/classes";
import { LY_DO_TOI_THIEU, NHAN_TRUONG } from "@/lib/parttime/sua-buoi-da-qua";
import type { DongNhatKySua } from "@/lib/parttime/sua-buoi-da-qua-db";
import { suaBuoiDaQuaAction } from "../_actions";
import { TONE_CLS, type Tone } from "./loc";

/** `nhom` = nhãn cơ sở của người (vẽ `<optgroup>`) — danh sách đã xếp cơ sở đang xem trước (`nhomTheoCoSo`). */
export type GiaoVien = { id: string; ten: string; nhom: string };
/** Phần của buổi mà "Sửa buổi đã qua" cần — bảng cũ truyền cả `BuoiTrongTuan`, panel gộp truyền chi tiết buổi. */
export type BuoiDeSua = Pick<BuoiTrongTuan, "sourceType" | "sourceId" | "tinhTrang" | "nguoiDungLop"> & {
  main: Pick<DongPhanCong, "userId" | "ten"> | null;
  ta: Pick<DongPhanCong, "userId" | "ten"> | null;
};

export function Pill({
  tone,
  children,
  title,
}: {
  tone: Tone;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span title={title} className={cn(PILL, TONE_CLS[tone])}>
      {children}
    </span>
  );
}

/** Bằng chứng chấm công P4 — CHỈ để xem, chưa tính công. Chữ + biểu tượng + câu đầy đủ (không chỉ màu). */
export function ChipChamCong({ n }: { n: NhanBangChung | undefined }) {
  if (!n) return null;
  return (
    <span title={n.chiTiet} className={cn(PILL, TONE_CLS[n.tone], "gap-1")}>
      <ClipboardCheck className="h-3 w-3" aria-hidden />
      <span className="sr-only">Chấm công: </span>
      {n.nhan}
      <span className="sr-only">. {n.chiTiet}</span>
    </span>
  );
}

const NHAN_KET_THUC: Partial<
  Record<DongPhanCong["status"], { nhan: string; tone: Tone }>
> = {
  DECLINED: { nhan: "Từ chối", tone: "danger" },
  CANCELLED: { nhan: "Đã huỷ", tone: "muted" },
  REPLACED: { nhan: "Bị thay", tone: "muted" },
};

/**
 * Sửa buổi đã qua: GV đứng chính · trợ giảng · người thực dạy (buổi lớp đã chốt). Chỉ gửi ô ĐÃ ĐỔI so với hiện tại; chọn "— Không ai —"
 * là gỡ. Lý do bắt buộc — đi nguyên văn vào nhật ký và thông báo cho giáo viên cũ + mới.
 */
export function SuaBuoiDaQua({ b, giaoVien }: { b: BuoiDeSua; giaoVien: GiaoVien[] }) {
  const coThucDay = b.sourceType === "CLASS_SESSION" && b.tinhTrang === "DA_CHOT";
  const goc = { main: b.main?.userId ?? "", ta: b.ta?.userId ?? "", thucDay: b.nguoiDungLop ?? "" };
  const [chon, setChon] = useState(goc);
  const [lyDo, setLyDo] = useState("");
  const [dang, batDau] = useTransition();
  const idLyDo = useId();
  const idMain = useId();
  const idTa = useId();
  const idThuc = useId();
  const ten = new Map<string, string>(giaoVien.map((g) => [g.id, g.ten]));
  if (b.main) ten.set(b.main.userId, b.main.ten);
  if (b.ta) ten.set(b.ta.userId, b.ta.ten);
  const doi = (k: keyof typeof goc) => chon[k] !== goc[k];
  const coDoi = doi("main") || doi("ta") || (coThucDay && doi("thucDay"));
  const lyDoDu = lyDo.trim().length >= LY_DO_TOI_THIEU;

  const oChon = (k: keyof typeof goc, id: string, nhan: string, trong: string) => (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {nhan}
        {doi(k) && <span className="ml-1 font-medium text-state-warning-ink">· đã đổi</span>}
      </label>
      <select
        id={id}
        value={chon[k]}
        onChange={(e) => setChon({ ...chon, [k]: e.target.value })}
        className={cn(FIELD, "w-full min-w-0 pointer-coarse:h-11")}
      >
        <option value="">{trong}</option>
        {goc[k] && !giaoVien.some((g) => g.id === goc[k]) && <option value={goc[k]}>{ten.get(goc[k]) ?? "Người hiện tại"} (hiện tại)</option>}
        {[...new Set(giaoVien.map((g) => g.nhom))].map((nhom) => (
          <optgroup key={nhom} label={nhom}>
            {giaoVien
              .filter((g) => g.nhom === nhom)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.ten}
                  {g.id === goc[k] ? " (hiện tại)" : ""}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );

  const luu = () =>
    batDau(async () => {
      const r = await suaBuoiDaQuaAction({
        sourceType: b.sourceType,
        sourceId: b.sourceId,
        lyDo,
        ...(doi("main") ? { main: chon.main || null } : {}),
        ...(doi("ta") ? { ta: chon.ta || null } : {}),
        ...(coThucDay && doi("thucDay") ? { thucDay: chon.thucDay || null } : {}),
      });
      if (r.ok) {
        toast.success(r.message ?? "Đã sửa buổi");
        setLyDo("");
      } else toast.error(r.error);
    });

  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-3">
      <h3 className="text-sm font-semibold text-foreground">Sửa buổi đã qua</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Mỗi thay đổi được ghi nhật ký và báo cho giáo viên cũ + mới kèm lý do để đối soát.
        {coThucDay && " Người thực dạy quyết định ai được tính công dạy buổi này."}
      </p>
      <div className={cn("mt-3 grid gap-3", coThucDay ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {oChon("main", idMain, NHAN_TRUONG.MAIN_TEACHER, "— Không ai —")}
        {oChon("ta", idTa, NHAN_TRUONG.TEACHING_ASSISTANT, "— Không có trợ giảng —")}
        {coThucDay && oChon("thucDay", idThuc, NHAN_TRUONG.THUC_DAY, "— Theo GV lớp / dạy thay —")}
      </div>
      <div className="mt-3 flex min-w-0 flex-col gap-1">
        <label htmlFor={idLyDo} className="text-xs text-muted-foreground">
          Lý do (bắt buộc — gửi kèm cho giáo viên liên quan)
        </label>
        <textarea
          id={idLyDo}
          value={lyDo}
          onChange={(e) => setLyDo(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder={`Tối thiểu ${LY_DO_TOI_THIEU} ký tự, ví dụ: cô A dạy thay vì thầy B ốm, đã đối chiếu điểm danh`}
          aria-invalid={lyDo.length > 0 && !lyDoDu}
          className={cn(FIELD, "h-auto w-full py-2")}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!coDoi || !lyDoDu || dang} onClick={luu} className={cn(BTN_PRIMARY, "pointer-coarse:h-11")}>
          {dang ? "Đang lưu…" : "Lưu điều chỉnh"}
        </button>
        {coDoi && (
          <button type="button" disabled={dang} onClick={() => setChon(goc)} className={cn(BTN_OUTLINE, "pointer-coarse:h-11")}>
            Bỏ thay đổi
          </button>
        )}
        {!coDoi && <span className="text-xs text-muted-foreground">Chọn người khác ở ô cần sửa.</span>}
      </div>
    </div>
  );
}

export function NhatKySua({ ds }: { ds: DongNhatKySua[] }) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <History className="h-3.5 w-3.5" aria-hidden />
        Nhật ký sửa buổi
      </h3>
      <ul className="space-y-1.5 text-sm">
        {ds.map((x) => (
          <li key={x.id} className="min-w-0">
            <span className="tabular-nums text-xs text-muted-foreground">
              {new Date(x.luc).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>{" "}
            <span className="text-foreground">{x.nguoiSua}</span>
            <span className="text-muted-foreground"> · {NHAN_TRUONG[x.truong]}: </span>
            <span className="text-foreground">{x.tu ?? "(trống)"} → {x.den ?? "(trống)"}</span>
            {x.lyDo && <span className="block text-xs text-muted-foreground">“{x.lyDo}”</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LichSu({ ds }: { ds: DongPhanCong[] }) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <History className="h-3.5 w-3.5" aria-hidden />
        Đã kết thúc
      </h3>
      <ul className="space-y-1 text-sm">
        {ds.map((x) => {
          const t = NHAN_KET_THUC[x.status] ?? {
            nhan: x.status,
            tone: "muted" as Tone,
          };
          return (
            <li
              key={x.id}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
            >
              <span className="text-foreground">{x.ten}</span>
              <span className="text-xs text-muted-foreground">
                {x.role === "MAIN_TEACHER" ? "đứng chính" : "trợ giảng"}
              </span>
              <Pill tone={t.tone}>{t.nhan}</Pill>
              {x.status === "DECLINED" && x.lyDoTuChoi && (
                <span className="min-w-0 text-xs text-muted-foreground">
                  “{x.lyDoTuChoi}”
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
