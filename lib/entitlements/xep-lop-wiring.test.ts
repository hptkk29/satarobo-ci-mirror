// lib/entitlements/xep-lop-wiring.test.ts — LƯỚI GHIM DÂY NỐI của "xếp lớp → buổi bắt đầu" (tinhBatDauKhiXepLop, xetXepLopChoDon, GATE D). KHÔNG DB.
//
// Hành vi đo trên Postgres ở `tests/finance/xep-lop-buoi-bat-dau.test.ts` (`[XL-DB-xx]`). Lưới này canh những thứ test hành vi KHÔNG chắc bắt được vì
// nằm ở THỨ TỰ câu lệnh hoặc ở chỗ ĐƯỜNG GỌI: gỡ lời gọi `xetXepLopChoDon` khỏi `hich.ts` thì không ca hành vi nào ngoài đường hích đỏ; nối nhầm
// `tinhPhamViHoc` vào `xepLopTrongTx` thì ca nào dùng gói trọn ≤ ngưỡng vẫn xanh.
//
// Luật 11: neo biểu thức/lời GỌI (không neo chỗ đặt `await`), đếm SỐ LẦN, và chạy trên mã ĐÃ BỎ CHÚ THÍCH (chú thích giải thích bản vá chứa đúng
// chuỗi đang tìm).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const docTho = (tep: string) => readFileSync(resolve(process.cwd(), tep), "utf8");
const doc = (tep: string) => boChuThich(docTho(tep));
const dem = (s: string, re: RegExp) => s.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))?.length ?? 0;

const XEP = doc("lib/entitlements/xep-lop-tu-don.ts");
const HICH = doc("lib/entitlements/hich.ts");
const DICHVU = doc("lib/entitlements/dich-vu.ts");
/** Phần mã BÊN TRONG callback của `db.$transaction(`. */
const TRONG_TX = XEP.slice(XEP.indexOf("db.$transaction("));

/** Tệp (ngoài test) có lời gọi `ten(` — quét cả cây mã nguồn, kể cả tệp chưa theo dõi. */
function noiGoi(ten: string): string[] {
  let ra: string;
  try {
    ra = execFileSync("git", ["grep", "--untracked", "-l", "-E", `\\b${ten}\\(`, "--", "lib", "app", "components", "scripts"], { encoding: "utf8" });
  } catch {
    ra = ""; // git grep thoát 1 khi không có kết quả
  }
  return ra
    .split("\n")
    .filter(Boolean)
    .map((t) => t.replace(/\\/g, "/"))
    .filter((t) => !/\.test\.tsx?$/.test(t) && !/\.spec\.tsx?$/.test(t))
    .filter((t) => dem(doc(t), new RegExp(`\\b${ten}\\(`)) > 0)
    .sort();
}

describe("[XL-W] xep-lop-tu-don.ts — thứ tự cổng và khoá", () => {
  it("[XL-W1] dấu SCOPE → OrgUnit → cờ → transaction: đúng thứ tự, cờ hỏi đúng MỘT lần, một transaction", () => {
    const iDau = XEP.indexOf("laDonPhamVi(");
    const iOu = XEP.indexOf("orgUnitIdForCenter(");
    const iCo = XEP.indexOf("laThuHocPhiTheoPhamViBat(");
    const iTx = XEP.indexOf("db.$transaction(");
    expect([iDau, iOu, iCo, iTx].every((i) => i > -1)).toBe(true);
    expect(iDau < iOu && iOu < iCo && iCo < iTx).toBe(true);
    expect(dem(XEP, /\blaThuHocPhiTheoPhamViBat\(/)).toBe(1);
    expect(dem(XEP, /\$transaction\(/)).toBe(1);
    expect(XEP).toMatch(/laThuHocPhiTheoPhamViBat\(orgUnitId\)/);
  });

  it("[XL-W2] trong transaction: KHÔNG dùng kết nối gốc `db.`, KHÔNG hỏi cờ / OrgUnit / cài đặt / đọc lớp (kết nối thứ hai ⇒ treo bể kết nối)", () => {
    const sauMo = TRONG_TX.slice("db.$transaction(".length);
    expect(sauMo).not.toMatch(/\bdb\./);
    expect(sauMo).not.toMatch(/laThuHocPhiTheoPhamViBat\(|orgUnitIdForCenter\(|getSetting\(|docCauHinhPhamVi(?:KemRoRang)?\(|docBaiMoiBuoiHocVuot\(|docBaiKeTiepCuaLop\(|docBuoiDaDayTheoBai\(/);
  });

  it("[XL-W3] khoá ĐƠN lấy ĐÚNG MỘT lần, TRƯỚC mọi lần đọc trong giao dịch và TRƯỚC lời chốt phạm vi", () => {
    expect(dem(TRONG_TX, /\bkhoaDonTrongTx\(tx,/)).toBe(1);
    const iKhoa = TRONG_TX.indexOf("khoaDonTrongTx(tx,");
    for (const sau of ["tx.studyEntitlementXuLy.findMany(", "tx.studyEntitlement.findMany(", "xepLopTrongTx(", "taoDongHocBu(tx,", "tx.enrollment.update("]) {
      const i = TRONG_TX.indexOf(sau);
      expect({ sau, thay: i > -1 }).toEqual({ sau, thay: true });
      expect({ sau, saukhoa: iKhoa < i }).toEqual({ sau, saukhoa: true });
    }
  });

  it("[XL-W4] chốt phạm vi: đúng MỘT lời `xepLopTrongTx`, nhu cầu học vượt (ORDER_CONVERSION, khai orgUnitId) tạo SAU nó; phép tính thuần chạy NGOÀI transaction", () => {
    expect(dem(XEP, /\bxepLopTrongTx\(/)).toBe(1);
    expect(dem(XEP, /\btinhBatDauKhiXepLop\(/)).toBe(1);
    expect(XEP.indexOf("tinhBatDauKhiXepLop(")).toBeLessThan(XEP.indexOf("db.$transaction("));
    expect(dem(TRONG_TX, /\btaoDongHocBu\(tx,/)).toBe(1);
    expect(TRONG_TX.indexOf("xepLopTrongTx(")).toBeLessThan(TRONG_TX.indexOf("taoDongHocBu(tx,"));
    expect(TRONG_TX).toMatch(/nguon:\s*"ORDER_CONVERSION"/);
    expect(TRONG_TX).toMatch(/orgUnitId:\s*k\.xep\.orgUnitIdLop/);
  });

  it("[XL-W5] KHÔNG tiêu thụ buổi nào lúc xếp lớp: file không chạm sổ cái / cột tiêu thụ", () => {
    expect(XEP).not.toMatch(/studyEntitlementUsage|consumedSessions|ghiNhanBai|ganLaiTieuThu/);
  });

  it("[XL-W7] ghi danh được ĐỌC LẠI dưới khoá đơn (còn sống, cùng lớp) TRƯỚC khi chốt phạm vi — rút / đổi lớp không đi qua khoá đơn", () => {
    const iDoc = TRONG_TX.indexOf("tx.enrollment.findUnique(");
    expect(iDoc).toBeGreaterThan(-1);
    expect(dem(TRONG_TX, /\btx\.enrollment\.findUnique\(/)).toBe(1);
    expect(iDoc).toBeLessThan(TRONG_TX.indexOf("xepLopTrongTx("));
    const kiem = TRONG_TX.slice(iDoc, TRONG_TX.indexOf("xepLopTrongTx("));
    expect(kiem).toMatch(/gdMoi\.deletedAt !== null/);
    expect(kiem).toMatch(/gdMoi\.classId !== gd\.classId/);
    expect(kiem).toMatch(/TRANG_THAI_GHI_DANH_SONG/);
    expect(kiem).toMatch(/continue;/);
  });

  it("[XL-W6] cổng chiều ngược: dòng đang CAN_THU_HOI / TREO_DUYET_TAY MỞ thì không chốt phạm vi; quyền học đã chốt thì KHÔNG đụng dòng chờ", () => {
    expect(XEP).toMatch(/LOAI_CHIEU_NGUOC\s*=\s*\["CAN_THU_HOI",\s*"TREO_DUYET_TAY"\]/);
    const iCan = TRONG_TX.indexOf("LOAI_CHIEU_NGUOC as readonly string[]");
    expect(iCan).toBeGreaterThan(-1);
    expect(iCan).toBeLessThan(TRONG_TX.indexOf("xepLopTrongTx("));
    // nhánh "đã chốt phạm vi từ trước" chỉ ghi vào danh sách, không gọi xuLyCho
    const nhanh = TRONG_TX.slice(TRONG_TX.indexOf("q.status !== \"AWAITING_PLACEMENT\""), TRONG_TX.indexOf("if (!q) {"));
    expect(nhanh).toMatch(/daXepTruoc\.push\(/);
    expect(nhanh).not.toMatch(/xuLyCho\(/);
  });
});

describe("[XL-W] đường gọi", () => {
  it("[XL-W10] `xetXepLopChoDon` chỉ được gọi từ hich.ts (ngoài chính tệp định nghĩa) — mọi đường tiền / Chuyển đổi đã nối vào hich tự được xếp lớp", () => {
    expect(noiGoi("xetXepLopChoDon")).toEqual(["lib/entitlements/hich.ts", "lib/entitlements/xep-lop-tu-don.ts"]);
  });

  it("[XL-W11] hich.ts: xếp lớp chạy SAU cấp quyền, trong try riêng, và BỎ QUA bốn nguồn chiều ngược", () => {
    expect(dem(HICH, /\bxetXepLopChoDon\(/)).toBe(1);
    expect(HICH.indexOf("xetCapQuyenHocChoDon(orderId")).toBeLessThan(HICH.indexOf("xetXepLopChoDon("));
    expect(HICH).toMatch(/NGUON_CHIEU_NGUOC[^=]*=\s*new Set\(\["TIEN_BI_TU_CHOI",\s*"TIEN_BI_HOAN",\s*"DON_BI_LOAI",\s*"DUNG_HOC"\]\)/);
    expect(HICH).toMatch(/if \(NGUON_CHIEU_NGUOC\.has\(nguon\)\) return;/);
    expect(dem(HICH, /\btry\s*\{/)).toBeGreaterThanOrEqual(3); // cấp quyền · xếp lớp · (hichCapQuyenHocChoLead)
    expect(HICH.indexOf("NGUON_CHIEU_NGUOC.has(nguon)")).toBeLessThan(HICH.indexOf("xetXepLopChoDon("));
  });

  it("[XL-W12] `xepLopTrongTx` chỉ được gọi từ xep-lop-tu-don.ts (và chính nó trong dich-vu.ts)", () => {
    expect(noiGoi("xepLopTrongTx")).toEqual(["lib/entitlements/dich-vu.ts", "lib/entitlements/xep-lop-tu-don.ts"]);
  });

  it("[XL-W13] dich-vu.ts: MỘT công thức xếp lớp — `tinhBatDauKhiXepLop`, không còn `tinhPhamViHoc`; skippedSessions chỉ đếm bài bỏ qua TRONG phạm vi", () => {
    expect(dem(DICHVU, /\btinhBatDauKhiXepLop\(/)).toBe(1);
    expect(DICHVU).not.toMatch(/\btinhPhamViHoc\b/);
    expect(DICHVU).toMatch(/skippedSessions:\s*phamVi\.skippedLessons\.length/);
    expect(DICHVU).not.toMatch(/skippedSessions:[^\n]*lessonsBeforeStart/);
    expect(DICHVU).toMatch(/startLessonOrder:\s*phamVi\.startLesson/);
    expect(DICHVU).toMatch(/endLessonOrder:\s*phamVi\.endLesson/);
  });
});

describe("[XL-W] GATE D — hai đường ghi danh cũ không áp 'học các buổi cuối' cho dòng SCOPE khi cờ BẬT", () => {
  const CONVERT = doc("lib/crm/convert-lead-v2.ts");
  const CDD = doc("lib/orders/chuyen-doi-don.ts");
  const DDL = doc("lib/finance/dong-don-cua-lead.ts");

  it("[XL-W20] convertLeadV2: cờ hỏi MỘT lần và CHỈ khi có dòng mang dấu; dòng SCOPE ⇒ null TRƯỚC khi tính `phamViBuoiDangKy`", () => {
    expect(dem(CONVERT, /\bphamViDangBatChoCoSo\(/)).toBe(1);
    expect(dem(CONVERT, /\blaDongPhamViChoGhiDanh\(/)).toBe(1);
    expect(CONVERT).toMatch(/dongDon\.some\(\(d\) => d\.coPhamVi\)\s*&&\s*\(await phamViDangBatChoCoSo\(lead\.centerId\)\)/);
    const iNull = CONVERT.indexOf("laDongPhamViChoGhiDanh(");
    const iCu = CONVERT.indexOf("phamViBuoiDangKy({");
    expect(iNull).toBeGreaterThan(-1);
    expect(iNull).toBeLessThan(iCu);
    // PR5: MỘT phép khớp (`dongTheoQuyenHoc`) quyết cả `buoiBatDau = null` lẫn trạng thái ghi danh PENDING — hai phép khớp là hai cách lệch.
    expect(CONVERT).toMatch(/const dongTheoQuyenHoc = input\.students\.map\(\(s\) => phamViBat && laDongPhamViChoGhiDanh\(/);
    expect(CONVERT).toMatch(/if \(dongTheoQuyenHoc\[i\]\) return null;/);
  });

  it("[XL-W21] dongDonCuaLead điền `coPhamVi` từ CHÍNH hàm đọc dấu (không dựng phép kiểm thứ hai)", () => {
    expect(DDL).toMatch(/coPhamVi:\s*docPhamViDong\(it\.metadata\)\s*!==\s*null/);
  });

  it("[XL-W22] màn Chuyển đổi: dòng SCOPE dùng phán quyết trung tính, KHÔNG `xetXepVaoLop`; buoiBatDau của dòng là null; cờ hỏi qua gate", () => {
    expect(dem(CDD, /\bdongPhamViDangBat\(/)).toBe(1);
    expect(CDD).toMatch(/const xet = laPhamVi\s*\?\s*xetTheoPhamVi\(soBuoiDaQua \+ 1\)\s*:\s*xetXepVaoLop\(/);
    expect(CDD).toMatch(/buoiBatDau:\s*laPhamVi\s*\?\s*null\s*:\s*xetXepVaoLop\(/);
    expect(CDD).toMatch(/phamVi:\s*laPhamVi/);
    // phán quyết trung tính không sinh học vượt / không mất buổi / không chặn lớp
    const than = CDD.slice(CDD.indexOf("function xetTheoPhamVi("), CDD.indexOf("/** Trạng thái lớp còn nhận ghi danh"));
    expect(than).toMatch(/xepDuoc:\s*true/);
    expect(than).toMatch(/chiAdmin:\s*false/);
    expect(than).toMatch(/soBuoiHocVuot:\s*0/);
    expect(than).toMatch(/soBuoiMatTrang:\s*0/);
    expect(than).toMatch(/buoiBatDau:\s*null/);
  });
});

describe("[XL-W] migration + schema", () => {
  const TEN = "20261021100000_quyen_hoc_xu_ly_cho_xep_lop";
  it("[XL-W30] migration chỉ THÊM một giá trị enum, không dùng nó, không đụng gì khác; dấu thời gian duy nhất", () => {
    const sql = docTho(`prisma/migrations/${TEN}/migration.sql`).replace(/--[^\n]*/g, "").trim();
    expect(sql).toBe(`ALTER TYPE "EntitlementXuLyLoai" ADD VALUE IF NOT EXISTS 'CHO_XEP_LOP';`);
    const ten = readdirSync(resolve(process.cwd(), "prisma/migrations")).filter((t) => /^\d{14}_/.test(t));
    expect(ten.filter((t) => t.startsWith("20261021100000_"))).toEqual([TEN]);
  });
  it("[XL-W31] schema.prisma khai CHO_XEP_LOP trong enum EntitlementXuLyLoai và tên migration khớp một giá trị trong schema", () => {
    const schema = docTho("prisma/schema.prisma");
    const enumBody = schema.match(/enum EntitlementXuLyLoai \{([\s\S]*?)\}/)?.[1] ?? "";
    expect(boChuThich(enumBody).split(/\s+/).filter(Boolean).sort()).toEqual(["CAN_THU_HOI", "CHO_CHUYEN_DOI", "CHO_DUYET_HOC_VUOT", "CHO_XEP_LOP", "LECH_DU_LIEU", "THIEU_QUYEN_HOC", "TREO_DUYET_TAY"]);
  });
});
