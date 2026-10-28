// Ca [CTW-*] — LƯỚI GHIM DÂY NỐI của chứng từ ngân hàng (P7-E, 06/11/2026). Test HÀNH VI ở `tests/finance/chung-tu-ngan-hang.test.ts` + `[CTA-*]` + `[CTR-*]`
// + `[CTB-*]`; tệp này canh những LỜI HỨA mà test hành vi không thấy (chúng sống ở chỗ các hàm được GỌI từ đâu / KHÔNG được chạm gì):
//   · tầng ghi chỉ ghi `ChungTuNganHang` + AuditLog — KHÔNG `Payment`, Receipt, hoá đơn (tải chứng từ không xác nhận khoản, không đụng hoá đơn);
//   · mọi phép ghi nằm trong transaction, cổng đứng TRƯỚC phép ghi đầu, audit cùng transaction;
//   · mọi action đi qua cổng chung; khoá tệp không bao giờ ra client;
//   · làn chứng từ KHÔNG dùng bộ lọc hàng chờ hoá đơn (đưa khoản nhập lịch sử vào là YÊU CẦU, không phải sơ suất);
//   · bảng mới đã khai đủ ba nơi cách ly cơ sở; migration chỉ THÊM, có RLS.
// Quy tắc viết (CLAUDE.md luật 11): bỏ chú thích TRƯỚC khi khớp, neo vào BIỂU THỨC, khẳng định cả SỐ LẦN khớp.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const dem = (s: string, re: RegExp) => [...s.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))].length;
/** Thân MỘT hàm `export async function ten` đến hàm export kế tiếp (hoặc hết tệp). */
function than(s: string, ten: string): string {
  const i = s.indexOf(`export async function ${ten}`);
  expect(i, `không thấy hàm ${ten}`).toBeGreaterThanOrEqual(0);
  const j = s.indexOf("\nexport ", i + 10);
  return s.slice(i, j < 0 ? undefined : j);
}

/** `a` đứng TRƯỚC `b` — và CẢ HAI phải có mặt (indexOf = -1 sẽ thành «đứng trước» nhầm: mutant xoá hẳn lời gọi vẫn xanh). */
function truocHon(s: string, a: string, b: string): void {
  const ia = s.indexOf(a);
  const ib = s.indexOf(b);
  expect(ia, `thiếu «${a}»`).toBeGreaterThanOrEqual(0);
  expect(ib, `thiếu «${b}»`).toBeGreaterThanOrEqual(0);
  expect(ia, `«${a}» phải đứng trước «${b}»`).toBeLessThan(ib);
}

const DB = "lib/finance/hoa-don/chung-tu-ngan-hang-db.ts";
const ACT = "app/(admin)/admin/payments/hoa-don/chung-tu-ngan-hang/_actions.ts";
const ROUTE = "app/(admin)/admin/payments/hoa-don/chung-tu-ngan-hang/[hoSoId]/tai-ve/route.ts";
const PAGE = "app/(admin)/admin/payments/hoa-don/chung-tu-ngan-hang/page.tsx";
const GHI = ["danhDauCanChungTu", "ghiTepChungTu", "danhDauDaKiemTra", "yeuCauBoSungLai", "huyDanhDau"] as const;

describe("[CTW-01] tầng ghi CHỈ ghi `ChungTuNganHang` + AuditLog — không bao giờ `Payment`, Receipt, hoá đơn", () => {
  const s = boChuThich(doc(DB));

  it("không có phép ghi nào lên bảng khác; `Payment` chỉ được ĐỌC (findUnique)", () => {
    const khac = /\.(?:payment|receipt|hoaDonDienTu|hoaDonKhoan|hoaDonGuiEmail|order|orderItem|enrollment|paymentRequest|paymentAllocation|bankTransaction|commissionLine|commissionTransaction)\.(?:update|updateMany|create|createMany|delete|deleteMany|upsert)\(/;
    expect(dem(s, khac)).toBe(0);
    expect(dem(s, /\$executeRaw|\$queryRaw|\$executeRawUnsafe/)).toBe(0);
    expect(dem(s, /\btx\.payment\.findUnique\(/)).toBe(1);
    expect(dem(s, /\.payment\.[a-zA-Z]+\(/)).toBe(1); // ngoài findUnique ở trên không còn lời gọi `payment.*` nào
  });

  it("đúng MỘT create, MỘT updateMany (có điều kiện trạng thái), MỘT deleteMany (có điều kiện) trên bảng của mình", () => {
    expect(dem(s, /\.chungTuNganHang\.create\(/)).toBe(1);
    expect(dem(s, /\.chungTuNganHang\.updateMany\(/)).toBe(1);
    expect(dem(s, /\.chungTuNganHang\.deleteMany\(/)).toBe(1);
    expect(dem(s, /\.chungTuNganHang\.(?:update|delete|upsert|createMany)\(/)).toBe(0);
    expect(s).toMatch(/updateMany\(\{ where: \{ id, trangThai: tu \}, data \}\)/);
    expect(s).toMatch(/deleteMany\(\{ where: \{ id: hs\.id, trangThai: "CHO_BO_SUNG", tepKhoa: null \} \}\)/);
  });

  it("KHÔNG đặt `accountantStatus` / `evidenceUrl` / `confirmedAt` ở bất kỳ đâu trong tệp ghi (chỉ có thể là chuỗi đọc)", () => {
    expect(dem(s, /\bevidenceUrl\b/)).toBe(0);
    expect(dem(s, /\bconfirmedAt\b/)).toBe(0);
    // chỉ xuất hiện trong ba khối `select` (payment.findUnique · danh sách · tìm khoản), không bao giờ trong `data` của phép ghi
    expect(dem(s, /accountantStatus\s*:/)).toBe(3);
    expect(dem(s, /data[^;]*accountantStatus/)).toBe(0);
  });
});

describe("[CTW-02] mỗi hàm GHI: một transaction, cổng TRƯỚC phép ghi, audit cùng transaction, phạm vi kế toán hỏi bằng CHÍNH transaction", () => {
  const s = boChuThich(doc(DB));

  for (const ten of GHI) {
    it(`${ten}`, () => {
      const t = than(s, ten);
      expect(dem(t, /\bdb\.\$transaction\(/), "một transaction").toBe(1);
      expect(dem(t, /\bwriteAudit\(/), "một audit").toBe(1);
      expect(t).toMatch(/\btx,\s*\n\s*\}\);/); // audit nhận `tx`
      const iGhi = Math.min(...[t.indexOf("tx.chungTuNganHang.create("), t.indexOf("capNhatCoDieuKien(tx"), t.indexOf("tx.chungTuNganHang.deleteMany(")].filter((i) => i >= 0));
      const iAudit = t.indexOf("writeAudit(");
      expect(iGhi, "phải có phép ghi").toBeGreaterThan(0);
      expect(iAudit, "audit SAU phép ghi, cùng transaction").toBeGreaterThan(iGhi);
      // cổng phạm vi đứng TRƯỚC phép ghi: hoặc `docHoSo(tx` (đã gồm coQuyenKeToanTaiCoSo) hoặc kiểm trực tiếp trong danhDauCanChungTu
      const iCong = ten === "danhDauCanChungTu" ? t.indexOf("coQuyenKeToanTaiCoSo(") : t.indexOf("docHoSo(tx");
      expect(iCong, "cổng phạm vi").toBeGreaterThan(0);
      expect(iCong).toBeLessThan(iGhi);
      // rollback: từ chối là THROW, không `return { ok: false`
      expect(dem(t, /return \{ ok: false/)).toBe(0);
    });
  }

  it("`docHoSo` hỏi `coQuyenKeToanTaiCoSo` trên hồ sơ đọc bằng transaction; không phải `scopedDb`", () => {
    const d = s.slice(s.indexOf("async function docHoSo"), s.indexOf("function kiemChuyen"));
    expect(d).toMatch(/tx\.chungTuNganHang\.findUnique\(\{ where: \{ paymentId \} \}\)/);
    expect(d).toMatch(/!hs \|\| !coQuyenKeToanTaiCoSo\(actor, hs\.centerId\)\) throw khongThay\(\)/);
    expect(dem(s, /scopedDb\(/)).toBe(2); // chỉ hai hàm ĐỌC (danh sách + tìm khoản)
  });

  it("`create` tự set `centerId` của KHOẢN (scopedDb không che write)", () => {
    const t = than(s, "danhDauCanChungTu");
    expect(t).toMatch(/centerId: p\.centerId,/);
    expect(t).toMatch(/!p \|\| !p\.centerId \|\| !coQuyenKeToanTaiCoSo\(input\.actor, p\.centerId\)\) throw khongThay\(\)/);
  });

  it("lỗi nghiệp vụ là `throw new LoiChungTu`; không `console.log` PII; không đọc đồng hồ (nơi gọi truyền `now`)", () => {
    expect(dem(s, /\bnew Date\(/)).toBe(0);
    expect(dem(s, /Date\.now\(/)).toBe(0);
    expect(dem(s, /console\./)).toBe(0);
  });
});

describe("[CTW-03] action: mọi action đi qua cổng chung; tệp 'use server' chỉ export async function; khoá tệp không ra client", () => {
  const raw = doc(ACT);
  const s = boChuThich(raw);

  it("`use server` ở dòng đầu; mọi `export` là `export async function`", () => {
    expect(raw.startsWith('"use server";')).toBe(true);
    expect(dem(s, /^export (?!async function)/m)).toBe(0);
    expect(dem(s, /^export async function /m)).toBe(7);
  });

  it("MỖI action gọi `cong()` hoặc `congHoSo(` ĐÚNG MỘT lần, TRƯỚC mọi tầng ghi; cổng chung hỏi cờ → đăng nhập → payments:confirm → actor", () => {
    for (const ten of [
      "timKhoanTheoMaDonAction",
      "danhDauCanChungTuAction",
      "huyDanhDauChungTuAction",
      "kyTaiLenChungTuAction",
      "ghiChungTuDaTaiAction",
      "kiemTraChungTuAction",
      "yeuCauBoSungLaiChungTuAction",
    ]) {
      const t = than(s, ten);
      expect(dem(t, /\bawait (?:cong|congHoSo)\(/), ten).toBe(1);
    }
    const c = s.slice(s.indexOf("async function cong()"), s.indexOf("/** Hồ sơ theo khoản"));
    const moc = ["laHoaDonBat()", "auth()", 'checkPermission("payments:confirm")', "resolveActor("];
    let tu = 0;
    for (const m of moc) {
      const i = c.indexOf(m, tu);
      expect(i, m).toBeGreaterThanOrEqual(tu);
      tu = i;
    }
  });

  it("`congHoSo` tra hồ sơ qua `scopedDb` rồi hỏi `coQuyenKeToanTaiCoSo`; ký URL và xác minh chỉ sau cổng", () => {
    const c = s.slice(s.indexOf("async function congHoSo"), s.indexOf("function lamMoi"));
    expect(c).toMatch(/scopedDb\(c\.actor\)\.chungTuNganHang\.findUnique/);
    expect(c).toMatch(/!hs \|\| !coQuyenKeToanTaiCoSo\(c\.actor, hs\.centerId\)/);
    const ky = than(s, "kyTaiLenChungTuAction");
    truocHon(ky, "await congHoSo(", "kyUrlTaiLenChungTu(");
    truocHon(ky, 'chuyenTrangThai(c.hoSo.trangThai, "TAI_LEN")', "kyUrlTaiLenChungTu(");
    const ghi = than(s, "ghiChungTuDaTaiAction");
    truocHon(ghi, "khoaThuocKhoan(", "xacMinhTepChungTu(");
    truocHon(ghi, "xacMinhTepChungTu(", "ghiTepChungTu(");
  });

  it("tệp action không động tới `Payment` / hoá đơn; không trả khoá tệp (`tepKhoa`) về client", () => {
    expect(dem(s, /\b(?:payment|receipt|hoaDonDienTu)\.(?:update|create|delete|upsert)/)).toBe(0);
    expect(dem(s, /\btepKhoa\b/)).toBe(2); // `select` của hồ sơ + so `hoSo.tepKhoa` với khoá khách gửi; KHÔNG nằm trong giá trị trả về
    const ky = than(s, "kyTaiLenChungTuAction");
    expect(ky).toMatch(/data: \{ khoa, url, contentType/); // khoá của tệp MỚI (client cần để PUT/ghi) — không phải khoá tệp đang giữ
  });
});

describe("[CTW-04] route tải: audit TRƯỚC ký URL; chỉ kế toán đúng cơ sở; không nhánh PII; không URL công khai", () => {
  const s = boChuThich(doc(ROUTE));

  it("thứ tự cổng: cờ → đăng nhập → payments:confirm → scopedDb → phạm vi kế toán → có tệp → kho → AUDIT → ký → 302", () => {
    const moc = ["laHoaDonBat()", "auth()", 'checkPermission("payments:confirm")', "scopedDb(actor).chungTuNganHang.findUnique", "coQuyenKeToanTaiCoSo(actor, hs.centerId)", "khoHoaDonDaCauHinh()", "ghiAuditTaiVeChungTu(", "kyUrlTaiVeChungTu(", "NextResponse.redirect(url, 302)"];
    let tu = 0;
    for (const m of moc) {
      const i = s.indexOf(m, tu);
      expect(i, m).toBeGreaterThanOrEqual(tu);
      tu = i;
    }
  });

  it("KHÔNG hỏi `orders:view-pii` (khác route hoá đơn), KHÔNG dùng URL công khai (`R2_PUBLIC_URL` / `getPublicUrl`)", () => {
    expect(dem(s, /orders:view-pii/)).toBe(0);
    expect(dem(s, /R2_PUBLIC_URL|publicUrl|getPublicUrl|cdn\./i)).toBe(0);
    expect(dem(s, /Cache-Control", "no-store"/)).toBe(1);
  });

  it("ĐỌC an toàn: kiểu `DongChungTu` (đi xuống client) KHÔNG có khoá tệp", () => {
    const t = boChuThich(doc(DB));
    const kieu = t.slice(t.indexOf("export type DongChungTu"), t.indexOf("const TRANG_THAI_HOA_DON_CO_SO_HIEU"));
    expect(kieu).not.toMatch(/tepKhoa/);
    expect(kieu).toMatch(/tepTen: string \| null;/);
  });
});

describe("[CTW-05] làn chứng từ KHÔNG dùng bộ lọc hàng chờ hoá đơn — khoản nguồn nhập lịch sử phải vào được", () => {
  const dbSrc = boChuThich(doc(DB));
  const page = boChuThich(doc(PAGE));

  it("không import hàng chờ / điều kiện ứng viên / phân loại khoản của màn hoá đơn", () => {
    for (const nguon of [dbSrc, page]) {
      expect(dem(nguon, /from "\.\/(?:hang-cho|loc-hang-cho|du-dieu-kien|ngan-hang-cho|dong-hang-cho)"/)).toBe(0);
      expect(dem(nguon, /\bKHOAN_UNG_VIEN\b|\bphanLoaiKhoan\b|\bnapHangChoHoaDon\b|\bdieuKienDonHangCho\b/)).toBe(0);
    }
  });

  it("`nguonGiaoDich` chỉ dùng để GẮN NHÃN (hai chỗ gán vào `nhapLichSu`), không nằm trong `where`", () => {
    expect(dem(dbSrc, /\bnguonGiaoDich\(/)).toBe(2);
    expect(dem(dbSrc, /nhapLichSu: nguonGiaoDich\([^)]*\)\.loai === "LICH_SU"/)).toBe(2);
  });

  it("trang chỉ dùng `docBoLoc` + `chonCoSoLamViec` của bộ lọc CƠ SỞ (không lọc theo nguồn khoản)", () => {
    expect(page).toMatch(/import \{ chonCoSoLamViec, docBoLoc \} from "@\/lib\/finance\/hoa-don\/loc-hang-cho";/);
    expect(page).toMatch(/docBoLoc\(\{ coSo: sp\.coSo, thang: null \}, \{ phamViKeToan: phamViKeToan\(actor\)/);
  });
});

describe("[CTW-06] lối vào: màn nằm TRONG Hoá đơn điện tử (href literal), cổng trang, kho dùng chung với cron mồ côi", () => {
  it("trang Hoá đơn điện tử có link literal tới màn chứng từ; màn chứng từ có link quay về", () => {
    const hd = doc("app/(admin)/admin/payments/hoa-don/page.tsx");
    expect(hd).toMatch(/<Link href="\/payments\/hoa-don\/chung-tu-ngan-hang"/);
    expect(doc(PAGE)).toMatch(/<Link href="\/payments\/hoa-don"/);
  });

  it("cổng trang `payments:confirm` (không quyền mới); trang gác bằng `PAGE_GATES`", () => {
    expect(doc("lib/auth/page-gates.ts")).toMatch(/"\/payments\/hoa-don\/chung-tu-ngan-hang": \["payments:confirm"\],/);
    expect(doc(PAGE)).toMatch(/PAGE_GATES\["\/payments\/hoa-don\/chung-tu-ngan-hang"\]/);
    truocHon(boChuThich(doc(PAGE)), "laHoaDonBat()", "auth()");
  });

  it("cron dọn mồ côi coi `ChungTuNganHang.tepKhoa` là tham chiếu (db TRẦN, không lọc); kho liệt kê cả hai tiền tố", () => {
    const don = boChuThich(doc("lib/finance/hoa-don/don-tep-mo-coi.ts"));
    expect(dem(don, /db\.chungTuNganHang\.findMany\(\{ where: \{ tepKhoa: \{ not: null \} \}, select: \{ tepKhoa: true \} \}\)/)).toBe(1);
    expect(dem(don, /thamChieu\.add\(c\.tepKhoa\)/)).toBe(1);
    const kho = boChuThich(doc("lib/finance/hoa-don/kho-tep.ts"));
    expect(kho).toMatch(/for \(const Prefix of \[TIEN_TO_TEP_HOA_DON, TIEN_TO_CHUNG_TU_NGAN_HANG\]\)/);
    expect(kho).toMatch(/!k\.startsWith\(TIEN_TO_TEP_HOA_DON\) && !k\.startsWith\(TIEN_TO_CHUNG_TU_NGAN_HANG\)/);
  });

  it("kho chứng từ dùng bucket RIÊNG của hoá đơn (getter ném khi trùng bucket công khai) và không có hàm ký URL công khai", () => {
    const k = boChuThich(doc("lib/finance/hoa-don/kho-chung-tu.ts"));
    expect(dem(k, /Bucket: getHoaDonBucket\(\)/)).toBe(2);
    expect(dem(k, /const Bucket = getHoaDonBucket\(\);/)).toBe(1);
    expect(dem(k, /R2_PUBLIC_URL|publicUrl|cdn\./i)).toBe(0);
    expect(k).toMatch(/ResponseContentDisposition: `attachment;/);
  });
});

describe("[CTW-07] cách ly cơ sở: bảng mới khai đủ ba nơi; migration chỉ THÊM, có RLS, không đụng bảng đang có dữ liệu", () => {
  it("SCOPED_MODELS + getModelPrefixes (`payments:`) + BACKFILL_SPECS", () => {
    const sc = doc("lib/db-scope.ts");
    expect(dem(sc, /^\s+"ChungTuNganHang",$/m)).toBe(1);
    expect(sc).toMatch(/case "ChungTuNganHang":[^\n]*\n\s+return \["payments:"\];/);
    expect(doc("lib/org/center-bridge.ts")).toMatch(/model: "ChungTuNganHang",\s*\n\s*\/\/[^\n]*\n\s*nullMeaning: "BAT_BUOC",\s*\n\s*scoped: true,/);
  });

  it("migration: tạo enum + bảng + chỉ mục + FK Restrict tới Payment + RLS; không ALTER/DROP bảng nào khác", () => {
    const dir = readdirSync(resolve(process.cwd(), "prisma/migrations")).filter((d) => d.endsWith("_chung_tu_ngan_hang"));
    expect(dir).toHaveLength(1);
    const sql = boChuThich(doc(`prisma/migrations/${dir[0]}/migration.sql`).replace(/^--.*$/gm, ""));
    expect(dem(sql, /CREATE TYPE "ChungTuNganHangTrangThai" AS ENUM \('CHO_BO_SUNG', 'DA_TAI_LEN', 'DA_KIEM_TRA', 'CAN_BO_SUNG_LAI'\)/)).toBe(1);
    expect(dem(sql, /CREATE TABLE IF NOT EXISTS "ChungTuNganHang"/)).toBe(1);
    expect(dem(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "ChungTuNganHang_paymentId_key"/)).toBe(1);
    expect(sql).toMatch(/FOREIGN KEY \("paymentId"\) REFERENCES "Payment"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/);
    expect(sql).toMatch(/ALTER TABLE "ChungTuNganHang" ENABLE ROW LEVEL SECURITY;/);
    // mọi ALTER TABLE chỉ trên bảng của mình (khoá ngoại nằm ở bảng mới); không DROP / TRUNCATE / UPDATE / DELETE / INSERT
    for (const m of sql.matchAll(/ALTER TABLE "([^"]+)"/g)) expect(m[1]).toBe("ChungTuNganHang");
    expect(dem(sql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO|ADD COLUMN|ALTER COLUMN)\b/i)).toBe(0);
    expect(sql).toMatch(/CONSTRAINT "ChungTuNganHang_co_tep_check" CHECK \(\s*"trangThai" IN \('CHO_BO_SUNG', 'CAN_BO_SUNG_LAI'\) OR "tepKhoa" IS NOT NULL\s*\)/);
  });

  it("schema.prisma khớp migration: cùng bốn trạng thái, `paymentId @unique`, quan hệ Restrict", () => {
    const sch = doc("prisma/schema.prisma");
    const m = sch.slice(sch.indexOf("model ChungTuNganHang {"), sch.indexOf("model ChungTuNganHang {") + 2500);
    expect(m).toMatch(/paymentId\s+String\s+@unique/);
    expect(m).toMatch(/@relation\(fields: \[paymentId\], references: \[id\], onDelete: Restrict\)/);
    expect(m).toMatch(/centerId\s+String\n/);
    expect(sch).toMatch(/enum ChungTuNganHangTrangThai \{\s*CHO_BO_SUNG\s*DA_TAI_LEN\s*DA_KIEM_TRA\s*CAN_BO_SUNG_LAI\s*\}/);
  });
});
