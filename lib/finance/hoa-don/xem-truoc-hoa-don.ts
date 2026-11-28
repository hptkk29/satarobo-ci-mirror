import "server-only";
import type { Actor } from "@/lib/auth/actor";
import type { PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import { bamPhieuXemTruoc } from "./dau-phieu-xem-truoc";
import type { NguoiMuaHoaDon } from "./nguoi-mua";
import type { QuyetNguoiMua } from "./nguoi-mua-theo-con";
import { dungPhieuNhap, thongDiepLoiPhatHanh, type NguonPhieu } from "./phat-hanh-misa";
import { napTrangPhieuCho } from "./trang-phieu-cho";
import { laPhuongAnDuoc, type KetQuaXemTruoc, type PhuongAnKhongDuoc, type PhuongAnXemTruoc } from "./xem-truoc-kieu";

export { laPhuongAnDuoc, type KetQuaXemTruoc, type PhuongAnKhongDuoc, type PhuongAnXemTruoc };

// lib/finance/hoa-don/xem-truoc-hoa-don.ts — «XEM TRƯỚC» tờ hoá đơn (kế toán 24/11/2026): bày ĐÚNG những gì sẽ ghi vào hoá đơn, cho cả hai phương án người mua (ba/mẹ · con), để kế toán chọn rồi phát hành.
//
// Dựng bằng CHÍNH `dungPhieuNhap` (= `batDauPhatHanh` dừng trước phép ghi đầu tiên): mọi cổng nghiệp vụ chạy thật, phiếu dựng đúng cách phát hành thật, KHÔNG ghi gì (ném ⇒ rollback). Không có phép
// tính thứ hai nào ở đây — thứ người ta xem trước và thứ nhà cung cấp nhận đến từ cùng một hàm, nên không thể lệch (và `phieuDaThay` ở `batDauPhatHanh` còn so lại bằng dấu vân tay lúc bấm phát hành).
//
// Mỗi phương án dựng RIÊNG (dòng hàng «Học phí khoá … của <học viên>» khác nhau theo người mua — `tenDongHocPhi`): lựa chọn đi vào `napTrangPhieuCho` lẫn `batDauPhatHanh`.

function hienThi(chon: QuyetNguoiMua, phieu: PhieuPhatHanh, nm: NguoiMuaHoaDon): PhuongAnXemTruoc {
  return {
    chon,
    nguoiMua: {
      hoTen: nm.hoTen,
      donVi: nm.tenDonVi,
      mst: nm.maSoThue,
      diaChi: nm.diaChi,
      cccd: nm.cccd,
      email: nm.email,
      maKhachHang: nm.maKhachHang,
    },
    dong: phieu.dong.map((d) => ({ stt: d.stt, ten: d.ten, soLuong: d.soLuong, donGia: d.donGia, thanhTien: d.thanhTien, thueSuat: d.thueSuat })),
    hinhThucThanhToan: phieu.hinhThucThanhToan,
    tongThanhToan: phieu.tongThanhToan,
    dau: bamPhieuXemTruoc(phieu),
  };
}

type DauVao = {
  nguoiBam: { id: string; name: string };
  actor: Actor;
  orderId: string;
  centerId: string;
  /** Dòng loader dựng lại (không từ client): khoá lần thu, nhãn ngày thu, khoản + số ròng. */
  lanThu: { key: string; ngayThuLabel: string; khoan: readonly { id: string; soTien: number }[] };
  cheDo: Parameters<typeof dungPhieuNhap>[0]["cheDo"];
  nhaCungCap: Parameters<typeof dungPhieuNhap>[0]["nhaCungCap"];
  now: Date;
};

type MotPhuongAn = { ok: true; phieu: PhieuPhatHanh; nguoiMua: NguoiMuaHoaDon } | { ok: false; chon: QuyetNguoiMua | undefined; cau: string };

/**
 * Dựng tờ cho các phương án người mua của MỘT lần thu. Lỗi nghiệp vụ đã biết của MỘT phương án (vd con chưa có họ tên) ⇒ phương án đó `khongDuoc`, phương án kia vẫn xem được;
 * cả hai đều hỏng vì lý do chung (cổng đơn / pháp nhân) ⇒ trả `ok: false` với câu của phương án tự động. Lỗi lạ (DB, bug) ⇒ NÉM, không giả làm «cổng từ chối».
 */
export async function xemTruocHoaDon(i: DauVao): Promise<{ ok: true; data: KetQuaXemTruoc } | { ok: false; error: string }> {
  const thu = async (chon: QuyetNguoiMua | undefined): Promise<MotPhuongAn> => {
    const nap = await napTrangPhieuCho(i.actor, { orderId: i.orderId, ngayThuLabel: i.lanThu.ngayThuLabel, khoan: i.lanThu.khoan }, chon);
    if (!nap.ok) return { ok: false, chon, cau: nap.error };
    const nguon: NguonPhieu = nap;
    try {
      const d = await dungPhieuNhap({
        nguoiBam: i.nguoiBam,
        actor: i.actor,
        orderId: i.orderId,
        centerId: i.centerId,
        lanThuKey: i.lanThu.key,
        khoan: i.lanThu.khoan,
        nguon,
        cheDo: i.cheDo,
        now: i.now,
        nhaCungCap: i.nhaCungCap,
        ...(chon ? { nguoiMuaChon: chon } : {}),
      });
      return { ok: true, phieu: d.phieu, nguoiMua: d.nguoiMua };
    } catch (e) {
      const cau = thongDiepLoiPhatHanh(e);
      if (cau === null) throw e;
      return { ok: false, chon, cau };
    }
  };

  const tuDong = await thu(undefined);
  const baiLuat: QuyetNguoiMua = tuDong.ok && tuDong.nguoiMua.theoCon !== null ? "CON" : "PHU_HUYNH";
  const phuongAn = async (chon: QuyetNguoiMua): Promise<{ ket: PhuongAnXemTruoc | PhuongAnKhongDuoc; phieu: PhieuPhatHanh | null }> => {
    // Phương án trùng bên luật tự động chọn ⇒ dùng lại kết quả đã dựng (cùng đầu vào, cùng tờ), khỏi dựng hai lần.
    const r = tuDong.ok && chon === baiLuat ? tuDong : await thu(chon);
    return r.ok ? { ket: hienThi(chon, r.phieu, r.nguoiMua), phieu: r.phieu } : { ket: { chon, khongDuoc: r.cau }, phieu: null };
  };
  const phuHuynh = await phuongAn("PHU_HUYNH");
  const con = await phuongAn("CON");
  const goc = phuHuynh.phieu ?? con.phieu;
  if (!goc) return { ok: false, error: tuDong.ok ? "Không dựng được tờ hoá đơn" : tuDong.cau };
  // Luật tự động chọn một bên mà bên đó hỏng (hiếm: cổng chỉ từ chối bản chọn tay) ⇒ chọn sẵn bên còn dùng được.
  const macDinh: QuyetNguoiMua = laPhuongAnDuoc((baiLuat === "CON" ? con : phuHuynh).ket) ? baiLuat : baiLuat === "CON" ? "PHU_HUYNH" : "CON";
  return {
    ok: true,
    data: {
      // Ký hiệu / MST bán / ngày chung cho cả hai phương án — đọc từ tờ dựng được.
      kyHieu: goc.kyHieu,
      mstNguoiBan: goc.mstNguoiBan,
      ngayHoaDon: goc.ngayHoaDon.toISOString().slice(0, 10),
      macDinh,
      phuHuynh: phuHuynh.ket,
      con: con.ket,
    },
  };
}
