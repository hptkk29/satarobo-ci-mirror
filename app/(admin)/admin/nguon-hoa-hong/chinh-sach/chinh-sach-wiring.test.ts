/**
 * [NHH-FE-WCS-*] — LƯỚI GHIM MÃ NGUỒN cho dây nối của tab Chính sách (PR8) — phần mà test hành vi KHÔNG chạm tới vì page/action
 * là Server Component / Server Action (kéo next-auth + Prisma, không dựng được trong vitest).
 *
 * Cùng khuôn `khung-wiring.test.ts` / `khuyen-mai/quyen-action.test.ts`: đọc mã ĐÃ BỎ CHÚ THÍCH, neo hẹp, ĐẾM SỐ LẦN khớp, không cờ `/s`
 * (luật 11). Mỗi ca ĐÃ được cấy lại lỗi tương ứng để thấy đỏ (bảng cấy ở docs/source-commission/06, mục "Trạng thái thi công — PR8").
 *
 *   [NHH-FE-WCS-01..03]  Server Action: kiểm quyền ĐÚNG KEY ngay đầu hàm, trước mọi lời gọi nghiệp vụ; không `db` trần; chỉ export hàm async
 *   [NHH-FE-WCS-04..06]  page: cổng tab, quyền soạn ≠ quyền kích hoạt ≠ quyền ghi theo chủ sở hữu, chip cơ sở lọc thật
 *   [NHH-FE-WCS-07..08]  số hàng chờ một nguồn; trình soạn gọi action đúng chỗ, nút kích hoạt đi qua `quyetDinhNutKichHoat`
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();
const T = "app/(admin)/admin/nguon-hoa-hong/chinh-sach";

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

/** Tách thân từng `export async function`. */
function cacHam(src: string): { ten: string; than: string }[] {
  return src
    .split(/export async function /)
    .slice(1)
    .map((p) => ({ ten: p.slice(0, p.indexOf("(")), than: p }));
}

describe("[NHH-FE-WCS-01] _actions.ts: đúng năm action (bốn thao tác + thử tính), mỗi action kiểm ĐÚNG quyền ngay đầu hàm", () => {
  const src = doc(`${T}/_actions.ts`);
  const ham = cacHam(src);
  const QUYEN: Record<string, string> = {
    luuNhapAction: "commission_policies:manage",
    kiemHangRaoAction: "commission_policies:view",
    kichHoatAction: "commission_policies:activate",
    huyNhapAction: "commission_policies:manage",
    thuTinhAction: "commission_policies:manage",
  };
  const NGHIEP_VU: Record<string, RegExp> = {
    luuNhapAction: /\bluuNhap\(/,
    kiemHangRaoAction: /\bkiemHangRao\(/,
    kichHoatAction: /\bkichHoatPhienBan\(/,
    huyNhapAction: /\bhuyBanNhap\(/,
    thuTinhAction: /\bthuTinhPhienBan\(/,
  };

  it("[NHH-FE-WCS-01a] có đúng 5 action, tên khớp bảng (thêm action mới phải thêm dòng ở đây)", () => {
    expect(ham.map((h) => h.ten).sort()).toEqual(Object.keys(QUYEN).sort());
  });

  for (const h of cacHam(src)) {
    it(`[NHH-FE-WCS-01b] ${h.ten}: auth() → assertPermission("${QUYEN[h.ten]}") → resolveActor → nghiệp vụ, đúng thứ tự`, () => {
      const iAuth = h.than.indexOf("await auth()");
      const iQuyen = h.than.indexOf(`await assertPermission("${QUYEN[h.ten]}")`);
      const iActor = h.than.indexOf("await resolveActor(");
      const m = NGHIEP_VU[h.ten]!.exec(h.than);
      expect(iAuth, "thiếu auth()").toBeGreaterThan(-1);
      expect(iQuyen, `thiếu assertPermission("${QUYEN[h.ten]}")`).toBeGreaterThan(iAuth);
      expect(iActor, "thiếu resolveActor").toBeGreaterThan(iQuyen);
      expect(m, "không thấy lời gọi nghiệp vụ").not.toBeNull();
      expect(m!.index).toBeGreaterThan(iActor);
      // đúng MỘT lời kiểm quyền, và không phải quyền khác (chép nhầm key)
      expect(dem(h.than, /\bassertPermission\(/g)).toBe(1);
    });
  }

  it("[NHH-FE-WCS-01c] quyền soạn TÁCH quyền kích hoạt: `activate` chỉ ở kichHoatAction, `manage` không ở kichHoatAction", () => {
    expect(dem(src, /assertPermission\("commission_policies:activate"\)/g)).toBe(1);
    const kich = ham.find((h) => h.ten === "kichHoatAction")!;
    expect(kich.than).not.toMatch(/commission_policies:manage/);
  });

  it("[NHH-FE-WCS-02] không import `@/lib/db` trần; không so vai/cơ sở inline (cổng DB + no-inline-authz); không `any`", () => {
    expect(dem(src, /from\s+"@\/lib\/db"/g)).toBe(0);
    expect(dem(src, /\.roles?\s*[!=]==|\.centerId\s*[!=]==|\.includes\(\s*["'](SUPER_ADMIN|CENTER_MANAGER)/g)).toBe(0);
    expect(dem(src, /:\s*any\b|\bas any\b/g)).toBe(0);
  });

  it("[NHH-FE-WCS-03] file 'use server' chỉ export hàm async (mọi export khác thành endpoint POST)", () => {
    const raw = readFileSync(resolve(GOC, `${T}/_actions.ts`), "utf8");
    expect(raw.trimStart().startsWith('"use server"')).toBe(true);
    const exports = [...src.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
    expect(exports.every((e) => e === "async")).toBe(true);
    expect(exports.length).toBe(5);
  });
});

const pages: { ten: string; duong: string }[] = [
  { ten: "chính", duong: `${T}/page.tsx` },
  { ten: "moi", duong: `${T}/moi/page.tsx` },
  { ten: "[policyId]", duong: `${T}/[policyId]/page.tsx` },
  { ten: "[policyId]/soan", duong: `${T}/[policyId]/soan/page.tsx` },
];

describe("[NHH-FE-WCS-04] mọi page của tab Chính sách vào cổng đúng tab và gác đúng PAGE_GATES", () => {
  for (const { ten, duong } of pages) {
    it(`${ten}: vaoTab("chinh-sach") đúng 1 lần; if (!scope.any(PAGE_GATES[…])) { return <ThieuQuyen tab="chinh-sach" …} đúng 1 lần; không điều kiện bị vô hiệu`, () => {
      const src = doc(duong);
      expect(dem(src, /\bvaoTab\(\s*"chinh-sach"\s*\)/g)).toBe(1);
      expect(dem(src, /\bvaoTab\(/g)).toBe(1);
      expect(dem(src, /if\s*\(\s*!\s*scope\.any\(\s*PAGE_GATES\[\s*"\/nguon-hoa-hong\/chinh-sach"\s*\]\s*\)\s*\)\s*\{\s*return\s*<ThieuQuyen\s+tab="chinh-sach"/g)).toBe(1);
      expect(dem(src, /\bfalse\s*&&|\|\|\s*true\b/g)).toBe(0);
    });
  }
});

describe("[NHH-FE-WCS-05] quyền soạn ≠ quyền kích hoạt ≠ quyền GHI theo chủ sở hữu (luật 12: nút nói thật)", () => {
  it("[NHH-FE-WCS-05a] trang tạo mới đòi `commission_policies:manage` trước khi dựng form, và trả NoPermission nêu đúng key", () => {
    const src = doc(`${T}/moi/page.tsx`);
    expect(dem(src, /!\s*scope\.has\(\s*"commission_policies:manage"\s*\)/g)).toBe(1);
    expect(dem(src, /<NoPermission\s+permission="commission_policies:manage"/g)).toBe(1);
    // đòi quyền TRƯỚC khi đọc dữ liệu soạn
    expect(src.indexOf('scope.has("commission_policies:manage")')).toBeLessThan(src.indexOf("docDuLieuSoan("));
  });

  it("[NHH-FE-WCS-05b] trang soạn: coQuyenSoan = manage ∧ coTheGhi; coQuyenKichHoat = activate ∧ coTheGhi (BLĐ có activate mà không có manage vẫn kích hoạt được)", () => {
    const src = doc(`${T}/[policyId]/soan/page.tsx`);
    expect(dem(src, /const coTheGhi = coTheGhiChoChuSoHuu\(\s*tamNhinChinhSach\(actor\)\s*,\s*goc\.ownerCenterId\s*\)/g)).toBe(1);
    expect(dem(src, /const coQuyenSoan = scope\.has\("commission_policies:manage"\) && coTheGhi/g)).toBe(1);
    expect(dem(src, /coQuyenKichHoat=\{scope\.has\("commission_policies:activate"\) && coTheGhi\}/g)).toBe(1);
  });

  it("[NHH-FE-WCS-05c] trang chi tiết: nút Sửa/Tạo mới chỉ khi coTheSoan; 'Kiểm và kích hoạt' chỉ khi coTheKichHoat; cả hai gồm quyền GHI cho chủ sở hữu", () => {
    const src = doc(`${T}/[policyId]/page.tsx`);
    expect(dem(src, /const coTheSoan = scope\.has\("commission_policies:manage"\) && coTheGhi;/g)).toBe(1);
    expect(dem(src, /const coTheKichHoat = scope\.has\("commission_policies:activate"\) && coTheGhi;/g)).toBe(1);
    expect(dem(src, /(?<![!\w])chonLaNhap && coTheSoan &&/g)).toBe(1);
    expect(dem(src, /(?<![!\w])chonLaNhap && coTheKichHoat &&/g)).toBe(1);
    expect(dem(src, /!chonLaNhap && coTheSoan &&/g)).toBe(1);
  });

  it("[NHH-FE-WCS-05d] trang tab chính: nút 'Tạo chính sách' chỉ vẽ khi scope.has(manage)", () => {
    const src = doc(`${T}/page.tsx`);
    expect(dem(src, /const coTheSoan = scope\.has\("commission_policies:manage"\);/g)).toBe(1);
    expect(dem(src, /const actions = coTheSoan \? <NutTao \/> : undefined;/g)).toBe(1);
  });
});

describe("[NHH-FE-WCS-06] chip cơ sở LỌC THẬT (luật 12) và chỉ hiện khi có gì để lọc", () => {
  const src = doc(`${T}/page.tsx`);

  it("ma trận nhận `coSoId` đã kiểm nằm trong tầm nhìn; bảng lọc theo chủ sở hữu = Hội sở HOẶC đúng cơ sở đó", () => {
    expect(dem(src, /\bdocDuLieuMaTran\(\s*actor\s*,\s*coSoId\s*\)/g)).toBe(1);
    expect(dem(src, /d\.chuSoHuuCenterId === null \|\| d\.chuSoHuuCenterId === coSoId/g)).toBe(1);
    // cơ sở lấy từ danh sách TẦM NHÌN (boLoc.coSo), không từ chuỗi URL thô
    expect(dem(src, /const coSoChon = boLoc\.coSo\.find\(\(c\) => c\.id === motGiaTri\(sp\.coSo\)\) \?\? null;/g)).toBe(1);
  });

  it("ở chế độ 'Cần xử lý' ScopeBar KHÔNG có chip cơ sở (một chip không đổi được gì là lời hứa suông)", () => {
    expect(dem(src, /coSo=\{xem === "can-xu-ly" \? undefined : boLoc\.coSo\}/g)).toBe(1);
  });

  it("chip cơ sở dựng từ tầm nhìn (docBoLocChinhSach), KHÔNG từ can(action, {centerId})", () => {
    expect(dem(src, /\bcan\(|checkPermission\(|\.centerId\s*===\s*actor/g)).toBe(0);
  });
});

describe("[NHH-FE-WCS-07] số hàng chờ MỘT nguồn", () => {
  it("trang tab chính: 'Cần xử lý (N)' lấy từ viec.length của CHÍNH hàm đã dựng bảng; pill tab đồng bộ cùng số", () => {
    const src = doc(`${T}/page.tsx`);
    expect(dem(src, /\bdocHangChoChinhSach\(/g)).toBe(1);
    expect(dem(src, /soCanXuLy=\{viec\.length\}/g)).toBe(1);
    expect(dem(src, /soHangCho=\{\{\s*\.\.\.soHangCho,\s*"chinh-sach":\s*viec\.length\s*\}\}/g)).toBe(1);
  });

  it("pill tab/route gốc đếm bằng đúng demHangChoChinhSach (docSoHangChoTheoTab), không hàm khác", () => {
    const src = doc("lib/nguon-hoa-hong/hang-cho.ts");
    expect(dem(src, /\bdemHangChoChinhSach\(/g)).toBe(1);
    expect(dem(src, /scope\.tabMoDuoc\("chinh-sach"\)/g)).toBe(1);
  });
});

describe("[NHH-FE-WCS-08] trình soạn gọi action đúng chỗ", () => {
  const src = doc(`${T}/_components/trinh-soan.tsx`);

  it("mỗi action được gọi ĐÚNG MỘT lần; kích hoạt chỉ trong xacNhanKichHoat", () => {
    expect(dem(src, /\bluuNhapAction\(/g)).toBe(1);
    expect(dem(src, /\bkichHoatAction\(/g)).toBe(1);
    expect(dem(src, /\bkiemHangRaoAction\(/g)).toBe(1);
    expect(dem(src, /\bhuyNhapAction\(/g)).toBe(1);
    const a = src.indexOf("function xacNhanKichHoat()");
    const b = src.indexOf("function huyBanNhap()");
    expect(src.indexOf("kichHoatAction(")).toBeGreaterThan(a);
    expect(src.indexOf("kichHoatAction(")).toBeLessThan(b);
  });

  it("nút Kích hoạt đi qua quyetDinhNutKichHoat với laBanNhap = (phiên bản là nháp), KHÔNG gắn vào quyền soạn", () => {
    expect(dem(src, /\bquyetDinhNutKichHoat\(/g)).toBe(1);
    expect(dem(src, /const laBanNhap = p\.khoa === null;/g)).toBe(1);
    expect(dem(src, /quyetDinhNutKichHoat\(\{\s*coQuyenKichHoat: p\.coQuyenKichHoat,\s*laBanNhap,/g)).toBe(1);
  });

  it("lưu nháp kiểm `loiLuuNhap(form)` TRƯỚC khi gọi máy chủ; Tiếp dùng loiTheoBuoc; bước Kích hoạt đứng NGOÀI fieldset khoá", () => {
    expect(src.indexOf("loiLuuNhap(form)")).toBeLessThan(src.indexOf("luuNhapAction("));
    expect(dem(src, /\bloiTheoBuoc\(/g)).toBe(1);
    expect(dem(src, /<fieldset disabled=\{khoa\}/g)).toBe(1);
    const iFieldset = src.indexOf("<fieldset disabled={khoa}");
    const iDongFieldset = src.indexOf("</fieldset>");
    expect(src.indexOf("<BuocKichHoat")).toBeGreaterThan(iDongFieldset);
    expect(src.indexOf("<BuocBoiCanh")).toBeGreaterThan(iFieldset);
    expect(src.indexOf("<BuocBoiCanh")).toBeLessThan(iDongFieldset);
  });

  it("không dangerouslySetInnerHTML, không useEffect để lấy dữ liệu (chỉ focus/beforeunload)", () => {
    expect(dem(src, /dangerouslySetInnerHTML/g)).toBe(0);
    expect(dem(src, /\bfetch\(/g)).toBe(0);
  });
});

describe("[NHH-FE-WCS-09] module tạo/sửa chính sách có lối vào (nav-coverage) và loading từng route", () => {
  it("liên kết tới /moi nằm trong page tab chính (chuỗi literal) — nav-coverage quét literal", () => {
    // hai chỗ: nút "Tạo chính sách" và liên kết trong dải "chưa có chính sách nào đang hiệu lực"
    expect(dem(readFileSync(resolve(GOC, `${T}/page.tsx`), "utf8"), /href="\/nguon-hoa-hong\/chinh-sach\/moi"/g)).toBe(2);
  });

  it("moi, [policyId], [policyId]/soan đều có loading.tsx", async () => {
    const { existsSync } = await import("node:fs");
    for (const d of ["moi", "[policyId]", "[policyId]/soan"]) expect(existsSync(resolve(GOC, `${T}/${d}/loading.tsx`)), d).toBe(true);
  });
});

/**
 * [NHH-FE-WCS-10] — ba quyết định của page RSC mà `[NHH-FE-WCS-05]` KHÔNG chạm (cấy 08/10, rà soát độc lập: cả ba cấy đều XANH 1193/1193):
 *   · trang chi tiết: nút "Sửa bản nháp"/"Kiểm và kích hoạt" chỉ cho NHÁP CHƯA DÙNG (`chonLaNhap` có vế `!daDung`) — bản nháp đã sinh dòng
 *     sổ mà vẫn hiện nút là lời hứa suông (service từ chối `VERSION_DA_KHOA`);
 *   · trang soạn: bản đã kích hoạt/đã dùng ⇒ `khoa` (form chỉ đọc). Bỏ nhánh này là form MỞ để sửa một phiên bản bất biến;
 *   · trang tạo mới: nút Kích hoạt theo quyền `activate` THẬT, không `true`.
 * Page là Server Component (kéo next-auth + Prisma) nên không dựng được dưới vitest — lưới đọc mã, neo hẹp, đếm số lần khớp.
 */
describe("[NHH-FE-WCS-10] quyết định khoá/nút của page RSC", () => {
  it("[NHH-FE-WCS-10a] trang chi tiết: chonLaNhap = nháp ∧ chưa dùng; kiểm hàng rào chỉ khi chonLaNhap", () => {
    const src = doc(`${T}/[policyId]/page.tsx`);
    expect(dem(src, /const chonLaNhap = chon\.status === "DRAFT" && !chon\.daDung;/g)).toBe(1);
    expect(dem(src, /const kiem = chonLaNhap \? await kiemHangRao\(/g)).toBe(1);
  });

  it("[NHH-FE-WCS-10b] trang soạn: khoá khi KHÔNG phải nháp, và khi nháp đã dùng; chỉ kiểm hàng rào cho nháp sửa được", () => {
    const src = doc(`${T}/[policyId]/soan/page.tsx`);
    expect(dem(src, /const taoMoi = versionId === null;/g)).toBe(1);
    expect(dem(src, /: goc\.status !== "DRAFT"/g)).toBe(1);
    expect(dem(src, /: goc\.daDung/g)).toBe(1);
    expect(dem(src, /const laNhapSua = !taoMoi && goc\.status === "DRAFT" && !goc\.daDung;/g)).toBe(1);
    expect(dem(src, /laNhapSua \? await kiemHangRao\(/g)).toBe(1);
  });

  it("[NHH-FE-WCS-10c] trang tạo mới: coQuyenKichHoat theo scope.has(activate), không hằng", () => {
    const src = doc(`${T}/moi/page.tsx`);
    expect(dem(src, /coQuyenKichHoat=\{scope\.has\("commission_policies:activate"\)\}/g)).toBe(1);
    expect(dem(src, /coQuyenKichHoat=\{\s*true\s*\}|coQuyenKichHoat\s*(?:\/>|\n)/g)).toBe(0);
  });

  // Cấy 08/10: `loc.slice((trang - 1) * KICH_THUOC, trang * KICH_THUOC)` → `loc.slice(0, KICH_THUOC)` XANH 1198/1198 — trang 2, 3… in lại trang 1 và
  // dòng "Hiển thị 26–50 / 60" nói dối. Nhánh "Tất cả" của page là RSC (không dựng được dưới vitest) nên chỉ lưới đọc mã giữ được.
  it("[NHH-FE-WCS-10d] bảng 'Tất cả': kẹp trang theo tổng SAU lọc, cắt đúng cửa sổ trang, dòng 'Hiển thị a–b' cùng cửa sổ", () => {
    const src = doc(`${T}/page.tsx`);
    expect(dem(src, /const trang = kepTrang\(docTrang\(sp\.trang\), loc\.length, KICH_THUOC\);/g)).toBe(1);
    expect(dem(src, /const dong = loc\.slice\(\(trang - 1\) \* KICH_THUOC, trang \* KICH_THUOC\);/g)).toBe(1);
    expect(dem(src, /\{\(trang - 1\) \* KICH_THUOC \+ 1\}–\{Math\.min\(loc\.length, trang \* KICH_THUOC\)\}/g)).toBe(1);
    expect(dem(src, /soTrang=\{Math\.max\(1, Math\.ceil\(loc\.length \/ KICH_THUOC\)\)\}/g)).toBe(1);
    expect(dem(src, /const KICH_THUOC = 25;/g)).toBe(1);
  });

/**
 * [NHH-FE-WCS-11] — ba CỔNG của đường ghi có người dùng (`lib/hoa-hong/chinh-sach-hanh-dong.ts`) mà test hành vi chỉ chạm khi ĐÚNG đầu vào:
 * service có tham số TUỲ CHỌN `updatedAtDaThay` (seed + test dịch vụ không có mốc), nên quên truyền ở đường người dùng KHÔNG làm tsc hay ca nào đỏ
 * ngoài ca DB — mà ca DB `[NHH-FE-HD-30]` chỉ đỏ khi hàm điều phối chạy thật. Lưới này giữ dây nối ở chính mã nguồn.
 */
describe("[NHH-FE-WCS-11] đường ghi có người dùng: mốc updatedAt + tệp + trạng thái", () => {
  const src = doc("lib/hoa-hong/chinh-sach-hanh-dong.ts");

  it("[NHH-FE-WCS-11a] `suaNhap(` và `kichHoat(` đều được truyền `updatedAtDaThay` (đúng một lần mỗi lời gọi)", () => {
    expect(dem(src, /await suaNhap\(\{/g)).toBe(1);
    expect(dem(src, /updatedAtDaThay: nhapDangSua\.updatedAt,/g)).toBe(1);
    expect(dem(src, /await kichHoat\(\{[^\n]*updatedAtDaThay: new Date\(a\.updatedAtDaThay\) \}\);/g)).toBe(1);
  });

  it("[NHH-FE-WCS-11b] `luuNhap` từ chối trước khi tạo văn bản: `canNhap(` và `loiTepVanBan(` đứng TRƯỚC `taoVanBan(`; sửa nháp đã có mà thiếu mốc bị từ chối", () => {
    const iTao = src.indexOf("await taoVanBan(");
    expect(iTao).toBeGreaterThan(0);
    expect(dem(src, /\bcanNhap\(nhapDangSua\)/g)).toBe(1);
    expect(dem(src, /\bloiTepVanBan\(\{/g)).toBe(1);
    expect(src.indexOf("canNhap(nhapDangSua)")).toBeLessThan(iTao);
    expect(src.indexOf("loiTepVanBan({")).toBeLessThan(iTao);
    expect(dem(src, /nhapDangSua && a\.vao\.updatedAtDaThay === null\) return thatBai\(/g)).toBe(1);
  });

  it("[NHH-FE-WCS-11c] Server Action `kichHoatAction` chuyển `updatedAtDaThay` xuống điều phối (không tự bịa mốc)", () => {
    const a = doc(`${T}/_actions.ts`);
    expect(dem(a, /updatedAtDaThay: vao\.updatedAtDaThay \}\);/g)).toBe(1);
    expect(dem(a, /updatedAtDaThay: new Date|updatedAtDaThay: "/g)).toBe(0);
  });

  it("[NHH-FE-WCS-11d] trình soạn gửi mốc của bản nháp ĐÃ LƯU (`luu.updatedAt`) khi kích hoạt", () => {
    const t = doc(`${T}/_components/trinh-soan.tsx`);
    expect(dem(t, /kichHoatAction\(\{[^\n]*updatedAtDaThay: luu\.updatedAt \}\)/g)).toBe(1);
  });
});
});
