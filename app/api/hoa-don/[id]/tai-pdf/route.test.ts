// @vitest-environment node
//
// Ca [PPR-*] — ROUTE TẢI PDF PHÂN PHỐI (Sale + phụ huynh): mã trạng thái thống nhất, header, nhánh người xem, không redirect/khoá kho.
// Quyết định ai-được-tải-bản-nào nằm ở `moTepChoNguoiXem` (đo trên Postgres thật ở tests/finance/hoa-don-phan-phoi-db.test.ts); ở đây chỉ canh lớp HTTP.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  getPortalContext: vi.fn(),
  mo: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/portal/session", () => ({ getPortalContext: h.getPortalContext }));
vi.mock("@/lib/finance/hoa-don/phan-phoi-db", () => ({ moTepChoNguoiXem: h.mo }));

import { GET } from "./route";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const OK = { ok: true as const, than: PDF, tenTep: "hoa-don-1C26TSR-127.pdf" };
const KHONG = { ok: false as const, ma: "KHONG_TIM_THAY" as const };
const goi = (id = "hd1") => GET(new Request(`https://hocvien.satarobo.vn/api/hoa-don/${id}/tai-pdf`), { params: Promise.resolve({ id }) });

function vai(o: { nhanVien: boolean; phuHuynh: boolean }) {
  h.checkPermission.mockImplementation(async () => o.nhanVien);
  h.getPortalContext.mockResolvedValue(o.phuHuynh ? { parentUserId: "u1", children: [{ id: "c1" }, { id: "c2" }] } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Nguyen Van A" } });
  h.resolveActor.mockResolvedValue({ actor: true });
  h.mo.mockResolvedValue(OK);
  vai({ nhanVien: true, phuHuynh: false });
});

describe("[PPR-01] cổng vào: 401 / 403 / 404 thống nhất", () => {
  it("chưa đăng nhập ⇒ 401, không hỏi quyền, không mở tệp", async () => {
    h.auth.mockResolvedValue(null);
    const r = await goi();
    expect(r.status).toBe(401);
    expect(h.checkPermission).not.toHaveBeenCalled();
    expect(h.mo).not.toHaveBeenCalled();
  });
  it("không phải nhân viên có quyền, cũng không phải phụ huynh ⇒ 403; đối chứng: nhân viên có quyền ⇒ qua cổng", async () => {
    vai({ nhanVien: false, phuHuynh: false });
    expect((await goi()).status).toBe(403);
    expect(h.mo).not.toHaveBeenCalled();
    vai({ nhanVien: true, phuHuynh: false });
    expect((await goi()).status).toBe(200);
  });
  it("không tìm thấy / không phải của bạn / sai trạng thái / cờ tắt ⇒ CÙNG một 404 và cùng thông điệp", async () => {
    h.mo.mockResolvedValue(KHONG);
    const r = await goi("khong-co");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Không tìm thấy hoá đơn" });
    // đối chứng dương cùng đường
    h.mo.mockResolvedValue(OK);
    expect((await goi()).status).toBe(200);
  });
  it("kho / nhật ký lỗi ⇒ 503, thân không chứa gì ngoài thông điệp", async () => {
    for (const ma of ["KHO_CHUA_CAU_HINH", "KHO_LOI", "AUDIT_LOI"] as const) {
      h.mo.mockResolvedValue({ ok: false, ma });
      const r = await goi();
      expect(r.status).toBe(503);
      expect(Object.keys(await r.json())).toEqual(["error"]);
    }
  });
});

describe("[PPR-02] thành công: trả byte PDF, header an toàn, KHÔNG redirect", () => {
  it("200 + application/pdf + attachment + private no-store + nosniff; thân đúng byte; không Location", async () => {
    const r = await goi();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="hoa-don-1C26TSR-127.pdf"');
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("location")).toBeNull();
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PDF);
  });
  it("lỗi cũng mang Cache-Control private, no-store", async () => {
    h.mo.mockResolvedValue(KHONG);
    expect((await goi()).headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("[PPR-03] nhánh người xem: nhân viên trước, phụ huynh sau, và không che lỗi kho", () => {
  it("nhân viên tìm thấy ⇒ chỉ MỘT lượt mở (kênh nhân viên); phụ huynh không bị hỏi", async () => {
    vai({ nhanVien: true, phuHuynh: true });
    await goi();
    expect(h.mo).toHaveBeenCalledTimes(1);
    expect(h.mo.mock.calls[0]![0].nguoi.loai).toBe("NHAN_VIEN");
  });
  it("nhân viên không thấy ⇒ thử tư cách phụ huynh, owner = đúng con trong phiên", async () => {
    vai({ nhanVien: true, phuHuynh: true });
    h.mo.mockResolvedValueOnce(KHONG).mockResolvedValueOnce(OK);
    const r = await goi();
    expect(r.status).toBe(200);
    expect(h.mo).toHaveBeenCalledTimes(2);
    expect(h.mo.mock.calls[1]![0].nguoi).toEqual({ loai: "PHU_HUYNH", owner: { parentUserId: "u1", childIds: ["c1", "c2"] } });
  });
  it("phụ huynh thuần ⇒ KHÔNG dựng actor nhân viên, chỉ một lượt kênh phụ huynh", async () => {
    vai({ nhanVien: false, phuHuynh: true });
    await goi();
    expect(h.resolveActor).not.toHaveBeenCalled();
    expect(h.mo).toHaveBeenCalledTimes(1);
    expect(h.mo.mock.calls[0]![0].nguoi.loai).toBe("PHU_HUYNH");
  });
  it("nhánh nhân viên gặp lỗi kho (503) ⇒ trả 503 luôn, không rơi sang nhánh phụ huynh để che", async () => {
    vai({ nhanVien: true, phuHuynh: true });
    h.mo.mockResolvedValueOnce({ ok: false, ma: "KHO_LOI" });
    expect((await goi()).status).toBe(503);
    expect(h.mo).toHaveBeenCalledTimes(1);
  });
  it("quyền nhân viên cần CẢ orders:view lẫn orders:view-pii; thiếu một ⇒ không vào nhánh nhân viên", async () => {
    h.checkPermission.mockImplementation(async (a: string) => a === "orders:view");
    h.getPortalContext.mockResolvedValue(null);
    expect((await goi()).status).toBe(403);
    h.checkPermission.mockImplementation(async (a: string) => a === "orders:view-pii");
    expect((await goi()).status).toBe(403);
    expect(h.mo).not.toHaveBeenCalled();
    h.checkPermission.mockImplementation(async () => true);
    expect((await goi()).status).toBe(200);
  });
});

describe("[PPR-04] audit nhận danh tính từ phiên, không từ URL", () => {
  it("nguoiDung = id + tên của phiên; hoaDonId là đối số, không có studentId nào đi vào lời gọi", async () => {
    vai({ nhanVien: false, phuHuynh: true });
    await goi("hd9");
    const arg = h.mo.mock.calls[0]![0];
    expect(arg).toMatchObject({ hoaDonId: "hd9", nguoiDung: { id: "u1", ten: "Nguyen Van A" } });
    expect(JSON.stringify(arg)).not.toMatch(/studentId/);
  });
});
