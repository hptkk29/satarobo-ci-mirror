// lib/orders/hinh-thuc-lop.ts — HÌNH THỨC LỚP (Lớp nhóm / Coach 1-1 / 1-2 / 1-4) trên
// dòng đơn, theo SR.QD.219 Điều 5.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHẠM VI ĐÃ THU HẸP SAU KHI ĐO — đọc trước khi mở rộng
//
// Ý định ban đầu là "chọn 1-1 thì đơn giá tự nhân hệ số, rồi cổng `soatGiaDon` so với
// giá kỳ vọng theo công văn". Hai lượt phản biện độc lập (14/09/2026) bác bỏ, mỗi lượt
// kèm số. Ba điều RÚT RA, và chúng là lý do file này trông như thế này:
//
//  (1) HÌNH THỨC LỚP KHÔNG ĐƯỢC ĐI VÀO `giaNiemYet` CỦA CỔNG SOÁT GIÁ.
//      Hôm nay `giaNiemYet` là `Course.price` tra từ DB, client không chạm được — nên
//      hạ giá luôn lộ. `coachFormat` và `soBuoi` thì nằm trong `items[].metadata`, tức
//      PAYLOAD CLIENT. Cho chúng quyết định giá kỳ vọng là để client cầm cả hai vế của
//      phép so: khai `soBuoi` nhỏ là mọi đơn bán rẻ thành "khớp".
//
//  (2) SỐ SINH RA Ở ĐÂY LÀ ĐỂ NGƯỜI ĐỌC, KHÔNG PHẢI ĐỂ MÁY SO.
//      `giaMoiBuoi` làm tròn rồi `giaCoachMoiBuoi` làm tròn lần nữa: round(5.200.000/12)
//      × 12 = 5.199.996, lệch 4đ so với giá niêm yết. `soatGiaDon` chạy `dungSai = 0`,
//      nên đưa số này vào cổng là mọi đơn LỚP NHÓM của 3/7 khoá seed bị đánh "lệch" —
//      biến con số theo dõi thất thoát thành nhiễu vĩnh viễn. Nên `goiYGiaCoach` trả
//      luôn `lechLamTron` để màn hình nói ra, chứ không giấu.
//
//  (3) TRỤC GHI DANH CHƯA BIẾT GÌ VỀ COACH — và đợt này KHÔNG vá.
//      `Enrollment.finalPrice` (thứ /cong-no, /portal/hoc-phi và hoàn tiền đọc) do các
//      đường convert ghi bằng giá NHÓM. Bán Coach 1-1 thì ZNS báo một số, portal in số
//      khác. Ghim ở `hinh-thuc-lop.test.ts` ca `[HTL-09]` bằng `it.fails`.
//
// THUẦN — không Prisma, không DB, không `getSetting`. Test không cần database.
// ─────────────────────────────────────────────────────────────────────────────

import type { CourseDiscountType } from "@prisma/client";

import {
  HE_SO_COACH,
  tinhHocPhiTheoBuoi,
  type CoachFormat,
  type HeSoCoach,
} from "@/lib/finance/coach-pricing";

/** Trần số buổi một dòng đơn — chặn `soBuoi` rác từ client trước khi nó thành tiền. */
export const TRAN_SO_BUOI = 500;

const HINH_THUC: readonly CoachFormat[] = [
  "GROUP",
  "ONE_ON_ONE",
  "ONE_ON_TWO",
  "ONE_ON_FOUR",
] as const;

export type HinhThucDongDon = {
  courseId: string | null;
  coachFormat: CoachFormat;
  /** `null` = không khai; KHÔNG hoá 0, vì 0 buổi là giá 0 và giá 0 đi rất xa. */
  soBuoi: number | null;
};

/**
 * Đọc hình thức lớp từ `OrderItem.metadata`.
 *
 * ⚠️ `metadata` là `Json?` và có BỐN đường ghi (`createOrderManualAction`,
 * `backfill-order`, `ghi-giao-dich-cu`, convert) — chỉ một đường qua zod. Nên ở đây coi
 * nó là DỮ LIỆU NGOÀI: không tin kiểu, không ném, fail-closed về hình thức RẺ NHẤT.
 *
 * `GROUP` cho dữ liệu cũ là có chủ đích: mọi đơn tạo trước hôm nay chỉ có `{ courseId }`,
 * và chúng đúng là lớp nhóm. Trả `null` thì từng chỗ đọc phải tự nhớ "null nghĩa là
 * nhóm", và sẽ có chỗ quên.
 */
export function docHinhThucLop(metadata: unknown): HinhThucDongDon {
  const m =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};

  const f = m.coachFormat;
  const coachFormat =
    typeof f === "string" && (HINH_THUC as readonly string[]).includes(f)
      ? (f as CoachFormat)
      : "GROUP";

  const b = m.soBuoi;
  const soBuoi =
    typeof b === "number" && Number.isInteger(b) && b > 0 && b <= TRAN_SO_BUOI ? b : null;

  const c = m.courseId;
  return {
    courseId: typeof c === "string" && c.length > 0 ? c : null,
    coachFormat,
    soBuoi,
  };
}

/**
 * Dựng `OrderItem.metadata` cho một dòng đơn khoá học.
 *
 * `coachFormat` KHÔNG ghi khi là lớp nhóm: đơn nhóm là đa số, nhét `"GROUP"` vào mọi đơn
 * là làm dữ liệu ồn lên mà không thêm thông tin nào — `docHinhThucLop` vốn đã trả `GROUP`
 * khi vắng mặt, nên hai đầu khớp nhau.
 *
 * ⚠️ `soBuoi` THÌ LUÔN GHI KHI CÓ KHAI — kể cả lớp nhóm [đổi 25/09/2026].
 *
 * Trước ngày này nó nằm TRONG nhánh `coachFormat !== "GROUP"`, nên sale gõ "Số buổi mua"
 * trên form mà **con số không bao giờ rời khỏi trình duyệt**. Đo `satarobo_local`:
 * **0/519 `OrderItem` có `soBuoi`, 0/519 có `coachFormat`** — mọi dòng đều là lớp nhóm.
 *
 * Lý lẽ cũ ("đừng ghi khoá thừa") vẫn ĐÚNG cho `coachFormat`, vì `GROUP` là giá trị mặc
 * định suy ra được. Nó KHÔNG đúng cho `soBuoi`: số buổi mua là thông tin THẬT, không suy
 * ra được từ đâu cả, và nay có ba chỗ cần nó —
 *   · luật duyệt mốc học phần (`lib/orders/so-buoi-hoc-phan.ts`, chốt 25/09);
 *   · dòng `· N buổi` trên trang chi tiết đơn (`order-detail-client.tsx`);
 *   · đối soát về sau: "đơn này bán bao nhiêu buổi" phải trả lời được từ chính tờ đơn.
 * Bỏ nó đi là để ba chỗ ấy cùng câm.
 */
export function veMetadataDongDon(
  x: HinhThucDongDon,
): Record<string, unknown> | null {
  if (!x.courseId) return null;
  const m: Record<string, unknown> = { courseId: x.courseId };
  if (x.coachFormat !== "GROUP") m.coachFormat = x.coachFormat;
  if (x.soBuoi != null) m.soBuoi = x.soBuoi;
  return m;
}

export type ThieuDeGoiY = "GIA" | "SO_BUOI" | "LOAI_TRU" | null;

export type GoiYGiaCoach = {
  /** Đủ dữ liệu để đưa ra con số không? */
  dungDuoc: boolean;
  /** Vì sao không gợi ý được. `null` khi `dungDuoc`. */
  thieu: ThieuDeGoiY;
  giaMoiBuoi: number;
  giaMoiBuoiSauGiam: number;
  heSo: number;
  giaCoachMoiBuoi: number;
  soBuoiMua: number;
  thanhTien: number;
  /**
   * `thanhTien − (giá niêm yết sau giảm × hệ số)` — phần sinh ra do làm tròn hai lần.
   *
   * Nêu ra chứ không giấu: đây đúng là con số đã bác bỏ thiết kế "đưa giá kỳ vọng vào
   * cổng soát" (dungSai = 0 thì lệch 4đ cũng thành CAO_HON/THAP_HON).
   */
  lechLamTron: number;
};

const RONG: GoiYGiaCoach = {
  dungDuoc: false,
  thieu: null,
  giaMoiBuoi: 0,
  giaMoiBuoiSauGiam: 0,
  heSo: 1,
  giaCoachMoiBuoi: 0,
  soBuoiMua: 0,
  thanhTien: 0,
  lechLamTron: 0,
};

/**
 * GỢI Ý học phí theo công văn cho người bán đọc — KHÔNG phải giá hệ thống tự áp.
 *
 * Người bán vẫn là người gõ đơn giá (ô đó vốn nhập tay và đợt này không đổi điều đó).
 * Hàm chỉ bọc `tinhHocPhiTheoBuoi` thêm ba việc mà một form cần mà một hàm tính tiền
 * không nên làm: (a) nhận số THIẾU (`null`) thay vì bắt người gọi tự đoán, (b) đổi cú
 * ném `CoachKhongApDung` thành CỜ — ném giữa lúc người ta đang gõ form là màn trắng, và
 * (c) tính sẵn `lechLamTron` để màn hình nói ra.
 *
 * ⚠️ Thứ tự Mục 5.3 — GIẢM TRƯỚC, HỆ SỐ SAU — do `tinhHocPhiTheoBuoi` giữ; đừng tự nhân
 * lại ở chỗ gọi.
 */
export function goiYGiaCoach(input: {
  giaNiemYet: number | null | undefined;
  tongSoBuoi: number | null | undefined;
  soBuoiMua: number | null | undefined;
  coachFormat: CoachFormat;
  giamGia: { type: CourseDiscountType; value: number } | null;
  khoaKhongApDungCoach?: boolean;
  heSo?: HeSoCoach;
}): GoiYGiaCoach {
  const heSoBang = input.heSo ?? HE_SO_COACH;
  const heSo = heSoBang[input.coachFormat] || HE_SO_COACH[input.coachFormat];

  if (input.khoaKhongApDungCoach && input.coachFormat !== "GROUP") {
    return { ...RONG, thieu: "LOAI_TRU", heSo };
  }

  const gia = Number(input.giaNiemYet);
  if (!Number.isFinite(gia) || gia <= 0) return { ...RONG, thieu: "GIA", heSo };

  const tong = Number(input.tongSoBuoi);
  if (!Number.isFinite(tong) || tong <= 0) return { ...RONG, thieu: "SO_BUOI", heSo };

  // Không khai số buổi mua ⇒ mua ĐỦ KHOÁ. Lùi về 0 là ra giá 0 — thứ đi rất xa trước
  // khi ai đó thấy.
  const muaRaw = Number(input.soBuoiMua);
  const mua =
    Number.isFinite(muaRaw) && muaRaw > 0 ? Math.min(Math.floor(muaRaw), TRAN_SO_BUOI) : Math.floor(tong);

  const r = tinhHocPhiTheoBuoi({
    giaNiemYet: gia,
    tongSoBuoi: Math.floor(tong),
    soBuoiMua: mua,
    coachFormat: input.coachFormat,
    giamGia: input.giamGia,
    heSo: heSoBang,
  });

  // MỐC SO SÁNH của `lechLamTron`: đúng phép tính mà người bán nhẩm trong đầu —
  // "giá khoá (sau giảm) × hệ số", KHÔNG làm tròn ở giữa.
  //
  // Tỉ lệ giảm suy NGƯỢC từ hai giá trị hàm đã trả (`sauGiam / goc`) thay vì chép lại
  // nhánh PERCENT/AMOUNT của `tinhHocPhiTheoBuoi`. Chép lại là đẻ ra bản sao thứ hai của
  // luật Mục 5.3, và bản sao sẽ lệch vào ngày ai đó sửa một bên.
  const tiLeGiam = r.giaMoiBuoiGoc > 0 ? r.giaMoiBuoiSauGiam / r.giaMoiBuoiGoc : 1;
  const mocNhamTay = Math.round((gia / Math.floor(tong)) * tiLeGiam * r.heSoApDung * r.soBuoiMua);

  return {
    dungDuoc: true,
    thieu: null,
    giaMoiBuoi: r.giaMoiBuoiGoc,
    giaMoiBuoiSauGiam: r.giaMoiBuoiSauGiam,
    heSo: r.heSoApDung,
    giaCoachMoiBuoi: r.giaCoachMoiBuoi,
    soBuoiMua: r.soBuoiMua,
    thanhTien: r.thanhTien,
    lechLamTron: r.thanhTien - mocNhamTay,
  };
}

/**
 * KHOÁ HỌC của một dòng đơn — tra theo THỨ TỰ, không chỉ đọc `metadata`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 Đo `satarobo_local` 26/09/2026, và con số này là cả lý do hàm tồn tại:
 *
 *   | nguồn                        | số dòng tra ra khoá |
 *   |------------------------------|---------------------|
 *   | `metadata.courseId`          | **5 / 523**         |
 *   | `Enrollment.courseId`        | **493 / 523**       |
 *   | cả hai gộp lại               | **498 / 523**       |
 *
 * `metadata.courseId` CHỈ được ghi bởi form `/orders/new` (`veMetadataDongDon`). Ba
 * đường tạo đơn còn lại — `convert-lead`, `backfill-order`, `ghi-giao-dich-cu` — không
 * ghi nó bao giờ, và chúng đẻ ra gần như toàn bộ dữ liệu thật. Dùng một mình `metadata`
 * để hỏi "dòng này là khoá nào" là **câm trên 99% đơn**, mà lại câm một cách trông rất
 * bình thường: hàm trả `null`, màn hình không in gì, không lỗi nào báo.
 *
 * ⚠️ `metadata` THẮNG khi có cả hai: đó là khoá người bán CHỌN lúc lập đơn, còn
 * `Enrollment` là kết quả của lượt convert về sau và có thể đã bị đổi khoá
 * (`doi-khoa-dialog`). Người soát đơn đang xem TỜ ĐƠN, nên phải thấy thứ tờ đơn ghi.
 */
export function khoaCuaDong(d: {
  metadata: unknown;
  /** `Enrollment.courseId` của dòng, `null` khi dòng chưa gắn ghi danh. */
  courseIdGhiDanh: string | null;
}): string | null {
  return docHinhThucLop(d.metadata).courseId ?? d.courseIdGhiDanh ?? null;
}
