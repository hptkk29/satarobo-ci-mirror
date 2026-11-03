// Ca [YCN-A*] — Server Actions của khối «Thông tin người mua qua QR» (Invoice Hub S11): cổng đăng nhập / cờ THEO CƠ SỞ đứng TRƯỚC dịch vụ, dựng liên kết + QR đúng, tham số `ghiDe`.
// Dịch vụ / DB đã đo ở tests/finance/hoa-don-yeu-cau-*-db.test.ts; ở đây chỉ phần nối dây, với phụ thuộc giả.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActor: vi.fn(),
  donTim: vi.fn(),
  batCo: vi.fn(),
  cauHinh: vi.fn(),
  tao: vi.fn(),
  huy: vi.fn(),
  nhapThay: vi.fn(),
  apDung: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/audit/log", () => ({ getAuditActor: () => ({ actorId: "u1", actorName: "Nhân viên A" }) }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({ order: { findUnique: h.donTim } }) }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHubNguoiMuaBatChoCoSo: h.batCo, docCauHinhNguoiMua: h.cauHinh }));
vi.mock("@/lib/finance/hoa-don/yeu-cau-nguoi-mua-db", () => ({ taoYeuCau: h.tao, huyYeuCau: h.huy, nhapThayBoiSale: h.nhapThay }));
vi.mock("@/lib/finance/hoa-don/yeu-cau-nguoi-mua-ap-dung-db", () => ({ apDungYeuCauVaoDon: h.apDung }));

import { apDungYeuCauNguoiMuaAction, capLaiYeuCauNguoiMuaAction, huyYeuCauNguoiMuaAction, nhapThayYeuCauNguoiMuaAction, taoYeuCauNguoiMuaAction } from "./_actions-nguoi-mua";

const TOKEN = "T0kenThoCuaTest_0123456789abcdefghijklmnopqrstuvwxyzAB";
const HET_HAN = new Date("2026-11-02T07:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("AFFILIATE_PUBLIC_ORIGIN", "https://test.satarobo.vn");
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Nhân viên A" } });
  h.resolveActor.mockResolvedValue({ userId: "u1" });
  h.donTim.mockResolvedValue({ id: "don1", centerId: "cs1" });
  h.batCo.mockResolvedValue(true);
  h.cauHinh.mockResolvedValue({ ttlPhut: 123, toiDaSaiToken: 5, toiDaLanMo: 30, khoaPhut: 15, giuDuLieuNgay: 30, choXuLyToiDaNgay: 14 });
  h.tao.mockResolvedValue({ ok: true, id: "yc1", token: TOKEN, maLienKet: `yc1.${TOKEN}`, hetHanLuc: HET_HAN });
  h.huy.mockResolvedValue({ ok: true });
  h.nhapThay.mockResolvedValue({ ok: true, oDaDoi: ["ten"], oXungDot: [] });
  h.apDung.mockResolvedValue({ ok: true, orderId: "don1", cotDaDoi: [], hoaDonConHieuLuc: [] });
});

const DICH_VU = () => [h.tao, h.huy, h.nhapThay, h.apDung];
const goiTatCa = () => [
  () => taoYeuCauNguoiMuaAction("don1"),
  () => capLaiYeuCauNguoiMuaAction("don1", "yc0"),
  () => huyYeuCauNguoiMuaAction("don1", "yc0", "lý do"),
  () => nhapThayYeuCauNguoiMuaAction("don1", "yc0", { ten: "A" }),
  () => apDungYeuCauNguoiMuaAction("don1", "yc0", false),
];

describe("[YCN-A1] cổng đứng TRƯỚC dịch vụ", () => {
  it("chưa đăng nhập ⇒ cả năm action từ chối và KHÔNG gọi dịch vụ", async () => {
    h.auth.mockResolvedValue(null);
    for (const f of goiTatCa()) expect(await f()).toMatchObject({ ok: false, error: "Chưa đăng nhập" });
    for (const m of DICH_VU()) expect(m).not.toHaveBeenCalled();
  });

  it("đơn không thấy được (ngoài tầm scopedDb) ⇒ từ chối, không dịch vụ", async () => {
    h.donTim.mockResolvedValue(null);
    for (const f of goiTatCa()) expect(await f()).toMatchObject({ ok: false, error: "Không tìm thấy đơn hàng" });
    for (const m of DICH_VU()) expect(m).not.toHaveBeenCalled();
  });

  it("cờ THEO CƠ SỞ của đơn tắt ⇒ CHUA_BAT, không dịch vụ; cờ được hỏi với ĐÚNG centerId của đơn; đối chứng: bật thì chạy", async () => {
    h.batCo.mockResolvedValue(false);
    for (const f of goiTatCa()) expect(await f()).toMatchObject({ ok: false, ma: "CHUA_BAT" });
    for (const m of DICH_VU()) expect(m).not.toHaveBeenCalled();
    expect(h.batCo).toHaveBeenCalledWith("cs1");
    h.batCo.mockResolvedValue(true);
    expect((await taoYeuCauNguoiMuaAction("don1")).ok).toBe(true);
  });
});

describe("[YCN-A2] tạo mã QR", () => {
  it("liên kết = gốc công khai + /thong-tin-hoa-don/<id>.<token>; QR là ảnh data URI; TTL lấy từ CẤU HÌNH; token thô chỉ có trong kết quả", async () => {
    const r = await taoYeuCauNguoiMuaAction("don1");
    expect(r).toMatchObject({ ok: true, id: "yc1", lienKet: `https://test.satarobo.vn/thong-tin-hoa-don/yc1.${TOKEN}`, hetHanLuc: HET_HAN.toISOString() });
    expect(r.ok && r.qr.startsWith("data:image/svg+xml")).toBe(true);
    expect(h.tao).toHaveBeenCalledWith(expect.objectContaining({ orderId: "don1", ttlPhut: 123, phamVi: "DON" }));
    expect(h.revalidate).toHaveBeenCalledWith("/orders/don1");
  });

  it("thiếu gốc công khai ⇒ nói thẳng và KHÔNG tạo yêu cầu (tạo rồi không dựng được link là mất token một lần)", async () => {
    vi.stubEnv("AFFILIATE_PUBLIC_ORIGIN", "");
    const r = await taoYeuCauNguoiMuaAction("don1");
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain("AFFILIATE_PUBLIC_ORIGIN");
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("dịch vụ từ chối (đã có yêu cầu mở) ⇒ chuyển nguyên mã lỗi, không có token", async () => {
    h.tao.mockResolvedValue({ ok: false, ma: "DA_CO_YEU_CAU_MO", error: "Đơn đã có yêu cầu đang mở." });
    const r = await taoYeuCauNguoiMuaAction("don1");
    expect(r).toEqual({ ok: false, error: "Đơn đã có yêu cầu đang mở.", ma: "DA_CO_YEU_CAU_MO" });
  });
});

describe("[YCN-A3] cấp lại, nhập thay, áp dụng", () => {
  it("cấp lại: thu hồi yêu cầu cũ TRƯỚC rồi mới tạo mới; thu hồi lỗi ⇒ không tạo", async () => {
    const thuTu: string[] = [];
    h.huy.mockImplementation(async () => (thuTu.push("huy"), { ok: true }));
    h.tao.mockImplementation(async () => (thuTu.push("tao"), { ok: true, id: "yc2", token: TOKEN, maLienKet: "x", hetHanLuc: HET_HAN }));
    expect((await capLaiYeuCauNguoiMuaAction("don1", "yc1")).ok).toBe(true);
    expect(thuTu).toEqual(["huy", "tao"]);
    h.huy.mockResolvedValue({ ok: false, ma: "DA_DONG", error: "Yêu cầu đã được xử lý." });
    h.tao.mockClear();
    expect(await capLaiYeuCauNguoiMuaAction("don1", "yc1")).toMatchObject({ ok: false, ma: "DA_DONG" });
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("nhập thay: chuyển lỗi theo ô cho UI; áp dụng: ghiDe=false ⇒ TU_CHOI, ghiDe=true ⇒ GHI_DE", async () => {
    h.nhapThay.mockResolvedValue({ ok: false, ma: "DU_LIEU_SAI", error: "Có ô chưa hợp lệ.", loiTheoO: { email: "Email chưa đúng" } });
    expect(await nhapThayYeuCauNguoiMuaAction("don1", "yc1", { email: "x" })).toMatchObject({ ok: false, loiTheoO: { email: "Email chưa đúng" } });
    await apDungYeuCauNguoiMuaAction("don1", "yc1", false);
    expect(h.apDung).toHaveBeenLastCalledWith(expect.objectContaining({ id: "yc1", khiDonDaDoi: "TU_CHOI" }));
    await apDungYeuCauNguoiMuaAction("don1", "yc1", true);
    expect(h.apDung).toHaveBeenLastCalledWith(expect.objectContaining({ khiDonDaDoi: "GHI_DE" }));
  });

  it("áp dụng thành công làm mới trang đơn + trang hoá đơn; lỗi DON_DA_DOI chuyển nguyên mã để UI hiện nút «Ghi đè»", async () => {
    await apDungYeuCauNguoiMuaAction("don1", "yc1", false);
    expect(h.revalidate).toHaveBeenCalledWith("/orders/don1");
    expect(h.revalidate).toHaveBeenCalledWith("/payments/hoa-don");
    h.apDung.mockResolvedValue({ ok: false, ma: "DON_DA_DOI", error: "Đơn đã được sửa (invoiceEmail)." });
    expect(await apDungYeuCauNguoiMuaAction("don1", "yc1", false)).toMatchObject({ ok: false, ma: "DON_DA_DOI" });
  });
});

describe("[YCN-A4] không rò token", () => {
  it("không log token ra console; kết quả lỗi không chứa token", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => undefined));
    await taoYeuCauNguoiMuaAction("don1");
    h.tao.mockResolvedValue({ ok: false, ma: "KHONG_CO_QUYEN", error: "Không có quyền." });
    const r = await taoYeuCauNguoiMuaAction("don1");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(TOKEN);
    spies.forEach((s) => s.mockRestore());
  });
});
