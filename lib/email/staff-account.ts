import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { sendEmail } from "./send";
import { renderTemplate } from "./render";
import { EMAIL_TEMPLATE_DEFS } from "./template-codes";
import { sendZaloNotification } from "@/lib/zalo/service";
import { buildAccountZnsParams } from "@/lib/zalo/templates";

// =============================================================================
// BGĐ 31/07 — thông báo CẤP TÀI KHOẢN / RESET MẬT KHẨU cho nhân sự.
//
// Email gửi TRỰC TIẾP (không qua EmailQueue): password plaintext không được phép
// nằm trong EmailQueue.payload / bodyText. EmailLog lưu bản ĐÃ MASK qua
// logBodyText/logBodyHtml của sendEmail.
//
// Zalo ZNS gửi kèm (khi cấu hình): CHỈ tài khoản + link đăng nhập, KHÔNG gửi
// mật khẩu qua ZNS — params bị lưu nguyên văn vào ZaloMessageLog.payload.
// Template id đọc từ env ZALO_ZNS_TEMPLATE_ACCOUNT (đăng ký với Zalo sau,
// tương tự 616128/616258); thiếu env → sendZaloNotification tự SKIP an toàn.
// =============================================================================

const MASK = "••••••••";
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

/** Link đăng nhập theo vai trò: GV thuần → site giáo viên, còn lại → admin. */
export function loginUrlForRoles(roles: string[]): string {
  const staffRoles = roles.filter((r) => r !== "PARENT");
  const teacherOnly = staffRoles.length > 0 && staffRoles.every((r) => r === "TEACHER");
  return teacherOnly
    ? "https://giaovien.satarobo.vn/login"
    : "https://admin.satarobo.vn/login";
}

export type StaffAccountNotifyInput = {
  /** Email nhận thông tin (bắt buộc để gửi được mật khẩu). */
  email: string | null;
  /** SĐT canonical 84… — vừa là tài khoản đăng nhập ưu tiên, vừa là kênh ZNS. */
  phone: string | null;
  name: string | null;
  roles: string[];
  /** Mật khẩu plaintext admin vừa đặt — CHỈ tồn tại trong scope gọi hàm. */
  password: string;
};

/**
 * Gửi email "Cấp tài khoản từ Sata Robo" (kèm mật khẩu, log mask) + ZNS thông
 * báo (không mật khẩu). Fire-and-forget an toàn: không throw.
 */
export async function notifyStaffAccountGranted(input: StaffAccountNotifyInput): Promise<void> {
  const loginId = input.phone ?? input.email ?? "";
  const loginUrl = loginUrlForRoles(input.roles);
  const staffName = input.name?.trim() || "bạn";

  // ── Email (kênh duy nhất mang mật khẩu) ──────────────────────────────────
  if (input.email) {
    try {
      // Ưu tiên template ACTIVE trong DB (admin sửa ở /admin/email-templates),
      // fallback bản mặc định trong code — cùng cơ chế worker EmailQueue.
      const def = EMAIL_TEMPLATE_DEFS.STAFF_ACCOUNT_GRANTED;
      const tpl = await db.emailTemplate
        .findUnique({ where: { code: "STAFF_ACCOUNT_GRANTED" } })
        .catch(() => null);
      const subjectSrc = tpl?.isActive ? tpl.subject : def.subject;
      const bodyTextSrc = tpl?.isActive ? tpl.bodyText : def.bodyText;
      const bodyHtmlSrc = tpl?.isActive ? tpl.bodyHtml : def.bodyHtml;

      const vars = { staffName, loginId, loginUrl };
      const render = (src: string, password: string) =>
        renderTemplate(src, { ...vars, password });

      await sendEmail({
        to: input.email,
        toName: input.name ?? undefined,
        subject: renderTemplate(subjectSrc, vars),
        bodyText: render(bodyTextSrc, input.password),
        bodyHtml: render(bodyHtmlSrc, input.password),
        // Bản lưu EmailLog: mật khẩu thay bằng mask.
        logBodyText: render(bodyTextSrc, MASK),
        logBodyHtml: render(bodyHtmlSrc, MASK),
        templateId: tpl?.isActive ? tpl.id : null,
        contextType: "STAFF_ACCOUNT_GRANTED",
        contextId: loginId,
        triggerType: "USER_ACTION",
      });
    } catch (err) {
      console.error("[staff-account] send email failed:", err);
    }
  }

  // ── Zalo ZNS (không mật khẩu) ────────────────────────────────────────────
  if (input.phone) {
    await sendZaloNotification({
      toPhone: input.phone,
      templateKey: await znsAccountTemplate(),
      // Params qua buildAccountZnsParams để khớp bảng khai mẫu 616899 (chỉ
      // `name` ≤30 + `login_id` ≤15; KHÔNG có `login_url`). Bản trước dựng tay
      // {name, login_id, login_url}: name không cắt 30 ký tự → tên dài bị Zalo
      // từ chối khi live — đúng lớp bug PR #77 đã vá ở provision.ts.
      params: buildAccountZnsParams({ customerName: staffName, phone: input.phone }),
      // Không fallback email — email chính thức (kèm mật khẩu) đã gửi ở trên.
      fallbackEmail: null,
    }).catch(() => {});
  }
}
