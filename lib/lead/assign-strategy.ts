// Module CRM & Lead PHẦN 2 — chiến lược chia lead (pure, testable).
//
// Thứ tự: (1) theo CƠ SỞ trước; (2) trong cơ sở theo chế độ ROUND_ROBIN /
// CLOSE_RATE / MANUAL. Lead đã có tương tác (gọi/nhắn/ghi chú) KHÔNG bị auto.

export type SaleStat = {
  id: string;
  openCount: number; // số lead đang mở của sale
  closed: number; // số lead chốt tháng gần nhất
  handled: number; // số lead đã xử lý (mẫu) tháng gần nhất
};

/** Tỷ lệ chốt = closed / handled (0 nếu chưa có mẫu). */
export function computeCloseRate(closed: number, handled: number): number {
  if (handled <= 0) return 0;
  return closed / handled;
}

/**
 * Chọn sale theo TỶ LỆ CHỐT: sale tỷ lệ chốt cao nhận nhiều hơn. Deterministic
 * (không random) — chọn sale có (openCount / weight) NHỎ NHẤT, weight = 0.5 +
 * closeRate (0.5..1.5) → chốt cao gánh được nhiều lead hơn trước khi "đầy".
 */
export function pickByCloseRate(candidates: SaleStat[]): string | null {
  if (candidates.length === 0) return null;
  const scored = candidates.map((c) => {
    const weight = 0.5 + computeCloseRate(c.closed, c.handled); // 0.5..1.5
    return { id: c.id, score: c.openCount / weight };
  });
  scored.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return scored[0].id;
}

/** Round-robin: sale ít lead mở nhất; tie-break id. */
export function pickRoundRobin(candidates: { id: string; openCount: number }[]): string | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) => a.openCount - b.openCount || a.id.localeCompare(b.id),
  )[0].id;
}

export type CenterLoad = { centerId: string; openCount: number };

/**
 * Lead CHƯA chọn cơ sở → chia ĐỀU giữa các cơ sở: chọn cơ sở có ÍT lead mở hơn.
 * Tie-break theo centerId để ổn định. Số cơ sở do caller truyền (động, không cố định 2).
 */
export function pickCenterEvenly(centers: CenterLoad[]): string | null {
  if (centers.length === 0) return null;
  return [...centers].sort(
    (a, b) => a.openCount - b.openCount || a.centerId.localeCompare(b.centerId),
  )[0].centerId;
}
