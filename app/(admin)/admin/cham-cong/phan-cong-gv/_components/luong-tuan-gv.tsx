"use client";
// Lương TUẦN của một giáo viên theo loại (PR8): bấm ô "Tuần" ở cuối dòng tiền ⇒ ngăn bên phải. KẾ HOẠCH và ĐÃ XÁC NHẬN đặt cạnh nhau, cùng
// một nguồn với lưới (`tongHopTuan` tách đúng các dòng tiền của ô — không tính lại). Công tắc tiền Parttime tắt ⇒ chỉ là xem trước / đối soát.
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { LuoiTuan } from "@/lib/parttime/luoi-tuan-db";
import { NHAN_NHOM_TIEN, tongHopTuan } from "@/lib/parttime/luong-tuan";

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

export function LuongTuanGv({
  dong,
  nhanTuan,
  tienBat,
  onDong,
}: {
  dong: LuoiTuan["dong"][number] | null;
  nhanTuan: string;
  /** Công tắc COMPENSATION của cơ sở — đọc thật ở trang, không viết cứng (luật 12). */
  tienBat: boolean;
  onDong: () => void;
}) {
  const t = dong ? tongHopTuan(dong) : null;
  return (
    <Sheet open={dong != null} onOpenChange={(v) => !v && onDong()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {dong && t && (
          <>
            <SheetHeader>
              <SheetTitle>Lương tuần — {dong.ten}</SheetTitle>
              <SheetDescription>
                {nhanTuan}. Kế hoạch suy từ phân công; đã xác nhận là đơn vị quản lý đã duyệt.{" "}
                {tienBat
                  ? "Số chi cuối cùng lấy ở Công parttime tháng."
                  : "Công tắc tiền Parttime của cơ sở đang tắt — đây là số xem trước, chưa phải số chi."}
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="whitespace-nowrap py-2 font-semibold uppercase tracking-wide">Khoản</th>
                    <th className="whitespace-nowrap py-2 text-right font-semibold uppercase tracking-wide">Kế hoạch</th>
                    <th className="whitespace-nowrap py-2 text-right font-semibold uppercase tracking-wide">Đã xác nhận</th>
                  </tr>
                </thead>
                <tbody>
                  {t.nhom.map((n) => {
                    const rong = n.keHoach === 0 && n.daXacNhan === 0;
                    return (
                      <tr key={n.loai} className={cn("border-b border-border/60", rong && "text-muted-foreground")}>
                        <td className="py-2">{NHAN_NHOM_TIEN[n.loai]}</td>
                        <td className="whitespace-nowrap py-2 text-right tabular-nums">{rong ? "—" : vnd(n.keHoach)}</td>
                        <td className="whitespace-nowrap py-2 text-right tabular-nums">{rong ? "—" : vnd(n.daXacNhan)}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td className="py-2 font-semibold">Tổng tuần</td>
                    <td className="whitespace-nowrap py-2 text-right font-bold tabular-nums">{vnd(t.keHoach)}</td>
                    <td className="whitespace-nowrap py-2 text-right font-bold tabular-nums">{vnd(t.daXacNhan)}</td>
                  </tr>
                </tbody>
              </table>
              {t.chuaTinh > 0 && (
                <p className="mt-3 rounded-md bg-state-warning-soft px-3 py-2 text-xs text-state-warning-ink">
                  {t.chuaTinh} khoản chưa tính được (buổi lệch chuẩn chưa có ghi đè, hoặc trực chờ quyết khi có học bù) — không cộng vào tổng. Mở ô có cảnh báo
                  để xử lý.
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Bằng chứng chấm công của từng buổi xem trong ô. Tiền đã xác nhận chỉ đến từ đơn vị quản lý đã duyệt ở Công parttime tháng — không suy từ mã kế hoạch.
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
