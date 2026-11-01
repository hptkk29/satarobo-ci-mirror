// @vitest-environment node
/**
 * `docCoSoBatPhamVi` — bảng cờ theo cơ sở cho trang tạo đơn. Spy trực tiếp hai phụ thuộc để tách các nhánh mà
 * kết quả cuối (`{id: boolean}`) không phân biệt được: cơ sở mồ côi KHÔNG được làm tốn một lần hỏi cờ, và cờ phải
 * được hỏi theo OrgUnit chứ không theo `Center.id`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ co: vi.fn(), ou: vi.fn() }));
vi.mock("@/lib/entitlements/feature", () => ({
  laThuHocPhiTheoPhamViBat: h.co,
  docCheDoMocNgay: vi.fn(),
  docThuTuConMacDinh: vi.fn(),
}));
vi.mock("@/lib/org/org-service", () => ({ orgUnitIdForCenter: h.ou }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/settings/service", () => ({ getSetting: vi.fn() }));

import { docCoSoBatPhamVi } from "./ap-dung";

beforeEach(() => {
  vi.clearAllMocks();
  h.ou.mockImplementation(async (id: string) => (id === "c-orphan" ? null : "ou-" + id));
  h.co.mockImplementation(async (ou: string) => ou === "ou-c2");
});

describe("[PB-G1] docCoSoBatPhamVi", () => {
  it("cờ hỏi theo OrgUnit; cơ sở mồ côi ⇒ false và KHÔNG hỏi cờ; đủ mọi cơ sở trong kết quả", async () => {
    const kq = await docCoSoBatPhamVi(["c1", "c2", "c-orphan"]);
    expect(kq).toEqual({ c1: false, c2: true, "c-orphan": false });
    expect(h.co.mock.calls.map((c) => c[0]).sort()).toEqual(["ou-c1", "ou-c2"]);
  });
  it("[đối chứng] danh sách rỗng ⇒ {} và không hỏi gì", async () => {
    expect(await docCoSoBatPhamVi([])).toEqual({});
    expect(h.co).not.toHaveBeenCalled();
  });
});
