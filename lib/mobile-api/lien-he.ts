import { SATA_ROBO_LOCATIONS, SATA_ROBO_PHONE } from "@/lib/locations";

/**
 * Liên hệ trung tâm cho thẻ «Đường dây nóng» của Tổng quan (B4.7). KHÔNG có dữ liệu mới: số điện thoại + Zalo là hằng CHUNG của công ty (`SATA_ROBO_PHONE`, chủ dự án chốt 24/09/2026 một số
 * duy nhất) và giờ mở cửa là của CƠ SỞ (`SATA_ROBO_LOCATIONS[].workingHours`, chủ dự án chốt 08/11/2026 «T3 - CN: 8:00 - 21:00»).
 *
 * ⚠️ KHÔNG đọc `Center.phone` của DB: đo trên DB TEST 17/11/2026 hai cơ sở cùng mang `0818823720` (số CŨ trước 24/09) và `workingHours` rỗng — cột đó không còn là nguồn đúng.
 * Cơ sở không nhận ra (mã lạ/trống) ⇒ giờ mở cửa của cơ sở mặc định (trụ sở); số điện thoại luôn là số chung.
 */
export type LienHeDto = {
  /** Số in cho người đọc: `0837.312.860`. */
  soHien: string;
  /** Số thuần cho `tel:`. */
  soTho: string;
  /** Đường dẫn Zalo của công ty. */
  zaloUrl: string;
  /** Giờ mở cửa của cơ sở của con, ví dụ `T3 - CN: 8:00 - 21:00`. */
  gioMoCua: string;
  /** Tên cơ sở của con (hoặc null khi không nhận ra). */
  tenCoSo: string | null;
};

export function lienHeCuaCoSo(maCoSo: string | null | undefined): LienHeDto {
  const cs = SATA_ROBO_LOCATIONS.find((l) => l.code === maCoSo) ?? null;
  const macDinh = SATA_ROBO_LOCATIONS.find((l) => l.isHQ) ?? SATA_ROBO_LOCATIONS[0];
  return {
    soHien: SATA_ROBO_PHONE.hien,
    soTho: SATA_ROBO_PHONE.tho,
    zaloUrl: SATA_ROBO_PHONE.zalo,
    gioMoCua: (cs ?? macDinh)?.workingHours ?? "",
    tenCoSo: cs?.name ?? null,
  };
}

/**
 * V8.45 — LIÊN HỆ CHO HỌC SINH (Student Mode). Owner chốt 25/11/2026: phần trẻ em KHÔNG có liên kết ngoài ⇒ DTO này CHỈ có ba trường CHỮ cho người đọc (số in ra,
 * giờ mở cửa, tên cơ sở) — KHÔNG `zaloUrl`, KHÔNG `soTho` (đường dẫn `tel:`). Dựng TƯỜNG MINH từng trường (không `...lienHe`) để thêm trường mới vào `LienHeDto`
 * sau này không tự rò sang học sinh; lưới `[LH-HS-01]` đếm đúng ba khoá.
 */
export type LienHeHocSinhDto = Pick<LienHeDto, "soHien" | "gioMoCua" | "tenCoSo">;

export function lienHeChoHocSinh(maCoSo: string | null | undefined): LienHeHocSinhDto {
  const l = lienHeCuaCoSo(maCoSo);
  return { soHien: l.soHien, gioMoCua: l.gioMoCua, tenCoSo: l.tenCoSo };
}
