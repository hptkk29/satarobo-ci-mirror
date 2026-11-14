// lib/finance/hoa-don/feature.ts — NƠI DUY NHẤT ĐỌC CÔNG TẮC màn kế toán Hoá đơn điện tử.
//
// Chép khuôn `lib/finance/feature.ts` (công tắc thu học phí linh hoạt): cờ nằm trong DB
// (`SystemSetting`), người vận hành bật được, thấy được, `AuditLog` ghi ai bật lúc nào. Lưới
// `[HDF-02]` đếm số chỗ nhắc chuỗi khoá ngoài tệp này = 0 — rải `getSetting(...)` khắp nơi là mỗi
// chỗ tự quyết nghĩa của "bật", và tắt cờ sẽ tắt được 9 chỗ trong 10.
//
// ⚠️ Cờ chỉ gác MÀN HÌNH + route tải tệp + việc gửi email. Các cổng chặn trong sổ tiền (khoản đã
// có hoá đơn thì không từ chối / tách được — docs/ke-toan-hoa-don/PLAN.md §5) LUÔN chạy, KHÔNG
// hỏi hàm này: tắt cờ mà mở lại được `rejectPayment` trên khoản đã xuất hoá đơn là lỗ.

import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";

export const KHOA_HOA_DON = "billing.hoaDonEnabled" as const;

/** Màn Hoá đơn điện tử có đang bật không (toàn hệ — không có công tắc theo cơ sở). */
export async function laHoaDonBat(): Promise<boolean> {
  return await getSetting(KHOA_HOA_DON);
}

/** Bước 1 MISA (30/09) — công tắc nút "Phát hành qua MISA". Cùng khuôn: trong DB, mặc định TẮT, đọc ở đây. */
export const KHOA_MISA_PHAT_HANH = "hoaDon.misaPhatHanh" as const;

/**
 * Nút "Phát hành qua MISA" có được bật không — CẢ HAI công tắc: màn Hoá đơn điện tử + phát hành qua MISA.
 * (Cổng MISA có cấu hình không là câu hỏi riêng — `layCongHoaDon()`.) Tắt màn thì công tắc con vô nghĩa.
 */
export async function laMisaPhatHanhBat(): Promise<boolean> {
  const [man, misa] = await Promise.all([getSetting(KHOA_HOA_DON), getSetting(KHOA_MISA_PHAT_HANH)]);
  return man && misa;
}

/** Invoice Hub S7 (01/11/2026) — công tắc khu "Chính sách hoá đơn có phiên bản". Cùng khuôn: trong DB, mặc định TẮT, đọc ở đây. */
export const KHOA_HUB_CHINH_SACH = "hoaDon.hubChinhSach" as const;

/** Khu Chính sách hoá đơn (và action ghi của nó) có được bật không — CẢ màn Hoá đơn điện tử LẪN công tắc con. Tắt màn thì công tắc con vô nghĩa. */
export async function laHubChinhSachBat(): Promise<boolean> {
  const [man, hub] = await Promise.all([getSetting(KHOA_HOA_DON), getSetting(KHOA_HUB_CHINH_SACH)]);
  return man && hub;
}

/** Invoice Hub S8 (01/11/2026) — công tắc SCANNER bóng (pha P2 của cron `hoa-don-misa-doi-soat`). Cùng khuôn: trong DB, mặc định TẮT, đọc ở đây. */
export const KHOA_HUB_QUET = "hoaDon.hubQuet" as const;

/**
 * Scanner bóng nghĩa vụ có được chạy không — CẢ màn Hoá đơn điện tử LẪN công tắc con. Khác `laMisaPhatHanhBat`: scanner KHÔNG hỏi
 * công tắc phát hành MISA (nó không phát hành gì). Tắt ⇒ pha P2 không chạm bảng nào của Hub; pha P1 (đối soát bản treo) không đổi.
 */
export async function laHubQuetBat(): Promise<boolean> {
  const [man, quet] = await Promise.all([getSetting(KHOA_HOA_DON), getSetting(KHOA_HUB_QUET)]);
  return man && quet;
}

/** Invoice Hub (01/11/2026) — cơ sở nào THAM GIA thí điểm. Cùng khuôn: trong DB, mặc định TẮT, đọc ở đây; đặt riêng từng cơ sở (`centerOverridable`). */
export const KHOA_HUB_THI_DIEM = "hoaDon.hubThiDiem" as const;

/**
 * Hub có chạy cho cơ sở này không: màn Hoá đơn điện tử + công tắc tổng `hubQuet` + cơ sở đã được bật thí điểm. `centerId` BẮT BUỘC (luật 7: để `tsc` liệt kê mọi chỗ gọi).
 * Cơ sở không có đơn vị tổ chức ⇒ không đặt được cài riêng ⇒ coi như TẮT (fail-closed), kể cả khi mức toàn hệ thống bật.
 */
export async function laHubQuetBatChoCoSo(centerId: string): Promise<boolean> {
  if (!(await laHubQuetBat())) return false;
  // Tra thẳng bảng OrgUnit (cùng điều kiện với `orgUnitIdForCenter`): KHÔNG import `lib/org/org-service` — chuỗi import của nó kéo `next-auth` vào mọi nơi dùng feature.ts (làm đỏ các test thuần không giả `next/server`).
  const ou = await db.orgUnit.findFirst({ where: { centerId, deletedAt: null }, select: { id: true } });
  const orgUnitId = ou?.id ?? null;
  if (!orgUnitId) return false;
  return await getSetting(KHOA_HUB_THI_DIEM, { orgUnitId });
}

/** Danh sách cơ sở đang được quét (rỗng khi công tắc tổng tắt). Mỗi cơ sở một lần đọc cấu hình — số cơ sở nhỏ (vài chục), không phải số đơn. */
export async function coSoQuetDuoc(): Promise<string[]> {
  if (!(await laHubQuetBat())) return [];
  const ds = await db.center.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  const bat = await Promise.all(ds.map(async (c) => ((await laHubQuetBatChoCoSo(c.id)) ? c.id : null)));
  return bat.filter((x): x is string => x !== null);
}

/** Invoice Hub (01/11/2026) — thu thập thông tin người mua (QR + nhân viên nhập thay). Cùng khuôn: trong DB, mặc định TẮT, đọc ở đây. */
export const KHOA_HUB_NGUOI_MUA = "hoaDon.hubNguoiMua" as const;

/**
 * Luồng thông tin người mua có chạy cho cơ sở này không: đã được bật thí điểm (`laHubQuetBatChoCoSo`: màn + công tắc tổng + cơ sở) VÀ công tắc riêng của luồng này.
 * `centerId` BẮT BUỘC (luật 7). Tắt ⇒ route công khai trả «không tồn tại», nút tạo mã không vẽ, action từ chối.
 */
export async function laHubNguoiMuaBatChoCoSo(centerId: string): Promise<boolean> {
  if (!(await laHubQuetBatChoCoSo(centerId))) return false;
  return await getSetting(KHOA_HUB_NGUOI_MUA);
}

/** Luồng người mua có chạy ở ĐÂU ĐÓ không (công tắc tổng + công tắc riêng) — cho pha dọn của cron; từng cơ sở còn phải qua `coSoNguoiMuaDuoc`. */
export async function laHubNguoiMuaBat(): Promise<boolean> {
  return (await laHubQuetBat()) && (await getSetting(KHOA_HUB_NGUOI_MUA));
}

/** Cơ sở đang chạy luồng người mua (đã thí điểm VÀ công tắc riêng bật). Rỗng khi công tắc riêng tắt. KHÔNG BAO GIỜ rơi về «mọi cơ sở». */
export async function coSoNguoiMuaDuoc(): Promise<string[]> {
  if (!(await getSetting(KHOA_HUB_NGUOI_MUA))) return [];
  return await coSoQuetDuoc();
}

/** Tham số kỹ thuật của luồng người mua — đọc MỘT lần, truyền vào dịch vụ (dịch vụ không có mặc định ẩn). */
export async function docCauHinhNguoiMua(): Promise<{
  ttlPhut: number;
  toiDaSaiToken: number;
  toiDaLanMo: number;
  khoaPhut: number;
  giuDuLieuNgay: number;
  choXuLyToiDaNgay: number;
}> {
  const [ttlPhut, toiDaSaiToken, toiDaLanMo, khoaPhut, giuDuLieuNgay, choXuLyToiDaNgay] = await Promise.all([
    getSetting("hoaDon.nguoiMuaTtlPhut"),
    getSetting("hoaDon.nguoiMuaToiDaSai"),
    getSetting("hoaDon.nguoiMuaToiDaMo"),
    getSetting("hoaDon.nguoiMuaKhoaPhut"),
    getSetting("hoaDon.nguoiMuaGiuDuLieuNgay"),
    getSetting("hoaDon.nguoiMuaChoXuLyNgay"),
  ]);
  return { ttlPhut, toiDaSaiToken, toiDaLanMo, khoaPhut, giuDuLieuNgay, choXuLyToiDaNgay };
}

/** Lô xuất đêm 23h (BGĐ 03/11/2026) — hai công tắc tổng. Cùng khuôn: trong DB, mặc định TẮT, đọc ở đây. */
export const KHOA_LO_DEM_CHAY_THU = "hoaDon.loDemChayThu" as const;
export const KHOA_LO_DEM_TU_DONG = "hoaDon.loDemTuDong" as const;

export type CheDoLoDem = "TAT" | "CHAY_THU" | "TU_DONG";

/**
 * Chế độ của lô 23h: màn Hoá đơn điện tử phải bật; `TU_DONG` thắng `CHAY_THU`. Cả hai tắt ⇒ `TAT` ⇒ cron không đọc, không ghi gì của lô.
 * Từng cơ sở còn phải qua `coSoLoDem` (thí điểm Hub) — công tắc này KHÔNG tự đưa cơ sở nào vào lô.
 */
export async function cheDoLoDem(): Promise<CheDoLoDem> {
  const [man, tuDong, chayThu] = await Promise.all([getSetting(KHOA_HOA_DON), getSetting(KHOA_LO_DEM_TU_DONG), getSetting(KHOA_LO_DEM_CHAY_THU)]);
  if (!man) return "TAT";
  if (tuDong) return "TU_DONG";
  return chayThu ? "CHAY_THU" : "TAT";
}

/** Cơ sở nằm trong lô 23h: đã bật thí điểm Invoice Hub. Rỗng khi công tắc tổng của Hub tắt. KHÔNG BAO GIỜ rơi về «mọi cơ sở». */
export async function coSoLoDem(): Promise<string[]> {
  return await coSoQuetDuoc();
}

/** Invoice Hub S10 (02/11/2026) — phân phối hoá đơn đã phát hành cho Sale / phụ huynh (chỉ đọc). */
export const KHOA_HUB_PHAN_PHOI = "hoaDon.hubPhanPhoi" as const;

/** Phân phối có chạy cho cơ sở này không: cơ sở đã bật thí điểm VÀ công tắc riêng. `centerId` BẮT BUỘC (luật 7). */
export async function laHubPhanPhoiBatChoCoSo(centerId: string): Promise<boolean> {
  if (!(await laHubQuetBatChoCoSo(centerId))) return false;
  return await getSetting(KHOA_HUB_PHAN_PHOI);
}

/** Số phút chờ nhà cung cấp trước khi báo «quá hạn» (bản đang phát hành). Cấu hình, không hằng ẩn. */
export async function docSlaKhongRoPhut(): Promise<number> {
  return await getSetting("hoaDon.slaKhongRoPhut");
}

/**
 * Ký USB token (hub/13, 04/11/2026) — công tắc TỔNG của đường lệnh ký USB. Cùng khuôn: trong DB, mặc định TẮT, đọc ở đây. Tắt ⇒ không tạo lệnh,
 * không lưu nháp, không gọi nhà cung cấp; pháp nhân ký USB vẫn KHÔNG nhận cổng HSM (hoá đơn của họ chờ tới khi bật cờ và ký).
 */
export const KHOA_KY_USB = "hoaDon.kyUsb" as const;

export async function laKyUsbBat(): Promise<boolean> {
  const [man, usb] = await Promise.all([getSetting(KHOA_HOA_DON), getSetting(KHOA_KY_USB)]);
  return man && usb;
}
