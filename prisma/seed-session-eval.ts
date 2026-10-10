// FL4 (R5) — Seed mẫu phiếu ĐÁNH GIÁ BUỔI HỌC (SESSION_EVAL) khớp phiếu giấy thật
// (Document/0-yeucau/0-tai-lieu-goc/Phiếu đánh giá buổi học.html).
//
// Idempotent: upsert EvalForm theo id cố định "seed-session-eval-form"; câu hỏi
// upsert theo (formId, order) — findFirst rồi update/create, xoá câu thừa cuối.
// Sau khi seed, admin tạo 1 đợt (EvaluationRound) SESSION_EVAL trỏ form này để mở phiếu.
//
// Chạy: pnpm exec dotenv -e .env -- tsx prisma/seed-session-eval.ts  (hoặc pnpm db:seed:session-eval)
import { db } from "../lib/db";
import type { EvalQuestionType } from "@prisma/client";

const FORM_ID = "seed-session-eval-form";
const FORM_TITLE = "Phiếu đánh giá buổi học (mẫu)";

type QDef = {
  type: EvalQuestionType;
  label: string;
  options?: string[];
  required?: boolean;
  groupLabel?: string | null;
  allowCustomText?: boolean;
};

// 5 mức mô tả (value 1..5) — text LẤY NGUYÊN từ phiếu HTML.
const KIEN_THUC_CU = [
  "Bạn nhớ rõ toàn bộ kiến thức cũ và vận dụng linh hoạt, kết hợp kiến thức mới để giải quyết thử thách.",
  "Bạn nhớ tốt kiến thức cũ và biết cách áp dụng vào hầu hết các tình huống quen thuộc.",
  "Bạn nhớ được hầu hết kiến thức cũ, đôi khi còn quên một vài nội dung và cần giáo viên nhắc lại.",
  "Bạn nhớ được kiến thức cũ nhưng còn bối rối khi áp dụng vào hoàn cảnh mới.",
  "Bạn còn quên nhiều kiến thức cũ, cần ôn tập lại và được hỗ trợ thường xuyên.",
];
const KIEN_THUC_MOI = [
  "Bạn tiếp thu kiến thức rất tốt, hoàn thành 100% nhiệm vụ bài học và còn mở rộng thêm.",
  "Bạn tiếp thu kiến thức tốt, hoàn thành đầy đủ các nhiệm vụ chính của bài học.",
  "Bạn tiếp thu khá tốt, hoàn thành khoảng 70% thử thách thuộc phần kiến thức mới.",
  "Bạn tiếp thu được kiến thức cơ bản, hoàn thành khoảng 50% nhiệm vụ.",
  "Bạn hoàn thiện dưới 50% các nhiệm vụ kiến thức. Cần cố gắng hơn!",
];
const SANG_TAO = [
  "Bạn tự tin phát triển ý tưởng cá nhân, dám thử nghiệm nhiều phương án khác nhau để giải quyết vấn đề.",
  "Bạn chủ động đề xuất ý tưởng mới và biết cách chọn lọc để triển khai.",
  "Bạn đưa ra được nhiều ý tưởng sáng tạo nhưng cần giáo viên gợi ý để lựa chọn và triển khai.",
  "Bạn có ý tưởng riêng nhưng còn dựa nhiều vào mẫu của giáo viên.",
  "Bạn hoàn thiện nhiệm vụ theo đúng mẫu của giáo viên.",
];
const TU_DUY_PHAN_BIEN = [
  "Bạn chủ động lập luận, phân tích vấn đề đa chiều và đề xuất phương án giải quyết thuyết phục.",
  "Bạn chủ động lập luận, tìm hiểu vấn đề và đưa ra phương án giải quyết.",
  "Bạn tích cực lắng nghe, đặt câu hỏi và trao đổi xây dựng bài học.",
  "Bạn có lắng nghe và trao đổi nhưng chưa chủ động đặt câu hỏi.",
  "Bạn còn rụt rè trong việc đưa ra quan điểm cá nhân.",
];
const KY_NANG_MEM = [
  "Bạn trình bày ý tưởng tự tin và điều phối công việc nhóm xuất sắc.",
  "Bạn trình bày rõ ràng và phối hợp tốt với các bạn trong nhóm.",
  "Bạn nỗ lực hoàn thành nhiệm vụ được giao, hướng tới mục tiêu chung của nhóm.",
  "Bạn trình bày được ý tưởng nhưng chưa trôi chảy, cần tích cực hơn khi làm việc nhóm.",
  "Bạn còn ngại trình bày và tham gia hoạt động nhóm, cần được khích lệ thêm.",
];
const MUC_DO_HOAN_THIEN = [
  "Sử dụng đầy đủ kiến thức bắt buộc; sản phẩm hoạt động tốt, tính thẩm mỹ cao.",
  "Sử dụng đầy đủ kiến thức bài học; sản phẩm hoạt động ổn định.",
  "Đạt khoảng 50–70% kiến thức bài học; các tính năng cơ bản hoạt động.",
  "Sản phẩm hoạt động được một phần, còn một số lỗi cần khắc phục.",
  "Dự án chưa hoàn thiện hoặc chưa chạy được tốt.",
];
const Y_TUONG_DU_AN = [
  "Dự án mở rộng và sáng tạo trên chủ đề, hoàn toàn cá nhân hóa, không dùng mẫu.",
  "Dự án thể hiện rõ chủ đề với ý tưởng riêng của bản thân.",
  "Có sử dụng một số ý tưởng từ dự án khác nhưng được thay đổi phù hợp.",
  "Dự án thể hiện được một phần chủ đề và chủ yếu làm theo mẫu.",
  "Dự án làm hoàn toàn theo mẫu, chưa thể hiện ý tưởng cá nhân.",
];
const MUC_DO_TAP_TRUNG = [
  "Bạn rất tập trung và tương tác tốt với toàn bộ nội dung bài học.",
  "Bạn tập trung tốt trong phần lớn buổi học.",
  "Bạn tập trung ở mức ổn, đôi lúc cần được nhắc nhở.",
  "Bạn thỉnh thoảng bị mất tập trung tại một số thời điểm.",
  "Bạn còn dễ bị phân tâm, cần được hỗ trợ để duy trì sự tập trung.",
];
const THAI_DO_GIAO_TIEP = [
  "Bạn trao đổi, giao tiếp rất chủ động với thầy cô và bạn bè.",
  "Bạn giao tiếp cởi mở và sẵn sàng chia sẻ trong lớp.",
  "Bạn giao tiếp ở mức ổn, chủ yếu trả lời khi được hỏi.",
  "Bạn còn khá ít trao đổi, cần được khuyến khích thêm.",
  "Bạn còn rụt rè khi giao tiếp với thầy cô và các bạn.",
];

const DEFS: QDef[] = [
  // Nhóm 1 — Kiến thức
  { type: "RADIO", label: "Kiến thức cũ", options: KIEN_THUC_CU, groupLabel: "Kiến thức" },
  { type: "RADIO", label: "Kiến thức mới", options: KIEN_THUC_MOI, groupLabel: "Kiến thức" },
  // Nhóm 2 — Kỹ năng
  { type: "RADIO", label: "Sáng tạo (Creativity)", options: SANG_TAO, groupLabel: "Kỹ năng" },
  { type: "RADIO", label: "Tư duy phản biện (Critical Thinking)", options: TU_DUY_PHAN_BIEN, groupLabel: "Kỹ năng" },
  { type: "RADIO", label: "Kỹ năng mềm", options: KY_NANG_MEM, groupLabel: "Kỹ năng" },
  // Nhóm 3 — Sản phẩm
  { type: "RADIO", label: "Mức độ hoàn thiện", options: MUC_DO_HOAN_THIEN, groupLabel: "Sản phẩm" },
  { type: "RADIO", label: "Ý tưởng dự án", options: Y_TUONG_DU_AN, groupLabel: "Sản phẩm" },
  // Nhóm 4 — Thái độ học tập
  { type: "RADIO", label: "Mức độ tập trung", options: MUC_DO_TAP_TRUNG, groupLabel: "Thái độ học tập" },
  { type: "RADIO", label: "Thái độ giao tiếp", options: THAI_DO_GIAO_TIEP, groupLabel: "Thái độ học tập" },
  // Nhận xét của giáo viên + Đề xuất
  { type: "TEXTBOX", label: "Nhận xét của giáo viên", groupLabel: "Nhận xét của giáo viên" },
  { type: "TEXTBOX", label: "Đề xuất", groupLabel: "Nhận xét của giáo viên" },
  // Hình ảnh dự án & lớp học
  { type: "PHOTO", label: "Hình ảnh dự án & lớp học (tối đa 3 ảnh)", groupLabel: "Hình ảnh dự án & lớp học" },
];

async function main() {
  await db.evalForm.upsert({
    where: { id: FORM_ID },
    update: { title: FORM_TITLE, scope: "SESSION_EVAL", status: "ACTIVE" },
    create: { id: FORM_ID, title: FORM_TITLE, scope: "SESSION_EVAL", status: "ACTIVE" },
  });

  for (let i = 0; i < DEFS.length; i++) {
    const q = DEFS[i]!;
    const data = {
      type: q.type,
      label: q.label,
      options: q.type === "RADIO" || q.type === "CHECKBOX" ? (q.options ?? []) : undefined,
      required: q.required ?? false,
      order: i,
      groupLabel: q.groupLabel ?? null,
      allowCustomText: q.allowCustomText ?? false,
    };
    const existing = await db.evalQuestion.findFirst({
      where: { formId: FORM_ID, order: i },
      select: { id: true },
    });
    if (existing) {
      await db.evalQuestion.update({ where: { id: existing.id }, data });
    } else {
      await db.evalQuestion.create({ data: { formId: FORM_ID, ...data } });
    }
  }

  // Dọn câu hỏi thừa (nếu lần seed trước có nhiều câu hơn).
  await db.evalQuestion.deleteMany({ where: { formId: FORM_ID, order: { gte: DEFS.length } } });

  console.log(`✓ Seed phiếu "${FORM_TITLE}" (${DEFS.length} câu, id=${FORM_ID}).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
