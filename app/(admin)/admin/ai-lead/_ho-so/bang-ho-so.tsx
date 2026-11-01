// Bảng hồ sơ chờ AI. Server Component; phân trang bằng <PhanTrangBang> (bảng ≤ SO_DONG_TOI_DA dòng đã lọc ở máy chủ).
//
// Hai hình dạng từ MỘT cây DOM (không nhân đôi nội dung):
//  · từ 1536px (2xl): bảng dày 44px/dòng (DESIGN.md §2). Ô được xuống dòng tới 2000px (bảng 8 cột cần ≈1070px khi xuống dòng, ≈1630px khi `nowrap`); `nowrap` chỉ từ 2000px. Vẫn bọc `cuonNgang` làm lưới an toàn;
//  · dưới 1536px (kể cả 280px): mỗi dòng thành MỘT THẺ (lưới 2 cột từ 1000px). Đo 18 độ rộng: vì khung admin có thanh bên 256px cố định từ 768px, bảng 8 cột ở 768–1440px chỉ thấy 2–3 cột — nhãn cột lấy từ `data-nhan` qua ::before, tiêu đề cột ẩn khỏi mắt nhưng còn cho trình đọc màn hình.
// Cả dòng là vùng bấm: liên kết ở ô «Khách» phủ kín dòng bằng `after:inset-0` (dòng `relative`) — và dòng có `cursor-pointer` đúng vì nó bấm được (luật 12).
import Link from "next/link";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import type { HangDanhSach } from "@/lib/ai-lead/dich-vu/duyet";
import { NHAN_Y_DINH, conLai, gioVn } from "./hien-thi";
import { NhanSla, NhanTrangThai } from "./huy-hieu";

const TH = "whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const TD =
  "px-4 py-3 align-middle text-sm min-[2000px]:whitespace-nowrap max-2xl:block max-2xl:px-0 max-2xl:py-0.5 " +
  "max-2xl:before:mr-2 max-2xl:before:text-xs max-2xl:before:text-muted-foreground max-2xl:before:content-[attr(data-nhan)]";

export function BangHoSo({ hang, now, khoaTrang }: { hang: HangDanhSach[]; now: Date; khoaTrang: string }) {
  return (
    <PhanTrangBang tenDonVi="hồ sơ" cuonNgang khoaTrang={khoaTrang} khoaGhiNho="ai-lead">
      <table className="w-full border-collapse text-sm max-2xl:block">
        <thead className="border-b border-border bg-muted/40 max-2xl:sr-only">
          <tr>
            <th className={TH}>Khách</th>
            <th className={TH}>SĐT</th>
            <th className={TH}>Khách muốn</th>
            <th className={TH}>Cơ sở</th>
            <th className={TH}>Trạng thái</th>
            <th className={TH}>SLA</th>
            <th className={TH}>Người xử lý</th>
            <th className={TH}>Nhận lúc</th>
          </tr>
        </thead>
        <tbody className="max-2xl:grid max-2xl:grid-cols-1 max-2xl:gap-2 min-[1000px]:max-2xl:grid-cols-2">
          {hang.map((h) => (
            <tr
              key={h.id}
              className="relative cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/40 focus-within:bg-muted/40 max-2xl:block max-2xl:rounded-xl max-2xl:border max-2xl:bg-card max-2xl:p-3"
            >
              <td className={`${TD} max-2xl:before:content-none`}>
                <Link
                  href={`/ai-lead/${h.id}`}
                  title={h.fbName ?? undefined}
                  className="block min-w-[9rem] max-w-[16rem] [overflow-wrap:anywhere] font-medium min-[2000px]:truncate text-foreground outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:underline focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary max-2xl:max-w-none"
                >
                  {h.fbName ?? <span className="font-normal text-muted-foreground">(chưa có tên Facebook)</span>}
                </Link>
                <span className="block font-mono text-[11px] text-muted-foreground">Mã {h.id.slice(-8)} · {h.pageId}</span>
              </td>
              <td className={TD} data-nhan="SĐT">
                {h.phone ?? <span className="text-muted-foreground">Chưa có</span>}
              </td>
              <td className={TD} data-nhan="Khách muốn">{NHAN_Y_DINH[h.intent] ?? h.intent}</td>
              <td className={TD} data-nhan="Cơ sở">
                <span title={h.centerTen ?? undefined} className="inline-block min-w-[9rem] max-w-[12rem] align-bottom min-[2000px]:truncate max-2xl:max-w-none">
                  {h.centerTen ?? <span className="text-muted-foreground">Chưa chọn</span>}
                </span>
              </td>
              <td className={TD} data-nhan="Trạng thái">
                <NhanTrangThai state={h.state} />
                {h.thieu.length > 0 && h.state !== "COLLECTING" && (
                  <span className="ml-2 text-xs text-muted-foreground">thiếu {h.thieu.length} mục</span>
                )}
              </td>
              <td className={TD} data-nhan="SLA">
                <NhanSla muc={h.mucSla} />
                {h.mucSla !== "KHONG_AP_DUNG" && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {conLai(h.claimedById ? h.slaResolveDueAt : h.slaClaimDueAt, now)}
                  </span>
                )}
              </td>
              <td className={TD} data-nhan="Người xử lý">
                <span className="inline-block max-w-[10rem] align-bottom min-[2000px]:truncate max-2xl:max-w-none">
                  {h.claimedById ? (h.claimedTen ?? "(không rõ tên)") : <span className="text-muted-foreground">Chưa ai nhận</span>}
                </span>
              </td>
              <td className={`${TD} text-muted-foreground`} data-nhan="Nhận lúc">{gioVn(h.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PhanTrangBang>
  );
}
