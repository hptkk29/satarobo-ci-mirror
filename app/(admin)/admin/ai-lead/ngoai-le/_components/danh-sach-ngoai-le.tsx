// Danh sách ngoại lệ. Server Component; phân trang bằng <PhanTrangBang> (bảng ≤ SO_DONG_TOI_DA dòng đã lọc ở máy chủ). Cùng quy ước với bảng «Hồ sơ chờ AI»:
//  · từ 1536px (2xl): bảng dày; · dưới 1536px (kể cả 280px): mỗi dòng thành MỘT THẺ (lưới 2 cột từ 1000px) — nhãn cột lấy từ `data-nhan`, tiêu đề cột ẩn khỏi mắt nhưng còn cho trình đọc màn hình.
// Cả dòng là vùng bấm: liên kết ở ô «Khách» phủ kín dòng bằng `after:inset-0` (dòng `relative`) — và dòng có `cursor-pointer` đúng vì nó bấm được (luật 12).
// Nút hành động nổi trên lớp phủ (`relative z-10`, trong HanhDongNgoaiLe) nên bấm nút KHÔNG mở hồ sơ.
import Link from "next/link";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import type { HangNgoaiLe } from "@/lib/ai-lead/dich-vu/ngoai-le";
import { NHAN_LOAI } from "@/lib/ai-lead/dich-vu/ngoai-le-thuan";
import { tuoiChu } from "../../_components/dinh-dang";
import { ViTrang, type Tone } from "../../_components/nhan-trang-thai";
import { HanhDongNgoaiLe } from "./hanh-dong-ngoai-le";

const TH = "whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const TD =
  "px-4 py-3 align-top text-sm max-2xl:block max-2xl:px-0 max-2xl:py-0.5 " +
  "max-2xl:before:mr-2 max-2xl:before:text-xs max-2xl:before:text-muted-foreground max-2xl:before:content-[attr(data-nhan)]";

export function toneLoai(h: Pick<HangNgoaiLe, "loai" | "mucSla">): Tone {
  if (h.loai === "SYSTEM_EXCEPTION") return "danger";
  if (h.loai === "ASSIGNMENT_PENDING") return "warning";
  return h.mucSla === "QUA_HAN_XU_LY" ? "danger" : "warning";
}

export function NhanLoai({ h }: { h: Pick<HangNgoaiLe, "loai" | "mucSla" | "leadDaCoNguoi"> }) {
  // Lead đã có sale mà hồ sơ chưa đóng: nhãn nói việc còn lại («Chờ đóng hồ sơ»), không còn tông cảnh báo.
  if (h.loai === "ASSIGNMENT_PENDING" && h.leadDaCoNguoi === true) return <ViTrang tone="info">Chờ đóng hồ sơ</ViTrang>;
  return <ViTrang tone={toneLoai(h)}>{NHAN_LOAI[h.loai]}</ViTrang>;
}

export function DanhSachNgoaiLe({ hang, khoaTrang }: { hang: HangNgoaiLe[]; khoaTrang: string }) {
  return (
    <PhanTrangBang tenDonVi="ngoại lệ" cuonNgang khoaTrang={khoaTrang} khoaGhiNho="ai-lead-ngoai-le">
      <table className="w-full border-collapse text-sm max-2xl:block">
        <thead className="border-b border-border bg-muted/40 max-2xl:sr-only">
          <tr>
            <th className={TH}>Khách</th>
            <th className={TH}>Vì sao là ngoại lệ</th>
            <th className={TH}>Cơ sở</th>
            <th className={TH}>Tuổi</th>
            <th className={TH}>Người xử lý</th>
            <th className={TH}>Xử lý</th>
          </tr>
        </thead>
        <tbody className="max-2xl:grid max-2xl:grid-cols-1 max-2xl:gap-2 min-[1000px]:max-2xl:grid-cols-2">
          {hang.map((h) => {
            const ten = h.fbName ?? "(chưa có tên Facebook)";
            return (
              <tr
                key={h.id}
                data-loai={h.loai}
                className="relative cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/40 focus-within:bg-muted/40 max-2xl:block max-2xl:rounded-xl max-2xl:border max-2xl:bg-card max-2xl:p-3"
              >
                <td className={`${TD} max-2xl:before:content-none`}>
                  <Link
                    href={`/ai-lead/${h.id}`}
                    className="block min-w-[9rem] max-w-[16rem] [overflow-wrap:anywhere] font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:underline focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary max-2xl:max-w-none"
                  >
                    {h.fbName ?? <span className="font-normal text-muted-foreground">{ten}</span>}
                  </Link>
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    Mã {h.id.slice(-8)} · {h.pageId}
                  </span>
                </td>
                <td className={`${TD} max-2xl:before:content-none`}>
                  <NhanLoai h={h} />
                  <span className="mt-1 block max-w-[28rem] text-foreground max-2xl:max-w-none">{h.lyDo.cau}</span>
                  <span className="block max-w-[28rem] text-xs text-muted-foreground max-2xl:max-w-none">
                    {h.lyDo.goiY}
                    {h.lyDo.ma ? <span className="ml-1 font-mono">(mã {h.lyDo.ma})</span> : null}
                  </span>
                </td>
                <td className={TD} data-nhan="Cơ sở">
                  <span className="inline-block min-w-[8rem] max-w-[12rem] align-top max-2xl:max-w-none">
                    {h.centerTen ?? <span className="text-muted-foreground">Chưa chọn</span>}
                  </span>
                </td>
                <td className={TD} data-nhan="Tuổi">
                  {/* Thẻ (<1536px): cho xuống dòng — «Chờ phân công cách đây 39 giờ» + nhãn «Tuổi» rộng 218px+, vượt thẻ 248px ở 280px (đo: cuộn ngang trong khung). Bảng (≥1536px): một dòng. */}
                  <span className="whitespace-normal 2xl:whitespace-nowrap">
                    {h.nhanTuoi} {tuoiChu(h.tuoiMs)}
                  </span>
                </td>
                <td className={TD} data-nhan="Người xử lý">
                  <span className="inline-block max-w-[10rem] align-top max-2xl:max-w-none">
                    {h.claimedById ? (h.claimedTen ?? "(không rõ tên)") : <span className="text-muted-foreground">Chưa ai nhận</span>}
                  </span>
                </td>
                <td className={`${TD} max-2xl:mt-2 max-2xl:before:content-none`}>
                  <HanhDongNgoaiLe draftId={h.id} version={h.version} nut={h.nut} ungVien={h.ungVien} tenHoSo={ten} />
                  {h.nut.ghiChu && <p className="mt-1 max-w-[22rem] text-xs text-muted-foreground">{h.nut.ghiChu}</p>}
                  {h.loai === "ASSIGNMENT_PENDING" && h.leadId && (
                    <Link
                      href={`/leads/${h.leadId}`}
                      className="relative z-10 mt-2 inline-flex min-h-11 items-center rounded-lg px-1 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {h.leadDaCoNguoi === true ? "Xem lead" : "Mở lead để giao sale"}
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </PhanTrangBang>
  );
}
