// GIÁO VIÊN CỦA CASE TRIAL VẮNG vì ĐƠN NGHỈ / ĐỔI CA đã duyệt — hàm THUẦN.
//
// ── CHỐT 29/09/2026 (chủ dự án) ───────────────────────────────────────────────────────
// "khi giáo viên được duyệt đơn nghỉ, đổi ca thì hệ thống phải liên kết data với nhau …
// các case trial trong khung giờ có các giáo viên nghỉ đó phải ẩn đi". Chốt khi hỏi lại:
// ĐÁNH DẤU case ("GV nghỉ — cần đổi GV") + KHOÁ xếp thêm bé vào, KHÔNG giấu case (bé đã
// xếp vẫn ở đó), và báo Sale chủ case + Đào tạo khi đơn được duyệt.
//
// ── VÌ SAO CHỈ TIN Ô CA MANG NGUỒN `LEAVE` / `SWAP` ────────────────────────────────────
// Duyệt đơn (`decideRequest`, lib/cham-cong/requests.ts) ghi thẳng lên lưới ca: đơn nghỉ ⇒
// ô `P`/`X` nguồn `LEAVE`; đổi ca ⇒ huỷ ô cũ, tạo ô mới nguồn `SWAP`. Đó là BẰNG CHỨNG
// có người duyệt. Còn "giáo viên không có ca giờ đó" nói chung (lưới chưa sinh, giáo viên
// bán thời gian chưa vào lưới, khung ca tuần chưa khai) là DỮ LIỆU THIẾU — đánh dấu theo nó
// là báo động giả trên hàng loạt case đang chạy bình thường, rồi người ta học cách lờ đi.
//
// Phép "ca có phủ khung giờ không" KHÔNG viết lại: dùng đúng `caPhuTronKhungGio` mà ô chọn
// giáo viên đang dùng, để hai nơi không thể nói hai điều khác nhau về cùng một người.

import { caPhuTronKhungGio, type CaNgay } from "@/lib/trial/gv-kha-dung";

/** Nguồn của ô ca — khớp enum `ShiftAssignmentSource` của Prisma. */
export type NguonOCa = "PATTERN" | "IMPORT" | "MANUAL" | "SWAP" | "LEAVE" | "HOLIDAY";

/** Ô ca ACTIVE của giáo viên trong ngày của case. `null` = không có ô. */
export type OCaGiaoVien = { nguon: NguonOCa; ca: CaNgay } | null;

export type GvVangCase =
  | { vang: false }
  | {
      vang: true;
      /** `NGHI` = đơn nghỉ; `DOI_CA` = đổi ca sang ca không phủ giờ case. */
      loai: "NGHI" | "DOI_CA";
      /** Câu hiện trên màn + trong thông báo. */
      lyDo: string;
    };

export const LY_DO_GV_NGHI = "GV nghỉ ngày này (đơn nghỉ đã duyệt) — cần đổi GV";
export const LY_DO_GV_DOI_CA = "GV đã đổi ca, ca mới không phủ giờ case — cần đổi GV";

export function gvVangTaiCase(input: {
  o: OCaGiaoVien;
  khung: { startTime: string; endTime: string };
}): GvVangCase {
  const { o } = input;
  // Không có ô / ô không do đơn nào sinh ra ⇒ không có bằng chứng ⇒ không đánh dấu.
  if (!o || (o.nguon !== "LEAVE" && o.nguon !== "SWAP")) return { vang: false };

  const phu = caPhuTronKhungGio({
    ca: o.ca,
    khung: input.khung,
    // Có ô ca thật trong ngày ⇒ lưới đã sinh và người này có trong lưới.
    luoiDaSinh: true,
    coTrongLuoi: true,
  });

  if (phu === "NGHI") return { vang: true, loai: "NGHI", lyDo: LY_DO_GV_NGHI };
  // Ca có giờ mà không chứa trọn giờ case: giáo viên KHÔNG ở đó lúc case diễn ra.
  if (phu === "KHONG_PHU") {
    return o.nguon === "LEAVE"
      ? { vang: true, loai: "NGHI", lyDo: LY_DO_GV_NGHI }
      : { vang: true, loai: "DOI_CA", lyDo: LY_DO_GV_DOI_CA };
  }
  // PHU_TRON: vẫn dạy được (vd người được đổi ca SANG đúng khung này).
  // KHONG_GIO: mã ca không mang giờ — không kết luận được ⇒ không đánh dấu.
  return { vang: false };
}
