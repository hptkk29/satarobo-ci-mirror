// Ca [PPW-*] — LƯỚI GHIM MÃ NGUỒN của đường phân phối hoá đơn đã phát hành (Invoice Hub S10).
//
// Hành vi (cô lập cơ sở, sở hữu phụ huynh, trạng thái, cờ, audit, mã HTTP) đo trên Postgres thật ở `tests/finance/hoa-don-phan-phoi-db.test.ts`.
// Lưới này khoá điều test hành vi không chứng minh được vì là thứ mã KHÔNG làm / làm ở ĐÚNG chỗ:
//   · thứ tự cổng trong `moTepChoNguoiXem`: sở hữu → trạng thái → cờ → kho → AUDIT → đọc byte (đảo là rò byte khi audit hỏng / khi cờ tắt);
//   · không có đường nào đọc `HoaDonDienTu`/`Order` bằng `db` trần trong loader; phụ huynh luôn đi qua `portalDb` + điều kiện sở hữu viết trong `where`;
//   · route không redirect tới URL ký, không trả XML, không `console.log`, không nhắc `studentId`;
//   · view-model và audit không mang khoá lưu trữ;
//   · không có nơi gọi lạc ngoài các điểm đã định.
// Cách viết (CLAUDE.md "lưới ghim mã nguồn"): đọc mã đã BÓC chú thích; neo vào lời gọi / biểu thức; đếm SỐ LẦN khớp; mỗi ca đã cấy lỗi để thấy ĐỎ.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
const doc = (f: string) => boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
const dem = (src: string, re: RegExp) => src.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))?.length ?? 0;

const DIR = "lib/finance/hoa-don";
const DB = `${DIR}/phan-phoi-db.ts`;
const DOC = `${DIR}/phan-phoi-doc.ts`;
const TEP = `${DIR}/phan-phoi-tep.ts`;
const ROUTE = "app/api/hoa-don/[id]/tai-pdf/route.ts";
const TRANG_PH = "app/(portal)/portal/hoc-phi/page.tsx";
const KHOI_PH = "app/(portal)/portal/hoc-phi/_components/hoa-don-dien-tu.tsx";
// Khối Sale MỚI đã GỠ (02/11/2026): màn đơn đã có `KhoiHoaDon` (GĐ 7) cho Sale, component này không nối vào trang nào và sẽ trùng khối cũ.
// Giữ tên ở đây CHỈ để lưới [PPW-5b] canh nó không quay lại âm thầm (quay lại = hai khối hoá đơn cho Sale; OD-12 là quyết định của owner).
const KHOI_SALE_DA_GO = "app/(admin)/admin/orders/_components/hoa-don-da-phat-hanh.tsx";

/** Thân hàm `moTepChoNguoiXem` (đến hết tệp — đây là hàm cuối). */
function thanMoTep(src: string): string {
  const i = src.search(/export async function moTepChoNguoiXem\(/);
  expect(i).toBeGreaterThan(-1);
  return src.slice(i);
}

describe("[PPW-1] thứ tự cổng khi tải: sở hữu → trạng thái → cờ → kho → audit → đọc byte", () => {
  const than = thanMoTep(doc(DB));
  const vt = (re: RegExp) => than.search(re);
  it("mỗi cổng xuất hiện đúng MỘT lần trong hàm", () => {
    for (const re of [/\btimHoaDonChoNguoiTai\(/, /\bchoPhepTaiPdf\(/, /\blaHubPhanPhoiBatChoCoSo\(hd\.centerId\)/, /\bkhoHoaDonDaCauHinh\(\)/, /\bwriteAudit\(/, /\bdocPdfHoaDon\(/]) {
      expect(dem(than, re), String(re)).toBe(1);
    }
  });
  it("đúng thứ tự: tìm < trạng thái < cờ < kho < audit < đọc byte", () => {
    const thuTu = [/\btimHoaDonChoNguoiTai\(/, /\bchoPhepTaiPdf\(/, /\blaHubPhanPhoiBatChoCoSo\(hd\.centerId\)/, /\bkhoHoaDonDaCauHinh\(\)/, /\bwriteAudit\(/, /\bdocPdfHoaDon\(/].map(vt);
    expect([...thuTu].sort((a, b) => a - b)).toEqual(thuTu);
    expect(thuTu.every((x) => x > -1)).toBe(true);
  });
  it("audit ném ⇒ trả AUDIT_LOI (không rơi xuống đọc byte); cờ lấy theo cơ sở của CHÍNH hoá đơn, không cờ toàn hệ", () => {
    expect(dem(than, /\} catch \{\s*return \{ ok: false, ma: "AUDIT_LOI" \};\s*\}/)).toBe(1);
    expect(dem(doc(DB), /\blaHubPhanPhoiBatChoCoSo\(/)).toBe(3); // Sale-list, PH-list (cơ sở của con), coBatTheoCoSo — không có bản gọi trần nào khác
    expect(dem(doc(DB), /\blaHubQuetBat\(\)|\blaHoaDonBat\(\)/)).toBe(0);
  });
  it("audit chỉ ghi: loai · kenh · trangThai · orderId — không khoá kho, không studentId, không URL", () => {
    const i = than.search(/\bwriteAudit\(/);
    const khoi = than.slice(i, than.search(/orgUnitId: hd\.orgUnitId/));
    expect(dem(khoi, /newValues:\s*\{ loai: "pdf", kenh: [^}]*trangThai: hd\.trangThai, orderId: hd\.orderId \}/)).toBe(1);
    expect(dem(khoi, /tepPdfKey|studentId|url|khoa/i)).toBe(0);
  });
});

describe("[PPW-2] sở hữu: loader không dùng `db` trần; phụ huynh qua portalDb + điều kiện trong where", () => {
  const nguon = doc(DB);
  it("không import `@/lib/db` (chỉ `scopedDb` và `portalDb`)", () => {
    expect(dem(nguon, /from "@\/lib\/db"/)).toBe(0);
    expect(dem(nguon, /\bdb\.(hoaDonDienTu|order|student|payment)\b/)).toBe(0);
  });
  it("Sale: đọc qua `scopedDb(actor).order` (đúng 2 chỗ: danh sách + tải), KHÔNG qua `scopedDb(...).hoaDonDienTu`; tải còn đòi view-pii đúng cơ sở", () => {
    expect(dem(nguon, /\bscopedDb\(\w+(?:\.\w+)?\)\.order\./)).toBe(2);
    expect(dem(nguon, /\bscopedDb\([^)]*\)\.hoaDonDienTu/)).toBe(0);
    expect(dem(nguon, /\bcoQuyenXemPiiTaiCoSo\(/)).toBe(3); // định nghĩa + danh sách + tải
    expect(dem(nguon, /if \(!nguoi\.xemPii\) return null;/)).toBe(1);
  });
  it("phụ huynh: con lấy lại từ DB qua portalDb(owner).student; hoá đơn lọc trạng thái + không mô phỏng + có PDF + đơn chưa xoá + liên kết con", () => {
    expect(dem(nguon, /\bportalDb\(owner\)/)).toBe(1);
    expect(dem(nguon, /pdb\.student\.findMany\(\{ where: \{ id: \{ in: owner\.childIds \}, deletedAt: null \}/)).toBe(1);
    expect(dem(nguon, /trangThai: "DA_XAC_NHAN",\s*nguonPhatHanh: \{ not: "MISA_GIA_LAP" \},\s*tepPdfKey: \{ not: null \},\s*order: \{ deletedAt: null \},\s*OR: lienKetCon\(/)).toBe(1);
    expect(dem(nguon, /\bhoaDonThuocPhuHuynh\(/)).toBe(1);
    expect(dem(nguon, /if \(opts\.conDangChon !== null && !conCua\.includes\(opts\.conDangChon\)\) return \[\];/)).toBe(1);
  });
  it("bốn đường nối hoá đơn → con đều có: Order.studentId · OrderItem.studentId · khoản→ghi danh · khoản→dòng hàng", () => {
    expect(dem(nguon, /\{ order: \{ studentId: \{ in:/)).toBe(1);
    expect(dem(nguon, /\{ order: \{ items: \{ some: \{ studentId: \{ in:/)).toBe(1);
    expect(dem(nguon, /payment: \{ enrollment: \{ studentId: \{ in:/)).toBe(1);
    expect(dem(nguon, /payment: \{ orderItem: \{ studentId: \{ in:/)).toBe(1);
    expect(dem(nguon, /khoan: \{ some: \{ hieuLuc: true,/)).toBe(2);
  });
});

describe("[PPW-3] khoá lưu trữ không ra khỏi tầng đọc", () => {
  it("luật thuần không biết `tepPdfKey`; view-model dựng từng trường (không spread bản ghi DB)", () => {
    expect(dem(doc(DOC), /tepPdfKey|tepXmlKey|maTraCuu|phapNhanMst|studentId/)).toBe(0);
    const nguon = doc(DB);
    expect(dem(nguon, /\{\s*\.\.\.(?:r|hd|h|don)\b/)).toBe(0);
    expect(dem(nguon, /coTepPdf: typeof r\.tepPdfKey === "string" && r\.tepPdfKey\.length > 0/)).toBe(1);
  });
  it("khoá chỉ được dùng ở MỘT chỗ để đọc byte: `docPdfHoaDon(hd.tepPdfKey)`", () => {
    expect(dem(doc(DB), /\bdocPdfHoaDon\(hd\.tepPdfKey\)/)).toBe(1);
    expect(dem(doc(DB), /\bhd\.tepPdfKey\b/)).toBe(2); // điều kiện + đối số
  });
  it("tầng đọc kho: đúng một GetObject, kiểm cỡ + vân tay PDF, không ký URL, không log", () => {
    const t = doc(TEP);
    expect(dem(t, /new GetObjectCommand\(/)).toBe(1);
    expect(dem(t, /TRAN_CO_TEP\.pdf/)).toBe(1);
    expect(dem(t, /vanTayHoaDon\("pdf", than\)/)).toBe(1);
    expect(dem(t, /getSignedUrl|kyUrl|console\./)).toBe(0);
  });
});

describe("[PPW-4] route: không redirect, không XML, không log, không studentId, header riêng tư", () => {
  const r = doc(ROUTE);
  it("không chuyển hướng tới URL ký; không loại tệp XML", () => {
    expect(dem(r, /NextResponse\.redirect|redirect\(|kyUrl|getSignedUrl|Location/)).toBe(0);
    expect(dem(r, /xml|tai-ve|loai=/i)).toBe(0);
  });
  it("không console.*; không nhắc studentId; không nhận id học viên từ URL (chỉ `params.id` là hoá đơn)", () => {
    expect(dem(r, /\bconsole\./)).toBe(0);
    expect(dem(r, /studentId/)).toBe(0);
    expect(dem(r, /searchParams|nextUrl|\.url\b/)).toBe(0);
  });
  it("Cache-Control private, no-store ở CẢ lỗi lẫn thành công", () => {
    expect(dem(r, /"Cache-Control": "private, no-store"/)).toBe(2);
  });
  it("cổng nhân viên đòi CẢ hai quyền; phụ huynh lấy con từ phiên; hai lượt mở (nhân viên rồi phụ huynh), mỗi lượt đúng kênh", () => {
    expect(dem(r, /checkPermission\("orders:view"\)/)).toBe(1);
    expect(dem(r, /checkPermission\("orders:view-pii"\)/)).toBe(1);
    expect(dem(r, /const laNhanVien = xemDon && xemPii;/)).toBe(1);
    expect(dem(r, /\bmoTepChoNguoiXem\(/)).toBe(2);
    expect(dem(r, /loai: "NHAN_VIEN"/)).toBe(1);
    expect(dem(r, /loai: "PHU_HUYNH"/)).toBe(1);
    expect(dem(r, /childIds: ctxPhuHuynh\.children\.map\(\(c\) => c\.id\)/)).toBe(1);
    expect(dem(r, /if \(!kq\.ok && kq\.ma === "KHONG_TIM_THAY" && ctxPhuHuynh\)/)).toBe(1);
  });
  it("401 chỉ khi chưa đăng nhập; 403 chỉ khi không là nhân viên có quyền lẫn phụ huynh; thông điệp 404 duy nhất", () => {
    expect(dem(r, /loi\(401,/)).toBe(1);
    expect(dem(r, /loi\(403,/)).toBe(1);
    expect(dem(r, /if \(!laNhanVien && !ctxPhuHuynh\) return loi\(403,/)).toBe(1);
    expect(dem(r, /loi\(404,/)).toBe(1);
  });
  it("phiên: dùng getPortalContext (không redirect), KHÔNG requireActiveStudent", () => {
    expect(dem(r, /\bgetPortalContext\(\)/)).toBe(1);
    expect(dem(r, /requireActiveStudent/)).toBe(0);
  });
});

describe("[PPW-5] giao diện: khối chỉ-đọc, không nút ngoài tải PDF, không dựng URL từ học viên", () => {
  it("khối phụ huynh: không XML, không «gửi lại», không studentId; liên kết lấy từ view-model", () => {
    for (const f of [KHOI_PH]) {
      const c = doc(f);
      expect(dem(c, /xml|gửi lại|studentId|tepPdfKey|"use server"|onClick/i), f).toBe(0);
      expect(dem(c, /href=\{d\.taiPdf\}/), f).toBe(1);
    }
  });
  it("[PPW-5b] KHÔNG có khối hoá đơn Sale thứ hai: component Sale mới đã gỡ và trang chi tiết đơn không gọi `docHoaDonChoDon`", () => {
    expect(existsSync(resolve(process.cwd(), KHOI_SALE_DA_GO)), "khối Sale trùng `KhoiHoaDon` đã quay lại").toBe(false);
    expect(dem(doc("app/(admin)/admin/orders/[id]/page.tsx"), /\bdocHoaDonChoDon\(|HoaDonDaPhatHanh/)).toBe(0);
  });
  it("trang Học phí: khối hoá đơn chỉ ở nhánh V2, một lần, song song với học phí, lỗi không làm hỏng trang, con lấy từ phiên", () => {
    const t = doc(TRANG_PH);
    expect(dem(t, /\bdocHoaDonChoPhuHuynh\(/)).toBe(1);
    expect(dem(t, /<HoaDonDienTuPhuHuynh khoi=\{hoaDon\} \/>/)).toBe(1);
    const v2 = t.slice(t.search(/if \(isPortalV2Enabled\(\)\)/), t.search(/const \{ enrollments, receipts, totals, flags \}/));
    expect(dem(v2, /\bdocHoaDonChoPhuHuynh\(/)).toBe(1);
    expect(dem(v2, /const \[data, hoaDon\] = await Promise\.all\(\[/)).toBe(1);
    expect(dem(v2, /\.catch\(/)).toBe(1);
    expect(dem(v2, /childIds: ctx\.children\.map\(\(c\) => c\.id\)/)).toBe(1);
    expect(dem(v2, /\bstudentId,\s*\n?\s*ctx\.activeStudent\?\.centerId \?\? null/)).toBe(1);
    // nhánh V1 (sau khối V2) không có gì của hoá đơn
    expect(dem(t.slice(t.search(/const \{ enrollments, receipts, totals, flags \}/)), /HoaDon|hoaDon/)).toBe(0);
  });
});

describe("[PPW-6] không đồng hồ thật, không console.log, không lời gọi lạc", () => {
  it("luật thuần & loader không đọc đồng hồ", () => {
    for (const f of [DOC, DB, TEP]) expect(dem(doc(f), /\bDate\.now\s*\(|\bnew Date\s*\(\s*\)/), f).toBe(0);
  });
  it("không `console.log` ở bất kỳ tệp nào của lát này", () => {
    for (const f of [DOC, DB, TEP, ROUTE, KHOI_PH]) expect(dem(doc(f), /\bconsole\.log\b/), f).toBe(0);
  });
  it("`moTepChoNguoiXem(` / `docHoaDonChoPhuHuynh(` / `docHoaDonChoDon(` chỉ được gọi ở các điểm đã định", () => {
    const ra = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "lib", "app", "components"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const tep = ra.split(/\r?\n/).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
    const goi = (re: RegExp) => tep.filter((f) => dem(doc(f), re) > 0).sort();
    expect(goi(/\bmoTepChoNguoiXem\(/)).toEqual([DB, ROUTE].sort());
    expect(goi(/\bdocHoaDonChoPhuHuynh\(/)).toEqual([DB, TRANG_PH].sort());
    // trang chi tiết đơn do lead nối sau — được phép có hoặc chưa có, nhưng không nơi nào khác
    const sale = goi(/\bdocHoaDonChoDon\(/);
    expect(sale.every((f) => f === DB || f === "app/(admin)/admin/orders/[id]/page.tsx")).toBe(true);
    expect(sale).toContain(DB);
  });
});
