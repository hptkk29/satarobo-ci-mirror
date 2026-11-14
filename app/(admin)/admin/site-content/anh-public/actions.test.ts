// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: { user: { id: "u1", name: "Marketing A", email: "a@x.vn" } } as { user: { id: string; name: string; email: string } } | null,
  coQuyen: true,
  upsert: vi.fn(),
  findUnique: vi.fn(),
  deleteMany: vi.fn(),
  audit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: async () => m.session }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: async () => ({ id: "u1" }) }));
vi.mock("@/lib/auth/check-permission", () => ({
  assertPermission: async (a: string) => {
    if (!m.coQuyen) throw new Error(`thiếu quyền ${a}`);
    expect(a).toBe("site-content:edit");
  },
}));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({ sitePageContent: { upsert: m.upsert, findUnique: m.findUnique, deleteMany: m.deleteMany } }),
}));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

import { datLaiAnhPublicAction, luuAnhPublicAction } from "./actions";

const ID = "659c303937fe76b0d2be11b04c59889e"; // 576×768
const URL_OK = "https://cdn.satarobo.vn/uploads/images/2026-11/anh-public-659c3039-1a2b3c4d.webp";
const hop = (o: Record<string, unknown> = {}) => ({ id: ID, url: URL_OK, w: 1200, h: 1600, ...o });

describe("[PAA] luuAnhPublicAction", () => {
  beforeEach(() => {
    m.session = { user: { id: "u1", name: "Marketing A", email: "a@x.vn" } };
    m.coQuyen = true;
    for (const f of [m.upsert, m.findUnique, m.deleteMany, m.audit, m.revalidatePath]) f.mockReset();
    m.findUnique.mockResolvedValue(null);
    m.deleteMany.mockResolvedValue({ count: 1 });
    m.audit.mockResolvedValue({});
  });

  it("[PAA-01] hợp lệ ⇒ lưu JSON {url,w,h} vào SitePageContent(pageKey=pub-anh), ghi audit, làm mới trang public", async () => {
    const r = await luuAnhPublicAction(hop());
    expect(r).toEqual({ ok: true });
    expect(m.upsert).toHaveBeenCalledTimes(1);
    const arg = m.upsert.mock.calls[0]![0];
    expect(arg.where).toEqual({ pageKey_contentKey: { pageKey: "pub-anh", contentKey: ID } });
    expect(JSON.parse(arg.create.contentValue)).toEqual({ url: URL_OK, w: 1200, h: 1600 });
    expect(arg.create.updatedById).toBe("u1");
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "pub-anh.replaced", entityId: ID, module: "site-content" }));
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("[PAA-02] chưa đăng nhập ⇒ từ chối, không chạm DB", async () => {
    m.session = null;
    expect(await luuAnhPublicAction(hop())).toEqual({ ok: false, error: "Chưa đăng nhập" });
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("[PAA-03] ĐỐI CHỨNG ÂM: thiếu quyền site-content:edit ⇒ từ chối, không ghi, không audit, không làm mới", async () => {
    m.coQuyen = false;
    expect(await luuAnhPublicAction(hop())).toEqual({ ok: false, error: "Không có quyền" });
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["mã ảnh lạ", hop({ id: "0".repeat(32) })],
    ["mã ảnh sai dạng", hop({ id: "../x" })],
    ["URL host lạ", hop({ url: "https://evil.com/uploads/images/a.webp" })],
    ["URL http", hop({ url: URL_OK.replace("https", "http") })],
    ["URL ngoài thư mục ảnh", hop({ url: "https://cdn.satarobo.vn/khac/a.webp" })],
    ["tỉ lệ sai (ngang thay cho dọc)", hop({ w: 1600, h: 1200 })],
    ["kích thước ngoài biên", hop({ w: 50, h: 70 })],
    ["thiếu trường", { id: ID }],
    ["không phải object", "abc"],
  ])("[PAA-04] từ chối: %s — không ghi gì", async (_ten, input) => {
    const r = await luuAnhPublicAction(input);
    expect(r.ok).toBe(false);
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("[PAA] datLaiAnhPublicAction", () => {
  beforeEach(() => {
    m.session = { user: { id: "u1", name: "Marketing A", email: "a@x.vn" } };
    m.coQuyen = true;
    for (const f of [m.upsert, m.findUnique, m.deleteMany, m.audit, m.revalidatePath]) f.mockReset();
    m.deleteMany.mockResolvedValue({ count: 1 });
    m.audit.mockResolvedValue({});
  });

  it("[PAA-05] xoá đúng dòng ghi đè của ô, ghi audit, làm mới trang public", async () => {
    expect(await datLaiAnhPublicAction({ id: ID })).toEqual({ ok: true });
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { pageKey: "pub-anh", contentKey: ID } });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "pub-anh.reset", entityId: ID }));
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("[PAA-06] ô chưa từng bị thay ⇒ vẫn ok (idempotent), KHÔNG ghi audit rỗng", async () => {
    m.deleteMany.mockResolvedValue({ count: 0 });
    expect(await datLaiAnhPublicAction({ id: ID })).toEqual({ ok: true });
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("[PAA-07] ĐỐI CHỨNG ÂM: thiếu quyền / chưa đăng nhập / mã lạ ⇒ không xoá gì", async () => {
    m.coQuyen = false;
    expect((await datLaiAnhPublicAction({ id: ID })).ok).toBe(false);
    m.coQuyen = true;
    m.session = null;
    expect((await datLaiAnhPublicAction({ id: ID })).ok).toBe(false);
    m.session = { user: { id: "u1", name: "x", email: "x@x.vn" } };
    expect((await datLaiAnhPublicAction({ id: "zzz" })).ok).toBe(false);
    expect(m.deleteMany).not.toHaveBeenCalled();
  });
});
