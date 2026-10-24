// LIB-07 — format tiền VND. 1 nguồn thay ~7 chỗ inline `x.toLocaleString("vi-VN") + "đ"`.
// KHÁC formatVnd (lib/utils.ts) dùng style:"currency" → glyph "₫". Bản này dùng "đ"
// (thường trong email/PDF/notification). withSpace giữ ĐÚNG khoảng trắng từng call-site
// cũ (một số " đ", một số "đ") → behavior-preserving.

/** "1.000.000 đ" (withSpace=true, mặc định) hoặc "1.000.000đ" (false). */
export function formatVndPlain(amount: number, withSpace = true): string {
  return amount.toLocaleString("vi-VN") + (withSpace ? " đ" : "đ");
}

/**
 * Rút gọn tiền cho TRỤC biểu đồ (tránh nhãn 8 chữ số "10000000" bị cắt):
 *   10.000.000 → "10tr" · 7.500.000 → "7,5tr" · 1.500.000.000 → "1,5 tỷ" · 900 → "900".
 * Chỉ dùng cho hiển thị trục/nhãn gọn — số đầy đủ vẫn ở tooltip/bảng.
 */
export function formatVndCompact(amount: number): string {
  const abs = Math.abs(amount);
  const trim = (n: number) =>
    Number(n.toFixed(1)).toLocaleString("vi-VN"); // 7.5 → "7,5", 10 → "10"
  if (abs >= 1_000_000_000) return `${trim(amount / 1_000_000_000)} tỷ`;
  if (abs >= 1_000_000) return `${trim(amount / 1_000_000)}tr`;
  if (abs >= 1_000) return `${trim(amount / 1_000)}k`;
  return String(Math.round(amount));
}

// ─── Ô NHẬP TIỀN ────────────────────────────────────────────────────────────
// 2 hàm dưới phục vụ <MoneyInput/> (components/ui/money-input.tsx): người dùng gõ
// "10000000", ô hiển thị "10.000.000". KHÁC formatVndPlain ở chỗ KHÔNG kèm hậu tố
// "đ" — đây là giá trị nằm TRONG ô nhập, không phải nhãn hiển thị.
//
// Cố tình KHÔNG dùng Intl/toLocaleString: Node dựng thiếu full-icu sẽ rơi về locale
// "en" và trả "10,000,000" (dấu PHẨY) — sai và chỉ lộ ra ở CI/máy lập trình viên chứ
// không lộ trên Vercel. Chèn dấu bằng regex thì kết quả giống nhau ở mọi môi trường.

/** 15 chữ số ≈ 999.999.999.999.999 — vẫn nằm trong Number.MAX_SAFE_INTEGER (16 chữ số). */
const MAX_SAFE_DIGITS = 15;

/**
 * Bóc mọi ký tự không phải chữ số (dấu chấm/phẩy/khoảng trắng/"đ"/"₫"/"VND") rồi trả
 * số nguyên. Dùng cho cả lúc gõ lẫn lúc DÁN chuỗi kiểu "1.500.000 đ".
 *
 * → `null` khi chuỗi rỗng hoặc không có chữ số nào (kể cả chuỗi rác "abc", hoặc chỉ
 *   mỗi dấu "-"), để phía gọi phân biệt được "chưa nhập" với "nhập số 0".
 * → `null` khi số vượt ngưỡng an toàn của JS: thà báo không hợp lệ còn hơn trả một
 *   con số đã bị làm tròn sai âm thầm.
 *
 * Dấu trừ CHỈ được nhìn nhận khi đứng đầu chuỗi và `allowNegative` bật (mặc định tắt —
 * tuyệt đại đa số ô tiền trong hệ thống không cho phép số âm).
 */
export function parseVndInput(
  raw: string,
  opts?: { allowNegative?: boolean },
): number | null {
  if (typeof raw !== "string") return null;
  const negative = opts?.allowNegative === true && /^\s*-/.test(raw);
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return null;
  // Bỏ số 0 vô nghĩa ở đầu ("007" → "7") trước khi đo độ dài, để "0000123" không bị
  // coi là dài quá ngưỡng.
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  if (trimmed.length > MAX_SAFE_DIGITS) return null;
  const magnitude = Number(trimmed);
  if (!Number.isSafeInteger(magnitude)) return null;
  // `magnitude !== 0` để tránh đẻ ra -0 (lọt vào DB/JSON thành "-0" rất khó truy).
  return negative && magnitude !== 0 ? -magnitude : magnitude;
}

/**
 * Chèn dấu CHẤM mỗi 3 chữ số kiểu vi-VN, KHÔNG kèm "đ":
 *   10000000 → "10.000.000" · 0 → "0" · -1500000 → "-1.500.000" · null/"" → "".
 *
 * Nhận cả chuỗi đã có dấu sẵn ("1.500.000 đ") để dùng được ngay trên giá trị thô mà
 * người dùng vừa gõ/dán, không cần parse trước.
 */
export function formatVndInput(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";

  let signed: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    signed = String(Math.trunc(value)); // Math.trunc(-0) → -0, String(-0) → "0"
  } else {
    const negative = /^\s*-/.test(value);
    const digits = value.replace(/\D/g, "");
    if (digits === "") return "";
    signed = (negative ? "-" : "") + digits;
  }

  const negative = signed.startsWith("-");
  const digits = (negative ? signed.slice(1) : signed).replace(/^0+(?=\d)/, "");
  // Chèn dấu vào mọi ranh giới còn dư đúng bội số của 3 chữ số phía sau.
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return negative && digits !== "0" ? `-${grouped}` : grouped;
}
