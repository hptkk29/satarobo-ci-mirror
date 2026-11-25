// lib/finance/hoa-don/nha-cung-cap/mock-adapter.ts — adapter GIẢ cho test/UAT, mô phỏng một nhà cung cấp BẤT KỲ.
//
// Gương của cổng `gia-lap.ts` (cùng số hoá đơn/mã tra cứu tất định từ refId, cùng PDF/XML mô phỏng, cùng
// `kiemPhieu` như cổng thật) NHƯNG: (1) bộ nhớ là CỦA TỪNG THỂ HIỆN (gia-lap dùng Map cấp tiến trình ⇒ test
// chéo nhau), (2) có CHẾ ĐỘ LỖI để dựng ba kết quả và timeout. KHÔNG có giá trị pháp lý, không gọi mạng.
//
// Chế độ (BẮT BUỘC khai — không có mặc định, để test nói rõ mình đang thử cái gì):
//   THANH_CONG       cấp số, idempotent theo khoá.
//   TU_CHOI          nhà cung cấp từ chối CHẮC CHẮN (mã MOCK_TU_CHOI), không ghi gì.
//   TIMEOUT_DA_GHI   nhà cung cấp ĐÃ ghi nhận nhưng câu trả lời mất ⇒ KHONG_RO; traCuu thấy hoá đơn.
//   TIMEOUT_CHUA_GHI timeout mà nhà cung cấp CHƯA nhận gì ⇒ KHONG_RO; traCuu ra CHUA_CO.
//   LOI_XAC_THUC     đăng nhập hỏng ở mọi lời gọi (phát hành ⇒ TU_CHOI vì chưa gửi gì; tra cứu ⇒ KHONG_RO).
//
// ⚠️ Phiếu sai bị `kiemPhieu` tự chặn TRƯỚC khi áp chế độ (TU_CHOI chắc chắn) — y như cổng thật.

import { MA_TU_CHAN, kiemPhieu } from "@/lib/misa/meinvoice/anh-xa";
import type { DaPhatHanh, KetQuaPhatHanh, KetQuaTraCuu, LoaiTep, PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import { maTraCuuGiaLap, pdfMoPhong, soHoaDonGiaLap, xmlMoPhong } from "@/lib/misa/meinvoice/gia-lap";
import type { HoaDonNhaCungCap } from "./hop-dong";
import { taoBanDoNangLuc } from "./nang-luc";

export type CheDoMock = "THANH_CONG" | "TU_CHOI" | "TIMEOUT_DA_GHI" | "TIMEOUT_CHUA_GHI" | "LOI_XAC_THUC";

export type MockAdapter = HoaDonNhaCungCap & {
  /** Đổi chế độ giữa chừng (vd timeout rồi thử lại cùng khoá). */
  datCheDo(cheDo: CheDoMock): void;
  /** Số lần nhà cung cấp giả THỰC SỰ cấp số — bằng chứng "không phát hành đôi". */
  soLanCapSo(): number;
  /** Bắt buộc có: vì kiemTraKetNoi được nối. */
  kiemTraKetNoi: NonNullable<HoaDonNhaCungCap["kiemTraKetNoi"]>;
};

const GHI_CHU_MOCK = "[R] Mock: mô phỏng trong tiến trình, không có nhà cung cấp thật đứng sau.";

const BAN_DO_NANG_LUC_MOCK = taoBanDoNangLuc({
  PHAT_HANH: { providerSupports: "CO", adapterImplements: true, ghiChu: GHI_CHU_MOCK },
  TRA_CUU_THEO_KHOA: { providerSupports: "CO", adapterImplements: true, ghiChu: GHI_CHU_MOCK },
  TAI_PDF: { providerSupports: "CO", adapterImplements: true, ghiChu: GHI_CHU_MOCK },
  TAI_XML: { providerSupports: "CO", adapterImplements: true, ghiChu: GHI_CHU_MOCK },
  KIEM_TRA_KET_NOI: { providerSupports: "CO", adapterImplements: true, ghiChu: GHI_CHU_MOCK },
  LAY_PHAP_NHAN: { providerSupports: "KHONG", adapterImplements: false, ghiChu: GHI_CHU_MOCK },
  DANH_MUC_MAU_KY_HIEU: { providerSupports: "KHONG", adapterImplements: false, ghiChu: GHI_CHU_MOCK },
  TRANG_THAI_CQT: { providerSupports: "KHONG", adapterImplements: false, ghiChu: GHI_CHU_MOCK },
  GUI_EMAIL: { providerSupports: "KHONG", adapterImplements: false, ghiChu: GHI_CHU_MOCK },
  DIEU_CHINH: { providerSupports: "KHONG", adapterImplements: false, ghiChu: GHI_CHU_MOCK },
  THAY_THE: { providerSupports: "KHONG", adapterImplements: false, ghiChu: GHI_CHU_MOCK },
  HUY: { providerSupports: "KHONG", adapterImplements: false, ghiChu: GHI_CHU_MOCK },
  BAO_SAI_SOT: { providerSupports: "KHONG", adapterImplements: false, ghiChu: GHI_CHU_MOCK },
});

/** Cùng cách so khoá như MISA/gia-lap: bỏ khoảng trắng đầu cuối, không phân biệt hoa/thường. */
function khoa(refId: string): string {
  return refId.trim().toLowerCase();
}

export function taoMockAdapter(tuyChon: { cheDo: CheDoMock }): MockAdapter {
  let cheDo = tuyChon.cheDo;
  const daCap = new Map<string, DaPhatHanh>();
  /** maTraCuu → đã cấp (để taiTep từ chối mã lạ như cổng thật). */
  const maDaCap = new Set<string>();
  let soLanCap = 0;

  function cap(phieu: PhieuPhatHanh): DaPhatHanh {
    const k = khoa(phieu.refId);
    const co = daCap.get(k);
    if (co) return co;
    const moi: DaPhatHanh = {
      loai: "DA_PHAT_HANH",
      refId: phieu.refId,
      kyHieu: phieu.kyHieu.trim().toUpperCase(),
      soHoaDon: soHoaDonGiaLap(phieu.refId),
      ngayPhatHanh: phieu.ngayHoaDon,
      maTraCuu: maTraCuuGiaLap(phieu.refId),
    };
    daCap.set(k, moi);
    maDaCap.add(moi.maTraCuu);
    soLanCap++;
    return moi;
  }

  async function phatHanh(phieu: PhieuPhatHanh): Promise<KetQuaPhatHanh> {
    const loi = kiemPhieu(phieu);
    if (loi) return { loai: "TU_CHOI", ma: MA_TU_CHAN, thongDiep: loi };
    switch (cheDo) {
      case "LOI_XAC_THUC":
        return {
          loai: "TU_CHOI",
          ma: "MOCK_DANG_NHAP",
          thongDiep: "Không đăng nhập được nhà cung cấp mô phỏng — chưa gửi hoá đơn.",
        };
      case "TU_CHOI":
        return { loai: "TU_CHOI", ma: "MOCK_TU_CHOI", thongDiep: "Nhà cung cấp mô phỏng từ chối (chế độ TU_CHOI)." };
      case "TIMEOUT_DA_GHI":
        cap(phieu);
        return { loai: "KHONG_RO", thongDiep: "Nhà cung cấp mô phỏng quá thời gian không phản hồi — chưa rõ đã phát hành hay chưa, cần tra cứu." };
      case "TIMEOUT_CHUA_GHI":
        return { loai: "KHONG_RO", thongDiep: "Nhà cung cấp mô phỏng quá thời gian không phản hồi — chưa rõ đã phát hành hay chưa, cần tra cứu." };
      case "THANH_CONG":
        return cap(phieu);
    }
  }

  async function traCuu(refId: string): Promise<KetQuaTraCuu> {
    if (cheDo === "LOI_XAC_THUC") {
      return { loai: "KHONG_RO", thongDiep: "Không đăng nhập được nhà cung cấp mô phỏng để tra cứu." };
    }
    return daCap.get(khoa(refId)) ?? { loai: "CHUA_CO" };
  }

  async function taiTep(maTraCuu: string, loai: LoaiTep): Promise<Uint8Array> {
    if (cheDo === "LOI_XAC_THUC") throw new Error("Không đăng nhập được nhà cung cấp mô phỏng để tải tệp.");
    if (!maDaCap.has(maTraCuu)) throw new Error("Phản hồi tải tệp không có bản ghi mang đúng mã tra cứu.");
    return loai === "pdf" ? pdfMoPhong(maTraCuu) : xmlMoPhong(maTraCuu);
  }

  async function kiemTraKetNoi() {
    return cheDo === "LOI_XAC_THUC"
      ? { ok: false, ghiChu: "Không đăng nhập được nhà cung cấp mô phỏng." }
      : { ok: true, ghiChu: "Nhà cung cấp mô phỏng — không gọi mạng." };
  }

  return Object.freeze({
    nhaCungCap: "MOCK" as const,
    moiTruongVanHanh: "GIA_LAP" as const,
    nangLuc: BAN_DO_NANG_LUC_MOCK,
    phatHanh,
    traCuu,
    taiTep,
    kiemTraKetNoi,
    datCheDo: (c: CheDoMock) => {
      cheDo = c;
    },
    soLanCapSo: () => soLanCap,
  });
}
