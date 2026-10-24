// lib/lms/session-eval-rubric.ts — Rubric "Phiếu nhận xét buổi học" của site GV.
//
// Port NGUYÊN từ TeachUI (src/data/mock.ts evalCriteria): 9 tiêu chí × 4 nhóm × 5 mức
// (1 = tốt nhất … 5 = cần cố gắng). Phiếu gồm: tên Dự án + nhận xét văn xuôi + 9
// dropdown năng lực. Pure (không "use server") nên dùng được cả server, client và
// @react-pdf.
//
// ⚠️ 21/08 — Ô VĂN XUÔI ĐỔI HÌNH: 4 ô rời (Kiến thức/Kỹ năng/Thái độ/Đề xuất) gộp
// thành MỘT ô "Đánh giá chung" (`overall`, ≤ 2000 ký tự). 4 khoá cũ KHÔNG bị xoá khỏi
// kiểu dữ liệu và KHÔNG có migration nào đụng vào phiếu đã lưu: hàng nghìn phiếu trên
// prod vẫn nằm ở dạng 4 mục, nên mọi chỗ ĐỌC phải hiểu cả hai dạng (xem
// `evalNotesProse`), còn chỗ GHI thì từ nay chỉ điền `overall`. Phiếu cũ chuyển sang
// dạng mới đúng lúc giáo viên mở ra sửa (`toOverallText` ghép 4 mục thành một đoạn).

export type EvalLevel = { value: number; text: string };
export type EvalCriterion = { id: string; group: string; name: string; levels: EvalLevel[] };

/**
 * 4 mục nhận xét văn xuôi CŨ (phiếu trước 21/08). Giữ lại để ĐỌC phiếu cũ — đừng dựng
 * form nhập mới từ mảng này nữa.
 */
export const EVAL_NOTE_FIELDS = [
  { key: "knowledge", label: "Kiến thức" },
  { key: "skill", label: "Kỹ năng" },
  { key: "attitude", label: "Thái độ" },
  { key: "proposal", label: "Đề xuất" },
] as const;

export type EvalNoteKey = (typeof EVAL_NOTE_FIELDS)[number]["key"];
/** Phiếu mới điền `overall`; 4 khoá còn lại chỉ còn dữ liệu ở phiếu cũ. */
export type EvalNotes = Record<EvalNoteKey, string> & { overall: string };

export const EMPTY_NOTES: EvalNotes = {
  overall: "",
  knowledge: "",
  skill: "",
  attitude: "",
  proposal: "",
};

/** Nhãn + trần độ dài của ô nhận xét MỚI. */
export const EVAL_OVERALL_LABEL = "Đánh giá chung";
export const EVAL_OVERALL_MAX = 2000;
/**
 * Trần AN TOÀN của cột (chống payload rác), KHÁC trần nghiệp vụ 2000 ở trên.
 * Vì sao cần hai con số: phiếu CŨ có 4 mục × 3000 ký tự, ghép lại kèm nhãn có thể vượt
 * 2000. Bắt trần 2000 lên cả nội dung cũ thì giáo viên KHÔNG lưu nổi phiếu đó nữa —
 * kể cả khi chỉ muốn đổi một ô năng lực — cho tới khi tự tay xoá bớt chữ mình đã viết.
 * Luật thật: 2000 áp cho nội dung GV VỪA SỬA; nội dung cũ giữ nguyên thì cho qua
 * (xem saveSessionEvalCore).
 */
export const EVAL_OVERALL_HARD_MAX = 13000;

/** Khối "Hướng dẫn gợi ý khi viết nhận xét chung" hiện dưới ô nhập (chốt 21/08). */
export const EVAL_OVERALL_GUIDE_INTRO =
  "Hướng dẫn gợi ý khi viết nhận xét chung: (Lưu ý sử dụng ngôn từ phù hợp, tích cực và dễ hiểu để phụ huynh đọc)";

export const EVAL_OVERALL_GUIDE_ITEMS: { label: string; text: string }[] = [
  {
    label: "Kiến thức",
    text: "Đánh giá mức độ tiếp thu, ghi nhớ và vận dụng kiến thức đã học của học viên (hiểu bài tốt, nắm được kiến thức cơ bản, ghi nhớ câu lệnh, biết áp dụng kiến thức vào bài tập,...)",
  },
  {
    label: "Kỹ năng",
    text: "Đánh giá các kỹ năng học viên đã thể hiện trong quá trình học tập và thực hành (kỹ năng lắp ráp, thao tác máy tính, lập trình, tư duy logic, giải quyết vấn đề, khả năng vận dụng kiến thức, sự chủ động trong thực hành,...)",
  },
  {
    label: "Thái độ",
    text: "Đánh giá tinh thần và thái độ học tập của học viên (tập trung, chủ động, tích cực, chăm chỉ, hợp tác, thực hiện đúng hướng dẫn, có tinh thần học hỏi,...). Có thể đề cập nhẹ nhàng những điểm cần cải thiện (Cần tập trung hơn khi...; Chủ động hơn trong việc...; Tích cực tham gia...)",
  },
  {
    label: "Đề xuất",
    text: "Đưa ra hướng luyện tập và giải pháp cụ thể giúp học viên phát triển thêm kỹ năng hoặc cải thiện những nội dung còn hạn chế (Khuyến khích ôn tập thêm kiến thức đã học; Rèn luyện thêm kỹ năng lập trình; Tăng cường thực hành; Luyện tập thêm các câu lệnh; Chủ động thực hiện bài tập ở nhà,...)",
  },
];

export const EVAL_OVERALL_GUIDE_NOTE =
  "Nội dung nhận xét cần đảm bảo có đầy đủ Kiến thức – Kỹ năng – Thái độ – Đề xuất, ưu tiên cách diễn đạt tích cực, mang tính xây dựng và phù hợp để phụ huynh theo dõi quá trình học tập của học viên.";

/** Mức mặc định khi mở phiếu mới (giữa thang) — khớp reference. */
export const DEFAULT_EVAL_LEVEL = 3;

export const DEFAULT_PROJECT_NAME = "Dự án 1: Làm quen hệ thống";

// 9 tiêu chí năng lực (mục ②) — thứ tự + nhóm giữ nguyên reference.
export const EVAL_CRITERIA: EvalCriterion[] = [
  {
    id: "kt-cu",
    group: "Kiến thức",
    name: "Kiến thức cũ",
    levels: [
      { value: 1, text: "Nhớ rõ toàn bộ kiến thức cũ và vận dụng linh hoạt, kết hợp kiến thức mới để giải quyết thử thách." },
      { value: 2, text: "Nhớ tốt kiến thức cũ và biết cách áp dụng vào hầu hết các tình huống quen thuộc." },
      { value: 3, text: "Nhớ được hầu hết kiến thức cũ, đôi khi còn quên một vài nội dung và cần giáo viên nhắc lại." },
      { value: 4, text: "Nhớ được kiến thức cũ nhưng còn bối rối khi áp dụng vào hoàn cảnh mới." },
      { value: 5, text: "Còn quên nhiều kiến thức cũ, cần ôn tập lại và được hỗ trợ thường xuyên." },
    ],
  },
  {
    id: "kt-moi",
    group: "Kiến thức",
    name: "Kiến thức mới",
    levels: [
      { value: 1, text: "Tiếp thu kiến thức rất tốt, hoàn thành 100% nhiệm vụ bài học và còn mở rộng thêm." },
      { value: 2, text: "Tiếp thu kiến thức tốt, hoàn thành đầy đủ các nhiệm vụ chính của bài học." },
      { value: 3, text: "Tiếp thu khá tốt, hoàn thành khoảng 70% thử thách thuộc phần kiến thức mới." },
      { value: 4, text: "Tiếp thu được kiến thức cơ bản, hoàn thành khoảng 50% nhiệm vụ." },
      { value: 5, text: "Hoàn thiện dưới 50% các nhiệm vụ kiến thức. Cần cố gắng hơn!" },
    ],
  },
  {
    id: "kn-st",
    group: "Kỹ năng",
    name: "Sáng tạo (Creativity)",
    levels: [
      { value: 1, text: "Tự tin phát triển ý tưởng cá nhân, dám thử nghiệm nhiều phương án khác nhau để giải quyết vấn đề." },
      { value: 2, text: "Chủ động đề xuất ý tưởng mới và biết cách chọn lọc để triển khai." },
      { value: 3, text: "Đưa ra được nhiều ý tưởng sáng tạo nhưng cần giáo viên gợi ý để lựa chọn và triển khai." },
      { value: 4, text: "Có ý tưởng riêng nhưng còn dựa nhiều vào mẫu của giáo viên." },
      { value: 5, text: "Hoàn thiện nhiệm vụ theo đúng mẫu của giáo viên." },
    ],
  },
  {
    id: "kn-pb",
    group: "Kỹ năng",
    name: "Tư duy phản biện (Critical Thinking)",
    levels: [
      { value: 1, text: "Chủ động lập luận, phân tích vấn đề đa chiều và đề xuất phương án giải quyết thuyết phục." },
      { value: 2, text: "Chủ động lập luận, tìm hiểu vấn đề và đưa ra phương án giải quyết." },
      { value: 3, text: "Tích cực lắng nghe, đặt câu hỏi và trao đổi xây dựng bài học." },
      { value: 4, text: "Có lắng nghe và trao đổi nhưng chưa chủ động đặt câu hỏi." },
      { value: 5, text: "Còn rụt rè trong việc đưa ra quan điểm cá nhân." },
    ],
  },
  {
    id: "kn-mem",
    group: "Kỹ năng",
    name: "Kỹ năng mềm",
    levels: [
      { value: 1, text: "Trình bày ý tưởng tự tin và điều phối công việc nhóm xuất sắc." },
      { value: 2, text: "Trình bày rõ ràng và phối hợp tốt với các bạn trong nhóm." },
      { value: 3, text: "Nỗ lực hoàn thành nhiệm vụ được giao, hướng tới mục tiêu chung của nhóm." },
      { value: 4, text: "Trình bày được ý tưởng nhưng chưa trôi chảy, cần tích cực hơn khi làm việc nhóm." },
      { value: 5, text: "Còn ngại trình bày và tham gia hoạt động nhóm, cần được khích lệ thêm." },
    ],
  },
  {
    id: "sp-ht",
    group: "Sản phẩm",
    name: "Mức độ hoàn thiện",
    levels: [
      { value: 1, text: "Sử dụng đầy đủ kiến thức bắt buộc; sản phẩm hoạt động tốt, tính thẩm mỹ cao." },
      { value: 2, text: "Sử dụng đầy đủ kiến thức bài học; sản phẩm hoạt động ổn định." },
      { value: 3, text: "Đạt khoảng 50-70% kiến thức bài học; các tính năng cơ bản hoạt động." },
      { value: 4, text: "Sản phẩm hoạt động được một phần, còn một số lỗi cần khắc phục." },
      { value: 5, text: "Dự án chưa hoàn thiện hoặc chưa chạy được tốt." },
    ],
  },
  {
    id: "sp-yt",
    group: "Sản phẩm",
    name: "Ý tưởng dự án",
    levels: [
      { value: 1, text: "Dự án mở rộng và sáng tạo trên chủ đề, hoàn toàn cá nhân hóa, không dùng mẫu." },
      { value: 2, text: "Dự án thể hiện rõ chủ đề với ý tưởng riêng của bản thân." },
      { value: 3, text: "Có sử dụng một số ý tưởng từ dự án khác nhưng được thay đổi phù hợp." },
      { value: 4, text: "Dự án thể hiện được một phần chủ đề và chủ yếu làm theo mẫu." },
      { value: 5, text: "Dự án làm hoàn toàn theo mẫu, chưa thể hiện ý tưởng cá nhân." },
    ],
  },
  {
    id: "td-tt",
    group: "Thái độ học tập",
    name: "Mức độ tập trung",
    levels: [
      { value: 1, text: "Rất tập trung và tương tác tốt với toàn bộ nội dung bài học." },
      { value: 2, text: "Tập trung tốt trong phần lớn buổi học." },
      { value: 3, text: "Tập trung ở mức ổn, đôi lúc cần được nhắc nhở." },
      { value: 4, text: "Thỉnh thoảng bị mất tập trung tại một số thời điểm." },
      { value: 5, text: "Còn dễ bị phân tâm, cần được hỗ trợ để duy trì sự tập trung." },
    ],
  },
  {
    id: "td-gt",
    group: "Thái độ học tập",
    name: "Thái độ giao tiếp",
    levels: [
      { value: 1, text: "Trao đổi, giao tiếp rất chủ động với thầy cô và bạn bè." },
      { value: 2, text: "Giao tiếp cởi mở và sẵn sàng chia sẻ trong lớp." },
      { value: 3, text: "Giao tiếp ở mức ổn, chủ yếu trả lời khi được hỏi." },
      { value: 4, text: "Còn khá ít trao đổi, cần được khuyến khích thêm." },
      { value: 5, text: "Còn rụt rè khi giao tiếp với thầy cô và các bạn." },
    ],
  },
];

/** Bảng tra nhanh tiêu chí theo id. */
export const EVAL_CRITERIA_BY_ID: Record<string, EvalCriterion> = Object.fromEntries(
  EVAL_CRITERIA.map((c) => [c.id, c]),
);

/** Thứ tự nhóm xuất hiện (giữ đúng thứ tự khai báo). */
export const EVAL_GROUP_ORDER: string[] = [...new Set(EVAL_CRITERIA.map((c) => c.group))];

/** Nhóm tiêu chí theo `group` để render thành khối. */
export function groupedEvalCriteria(): [string, EvalCriterion[]][] {
  const map = new Map<string, EvalCriterion[]>();
  for (const c of EVAL_CRITERIA) {
    const arr = map.get(c.group) ?? [];
    arr.push(c);
    map.set(c.group, arr);
  }
  return [...map.entries()];
}

/** Text mô tả của một mức (1-5) cho tiêu chí — fallback rỗng nếu không hợp lệ. */
export function evalLevelText(criterionId: string, value: number): string {
  return EVAL_CRITERIA_BY_ID[criterionId]?.levels.find((l) => l.value === value)?.text ?? "";
}

/** Chuẩn hoá ratings từ Json đã lưu → mọi tiêu chí có giá trị 1-5 (mặc định 3). */
export function normalizeEvalRatings(raw: unknown): Record<string, number> {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const c of EVAL_CRITERIA) {
    const v = Number(obj[c.id]);
    out[c.id] = Number.isInteger(v) && v >= 1 && v <= 5 ? v : DEFAULT_EVAL_LEVEL;
  }
  return out;
}

/** Chuẩn hoá các mục nhận xét từ Json đã lưu (phiếu mới `overall` + 4 mục cũ). */
export function normalizeEvalNotes(raw: unknown): EvalNotes {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    overall: typeof obj.overall === "string" ? obj.overall : "",
    knowledge: typeof obj.knowledge === "string" ? obj.knowledge : "",
    skill: typeof obj.skill === "string" ? obj.skill : "",
    attitude: typeof obj.attitude === "string" ? obj.attitude : "",
    proposal: typeof obj.proposal === "string" ? obj.proposal : "",
  };
}

/** 4 mục cũ CÓ NỘI DUNG của một phiếu (bỏ mục trống) — rỗng với phiếu dạng mới. */
export function legacyNoteRows(
  notes: EvalNotes,
): { key: EvalNoteKey; label: string; text: string }[] {
  return EVAL_NOTE_FIELDS.map((f) => ({ ...f, text: notes[f.key].trim() })).filter(
    (r) => r.text.length > 0,
  );
}

/**
 * Văn xuôi của phiếu, đã phân biệt hai dạng dữ liệu — MỌI chỗ hiển thị nên đi qua đây
 * thay vì tự đoán, nếu không phiếu cũ sẽ mất chữ hoặc phiếu mới bị in hai lần.
 *   • `{ kind: "overall" }`  — phiếu từ 21/08: một đoạn "Đánh giá chung".
 *   • `{ kind: "legacy" }`   — phiếu cũ: các mục Kiến thức/Kỹ năng/Thái độ/Đề xuất.
 *   • `null`                 — phiếu không có văn xuôi (chỉ rubric/sao).
 * `overall` thắng khi phiếu có cả hai (phiếu cũ vừa được sửa lại theo dạng mới).
 */
export function evalNotesProse(
  notes: EvalNotes | null | undefined,
):
  | { kind: "overall"; text: string }
  | { kind: "legacy"; rows: { key: EvalNoteKey; label: string; text: string }[] }
  | null {
  if (!notes) return null;
  const overall = notes.overall.trim();
  if (overall) return { kind: "overall", text: overall };
  const rows = legacyNoteRows(notes);
  return rows.length > 0 ? { kind: "legacy", rows } : null;
}

/**
 * Nội dung mồi cho ô "Đánh giá chung" khi giáo viên mở lại một phiếu.
 * Phiếu cũ (4 mục) được GHÉP thành một đoạn có nhãn — không cắt bớt, kể cả khi dài hơn
 * EVAL_OVERALL_MAX: thà để giáo viên tự rút gọn còn hơn im lặng nuốt chữ họ đã viết
 * (hộp thoại chặn Lưu và báo số ký tự thừa).
 */
export function toOverallText(notes: EvalNotes | null | undefined): string {
  if (!notes) return "";
  const overall = notes.overall.trim();
  if (overall) return overall;
  return legacyNoteRows(notes)
    .map((r) => `${r.label}: ${r.text}`)
    .join("\n");
}

// ─── ĐỌC phiếu đã lưu (parse Json do GV ghi — có thể null/sai dạng, KHÔNG throw) ──
// Trước 18/08 hai hàm này nằm trong lib/portal/feedback.ts, kéo theo `server-only` +
// Prisma cho bất kỳ ai muốn render phiếu. Chuyển về đây (module thuần) để portal PH,
// site GV và màn admin dùng CHUNG một cách hiểu dữ liệu. feedback.ts re-export lại.

/**
 * Nhận xét văn xuôi từ Json đã lưu → null nếu KHÔNG mục nào có nội dung.
 * Tính cả `overall` (phiếu từ 21/08) lẫn 4 mục cũ — bỏ sót `overall` ở đây là phiếu mới
 * bị coi như "chưa có nhận xét" trên portal phụ huynh, PDF và màn quản lý.
 */
export function parseFeedbackNotes(raw: unknown): EvalNotes | null {
  const notes = normalizeEvalNotes(raw);
  const hasAny =
    notes.overall.trim().length > 0 ||
    EVAL_NOTE_FIELDS.some((f) => notes[f.key].trim().length > 0);
  return hasAny ? notes : null;
}

/**
 * Rubric từ Json đã lưu → chỉ giữ tiêu chí ĐÃ BIẾT (EVAL_CRITERIA) có mức 1-5 hợp lệ;
 * null nếu không còn gì (khác normalizeEvalRatings: KHÔNG chế mức mặc định — phiếu
 * không chấm rubric thì người đọc không được thấy điểm 3 do máy bịa ra).
 */
export function parseFeedbackRubric(raw: unknown): Record<string, number> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const c of EVAL_CRITERIA) {
    const v0 = obj[c.id];
    const v = typeof v0 === "number" ? v0 : typeof v0 === "string" ? Number(v0) : NaN;
    if (Number.isInteger(v) && v >= 1 && v <= 5) out[c.id] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}
