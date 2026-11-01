// lib/media-review/tree.ts — cây duyệt media: NGÀY → LỚP → media.
//
// ⚠️ NGUYÊN TẮC GỐC (BA §7.1) — nguồn sự thật là LỊCH HỌC, không phải kho ảnh.
//
// Mô tả gốc đòi "chỉ hiện folder nào có ảnh chưa duyệt" nhưng đồng thời đòi nút
// "Hôm nay không có ảnh". Hai điều đó chọi nhau: dựng cây từ ảnh thì lớp KHÔNG có ảnh
// không bao giờ xuất hiện ⇒ không ai bấm được nút đó ⇒ mất luôn cơ chế giải trình và
// mất luôn báo cáo SLA. Nên cây dựng từ `ClassSession` đã diễn ra; một lớp chỉ biến mất
// khi buổi đó CÓ KẾT LUẬN (`SessionMediaReview.status` ≠ OPEN).
import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { deriveSessionLabel } from "@/lib/lms/session-project-name";
import { buildSessionNumberMap } from "@/lib/lms/session-order";
import { deadlineFor, isOverdue, vnToday, ymd } from "./deadline";
import { getReviewDeadlineHour } from "./settings";

export type ReviewClassNode = {
  classSessionId: string;
  classId: string;
  className: string;
  classCode: string | null;
  centerName: string | null;
  /** "Buổi 3 - HP1 - Bàn Tay Ma Thuật" — cùng nhãn với site giáo viên. */
  sessionLabel: string;
  /** "09:00-10:30" | "" */
  timeLabel: string;
  teacherName: string | null;
  images: number;
  videos: number;
  overdue: boolean;
};

export type ReviewDayNode = {
  /** "2026-08-25" */
  date: string;
  /** "Thứ Ba, 25/08" */
  label: string;
  overdue: boolean;
  classes: ReviewClassNode[];
};

const dayFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC", // @db.Date là UTC 00:00 của ngày lịch VN
});

function hoa(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Cây các buổi CÒN VIỆC của cơ sở mà `actor` quản.
 *
 * `lookbackDays` giới hạn nhìn lại bao xa — không có nó thì lần đầu bật tính năng, mọi
 * buổi từ đời nào cũng chưa có kết luận và QLCS mở màn ra thấy vài nghìn dòng.
 */
export async function getReviewTree(
  actor: Actor,
  opts?: { lookbackDays?: number; now?: Date },
): Promise<ReviewDayNode[]> {
  const now = opts?.now ?? new Date();
  const lookback = opts?.lookbackDays ?? 30;
  const today = vnToday(now);
  const from = new Date(today.getTime() - lookback * 24 * 60 * 60 * 1000);
  const sdb = scopedDb(actor);
  const gioHan = await getReviewDeadlineHour();

  // Buổi ĐÃ DIỄN RA (tính cả hôm nay) và chưa huỷ. ClassSession ∈ SCOPED_MODELS ⇒
  // scopedDb tự chèn `centerId IN visibleCenterIds`, không phải lọc tay.
  const sessions = await sdb.classSession.findMany({
    where: {
      status: { not: "CANCELLED" },
      date: { gte: from, lte: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1) },
    },
    orderBy: { date: "desc" },
    take: 800,
    select: {
      id: true,
      classId: true,
      centerId: true,
      date: true,
      topic: true,
      actualTeacherId: true,
      substituteTeacherId: true,
      plan: { select: { customTitle: true, order: true } },
      lesson: { select: { order: true, title: true, moduleCode: true } },
      class: {
        select: {
          name: true,
          classCode: true,
          teacherId: true,
          startTime: true,
          endTime: true,
          center: { select: { name: true } },
        },
      },
    },
  });
  if (sessions.length === 0) return [];

  const ids = sessions.map((s) => s.id);

  // Buổi nào đã có kết luận → loại khỏi cây.
  const reviews = await sdb.sessionMediaReview.findMany({
    where: { classSessionId: { in: ids } },
    select: { classSessionId: true, status: true, deadlineAt: true },
  });
  const reviewOf = new Map(reviews.map((r) => [r.classSessionId, r]));

  // Đếm media CHƯA có kết cục (PENDING) theo buổi + loại.
  const media = await sdb.mediaAsset.groupBy({
    by: ["classSessionId", "type"],
    where: { classSessionId: { in: ids }, status: "PENDING" },
    _count: { _all: true },
  });
  const countOf = new Map<string, { images: number; videos: number }>();
  for (const m of media) {
    const cur = countOf.get(m.classSessionId) ?? { images: 0, videos: 0 };
    if (m.type === "VIDEO") cur.videos += m._count._all;
    else cur.images += m._count._all;
    countOf.set(m.classSessionId, cur);
  }

  // Tên GV PHỤ TRÁCH BUỔI (BA US-02.3): dạy thay / thực dạy đứng trước GV của lớp —
  // hỏi đúng người đã đứng buổi đó, không phải người đứng tên lớp.
  const teacherIds = [
    ...new Set(
      sessions
        .map((s) => s.actualTeacherId ?? s.substituteTeacherId ?? s.class?.teacherId ?? null)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  const teachers = teacherIds.length
    ? await sdb.user.findMany({ where: { id: { in: teacherIds } }, select: { id: true, name: true } })
    : [];
  const teacherName = new Map(teachers.map((t) => [t.id, t.name]));

  // Số buổi phải tính trên TOÀN BỘ buổi của lớp (lib/lms/session-order), không phải
  // trên cửa sổ đang xem — cắt cửa sổ rồi đánh số là "Buổi 1" nhảy lung tung.
  const classIds = [...new Set(sessions.map((s) => s.classId))];
  const allOfClasses = await sdb.classSession.findMany({
    where: { classId: { in: classIds } },
    select: { id: true, classId: true, date: true },
  });
  const numberOf = buildSessionNumberMap(allOfClasses);

  const byDay = new Map<string, ReviewClassNode[]>();
  for (const s of sessions) {
    const rv = reviewOf.get(s.id);
    if (rv && rv.status !== "OPEN") continue; // đã có kết luận → hết việc

    const c = countOf.get(s.id) ?? { images: 0, videos: 0 };
    const han = rv?.deadlineAt ?? deadlineFor(s.date, gioHan);
    const tid = s.actualTeacherId ?? s.substituteTeacherId ?? s.class?.teacherId ?? null;
    const time =
      s.class?.startTime && s.class?.endTime ? `${s.class.startTime}-${s.class.endTime}` : "";

    const node: ReviewClassNode = {
      classSessionId: s.id,
      classId: s.classId,
      className: s.class?.name ?? "Lớp",
      classCode: s.class?.classCode ?? null,
      centerName: s.class?.center?.name ?? null,
      sessionLabel:
        deriveSessionLabel({
          sessionNumber: numberOf.get(s.id) ?? null,
          planTitle: s.plan?.customTitle,
          planOrder: s.plan?.order,
          lessonTitle: s.lesson?.title,
          lessonOrder: s.lesson?.order,
          moduleCode: s.lesson?.moduleCode,
          topic: s.topic,
        }) || "Buổi học",
      timeLabel: time,
      teacherName: tid ? (teacherName.get(tid) ?? null) : null,
      images: c.images,
      videos: c.videos,
      overdue: isOverdue(han, now),
    };

    const key = ymd(s.date);
    const arr = byDay.get(key) ?? [];
    arr.push(node);
    byDay.set(key, arr);
  }

  // Ngày mới nhất trên cùng (BA US-01.5).
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, classes]) => ({
      date,
      label: hoa(dayFmt.format(new Date(`${date}T00:00:00.000Z`))),
      overdue: classes.some((c) => c.overdue),
      classes: classes.sort((a, b) => a.className.localeCompare(b.className, "vi")),
    }));
}
