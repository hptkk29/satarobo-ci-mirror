// @vitest-environment node
/**
 * [AFC-W1..W9] — LƯỚI GHIM MÃ NGUỒN cho dây nối của tab CAMPAIGN AFFILIATE (AFF-P0b).
 *
 * Cổng mà test hành vi KHÔNG chạm tới (page là Server Component kéo next-auth + Prisma; hàm ghi chạm DB nên test thuần không thấy thứ tự khoá) ⇒ ghim bằng văn bản mã nguồn ĐÃ BỎ CHÚ THÍCH.
 * Luật 11: neo hẹp, ĐẾM SỐ LẦN khớp, không cờ `/s`. Luật 14: mỗi ca ĐÃ được cấy lại lỗi để thấy nó đỏ (bảng phép cấy ở báo cáo của đợt).
 *
 *   [AFC-W1] bốn page của tab: vaoTab("campaign") đúng 1 lần · PAGE_GATES đúng 1 lần · khối ThieuQuyen nguyên vẹn, không bị vô hiệu bằng hằng
 *   [AFC-W2] chi tiết / sửa: mã trên URL qua giaiMaTrenUrl (hỏng ⇒ 404), không có campaign ⇒ notFound
 *   [AFC-W3] NÚT = KHOÁ: chi tiết vẽ nút bằng scope.has(khoá) ĐÚNG khoá mà action kiểm; kích hoạt chỉ khi `activate`
 *   [AFC-W4] action: mỗi hàm `auth()` → `checkPermission(khoá)` → zod → cờ → hàm ghi, đúng thứ tự, và đúng bảng khoá
 *   [AFC-W5] file "use server" chỉ export hàm async
 *   [AFC-W6] hàm ghi: mọi lệnh ghi con khoá CAMPAIGN trước; kích hoạt kiểm điều kiện TRONG transaction, sau khoá; tạo không khoá
 *   [AFC-W7] một nguồn cho điều kiện kích hoạt / cho xem trước nguồn (không bản chép tay thứ hai)
 *   [AFC-W8] thành phần client không kéo mã máy chủ (db · hàm đọc · hàm ghi) vào trình duyệt
 *   [AFC-W9] xem trước nguồn: không chữ "Không rõ" / UNKNOWN trên màn; không useEffect cho dữ liệu
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();
const APP = "app/(admin)/admin/nguon-hoa-hong/campaign";

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

const CAC_PAGE = [`${APP}/page.tsx`, `${APP}/tao/page.tsx`, `${APP}/[maCampaign]/page.tsx`, `${APP}/[maCampaign]/sua/page.tsx`];

describe("[AFC-W1] bốn page của tab vào cổng đúng", () => {
  it("quét được đủ 4 page và mỗi route có loading.tsx", () => {
    expect(CAC_PAGE).toHaveLength(4);
    for (const p of CAC_PAGE) {
      expect(existsSync(resolve(GOC, p)), p).toBe(true);
      expect(existsSync(resolve(GOC, p.replace("page.tsx", "loading.tsx"))), `${p} thiếu loading.tsx`).toBe(true);
    }
  });

  for (const p of CAC_PAGE) {
    it(`${p.slice(APP.length + 1)}: vaoTab("campaign") đúng 1 lần, PAGE_GATES["/nguon-hoa-hong/campaign"] đúng 1 lần, khối ThieuQuyen nguyên vẹn, không điều kiện bị vô hiệu`, () => {
      const src = doc(p);
      expect(dem(src, /\bvaoTab\(\s*"campaign"\s*\)/g), "vaoTab('campaign')").toBe(1);
      expect(dem(src, /\bvaoTab\(/g), "tổng số lời gọi vaoTab").toBe(1);
      expect(dem(src, /PAGE_GATES\[\s*"\/nguon-hoa-hong\/campaign"\s*\]/g), "gate của chính tab").toBe(1);
      expect([...src.matchAll(/PAGE_GATES\[\s*"([^"]+)"\s*\]/g)].map((m) => m[1]).filter((h) => h !== "/nguon-hoa-hong/campaign"), "gate của route khác").toEqual([]);
      expect(dem(src, /if\s*\(\s*!\s*scope\.any\(\s*PAGE_GATES\[\s*"\/nguon-hoa-hong\/campaign"\s*\]\s*\)\s*\)\s*\{\s*return\s*<ThieuQuyen\s+tab="campaign"/g)).toBe(1);
      expect(dem(src, /\bfalse\s*&&|\|\|\s*true\b/g), "điều kiện bị vô hiệu bằng hằng").toBe(0);
      expect(dem(src, /redirect\(\s*["'`]\/login/g), "redirect login trong page (đã có vaoTab)").toBe(0);
    });
  }
});

describe("[AFC-W2] mã trên URL & campaign lạ", () => {
  for (const p of [`${APP}/[maCampaign]/page.tsx`, `${APP}/[maCampaign]/sua/page.tsx`]) {
    it(`${p.slice(APP.length + 1)}: giải mã bằng giaiMaTrenUrl (null ⇒ notFound), KHÔNG decodeURIComponent trần; không có campaign ⇒ notFound`, () => {
      const src = doc(p);
      expect(dem(src, /\bdecodeURIComponent\(/g)).toBe(0);
      expect(dem(src, /\bgiaiMaTrenUrl\(\s*maCampaign\s*\)/g)).toBe(1);
      expect(dem(src, /if\s*\(\s*ma\s*===\s*null\s*\)\s*notFound\(\);/g)).toBe(1);
      expect(dem(src, /if\s*\(\s*!\s*campaign\s*\)\s*notFound\(\);/g)).toBe(1);
      expect(dem(src, /\bdocChiTietCampaign\(\s*ma\s*,\s*now\s*\)/g), "hàm đọc nhận mã ĐÃ giải mã + now").toBe(1);
    });
  }
});

describe("[AFC-W3] nút vẽ = khoá mà action kiểm", () => {
  const chiTiet = doc(`${APP}/[maCampaign]/page.tsx`);
  const danhSach = doc(`${APP}/page.tsx`);

  it("chi tiết: BA cờ quyền, mỗi cái một khoá, hỏi bằng scope.has đúng 1 lần", () => {
    expect(dem(chiTiet, /const coTheSoan = scope\.has\("affiliate_campaigns:manage"\);/g)).toBe(1);
    expect(dem(chiTiet, /const coTheKichHoat = scope\.has\("affiliate_campaigns:activate"\);/g)).toBe(1);
    expect(dem(chiTiet, /const coTheThanhVien = scope\.has\("affiliate_memberships:manage"\);/g)).toBe(1);
    // AFF-L1 thêm HAI khoá của mục Hoa hồng (đúng khoá của action/đường vào tương ứng — xem `hoa-hong-day-noi.test.ts` [AFL1-W1]).
    expect(dem(chiTiet, /const xemChinhSach = scope\.has\("commission_policies:view"\);/g)).toBe(1);
    expect(dem(chiTiet, /soanChinhSach: scope\.has\("commission_policies:manage"\) && scope\.co\.engine/g)).toBe(1);
    expect(dem(chiTiet, /\bscope\.has\(/g), "không scope.has nào khác").toBe(5);
  });

  it("nút Kích hoạt / Tạm dừng / Kết thúc chỉ vẽ khi `coTheKichHoat`; liên kết Sửa chỉ khi `coTheSoan` ∧ chưa ENDED", () => {
    expect(dem(chiTiet, /\{coTheKichHoat && \(\s*<NutDoiTrangThaiCampaign\b/g)).toBe(1);
    expect(dem(chiTiet, /\{coTheSoan && campaign\.status !== "ENDED" && \(\s*<Link href=\{`\$\{goc\}\/sua`\}/g)).toBe(1);
    expect(dem(chiTiet, /<NutDoiTrangThaiCampaign\b/g)).toBe(1);
  });

  it("khối con nhận cờ quyền bằng BIẾN, không hằng", () => {
    expect(dem(chiTiet, /coTheGhi=\{coTheSoan\}/g), "quy tắc + website").toBe(2);
    expect(dem(chiTiet, /coTheGhi=\{coTheThanhVien\}/g), "bảng thành viên").toBe(1);
    expect(dem(chiTiet, /\bcoTheGhi=\{\s*(true|false)\s*\}/g)).toBe(0);
    expect(dem(chiTiet, /\{coTheThanhVien && campaign\.status !== "ENDED" && <ThemMembership\b/g)).toBe(1);
    expect(dem(chiTiet, /chanKichHoat=\{campaign\.chanKichHoat\}/g), "nút kích hoạt nhận điều kiện thiếu").toBe(1);
  });

  it("danh sách: nút «Tạo campaign» theo scope.has('affiliate_campaigns:manage')", () => {
    expect(dem(danhSach, /const coTheTao = scope\.has\("affiliate_campaigns:manage"\);/g)).toBe(1);
    expect(dem(danhSach, /\bscope\.has\(/g)).toBe(1);
  });

  it("trang tạo / sửa: người thiếu `affiliate_campaigns:manage` thấy NoPermission nêu đúng khoá, không thấy form", () => {
    for (const p of [`${APP}/tao/page.tsx`, `${APP}/[maCampaign]/sua/page.tsx`]) {
      const src = doc(p);
      expect(dem(src, /if\s*\(\s*!\s*scope\.has\("affiliate_campaigns:manage"\)\s*\)\s*\{\s*return\s*\(/g), p).toBe(1);
      expect(dem(src, /permission="affiliate_campaigns:manage"/g), p).toBe(1);
    }
  });
});

describe("[AFC-W4] action: thứ tự cổng và bảng khoá", () => {
  const src = doc(`${APP}/_actions.ts`);
  const BANG: [string, string][] = [
    ["taoCampaignAction", "affiliate_campaigns:manage"],
    ["suaCampaignAction", "affiliate_campaigns:manage"],
    ["doiTrangThaiCampaignAction", "affiliate_campaigns:activate"],
    ["datCheDoThuongAction", "affiliate_campaigns:manage"],
    ["themQuyTacAction", "affiliate_campaigns:manage"],
    ["xoaQuyTacAction", "affiliate_campaigns:manage"],
    ["ganWebsiteAction", "affiliate_campaigns:manage"],
    ["goWebsiteAction", "affiliate_campaigns:manage"],
    ["datTrangDichCampaignAction", "affiliate_campaigns:manage"],
    ["themMembershipAction", "affiliate_memberships:manage"],
    ["doiTrangThaiMembershipAction", "affiliate_memberships:manage"],
    ["suaMembershipAction", "affiliate_memberships:manage"],
  ];

  it("đủ 12 action (AFF-L1 thêm `datCheDoThuongAction`, AFF-L6 thêm `datTrangDichCampaignAction`), và tổng số lời gọi checkPermission đúng 12 (mỗi action đúng một)", () => {
    expect(dem(src, /export async function \w+Action\(/g)).toBe(12);
    expect(dem(src, /\bcheckPermission\(/g)).toBe(12);
  });

  for (const [ten, khoa] of BANG) {
    it(`${ten}: auth() → checkPermission("${khoa}") → safeParse → moduleBat() → hàm ghi, theo đúng thứ tự, khoá không lẫn`, () => {
      const t = than(src, ten);
      const iAuth = t.indexOf("await auth()");
      const iQuyen = t.search(new RegExp(`checkPermission\\("${khoa.replace(":", ":")}"\\)`));
      const iZod = t.indexOf(".safeParse(");
      const iCo = t.indexOf("await moduleBat()");
      const iGhi = t.search(/\bawait (taoCampaign|suaCampaign|doiTrangThaiCampaign|datCheDoThuong|datTrangDichCampaign|themQuyTac|xoaQuyTac|ganWebsite|goWebsite|themMembership|doiTrangThaiMembership|suaMembership)\(/);
      expect(iAuth, "auth").toBeGreaterThanOrEqual(0);
      expect(iQuyen, "checkPermission đúng khoá").toBeGreaterThan(iAuth);
      expect(iZod, "zod sau quyền").toBeGreaterThan(iQuyen);
      expect(iCo, "cờ sau zod").toBeGreaterThan(iZod);
      expect(iGhi, "hàm ghi sau cờ").toBeGreaterThan(iCo);
      expect(dem(t, /checkPermission\(/g)).toBe(1);
      const khoaKhac = [...t.matchAll(/checkPermission\("([^"]+)"\)/g)].map((m) => m[1]).filter((k) => k !== khoa);
      expect(khoaKhac, "khoá lạ trong action").toEqual([]);
    });
  }

  it("cờ đọc bằng docCoModule().affiliate, hỏng ⇒ tắt (try/catch trả false)", () => {
    expect(dem(src, /\(await docCoModule\(\)\)\.affiliate/g)).toBe(1);
    expect(dem(src, /\bdocCoModule\(/g)).toBe(1);
    expect(dem(src, /catch\s*\{\s*return false;/g)).toBe(1);
  });
});

describe("[AFC-W5] file 'use server' chỉ export hàm async", () => {
  it("mọi `export` trong _actions.ts là `export async function`", () => {
    const raw = readFileSync(resolve(GOC, `${APP}/_actions.ts`), "utf8");
    expect(raw.startsWith('"use server";')).toBe(true);
    const src = boChuThich(raw);
    const moi = dem(src, /^export\s/gm);
    expect(moi).toBeGreaterThan(0);
    expect(dem(src, /^export async function \w+\(/gm)).toBe(moi);
  });
});

describe("[AFC-W6] hàm ghi: thứ tự khoá", () => {
  const camp = doc("lib/affiliate/ghi-campaign.ts");
  const mem = doc("lib/affiliate/ghi-membership.ts");

  it("khoá campaign bằng FOR UPDATE ở MỘT nơi; nguồn / website khoá FOR SHARE", () => {
    expect(dem(camp, /FOR UPDATE/g)).toBe(1);
    expect(dem(camp, /FOR SHARE/g)).toBe(2);
    expect(dem(mem, /FOR UPDATE/g), "membership khoá hàng của chính nó").toBe(1);
    expect(dem(mem, /"AffiliateMembership" WHERE/g)).toBe(1);
  });

  it("MỌI hàm ghi CON của campaign khoá campaign TRƯỚC: ghi-campaign 8 lời gọi (AFF-L1 thêm `datCheDoThuong`, AFF-L6 thêm `datTrangDichCampaign`), ghi-membership 3; `taoCampaign` thì không (chưa có hàng để khoá)", () => {
    expect(dem(camp, /\bkhoaCampaignTrongTx\(tx,/g)).toBe(8);
    expect(dem(mem, /\bkhoaCampaignTrongTx\(tx,/g)).toBe(3);
    expect(dem(than(camp, "taoCampaign"), /khoaCampaignTrongTx/g)).toBe(0);
    for (const ten of ["suaCampaign", "doiTrangThaiCampaign", "datCheDoThuong", "themQuyTac", "xoaQuyTac", "ganWebsite", "goWebsite", "datTrangDichCampaign"]) {
      const t = than(camp, ten);
      expect(t.indexOf("khoaCampaignTrongTx(tx,"), ten).toBeGreaterThan(t.indexOf("$transaction"));
      // khoá đứng TRƯỚC phép ghi đầu tiên
      // (AFF-L6: tính cả `createMany`/`deleteMany` — `datTrangDichCampaign` ghi bằng hai lệnh này, không có `.create(` / `.delete(` nào để lưới cũ thấy.)
      const iGhi = t.search(/\.(create|createMany|update|delete|deleteMany)\(/);
      expect(iGhi, `${ten}: phải thấy phép ghi để so thứ tự`).toBeGreaterThan(0);
      expect(t.indexOf("khoaCampaignTrongTx(tx,"), `${ten}: khoá sau phép ghi`).toBeLessThan(iGhi);
    }
  });

  it("kích hoạt: kiemKichHoatCampaign chạy TRONG transaction, SAU khoá campaign, TRƯỚC phép ghi trạng thái; khoá nguồn + website trước khi đọc trạng thái của chúng", () => {
    const t = than(camp, "doiTrangThaiCampaign");
    const iKhoa = t.indexOf("khoaCampaignTrongTx(tx,");
    const iKhoaNguon = t.indexOf("await khoaNguon(tx,");
    const iKhoaSite = t.indexOf("await khoaWebsite(tx,");
    const iKiem = t.indexOf("kiemKichHoatCampaign(");
    const iDocNguon = t.indexOf("tx.leadSourceGroup.findMany");
    const iGhi = t.indexOf("tx.affiliateCampaign.update(");
    expect(t.indexOf("$transaction")).toBeLessThan(iKhoa);
    expect(iKhoaNguon).toBeGreaterThan(iKhoa);
    expect(iKhoaSite).toBeGreaterThan(iKhoa);
    expect(iDocNguon, "đọc trạng thái nguồn SAU khi khoá nó").toBeGreaterThan(iKhoaNguon);
    expect(iKiem).toBeGreaterThan(iDocNguon);
    expect(iGhi).toBeGreaterThan(iKiem);
    expect(dem(t, /\bkiemKichHoatCampaign\(/g)).toBe(1);
  });

  it("từ chối trong transaction là `throw` — hàm ghi không có `return { ok: false` ĐỨNG GIỮA callback $transaction", () => {
    for (const [ten, src] of [["ghi-campaign", camp], ["ghi-membership", mem]] as const) {
      const tx = src.split(/\$transaction\(async \(tx\) => \{/).slice(1);
      expect(tx.length, ten).toBeGreaterThan(0);
      for (const khoi of tx) {
        const than2 = khoi.split(/\n {4}\}\);/)[0] ?? khoi; // callback $transaction kết thúc bằng `    });` (4 dấu cách, nằm trong try)
        expect(dem(than2, /return\s*\{\s*ok:\s*false/g), `${ten}: return ok:false trong transaction`).toBe(0);
      }
    }
  });

  it("mọi đường ghi có audit CÙNG transaction: số writeAudit({ tx, = số lệnh ghi", () => {
    expect(dem(camp, /\bwriteAudit\(\{\s*tx,/g)).toBe(9);
    expect(dem(mem, /\bwriteAudit\(\{\s*tx,/g)).toBe(4);
    expect(dem(camp, /\bwriteAudit\(/g)).toBe(9);
    expect(dem(mem, /\bwriteAudit\(/g)).toBe(4);
  });

  it("khoá lạc quan: so `getTime()` trong JS sau khoá, KHÔNG updateMany({ where: { updatedAt } })", () => {
    expect(dem(camp, /updatedAt\.getTime\(\) !== p\.updatedAtDaThay\.getTime\(\)/g)).toBe(3);
    expect(dem(mem, /updatedAt\.getTime\(\) !== p\.updatedAtDaThay\.getTime\(\)/g)).toBe(2);
    expect(dem(camp + mem, /updateMany\(/g)).toBe(0);
  });

  it("không xoá cứng campaign / thành viên; `now` bắt buộc ở mọi hàm ghi", () => {
    expect(dem(camp, /affiliateCampaign\.delete\(/g)).toBe(0);
    expect(dem(mem, /affiliateMembership\.delete\(/g)).toBe(0);
    expect(dem(camp, /\bnew Date\(\)/g), "chỉ dấu khoá lạc quan của Prisma dùng đồng hồ máy").toBe(1);
  });
});

describe("[AFC-W7] MỘT nguồn cho điều kiện kích hoạt và cho xem trước nguồn", () => {
  it("kiemKichHoatCampaign được GỌI ở đúng hai nơi: hàm ghi (cổng thật) và hàm đọc chi tiết (nút nói thật) — không bản chép tay", () => {
    expect(dem(doc("lib/affiliate/ghi-campaign.ts"), /\bkiemKichHoatCampaign\(/g)).toBe(1);
    expect(dem(doc("lib/affiliate/doc-campaign.ts"), /\bkiemKichHoatCampaign\(/g)).toBe(1);
    const trang = doc(`${APP}/[maCampaign]/page.tsx`) + doc("components/admin/nguon-hoa-hong/campaign/nut-doi-trang-thai-campaign.tsx");
    expect(dem(trang, /\bkiemKichHoat(Campaign)?\(/g), "UI không tự tính điều kiện").toBe(0);
  });

  it("giaiNguonCuaDoiTac chỉ được gọi trong `xemTruocNguon` (1 lần); docXemTruocNguon đi qua dungDauVaoXemTruoc + xemTruocNguon, nối ĐÚNG trường", () => {
    expect(dem(doc("lib/affiliate/ghi-campaign-dau-vao.ts"), /\bgiaiNguonCuaDoiTac\(/g)).toBe(1);
    expect(dem(doc("lib/affiliate/doc-campaign.ts"), /\bgiaiNguonCuaDoiTac\(/g)).toBe(0);
    const dc = doc("lib/affiliate/doc-campaign.ts");
    expect(dem(dc, /\bxemTruocNguon\(\{/g)).toBe(1);
    expect(dem(dc, /\bdungDauVaoXemTruoc\(\{/g)).toBe(1);
    expect(dem(dc, /campaignMacDinh:\s*camp\.defaultSourceGroupId,/g)).toBe(1);
    expect(dem(dc, /loaiMacDinh:\s*doiTac\.type\?\.defaultSourceGroupId \?\? null,/g)).toBe(1);
    expect(dem(dc, /doiTac:\s*\{\s*loaiId:\s*doiTac\.type\?\.id \?\? null,\s*nhanIds:\s*doiTac\.tags\.map\(\(t\) => t\.tagId\)\s*\}/g)).toBe(1);
  });

  it("nguồn chọn được = `nguonChonDuoc` (cùng ô chọn nguồn của lead mới) ở cả ô chọn, hiển thị và cổng ghi; không so mã nguồn nào", () => {
    const tep = ["lib/affiliate/ghi-campaign.ts", "lib/affiliate/ghi-campaign-dau-vao.ts", "lib/affiliate/doc-campaign.ts"].map(doc).join("\n");
    expect(dem(tep, /\bnguonChonDuoc\(/g)).toBeGreaterThanOrEqual(3);
    expect(dem(tep, /["'`]UNKNOWN["'`]/g), "so mã UNKNOWN").toBe(0);
    expect(dem(tep, /\.code\s*[!=]==?\s*["'`]/g), "so mã nguồn với chuỗi").toBe(0);
  });
});

describe("[AFC-W8] thành phần client không kéo mã máy chủ", () => {
  const dir = resolve(GOC, "components/admin/nguon-hoa-hong/campaign");
  const tep = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));

  it("quét được các tệp của thư mục", () => {
    expect(tep.length).toBeGreaterThanOrEqual(8);
  });

  for (const f of tep) {
    it(`${f}: không import @/lib/db · doc-campaign · ghi-campaign(.ts) · ghi-membership(.ts)`, () => {
      const src = boChuThich(readFileSync(join(dir, f), "utf8"));
      expect(dem(src, /from\s+["']@\/lib\/db["']/g)).toBe(0);
      expect(dem(src, /from\s+["']@\/lib\/affiliate\/doc-campaign["']/g)).toBe(0);
      expect(dem(src, /from\s+["']@\/lib\/affiliate\/ghi-campaign["']/g)).toBe(0);
      expect(dem(src, /from\s+["']@\/lib\/affiliate\/ghi-membership["']/g)).toBe(0);
    });
  }

  it("các thành phần ghi (client) đều có 'use client' và gọi Server Action qua _actions, không gọi hàm ghi trực tiếp", () => {
    for (const f of ["campaign-form.tsx", "hop-thoai-ly-do.tsx", "khoi-quy-tac.tsx", "khoi-website.tsx", "nut-doi-trang-thai-campaign.tsx", "nut-membership.tsx", "them-membership.tsx"]) {
      const raw = readFileSync(join(dir, f), "utf8");
      expect(raw.startsWith('"use client";'), f).toBe(true);
    }
  });
});

describe("[AFC-W9] xem trước nguồn", () => {
  const xt = doc(`${APP}/_components/xem-truoc-nguon.tsx`);

  it("thiếu cấu hình hiện «Cần xem tay» + lý do; màn không có «Không rõ» / UNKNOWN", () => {
    expect(dem(xt, /Cần xem tay/g)).toBeGreaterThanOrEqual(1);
    expect(dem(xt, /UNKNOWN/g)).toBe(0);
    expect(dem(xt, /[“"']Không rõ[”"']|>\s*Không rõ\s*</g)).toBe(0);
    expect(dem(xt, /NHAN_TU_DAU\[/g), "bậc quyết định lấy từ bảng của giai-nguon.ts").toBe(1);
  });

  it("xem trước là form GET (không JS, không Server Action); trang không dùng useEffect lấy dữ liệu", () => {
    expect(dem(xt, /<form method="get"/g)).toBe(1);
    expect(dem(xt, /use client|useEffect|"use server"/g)).toBe(0);
    for (const p of CAC_PAGE) expect(dem(doc(p), /\buseEffect\b/g), p).toBe(0);
  });

  it("ô chọn đối tác chỉ có tên · mã · loại: hàm đọc không select phone/email", () => {
    const dc = doc("lib/affiliate/doc-campaign.ts");
    expect(dem(dc, /\b(phone|email)\b/g)).toBe(0);
  });
});
