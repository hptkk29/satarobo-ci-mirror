// lib/parttime/thong-bao.ts — gửi thông báo phân công SAU commit (notifyStaff không nhận tx). In-app; không ZNS.
// Khoá chống trùng do service dựng (`parttime.*:<id>:v<phiên bản>`): đổi đáng kể thì rung lại, gửi lại cùng phiên bản thì không.
import "server-only";
import { notifyStaff } from "@/lib/notifications/notify";
import type { ThongBaoPhanCong } from "./phan-cong-db";

export async function guiThongBaoPhanCong(ds: readonly ThongBaoPhanCong[], boQuaUserId?: string | null): Promise<void> {
  for (const t of ds) {
    if (boQuaUserId && t.userId === boQuaUserId) continue;
    try {
      await notifyStaff({ userIds: [t.userId], dedupeKey: t.dedupeKey, title: t.title, body: t.body, href: t.href, reopen: true });
    } catch (e) {
      // Thông báo hỏng KHÔNG làm hỏng phân công đã commit — trạng thái chờ xác nhận đọc lại được ở màn "Phân công".
      console.error("[parttime] gửi thông báo phân công lỗi", t.dedupeKey, e);
    }
  }
}
