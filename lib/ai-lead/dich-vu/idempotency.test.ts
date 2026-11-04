// @vitest-environment node
// lib/ai-lead/dich-vu/idempotency.test.ts — phần THUẦN của idempotency: băm nội dung chuẩn hoá + lấy khoá. Mã ca: [AIL-ID-01..]
// Phần tranh chấp (20 yêu cầu song song) ở tests/ai-lead/*.spec.ts (Postgres thật).
import { describe, expect, it } from "vitest";
import { bamNoiDung, chuanHoaJson, dongGoiThan, dungThanOk, khoaIdempotencyCua, moGoiThan } from "./idempotency";
import { docFixture } from "../ho-tro-test";

describe("[AIL-ID-01] JSON chuẩn hoá: thứ tự khoá và khoảng trắng KHÔNG đổi nội dung", () => {
  it("khác thứ tự khoá ⇒ cùng chuỗi; mảng giữ thứ tự", () => {
    expect(chuanHoaJson({ b: 1, a: { d: 2, c: 3 } })).toBe(chuanHoaJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(chuanHoaJson({ x: [1, 2] })).not.toBe(chuanHoaJson({ x: [2, 1] }));
  });
  it("khác GIÁ TRỊ ⇒ khác chuỗi", () => {
    expect(chuanHoaJson({ campusCode: "CS1" })).not.toBe(chuanHoaJson({ campusCode: "CS2" }));
  });
});

describe("[AIL-ID-02] băm: cùng nội dung ⇒ cùng băm; fixture 94 (cùng key khác nội dung) ⇒ KHÁC băm", () => {
  const f10 = docFixture("10").request.body;
  const f94 = docFixture("94").request.body;
  const f16 = docFixture("16").request.body;
  it("fixture 16 là thân Y HỆT fixture 10 (replay)", () => {
    expect(bamNoiDung("leadIntakes", f16)).toBe(bamNoiDung("leadIntakes", f10));
  });
  it("fixture 94 dùng lại key của 10 nhưng nội dung khác ⇒ băm khác (⇒ 409)", () => {
    expect((f94 as { idempotencyKey: string }).idempotencyKey).toBe((f10 as { idempotencyKey: string }).idempotencyKey);
    expect(bamNoiDung("leadIntakes", f94)).not.toBe(bamNoiDung("leadIntakes", f10));
  });
  it("băm có tính endpoint: cùng thân ở endpoint khác ⇒ khác băm", () => {
    expect(bamNoiDung("leadIntakes", f10)).not.toBe(bamNoiDung("handoffs", f10));
  });
});

describe("[AIL-ID-03] khoaIdempotencyCua", () => {
  it("lấy key từ thân; catalog/heartbeat không có khoá", () => {
    const b = docFixture("10").request.body as { idempotencyKey: string };
    expect(khoaIdempotencyCua({ endpoint: "leadIntakes", body: b as never })?.key).toBe(b.idempotencyKey);
    expect(khoaIdempotencyCua({ endpoint: "catalog", body: null })).toBeNull();
    expect(khoaIdempotencyCua({ endpoint: "heartbeats", body: docFixture("40").request.body as never })).toBeNull();
  });
});

describe("[AIL-ID-04] dungThanOk: thân + meta gắn requestId/serverTime của yêu cầu", () => {
  it("khung {ok,data,meta}", () => {
    expect(dungThanOk({ requestId: "req_a", nowMs: 5 }, { x: 1 })).toEqual({ ok: true, data: { x: 1 }, meta: { requestId: "req_a", serverTime: 5 } });
  });
});

describe("[AIL-ID-05] lưu phản hồi: phát lại ĐÚNG từng byte như lần đầu (jsonb sắp lại thứ tự khoá nên không lưu đối tượng thẳng)", () => {
  it("đóng gói rồi mở: cùng thứ tự khoá, cùng chuỗi", () => {
    const body = dungThanOk({ requestId: "req_a", nowMs: 5 }, { receiptId: "rct_x", status: "ACCEPTED", nextAction: "ACKNOWLEDGE_GENERIC" });
    const mo = moGoiThan(dongGoiThan(body));
    expect(JSON.stringify(mo)).toBe(JSON.stringify(body));
    expect(Object.keys((mo.data as object))).toEqual(["receiptId", "status", "nextAction"]);
  });
  it("dữ liệu lưu hỏng ⇒ ném (vỏ trả 500), không phát lại rác", () => {
    expect(() => moGoiThan({})).toThrow();
    expect(() => moGoiThan(null)).toThrow();
    expect(() => moGoiThan({ r: 5 })).toThrow();
  });
});
