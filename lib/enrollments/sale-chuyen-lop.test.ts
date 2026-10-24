// lib/enrollments/sale-chuyen-lop.test.ts — [SCL-*] LUẬT SALE TỰ CHUYỂN LỚP (THUẦN) + LƯỚI GHIM DÂY NỐI.
//
// Phần đầu khẳng định HÀNH VI của `xetChuyenLop`. Phần sau là LƯỚI GHIM MÃ NGUỒN cho những chỗ test hành vi không với tới được (action chạm DB, trang RSC):
// neo vào LỜI GỌI + số lần khớp, không neo vào cách đặt chữ (bài học `[NDC-07]`).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HAU_TO_SALE_TU_CHUYEN, xetChuyenLop, type DauVaoChuyenLop } from "./sale-chuyen-lop";

const goc: DauVaoChuyenLop = {
  coQuyenChuyen: false,
  coQuyenGhiDanh: true,
  laHocVienCuaMinh: true,
  dangChoXepLop: false,
  khoaNguon: "K1",
  khoaDich: "K1",
  coSoNguon: "CS1",
  coSoDich: "CS1",
};

describe("[SCL] xetChuyenLop — Sale tự chuyển lớp học viên của mình", () => {
  it("[SCL-01] quản lý (có enrollments:transfer) đi thẳng, KHÔNG bị siết thêm gì — kể cả khác khoá / khác cơ sở / không phải học viên của mình", () => {
    expect(xetChuyenLop({ ...goc, coQuyenChuyen: true, laHocVienCuaMinh: false, khoaDich: "K2", coSoDich: "CS2" })).toEqual({ ok: true, theo: "QUAN_LY" });
  });

  it("[SCL-02] Sale: học viên của mình + cùng khoá + cùng cơ sở ⇒ được, đánh dấu theo SALE_CUA_MINH", () => {
    expect(xetChuyenLop(goc)).toEqual({ ok: true, theo: "SALE_CUA_MINH" });
  });

  it("[SCL-03] Sale: học viên của người khác ⇒ từ chối, nói rõ lý do", () => {
    const r = xetChuyenLop({ ...goc, laHocVienCuaMinh: false });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.lyDo).toContain("do mình phụ trách");
  });

  it("[SCL-04] Sale: khác khoá ⇒ từ chối (đổi mức phí); khác cơ sở ⇒ từ chối (đi màn Chuyển lớp / cơ sở có duyệt)", () => {
    const k = xetChuyenLop({ ...goc, khoaDich: "K2" });
    expect(k.ok ? "" : k.lyDo).toContain("khác khoá");
    const c = xetChuyenLop({ ...goc, coSoDich: "CS2" });
    expect(c.ok ? "" : c.lyDo).toContain("khác cơ sở");
    // Cơ sở cùng là NULL (lớp chưa gắn cơ sở) vẫn coi là cùng — không chặn oan.
    expect(xetChuyenLop({ ...goc, coSoNguon: null, coSoDich: null }).ok).toBe(true);
  });

  it("[SCL-04b] Sale: ghi danh đang Chờ xếp lớp (PENDING) ⇒ từ chối; quản lý vẫn đi thẳng (không siết người đang chuyển được)", () => {
    const r = xetChuyenLop({ ...goc, dangChoXepLop: true });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.lyDo).toContain("Chờ xếp lớp");
    expect(xetChuyenLop({ ...goc, dangChoXepLop: true, coQuyenChuyen: true }).ok).toBe(true);
  });

  it("[SCL-05] không có cả transfer lẫn create ⇒ từ chối; hậu tố audit có chữ 'Sale tự chuyển'", () => {
    expect(xetChuyenLop({ ...goc, coQuyenGhiDanh: false })).toEqual({ ok: false, lyDo: "Không có quyền chuyển lớp" });
    expect(HAU_TO_SALE_TU_CHUYEN).toContain("Sale tự chuyển");
  });
});

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
/** Bỏ các dòng chú thích (một dòng hoặc khối JSDoc) trước khi đếm — chính khối giải thích bản vá chứa đúng chuỗi đang canh (luật 11). */
const boChuThich = (s: string) => s.split("\n").filter((d) => !["//", "/*", "*"].some((dau) => d.trim().startsWith(dau))).join("\n");
const dem = (s: string, ct: string) => s.split(ct).length - 1;

describe("[SCL-W] lưới ghim dây nối", () => {
  const CHUYEN_DOI = boChuThich(doc("app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts"));
  const LOADER = boChuThich(doc("lib/orders/chuyen-doi-don.ts"));
  const CHUYEN_LOP = boChuThich(doc("lib/enrollments/chuyen-lop.ts"));
  const GHI_DANH = boChuThich(doc("app/(admin)/admin/enrollments/_actions.ts"));
  const DI_THEO = boChuThich(doc("lib/enrollments/di-theo-ghi-danh.ts"));
  const TRANSFER = boChuThich(doc("lib/transfer/service.ts"));
  const ROSTER = boChuThich(doc("app/(admin)/admin/classes/[id]/students/page.tsx"));

  it("[SCL-W1] màn Chuyển đổi: sale phụ trách lấy từ LEAD (assignedToId) — KHÔNG từ người bấm chốt / người tạo đơn", () => {
    expect(dem(LOADER, "assignedToId: true")).toBe(1);
    expect(LOADER).toContain("saleId: order.lead?.assignedToId ?? null");
    expect(LOADER).not.toMatch(/createdById/);
    expect(dem(CHUYEN_DOI, "saleId: duLieu.saleId,")).toBe(2); // một ở ghi danh, một ở audit
    expect(CHUYEN_DOI).not.toMatch(/saleId:\s*(uid|actorId|session)/);
  });

  it("[SCL-W2] màn Chuyển đổi: học viên nối về lead (leadId/leadChildId) và KHÔNG ghi Enrollment.leadChildId", () => {
    expect(CHUYEN_DOI).toContain("leadId: duLieu.leadId,");
    expect(CHUYEN_DOI).toContain("leadChildId: conCuaLead?.id ?? null");
    const khoiGhiDanh = CHUYEN_DOI.slice(CHUYEN_DOI.indexOf("tx.enrollment.create"), CHUYEN_DOI.indexOf("tx.orderItem.update"));
    expect(khoiGhiDanh).not.toContain("leadChildId");
  });

  it("[SCL-W3] chuyenLopTrongTx: buoiBatDau (chỉ cùng khoá) + saleId + quyền học cùng khoá đi theo QUA HÀM DÙNG CHUNG; KHÔNG chép leadChildId / renewedFrom", () => {
    expect(dem(CHUYEN_LOP, "diTheoGhiDanhCu(cu, lop.courseId)")).toBe(1);
    expect(CHUYEN_LOP).toContain("buoiBatDau: diTheo.buoiBatDau");
    expect(CHUYEN_LOP).toContain("sale: { connect: { id: diTheo.saleId } }");
    expect(dem(CHUYEN_LOP, "doiQuyenHocSangGhiDanhMoi(tx,")).toBe(1);
    expect(CHUYEN_LOP).not.toContain("tx.studyEntitlement.updateMany(");
    const khoiTao = CHUYEN_LOP.slice(CHUYEN_LOP.indexOf("tx.enrollment.create"), CHUYEN_LOP.indexOf("tx.enrollment.update"));
    expect(khoiTao).not.toMatch(/leadChildId|renewedFrom/);
    // luật nằm MỘT chỗ
    expect(DI_THEO).toContain("cu.courseId === courseIdMoi ? cu.buoiBatDau : null");
    expect(dem(DI_THEO, "tx.studyEntitlement.updateMany(")).toBe(1);
    expect(DI_THEO).toContain("courseId: p.courseId,");
    expect(DI_THEO).toContain("data: { enrollmentId: p.enrollmentMoiId, classId: p.classId }");
    expect(DI_THEO).not.toMatch(/centerId/); // quyền học giữ cơ sở của ĐƠN (doanh thu), không dời theo lớp
  });

  it("[SCL-W7] approveTransfer (/chuyen-lop): đọc ghi danh cũ TRƯỚC khi đóng, rồi cùng hai hàm dùng chung; KHÔNG chép leadChildId / renewedFrom", () => {
    expect(dem(TRANSFER, "diTheoGhiDanhCu(cu, toClass.courseId)")).toBe(1);
    expect(dem(TRANSFER, "doiQuyenHocSangGhiDanhMoi(tx,")).toBe(1);
    const tu = TRANSFER.indexOf("export async function approveTransfer");
    const khoi = TRANSFER.slice(tu, TRANSFER.indexOf("export async function rejectTransfer"));
    expect(khoi.indexOf("tx.enrollment.findFirst(")).toBeGreaterThan(-1);
    expect(khoi.indexOf("tx.enrollment.findFirst(")).toBeLessThan(khoi.indexOf("tx.enrollment.updateMany("));
    expect(khoi).toContain("buoiBatDau: diTheo.buoiBatDau, saleId: diTheo.saleId");
    const khoiTao = khoi.slice(khoi.indexOf("tx.enrollment.create"), khoi.indexOf("doiQuyenHocSangGhiDanhMoi(tx,"));
    expect(khoiTao).not.toMatch(/leadChildId|renewedFrom/);
  });

  it("[SCL-W4] transferEnrollment: cổng đi qua xetChuyenLop (MỘT lần) TRƯỚC khi mở transaction; lý do audit có hậu tố khi Sale tự chuyển", () => {
    const tu = GHI_DANH.indexOf("export async function transferEnrollment");
    const khoi = GHI_DANH.slice(tu);
    expect(dem(khoi, "xetChuyenLop(")).toBe(1);
    expect(khoi.indexOf("xetChuyenLop(")).toBeLessThan(khoi.indexOf("runSerializable("));
    expect(khoi).toContain("reason: lyDoChuyen,");
    expect(khoi).toContain("docHocVienCuaSale(uid, [oldEnrollment.studentId])");
  });

  it("[SCL-W5] enrollStudent: nối quyền học TRONG transaction rồi hích SAU commit", () => {
    const tu = GHI_DANH.indexOf("export async function enrollStudent");
    const den = GHI_DANH.indexOf("const ChangeStatusSchema");
    const khoi = GHI_DANH.slice(tu, den);
    expect(dem(khoi, "ganGhiDanhTayVaoQuyenHoc(")).toBe(1);
    expect(dem(khoi, "hichSauGhiDanhTay(")).toBe(1);
    expect(khoi.indexOf("ganGhiDanhTayVaoQuyenHoc(")).toBeLessThan(khoi.indexOf("syncConversationMembership(tx, classId)") + 2000);
    // hích nằm SAU khối transaction (sau lệnh `return { id: created.id`)
    expect(khoi.indexOf("hichSauGhiDanhTay(")).toBeGreaterThan(khoi.indexOf("return { id: created.id"));
  });

  it("[SCL-W6] trang roster: nút Chuyển lớp hiện theo từng học viên (choPhepChuyen) cho người có create mà không có transfer — cùng nguồn 'học viên của Sale'", () => {
    expect(ROSTER).toContain("docHocVienCuaSale(session.user.id");
    expect(ROSTER).toContain("choPhepChuyen: choPhepTheoHocVien.has(e.studentId)");
    expect(ROSTER).toContain("!canTransfer && coQuyenGhiDanh");
  });
});
