// @vitest-environment node
//
// Ca [MDR-*] — route xuất đơn bảo lưu .docx. Test HÀNH VI của cổng: quyền, body, tầm nhìn cơ sở, công tắc, mẫu theo cơ sở
// (KHÔNG đường lùi), audit TRƯỚC khi trả file, nhật ký không chứa nội dung đơn, và file ra mang đúng giá trị client gửi.
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chuTrongXml } from "@/lib/bao-luu/mau-don-docx";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  studentFindFirst: vi.fn(),
  centerFindFirst: vi.fn(),
  writeAudit: vi.fn(async (_a: unknown) => ({ id: "audit-1" })),
  laBat: vi.fn(async () => true),
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({ student: { findFirst: h.studentFindFirst }, center: { findFirst: h.centerFindFirst } }),
}));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
vi.mock("@/lib/bao-luu/feature", () => ({ laBaoLuuBat: h.laBat, LOI_BAO_LUU_TAT: "TAT" }));

import { POST } from "./route";

const DON = {
  phuHuynh: { hoTen: "Nguyễn Thị Lan", quanHe: "Mẹ", dienThoai: "0905123456", email: "lan@example.com" },
  hocVien: { hoTen: "Trần Minh Khang", ngaySinh: "12/03/2016", ma: "HV0042", khoa: "Sata 3", lop: "L1", giaoVien: "GV A" },
  lyDo: ["FAMILY"],
  lyDoKhac: "",
  danhSachKhoa: [] as string[],
  thoiGian: { baoLuuTu: "", hocLaiDuKien: "20/01/2027", nghiTuNgay: "" },
};
const HV = { id: "hv1", centerId: "c1", orgUnitId: "ou1", studentCode: "HV0042" };

const post = (body: unknown) =>
  POST(new Request("https://admin.satarobo.vn/api/admin/bao-luu/mau-don", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const quyen = (...cho: string[]) => h.checkPermission.mockImplementation(async (a: string) => cho.includes(a));

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Sale" } });
  quyen("bao-luu:create");
  h.resolveActor.mockResolvedValue({ isHoLevel: false, visibleOrgUnitIds: ["ou1"] });
  h.studentFindFirst.mockResolvedValue({ ...HV });
  h.centerFindFirst.mockResolvedValue({ code: "CS1" });
  h.laBat.mockResolvedValue(true);
  h.writeAudit.mockResolvedValue({ id: "audit-1" });
});

describe("[MDR-01] cổng vào", () => {
  it("chưa đăng nhập ⇒ 401; thiếu bao-luu:create ⇒ 403 (không chạm DB)", async () => {
    h.auth.mockResolvedValue(null);
    expect((await post({ studentId: "hv1", don: DON })).status).toBe(401);
    h.auth.mockResolvedValue({ user: { id: "u1" } });
    quyen("bao-luu:view");
    expect((await post({ studentId: "hv1", don: DON })).status).toBe(403);
    expect(h.studentFindFirst).not.toHaveBeenCalled();
  });

  it("body không phải JSON / thiếu studentId / giá trị quá dài ⇒ 400, không audit", async () => {
    expect((await post("{không phải json")).status).toBe(400);
    expect((await post({ don: DON })).status).toBe(400);
    expect((await post({ studentId: "hv1", don: { ...DON, phuHuynh: { ...DON.phuHuynh, hoTen: "x".repeat(500) } } })).status).toBe(400);
    expect((await post({ studentId: "hv1", don: { ...DON, lyDo: ["KHONG_CO"] } })).status).toBe(400);
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("học viên ngoài tầm nhìn cơ sở (scopedDb trả null) ⇒ 404, KHÔNG 403 (không lộ sự tồn tại)", async () => {
    h.studentFindFirst.mockResolvedValue(null);
    const r = await post({ studentId: "hv-khac", don: DON });
    expect(r.status).toBe(404);
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("công tắc bảo lưu TẮT ở cơ sở của học viên ⇒ 403, hỏi đúng orgUnitId của học viên", async () => {
    h.laBat.mockResolvedValue(false);
    expect((await post({ studentId: "hv1", don: DON })).status).toBe(403);
    expect(h.laBat).toHaveBeenCalledWith("ou1");
    expect(h.writeAudit).not.toHaveBeenCalled();
  });
});

describe("[MDR-02] mẫu theo cơ sở — không có đường lùi", () => {
  it.each([["CS3"], [null], ["HO"]])("cơ sở %s chưa có mẫu ⇒ 422 và KHÔNG xuất file mẫu của cơ sở khác", async (ma) => {
    h.centerFindFirst.mockResolvedValue(ma === null ? null : { code: ma });
    const r = await post({ studentId: "hv1", don: DON });
    expect(r.status).toBe(422);
    expect(r.headers.get("content-type")).not.toContain("wordprocessingml");
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("học viên chưa gắn cơ sở (centerId null) ⇒ 422, không tra cơ sở", async () => {
    h.studentFindFirst.mockResolvedValue({ ...HV, centerId: null });
    expect((await post({ studentId: "hv1", don: DON })).status).toBe(422);
    expect(h.centerFindFirst).not.toHaveBeenCalled();
  });

  it("CS2 ra mẫu của pháp nhân CS2 (New Vision), CS1 ra STEM Robotics & AI", async () => {
    const ra = async (ma: string) => {
      h.centerFindFirst.mockResolvedValue({ code: ma });
      const r = await post({ studentId: "hv1", don: DON });
      expect(r.status).toBe(200);
      const z = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()));
      return chuTrongXml(await z.file("word/document.xml")!.async("string")).join("|");
    };
    expect(await ra("CS2")).toContain("NEW VISION");
    expect(await ra("CS1")).toContain("STEM ROBOTICS");
    expect(await ra("CS1")).not.toContain("NEW VISION");
  });
});

describe("[MDR-03] file ra và nhật ký", () => {
  it("200: .docx đúng loại, no-store, tên tệp ASCII; giá trị client gửi nằm trong file (không tính lại từ DB)", async () => {
    const r = await post({ studentId: "hv1", don: DON });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("wordprocessingml.document");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="don-bao-luu-HV0042-CS1.docx"');
    const z = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()));
    const chu = chuTrongXml(await z.file("word/document.xml")!.async("string"));
    expect(chu).toContain("Nguyễn Thị Lan\t");
    expect(chu).toContain("20/01/2027\t");
    // Ô thứ hai của hàng nằm sau một tab trong cùng chạy chữ ⇒ so theo "chứa", không so bằng.
    expect(chu.some((t) => t.includes("☒ Gia đình có việc dài ngày"))).toBe(true);
  });

  it("audit ghi TRƯỚC khi trả file, gắn đúng học viên + đơn vị, và KHÔNG chứa nội dung đơn (SĐT/email/ngày sinh)", async () => {
    await post({ studentId: "hv1", don: DON });
    expect(h.writeAudit).toHaveBeenCalledTimes(1);
    const a = h.writeAudit.mock.calls[0]![0] as { entityId: string; orgUnitId: string; action: string; newValues: Record<string, unknown> };
    expect(a).toMatchObject({ entityId: "hv1", orgUnitId: "ou1", action: "XUAT_DON_BAO_LUU" });
    const luu = JSON.stringify(a.newValues);
    for (const pii of ["0905123456", "lan@example.com", "12/03/2016", "Nguyễn Thị Lan"]) expect(luu).not.toContain(pii);
  });

  it("audit NÉM ⇒ 503 và KHÔNG trả file (tệp mang SĐT phụ huynh + tên trẻ em)", async () => {
    h.writeAudit.mockRejectedValue(new Error("db chết"));
    const r = await post({ studentId: "hv1", don: DON });
    expect(r.status).toBe(503);
    expect(r.headers.get("content-type")).not.toContain("wordprocessingml");
  });
});
