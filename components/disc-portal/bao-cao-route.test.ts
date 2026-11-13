/**
 * [DPR-*] — route tải lại báo cáo DISC của phụ huynh, chạy HÀM THẬT với cổng phiên + cổng đọc giả.
 *   [DPR-01] cờ tắt ⇒ 404; chưa đăng nhập ⇒ 401; không chạm cổng đọc ở hai ca đó
 *   [DPR-02] bài không thuộc user (cổng đọc trả null) ⇒ 404, KHÔNG ném lỗi (không phân biệt "lạ" với "của người khác")
 *   [DPR-03] hợp lệ ⇒ 200 HTML, không cache chung, CSP chặt, userId lấy từ PHIÊN chứ không từ URL
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const gia = vi.hoisted(() => ({
  phien: { ok: true, userId: "u-me" } as { ok: true; userId: string } | { ok: false; loai: "CO_TAT" | "CHUA_DANG_NHAP" },
  docChiTietLuot: vi.fn(),
  dungHtml: vi.fn(),
}));

vi.mock("@/app/(portal)/portal/disc/_lib/phien-disc", () => ({ docPhienDisc: async () => gia.phien }));
vi.mock("@/lib/disc/portal-doc", () => ({ docChiTietLuot: gia.docChiTietLuot, dungBaoCaoHtmlChoLuot: gia.dungHtml }));

import { GET } from "@/app/(portal)/portal/disc/[id]/bao-cao/route";

const goi = (id = "bai-1") => GET(new Request("http://localhost/portal/disc/x/bao-cao"), { params: Promise.resolve({ id }) });

beforeEach(() => {
  gia.phien = { ok: true, userId: "u-me" };
  gia.docChiTietLuot.mockReset();
  // Hàm thật ném khi nhận null (đọc `l.nguoi`) — mock cũng phải ném, nếu không route bỏ cổng null vẫn xanh vì mock nuốt lỗi.
  gia.dungHtml.mockReset().mockImplementation((l: unknown) => {
    if (!l) throw new TypeError("luot null");
    return null;
  });
});

describe("[DPR-01] cổng phiên", () => {
  it("cờ tắt ⇒ 404; chưa đăng nhập ⇒ 401; không chạm cổng đọc", async () => {
    gia.phien = { ok: false, loai: "CO_TAT" };
    expect((await goi()).status).toBe(404);
    gia.phien = { ok: false, loai: "CHUA_DANG_NHAP" };
    expect((await goi()).status).toBe(401);
    expect(gia.docChiTietLuot).not.toHaveBeenCalled();
  });
});

describe("[DPR-02] bài không đọc được", () => {
  it("cổng đọc trả null ⇒ 404 (không ném lỗi); có luot nhưng không dựng được HTML ⇒ cũng 404", async () => {
    gia.docChiTietLuot.mockResolvedValue(null);
    expect((await goi("cua-nguoi-khac")).status).toBe(404);
    gia.docChiTietLuot.mockResolvedValue({ id: "x" });
    gia.dungHtml.mockReturnValue(null);
    expect((await goi()).status).toBe(404);
  });
});

describe("[DPR-03] hợp lệ", () => {
  it("200 HTML; userId từ phiên; header an toàn", async () => {
    gia.docChiTietLuot.mockResolvedValue({ id: "bai-1" });
    gia.dungHtml.mockReturnValue("<!doctype html><p>gia</p>");
    const r = await goi("bai-1");
    expect(r.status).toBe(200);
    expect(gia.docChiTietLuot).toHaveBeenCalledWith("u-me", "bai-1");
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
    expect(r.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(await r.text()).toContain("gia");
  });
});
