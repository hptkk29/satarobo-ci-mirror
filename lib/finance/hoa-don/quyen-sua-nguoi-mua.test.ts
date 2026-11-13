// [QSN-*] Ai được sửa khối «Người mua trên hoá đơn» (chủ dự án 06/11/2026):
//   · Sale (vai «Tư vấn & CSKH»): chỉ đơn do CHÍNH MÌNH TẠO · kế toán / quản lý cơ sở: đơn trong cơ sở · Quản trị tối cao: tất cả
//   · đơn ĐÃ XUẤT hoá đơn ⇒ KHÔNG AI sửa (nút biến mất, hành động từ chối).
// Phần hành vi trên Postgres thật nằm ở `tests/finance/hoa-don-quyen-sua-nguoi-mua-db.test.ts`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { CAU_KHONG_SUA_NGUOI_MUA, donDaXuatHoaDon, laHoaDonDaXuat, quyenSuaNguoiMua, type DauVaoQuyenSua } from "./quyen-sua-nguoi-mua";

const ME = "u-sale-1";
const KHAC = "u-sale-2";
const dv = (o: Partial<DauVaoQuyenSua>): DauVaoQuyenSua => ({ coQuyenQuanLy: false, coQuyenHep: false, nguoiDungId: ME, nguoiTaoDonId: ME, daXuatHoaDon: false, ...o });

describe("[QSN] ma trận quyền sửa người mua", () => {
  it("[QSN-01] Sale (chỉ quyền hẹp): sửa được đơn do MÌNH tạo; đơn của người khác ⇒ KHONG_PHAI_DON_CUA_MINH", () => {
    expect(quyenSuaNguoiMua(dv({ coQuyenHep: true }))).toEqual({ duoc: true });
    expect(quyenSuaNguoiMua(dv({ coQuyenHep: true, nguoiTaoDonId: KHAC }))).toEqual({ duoc: false, lyDo: "KHONG_PHAI_DON_CUA_MINH" });
  });

  it("[QSN-02] đơn KHÔNG ghi người tạo (đơn cũ/nhập tay) ⇒ Sale không sửa được; `null === null` không bao giờ là «đơn của mình»", () => {
    expect(quyenSuaNguoiMua(dv({ coQuyenHep: true, nguoiTaoDonId: null }))).toEqual({ duoc: false, lyDo: "KHONG_PHAI_DON_CUA_MINH" });
  });

  it("[QSN-03] kế toán / quản lý cơ sở / Quản trị tối cao (`orders:manage`): sửa đơn của NGƯỜI KHÁC và đơn không ghi người tạo (phạm vi cơ sở do scopedDb gác ở nơi gọi)", () => {
    expect(quyenSuaNguoiMua(dv({ coQuyenQuanLy: true, nguoiTaoDonId: KHAC }))).toEqual({ duoc: true });
    expect(quyenSuaNguoiMua(dv({ coQuyenQuanLy: true, nguoiTaoDonId: null }))).toEqual({ duoc: true });
  });

  it("[QSN-04] không có quyền nào ⇒ KHONG_CO_QUYEN (kể cả đơn của chính mình)", () => {
    expect(quyenSuaNguoiMua(dv({}))).toEqual({ duoc: false, lyDo: "KHONG_CO_QUYEN" });
  });

  it("[QSN-05] ĐÃ XUẤT hoá đơn ⇒ KHÔNG AI sửa — kể cả người có toàn quyền, kể cả Sale sửa đơn của mình; lý do đúng là DA_XUAT_HOA_DON (đứng trước luật về người)", () => {
    expect(quyenSuaNguoiMua(dv({ coQuyenQuanLy: true, coQuyenHep: true, daXuatHoaDon: true }))).toEqual({ duoc: false, lyDo: "DA_XUAT_HOA_DON" });
    expect(quyenSuaNguoiMua(dv({ coQuyenHep: true, daXuatHoaDon: true }))).toEqual({ duoc: false, lyDo: "DA_XUAT_HOA_DON" });
    expect(quyenSuaNguoiMua(dv({ coQuyenQuanLy: true, nguoiTaoDonId: KHAC, daXuatHoaDon: true }))).toEqual({ duoc: false, lyDo: "DA_XUAT_HOA_DON" });
  });

  it("[QSN-06] mỗi lý do từ chối có câu tiếng Việt riêng, không trống", () => {
    for (const k of ["DA_XUAT_HOA_DON", "KHONG_CO_QUYEN", "KHONG_PHAI_DON_CUA_MINH"] as const) expect(CAU_KHONG_SUA_NGUOI_MUA[k].length).toBeGreaterThan(20);
    expect(new Set(Object.values(CAU_KHONG_SUA_NGUOI_MUA)).size).toBe(3);
  });
});

describe("[QSN] «đã xuất hoá đơn» là gì", () => {
  it("[QSN-07] NHAP · DANG_PHAT_HANH · DA_XAC_NHAN là đã xuất; KHONG_XUAT chỉ khi lý do là «đã xuất ngoài hệ thống»", () => {
    for (const t of ["NHAP", "DANG_PHAT_HANH", "DA_XAC_NHAN"] as const) expect(laHoaDonDaXuat({ trangThai: t, lyDo: null })).toBe(true);
    expect(laHoaDonDaXuat({ trangThai: "KHONG_XUAT", lyDo: "Đã xuất ngoài hệ thống" })).toBe(true);
  });

  it("[QSN-08] ĐỐI CHỨNG ÂM: LOI_PHAT_HANH (bị từ chối, CHƯA có hoá đơn — sửa người mua rồi «Phát hành lại») · THAY_THE (đã huỷ) · KHONG_XUAT vì lý do khác ⇒ KHÔNG khoá", () => {
    expect(laHoaDonDaXuat({ trangThai: "LOI_PHAT_HANH", lyDo: null })).toBe(false);
    expect(laHoaDonDaXuat({ trangThai: "THAY_THE", lyDo: "đã huỷ" })).toBe(false);
    expect(laHoaDonDaXuat({ trangThai: "KHONG_XUAT", lyDo: "Khách không lấy hoá đơn" })).toBe(false);
    expect(donDaXuatHoaDon([])).toBe(false);
  });

  it("[QSN-09] đơn có NHIỀU hoá đơn: chỉ cần MỘT cái đã xuất là khoá cả đơn", () => {
    expect(donDaXuatHoaDon([{ trangThai: "LOI_PHAT_HANH", lyDo: null }, { trangThai: "DA_XAC_NHAN", lyDo: null }])).toBe(true);
    expect(donDaXuatHoaDon([{ trangThai: "LOI_PHAT_HANH", lyDo: null }, { trangThai: "THAY_THE", lyDo: null }])).toBe(false);
  });
});

// ── LƯỚI GHIM DÂY NỐI: các luật trên chỉ có nghĩa nếu nút, hành động, quyền và seed cùng dùng chúng ──
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const doc = (p: string) => bo(readFileSync(resolve(process.cwd(), p), "utf8"));

describe("[QSN-W] dây nối", () => {
  const action = doc("app/(admin)/admin/orders/_actions.ts");
  const hamLuu = action.slice(action.indexOf("export async function luuThongTinHoaDonAction"), action.indexOf("export async function taoDotChoConAction"));

  it("[QSN-W1] hành động Lưu dùng `quyenSuaNguoiMua` + `docDonDaXuatHoaDon`, hỏi CẢ HAI quyền, và KHÔNG còn `requireOrdersManage()` (nó chặn Sale)", () => {
    expect(hamLuu).toContain("quyenSuaNguoiMua(");
    expect(hamLuu).toContain("docDonDaXuatHoaDon(");
    expect(hamLuu).toContain('checkPermission("orders:manage")');
    expect(hamLuu).toContain('checkPermission("orders:edit-invoice-buyer")');
    // Kế toán cơ sở (`orders:edit-invoice-buyer-any`) cùng nghĩa với `orders:manage` ở luật này — hai quyền gộp bằng `||` thành `coQuyenQuanLy`.
    expect(hamLuu).toContain('checkPermission("orders:edit-invoice-buyer-any")');
    expect(hamLuu).toContain("const coQuyenQuanLy = coManage || coMoiDon;");
    expect(hamLuu).not.toContain("requireOrdersManage()");
  });

  it("[QSN-W2] cổng quyền đứng SAU khi đã nạp đơn trong phạm vi và TRƯỚC `ghiNguoiMuaHoaDon` (mọi từ chối đứng trước phép ghi đầu tiên)", () => {
    const iDon = hamLuu.indexOf("sdb.order.findUnique");
    const iCong = hamLuu.indexOf("quyenSuaNguoiMua(");
    const iGhi = hamLuu.indexOf("ghiNguoiMuaHoaDon(");
    expect(iDon).toBeGreaterThan(0);
    expect(iCong).toBeGreaterThan(iDon);
    expect(iGhi).toBeGreaterThan(iCong);
    // `createdById` phải nằm trong select của đơn — thiếu nó thì `nguoiTaoDonId` là undefined ⇒ Sale không bao giờ sửa được (hoặc, tệ hơn, luật so sai).
    expect(hamLuu).toMatch(/select:\s*\{\s*id:\s*true,\s*centerId:\s*true,\s*createdById:\s*true\s*\}/);
  });

  it("[QSN-W3] trang đơn truyền `duocSuaNguoiMua` (không phải `canManage`) xuống thẻ, và đọc hoá đơn trong CÙNG lô quyền", () => {
    const trang = doc("app/(admin)/admin/orders/[id]/page.tsx");
    expect(trang.match(/duocSuaNguoiMua=\{duocSuaNguoiMua\}/g)).toHaveLength(1);
    expect(trang).toContain("docDonDaXuatHoaDon(order.id)");
    expect(trang).toContain('checkPermission("orders:edit-invoice-buyer")');
    expect(trang).toContain('checkPermission("orders:edit-invoice-buyer-any")');
    expect(trang).toContain("coQuyenQuanLy: canManage || coQuyenSuaMoiDon,");
    const client = doc("app/(admin)/admin/orders/_components/order-detail-client.tsx");
    expect(client).toMatch(/<ThongTinHoaDon[\s\S]{0,260}duocSua=\{duocSuaNguoiMua\}/);
    expect(client).not.toMatch(/<ThongTinHoaDon[\s\S]{0,260}canManage=/);
  });

  it("[QSN-W4] thẻ chỉ vẽ nút khi `duocSua` (không còn đọc `canManage`)", () => {
    const the = doc("app/(admin)/admin/orders/_components/thong-tin-hoa-don.tsx");
    expect(the).toContain("const moSua = duocSua && sua != null;");
    expect(the).not.toMatch(/\bcanManage\b/);
  });

  it("[QSN-W5] seed: vai «Tư vấn & CSKH cơ sở» CÓ `orders:edit-invoice-buyer` và KHÔNG có `orders:manage`; quyền có ở registry + ma trận v1 (SALES_CSM, không ACCOUNTANT/CENTER_MANAGER thừa)", () => {
    // Chỉ bỏ dòng chú thích `//`: seed có chuỗi chứa «/*» nên bộ bỏ khối `/* */` sẽ nuốt cả vai.
    const seed = readFileSync(resolve(process.cwd(), "prisma/seed-roles.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    const i = seed.indexOf('code: "CENTER_SALES_CSM"');
    const j = seed.slice(i + 30).search(/\n\s{4}code: "/);
    const khoi = seed.slice(i, j > 0 ? i + 30 + j : undefined);
    expect(khoi).toContain('"orders:edit-invoice-buyer"');
    expect(khoi).not.toContain('"orders:manage"');
    expect(doc("lib/permissions/registry/finance.ts")).toContain('key: "orders:edit-invoice-buyer"');
    const v1 = doc("lib/auth/permissions.ts");
    expect(v1).toMatch(/"orders:edit-invoice-buyer": \["SUPER_ADMIN", "SALES_CSM"\]/);
  });

  it("[QSN-W6] kế toán cơ sở: seed vai «Kế toán cơ sở» CÓ `orders:edit-invoice-buyer-any` và KHÔNG có `orders:manage` (không mở quyền huỷ/hoàn đơn); Sale KHÔNG có quyền `-any`; quyền có ở registry + ma trận v1", () => {
    const seed = readFileSync(resolve(process.cwd(), "prisma/seed-roles.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    const khoiCua = (ma: string) => {
      const i = seed.indexOf(`code: "${ma}"`);
      const j = seed.slice(i + 30).search(/\n\s{4}code: "/);
      return seed.slice(i, j > 0 ? i + 30 + j : undefined);
    };
    const ketoan = khoiCua("CENTER_ACCOUNTANT");
    expect(ketoan).toContain('"orders:edit-invoice-buyer-any"');
    expect(ketoan).not.toContain('"orders:manage"');
    expect(khoiCua("CENTER_SALES_CSM")).not.toContain('"orders:edit-invoice-buyer-any"');
    expect(doc("lib/permissions/registry/finance.ts")).toContain('key: "orders:edit-invoice-buyer-any"');
    expect(doc("lib/auth/permissions.ts")).toMatch(/"orders:edit-invoice-buyer-any": \["SUPER_ADMIN"\]/);
  });
});
