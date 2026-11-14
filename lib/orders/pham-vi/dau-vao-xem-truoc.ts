// lib/orders/pham-vi/dau-vao-xem-truoc.ts — ĐỌC đầu vào của action "xem trước giá theo phạm vi học" và nói THẬT vì sao bị từ chối. THUẦN.
//
// ── VÌ SAO TÁCH RA [14/10/2026, PR "vá sau smoke"] ───────────────────────────────────────────────────────────────
// Smoke trên test.satarobo.vn: sale bấm vào ô "Số buổi mua" (đang mang 48 do chọn khoá điền sẵn) và gõ "24" mà không bôi đen — giá trị thành
// 4824, vượt trần 500 của `orderItemSchema` (`metadata.soBuoi`). Zod từ chối ở CỔNG ĐỌC, trước khi planner thấy gì, và action cũ gom MỌI lỗi zod
// thành "Dữ liệu không hợp lệ" — câu không nói số nào, dòng nào, vì sao. Người dùng đọc nó như "máy chủ hỏng" rồi gõ lại cho tới khi đúng.
//
// Quy tắc: thông điệp của refine (`code: "custom"`) là câu TIẾNG VIỆT do chính schema viết cho người dùng ("Số buổi phải là số nguyên từ 1 đến 500"),
// nên chuyển nguyên văn kèm "Dòng N: ". Lỗi cấu trúc của zod ("Invalid input: expected string…") là tiếng Anh nội bộ — KHÔNG đưa ra màn, giữ câu chung.
//
// ⚠️ Chỉ đổi CÂU CHỮ của lời từ chối. Hình dạng đầu vào, trần 500 và mọi luật của planner ĐỨNG NGUYÊN — thêm lớp "kẹp về 500" hay "đổi thành null"
// ở đây là sai: `soBuoi = null` nghĩa là "mua ĐỦ KHOÁ" nên giá 48 buổi sẽ hiện như hợp lệ cho một ô đang mang 4824.
import { z } from "zod";
import { orderItemSchema } from "@/lib/validators/order";

export const xemTruocSchema = z.object({
  centerId: z.string().min(1).nullable(),
  items: z.array(orderItemSchema).min(1).max(20),
});

export type DauVaoXemTruoc = z.infer<typeof xemTruocSchema>;

/** Câu chung khi không có thông điệp nào đáng đưa ra màn. */
export const LOI_DAU_VAO_CHUNG = "Dữ liệu không hợp lệ";

export type KetQuaDocDauVao = { readonly ok: true; readonly data: DauVaoXemTruoc } | { readonly ok: false; readonly error: string };

export function docDauVaoXemTruoc(input: unknown): KetQuaDocDauVao {
  const r = xemTruocSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  // Lỗi đầu tiên có thông điệp do schema VIẾT (refine) — thứ tự zod = thứ tự khai trong schema nên ổn định.
  const loi = r.error.issues.find((i) => i.code === "custom" && i.message.trim().length > 0);
  if (!loi) return { ok: false, error: LOI_DAU_VAO_CHUNG };
  const dong = loi.path[0] === "items" && typeof loi.path[1] === "number" ? `Dòng ${loi.path[1] + 1}: ` : "";
  return { ok: false, error: `${dong}${loi.message}` };
}
