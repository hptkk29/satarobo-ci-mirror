"use client";

// Bảng số dư quỹ nghỉ bù + điều chỉnh tay (đợt 8 đơn từ). Nút "Điều chỉnh" chỉ hiện khi trang tính
// `dieuChinhDuoc` (= `hr_attendance:adjust` ở khối) — cùng cổng action kiểm.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD } from "@/components/admin/cham-cong/classes";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { cn } from "@/lib/utils";
import { dieuChinhQuyNghiBuAction } from "../_actions";

export type DongBangQuy = { userId: string; ten: string; soDu: string; soDuPhut: number; congThem: string; daDung: string };

const TH = "whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2.5 text-sm text-foreground";

export function BangQuyNghiBu({ coSo, dong, dieuChinhDuoc }: { coSo: string; dong: DongBangQuy[]; dieuChinhDuoc: boolean }) {
  const router = useRouter();
  const [dangSua, setDangSua] = useState<string | null>(null);
  const [chieu, setChieu] = useState<"CONG" | "TRU">("CONG");
  const [gio, setGio] = useState("");
  const [lyDo, setLyDo] = useState("");
  const [pending, start] = useTransition();

  const luu = (userId: string) => {
    const phut = Math.round(Number(gio.replace(",", ".")) * 60);
    if (!Number.isFinite(phut) || phut <= 0) {
      toast.error("Nhập số giờ lớn hơn 0 (vd 1,5)");
      return;
    }
    start(async () => {
      const r = await dieuChinhQuyNghiBuAction({ userId, coSo, phut: chieu === "CONG" ? phut : -phut, lyDo });
      if (r.ok) {
        toast.success("Đã điều chỉnh quỹ nghỉ bù");
        setDangSua(null);
        setGio("");
        setLyDo("");
        router.refresh();
      } else toast.error(r.error);
    });
  };

  return (
    <PhanTrangBang cuonNgang tenDonVi="người" khoaGhiNho="quy-nghi-bu">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-border">
          <tr>
            <th scope="col" className={TH}>Nhân sự</th>
            <th scope="col" className={TH}>Số dư</th>
            <th scope="col" className={TH}>Đã cộng</th>
            <th scope="col" className={TH}>Đã dùng</th>
            {dieuChinhDuoc && <th scope="col" className={TH}><span className="sr-only">Điều chỉnh</span></th>}
          </tr>
        </thead>
        <tbody>
          {dong.map((d) => (
            <tr key={d.userId} className="border-b border-border/60 align-top last:border-0">
              <td className={cn(TD, "font-medium")}>{d.ten}</td>
              <td className={cn(TD, "font-semibold tabular-nums", d.soDuPhut < 0 && "text-state-danger-ink")}>
                {d.soDu}
                {d.soDuPhut < 0 && <span className="block text-xs font-normal">âm — dữ liệu trước khi có chặn, cần rà soát</span>}
              </td>
              <td className={cn(TD, "tabular-nums text-muted-foreground")}>{d.congThem}</td>
              <td className={cn(TD, "tabular-nums text-muted-foreground")}>{d.daDung}</td>
              {dieuChinhDuoc && (
                <td className={TD}>
                  {dangSua === d.userId ? (
                    <div className="flex min-w-[16rem] flex-col gap-2">
                      <div className="flex gap-2">
                        <select
                          aria-label="Cộng hay trừ"
                          value={chieu}
                          onChange={(e) => setChieu(e.target.value as "CONG" | "TRU")}
                          className={cn(FIELD, "w-24")}
                        >
                          <option value="CONG">Cộng</option>
                          <option value="TRU">Trừ</option>
                        </select>
                        <input
                          aria-label="Số giờ"
                          inputMode="decimal"
                          placeholder="Số giờ, vd 1,5"
                          value={gio}
                          onChange={(e) => setGio(e.target.value)}
                          className={cn(FIELD, "w-32")}
                        />
                      </div>
                      <input
                        aria-label="Lý do điều chỉnh"
                        placeholder="Lý do (bắt buộc)"
                        value={lyDo}
                        onChange={(e) => setLyDo(e.target.value)}
                        className={FIELD}
                      />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => luu(d.userId)} disabled={pending} className={cn(BTN_PRIMARY, "h-8 px-3 text-xs")}>
                          {pending ? "Đang lưu…" : "Lưu"}
                        </button>
                        <button type="button" onClick={() => setDangSua(null)} disabled={pending} className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}>
                          Huỷ
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setDangSua(d.userId)} className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}>
                      Điều chỉnh
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </PhanTrangBang>
  );
}
