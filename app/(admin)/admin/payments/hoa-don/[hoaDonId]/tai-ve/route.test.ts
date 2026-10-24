// @vitest-environment node
//
// Ca [HDT-*] — ROUTE TẢI TỆP HOÁ ĐƠN: ai tải được bản nào, audit TRƯỚC khi cấp URL, redirect 302 no-store.
//
// Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §6 + §8. Tệp hoá đơn có MST, địa chỉ, email khách.
//   · Kế toán CỦA CƠ SỞ GIỮ ĐƠN (payments:confirm, theo tập cơ sở của đúng quyền đó) tải mọi bản.
//   · Người có orders:view-pii (sale, QLCS) CHỈ tải bản DA_XAC_NHAN — bản nháp có thể sai, bản đã
//     bị thay là tờ sai; gửi tay qua Zalo thì không thu về được. Bản khác trả 404, KHÔNG 403, để
//     khỏi lộ sự tồn tại.
//   · Audit lỗi ⇒ KHÔNG cấp URL. Đây là test HÀNH VI, cố ý: lưới "audit trước ký" của module ghi âm
//     (tests/goi-dien/bat-bien.test.ts (OmiCall — đã gỡ 06/10/2026)) soi chuỗi và khớp NHẦM vào dòng import — lưới chết.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  findUnique: vi.fn(),
  writeAudit: vi.fn(async () => ({ id: "audit-1" })),
  khoOk: vi.fn(() => true),
  kyGet: vi.fn(async (khoa: string, ten: string, ttl: number) => `https://r2.test/${khoa}?ttl=${ttl}&ten=${encodeURIComponent(ten)}`),
}));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: h.bat }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({ hoaDonDienTu: { findUnique: h.findUnique } }) }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
vi.mock("@/lib/finance/hoa-don/kho-tep", () => ({ khoHoaDonDaCauHinh: h.khoOk, kyUrlTaiVeHoaDon: h.kyGet }));

import { GET } from "./route";

const HD = {
  id: "hd1",
  orderId: "don1",
  centerId: "cs1",
  orgUnitId: "ou-cs1",
  trangThai: "DA_XAC_NHAN",
  kyHieu: "1C26TSR",
  soHoaDon: "127",
  tepPdfKey: "hoa-don/CS1/2026/don1/u.pdf",
  tepPdfTen: "hd.pdf",
  tepXmlKey: null as string | null,
  tepXmlTen: null as string | null,
};

const perm = (action: string, centerScope: "ALL" | string[]) => ({
  action,
  scopeType: "GLOBAL",
  orgUnitId: "ou",
  roleCode: "X",
  centerScope,
});
const KE_TOAN_CS1 = { isSuperAdmin: false, grantsAllow: new Set(), permissions: [perm("payments:confirm", ["cs1"])] };
const KE_TOAN_CS2_KIEM_SALE_CS1 = {
  isSuperAdmin: false,
  grantsAllow: new Set(),
  permissions: [perm("payments:confirm", ["cs2"]), perm("payments:record", ["cs1"])],
};
const SALE = { isSuperAdmin: false, grantsAllow: new Set(), permissions: [perm("orders:view-pii", ["cs1"])] };

function vai(o: { keToan: boolean; xemPii: boolean; actor: unknown }) {
  h.checkPermission.mockImplementation(async (a: string) =>
    a === "payments:confirm" ? o.keToan : a === "orders:view-pii" ? o.xemPii : false,
  );
  h.resolveActor.mockResolvedValue(o.actor);
}
const goi = (loai = "pdf", id = "hd1") =>
  GET(new Request(`https://admin.satarobo.vn/payments/hoa-don/${id}/tai-ve?loai=${loai}`), {
    params: Promise.resolve({ hoaDonId: id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.bat.mockResolvedValue(true);
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Kế toán" } });
  h.khoOk.mockReturnValue(true);
  h.writeAudit.mockResolvedValue({ id: "audit-1" });
  h.findUnique.mockResolvedValue({ ...HD });
});

describe("[HDT-01] cổng vào", () => {
  it("cờ TẮT ⇒ 404, không hỏi quyền, không đọc DB", async () => {
    h.bat.mockResolvedValue(false);
    expect((await goi()).status).toBe(404);
    expect(h.checkPermission).not.toHaveBeenCalled();
    expect(h.findUnique).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập ⇒ 401", async () => {
    h.auth.mockResolvedValue(null);
    expect((await goi()).status).toBe(401);
  });

  it("không có payments:confirm lẫn orders:view-pii ⇒ 403", async () => {
    vai({ keToan: false, xemPii: false, actor: SALE });
    expect((await goi()).status).toBe(403);
  });

  it("loai lạ ⇒ 400", async () => {
    vai({ keToan: true, xemPii: false, actor: KE_TOAN_CS1 });
    expect((await goi("exe")).status).toBe(400);
  });

  it("hoá đơn ngoài tầm nhìn (scopedDb trả null) ⇒ 404", async () => {
    vai({ keToan: true, xemPii: false, actor: KE_TOAN_CS1 });
    h.findUnique.mockResolvedValue(null);
    expect((await goi()).status).toBe(404);
  });
});

describe("[HDT-02] ma trận ai tải bản nào — kèm ĐỐI CHỨNG DƯƠNG", () => {
  it("sale tải bản NHÁP ⇒ 404 (không lộ là có)", async () => {
    vai({ keToan: false, xemPii: true, actor: SALE });
    h.findUnique.mockResolvedValue({ ...HD, trangThai: "NHAP" });
    expect((await goi()).status).toBe(404);
    expect(h.kyGet).not.toHaveBeenCalled();
  });

  it("…đối chứng: KẾ TOÁN của cơ sở tải bản NHÁP ⇒ 302", async () => {
    vai({ keToan: true, xemPii: false, actor: KE_TOAN_CS1 });
    h.findUnique.mockResolvedValue({ ...HD, trangThai: "NHAP" });
    expect((await goi()).status).toBe(302);
  });

  it("sale tải bản ĐÃ BỊ THAY ⇒ 404", async () => {
    vai({ keToan: false, xemPii: true, actor: SALE });
    h.findUnique.mockResolvedValue({ ...HD, trangThai: "THAY_THE" });
    expect((await goi()).status).toBe(404);
  });

  it("sale tải bản ĐÃ XÁC NHẬN ⇒ 302", async () => {
    vai({ keToan: false, xemPii: true, actor: SALE });
    expect((await goi()).status).toBe(302);
  });

  it("KIÊM NHIỆM: kế toán CS2 + sale CS1, tải bản NHÁP của CS1 ⇒ 404 (không phải kế toán CS1)", async () => {
    // Qua được checkPermission("payments:confirm") trần VÀ thấy hoá đơn CS1 nhờ payments:record —
    // đúng lỗ mà tập cơ sở theo quyền sinh ra để bịt (PLAN §9).
    vai({ keToan: true, xemPii: false, actor: KE_TOAN_CS2_KIEM_SALE_CS1 });
    h.findUnique.mockResolvedValue({ ...HD, trangThai: "NHAP" });
    expect((await goi()).status).toBe(404);
  });

  it("hoá đơn KHÔNG XUẤT (không có tệp) ⇒ 404 kể cả với kế toán", async () => {
    vai({ keToan: true, xemPii: false, actor: KE_TOAN_CS1 });
    h.findUnique.mockResolvedValue({ ...HD, trangThai: "KHONG_XUAT", tepPdfKey: null });
    expect((await goi()).status).toBe(404);
  });

  it("xin XML khi hoá đơn không kèm XML ⇒ 404", async () => {
    vai({ keToan: true, xemPii: false, actor: KE_TOAN_CS1 });
    expect((await goi("xml")).status).toBe(404);
  });
});

describe("[HDT-03] audit TRƯỚC, ký SAU — test HÀNH VI", () => {
  it("audit ném lỗi ⇒ 503 và KHÔNG ký URL", async () => {
    vai({ keToan: true, xemPii: false, actor: KE_TOAN_CS1 });
    h.writeAudit.mockRejectedValue(new Error("db down"));
    expect((await goi()).status).toBe(503);
    expect(h.kyGet).not.toHaveBeenCalled();
  });

  it("audit ghi ĐÚNG hoá đơn, KHÔNG chép khoá tệp / URL vào nhật ký", async () => {
    vai({ keToan: true, xemPii: false, actor: KE_TOAN_CS1 });
    await goi();
    expect(h.writeAudit).toHaveBeenCalledTimes(1);
    const [arg] = h.writeAudit.mock.calls[0]! as unknown as [Record<string, unknown>];
    expect(arg).toMatchObject({ entityType: "HoaDonDienTu", entityId: "hd1", module: "finance", orgUnitId: "ou-cs1" });
    expect(JSON.stringify(arg)).not.toContain("hoa-don/CS1");
    // Thứ tự gọi: audit xong mới ký.
    expect(h.writeAudit.mock.invocationCallOrder[0]!).toBeLessThan(h.kyGet.mock.invocationCallOrder[0]!);
  });

  it("kho chưa cấu hình ⇒ 503, không audit, không ký", async () => {
    vai({ keToan: true, xemPii: false, actor: KE_TOAN_CS1 });
    h.khoOk.mockReturnValue(false);
    expect((await goi()).status).toBe(503);
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(h.kyGet).not.toHaveBeenCalled();
  });
});

describe("[HDT-04] phản hồi", () => {
  it("302 (không phải 307 mặc định) + Cache-Control no-store + TTL 300 giây + tên tệp có ký hiệu và số", async () => {
    vai({ keToan: true, xemPii: false, actor: KE_TOAN_CS1 });
    const r = await goi();
    expect(r.status).toBe(302);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const [khoa, ten, ttl] = h.kyGet.mock.calls[0]!;
    expect(khoa).toBe(HD.tepPdfKey);
    expect(ten).toBe("hoa-don-1C26TSR-127.pdf");
    expect(ttl).toBe(300);
    expect(r.headers.get("location")).toContain(encodeURIComponent("hoa-don/CS1/2026/don1/u.pdf").replaceAll("%2F", "/"));
  });

  it("phản hồi lỗi cũng no-store", async () => {
    vai({ keToan: false, xemPii: false, actor: SALE });
    expect((await goi()).headers.get("cache-control")).toBe("no-store");
  });
});
