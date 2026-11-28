// @vitest-environment node
// [HDPH-R*] Route tải hoá đơn của phụ huynh — thứ tự cổng + KHÔNG ký khi chưa qua đủ cổng. Mọi phụ thuộc bị giả lập;
// chỗ kiểm SỞ HỮU thật (truy vấn Postgres) ở `tests/finance/hoa-don-phu-huynh-db.test.ts`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  laHoaDonBat: vi.fn(),
  auth: vi.fn(),
  getPortalContext: vi.fn(),
  hasAcceptedSitePolicy: vi.fn(),
  docHoaDonDeTai: vi.fn(),
  khoDaCauHinh: vi.fn(),
  writeAudit: vi.fn(),
  kyUrl: vi.fn(),
  kyUrlXem: vi.fn(),
}));

vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: m.laHoaDonBat }));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/portal/session", () => ({ getPortalContext: m.getPortalContext }));
vi.mock("@/lib/legal/site-policy", () => ({ hasAcceptedSitePolicy: m.hasAcceptedSitePolicy }));
vi.mock("@/lib/portal/hoa-don-phu-huynh", () => ({ docHoaDonDeTai: m.docHoaDonDeTai }));
vi.mock("@/lib/finance/hoa-don/kho-tep", () => ({ khoHoaDonDaCauHinh: m.khoDaCauHinh, kyUrlTaiVeHoaDon: m.kyUrl }));
vi.mock("@/lib/portal/hoa-don-phu-huynh-url", () => ({ kyUrlXemPdfHoaDon: m.kyUrlXem }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: m.writeAudit }));

import { GET } from "./route";

const HD = {
  id: "hd1",
  orgUnitId: "ou1",
  kyHieu: "1C26TSR",
  soHoaDon: "127",
  tepPdfKey: "hoa-don/CS1/2026/o1/a.pdf",
  tepPdfTen: "a.pdf",
  tepXmlKey: null,
  tepXmlTen: null,
};

const goi = (qs = "?loai=pdf") =>
  GET(new Request(`http://portal.test/portal/hoa-don/hd1/tai-ve${qs}`), { params: Promise.resolve({ hoaDonId: "hd1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.laHoaDonBat.mockResolvedValue(true);
  m.auth.mockResolvedValue({ user: { id: "ph1", role: "PARENT", name: "Phụ huynh A" } });
  m.getPortalContext.mockResolvedValue({ parentUserId: "ph1", cheDo: "phu-huynh", children: [{ id: "s1" }, { id: "s2" }] });
  m.hasAcceptedSitePolicy.mockResolvedValue(true);
  m.docHoaDonDeTai.mockResolvedValue(HD);
  m.khoDaCauHinh.mockReturnValue(true);
  m.writeAudit.mockResolvedValue({});
  m.kyUrl.mockResolvedValue("https://kho.example/ky?x=1");
  m.kyUrlXem.mockResolvedValue("https://kho.example/xem?x=1");
});

describe("[HDPH-R1] đường thành công", () => {
  it("302 → URL ký, no-store; audit ghi TRƯỚC khi ký; hỏi hoá đơn bằng MỌI con của phụ huynh (từ phiên)", async () => {
    const res = await goi();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://kho.example/ky?x=1");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(m.docHoaDonDeTai).toHaveBeenCalledWith(["s1", "s2"], "hd1");
    expect(m.writeAudit).toHaveBeenCalledTimes(1);
    expect(m.writeAudit.mock.invocationCallOrder[0]).toBeLessThan(m.kyUrl.mock.invocationCallOrder[0]);
    expect(m.kyUrl).toHaveBeenCalledWith("hoa-don/CS1/2026/o1/a.pdf", "hoa-don-1C26TSR-127.pdf", 300);
    const a = m.writeAudit.mock.calls[0][0];
    expect(a).toMatchObject({ entityType: "HoaDonDienTu", entityId: "hd1", action: "PH_TAI_TEP_HOA_DON", orgUnitId: "ou1" });
    expect(JSON.stringify(a)).not.toContain("hoa-don/CS1"); // không chép khoá tệp vào nhật ký
  });
});

describe("[HDPH-R3] «Xem» (inline) khác «Tải về» (attachment)", () => {
  it("xem=1 + PDF ⇒ ký URL inline, KHÔNG gọi hàm ép tải; audit ghi cachMo=XEM", async () => {
    const res = await goi("?loai=pdf&xem=1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://kho.example/xem?x=1");
    expect(m.kyUrlXem).toHaveBeenCalledWith("hoa-don/CS1/2026/o1/a.pdf", 300);
    expect(m.kyUrl).not.toHaveBeenCalled();
    expect(m.writeAudit.mock.calls[0][0].newValues.cachMo).toBe("XEM");
  });
  it("không có xem=1 ⇒ ép tải (đối chứng), audit cachMo=TAI_VE", async () => {
    await goi("?loai=pdf");
    expect(m.kyUrl).toHaveBeenCalledTimes(1);
    expect(m.kyUrlXem).not.toHaveBeenCalled();
    expect(m.writeAudit.mock.calls[0][0].newValues.cachMo).toBe("TAI_VE");
  });
  it("xem=1 với XML ⇒ vẫn là tải về (xem chỉ cho PDF)", async () => {
    m.docHoaDonDeTai.mockResolvedValue({ ...HD, tepXmlKey: "hoa-don/CS1/2026/o1/a.xml", tepXmlTen: "a.xml" });
    await goi("?loai=xml&xem=1");
    expect(m.kyUrlXem).not.toHaveBeenCalled();
    expect(m.kyUrl).toHaveBeenCalledTimes(1);
  });
});

describe("[HDPH-R2] từ chối — và KHÔNG ký, KHÔNG ghi audit tải", () => {
  const khongKy = () => {
    expect(m.kyUrl).not.toHaveBeenCalled();
    expect(m.writeAudit).not.toHaveBeenCalled();
  };
  it("cờ hoá đơn tắt ⇒ 404, chưa đụng phiên", async () => {
    m.laHoaDonBat.mockResolvedValue(false);
    expect((await goi()).status).toBe(404);
    expect(m.auth).not.toHaveBeenCalled();
    khongKy();
  });
  it("chưa đăng nhập ⇒ 401", async () => {
    m.auth.mockResolvedValue(null);
    expect((await goi()).status).toBe(401);
    khongKy();
  });
  it("không phải PARENT (nhân viên) ⇒ 404, không lộ", async () => {
    m.auth.mockResolvedValue({ user: { id: "nv1", role: "HR" } });
    expect((await goi()).status).toBe(404);
    expect(m.docHoaDonDeTai).not.toHaveBeenCalled();
    khongKy();
  });
  it("đang ở CHẾ ĐỘ HỌC SINH (cookie portal_hv) ⇒ 404", async () => {
    m.getPortalContext.mockResolvedValue({ parentUserId: "ph1", cheDo: "hoc-sinh", children: [{ id: "s1" }] });
    expect((await goi()).status).toBe(404);
    expect(m.docHoaDonDeTai).not.toHaveBeenCalled();
    khongKy();
  });
  it("chưa đồng ý chính sách website ⇒ 403", async () => {
    m.hasAcceptedSitePolicy.mockResolvedValue(false);
    expect((await goi()).status).toBe(403);
    expect(m.docHoaDonDeTai).not.toHaveBeenCalled();
    khongKy();
  });
  it("loại tệp lạ ⇒ 400", async () => {
    expect((await goi("?loai=exe")).status).toBe(400);
    khongKy();
  });
  it("hoá đơn không phải của con nào của phụ huynh / không phải bản được hiện (loader trả null) ⇒ 404 y hệt", async () => {
    m.docHoaDonDeTai.mockResolvedValue(null);
    const res = await goi();
    expect(res.status).toBe(404);
    khongKy();
  });
  it("không có tệp loại yêu cầu (XML trống) ⇒ 404", async () => {
    expect((await goi("?loai=xml")).status).toBe(404);
    khongKy();
  });
  it("kho tệp chưa cấu hình ⇒ 503", async () => {
    m.khoDaCauHinh.mockReturnValue(false);
    expect((await goi()).status).toBe(503);
    khongKy();
  });
  it("AUDIT ném ⇒ 503 và KHÔNG ký URL", async () => {
    m.writeAudit.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await goi()).status).toBe(503);
    expect(m.kyUrl).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("ký URL lỗi ⇒ 503", async () => {
    m.kyUrl.mockRejectedValue(new Error("r2"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await goi()).status).toBe(503);
    spy.mockRestore();
  });
});

describe("[HDPH-R9] kho cục bộ (chỉ dev): thay NGUỒN byte, không thay cổng", () => {
  const moKho = () => {
    const d = mkdtempSync(join(tmpdir(), "kho-hd-r9-"));
    mkdirSync(join(d, "hoa-don", "CS1", "2026", "o1"), { recursive: true });
    writeFileSync(join(d, "hoa-don", "CS1", "2026", "o1", "a.pdf"), "%PDF-DEMO");
    vi.stubEnv("PORTAL_HOA_DON_KHO_CUC_BO", d);
    return d;
  };
  afterEach(() => vi.unstubAllEnvs());

  it("có kho cục bộ ⇒ 200 trả đúng byte (không ký URL, không cần R2); audit ghi TRƯỚC; xem=1 ⇒ inline", async () => {
    const d = moKho();
    m.khoDaCauHinh.mockReturnValue(false); // R2 chưa sẵn sàng — kho cục bộ vẫn phục vụ
    const res = await goi("?loai=pdf&xem=1");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("%PDF-DEMO");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(m.kyUrl).not.toHaveBeenCalled();
    expect(m.kyUrlXem).not.toHaveBeenCalled();
    expect(m.writeAudit).toHaveBeenCalledTimes(1);
    rmSync(d, { recursive: true, force: true });
  });
  it("tải về ⇒ attachment kèm tên tệp", async () => {
    const d = moKho();
    const res = await goi("?loai=pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''/);
    rmSync(d, { recursive: true, force: true });
  });
  it("các cổng vẫn chạy: hoá đơn không thuộc phụ huynh ⇒ 404; chưa đăng nhập ⇒ 401; audit ném ⇒ 503 và KHÔNG trả tệp", async () => {
    const d = moKho();
    m.docHoaDonDeTai.mockResolvedValue(null);
    expect((await goi()).status).toBe(404);
    m.docHoaDonDeTai.mockResolvedValue(HD);
    m.auth.mockResolvedValue(null);
    expect((await goi()).status).toBe(401);
    m.auth.mockResolvedValue({ user: { id: "ph1", role: "PARENT", name: "A" } });
    m.writeAudit.mockRejectedValue(new Error("audit hỏng"));
    expect((await goi()).status).toBe(503);
    rmSync(d, { recursive: true, force: true });
  });
  it("tệp không có trong kho ⇒ 404 (không rơi về R2)", async () => {
    const d = moKho();
    m.docHoaDonDeTai.mockResolvedValue({ ...HD, tepPdfKey: "hoa-don/khong-co.pdf" });
    expect((await goi()).status).toBe(404);
    expect(m.kyUrl).not.toHaveBeenCalled();
    rmSync(d, { recursive: true, force: true });
  });
  it("PRODUCTION: biến có đặt cũng bị bỏ qua ⇒ đi đường R2 như cũ (302 → URL ký) — đối chứng của bốn ca trên", async () => {
    const d = moKho();
    vi.stubEnv("NODE_ENV", "production");
    const res = await goi();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://kho.example/ky?x=1");
    rmSync(d, { recursive: true, force: true });
  });
});
