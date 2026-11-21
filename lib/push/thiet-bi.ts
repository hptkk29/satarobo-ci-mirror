import "server-only";

// Đọc danh sách thiết bị nhận thông báo CỦA CHÍNH MỘT NGƯỜI — Web Push Đợt 3.
//
// Đặt ở `lib/` để hai màn (`/settings` của admin và `/teacher/ho-so`) dùng chung mà không màn nào
// phải import `@/lib/db` trần — đường đó là ESLint error trong `app/(admin|teacher)/**`.
//
// KHÔNG cần `scopedDb`: bảng này không có cột đơn vị, và `userId` CHÍNH LÀ ranh giới quyền —
// đúng mô hình `StaffNotification` (`lib/notifications/service.ts`: "thông báo của tôi là của
// tôi, kể cả khi tôi vừa chuyển cơ sở"). Ranh giới được ép bằng `where: { userId }` ngay dưới,
// nơi gọi truyền `session.user.id` chứ không bao giờ là một id đến từ client.
//
// ⚠️ TUYỆT ĐỐI KHÔNG TRẢ `endpoint` / `p256dh` / `auth` (siết ở Đợt 5, 13/09/2026).
//
// Kết quả của hàm này là PROP của một Client Component (`<BatThongBao thietBi={…} />`), nghĩa là
// nó được tuần tự hoá thẳng vào HTML của trang — ai mở "xem mã nguồn" là đọc được. Bản Đợt 3 trả
// `endpoint` đầy đủ, và chính điều đó biến lỗ §13.8b(b) từ lý thuyết thành khả thi: endpoint là
// một KHẢ NĂNG GỬI (ai có nó bắn được push rỗng vào máy nhân viên, không cần `p256dh`/`auth`), và
// nó cũng là đầu vào duy nhất mà kẻ muốn chiếm đăng ký của người khác cần.
//
// Nay trả BĂM + NHÃN CẮT: đủ để màn hình đánh dấu "máy này" (client tự băm endpoint của nó bằng
// `bamEndpointOClient`) và đủ để người dùng phân biệt máy của mình, KHÔNG đủ để dựng lại endpoint.

import { db } from "@/lib/db";
import { bamEndpoint, nhanEndpoint } from "@/lib/push/ket-qua";

export interface ThietBiCuaToi {
  id: string;
  /**
   * Băm endpoint (sha256, 16 hex) — để màn hình so với máy đang dùng.
   *
   * Client dùng `bamEndpointOClient` (`lib/push/client-key.ts`) băm endpoint của CHÍNH NÓ rồi
   * so chuỗi này. Hai bản phải khớp từng byte; có test so hai đầu.
   */
  bam: string;
  /** Nhãn người đọc được: `host/…6 ký tự cuối`. KHÔNG gửi lại được. */
  nhan: string;
  deviceLabel: string | null;
  userAgent: string | null;
  origin: string;
  displayMode: string | null;
  lastSuccessAt: string | null;
  createdAt: string;
}

/**
 * Thiết bị đang SỐNG của một người, mới đăng ký trước.
 *
 * Chỉ `ACTIVE`: `REVOKED` (tự gỡ) và `EXPIRED` (push service trả 410) không còn là thiết bị của
 * ai cả — để chúng trong danh sách là mời người dùng bấm "Gỡ" một thứ đã gỡ rồi.
 *
 * Mốc thời gian trả về dạng chuỗi ISO: dữ liệu này đi từ Server Component sang Client Component,
 * mà `Date` không tuần tự hoá qua ranh giới đó.
 */
export async function layThietBiCuaToi(userId: string): Promise<ThietBiCuaToi[]> {
  if (!userId) return [];
  const rows = await db.webPushSubscription.findMany({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      // `endpoint` đọc lên để BĂM ngay tại đây rồi bỏ — nó không đi tiếp một bước nào nữa.
      endpoint: true,
      deviceLabel: true,
      userAgent: true,
      origin: true,
      displayMode: true,
      lastSuccessAt: true,
      createdAt: true,
    },
  });
  return rows.map(({ endpoint, ...r }) => ({
    ...r,
    bam: bamEndpoint(endpoint),
    nhan: nhanEndpoint(endpoint),
    lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
