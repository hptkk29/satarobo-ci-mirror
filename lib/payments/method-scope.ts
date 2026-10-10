// method-scope.ts — MỘT chỗ trả lời câu "phương thức thanh toán nào dùng được ở đây".
//
// VÌ SAO TỒN TẠI: trước đợt 30/08/2026 câu trả lời đó bị CHÉP 4 LẦN với 3 hình dạng
// khác nhau — `allowedMap` trong createOrderManualAction (orders/_actions.ts), lại một
// `allowedMap` nữa trong updateOrderPaymentMethodAction, `pmAllowedForType` dạng switch
// trong order-detail-client.tsx, và `availablePMs` dạng filter trong order-create-form.tsx.
// Thêm chiều "cơ sở" vào bốn bản chép rời nhau là gần như chắc chắn quên một chỗ; và chỗ
// quên sẽ là một ĐƯỜNG GHI (Server Action = endpoint riêng, lọc ở client vô nghĩa).
//
// File này THUẦN, không import Prisma/DB/server-only — để test Vitest chạy không cần DB
// và để client component import được cùng một luật với Server Action.

/** Loại đơn hàng mà một phương thức có thể phục vụ. Khớp `OrderType` của Prisma. */
export type OrderTypeForMethod = "COURSE" | "PACKAGE" | "EXAM" | "PRODUCT";

/** Phần dữ liệu TỐI THIỂU của một phương thức mà mọi luật dưới đây cần. */
export type MethodScopeInput = {
  /** null = phương thức DÙNG CHUNG mọi cơ sở. */
  centerId: string | null;
  canBuyCourse: boolean;
  canBuyPackage: boolean;
  canBuyExam: boolean;
  canBuyProduct: boolean;
};

/**
 * Phương thức có phục vụ được cơ sở này không.
 *
 * Hai luật, và luật thứ hai là thứ khiến hệ thống không tự khoá chính nó:
 *  1. `method.centerId === null` → DÙNG CHUNG, hợp lệ với mọi cơ sở (kể cả đơn chưa
 *     gắn cơ sở). Đây là 4 dòng seed gốc (CASH/BANK_TRANSFER/VNPAY/TINGEE) và mọi
 *     dòng có trước 30/08/2026.
 *  2. Đơn KHÔNG gắn cơ sở (`orderCenterId == null`) → CHỈ dùng được phương thức chung.
 *     Đơn loại này có thật và hợp lệ: form tạo đơn có mục "— Không gán —" và vai giữ
 *     `orders:manage` được phép chọn (orders/_components/order-create-form.tsx). Nếu
 *     luật này trả false cho mọi thứ thì đơn không-cơ-sở hết đường tạo — đúng cái bẫy
 *     "danh sách rỗng nên không lưu được" phải tránh.
 */
export function methodServesCenter(
  method: Pick<MethodScopeInput, "centerId">,
  orderCenterId: string | null | undefined,
): boolean {
  if (method.centerId === null || method.centerId === undefined) return true;
  return method.centerId === (orderCenterId ?? null);
}

/** Phương thức có bật cờ cho LOẠI đơn này không (gộp 4 bản chép cũ về một chỗ). */
export function methodAllowsOrderType(
  method: Pick<
    MethodScopeInput,
    "canBuyCourse" | "canBuyPackage" | "canBuyExam" | "canBuyProduct"
  >,
  type: OrderTypeForMethod | string,
): boolean {
  switch (type) {
    case "COURSE":
      return method.canBuyCourse;
    case "PACKAGE":
      return method.canBuyPackage;
    case "EXAM":
      return method.canBuyExam;
    case "PRODUCT":
      return method.canBuyProduct;
    default:
      // Loại đơn lạ (enum mở rộng mà quên khai ở đây) → fail-closed. Thà chặn và bị
      // báo còn hơn cho tiền đi bằng một đường chưa ai duyệt.
      return false;
  }
}

/** Vừa đúng cơ sở, vừa đúng loại đơn — luật đầy đủ cho một lần chọn phương thức. */
export function methodUsableForOrder(
  method: MethodScopeInput,
  orderCenterId: string | null | undefined,
  type: OrderTypeForMethod | string,
): boolean {
  return methodServesCenter(method, orderCenterId) && methodAllowsOrderType(method, type);
}

/**
 * Lọc danh sách theo cơ sở. Giữ generic để dùng được cho cả hàng đã `select` gọn ở RSC
 * lẫn bản ghi đầy đủ.
 */
export function filterMethodsForCenter<T extends Pick<MethodScopeInput, "centerId">>(
  methods: readonly T[],
  orderCenterId: string | null | undefined,
): T[] {
  return methods.filter((m) => methodServesCenter(m, orderCenterId));
}

/**
 * Một cơ sở chọn được ở ô "Cơ sở áp dụng" của form phương thức thanh toán.
 *
 * Kiểu để ở file THUẦN (không `server-only`) vì cả RSC lẫn client component đều cần:
 * loader `lib/payments/center-options.ts` trả về nó, form nhận nó qua props. Khai hai
 * bản ở hai nơi là mở đường cho hai bên lệch field mà typecheck vẫn xanh.
 *
 * ⚠️ 31/08/2026 — bỏ field `bank`. Tài khoản nhận tiền nay nằm TRÊN CHÍNH phương thức
 * (cột `PaymentMethod.bank*`), không còn tra theo cơ sở nữa, nên form không cần biết
 * "cơ sở này đang có tài khoản gì".
 */
export type CenterPaymentOption = {
  id: string;
  name: string;
};

/**
 * Được phép GHI lên một dòng danh mục có nghĩa "dùng chung" hay không.
 *
 * ⚠️ VÌ SAO TỒN TẠI — đây là lỗ hổng ĐÃ TÁI HIỆN ĐƯỢC, không phải lo xa. `passesScope`
 * trả `true` cho dòng `centerId = null` với MỌI actor (đúng theo nghĩa NULL_IS_GLOBAL:
 * ai cũng ĐỌC được). Nhưng "ai cũng đọc được" không kéo theo "ai cũng SỬA được", mà hai
 * cổng update/toggle chỉ dựa vào `passesScope`. Hệ quả đo thật:
 *
 *   Kế toán CS1 mở phương thức "Tiền mặt" (dùng chung), đổi ô "Cơ sở áp dụng" sang CS1,
 *   bấm Lưu. Cả hai guard đều pass (nguồn null → true; đích CS1 → true). Sau lượt lưu
 *   đó CS2 còn ĐÚNG 0 phương thức thanh toán — mất sạch đường thu tiền, do một người
 *   không có quyền gì với CS2 bấm nhầm một ô.
 *
 * LUẬT: đụng vào dòng dùng chung — dù là SỬA nó, KÉO nó về một cơ sở, hay ĐẨY một
 * phương thức riêng thành dùng chung — đòi tầm nhìn TOÀN HỆ THỐNG (Hội sở/SUPER_ADMIN).
 * Người cấp cơ sở vẫn toàn quyền với phương thức CỦA CƠ SỞ MÌNH.
 *
 * Hàm để ở file THUẦN (không phải trong Server Action) có chủ đích: so `centerId` ngay
 * trong action là đúng thứ lint `no-inline-authz` (TS-03) cấm. Action chỉ gọi một hàm
 * boolean và truyền vào kết quả của cổng scope chuẩn.
 */
export function canWriteSharedMethod(opts: {
  /** Cơ sở HIỆN TẠI của dòng. `undefined` = đang TẠO MỚI (chưa có dòng nào). */
  currentCenterId?: string | null;
  /** Cơ sở SAU khi ghi. Với toggle thì truyền đúng giá trị hiện tại. */
  nextCenterId: string | null;
  /** Actor có tầm nhìn mọi cơ sở không — `getModelVisibleCenterIds(...) === "ALL"`. */
  actorSeesAllCenters: boolean;
}): boolean {
  const touchesShared =
    opts.currentCenterId === null || opts.nextCenterId === null;
  return touchesShared ? opts.actorSeesAllCenters : true;
}

/** Câu từ chối khi người cấp cơ sở với tay vào dòng dùng chung. */
export const SHARED_METHOD_FORBIDDEN =
  "Phương thức DÙNG CHUNG thuộc về toàn hệ thống — chỉ Hội sở sửa được. Bạn có thể tạo/sửa phương thức riêng của cơ sở mình.";

/**
 * Câu từ chối dùng CHUNG cho mọi đường ghi, để sale đọc là biết phải làm gì thay vì
 * gặp "Dữ liệu không hợp lệ" chung chung.
 */
export const METHOD_WRONG_CENTER_ERROR =
  "Phương thức thanh toán này thuộc cơ sở khác. Chọn phương thức của cơ sở trên đơn, hoặc một phương thức dùng chung.";
