// lib/phan-cong/cong-o.ts — CÔNG PARTTIME TỰ ĐỘNG theo ô (GĐ6, docs/phan-cong-gop/KHAO-SAT.md chốt 8, 9, 10). THUẦN — không DB, không
// đồng hồ. Ba câu hỏi, mỗi câu MỘT hàm:
//   1. ngày / kỳ này đi luật nào                  → luatNgay · luatKy (trước 01/11/2026 — và mọi khoá không đọc được — LUẬT CŨ; chốt 8)
//      Mốc bắt đầu là một NGÀY (chủ dự án chốt 29/10/2026: "áp từ 15/11/2026") ⇒ một kỳ có thể TRỘN: ngày trước mốc luật cũ, từ mốc luật mới.
//   2. ngày này được sửa tối đa mấy mốc giờ quét   → tranMocNgay   (luật mới: số cặp kỳ vọng × 2; luật cũ: hằng cũ; chốt 9)
//   3. mỗi cặp quét kỳ vọng có đủ không, ô có được tính tự động không → danhGiaCap + trangThaiO
//
// ⚠️ CHƯA NỐI vào engine / màn nào (QUYET-DINH-DEM G6-*). Đây là lõi để đo trước/sau kỳ 10 ở chế độ xem trước và cho đợt nối sau.
// Không đổi công thức lương, không đổi hệ số công, không ghi WorkUnit.
import type { CapQuet } from "@/lib/cham-cong/cap-quet-ky-vong";
import { soMocToiDa } from "@/lib/cham-cong/cap-quet-ky-vong";
import { phutTrongNgay } from "@/lib/parttime/chinh-sach";
import type { KetQuaMaO } from "./ma-o";

/** SÀN của luật mới (chốt 8: "kỳ ≤ 10/2026 luôn đi luật cũ"). Cài đặt đặt sớm hơn cũng bị kẹp về đây — kỳ 10 không bao giờ đổi. */
export const KY_LUAT_MOI_TU = "2026-11";

const KHOA_KY = /^\d{4}-(0[1-9]|1[0-2])$/;
const KHOA_NGAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const SAN_NGAY = `${KY_LUAT_MOI_TU}-01`;

/**
 * NGÀY ĐẦU đi luật mới ("YYYY-MM-DD"), đã kẹp sàn 01/11/2026; null = TẮT. `tuKy` = cài đặt `shift.parttimeLuatCongMoiTuKy`, nhận
 * "YYYY-MM-DD" (một ngày) hoặc "YYYY-MM" (= ngày 01 của kỳ — giá trị cũ vẫn đọc được). Rỗng / hỏng ⇒ null — không bao giờ đoán là bật.
 */
export function ngayBatDauLuatMoi(tuKy: string | null): string | null {
  if (!tuKy) return null;
  const ngay = KHOA_KY.test(tuKy) ? `${tuKy}-01` : KHOA_NGAY.test(tuKy) ? tuKy : null;
  // Ngày phải CÓ THẬT trên lịch ("2026-11-31" qua được regex nhưng không tồn tại) — hỏng ⇒ TẮT, không đoán.
  if (!ngay || new Date(`${ngay}T00:00:00.000Z`).toISOString().slice(0, 10) !== ngay) return null;
  return ngay > SAN_NGAY ? ngay : SAN_NGAY;
}

/** CỜ THEO NGÀY — mọi cổng gắn với MỘT ngày (xác nhận tay, phản ánh, trần mốc, chi tiết buổi) hỏi hàm này. `tuKy` BẮT BUỘC (luật 7). */
export function luatNgay(ngay: string, tuKy: string | null): "MOI" | "CU" {
  const bd = ngayBatDauLuatMoi(tuKy);
  return bd != null && KHOA_NGAY.test(ngay) && ngay >= bd ? "MOI" : "CU";
}

/**
 * CỜ THEO KỲ — màn tháng / chốt kỳ. "MOI" = mọi ngày của kỳ đi luật mới; "TRON" = mốc rơi GIỮA kỳ (ngày trước mốc luật cũ, từ mốc luật
 * mới — hỏi `luatNgay` cho từng ngày); "CU" = không ngày nào. Khoá kỳ / cài đặt hỏng ⇒ CU.
 */
export function luatKy(periodKey: string, tuKy: string | null): "MOI" | "CU" | "TRON" {
  const bd = ngayBatDauLuatMoi(tuKy);
  if (!KHOA_KY.test(periodKey) || bd == null) return "CU";
  if (`${periodKey}-01` >= bd) return "MOI";
  return bd.slice(0, 7) === periodKey ? "TRON" : "CU";
}

/**
 * Trần số mốc VÀO/RA được sửa trong MỘT ngày. Luật mới (ngày Parttime, kỳ ≥ 11/2026) = số cặp kỳ vọng × 2 (chốt 9); luật cũ = hằng của
 * `sua-gio-quet.ts` (truyền vào — file này không import mô-đun có DB). `hangCu` BẮT BUỘC (luật 7).
 */
export function tranMocNgay(p: { ngay: string; tuKy: string | null; cap: readonly CapQuet[]; hangCu: number }): number {
  return luatNgay(p.ngay, p.tuKy) === "MOI" ? soMocToiDa(p.cap) : p.hangCu;
}

export type LyDoCap = "THIEU_VAO" | "THIEU_RA" | "VAO_MUON" | "RA_SOM";
export type DanhGiaCap = { ma: string; du: boolean; lyDo: LyDoCap[] };

/** Khoảng có mặt trong ngày, theo PHÚT giờ VN (`den` null = chưa có lượt ra). Lấy từ `khoangCoMatTrongNgay` (bảng công). */
export type KhoangPhut = { tu: number; den: number | null };

/**
 * Cặp kỳ vọng có ĐỦ không: phải VÀO trước `tu` (cặp DẠY trừ thêm thời gian chuẩn bị) và RA sau `den`, trong dung sai. Gom mọi khoảng có
 * mặt CHỒNG lên cặp: vào = sớm nhất, ra = muộn nhất (khoảng mở ⇒ thiếu RA). Không khoảng nào chồng ⇒ thiếu cả hai lượt.
 */
export function danhGiaCap(p: {
  cap: readonly CapQuet[];
  khoang: readonly KhoangPhut[];
  dungSai: { treVaoPhut: number; veSomPhut: number };
  /** `tiet.chuanBiPhut` của chính sách — chỉ áp cho cặp DẠY. BẮT BUỘC (luật 7). */
  chuanBiPhut: number;
}): DanhGiaCap[] {
  return p.cap.map((c) => {
    const can = { tu: phutTrongNgay(c.tu) - (c.loai === "DAY" ? p.chuanBiPhut : 0), den: phutTrongNgay(c.den) };
    const chong = p.khoang.filter((k) => k.tu < can.den && (k.den == null || k.den > can.tu));
    if (!chong.length) return { ma: c.ma, du: false, lyDo: ["THIEU_VAO", "THIEU_RA"] };
    const vao = Math.min(...chong.map((k) => k.tu));
    const mo = chong.some((k) => k.den == null);
    const ra = mo ? null : Math.max(...chong.map((k) => k.den as number));
    const lyDo: LyDoCap[] = [];
    if (vao > can.tu + p.dungSai.treVaoPhut) lyDo.push("VAO_MUON");
    if (ra == null) lyDo.push("THIEU_RA");
    else if (ra < can.den - p.dungSai.veSomPhut) lyDo.push("RA_SOM");
    return { ma: c.ma, du: lyDo.length === 0, lyDo };
  });
}

export type LyDoO = LyDoCap | "TRUNG_GIO" | "KHONG_CO_CAP";
export type TrangThaiO = { trangThai: "KHONG_CO_VIEC" | "TU_DONG" | "CAN_XEM"; lyDo: LyDoO[] };

/**
 * Ô được TÍNH TỰ ĐỘNG khi: có việc, MỌI cặp phủ ô đều đủ, không cờ trùng giờ. Thiếu một lượt của bất kỳ cặp nào phủ ô ⇒ "cần xem" (gửi
 * giáo viên — họ phản ánh nếu sai; chốt 4, 5). Ô không việc (X, không Trial) ⇒ không có công để tính.
 */
export function trangThaiO(p: { ca: string; o: Pick<KetQuaMaO, "ma" | "coTrial" | "coTrungGio">; cap: readonly CapQuet[]; danhGia: readonly DanhGiaCap[] }): TrangThaiO {
  if (p.o.ma === "X" && !p.o.coTrial) return { trangThai: "KHONG_CO_VIEC", lyDo: [] };
  const phu = p.cap.filter((c) => c.phuCa.includes(p.ca));
  const lyDo = new Set<LyDoO>();
  if (p.o.coTrungGio) lyDo.add("TRUNG_GIO");
  if (!phu.length) lyDo.add("KHONG_CO_CAP");
  for (const c of phu) for (const l of p.danhGia.find((d) => d.ma === c.ma)?.lyDo ?? ["THIEU_VAO", "THIEU_RA"]) lyDo.add(l as LyDoO);
  return lyDo.size ? { trangThai: "CAN_XEM", lyDo: [...lyDo] } : { trangThai: "TU_DONG", lyDo: [] };
}
