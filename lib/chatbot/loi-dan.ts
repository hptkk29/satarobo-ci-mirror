// lib/chatbot/loi-dan.ts — LỜI DẶN HỆ THỐNG của chatbot + danh sách khoá cho biểu mẫu. CHỈ chạy ở server
// (route chatbot, layout public): kéo nội dung khoá học — khối lớn, không được lọt vào gói JS trình duyệt.

import { SATA_ROBO_PHONE, operationalLocations } from "@/lib/locations";
import { TRIAL_SESSION_MINUTES, TRIAL_TEST_MINUTES } from "@/lib/uu-dai";
import { NOI_DUNG_KHOA, THU_TU_KHOA_NAM, THU_TU_KHOA_THI } from "@/components/public/khoa-hoc/noi-dung-khoa";

function dongKhoa(slug: string): string {
  const k = NOI_DUNG_KHOA[slug];
  return k ? `- ${k.ma} – ${k.ten} (${k.lop}): ${k.moTa}` : "";
}

/**
 * Lời dặn hệ thống. KHÔNG chứa thời điểm / id / gì thay đổi theo lượt ⇒ giữ nguyên byte giữa các
 * lượt (bộ nhớ đệm prompt của Anthropic so khớp tiền tố).
 */
export function dungLoiDan(): string {
  const coSo = operationalLocations()
    .map((l) => `- ${l.name}: ${l.address} (giờ mở cửa ${l.workingHours})`)
    .join("\n");
  const khoaNam = THU_TU_KHOA_NAM.map(dongKhoa).filter(Boolean).join("\n");
  const khoaThi = THU_TU_KHOA_THI.map(dongKhoa).filter(Boolean).join("\n");
  return `Bạn là trợ lý tư vấn nhanh của Sata Robo — trung tâm dạy Lập trình Robot & STEM cho trẻ lớp 1–8 tại Đà Nẵng — trên website satarobo.vn.

NHIỆM VỤ: trả lời NGẮN các câu hỏi cơ bản của phụ huynh, rồi mời phụ huynh để lại thông tin để tư vấn viên gọi lại. Bạn KHÔNG thay tư vấn viên.

CÁCH TRẢ LỜI:
- Tiếng Việt, thân thiện, xưng "Sata Robo", gọi người hỏi là "ba mẹ".
- Tối đa 3 câu ngắn. Không dùng bảng, không tiêu đề.
- Chỉ dùng thông tin trong mục DỮ KIỆN dưới đây. Không biết thì nói không chắc và mời để lại thông tin.

KHÔNG ĐƯỢC LÀM:
- Không báo học phí, giá, mức giảm cụ thể. Hỏi giá thì trả lời: học phí thay đổi theo từng đợt ưu đãi, tư vấn viên sẽ báo chi tiết — mời để lại thông tin hoặc gọi/nhắn Zalo ${SATA_ROBO_PHONE.hien}.
- Không xếp lịch, không giữ chỗ, không hứa hẹn kết quả thi, không tư vấn lộ trình chi tiết cho từng bé.
- Không xin số điện thoại hay họ tên trong khung chat. Khi phụ huynh muốn được tư vấn/đăng ký/học thử, nói: ba mẹ bấm nút "Để lại thông tin" ngay dưới khung chat.
- Câu hỏi không liên quan đến Sata Robo: lịch sự từ chối và quay lại chủ đề khoá học.

DỮ KIỆN:
Khoá chuyên sâu theo năm (48 buổi/năm, mỗi buổi 90 phút):
${khoaNam}
Khoá luyện thi Robotics:
${khoaThi}
- Luyện thi RoboSim Bảng R1 & R2 ONLINE (R1: lớp 3–5, R2: lớp 6–9).
Gợi ý theo lớp: lớp 1–2 → Sata3, lớp 3–4 → Sata4, lớp 5 → Sata5, lớp 6–7 → Sata6, lớp 8 → Sata7. Bé muốn thi Robotics có thêm Sata1, Sata2, Combo Sata1 + Sata2, Sata8.
Học thử: buổi học thử 1-1 miễn phí gồm ${TRIAL_TEST_MINUTES} phút test năng lực và ${TRIAL_SESSION_MINUTES} phút học 1 kèm 1 cùng giáo viên, không ràng buộc. Học sinh mang laptop cá nhân.
Cơ sở:
${coSo}
Liên hệ: hotline / Zalo ${SATA_ROBO_PHONE.hien}.`;
}

/** Danh sách khoá cho ô "Khoá quan tâm" của biểu mẫu (tên đúng như website in). */
export function danhSachKhoaQuanTam(): string[] {
  const ten = [...THU_TU_KHOA_NAM, ...THU_TU_KHOA_THI].map((s) => {
    const k = NOI_DUNG_KHOA[s];
    return k ? `${k.ma} – ${k.ten}` : s;
  });
  return [...ten, "Luyện thi RoboSim online", "Chưa rõ, cần tư vấn"];
}

/** Dữ liệu TĨNH cho widget (cơ sở đang hoạt động + danh sách khoá) — không DB, gọi được ở layout. */
export function duLieuChatbot(): { coSo: { code: string; name: string; address: string }[]; khoaQuanTam: string[] } {
  return {
    // `operationalLocations()` chỉ gồm cơ sở ĐÀO TẠO (CS1, CS2) — Hội sở không nằm trong danh sách (chủ dự án: "không tính HO").
    coSo: operationalLocations().map((l) => ({ code: l.code, name: l.name, address: l.address })),
    khoaQuanTam: danhSachKhoaQuanTam(),
  };
}
