// lib/ai-lead/dich-vu/quy-tac-page.ts — QUY TẮC THEO PAGE (E2): luật "Page này có được TỰ TẠO LEAD không", ở MỘT chỗ THUẦN.
//
// THUẦN có chủ đích: không DB, không env, không đồng hồ, không import runtime nào (chỉ `import type`). Vì sao:
//   · `intake.ts` (đường PHẢN HỒI của Agent) gọi nó mà KHÔNG được chạm CRM / bảng nào ngoài Gateway (N1) — hàm thuần không thể vi phạm;
//   · `page-agent.tsx` (màn Cấu hình) gọi CHÍNH hàm này để hiện "trạng thái hiệu lực" — màn hình và máy chủ không bao giờ nói hai điều khác nhau (luật 12).
//
// LUẬT (fail-closed — thiếu/ lạ một vế là KHÔNG tự tạo):
//   tự tạo lead  ⇔  công tắc toàn hệ (`ai.autoCreateEnabled`) BẬT
//                  ∧ cờ riêng của Page (`AiLeadAgentPage.autoCreate`) BẬT
//                  ∧ Page đang ENABLED
//                  ∧ Agent đang active
//                  ∧ môi trường là TEST hoặc PROD (giá trị lạ ⇒ từ chối).
//   Cổng PROD (`ai.prodEnabled` + chính sách đồng ý) KHÔNG lặp ở đây — đã chặn ở `xac-thuc.ts` trước khi yêu cầu tới được `intake.ts`. `environment` KHÔNG đổi kết quả
//   giữa TEST và PROD; chỉ để bắt giá trị lạ.
//   Cổng `ai.autoCreateEnabled` ở `tao-lead.ts` (`taoLeadTuHoSo`, tu = "AUTO") GIỮ NGUYÊN: lớp thứ hai, đọc lại cài đặt ngay lúc tạo.
import type { MoiTruong, TrangThaiPage } from "../kieu";

/** Mã lý do (ổn định — màn hình dịch ra chữ; test khoá theo mã). */
export type LyDoTuTao = "CHO_PHEP" | "TOAN_HE_TAT" | "PAGE_TAT" | "PAGE_TAM_DUNG" | "AGENT_TAT" | "MOI_TRUONG_LA";

export type DauVaoTuTao = {
  /** `ai.autoCreateEnabled` — công tắc TOÀN HỆ. */
  autoCreateToanHe: boolean;
  /** `AiLeadAgentPage.autoCreate` — cờ riêng của Page (mặc định TẮT). */
  pageAutoCreate: boolean;
  pageState: TrangThaiPage;
  agentActive: boolean;
  environment: MoiTruong;
};

export type KetQuaTuTao = { allowed: boolean; lyDo: LyDoTuTao };

/**
 * Thứ tự kiểm = thứ tự NGUYÊN NHÂN người vận hành cần xử lý trước: công tắc toàn hệ → cờ Page → Page tạm dừng → Agent tắt → môi trường.
 * Chỉ trả `allowed: true` ở đúng một nhánh cuối. Giá trị lạ của `pageState`/`environment` (dữ liệu hỏng, ép kiểu) ⇒ từ chối.
 */
export function choPhepTuTaoLead(x: DauVaoTuTao): KetQuaTuTao {
  if (x.autoCreateToanHe !== true) return { allowed: false, lyDo: "TOAN_HE_TAT" };
  if (x.pageAutoCreate !== true) return { allowed: false, lyDo: "PAGE_TAT" };
  if (x.pageState !== "ENABLED") return { allowed: false, lyDo: "PAGE_TAM_DUNG" };
  if (x.agentActive !== true) return { allowed: false, lyDo: "AGENT_TAT" };
  if (x.environment !== "TEST" && x.environment !== "PROD") return { allowed: false, lyDo: "MOI_TRUONG_LA" };
  return { allowed: true, lyDo: "CHO_PHEP" };
}

/** Câu tiếng Việt cho từng lý do — màn Cấu hình hiện đúng câu này (không tự ghép chuỗi ở component). */
export const CAU_LY_DO_TU_TAO: Record<LyDoTuTao, string> = {
  CHO_PHEP: "Đang hiệu lực: AI gửi đủ tên Facebook + SĐT + cơ sở là hệ thống tạo lead và chia sale ngay.",
  TOAN_HE_TAT: "Đang chờ công tắc toàn hệ (ai.autoCreateEnabled) — hiện TẮT nên chưa tự tạo lead nào, kể cả khi Page này bật.",
  PAGE_TAT: "Page này chưa bật tự tạo lead — hồ sơ đủ điều kiện vẫn chờ nhân viên duyệt.",
  PAGE_TAM_DUNG: "Page đang tạm dừng — chưa tự tạo lead.",
  AGENT_TAT: "Agent đang tắt — chưa tự tạo lead.",
  MOI_TRUONG_LA: "Môi trường Agent không hợp lệ — chưa tự tạo lead.",
};
