import "server-only";
import { db } from "@/lib/db";

/**
 * Tra một phương thức thanh toán theo MÃ, CỐ Ý KHÔNG QUA `scopedDb`.
 *
 * ⚠️ VÌ SAO PHẢI KHÔNG-SCOPE — đây là chỗ dễ tự bắn vào chân nhất của cả đợt sửa.
 * Cổng chặn "phương thức của cơ sở khác" hoạt động theo kiểu: tra mã ra cơ sở sở hữu,
 * rồi so với cơ sở của đơn. Nếu câu tra ĐÓ đi qua `scopedDb`, thì đúng mã cần chặn —
 * mã của cơ sở KHÁC — lại bị scope lọc mất và trả `null`; cổng đọc `null` thành "mã lạ,
 * cho qua" và **cửa mở toang đúng lúc đáng lẽ phải đóng**. Câu chặn không được dùng
 * chính bộ lọc mà nó đang đi chặn người vượt.
 *
 * An toàn vì: (a) `code` là `@unique` TOÀN CỤC nên tra theo mã không mơ hồ; (b) thứ trả
 * ra chỉ là `centerId` — không tên, không số tài khoản (tài khoản nằm ở IntegrationConfig,
 * không ở bảng này); (c) kết quả CHỈ dùng để TỪ CHỐI, không bao giờ để hiển thị hay để
 * nới quyền. Mọi đường ĐỌC danh sách cho người dùng vẫn đi `scopedDb` như cũ.
 */
export type MethodCenterLookup =
  /** Mã khớp một dòng danh mục. `centerId` null = phương thức dùng chung. */
  | { found: true; centerId: string | null }
  /**
   * Mã KHÔNG khớp dòng nào. `Payment.method` là chuỗi tự do và trong sổ đang có giá trị
   * cũ ("auto" do đường ghi tự động sinh, nhãn nhập tay trước khi có danh mục). Chặn
   * cứng mọi chuỗi lạ là khoá luôn những khoản hợp lệ đã tồn tại ⇒ caller cho qua.
   */
  | { found: false; centerId: null };

export async function lookupMethodCenterByCode(
  code: string,
): Promise<MethodCenterLookup> {
  const row = await db.paymentMethod.findUnique({
    where: { code },
    select: { centerId: true },
  });
  return row ? { found: true, centerId: row.centerId } : { found: false, centerId: null };
}

/**
 * Mã này đã có chủ chưa — dùng cho kiểm TRÙNG MÃ ở màn danh mục.
 *
 * Cũng phải KHÔNG-SCOPE, vì `code` unique toàn cục: hỏi bằng câu có scope thì actor CS1
 * đặt trùng mã của CS2 sẽ được báo "chưa ai dùng", lưu xuống rồi mới ăn lỗi unique thô
 * của Postgres — thông báo không đọc được và không nói phải sửa gì.
 */
export async function paymentMethodCodeTaken(
  code: string,
  exceptId?: string,
): Promise<boolean> {
  const row = await db.paymentMethod.findUnique({
    where: { code },
    select: { id: true },
  });
  if (!row) return false;
  return row.id !== exceptId;
}

/**
 * TÊN hiển thị của một phương thức theo mã — cũng KHÔNG-SCOPE, và cũng có lý do.
 *
 * Dùng cho phiếu thu PDF (đưa tận tay phụ huynh) và các chỗ chỉ cần dịch mã ra chữ.
 * Scope câu này là in ra mã nội bộ ("BANK_CS1") trên giấy gửi ra ngoài công ty, đúng
 * lúc người xem chỉ thiếu tầm nhìn cơ sở chứ không thiếu quyền xem chính khoản thu đó —
 * quyền với khoản thu đã được kiểm ở tầng trên rồi.
 *
 * KHÔNG lọc `isActive`: phương thức đã tắt vẫn phải in đúng tên trên phiếu thu CŨ.
 * Thứ trả ra chỉ là một cái tên, không kèm cơ sở, không kèm số tài khoản.
 */
export async function lookupMethodNameByCode(
  code: string,
): Promise<string | null> {
  const row = await db.paymentMethod.findUnique({
    where: { code },
    select: { name: true },
  });
  return row?.name ?? null;
}
