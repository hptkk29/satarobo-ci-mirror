"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { isZalocrmEnabled } from "@/lib/flags";
import { dongBoNick } from "@/lib/integrations/zalocrm/nick-admin";
import { setMisaEnabled, getMisaConfig, syncToMisa } from "@/lib/misa/service";
import { canonicalPhone, formatPhoneVN } from "@/lib/phone";
import { zaloOtpProvider } from "@/lib/zalo/otp-provider";
import { znsProvider } from "@/lib/zalo/provider";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit/audit-log";
import { randomInt } from "crypto";
import { getSetting } from "@/lib/settings/service";

// C6 — bật/tắt MISA + chạy thử sync. Gate settings:edit (SUPER_ADMIN).

export async function toggleMisa(): Promise<{ ok: boolean; error?: string; enabled?: boolean }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("settings:edit"))) return { ok: false, error: "Không có quyền" };

  const cur = await getMisaConfig();
  await setMisaEnabled(!cur.isEnabled);
  revalidatePath("/admin/tich-hop");
  return { ok: true, enabled: !cur.isEnabled };
}

export async function testMisaSync(): Promise<{ ok: boolean; error?: string; status?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("settings:edit"))) return { ok: false, error: "Không có quyền" };

  const res = await syncToMisa({ action: "TEST_PING", payload: { ping: true, at: "manual-test" } });
  revalidatePath("/admin/tich-hop");
  return { ok: true, status: res.status };
}

/**
 * AUTH-SĐT P4 — gửi thử 1 tin ZNS mẫu Xác thực (bước 1 checklist "Bật live",
 * docs/otp-service.md). Luồng OTP tới SĐT chỉ có từ P5, nên trước đó KHÔNG có
 * đường nào trong giao diện chạm tới ZNS — không có nút này thì không kiểm được
 * template/tên tham số trước khi mở cho phụ huynh thật.
 *
 * Tiền thật: mỗi tin gửi THÀNH CÔNG tốn ~300đ (QĐ-E) ⇒ gate `settings:edit` +
 * trần 5 lần/giờ/người + ghi audit. Mã gửi đi là số ngẫu nhiên KHÔNG gắn với
 * tài khoản nào (không tạo `OtpRequest`) — chỉ để đối chiếu nội dung tin.
 */
export async function sendZnsTest(
  input: unknown,
): Promise<{ ok: boolean; error?: string; detail?: string; live?: boolean }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("settings:edit"))) return { ok: false, error: "Không có quyền" };

  const phone = canonicalPhone((input as { phone?: unknown })?.phone);
  if (!phone) return { ok: false, error: "Số điện thoại không hợp lệ (chỉ nhận di động VN)" };

  const rl = await rateLimit({ key: `zns-test:${session.user.id}`, max: 5, windowMs: 3_600_000 });
  if (!rl.success) return { ok: false, error: "Đã gửi thử quá 5 lần trong 1 giờ. Thử lại sau." };

  // 07/08 — công tắc live nay ở SystemSetting; isLive() chỉ còn đọc env nên dùng
  // trần sẽ báo SAI trạng thái cho người vận hành. Đọc cùng công thức với provider.
  const live =
    znsProvider.isConfigured() &&
    ((await getSetting("zalo.znsLive").catch(() => false)) || process.env.ZALO_LIVE === "true");
  const code = String(randomInt(100000, 1000000));
  const res = await zaloOtpProvider.send({
    target: phone,
    code,
    purpose: "ACTIVATION",
    minutesValid: 5,
  });

  await writeAudit({
    actor: {
      id: session.user.id,
      name: session.user.name ?? session.user.email ?? session.user.id,
    },
    module: "integrations",
    entityType: "ZaloZnsTest",
    entityId: phone,
    action: "SEND_TEST",
    newValues: { phone, live, ok: res.ok, error: res.error ?? null },
    reason: "Smoke ZNS mẫu Xác thực trước khi mở cho phụ huynh thật",
  });

  revalidatePath("/admin/tich-hop");
  if (!res.ok) return { ok: false, error: res.error ?? "Gửi thất bại", live };
  return {
    ok: true,
    live,
    detail: live
      ? `Đã gửi ZNS THẬT tới ${formatPhoneVN(phone)} — mã trong tin phải là ${code}`
      : `ZALO_LIVE chưa bật ở môi trường này nên chỉ MÔ PHỎNG, không có tin nào được gửi (mã giả lập ${code})`,
  };
}

// ⚠️ 31/08/2026 (theo `main`) — `setVietQrConfig` + `vietqrSchema` ĐÃ GỠ.
//
// Tài khoản nhận tiền nay khai trong từng phương thức thanh toán loại "Chuyển khoản"
// (`/admin/payment-methods`). Giữ lại action là giữ một CỬA GHI THỨ HAI vào kho cũ
// `IntegrationConfig` khoá `VIETQR:*` — kho mà đường đọc chỉ còn dùng làm lối LÙI. Ai gọi
// lại nó sẽ tạo ra tài khoản mà không màn nào hiển thị, còn mã QR thì đã ưu tiên tài khoản
// trên phương thức. (Bản trên nhánh `test` còn action này; hợp nhất 16/09 lấy theo `main`.)

// ─── S7 (lô L9) — đồng bộ nick ZaloCRM ──────────────────────────────────────

const dongBoNickSchema = z.object({
  // Khuôn giống hệt chỗ chặn `[org]` trên đường webhook và ô setting `zalocrm.orgCodes`
  // — ba nơi phải cùng một khuôn, kẻo khai được ở đây mà webhook 404 câm.
  orgCode: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,32}$/, "Mã tổ chức chỉ gồm chữ thường, số và dấu gạch ngang")
    .optional()
    .nullable(),
});

/**
 * Kéo danh sách nick Zalo từ máy chủ ZaloCRM về, cho mọi org trong tầm người bấm.
 *
 * Vì sao cần một nút: `ZaloCrmNick` hiện chỉ được điền bởi webhook
 * (`nap-su-kien.ts`) — tức một nick chỉ xuất hiện SAU KHI đã có khách nhắn qua nó.
 * Trước đó bảng trống, và "bảng trống" không phân biệt được với "webhook chưa cắm".
 * Nút này cho người vận hành dựng danh sách trước, để cái im lặng sau đó có nghĩa.
 *
 * ⚠️ KHÔNG chạm `lastEventAt` (xem `dongBoNick`): nếu bấm nút mà mốc sự kiện được ghi
 * mới, thì mỗi lần bấm cho yên tâm là một lần xoá đúng bằng chứng nói nick đã chết.
 *
 * Cách ly cơ sở nằm ở `nickCoTheGhi` trong lib, KHÔNG ở đây: `ZaloCrmNick` thuộc
 * `SCOPE_EXEMPT` nên `scopedDb` không che gì, và mọi đường GHI phải tự gác.
 */
export async function dongBoNickZalocrm(
  input: unknown,
): Promise<{ ok: boolean; error?: string; tomTat?: string; coLoi?: boolean }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("settings:edit"))) return { ok: false, error: "Không có quyền" };
  // Gate cờ ĐỨNG SAU gate quyền: người không có quyền không cần biết tính năng nào tồn tại.
  if (!isZalocrmEnabled()) return { ok: false, error: "Tính năng ZaloCRM đang tắt" };

  const parsed = dongBoNickSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  // Một lần bấm = N lượt HTTP sang một VPS sau Cloudflare Tunnel. Không tốn tiền như
  // ZNS, nhưng bấm liên tục là tự làm nghẽn máy chủ bên kia (và giữ invocation Vercel).
  const rl = await rateLimit({
    key: `zalocrm-sync-nicks:${session.user.id}`,
    max: 6,
    windowMs: 300_000,
  });
  if (!rl.success) return { ok: false, error: "Đã đồng bộ quá 6 lần trong 5 phút. Thử lại sau." };

  const actor = await resolveActor(session.user.id);
  const ketQua = await dongBoNick(actor, { orgCode: parsed.data.orgCode ?? null });
  revalidatePath("/admin/tich-hop");

  if (ketQua.length === 0) {
    // Hai lý do khác nhau, hai câu khác nhau: nói nhầm ở đây là người vận hành đi sửa
    // đúng chỗ không hỏng.
    return {
      ok: false,
      error: parsed.data.orgCode
        ? `Không thấy tổ chức ${parsed.data.orgCode} trong bảng ánh xạ zalocrm.orgCodes.`
        : "Chưa cơ sở nào được ánh xạ sang orgCode. Khai khoá zalocrm.orgCodes ở màn Cấu hình vận hành trước.",
    };
  }

  const tomTat = ketQua
    .map((r) =>
      r.ok
        ? `${r.orgCode}: nhận ${r.soNickNhan}, thêm ${r.soTao}, cập nhật ${r.soCapNhat}` +
          (r.soBoQua > 0 ? `, bỏ qua ${r.soBoQua}` : "")
        : `${r.orgCode}: LỖI ${r.ma}`,
    )
    .join(" · ");
  return { ok: true, tomTat, coLoi: ketQua.some((r) => !r.ok) };
}
