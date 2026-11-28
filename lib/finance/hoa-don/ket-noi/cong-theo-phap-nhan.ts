import "server-only";
import type { CongHoaDon, KetQuaPhatHanh, PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import { taoCongHsm } from "@/lib/misa/meinvoice/http";
import { laProductionThat } from "@/lib/security/client-ip";
import { taoCongVin, type CongVin, type FetchLike } from "@/lib/vin-hoadon/http";
import { cauHinhHoaDonChoMoiTruong } from "../phap-nhan-theo-moi-truong";
import { nhaCungCapHieuLuc, TEN_NHA_CUNG_CAP_API, type NhaCungCapApi } from "../phap-nhan";
import { layCongHoaDon } from "../cong-phat-hanh";
import { CAU_TAM_DUNG_KY, kyDangTamDung } from "../ky-chinh-sach/ky-chinh-sach-db";
import { db } from "@/lib/db";
import { docTaiKhoanKetNoi, type TaiKhoanKetNoi } from "./ket-noi-db";
import { duocDungDuongHsm, giaiKetNoi, moiTruongKetNoiTuMoiTruongChay, type CheDoKy, type KetQuaGiaiKetNoi } from "./luat";

// lib/finance/hoa-don/ket-noi/cong-theo-phap-nhan.ts — LẤY cổng phát hành theo (PHÁP NHÂN × môi trường), đọc cấu hình kế toán tự khai ở bảng
// `HoaDonKetNoiNhaCungCap`, rơi về biến môi trường khi chưa có dòng nào (xem thứ tự ưu tiên ở `luat.ts`).
//
// ADDITIVE: `layCongHoaDon(ncc)` (đồng bộ, theo env) VẪN là chỗ trả lời "nhà cung cấp này có cấu hình sẵn sàng không" cho nút trên màn. Hàm ở đây
// là chỗ trả lời "pháp nhân này, lúc GỬI, dùng tài khoản nào" — mọi đường THẬT SỰ gọi cổng (3 action, 2 cron) đi qua đây.
//
// ⚠️ PHÁP NHÂN KÝ USB KHÔNG BAO GIỜ nhận được cổng HSM từ `layCongHsmChoPhapNhan`: gọi `phatHanh` trên VIN sẽ ký bằng HSM của tài khoản VIN (nếu có) —
//    trái ý "ký bằng USB của kế toán" và gửi hoá đơn ra ngoài mà không ai bấm. Đường USB là `layCongUsbChoPhapNhan` + lệnh ký.
// ⚠️ `muc` BẮT BUỘC (luật 7 — để `tsc` liệt kê mọi chỗ gọi): «GUI» = việc có thể đưa hoá đơn / chữ ký ra ngoài → bị chặn khi pháp nhân TẠM DỪNG KÝ;
//    «TRA_CUU» = chỉ hỏi nhà cung cấp kết quả của thứ ĐÃ gửi (đối soát, kiểm tra lại USB) → KHÔNG bị chặn, để biết hoá đơn đã gửi trước lúc dừng nay ra sao.
// ⚠️ Cổng lấy từ BẢNG được bọc `rangBuocMst`: phiếu có MST người bán khác MST của dòng cấu hình ⇒ KHÔNG gửi (tài khoản của pháp nhân này không phát hành cho MST khác).

export type MucCong = "GUI" | "TRA_CUU";
/**
 * `nhaCungCap` = nhà cung cấp của CỔNG VỪA TRẢ (đã qua luật «dòng kết nối thắng mặc định trong mã»). BẮT BUỘC (luật 7): người gọi phải đối chiếu / ghi nó lên hoá đơn thay vì tự suy lại
 * từ `phanMem` — suy lại chính là lỗi «ghi hoá đơn MISA trong khi đã gửi qua VIN» khi pháp nhân đã đổi nhà cung cấp.
 */
export type KetQuaCongHsm = { ok: true; cong: CongHoaDon; nguon: "BANG" | "ENV"; nhaCungCap: NhaCungCapApi } | { ok: false; lyDo: string; usb: boolean; tamDung?: true; nhaCungCap?: NhaCungCapApi };
export type KetQuaCongUsb = { ok: true; cong: CongVin; cheDoKy: CheDoKy; mst: string } | { ok: false; lyDo: string; tamDung?: true };

type Env = Record<string, string | undefined>;
type TuyChon = { env?: Env; fetchImpl?: FetchLike };

const LOI_KHOA: Record<"KHOA_THIEU" | "KHONG_GIAI_MA_DUOC" | "CAU_HINH_SAI", string> = {
  KHOA_THIEU: "Máy chủ chưa đặt khoá mã hoá bí mật (HOA_DON_KHOA_BI_MAT) nên chưa dùng được mật khẩu đã lưu.",
  KHONG_GIAI_MA_DUOC: "Không giải mã được mật khẩu đã lưu (khoá mã hoá đã đổi?) — nhập lại mật khẩu ở «Kết nối & ký».",
  CAU_HINH_SAI: "Địa chỉ máy chủ đã lưu không qua được luật chống trỏ nhầm (sai môi trường hoặc không phải máy chủ của nhà cung cấp) — sửa ở «Kết nối & ký».",
};

/** Biến môi trường của nhà cung cấp này đã đủ để dựng cổng chưa (đường lùi). Màn «Kết nối & ký» hỏi để tính trạng thái bằng CHÍNH `giaiKetNoi` mà phát hành dùng. */
export const envCoCongChoNhaCungCap = (ncc: NhaCungCapApi): boolean => layCongHoaDon(ncc) !== null;

/** Kết quả CHỌN nguồn kết nối của pháp nhân (không giải mã mật khẩu để dựng cổng). Dùng khi chỉ cần biết «cấu hình đang nói gì». */
export async function giaiKetNoiChoPhapNhan(phapNhanMa: string, tc: TuyChon = {}): Promise<KetQuaGiaiKetNoi> {
  return (await giai(phapNhanMa, tc)).ketQua;
}

async function giai(phapNhanMa: string, tc: TuyChon) {
  const phapNhan = cauHinhHoaDonChoMoiTruong().phapNhan.find((p) => p.ma === phapNhanMa && p.bat) ?? null;
  const moiTruong = moiTruongKetNoiTuMoiTruongChay(laProductionThat(tc.env ?? process.env));
  const tk = await docTaiKhoanKetNoi(phapNhanMa, moiTruong, tc.env);
  // [05/11/2026] Nhà cung cấp = của DÒNG đã lưu nếu có, không thì mặc định trong mã. Pháp nhân không tồn tại / đang tắt ⇒ `null` (không đoán).
  const ncc: NhaCungCapApi | null = phapNhan ? nhaCungCapHieuLuc(phapNhan, tk.hang?.nhaCungCapMa) : null;
  const congEnv = ncc ? layCongHoaDon(ncc) : null;
  const ketQua: KetQuaGiaiKetNoi = giaiKetNoi({ hang: tk.hang, nhaCungCapCuaPhapNhan: ncc, envCoCong: congEnv !== null });
  return { ncc, tk, congEnv, ketQua };
}

function lyDoKhongDung(ncc: NhaCungCapApi | null, lyDo: string, loiKhoa: TaiKhoanKetNoi["loi"]): string {
  const ten = ncc ? TEN_NHA_CUNG_CAP_API[ncc] : "nhà cung cấp";
  return loiKhoa ? `${LOI_KHOA[loiKhoa]}` : `${lyDo} (${ten}) — báo kế toán Hội sở vào «Kết nối & ký».`;
}

const TU_CHOI_SAI_MST = { loai: "TU_CHOI" as const, ma: "SAI_MST_CAU_HINH", thongDiep: "MST người bán trên hoá đơn không khớp MST của tài khoản đã cấu hình cho pháp nhân này — chưa gửi gì. Kiểm lại «Kết nối & ký»." };

/**
 * Bọc cổng lấy từ BẢNG: mọi lời gọi GỬI mang phiếu có `mstNguoiBan` ≠ MST của dòng cấu hình ⇒ TU_CHOI **trước khi** chạm nhà cung cấp (chưa gửi gì ⇒ an toàn để sửa rồi phát hành lại).
 * Chỉ bọc đường GỬI; tra cứu / tải tệp giữ nguyên.
 */
export function rangBuocMst<T extends CongHoaDon>(cong: T, mst: string): T {
  const khop = (phieu: { mstNguoiBan: string }) => phieu.mstNguoiBan.trim() === mst.trim();
  const boc = { ...cong, phatHanh: async (phieu: PhieuPhatHanh): Promise<KetQuaPhatHanh> => (khop(phieu) ? cong.phatHanh(phieu) : TU_CHOI_SAI_MST) };
  const vin = cong as unknown as Partial<CongVin>;
  if (vin.kyUsb) {
    const ky = vin.kyUsb;
    const kyBoc: CongVin["kyUsb"] = {
      ...ky,
      luuNhap: async (phieu) => (khop(phieu) ? ky.luuNhap(phieu) : TU_CHOI_SAI_MST),
      guiXmlDaKy: async (a) => (khop(a.phieu) ? ky.guiXmlDaKy(a) : TU_CHOI_SAI_MST),
    };
    return { ...boc, kyUsb: kyBoc } as T;
  }
  return boc as T;
}

/** Pháp nhân đang bị tạm dừng ký thì việc GỬI dừng NGAY — trước cả việc đọc cấu hình. */
async function chanNeuTamDung(phapNhanMa: string, muc: MucCong): Promise<string | null> {
  if (muc !== "GUI") return null;
  const t = await kyDangTamDung(phapNhanMa);
  return t.tamDung ? CAU_TAM_DUNG_KY : null;
}

/** Cổng PHÁT HÀNH HSM (một lời gọi gửi + ký) của pháp nhân. USB ⇒ `ok: false, usb: true`. Tạm dừng + `GUI` ⇒ `ok: false, tamDung: true`. */
export async function layCongHsmChoPhapNhan(phapNhanMa: string, muc: MucCong, tc: TuyChon = {}): Promise<KetQuaCongHsm> {
  const dung = await chanNeuTamDung(phapNhanMa, muc);
  if (dung) return { ok: false, usb: false, tamDung: true, lyDo: dung };
  const { ncc, tk, congEnv, ketQua } = await giai(phapNhanMa, tc);
  if (ketQua.nguon === "KHONG") return { ok: false, usb: false, lyDo: lyDoKhongDung(ncc, ketQua.lyDo, tk.loi) };
  if (!duocDungDuongHsm(ketQua)) {
    return { ok: false, usb: true, nhaCungCap: ketQua.nhaCungCap, lyDo: "Pháp nhân này ký bằng USB token — hoá đơn không phát hành tự động mà chờ kế toán ký (hàng chờ ký)." };
  }
  if (ketQua.nguon === "ENV") return congEnv ? { ok: true, cong: congEnv, nguon: "ENV", nhaCungCap: ketQua.nhaCungCap } : { ok: false, usb: false, lyDo: lyDoKhongDung(ncc, "Chưa cấu hình kết nối", null) };
  // BANG + HSM
  if (ketQua.nhaCungCap === "MISA_MEINVOICE") {
    // Dòng mang ĐỦ tài khoản MISA của pháp nhân ⇒ cổng dựng từ dòng đó (đã qua luật host); dòng chỉ ghi phương thức ký (cấu hình cũ) ⇒ cổng env như trước.
    if (tk.hang?.coTaiKhoanMisa === true) {
      if (!tk.cauHinhMisa || !tk.mst) return { ok: false, usb: false, lyDo: lyDoKhongDung(ncc, "Kết nối MISA chưa dùng được", tk.loi) };
      return { ok: true, cong: rangBuocMst(taoCongHsm({ cauHinh: tk.cauHinhMisa, fetchImpl: tc.fetchImpl ?? ((i, init) => fetch(i, init)) }), tk.mst), nguon: "BANG", nhaCungCap: ketQua.nhaCungCap };
    }
    return congEnv ? { ok: true, cong: congEnv, nguon: "BANG", nhaCungCap: ketQua.nhaCungCap } : { ok: false, usb: false, lyDo: lyDoKhongDung(ncc, "Chưa cấu hình tài khoản MISA", null) };
  }
  if (!tk.cauHinhVin || !tk.mst) return { ok: false, usb: false, lyDo: lyDoKhongDung(ncc, "Kết nối VIN chưa dùng được", tk.loi) };
  return { ok: true, cong: rangBuocMst(taoCongVin({ cauHinh: tk.cauHinhVin, fetchImpl: tc.fetchImpl ?? ((i, init) => fetch(i, init)) }), tk.mst), nguon: "BANG", nhaCungCap: ketQua.nhaCungCap };
}

/** Cổng VIN cho đường KÝ USB (lưu nháp · tải XML · gửi XML đã ký). Chỉ khi dòng BẬT, VIN, phương thức USB, đủ thông tin. */
export async function layCongUsbChoPhapNhan(phapNhanMa: string, muc: MucCong, tc: TuyChon = {}): Promise<KetQuaCongUsb> {
  const dung = await chanNeuTamDung(phapNhanMa, muc);
  if (dung) return { ok: false, tamDung: true, lyDo: dung };
  const { ncc, tk, ketQua } = await giai(phapNhanMa, tc);
  if (ketQua.nguon !== "BANG" || ketQua.phuongThucKy !== "USB" || ketQua.nhaCungCap !== "VIN_HOADON") {
    return { ok: false, lyDo: ketQua.nguon === "KHONG" ? lyDoKhongDung(ncc, ketQua.lyDo, tk.loi) : "Pháp nhân này không cấu hình ký bằng USB token." };
  }
  if (!tk.cauHinhVin || !tk.mst) return { ok: false, lyDo: lyDoKhongDung(ncc, "Kết nối VIN chưa dùng được", tk.loi) };
  return { ok: true, cong: rangBuocMst(taoCongVin({ cauHinh: tk.cauHinhVin, fetchImpl: tc.fetchImpl ?? ((i, init) => fetch(i, init)) }), tk.mst), cheDoKy: ketQua.cheDoKy, mst: tk.mst };
}

/**
 * [08/11/2026] Cổng VIN cho «Gửi NHÁP lên VIN» (lưu nháp, KHÔNG ký): dùng được cho cả pháp nhân ký HSM lẫn USB — nháp không ký nên không phụ thuộc cách ký, và HSM chưa kích hoạt vẫn thử được.
 * Chỉ khi dòng kết nối BẬT, nhà cung cấp là VIN-HOADON, đủ thông tin; pháp nhân đang TẠM DỪNG ký thì không (cùng luật «mọi đường GỬI»). Môi trường chạy quyết dòng PROD/SANDBOX như mọi cổng khác.
 */
export async function layCongNhapVinChoPhapNhan(phapNhanMa: string, tc: TuyChon = {}): Promise<{ ok: true; cong: CongVin; mst: string } | { ok: false; lyDo: string; tamDung?: true }> {
  const dung = await chanNeuTamDung(phapNhanMa, "GUI");
  if (dung) return { ok: false, tamDung: true, lyDo: dung };
  const { ncc, tk, ketQua } = await giai(phapNhanMa, tc);
  if (ketQua.nguon !== "BANG" || ketQua.nhaCungCap !== "VIN_HOADON") {
    return { ok: false, lyDo: ketQua.nguon === "KHONG" ? lyDoKhongDung(ncc, ketQua.lyDo, tk.loi) : "Gửi nháp chỉ dùng được với pháp nhân có nhà cung cấp hỗ trợ gửi nháp và đã khai kết nối ở «Kết nối & ký»." };
  }
  if (!tk.cauHinhVin || !tk.mst) return { ok: false, lyDo: lyDoKhongDung(ncc, "Kết nối VIN chưa dùng được", tk.loi) };
  return { ok: true, cong: rangBuocMst(taoCongVin({ cauHinh: tk.cauHinhVin, fetchImpl: tc.fetchImpl ?? ((i, init) => fetch(i, init)) }), tk.mst), mst: tk.mst };
}

/**
 * Cho NÚT trên màn: nhà cung cấp này có SẴN SÀNG phát hành HSM không, và ở môi trường nào — biến môi trường đủ, HOẶC có ít nhất một kết nối HSM bật đủ thông
 * tin trong bảng. `null` = không sẵn sàng. Chỉ là điều kiện HIỆN nút (cấp nhà cung cấp); lúc gửi vẫn hỏi lại đúng pháp nhân qua `layCongHsmChoPhapNhan` (fail-closed).
 */
export async function moiTruongSanSangHsm(ncc: NhaCungCapApi, tc: TuyChon = {}): Promise<CongHoaDon["moiTruong"] | null> {
  const env = layCongHoaDon(ncc);
  if (env) return env.moiTruong;
  const moiTruong = moiTruongKetNoiTuMoiTruongChay(laProductionThat(tc.env ?? process.env));
  const n = await db.hoaDonKetNoiNhaCungCap.count({
    where: {
      nhaCungCapMa: ncc,
      moiTruong,
      dangBat: true,
      phuongThucKy: "HSM_NHA_CUNG_CAP",
      matKhauMaHoa: { not: null },
      baseUrl: { not: null },
      mst: { not: null },
      tenDangNhap: { not: null },
      // MISA cần thêm AppID + loại hoá đơn để dòng đứng được một mình; dòng MISA chỉ ghi phương thức ký KHÔNG làm MISA «sẵn sàng».
      ...(ncc === "MISA_MEINVOICE" ? { misaAppId: { not: null }, misaLoaiHoaDon: { not: null } } : {}),
    },
  });
  return n > 0 ? (moiTruong === "PROD" ? "production" : "sandbox") : null;
}
