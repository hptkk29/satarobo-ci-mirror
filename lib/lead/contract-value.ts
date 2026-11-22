// lib/lead/contract-value.ts — G-06 · GIÁ TRỊ HỢP ĐỒNG của một đứa con.
//
// 🔴 ĐÂY KHÔNG PHẢI DOANH THU. Đây là con số Sale **cam kết trên hợp đồng**; tiền đã
// thật sự vào tài khoản là chuyện khác và nằm ở đường khác.
//
// Chốt 24/08/2026 (quyết định B3, kéo theo OQ-G2 đóng luôn): doanh thu của TOÀN hệ
// thống lấy từ `Payment` đã xác nhận (CONFIRMED) — **không** `Order.totalAmount`,
// **không** `LeadChild.contractValue`. Công thức thực thu chỉ có một bản, ở
// `lib/finance/thuc-thu.ts`; bổ dọc theo con thì đi `lib/reports/revenue-by-child.ts`.
//
// Vì sao phải viết to như vậy: cộng cột này vào một báo cáo doanh thu sẽ làm tổng
// PHỒNG đúng bằng phần khách chưa đóng, mà kết quả vẫn ra một con số trông hợp lý nên
// không ai phát hiện. Đợt này đã phải dọn một lần đúng kiểu hỏng đó (ba màn cùng cộng
// tiền theo ba luật khác nhau — B-02). Nhãn + chú giải để ở đây, một chỗ, để không màn
// nào tự đặt tên khác cho nó.
import { parseVndInput } from "@/lib/format/money";

/** Nhãn hiển thị — mọi màn dùng CHUNG chuỗi này, đừng gõ lại. */
export const CONTRACT_VALUE_LABEL = "Giá trị hợp đồng (đã ký)";

/** Chú giải bắt buộc đi kèm ô nhập / cột bảng. Nói thẳng ranh giới với tiền đã thu. */
export const CONTRACT_VALUE_HINT =
  "Số tiền ghi trên hợp đồng Sale chốt — KHÔNG phải tiền đã thu. " +
  "Doanh thu thực thu tính từ khoản thanh toán đã xác nhận (tab Tài chính).";

/**
 * Trần 5 tỷ cho MỘT hợp đồng của MỘT đứa trẻ. Không phải giới hạn nghiệp vụ mà là
 * lưới chắn gõ nhầm: học phí một khoá cao nhất đang ở mức chục triệu, nên một con số
 * chín chữ số gần như chắc chắn là thừa vài số 0 — và nó sẽ làm mọi phép trung bình
 * trên màn hình vô nghĩa.
 */
export const CONTRACT_VALUE_MAX = 5_000_000_000;

export type ContractValueParse =
  | { ok: true; value: number | null }
  | { ok: false; message: string };

/**
 * Đọc ô "giá trị hợp đồng" từ bất kỳ đầu vào nào (form gửi chuỗi, API gửi số).
 *
 * · rỗng / khoảng trắng / null / undefined ⇒ `null` = **chưa nhập**, KHÁC số 0.
 *   (0 là giá trị thật: học bổng toàn phần. Gộp hai thứ này là biến mọi phiếu chưa ai
 *   điền thành "hợp đồng 0 đồng" và kéo mọi con số trung bình xuống đáy.)
 * · chuỗi có dấu phân cách kiểu vi-VN ("5.000.000 đ") ⇒ nhận, vì người ta gõ y như
 *   trên hợp đồng. Bóc dấu bằng `parseVndInput` — cùng hàm với ô tiền của toàn hệ
 *   thống, không viết regex thứ hai.
 * · chữ không có số nào ⇒ **từ chối**, không im lặng trả `null`: trả `null` là nuốt
 *   mất lượt nhập trong khi người nhập tưởng đã lưu.
 */
export function parseContractValue(raw: unknown): ContractValueParse {
  if (raw === null || raw === undefined) return { ok: true, value: null };

  let so: number;
  if (typeof raw === "number") {
    so = raw;
  } else if (typeof raw === "string") {
    const s = raw.trim();
    if (s === "") return { ok: true, value: null };
    // Dấu trừ phải bị nhìn thấy, không được `parseVndInput` bỏ đi im lặng.
    if (s.startsWith("-")) {
      return { ok: false, message: `${CONTRACT_VALUE_LABEL} không được âm` };
    }
    const n = parseVndInput(s);
    if (n === null) {
      return { ok: false, message: `${CONTRACT_VALUE_LABEL} phải là số tiền (VND)` };
    }
    so = n;
  } else {
    return { ok: false, message: `${CONTRACT_VALUE_LABEL} phải là số tiền (VND)` };
  }

  if (!Number.isFinite(so) || !Number.isInteger(so)) {
    return { ok: false, message: `${CONTRACT_VALUE_LABEL} phải là số nguyên (đồng)` };
  }
  if (so < 0) return { ok: false, message: `${CONTRACT_VALUE_LABEL} không được âm` };
  if (so > CONTRACT_VALUE_MAX) {
    return {
      ok: false,
      message: `${CONTRACT_VALUE_LABEL} vượt ngưỡng ${CONTRACT_VALUE_MAX.toLocaleString("vi-VN")} đ — kiểm tra lại số 0`,
    };
  }
  return { ok: true, value: so };
}
