// Tab "Tổng hợp tự động" (GĐ6, kỳ ≥ 2026-11): công tính KHI ĐỌC theo ô — không có bước QLCS xác nhận. Số đọc từ `docCongOThang`
// (cùng loader với site GV). Ô "cần xem" là ô GV được mời phản ánh; chưa phản ánh thì ô đó chưa được tính.
import type { OCong } from "@/lib/phan-cong/cong-o-db";
import { NHAN_LY_DO_O, NHAN_TRANG_THAI_PHAN_ANH } from "@/lib/phan-cong/phan-anh";

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

export function TongHopTuDong({ o, tu, den }: { o: OCong[]; tu: string; den: string }) {
  const nguoi = [...new Map(o.map((x) => [x.userId, x.ten])).entries()].sort((a, b) => a[1].localeCompare(b[1], "vi"));
  const canXem = o.filter((x) => x.trangThai === "CAN_XEM");
  return (
    <section className="space-y-4" data-tong-hop-tu-dong>
      <p className="text-sm text-muted-foreground">
        Từ {dm(tu)} tới {dm(den)} (ngày đã qua). Ô <b>tự động</b> = mọi cặp quét kỳ vọng đủ lượt — tính luôn, không cần xác nhận. Ô{" "}
        <b>cần xem</b> chưa được tính cho tới khi giáo viên phản ánh và được duyệt.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Giáo viên</th>
              <th className="px-3 py-2 text-right">Ô có việc</th>
              <th className="px-3 py-2 text-right">Tự động</th>
              <th className="px-3 py-2 text-right">Cần xem</th>
              <th className="px-3 py-2 text-right">Tiết đứng chính (tự động)</th>
              <th className="px-3 py-2 text-right">Tiết trợ giảng (tự động)</th>
              <th className="px-3 py-2 text-right">Trực quy đổi (tự động)</th>
            </tr>
          </thead>
          <tbody>
            {nguoi.map(([id, ten]) => {
              const cua = o.filter((x) => x.userId === id);
              const td = cua.filter((x) => x.trangThai === "TU_DONG");
              return (
                <tr key={id} className="border-t border-border">
                  <td className="px-3 py-2">{ten}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{cua.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{td.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{cua.length - td.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{td.reduce((s, x) => s + x.tietD, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{td.reduce((s, x) => s + x.tietTG, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{td.reduce((s, x) => s + x.trucQuyDoi, 0).toLocaleString("vi-VN")}</td>
                </tr>
              );
            })}
            {!nguoi.length && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  Chưa có ô công nào trong khoảng này.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canXem.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Ô cần xem ({canXem.length})</h3>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm" data-o-can-xem>
            {canXem.map((x) => (
              <li key={`${x.centerId}-${x.userId}-${x.ngay}-${x.ca}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-medium">{x.ten}</span>
                <span className="tabular-nums text-muted-foreground">
                  {dm(x.ngay)} · ca {x.ca} · {x.ma}
                </span>
                <span className="text-state-warning-ink">{x.lyDo.map((l) => NHAN_LY_DO_O[l] ?? l).join(", ")}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {x.phanAnh ? (NHAN_TRANG_THAI_PHAN_ANH[x.phanAnh.status] ?? x.phanAnh.status) : "Chưa phản ánh"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
