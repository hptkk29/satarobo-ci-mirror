// G-D (21/08/2026) — test viết TRƯỚC hiện thực (luật cứng #5).
//
// Biểu mẫu nhập khách gửi mã nhân viên bằng một ô người dùng TỰ GÕ. Ai cũng gõ
// được mã của người khác, và không có gì chặn. Khi phiếu đến kèm phiên đăng nhập
// thì danh tính phải lấy từ phiên, còn ô trên phiếu chỉ là dữ liệu người dùng.
import { describe, it, expect } from "vitest";
import { pickEmployeeCode } from "./identity-override";

describe("[G-D] pickEmployeeCode — phiên đăng nhập thắng ô trên phiếu", () => {
  it("có phiên → lấy mã của phiên, bỏ qua mã trên phiếu", () => {
    const r = pickEmployeeCode("CS1.TVV.007", "CS2.TVV.999");
    expect(r.code).toBe("CS1.TVV.007");
    expect(r.source).toBe("session");
  });

  it("có phiên + phiếu gõ mã người khác → gắn cờ giả mạo để còn ghi vết", () => {
    expect(pickEmployeeCode("CS1.TVV.007", "CS2.TVV.999").spoofed).toBe(true);
  });

  it("có phiên + phiếu gõ đúng mã của mình → KHÔNG phải giả mạo", () => {
    expect(pickEmployeeCode("CS1.TVV.007", "CS1.TVV.007").spoofed).toBe(false);
  });

  it("so mã bỏ qua hoa thường và khoảng trắng thừa", () => {
    expect(pickEmployeeCode("CS1.TVV.007", "  cs1.tvv.007 ").spoofed).toBe(false);
  });

  it("có phiên + phiếu bỏ trống ô mã → không coi là giả mạo", () => {
    const r = pickEmployeeCode("CS1.TVV.007", "");
    expect(r.spoofed).toBe(false);
    expect(r.code).toBe("CS1.TVV.007");
  });

  it("không có phiên (đường ẩn danh cũ) → dùng mã trên phiếu như trước", () => {
    const r = pickEmployeeCode(null, "CS1.TVV.007");
    expect(r.code).toBe("CS1.TVV.007");
    expect(r.source).toBe("form");
    expect(r.spoofed).toBe(false);
  });

  it("không phiên, không mã → không có danh tính, lead rơi về tự chia", () => {
    const r = pickEmployeeCode(null, null);
    expect(r.code).toBeNull();
    expect(r.source).toBe("none");
  });

  it("tài khoản đăng nhập chưa gắn mã nhân viên → rơi về mã trên phiếu, KHÔNG chặn phiếu", () => {
    // Chặn phiếu vì tài khoản chưa gắn mã là đánh đổi sai — lead quan trọng hơn.
    const r = pickEmployeeCode(null, "CS1.TVV.007");
    expect(r.code).toBe("CS1.TVV.007");
  });
});
