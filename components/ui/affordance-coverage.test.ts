/**
 * components/ui/affordance-coverage.test.ts — LUẬT 12: affordance phải nói thật.
 *
 * Một mũi tên đặt ở cuối hàng bảng là lời hứa "bấm để mở". Nếu nó không nằm trong phần tử
 * tương tác nào, và hàng cũng không phải vùng bấm, thì lời hứa đó là suông — **không ném
 * lỗi, không làm test nào đỏ**, và người dùng sẽ bấm rồi tưởng hệ thống hỏng.
 *
 * Đã xảy ra thật: `/cham-cong` (Bảng công ngày) có `<ChevronRight aria-hidden />` trơ ở ô
 * cuối mỗi dòng. Chủ dự án báo "bấm không có gì xảy ra". Console SẠCH, không lỗi JS,
 * không test nào đỏ — vì **không có gì hỏng**: nó chưa từng được nối.
 *
 * ⚠️ Đây là test GREP MÃ NGUỒN — loại mong manh nhất (luật 11). Bản ĐẦU của chính file này
 * đã VÔ DỤNG: nó dò `<td` trong cửa sổ 12 dòng phía trên icon, mà sau khi prettier tách
 * dòng thì khối chú thích đẩy `<td` ra xa hơn thế ⇒ bộ quét **bỏ qua luôn** cái icon, và
 * cả BA lượt cấy lỗi đều XANH. Chỉ lộ ra vì đã cấy (luật 8).
 *
 * Nay `iconTranTrongNguon` là hàm THUẦN nhận chuỗi nguồn, nên anti-vacuity kiểm được bằng
 * đầu vào GIẢ có chủ đích thay vì phải tin bộ quét chạy đúng trên cây thật.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const GOC = ["app", "components"];

/** Icon mang nghĩa "bấm được": mũi tên chỉ hướng, dấu ba chấm. */
const ICON =
  /<(Chevron(Right|Left|Down|Up)|Arrow(Right|Left|UpRight)|ExternalLink|More(Horizontal|Vertical))\b/;

/**
 * Thứ chứng minh icon nằm trong vùng bấm THẬT.
 *
 * ⚠️ Phải khớp PHẦN TỬ/THUỘC TÍNH, không khớp chữ trần. Bản trước viết `|Trigger|` và nó
 * khớp luôn CHÚ THÍCH của bản vá (câu giải thích có nhắc `SheetTrigger`) ⇒ cả ô bị coi là có
 * tương tác, cổng cho qua. Đúng gạch đầu dòng thứ hai của luật 11.
 */
const TUONG_TAC =
  /<button|<a\s|<Link\b|<[A-Z][A-Za-z]*Trigger\b|onClick=|href=|role="button"/;

/** Bỏ chú thích trước khi soi — chú thích bản vá hay chứa đúng chuỗi đang cấm. */
function boChuThich(x: string): string {
  return x
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * Cả HÀNG là vùng bấm — hợp lệ, và là cách `/cham-cong` được vá 09/09/2026:
 * `<tr className="… relative … cursor-pointer">` + trigger mang `after:inset-0` phủ kín
 * hàng. Phải có ĐỦ HAI mảnh: `cursor-pointer` một mình chỉ là con trỏ nói dối.
 */
function hangLaVungBam(src: string, boSung: string): boolean {
  // ⚠️ HAI MẢNH NẰM Ở HAI FILE: `<tr … cursor-pointer>` ở page, còn lớp phủ
  // `after:inset-0` ở component trigger bên `_components/`. Kiểm cả hai trong CÙNG một
  // file là bỏ sót — bản trước làm thế nên gỡ lớp phủ mà cổng vẫn xanh.
  return /cursor-pointer/.test(src) && /after:inset-0/.test(src + boSung);
}

/**
 * THUẦN — trả số dòng (1-based) của mọi icon chỉ hướng nằm trong `<td>…</td>` mà khối đó
 * KHÔNG có phần tử tương tác nào.
 *
 * Quét theo KHỐI `<td>` thật (mở → đóng), KHÔNG theo cửa sổ N dòng — cửa sổ chính là thứ
 * đã làm bản đầu vô dụng.
 */
export function iconTranTrongNguon(src: string, boSung = ""): number[] {
  if (!ICON.test(src)) return [];
  // BỎ CHÚ THÍCH TRƯỚC khi hỏi "hàng có phải vùng bấm không".
  // Đo được: chú thích ở page.tsx:678 giải thích bản vá có nhắc `after:inset-0`,
  // và nó làm file được miễn trừ VĨNH VIỄN — cổng xanh dù gỡ sạch cả hai mảnh.
  // Lần thứ năm trong ngày chú thích nuốt mất bộ so khớp (luật 11).
  if (hangLaVungBam(boChuThich(src), boChuThich(boSung))) return [];
  const dong = src.split("\n");
  const ra: number[] = [];
  let trong = false;
  let dau = 0;
  let khoi: string[] = [];
  for (let i = 0; i < dong.length; i++) {
    const l = dong[i] ?? "";
    if (!trong && /<td[\s>]/.test(l)) {
      trong = true;
      dau = i;
      khoi = [];
    }
    if (trong) {
      khoi.push(l);
      if (l.includes("</td>")) {
        const noi = boChuThich(khoi.join("\n"));
        if (!TUONG_TAC.test(noi)) {
          for (let k = 0; k < khoi.length; k++) {
            if (ICON.test(khoi[k] ?? "")) ra.push(dau + k + 1);
          }
        }
        trong = false;
      }
    }
  }
  return ra;
}

function moiFileTsx(): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) di(p);
      else if (e.name.endsWith(".tsx")) ra.push(p);
    }
  };
  for (const g of GOC) di(path.join(ROOT, g));
  return ra;
}

/** Nguồn các file `_components/` cùng thư mục — nơi trigger (và lớp phủ) hay nằm. */
function nguonAnhEm(p: string): string {
  const d = path.join(path.dirname(p), "_components");
  if (!fs.existsSync(d)) return "";
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => fs.readFileSync(path.join(d, f), "utf8"))
    .join(String.fromCharCode(10));
}

function viPhamToanRepo(): string[] {
  const ra: string[] = [];
  for (const p of moiFileTsx()) {
    const rel = path.relative(ROOT, p).replace(/\\/g, "/");
    const loi = iconTranTrongNguon(fs.readFileSync(p, "utf8"), nguonAnhEm(p));
    for (const n of loi) ra.push(`${rel}:${n}`);
  }
  return ra;
}

// ── ANTI-VACUITY TRƯỚC, quét repo SAU ───────────────────────────────────────
//
// Thứ tự có chủ đích: bộ quét hỏng thì mấy ca dưới đỏ TRƯỚC, thay vì ca "repo sạch" xanh
// giả rồi không ai biết.
describe("iconTranTrongNguon — bộ quét có thật sự phân biệt được không", () => {
  const XAU = [
    '    <td className="text-right">',
    "      {/* chú thích dài chen giữa — đúng thứ đã giết bản đầu của file này,",
    "          vì nó đẩy `<td` ra ngoài cửa sổ 12 dòng */}",
    '      <ChevronRight aria-hidden className="h-4 w-4" />',
    "    </td>",
  ].join("\n");

  it("BẮT mũi tên trơ trong ô — kể cả khi có chú thích chen giữa", () => {
    expect(iconTranTrongNguon(XAU)).toHaveLength(1);
  });

  it("BỎ QUA mũi tên nằm trong <button>", () => {
    expect(
      iconTranTrongNguon(
        [
          "    <td>",
          '      <button type="button" aria-label="Mở">',
          '        <ChevronRight aria-hidden className="h-4 w-4" />',
          "      </button>",
          "    </td>",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("BỎ QUA khi CẢ HÀNG là vùng bấm (đủ hai mảnh)", () => {
    const tot = `<tr className="relative cursor-pointer">\n${XAU}`;
    // Lớp phủ nằm ở FILE KHÁC — truyền qua `boSung`, đúng như đời thật.
    expect(iconTranTrongNguon(tot, "after:inset-0")).toEqual([]);
  });

  it("`cursor-pointer` MỘT MÌNH không đủ — con trỏ nói dối vẫn là vi phạm", () => {
    // Thiếu lớp phủ `after:inset-0` ⇒ hàng chỉ ĐỔI CON TRỎ chứ không bấm được.
    const doi = `<tr className="relative cursor-pointer">\n${XAU}`;
    expect(iconTranTrongNguon(doi)).toHaveLength(1);
  });

  it("đọc được cây file thật, không phải trả rỗng vì sai đường gốc", () => {
    const ds = moiFileTsx();
    expect(ds.length).toBeGreaterThan(200);
    expect(ds.some((p) => p.includes("cham-cong"))).toBe(true);
  });
});

/**
 * Trần thời gian cho ca QUÉT CÂY — phép tính ghi ngay đây, cùng khuôn với
 * `lib/finance/truc-a.test.ts`, `lib/finance/ghi-nhan.test.ts` và `HAN_QUET_CAY` của
 * `lib/events/khop-phat-nghe.test.ts`.
 *
 * Đo 15/09/2026: ca này đọc + soi regex ~2.000 tệp .tsx, chạy MỘT MÌNH **627ms**; trong
 * cả bộ `pnpm test:unit` (máy đang tải) **6335ms** ⇒ vượt trần mặc định 5s ⇒ ĐỎ với
 * "Test timed out", không phải với một vi phạm affordance nào.
 *
 * ⚠️ KHÁC hai ca vá cùng ngày ở `requests.spec.ts` và `require-now-in-tests.test.ts`:
 * ở đó chi phí là KHỞI TẠO MỘT LẦN nên dời được về `beforeAll` và ca về 1ms/10ms. Ở
 * đây việc quét CHÍNH LÀ việc của ca — dời đi chỉ là chuyển chỗ tính tiền, không giảm.
 * Nên đây là ca duy nhất trong ba ca đáng NỚI TRẦN, và nới có phép tính: 30s ≈ 4,7× lần
 * đo tệ nhất. 5s vốn chưa bao giờ là ngân sách đúng cho một ca đọc 2.000 tệp.
 */
const TRAN_QUET_MS = 30_000;

describe("luật 12 — icon chỉ hướng trong hàng bảng phải nằm trong vùng bấm", () => {
  it("không file nào có mũi tên TRƠ trong ô bảng", { timeout: TRAN_QUET_MS }, () => {
    expect(
      viPhamToanRepo(),
      "Mũi tên/chevron trong <td> mà không nằm trong <button>/<a>/<Link>/Trigger, và " +
        "hàng cũng không phải vùng bấm (cần `cursor-pointer` trên <tr> + `after:inset-0` " +
        "trên trigger). Lời hứa suông — xem luật 12.",
    ).toEqual([]);
  });

  it("bảng công ngày: đủ ba mảnh của vùng bấm cả dòng", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "app/(admin)/admin/cham-cong/page.tsx"),
      "utf8",
    );
    const sheet = fs.readFileSync(
      path.join(
        ROOT,
        "app/(admin)/admin/cham-cong/_components/day-detail-sheet.tsx",
      ),
      "utf8",
    );
    expect(src, "<tr> phải là neo định vị").toContain("relative h-11");
    expect(src, "con trỏ phải nói thật").toContain("cursor-pointer");
    expect(sheet, "trigger phải phủ kín hàng").toContain("after:inset-0");
  });
});
