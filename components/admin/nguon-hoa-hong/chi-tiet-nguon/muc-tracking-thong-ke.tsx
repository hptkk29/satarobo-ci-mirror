// components/admin/nguon-hoa-hong/chi-tiet-nguon/muc-tracking-thong-ke.tsx — MỤC 5 «Tracking» và MỤC 6 «Thống kê» của trang chi tiết nguồn.
//
// Tracking: Page đã gán về nguồn (bảng Page → nguồn) + đường vào của lead. Thống kê: ba bảng SỐ nhỏ (lead 7/30 ngày/tổng · theo trạng thái lead · hàng chờ theo lý do), không biểu đồ.
// Mọi con số đếm qua Lead đã `scopedDb` — QLCS CS1 không đếm lead CS2 (nơi đọc lo; ở đây chỉ vẽ).
import type { LeadStatus } from "@prisma/client";
import { LEAD_STATUS_LABEL } from "@/lib/leads/status";
import type { ChiTietNguon } from "@/lib/nguon/doc-danh-muc";
import { LY_DO_HANG_CHO, NHAN_LY_DO } from "@/lib/nguon/doc-hang-cho";
import type { KetQuaMuc } from "@/lib/nguon/doc-trang-chi-tiet";
import { soVN } from "../nhan-nguon";
import { Hang, MucChiTiet, MucKhongDoc, MucRong } from "./khung-muc";

const nhanTrangThaiLead = (s: string) => LEAD_STATUS_LABEL[s as LeadStatus] ?? s;

export function MucTracking({ chiTiet, linkPageMapping }: { chiTiet: KetQuaMuc<ChiTietNguon>; linkPageMapping?: React.ReactNode }) {
  return (
    <MucChiTiet id="tracking" tieuDe="Tracking" ghiChu={linkPageMapping}>
      {!chiTiet.ok ? (
        <MucKhongDoc loai={chiTiet.loai} />
      ) : (
        <dl>
          <Hang nhan="Page đã gán">
            {chiTiet.du.pageDaMap.length === 0 ? (
              <span className="text-muted-foreground">Chưa có Page nào được gán về nguồn này.</span>
            ) : (
              <ul className="space-y-0.5">
                {chiTiet.du.pageDaMap.map((p) => (
                  <li key={p.pageId}>
                    <code className="font-mono text-xs">{p.pageId}</code>
                    {p.campaignCode && <span className="text-muted-foreground"> · chiến dịch {p.campaignCode}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Hang>
          <Hang nhan="Đường vào">
            {chiTiet.du.thongKe.theoDuongVao.length === 0 ? (
              <span className="text-muted-foreground">Chưa có lead nào mang nguồn này.</span>
            ) : (
              <ul className="max-w-sm space-y-0.5">
                {chiTiet.du.thongKe.theoDuongVao.map((d) => (
                  <li key={d.duongVao} className="flex justify-between gap-4 tabular-nums">
                    <span className="min-w-0 truncate">{d.duongVao}</span>
                    <span>{soVN(d.so)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Hang>
        </dl>
      )}
    </MucChiTiet>
  );
}

export function MucThongKe({ chiTiet }: { chiTiet: KetQuaMuc<ChiTietNguon> }) {
  return (
    <MucChiTiet id="thong-ke" tieuDe="Thống kê" ghiChu="Số lead đếm trong các cơ sở bạn được xem.">
      {!chiTiet.ok ? (
        <MucKhongDoc loai={chiTiet.loai} />
      ) : chiTiet.du.thongKe.tong === 0 ? (
        <MucRong>Chưa có lead nào mang nguồn này trong phạm vi bạn xem.</MucRong>
      ) : (
        (() => {
          const tk = chiTiet.du.thongKe;
          return (
            <div className="grid gap-6 md:grid-cols-3">
              <table className="w-full text-sm">
                <caption className="mb-1 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lead vào</caption>
                <tbody>
                  <tr>
                    <th scope="row" className="py-1 text-left font-normal text-muted-foreground">7 ngày qua</th>
                    <td className="py-1 text-right tabular-nums">{soVN(tk.bay7)}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="py-1 text-left font-normal text-muted-foreground">30 ngày qua</th>
                    <td className="py-1 text-right tabular-nums">{soVN(tk.ba30)}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="py-1 text-left font-normal text-muted-foreground">Tổng</th>
                    <td className="py-1 text-right font-semibold tabular-nums">{soVN(tk.tong)}</td>
                  </tr>
                </tbody>
              </table>
              <table className="w-full text-sm">
                <caption className="mb-1 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Theo trạng thái lead</caption>
                <tbody>
                  {tk.theoTrangThaiLead.map((t) => (
                    <tr key={t.trangThai}>
                      <th scope="row" className="py-1 text-left font-normal text-muted-foreground">{nhanTrangThaiLead(t.trangThai)}</th>
                      <td className="py-1 text-right tabular-nums">{soVN(t.so)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="w-full text-sm">
                <caption className="mb-1 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Đang chờ xử lý nguồn</caption>
                <tbody>
                  {LY_DO_HANG_CHO.map((l) => (
                    <tr key={l}>
                      <th scope="row" className="py-1 text-left font-normal text-muted-foreground">{NHAN_LY_DO[l]}</th>
                      <td className="py-1 text-right tabular-nums">{soVN(tk.hangChoTheoLyDo[l])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()
      )}
    </MucChiTiet>
  );
}
