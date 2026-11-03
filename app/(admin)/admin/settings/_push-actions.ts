"use server";

// Đăng ký / gỡ THIẾT BỊ nhận thông báo đẩy — Web Push Đợt 3.
//
// Đặt cạnh `settings/actions.ts` và site giáo viên import sang, đúng tiền lệ đã có:
// `app/(teacher)/teacher/ho-so/_components/change-password-dialog.tsx` import `changePassword`
// từ chính thư mục này. Hai màn, một đường ghi.
//
// ⚠️ BA THỨ KHÔNG BAO GIỜ NHẬN TỪ CLIENT:
//   · `userId`     — lấy từ phiên. Nhận từ client là cho phép bất kỳ ai gắn thiết bị của mình
//                    vào tài khoản người khác rồi đọc trộm mọi thông báo của họ.
//   · `origin`     — suy từ header request. Client tự khai thì cột đó thành lời kể, không còn
//                    là số đo.
//   · `vapidKeyId` — suy từ chính khoá server đang dùng. Client không có cách nào biết đúng, và
//                    cột này sinh ra để phân biệt "khoá đã xoay" với "người dùng gỡ quyền".
//
// ⚠️ CHỈ GHI TỪ `parsed.data`. `webPushSubscriptionSchema` là `z.object` chế độ STRIP — nó BỎ
// khoá lạ chứ KHÔNG TỪ CHỐI, nên ghi từ input thô là mọi khoá lạ đi thẳng vào Prisma.

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { hasStaffRole } from "@/lib/auth/permissions";
import { webPushSubscriptionSchema } from "@/lib/push/subscription";
import { vapidKeyIdTuKhoa } from "@/lib/push/vapid";
import { originTuHeaders } from "@/lib/push/origin";
import { nhanEndpoint } from "@/lib/push/ket-qua";
import { writeAudit } from "@/lib/audit/audit-log";

export interface KetQuaThietBi {
  ok: boolean;
  error?: string;
  /**
   * Số dòng THẬT SỰ bị thu hồi (chỉ `huyThietBiTheoEndpointAction` đặt).
   *
   * Nơi gọi cần phân biệt "đã thu hồi dòng CỦA MÌNH" với "không có dòng nào khớp" — mà `ok`
   * không nói được điều đó (action cố ý trả `ok: true` khi 0 dòng khớp, xem chú thích ở đó).
   * Đường đăng xuất dùng con số này để quyết có `unsubscribe()` ở trình duyệt hay không: trên
   * môi trường MỘT ORIGIN (localhost, `test.satarobo.vn`) một người KHÔNG phải chủ endpoint
   * cũng chạy qua đó, và huỷ bừa là giết đăng ký của người khác.
   */
  soDong?: number;
}

/**
 * Chế độ hiển thị lúc đăng ký. Danh sách đóng theo spec `display-mode` của CSS — nhận chuỗi tự
 * do là mở một ô để client nhồi bất cứ gì vào cột dùng để CHẨN ĐOÁN.
 */
const displayModeSchema = z.enum([
  "standalone",
  "browser",
  "minimal-ui",
  "fullscreen",
  "window-controls-overlay",
]);

/**
 * Lý do thu hồi mà đường TỰ ĐỘNG được phép hồi sinh — và là lý do DUY NHẤT.
 *
 * ⚠️ Hằng dùng chung với `huyThietBiTheoEndpointAction` bên dưới. So chuỗi giữa hai nơi là thứ
 * lặng lẽ lệch nhau khi ai đó sửa câu chữ cho đẹp; giữ ĐÚNG MỘT nguồn.
 *
 * Vì sao đúng lý do này: nó được đặt bởi hai đường mà cả hai đều nghĩa là "cùng người, cùng máy,
 * vừa rời ghế" — nút "Tắt trên máy này" và nửa client của đăng xuất (`lib/auth/logout-client.ts`).
 * Nút "Tắt" còn cắm thêm cờ `da-tat-tay` ở trình duyệt nên đường tự động không tới được đây; phần
 * còn lại là đăng xuất, đúng ca mà Đợt 6 sinh ra để chữa.
 */
const LY_DO_TAT_MAY_NAY = "Tắt trên máy này";

const dangKySchema = z.object({
  subscription: webPushSubscriptionSchema,
  /** Cắt ngắn: một số trình duyệt trả chuỗi rất dài, và cột này chỉ để người trực nhìn. */
  userAgent: z.string().trim().max(500).optional(),
  deviceLabel: z.string().trim().max(100).optional(),
  displayMode: displayModeSchema.optional(),
  /**
   * Lượt ghi này đến từ đường TỰ ĐỘNG (`lib/push/tu-dang-ky-lai.ts`), không từ một cú bấm.
   *
   * ⚠️ Cờ này CHỈ SIẾT, không bao giờ nới — đó là lý do nhận nó từ client vẫn an toàn: kẻ gửi
   * `tuDong: false` chỉ nhận được đúng đường mà nút bấm tay vốn đã có, không thêm quyền nào.
   */
  tuDong: z.boolean().optional(),
});

const huyTheoIdSchema = z.object({ id: z.string().min(1) });
const huyTheoEndpointSchema = z.object({ endpoint: z.string().min(1) });

/** Ai được đăng ký thiết bị: nhân viên đã đăng nhập. Phụ huynh KHÔNG — phạm vi đã chốt. */
async function nhanSuDangNhap(): Promise<
  { ok: true; userId: string; ten: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  // Không tạo permission key mới: đây là thao tác TỰ PHỤC VỤ trên chính tài khoản mình, cùng
  // hạng với đổi mật khẩu. Thêm key mới sẽ kéo theo sửa 4 nơi + bấm tay `seed-prod-roles.yml`
  // trên prod, đổi lấy một lớp gác không quyết định gì thêm.
  if (!hasStaffRole(session.user)) return { ok: false, error: "Không có quyền" };
  // `ten` chỉ để ghi AuditLog cho ca CHUYỂN CHỦ đăng ký — `AuditLog.actorName` là cột chụp
  // ảnh, cố ý không join lại `User` (tên đổi thì sổ cũ vẫn phải đọc được như lúc ghi).
  return { ok: true, userId: session.user.id, ten: session.user.name ?? session.user.id };
}

/**
 * Ghi/đè đăng ký của MỘT thiết bị.
 *
 * UPSERT theo `endpoint` chứ không theo `(userId, endpoint)`: trình duyệt cấp lại đúng endpoint
 * cũ cho cùng máy + cùng khoá VAPID, và một máy DÙNG CHUNG có thể đổi người đăng nhập. Ghi đè
 * `userId` trong nhánh `update` là CÓ CHỦ ĐÍCH — nếu không, thông báo của người trước vẫn bắn
 * vào máy người sau đang cầm.
 */
// TỰ PHỤC VỤ: thao tác chỉ đụng thiết bị của CHÍNH người đang đăng nhập, cùng hạng với đổi
// mật khẩu. Cổng là `nhanSuDangNhap()` (phiên + hasStaffRole) và `userId` của phiên nằm trong
// MỌI câu ghi. KHÔNG tạo permission key riêng: nó không quyết định gì thêm mà kéo theo sửa 4
// nơi + bấm tay `seed-prod-roles.yml` trên prod.
//
// ⚠️ Dòng miễn trừ phải nằm NGAY TRƯỚC `export` — chèn chú thích xen vào giữa là nó vô hiệu,
// và ESLint chỉ báo "Unused eslint-disable directive" chứ không nói rule kia vẫn đang đỏ.
// eslint-disable-next-line authz/require-can-in-write-action
export async function dangKyThietBiAction(input: unknown): Promise<KetQuaThietBi> {
  const ai = await nhanSuDangNhap();
  if (!ai.ok) return { ok: false, error: ai.error };

  const parsed = dangKySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { subscription, userAgent, deviceLabel, displayMode, tuDong } = parsed.data;

  const origin = originTuHeaders(await headers());
  if (!origin) return { ok: false, error: "Không xác định được địa chỉ trang — thử tải lại." };

  const khoaCongKhai = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!khoaCongKhai) {
    // Nói thẳng thay vì ghi một dòng vô dụng: thiếu khoá thì đăng ký này không bao giờ nhận
    // được gì, và người vận hành cần biết ngay chứ không phải vào Đợt 4 mới phát hiện.
    return { ok: false, error: "Hệ thống chưa cấu hình khoá thông báo (VAPID)." };
  }
  const vapidKeyId = vapidKeyIdTuKhoa(khoaCongKhai);

  const sdb = scopedDb(await resolveActor(ai.userId));
  const now = new Date();
  const chung = {
    userId: ai.userId,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    origin,
    vapidKeyId,
    userAgent: userAgent ?? null,
    deviceLabel: deviceLabel || null,
    displayMode: displayMode ?? null,
    status: "ACTIVE" as const,
    lastSeenAt: now,
  };

  // ── CHUYỂN CHỦ (US-14b Đợt 5, lỗ §13.8b(b)) ──────────────────────────────────────────
  //
  // Trước bản vá này, `upsert` khoá theo MỖI `endpoint` và nhánh `update` ghi đè `userId` thành
  // người đang gọi, KHÔNG vế nào kiểm người gọi có thật sự sở hữu endpoint đó. Ai biết endpoint
  // của người khác thì gọi action với chuỗi ấy là chiếm luôn: nạn nhân mất push IM LẶNG (dòng
  // đã đổi chủ), còn máy của họ từ đó rung cho việc của kẻ chiếm. Và endpoint không khó biết —
  // `lib/push/thiet-bi.ts` đang trả nó ĐẦY ĐỦ xuống HTML trang /settings (bịt ở cùng commit).
  //
  // Không thể gác bằng "chứng minh sở hữu": trình duyệt là thứ duy nhất biết endpoint nào của
  // nó, và server không có cách nào xác thực điều đó. Nhưng ĐỔI CHỦ VẪN LÀ HÀNH VI ĐÚNG — máy
  // lễ tân dùng chung, người đang ngồi là chủ hợp pháp của endpoint trình duyệt vừa cấp, và
  // chính việc đổi chủ mới là thứ bảo vệ họ khỏi nhận thông báo của người trước. Nên chốt là:
  // cho đổi chủ, nhưng ĐỔI CHỦ KHÔNG ĐƯỢC IM LẶNG.
  //
  // ⚠️ Tra KHÔNG-SCOPE là CỐ Ý và là cả một bài học của repo (`lib/payments/method-lookup.ts`):
  // câu tra dùng để CHẶN mà bị lọc mất đúng dòng cần chặn thì nó trả null, và cổng đọc null
  // thành "không có gì, cho qua" ⇒ mở toang đúng lúc phải đóng. Ở đây an toàn: bảng không có
  // cột đơn vị và KHÔNG nằm trong `SCOPED_MODELS`, nên `scopedDb` không lọc gì — nhưng đừng
  // đổi câu này sang một đường có lọc.
  const dongCu = await sdb.webPushSubscription.findUnique({
    where: { endpoint: subscription.endpoint },
    select: { userId: true, status: true, revokedReason: true },
  });
  const chuyenChu = !!dongCu && dongCu.userId !== ai.userId;

  // ── CỔNG 5 — HAI LUẬT CHỈ ÁP CHO ĐƯỜNG TỰ ĐỘNG (US-14b Đợt 6, hai lỗ lăng kính tìm ra) ──
  //
  // Cả hai luật PHẢI ở server: client không có danh tính đáng tin, và cái máy cần chặn thì ta
  // không với tới được để cắm cờ.
  if (tuDong) {
    // LUẬT 1 — "người này đã từng ĐỒNG Ý trên trang này".
    //
    // Lỗ đã đo: quyền thông báo thuộc về ORIGIN, không thuộc về ai. Trên máy lễ tân dùng chung,
    // Sale A bấm "Bật" (quyền origin thành `granted` vĩnh viễn) rồi đăng xuất; Sale B đăng nhập
    // và lượt tải trang đầu tiên TỰ ghi danh B — B chưa bao giờ được hỏi, mà từ đó mọi lead của
    // B nổ trên màn hình khoá của cái máy đặt ở sảnh, kèm tên phụ huynh, trong tầm mắt khách
    // đang chờ. Cổng này đòi B từng có ÍT NHẤT MỘT dòng trên đúng origin đó — bất kể trạng thái,
    // vì dòng của một lần bật cũ đã bị đăng xuất đưa về `REVOKED`.
    //
    // Không dùng `scopedDb` cho câu tra này thì cũng không sao (bảng không thuộc `SCOPED_MODELS`),
    // nhưng vẫn đi qua `sdb` cho nhất quán với hai câu còn lại trong hàm.
    const tienSu = await sdb.webPushSubscription.findFirst({
      where: { userId: ai.userId, origin },
      select: { id: true },
    });
    if (!tienSu) {
      return {
        ok: false,
        error: "Chưa từng bật thông báo trên trang này — hãy bấm Bật thông báo một lần.",
      };
    }

    // LUẬT 2 — KHÔNG hồi sinh một dòng bị thu hồi vì lý do KHÁC "vừa rời ghế".
    //
    // Lỗ đã đo: nút "Gỡ" một thiết bị Ở XA (mất điện thoại, hoặc một máy ở cơ sở khác) không thể
    // `unsubscribe()` — ta không với tới trình duyệt đó. Trước Đợt 6, gỡ từ xa là DỨT ĐIỂM. Với
    // đường tự động, lượt tải trang kế tiếp trên đúng máy đó thấy đăng ký cũ còn sống, khoá vẫn
    // khớp, rồi nhánh `update` bên dưới dọn `revokedAt`/`revokedReason`/`failureCount` và đặt lại
    // `ACTIVE` ⇒ HỒI SINH ĐÚNG DÒNG VỪA GỠ, và danh sách thiết bị không có gì báo là nó đã quay
    // lại (`createdAt` vẫn là ngày cũ).
    //
    // Cũng chặn luôn hai ca cùng hình dạng: tài khoản bị xoá/vô hiệu hoá rồi bật lại, và dòng bị
    // chuyển chủ. Cả ba đều đòi một cú bấm tay — đúng, vì cả ba đều là một quyết định của con
    // người mà máy không được tự lật lại.
    if (dongCu && dongCu.status !== "ACTIVE" && dongCu.revokedReason !== LY_DO_TAT_MAY_NAY) {
      return {
        ok: false,
        error: "Thiết bị này đã bị gỡ — hãy bấm Bật thông báo nếu muốn nhận lại.",
      };
    }
  }

  if (chuyenChu) {
    // THU HỒI TRƯỚC, rồi mới ghi chủ mới — hai câu, không phải một.
    //
    // Vì sao không gộp vào `upsert`: nếu câu ghi chủ mới hỏng giữa đường (mạng, pooler chập)
    // thì trạng thái còn lại phải là "người cũ ĐÃ mất quyền", không phải "người cũ vẫn đang
    // nhận". Fail-safe đúng chiều — cùng lắm là người đang ngồi phải bấm lại một lần.
    //
    // ⚠️ `endpoint` là `@unique` TOÀN CỤC nên KHÔNG thể giữ dòng REVOKED cũ CẠNH một dòng mới:
    // trạng thái `REVOKED` dưới đây chỉ sống tới câu `upsert` ngay sau. Vết DÀI HẠN của lần
    // chuyển chủ nằm ở `AuditLog`, không nằm trong bảng này.
    await sdb.webPushSubscription.updateMany({
      // Lọc `status: "ACTIVE"` để KHÔNG ghi đè `revokedAt`/`revokedReason` của một lần thu hồi
      // TRƯỚC đó — đúng bất biến mà `lib/push/thu-hoi.test.ts` tự pin. Dòng đã `REVOKED` thì
      // không có gì để thu hồi nữa; nó vẫn được `upsert` ngay dưới đổi chủ + vẫn được ghi sổ,
      // vì `chuyenChu` xét THEO CHỦ chứ không theo trạng thái.
      where: { endpoint: subscription.endpoint, userId: { not: ai.userId }, status: "ACTIVE" },
      data: {
        status: "REVOKED",
        revokedAt: now,
        revokedReason: "Máy dùng chung — người khác đăng nhập và bật thông báo trên máy này",
      },
    });
  }

  await sdb.webPushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: { endpoint: subscription.endpoint, ...chung },
    // Hồi sinh một dòng đã REVOKED/EXPIRED: dọn sạch vết hỏng cũ, nếu không thì engine Đợt 4
    // đọc `failureCount` của lần trước và bỏ qua một thiết bị vừa được bật lại. Cũng là nhánh
    // dọn `revokedReason` mà bước chuyển chủ ở trên vừa đặt.
    update: { ...chung, revokedAt: null, revokedReason: null, failureCount: 0, lastErrorCode: null },
  });

  if (chuyenChu && dongCu) {
    // VẾT DÀI HẠN của lần chuyển chủ. Bảng `WebPushSubscription` không có chỗ giữ nó (một dòng
    // cho mỗi endpoint), nên `AuditLog` là nơi duy nhất trả lời được "máy nào đổi từ ai sang ai,
    // lúc nào" sau này.
    //
    // ⚠️ Ghi NHÃN CẮT (`host/…6 ký tự cuối`), TUYỆT ĐỐI không endpoint đầy đủ: endpoint là một
    // KHẢ NĂNG GỬI (ai có nó bắn được push rỗng vào máy nhân viên), và luật của việc này là
    // không để nó nguyên ở bất kỳ đâu — log, Sentry, hay AuditLog.
    //
    // Bọc try/catch: sổ hỏng không được chặn một thao tác tự phục vụ hợp lệ. Nhưng phải log to,
    // vì mất vết của đúng ca bảo mật này là mất thứ duy nhất còn lại.
    try {
      await writeAudit({
        actor: { id: ai.userId, name: ai.ten },
        module: "push",
        entityType: "WebPushSubscription",
        entityId: nhanEndpoint(subscription.endpoint),
        action: "TAKEOVER",
        oldValues: { userId: dongCu.userId, status: dongCu.status },
        newValues: { userId: ai.userId, status: "ACTIVE" },
        reason: "Máy dùng chung: người đang ngồi máy bật thông báo trên endpoint của người khác",
        userAgent: userAgent ?? null,
      });
    } catch (err) {
      console.error("[push] KHÔNG ghi được vết chuyển chủ đăng ký (thao tác vẫn thành công):", err);
    }
  }

  // Hai màn dùng chung component này — phải làm mới CẢ HAI, nếu không người dùng bật xong
  // vẫn thấy "Chưa có thiết bị nào" ngay cạnh dòng chữ "Đã bật".
  revalidatePath("/settings");
  revalidatePath("/teacher/ho-so");
  return { ok: true };
}

/**
 * Gỡ một thiết bị khỏi danh sách của CHÍNH MÌNH.
 *
 * `updateMany` với `userId` NẰM TRONG `where` là chốt chống IDOR: `scopedDb` không che đường
 * GHI, nên nếu chỉ lọc theo `id` thì ai biết id là gỡ được thiết bị của người khác. Và bảng này
 * không có cột đơn vị nên cũng không có lưới nào khác đỡ hộ.
 */
// TỰ PHỤC VỤ: thao tác chỉ đụng thiết bị của CHÍNH người đang đăng nhập, cùng hạng với đổi
// mật khẩu. Cổng là `nhanSuDangNhap()` (phiên + hasStaffRole) và `userId` của phiên nằm trong
// MỌI câu ghi. KHÔNG tạo permission key riêng: nó không quyết định gì thêm mà kéo theo sửa 4
// nơi + bấm tay `seed-prod-roles.yml` trên prod.
//
// ⚠️ Dòng miễn trừ phải nằm NGAY TRƯỚC `export` — chèn chú thích xen vào giữa là nó vô hiệu,
// và ESLint chỉ báo "Unused eslint-disable directive" chứ không nói rule kia vẫn đang đỏ.
// eslint-disable-next-line authz/require-can-in-write-action
export async function huyThietBiAction(input: unknown): Promise<KetQuaThietBi> {
  const ai = await nhanSuDangNhap();
  if (!ai.ok) return { ok: false, error: ai.error };

  const parsed = huyTheoIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Thiếu thiết bị cần gỡ" };

  const sdb = scopedDb(await resolveActor(ai.userId));
  const kq = await sdb.webPushSubscription.updateMany({
    where: { id: parsed.data.id, userId: ai.userId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: "Người dùng tự gỡ" },
  });
  if (kq.count === 0) return { ok: false, error: "Không tìm thấy thiết bị này" };

  // Hai màn dùng chung component này — phải làm mới CẢ HAI, nếu không người dùng bật xong
  // vẫn thấy "Chưa có thiết bị nào" ngay cạnh dòng chữ "Đã bật".
  revalidatePath("/settings");
  revalidatePath("/teacher/ho-so");
  return { ok: true };
}

/**
 * Tắt thông báo trên CHÍNH máy đang dùng — client đã gọi `subscription.unsubscribe()` trước.
 *
 * Tách khỏi hàm trên vì trình duyệt chỉ biết `endpoint` của mình, không biết id dòng.
 */
// TỰ PHỤC VỤ: thao tác chỉ đụng thiết bị của CHÍNH người đang đăng nhập, cùng hạng với đổi
// mật khẩu. Cổng là `nhanSuDangNhap()` (phiên + hasStaffRole) và `userId` của phiên nằm trong
// MỌI câu ghi. KHÔNG tạo permission key riêng: nó không quyết định gì thêm mà kéo theo sửa 4
// nơi + bấm tay `seed-prod-roles.yml` trên prod.
//
// ⚠️ Dòng miễn trừ phải nằm NGAY TRƯỚC `export` — chèn chú thích xen vào giữa là nó vô hiệu,
// và ESLint chỉ báo "Unused eslint-disable directive" chứ không nói rule kia vẫn đang đỏ.
// eslint-disable-next-line authz/require-can-in-write-action
export async function huyThietBiTheoEndpointAction(input: unknown): Promise<KetQuaThietBi> {
  const ai = await nhanSuDangNhap();
  if (!ai.ok) return { ok: false, error: ai.error };

  const parsed = huyTheoEndpointSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Thiếu endpoint" };

  const kq = await scopedDb(await resolveActor(ai.userId)).webPushSubscription.updateMany({
    where: { endpoint: parsed.data.endpoint, userId: ai.userId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: LY_DO_TAT_MAY_NAY },
  });
  // KHÔNG báo lỗi khi không có dòng nào: người dùng vừa tắt ở máy này, và việc DB không còn bản
  // ghi tương ứng là kết quả họ muốn. Bắt họ đọc một thông báo lỗi là nói sai về kết quả.
  //
  // NHƯNG phải TRẢ VỀ con số: đường đăng xuất cần phân biệt "vừa thu hồi dòng của mình" với
  // "không có dòng nào khớp" để quyết có huỷ đăng ký ở trình duyệt hay không (xem `soDong`).

  // Hai màn dùng chung component này — phải làm mới CẢ HAI, nếu không người dùng bật xong
  // vẫn thấy "Chưa có thiết bị nào" ngay cạnh dòng chữ "Đã bật".
  revalidatePath("/settings");
  revalidatePath("/teacher/ho-so");
  return { ok: true, soDong: kq.count };
}
