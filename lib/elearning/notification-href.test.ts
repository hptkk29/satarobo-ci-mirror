import { describe, it, expect } from "vitest";
import { elearningHref } from "./notification-href";

describe("[NH-01] elearningHref — chỉ trả đường chạy được trên khu học tập", () => {
  it("giữ đường /elearning/*", () => {
    expect(elearningHref("/elearning/hoc/abc")).toBe("/elearning/hoc/abc");
    expect(elearningHref("/elearning")).toBe("/elearning");
    expect(elearningHref("/elearning/cham-bai-tap?x=1")).toBe("/elearning/cham-bai-tap?x=1");
  });

  it("URL tuyệt đối của host e-learning → đường có tiền tố /elearning", () => {
    expect(elearningHref("https://e-learning.satarobo.vn/hoc/abc")).toBe("/elearning/hoc/abc");
    expect(elearningHref("https://e-learning.satarobo.vn/")).toBe("/elearning");
    expect(elearningHref("https://e-learning.satarobo.vn/elearning/ma-tran?a=b")).toBe(
      "/elearning/ma-tran?a=b",
    );
  });

  it("đường admin / host khác / rỗng → null (hiện chữ, không link chết)", () => {
    expect(elearningHref("/classes/abc")).toBeNull();
    expect(elearningHref("/don-tu")).toBeNull();
    expect(elearningHref("https://admin.satarobo.vn/leads")).toBeNull();
    expect(elearningHref("https://evil.example/elearning/x")).toBeNull();
    expect(elearningHref("/elearningx/abc")).toBeNull();
    expect(elearningHref(null)).toBeNull();
    expect(elearningHref("")).toBeNull();
  });
});
