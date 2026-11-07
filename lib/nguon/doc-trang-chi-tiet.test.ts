// @vitest-environment node
/**
 * [CTN-DM-*] `docMuc` — cô lập lỗi theo mục của trang chi tiết nguồn. Thuần (không DB: các hàm đọc không được gọi ở đây).
 *
 *   [CTN-DM-01] thành công ⇒ {ok:true}; PermissionError ⇒ QUYEN (KHÔNG log như lỗi); lỗi khác ⇒ LOI + log chỉ TÊN lỗi (thông điệp Prisma có thể mang giá trị tham số)
 *   [CTN-DM-02] lỗi một mục không ném ra ngoài: các mục chạy song song vẫn có kết quả
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({}) }));

import { PermissionError } from "@/lib/auth/can";
import { docMuc } from "./doc-trang-chi-tiet";

afterEach(() => vi.restoreAllMocks());

describe("[CTN-DM-01] docMuc", () => {
  it("thành công", async () => {
    expect(await docMuc("x", async () => 5)).toEqual({ ok: true, du: 5 });
  });
  it("PermissionError ⇒ QUYEN và KHÔNG ghi log lỗi (thiếu quyền không phải sự cố)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await docMuc("x", async () => Promise.reject(new PermissionError()))).toEqual({ ok: false, loai: "QUYEN" });
    expect(log).not.toHaveBeenCalled();
  });
  it("lỗi khác ⇒ LOI; log CHỈ tên lỗi, không thông điệp (có thể mang giá trị tham số / SĐT)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    class LoiGia extends Error {
      constructor() {
        super("Invalid `db.lead.count()` … phone: 0901234567");
        this.name = "PrismaClientKnownRequestError";
      }
    }
    expect(await docMuc("thống kê", async () => Promise.reject(new LoiGia()))).toEqual({ ok: false, loai: "LOI" });
    expect(log).toHaveBeenCalledTimes(1);
    const dong = log.mock.calls[0]!.join(" ");
    expect(dong).toContain("PrismaClientKnownRequestError");
    expect(dong).not.toContain("0901234567");
  });
});

describe("[CTN-DM-02] lỗi một mục không kéo theo mục khác", () => {
  it("Promise.all các mục: mục hỏng LOI, mục lành vẫn ok", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [a, b, c] = await Promise.all([docMuc("a", async () => 1), docMuc("b", async () => Promise.reject(new Error("boom"))), docMuc("c", async () => 3)]);
    expect([a.ok, b.ok, c.ok]).toEqual([true, false, true]);
  });
});
