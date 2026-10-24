// @vitest-environment node
//
// Ca [HPC-*] — ROUTE PHIẾU THU CHỜ XÁC NHẬN (docs/ke-toan-hoa-don/PLAN.md §4 bước ②).
//
//   · Tập khoản + số tiền lấy từ LOADER của màn, không từ URL — `?khoan=` lạ bị bỏ qua.
//   · Không phải kế toán đúng cơ sở ⇒ 404 (không lộ), kèm ĐỐI CHỨNG DƯƠNG: kế toán ⇒ 200 PDF.
//   · Audit (mang dấu người mua) chạy TRƯỚC khi dựng PDF; audit lỗi ⇒ 503, không PDF.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  auth: vi.fn(),
  checkPermission: vi.fn(async () => true),
  resolveActor: vi.fn(async () => ({ userId: "kt1" })),
  nap: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(async () => [{ id: "sale1", name: "Sale Một" }]),
  writeAudit: vi.fn(async () => ({ id: "a1" })),
  render: vi.fn(async () => Buffer.from("%PDF-1.7 giả")),
  thuTu: [] as string[],
}));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: h.bat }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/finance/hoa-don/hang-cho", () => ({ napHangChoHoaDon: h.nap }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({ order: { findUnique: h.findUnique }, user: { findMany: h.findMany } }),
}));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
vi.mock("@/lib/payments/method-lookup", () => ({ lookupMethodNameByCode: async () => "Chuyển khoản" }));
vi.mock("@/lib/pdf/brand", () => ({ withFreshFonts: <T,>(f: () => T) => f() }));
vi.mock("@react-pdf/renderer", async (orig) => ({
  ...(await orig<typeof import("@react-pdf/renderer")>()),
  renderToBuffer: h.render,
}));

import { GET } from "./route";

const DONG = {
  key: "dot:dot1",
  orderId: "don1",
  ngayThu: "2026-09-10",
  ngayThuLabel: "10/09/2026",
  soTien: 5_000_000,
  khoanIds: ["p1", "p2"],
  khoan: [
    { id: "p1", soTien: 3_000_000 },
    { id: "p2", soTien: 2_000_000 },
  ],
  hanhDong: { taiPhieu: true },
};

const khoanDb = (id: string, ten: string) => ({
  id,
  method: "BANK_TRANSFER",
  recordedById: "sale1",
  enrollment: { class: { name: "S4-A", course: { name: "Sata 4" } }, student: { name: ten } },
  orderItem: null,
});

const DON = {
  code: "ORD-260910-000001",
  type: "COURSE",
  customerName: "Nguyễn Văn A",
  customerPhone: "0905123456",
  customerEmail: "a@gmail.com",
  customerAddress: "12 Lê Lợi",
  customerWard: null,
  customerCity: "Đà Nẵng",
  customerCccd: null,
  invoiceBuyerName: null,
  invoiceCompanyName: null,
  invoiceTaxCode: null,
  invoiceEmail: null,
  center: { code: "CS1" },
  student: { name: "Bé Một" },
  payments: [khoanDb("p1", "Bé Một"), khoanDb("p2", "Bé Hai")],
};

const goi = (qs = "don=don1&chon=dot%3Adot1") =>
  GET(new Request(`https://admin.satarobo.vn/payments/hoa-don/phieu-cho?${qs}`));

type TrangGiaLap = { maPhieu: string | null; tong: { congTienThanhToan: number }; dong: { ten: string }[] };
const trangDaDung = (): TrangGiaLap[] => {
  const el = (h.render.mock.calls[0] as unknown as [{ props: { trang: TrangGiaLap[] } }])[0];
  return el.props.trang;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.thuTu.length = 0;
  h.bat.mockResolvedValue(true);
  h.auth.mockResolvedValue({ user: { id: "kt1", name: "Kế toán" } });
  h.checkPermission.mockResolvedValue(true);
  h.nap.mockResolvedValue({ dong: [structuredClone(DONG)], thieuCoSo: 0, khoOk: true });
  h.findUnique.mockResolvedValue(structuredClone(DON));
  h.writeAudit.mockImplementation(async () => {
    h.thuTu.push("audit");
    return { id: "a1" };
  });
  h.render.mockImplementation(async () => {
    h.thuTu.push("render");
    return Buffer.from("%PDF-1.7 giả");
  });
});

describe("[HPC-01] cổng vào", () => {
  it("cờ TẮT ⇒ 404, không hỏi quyền, không nạp gì", async () => {
    h.bat.mockResolvedValue(false);
    expect((await goi()).status).toBe(404);
    expect(h.checkPermission).not.toHaveBeenCalled();
    expect(h.nap).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập ⇒ 401; thiếu payments:confirm ⇒ 403", async () => {
    h.auth.mockResolvedValue(null);
    expect((await goi()).status).toBe(401);
    h.auth.mockResolvedValue({ user: { id: "kt1" } });
    h.checkPermission.mockResolvedValue(false);
    expect((await goi()).status).toBe(403);
    expect(h.checkPermission).toHaveBeenCalledWith("payments:confirm");
  });

  it("thiếu don / chon ⇒ 400", async () => {
    expect((await goi("don=don1")).status).toBe(400);
    expect((await goi("chon=dot%3Adot1")).status).toBe(400);
  });
});

describe("[HPC-02] ai tải được — kèm ĐỐI CHỨNG DƯƠNG", () => {
  it("kế toán ĐÚNG cơ sở ⇒ 200 PDF, no-store, loader thu hẹp theo đơn", async () => {
    const res = await goi();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.nap).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderId: "don1" }));
  });

  it("không phải kế toán của cơ sở giữ đơn (taiPhieu=false) ⇒ 404, không audit, không PDF", async () => {
    h.nap.mockResolvedValue({ dong: [{ ...structuredClone(DONG), hanhDong: { taiPhieu: false } }], thieuCoSo: 0, khoOk: true });
    expect((await goi()).status).toBe(404);
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(h.render).not.toHaveBeenCalled();
  });

  it("[HPC-GOP] (Q2) khoá GỘP ⇒ loader dựng lại với tập đọc từ khoá; khoá thường ⇒ không gộp", async () => {
    h.nap.mockResolvedValue({ dong: [{ ...structuredClone(DONG), key: "gop:dot:dot1+k:p2" }], thieuCoSo: 0, khoOk: true });
    expect((await goi("don=don1&chon=gop%3Adot%3Adot1%2Bk%3Ap2")).status).toBe(200);
    expect(h.nap).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderId: "don1", gop: ["dot:dot1", "k:p2"] }));
    h.nap.mockClear();
    await goi();
    expect(h.nap).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ gop: [] }));
  });

  it("khoá lần thu không có trong đơn (đơn ngoài tầm nhìn / khoá bịa) ⇒ 404", async () => {
    expect((await goi("don=don1&chon=dot%3Akhac")).status).toBe(404);
    h.nap.mockResolvedValue({ dong: [], thieuCoSo: 0, khoOk: true });
    expect((await goi()).status).toBe(404);
  });
});

describe("[HPC-03] tập khoản và số tiền đến từ LOADER, không từ URL", () => {
  it("mỗi khoản một trang, số RÒNG của loader, không số phiếu, tên đúng bé", async () => {
    expect((await goi("don=don1&chon=dot%3Adot1&khoan=p9")).status).toBe(200);
    const where = (h.findUnique.mock.calls[0] as unknown as [{ select: { payments: { where: { id: { in: string[] } } } } }])[0]
      .select.payments.where;
    expect(where.id.in).toEqual(["p1", "p2"]);
    const trang = trangDaDung();
    expect(trang).toHaveLength(2);
    expect(trang.map((t) => t.maPhieu)).toEqual([null, null]);
    expect(trang.map((t) => t.tong.congTienThanhToan)).toEqual([3_000_000, 2_000_000]);
    expect(trang[1]!.dong[0]!.ten).toMatch(/Bé Hai/);
  });

  it("khoản vừa biến mất giữa hai câu tra ⇒ 409, không in thiếu trang", async () => {
    h.findUnique.mockResolvedValue({ ...structuredClone(DON), payments: [khoanDb("p1", "Bé Một")] });
    expect((await goi()).status).toBe(409);
    expect(h.render).not.toHaveBeenCalled();
  });
});

describe("[HPC-04] audit TRƯỚC khi dựng PDF", () => {
  it("audit mang khoá lần thu + dấu người mua, chạy trước render", async () => {
    expect((await goi()).status).toBe(200);
    expect(h.thuTu).toEqual(["audit", "render"]);
    const arg = (h.writeAudit.mock.calls[0] as unknown as [{ action: string; entityId: string; newValues: Record<string, unknown> }])[0];
    expect(arg).toMatchObject({ action: "TAI_PHIEU_CHO", entityId: "don1" });
    expect(arg.newValues).toMatchObject({ lanThuKey: "dot:dot1", khoanIds: ["p1", "p2"] });
    expect(arg.newValues.nguoiMuaHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("audit lỗi ⇒ 503, KHÔNG dựng PDF", async () => {
    h.writeAudit.mockRejectedValue(new Error("db"));
    expect((await goi()).status).toBe(503);
    expect(h.render).not.toHaveBeenCalled();
  });
});
