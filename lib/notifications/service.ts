import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { NOTI_GROUPS, isNotiGroupKey, type NotiGroupKey } from "./catalog";
import { buildBadge, sortForPanel, type BadgeView } from "./badge";
import { vnAddDays, vnStartOfDay } from "@/lib/time/vn";

// =============================================================================
// Đường ĐỌC của chuông thông báo.
//
// LUẬT QUAN TRỌNG NHẤT CỦA FILE NÀY: `getNotificationSummary` KHÔNG được chạy đồng bộ việc tồn.
// Trước đây mỗi lần chuông hỏi số (60 giây/lần/người) là một lượt `getPendingTasks` — 14 nhóm việc,
// hàng chục truy vấn có kiểm quyền. Nhân với số nhân sự đang mở máy thì đó là một lượt quét toàn hệ
// mỗi phút, và không có cách nào đạt mốc p95 < 150ms mà PRD đòi. Nay:
//   · `/summary`  → đúng MỘT câu groupBy trên index (userId, groupKey, readAt). Không ghi gì.
//   · danh sách   → mới đồng bộ việc tồn, vì đó là lúc người dùng thật sự mở panel.
//
// Phạm vi dữ liệu: bảng này fan-out sẵn theo người nhận, nên `userId` CHÍNH LÀ ranh giới quyền —
// không cần `scopedDb`. Đừng thêm bộ lọc cơ sở ở đây: thông báo của tôi là của tôi, kể cả khi tôi
// vừa chuyển cơ sở.
// =============================================================================

/**
 * Chỉ mục ACTIVE và chưa hết hạn mới được đếm vào badge.
 *
 * Trả về một mệnh đề để ghép qua `AND` chứ KHÔNG phải để spread thẳng vào `where`: nó dùng `OR`,
 * mà ô tìm kiếm của trang "Tất cả thông báo" cũng dùng `OR` — spread cả hai là cái sau đè cái trước
 * và bộ lọc hết hạn biến mất không một tiếng động.
 */
function conHieuLuc(now: Date): Prisma.StaffNotificationWhereInput {
  return {
    state: "ACTIVE",
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

export interface NotiGroupCount {
  key: NotiGroupKey;
  label: string;
  unread: number;
}

export interface NotificationSummary {
  totalUnread: number;
  hasPriority1: boolean;
  badge: BadgeView;
  groups: NotiGroupCount[];
  generatedAt: string;
}

/** Badge + số chưa đọc từng nhóm. Đọc thuần, không ghi, không đồng bộ. */
export async function getNotificationSummary(
  userId: string,
  now: Date = new Date(),
): Promise<NotificationSummary> {
  // Gom theo (nhóm, mức) trong MỘT lượt: vừa ra số từng nhóm, vừa biết có mục khẩn hay không.
  const rows = await db.staffNotification.groupBy({
    by: ["groupKey", "priority"],
    where: { userId, readAt: null, AND: [conHieuLuc(now)] },
    _count: true,
  });

  const theoNhom = new Map<string, number>();
  let total = 0;
  let hasP1 = false;

  for (const r of rows) {
    const n = r._count;
    total += n;
    if (r.priority <= 1) hasP1 = true;
    theoNhom.set(r.groupKey, (theoNhom.get(r.groupKey) ?? 0) + n);
  }

  // Nhóm lạ (dữ liệu cũ, hoặc catalog thiếu) được dồn vào "Hệ thống" thay vì biến mất —
  // badge tổng phải luôn bằng tổng các chip, nếu không người dùng thấy số không khớp.
  let laVaoHeThong = 0;
  for (const [key, n] of theoNhom) {
    if (!isNotiGroupKey(key)) laVaoHeThong += n;
  }

  const groups: NotiGroupCount[] = NOTI_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    unread: (theoNhom.get(g.key) ?? 0) + (g.key === "system" ? laVaoHeThong : 0),
  }));

  return {
    totalUnread: total,
    hasPriority1: hasP1,
    badge: buildBadge(total, hasP1),
    groups,
    generatedAt: now.toISOString(),
  };
}

// ─── Danh sách ─────────────────────────────────────────────────────────────────

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  href: string | null;
  groupKey: string;
  groupLabel: string;
  priority: number;
  aggregateCount: number;
  readAt: string | null;
  seenAt: string | null;
  createdAt: string;
}

export type NotificationStatusFilter = "unread" | "all";

/** Cursor phân trang = `<createdAt ISO>|<id>`. Chuỗi, để đi thẳng trong query string. */
function maHoaCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}|${id}`;
}

function giaiMaCursor(raw: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  const cat = raw.indexOf("|");
  if (cat <= 0) return null;
  const createdAt = new Date(raw.slice(0, cat));
  const id = raw.slice(cat + 1);
  // Cursor rác (người dùng sửa URL, hoặc bản cũ còn trong lịch sử trình duyệt) → coi như không có
  // cursor, trả về trang đầu. Thà lặp lại trang đầu còn hơn ném lỗi vào mặt người dùng.
  return Number.isNaN(createdAt.getTime()) || !id ? null : { createdAt, id };
}

function toItem(r: {
  id: string; title: string; body: string; href: string | null;
  groupKey: string; priority: number; aggregateCount: number;
  readAt: Date | null; seenAt: Date | null; createdAt: Date;
}): NotificationItem {
  const g = NOTI_GROUPS.find((x) => x.key === r.groupKey);
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    href: r.href,
    groupKey: g ? r.groupKey : "system",
    groupLabel: g?.label ?? "Hệ thống",
    priority: r.priority,
    aggregateCount: r.aggregateCount,
    readAt: r.readAt?.toISOString() ?? null,
    seenAt: r.seenAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

const CHON = {
  id: true, title: true, body: true, href: true,
  groupKey: true, priority: true, aggregateCount: true,
  readAt: true, seenAt: true, createdAt: true,
} as const;

/**
 * 10 mục cho PANEL, đã sắp theo độ khẩn (PRD §7.5).
 *
 * Vì điểm ưu tiên là hàm của thời gian nên KHÔNG sắp được bằng SQL. Cách làm: lấy một cửa sổ đủ rộng
 * theo thời gian rồi sắp trong bộ nhớ. Cửa sổ 60 là con số có chủ đích — trần chống nhiễu của PRD là
 * 30 thông báo/người/ngày, nên 60 đã phủ hơn hai ngày tệ nhất mà vẫn là một truy vấn nhỏ.
 */
export async function getPanelNotifications(
  userId: string,
  opts: { group?: NotiGroupKey; limit?: number; now?: Date } = {},
): Promise<{ items: NotificationItem[]; conLai: number }> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 10;

  const where: Prisma.StaffNotificationWhereInput = {
    userId,
    AND: [conHieuLuc(now)],
    ...(opts.group ? { groupKey: opts.group } : {}),
  };

  // ⛔ ĐỪNG gộp lại thành MỘT truy vấn `orderBy: [{ readAt: "asc" }, ...]`.
  // Postgres sắp `ASC` với NULLS **LAST**, mà "chưa đọc" chính là `readAt IS NULL` ⇒ cửa sổ 60
  // dòng sẽ lấy trọn 60 mục ĐÃ ĐỌC cũ nhất và đẩy mọi mục chưa đọc ra ngoài LIMIT. Người dùng
  // tích đủ 60 thông báo đã đọc (không có job dọn, mỗi tin nhắn phụ huynh là một dòng) sẽ thấy
  // badge báo "5" nhưng mở panel ra toàn mục mờ — đúng căn bệnh mà cả tính năng này sinh ra để
  // chữa. Lấy hai lượt: chưa đọc trước, đã đọc chỉ để lấp phần còn thiếu.
  const [chuaDoc, tong] = await Promise.all([
    db.staffNotification.findMany({
      where: { ...where, readAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 60,
      select: CHON,
    }),
    db.staffNotification.count({ where }),
  ]);

  const thieu = Math.max(0, limit - chuaDoc.length);
  const daDoc =
    thieu === 0
      ? []
      : await db.staffNotification.findMany({
          where: { ...where, readAt: { not: null } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: thieu,
          select: CHON,
        });

  const sorted = sortForPanel([...chuaDoc, ...daDoc], now);
  return {
    items: sorted.slice(0, limit).map(toItem),
    conLai: Math.max(0, tong - limit),
  };
}

/**
 * Danh sách đầy đủ cho trang "Tất cả thông báo" — thứ tự THỜI GIAN, không phải độ khẩn.
 * Cố ý khác panel: trang này để TRA LẠI ("tuần trước ai giao việc cho tôi"), mà tra lại thì mốc
 * thời gian là trục duy nhất người ta nhớ. Nó cũng cho phép gộp theo ngày và phân trang bằng cursor
 * thật, thay vì sắp lại toàn bộ trong bộ nhớ.
 */
export async function listNotifications(
  userId: string,
  opts: {
    group?: NotiGroupKey;
    status?: NotificationStatusFilter;
    from?: Date;
    q?: string;
    cursor?: string | null;
    limit?: number;
    now?: Date;
  } = {},
): Promise<{ items: NotificationItem[]; nextCursor: string | null }> {
  const now = opts.now ?? new Date();
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const tuKhoa = opts.q?.trim();

  // Cursor là GIÁ TRỊ `createdAt|id`, KHÔNG phải `cursor: { id }` của Prisma.
  // `cursor + skip: 1` giả định dòng mốc VẪN còn khớp `where`. Nó không còn khớp trong đúng
  // kịch bản hay xảy ra nhất: đang lọc "Chưa đọc", người dùng bấm mục cuối trang (thành đã đọc)
  // rồi bấm "Tải thêm" — lúc đó `skip: 1` ăn mất một mục hợp lệ, im lặng, không cách nào cuộn tới.
  const moc = giaiMaCursor(opts.cursor);

  const rows = await db.staffNotification.findMany({
    where: {
      userId,
      ...(opts.group ? { groupKey: opts.group } : {}),
      ...(opts.status === "unread" ? { readAt: null } : {}),
      ...(opts.from ? { createdAt: { gte: opts.from } } : {}),
      AND: [
        conHieuLuc(now),
        // Trang kế tiếp: mọi dòng đứng SAU mốc theo đúng thứ tự (createdAt desc, id desc).
        ...(moc
          ? [
              {
                OR: [
                  { createdAt: { lt: moc.createdAt } },
                  { createdAt: moc.createdAt, id: { lt: moc.id } },
                ],
              },
            ]
          : []),
        // Ghép qua AND để không đè mệnh đề OR của bộ lọc hết hạn ở trên.
        ...(tuKhoa
          ? [
              {
                OR: [
                  { title: { contains: tuKhoa, mode: "insensitive" as const } },
                  { body: { contains: tuKhoa, mode: "insensitive" as const } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: CHON,
  });

  const conNua = rows.length > limit;
  const trang = conNua ? rows.slice(0, limit) : rows;
  const cuoi = trang[trang.length - 1];

  return {
    items: trang.map(toItem),
    nextCursor: conNua && cuoi ? maHoaCursor(cuoi.createdAt, cuoi.id) : null,
  };
}

// ─── Ghi trạng thái ────────────────────────────────────────────────────────────

/**
 * "Đã nhìn thấy" — đặt khi mục hiện ra trong panel. KHÔNG đụng `readAt`, KHÔNG làm badge giảm.
 * Đây là cả nửa còn lại của rủi ro T4 trong PRD: mở panel lướt một cái mà badge về 0 thì đúng
 * những việc người dùng chưa kịp đọc là những việc biến mất.
 *
 * Chỉ ghi khi `seenAt` còn trống — mốc "thấy lần đầu" là dữ liệu có hệ quả (chủ dự án chốt 19/08
 * rằng số liệu đọc được dùng cho đánh giá nhân sự), đè lại là làm sai lệch số liệu đó.
 */
export async function markNotificationsSeen(userId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.staffNotification.updateMany({
    where: { id: { in: [...ids] }, userId, seenAt: null },
    data: { seenAt: new Date() },
  });
}

/** Đánh dấu đã đọc một mục. Trả về true nếu có gì đó thật sự đổi (để client biết có nên trừ badge). */
export async function markNotificationRead(userId: string, id: string): Promise<boolean> {
  const now = new Date();
  // HAI lệnh, không phải một: mốc "thấy lần đầu" CHỈ được ghi khi còn trống. Gộp thành
  // `data: { readAt: now, seenAt: now }` là đè mất khoảng "thấy rồi để đó bao lâu" — mà chủ dự án
  // đã chốt (Q-D, 19/08) rằng số liệu đọc dùng cho đánh giá nhân sự, nên đè là làm mọi khoảng
  // seen→read bằng 0 giây cho toàn hệ, đẹp một cách giả tạo và không truy lại được.
  await db.staffNotification.updateMany({
    where: { id, userId, readAt: null, seenAt: null },
    data: { seenAt: now },
  });
  const r = await db.staffNotification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: now },
  });
  return r.count > 0;
}

/**
 * Hoàn tác "đã đọc" (nút Hoàn tác trong toast 10 giây của PRD §7.9).
 * Gỡ `readAt` nhưng GIỮ `seenAt` — người dùng đã thật sự nhìn thấy mục này, xoá dấu đó là nói dối.
 */
export async function markNotificationUnread(userId: string, id: string): Promise<boolean> {
  const r = await db.staffNotification.updateMany({
    where: { id, userId, readAt: { not: null } },
    data: { readAt: null },
  });
  return r.count > 0;
}

/**
 * "Đánh dấu tất cả đã đọc" — TÔN TRỌNG ĐÚNG bộ lọc đang hiển thị (PRD §7.9): nhóm, khoảng thời
 * gian VÀ ô tìm kiếm. Người dùng nhìn thấy 3 mục rồi bấm nút thì phải là đúng 3 mục đó, không phải
 * cả ba tháng. Nút trên giao diện còn phải GHI RÕ đang áp cho phạm vi nào.
 */
export async function markAllNotificationsRead(
  userId: string,
  filter: { group?: NotiGroupKey; from?: Date; q?: string } = {},
): Promise<number> {
  const now = new Date();
  const tuKhoa = filter.q?.trim();
  const loc: Prisma.StaffNotificationWhereInput = {
    userId,
    readAt: null,
    ...(filter.group ? { groupKey: filter.group } : {}),
    ...(filter.from ? { createdAt: { gte: filter.from } } : {}),
    ...(tuKhoa
      ? {
          OR: [
            { title: { contains: tuKhoa, mode: "insensitive" as const } },
            { body: { contains: tuKhoa, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  // Cùng lý do như `markNotificationRead`: `seenAt` chỉ ghi khi còn trống.
  await db.staffNotification.updateMany({
    where: { ...loc, seenAt: null },
    data: { seenAt: now },
  });
  const r = await db.staffNotification.updateMany({ where: loc, data: { readAt: now } });
  return r.count;
}

/**
 * Đếm tổng số thông báo của một người (mọi trạng thái).
 *
 * Dùng cho đúng một quyết định: người này đã từng có thông báo chưa. Nếu chưa, đường liệt kê sẽ
 * CHỜ vòng đồng bộ việc tồn thay vì đẩy nó ra sau response — mở chuông lần đầu mà trống trơn là
 * ấn tượng đầu tiên tệ nhất có thể. Đã có rồi thì không chờ (xem chú thích ở app/api/notifications/route.ts).
 */
export async function demThongBao(userId: string): Promise<number> {
  return db.staffNotification.count({ where: { userId } });
}

/**
 * Mốc BẮT ĐẦU của bộ lọc thời gian trên trang "Tất cả thông báo".
 *
 * Tính theo NGÀY GIỜ VIỆT NAM, không phải "trừ N×24 giờ". Trừ 24 giờ thì lúc 09:00 hôm nay bộ lọc
 * "Hôm nay" vẫn kéo về thông báo tạo lúc 15:00 HÔM QUA — mà chính trang đó lại gộp tiêu đề theo
 * ngày VN, nên người dùng thấy một mục nằm dưới nhãn "Hôm qua" trong khi đang lọc "Hôm nay".
 *
 * Dùng CHUNG cho cả Server Component (trang đầu) lẫn route handler (tải thêm) — hai nơi tính theo
 * hai cách là biên dưới của danh sách trôi giữa các trang và nuốt mất mục ở đuôi.
 */
export function mocLocThoiGian(range: string | null | undefined, now: Date = new Date()): Date | undefined {
  const soNgay: Record<string, number> = { today: 0, "7d": 6, "30d": 29 };
  const n = soNgay[range ?? ""];
  if (n === undefined) return undefined;
  return vnStartOfDay(vnAddDays(now, -n));
}
