// lib/enrollments/di-theo-gia-va-tien.test.ts — [DTGV-*] LUẬT «giá + khoản thu đi theo ghi danh mới khi chuyển lớp cùng khoá» (THUẦN) + LƯỚI GHIM DÂY NỐI (P7-G2, 27/10/2026).
//
// Phần đầu khẳng định HÀNH VI của `xetDiTheoGiaVaTien`. Phần sau là lưới ghim mã nguồn cho chỗ test hành vi không với tới (ai gọi với chế độ nào, hàm DB không chạm chứng từ):
// neo vào LỜI GỌI + số lần khớp, không neo cách đặt chữ (bài học `[NDC-07]`). Hành vi chạm DB: tests/finance/chuyen-lop-giu-gia-va-tien.test.ts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GIA_TRONG, giaTrong, noCua, xetDiTheoGiaVaTien } from "./di-theo-gia-va-tien";

const GIA = { listPrice: 5_280_000, discountType: "PERCENT", discountAmount: 264_000, tuition: 5_016_000, finalPrice: 5_016_000 };
const goc = { khoaCu: "K1", khoaMoi: "K1", giaCu: GIA, giaMoi: GIA_TRONG, soKhoanCu: 2, soHoanTienBaoLuuCu: 0 };

describe("[DTGV] xetDiTheoGiaVaTien", () => {
  it("[DTGV-01] ĐỐI CHỨNG DƯƠNG: cùng khoá, ghi danh mới trống, ghi danh cũ có giá + khoản ⇒ mang đi", () => {
    expect(xetDiTheoGiaVaTien(goc)).toEqual({ lam: true });
  });
  it("[DTGV-02] khác khoá ⇒ không mang (đổi khoá F4 có học phí mới)", () => {
    expect(xetDiTheoGiaVaTien({ ...goc, khoaMoi: "K2" })).toEqual({ lam: false, ma: "KHAC_KHOA" });
  });
  it("[DTGV-03] có yêu cầu hoàn / bảo lưu ở ghi danh cũ ⇒ không mang, để kế toán xử lý", () => {
    expect(xetDiTheoGiaVaTien({ ...goc, soHoanTienBaoLuuCu: 1 })).toEqual({ lam: false, ma: "CO_HOAN_TIEN_HOAC_BAO_LUU" });
  });
  it("[DTGV-04] ghi danh mới đã có giá (dù chỉ MỘT cột) ⇒ không mang, không ghi đè", () => {
    expect(xetDiTheoGiaVaTien({ ...goc, giaMoi: { ...GIA_TRONG, finalPrice: 1 } })).toEqual({ lam: false, ma: "GHI_DANH_MOI_DA_CO_GIA" });
    expect(xetDiTheoGiaVaTien({ ...goc, giaMoi: { ...GIA_TRONG, discountType: "PERCENT" } })).toEqual({ lam: false, ma: "GHI_DANH_MOI_DA_CO_GIA" });
  });
  it("[DTGV-05] ghi danh cũ không giá và không khoản ⇒ không có gì để mang; có khoản mà không giá ⇒ vẫn mang khoản; có giá mà không khoản ⇒ vẫn mang giá", () => {
    expect(xetDiTheoGiaVaTien({ ...goc, giaCu: GIA_TRONG, soKhoanCu: 0 })).toEqual({ lam: false, ma: "KHONG_CO_GI_DE_MANG" });
    expect(xetDiTheoGiaVaTien({ ...goc, giaCu: GIA_TRONG, soKhoanCu: 1 })).toEqual({ lam: true });
    expect(xetDiTheoGiaVaTien({ ...goc, soKhoanCu: 0 })).toEqual({ lam: true });
  });
  it("[DTGV-06] thứ tự kiểm: khác khoá thắng mọi lý do khác (không báo «cần kế toán» cho ca vốn không thuộc luật)", () => {
    expect(xetDiTheoGiaVaTien({ ...goc, khoaMoi: "K2", soHoanTienBaoLuuCu: 3, giaMoi: GIA })).toEqual({ lam: false, ma: "KHAC_KHOA" });
  });
  it("[DTGV-07] giaTrong cần CẢ NĂM cột NULL; noCua = giá − đã thu, null khi chưa có giá", () => {
    expect(giaTrong(GIA_TRONG)).toBe(true);
    expect(giaTrong({ ...GIA_TRONG, tuition: 0 })).toBe(false);
    expect(noCua(5_016_000, 2_508_000)).toBe(2_508_000);
    expect(noCua(null, 2_508_000)).toBeNull();
  });
});

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (s: string) => s.split("\n").filter((d) => !["//", "/*", "*"].some((dau) => d.trim().startsWith(dau))).join("\n");
const dem = (s: string, x: string) => s.split(x).length - 1;

describe("[DTGV-W] lưới ghim dây nối", () => {
  const CHUYEN_LOP = boChuThich(doc("lib/enrollments/chuyen-lop.ts"));
  const DB = boChuThich(doc("lib/enrollments/di-theo-gia-va-tien-db.ts"));
  const TRANSFER = boChuThich(doc("lib/transfer/service.ts"));
  const DOI_KHOA = boChuThich(doc("lib/finance/doi-khoa-db.ts"));
  const GHI_DANH = boChuThich(doc("app/(admin)/admin/enrollments/_actions.ts"));

  it("[DTGV-W1] chuyenLopTrongTx: KHOÁ hàng ghi danh cũ TRƯỚC khi đọc; đóng ghi danh cũ bằng phép ghi CÓ ĐIỀU KIỆN (status + chưa trỏ) và kiểm số dòng; mang giá SAU khi đóng", () => {
    const tu = CHUYEN_LOP.indexOf("export async function chuyenLopTrongTx");
    const than = CHUYEN_LOP.slice(tu);
    expect(dem(than, 'FROM "Enrollment" WHERE id = ${input.oldEnrollmentId} FOR UPDATE')).toBe(1);
    expect(than.indexOf("FOR UPDATE")).toBeLessThan(than.indexOf("tx.enrollment.findFirst("));
    expect(than).toContain("where: { id: cu.id, status: cu.status, transferredToId: null }");
    expect(than).toContain("if (dong.count !== 1) throw new ChuyenLopError(");
    expect(than).not.toMatch(/tx\.enrollment\.update\(/); // bản cũ: update không điều kiện ⇒ hai lượt chồng cùng thành công
    expect(dem(than, "diTheoGiaVaTienSangGhiDanhMoi(tx,")).toBe(1);
    expect(than.indexOf("tx.enrollment.updateMany(")).toBeLessThan(than.indexOf("diTheoGiaVaTienSangGhiDanhMoi(tx,"));
    expect(than).toContain('if (input.giaVaTien === "THEO_GHI_DANH")');
  });

  it("[DTGV-W2] chế độ giá/tiền là tham số BẮT BUỘC (không `?`, không mặc định) — tsc liệt kê chỗ gọi", () => {
    expect(CHUYEN_LOP).toContain("giaVaTien: CheDoGiaVaTien;");
    expect(CHUYEN_LOP).not.toMatch(/giaVaTien\?:/);
    expect(CHUYEN_LOP).not.toMatch(/giaVaTien\s*=\s*"/);
  });

  it("[DTGV-W3] đổi khoá F4 truyền KHONG_DOI (nó tự tạo dòng đơn mới + tự chuyển tiền — dời thêm là dời ĐÔI); chuyển lớp thường truyền THEO_GHI_DANH", () => {
    expect(dem(DOI_KHOA, 'giaVaTien: "KHONG_DOI"')).toBe(1);
    expect(DOI_KHOA).not.toContain("THEO_GHI_DANH");
    expect(dem(GHI_DANH, 'giaVaTien: "THEO_GHI_DANH"')).toBe(1);
    expect(GHI_DANH).not.toContain("KHONG_DOI");
  });

  it("[DTGV-W4] approveTransfer: CLAIM yêu cầu là phép ghi ĐẦU TIÊN; ghi `transferredToId`; mang giá + khoản thu qua hàm dùng chung", () => {
    const tu = TRANSFER.indexOf("export async function approveTransfer");
    const khoi = TRANSFER.slice(tu, TRANSFER.indexOf("export async function rejectTransfer"));
    expect(khoi).toContain('where: { id: requestId, status: "PENDING" }');
    expect(khoi.indexOf("tx.studentTransferRequest.updateMany(")).toBeLessThan(khoi.indexOf("tx.enrollment.updateMany("));
    expect(khoi.indexOf("tx.studentTransferRequest.updateMany(")).toBeLessThan(khoi.indexOf("tx.enrollment.create("));
    expect(khoi).toContain("data: { transferredToId: moi.id }");
    expect(dem(khoi, "diTheoGiaVaTienSangGhiDanhMoi(tx,")).toBe(1);
    expect(dem(khoi, 'status: "APPROVED"')).toBe(1); // yêu cầu chỉ đóng MỘT lần (ở claim), không còn bước đóng ở cuối
  });

  it("[DTGV-W5] phần DB: CHỈ đổi Payment.enrollmentId + năm cột giá + OrderItem.enrollmentId; KHÔNG Receipt, hoa hồng, hoá đơn, Order; không tạo Payment; không đổi số tiền/ngày/trạng thái", () => {
    expect(DB).not.toMatch(/tx\.(receipt|commissionLine|commissionTransaction|commissionStatement|hoaDon\w*|order)\./);
    expect(DB).not.toMatch(/tx\.payment\.(create|createMany|update|delete|deleteMany|upsert)\(/);
    expect(dem(DB, "tx.payment.updateMany(")).toBe(1);
    expect(DB).toContain("data: { enrollmentId: p.moiId } });");
    expect(dem(DB, "tx.orderItem.updateMany(")).toBe(1);
    expect(dem(DB, "tx.enrollment.updateMany(")).toBe(2);
    // điều kiện của phép dời khoản: đúng ghi danh cũ + chưa xoá + đúng tập id đã đọc
    expect(DB).toContain("where: { id: { in: khoan.map((k) => k.id) }, enrollmentId: p.cuId, deletedAt: null }");
    // lệch số dòng ⇒ NÉM, không `continue`/`return`
    expect(dem(DB, "throw new Error(")).toBeGreaterThanOrEqual(5);
  });
});
