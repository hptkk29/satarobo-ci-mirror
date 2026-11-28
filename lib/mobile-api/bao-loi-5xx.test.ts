import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ goi: [] as Array<{ e: unknown; opts: { tags: Record<string, string>; level: string } }>, hong: false }));
vi.mock("@sentry/nextjs", () => ({
  captureException: (e: unknown, opts: { tags: Record<string, string>; level: string }) => {
    if (sentry.hong) throw new Error("sentry down");
    sentry.goi.push({ e, opts });
  },
}));

import { traLoi } from "./cong";
import { LoiApiMobile } from "./xac-thuc/dich-vu";

describe("[SEC11] lỗi 5xx không lường trước phải để lại dấu ở máy chủ (Sentry + log đếm được)", () => {
  let log: string[] = [];
  const goc = console.error;
  beforeEach(() => {
    sentry.goi = [];
    sentry.hong = false;
    log = [];
    console.error = (...a: unknown[]) => void log.push(a.map(String).join(" "));
  });
  afterEach(() => {
    console.error = goc;
  });

  it("[SEC11-01] lỗi lạ ⇒ 500 chung cho app + Sentry nhận ĐÚNG lỗi với thẻ area=mobile-api và requestId KHỚP requestId trong thân trả về", async () => {
    const loi = new Error("connection terminated");
    const r = traLoi(loi);
    const b = (await r.json()) as { ok: boolean; error: { code: string; message: string; requestId: string } };
    expect([r.status, b.ok, b.error.code]).toEqual([500, false, "SERVER"]);
    expect(sentry.goi).toHaveLength(1);
    expect(sentry.goi[0]!.e).toBe(loi);
    expect(sentry.goi[0]!.opts.tags).toEqual({ area: "mobile-api", requestId: b.error.requestId });
    expect(b.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(b)).not.toContain("connection terminated"); // app KHÔNG thấy nội bộ
  });

  it("[SEC11-02] lỗi NGHIỆP VỤ đã biết (LoiApiMobile 4xx/5xx có chủ đích) KHÔNG báo Sentry (không đẻ nhiễu)", () => {
    expect(traLoi(new LoiApiMobile("FORBIDDEN", 403, "x")).status).toBe(403);
    expect(traLoi(new LoiApiMobile("SERVER", 503, "kho chưa sẵn sàng", 30)).status).toBe(503);
    expect(sentry.goi).toHaveLength(0);
  });

  it("[SEC11-03] dòng log đếm được có requestId + tên lỗi, và KHÔNG chứa message của lỗi (lỗi Prisma có thể kèm PII / giá trị tham số)", () => {
    const loi = Object.assign(new Error("Invalid `db.user.findFirst()` where phone: '84901234567' Bearer abc.def.ghi"), { code: "P2010" });
    traLoi(loi);
    const dong = log.find((l) => l.startsWith("[mobile-api-5xx]"));
    expect(dong).toBeDefined();
    expect(dong).toContain('"code":"P2010"');
    expect(dong).toContain('"name":"Error"');
    expect(dong).not.toMatch(/84901234567|Bearer|abc\.def/);
  });

  it("[SEC11-04] Sentry hỏng ⇒ phản hồi vẫn là 500 chuẩn (báo lỗi hỏng không được làm hỏng phản hồi)", async () => {
    sentry.hong = true;
    const r = traLoi(new Error("boom"));
    expect(r.status).toBe(500);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("SERVER");
  });
});
