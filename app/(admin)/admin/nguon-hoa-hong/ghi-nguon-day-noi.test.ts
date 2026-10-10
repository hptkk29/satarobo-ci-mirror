/**
 * [NHH-UI-W1..W7] — LƯỚI GHIM MÃ NGUỒN cho dây nối của UI GHI tab Nguồn (PR7).
 *
 * Cổng mà test hành vi KHÔNG chạm tới: action là "use server" kéo next-auth + Prisma, page là Server Component — không dựng được trong
 * vitest thuần. Nên ghim bằng văn bản mã nguồn ĐÃ BỎ CHÚ THÍCH. Luật 11: neo hẹp, ĐẾM SỐ LẦN khớp, không cờ `/s`; luật 14: mỗi ca đã
 * được CẤY lại lỗi để thấy nó đỏ (danh sách phép cấy ở docs/source-commission/06, mục "PR7").
 *
 *   [NHH-UI-W1]  NÚT VẼ = KHOÁ MÀ CỔNG KIỂM (luật 12): nút "Đổi nguồn"/Sheet hỏi quyền bằng `quyenDoiNguon` — CÙNG hàm mà cổng server
 *                (`quyetDinhDoiNguon`) gọi — và hai đường hỏi ĐÚNG MỘT bộ khoá
 *   [NHH-UI-W2]  action ĐỌC/GHI mới gác quyền Ở ĐẦU HÀM (trước zod, trước mọi truy vấn) bằng đúng khoá mà giao diện dùng để vẽ
 *   [NHH-UI-W3]  khối "Nguồn" trên lead: gác `sources:view` ∧ cờ TRƯỚC khi đọc; đọc qua MỘT hàm; không vẽ khi null
 *   [NHH-UI-W4]  thành phần CLIENT không kéo mã chỉ-máy-chủ (db, scopedDb, auth, tệp đọc DB) vào trình duyệt
 *   [NHH-UI-W5]  bảng nguồn của Page chỉ có MỘT đường ghi (không rải `systemSetting.*` cho khoá này ra nơi khác)
 *   [NHH-UI-W6]  ép chọn nguồn: Server Action chặn Ở MÁY CHỦ trước khi nhận lead, và đưa lựa chọn xuống resolver
 *   [NHH-UI-W7]  hàng chờ mở Sheet; không quay lại liên kết thẳng sang /leads
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KHOA_QUYEN_DOI_NGUON } from "@/lib/nguon/doi-nguon";

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

/** Thân của hàm `export async function ten(` — tới `}` đứng đầu dòng. */
function than(src: string, ten: string): string {
  const i = src.indexOf(`export async function ${ten}(`);
  expect(i, `không thấy hàm ${ten}`).toBeGreaterThanOrEqual(0);
  const j = src.indexOf("\n}\n", i);
  return src.slice(i, j < 0 ? undefined : j);
}

const SUA_QUYEN = [KHOA_QUYEN_DOI_NGUON.truocThuc, KHOA_QUYEN_DOI_NGUON.sauThuc, KHOA_QUYEN_DOI_NGUON.khoa];

describe("[NHH-UI-W1] nút vẽ = khoá mà cổng kiểm", () => {
  it("`docChoGanNguon` (nguồn của nút/Sheet) gọi `quyenDoiNguon` ĐÚNG MỘT lần; `quyetDinhDoiNguon` (cổng server) cũng ĐÚNG MỘT lần — không ai tự viết lại điều kiện quyền", () => {
    const doc1 = doc("lib/nguon/doc-gan-nguon.ts");
    const cong = doc("lib/nguon/doi-nguon.ts");
    expect(dem(doc1, /\bquyenDoiNguon\(/g)).toBe(1);
    // trong doi-nguon.ts: một định nghĩa + đúng một lời gọi trong `quyetDinhDoiNguon`
    expect(dem(cong, /\bquyenDoiNguon\(/g)).toBe(2);
    expect(dem(cong, /export function quyenDoiNguon\(/g)).toBe(1);
  });

  it("tên khoá nằm ở MỘT bảng (KHOA_QUYEN_DOI_NGUON): doi-nguon.ts không rải chuỗi khoá ngoài bảng đó", () => {
    const cong = doc("lib/nguon/doi-nguon.ts");
    for (const k of SUA_QUYEN) expect(dem(cong, new RegExp(`"${k}"`, "g")), k).toBe(1);
  });

  it("bộ khoá HỎI của nút (doc-gan-nguon) = bộ khoá HỎI của cổng (doi-nguon-lead) = bảng khoá — lệch một khoá là nút nói một đằng, cổng làm một nẻo", () => {
    const khoaHoi = (src: string) => new Set([...src.matchAll(/kiemQuyen\(\s*"([a-z_:-]+)"/g)].map((m) => m[1]!));
    const nutTho = khoaHoi(doc("lib/nguon/doc-gan-nguon.ts"));
    const cong = khoaHoi(doc("lib/nguon/doi-nguon-lead.ts"));
    // `payments:view` KHÔNG phải khoá ĐỔI nguồn: nó chỉ quyết có TRẢ tổng tiền đã thu xuống Sheet hay không (người chỉ có sources:view
    // không nhận số tiền của lead). Nằm ngoài bộ khoá của cổng, và được ghim riêng ở đây để không ai gỡ nó mà lưới vẫn xanh.
    expect(nutTho.has("payments:view")).toBe(true);
    const nut = new Set([...nutTho].filter((k) => k !== "payments:view"));
    expect([...nut].sort()).toEqual([...SUA_QUYEN].sort());
    expect([...cong].sort()).toEqual([...nut].sort());
  });

  it("Sheet chỉ vẽ form/nút Lưu khi máy chủ nói ĐƯỢC: biến `duocDoi` suy từ `du.quyen.ok` và gác cả form lẫn nút", () => {
    const sheet = doc("components/admin/nguon-hoa-hong/gan-nguon-sheet.tsx");
    expect(dem(sheet, /const duocDoi = du\.quyen\.ok\b/g)).toBe(1);
    expect(dem(sheet, /\{duocDoi && nguon && \(/g)).toBe(1); // form
    expect(dem(sheet, /\{duocDoi && \(/g)).toBe(1); // nút Lưu
    const khoi = doc("components/admin/nguon-hoa-hong/khoi-nguon-lead.tsx");
    expect(dem(khoi, /nguon && du\.quyen\.ok &&/g)).toBe(1); // nút "Đổi nguồn" trên lead
  });
});

describe("[NHH-UI-W2] gác quyền Ở ĐẦU HÀM bằng đúng khoá giao diện dùng", () => {
  const nguon = doc("app/(admin)/admin/leads/nguon-actions.ts");
  const pm = doc("app/(admin)/admin/nguon-hoa-hong/nguon/_actions.ts");

  it("`moGanNguonAction`: sources:view đứng TRƯỚC zod và TRƯỚC đọc dữ liệu; khoá = khoá cổng của tab Nguồn", () => {
    const t = than(nguon, "moGanNguonAction");
    const quyen = t.indexOf('checkPermission("sources:view")');
    expect(quyen).toBeGreaterThan(0);
    expect(quyen).toBeLessThan(t.indexOf(".safeParse("));
    expect(quyen).toBeLessThan(t.indexOf("docChoGanNguon("));
    expect(dem(t, /checkPermission\(/g)).toBe(2); // 1 ở đầu + 1 truyền xuống `docChoGanNguon` (quyền THEO TỪNG LEAD)
  });

  it("`timNguoiGioiThieuAction`: khoá cho phép GHI nguồn đứng TRƯỚC zod và TRƯỚC tìm; bộ khoá gồm cả `leads:create` (form nhập lead)", () => {
    const t = than(nguon, "timNguoiGioiThieuAction");
    const quyen = t.indexOf("checkAnyPermission(KHOA_TIM_NGUOI)");
    expect(quyen).toBeGreaterThan(0);
    expect(quyen).toBeLessThan(t.indexOf(".safeParse("));
    expect(quyen).toBeLessThan(t.indexOf("timNguoiGioiThieu("));
    const bo = nguon.match(/const KHOA_TIM_NGUOI = \[([^\]]+)\] as const;/);
    expect(bo).not.toBeNull();
    const cac = [...bo![1]!.matchAll(/"([a-z_:-]+)"/g)].map((m) => m[1]);
    expect(cac.sort()).toEqual(["leads:create", ...SUA_QUYEN].sort());
  });

  it("`luuPageMappingAction`: sources:manage đứng TRƯỚC zod và TRƯỚC ghi; ĐÚNG khoá mà trang dùng để vẽ ô sửa (`scope.has`)", () => {
    const t = than(pm, "luuPageMappingAction");
    const quyen = t.indexOf('checkPermission("sources:manage")');
    expect(quyen).toBeGreaterThan(0);
    expect(quyen).toBeLessThan(t.indexOf(".safeParse("));
    expect(quyen).toBeLessThan(t.indexOf("luuNguonCuaPage("));
    const trang = doc("app/(admin)/admin/nguon-hoa-hong/nguon/page.tsx");
    expect(dem(trang, /const coTheSua = scope\.has\("sources:manage"\);/g)).toBe(2); // chế độ Page mapping + chế độ danh mục: cùng khoá với action
    expect(dem(trang, /coTheSua=\{coTheSua\}/g)).toBe(1);
  });

  it("`doiNguonLeadAction` nhận mốc khoá lạc quan của MÀN HÌNH và chuyển xuống dịch vụ", () => {
    const t = than(nguon, "doiNguonLeadAction");
    expect(dem(t, /daThayCapNhatLuc: d\.expectedUpdatedAt/g)).toBe(1);
    // HAI schema: «Đổi nguồn» + «Bổ sung Sale phụ trách PH» — mỗi action tự nhận mốc của màn hình mình (gỡ một nơi là mất khoá lạc quan ở đúng action đó).
    expect(dem(nguon, /expectedUpdatedAt: z\.string\(\)\.datetime\(\)/g)).toBe(2);
    const sheet = doc("components/admin/nguon-hoa-hong/gan-nguon-sheet.tsx");
    expect(dem(sheet, /expectedUpdatedAt: nguon\.capNhatLuc/g)).toBe(1);
    const bo = than(nguon, "boSungSalePhuHuynhAction");
    expect(dem(bo, /daThayCapNhatLuc: d\.expectedUpdatedAt/g)).toBe(1);
    const sheetBo = doc("components/admin/nguon-hoa-hong/bo-sung-sale-sheet.tsx");
    expect(dem(sheetBo, /expectedUpdatedAt: capNhatLuc/g)).toBe(1);
  });
});

describe("[NHH-UI-W3] khối 'Nguồn' trên chi tiết lead", () => {
  const trang = doc("app/(admin)/admin/leads/[id]/page.tsx");

  it("đọc qua MỘT hàm (`docChoGanNguon`), sau cổng sources:view ∧ cờ; không vẽ khi null", () => {
    expect(dem(trang, /\bdocChoGanNguon\(/g)).toBe(1);
    const quyen = trang.indexOf('checkPermission("sources:view")');
    const co = trang.indexOf("laQuanLyNguonBat()");
    const doc1 = trang.indexOf("docChoGanNguon(");
    expect(quyen).toBeGreaterThan(0);
    expect(co).toBeGreaterThan(0);
    expect(quyen).toBeLessThan(doc1);
    expect(co).toBeLessThan(doc1);
    // Điều kiện của phép chọn phải LÀ ĐÚNG `coQuyenXemNguon && nguonBat` (không thêm `|| …`, không bỏ vế nào) và nhánh còn lại là `null`.
    // Neo vào dấu `?` đứng ngay sau điều kiện — chỉ đếm chuỗi con sẽ qua khi ai đó viết `coQuyenXemNguon && nguonBat || true`.
    expect(dem(trang, /const nguonCuaLead =\s*coQuyenXemNguon && nguonBat\s*\?\s*await docChoGanNguon\(/g)).toBe(1);
    expect(dem(trang, /\)\s*:\s*null;\s*const piiLead =/g)).toBe(1);
    // Hai cờ mà `docChoGanNguon` đọc từ trang — PII và hỏi quyền — phải là giá trị THẬT của người xem, không hằng:
    // `canViewPii: true` lộ tên lead cho người thiếu leads:view-pii; `kiemQuyen: async () => true` vẽ nút "Đổi nguồn" cho mọi người.
    const goi = trang.match(/await docChoGanNguon\(\{([\s\S]*?)\n\s*\}\)/);
    expect(goi, "không thấy lời gọi docChoGanNguon").not.toBeNull();
    expect(dem(goi![1]!, /\bcanViewPii,/g)).toBe(1);
    expect(dem(goi![1]!, /kiemQuyen: \(action, target\) => checkPermission\(action, target\),/g)).toBe(1);
    expect(dem(goi![1]!, /\btrue\b/g)).toBe(0);
    expect(dem(trang, /const canViewPii = await canViewLeadPii\(\);/g)).toBe(1);
    expect(dem(trang, /\{nguonCuaLead && <KhoiNguonLead /g)).toBe(1);
  });
});

describe("[NHH-UI-W4] thành phần CLIENT không kéo mã chỉ-máy-chủ vào trình duyệt", () => {
  const CAM = [
    "@/lib/db",
    "@/lib/db-scope",
    "@/lib/auth",
    "@/lib/auth/check-permission",
    "@/lib/nguon/doc-hang-cho",
    "@/lib/nguon/doc-gan-nguon",
    "@/lib/nguon/tim-nguoi-gioi-thieu",
    "@/lib/nguon/bang-nguon-theo-page",
    "@/lib/nguon/nguon-cho-form-nhap",
    "@/lib/nguon/thu-thap-tin-hieu",
    "@/lib/nguon/doi-nguon-lead",
    "@/lib/settings/service",
  ];
  const CLIENT = [
    "components/admin/nguon-hoa-hong/gan-nguon-sheet.tsx",
    "components/admin/nguon-hoa-hong/referrer-picker.tsx",
    "components/admin/nguon-hoa-hong/source-picker.tsx",
    "components/admin/nguon-hoa-hong/chon-nguon-fields.tsx",
    "components/admin/nguon-hoa-hong/bang-page-mapping.tsx",
    "components/admin/nguon-hoa-hong/thong-tin-nguon.tsx",
    "components/lead-intake/quick-lead-form.tsx",
  ];

  /** Các `import … from "x"` KHÔNG phải `import type` (kiểu bị xoá lúc biên dịch nên vô hại). */
  const importGiaTri = (src: string) =>
    [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]!);

  it("lưới quét được tệp (không rỗng) và không tệp client nào import giá trị từ module chỉ-máy-chủ", () => {
    for (const f of CLIENT) {
      const nguon = doc(f);
      expect(nguon.length, f).toBeGreaterThan(500);
      for (const duong of importGiaTri(nguon)) expect(CAM, `${f} import "${duong}"`).not.toContain(duong);
    }
  });

  it("`lib/nguon/chon-nguon.ts` (client đọc) chỉ import các module THUẦN trong danh sách cho phép", () => {
    const src = doc("lib/nguon/chon-nguon.ts");
    const rel = importGiaTri(src).filter((d) => d.startsWith("."));
    // `./danh-muc-goc` chỉ còn `import type` (kiểu MaVaiNguon — xoá khi biên dịch): bảng vai→nhóm đã gỡ nên client không còn nhập GIÁ TRỊ nào từ đó.
    expect(rel.sort()).toEqual(["./doi-nguon", "./hieu-luc-nguon", "./kiem-nguon"]); // hieu-luc-nguon: hàm thuần «chọn được lúc now» (không Zod, không DB)
    expect(importGiaTri(src).filter((d) => !d.startsWith("."))).toEqual([]); // không `@/lib/db`, không `@prisma/client` giá trị
  });

  it("các tệp client có dòng 'use client' ở đầu (thiếu là chạy như Server Component và hook nổ lúc build)", () => {
    for (const f of CLIENT.filter((x) => !x.endsWith("thong-tin-nguon.tsx"))) {
      expect(readFileSync(resolve(GOC, f), "utf8").trimStart().startsWith('"use client"'), f).toBe(true);
    }
    // thong-tin-nguon.tsx cố ý KHÔNG có: nó dùng được ở cả Server lẫn Client Component
    expect(readFileSync(resolve(GOC, "components/admin/nguon-hoa-hong/thong-tin-nguon.tsx"), "utf8")).not.toMatch(/^"use client"/m);
  });
});

describe("[NHH-UI-W5] bảng nguồn của Page chỉ có MỘT đường ghi", () => {
  function duyet(dir: string, ra: string[] = []): string[] {
    for (const ten of readdirSync(dir)) {
      if (ten === "node_modules" || ten.startsWith(".")) continue;
      const p = join(dir, ten);
      if (statSync(p).isDirectory()) duyet(p, ra);
      else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\./.test(ten)) ra.push(p);
    }
    return ra;
  }

  it("khoá `nguon.bangNguonTheoPage` chỉ được ghi trong `lib/nguon/bang-nguon-theo-page.ts` (qua KHOA_NGUON) — không action/script nào tự upsert", () => {
    const tepGhi: string[] = [];
    for (const goc of ["lib", "app", "components", "scripts"]) {
      for (const f of duyet(resolve(GOC, goc))) {
        const s = boChuThich(readFileSync(f, "utf8"));
        if (/bangNguonTheoPage/.test(s) && /systemSetting\.(upsert|update|updateMany|create)\(/.test(s)) tepGhi.push(f.replace(GOC, "").replace(/\\/g, "/").replace(/^\//, ""));
      }
    }
    expect(tepGhi).toEqual(["lib/nguon/bang-nguon-theo-page.ts"]);
  });

  it("đường ghi dùng khoá lạc quan (`updateMany` có `updatedAt`) và AuditLog CÙNG giao dịch", () => {
    const s = doc("lib/nguon/bang-nguon-theo-page.ts");
    expect(dem(s, /systemSetting\.updateMany\(/g)).toBe(1);
    expect(dem(s, /where: \{ key: KEY, updatedAt: hang\.updatedAt \}/g)).toBe(1);
    expect(dem(s, /await writeAudit\(\{\s*tx,/g)).toBe(1);
    expect(dem(s, /clearSettingsCache\(\)/g)).toBe(1);
  });
});

describe("[NHH-UI-W6] ép chọn nguồn ở máy chủ", () => {
  const act = doc("lib/lead/intake/quick-form-action.ts");

  it("Server Action chặn phiếu thiếu `nguonChon` ở cơ sở ép chọn TRƯỚC khi gọi `ingestIntakeLead`", () => {
    const t = than(act, "createInternalLeadAction");
    const chan = t.indexOf("epChonNguonChoMaCoSo(");
    expect(chan).toBeGreaterThan(0);
    expect(chan).toBeLessThan(t.indexOf("ingestIntakeLead("));
    expect(dem(t, /epChonNguonChoMaCoSo\(/g)).toBe(1);
    expect(dem(t, /!parsed\.data\.nguonChon &&/g)).toBe(1);
  });

  it("lựa chọn đi xuống resolver qua `tinHieuNguon.nguonChon` (không đường vòng), và ingest đẩy nó vào `chuanBiQuyNguon`", () => {
    const t = than(act, "createInternalLeadAction");
    expect(dem(t, /tinHieuNguon: \{ \.\.\.KHONG_CO_TIN_HIEU_NGUON, nguonChon: parsed\.data\.nguonChon \}/g)).toBe(1);
    const ingest = doc("lib/lead/intake/ingest.ts");
    expect(dem(ingest, /nguonChon: ctx\.tinHieuNguon\.nguonChon,/g)).toBe(1);
  });

  it("lỗi của lựa chọn CHẶN đường nhập bất kể cờ ép chọn (`loiChon ??` đứng đầu `chanNhap`)", () => {
    const nd = doc("lib/nguon/noi-day.ts");
    expect(dem(nd, /const loiChon = thu\.tin\[i\]!\.nguonChon\?\.loi \?\? null;/g)).toBe(1);
    expect(dem(nd, /loiChon \?\?\s*\(/g)).toBe(1);
  });

  it("trang và action cùng hỏi MỘT nguồn cờ ép chọn (nguon-cho-form-nhap) — trang không tự gọi `laEpChonNguon`", () => {
    const trang = doc("app/(admin)/admin/nhap-khach-hang/page.tsx");
    expect(dem(trang, /loadNguonChoFormNhap\(centers, new Date\(\)\)/g)).toBe(1);
    expect(dem(trang, /laEpChonNguon/g)).toBe(0);
    const form = doc("lib/nguon/nguon-cho-form-nhap.ts");
    expect(dem(form, /epChonNguonChoMaCoSo\(c\.code\)/g)).toBe(1); // trang dùng đúng hàm mà action dùng
  });
});

describe("[NHH-UI-W7] hàng chờ nguồn mở Sheet", () => {
  it("HangChoBang dựng nút mở Sheet cho mỗi dòng và không còn liên kết thẳng /leads/<id> ở ô tên", () => {
    const b = doc("app/(admin)/admin/nguon-hoa-hong/nguon/_components/hang-cho-bang.tsx");
    expect(dem(b, /<GanNguonSheet\b/g)).toBe(1);
    expect(dem(b, /href=\{`\/leads\//g)).toBe(0);
    expect(dem(b, /coTheMoLead=\{coTheMoLead\}/g)).toBe(1);
  });
});

describe("[NHH-UI-W8] cơ sở đang chọn sống sót qua chế độ 'Page mapping'", () => {
  it("MỌI <QueueToggle> của trang Nguồn đều nhận `giu={{ coSo: coSoId }}` (3 lời gọi: hàng chờ · tất cả · Page mapping) — thiếu một cái là bấm quay lại bị đẩy về 'Tất cả cơ sở'", () => {
    // Cấy bỏ `giu` ở nhánh page-mapping: không ca hành vi nào đỏ (QueueToggle tự đúng; lỗi nằm ở chỗ GỌI nó).
    const p = doc("app/(admin)/admin/nguon-hoa-hong/nguon/page.tsx");
    expect(dem(p, /<QueueToggle\b/g)).toBe(3);
    expect(dem(p, /<QueueToggle\b[^>]*giu=\{\{ coSo: coSoId \}\}/g)).toBe(3);
  });
});
