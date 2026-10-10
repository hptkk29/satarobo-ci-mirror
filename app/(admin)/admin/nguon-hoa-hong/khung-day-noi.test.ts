/**
 * [NHH-FE-W7] · [NHH-FE-W8] · [NHH-FE-W9] · [NHH-FE-W10] — LƯỚI GHIM MÃ NGUỒN cho phần dây nối mà `khung-wiring.test.ts`
 * (W1–W6) để hở. Cùng khuôn: đọc mã ĐÃ BỎ CHÚ THÍCH, neo hẹp, ĐẾM SỐ LẦN khớp, không cờ `/s`.
 *
 * VÌ SAO CÓ FILE NÀY — đợt cấy lỗi 08/10 tìm ra chín phép cấy lên page/layout mà MỌI lưới hiện có vẫn XANH, vì lưới
 * cũ chỉ đếm SỰ CÓ MẶT của một chuỗi chứ không ghim điều kiện bao quanh nó:
 *   S01b/S03  layout `hoaHongEngineEnabled={false}` / `nguonLeadEnabled={hoaHongEngineEnabled}`  — [SB-FLAG] đếm `prop={`
 *   S02       layout `.catch(() => true)` (cờ đọc lỗi ⇒ BẬT)                                       — không lưới nào
 *   W06       công tắc "Cần xử lý (N)" đếm `demHangChoNguon(actor, null)` thay vì theo cơ sở      — [W4] chỉ đếm số lần gọi
 *   W07       `timCoSo` → `chonCoSo` (chế độ "Tất cả cơ sở" biến mất, luôn ép về cơ sở đầu)       — không lưới nào
 *   W08       `canViewPii: true` (lộ tên phụ huynh hàng loạt)                                     — không lưới nào
 *   W09/W17   `if (false && !scope.any(PAGE_GATES[…]))` — cổng quyền bị VÔ HIỆU                    — [W1] chỉ đếm `PAGE_GATES["…"]`
 *   W18/W19   chi tiết nguồn: bỏ `notFound()` / bỏ `decodeURIComponent`                           — không lưới nào
 * Page là Server Component (kéo next-auth + Prisma) nên không dựng được trong vitest — đây là cách rẻ nhất để canh.
 * Mỗi ca ĐÃ được cấy lại lỗi tương ứng để thấy đỏ (ghi trong báo cáo đợt cấy).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TAB_HREF, TAB_KEYS } from "@/lib/nguon-hoa-hong/tab";

const GOC = process.cwd();

/** Bỏ chú thích dòng TRƯỚC, khối SAU (chú thích dòng hay nhắc `lib/x/*` — chuỗi `/*` đó mở một "khối" giả nuốt mã thật). */
function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

describe("[NHH-FE-W7] layout nối hai cờ module xuống sidebar", () => {
  const src = doc("app/(admin)/admin/layout.tsx");

  it("mỗi cờ gắn ĐÚNG hàm đọc của nó trong CÙNG Promise.all, và đọc hỏng ⇒ TẮT (`.catch(() => false)`)", () => {
    // Thứ tự tên ↔ thứ tự hàm gọi cũng được ghim: lệch là cờ nguồn đọc cờ engine. Đổi `false` thành `true` ra XANH ở
    // mọi lưới cũ — một lần DB chớp là mở module cho cả hệ thống, trên MỌI trang admin (layout chạy mỗi lượt).
    expect(
      dem(
        src,
        /\[\s*hoaDonEnabled,\s*nguonLeadEnabled,\s*hoaHongEngineEnabled,\s*anMenuCuaVai\s*\]\s*=\s*await\s+Promise\.all\(\[\s*laHoaDonBat\(\)\.catch\(\(\) => false\),\s*laQuanLyNguonBat\(\)\.catch\(\(\) => false\),\s*laEngineHoaHongBat\(\)\.catch\(\(\) => false\),/g,
      ),
    ).toBe(1);
  });

  it("truyền GIÁ TRỊ THẬT xuống AdminShell: `nguonLeadEnabled={nguonLeadEnabled}` và `hoaHongEngineEnabled={hoaHongEngineEnabled}` đúng 1 lần", () => {
    // [SB-FLAG] chỉ đếm `prop={` nên `hoaHongEngineEnabled={false}` hay `nguonLeadEnabled={hoaHongEngineEnabled}` VẪN XANH.
    expect(dem(src, /\bnguonLeadEnabled=\{nguonLeadEnabled\}/g)).toBe(1);
    expect(dem(src, /\bhoaHongEngineEnabled=\{hoaHongEngineEnabled\}/g)).toBe(1);
    expect(dem(src, /\b(nguonLeadEnabled|hoaHongEngineEnabled)=\{\s*(true|false)\s*\}/g)).toBe(0);
  });

  it("`laQuanLyNguonBat` / `laEngineHoaHongBat` chỉ được GỌI trong khối Promise.all đó (không đọc cờ lần hai ở chỗ khác)", () => {
    expect(dem(src, /\blaQuanLyNguonBat\(/g)).toBe(1);
    expect(dem(src, /\blaEngineHoaHongBat\(/g)).toBe(1);
  });
});

describe("[NHH-FE-W8] page Nguồn: cách ly cơ sở và PII đi qua đúng dây", () => {
  const src = doc("app/(admin)/admin/nguon-hoa-hong/nguon/page.tsx");

  it("công tắc 'Cần xử lý (N)' đếm THEO cơ sở đang chọn (`demHangChoNguon(actor, coSoId)`), không toàn tầm nhìn", () => {
    expect(dem(src, /\bdemHangChoNguon\(\s*actor\s*,\s*coSoId\s*\)/g)).toBe(1);
    expect(dem(src, /\bdemHangChoNguon\(/g)).toBe(1);
  });

  it('cơ sở lọc lấy bằng `timCoSo(…, "Lead")` (ngoài tầm nhìn ⇒ null = "Tất cả"), KHÔNG `chonCoSo` (sẽ ép về cơ sở đầu)', () => {
    expect(dem(src, /\bscope\.timCoSo\(\s*motGiaTri\(\s*sp\.coSo\s*\)\s*,\s*"Lead"\s*\)/g)).toBe(1);
    expect(dem(src, /\bchonCoSo\(/g)).toBe(0);
  });

  it('chip cơ sở dựng từ tầm nhìn của model Lead (`scope.coSoCua("Lead")`)', () => {
    expect(dem(src, /\bscope\.coSoCua\(\s*"Lead"\s*\)/g)).toBe(1);
    expect(dem(src, /\bcoSoCua\(/g)).toBe(1);
  });

  it("PII: quyền xem PII lấy từ `canViewLeadPii()` và đi vào docHangChoNguon bằng BIẾN `canViewPii` (không `canViewPii: true`)", () => {
    expect(dem(src, /\bcanViewLeadPii\(\)/g)).toBe(1);
    expect(dem(src, /\bdocHangChoNguon\(\s*actor\s*,\s*\{[^}]*\bcanViewPii\s*[,}]/g)).toBe(1);
    expect(dem(src, /\bcanViewPii\s*:/g)).toBe(0);
  });

  it("danh mục nhận `trangThai` và `loai` đã CHUẨN HOÁ qua bảng (TRANG_THAI · LOAI_NGUON_BO_LOC) — không nhận chuỗi URL thô", () => {
    expect(dem(src, /\bdocDanhMucNguon\(\s*actor\s*,\s*\{\s*now\s*,\s*trangThai\s*,\s*loai\s*,\s*coSoId\s*\}\s*\)/g)).toBe(1);
    expect(dem(src, /const trangThai = TRANG_THAI\.find\(\(t\) => t\.gia === motGiaTri\(sp\.trangthai\)\)\?\.gia \?\? null;/g)).toBe(1);
    expect(dem(src, /const loai: LeadSourceType \| null = LOAI_NGUON_BO_LOC\.find\(\(l\) => l === motGiaTri\(sp\.loai\)\) \?\? null;/g)).toBe(1);
  });
});

describe("[NHH-FE-W9] cổng quyền của MỖI page: điều kiện nguyên vẹn và trả đúng ThieuQuyen", () => {
  const goc = "app/(admin)/admin/nguon-hoa-hong";
  const trang: { k: string; gate: string; duong: string }[] = [
    ...TAB_KEYS.map((k) => ({ k: k as string, gate: TAB_HREF[k] as string, duong: `${goc}/${TAB_HREF[k].replace("/nguon-hoa-hong/", "")}/page.tsx` })),
    { k: "nguon", gate: TAB_HREF.nguon, duong: `${goc}/nguon/[maNguon]/page.tsx` },
  ];

  it("quét được đủ 6 page (5 tab + chi tiết nguồn)", () => {
    expect(trang).toHaveLength(6);
  });

  for (const { k, gate, duong } of trang) {
    it(`${duong.slice(goc.length + 1)}: if (!scope.any(PAGE_GATES["${gate}"])) { return <ThieuQuyen tab="${k}" … } đúng 1 lần`, () => {
      // [W1] chỉ đếm `PAGE_GATES["…"]`: `if (false && !scope.any(PAGE_GATES["…"]))` — cổng bị VÔ HIỆU — vẫn xanh.
      const src = doc(duong);
      const re = new RegExp(
        `if\\s*\\(\\s*!\\s*scope\\.any\\(\\s*PAGE_GATES\\[\\s*"${escRe(gate)}"\\s*\\]\\s*\\)\\s*\\)\\s*\\{\\s*return\\s*<ThieuQuyen\\s+tab="${k}"`,
        "g",
      );
      expect(dem(src, re)).toBe(1);
      expect(dem(src, /\bfalse\s*&&|\|\|\s*true\b/g), "điều kiện bị vô hiệu bằng hằng").toBe(0);
    });
  }
});

describe("[NHH-FE-W10] chi tiết nguồn: mã lạ ⇒ 404; mã trên URL được giải mã", () => {
  const src = doc("app/(admin)/admin/nguon-hoa-hong/nguon/[maNguon]/page.tsx");

  // [CTN] Trang đọc qua MỘT hàm ghép (`docTrangChiTietNguon`, bảy mục cô lập lỗi) thay vì gọi `docChiTietNguon` trực tiếp. Luật vẫn là: không có nguồn ⇒ 404 (không trang trống / 500),
  // và hàm đọc nhận actor đã scope + mã ĐÃ GIẢI MÃ. Bản cũ ghim văn bản `if (!ct) notFound();` / `docChiTietNguon(actor, ma, now)` — tên biến và tên hàm, không phải luật.
  it("`if (!trang) notFound();` đúng 1 lần (không để trang trống / lỗi 500 cho mã không có)", () => {
    expect(dem(src, /if\s*\(\s*!\s*trang\s*\)\s*notFound\(\);/g)).toBe(1);
  });

  it("hàm đọc nhận mã ĐÃ GIẢI MÃ (`ma`, từ giaiMaTrenUrl — xem W12) và actor đã scope", () => {
    expect(dem(src, /\bdocTrangChiTietNguon\(\s*actor\s*,\s*ma\s*,/g)).toBe(1);
    expect(dem(src, /\bgiaiMaTrenUrl\(\s*maNguon\s*\)/g)).toBe(1);
  });
});

describe("[NHH-FE-W11] page Nguồn: dây nối của chip cơ sở, phân trang và quyền mở lead", () => {
  const src = doc("app/(admin)/admin/nguon-hoa-hong/nguon/page.tsx");

  it("danh mục nhận `coSoId` (chip cơ sở LỌC thật, không chỉ đổi con số 'Cần xử lý') — gỡ là chip thành lời hứa suông", () => {
    // [W8] cũ chỉ ghim `{ now, trangThai }`; thiếu `coSoId` thì docDanhMucNguon đếm toàn tầm nhìn dù chip CS2 đang sáng.
    expect(dem(src, /\bdocDanhMucNguon\(\s*actor\s*,\s*\{[^}]*\bcoSoId\b[^}]*\}\s*\)/g)).toBe(1);
  });

  it("?trang= vượt biên bị kẹp rồi redirect về trang cuối: `kepTrang(trang, ds.tong, ds.kichThuoc)` + `redirect(hrefVoi(BASE, {…trang: trangHopLe}))` đúng 1 lần", () => {
    expect(dem(src, /\bkepTrang\(\s*trang\s*,\s*ds\.tong\s*,\s*ds\.kichThuoc\s*\)/g)).toBe(1);
    expect(dem(src, /\bredirect\(\s*hrefVoi\(\s*BASE\s*,\s*\{[^}]*\btrang\s*:\s*trangHopLe\b[^}]*\}\s*\)\s*\)/g)).toBe(1);
    // chỉ redirect khi CÓ lead (tổng 0 ⇒ nhánh rỗng lo, không redirect vòng)
    expect(dem(src, /\bds\.tong\s*>\s*0\s*&&\s*trangHopLe\s*!==\s*trang\b/g)).toBe(1);
  });

  it("quyền mở lead hỏi bằng ĐÚNG hai key của trang `/leads/[id]` và đi vào bảng bằng BIẾN `coTheMoLead` (không hằng)", () => {
    expect(dem(src, /\bcheckAnyPermission\(\s*\[\s*"leads:view-all"\s*,\s*"leads:view-own"\s*\]\s*\)/g)).toBe(1);
    expect(dem(src, /\bcoTheMoLead=\{coTheMoLead\}/g)).toBe(1);
    expect(dem(src, /\bcoTheMoLead(=\{\s*(true|false)\s*\}|\s*=\s*(true|false)\b)/g)).toBe(0);
  });

  it("ràng buộc hai chiều: trang chi tiết lead VẪN gác bằng hai key đó (đổi cổng ở đó mà quên ở đây ⇒ dòng hứa suông trở lại)", () => {
    const lead = doc("app/(admin)/admin/leads/[id]/page.tsx");
    expect(dem(lead, /\bcheckPermission\(\s*"leads:view-all"\s*\)/g)).toBe(1);
    expect(dem(lead, /\bcheckPermission\(\s*"leads:view-own"\s*\)/g)).toBe(1);
  });
});

describe("[NHH-FE-W12] chi tiết nguồn: mã %-escape sai ⇒ 404, không URIError", () => {
  const src = doc("app/(admin)/admin/nguon-hoa-hong/nguon/[maNguon]/page.tsx");

  it("giải mã qua `giaiMaTrenUrl` (null ⇒ notFound), KHÔNG `decodeURIComponent` trần", () => {
    expect(dem(src, /\bdecodeURIComponent\(/g)).toBe(0);
    expect(dem(src, /\bgiaiMaTrenUrl\(\s*maNguon\s*\)/g)).toBe(1);
    expect(dem(src, /if\s*\(\s*ma\s*===\s*null\s*\)\s*notFound\(\);/g)).toBe(1);
  });
});
