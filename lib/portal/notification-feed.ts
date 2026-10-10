import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { idsDaDoc } from "@/lib/portal/feed-read";
import { getStudentFeedback, type FeedbackItem } from "@/lib/portal/feedback";
import { getStudentMakeup, type StudentMakeup } from "@/lib/portal/makeup";
import { getStudentBilling, type StudentBilling } from "@/lib/portal/billing-student";
import { getCenterSurveys, type SurveyCard } from "@/lib/portal/surveys";
import { getParentNotifications } from "@/lib/portal/notifications";
import { getChildren } from "@/lib/portal/session";
import { getPublishedReportCards } from "@/lib/lms/report-card";
import { formatVndPlain } from "@/lib/format/money";

// Portal v2 — feed thông báo tổng hợp cho phụ huynh (giống SataUI): gom sự kiện thật
// từ nhận xét · học bù · học phí · học bạ · khảo sát · thông báo trung tâm, gắn danh mục.
// Chưa có bảng đánh dấu đã đọc → heuristic: sự kiện < 2 ngày = chưa đọc.
// LƯU Ý: KHÔNG có "BAI_TAP" — feed chưa nối nguồn Assignment (bổ sung khi có nguồn).

export type FeedCategory =
  | "NHAN_XET"
  | "LICH_HOC"
  | "HOC_BU"
  | "HOC_PHI"
  | "HOC_BA"
  | "KHAO_SAT"
  // Thông báo trung tâm/cơ sở/lớp (Notification) — nội dung tự do (sự kiện, nhắc nhở…),
  // KHÔNG gán cứng "LICH_HOC" (nhãn sai nguồn cho thông báo không liên quan lịch học).
  | "THONG_BAO";

export type FeedItem = {
  id: string;
  category: FeedCategory;
  title: string;
  body: string;
  childName: string | null;
  at: string;
  read: boolean;
};

export type NotificationFeed = {
  items: FeedItem[];
  unreadByCategory: Record<FeedCategory, number>;
  unreadTotal: number;
};

const READ_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

function vnd(n: number): string {
  return formatVndPlain(n);
}
function firstLine(s: string): string {
  const line = s.split("\n").map((x) => x.trim()).find(Boolean) ?? s;
  return line.replace(/^(Điểm nổi bật|Tiến bộ|Cần cải thiện|Đề xuất)\s*[:：]?\s*/i, "").slice(0, 160);
}

/**
 * Feed tổng hợp cho 1 phụ huynh. Nhận DUY NHẤT parentUserId (danh sách con tự
 * query bên trong qua getChildren — React cache) để cache() dedupe được theo
 * tham số primitive: layout + page /portal/thong-bao gọi trong cùng request
 * chỉ fan-out ĐÚNG 1 lần (mảng children truyền từ ngoài vào là reference mới
 * mỗi call-site → cache() không dedupe được).
 */
export const getParentNotificationFeed = cache(async (
  parentUserId: string,
): Promise<NotificationFeed> => {
  const children = await getChildren(parentUserId);
  const now = Date.now();
  const items: FeedItem[] = [];

  // 3 nhóm nguồn ĐỘC LẬP (per-child sources · khảo sát per-child · thông báo
  // trung tâm) — kick off song song rồi await chung MỘT Promise.all ở dưới:
  // không cộng dồn 3 đợt round-trip tuần tự vào TTFB.
  const perChildSources = Promise.all(
    children.map(async (child) => {
      // 1 nguồn hỏng lẻ → bỏ qua nguồn đó (fallback rỗng), không reject cả Promise.all
      // làm sập nguyên trang thông báo.
      const [feedback, makeup, billing, reportCards] = await Promise.all([
        // Feed chỉ hiện tối đa 3 nhận xét/con → LIMIT 3 đẩy xuống DB.
        getStudentFeedback(child.id, 3).catch((): FeedbackItem[] => []),
        getStudentMakeup(child.id).catch(
          (): StudentMakeup => ({ centerName: null, needCount: 0, pendingCount: 0, doneCount: 0, needList: [], history: [] }),
        ),
        getStudentBilling(child.id).catch(
          (): StudentBilling => ({ courseName: null, className: null, tuition: 0, paid: 0, outstanding: 0, nextDueDate: null, rows: [], receipts: [], pendingCount: 0, rejectedCount: 0 }),
        ),
        // Feed chỉ hiện học bạ MỚI NHẤT mỗi con → limit 1, khỏi kéo mọi snapshot JSON.
        getPublishedReportCards(child.id, 1).catch(() => []),
      ]);

      // Nhận xét (mỗi con lấy tối đa 3 gần nhất — đã LIMIT 3 ở query, không slice)
      for (const f of feedback) {
        items.push({
          id: `fb-${f.id}`,
          category: "NHAN_XET",
          title: `Nhận xét mới từ ${f.teacher ?? "giáo viên"}`,
          // Phiếu rubric-only (comment null từ khi comment thành nullable) → body
          // rỗng nhìn như card hỏng; thay bằng câu dẫn sang trang Nhận xét.
          body: firstLine(f.comment) || "Giáo viên đã gửi phiếu đánh giá năng lực buổi học.",
          childName: child.name,
          at: f.dateISO || new Date(now).toISOString(),
          read: f.dateISO ? now - new Date(f.dateISO).getTime() > READ_AFTER_MS : false,
        });
      }

      // Học bù
      for (const m of makeup.needList) {
        items.push({
          id: `mk-need-${m.id}`,
          category: "HOC_BU",
          title: "Con có buổi cần học bù",
          body: `${m.lessonTitle} — vắng buổi này, phụ huynh đặt lịch học bù giúp con.`,
          childName: child.name,
          at: m.missedDate ?? new Date(now).toISOString(),
          read: false,
        });
      }
      for (const m of makeup.history.filter((h) => h.status === "COMPLETED").slice(0, 2)) {
        // Mốc thời gian = lúc học bù XONG (completedAt) — KHÔNG phải ngày buổi vắng
        // gốc (missedDate) kẻo card "học bù xong hôm qua" hiện "10 ngày trước" và
        // bị sort chìm. Fallback missedDate khi record cũ chưa set completedAt.
        const at = m.completedAt ?? m.missedDate ?? new Date(now).toISOString();
        items.push({
          id: `mk-done-${m.id}`,
          category: "HOC_BU",
          title: "Lịch học bù đã hoàn tất",
          body: `${m.lessonTitle} — lớp ${m.className} đã được học bù.`,
          childName: child.name,
          at,
          read: true,
        });
      }

      // Học phí — hạn đóng thường là ngày TƯƠNG LAI: chỉ dùng làm nội dung, không
      // dùng làm mốc thời gian (sort/timeAgo sai); at = dueDate quá hạn hoặc "now".
      if (billing.outstanding > 0) {
        const dueMs = billing.nextDueDate ? new Date(billing.nextDueDate).getTime() : NaN;
        items.push({
          id: `fee-${child.id}`,
          category: "HOC_PHI",
          title: "Học phí cần thanh toán",
          body: `${child.name} còn công nợ ${vnd(billing.outstanding)}${billing.nextDueDate ? ` — hạn đóng ${new Date(billing.nextDueDate).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : ""}.`,
          childName: child.name,
          at: billing.nextDueDate && dueMs <= now ? billing.nextDueDate : new Date(now).toISOString(),
          read: false,
        });
      }

      // Học bạ — dùng publishedAt THẬT của snapshot (không bịa "now") + heuristic đã đọc.
      for (const rc of reportCards.slice(0, 1)) {
        items.push({
          id: `rc-${rc.id}`,
          category: "HOC_BA",
          title: "Học bạ định kỳ đã phát hành",
          body: `Học bạ của ${child.name} đã được trung tâm công bố chính thức.`,
          childName: child.name,
          at: rc.publishedAt || new Date(now).toISOString(),
          read: rc.publishedAt ? now - new Date(rc.publishedAt).getTime() > READ_AFTER_MS : false,
        });
      }
    }),
  );

  const surveysPerChild = Promise.all(
    // Feed chỉ cần title/description/done/createdAt để đếm pending — bỏ join surveyQuestion.
    children.map((c) =>
      getCenterSurveys(c.id, { withQuestions: false }).catch(() => ({ cards: [] as SurveyCard[], todoCount: 0 })),
    ),
  );
  const notifsPromise = getParentNotifications(parentUserId);

  const [, perChild, notifs] = await Promise.all([perChildSources, surveysPerChild, notifsPromise]);

  // Khảo sát (center-level) — gộp theo TẤT CẢ các con (mỗi con có thể khác cơ sở):
  // hiện nếu còn ≥1 con chưa làm; mốc thời gian = createdAt thật của Survey
  // (có sẵn trên SurveyCard — KHÔNG query lại bảng Survey chỉ để lấy createdAt).
  const pending = new Map<string, SurveyCard>();
  for (const { cards } of perChild) {
    for (const c of cards) if (!c.done && !pending.has(c.id)) pending.set(c.id, c);
  }
  for (const c of [...pending.values()].slice(0, 2)) {
    items.push({
      id: `sv-${c.id}`,
      category: "KHAO_SAT",
      title: `Khảo sát: ${c.title}`,
      body: c.description ?? "Khảo sát đang được mở, mời phụ huynh tham gia.",
      childName: null,
      at: c.createdAt,
      read: now - new Date(c.createdAt).getTime() > READ_AFTER_MS,
    });
  }

  // Thông báo trung tâm/cơ sở/lớp thật — category THONG_BAO (nội dung tự do,
  // không gán cứng LICH_HOC). audience=STUDENT (gửi riêng 1 con) → gắn badge tên
  // con để phụ huynh nhiều con biết thông báo thuộc con nào (parity scope v1).
  const childNameById = new Map(children.map((c) => [c.id, c.name]));
  // 06/09 — THÔI cắt còn 10. Nguồn `getParentNotifications` đã `take: 100`, mà bảng tin
  // v2 lại slice xuống 10 và không có phân trang: thông báo trung tâm gửi tuần trước bị
  // vài tin hệ thống đẩy văng khỏi cổng phụ huynh, không đường nào xem lại. Bản v1 hiện
  // đủ 100.
  for (const n of notifs) {
    items.push({
      id: `nt-${n.id}`,
      category: "THONG_BAO",
      title: n.title,
      body: n.body,
      childName: n.studentId ? (childNameById.get(n.studentId) ?? null) : null,
      at: n.publishedAt,
      read: now - new Date(n.publishedAt).getTime() > READ_AFTER_MS,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  // TRẠNG THÁI ĐỌC THẬT đè lên suy đoán theo thời gian ở trên (04/09/2026).
  //
  // Phép HOẶC chứ không thay thế: bỏ hẳn `READ_AFTER_MS` thì lần triển khai đầu tiên
  // mọi mục cũ chưa từng được đánh dấu sẽ dồn hết vào badge — phụ huynh mở portal
  // ra thấy "9+" cho những thứ họ đã xem từ lâu. Suy đoán cũ làm trạng thái BAN ĐẦU,
  // dấu đọc thật chỉ thêm vào.
  const daDoc = await idsDaDoc(parentUserId);
  for (const it of items) if (daDoc.has(it.id)) it.read = true;

  const unreadByCategory = {
    NHAN_XET: 0, LICH_HOC: 0, HOC_BU: 0, HOC_PHI: 0, HOC_BA: 0, KHAO_SAT: 0, THONG_BAO: 0,
  } as Record<FeedCategory, number>;
  for (const it of items) if (!it.read) unreadByCategory[it.category]++;
  const unreadTotal = items.filter((i) => !i.read).length;

  return { items, unreadByCategory, unreadTotal };
});

// ── Badge chuông (layout v2) ─────────────────────────────────────────────────
// Layout render trên MỌI page view portal → KHÔNG được trả full fan-out mỗi
// request chỉ để lấy 1 con số. unstable_cache TTL 60s key theo parentUserId:
// stale 60s chấp nhận được vì trạng thái "đã đọc" vốn là heuristic 2 ngày.
// CÙNG nguồn số với trang Thông báo (cùng getParentNotificationFeed, chỉ thêm
// cache) — cache miss trên /portal/thong-bao vẫn chỉ fan-out 1 lần nhờ React
// cache dedupe giữa callback này và page.
/** Thẻ cache theo từng phụ huynh — để xóa đúng bản của họ khi vừa đọc xong. */
export function theBadgeThongBao(parentUserId: string): string {
  return `portal-badge-thong-bao:${parentUserId}`;
}

// 06/09 — THẺ THEO TỪNG PHỤ HUYNH. Bản cũ gắn một thẻ hằng `"portal-badge-thong-bao"`
// cho MỌI phụ huynh, nên một người bấm vào trang Thông báo là xoá cache badge của toàn
// bộ phụ huynh đang online — cả hệ thống cùng lúc tính lại một fan-out khá nặng chỉ để
// ra một con số. Hàm `theBadgeThongBao()` viết ra đúng cho việc này nhưng chưa nơi nào
// gọi. `unstable_cache` chốt thẻ lúc ĐỊNH NGHĨA, nên phải dựng hàm theo từng lượt gọi.
//
// (Khoá cache vốn đã tách theo người: `unstable_cache` gộp cả THAM SỐ vào khoá, nên
// không có chuyện phụ huynh này đọc được con số của phụ huynh kia. Đây thuần là chuyện
// xoá cache quá tay.)
const badgeCached = (parentUserId: string): Promise<number> =>
  unstable_cache(
    async (): Promise<number> =>
      (await getParentNotificationFeed(parentUserId)).unreadTotal,
    ["portal-v2-notification-badge", parentUserId],
    // TTL 60s vẫn giữ (layout dựng trên MỌI page view), nhưng thêm THẺ để
    // `updateTag` xóa được ngay khi phụ huynh vừa đọc — không thì badge đứng nguyên
    // tới một phút sau khi họ đã xem, đúng triệu chứng vé này định chữa.
    { revalidate: 60, tags: [theBadgeThongBao(parentUserId)] },
  )();

/** Số chưa đọc cho badge chuông topbar v2 (cache 60s/parent). */
export const getParentNotificationBadge = cache(
  async (parentUserId: string): Promise<number> => badgeCached(parentUserId),
);
