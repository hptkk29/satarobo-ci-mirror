// @vitest-environment node
// POST /api/admin/upload-url — đường mở theo QUYỀN cho BLĐ đính kèm văn bản khuyến mãi (26/09/2026).
//
// Vai `GIAM_DOC` chỉ có ở RBAC v2 nên KHÔNG khớp `allowedRoles` v1 — đường vào của họ là quyền
// `promotions:manage`, và chỉ được ký TÀI LIỆU + ẢNH (không video/âm thanh/nén). Test hành vi thật
// của route với auth/quyền/R2 giả lập: không mạng, không DB.
import { describe, it, expect, vi, beforeEach } from "vitest";

const Q = vi.hoisted(() => ({ role: "HR", quyen: new Set<string>() }));

vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "u1", role: Q.role } }) }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: async (p: string) => Q.quyen.has(p) }));
vi.mock("@/lib/settings/service", () => ({ getSetting: async () => 300 }));
vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: () => ({}),
  getR2Bucket: () => "bucket",
  getPublicUrl: (k: string) => `https://cdn.example/${k}`,
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: async () => "https://r2.example/ky" }));

import { POST } from "./route";

function yeuCau(category: string, filename: string, mimeType: string) {
  return new Request("http://localhost/api/admin/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ category, filename, mimeType, sizeBytes: 1000 }),
  }) as unknown as Parameters<typeof POST>[0];
}

describe("[UP-KM] người giữ promotions:manage (vai v2, không có trong allowedRoles v1)", () => {
  beforeEach(() => {
    Q.role = "HR";
    Q.quyen = new Set(["promotions:manage"]);
  });

  it("[UP-KM-01] ký được TÀI LIỆU (PDF) và ẢNH chụp văn bản", async () => {
    expect((await POST(yeuCau("document", "SR.QD.233.pdf", "application/pdf"))).status).toBe(200);
    expect((await POST(yeuCau("image", "ban-ky.jpg", "image/jpeg"))).status).toBe(200);
  });

  it("[UP-KM-02] KHÔNG ký được video/âm thanh — quyền ban hành văn bản không phải quyền đăng học liệu", async () => {
    expect((await POST(yeuCau("video", "clip.mp4", "video/mp4"))).status).toBe(403);
    expect((await POST(yeuCau("audio", "a.mp3", "audio/mpeg"))).status).toBe(403);
  });

  it("[UP-KM-03] đối chứng: KHÔNG có promotions:manage (và vai v1 không được phép) ⇒ 403 ngay cả với PDF", async () => {
    Q.quyen = new Set();
    expect((await POST(yeuCau("document", "SR.QD.233.pdf", "application/pdf"))).status).toBe(403);
  });
});
