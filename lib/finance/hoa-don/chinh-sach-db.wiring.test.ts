// Ca [CSDB-W*] — LƯỚI GHIM MÃ NGUỒN của dịch vụ chính sách (lát S7). THUẦN: đọc `chinh-sach-db.ts`, không DB.
//
// Vì sao cần riêng, ngoài `cong-truoc-phep-ghi.test.ts`: lưới đó chỉ nhìn callback của `$transaction(` / `ghiTienChoDon(`. Dịch vụ này bọc `$transaction`
// trong MỘT hàm `trongKhoa(phapNhanMa, async (tx) => …)` (khoá tư vấn nằm đúng một chỗ) — nên các callback `viec` KHÔNG vào tầm lưới kia (đã cấy thử 01/11/2026:
// chèn `return { ok: false …}` sau khoá ⇒ lưới cũ xanh). Lưới dưới thay phần đó: trong cả tệp chỉ MỘT chỗ được `return { ok: false` (khối `catch` của `chayGhi`),
// còn mọi từ chối khác là `throw`. Neo vào LỜI GỌI/biểu thức, bỏ chú thích, đếm SỐ LẦN (luật 11).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const ma = boChuThich(readFileSync(resolve(process.cwd(), "lib/finance/hoa-don/chinh-sach-db.ts"), "utf8"));
const dem = (re: RegExp, s = ma) => (s.match(re) ?? []).length;
/** Thân hàm xuất `export function <ten>` đến `export function` kế tiếp (hoặc hết tệp). */
const than = (ten: string): string => {
  const i = ma.search(new RegExp(`export (?:async )?function ${ten}\\b`));
  expect(i, `không thấy export function ${ten}`).toBeGreaterThanOrEqual(0);
  const sau = ma.slice(i + 10).search(/\nexport (?:function|async function|const|type)\b/);
  return sau < 0 ? ma.slice(i) : ma.slice(i, i + 10 + sau);
};

describe("[CSDB-W1] từ chối = throw: không có đường `return { ok: false` nào trong callback giao dịch", () => {
  it("cả tệp chỉ có HAI `return { ok: false`: khối catch của `chayGhi` và nhánh bắt lỗi ĐỌC của `docMoPhongChoBan` (đường đọc, không giao dịch); không `return fail(`", () => {
    const TU_CHOI = /\breturn\s*\{\s*ok:\s*false/g;
    expect(dem(TU_CHOI)).toBe(2);
    expect(dem(/\breturn\s+fail\s*\(/g)).toBe(0);
    const chayGhi = ma.slice(ma.indexOf("async function chayGhi"), ma.indexOf("/** Tóm tắt dòng"));
    expect(dem(TU_CHOI, chayGhi)).toBe(1);
    expect(chayGhi).toMatch(/catch\s*\(e\)[\s\S]*instanceof TuChoiChinhSach/);
    const docMp = than("docMoPhongChoBan");
    expect(dem(TU_CHOI, docMp)).toBe(1);
    expect(docMp).not.toMatch(/trongKhoa|\$transaction|\btx\./);
    // Mọi chỗ còn lại (tức mọi nơi có thể nằm trong callback giao dịch) KHÔNG có `return { ok: false`.
    expect(dem(TU_CHOI, ma.replace(chayGhi, "").replace(docMp, ""))).toBe(0);
  });
  it("một chỗ duy nhất mở `$transaction`, một chỗ duy nhất lấy khoá tư vấn theo PHÁP NHÂN; năm hàm ghi đều đi qua `trongKhoa`", () => {
    expect(dem(/\bdb\.\$transaction\s*\(/g)).toBe(1);
    expect(dem(/pg_advisory_xact_lock/g)).toBe(1);
    expect(ma).toMatch(/"hoa-don-chinh-sach:"\s*\+\s*phapNhanMa/);
    expect(dem(/\bawait\s+trongKhoa\s*\(|\breturn\s+trongKhoa\s*\(/g)).toBe(5);
  });
});

describe("[CSDB-W2] cổng đứng TRƯỚC phép ghi, đúng vị từ dùng chung", () => {
  it("taoNhap: kiểm phạm vi + pháp nhân + nội dung + lý do TRƯỚC khi vào giao dịch", () => {
    const t = than("taoNhap");
    const vao = t.indexOf("trongKhoa(");
    for (const cong of ["canGhi(i.actor", "phapNhanHopLe.includes", "kiemKhoangHieuLuc(", "phanTichNoiDung(", "kiemLyDo("]) {
      const k = t.indexOf(cong);
      expect(k, cong).toBeGreaterThanOrEqual(0);
      expect(k, `${cong} phải đứng trước giao dịch`).toBeLessThan(vao);
    }
  });
  it("duyet: kiemChuyen + kiemChongHoPhienBan + kiemBoSauKhiThem đứng TRƯỚC ghiChuyen; canDuyet đứng trước giao dịch", () => {
    const t = than("duyet");
    const ghi = t.indexOf("ghiChuyen(");
    expect(t.indexOf("canDuyet(i.actor)")).toBeLessThan(t.indexOf("trongKhoa("));
    for (const cong of ["kiemChuyen(", "kiemChongHoPhienBan(", "kiemBoSauKhiThem(", "dungMoPhong("]) {
      expect(t.indexOf(cong), cong).toBeGreaterThanOrEqual(0);
      expect(t.indexOf(cong), `${cong} phải đứng trước ghiChuyen`).toBeLessThan(ghi);
    }
    expect(t).toMatch(/moPhong:\s*\{\s*hashUi:\s*i\.hashMoPhongUi,\s*hashServer:\s*mp\.hash\s*\}/);
    // Luật «người duyệt ≠ người soạn» ĐÃ BỎ (02/11/2026): `kiemChuyen` không còn nhận danh tính — lưới đòi cho CHẮC chưa ai gắn lại.
    expect(t).not.toMatch(/nguoiTaoId|nguoiThaoTacId/);
    expect(t).toMatch(/nguoiDuyetId:\s*i\.actor\.userId/); // vẫn truy vết ai duyệt
  });
  it("mỗi hàm chuyển trạng thái gọi `kiemChuyen` đúng 1 lần với ĐÍCH đúng; guiDuyet/tuChoi/hetHieuLuc có vị từ quyền", () => {
    expect(dem(/\bkiemChuyen\s*\(\s*cu\.trangThai,\s*"CHO_DUYET"/g, than("guiDuyet"))).toBe(1);
    expect(dem(/\bkiemChuyen\s*\(\s*cu\.trangThai,\s*"HIEU_LUC"/g, than("duyet"))).toBe(1);
    expect(dem(/\bkiemChuyen\s*\(\s*cu\.trangThai,\s*"TU_CHOI"/g, than("tuChoi"))).toBe(1);
    expect(dem(/\bkiemChuyen\s*\(\s*cu\.trangThai,\s*"HET_HIEU_LUC"/g, than("hetHieuLuc"))).toBe(1);
    expect(dem(/\bcanGhi\s*\(/g, than("guiDuyet"))).toBe(1);
    for (const f of ["duyet", "tuChoi", "hetHieuLuc"]) expect(dem(/\bcanDuyet\s*\(\s*i\.actor\s*\)/g, than(f)), f).toBe(1);
    expect(dem(/\bcanDuyet\s*\(\s*i\.actor\s*\)/g)).toBe(3);
  });
  it("tầm nhìn: dòng đọc lại trong khoá qua `passesScope` (đúng 1 chỗ — `docBanTrongKhoa`); mọi hàm ghi đọc bản qua nó", () => {
    expect(dem(/\bpassesScope\s*\(/g)).toBe(1);
    for (const f of ["guiDuyet", "duyet", "tuChoi", "hetHieuLuc"]) expect(dem(/\bdocBanTrongKhoa\s*\(\s*tx,\s*i\.actor,\s*i\.id\s*\)/g, than(f)), f).toBe(1);
  });
});

describe("[CSDB-W3] ghi: một `create`, một `updateMany` CÓ ĐIỀU KIỆN; không bao giờ sửa nội dung", () => {
  it("đúng 1 `create` (tạo nháp, tự set centerId) và 1 `updateMany` (đổi trạng thái); không update/delete/upsert khác", () => {
    expect(dem(/\btx\.hoaDonChinhSach\.create\s*\(/g)).toBe(1);
    expect(dem(/\btx\.hoaDonChinhSach\.updateMany\s*\(/g)).toBe(1);
    expect(dem(/\btx\.hoaDonChinhSach\.(?:update|upsert|delete|deleteMany|createMany)\s*\(/g)).toBe(0);
    expect(than("taoNhap")).toMatch(/centerId:\s*i\.centerId/);
    expect(than("taoNhap")).toMatch(/trangThai:\s*"NHAP"/);
    expect(than("taoNhap")).toMatch(/nguoiTaoId:\s*i\.actor\.userId/);
  });
  it("`updateMany` có điều kiện id + trangThai + phienBan và đổi 0 dòng ⇒ throw; dữ liệu ghi KHÔNG chứa noiDung", () => {
    const g = ma.slice(ma.indexOf("async function ghiChuyen"), ma.indexOf("/** NHAP → CHO_DUYET."));
    expect(g).toMatch(/where:\s*\{\s*id:\s*cu\.id,\s*trangThai:\s*cu\.trangThai,\s*phienBan:\s*cu\.phienBan\s*\}/);
    expect(g).toMatch(/upd\.count\s*===\s*0\)\s*throw\s+new\s+TuChoiChinhSach/);
    const data = g.slice(g.indexOf("data:"), g.indexOf("});", g.indexOf("data:")));
    expect(data).not.toMatch(/noiDung/);
  });
  it("mọi ghi đi kèm AuditLog trong CÙNG giao dịch (`writeAudit({ tx,`) — 2 chỗ: tạo và chuyển trạng thái; lý do đi vào `reason`", () => {
    expect(dem(/\bwriteAudit\s*\(\s*\{\s*tx,/g)).toBe(2);
    expect(dem(/\breason:\s*lyDo\b/g)).toBe(2);
  });
});

describe("[CSDB-W4] docHieuLuc: đọc cả bản đã kết thúc; dịch vụ không đọc cột nhạy cảm của cấu hình cơ sở", () => {
  it("lọc trạng thái gồm HIEU_LUC và HET_HIEU_LUC (bản đã kết thúc vẫn đúng cho ngày trong khoảng)", () => {
    expect(than("docHieuLuc")).toMatch(/trangThai:\s*\{\s*in:\s*\["HIEU_LUC",\s*"HET_HIEU_LUC"\]\s*\}/);
  });
  it("tệp dịch vụ không nhắc `cauHinhHoaDonCoSo` (cột nhạy cảm chỉ đọc ở tệp riêng)", () => {
    expect(ma).not.toMatch(/cauHinhHoaDonCoSo/);
  });
});
