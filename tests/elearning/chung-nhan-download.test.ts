// @vitest-environment node
/**
 * EL-16·B — ai tải được bản PDF chứng nhận (`GET /api/elearning/chung-nhan?id=`).
 *
 * Bản PDF mang họ tên + mã nhân viên của một con người. Hợp đồng (đọc từ chính route):
 *   · chưa đăng nhập / phiên chết ⇒ 401, KHÔNG chạm DB;
 *   · chứng nhận KHÔNG nằm trong tầm nhìn cơ sở của người gọi (`scopedDb` trả null) ⇒ 404;
 *   · trong tầm nhìn nhưng KHÔNG phải chính chủ và KHÔNG có `progress:view-all` ⇒ 403 — đây là
 *     ca mà `scopedDb` một mình KHÔNG chặn được (đồng nghiệp CÙNG cơ sở), nên phải có phép so
 *     `userId` tường minh;
 *   · chính chủ ⇒ 200 PDF; người có `progress:view-all` ⇒ 200 PDF (đối chứng dương).
 *
 * Mọi ca âm tính kèm đối chứng dương để "bị chặn" không thể là vì route hỏng hẳn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  phien: null as null | { user: { id: string } },
  coQuyenXemTatCa: false,
  chungNhan: null as null | Record<string, unknown>,
  timCn: vi.fn(),
  timKhoa: vi.fn(),
  render: vi.fn(async () => Buffer.from("%PDF-gia")),
}));

vi.mock("@/lib/auth/live-session", () => ({ requireLiveSession: async () => h.phien }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: async () => ({ userId: "actor" }) }));
vi.mock("@/lib/auth/can", () => ({
  can: (_a: unknown, key: string) => key === "elearning:progress:view-all" && h.coQuyenXemTatCa,
}));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    trnCertificate: { findFirst: h.timCn },
    trnCourse: { findFirst: h.timKhoa },
  }),
}));
vi.mock("@/lib/auth/hosts", () => ({ elearningHomeUrl: () => "https://e-learning.test" }));
vi.mock("@/lib/pdf/brand", () => ({ withFreshFonts: (f: () => Promise<unknown>) => f() }));
vi.mock("@/lib/pdf/certificate", () => ({ CertificatePdf: () => null }));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: h.render }));
vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:image/png;base64,AA==" } }));

import { GET } from "@/app/api/elearning/chung-nhan/route";

const CN = {
  id: "cn1",
  userId: "u-chu",
  certCode: "SR.CN.2026.00001",
  verifyToken: "a".repeat(32),
  snapFullName: "Nguyễn Văn A",
  snapEmployeeCode: "NV001",
  issuedAt: new Date("2026-10-01T00:00:00Z"),
  validUntil: null,
  revokedAt: null,
  status: "VALID",
  courseId: "k1",
};

const goi = (id?: string) =>
  new NextRequest(`http://localhost/api/elearning/chung-nhan${id ? `?id=${id}` : ""}`);

beforeEach(() => {
  // Cổng cờ chung của API (đặc tả §4.8): route 404 khi ELEARNING_ENABLED tắt ⇒ các ca dưới bật tường minh.
  process.env.ELEARNING_ENABLED = "true";
  vi.clearAllMocks();
  h.phien = { user: { id: "u-chu" } };
  h.coQuyenXemTatCa = false;
  h.timCn.mockResolvedValue(CN);
  h.timKhoa.mockResolvedValue({ title: "Khoá thử" });
});

describe("tải PDF chứng nhận — ai được tải", () => {
  it("ĐỐI CHỨNG DƯƠNG: chính chủ ⇒ 200 và đúng loại PDF, không cache", async () => {
    const r = await GET(goi("cn1"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(h.render).toHaveBeenCalledTimes(1);
  });

  it("ĐỐI CHỨNG DƯƠNG: người có `progress:view-all` (không phải chính chủ) ⇒ 200", async () => {
    h.phien = { user: { id: "u-dao-tao" } };
    h.coQuyenXemTatCa = true;
    const r = await GET(goi("cn1"));
    expect(r.status).toBe(200);
  });

  it("🔴 đồng nghiệp CÙNG cơ sở, không phải chính chủ, không có view-all ⇒ 403 và KHÔNG dựng PDF", async () => {
    h.phien = { user: { id: "u-dong-nghiep" } };
    h.coQuyenXemTatCa = false;
    const r = await GET(goi("cn1"));
    expect(r.status).toBe(403);
    expect(h.render).not.toHaveBeenCalled();
  });

  it("chứng nhận ngoài tầm nhìn cơ sở (scopedDb trả null) ⇒ 404, KHÔNG dựng PDF", async () => {
    h.timCn.mockResolvedValue(null);
    const r = await GET(goi("cn1"));
    expect(r.status).toBe(404);
    expect(h.render).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập / phiên chết ⇒ 401 và KHÔNG chạm DB", async () => {
    h.phien = null;
    const r = await GET(goi("cn1"));
    expect(r.status).toBe(401);
    expect(h.timCn).not.toHaveBeenCalled();
    expect(h.render).not.toHaveBeenCalled();
  });

  it("thiếu ?id= ⇒ lỗi kiểm tra đầu vào, không chạm DB", async () => {
    const r = await GET(goi());
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(h.timCn).not.toHaveBeenCalled();
  });
});

describe("cổng cờ chung — ELEARNING_ENABLED tắt ⇒ route 404, không đọc phiên, không chạm DB", () => {
  afterEach(() => {
    process.env.ELEARNING_ENABLED = "true";
  });

  it("cờ OFF ⇒ 404 dù người gọi là chính chủ", async () => {
    delete process.env.ELEARNING_ENABLED;
    const r = await GET(goi("cn1"));
    expect(r.status).toBe(404);
    expect(h.timCn).not.toHaveBeenCalled();
    expect(h.render).not.toHaveBeenCalled();
  });
});
