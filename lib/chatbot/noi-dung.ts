// lib/chatbot/noi-dung.ts — PHẦN THUẦN của chatbot website (không DB, không mạng, không đồng hồ).
// Dùng được ở TRÌNH DUYỆT: không import nội dung khoá học (khối lớn) — phần đó ở `loi-dan.ts`.
//
// Chủ dự án chốt 06/11/2026: chatbot chỉ trả lời câu hỏi ĐƠN GIẢN của phụ huynh rồi đưa phụ huynh
// sang Sale — KHÔNG làm thay phần tư vấn của Sale. Hai hệ quả trong thiết kế:
//  · Mọi dữ kiện chatbot được nói nằm trong `dungLoiDan()` (loi-dan.ts, CHỈ server) — dựng từ đúng các nguồn website đang
//    in (danh sách khoá, cơ sở, học thử, hotline), không gõ lại tay ⇒ đổi ở nguồn là chatbot đổi theo.
//  · Chatbot KHÔNG báo học phí và KHÔNG nhận SĐT trong khung chat: thu thông tin bằng BIỂU MẪU
//    (bắt buộc tên + SĐT + cơ sở) gửi qua đúng đường `/api/leads` ⇒ đi qua hệ thống chia lead hiện tại.

import { z } from "zod";
import { SATA_ROBO_PHONE } from "@/lib/locations";

/** Model trả lời (chủ dự án chốt 06/11/2026: Claude Haiku 5.5 — rẻ, nhanh, đủ cho hỏi đáp cơ bản). */
export const MODEL_CHATBOT = "claude-haiku-5-5";
/** Số lượt phụ huynh hỏi tối đa trong một cuộc trò chuyện — quá thì mời để lại thông tin. */
export const SO_LUOT_HOI_TOI_DA = 10;
/** Độ dài tối đa một tin nhắn (ký tự). */
export const DO_DAI_TIN_TOI_DA = 500;
/** Trần token câu trả lời (gồm cả phần suy nghĩ của model): trả lời 2–4 câu là đủ. */
export const TOKEN_TRA_LOI_TOI_DA = 1024;
/** Nguồn ghi vào `Lead.source` — khai trong `NGUON_CONG_KHAI_DA_BIET` (lib/validators/lead.ts). */
export const NGUON_LEAD_CHATBOT = "chatbot-website";
/** Câu chào mở đầu (hiện ở trình duyệt, KHÔNG gửi lên model). */
export const CAU_CHAO =
  "Chào ba mẹ! Sata Robo có thể giúp gì ạ? Ba mẹ hỏi về khoá học hợp với tuổi của con, học thử miễn phí hay địa chỉ cơ sở đều được nhé.";
/** Gợi ý bấm nhanh. */
export const GOI_Y_NHANH = [
  "Con lớp 3 nên học khoá nào?",
  "Học thử miễn phí thế nào?",
  "Cơ sở ở đâu, giờ mở cửa?",
] as const;
/** Câu thay thế khi chatbot không trả lời được (hết hạn mức, lỗi mạng, model từ chối…). */
export const CAU_DU_PHONG = `Xin lỗi ba mẹ, Sata Robo chưa trả lời được lúc này. Ba mẹ bấm "Để lại thông tin" để tư vấn viên gọi lại, hoặc gọi/nhắn Zalo ${SATA_ROBO_PHONE.hien} nhé.`;

// ───────────────────────────── Dữ liệu vào từ trình duyệt ─────────────────────────────

const tinNhan = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(DO_DAI_TIN_TOI_DA * 4),
});

/**
 * Cuộc trò chuyện trình duyệt gửi lên. Trình duyệt GIỮ lịch sử (máy chủ không lưu gì) nên mọi thứ
 * ở đây là đầu vào không tin cậy: giới hạn số lượt, độ dài, thứ tự vai.
 * Tin của trợ lý được phép dài hơn tin phụ huynh (×4) vì đó là câu trả lời cũ của chính chatbot.
 */
export const cuocTroChuyenSchema = z
  .object({ messages: z.array(tinNhan).min(1).max(SO_LUOT_HOI_TOI_DA * 2) })
  .superRefine((v, ctx) => {
    v.messages.forEach((m, i) => {
      const vaiDung = i % 2 === 0 ? "user" : "assistant";
      if (m.role !== vaiDung) ctx.addIssue({ code: "custom", message: "Thứ tự tin nhắn không hợp lệ", path: ["messages", i] });
      if (m.role === "user" && m.content.length > DO_DAI_TIN_TOI_DA) {
        ctx.addIssue({ code: "custom", message: `Tin nhắn tối đa ${DO_DAI_TIN_TOI_DA} ký tự`, path: ["messages", i] });
      }
    });
    if (v.messages.at(-1)?.role !== "user") ctx.addIssue({ code: "custom", message: "Tin cuối phải là của phụ huynh" });
  });
export type CuocTroChuyen = z.infer<typeof cuocTroChuyenSchema>;

// ───────────────────────────── Ghi chú lead ─────────────────────────────

/** Trần của `note` ở `leadCreateSchema` (lib/validators/lead.ts). */
export const DO_DAI_GHI_CHU_TOI_DA = 500;

export type ThongTinThem = {
  lopCuaCon: string | null;
  khoaQuanTam: string | null;
  diaChi: string | null;
};

/**
 * Ghi chú gắn vào lead cho Sale đọc trước khi gọi: thông tin phụ huynh khai thêm + các câu phụ huynh
 * đã HỎI (không kèm câu trả lời của chatbot). Không gọi model để tóm tắt: rẻ hơn và không có chuyện
 * chatbot bịa ra điều phụ huynh không nói. Cắt ở trần 500 ký tự của form lead.
 */
export function dungGhiChuLead(thongTin: ThongTinThem, cauHoi: readonly string[]): string {
  const phan = ["[Chatbot website]"];
  if (thongTin.lopCuaCon?.trim()) phan.push(`Con học: ${thongTin.lopCuaCon.trim()}`);
  if (thongTin.khoaQuanTam?.trim()) phan.push(`Quan tâm: ${thongTin.khoaQuanTam.trim()}`);
  if (thongTin.diaChi?.trim()) phan.push(`Địa chỉ: ${thongTin.diaChi.trim()}`);
  const hoi = cauHoi.map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (hoi.length) phan.push(`Đã hỏi: ${hoi.join(" | ")}`);
  const ghiChu = phan.join(" · ");
  return ghiChu.length <= DO_DAI_GHI_CHU_TOI_DA ? ghiChu : `${ghiChu.slice(0, DO_DAI_GHI_CHU_TOI_DA - 1)}…`;
}
