import { db } from "@/lib/db";
import { resolveActor } from "@/lib/auth/actor";
import { getPendingTasks, type TaskUser } from "@/lib/pending-tasks";
import { isPendingSyncKey, pendingSyncKey } from "@/lib/notifications/pending-sync";
import { classifyNotification } from "@/lib/notifications/catalog";

// =============================================================================
// MODULE NHẮC VIỆC PHẦN 3 — thông báo CHUÔNG (in-app) cho nhân viên.
// Đồng bộ LƯỜI theo user: mỗi lần user mở chuông → reconcile từ getPendingTasks.
//   - Việc cần xử lý  → 1 notif/loại (dedupeKey "<type>:pending").
//   - Việc quá hạn    → 1 notif/loại (dedupeKey "<type>:overdue") — nhắc lại.
//   - Việc đã xong (loại không còn) → tự đánh dấu ĐÃ ĐỌC.
// dedupeKey + @@unique([userId, dedupeKey]) → KHÔNG tạo trùng cùng 1 việc.
//
// ⚠️ PHẠM VI RECONCILE (BUG-1, vá 19/08/2026) — đọc trước khi sửa hàm dưới:
// bảng `StaffNotification` KHÔNG chỉ có thông báo của module này. ~15 nguồn khác cũng ghi
// vào đây (cron nhắc chốt buổi/dạy thay/SLA lead/sinh nhật, handler điểm danh bị sửa hồi tố,
// yêu cầu phụ huynh, tin nhắn phụ huynh…) với dedupeKey theo mẫu RIÊNG. Vòng reconcile
// trước đây quét TOÀN BỘ dòng chưa đọc rồi dập `readAt` mọi khoá "lạ" ⇒ nguyên nhóm đó
// bị đánh dấu đã đọc ngay trong request mở chuông và chưa từng làm badge nhảy.
// Nay reconcile chỉ đụng khoá `isPendingSyncKey()`; thông báo của nguồn khác do CHÍNH
// người dùng quyết định đã đọc. Đừng nới lại phạm vi này.
// =============================================================================

export interface StaffNotificationView {
  id: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

type Desired = { dedupeKey: string; category: string; title: string; body: string; href: string | null };

/** Đồng bộ thông báo cho user từ việc cần xử lý hiện tại. Trả về số chưa đọc. */
export async function syncStaffNotifications(user: TaskUser): Promise<number> {
  // Chuông gọi từ route handler (có request context) → resolveActor cache theo request.
  const groups = await getPendingTasks(user, await resolveActor(user.id));

  const desired: Desired[] = [];
  for (const g of groups) {
    if (g.count > 0) {
      desired.push({
        dedupeKey: pendingSyncKey(g.type, "pending"),
        category: g.type,
        title: g.label,
        body: `${g.count} việc cần xử lý.`,
        href: g.href,
      });
    }
    if (g.overdueCount > 0) {
      desired.push({
        dedupeKey: pendingSyncKey(g.type, "overdue"),
        category: g.type,
        title: `⚠ ${g.label} — quá hạn`,
        body: `${g.overdueCount} việc đã quá hạn, xử lý gấp.`,
        href: g.href,
      });
    }
  }
  const desiredKeys = new Set(desired.map((d) => d.dedupeKey));

  // MỞ LẠI loại việc đã đóng nay quay lại.
  //
  // Vì sao bắt buộc: khi một loại việc hết, vòng reconcile bên dưới đóng nó (state EXPIRED).
  // Nhưng `upsert` phía dưới, với bản ghi đã tồn tại, luôn rơi vào nhánh `update` — mà nhánh đó
  // CỐ Ý không đụng `readAt` (để số đếm đổi không spam người dùng). Hệ quả nếu thiếu bước này:
  // mỗi loại việc chỉ làm badge nhảy ĐÚNG MỘT LẦN trong đời. Quản lý duyệt hết lớp buổi sáng,
  // chiều có 3 lớp mới chờ duyệt — chuông im lặng vĩnh viễn. Đo được, và đủ để giết cả tính năng.
  if (desiredKeys.size > 0) {
    await db.staffNotification.updateMany({
      where: { userId: user.id, dedupeKey: { in: [...desiredKeys] }, state: "EXPIRED" },
      // Đây là một LẦN PHÁT SINH MỚI của cùng loại việc, nên mốc thấy/đọc cũ không còn ý nghĩa.
      data: { state: "ACTIVE", readAt: null, seenAt: null },
    });
  }

  // Tạo notif còn thiếu (bỏ qua nếu đã tồn tại — dedupe).
  // Nhóm + mức lấy từ catalog ở CẢ create lẫn update: sửa phân loại trong catalog rồi thì lần
  // đồng bộ kế tiếp tự chữa các dòng cũ, không phải chạy script vá tay.
  for (const d of desired) {
    const phanLoai = classifyNotification(d.dedupeKey);
    const xepLoai = {
      groupKey: phanLoai.groupKey,
      priority: phanLoai.priority,
      entityType: phanLoai.entityType,
    };
    await db.staffNotification.upsert({
      where: { userId_dedupeKey: { userId: user.id, dedupeKey: d.dedupeKey } },
      create: {
        userId: user.id,
        dedupeKey: d.dedupeKey,
        category: d.category,
        title: d.title,
        body: d.body,
        href: d.href,
        ...xepLoai,
      },
      // Cập nhật nội dung (số đếm) nhưng GIỮ trạng thái đọc để không spam.
      update: { title: d.title, body: d.body, href: d.href, ...xepLoai },
    });
  }

  // Việc đã xong → đánh dấu đã đọc các notif chưa đọc không còn trong desired.
  // CHỈ trong phạm vi khoá của vòng đồng bộ (xem khối cảnh báo đầu file): thông báo do
  // sự kiện sinh ra phải sống tới khi người dùng tự đọc.
  // ⚠️ QUÉT THEO `state`, KHÔNG theo `readAt`.
  // Lọc `readAt: null` ở đây (như bản trước) là bỏ sót đúng đường đi THƯỜNG GẶP NHẤT: người dùng
  // bấm vào mục → `readAt` được set → việc xong → vòng này không còn thấy dòng đó nên không bao
  // giờ đóng nó → lần sau việc quay lại, khối "MỞ LẠI" ở trên không khớp `state: EXPIRED` và
  // chuông im lặng vĩnh viễn. Nói cách khác: bản vá "mở lại" chỉ chạy được nếu vòng này ĐÓNG
  // được cả những dòng đã đọc.
  const dangMo = await db.staffNotification.findMany({
    where: { userId: user.id, state: "ACTIVE" },
    select: { id: true, dedupeKey: true, readAt: true },
  });
  const canDong = dangMo.filter(
    (s) => isPendingSyncKey(s.dedupeKey) && !desiredKeys.has(s.dedupeKey),
  );
  if (canDong.length > 0) {
    await db.staffNotification.updateMany({
      where: { id: { in: canDong.map((s) => s.id) } },
      data: { state: "EXPIRED" },
    });
    // Dòng chưa đọc thì đồng thời coi là đã đọc — việc đã xong, không bắt người dùng đọc nữa.
    // Dòng đã đọc GIỮ NGUYÊN `readAt` cũ: mốc đó là vết cho số liệu (Q-D), không được dời.
    const chuaDoc = canDong.filter((s) => s.readAt === null).map((s) => s.id);
    if (chuaDoc.length > 0) {
      await db.staffNotification.updateMany({
        where: { id: { in: chuaDoc } },
        data: { readAt: new Date() },
      });
    }
  }

  // Đếm CÙNG điều kiện với `/summary` (state ACTIVE), nếu không hai chỗ ra hai số khác nhau.
  return db.staffNotification.count({
    where: { userId: user.id, readAt: null, state: "ACTIVE" },
  });
}

/** Lấy danh sách thông báo gần đây + số chưa đọc (đã sync). */
export async function getStaffNotifications(
  user: TaskUser,
): Promise<{ items: StaffNotificationView[]; unread: number }> {
  const unread = await syncStaffNotifications(user);
  const rows = await db.staffNotification.findMany({
    // Lọc `state` (08/09/2026): mục đã THU HỒI phải biến mất ở CẢ hai đường đọc. Đường mới
    // (`lib/notifications/service.ts`) đã lọc qua `conHieuLuc`; thiếu vế này thì cùng một
    // endpoint chuông trả hai con số khác nhau, và chuông mồ côi vẫn hiện ở đường cũ.
    where: { userId: user.id, state: "ACTIVE" },
    orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
    take: 20,
  });
  return {
    unread,
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      href: r.href,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function markStaffNotificationRead(userId: string, id: string): Promise<void> {
  await db.staffNotification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllStaffNotificationsRead(userId: string): Promise<void> {
  await db.staffNotification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
