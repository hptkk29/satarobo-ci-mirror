// lib/finance/coach-pricing.ts — GIÁ THEO BUỔI + hệ số lớp Coach.
//
// NGUỒN LUẬT: `SR.QD.219 — Chính sách giá bán sản phẩm tạo trung tâm đào tạo Sata Robo`,
// **Điều 5** (bản trong `E:\Cong_van`). Trích nguyên văn phần chịu lực:
//
//   5.1. Coach 1-1: 01 GV kèm riêng 01 HS · Coach 1-2: 01 GV kèm 02 HS ·
//        Coach 1-4: 01 GV kèm tối đa 04 HS.
//   5.2. Giá mỗi buổi Coach = giá/buổi của khóa (giá niêm yết Điều 3/4 ÷ tổng số buổi)
//        × hệ số: 1-1 ×2,0 · 1-2 ×1,8 · 1-4 ×1,5.
//   5.3. Nếu chốt trong thời gian khuyến mãi: giá/buổi làm căn cứ tính hệ số là giá/buổi
//        **SAU khuyến mãi tại thời điểm chốt**, KHÔNG phải giá niêm yết gốc.
//   5.4. Học thêm ngoài chính khoá: áp hệ số Coach tương ứng, tính **theo từng buổi**.
//   5.5. Học bù khi nghỉ KHÔNG lý do: tính theo hệ số Coach. Nghỉ CÓ lý do: miễn phí.
//        ("nghỉ không lý do" = không báo trước ≥ 60 phút — Mục 5.6.)
//   Ghi chú: **Sata8 KHÔNG áp dụng Coach** (gói cam kết 5 buổi, giá cố định Điều 3).
//
// ⚠️ THỨ TỰ PHÉP TÍNH LÀ PHẦN DỄ SAI NHẤT (Mục 5.3): **giảm giá TRƯỚC, hệ số SAU**.
// Với giảm theo % thì hai thứ tự trùng nhau nên bug ẩn; với giảm theo SỐ TIỀN thì lệch
// hẳn — `[CO-04]` ghim đúng ca đó bằng số.
//
// ⚠️ HỆ SỐ LÀ MẶC ĐỊNH, KHÔNG PHẢI HẰNG BẤT BIẾN. Chủ dự án chốt 13/09/2026: mọi chính
// sách phải sửa được ở màn cấu hình. Hằng dưới đây chỉ dùng khi người gọi không truyền
// gì; **đường nào chạm DB thì phải `getSetting("coach.multiplier*")` rồi truyền vào**
// (cùng bài học với `crm.commissionMaxTotalRate` — xem CLAUDE.md).
//
// THUẦN — không Prisma, không DB, không `getSetting`. Test không cần DB.

import type { CourseDiscountType } from "@prisma/client";

/** Hình thức tổ chức lớp. `GROUP` = lớp nhóm thường (không phải Coach). */
export type CoachFormat = "GROUP" | "ONE_ON_ONE" | "ONE_ON_TWO" | "ONE_ON_FOUR";

export type HeSoCoach = Record<CoachFormat, number>;

/** MẶC ĐỊNH theo Mục 5.2. Admin sửa được — đừng coi đây là chân lý. */
export const HE_SO_COACH: HeSoCoach = {
  GROUP: 1,
  ONE_ON_ONE: 2.0,
  ONE_ON_TWO: 1.8,
  ONE_ON_FOUR: 1.5,
};

/** Nhãn tiếng Việt cho màn hình — một chỗ, đừng ghép chuỗi ở component. */
export const NHAN_COACH: Record<CoachFormat, string> = {
  GROUP: "Lớp nhóm",
  ONE_ON_ONE: "Coach 1-1 (kèm riêng)",
  ONE_ON_TWO: "Coach 1-2",
  ONE_ON_FOUR: "Coach 1-4",
};

/**
 * Khoá này bị công văn LOẠI khỏi hình thức Coach?
 *
 * Ghi chú Điều 5: "Sata8 KHÔNG áp dụng Coach" (gói cam kết 5 buổi, giá cố định Điều 3).
 *
 * ⚠️ ĐÂY LÀ PHÉP ĐOÁN THEO TÊN, và nó được khai ra đúng chỗ này thay vì giấu trong một
 * `if` ở màn hình. `Course` KHÔNG có cột "được Coach hay không", và thêm cột là ALTER
 * trên bảng có dữ liệu prod ⇒ phải là story riêng có dry-run (luật cứng #4). Khi cột đó
 * ra đời thì bỏ hàm này, đừng để hai nguồn.
 *
 * Hướng sai của nó là AN TOÀN: đặt tên khoá mới kiểu "Sata 8 nâng cao" cũng bị chặn
 * Coach — chặn nhầm còn hơn bán một hình thức công văn cấm. Nhưng thiếu cả ba trường thì
 * KHÔNG chặn: chặn vì không đọc được tên là chặn một việc bán hàng hợp lệ.
 */
export function laKhoaLoaiTruCoach(khoa: {
  slug?: string | null;
  code?: string | null;
  name?: string | null;
}): boolean {
  const chuan = (v: string | null | undefined) =>
    (v ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      // Gom "sata-8" · "Sata 8" · "SATA8" về một dạng; ranh giới từ ở dưới lo
      // phần "Sata 18" / "Sata 80".
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();
  const mau = /\bSATA\s*8\b/;
  return [khoa.slug, khoa.code, khoa.name].some((v) => mau.test(chuan(v)));
}

function so(n: number, macDinh = 0): number {
  return Number.isFinite(n) ? n : macDinh;
}

/**
 * Giá MỘT buổi của khoá = giá niêm yết ÷ tổng số buổi (Mục 5.2).
 *
 * `tongSoBuoi <= 0` → 0 thay vì `Infinity`/`NaN`: đây là đường tiền, một `Infinity` lọt
 * vào sẽ đi rất xa trước khi ai đó thấy.
 */
export function giaMoiBuoi(giaNiemYet: number, tongSoBuoi: number): number {
  const gia = Math.max(0, so(giaNiemYet));
  const buoi = Math.floor(so(tongSoBuoi));
  if (buoi <= 0) return 0;
  return Math.round(gia / buoi);
}

/** Giá một buổi Coach = giá/buổi × hệ số (Mục 5.2). */
export function giaCoachMoiBuoi(
  giaBuoi: number,
  format: CoachFormat,
  heSo: HeSoCoach = HE_SO_COACH,
): number {
  const h = so(heSo[format], HE_SO_COACH[format]);
  const hSach = h > 0 ? h : HE_SO_COACH[format];
  return Math.round(Math.max(0, so(giaBuoi)) * hSach);
}

/** Lỗi khi cố tính Coach cho khoá công văn đã loại trừ (Sata8). */
export class CoachKhongApDung extends Error {
  readonly code = "COACH_KHONG_AP_DUNG" as const;
  constructor() {
    super(
      "Khoá này không áp dụng hình thức Coach (SR.QD.219 Điều 5 — Sata8 là gói cam kết " +
        "5 buổi, giá cố định theo Điều 3). Chọn lớp nhóm, hoặc chọn khoá khác.",
    );
    this.name = "CoachKhongApDung";
  }
}

export type HocPhiTheoBuoi = {
  /** Giá/buổi niêm yết (trước giảm). */
  giaMoiBuoiGoc: number;
  /** Giá/buổi SAU giảm — đây là căn cứ tính hệ số theo Mục 5.3. */
  giaMoiBuoiSauGiam: number;
  /** Giá/buổi sau khi nhân hệ số Coach. */
  giaCoachMoiBuoi: number;
  soBuoiMua: number;
  /** Thành tiền = giá Coach/buổi × số buổi mua. */
  thanhTien: number;
  heSoApDung: number;
};

/**
 * Tính học phí theo SỐ BUỔI + hình thức lớp.
 *
 * Dùng cho: mua cả khoá (`soBuoiMua = tongSoBuoi`), học thêm (Mục 5.4), và học bù có
 * tính tiền (Mục 5.5) — cả ba đều là "n buổi × giá Coach/buổi", nên MỘT hàm.
 *
 * ⚠️ Giảm giá áp ở mức **GIÁ/BUỔI**, không phải ở tổng: đó là điều Mục 5.3 nói, và cũng
 * là thứ cho phép mua lẻ buổi mà vẫn đúng chính sách khuyến mãi.
 *
 * @throws {CoachKhongApDung} khi khoá bị loại trừ mà vẫn chọn hình thức Coach.
 */
export function tinhHocPhiTheoBuoi(input: {
  giaNiemYet: number;
  tongSoBuoi: number;
  soBuoiMua: number;
  coachFormat: CoachFormat;
  giamGia: { type: CourseDiscountType; value: number } | null;
  /** Khoá mà công văn loại trừ khỏi Coach (hiện chỉ Sata8). */
  khoaKhongApDungCoach?: boolean;
  /** Bảng hệ số từ cấu hình; bỏ trống → mặc định Mục 5.2. */
  heSo?: HeSoCoach;
}): HocPhiTheoBuoi {
  const { coachFormat } = input;
  if (input.khoaKhongApDungCoach && coachFormat !== "GROUP") {
    throw new CoachKhongApDung();
  }

  const heSo = input.heSo ?? HE_SO_COACH;
  const giaMoiBuoiGoc = giaMoiBuoi(input.giaNiemYet, input.tongSoBuoi);

  // Mục 5.3 — GIẢM TRƯỚC, HỆ SỐ SAU. Giảm tính trên GIÁ/BUỔI.
  let giaMoiBuoiSauGiam = giaMoiBuoiGoc;
  const g = input.giamGia;
  if (g) {
    if (g.type === "PERCENT" || g.type === "SCHOLARSHIP") {
      const pct = Math.min(Math.max(so(g.value), 0), 100);
      giaMoiBuoiSauGiam = Math.round(giaMoiBuoiGoc * (1 - pct / 100));
    } else {
      // AMOUNT / PROGRAM — số tiền giảm trên MỘT BUỔI, kẹp trong [0, giá/buổi].
      giaMoiBuoiSauGiam = Math.max(0, giaMoiBuoiGoc - Math.max(0, so(g.value)));
    }
  }

  const giaCoach = giaCoachMoiBuoi(giaMoiBuoiSauGiam, coachFormat, heSo);
  const soBuoiMua = Math.max(0, Math.floor(so(input.soBuoiMua)));
  const hApDung = so(heSo[coachFormat], HE_SO_COACH[coachFormat]);

  return {
    giaMoiBuoiGoc,
    giaMoiBuoiSauGiam,
    giaCoachMoiBuoi: giaCoach,
    soBuoiMua,
    thanhTien: giaCoach * soBuoiMua,
    heSoApDung: hApDung > 0 ? hApDung : HE_SO_COACH[coachFormat],
  };
}
