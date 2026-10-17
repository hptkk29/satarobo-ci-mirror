// @vitest-environment node
/**
 * [HCX-W*] — LƯỚI GHIM MÃ NGUỒN cho «Hàng chờ cần xử lý» (R9 · T1). Hành vi đã có ca Postgres ở `tests/hoa-hong/hang-cho-xu-ly.spec.ts` (`[T1-*]`); ở đây là những thứ test hành vi
 * KHÔNG bắt được vì nó là "ai đó nối thêm một đường": một lời gọi ghi tiền thứ hai · một `UPDATE status` trực tiếp · nút vẽ bằng quyền khác action · cổng đặt SAU phép ghi.
 * Neo hẹp, bỏ chú thích TRƯỚC khi đếm, đếm SỐ LẦN (luật 11).
 *
 *   [HCX-W1] service là NƠI DUY NHẤT gọi `giaiHangCho`, và không có đường nào khác ghi sổ / đổi trạng thái hàng chờ ("không ép pass")
 *   [HCX-W2] thứ tự cổng trong `quyetXuLy`: phạm vi → trạng thái → xem trước → cấp duyệt → (đề nghị còn hạn → tách nhiệm → đúng chiều) → `giaiHangCho` có TRẦN TIỀN
 *   [HCX-W3] chế độ XEM TRƯỚC của `giaiHangCho` không ghi gì: không mở kỳ, dừng trước `khoaKyDeGhi`/`ghiChenhLech`; `tranTien` đứng trước phép ghi
 *   [HCX-W4] Server Action: đủ bốn hàm, quyền ĐỨNG ĐẦU, MỘT key = key của nút (luật 12)
 *   [HCX-W5] giao diện: `coTheXuLy` bắt buộc; nút CHỈ khi quyền ∧ có hành động làm được; component không tự xét mã hàng chờ; hộp thoại chỉ gọi đúng bốn action
 *   [HCX-W6] điều phối: cờ engine/mốc cutover TRƯỚC mọi thao tác; không import DB/ghi trực tiếp
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const boChuThich = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const doc = (p: string): string => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n"));
const dem = (s: string, mau: RegExp): number => (s.match(new RegExp(mau.source, mau.flags.includes("g") ? mau.flags : `${mau.flags}g`)) ?? []).length;

/** Thân `export async function <ten>(...) { ... }` — đếm ngoặc. */
function thanHam(src: string, ten: string): string {
  const bat = src.indexOf(`export async function ${ten}(`);
  if (bat < 0) throw new Error(`thiếu hàm ${ten}`);
  let i = src.indexOf("(", bat);
  let sau = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") sau++;
    else if (src[i] === ")" && --sau === 0) break;
  }
  const mo = src.indexOf("{\n", i); // thân hàm = dấu `{` đầu tiên cuối dòng sau ngoặc tham số (kiểu trả về có `{ … }` thì cùng dòng)
  let n = 0;
  for (let j = mo; j < src.length; j++) {
    if (src[j] === "{") n++;
    else if (src[j] === "}" && --n === 0) return src.slice(mo + 1, j);
  }
  throw new Error(`không đóng được ngoặc ${ten}`);
}

const SERVICE = "lib/hoa-hong/hang-cho-xu-ly-service.ts";
const PURE = "lib/hoa-hong/hang-cho-xu-ly.ts";
const HANH_DONG = "lib/hoa-hong/hang-cho-xu-ly-hanh-dong.ts";
const SO = "app/(admin)/admin/nguon-hoa-hong/so";
const ACTION = `${SO}/_actions-hang-cho.ts`;
const NUT = `${SO}/_components/nut-xu-ly-hang-cho.tsx`;
const BANG = `${SO}/_components/hang-cho-so-bang.tsx`;
const PAGE = `${SO}/page.tsx`;
const GIAI = "lib/hoa-hong/giai-hang-cho.ts";
const KEY = "commission_periods:manage";

describe("[HCX-W1] service là nơi DUY NHẤT gọi `giaiHangCho`; không đường ghi sổ / đổi trạng thái hàng chờ nào khác", () => {
  const service = doc(SERVICE);
  const tatCa = [SERVICE, PURE, HANH_DONG, ACTION].map((p) => [p, doc(p)] as const);

  it("ĐÚNG hai lời gọi `giaiHangCho(`: xem trước và ghi — lời gọi thứ ba là một đường ghi tiền mới", () => {
    expect(dem(service, /\bgiaiHangCho\(/g)).toBe(2);
    expect(dem(service, /xemTruoc: true/g)).toBe(1);
    // lần ghi nằm trong `quyetXuLy`, lần xem trước nằm trong `chayXemTruoc`
    expect(dem(thanHam(service, "quyetXuLy"), /\bgiaiHangCho\(/g)).toBe(1);
    expect(dem(service.slice(service.indexOf("async function chayXemTruoc(")), /\bgiaiHangCho\(/g)).toBeGreaterThanOrEqual(1);
  });

  it("không tệp nào của luồng này ghi sổ hoặc đổi trạng thái hàng chờ trực tiếp (chỉ `writeAudit` cho đề nghị / xem tay)", () => {
    for (const [p, ma] of tatCa) {
      expect(ma, p).not.toMatch(/commissionTransaction\s*\.\s*(create|createMany|update|updateMany|delete|deleteMany|upsert)/);
      expect(ma, p).not.toMatch(/commissionHold\s*\.\s*(create|createMany|update|updateMany|delete|deleteMany|upsert)/);
      expect(ma, p).not.toMatch(/\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe/);
      expect(ma, p).not.toMatch(/ghiChenhLech\(|ghiDong\(|chayTrongKhoa\(/);
    }
    expect(dem(service, /\bwriteAudit\(/g)).toBe(2); // RELEASE_REQUEST + ESCALATE_MANUAL — hai dấu vết, không đổi trạng thái
    expect(dem(service, /action: HANH_DONG_DE_NGHI/g)).toBe(1);
    expect(dem(service, /action: HANH_DONG_XEM_TAY/g)).toBe(1);
  });

  it("PHẠM VI GHI = nơi người này giữ ĐÚNG `commission_periods:manage` (không phải tầm nhìn gộp theo tiền tố `commission:`): cổng đứng cùng dòng với `passesScope`, key dùng chung một hằng", () => {
    const s = doc(SERVICE);
    expect(dem(s, /!coQuyenXuLyTai\(nguoi\.quyen, hold\.centerId\)/g)).toBe(1);
    expect(dem(s, /p\.action !== KEY_XU_LY_HANG_CHO/g)).toBe(1);
    expect(doc(PURE)).toMatch(/export const KEY_XU_LY_HANG_CHO = "commission_periods:manage" as const;/);
    expect(dem(doc(ACTION), /"commission_periods:manage"/g)).toBe(1); // action vẫn gõ chữ (lưới W4 đếm đúng 1) — hai nơi cùng giá trị, lưới này ghim hằng
  });

  it("luật thuần không import DB/Prisma runtime/audit (test được không cần DB; không đường ghi nào ẩn trong đó)", () => {
    const pure = doc(PURE);
    expect(pure).not.toMatch(/from "@\/lib\/db"|from "@\/lib\/audit/);
    expect(dem(pure, /from "@prisma\/client"/g)).toBe(1);
    expect(pure).toMatch(/^import type \{ CommissionHoldCode \} from "@prisma\/client";/m); // chỉ KIỂU — không kéo Prisma runtime
    expect(dem(pure, /^import /gm)).toBe(3); // @prisma/client (type), ./dieu-chinh, ./kieu
    expect(pure).not.toMatch(/new Date\(\)|Date\.now\(\)/); // luật 19: không đọc đồng hồ
  });
});

describe("[HCX-W2] thứ tự cổng trong `quyetXuLy` — mọi cổng TRƯỚC `giaiHangCho(`", () => {
  const q = thanHam(doc(SERVICE), "quyetXuLy");
  const vt = (m: string) => q.indexOf(m);

  it("mỗi cổng có mặt đúng MỘT lần", () => {
    for (const m of ["kiemLyDoVaBangChung(", "docHoldTrongPhamVi(", "huongXuLy(", "chayXemTruoc(", "quyetCapDuyet(", "deNghiConHieuLuc(", "loiNguoiDuyet(", "giaiHangCho("]) {
      expect(dem(q, new RegExp(m.replace(/[().]/g, "\\$&"), "g")), m).toBe(1);
    }
  });

  it("thứ tự: lý do/bằng chứng → phạm vi → trạng thái (idempotent) → hướng xử lý → xem trước → cấp duyệt → đề nghị → tách nhiệm → ghi", () => {
    const thu = ["kiemLyDoVaBangChung(", "docHoldTrongPhamVi(", 'hold.status !== "OPEN"', "huongXuLy(", "chayXemTruoc(", "quyetCapDuyet(", "deNghiConHieuLuc(", "loiNguoiDuyet(", "giaiHangCho("];
    const viTri = thu.map(vt);
    viTri.forEach((v, i) => expect(v, thu[i]).toBeGreaterThan(-1));
    expect([...viTri].sort((a, b) => a - b)).toEqual(viTri);
  });

  it("CẢ HAI nhánh một/hai người đều truyền trần `tranTien` vào `giaiHangCho`; nhánh một người cắt ở ngưỡng − 1", () => {
    expect(dem(q, /tranTien = i\.quyetDinh === "AP_DUNG" \? Math\.min\(i\.tienDaThay, \(nguong \?\? 0\) - 1\) : undefined/g)).toBe(1);
    expect(dem(q, /tranTien = i\.quyetDinh === "AP_DUNG" \? deNghi\.tien : undefined/g)).toBe(1);
    expect(dem(q, /\.\.\.\(tranTien !== undefined \? \{ tranTien \} : \{\}\)/g)).toBe(1);
  });

  it("tách nhiệm: người đề nghị ≠ người duyệt, và duyệt ĐÚNG chiều đã đề nghị (không đổi chiều ở cấp 2)", () => {
    expect(dem(q, /throw new HoaHongError\("CUNG_NGUOI"/g)).toBe(1);
    expect(dem(q, /throw new HoaHongError\("QUYET_DINH_KHAC_DE_NGHI"/g)).toBe(1);
    expect(dem(q, /throw new HoaHongError\("CAN_DE_NGHI_CAP_1"/g)).toBe(1);
  });

  it("'Giải phóng' mà xem trước báo cổng chặn ⇒ ném lại đúng lỗi đó; KHÔNG nuốt thành 'một người cũng được'", () => {
    expect(dem(q, /if \(i\.quyetDinh === "AP_DUNG" && !xem\.ok\) throw new HoaHongError\(xem\.ma, xem\.loi\)/g)).toBe(1);
  });

  it("cấp duyệt đọc ngưỡng THẲNG từ `SystemSetting` (không cache) — `docNguongDuyetHaiCap`, ba chỗ: xem trước · đề nghị · quyết", () => {
    expect(dem(doc(SERVICE), /docNguongDuyetHaiCap\(/g)).toBe(3);
    expect(doc(SERVICE)).not.toMatch(/getSetting\(/);
  });

  it("đề nghị chỉ lập khi CẦN hai người; dưới ngưỡng bị từ chối (không để cửa thứ hai lách 'một người')", () => {
    const d = thanHam(doc(SERVICE), "deNghiXuLy");
    expect(dem(d, /throw new HoaHongError\("KHONG_CAN_DE_NGHI"/g)).toBe(1);
    expect(d.indexOf('"KHONG_CAN_DE_NGHI"')).toBeLessThan(d.indexOf("writeAudit("));
    expect(d.indexOf("chayXemTruoc(")).toBeLessThan(d.indexOf("writeAudit("));
  });
});

describe("[HCX-W3] chế độ XEM TRƯỚC của `giaiHangCho` KHÔNG ghi; `tranTien` đứng TRƯỚC phép ghi", () => {
  const giai = doc(GIAI);
  const apDung = giai.slice(giai.indexOf("async function apDungInputDrift("), giai.indexOf("async function daoKhoanBiRut("));
  const dao = giai.slice(giai.indexOf("async function daoKhoanBiRut("));

  it("xem trước KHÔNG mở kỳ: `kyChanCua` (→ `bamKy`, một phép ghi) chỉ chạy khi KHÔNG xem trước — đúng 2 chỗ", () => {
    expect(dem(giai, /tuyChon\.xemTruoc \? null : await kyChanCua\(/g)).toBe(2);
    expect(dem(giai, /await kyChanCua\(/g)).toBe(2); // không còn lời gọi trần nào
  });

  it("cả hai nhánh: dừng ở `gomXemTruoc` → rồi `batTranTien` → rồi mới `khoaKyDeGhi` / `ghiChenhLech`", () => {
    for (const [ten, ma] of [["apDungInputDrift", apDung], ["daoKhoanBiRut", dao]] as const) {
      const a = ma.indexOf("if (tuyChon.xemTruoc) return gomXemTruoc(");
      const b = ma.indexOf("batTranTien(tuyChon");
      const c = ma.indexOf("h.khoaKyDeGhi(");
      const d = ma.indexOf("ghiChenhLech(");
      expect(a, `${ten}: xem trước`).toBeGreaterThan(-1);
      expect(b, `${ten}: trần`).toBeGreaterThan(a);
      expect(c, `${ten}: khoá kỳ`).toBeGreaterThan(b);
      expect(d, `${ten}: ghi`).toBeGreaterThan(b);
    }
  });

  it("'Giữ nguyên' + xem trước ⇒ trả rỗng TRƯỚC `$transaction` (không đóng hàng chờ)", () => {
    const g = giai.slice(giai.indexOf("async function giuNguyen("), giai.indexOf("// ── ÁP DỤNG: INPUT_DRIFT"));
    expect(g.indexOf("if (tuyChon.xemTruoc) return gomXemTruoc(")).toBeGreaterThan(-1);
    expect(g.indexOf("if (tuyChon.xemTruoc) return gomXemTruoc(")).toBeLessThan(g.indexOf("$transaction("));
  });

  it("ĐÓNG hàng chờ ở cả hai nhánh ghi đi qua `dongCoDieuKien` (updateMany `status: OPEN`, 0 dòng ⇒ throw ⇒ rollback cả dòng sổ) — không còn `commissionHold.update` vô điều kiện", () => {
    expect(dem(giai, /await dongCoDieuKien\(tx, hold\.id,/g)).toBe(2);
    expect(dem(giai, /commissionHold\.update\(/g)).toBe(0);
    expect(dem(giai, /commissionHold\.updateMany\(\{ where: \{ id: holdId, status: "OPEN" \}, data \}\)/g)).toBe(1);
    expect(dem(giai, /throw new HoaHongError\("TRANG_THAI_DA_DOI"/g)).toBeGreaterThanOrEqual(2); // giữ nguyên + đóng có điều kiện
  });

  it("lý do ≥ 10 ký tự chỉ được BỎ QUA khi xem trước — đường ghi vẫn bắt", () => {
    expect(dem(giai, /const lyDo = i\.xemTruoc \? i\.lyDo\.trim\(\) : batLyDoToiThieu\(/g)).toBe(1);
  });

  it("`batKy` (đề nghị · bằng chứng) vào audit CÙNG transaction với phép ghi — ở cả ba nơi ghi trạng thái", () => {
    expect(dem(giai, /\.\.\.batKyAudit\(tuyChon\)/g)).toBe(3);
  });
});

describe("[HCX-W4] Server Action: bốn hàm, quyền ĐỨNG ĐẦU, MỘT key", () => {
  const a = doc(ACTION);
  const TEN = ["xemTruocHangChoAction", "deNghiHangChoAction", "quyetHangChoAction", "chuyenXemTayHangChoAction"] as const;

  it("đúng bốn action được export (thêm action mới ⇒ phải vào lưới này)", () => {
    const ra = [...a.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);
    expect(ra).toEqual([...TEN]);
  });

  it("mỗi action: `vaoViec()` là lệnh `await` ĐẦU TIÊN; key quyền xuất hiện đúng một lần (trong `vaoViec`)", () => {
    for (const t of TEN) {
      const th = thanHam(a, t);
      expect(th.indexOf("await vaoViec()"), t).toBeGreaterThan(-1);
      expect(th.indexOf("await vaoViec()"), t).toBe(th.indexOf("await "));
    }
    expect(dem(a, new RegExp(`"${KEY}"`, "g"))).toBe(1);
    expect(dem(a, /assertPermission\(/g)).toBe(1);
    expect(dem(a, /await auth\(\)/g)).toBe(1);
  });

  it("quyền của NÚT = quyền của ACTION = quyền của tab Kỳ (cùng key, không đẻ quyền mới)", () => {
    expect(doc(PAGE)).toMatch(new RegExp(`const KEY_QUAN_LY_KY = "${KEY}"`));
    expect(doc("app/(admin)/admin/nguon-hoa-hong/ky/_actions.ts")).toMatch(new RegExp(`"${KEY}"`));
  });

  it("chỉ action ghi mới `lamMoi()`; xem trước (chỉ đọc) không làm mới trang", () => {
    expect(dem(thanHam(a, "xemTruocHangChoAction"), /lamMoi\(\)/g)).toBe(0);
    for (const t of ["deNghiHangChoAction", "quyetHangChoAction", "chuyenXemTayHangChoAction"] as const) expect(dem(thanHam(a, t), /lamMoi\(\)/g), t).toBe(1);
  });

  it("action không chạm DB/Prisma trực tiếp — chỉ điều phối", () => {
    expect(a).not.toMatch(/@\/lib\/db|@prisma\/client|commissionHold|commissionTransaction/);
  });
});

describe("[HCX-W5] giao diện: luật 11 (prop bắt buộc) · luật 12 (nút nói thật)", () => {
  const bang = doc(BANG);
  const nut = doc(NUT);
  const page = doc(PAGE);

  it("`coTheXuLy` là prop BẮT BUỘC (không `?`, không mặc định) ở bảng và ở dòng; trang truyền nó bằng ĐÚNG key quản lý kỳ", () => {
    expect(dem(bang, /coTheXuLy: boolean;/g)).toBe(2);
    expect(dem(bang, /coTheXuLy\?|coTheXuLy = /g)).toBe(0);
    expect(dem(page, /coTheXuLy=\{scope\.has\(KEY_QUAN_LY_KY\)\}/g)).toBe(1);
  });

  it("nút Xử lý chỉ vẽ khi quyền ∧ có hành động làm được (`huongXuLy`); trạng thái xử lý hiện cho mọi người xem", () => {
    expect(dem(bang, /coTheXuLy && d\.xuLy && \(d\.xuLy\.huong\.giaiPhong\.duoc \|\| d\.xuLy\.huong\.tuChoi\.duoc \|\| d\.xuLy\.huong\.chuyenXemTay\.duoc\)/g)).toBe(1);
    expect(dem(bang, /d\.xuLy && d\.xuLy\.trangThai !== "CHUA_XU_LY"/g)).toBe(1);
  });

  it("component KHÔNG tự xét mã hàng chờ hay tiền (một nguồn với server): không nhắc mã nào, không import DB", () => {
    for (const ma of [bang, nut]) {
      expect(ma).not.toMatch(/INPUT_DRIFT|PAYMENT_WITHDRAWN|MA_GIAI_DUOC|kiemGiaiHangCho|nguongDuyetHaiCap/);
      expect(ma).not.toMatch(/@\/lib\/db|@prisma\/client/);
    }
  });

  it("hộp thoại gọi ĐÚNG bốn action của tab Sổ, và mở ra là xin XEM TRƯỚC (không tự tính ở client)", () => {
    expect(nut.match(/import \{([^}]+)\} from "\.\.\/_actions-hang-cho"/)?.[1]?.split(",").map((x) => x.trim()).sort()).toEqual(["chuyenXemTayHangChoAction", "deNghiHangChoAction", "quyetHangChoAction", "xemTruocHangChoAction"]);
    expect(dem(nut, /xemTruocHangChoAction\(\{ holdId \}\)/g)).toBe(1);
    expect(nut).not.toMatch(/useEffect/); // xin xem trước trong trình xử lý bấm, không fetch bằng effect (luật «không useEffect cho data fetching»)
    expect(dem(nut, /type="button"/g)).toBe(dem(nut, /<button\b/g));
  });

  it("`choPhep` là prop BẮT BUỘC của nút; nút gửi bị khoá khi thiếu lý do/bằng chứng hoặc khi cổng chưa mở (giaiPhong chỉ khi xem trước `ok`)", () => {
    expect(dem(nut, /choPhep: \{ giaiPhong: boolean; tuChoi: boolean; chuyenXemTay: boolean \}/g)).toBe(1);
    expect(dem(nut, /const giaiPhongDuoc = choPhep\.giaiPhong && xem\?\.giaiPhong\.ok === true/g)).toBe(1);
    expect(dem(nut, /!duLyDo \|\|/g)).toBe(1);
    expect(dem(nut, /\(chon !== "XEM_TAY" && !duBangChung\)/g)).toBe(1);
  });

  it("dữ liệu dòng lấy từ MỘT hàm đọc: `docHangChoSo` gọi `docDauVetXuLy` đúng một lần và `huongXuLy` đúng một lần", () => {
    const d = doc("lib/hoa-hong/hang-cho-so-doc.ts");
    expect(dem(d, /docDauVetXuLy\(client/g)).toBe(1);
    expect(dem(d, /huongXuLy\(\{ code: r\.code/g)).toBe(1);
    expect(dem(d, /tienTiepXuc\(\{ code: r\.code/g)).toBe(1);
  });
});

describe("[HCX-W6] điều phối: cờ engine / mốc cutover TRƯỚC mọi thao tác", () => {
  const h = doc(HANH_DONG);
  it("bốn hàm điều phối đều đi qua `boiCanh(pt, …)` trước khi gọi service, và dịch lỗi không lộ chi tiết lạ", () => {
    for (const t of ["xemTruocHanhDong", "deNghiHanhDong", "quyetHanhDong", "chuyenXemTayHanhDong"] as const) {
      const th = thanHam(h, t);
      expect(th.indexOf("await boiCanh(pt, i.now)"), t).toBeGreaterThan(-1);
      expect(th.indexOf("await boiCanh(pt, i.now)"), t).toBeLessThan(Math.max(th.indexOf("Xu"), th.indexOf("(db"), 1) + 1000);
    }
    expect(dem(h, /LOI_LA/g)).toBe(1);
    // `e.message` chỉ được ra client khi `e` là `HoaHongError` (câu tiếng Việt do ta viết); lỗi lạ chỉ log TÊN lỗi.
    expect(dem(h, /e\.message/g)).toBe(1);
    expect(dem(h, /if \(e instanceof HoaHongError\) return thatBai\(e\.ma, e\.message\)/g)).toBe(1);
    expect(h).not.toMatch(/String\(e\)|JSON\.stringify\(e/);
  });
  it("điều phối không chạm bảng nào (không `db.commission*`) — chỉ truyền `db` cho service", () => {
    expect(h).not.toMatch(/db\.\w+\./);
  });
});
