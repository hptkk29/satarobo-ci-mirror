import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasStaffRole } from "@/lib/auth/permissions";
import { isNotiGroupKey, type NotiGroupKey } from "@/lib/notifications/catalog";
import {
  demThongBao,
  mocLocThoiGian,
  getPanelNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  markNotificationsSeen,
} from "@/lib/notifications/service";
import { syncStaffNotifications } from "@/lib/staff-notifications";
import type { TaskUser } from "@/lib/pending-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Danh sách thông báo + đổi trạng thái đọc.
//
// Đây là chỗ DUY NHẤT chạy đồng bộ việc tồn (`syncStaffNotifications`) — tức chỉ khi người dùng
// thật sự mở panel hoặc mở trang tất cả thông báo, không phải mỗi nhịp đếm badge. Xem chú thích
// ở app/api/notifications/summary/route.ts.

function parseGroup(v: string | null): NotiGroupKey | undefined {
  return v && isNotiGroupKey(v) ? v : undefined;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !hasStaffRole(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const group = parseGroup(sp.get("group"));
  const mode = sp.get("mode") === "panel" ? "panel" : "page";

  // ⏱️ ĐỒNG BỘ VIỆC TỒN KHÔNG ĐƯỢC CHẶN ĐƯỜNG ĐỌC.
  // Đo thật 19/08 trên dev: `syncStaffNotifications` (→ `getPendingTasks`: 14 nhóm việc, hàng chục
  // truy vấn có kiểm quyền) làm lời gọi này mất **6,4 giây**, trong khi PRD đòi mục đầu tiên hiện
  // ra dưới 400ms. Nay nó chạy SAU khi response đã đi, nên panel mở tức thì bằng dữ liệu đã lưu.
  //
  // Cái giá phải trả, có chủ đích: một nhóm việc tồn vừa phát sinh có thể chậm MỘT nhịp mới hiện.
  // Chấp nhận được vì (a) badge tự hỏi lại theo tín hiệu realtime + vòng 90 giây, (b) thông báo do
  // SỰ KIỆN sinh ra không đi qua đường này nên vẫn tức thì.
  //
  // NGOẠI LỆ: người chưa có thông báo nào thì CHỜ đồng bộ — mở chuông lần đầu mà trống trơn rồi
  // phải mở lại mới thấy việc là ấn tượng đầu tiên tệ nhất có thể.
  const donongBo = () =>
    syncStaffNotifications(session.user as TaskUser).catch((err) => {
      console.warn("[notifications] đồng bộ việc tồn lỗi — không ảnh hưởng danh sách:", err);
    });

  if ((await demThongBao(session.user.id)) === 0) {
    await donongBo();
  } else {
    // `after()` chỉ chạy trong ngữ cảnh request; ngoài đó (test/script) thì chạy thẳng.
    try {
      const { after } = await import("next/server");
      after(donongBo);
    } catch {
      void donongBo();
    }
  }

  if (mode === "panel") {
    const { items, conLai } = await getPanelNotifications(session.user.id, { group });
    return NextResponse.json(
      { items, remaining: conLai },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const data = await listNotifications(session.user.id, {
    group,
    status: sp.get("status") === "unread" ? "unread" : "all",
    from: mocLocThoiGian(sp.get("range")),
    q: sp.get("q") ?? undefined,
    cursor: sp.get("cursor"),
    limit: Number(sp.get("limit")) || 20,
  });

  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

const bodySchema = z.union([
  z.object({ action: z.literal("read"), id: z.string().min(1) }),
  z.object({ action: z.literal("unread"), id: z.string().min(1) }),
  z.object({
    action: z.literal("read-all"),
    group: z.string().optional(),
    // Bộ lọc đang hiển thị. Thiếu chúng thì nút "đánh dấu tất cả" bấm trên màn đang lọc "Hôm nay"
    // nuốt luôn thông báo chưa đọc của ba tháng trước — và không có Hoàn tác để lùi.
    range: z.string().optional(),
    q: z.string().optional(),
  }),
  z.object({ action: z.literal("seen"), ids: z.array(z.string().min(1)).max(60) }),
]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !hasStaffRole(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  }

  const userId = session.user.id;
  const body = parsed.data;

  switch (body.action) {
    case "read":
      return NextResponse.json({ changed: await markNotificationRead(userId, body.id) });

    case "unread":
      return NextResponse.json({ changed: await markNotificationUnread(userId, body.id) });

    case "read-all": {
      // Tôn trọng ĐÚNG bộ lọc đang hiển thị (PRD §7.9), không chỉ mỗi nhóm.
      const count = await markAllNotificationsRead(userId, {
        group: parseGroup(body.group ?? null),
        from: mocLocThoiGian(body.range ?? null),
        q: body.q,
      });
      return NextResponse.json({ count });
    }

    case "seen":
      // Chỉ đặt mốc "đã nhìn thấy" — KHÔNG đụng badge. Đây là nửa còn lại của rủi ro T4.
      await markNotificationsSeen(userId, body.ids);
      return NextResponse.json({ ok: true });
  }
}
