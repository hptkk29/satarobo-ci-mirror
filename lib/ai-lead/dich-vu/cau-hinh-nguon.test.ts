// @vitest-environment node
// [AIK-SRC] LƯỚI GHIM MÃ NGUỒN của lát K (luật 11/14): những bất biến mà test hành vi không với tới — "không có phép sửa snapshot", "thiếu khoá gốc chặn
// TRƯỚC khi ghi", "xoay khoá có điều kiện version"… Đọc mã ĐÃ BỎ CHÚ THÍCH (chú thích giải thích bản vá hay chứa đúng chuỗi đang cấm), neo vào biểu thức
// hẹp, đếm SỐ LẦN khớp. Mỗi ca đã được CẤY LẠI lỗi để thấy đỏ (bảng trong báo cáo).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function doc(tep: string): string {
  const raw = readFileSync(resolve(process.cwd(), tep), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}
/** Thân của một hàm export: từ `export async function ten(` tới dòng `}` đầu cột. */
function than(src: string, ten: string): string {
  const i = src.indexOf(`export async function ${ten}(`);
  if (i < 0) throw new Error(`Không thấy hàm ${ten}`);
  return src.slice(i, src.indexOf("\n}\n", i));
}
const dem = (src: string, re: RegExp) => [...src.matchAll(re)].length;

const CH = doc("lib/ai-lead/dich-vu/cau-hinh.ts");
const KN = doc("lib/ai-lead/dich-vu/ket-noi.ts");
const KNT = doc("lib/ai-lead/dich-vu/ket-noi-thuan.ts");
const CHT = doc("lib/ai-lead/dich-vu/cau-hinh-thuan.ts");

describe("[AIK-SRC] cau-hinh.ts", () => {
  it("[AIK-SRC-01] SNAPSHOT BẤT BIẾN: không có update/updateMany/delete/deleteMany/upsert nào trên aiLeadCatalogSnapshot; đúng MỘT chỗ create", () => {
    expect(dem(CH, /aiLeadCatalogSnapshot\s*\.\s*(update|updateMany|delete|deleteMany|upsert)\b/g)).toBe(0);
    expect(dem(CH, /aiLeadCatalogSnapshot\s*\.\s*create\b/g)).toBe(1);
  });

  it("[AIK-SRC-02] thiếu khoá gốc chặn TRƯỚC mọi phép ghi (taoAgent, taoLaiKhoa)", () => {
    for (const t of ["taoAgent", "taoLaiKhoa"]) {
      const b = than(CH, t);
      const iChan = b.indexOf("if (!masterKeyCoSan()) return");
      expect(iChan, t).toBeGreaterThan(-1);
      expect(iChan, t).toBeLessThan(b.indexOf("chayGiaoDich("));
    }
  });

  it("[AIK-SRC-03] xoay khoá CÓ ĐIỀU KIỆN version đang thấy (updateMany + secretVersion: cu), và từ chối khi đổi 0 dòng", () => {
    const b = than(CH, "taoLaiKhoa");
    expect(dem(b, /aiLeadAgent\.updateMany\(\{ where: \{ id: a\.id, secretVersion: cu \}/g)).toBe(1);
    expect(b).toMatch(/doi\.count === 0\) throw new LoiNghiepVu/);
  });

  it("[AIK-SRC-04] Agent PROD đi qua cổng PROD khi TẠO và khi BẬT lại", () => {
    expect(than(CH, "taoAgent")).toMatch(/environment === "PROD"[\s\S]*cheMoCongProd\(\)/);
    expect(than(CH, "datHoatDongAgent")).toMatch(/input\.active && a\.environment === "PROD"[\s\S]*cheMoCongProd\(\)/);
    expect(dem(CH, /async function cheMoCongProd/g)).toBe(1);
    expect(CH).toMatch(/const c = await congProd\(\);\s*if \(c\.allowed\) return null;/);
  });

  it("[AIK-SRC-05] MỌI nhật ký đi qua `ghiNhatKy` (chặn chuỗi 64-hex); `writeAudit(` xuất hiện đúng một lần trong tệp", () => {
    expect(dem(CH, /\bwriteAudit\(/g)).toBe(1);
    const i = CH.indexOf("async function ghiNhatKy(");
    const b = CH.slice(i, CH.indexOf("\n}\n", i));
    expect(b).toMatch(/if \(RE_CHUOI_GIONG_KHOA\.test\(/);
    expect(b).toMatch(/throw new Error\(/);
    expect(CH).toMatch(/const RE_CHUOI_GIONG_KHOA = \/\(\?<!\[0-9a-f\]\)\[0-9a-f\]\{64\}\(\?!\[0-9a-f\]\)\/i;/);
  });

  it("[AIK-SRC-06] nhật ký của agent KHÔNG mang khoá: lời gọi ghiNhatKy của taoAgent/taoLaiKhoa không nhắc agentSecret/khoa; không console", () => {
    for (const t of ["taoAgent", "taoLaiKhoa"]) {
      const goi = than(CH, t).match(/await ghiNhatKy\(([\s\S]*?)\n {4}\}\);/);
      expect(goi, t).not.toBeNull();
      expect(goi![1], t).not.toMatch(/agentSecret|\bkhoa\b/);
    }
    expect(dem(CH, /console\./g)).toBe(0);
  });

  it("[AIK-SRC-07] rollback (xuatBanLai) tạo version MỚI qua taoSnapshot; xuất bản cùng nội dung bị từ chối; etag có version", () => {
    expect(than(CH, "xuatBanLai")).toMatch(/return taoSnapshot\(/);
    expect(CH).toMatch(/jsonChuanTac\(hien\) === jsonChuanTac\(payload\)\) \{\s*throw new LoiNghiepVu/);
    expect(CH).toMatch(/const version = \(moiNhat\?\.version \?\? 0\) \+ 1;/);
    expect(CH).toMatch(/const etag = tinhEtag\(version, payload\);/);
  });

  it("[AIK-SRC-08] đổi chính sách đi qua setGlobalSetting rồi ghi nhật ký ai-lead", () => {
    const b = than(CH, "doiChinhSach");
    expect(b).toMatch(/setGlobalSetting\(actor,/);
    expect(b).toMatch(/entityType: "AiLeadPolicy"/);
  });

  it("[AIK-SRC-09] chỉ nhận cơ sở nhận khách: đang hoạt động, không phải Hội sở, có mã hợp lệ — dùng chung cho routing và xuất bản", () => {
    const i = CH.indexOf("async function kiemCoSoNhanKhach(");
    const b = CH.slice(i, CH.indexOf("\n}\n", i));
    expect(b).toMatch(/!c\.isActive/);
    expect(b).toMatch(/khongNhan\.includes\(c\.id\)/);
    expect(b).toMatch(/RE\.campusCode\.test\(c\.code\)/);
    expect(dem(CH, /kiemCoSoNhanKhach\(/g)).toBe(5); // định nghĩa + routing(2) + xuất bản(1) + kiểm quy tắc theo thế giới sống (Rule Builder, 1)
  });

  it("[AIK-SRC-10] không đọc đồng hồ thật trong nghiệp vụ cấu hình (dùng DB `@default(now())`)", () => {
    expect(dem(CH, /Date\.now\(\)|new Date\(\)/g)).toBe(0);
  });
});

describe("[AIK-SRC] ket-noi.ts / ket-noi-thuan.ts", () => {
  it("[AIK-SRC-20] luật nhãn THUẦN: không đồng hồ thật, không DB, không env", () => {
    expect(dem(KNT, /Date\.now\(\)|new Date\(\)|process\.env|@\/lib\/db|console\./g)).toBe(0);
  });

  it("[AIK-SRC-21] chỉ lần chạy status PASS mới có thể làm tầng đạt; MOCK_ONLY/NOT_RUN bị loại khi chọn lần chạy thật", () => {
    expect(KNT).toMatch(/\.filter\(\(r\) => r\.status !== "MOCK_ONLY" && r\.status !== "NOT_RUN"\)/);
    expect(dem(KNT, /dat: muc === "DAT"/g)).toBe(1);
    expect(KNT).toMatch(/const han = kiemHanPass\(that, d\);\s*if \(!han\.conHan\) return co\("HET_HAN"/);
  });

  it("[AIK-SRC-22] hết hạn PASS so ĐỦ năm thứ: TTL, build, hash Agent, môi trường, tập Page", () => {
    const i = KNT.indexOf("export function kiemHanPass(");
    const b = KNT.slice(i, KNT.indexOf("\n}\n", i));
    expect(b).toMatch(/tuoi > ctx\.ttlKiemChungMs/);
    expect(b).toMatch(/run\.buildSha !== ctx\.agent\.lastBuildSha/);
    expect(b).toMatch(/run\.contractHash !== ctx\.agent\.lastContractHash/);
    expect(b).toMatch(/ev\.environment !== ctx\.agent\.environment/);
    expect(b).toMatch(/sapXepPage\(ev\.pageIds\) !== sapXepPage\(ctx\.pageIdsHienTai\)/);
  });

  it("[AIK-SRC-23] nhãn xanh CHỈ từ ba nhánh có bằng chứng; PROD_LIVE đòi tầng L4 `dat` (đã gồm chữ ký)", () => {
    expect(KNT).toMatch(/if \(tang\.L4\.dat\) return ra\("PROD_LIVE_VERIFIED"/);
    expect(KNT).toMatch(/if \(tang\.L3\.dat\) return ra\("E2E_VERIFIED"/);
    expect(KNT).toMatch(/if \(tang\.L2\.dat\) return ra\("CONNECTED"/);
    expect(dem(KNT, /ra\("(CONNECTED|E2E_VERIFIED|PROD_LIVE_VERIFIED)"/g)).toBe(3);
    expect(KNT).toMatch(/typeof ky !== "string" \|\| ky\.trim\(\) === ""/);
  });

  it("[AIK-SRC-24] ket-noi.ts: thăm dò không phát chồng; sự cố đổi CÓ ĐIỀU KIỆN trạng thái; L2 KHÔNG có đường ghi tay trong Trung tâm kết nối", () => {
    expect(KN).toMatch(/ackedAt: null, expiresAt: \{ gt: bayGio \}/);
    expect(KN).toMatch(/updateMany\(\{ where: \{ id: s\.id, state: \{ in: tuTrangThai \} \}, data \}\)/);
    // L2 chỉ do route heartbeat ghi, đúng lúc Agent ack (review độc lập 27/10): Trung tâm kết nối KHÔNG có đường nào tự ghi L2 từ thăm dò.
    expect(KN).not.toMatch(/ghiNhanL2/);
    expect(KN).not.toMatch(/kind:\s*"PROBE"/);
    expect(dem(KN, /Date\.now\(\)|new Date\(\)/g)).toBe(0);
    expect(dem(KN, /console\./g)).toBe(0);
  });

  it("[AIK-SRC-25] đọc hồ sơ chờ qua scopedDb (AiLeadDraft mang cách ly cơ sở)", () => {
    expect(KN).toMatch(/scopedDb\(actor\)\.aiLeadDraft\.findMany\(/);
    expect(dem(KN, /\bdb\.aiLeadDraft\b/g)).toBe(0);
  });

  it("[AIK-SRC-26] không trả khoá ra ngoài: ket-noi.ts không import daoKhoaAgent", () => {
    expect(KN).not.toMatch(/daoKhoaAgent/);
  });
});

describe("[AIK-SRC] cau-hinh-thuan.ts", () => {
  it("[AIK-SRC-30] etag băm CẢ version; catalog qua schema hợp đồng trước khi trả", () => {
    expect(CHT).toMatch(/update\(`v\$\{version\}\|\$\{jsonChuanTac\(payload\)\}`\)/);
    expect(CHT).toMatch(/schemaPages\.safeParse\(pages\)/);
    expect(CHT).toMatch(/\.filter\(\(h\) => h\.pageId === pageId && h\.publicVisible\)/);
  });

  it("[AIK-SRC-31] pageId chặn danh tính mẫu của gói bàn giao", () => {
    expect(CHT).toMatch(/laDanhTinhFixture\(\{ pageId: v \}\)/);
  });
});
