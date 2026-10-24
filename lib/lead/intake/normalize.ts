import type { CenterHint } from "./types";

// =============================================================================
// LEAD INTAKE — các hàm THUẦN dùng chung giữa các mapper.
// Không import DB, không import server-only → test được bằng unit test thuần.
// =============================================================================

/**
 * Chuẩn hoá chuỗi tiếng Việt để SO KHỚP (không phải để hiển thị):
 * bỏ dấu, về chữ thường, gộp mọi khoảng trắng thành 1 dấu cách.
 *
 * Cần vì cùng một cơ sở được ghi mỗi nơi một kiểu — dữ liệu thật của sheet
 * quatang có cả `"114 Hoàng Diệu"` (bản cũ) lẫn
 * `"Cơ sở 2 - 114 Hoàng Diệu, Đà Nẵng"` (bản mới).
 */
export function normalizeVi(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // dấu thanh + dấu mũ
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Trim + rỗng thành `null` (đừng ghi chuỗi rỗng xuống DB). */
export function str(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s.length > 0 ? s : null;
}

/**
 * Tên phụ huynh hiển thị khi phiếu KHÔNG có ô tên PH hoặc PH bỏ trống.
 *
 * Có thật ở CẢ HAI nguồn: form MISA chỉ bắt buộc `LastName` (tên HỌC SINH),
 * còn sheet quatang có cả một đợt bỏ trống hẳn cột tên PH. `Lead.parentName`
 * là NOT NULL ⇒ không có fallback thì lead rụng hết ngay ngày đầu.
 */
export function parentNameFallback(childName: string | null): string {
  return childName ? `PH của ${childName}` : "Phụ huynh (chưa rõ tên)";
}

/** Cơ sở nguồn gửi dạng số thứ tự ("1", "2") → mã cơ sở của repo ("CS1"). */
export function centerHintFromIndex(raw: unknown): CenterHint | null {
  const s = String(raw ?? "").trim();
  return /^[1-9][0-9]*$/.test(s) ? { kind: "code", value: `CS${s}` } : null;
}

/**
 * Cơ sở chọn từ DANH SÁCH THẬT (`Center.code`, vd "CS1") → hint dạng code.
 *
 * Dùng cho biểu mẫu nội bộ có đăng nhập (G-D): người nhập chọn cơ sở từ danh
 * sách nạp từ DB, nên không còn phải quy đổi số thứ tự như biểu mẫu cũ.
 */
export function centerHintFromCode(raw: unknown): CenterHint | null {
  const s = str(raw);
  return s ? { kind: "code", value: s.toUpperCase() } : null;
}

/** Cơ sở nguồn gửi dạng chuỗi tự do → giữ nguyên để tầng ingest so khớp DB. */
export function centerHintFromText(raw: unknown): CenterHint | null {
  const s = str(raw);
  return s ? { kind: "text", value: s } : null;
}

export type CenterRow = {
  id: string;
  code: string | null;
  name: string;
  address: string;
};

/**
 * Khớp gợi ý cơ sở với danh sách cơ sở ĐỌC TỪ DB → trả `Center.id`.
 *
 * Hàm thuần (nhận sẵn `centers`) để test không cần DB, và để việc "mở CS3 chỉ
 * là thêm data" thành thật: không có danh sách cơ sở nào hardcode ở đây.
 *
 * Thứ tự khớp — chặt trước, lỏng sau:
 *   1. `code` bằng nhau (đường của form Sale: "1" → "CS1").
 *   2. `name` bằng nhau.
 *   3. `address` của cơ sở là CHUỖI CON của chuỗi nguồn gửi. Đây là đường của
 *      quatang: `"Cơ sở 2 - 114 Hoàng Diệu, Đà Nẵng"` chứa `"114 Hoàng Diệu"`.
 *      So bằng `===` sẽ trượt toàn bộ — dữ liệu thật đã đổi cách ghi 1 lần rồi.
 *
 * ⚠️ Ở bước 3, khớp được NHIỀU cơ sở là chuyện BÌNH THƯỜNG, không phải mơ hồ:
 * `Center("hoi-so")` có `address = "Đà Nẵng"` (seed.ts), mà chuỗi quatang luôn
 * kết thúc bằng ", Đà Nẵng" ⇒ Hội sở khớp CÙNG LÚC với cơ sở thật ở mọi phiếu.
 * Bản đầu đòi "đúng 1 khớp" nên sẽ trả `null` cho TOÀN BỘ lead quatang trên
 * prod (DB test local không có Hội sở nên không lộ). Luật đúng là **cụ thể
 * nhất thắng**: địa chỉ khớp DÀI NHẤT ăn — `"211 Nguyễn Hữu Thọ"` thắng
 * `"Đà Nẵng"`. Chỉ khi hai địa chỉ dài BẰNG NHAU mới thực sự là mơ hồ ⇒ `null`,
 * để lead rơi về auto-chia thay vì giao nhầm cơ sở.
 *
 * Người gọi nên lọc bỏ cơ sở không nhận ghi danh TRƯỚC khi truyền vào đây.
 */
export function matchCenter(
  hint: CenterHint | null | undefined,
  centers: readonly CenterRow[],
): string | null {
  if (!hint) return null;
  const needle = normalizeVi(hint.value);
  if (!needle) return null;

  if (hint.kind === "code") {
    const hit = centers.filter((c) => c.code && normalizeVi(c.code) === needle);
    return hit.length === 1 ? hit[0]!.id : null;
  }

  const byCode = centers.filter((c) => c.code && normalizeVi(c.code) === needle);
  if (byCode.length === 1) return byCode[0]!.id;

  const byName = centers.filter((c) => normalizeVi(c.name) === needle);
  if (byName.length === 1) return byName[0]!.id;

  const byAddress = centers
    .map((c) => ({ id: c.id, addr: normalizeVi(c.address) }))
    .filter((c) => c.addr.length >= 5 && needle.includes(c.addr));
  if (byAddress.length === 0) return null;

  const longest = Math.max(...byAddress.map((c) => c.addr.length));
  const winners = byAddress.filter((c) => c.addr.length === longest);
  return winners.length === 1 ? winners[0]!.id : null;
}

/**
 * Hai tên con có phải CÙNG một đứa không (so sánh đã bỏ dấu/hoa-thường).
 * Dùng cho luật "trùng SĐT nhưng khác con thì gắn thêm `LeadChild`".
 */
export function isSameChildName(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return normalizeVi(a) === normalizeVi(b);
}

/** Ghép các dòng ghi chú + cảnh báo thành `Lead.note`. Rỗng ⇒ `null`. */
export function buildNote(
  noteLines: readonly string[],
  warnings: readonly string[],
): string | null {
  const lines = [
    ...noteLines.filter(Boolean),
    ...warnings.filter(Boolean).map((w) => `⚠️ ${w}`),
  ];
  return lines.length > 0 ? lines.join("\n") : null;
}

// ───────────────────────────────────────────────────────────────────────────
// Link Facebook của phụ huynh (ô mới, 22/08/2026)
// ───────────────────────────────────────────────────────────────────────────

/** Kết quả chuẩn hoá link FB: `url` dùng được, hoặc `null` kèm lý do. */
export type FacebookUrlResult = { url: string | null; warning: string | null };

/**
 * Chuẩn hoá ô "Link Facebook" thành một URL BẤM ĐƯỢC, hoặc trả `null` + lý do.
 *
 * Người nhập dán đủ kiểu — đây là những dạng gặp thật khi trực quảng cáo:
 * | Gõ vào | Ra |
 * |---|---|
 * | `https://facebook.com/abc` | giữ nguyên |
 * | `facebook.com/abc` · `m.me/abc` · `fb.com/abc` | thêm `https://` |
 * | `minh.nguyen.549` (tên tài khoản, không có dấu `/`) | `https://www.facebook.com/minh.nguyen.549` |
 * | `javascript:alert(1)` · `data:…` | `null` + cảnh báo |
 *
 * ⚠️ Chặn scheme lạ là BẮT BUỘC, không phải cẩn thận thừa: giá trị này được
 * render thành `<a href>` trong màn admin. Nhận `javascript:` là mở đúng một lỗ
 * XSS mà người tấn công chỉ cần gõ vào ô của biểu mẫu nội bộ.
 */
export function normalizeFacebookUrl(raw: unknown): FacebookUrlResult {
  const s = str(raw);
  if (!s) return { url: null, warning: null };

  const bad = (why: string): FacebookUrlResult => ({
    url: null,
    warning: `Link Facebook "${s}" ${why} — chưa lưu vào ô link, đã giữ lại trong ghi chú.`,
  });

  // Khoảng trắng giữa chuỗi ⇒ đây là câu chữ, không phải link.
  if (/\s/.test(s)) return bad("không phải một đường dẫn");

  let candidate = s;
  if (s.includes("://")) {
    if (!/^https?:\/\//i.test(s)) return bad("dùng giao thức không cho phép");
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    // `javascript:…`, `data:…`, `mailto:…` — có scheme nhưng không có `//`.
    return bad("dùng giao thức không cho phép");
  } else if (s.includes("/")) {
    candidate = `https://${s}`;
  } else {
    // KHÔNG có dấu `/` ⇒ coi là TÊN TÀI KHOẢN, không phải tên miền.
    //
    // Đây là ô "Link Facebook", người ta không gõ tên miền trần vào đây. Ngược
    // lại, tên tài khoản Facebook rất hay có dấu chấm ("minh.nguyen.549") — mà
    // đoán nó là tên miền thì hỏng hẳn: `new URL("https://minh.nguyen.549")`
    // NÉM lỗi, vì nhãn cuối toàn số nên trình phân giải hiểu là địa chỉ IPv4.
    candidate = `https://www.facebook.com/${s}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return bad("không phải một đường dẫn");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return bad("dùng giao thức không cho phép");
  }
  if (!parsed.hostname.includes(".")) return bad("không phải một đường dẫn");

  return { url: parsed.toString(), warning: null };
}
