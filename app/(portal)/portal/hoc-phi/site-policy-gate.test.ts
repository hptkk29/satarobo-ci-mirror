// @vitest-environment node
/**
 * Hồ sơ BCT mục 4 — CỔNG CHẶN `/portal/hoc-phi` và SERVER ACTION ghi đồng ý.
 *
 * Hai thứ này phải test CÙNG NHAU vì chúng là hai endpoint HTTP riêng biệt: chặn ở layout
 * mà bỏ action thì cổng chỉ là tấm màn (ai cũng POST thẳng action được), còn chặn action
 * mà bỏ layout thì số công nợ vẫn rời DB.
 *
 * ⚠️ `redirect` của Next PHẢI được giả lập là NÉM LỖI, đúng như bản thật. Một mock chỉ ghi
 * nhận lời gọi sẽ khiến ca "chưa đăng nhập" xanh trong khi mã vẫn chạy tiếp xuống dưới và
 * dữ liệu đã kịp rời DB.
 *
 * ⚠️ Bất biến quan trọng nhất là `children` KHÔNG VÀO CÂY khi chưa đồng ý — không phải
 * "gate được render". Ẩn UI mà vẫn dựng children thì page RSC đã chạy và số tiền đã nằm
 * trong payload; mở DevTools là đọc.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  hasAccepted: vi.fn(),
  record: vi.fn(),
  revalidatePath: vi.fn(),
  headersGet: vi.fn(() => null as string | null),
}));

class RedirectError extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: h.headersGet }) }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/legal/site-policy", () => ({
  hasAcceptedSitePolicy: h.hasAccepted,
  recordSitePolicyAcceptance: h.record,
}));
// Màn cổng là Client Component; ở đây chỉ cần một dấu nhận biết.
vi.mock("./_components/site-policy-gate", () => ({
  SitePolicyGate: () => "GATE",
}));

const { default: HocPhiLayout } = await import("./layout");
const { acceptSitePolicyAction } = await import("./actions");

/** Chuỗi mật: nếu nó lọt ra cây khi chưa đồng ý thì children đã bị dựng. */
const SO_TIEN_BI_MAT = "SO-TIEN-BI-MAT-4213";

beforeEach(() => {
  h.auth.mockReset();
  h.hasAccepted.mockReset();
  h.record.mockReset();
  h.revalidatePath.mockReset();
});

const chay = (children: unknown = SO_TIEN_BI_MAT) =>
  HocPhiLayout({ children: children as React.ReactNode });

describe("cổng chính sách hoạt động — layout /portal/hoc-phi", () => {
  it("[GATE-01] chưa đăng nhập ⇒ redirect /login và KHÔNG hỏi sổ", async () => {
    h.auth.mockResolvedValue(null);
    await expect(chay()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(h.hasAccepted).not.toHaveBeenCalled();
  });

  it("[GATE-02] không phải PARENT ⇒ redirect, KHÔNG thấy màn chính sách", async () => {
    // Nhân viên không bao giờ được thấy màn dành cho phụ huynh.
    h.auth.mockResolvedValue({ user: { id: "nv1", role: "TEACHER" } });
    await expect(chay()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(h.hasAccepted).not.toHaveBeenCalled();
  });

  it("[GATE-03] chưa đồng ý ⇒ trả cổng, children KHÔNG vào cây", async () => {
    h.auth.mockResolvedValue({ user: { id: "ph1", role: "PARENT" } });
    h.hasAccepted.mockResolvedValue(false);
    const cay = JSON.stringify(await chay());
    expect(cay).not.toContain(SO_TIEN_BI_MAT);
  });

  it("[GATE-04] đã đồng ý ⇒ children QUA (đối chứng dương)", async () => {
    // Thiếu ca này thì một bản vá "chặn sạch mọi phụ huynh" cũng xanh.
    h.auth.mockResolvedValue({ user: { id: "ph1", role: "PARENT" } });
    h.hasAccepted.mockResolvedValue(true);
    const cay = JSON.stringify(await chay());
    expect(cay).toContain(SO_TIEN_BI_MAT);
  });

  it("[GATE-05] hỏi sổ đúng userId của phiên", async () => {
    h.auth.mockResolvedValue({ user: { id: "ph-xyz", role: "PARENT" } });
    h.hasAccepted.mockResolvedValue(true);
    await chay();
    expect(h.hasAccepted).toHaveBeenCalledWith("ph-xyz");
  });
});

describe("Server Action ghi đồng ý", () => {
  it("[ACT-01] không phiên ⇒ từ chối và KHÔNG ghi", async () => {
    h.auth.mockResolvedValue(null);
    await expect(acceptSitePolicyAction()).resolves.toMatchObject({ ok: false });
    expect(h.record).not.toHaveBeenCalled();
  });

  it("[ACT-02] không phải PARENT ⇒ từ chối và KHÔNG ghi", async () => {
    // Server Action là endpoint HTTP riêng — layout chặn không che được nó.
    h.auth.mockResolvedValue({ user: { id: "nv1", role: "HR" } });
    await expect(acceptSitePolicyAction()).resolves.toMatchObject({ ok: false });
    expect(h.record).not.toHaveBeenCalled();
  });

  it("[ACT-03] ghi cho userId CỦA PHIÊN, không nhận từ đầu vào", async () => {
    h.auth.mockResolvedValue({ user: { id: "ph-that", role: "PARENT" } });
    await acceptSitePolicyAction();
    expect(h.record).toHaveBeenCalledWith("ph-that", expect.anything());
  });

  it('[ACT-04] revalidate đúng ("/portal/hoc-phi", "layout")', async () => {
    // "page" thì layout vẫn dựng lại màn chính sách và người vừa bấm bị đá về chỗ cũ.
    h.auth.mockResolvedValue({ user: { id: "ph1", role: "PARENT" } });
    await acceptSitePolicyAction();
    expect(h.revalidatePath).toHaveBeenCalledWith("/portal/hoc-phi", "layout");
  });
});
