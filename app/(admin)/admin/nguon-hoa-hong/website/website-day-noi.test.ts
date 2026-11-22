// @vitest-environment node
/**
 * [WWN-*] — LƯỚI GHIM MÃ NGUỒN cho DÂY NỐI của tab Website (AFF-P0b): thứ test hành vi KHÔNG chạm tới (action là "use server" kéo next-auth + Prisma; page là Server Component).
 * Đọc mã ĐÃ BỎ CHÚ THÍCH; neo hẹp; ĐẾM số lần khớp; không cờ `/s` (luật 11). Mỗi ca đã được CẤY lại lỗi để thấy nó đỏ (báo cáo đợt).
 *
 *   [WWN-01] mọi Server Action gác quyền `affiliate_campaigns:manage` Ở ĐẦU HÀM (trước mọi await khác ngoài auth) rồi mới kiểm cờ; khoá có thật và có vai giữ
 *   [WWN-02] nút ghi vẽ bằng ĐÚNG khoá + cờ mà action kiểm (luật 12) — một khoá, hai nơi
 *   [WWN-03] thành phần CLIENT không kéo mã chỉ-máy-chủ (db · auth · hàm ghi/đọc DB) vào trình duyệt
 *   [WWN-04] hàm ghi: khoá hàng + so mốc lạc quan bằng getTime() ở MỌI đường sửa; audit cùng transaction ở MỌI đường ghi; không xoá cứng ngoài website trống
 *   [WWN-05] thứ tự khoá chung với ghi-campaign: campaign TRƯỚC website
 *   [WWN-06] hàm thuần dùng chung: chỉ MỘT nơi định nghĩa phép so tên miền/đường dẫn — page, form, Sheet và hàm ghi đều gọi nó, không ai chép lại
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_ACTIONS } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../../../../prisma/seed-roles";

const GOC = process.cwd();
const KHOA_GHI = "affiliate_campaigns:manage";

/**
 * Bỏ chú thích dòng TRƯỚC, khối SAU — và khối CHỈ khi nó mở ở ĐẦU DÒNG (sau khoảng trắng): giao diện của tab này có chuỗi `"/khoa-hoc/*"` và chữ `/*` trong văn bản JSX, mà bộ bỏ khối
 * kiểu `/\*…\*\/` thấy `/*` đó là mở một "chú thích" và NUỐT mã thật tới tận một `*\/` ở xa (đã đo: nuốt mất cả nhánh `{coTheGhi && (` của Sheet làm lưới đếm ra 0 và đỏ oan).
 */
function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/(^|\n)[ \t]*\/\*[\s\S]*?\*\//g, "$1");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

function duyet(dir: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) duyet(p, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\./.test(ten)) ra.push(p);
  }
  return ra;
}

/** Thân hàm `export async function <ten>(...) { ... }` — đếm ngoặc, chịu được `{}` trong kiểu tham số. */
function thanHam(src: string, ten: string): string {
  const bat = src.indexOf(`export async function ${ten}(`);
  expect(bat, `không thấy hàm ${ten}`).toBeGreaterThanOrEqual(0);
  let i = src.indexOf("(", bat);
  let sau = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") sau++;
    else if (src[i] === ")" && --sau === 0) break;
  }
  const mo = src.indexOf("{", i);
  let d = 0;
  for (let j = mo; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}" && --d === 0) return src.slice(mo + 1, j);
  }
  throw new Error(`không đóng được ngoặc của ${ten}`);
}

const ACTIONS = doc("app/(admin)/admin/nguon-hoa-hong/website/_actions.ts");
const TEN_ACTION = ["taoWebsiteAction", "suaWebsiteAction", "doiTrangThaiWebsiteAction", "xoaWebsiteAction", "themTrangDichAction", "suaTrangDichAction", "batTatTrangDichAction"] as const;

describe("[WWN-01] Server Action gác quyền Ở ĐẦU HÀM", () => {
  it("tệp có đúng 7 `export async function` — action MỚI thêm vào mà quên cổng ⇒ đỏ ở đây", () => {
    const ten = [...ACTIONS.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    expect(ten.sort()).toEqual([...TEN_ACTION].sort());
  });

  it.each(TEN_ACTION)("%s: auth() → checkPermission(khoá ghi) đứng TRƯỚC mọi await khác, rồi zod, rồi cờ, rồi hàm ghi", (ten) => {
    const t = thanHam(ACTIONS, ten);
    const iAuth = t.search(/await\s+auth\s*\(\s*\)/);
    const iCong = t.search(new RegExp(`await\\s+checkPermission\\(\\s*"${KHOA_GHI}"\\s*\\)`));
    expect(iAuth, "thiếu await auth()").toBeGreaterThanOrEqual(0);
    expect(iCong, "thiếu cổng quyền").toBeGreaterThan(iAuth);
    // `await` đầu tiên KHÔNG phải của auth / cổng quyền phải đứng SAU cổng quyền.
    const re = /\bawait\s+([A-Za-z_$][\w$.]*)/g;
    let dauKhac = -1;
    for (let x = re.exec(t); x; x = re.exec(t)) {
      if (x[1] === "auth" || x[1] === "checkPermission") continue;
      dauKhac = x.index;
      break;
    }
    expect(dauKhac, "có await khác chạy trước cổng quyền").toBeGreaterThan(iCong);
    // zod trước cờ, cờ trước hàm ghi
    const iZod = t.search(/\.safeParse\(/);
    const iCo = t.search(/\(await\s+docCoModule\(\)\)\.affiliate/);
    const iGhi = t.search(/await\s+(?:tao|sua|doiTrangThai|xoa|them|batTat)\w*\(\s*\{/);
    expect(iZod, "thiếu zod").toBeGreaterThan(iCong);
    expect(iCo, "thiếu kiểm cờ").toBeGreaterThan(iZod);
    expect(iGhi, "thiếu lời gọi hàm ghi").toBeGreaterThan(iCo);
    // chỉ MỘT khoá quyền trong hàm
    expect(dem(t, /checkPermission\(/g)).toBe(1);
  });

  it("khoá quyền có THẬT (∈ ALL_ACTIONS) và có ít nhất một vai giữ — gõ sai chính tả không ném lỗi, chỉ trả false cho mọi người (luật 11)", () => {
    expect((ALL_ACTIONS as readonly string[]).includes(KHOA_GHI)).toBe(true);
    const vai = ROLE_SEED.filter((r) => r.perms.some((p) => p.action === KHOA_GHI)).map((r) => r.code);
    expect(vai.length).toBeGreaterThan(0);
  });

  it("tệp chỉ export hàm async (file 'use server' mà export hằng/đối tượng là lỗi biên dịch của Next)", () => {
    expect(dem(ACTIONS, /^export\s+(?!async function)(?!type\b)(?!interface\b)/gm)).toBe(0);
    expect(readFileSync(resolve(GOC, "app/(admin)/admin/nguon-hoa-hong/website/_actions.ts"), "utf8").startsWith('"use server"')).toBe(true);
  });
});

describe("[WWN-02] nút ghi vẽ bằng ĐÚNG khoá + cờ mà action kiểm", () => {
  const page = doc("app/(admin)/admin/nguon-hoa-hong/website/page.tsx");

  it(`page tính quyền ghi MỘT lần: scope.has("${KHOA_GHI}") ∧ scope.co.affiliate — cùng khoá + cờ với action`, () => {
    expect(dem(page, new RegExp(`scope\\.has\\(\\s*"${KHOA_GHI}"\\s*\\)\\s*&&\\s*scope\\.co\\.affiliate`, "g"))).toBe(1);
    expect(dem(page, /\bscope\.has\(/g)).toBe(1); // không khoá nào khác dùng để vẽ nút
    expect(dem(page, /checkPermission|assertCan/g)).toBe(0); // quyền hỏi qua scope (một lần), không rải
  });

  it("`coTheGhi` đi xuống bảng và nút «Thêm website»; không ai truyền hằng true/false", () => {
    expect(dem(page, /<BangWebsite\b[^>]*\bcoTheGhi=\{coTheGhi\}/g)).toBe(1);
    expect(dem(page, /actions=\{coTheGhi \?/g)).toBe(1);
    expect(dem(page, /coTheGhi=\{\s*(?:true|false)\s*\}/g)).toBe(0);
  });

  it("hai truy vấn của page (pill hàng chờ · danh sách website) chạy SONG SONG trong một Promise.all (không nối đuôi)", () => {
    expect(dem(page, /await\s+Promise\.all\(\[\s*docSoHangChoTheoTab\(actor,\s*scope\),\s*docWebsite\(\)\s*\]\)/g)).toBe(1);
    expect(dem(page, /\bawait\b/g)).toBe(2); // vaoTab + Promise.all
  });

  it("bảng chỉ vẽ cột Thao tác và nút ghi sau cổng `coTheGhi`; hộp thoại ghi cũng sau cổng đó", () => {
    const bang = doc("components/admin/nguon-hoa-hong/website/bang-website.tsx");
    expect(dem(bang, /\{coTheGhi && \(\s*<th/g)).toBe(1);
    expect(dem(bang, /\{coTheGhi && \(\s*<td/g)).toBe(1);
    // Sheet sửa + 3 hộp thoại ghi: đều nằm sau `coTheGhi &&`
    expect(dem(bang, /hd && dongDangChon && coTheGhi && hd\.loai ===/g)).toBe(4);
    // Sheet trang đích mở được không cần quyền ghi (xem + thử địa chỉ)
    expect(dem(bang, /hd && dongDangChon && hd\.loai === "trang-dich"/g)).toBe(1);
  });

  it("Sheet trang đích: form thêm + nút sửa/bật-tắt đều sau `coTheGhi`; «Thử một địa chỉ» không", () => {
    const sheet = doc("components/admin/nguon-hoa-hong/website/trang-dich-sheet.tsx");
    expect(dem(sheet, /\{coTheGhi && \(\s*<form/g)).toBe(1);
    expect(dem(sheet, /\{coTheGhi && \(\s*<span/g)).toBe(1);
    expect(dem(sheet, /suaId === t\.id && coTheGhi/g)).toBe(1);
    expect(dem(sheet, /<ThuUrl\b/g)).toBe(1);
  });
});

describe("[WWN-03] thành phần CLIENT không kéo mã chỉ-máy-chủ", () => {
  const CLIENT = duyet(resolve(GOC, "components/admin/nguon-hoa-hong/website"));

  it("lưới quét được cây (không rỗng)", () => {
    expect(CLIENT.length).toBeGreaterThanOrEqual(6);
  });

  it("không import db / scopedDb / auth / hàm ghi / hàm đọc DB ở dạng GIÁ TRỊ (chỉ `import type`)", () => {
    for (const f of CLIENT) {
      const s = boChuThich(readFileSync(f, "utf8"));
      expect(dem(s, /from\s+"@\/lib\/db(?:-scope)?"/g), `${f}: db`).toBe(0);
      expect(dem(s, /from\s+"@\/lib\/auth"/g), `${f}: auth`).toBe(0);
      expect(dem(s, /^import\s+\{[^}]*\}\s+from\s+"@\/lib\/affiliate\/(?:ghi-website|doc-website)"/gm), `${f}: hàm ghi/đọc DB ở dạng giá trị`).toBe(0);
      expect(dem(s, /^import\s+type\s+\{[^}]*\}\s+from\s+"@\/lib\/affiliate\/(?:ghi-website|doc-website)"/gm) >= 0).toBe(true);
    }
  });

  it("[tự kiểm] bộ dò THẤY một import giá trị hàm ghi và KHÔNG tính import type", () => {
    const re = /^import\s+\{[^}]*\}\s+from\s+"@\/lib\/affiliate\/(?:ghi-website|doc-website)"/gm;
    expect(dem('import { taoWebsite } from "@/lib/affiliate/ghi-website";', re)).toBe(1);
    expect(dem('import type { KetQuaTaoWebsite } from "@/lib/affiliate/ghi-website";', re)).toBe(0);
    expect(dem('import { LY_DO_TOI_THIEU_WEBSITE } from "@/lib/affiliate/ghi-website-dau-vao";', re)).toBe(0);
  });

  it("page KHÔNG import @/lib/db trần (ESLint cấm trong app/(admin)); đọc DB đi qua doc-website", () => {
    const page = doc("app/(admin)/admin/nguon-hoa-hong/website/page.tsx");
    expect(dem(page, /@\/lib\/db/g)).toBe(0);
    expect(dem(page, /\bdocWebsite\(/g)).toBe(1);
  });
});

describe("[WWN-04] hàm ghi: khoá hàng, mốc lạc quan, audit cùng transaction, không xoá cứng bừa", () => {
  const ghi = doc("lib/affiliate/ghi-website.ts");

  it("bảy đường ghi — bảy lời gọi writeAudit, MỌI lời gọi mang `tx,` (cùng transaction)", () => {
    expect(dem(ghi, /await writeAudit\(\{/g)).toBe(7);
    expect(dem(ghi, /await writeAudit\(\{\s*tx,/g)).toBe(7);
  });

  it("mọi đường SỬA/ĐỔI/XOÁ so mốc lạc quan bằng getTime() trong JS (5: website sửa · trạng thái · xoá, trang đích sửa · bật/tắt)", () => {
    expect(dem(ghi, /\.updatedAt\.getTime\(\) !== p\.updatedAtDaThay\.getTime\(\)/g)).toBe(5);
  });

  it("KHÔNG dùng `updateMany({ where: { updatedAt } })` làm khoá lạc quan (micro/mili-giây lệch ⇒ không bao giờ khớp)", () => {
    expect(dem(ghi, /updateMany\(/g)).toBe(0);
    expect(dem(ghi, /where:\s*\{[^}]*updatedAt/g)).toBe(0);
  });

  it("khoá hàng: website `FOR UPDATE` (1 hàm dùng chung cho 3 đường), trang đích `FOR UPDATE` (2), trang đích thêm `FOR SHARE` website", () => {
    expect(dem(ghi, /"AffiliateSite" WHERE "id" = \$\{id\} FOR UPDATE/g)).toBe(1);
    expect(dem(ghi, /await khoaWebsite\(tx,/g)).toBe(3);
    expect(dem(ghi, /"AffiliateLandingPage" WHERE "id" = \$\{p\.id\} FOR UPDATE/g)).toBe(2);
    expect(dem(ghi, /"AffiliateSite" WHERE "id" = \$\{v\.siteId\} FOR SHARE/g)).toBe(1);
  });

  it("xoá cứng CHỈ có một chỗ (website) và đứng sau cổng kiemXoaWebsite; KHÔNG có lệnh xoá trang đích hay campaign", () => {
    expect(dem(ghi, /\.delete(?:Many)?\(/g)).toBe(1);
    expect(dem(ghi, /affiliateSite\.delete\(/g)).toBe(1);
    expect(dem(ghi, /affiliateLandingPage\.delete/g)).toBe(0);
    expect(dem(ghi, /affiliateCampaign\w*\.delete/g)).toBe(0);
    const t = thanHam(ghi, "xoaWebsite");
    expect(t.indexOf("kiemXoaWebsite(")).toBeGreaterThan(0);
    expect(t.indexOf("affiliateSite.delete(")).toBeGreaterThan(t.indexOf("kiemXoaWebsite("));
    // đếm trang đích + campaign SAU khoá hàng
    expect(t.indexOf("khoaWebsite(")).toBeLessThan(t.indexOf("affiliateLandingPage.count("));
    expect(t.indexOf("khoaWebsite(")).toBeLessThan(t.indexOf("affiliateCampaignSite.count("));
  });

  it("từ chối TRONG transaction là `throw`, không `return {ok:false}` sau phép ghi: không có `return { ok: false` nào trong callback $transaction", () => {
    // Mọi callback đều dùng throw LoiGhiAffiliate; `return { ok: false` chỉ được xuất hiện ở NGOÀI transaction (kiểm đầu vào / pre-check).
    for (const ten of ["taoWebsite", "suaWebsite", "doiTrangThaiWebsite", "xoaWebsite", "themTrangDich", "suaTrangDich", "batTatTrangDich"]) {
      const t = thanHam(ghi, ten);
      const iTx = t.indexOf("$transaction(");
      expect(iTx, `${ten}: có $transaction`).toBeGreaterThan(0);
      const trongTx = t.slice(iTx, t.indexOf("} catch", iTx) > 0 ? t.indexOf("} catch", iTx) : undefined);
      expect(dem(trongTx, /return\s*\{\s*ok:\s*false/g), `${ten}: return {ok:false} trong transaction`).toBe(0);
    }
  });

  it("host của gốc URL ∈ tên miền được phép kiểm LẠI trong transaction (tạo: chuanHoaNoiDungWebsite gọi 2 lần — ngoài cho phản hồi sớm, trong cho bản ghi thật; sửa: kiemSuaWebsite trong transaction)", () => {
    const tao = thanHam(ghi, "taoWebsite");
    expect(dem(tao, /chuanHoaNoiDungWebsite\(/g)).toBe(2);
    expect(tao.indexOf("chuanHoaNoiDungWebsite(", tao.indexOf("$transaction("))).toBeGreaterThan(tao.indexOf("$transaction("));
    expect(tao.indexOf("chuanHoaNoiDungWebsite(", tao.indexOf("$transaction("))).toBeLessThan(tao.indexOf("affiliateSite.create("));
    const sua = thanHam(ghi, "suaWebsite");
    expect(sua.indexOf("kiemSuaWebsite(")).toBeGreaterThan(sua.indexOf("$transaction("));
    expect(sua.indexOf("kiemSuaWebsite(")).toBeLessThan(sua.indexOf("affiliateSite.update("));
  });
});

describe("[WWN-05] thứ tự khoá chung với ghi-campaign: campaign TRƯỚC website", () => {
  const ghi = doc("lib/affiliate/ghi-website.ts");

  it("suaWebsite: khoaCampaignChia đứng TRƯỚC khoaWebsite; taoWebsite khoá campaign trước khi tạo website; không hàm nào khoá website rồi mới khoá campaign", () => {
    const sua = thanHam(ghi, "suaWebsite");
    expect(sua.indexOf("khoaCampaignChia(")).toBeGreaterThan(0);
    expect(sua.indexOf("khoaCampaignChia(")).toBeLessThan(sua.indexOf("khoaWebsite("));
    const tao = thanHam(ghi, "taoWebsite");
    expect(tao.indexOf("khoaCampaignChia(")).toBeLessThan(tao.indexOf("affiliateSite.create("));
    for (const ten of ["doiTrangThaiWebsite", "xoaWebsite"]) expect(dem(thanHam(ghi, ten), /khoaCampaignChia\(/g), ten).toBe(0);
    // khoá campaign là FOR SHARE (campaign thật sự đổi thì ghi-campaign khoá FOR UPDATE và chờ)
    expect(dem(ghi, /"AffiliateCampaign" WHERE "id" = \$\{id\} FOR SHARE/g)).toBe(1);
  });
});

describe("[WWN-06] một nơi định nghĩa phép so tên miền / đường dẫn", () => {
  const files = [
    "lib/affiliate/ghi-website-dau-vao.ts",
    "components/admin/nguon-hoa-hong/website/o-ten-mien.tsx",
    "components/admin/nguon-hoa-hong/website/thu-url.tsx",
    "components/admin/nguon-hoa-hong/website/trang-dich-sheet.tsx",
    "components/admin/nguon-hoa-hong/website/form-website.tsx",
  ];

  it("không tệp nào tự viết phép so host (endsWith/includes trên tên miền) hay tự bóc URL bằng regex — chỉ gọi website-hop-le", () => {
    for (const f of files) {
      const s = doc(f);
      expect(dem(s, /\.endsWith\(\s*["'`]\./g), `${f}: endsWith(".…") trên tên miền`).toBe(0);
      expect(dem(s, /new URL\(/g), `${f}: tự phân tích URL`).toBe(0);
      expect(dem(s, /\.hostname\b/g), `${f}: tự đọc host`).toBe(0);
    }
  });

  it("ThuUrl gọi ĐÚNG kiemUrlDuocPhep (hàm mà P1 gọi) và hiển thị nhãn lý do từ NHAN_LY_DO của nó", () => {
    const s = doc("components/admin/nguon-hoa-hong/website/thu-url.tsx");
    expect(dem(s, /\bkiemUrlDuocPhep\(/g)).toBe(1);
    expect(dem(s, /NHAN_LY_DO\[kq\.lyDo\]/g)).toBe(1);
  });

  it("form + hàm ghi cùng gọi chuanHoaNoiDungWebsite; Sheet + hàm ghi cùng gọi kiemMauTrangDich", () => {
    expect(dem(doc("components/admin/nguon-hoa-hong/website/form-website.tsx"), /\bchuanHoaNoiDungWebsite\(/g)).toBe(1);
    expect(dem(doc("components/admin/nguon-hoa-hong/website/trang-dich-sheet.tsx"), /\bkiemMauTrangDich\(/g)).toBe(2);
    expect(dem(doc("lib/affiliate/ghi-website.ts"), /\bkiemMauTrangDich\(/g)).toBe(2);
  });
});
