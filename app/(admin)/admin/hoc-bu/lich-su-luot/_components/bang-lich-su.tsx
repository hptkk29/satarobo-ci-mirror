"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { formatDateTimeVN } from "@/lib/format/date";
import { cn } from "@/lib/utils";
// Khớp `LY_DO_TOI_THIEU` ở `lib/hoc-bu/huy.ts` (không import: tệp đó kéo theo mã máy chủ).
const LY_DO_TOI_THIEU = 10;
import type { DongLichSu } from "@/lib/hoc-bu/lich-su-luot-db";
import { suaLuotHocVuotAction, suaLuotQlcsAction } from "../_actions";

// Bảng lịch sử cấp lượt học bù / duyệt học vượt (17/11/2026). Dữ liệu đã qua phạm vi cơ sở ở máy chủ; nút Sửa chỉ hiện khi bút toán sửa được VÀ người xem có quyền
// (`coTheSua`) — Server Action vẫn gác lại. Sửa = ghi bút toán BÙ TRỪ, bút toán gốc giữ nguyên (sổ lượt chỉ ghi thêm).

const TONE: Record<string, PillTone> = {
  QLCS_CAP: "success",
  QLCS_GIAM: "danger",
  QLCS_SUA: "warning",
  HOC_VUOT_DUYET: "info",
  HOC_VUOT_SUA: "warning",
  HOC_VUOT_DOI: "muted",
  THEO_DON: "muted",
  TU_DONG: "muted",
  KHAC: "muted",
};
const TRANG_THAI_YC: Record<string, string> = { PENDING: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Từ chối", CANCELLED: "Đã huỷ" };

const dau = (n: number) => (n > 0 ? `+${n}` : String(n));

function maLanMoi(): string {
  // Chỉ chữ-số-gạch, 8–64 ký tự (khớp luật máy chủ). Sinh trong HANDLER, không trong lúc render.
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function BangLichSu({ dong, coTheSua }: { dong: DongLichSu[]; coTheSua: boolean }) {
  const [sua, setSua] = useState<{ d: DongLichSu; ma: string } | null>(null);
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className={adminTh}>Thời gian</th>
                <th className={adminTh}>Học viên</th>
                <th className={adminTh}>Loại</th>
                <th className={cn(adminTh, "text-right")}>Lượt</th>
                <th className={adminTh}>Chi tiết</th>
                <th className={adminTh}>Người làm</th>
                <th className={cn(adminTh, "text-right")}>Sổ lượt hiện tại</th>
                {coTheSua && <th className={adminTh}>
                  <span className="sr-only">Sửa</span>
                </th>}
              </tr>
            </thead>
            <tbody>
              {dong.map((d) => {
                const doi = d.hieuLuc !== null && d.hieuLuc !== d.delta;
                return (
                  <tr key={d.id} className={adminTr}>
                    <td className={cn(adminTd, "whitespace-nowrap tabular-nums")}>{formatDateTimeVN(d.luc)}</td>
                    <td className={cn(adminTd, "max-w-[220px]")}>
                      <p className="truncate font-medium">{d.hocVien}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {d.maHocVien ? `${d.maHocVien} · ` : ""}
                        {d.khoa}
                      </p>
                    </td>
                    <td className={adminTd}>
                      <StatusPill tone={TONE[d.nhom] ?? "muted"}>{d.nhan}</StatusPill>
                    </td>
                    <td className={cn(adminTd, "whitespace-nowrap text-right tabular-nums")}>
                      <span className={cn("font-semibold", d.delta > 0 ? "text-[color:var(--state-success)]" : d.delta < 0 ? "text-[color:var(--state-danger)]" : "")}>{dau(d.delta)}</span>
                      {doi && (
                        <p className="text-xs text-muted-foreground" title="Số hiệu lực sau các lần sửa">
                          hiệu lực {d.hieuLuc !== null ? dau(d.hieuLuc) : ""}
                        </p>
                      )}
                    </td>
                    <td className={cn(adminTd, "min-w-[260px] max-w-[420px]")}>
                      {d.yeuCau && (
                        <p className="text-xs text-muted-foreground">
                          Đơn {d.yeuCau.maDon} · {d.yeuCau.lop} · bắt đầu buổi {d.yeuCau.buoiBatDau} · phải học vượt {d.yeuCau.phaiBu} buổi · Sale xin bù {d.yeuCau.xin} buổi ({TRANG_THAI_YC[d.yeuCau.trangThai]})
                        </p>
                      )}
                      <p className="break-words">{d.lyDo || "—"}</p>
                    </td>
                    <td className={cn(adminTd, "whitespace-nowrap")}>{d.nguoi}</td>
                    <td className={cn(adminTd, "whitespace-nowrap text-right tabular-nums")} title={`Tổng cấp ${d.so.tong} · đang giữ ${d.so.dangGiu} · đã dùng ${d.so.daDung}`}>
                      còn <b>{d.so.con}</b>/{d.so.tong}
                    </td>
                    {coTheSua && (
                      <td className={adminTd}>
                        {d.suaDuoc ? (
                          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setSua({ d, ma: maLanMoi() })}>
                            Sửa
                          </Button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {sua && <HopSua key={sua.ma} d={sua.d} ma={sua.ma} onDong={() => setSua(null)} />}
    </>
  );
}

function HopSua({ d, ma, onDong }: { d: DongLichSu; ma: string; onDong: () => void }) {
  const router = useRouter();
  const laVuot = d.nhom === "HOC_VUOT_DUYET";
  const hienTai = d.hieuLuc ?? d.delta;
  const [so, setSo] = useState(String(hienTai));
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function luu() {
    setLoi(null);
    const n = Number(so);
    if (!Number.isInteger(n)) return setLoi("Nhập số nguyên");
    if (lyDo.trim().length < LY_DO_TOI_THIEU) return setLoi(`Ghi lý do ít nhất ${LY_DO_TOI_THIEU} ký tự`);
    start(async () => {
      const kq = laVuot && d.yeuCau
        ? await suaLuotHocVuotAction({ requestId: d.yeuCau.id, bMoi: n, lyDo, maLan: ma })
        : await suaLuotQlcsAction({ entryId: d.id, soMoi: n, lyDo, maLan: ma });
      if (!kq.ok) {
        setLoi(kq.error);
        toast.error(kq.error);
        return;
      }
      toast.success(kq.daDoi ? `Đã sửa ${d.hocVien}: ${dau(kq.thayDoi)} lượt so với trước` : "Lần sửa này đã được ghi trước đó — sổ không đổi");
      onDong();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(m) => !m && !pending && onDong()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{laVuot ? "Sửa số buổi bù đã duyệt" : "Sửa lượt đã cấp"}</DialogTitle>
          <DialogDescription>
            {d.hocVien} · {d.khoa}. Bút toán gốc giữ nguyên; hệ thống ghi thêm một bút toán bù trừ để số hiệu lực thành số bạn nhập.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="so-moi">{laVuot ? `Số buổi bù đúng (1–${d.yeuCau?.phaiBu ?? "?"}, hiện ${hienTai})` : `Số lượt đúng của lần này (có dấu, hiện ${dau(hienTai)})`}</Label>
            <Input id="so-moi" inputMode="numeric" value={so} onChange={(e) => setSo(e.target.value)} className="mt-1 h-11 sm:h-9" />
          </div>
          <div>
            <Label htmlFor="ly-do-sua">Lý do sửa (bắt buộc, ≥ {LY_DO_TOI_THIEU} ký tự)</Label>
            <Textarea id="ly-do-sua" value={lyDo} onChange={(e) => setLyDo(e.target.value)} rows={3} maxLength={500} className="mt-1" />
          </div>
          <p className="text-xs text-muted-foreground">Giảm chỉ rút được phần lượt còn TRỐNG — lượt đang giữ chỗ trong case hoặc đã dùng không rút lại được.</p>
          {loi && (
            <p role="alert" className="rounded-lg bg-[color:var(--state-danger-soft)] px-3 py-2 text-sm text-[color:var(--state-danger)]">
              {loi}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onDong} disabled={pending} className="min-h-11 sm:min-h-9">
            Đóng
          </Button>
          <Button onClick={luu} disabled={pending} className="min-h-11 sm:min-h-9">
            {pending ? "Đang lưu…" : "Lưu sửa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
