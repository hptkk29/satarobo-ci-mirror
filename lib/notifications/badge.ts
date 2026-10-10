// lib/notifications/badge.ts — quy tắc HIỂN THỊ badge và THỨ TỰ sắp xếp. Thuần, không I/O.
//
// VÌ SAO NẰM Ở SERVER (PRD W-2): quy tắc "0 → không chấm · 1 → chấm không số · 2–9 → số · ≥10 → 9+"
// phải tồn tại ĐÚNG MỘT CHỖ. Nếu frontend tự tính thì chuông, tiêu đề tab và (sau này) mobile sẽ
// lệch nhau mà không ai phát hiện. `/api/notifications/summary` trả thẳng `label` + `showDot` đã tính;
// frontend chỉ vẽ lại.

import type { NotiGroupKey, NotiPriority } from "./catalog";

/**
 * Từ số này trở lên mới HIỆN SỐ trên chuông; dưới nó chỉ là chấm đỏ trơn.
 * PRD §7.3 chốt 2 (một mục thì "có việc" là đủ, chưa cần đếm). Đổi ý chỉ cần sửa hằng này —
 * ⚠️ KHÔNG áp dụng cho tiêu đề tab trình duyệt: ở đó `(1)` hiện ngay từ 1, vì trên tab chấm đỏ
 * đã do favicon đảm nhiệm còn tiêu đề là kênh mang con số (PRD §7.11b).
 */
export const BADGE_MIN_COUNT = 2;

/** Quá ngưỡng này thì thôi đếm, tránh chip rộng ra đẩy lệch topbar. */
export const BADGE_MAX_COUNT = 9;

export interface BadgeView {
  /** Có chấm đỏ hay không. */
  showDot: boolean;
  /** Chuỗi hiện trong chip; rỗng = chỉ chấm trơn, không có chữ. */
  label: string;
  /** Có ít nhất một mục khẩn ⇒ chip đổi đỏ đậm + viền ngoài. */
  hasPriority1: boolean;
  /** Câu đọc cho trình đọc màn hình. */
  ariaLabel: string;
}

/** Badge của CHUÔNG. */
export function buildBadge(totalUnread: number, hasPriority1: boolean): BadgeView {
  const n = Math.max(0, Math.trunc(totalUnread));

  if (n === 0) {
    return { showDot: false, label: "", hasPriority1: false, ariaLabel: "Thông báo, không có mục chưa đọc" };
  }

  const label =
    n < BADGE_MIN_COUNT ? "" : n > BADGE_MAX_COUNT ? `${BADGE_MAX_COUNT}+` : String(n);

  const dem = n > BADGE_MAX_COUNT ? `${BADGE_MAX_COUNT} hoặc nhiều hơn` : String(n);
  const khan = hasPriority1 ? ", trong đó có mục khẩn" : "";

  return {
    showDot: true,
    label,
    hasPriority1,
    ariaLabel: `Thông báo, ${dem} mục chưa đọc${khan}`,
  };
}

/**
 * Tiền tố cho `document.title`. KHÁC chuông một cách CÓ CHỦ Ý: hiện `(1)` ngay từ mục đầu tiên.
 * QA cần biết để không báo nhầm là lỗi lệch số.
 */
export function buildTabTitlePrefix(totalUnread: number): string {
  const n = Math.max(0, Math.trunc(totalUnread));
  if (n === 0) return "";
  return n > BADGE_MAX_COUNT ? `(${BADGE_MAX_COUNT}+) ` : `(${n}) `;
}

// ─── Thứ tự trong panel (PRD §7.5) ─────────────────────────────────────────────

/** Trần điểm tuổi — chờ càng lâu càng lên cao, nhưng không được lấn át mức ưu tiên. */
const AGE_SCORE_MAX = 50;
/** Sau ngần này thì điểm tuổi kịch trần. 3 ngày: quá mốc đó thì "cũ hơn" không còn nghĩa lý gì. */
const AGE_SATURATE_MS = 3 * 24 * 60 * 60 * 1000;
/** Phụ huynh đang chờ luôn được đẩy lên trước ở cùng mức ưu tiên. */
const PARENT_MESSAGE_BONUS = 10;

export interface ScorableNotification {
  priority: NotiPriority | number;
  groupKey: NotiGroupKey | string;
  createdAt: Date;
  readAt: Date | null;
}

/**
 * Điểm ưu tiên, cao hơn = lên trên. `score = mức×100 + điểm tuổi + điểm nhóm`.
 * Mức: P1→3, P2→2, P3→1 (giữ nguyên công thức PRD, không tự chế thang khác).
 */
export function scoreNotification(n: ScorableNotification, now: Date): number {
  const rank = n.priority === 1 ? 3 : n.priority === 2 ? 2 : 1;

  const waited = Math.max(0, now.getTime() - n.createdAt.getTime());
  const age = Math.round(Math.min(1, waited / AGE_SATURATE_MS) * AGE_SCORE_MAX);

  const bonus = n.groupKey === "parent_message" ? PARENT_MESSAGE_BONUS : 0;

  return rank * 100 + age + bonus;
}

/**
 * Sắp xếp cho panel: CHƯA ĐỌC luôn trên ĐÃ ĐỌC (không có ngoại lệ — mục đã đọc mà điểm cao
 * chen lên trên mục chưa đọc là đúng thứ người dùng phàn nàn), rồi tới điểm, rồi mới nhất trước.
 */
export function sortForPanel<T extends ScorableNotification>(rows: readonly T[], now: Date): T[] {
  return [...rows].sort((a, b) => {
    const unreadA = a.readAt === null ? 1 : 0;
    const unreadB = b.readAt === null ? 1 : 0;
    if (unreadA !== unreadB) return unreadB - unreadA;

    const s = scoreNotification(b, now) - scoreNotification(a, now);
    if (s !== 0) return s;

    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}
