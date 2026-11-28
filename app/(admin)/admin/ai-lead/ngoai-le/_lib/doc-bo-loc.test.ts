// [NLD] Đọc bộ lọc «Ngoại lệ» từ URL: giá trị lạ bị bỏ (không mở rộng phạm vi); href đổi loại giữ các bộ lọc khác.
import { describe, expect, it } from "vitest";
import { CO_LOC_NGOAI_LE, docBoLocNgoaiLe, hrefTheoLoai } from "./doc-bo-loc";

describe("[NLD] docBoLocNgoaiLe", () => {
  it("[NLD-01] ba loại hợp lệ ánh xạ đúng; loại lạ / rỗng ⇒ bỏ (= tất cả, không phải loại nào đặc biệt)", () => {
    expect(docBoLocNgoaiLe({ loai: "loi" })).toEqual({ loai: "SYSTEM_EXCEPTION" });
    expect(docBoLocNgoaiLe({ loai: "chua-co-sale" })).toEqual({ loai: "ASSIGNMENT_PENDING" });
    expect(docBoLocNgoaiLe({ loai: "qua-han" })).toEqual({ loai: "QUA_HAN_SLA" });
    for (const x of ["", "SYSTEM_EXCEPTION", "tat-ca", "__proto__", "constructor"]) expect(docBoLocNgoaiLe({ loai: x }), x).toEqual({});
  });

  it("[NLD-02] mảng ⇒ lấy phần tử đầu; cắt khoảng trắng và độ dài; rỗng ⇒ bỏ", () => {
    expect(docBoLocNgoaiLe({ page: ["p1", "p2"], cs: "  cs1 ", q: "x".repeat(100) })).toEqual({ pageId: "p1", coSoId: "cs1", q: "x".repeat(40) });
    expect(docBoLocNgoaiLe({ page: "   ", cs: undefined, q: [] })).toEqual({});
    expect(CO_LOC_NGOAI_LE({})).toBe(false);
    expect(CO_LOC_NGOAI_LE({ q: "a" })).toBe(true);
  });

  it("[NLD-03] hrefTheoLoai giữ page/cs/q, đổi loại; null ⇒ bỏ loại; không bộ lọc ⇒ đường dẫn trần", () => {
    expect(hrefTheoLoai({}, null)).toBe("/ai-lead/ngoai-le");
    expect(hrefTheoLoai({ loai: "SYSTEM_EXCEPTION", pageId: "p", coSoId: "c", q: "ab" }, "QUA_HAN_SLA")).toBe("/ai-lead/ngoai-le?loai=qua-han&page=p&cs=c&q=ab");
    expect(hrefTheoLoai({ loai: "SYSTEM_EXCEPTION", pageId: "p" }, null)).toBe("/ai-lead/ngoai-le?page=p");
  });
});
