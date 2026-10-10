// lib/trial/rubric.ts — Bộ tiêu chí đánh giá buổi TRẢI NGHIỆM SataRobo (thang 10.0).
//
// ⚠️ 27/08/2026 — ĐỔI THANG 8.0 → 10.0 (chủ dự án yêu cầu). Điểm chia lại cho tổng
// đúng 10, và ngưỡng xếp loại đổi theo (8 / 6 / 4 thay cho 6.5 / 5 / 3.5).
//
// Chọn bộ số 2.0 / 1.0 / 2.0 cho ba nhóm thay vì nhân 1.25 lên bộ cũ: nhân thẳng ra
// 1.875 và 0.9375, tức mức giữa thành 0.94 — phiếu in cho phụ huynh mà đầy số lẻ ba
// chữ số thì không ai đọc. Bộ mới giữ mọi điểm là bội của 0.5.
//
// Đánh đổi ĐÃ BIẾT: nhóm "Thao tác máy tính" từ 2/8 = 25% xuống 2/10 = 20% tổng điểm,
// hai nhóm kia nhích lên. Trọng số tương đối giữa tiêu chí "mềm" và tiêu chí thao tác
// đổi từ 1,5:1 thành 2:1. Muốn giữ nguyên đúng tỉ lệ cũ thì phải chấp nhận số lẻ.
//
// Cấu trúc CỐ ĐỊNH (không drive bằng DB) — dùng chung form (client) + PDF (server)
// + action lưu. 3 nhóm × 2 tiêu chí; điểm mỗi tiêu chí chọn 1 trong 3 mức. Port từ
// TeachUI trial-eval-rubric.tsx.

export interface RubricLevel {
  points: number;
  title: string;
  desc?: string;
}
export interface RubricCriterion {
  id: string;
  label: string;
  levels: RubricLevel[];
}
export interface RubricSection {
  num: number;
  title: string;
  criteria: RubricCriterion[];
}

export const RUBRIC: RubricSection[] = [
  {
    num: 1,
    title: "Thái độ học tập",
    criteria: [
      {
        id: "focus",
        label: "A. Mức độ tập trung",
        levels: [
          { points: 2, title: "Tập trung cao", desc: "Lắng nghe GV giảng" },
          { points: 1, title: "Tập trung khá", desc: "Chỉ tập trung 1 khoảng thời gian" },
          { points: 0, title: "Tập trung thấp", desc: "Dễ bị xao nhãng trong giờ học" },
        ],
      },
      {
        id: "interact",
        label: "B. Khả năng tương tác",
        levels: [
          { points: 2, title: "Mạnh dạn tương tác", desc: "Tích cực trao đổi với GV" },
          { points: 1, title: "Có tương tác nhưng còn ít", desc: "Có sự ngại ngùng" },
          { points: 0, title: "Thụ động", desc: "GV hỏi gì trả lời đó" },
        ],
      },
    ],
  },
  {
    num: 2,
    title: "Thao tác máy tính",
    criteria: [
      {
        id: "keyboard",
        label: "A. Thao tác bàn phím, phần mềm có sẵn",
        levels: [
          { points: 1, title: "Nhanh, chính xác", desc: "Hỏi là thực hành được" },
          { points: 0.5, title: "Thao tác vừa phải", desc: "Cần hướng dẫn thêm" },
          { points: 0, title: "Chậm", desc: "Biết ít hoặc hầu như không biết" },
        ],
      },
      {
        id: "experience",
        label: "B. Thao tác với bộ môn trải nghiệm",
        levels: [
          { points: 1, title: "Làm quen nhanh, thao tác tốt" },
          { points: 0.5, title: "Làm quen ở mức khá", desc: "Thao tác có sai sót ít" },
          { points: 0, title: "Làm quen chậm", desc: "Thao tác có nhiều sai sót" },
        ],
      },
    ],
  },
  {
    num: 3,
    title: "Tư duy học tập",
    criteria: [
      {
        id: "absorb",
        label: "A. Tiếp thu và vận dụng kiến thức",
        levels: [
          { points: 2, title: "Tiếp thu tốt", desc: "Vận dụng được kiến thức đã học" },
          { points: 1, title: "Tiếp thu khá", desc: "Khi vận dụng còn quên một số kiến thức" },
          { points: 0, title: "Tiếp thu chậm", desc: "Cần giảng bài lại thường xuyên" },
        ],
      },
      {
        id: "logic",
        label: "B. Tư duy logic",
        levels: [
          { points: 2, title: "Suy luận vấn đề tốt", desc: "Các vấn đề liên kết chặt chẽ với nhau" },
          { points: 1, title: "Suy luận ra vấn đề", desc: "Nhưng chưa có tính liên kết chặt chẽ" },
          { points: 0, title: "Chưa nhận biết vấn đề", desc: "Cần gợi ý" },
        ],
      },
    ],
  },
];

export const RUBRIC_MAX = 10;

/** Danh sách phẳng 6 tiêu chí (thứ tự cố định) — dùng khi lặp/validate. */
export const RUBRIC_CRITERIA: RubricCriterion[] = RUBRIC.flatMap((s) => s.criteria);
export const RUBRIC_CRITERION_IDS = RUBRIC_CRITERIA.map((c) => c.id);

/** Điểm hợp lệ của 1 tiêu chí (dùng validate ở action). */
export function allowedPoints(criterionId: string): number[] {
  return RUBRIC_CRITERIA.find((c) => c.id === criterionId)?.levels.map((l) => l.points) ?? [];
}

/** Điểm tối đa của 1 tiêu chí (mức đầu). */
export function maxPoints(criterionId: string): number {
  return RUBRIC_CRITERIA.find((c) => c.id === criterionId)?.levels[0]?.points ?? 0;
}

/** Tổng điểm từ map { criterionId: points } — bỏ qua id lạ. */
export function computeTotal(scores: Record<string, number>): number {
  let sum = 0;
  for (const c of RUBRIC_CRITERIA) sum += scores[c.id] ?? 0;
  return Math.round(sum * 100) / 100;
}

/** 10.0 → "10.0", 0.5 → "0.5". */
export function fmtScore(n: number): string {
  return n % 1 === 0 ? n.toFixed(1) : n.toFixed(2).replace(/0$/, "");
}

export type RubricRank = "Tốt" | "Khá" | "Trung bình" | "Cần cố gắng";

/**
 * Xếp loại + tone theo tổng điểm, thang 10.0.
 *
 * Ngưỡng cũ trên thang 8 là 6.5 / 5 / 3.5 — tức 81,25% / 62,5% / 43,75%. Bộ mới lấy
 * 8 / 6 / 4 (80% / 60% / 40%): số tròn, và rơi ĐÚNG vào các tổng đạt được (mọi điểm
 * đều bội của 0.5) nên không có vùng chết ngay sát ngưỡng.
 */
export function rankOf(total: number): { label: RubricRank; tone: "green" | "blue" | "amber" | "red" } {
  if (total >= 8) return { label: "Tốt", tone: "green" };
  if (total >= 6) return { label: "Khá", tone: "blue" };
  if (total >= 4) return { label: "Trung bình", tone: "amber" };
  return { label: "Cần cố gắng", tone: "red" };
}

/** Nhận xét + định hướng mẫu (GV chỉnh lại) — prefill khi phiếu trống. */
export const DEFAULT_GENERAL_COMMENT =
  "Học sinh chú ý lắng nghe bài giảng, tiếp thu kiến thức tốt. Thao tác máy tính tốt. Học sinh hiểu bài tốt, có tư duy logic trong quá trình làm bài. Tuy nhiên cần luyện tập ghi nhớ nhiều từ vựng hơn để thao tác ngày càng thành thạo và thuận tiện hơn trong quá trình học.";
export const DEFAULT_ORIENTATION =
  "• Tiếp tục rèn luyện và thử sức với các bài tập nâng cao hơn.\n• Khuyến khích sáng tạo và mở rộng sản phẩm cá nhân.\n• Có thể tham gia học Sata tiếp theo.";
