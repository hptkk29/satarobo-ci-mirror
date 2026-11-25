import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { canonicalPhone } from "@/lib/phone";
import { sendZaloNotification } from "@/lib/zalo/service";
import { buildAccountZnsParams } from "@/lib/zalo/templates";
import { isAuthPhoneProvisioningEnabled } from "@/lib/flags";

// =============================================================================
// BGĐ 31/07 — SAU KHI XÁC NHẬN THANH TOÁN: tự cấp tài khoản PHỤ HUYNH theo SĐT
// và báo qua Zalo (ZNS).
//
// Khác luồng cũ (lib/crm/convert-lead-v2.ts) vốn tạo tài khoản lúc CHUYỂN LEAD và
// bắt buộc EMAIL: ở đây khoá định danh là SĐT (User.phone unique — AUTH-SĐT P3),
// email chỉ là tuỳ chọn. Phụ huynh đăng nhập bằng SĐT.
//
// IDEMPOTENT: đã có tài khoản theo SĐT (hoặc email) → KHÔNG tạo lại, KHÔNG gửi lại
// thông báo. Gọi được nhiều lần từ cả xác nhận tay lẫn webhook SePay.
//
// Tài khoản tạo ra ở trạng thái PENDING_ACTIVATION (chưa có mật khẩu) — phụ huynh
// tự đặt mật khẩu ở /kich-hoat. Không sinh/gửi mật khẩu qua ZNS.
// =============================================================================

/**
 * Mã mẫu ZNS "Cấp tài khoản". SETTING (DB) thắng, env là dự phòng.
 * Công tắc `zalo.znsAccountEnabled` TẮT → không gửi, nhưng mã mẫu GIỮ NGUYÊN
 * (tắt/bật không làm mất số đã nhập). Chốt 07/08.
 */
async function znsAccountTemplate(): Promise<string | null> {
  const enabled = await getSetting("zalo.znsAccountEnabled").catch(() => false);
  if (!enabled) return null; // công tắc TẮT → không gửi, nhưng mã mẫu vẫn giữ nguyên
  const fromDb = await getSetting("zalo.znsTemplateAccount").catch(() => null);
  return (fromDb || process.env.ZALO_ZNS_TEMPLATE_ACCOUNT || "").trim() || null;
}
// Domain CHÍNH (không phải hocvien.*) — /kich-hoat mở trên mọi host (route-policy
// PUBLIC_OTP_PATHS), và người được cấp TK không chỉ phụ huynh: nhân viên, cơ sở
// nhượng quyền cũng đi link này (chốt chủ dự án 02/08).
const PORTAL_ACTIVATE_URL = "https://satarobo.vn/kich-hoat";

export type ProvisionParentResult =
  | { ok: true; created: boolean; userId: string }
  | { ok: false; reason: string };

/**
 * Bảo đảm phụ huynh của đơn `orderId` có tài khoản portal (khoá = SĐT).
 * Best-effort: không throw — lỗi chỉ log, không chặn luồng tiền.
 */
export async function ensureParentAccountForOrder(
  orderId: string,
): Promise<ProvisionParentResult> {
  // AUTH-SĐT P5 — công tắc ngắt. Đặt TRƯỚC mọi truy vấn: khi kéo cờ là lúc đang
  // có sự cố, đường này phải im hoàn toàn chứ không phải "chạy nhưng không ghi".
  // Cả 2 chỗ gọi đều fire-and-forget nên không ai đọc `reason` — vì vậy log lại,
  // nếu không thì tắt xong sẽ không có dấu vết nào cho biết đã bỏ qua bao nhiêu đơn.
  if (!isAuthPhoneProvisioningEnabled()) {
    console.warn(`[parent-provision] BỎ QUA đơn ${orderId} — AUTH_PHONE_PROVISIONING=false`);
    return { ok: false, reason: "Đường tự cấp tài khoản đang tắt (AUTH_PHONE_PROVISIONING=false)" };
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      centerId: true,
      studentId: true,
    },
  });
  if (!order) return { ok: false, reason: "Không tìm thấy đơn" };

  const phone = canonicalPhone(order.customerPhone);
  if (!phone) return { ok: false, reason: "Đơn không có SĐT hợp lệ" };

  const email = order.customerEmail?.trim().toLowerCase() || null;

  // Đã có tài khoản (theo SĐT, hoặc theo email của đơn) → chỉ bổ sung SĐT nếu thiếu.
  const existing = await db.user.findFirst({
    where: email ? { OR: [{ phone }, { email }] } : { phone },
    select: { id: true, phone: true, deletedAt: true },
  });
  if (existing && !existing.deletedAt) {
    if (!existing.phone) {
      await db.user
        .update({ where: { id: existing.id }, data: { phone } })
        .catch(() => {}); // SĐT đã thuộc user khác → bỏ qua, không phá dữ liệu
    }
    await linkStudentToParent(order.studentId, existing.id);
    return { ok: true, created: false, userId: existing.id };
  }

  let created;
  try {
    created = await db.user.create({
      data: {
        phone,
        email,
        name: order.customerName,
        role: "PARENT",
        roles: ["PARENT"],
        accountStatus: "PENDING_ACTIVATION", // chưa có mật khẩu — PH tự đặt ở /kich-hoat
        centerId: order.centerId,
      },
      select: { id: true },
    });
  } catch (err) {
    // Race 2 webhook/2 lần bấm cùng lúc → unique(phone) → coi như đã có.
    const again = await db.user.findUnique({ where: { phone }, select: { id: true } });
    if (again) {
      await linkStudentToParent(order.studentId, again.id);
      return { ok: true, created: false, userId: again.id };
    }
    console.error("[parent-provision] create failed:", err);
    return { ok: false, reason: "Không tạo được tài khoản phụ huynh" };
  }

  await linkStudentToParent(order.studentId, created.id);

  // Báo phụ huynh qua ZNS (fallback email nếu đơn có email). KHÔNG kèm mật khẩu.
  //
  // ⚠️ Tham số dựng qua `buildAccountZnsParams` để khớp bảng khai của mẫu 616899
  // (chỉ `name` ≤30 + `login_id` ≤15 — đường dẫn kích hoạt nằm trong nội dung
  // TĨNH của mẫu, không phải tham số). Bản trước gửi thêm `login_url` và không
  // cắt `name`: tên dài >30 là Zalo từ chối, mà `.catch(() => {})` dưới nuốt
  // sạch nên không ai biết. Bài học PR #77.
  await sendZaloNotification({
    toPhone: phone,
    templateKey: await znsAccountTemplate(),
    params: buildAccountZnsParams({ customerName: order.customerName, phone }),
    fallbackEmail: email
      ? {
          to: email,
          toName: order.customerName,
          subject: "Tài khoản phụ huynh Sata Robo",
          bodyText: `Chào ${order.customerName},\nTrung tâm đã tạo tài khoản theo dõi học tập cho quý phụ huynh.\n- Tài khoản đăng nhập: ${phone}\n- Kích hoạt & đặt mật khẩu tại: ${PORTAL_ACTIVATE_URL}\n\n— Trung tâm Sata Robo`,
        }
      : null,
  }).catch(() => {});

  return { ok: true, created: true, userId: created.id };
}

/** Gắn học viên của đơn về phụ huynh (chỉ khi HV chưa có phụ huynh). */
async function linkStudentToParent(
  studentId: string | null,
  parentUserId: string,
): Promise<void> {
  if (!studentId) return;
  await db.student
    .updateMany({
      where: { id: studentId, parentUserId: null },
      data: { parentUserId },
    })
    .catch(() => {});
}
