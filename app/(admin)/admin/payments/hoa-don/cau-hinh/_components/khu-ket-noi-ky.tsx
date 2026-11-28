import type { Actor } from "@/lib/auth/actor";
import { envCoCongChoNhaCungCap } from "@/lib/finance/hoa-don/ket-noi/cong-theo-phap-nhan";
import { canhBaoChungThu, nhanKetQuaKiemTra, tomTatTrangThai } from "@/lib/finance/hoa-don/ket-noi/hien-thi";
import { docCacKetNoi, docLichSuKetNoi, laKeToanHoiSo, type DongKetNoi } from "@/lib/finance/hoa-don/ket-noi/ket-noi-db";
import { docKhoaBiMat } from "@/lib/finance/hoa-don/ket-noi/khoa-bi-mat";
import { giaiKetNoi, moiTruongKetNoiTuMoiTruongChay, type KetNoiDaDoc } from "@/lib/finance/hoa-don/ket-noi/luat";
import { nhaCungCapHieuLuc, TEN_NHA_CUNG_CAP_API } from "@/lib/finance/hoa-don/phap-nhan";
import { cauHinhHoaDonChoMoiTruong } from "@/lib/finance/hoa-don/phap-nhan-theo-moi-truong";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { laProductionThat } from "@/lib/security/client-ip";
import { KetNoiKy, type TheKetNoi } from "./ket-noi-ky";

/**
 * Khu «Kết nối & ký» (hub/13) — kế toán Hội sở XEM; CHỈ Quản trị tối cao THAY ĐỔI (`duocSua`, BGĐ 04/11/2026). Trạng thái «đang dùng gì» tính bằng CHÍNH `giaiKetNoi` mà đường phát hành dùng
 * (màn không thể nói một đằng, cổng làm một nẻo). Không bao giờ nạp mật khẩu hay chuỗi mã hoá (`docCacKetNoi` không select chúng).
 *
 * 05/11/2026 — CHỈ hiện pháp nhân của cơ sở đang chọn (`phapNhanMa`, suy từ Cây tổ chức theo MST). BẮT BUỘC (luật 7): để tuỳ chọn thì quên truyền = lặng lẽ
 * quay về hiện cả ba pháp nhân. Kết nối vẫn là dữ liệu cấp PHÁP NHÂN (một pháp nhân có thể phục vụ nhiều cơ sở) — đây chỉ là bộ lọc hiển thị.
 */
export async function KhuKetNoiKy({ actor, phapNhanMa }: { actor: Actor; phapNhanMa: string }) {
  if (!laKeToanHoiSo(actor)) return null;
  const moiTruong = moiTruongKetNoiTuMoiTruongChay(laProductionThat());
  const homNay = ngayVN(new Date());
  const [cacKetNoi, khoa] = await Promise.all([docCacKetNoi(actor), Promise.resolve(docKhoaBiMat())]);
  const hangTheoPn = new Map<string, DongKetNoi>(
    cacKetNoi.filter((k) => k.moiTruong === moiTruong && k.phapNhanMa === phapNhanMa).map((k) => [k.phapNhanMa, k]),
  );
  const lichSu = await docLichSuKetNoi(actor, [...hangTheoPn.values()].map((k) => k.id));

  const the: TheKetNoi[] = cauHinhHoaDonChoMoiTruong()
    .phapNhan.filter((p) => p.bat && p.ma === phapNhanMa)
    .map((p) => {
      const dong = hangTheoPn.get(p.ma) ?? null;
      // [05/11/2026] Dòng đã lưu thắng mặc định trong mã — cùng hàm với cổng phát hành.
      const ncc = nhaCungCapHieuLuc(p, dong?.nhaCungCapMa);
      const hang: KetNoiDaDoc | null = dong
        ? {
            nhaCungCapMa: dong.nhaCungCapMa,
            dangBat: dong.dangBat,
            phuongThucKy: dong.phuongThucKy,
            cheDoKy: dong.cheDoKy,
            coMatKhau: dong.coMatKhau,
            baseUrl: dong.baseUrl,
            mst: dong.mst,
            tenDangNhap: dong.tenDangNhap,
            chungThuSerial: dong.chungThuSerial,
            coTaiKhoanMisa: dong.nhaCungCapMa === "MISA_MEINVOICE" && dong.coMatKhau && !!dong.baseUrl && !!dong.mst && !!dong.tenDangNhap && !!dong.misaAppId && !!dong.misaLoaiHoaDon,
          }
        : null;
      const giai = giaiKetNoi({ hang, nhaCungCapCuaPhapNhan: ncc, envCoCong: ncc ? envCoCongChoNhaCungCap(ncc) : false });
      return {
        phapNhanMa: p.ma,
        ten: p.ten,
        maSoThue: p.maSoThue,
        nhaCungCapMa: ncc,
        tenNhaCungCap: ncc ? TEN_NHA_CUNG_CAP_API[ncc] : null,
        trangThai: tomTatTrangThai(giai),
        ketNoi: dong,
        canhBaoChungThu: canhBaoChungThu(dong?.chungThuHetHan ?? null, homNay),
        ketQuaKiemTra: nhanKetQuaKiemTra(dong?.kiemTraKetQua ?? null),
      };
    });

  return <KetNoiKy the={the} moiTruong={moiTruong} khoaOk={khoa.ok} lyDoThieuKhoa={khoa.ok ? null : khoa.lyDo} lichSu={lichSu} duocSua={actor.isSuperAdmin} />;
}
