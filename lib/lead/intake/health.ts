import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { getSetting } from "@/lib/settings/service";
import { getSuperAdminUserIds } from "@/lib/crm/marketing-alerts";
import { vnParts, vnYmd } from "@/lib/time/vn";

// =============================================================================
// SỨC KHOẺ ĐƯỜNG NHẬN LEAD — P4.
//
// Vì sao tồn tại: đường nhận lead hỏng mà KHÔNG AI BIẾT là kiểu hỏng tệ nhất.
// Webhook SePay trả 401 im lặng 6 ngày, nuốt 4 giao dịch ~26,8 triệu tiền thật —
// mọi bộ phận đều tưởng bình thường vì không có gì kêu. Lead cũng vậy: form vẫn
// hiện, người nhập vẫn thấy trang cảm ơn, chỉ là không ai được chăm.
//
// Hai tín hiệu, cố ý khác nhau về bản chất:
//
//  1. ĐANG LỖI (`failing`) — đếm `WebhookDelivery` FAILED trong 1 giờ. Tín hiệu
//     TRỰC TIẾP, không cần biết lưu lượng bình thường là bao nhiêu.
//
//  2. IM LẶNG (`silent`) — nguồn TỪNG chạy đều nay tịt hẳn. Phải so với chính
//     nền của nó chứ KHÔNG đặt ngưỡng tuyệt đối: lưu lượng thật chỉ ~2 lead/ngày
//     (đo trên sheet quatang), nên "0 lead trong 6 giờ" là chuyện bình thường và
//     đặt ngưỡng cứng kiểu đó chỉ tạo ra báo động giả — mà báo động giả bị phớt
//     lờ thì lần hỏng thật cũng bị phớt lờ theo.
// =============================================================================

/**
 * Nguồn nhận lead tự động cần canh nhánh IM LẶNG. Thêm nguồn mới thì thêm 1 dòng.
 *
 * ⚠️ 22/08/2026 — GỠ "sale-form": biểu mẫu tĩnh công khai đã nghỉ, nên nó im
 * lặng là ĐÚNG, không phải sự cố. Để lại thì bộ dò kêu mỗi ngày suốt ~7 ngày
 * (bằng đúng cửa sổ nền) — mà báo động giả bị phớt lờ thì lần hỏng thật cũng bị
 * phớt lờ theo, đúng thứ file này sinh ra để tránh.
 *
 * Biểu mẫu thay thế (`satarobo.vn/nhap-khach-hang`) CỐ Ý không có mặt ở đây:
 * `Lead.source` của nó nay mang **nguồn marketing người nhập gõ tự do**
 * ("Facebook Ads", "giới thiệu"…), không còn là tên kênh, nên gom theo `source`
 * là vô nghĩa. Đổi lại, kiểu hỏng mà nhánh IM LẶNG sinh ra để bắt (biểu mẫu ẩn
 * danh hỏng mà không ai hay) đã hết đường xảy ra: người nhập phải đăng nhập và
 * thấy ngay lỗi trên màn hình.
 */
export const MONITORED_SOURCES = [
  "quatang",
  "facebook",
  "zalo",
  "google-form",
] as const;

/**
 * Nguồn `WebhookDelivery` không sinh Lead — chỉ theo dõi lỗi, không xét im lặng.
 *
 * 29/08/2026 — hai nguồn "misa-mirror" / "misa-mirror-app" GIỮ LẠI TRONG DANH SÁCH
 * dù luồng MISA đã gỡ: bản ghi CŨ trên PROD vẫn còn, và bỏ chúng ra thì chúng rơi
 * vào nhánh xét "im lặng" ⇒ đẻ cảnh báo cho một kênh đã ngừng dùng, mãi mãi.
 */
const DELIVERY_ONLY_SOURCES = new Set(["misa-mirror", "misa-mirror-app"]);

export type IntakeAlert = {
  kind: "failing" | "silent";
  source: string;
  title: string;
  body: string;
  dedupeKey: string;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Mốc giờ theo giờ VN để khoá dedupe — cron chạy trên UTC, người đọc sống ở +07. */
function vnHourKey(d: Date): string {
  const p = vnParts(d);
  return `${vnYmd(d)}-${String(p.hour).padStart(2, "0")}`;
}

/**
 * Dò các tín hiệu bất thường. HÀM THUẦN ĐỌC — không ghi gì, không gửi gì.
 * Việc gửi nằm ở `runIntakeHealthAlerts` để test được phần suy luận riêng.
 */
export async function detectIntakeAlerts(now = new Date()): Promise<IntakeAlert[]> {
  const [failThreshold, silentHours] = await Promise.all([
    getSetting("intake.alertFailedPerHour"),
    getSetting("intake.alertSilentHours"),
  ]);

  const alerts: IntakeAlert[] = [];

  // ── (1) ĐANG LỖI ─────────────────────────────────────────────────────────
  const failedSince = new Date(now.getTime() - HOUR_MS);
  const failed = await db.webhookDelivery.groupBy({
    by: ["source"],
    where: { status: "FAILED", receivedAt: { gte: failedSince } },
    _count: { _all: true },
  });

  for (const row of failed) {
    if (row._count._all < failThreshold) continue;
    alerts.push({
      kind: "failing",
      source: row.source,
      title: `Nguồn "${row.source}" đang lỗi`,
      body:
        `${row._count._all} phiếu lỗi trong 1 giờ qua (ngưỡng ${failThreshold}). ` +
        `Mở "Webhook lỗi — Replay" để xem payload và gửi lại.`,
      dedupeKey: `intake-failing:${row.source}:${vnHourKey(now)}`,
    });
  }

  // ── (2) IM LẶNG so với nền của chính nguồn đó ────────────────────────────
  const silentSince = new Date(now.getTime() - silentHours * HOUR_MS);
  const baselineFrom = new Date(silentSince.getTime() - 7 * DAY_MS);

  const [recent, baseline] = await Promise.all([
    db.lead.groupBy({
      by: ["source"],
      where: { createdAt: { gte: silentSince }, deletedAt: null },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ["source"],
      where: {
        createdAt: { gte: baselineFrom, lt: silentSince },
        deletedAt: null,
      },
      _count: { _all: true },
    }),
  ]);

  const recentBySource = new Map(recent.map((r) => [r.source ?? "", r._count._all]));

  for (const row of baseline) {
    const source = row.source ?? "";
    if (!source) continue;
    if (DELIVERY_ONLY_SOURCES.has(source)) continue;
    if (!MONITORED_SOURCES.includes(source as (typeof MONITORED_SOURCES)[number])) {
      continue;
    }
    // Nền phải đủ dày mới coi là "từng chạy đều": < 7 lead trong 7 ngày (tức
    // dưới 1/ngày) thì im một ngày là chuyện thường, không phải sự cố.
    if (row._count._all < 7) continue;
    if ((recentBySource.get(source) ?? 0) > 0) continue;

    alerts.push({
      kind: "silent",
      source,
      title: `Nguồn "${source}" im lặng ${silentHours} giờ`,
      body:
        `7 ngày trước đó nguồn này về ${row._count._all} lead, ` +
        `nhưng ${silentHours} giờ qua KHÔNG có lead nào. ` +
        `Kiểm tra form/webhook của nguồn trước khi kết luận là ế khách.`,
      dedupeKey: `intake-silent:${source}:${vnYmd(now)}`,
    });
  }

  return alerts;
}

/** Dò rồi đẩy vào `StaffNotification` của SUPER_ADMIN (dedupe chống spam). */
export async function runIntakeHealthAlerts(
  now = new Date(),
): Promise<{ alerts: number; notified: number }> {
  const alerts = await detectIntakeAlerts(now);
  if (alerts.length === 0) return { alerts: 0, notified: 0 };

  const admins = await getSuperAdminUserIds(now);
  if (admins.length === 0) {
    // Không có ai để báo thì ÍT NHẤT phải kêu vào log — nuốt luôn ở đây là tái
    // lập đúng cái lỗi mà hàm này sinh ra để chặn.
    console.error(
      `[intake-health] Có ${alerts.length} cảnh báo nhưng KHÔNG tìm thấy SUPER_ADMIN nào để gửi:`,
      alerts.map((a) => a.title).join(" · "),
    );
    return { alerts: alerts.length, notified: 0 };
  }

  // Quy ước `href` = đường admin clean-URL, KHÔNG tiền tố "/admin" (chuông admin push
  // thẳng đường này). Giữ "/admin/..." thì link vẫn tới nơi nhưng ăn thêm một hop
  // redirect legacy — chậm và lệch với 20+ nơi sinh thông báo khác.
  const HREF = "/crm/webhook-replay";

  let notified = 0;
  for (const alert of alerts) {
    // MỘT lời gọi cho cả danh sách SUPER_ADMIN — fan-out realtime gộp thành một lô.
    // `notifyStaff` ghi kèm `href` ở nhánh update, thứ cần để chữa bản ghi cũ: dedupeKey
    // khoá theo giờ/ngày nên thông báo đã sinh trong cùng khung đó không chạy lại nhánh
    // create. Không `reopen`: cron chạy hàng giờ, một sự cố kéo dài không được dội chuông
    // lại mỗi lượt.
    notified += await notifyStaff({
      userIds: admins,
      dedupeKey: alert.dedupeKey,
      category: "INTAKE_ALERT",
      title: alert.title,
      body: alert.body,
      href: HREF,
    });
  }

  return { alerts: alerts.length, notified };
}
