/**
 * [DPW-*] — LƯỚI GHIM MÃ NGUỒN cho DÂY NỐI của `/portal/disc` (DISC × SataRobo, Bước 7).
 * Page / layout kéo next-auth + Prisma nên không dựng được trong vitest thuần; hành vi đọc/IDOR được kiểm ở
 * `lib/disc/portal-doc.test.ts`. Lưới này canh thứ ca hành vi không phân biệt được. Mã ĐÃ BỎ CHÚ THÍCH, neo hẹp, ĐẾM số lần khớp.
 *   [DPW-01] layout truyền `coDisc` cho CẢ HAI shell; prop BẮT BUỘC (không `?`, không mặc định) và có LỌC theo nó
 *   [DPW-02] href literal `/portal/disc` đúng một lần ở mỗi shell
 *   [DPW-03] cổng chung: cờ kiểm TRƯỚC phiên; PARENT-only; userId từ phiên
 *   [DPW-04] page + route: dùng cổng chung; không import `@/lib/db`; không lấy userId từ params/searchParams; null ⇒ 404
 *   [DPW-05] `portal-doc.ts`: MỌI truy vấn đi qua `dieuKienCuaToi`; không đọc theo phoneKey
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(process.cwd(), duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

const layout = doc("app/(portal)/portal/layout.tsx");
const nav = doc("app/(portal)/portal/_components/portal-nav.tsx");
const shell = doc("components/portal/v2-shell.tsx");
const phien = doc("app/(portal)/portal/disc/_lib/phien-disc.ts");
const trangDs = doc("app/(portal)/portal/disc/page.tsx");
const trangCt = doc("app/(portal)/portal/disc/[id]/page.tsx");
const route = doc("app/(portal)/portal/disc/[id]/bao-cao/route.ts");
const portalDoc = doc("lib/disc/portal-doc.ts");

describe("[DPW-01..02] menu", () => {
  it("[DPW-01] layout truyền coDisc cho CẢ HAI shell; prop BẮT BUỘC ở cả hai và có lọc", () => {
    // N2: v2 KHÔNG còn lọc theo «có con» (phụ huynh nhận DISC chưa có học viên vẫn phải thấy menu) — cả hai nhánh theo cờ.
    expect(dem(layout, /coDisc=\{isDiscEnabled\(\) && children_\.length > 0\}/g)).toBe(0);
    expect(dem(layout, /coDisc=\{isDiscEnabled\(\)\}/g)).toBe(2); // v2 + v1
    expect(dem(layout, /<PortalV2Shell\b[\s\S]*?coDisc=\{[^}]*\}[\s\S]*?>/g)).toBeGreaterThanOrEqual(1);
    expect(dem(layout, /<PortalNav\b[\s\S]*?coDisc=\{[^}]*\}[\s\S]*?\/>/g)).toBeGreaterThanOrEqual(1);
    for (const [ten, src] of [["portal-nav", nav], ["v2-shell", shell]] as const) {
      expect(dem(src, /\bcoDisc: boolean;/g), `${ten}: kiểu bắt buộc`).toBe(1);
      expect(dem(src, /\bcoDisc\?:/g), `${ten}: không tuỳ chọn`).toBe(0);
      expect(dem(src, /\bcoDisc\s*=\s*(false|true)/g), `${ten}: không mặc định`).toBe(0);
    }
    expect(dem(nav, /\(it\.flag === "disc" && coDisc\)/g)).toBe(1);
    expect(dem(shell, /\.\.\.\(coDisc \? \[parentNavDisc\] : \[\]\)/g)).toBe(1);
    // Mục «Kiểm tra DISC» (làm bài ngay trong cổng) cũng chỉ hiện khi cờ bật — trang /portal/disc/lam-bai tự 404 khi cờ tắt.
    expect(dem(shell, /\.\.\.\(coDisc \? \[parentNavDiscLamBai\] : \[\]\)/g)).toBe(1);
    expect(dem(shell, /href: "\/portal\/disc\/lam-bai"/g)).toBe(1);
  });

  it("[DPW-02] href literal `/portal/disc` đúng một lần ở mỗi shell (lưới v2-nav-day-du quét literal)", () => {
    expect(dem(shell, /href: "\/portal\/disc"/g)).toBe(1);
    expect(dem(nav, /href: "\/portal\/disc"/g)).toBe(1);
  });
});

const khung = doc("components/portal/khung-chua-lien-ket.tsx");

describe("[DPW-06] ngoại lệ N2 — chưa có học viên vẫn vào /portal/disc", () => {
  it("cổng ở SERVER: cờ ∧ PARENT; `children` chỉ đi vào cây khi choPhepDisc (cờ tắt ⇒ page không chạy)", () => {
    expect(dem(layout, /const choPhepDisc = isDiscEnabled\(\) && session\.user\.role === "PARENT";/g)).toBe(1);
    // mỗi nhánh (v2, v1) đúng một lần, và luôn nằm sau `choPhepDisc ?` — nhánh else chỉ có thông báo, không có children
    expect(dem(layout, /\bchoPhepMienPhi \?/g)).toBe(2);
    // 08/11/2026: `choPhepMienPhi` = DISC ∨ (Tủ sách/Sức khỏe bật) — cờ nào TẮT thì đoạn của nó không có trong `doanThem` nên page không chạy.
    expect(dem(layout, /const choPhepMienPhi = choPhepDisc \|\| doanThem\.length > 0;/g)).toBe(1);
    expect(dem(layout, /<KhungChuaLienKet choPhepDisc=\{choPhepDisc\} doanThem=\{doanThem\} thongBao=\{thongBaoChua\}>\s*\{children\}\s*<\/KhungChuaLienKet>/g)).toBe(2);
    // nhánh else (cờ tắt / không phải PARENT) CHỈ là thông báo — không phải `children`
    // (05/11/2026: hai biến thongBaoV2/V1 gộp thành MỘT `thongBaoChua` = lời chào cho tài khoản chưa có bé — vẫn đúng hai nhánh else)
    expect(dem(layout, /\) : \(\s*thongBaoChua\s*\)/g)).toBe(2);
    // `{children}` trong layout: 2 lần trong KhungChuaLienKet + 1 lần ở main v1 (nhánh có con) + 1 lần ở vỏ HỌC SINH (`HvVo`, cổng học sinh 03/11/2026). Thêm lần nào nữa = có đường đưa page vào cây khi cờ tắt.
    expect(dem(layout, /\{children\}/g)).toBe(4);
    // Lần thứ tư KHÔNG mở đường cho /portal/disc: ở chế độ học sinh, layout của chính khu DISC đá con về /portal/hoc-sinh TRƯỚC khi page chạy (đối chứng dương: gỡ dòng này thì ca đỏ).
    expect(dem(doc("app/(portal)/portal/disc/layout.tsx"), /await chanKhiOCheDoHocSinh\(\);/g)).toBe(1);
  });

  it("client chọn theo đoạn đầu `disc` đúng một chỗ; rewrite host portal vẫn ra `disc`", () => {
    expect(dem(khung, /\(choPhepDisc && doanDau === "disc"\) \|\| doanThem\.includes\(doanDau\)/g)).toBe(1);
    expect(dem(khung, /useSelectedLayoutSegment\(\)/g)).toBe(1);
  });
});

describe("[DPW-03] cổng chung", () => {
  it("cờ kiểm TRƯỚC auth(); PARENT-only; userId từ phiên", () => {
    const iCo = phien.indexOf("isDiscEnabled()");
    const iAuth = phien.indexOf("await auth()");
    expect(iCo).toBeGreaterThan(-1);
    expect(iAuth).toBeGreaterThan(iCo);
    expect(dem(phien, /session\.user\.role !== "PARENT"/g)).toBe(1);
    expect(dem(phien, /userId: session\.user\.id/g)).toBe(1);
    expect(dem(phien, /\bif \(p\.loai === "CO_TAT"\) notFound\(\)/g)).toBe(1);
  });
});

describe("[DPW-04] page + route", () => {
  it("dùng cổng chung, không import @/lib/db, không lấy danh tính từ URL", () => {
    expect(dem(trangDs, /await yeuCauPhienDisc\(\)/g)).toBe(1);
    expect(dem(trangCt, /await yeuCauPhienDisc\(\)/g)).toBe(1);
    expect(dem(route, /await docPhienDisc\(\)/g)).toBe(1);
    for (const [ten, src] of [["page", trangDs], ["chi-tiet", trangCt], ["route", route], ["phien", phien]] as const) {
      expect(dem(src, /@\/lib\/db\b/g), `${ten}: cổng DB`).toBe(0);
    }
    // userId chỉ từ phiên: params/searchParams chỉ mang id bài / số trang, không bao giờ vào ô userId
    expect(dem(trangDs, /docDanhSachLuot\(userId, \{ trang: Number\(sp\.trang\) \}\)/g)).toBe(1);
    expect(dem(trangCt, /docChiTietLuot\(userId, id\)/g)).toBe(1);
    expect(dem(route, /docChiTietLuot\(phien\.userId, id\)/g)).toBe(1);
    expect(dem(trangDs + trangCt + route, /userId\s*=\s*(?:sp|params|id)\b/g)).toBe(0);
  });

  it("không tìm thấy ⇒ 404 (cùng một đường cho 'lạ' và 'của người khác'); báo cáo không cache chung", () => {
    expect(dem(trangCt, /if \(!luot\) notFound\(\);/g)).toBe(1);
    // 2 = cờ tắt + HTML không có bài/id lạ/của người khác — vẫn CÙNG MỘT hàm 404, không nhánh nào nói lý do khác. (Nhánh «bài không dựng được PDF» đã gỡ cùng tính năng tải PDF, 04/11/2026.)
    expect(dem(route, /KHONG_TIM_THAY\(\)/g)).toBe(2);
    expect(dem(route, /"Cache-Control": "private, no-store"/g)).toBeGreaterThanOrEqual(2);
    expect(dem(route, /Content-Security-Policy/g)).toBe(1);
  });
});

describe("[DPW-05] portal-doc", () => {
  it("MỌI truy vấn Prisma bắt đầu từ dieuKienCuaToi; không có truy vấn theo phoneKey/claimCode", () => {
    const truyVan = dem(portalDoc, /\bdb\.discSubmission\.(count|findMany|findFirst|findUnique)\(/g);
    expect(truyVan).toBe(5); // count + findMany(ds) + findFirst(ct) + findMany(lịch sử) + findMany(tải dữ liệu của tôi)
    expect(dem(portalDoc, /(?:\.\.\.|=\s*|where:\s*)dieuKienCuaToi\(userId\)/g)).toBe(4); // const where (count + ds) · findFirst · lịch sử · tải dữ liệu của tôi
    expect(dem(portalDoc, /\bdb\.discSubmission\.(findUnique|update|updateMany|delete|deleteMany|create)\(/g)).toBe(0);
    expect(dem(portalDoc, /where:\s*\{\s*phoneKey|phoneKey:/g)).toBe(0);
    expect(dem(portalDoc, /claimedUserId: userId, claimStatus: "CLAIMED" as const, deletedAt: null/g)).toBe(1);
  });
});
