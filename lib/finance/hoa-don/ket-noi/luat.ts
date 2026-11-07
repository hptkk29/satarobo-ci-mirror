// lib/finance/hoa-don/ket-noi/luat.ts — LUẬT THUẦN của "Kết nối & ký" (hub/13): kiểm đầu vào khi kế toán lưu một kết nối, và QUYẾT ĐỊNH nguồn kết nối
// khi phát hành. Không DB, không env, không đồng hồ.
//
// THỨ TỰ ƯU TIÊN khi phát hành (MỘT chỗ — màn hình và phát hành cùng gọi `giaiKetNoi`, để màn không nói một đằng, cổng làm một nẻo):
//   1. Dòng ở bảng `HoaDonKetNoiNhaCungCap` của đúng (pháp nhân × môi trường):
//        · đang BẬT ⇒ dùng nó (nếu đủ thông tin và khớp phần mềm khai của pháp nhân);
//        · đang TẮT ⇒ KHÔNG rơi về biến môi trường (kế toán tắt có chủ đích — rơi về env là âm thầm đảo quyết định của họ).
//   2. Không có dòng nào ⇒ biến môi trường như trước đây (đường lùi: hệ thống chạy y hệt khi chưa ai cấu hình trên màn).
//   3. Không có gì ⇒ KHÔNG.
// MISA (04/11/2026): dòng BẬT mang ĐỦ tài khoản MISA của pháp nhân (`coTaiKhoanMisa`) ⇒ dùng tài khoản đó; dòng chỉ ghi phương thức ký (cấu hình cũ) ⇒ biến môi trường như trước.
// Các cột cũ ở `CauHinhHoaDonCoSo` (`nhaCungCapMa` · `phuongThucKy` · `khoaBiMat` · …) chỉ để HIỆN ở khu chỉ-đọc "Nhà cung cấp & ký" — phát hành
// KHÔNG đọc chúng (đo 04/11/2026: chỉ `cau-hinh-nha-cung-cap-db.ts` đọc). Đừng nối chúng vào đây mà không dọn một trong hai nguồn.

import { BIEN_MISA, kiemBaseUrl } from "@/lib/misa/meinvoice/cau-hinh";
import type { NhaCungCapApi } from "../phap-nhan";

/** Luật chống trỏ nhầm host của MISA (sandbox chỉ testapi.meinvoice.vn · production từ chối host «test» và chỉ nhận *.meinvoice.vn) — DÙNG LẠI hàm của đường env, không chép. */
function kiemBaseUrlMisa(cheDo: "sandbox" | "production", raw: string): string | null {
  const loi = kiemBaseUrl(cheDo, raw.trim());
  return loi ? loi.replaceAll(BIEN_MISA.BASE_URL, "Địa chỉ máy chủ MISA") : null;
}

export const MOI_TRUONG_KET_NOI = ["SANDBOX", "PROD"] as const;
export type MoiTruongKetNoi = (typeof MOI_TRUONG_KET_NOI)[number];
export const NHA_CUNG_CAP_KET_NOI = ["VIN_HOADON", "MISA_MEINVOICE"] as const;
export const PHUONG_THUC_KET_NOI = ["HSM_NHA_CUNG_CAP", "USB_TOKEN"] as const;
export type PhuongThucKetNoi = (typeof PHUONG_THUC_KET_NOI)[number];
export const CHE_DO_KY = ["TUNG_LENH", "LO", "NEN"] as const;
export type CheDoKy = (typeof CHE_DO_KY)[number];

/** Chế độ `NEN` (ứng dụng tự ký không cần bấm) — TẮT cho tới khi chủ dự án sửa OD-08 (hub/13 §6). */
export const CHE_DO_NEN_DA_MO = false as const;

export const TOI_THIEU_LY_DO_KET_NOI = 10;
export const TOI_DA_MAT_KHAU = 200;

const co = <T extends readonly string[]>(ds: T, v: unknown): v is T[number] => typeof v === "string" && (ds as readonly string[]).includes(v);
export const laMoiTruongKetNoi = (v: unknown): v is MoiTruongKetNoi => co(MOI_TRUONG_KET_NOI, v);
export const laNhaCungCapKetNoi = (v: unknown): v is (typeof NHA_CUNG_CAP_KET_NOI)[number] => co(NHA_CUNG_CAP_KET_NOI, v);
export const laPhuongThucKetNoi = (v: unknown): v is PhuongThucKetNoi => co(PHUONG_THUC_KET_NOI, v);
export const laCheDoKy = (v: unknown): v is CheDoKy => co(CHE_DO_KY, v);

/** Môi trường kết nối theo môi trường chạy: production thật ⇒ PROD, mọi nơi khác (test, dev, CI) ⇒ SANDBOX. Fail-closed về SANDBOX. */
export function moiTruongKetNoiTuMoiTruongChay(laProductionThat: boolean): MoiTruongKetNoi {
  return laProductionThat ? "PROD" : "SANDBOX";
}

// ─── Kiểm đầu vào khi lưu ─────────────────────────────────────────────────────────────────────────────────────────────────

export type DauVaoKetNoi = {
  phapNhanMa: string;
  moiTruong: string;
  nhaCungCapMa: string;
  dangBat: boolean;
  baseUrl: string | null;
  mst: string | null;
  tenDangNhap: string | null;
  phuongThucKy: string;
  cheDoKy: string;
  chungThuSerial: string | null;
  chungThuHetHan: string | null;
  /** MISA theo pháp nhân (04/11/2026). Tuỳ chọn để các nơi cũ không phải khai. */
  misaAppId?: string | null;
  misaLoaiHoaDon?: string | null;
  /** Mật khẩu MỚI người dùng vừa gõ; `null`/rỗng = giữ mật khẩu đang lưu. KHÔNG bao giờ được ghi vào nhật ký. */
  matKhauMoi: string | null;
  lyDo: string | null;
};

export type NguCanhKiemKetNoi = {
  /** Phần mềm API của pháp nhân (`nhaCungCapApiCuaPhapNhan`); `null` = pháp nhân chưa khai phần mềm. */
  nhaCungCapCuaPhapNhan: NhaCungCapApi | null;
  /** Dòng này đã có mật khẩu lưu trong DB chưa. */
  daCoMatKhau: boolean;
};

const MST_HOP_LE = /^\d{10}(-\d{3})?$/;
const SERIAL_HOP_LE = /^[0-9A-Fa-f]{4,64}$/;
const NGAY = /^\d{4}-\d{2}-\d{2}$/;

/** URL gốc của nhà cung cấp: https, không tài khoản nhúng, không tham số, không đoạn băm. Đường dẫn (nếu có) bỏ dấu `/` cuối. */
export function chuanHoaBaseUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || !u.hostname.includes(".")) return null;
  return `${u.origin}${u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "")}`;
}

/** Trả mảng câu tiếng Việt; rỗng = hợp lệ. Đường ghi PHẢI gọi hàm này. */
export function kiemKetNoi(d: DauVaoKetNoi, nc: NguCanhKiemKetNoi): string[] {
  const loi: string[] = [];
  if (!d.phapNhanMa.trim()) loi.push("Thiếu pháp nhân.");
  if (!laMoiTruongKetNoi(d.moiTruong)) loi.push("Môi trường phải là SANDBOX hoặc PROD.");
  if (!laNhaCungCapKetNoi(d.nhaCungCapMa)) loi.push("Nhà cung cấp không hợp lệ.");
  if (!laPhuongThucKetNoi(d.phuongThucKy)) loi.push("Phương thức ký phải là HSM của nhà cung cấp hoặc USB token.");
  if (!laCheDoKy(d.cheDoKy)) loi.push("Chế độ ký không hợp lệ.");
  if ((d.lyDo ?? "").trim().length < TOI_THIEU_LY_DO_KET_NOI) loi.push(`Lý do thay đổi phải có ít nhất ${TOI_THIEU_LY_DO_KET_NOI} ký tự.`);

  // [05/11/2026] Nhà cung cấp do Quản trị tối cao CHỌN trên dòng kết nối (MISA hoặc VIN-HOADON) — không còn bị buộc khớp `phanMem` khai trong mã (`phanMem` chỉ là mặc định cho pháp nhân chưa có dòng).
  // Các cổng của việc ĐỔI (pháp nhân phải đang tạm dừng · không còn hoá đơn đang phát hành dở / lệnh ký đang chờ · xoá tài khoản cũ) là việc của `luuKetNoi` — cần DB + khoá.
  if (d.cheDoKy === "NEN" && !CHE_DO_NEN_DA_MO) loi.push("Chế độ ký nền (tự ký không cần bấm) chưa được mở — cần chủ dự án quyết định trước.");
  if (d.phuongThucKy === "USB_TOKEN" && d.nhaCungCapMa === "MISA_MEINVOICE") loi.push("Ký USB với MISA chưa được hỗ trợ — MISA đang ký bằng HSM.");

  const matKhauMoi = d.matKhauMoi ?? "";
  if (d.nhaCungCapMa === "MISA_MEINVOICE") {
    // [04/11/2026] Tài khoản MISA THEO PHÁP NHÂN. Không khai gì ⇒ cổng rơi về biến môi trường như trước (cấu hình cũ không vỡ). Đã khai MỘT phần ⇒ đòi ĐỦ khi bật:
    // nửa vời (có tài khoản mà thiếu AppID) là cấu hình mà cổng sẽ lặng lẽ bỏ qua rồi dùng env — người khai tưởng đã chuyển.
    const appId = (d.misaAppId ?? "").trim();
    const loaiHd = (d.misaLoaiHoaDon ?? "").trim();
    const coKhai = Boolean(d.baseUrl || d.mst || d.tenDangNhap?.trim() || appId || loaiHd || matKhauMoi || nc.daCoMatKhau);
    if (appId.length > 100) loi.push("AppID MISA quá dài.");
    if (loaiHd && loaiHd !== "co-ma" && loaiHd !== "khong-ma") loi.push("Loại hoá đơn MISA phải là «có mã» hoặc «không mã».");
    if (d.baseUrl) {
      const cheDo = d.moiTruong === "PROD" ? "production" : "sandbox";
      const loiUrl = kiemBaseUrlMisa(cheDo, d.baseUrl);
      if (loiUrl) loi.push(loiUrl);
    }
    if (d.mst && !MST_HOP_LE.test(d.mst.trim())) loi.push("Mã số thuế phải gồm 10 chữ số, hoặc 10 chữ số + «-» + 3 chữ số cho chi nhánh.");
    if (matKhauMoi.length > TOI_DA_MAT_KHAU) loi.push(`Mật khẩu dài tối đa ${TOI_DA_MAT_KHAU} ký tự.`);
    if (d.dangBat && coKhai) {
      if (!d.baseUrl) loi.push("Thiếu địa chỉ máy chủ MISA.");
      if (!d.mst) loi.push("Thiếu mã số thuế.");
      if (!d.tenDangNhap?.trim()) loi.push("Thiếu tên đăng nhập MISA.");
      if (!appId) loi.push("Thiếu AppID MISA.");
      if (!loaiHd) loi.push("Thiếu loại hoá đơn MISA (có mã / không mã).");
      if (!nc.daCoMatKhau && !matKhauMoi) loi.push("Thiếu mật khẩu MISA.");
    }
  } else if (d.nhaCungCapMa === "VIN_HOADON") {
    if (d.baseUrl) {
      if (chuanHoaBaseUrl(d.baseUrl) === null) loi.push("Địa chỉ máy chủ VIN phải là địa chỉ https, không kèm tài khoản hay tham số.");
    } else if (d.dangBat) loi.push("Thiếu địa chỉ máy chủ VIN.");
    if (d.mst) {
      if (!MST_HOP_LE.test(d.mst.trim())) loi.push("Mã số thuế phải gồm 10 chữ số, hoặc 10 chữ số + «-» + 3 chữ số cho chi nhánh.");
    } else if (d.dangBat) loi.push("Thiếu mã số thuế.");
    if (!d.tenDangNhap?.trim() && d.dangBat) loi.push("Thiếu tên đăng nhập VIN.");
    if (matKhauMoi.length > TOI_DA_MAT_KHAU) loi.push(`Mật khẩu dài tối đa ${TOI_DA_MAT_KHAU} ký tự.`);
    if (d.dangBat && !nc.daCoMatKhau && !matKhauMoi) loi.push("Thiếu mật khẩu VIN.");
  }

  if (d.chungThuSerial && !SERIAL_HOP_LE.test(d.chungThuSerial.trim())) loi.push("Số serial chứng thư phải là chuỗi thập lục phân (0-9, A-F), 4–64 ký tự.");
  if (d.chungThuHetHan && !NGAY.test(d.chungThuHetHan)) loi.push("Ngày hết hạn chứng thư không hợp lệ (YYYY-MM-DD).");
  return loi;
}

// ─── Quyết định nguồn kết nối ─────────────────────────────────────────────────────────────────────────────────────────────

/** Dòng đã đọc, KHÔNG mang mật khẩu — chỉ biết có hay không. */
export type KetNoiDaDoc = {
  nhaCungCapMa: string;
  dangBat: boolean;
  phuongThucKy: string;
  cheDoKy: string;
  coMatKhau: boolean;
  baseUrl: string | null;
  mst: string | null;
  tenDangNhap: string | null;
  chungThuSerial: string | null;
  /** Hạn chứng thư (YYYY-MM-DD); tuỳ chọn để các nơi chỉ cần chọn nguồn kết nối không phải khai. */
  chungThuHetHan?: string | null;
  /** Dòng MISA mang ĐỦ tài khoản (địa chỉ · MST · tên đăng nhập · mật khẩu · AppID · loại hoá đơn). Thiếu ⇒ cổng MISA rơi về biến môi trường. */
  coTaiKhoanMisa?: boolean;
};

export type KetQuaGiaiKetNoi =
  | { nguon: "BANG"; nhaCungCap: NhaCungCapApi; phuongThucKy: "HSM" | "USB"; cheDoKy: CheDoKy }
  | { nguon: "ENV"; nhaCungCap: NhaCungCapApi; phuongThucKy: "HSM"; cheDoKy: "LO" }
  | { nguon: "KHONG"; lyDo: string };

export function giaiKetNoi(a: {
  hang: KetNoiDaDoc | null;
  nhaCungCapCuaPhapNhan: NhaCungCapApi | null;
  /** Biến môi trường của nhà cung cấp của pháp nhân đã đủ để dựng cổng. */
  envCoCong: boolean;
}): KetQuaGiaiKetNoi {
  const ncc = a.nhaCungCapCuaPhapNhan;
  if (ncc === null) return { nguon: "KHONG", lyDo: "Pháp nhân chưa khai phần mềm phát hành." };
  const h = a.hang;
  if (h === null) {
    return a.envCoCong ? { nguon: "ENV", nhaCungCap: ncc, phuongThucKy: "HSM", cheDoKy: "LO" } : { nguon: "KHONG", lyDo: "Chưa cấu hình kết nối." };
  }
  if (!h.dangBat) return { nguon: "KHONG", lyDo: "Kết nối đang tắt." };
  if (h.nhaCungCapMa !== ncc) return { nguon: "KHONG", lyDo: "Kết nối đã lưu không khớp phần mềm phát hành của pháp nhân." };
  const phuongThucKy = h.phuongThucKy === "USB_TOKEN" ? "USB" : "HSM";
  // NEN đang đóng (OD-08): dòng lỡ mang NEN ở DB cũng chạy như LO — chế độ tự ký không cần bấm không bao giờ bật âm thầm.
  const cheDoKy: CheDoKy = laCheDoKy(h.cheDoKy) && (h.cheDoKy !== "NEN" || CHE_DO_NEN_DA_MO) ? h.cheDoKy : "LO";
  if (ncc === "MISA_MEINVOICE") {
    if (phuongThucKy === "USB") return { nguon: "KHONG", lyDo: "Ký USB với MISA chưa được hỗ trợ." };
    // Dòng mang ĐỦ tài khoản MISA ⇒ dùng tài khoản của pháp nhân này (không cần env). Dòng chỉ ghi phương thức ký ⇒ env như trước.
    if (h.coTaiKhoanMisa === true) return { nguon: "BANG", nhaCungCap: ncc, phuongThucKy, cheDoKy };
    return a.envCoCong ? { nguon: "BANG", nhaCungCap: ncc, phuongThucKy, cheDoKy } : { nguon: "KHONG", lyDo: "Chưa cấu hình tài khoản MISA trên máy chủ." };
  }
  if (!h.baseUrl || !h.mst || !h.tenDangNhap || !h.coMatKhau) return { nguon: "KHONG", lyDo: "Kết nối VIN chưa đủ thông tin (địa chỉ, MST, tài khoản, mật khẩu)." };
  return { nguon: "BANG", nhaCungCap: ncc, phuongThucKy, cheDoKy };
}

/**
 * Cổng phát hành HSM (một lời gọi gửi + ký) có được dùng cho kết quả này không. USB token KHÔNG BAO GIỜ đi đường này: hoá đơn của pháp nhân
 * ký USB phải qua lệnh ký (lưu nháp → ký ở máy kế toán → gửi XML đã ký). MỘT vị từ cho cổng, hai cron và action.
 */
export function duocDungDuongHsm(k: KetQuaGiaiKetNoi): boolean {
  return k.nguon !== "KHONG" && k.phuongThucKy === "HSM";
}
