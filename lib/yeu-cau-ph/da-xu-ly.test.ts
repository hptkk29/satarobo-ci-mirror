// [YCX-*] V8.19 BR-REQ-02 — mọi đường đổi ParentRequest.status sang đã xử lý đều phát `parent_request.handled` đúng một lần, đúng điều kiện.
// Hàm thuần + giao dịch giả (không DB) + lưới ghim dây nối bốn đường ghi. Phần Postgres thật: tests/mobile-api/yeu-cau-da-xu-ly.spec.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const publishEvent = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("@/lib/events/publish", () => ({ publishEvent: (...a: unknown[]) => publishEvent(...a) }));

import { canBaoPhuHuynh, doiTrangThaiYeuCau, khoaSuKienDaXuLy, phatYeuCauDaXuLy } from "./da-xu-ly";

type Dong = { id: string; status: string; handledAt: Date | null; type: string };
/** Giao dịch giả tối thiểu: findMany(where.id/in|status|handledAt) + updateMany có điều kiện trạng thái. */
function txGia(dong: Dong[], truocKhiGhi?: () => void) {
  const khop = (d: Dong, w: Record<string, unknown>) => {
    const id = w.id as string | { in: string[] } | undefined;
    if (typeof id === "string" && d.id !== id) return false;
    if (id && typeof id === "object" && !id.in.includes(d.id)) return false;
    const st = w.status as string | { in: string[] } | undefined;
    if (typeof st === "string" && d.status !== st) return false;
    if (st && typeof st === "object" && !st.in.includes(d.status)) return false;
    if (w.handledAt instanceof Date && d.handledAt?.getTime() !== w.handledAt.getTime()) return false;
    if (typeof w.type === "string" && d.type !== w.type) return false;
    return true;
  };
  return {
    parentRequest: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => dong.filter((d) => khop(d, where)).map((d) => ({ id: d.id, status: d.status }))),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: { status: string; handledAt: Date } }) => {
        truocKhiGhi?.();
        const rows = dong.filter((d) => khop(d, where));
        for (const d of rows) Object.assign(d, { status: data.status, handledAt: data.handledAt });
        return { count: rows.length };
      }),
    },
  } as never;
}

beforeEach(() => publishEvent.mockClear());

describe("[YCX-01] canBaoPhuHuynh — chỉ khi ĐỔI trạng thái sang APPROVED/REJECTED", () => {
  it.each([
    ["PENDING", "APPROVED", true],
    ["PENDING", "REJECTED", true],
    ["APPROVED", "REJECTED", true],
    ["APPROVED", "APPROVED", false], // ghi lại cùng trạng thái (đổi lời phản hồi) — không báo lại
    ["PENDING", "CANCELLED", false], // huỷ không báo (handler cũng bỏ)
    ["PENDING", "PENDING", false],
  ])("%s → %s = %s", (a, b, kq) => expect(canBaoPhuHuynh(a, b)).toBe(kq));
});

describe("[YCX-02] doiTrangThaiYeuCau", () => {
  const T = new Date("2026-11-21T03:00:00Z");
  it("PENDING → APPROVED: ghi và phát đúng MỘT sự kiện, khoá trùng khoá handler", async () => {
    const dong: Dong[] = [{ id: "r1", status: "PENDING", handledAt: null, type: "MAKEUP" }];
    const n = await doiTrangThaiYeuCau(txGia(dong), { type: "MAKEUP", status: "PENDING" }, { status: "APPROVED", handledAt: T });
    expect(n).toBe(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent.mock.calls[0][1]).toEqual({ requestId: "r1" });
    expect((publishEvent.mock.calls[0][2] as { dedupeKey: string }).dedupeKey).toBe(khoaSuKienDaXuLy("r1", T));
  });
  it("không có dòng khớp ⇒ 0, không phát", async () => {
    expect(await doiTrangThaiYeuCau(txGia([]), { status: "PENDING" }, { status: "APPROVED", handledAt: T })).toBe(0);
    expect(publishEvent).not.toHaveBeenCalled();
  });
  it("cuộc đua: người khác đổi dòng giữa lúc đọc và lúc ghi ⇒ đổi 0 dòng, KHÔNG phát", async () => {
    const dong: Dong[] = [{ id: "r1", status: "PENDING", handledAt: null, type: "RESERVE" }];
    const tx = txGia(dong, () => {
      dong[0].status = "REJECTED"; // quản trị kia vừa từ chối
      dong[0].handledAt = new Date("2026-11-21T02:59:59Z");
    });
    const n = await doiTrangThaiYeuCau(tx, { id: "r1", status: "PENDING" }, { status: "APPROVED", handledAt: T });
    expect(n).toBe(0);
    expect(publishEvent).not.toHaveBeenCalled();
    expect(dong[0].status).toBe("REJECTED"); // không ghi đè quyết định của người trước
  });
  it("đã APPROVED, ghi lại APPROVED (đổi phản hồi) ⇒ ghi nhưng KHÔNG báo lại", async () => {
    const dong: Dong[] = [{ id: "r1", status: "APPROVED", handledAt: new Date("2026-11-20T00:00:00Z"), type: "RESERVE" }];
    const n = await doiTrangThaiYeuCau(txGia(dong), { id: "r1" }, { status: "APPROVED", handledAt: T });
    expect(n).toBe(1);
    expect(publishEvent).not.toHaveBeenCalled();
  });
  it("CANCELLED ⇒ ghi, không báo", async () => {
    const dong: Dong[] = [{ id: "r1", status: "PENDING", handledAt: null, type: "RESERVE" }];
    await doiTrangThaiYeuCau(txGia(dong), { id: "r1" }, { status: "CANCELLED", handledAt: T });
    expect(publishEvent).not.toHaveBeenCalled();
  });
  it("nhiều dòng ⇒ mỗi dòng đổi một sự kiện riêng", async () => {
    const dong: Dong[] = [
      { id: "a", status: "PENDING", handledAt: null, type: "MAKEUP" },
      { id: "b", status: "PENDING", handledAt: null, type: "MAKEUP" },
    ];
    await doiTrangThaiYeuCau(txGia(dong), { type: "MAKEUP", status: "PENDING" }, { status: "REJECTED", handledAt: T });
    expect(publishEvent.mock.calls.map((c) => (c[1] as { requestId: string }).requestId).sort()).toEqual(["a", "b"]);
  });
  it("phatYeuCauDaXuLy: trạng thái không đổi ⇒ false", async () => {
    expect(await phatYeuCauDaXuLy({} as never, { requestId: "x", truoc: "APPROVED", sau: "APPROVED", handledAt: T })).toBe(false);
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

describe("[YCX-W*] lưới ghim: không đường ghi nào còn ghi thẳng trạng thái yêu cầu phụ huynh", () => {
  const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const BON_DUONG: Array<[string, string]> = [
    ["[YCX-W1]", "lib/bao-luu/chuyen-trang-thai.ts"],
    ["[YCX-W2]", "lib/bao-luu/dich-vu.ts"],
    ["[YCX-W3]", "lib/hoc-bu/dong-service.ts"],
    ["[YCX-W4]", "lib/students/reserve-service.ts"],
    ["[YCX-W5]", "app/(admin)/admin/parent-requests/actions.ts"],
  ];
  it.each(BON_DUONG)("%s %s gọi doiTrangThaiYeuCau và không còn updateMany/update thẳng", (_m, f) => {
    const s = doc(f);
    expect(s).toMatch(/doiTrangThaiYeuCau\(/);
    expect(s).not.toMatch(/\.parentRequest\.(updateMany|update)\(/);
  });
  it("[YCX-W6] phép huỷ của phụ huynh / rút đơn nghỉ là CANCELLED (handler không báo) — hai nơi duy nhất còn ghi thẳng", () => {
    for (const f of ["lib/hoc-bu/rut-don-nghi.ts", "lib/mobile-api/dich-vu/yeu-cau.ts"]) {
      expect(doc(f)).toMatch(/status:\s*"CANCELLED"/);
    }
  });
});
