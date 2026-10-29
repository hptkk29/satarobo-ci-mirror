import "server-only";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { notifyStaff } from "@/lib/notifications/notify";
import { attachDeadlines } from "./media-review-deadline-config";
import {
  buildOverdueNotice,
  groupPendingMedia,
  mediaOverdueDedupeKey,
  pickOverdueFolders,
  type PendingMediaRow,
  type SessionRef,
} from "./media-review-overdue";

// =============================================================================
// F-21 — bắn thông báo khi ảnh/video buổi học QUÁ HẠN DUYỆT mà chưa duyệt hết.
//
// ── BA LỖI CỦA BẢN CŨ MÀ FILE NÀY VÁ ────────────────────────────────────────
// 1. KHÔNG CÓ ĐƯỜNG ĐẨY. Cảnh báo cũ chỉ được sinh trong `syncStaffNotifications`,
//    tức chỉ khi CHÍNH người đó mở panel chuông. Ai không mở thì việc quá hạn không
//    tồn tại. Nay có vòng chạy nền (gộp vào cron `parent-request-reminder`, mỗi giờ).
// 2. SAI NGƯỠNG. Cũ đếm "ảnh nằm chờ quá 2 ngày kể từ lúc tải lên"; hạn thật (F-20)
//    là 10h sáng ngày hôm sau NGÀY DẠY, đặt được theo từng cơ sở.
// 3. SAI NGƯỜI. Nhóm việc tồn lọc theo `user.centerId` của người đang mở chuông —
//    đúng, nhưng chỉ với người chịu mở. Ở đây người nhận được tra NGƯỢC: từ cơ sở
//    CÓ ảnh treo → quản lý của đúng cơ sở đó. Không có ảnh treo thì không ai bị gọi.
//
// ── HẠN TÍNH SỐNG, KHÔNG ĐÓNG BĂNG ──────────────────────────────────────────
// F-20-2 đòi đóng băng hạn cho BÁO CÁO SLA (quá khứ không được viết lại theo cấu hình
// hôm nay). Ở đây thì ngược lại: đây là cảnh báo cho việc ĐANG treo, nên cấu hình hiện
// hành mới là cái đúng — admin nới hạn lúc 9h thì 10h không được coi là trễ. Cột lưu
// hạn đóng băng chưa tồn tại (không thêm migration ở ticket này), và nếu sau này có
// thì chỗ dùng nó là F-30/F-31, không phải chỗ này.
// =============================================================================

/**
 * Trần số ảnh đọc mỗi lượt quét. Ảnh PENDING là HÀNG ĐỢI VIỆC nên bình thường rất
 * ít; trần chỉ để một đống tồn đọng bất thường không kéo sập lượt cron. Lấy MỚI
 * NHẤT trước (`createdAt desc`) có chủ đích: nếu phải cắt thì cắt phần cũ — phần cũ
 * đằng nào cũng đã ngoài cửa sổ nhắc.
 */
const SCAN_MAX = 3000;

/** Vai nhận cảnh báo: quản lý cơ sở. Cố ý KHÔNG bắn cho SUPER_ADMIN/HO — họ không
 *  phải người trực duyệt ảnh, và bắn cho họ là quay lại đúng lỗi "báo mọi QLCS". */
const NOTIFY_ROLES: Role[] = ["CENTER_MANAGER"];

export interface MediaOverdueRunResult {
  /** Số ảnh PENDING đã đọc. */
  scanned: number;
  /** Số folder (buổi / lớp×ngày) dựng được. */
  folders: number;
  /** Số folder đang quá hạn và còn trong cửa sổ nhắc. */
  overdue: number;
  /** Số bản ghi thông báo đã ghi (người × folder). */
  notified: number;
  /** Folder quá hạn nhưng cơ sở không có quản lý nào đang hoạt động. */
  khongCoNguoiNhan: number;
  /** Chạm trần `SCAN_MAX` — có ảnh cũ chưa được xét. */
  truncated: boolean;
}

/**
 * Quản lý của MỘT cơ sở. `centerId` null (lớp chưa gắn cơ sở) → KHÔNG có người nhận:
 * thà bỏ sót một folder và đếm nó vào `khongCoNguoiNhan` còn hơn bắn cho toàn bộ quản
 * lý mọi cơ sở — đó đúng là thứ ticket này phải sửa.
 */
export async function getMediaReviewRecipients(
  centerId: string | null,
): Promise<{ id: string }[]> {
  if (!centerId) return [];
  return db.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      roles: { hasSome: NOTIFY_ROLES },
      centerId,
    },
    select: { id: true },
  });
}

/**
 * Một lượt quét: ảnh PENDING → folder → folder quá hạn → thông báo cho quản lý cơ sở.
 *
 * Idempotent theo `(userId, dedupeKey)` với khoá cắt theo NGÀY VN, nên chạy mỗi giờ
 * cũng chỉ ra một thông báo/ngày cho mỗi folder.
 */
export async function runMediaReviewOverdueNotify(
  now: Date = new Date(),
): Promise<MediaOverdueRunResult> {
  const rows: PendingMediaRow[] = await db.classSessionMedia.findMany({
    // Chỉ PENDING. DRAFT là kho riêng của giáo viên (chưa gửi đi duyệt — `reviewMedia`
    // còn chặn), báo quản lý về nó là bắt họ chịu trách nhiệm cho việc chưa tới tay.
    where: { status: "PENDING" },
    select: {
      id: true,
      classId: true,
      classSessionId: true,
      takenAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: SCAN_MAX + 1,
  });
  const truncated = rows.length > SCAN_MAX;
  if (truncated) {
    rows.length = SCAN_MAX;
    console.warn(
      `[F-21] hàng chờ duyệt vượt ${SCAN_MAX} ảnh — lượt quét này bỏ qua phần cũ nhất`,
    );
  }
  if (rows.length === 0) {
    return {
      scanned: 0, folders: 0, overdue: 0, notified: 0,
      khongCoNguoiNhan: 0, truncated: false,
    };
  }

  const sessionIds = [...new Set(rows.map((r) => r.classSessionId).filter((v): v is string => !!v))];
  const sessions: SessionRef[] = sessionIds.length
    ? await db.classSession.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, classId: true, date: true },
      })
    : [];
  const folders = groupPendingMedia(rows, new Map(sessions.map((s) => [s.id, s])));

  const classIds = [...new Set(folders.map((f) => f.classId))];
  const classes = await db.class.findMany({
    // Lớp đã xoá mềm thì thôi đòi duyệt: ảnh của nó là rác chờ dọn, không phải việc
    // của quản lý cơ sở. `attachDeadlines` bỏ qua folder không tra ra lớp.
    where: { id: { in: classIds }, deletedAt: null },
    select: { id: true, name: true, classCode: true, centerId: true, orgUnitId: true },
  });
  const classById = new Map(classes.map((c) => [c.id, c]));

  const quaHan = pickOverdueFolders(await attachDeadlines(folders, classById), now);

  // Người nhận tra một lần cho mỗi cơ sở — một cơ sở thường có nhiều folder treo.
  const nguoiNhanTheoCenter = new Map<string, { id: string }[]>();
  let notified = 0;
  let khongCoNguoiNhan = 0;

  for (const f of quaHan) {
    const cls = classById.get(f.classId);
    const centerId = cls?.centerId ?? null;
    if (!centerId) {
      khongCoNguoiNhan += 1;
      continue;
    }
    let nguoiNhan = nguoiNhanTheoCenter.get(centerId);
    if (!nguoiNhan) {
      nguoiNhan = await getMediaReviewRecipients(centerId);
      nguoiNhanTheoCenter.set(centerId, nguoiNhan);
    }
    if (nguoiNhan.length === 0) {
      khongCoNguoiNhan += 1;
      continue;
    }

    const notice = buildOverdueNotice({
      folder: f,
      className: cls?.classCode ? `${cls.classCode} · ${cls.name}` : (cls?.name ?? null),
      soAnh: f.mediaIds.length,
    });
    notified += await notifyStaff({
      userIds: nguoiNhan.map((u) => u.id),
      dedupeKey: mediaOverdueDedupeKey(f.key, now),
      category: "media_review",
      title: notice.title,
      body: notice.body,
      href: "/media",
      // Cố ý KHÔNG set `entityId`: đối tượng ở đây là một FOLDER (buổi, hoặc lớp×ngày),
      // không phải một bản ghi media. Nhét id buổi vào ô mang `entityType: "media"` là
      // gài mìn cho bất kỳ vòng thu hồi thông báo nào sau này.
    });
  }

  return {
    scanned: rows.length,
    folders: folders.length,
    overdue: quaHan.length,
    notified,
    khongCoNguoiNhan,
    truncated,
  };
}
