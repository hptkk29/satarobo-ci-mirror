"use client";

// Bảng số dư SỔ PHÉP NĂM + bút toán tay (P2.1A). Nút "Điều chỉnh" chỉ hiện khi trang tính
// `dieuChinhDuoc` (= `hr_attendance:adjust` ở khối) — cùng cổng action kiểm (luật 12).
// Nhập theo NGÀY CÔNG (vd 0,5) — quy ra phút bằng `phutMotNgay` của tham số vận hành, đúng con số
// mà đường duyệt đơn dùng để trừ.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD } from "@/components/admin/cham-cong/classes";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { cn } from "@/lib/utils";
import { dieuChinhSoPhepAction } from "../_actions";

export type DongBangSoPhep = { userId: string; ten: string; soDu: string; soDuPhut: number; daCap: string; daDung: string };

const TH = "whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2.5 text-sm text-foreground";

type Kieu = "OPENING" | "CONG" | "TRU";

export function BangSoPhep({
  coSo,
  nam,
  phutMotNgay,
  dong,
  dieuChinhDuoc,
}: {
  coSo: string;
  nam: number;
  phutMotNgay: number;
  dong: DongBangSoPhep[];
  dieuChinhDuoc: boolean;
}) {
  const router = useRouter();
  const [dangSua, setDangSua] = useState<string | null>(null);
  const [kieu, setKieu] = useState<Kieu>("OPENING");
  const [ngay, setNgay] = useState("");
  const [lyDo, setLyDo] = useState("");
  const [pending, start] = useTransition();

  const luu = (userId: string) => {
    const phut = Math.round(Number(ngay.replace(",", ".")) * phutMotNgay);
    if (!Number.isFinite(phut) || phut <= 0) {
      toast.error("Nhập số ngày công lớn hơn 0 (vd 0,5)");
      return;
    }
    start(async () => {
      const r = await dieuChinhSoPhepAction({
        userId,
        coSo,
        nam,
        loai: kieu === "OPENING" ? "OPENING" : "MANUAL_ADJUSTMENT",
        phut: kieu === "TRU" ? -phut : phut,
        lyDo,
      });
      if (r.ok) {
        toast.success("Đã ghi sổ phép");
        setDangSua(null);
        setNgay("");
        setLyDo("");
        router.refresh();
      } else toast.error(r.error);
    });
  };

  return (
    <PhanTrangBang cuonNgang tenDonVi="người" khoaGhiNho="so-phep-nam">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-border">
          <tr>
            <th scope="col" className={TH}>Nhân sự</th>
            <th scope="col" className={TH}>Còn lại</th>
            <th scope="col" className={TH}>Đã cấp / hoàn</th>
            <th scope="col" className={TH}>Đã dùng</th>
            {dieuChinhDuoc && <th scope="col" className={TH}><span className="sr-only">Điều chỉnh</span></th>}
          </tr>
        </thead>
        <tbody>
          {dong.map((d) => (
            <tr key={d.userId} className="border-b border-border/60 align-top last:border-0">
              <td className={cn(TD, "font-medium")}>{d.ten}</td>
              <td className={cn(TD, "font-semibold tabular-nums", d.soDuPhut < 0 && "text-state-danger-ink")}>{d.soDu}</td>
              <td className={cn(TD, "tabular-nums text-muted-foreground")}>{d.daCap}</td>
              <td className={cn(TD, "tabular-nums text-muted-foreground")}>{d.daDung}</td>
              {dieuChinhDuoc && (
                <td className={TD}>
                  {dangSua === d.userId ? (
                    <div className="flex min-w-[16rem] flex-col gap-2">
                      <div className="flex gap-2">
                        <select
                          aria-label="Loại bút toán"
                          value={kieu}
                          onChange={(e) => setKieu(e.target.value as Kieu)}
                          className={cn(FIELD, "w-36")}
                        >
                          <option value="OPENING">Cấp đầu kỳ</option>
                          <option value="CONG">Điều chỉnh cộng</option>
                          <option value="TRU">Điều chỉnh trừ</option>
                        </select>
                        <input
                          aria-label="Số ngày công"
                          inputMode="decimal"
                          placeholder="Số ngày, vd 0,5"
                          value={ngay}
                          onChange={(e) => setNgay(e.target.value)}
                          className={cn(FIELD, "w-32")}
                        />
                      </div>
                      <input
                        aria-label="Lý do"
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
