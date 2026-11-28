// Tab "Tổng hợp tự động" (GĐ6, kỳ ≥ 2026-11).
// ⚠️ ĐẢO 09/11/2026 (chủ dự án: chốt kỳ ghi theo PHÂN CÔNG): khối đầu là ĐÚNG kế hoạch chốt kỳ sẽ ghi (`docKeHoachGhiKy` — cùng hàm
// `ghiCungDay` dùng), kèm mục KHÔNG ghi tự động (chưa tính được / Trial / vượt ca) và lý do. Bảng ô theo lượt quét (`docCongOThang`) phía
// dưới chỉ còn là BẰNG CHỨNG — "cần xem" không còn chặn ghi công (luật 12: nhãn cũ "chưa được tính" nay sai).
import type { OCong } from "@/lib/phan-cong/cong-o-db";
import type { MucBoQua, TongGhiNguoi } from "@/lib/phan-cong/ghi-theo-phan-cong";
import { NHAN_LY_DO_O, NHAN_TRANG_THAI_PHAN_ANH } from "@/lib/phan-cong/phan-anh";

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const so = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

export function TongHopTuDong({
  o,
  tu,
  den,
  keGhi,
}: {
  o: OCong[];
  tu: string;
  den: string;
  /** Kế hoạch ghi cứng theo phân công (`docKeHoachGhiKy` + `tongGhiTheoNguoi`). BẮT BUỘC (luật 7); null = không đọc được. */
  keGhi: { nguoi: TongGhiNguoi[]; ten: Record<string, string>; boQua: MucBoQua[]; tienSeGhi: number } | null;
}) {
  const nguoi = [...new Map(o.map((x) => [x.userId, x.ten])).entries()].sort((a, b) => a[1].localeCompare(b[1], "vi"));
  const canXem = o.filter((x) => x.trangThai === "CAN_XEM");
  const tenCua = (id: string) => keGhi?.ten[id] ?? id;
  return (
    <section className="space-y-4" data-tong-hop-tu-dong>
      {keGhi && (
        <div className="space-y-2" data-ke-hoach-ghi>
          <h3 className="text-sm font-semibold">Công sẽ ghi lúc chốt kỳ — theo phân công</h3>
          <p className="text-sm text-muted-foreground">
            Chốt kỳ ghi công cho MỌI tiết / ca trực / hỗ trợ Trial đã phân công của giáo viên parttime, đúng số Lương dự kiến (số tiết, ca
            trực quy đổi, đơn giá + Rank tại ngày, số học viên Trial có mặt × mức). Lượt quét chỉ là bằng chứng — ô thiếu quét vẫn được ghi; muộn / sớm chỉ trừ qua điều chỉnh quản lý đã
            xác nhận. Tổng sẽ ghi: <b className="tabular-nums text-foreground">{tien(keGhi.tienSeGhi)}</b>.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Giáo viên</th>
                  <th className="px-3 py-2 text-right">Tiết đứng chính</th>
                  <th className="px-3 py-2 text-right">Tiết trợ giảng</th>
                  <th className="px-3 py-2 text-right">Ca trực quy đổi</th>
                  <th className="px-3 py-2 text-right">Buổi hỗ trợ Trial</th>
                  <th className="px-3 py-2 text-right">Tiền sẽ ghi</th>
                  <th className="px-3 py-2 text-right">Không ghi tự động</th>
                </tr>
              </thead>
              <tbody>
                {[...keGhi.nguoi]
                  .sort((a, b) => tenCua(a.userId).localeCompare(tenCua(b.userId), "vi"))
                  .map((x) => (
                    <tr key={x.userId} className="border-t border-border">
                      <td className="px-3 py-2">{tenCua(x.userId)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{so(x.tietChinh)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{so(x.tietTroGiang)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{so(x.caTruc)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{x.buoiTrial || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{tien(x.tien)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{x.boQua || "—"}</td>
                    </tr>
                  ))}
                {!keGhi.nguoi.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      Chưa có phân công nào của giáo viên parttime trong kỳ.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {keGhi.boQua.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-state-warning-ink/30 text-sm" data-khong-ghi-tu-dong>
              {keGhi.boQua.map((b, i) => (
                <li key={`${b.loai}-${b.id}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="font-medium">{tenCua(b.userId)}</span>
                  <span className="tabular-nums text-muted-foreground">{dm(b.ngay)}</span>
                  <span className="text-state-warning-ink">{b.lyDo}</span>
                  {b.tien != null && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{tien(b.tien)} dự kiến</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <h3 className="text-sm font-semibold">Bằng chứng lượt quét theo ô</h3>
      <p className="text-sm text-muted-foreground">
        Từ {dm(tu)} tới {dm(den)} (ngày đã qua). Ô <b>đủ lượt</b> = mọi cặp quét kỳ vọng đủ lượt. Ô <b>cần xem</b> thiếu / trễ lượt —
        chỉ là bằng chứng để quản lý rà, KHÔNG chặn ghi công (công ghi theo phân công ở bảng trên).
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
