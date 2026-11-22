"use client";
// Dialog DÙNG CHUNG cho mọi thao tác Rank lương / chứng nhận Trial / chính sách hỗ trợ Trial (24/10/2026): danh sách Rank
// (`/teachers/rank`), khối "Rank lương" trong hồ sơ GV (`/teachers/[id]`) và danh mục "Đơn giá Parttime" cùng mở MỘT bản — không
// chép form. Nút mở dialog chỉ vẽ khi người xem CÓ quyền (nơi gọi quyết — luật 12); action kiểm lại ở server.
// Mọi thay đổi có hiệu lực từ ngày chọn (≥ hôm nay) — không hồi tố. Đổi Rank (chốt 25/10/2026): chỉ Giám đốc · QTTC · Đào tạo, ÁP NGAY.
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import { capChungNhanAction, datChinhSachTrialAction, doiRankAction, thuHoiChungNhanAction } from "../_actions";

export const dmy = (ymd: string | null) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : "—");

/** Đủ thông tin một GV để mở dialog — `DongRankGv` (danh sách) và `RankCuaGv` (hồ sơ) đều khớp. */
export type GvRank = {
  userId: string;
  ten: string;
  rank: number;
  coSoIds: string[];
  /** Chứng nhận MỚI NHẤT (đối tượng thu hồi). */
  chungNhan: { id: string } | null;
};

export type QuyenRank = {
  /** `parttime_rank:approve` — Giám đốc · QTTC · Đào tạo đổi Rank, áp ngay. */
  doi: boolean;
  chungNhan: boolean;
  chinhSach: boolean;
  /** Cơ sở (id, nhãn) trong phạm vi — cho form chính sách. */
  coSo: { id: string; nhan: string }[];
};

export type MoRank =
  | { loai: "doi"; gv: GvRank; bangGia: Record<string, number> | null }
  | { loai: "cap"; gv: GvRank }
  | { loai: "thu-hoi"; gv: GvRank }
  | { loai: "chinh-sach" }
  | null;

/** Khoá để mỗi lần mở là form MỚI — không mang ô đã gõ của giáo viên trước sang giáo viên sau. */
export const khoaMo = (mo: MoRank) => (mo ? `${mo.loai}:${"gv" in mo ? mo.gv.userId : "cs"}` : "dong");

export function RankDialog({ mo, dong, homNay, quyen }: { mo: MoRank; dong: () => void; homNay: string; quyen: Pick<QuyenRank, "coSo"> }) {
  const [dang, start] = useTransition();
  // Đổi Rank: ngày hiệu lực mặc định HÔM NAY (đổi là áp ngay) — muốn lên lịch thì chọn ngày sau.
  const [f, setF] = useState<Record<string, string>>((): Record<string, string> => (mo?.loai === "doi" ? { ngay: homNay } : {}));
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const gui = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message);
        setF({});
        dong();
      } else toast.error(r.error);
    });
  if (!mo) return null;
  const tieuDe =
    mo.loai === "doi"
      ? `Đổi Rank — ${mo.gv.ten}`
      : mo.loai === "cap"
          ? `Cấp chứng nhận Trial — ${mo.gv.ten}`
          : mo.loai === "thu-hoi"
            ? `Thu hồi chứng nhận Trial — ${mo.gv.ten}`
            : "Đặt chính sách hỗ trợ Trial";
  const NHAN = "mb-1 block text-sm font-semibold text-foreground";
  return (
    <Dialog open onOpenChange={(v) => !v && dong()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tieuDe}</DialogTitle>
          <DialogDescription>Có hiệu lực từ ngày chọn (không trước hôm nay {dmy(homNay)}) — không sửa ngày đã qua. Mọi thao tác ghi nhật ký.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {mo.loai === "doi" && (
            <>
              <fieldset>
                <legend className={NHAN}>
                  Rank mới <span className="font-normal text-muted-foreground">· đang áp R{mo.gv.rank}</span>
                </legend>
                <div role="radiogroup" aria-label="Rank mới" className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((r) => {
                    const chon = f.rank === String(r);
                    const hienTai = r === mo.gv.rank;
                    const gia = mo.bangGia?.[String(r)];
                    return (
                      <button
                        key={r}
                        type="button"
                        role="radio"
                        aria-checked={chon}
                        disabled={hienTai}
                        onClick={() => setF((x) => ({ ...x, rank: String(r) }))}
                        className={cn(
                          "flex min-h-14 min-w-0 flex-col items-center justify-center rounded-lg border px-1 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          chon
                            ? "border-primary bg-primary text-primary-foreground"
                            : hienTai
                              ? "cursor-not-allowed border-dashed border-border text-muted-foreground"
                              : "border-border bg-card text-foreground hover:border-primary/60 hover:bg-muted",
                        )}
                      >
                        <span className="text-base font-bold leading-none tabular-nums">R{r}</span>
                        <span className={cn("mt-1 truncate text-xs tabular-nums", chon ? "opacity-90" : "text-muted-foreground")}>
                          {hienTai ? "đang áp" : gia != null ? `${Math.round(gia / 1000)}k/tiết` : "—"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <label className="block">
                <span className={NHAN}>Hiệu lực từ</span>
                <input type="date" min={homNay} className={cn(FIELD, "w-full")} value={f.ngay ?? ""} onChange={set("ngay")} />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Mặc định hôm nay — áp ngay khi lưu. Chọn ngày sau để lên lịch; tiết trước ngày này giữ Rank cũ.
                </span>
              </label>
              <label className="block">
                <span className={NHAN}>Căn cứ (thâm niên · tỷ lệ tái tục · năng lực)</span>
                <textarea
                  rows={3}
                  maxLength={2000}
                  className={cn(FIELD, "h-auto w-full py-2")}
                  value={f.canCu ?? ""}
                  onChange={set("canCu")}
                  placeholder="vd: 26 tháng · tái tục 96% · đạt năng lực"
                />
              </label>
            </>
          )}
          {mo.loai === "cap" && (
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className={NHAN}>Số / mã chứng nhận</span>
                <input className={cn(FIELD, "w-full")} maxLength={100} value={f.ma ?? ""} onChange={set("ma")} />
              </label>
              <label>
                <span className={NHAN}>Hiệu lực từ</span>
                <input type="date" min={homNay} className={cn(FIELD, "w-full")} value={f.ngay ?? ""} onChange={set("ngay")} />
              </label>
              <label className="col-span-2">
                <span className={NHAN}>Ghi chú</span>
                <input className={cn(FIELD, "w-full")} maxLength={1000} value={f.ghiChu ?? ""} onChange={set("ghiChu")} />
              </label>
            </div>
          )}
          {mo.loai === "thu-hoi" && (
            <>
              <label className="block">
                <span className={NHAN}>Thu hồi từ ngày (buổi Trial trước ngày này vẫn được tính)</span>
                <input type="date" min={homNay} className={cn(FIELD, "w-full")} value={f.ngay ?? ""} onChange={set("ngay")} />
              </label>
              <label className="block">
                <span className={NHAN}>Lý do thu hồi</span>
                <textarea rows={2} maxLength={1000} className={cn(FIELD, "h-auto w-full py-2")} value={f.ghiChu ?? ""} onChange={set("ghiChu")} />
              </label>
            </>
          )}
          {mo.loai === "chinh-sach" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className={NHAN}>Phạm vi</span>
                  <select className={cn(FIELD, "w-full")} value={f.coSo ?? ""} onChange={set("coSo")}>
                    <option value="">Toàn hệ thống</option>
                    {quyen.coSo.map((c) => (
                      <option key={c.id} value={c.id}>
                        Riêng {c.nhan}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={NHAN}>Trạng thái</span>
                  <select className={cn(FIELD, "w-full")} value={f.bat ?? "1"} onChange={set("bat")}>
                    <option value="1">Bật</option>
                    <option value="0">Tắt</option>
                  </select>
                </label>
                <label>
                  <span className={NHAN}>Mức / học viên có mặt (VND)</span>
                  <input inputMode="numeric" className={cn(FIELD, "w-full")} value={f.muc ?? "30000"} onChange={set("muc")} />
                </label>
                <label>
                  <span className={NHAN}>Hiệu lực từ</span>
                  <input type="date" min={homNay} className={cn(FIELD, "w-full")} value={f.ngay ?? ""} onChange={set("ngay")} />
                </label>
              </div>
              <label className="block">
                <span className={NHAN}>Lý do / căn cứ phê duyệt</span>
                <textarea rows={2} maxLength={2000} className={cn(FIELD, "h-auto w-full py-2")} value={f.ghiChu ?? ""} onChange={set("ghiChu")} placeholder="vd: Theo SR.QD.238 §6, áp từ tháng 11" />
              </label>
            </>
          )}
        </div>
        <DialogFooter>
          <button type="button" className={BTN_OUTLINE} onClick={dong} disabled={dang}>
            Huỷ
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={dang || (mo.loai === "doi" && !f.rank)}
            onClick={() => {
              if (mo.loai === "doi") gui(() => doiRankAction({ userId: mo.gv.userId, rank: f.rank ?? "", effectiveFrom: f.ngay ?? "", lyDo: f.canCu ?? "" }));
              else if (mo.loai === "cap") gui(() => capChungNhanAction({ userId: mo.gv.userId, code: f.ma ?? null, effectiveFrom: f.ngay ?? "", note: f.ghiChu ?? null }));
              else if (mo.loai === "thu-hoi" && mo.gv.chungNhan) gui(() => thuHoiChungNhanAction({ id: mo.gv.chungNhan!.id, tuNgay: f.ngay ?? "", lyDo: f.ghiChu ?? "" }));
              else if (mo.loai === "chinh-sach")
                gui(() => datChinhSachTrialAction({ centerId: f.coSo ? f.coSo : null, enabled: (f.bat ?? "1") === "1", amountPerStudent: f.muc ?? "30000", effectiveFrom: f.ngay ?? "", reason: f.ghiChu ?? "" }));
            }}
          >
            {dang ? "Đang lưu…" : mo.loai === "doi" ? (f.rank ? `Đổi sang R${f.rank}` : "Chọn Rank mới") : "Lưu"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
