// @vitest-environment node
// lib/ai-lead/dich-vu/tien-ich.test.ts — các hàm THUẦN nhỏ của dịch vụ Gateway: kẹp nhịp, kẹp max-age, ETag, quyết định báo sự cố. Mã ca: [AIL-TI-01..]
import { describe, expect, it } from "vitest";
import { etagChoAgent, kepMaxAge, docPayloadCatalog } from "./catalog";
import { kepNhipHeartbeat } from "./heartbeat";
import { canBaoSuCo } from "./incident";
import { catalogResponseSchema } from "../schemas";

describe("[AIL-TI-01] kẹp theo biên hợp đồng (cấu hình sai không làm phản hồi vi phạm hợp đồng)", () => {
  it.each([[1, 15], [14, 15], [15, 15], [60, 60], [90, 90], [91, 90], [9999, 90]])("nextHeartbeatSeconds %i ⇒ %i", (vao, ra) => expect(kepNhipHeartbeat(vao)).toBe(ra));
  it.each([[1, 30], [29, 30], [30, 30], [300, 300], [3600, 3600], [3601, 3600]])("maxAgeSeconds %i ⇒ %i", (vao, ra) => expect(kepMaxAge(vao)).toBe(ra));
});

describe("[AIL-TI-02] ETag theo agent: đổi allowlist ⇒ đổi ETag (nếu không, 304 mãi trong khi nội dung đã khác)", () => {
  it("cùng tập Page (khác thứ tự) ⇒ cùng ETag; khác tập ⇒ khác", () => {
    expect(etagChoAgent("cat-7", ["b", "a"])).toBe(etagChoAgent("cat-7", ["a", "b"]));
    expect(etagChoAgent("cat-7", ["a"])).not.toBe(etagChoAgent("cat-7", ["a", "b"]));
    expect(etagChoAgent("cat-7", ["a"])).not.toBe(etagChoAgent("cat-8", ["a"]));
  });
  it("đủ ngắn cho trần 128 ký tự của hợp đồng với etag snapshot thực tế", () => {
    expect(etagChoAgent("cat-12345-" + "a".repeat(40), ["x".repeat(30)]).length).toBeLessThanOrEqual(128);
  });
});

describe("[AIL-TI-03] canBaoSuCo: chỉ HIGH/CRITICAL, và chỉ khi MỚI hoặc vừa leo thang qua ngưỡng", () => {
  it.each([
    [{ moi: true, truoc: null, sau: "LOW", moLai: false }, false],
    [{ moi: true, truoc: null, sau: "MEDIUM", moLai: false }, false],
    [{ moi: true, truoc: null, sau: "HIGH", moLai: false }, true],
    [{ moi: true, truoc: null, sau: "CRITICAL", moLai: false }, true],
    [{ moi: false, truoc: "MEDIUM", sau: "HIGH", moLai: false }, true],
    [{ moi: false, truoc: "LOW", sau: "CRITICAL", moLai: false }, true],
    [{ moi: false, truoc: "HIGH", sau: "CRITICAL", moLai: false }, false], // đã báo ở mức HIGH — dedupe theo id sự cố
    [{ moi: false, truoc: "HIGH", sau: "HIGH", moLai: false }, false],
    [{ moi: false, truoc: "CRITICAL", sau: "LOW", moLai: false }, false],
    [{ moi: false, truoc: "MEDIUM", sau: "MEDIUM", moLai: false }, false],
    [{ moi: false, truoc: "HIGH", sau: "HIGH", moLai: true }, true], // đã đóng rồi tái diễn cùng ngày ⇒ báo lại
    [{ moi: false, truoc: "HIGH", sau: "CRITICAL", moLai: true }, true],
    [{ moi: false, truoc: "HIGH", sau: "LOW", moLai: true }, false], // tái diễn nhưng báo cáo mới chỉ mức thấp ⇒ vẫn mở lại (ghi DB) nhưng không rung chuông
  ] as const)("%j ⇒ %s", (x, ra) => expect(canBaoSuCo(x)).toBe(ra));
});

describe("[AIL-TI-04] đọc payload catalog", () => {
  it("payload hỏng ⇒ null (coi như chưa có catalog dùng được)", () => {
    expect(docPayloadCatalog(null)).toBeNull();
    expect(docPayloadCatalog({ pages: "x" })).toBeNull();
    expect(docPayloadCatalog({ pages: [{ pageId: "p", campuses: [{ campusCode: "CS1" }] }] })).toBeNull();
  });
  it("payload đúng ⇒ giữ nguyên; phản hồi dựng từ nó hợp lệ theo schema hợp đồng", () => {
    const pages = docPayloadCatalog({ pages: [{ pageId: "104500000000001", campuses: [{ campusCode: "CS1", name: "CS 1", address: "đ/c", acceptingLeads: true }] }] })!;
    const r = catalogResponseSchema.safeParse({
      ok: true,
      data: { catalogVersion: 7, publishedAt: "2026-10-26T02:00:00.000Z", maxAgeSeconds: 300, etag: etagChoAgent("cat-7", ["104500000000001"]), pages },
      meta: { requestId: "req_abcdef123456abcdef123456", serverTime: 1 },
    });
    expect(r.success).toBe(true);
  });
});
