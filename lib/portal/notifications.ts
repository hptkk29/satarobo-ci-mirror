import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";
import { idsDaDoc } from "@/lib/portal/feed-read";
import { getChildren } from "@/lib/portal/session";

// =============================================================================
// PORTAL NOTIFICATIONS — Phase NHÓM 3
// Thông báo phụ huynh thấy = ALL_PARENTS, hoặc CENTER khớp cơ sở của con,
// hoặc CLASS khớp lớp con đang học. Chỉ bản đã publish.
// =============================================================================

// 06/09 — danh sách hợp nhất (lib/portal/trang-thai-ghi-danh.ts). Thêm "PAUSED":
// con tạm nghỉ vẫn thuộc lớp nên vẫn phải nhận thông báo của lớp.
const ACTIVE_ENROLLMENT = GHI_DANH_DANG_HOC;

export type NotificationRow = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  scope: string;
  /** NotificationAudience — feed v2 cần phân biệt STUDENT (gửi riêng 1 con). */
  audience: string;
  /** Con được nhắm tới khi audience=STUDENT (null với các audience khác). */
  studentId: string | null;
};

/**
 * Điều kiện audience chung cho thông báo phụ huynh thấy — list + count dùng chung
 * để badge chuông và trang luôn khớp nhau. Danh sách con tái dùng getChildren
 * (React cache — CÙNG query Student với getPortalContext trong 1 request, không
 * query Student lần 2) + 1 query Enrollment. Bọc cache() để list + count gọi
 * chung 1 request không lặp query Enrollment.
 */
const parentAudienceOr = cache(async (
  parentUserId: string,
): Promise<Prisma.NotificationWhereInput[]> => {
  const children = await getChildren(parentUserId);
  const studentIds = children.map((c) => c.id);
  const centerIds = new Set<string>();
  for (const c of children) {
    if (c.centerId) centerIds.add(c.centerId);
    if (c.preferredCenterId) centerIds.add(c.preferredCenterId);
  }

  const classIds = new Set(
    (
      await db.enrollment.findMany({
        where: { studentId: { in: studentIds }, status: { in: [...ACTIVE_ENROLLMENT] }, deletedAt: null }, // FIX-C3
        select: { classId: true },
      })
    ).map((e) => e.classId),
  );

  return [
    { audience: "ALL_PARENTS" },
    { audience: "CENTER", centerId: { in: [...centerIds] } },
    { audience: "CLASS", classId: { in: [...classIds] } },
    // Đợt 6 #7 — thông báo gửi riêng cho con của phụ huynh này.
    { audience: "STUDENT", studentId: { in: studentIds } },
  ];
});

export const getParentNotifications = cache(async (
  parentUserId: string,
): Promise<NotificationRow[]> => {
  const audienceOr = await parentAudienceOr(parentUserId);

  const now = new Date();
  const rows = await db.notification.findMany({
    where: {
      isPublished: true,
      OR: audienceOr,
      AND: [{ OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] }],
    },
    select: {
      id: true,
      title: true,
      body: true,
      audience: true,
      studentId: true,
      publishedAt: true,
      createdAt: true,
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  const scopeLabel: Record<string, string> = {
    ALL_PARENTS: "Toàn trung tâm",
    CENTER: "Cơ sở",
    CLASS: "Lớp học",
    STUDENT: "Riêng con bạn",
  };

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    publishedAt: (r.publishedAt ?? r.createdAt).toISOString(),
    scope: scopeLabel[r.audience] ?? "",
    audience: r.audience,
    studentId: r.studentId,
  }));
});

/**
 * Số thông báo GẦN ĐÂY (7 ngày) **CHƯA ĐỌC** — badge chuông portal (React cache/request).
 *
 * ⚠️ 04/09/2026 — trước bản này badge là HÀM CỦA THỬI GIAN, không phải của việc
 * đọc: ở đây đếm "tin trong 7 ngày qua", còn badge v2
 * (`lib/portal/notification-feed.ts`) coi là đã đọc sau 2 ngày TRÔI QUA. Cả hai đều
 * khiến phụ huynh mở tin ra đọc xong con số (1) vẫn nằm đó — `Notification` không hề
 * có cột trạng thái đã đọc nào để mà trừ.
 *
 * GIỮ nguyên cửa sổ 7 ngày, chỉ thêm điều kiện chưa đọc: đổi cả hai cùng lúc thì lần
 * triển khai đầu tiên mọi tin cũ chưa đọc sẽ dồn hết vào badge.
 */
export const getParentNotificationCount = cache(async (parentUserId: string): Promise<number> => {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const now = new Date();
  const audienceOr = await parentAudienceOr(parentUserId);
  // Badge chạy trên MỌI page view portal v1 → chỉ COUNT trong DB, không fetch
  // 100 bản ghi đầy đủ title/body rồi đếm bằng JS.
  return db.notification.count({
    where: {
      isPublished: true,
      OR: audienceOr,
      AND: [
        { OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] },
        // Mốc 7 ngày theo publishedAt ?? createdAt — khớp filter JS trước đây.
        { OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }] },
        // Chưa có dấu đã đọc của CHÍNH phụ huynh này. Bảng đọc dùng CHUNG với portal v2
        // (`lib/portal/feed-read.ts`) — v2 khoá theo id mục bảng tin, v1 khoá theo
        // `Notification.id`; cả hai đều là chuỗi nên dùng chung một bảng được.
        { id: { notIn: [...(await idsDaDoc(parentUserId))] } },
      ],
    },
  });
});


