// =============================================================================
// AUTH-SĐT P1 — NGUỒN DUY NHẤT cho việc chuẩn hoá / kiểm tra số điện thoại VN.
//
// Vì sao tồn tại: trước file này repo có **6 hàm `normalizePhone` khác nhau +
// 3 chỗ viết tay + 5 bản sao regex `PHONE_VN`**, cho ra **3 định dạng mâu
// thuẫn** — và hai unit test khoá cứng hai dạng đối nghịch nhau
// (`lead/import.test.ts` đòi `0…`, `crm/lead-qualify.test.ts` đòi `84…`).
// Chừng nào chưa gom về một chỗ thì SĐT KHÔNG đủ tư cách làm khoá đăng nhập.
//
// Canonical = `84XXXXXXXXX` (QĐ-4). Chọn `84…` chứ không phải `+84…`/`0…` vì:
//   (a) khớp thẳng payload ZNS ⇒ không phải convert lúc gửi;
//   (b) ký tự `+` bị Excel hiểu là công thức — repo import/export Excel rất nhiều;
//   (c) 2/9 điểm chuẩn hoá cũ đã ra dạng này.
//
// ⚠️ FILE THUẦN — KHÔNG `import "server-only"`. Client component
// (`lien-he/contact-form.tsx`, `consult-modal.tsx`) phải chuẩn hoá TRƯỚC khi
// gửi lên server, nếu không sẽ tái hiện lỗi "mất lead im lặng" (§P1).
// =============================================================================

/** Số thuê bao VN: 9 chữ số, đầu số 3/5/7/8/9. Dùng cho phần SAU mã quốc gia. */
const NSN_RE = /^[35789][0-9]{8}$/;

/** SĐT VN ở dạng canonical `84XXXXXXXXX`. Đây là regex DUY NHẤT của repo. */
export const PHONE_VN_RE = /^84[35789][0-9]{8}$/;

/**
 * Bỏ mọi ký tự trình bày: khoảng trắng (kể cả **non-breaking space** U+00A0 —
 * dạng này xuất hiện thật khi phụ huynh copy số từ Word/Zalo), chấm, gạch,
 * ngoặc. `\s` của JS đã bao U+00A0 nên không cần liệt kê riêng.
 */
function stripFormatting(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\s.\-()]/g, "")
    .trim();
}

/**
 * Chuẩn hoá về `84XXXXXXXXX`, hoặc `null` nếu không phải SĐT di động VN hợp lệ.
 *
 * Xử lý được (đây là tập hợp mọi dạng đang tồn tại thật trong dữ liệu repo):
 * | Đầu vào | Ra |
 * |---|---|
 * | `0905123456` | `84905123456` |
 * | `+84905123456` · `0084905123456` | `84905123456` |
 * | `84905123456` | `84905123456` |
 * | `+84 0905 123 456` (thừa số 0 sau mã quốc gia) | `84905123456` |
 * | `905123456` (Excel lưu number ⇒ mất số 0 đầu) | `84905123456` |
 * | `0905.123.456` · `(090) 512-3456` | `84905123456` |
 * | `02363123456` (cố định), `123`, `""` | `null` |
 *
 * ⚠️ CHỈ nhận di động (đầu số 3/5/7/8/9). Số cố định trả `null` — đừng dùng hàm
 * này cho `Employee.phone` (trường tự do, có thể là số bàn cơ sở).
 */
export function canonicalPhone(raw: unknown): string | null {
  let s = stripFormatting(raw);
  if (!s) return null;

  // Tiền tố quốc tế → về dạng chỉ chữ số bắt đầu bằng 84.
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("0084")) s = s.slice(2);

  if (!/^[0-9]+$/.test(s)) return null;

  if (s.startsWith("84")) {
    const rest = s.slice(2);
    // `84` + `0` + 9 số: người dùng ghép cả mã quốc gia lẫn số 0 nội địa.
    const nsn = rest.startsWith("0") ? rest.slice(1) : rest;
    return NSN_RE.test(nsn) ? `84${nsn}` : null;
  }
  if (s.startsWith("0")) {
    const nsn = s.slice(1);
    return NSN_RE.test(nsn) ? `84${nsn}` : null;
  }
  // 9 chữ số trần — cell Excel kiểu number đã nuốt mất số 0 đầu.
  return NSN_RE.test(s) ? `84${s}` : null;
}

/** Có phải SĐT di động VN hợp lệ không (nhận mọi dạng đầu vào). */
export function isValidPhoneVN(raw: unknown): boolean {
  return canonicalPhone(raw) !== null;
}

/**
 * Canonical → dạng hiển thị nội địa `0XXXXXXXXX`.
 * Dùng cho UI/Excel/PDF — KHÔNG dùng làm khoá tra cứu hay lưu DB.
 */
export function formatPhoneVN(raw: unknown): string {
  const c = canonicalPhone(raw);
  return c ? `0${c.slice(2)}` : String(raw ?? "");
}

/**
 * Giá trị cho `href="tel:..."` — dạng E.164 CÓ dấu `+`.
 *
 * ⚠️ Đừng nhét thẳng giá trị đang lưu trong DB vào `tel:`. DB lưu canonical `84…`
 * KHÔNG có dấu `+`, và máy điện thoại hiểu chuỗi đó là số nội địa: nó quay đúng
 * "84941000000" rồi báo không tồn tại. Thiếu mỗi một ký tự mà nút gọi chết, trong
 * khi trên màn hình số vẫn hiện đẹp — không ai soi ra bằng mắt.
 *
 * Số không chuẩn hoá được (dữ liệu rác cũ) thì trả chuỗi gốc: thà để người dùng
 * tự nhìn còn hơn dựng một link chắc chắn sai.
 */
export function telHrefVN(raw: unknown): string {
  const c = canonicalPhone(raw);
  // Trả CẢ scheme `tel:` — hàm này sở hữu trọn giá trị `href`. Để nơi gọi tự ghép
  // `tel:` là mời gọi đúng lỗi vừa gặp: quên phần đầu thì href thành đường dẫn
  // TƯƠNG ĐỐI, bấm vào là điều hướng lạc trong app chứ không mở trình gọi — và
  // trên màn hình số vẫn hiện đẹp nên không ai nhìn ra.
  return c ? `tel:+${c}` : `tel:${String(raw ?? "")}`;
}

/**
 * Mọi dạng một SĐT CÓ THỂ đang được lưu trong DB, để tra cứu chịu được giai
 * đoạn chuyển tiếp: `["84XXXXXXXXX", "0XXXXXXXXX"]`.
 *
 * ⚠️ Đây là thứ thay cho ràng buộc **"backfill phải nằm cùng deploy"** của QĐ-4.
 * Nếu đường GHI đổi sang `84…` mà đường ĐỌC vẫn so khớp đúng-bằng, thì mọi tra
 * cứu theo SĐT sẽ ngừng khớp dữ liệu cũ (`0…`) **ngay ngày deploy, không test
 * nào bắt**: `findRecentDuplicate` hết chống trùng 90 ngày, gộp con theo SĐT
 * ngừng match lead cũ, `findParentMatch` không tìm ra phụ huynh. Tra bằng
 * `{ phone: { in: phoneVariants(x) } }` thì backfill chạy lúc nào cũng được.
 *
 * Bỏ hẳn hàm này CHỈ SAU KHI `phone-audit` xác nhận PROD còn 0 bản ghi dạng cũ.
 */
export function phoneVariants(raw: unknown): string[] {
  const c = canonicalPhone(raw);
  if (!c) {
    // Không chuẩn hoá được → vẫn cho tra đúng chuỗi gốc (dữ liệu rác cũ).
    const s = stripFormatting(raw);
    return s ? [s] : [];
  }
  return [c, nationalPhone(c) ?? c];
}

/**
 * Dạng NỘI ĐỊA `0XXXXXXXXX` — thứ người Việt đọc, viết và gõ.
 *
 * `canonicalPhone` trả `84…` vì đó là dạng LƯU TRỮ (một số một cách viết, so sánh
 * được). Nhưng mọi chỗ CON NGƯỜI đọc thì phải là `0…`: chủ dự án 14/09 — "sđt trong
 * nội dung ck là 0987654321 chứ không dùng 84987654321".
 *
 * Tách thành hàm có tên thay vì `\`0${c.slice(2)}\`` rải rác: phép cắt hai ký tự đầu
 * chỉ đúng khi chuỗi CHẮC CHẮN là canonical, và một chỗ chép tay sai là ra số điện
 * thoại thiếu đầu mà không ai thấy.
 */
export function nationalPhone(raw: unknown): string | null {
  const c = canonicalPhone(raw);
  return c ? `0${c.slice(2)}` : null;
}

/** `phoneVariants` cho cả danh sách — dùng với `where: { phone: { in: … } }`. */
export function expandPhoneVariants(raws: readonly unknown[]): string[] {
  return [...new Set(raws.flatMap((r) => phoneVariants(r)))];
}

/**
 * Khoá gom nhóm cho một bản ghi ĐỌC TỪ DB: canonical nếu chuẩn hoá được, còn
 * không thì giữ nguyên chuỗi trong DB.
 *
 * Bắt buộc dùng khi dựng `Map` từ kết quả truy vấn: query bằng `expandPhoneVariants`
 * sẽ trả về **cả bản ghi `0…` cũ lẫn `84…` mới**, nên nếu vẫn key bằng `row.phone`
 * thô thì tra `map.get(canonical)` trượt đúng những bản ghi cũ vừa cất công tìm ra.
 */
export function phoneKey(dbValue: string): string {
  return canonicalPhone(dbValue) ?? dbValue;
}

/**
 * Chuỗi dùng cho ô TÌM KIẾM tự do (`{ phone: { contains: … } }`).
 *
 * Vì sao cần: đường GHI đã chuyển sang canonical `84…` nhưng dữ liệu cũ vẫn `0…`
 * (đo 03/08 trên DEV: 99 lead dạng `0…` / 8 dạng `84…`). Nhân viên luôn gõ số theo
 * kiểu phụ huynh đọc — `0328545229` — nên `contains` thô sẽ **im lặng bỏ sót** đúng
 * những bản ghi mới. Đây là ca có thật: lead vừa tạo tay không tìm ra bằng số của
 * chính nó.
 *
 * Cách xử lý: bỏ phần đầu (`84` hoặc `0`) rồi tìm theo phần lõi — `328545229` khớp
 * CẢ hai dạng chỉ với một điều kiện, không phải nở OR. Gõ dở (`03285`) vẫn chạy vì
 * lõi là tiền tố của lõi đầy đủ.
 *
 * Trả `null` khi chuỗi không phải dạng số → caller giữ nguyên `q` (tìm theo tên).
 */
export function phoneSearchTerm(raw: unknown): string | null {
  const s = stripFormatting(raw).replace(/^\+/, "");
  if (!/^\d{3,}$/.test(s)) return null;
  const core = s.startsWith("84") ? s.slice(2) : s.startsWith("0") ? s.slice(1) : s;
  return core.length >= 3 ? core : null;
}
