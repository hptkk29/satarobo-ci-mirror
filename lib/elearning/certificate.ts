import { randomBytes } from "node:crypto";
import {
  chuKyNganNhat,
  khopYeuCau,
  type YeuCauDeKhop,
} from "@/lib/elearning/requirement-match";

/**
 * EL-16 — CẤP CHỨNG NHẬN, và suy hạn hiệu lực.
 *
 * Chứng nhận ở đây là CHỨNG TỪ, không phải huy hiệu: nó phải kiểm chứng được bởi một
 * người không có tài khoản, bằng điện thoại của họ, sau khi người được cấp đã nghỉ
 * việc. Ba hệ quả bám suốt tệp này:
 *
 *  1. Mọi thứ in trên bản PDF phải là ẢNH CHỤP lúc cấp (`snap*`), không join sống.
 *  2. Địa chỉ tra cứu đi bằng `verifyToken` ngẫu nhiên, không bằng `id`.
 *  3. Trạng thái hiển thị phải SUY từ `validUntil`, không đọc thẳng cột `status`.
 */

/** Chuỗi trong QR: 32 ký tự, ngẫu nhiên mã hoá — không đoán, không liệt kê được. */
export function taoVerifyToken(): string {
  // 24 byte → 32 ký tự base64url. Dùng `randomBytes` chứ không `Math.random()`: đây
  // là thứ duy nhất chặn người lạ dò ra hồ sơ đào tạo của người khác trên một trang
  // công khai không đăng nhập.
  return randomBytes(24).toString("base64url");
}

/** `SR.CN.2026.00001` — mã người đọc bằng mắt, in trên bản PDF. */
export function maChungNhan(nam: number, stt: number): string {
  return `SR.CN.${nam}.${String(stt).padStart(5, "0")}`;
}

/**
 * Cộng tháng theo lịch, KHÔNG cộng 30 ngày.
 *
 * "12 tháng" trong một quy định về đào tạo nghĩa là cùng ngày sang năm, không phải
 * 360 ngày. Cộng ngày làm hạn trôi dần qua mỗi vòng tái chứng nhận, và sau vài vòng
 * thì ngày hết hạn không còn khớp với văn bản nữa.
 */
export function congThang(moc: Date, thang: number): Date {
  const d = new Date(moc.getTime());
  const ngayGoc = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + thang);
  // Tràn ngày: 31/01 + 1 tháng → JS cho ra 03/03. Kéo về ngày cuối tháng đích.
  if (d.getUTCDate() !== ngayGoc) d.setUTCDate(0);
  return d;
}

export type NguonHan = "YEU_CAU" | "CHUONG_TRINH" | "VO_THOI_HAN";

export type KetQuaHan = {
  validUntil: Date | null;
  nguon: NguonHan;
  /** Mốc dùng để cộng chu kỳ — khác `issuedAt` với hồ sơ công nhận tương đương. */
  mocTinh: Date;
  soThang: number | null;
};

/**
 * SUY HẠN HIỆU LỰC — 3 bước của HỢP ĐỒNG V2 §Z3.
 *
 *  (1) lượt thuộc một `TrnRequirement` có chu kỳ ⇒ mốc + `TrnRequirement.validityMonths`
 *  (2) không thuộc yêu cầu nào ⇒ `TrnProgram.validityMonths`
 *  (3) cả hai NULL ⇒ `validUntil = NULL`, VÔ THỜI HẠN
 *
 * ⚠️ `null` ở đây nghĩa là VÔ THỜI HẠN, không phải "chưa tính được". Hai nghĩa đó
 * trông giống hệt nhau trong DB và khác nhau hoàn toàn với người đọc tấm chứng nhận.
 * Vì vậy hàm trả kèm `nguon`: gọi xong vẫn biết mình đang ở nhánh nào, thay vì nhìn
 * một ô trống rồi đoán.
 *
 * ⚠️ `mocTinh` KHÔNG luôn là `issuedAt`. Với hồ sơ CÔNG NHẬN TƯƠNG ĐƯƠNG (EL-09),
 * hạn tính từ `originalEffectiveAt` — ngày người ta thật sự đạt nội dung đó. Lấy
 * ngày bấm nút công nhận làm mốc là kéo dài hiệu lực của một chứng chỉ cũ thêm trọn
 * một chu kỳ, tức hệ thống tự cấp cho mình quyền gia hạn thứ nó chỉ đang ghi nhận.
 */
export function suyHanHieuLuc(input: {
  issuedAt: Date;
  /** Chu kỳ ngắn nhất trong các yêu cầu ÁP DỤNG — `null` nếu không có. */
  chuKyTuYeuCau: number | null;
  /** `TrnProgram.validityMonths` — chỉ là mặc định, dùng ở bước 2. */
  chuKyTuChuongTrinh: number | null;
  /** `TrnEquivalence.originalEffectiveAt` nếu lượt này đến từ công nhận tương đương. */
  mocGoc?: Date | null;
}): KetQuaHan {
  const mocTinh = input.mocGoc ?? input.issuedAt;

  if (input.chuKyTuYeuCau != null && input.chuKyTuYeuCau > 0) {
    return {
      validUntil: congThang(mocTinh, input.chuKyTuYeuCau),
      nguon: "YEU_CAU",
      mocTinh,
      soThang: input.chuKyTuYeuCau,
    };
  }

  if (input.chuKyTuChuongTrinh != null && input.chuKyTuChuongTrinh > 0) {
    return {
      validUntil: congThang(mocTinh, input.chuKyTuChuongTrinh),
      nguon: "CHUONG_TRINH",
      mocTinh,
      soThang: input.chuKyTuChuongTrinh,
    };
  }

  return { validUntil: null, nguon: "VO_THOI_HAN", mocTinh, soThang: null };
}

export type TrangThaiHienThi = "VALID" | "EXPIRED" | "REVOKED";

/**
 * TRẠNG THÁI ĐỂ HIỂN THỊ — suy ra, KHÔNG đọc thẳng cột `status`.
 *
 * ⚠️ Đây là điểm dễ sai nhất của cả ticket, và nó sai theo hướng tệ nhất.
 *
 * Cột `status` là bộ nhớ đệm do cron cập nhật. Cron chạy mỗi ngày; hạn hiệu lực thì
 * trôi qua vào đúng một khoảnh khắc. Giữa hai lần chạy — hoặc bất cứ lần nào cron
 * lỗi, bị treo, hay chưa đăng ký — cột ấy nói VALID trong khi tấm chứng nhận đã hết
 * hạn. Và nơi đọc nó là **trang xác minh công khai**, tức đúng nơi được dựng lên để
 * làm nguồn sự thật cho người ngoài.
 *
 * Nói cách khác: tin cột `status` là để hệ thống nói dối người đi kiểm tra, ở đúng
 * chỗ nó được thiết kế để không nói dối.
 *
 * `REVOKED` thì ngược lại — nó là QUYẾT ĐỊNH của con người, không suy được từ ngày
 * tháng, nên chỗ đó cột `status` mới là nguồn.
 */
export function trangThaiHienThi(
  cert: { status: string; validUntil: Date | null },
  now: Date,
): TrangThaiHienThi {
  if (cert.status === "REVOKED") return "REVOKED";
  if (cert.validUntil != null && cert.validUntil.getTime() <= now.getTime()) {
    return "EXPIRED";
  }
  return "VALID";
}

/** Câu hiện trên trang xác minh — nói rõ, không để người đọc tự suy. */
export function cauTrangThai(
  tt: TrangThaiHienThi,
  cert: { validUntil: Date | null; revokedAt: Date | null },
): string {
  const ngay = (d: Date) => d.toLocaleDateString("vi-VN");
  switch (tt) {
    case "REVOKED":
      return cert.revokedAt
        ? `Đã thu hồi ngày ${ngay(cert.revokedAt)}`
        : "Đã thu hồi";
    case "EXPIRED":
      return cert.validUntil
        ? `Đã hết hiệu lực ngày ${ngay(cert.validUntil)}`
        : "Đã hết hiệu lực";
    default:
      return cert.validUntil
        ? `Còn hiệu lực đến ngày ${ngay(cert.validUntil)}`
        : "Còn hiệu lực — không thời hạn";
  }
}

/**
 * Lượt ghi danh này ĐỦ ĐIỀU KIỆN cấp chứng nhận chưa.
 *
 * Hai điều kiện, và cả hai đều cần:
 *  · `status` đã hoàn thành (kể cả hoàn thành TRỄ — trễ là một sự thật cần ghi lại,
 *    không phải lý do từ chối chứng từ; báo cáo tuân thủ đọc `isLate` riêng);
 *  · `verifiedAt` có giá trị — tức hệ thống đã KIỂM CHỨNG, không chỉ đánh dấu xong.
 *
 * ⚠️ Lượt bị THU HỒI (`revokedAt`) thì không, dù `status` còn sót giá trị cũ.
 */
export const TRANG_THAI_DU_CAP = ["COMPLETED", "COMPLETED_LATE"] as const;

export function duDieuKienCap(gd: {
  status: string;
  verifiedAt: Date | null;
  revokedAt: Date | null;
}): boolean {
  if (gd.revokedAt != null) return false;
  if (gd.verifiedAt == null) return false;
  return (TRANG_THAI_DU_CAP as readonly string[]).includes(gd.status);
}

/** Gom bước khớp yêu cầu + suy hạn — để đường ghi chỉ gọi một chỗ. */
export function tinhHanChoLuot(input: {
  issuedAt: Date;
  nguoi: Parameters<typeof khopYeuCau>[0];
  dsYeuCau: YeuCauDeKhop[];
  chuKyTuChuongTrinh: number | null;
  mocGoc?: Date | null;
}): KetQuaHan & { khongDoiChieuDuoc: { yeuCau: YeuCauDeKhop; lyDo: string }[] } {
  const khop = khopYeuCau(input.nguoi, input.dsYeuCau);
  const han = suyHanHieuLuc({
    issuedAt: input.issuedAt,
    chuKyTuYeuCau: chuKyNganNhat(khop.apDung),
    chuKyTuChuongTrinh: input.chuKyTuChuongTrinh,
    mocGoc: input.mocGoc,
  });
  return { ...han, khongDoiChieuDuoc: khop.khongDoiChieuDuoc };
}
