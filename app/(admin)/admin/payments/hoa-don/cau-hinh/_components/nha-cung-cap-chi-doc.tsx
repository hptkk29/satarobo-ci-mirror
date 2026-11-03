// Khu "Nhà cung cấp & ký (chỉ đọc)" của trang Cấu hình (S7, Invoice Hub). CHỈ HIỂN THỊ các CỘT NHẠY CẢM của `CauHinhHoaDonCoSo` (nhà cung cấp · môi trường ·
// loại hoá đơn · phương thức ký · khoá bí mật · chứng thư · chế độ Hub · khoá pháp lý).
//
// ⚠️ Đổi các cột này là đổi AI đứng tên hoá đơn, gửi TỚI ĐÂU, bằng credential NÀO (04 §2.8): cần action riêng của kế toán Hội sở + duyệt hai người —
//    CHƯA có. Vì vậy ở đây KHÔNG có nút, ô nhập hay form nào (luật 12: không vẽ thứ không làm được). Server component thuần: không state, không action.
// ⚠️ `khoaBiMat` là TÊN KHOÁ trong mã (không phải giá trị bí mật) — vẫn chỉ hiện tên.

import { InfoTip } from "@/components/admin/ui/help-hint";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { huongDan } from "@/lib/finance/hoa-don/huong-dan";
import { NHAN_CHE_DO, type CheDoHub } from "@/lib/finance/hoa-don/chinh-sach-phien-ban";
import type { CauHinhNhaCungCapChiDoc } from "@/lib/finance/hoa-don/cau-hinh-nha-cung-cap-db";
import { ddmmyyyy } from "./chinh-sach-nhap";

const NHA_CUNG_CAP: Record<string, string> = { MISA_MEINVOICE: "MISA meInvoice", VIN_HOADON: "VIN-HOADON", VIETTEL_SINVOICE: "Viettel S-Invoice", THU_CONG: "Làm tay" };
const MOI_TRUONG: Record<string, string> = { sandbox: "Thử nghiệm (sandbox)", production: "Thật (production)", "gia-lap": "Giả lập" };
const LOAI_HOA_DON: Record<string, string> = { CO_MA: "Có mã của cơ quan thuế", KHONG_MA: "Không mã" };
const PHUONG_THUC_KY: Record<string, string> = { HSM: "HSM — ký tại nhà cung cấp", USB: "USB token", TU_XA: "Ký từ xa", THU_CONG: "Làm tay" };

const hien = (bang: Record<string, string>, v: string | null): string => (v === null ? "Chưa khai" : (bang[v] ?? v));
/** `NULL` ≡ TAT (04 §2.8). */
export const nhanCheDoHub = (v: string | null): string => NHAN_CHE_DO[(v ?? "TAT") as CheDoHub] ?? (v as string);

export function NhaCungCapChiDoc({ tenCoSo, dong, tenPhapNhan }: { tenCoSo: string; dong: readonly CauHinhNhaCungCapChiDoc[]; tenPhapNhan: Readonly<Record<string, string>> }) {
  return (
    <section aria-labelledby="ncc-tieu-de" className="flex flex-col gap-3">
      <div>
        <h2 id="ncc-tieu-de" className="flex items-center gap-1 text-base font-semibold">
          Nhà cung cấp &amp; ký
          <StatusPill tone="muted">Chỉ đọc</StatusPill>
          <InfoTip label="Xem hướng dẫn về mục chỉ đọc">{huongDan("cau-hinh-chi-doc")}</InfoTip>
        </h2>
        <p className="text-sm text-muted-foreground">
          Cấu hình phát hành của <span className="font-medium text-foreground">{tenCoSo}</span>. Muốn đổi, báo quản trị: thay đổi ở đây cần kế toán Hội sở soạn và một người khác duyệt (chưa có trên giao diện).
        </p>
      </div>
      {dong.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-sm text-muted-foreground">Cơ sở này chưa có dòng cấu hình nào ở khu “Pháp nhân &amp; ký hiệu” phía trên, nên chưa có gì để hiển thị.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[56rem] text-sm">
            <caption className="sr-only">Cấu hình nhà cung cấp và ký của cơ sở</caption>
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">Ký hiệu · hiệu lực<InfoTip label="Xem hướng dẫn về ký hiệu">{huongDan("ky-hieu")}</InfoTip></span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">Pháp nhân<InfoTip label="Xem hướng dẫn về pháp nhân">{huongDan("phap-nhan")}</InfoTip></span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">Nhà cung cấp<InfoTip label="Xem hướng dẫn về nhà cung cấp">{huongDan("nha-cung-cap")}</InfoTip></span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">Môi trường<InfoTip label="Xem hướng dẫn về môi trường">{huongDan("moi-truong-nha-cung-cap")}</InfoTip></span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">Loại hoá đơn</th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">Cách ký<InfoTip label="Xem hướng dẫn về cách ký">{huongDan("phuong-thuc-ky")}</InfoTip></span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">Khoá bí mật</th>
                <th scope="col" className="px-3 py-2 font-medium">Chứng thư hết hạn</th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">Mức Hub<InfoTip label="Xem hướng dẫn về mức Hub">{huongDan("che-do-hub")}</InfoTip></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {dong.map((d) => (
                <tr key={d.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <div className="font-mono tabular-nums">{d.kyHieu}</div>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {ddmmyyyy(d.hieuLucTu)} → {ddmmyyyy(d.hieuLucDen)} · {d.dangBat ? "đang bật" : "đã tắt"}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{tenPhapNhan[d.phapNhanMa] ?? d.phapNhanMa}</div>
                    <div className="text-xs text-muted-foreground">{d.legalEntityId ? "Đã gắn pháp nhân trong Cây tổ chức" : "Chưa gắn pháp nhân trong Cây tổ chức"}</div>
                  </td>
                  <td className="px-3 py-2">{hien(NHA_CUNG_CAP, d.nhaCungCapMa)}</td>
                  <td className="px-3 py-2">{hien(MOI_TRUONG, d.moiTruongNcc)}</td>
                  <td className="px-3 py-2">{hien(LOAI_HOA_DON, d.loaiHoaDon)}</td>
                  <td className="px-3 py-2">{hien(PHUONG_THUC_KY, d.phuongThucKy)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{d.khoaBiMat ?? "Chưa khai"}</td>
                  <td className="px-3 py-2 tabular-nums">{d.chungThuHetHan ? ddmmyyyy(d.chungThuHetHan) : "Chưa khai"}</td>
                  <td className="px-3 py-2">{nhanCheDoHub(d.cheDoHub)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
