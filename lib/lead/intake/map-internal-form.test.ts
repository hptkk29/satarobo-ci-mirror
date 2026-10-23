// Biểu mẫu nhập khách hàng `satarobo.vn/nhap-khach-hang` — test viết TRƯỚC hiện
// thực (luật cứng Nền Hệ thống #5).
//
// Hai điều khoản nghiệp vụ bị khoá ở đây, đừng nới nếu chưa có quyết định mới:
//   1. Mã nhân viên lấy từ PHIÊN ĐĂNG NHẬP, không đọc từ payload.
//   2. **Không ô nào bắt buộc** (chủ dự án chốt 22/08/2026) — kể cả SĐT. Thiếu
//      thì CẢNH BÁO, không từ chối phiếu.
import { describe, it, expect } from "vitest";
import { mapInternalForm } from "./map-internal-form";

const STAFF = { employeeCode: "CS1.TVV.007", displayName: "Nguyễn Thị Diệu" };
const BASE = {
  parentName: "Chị Hương",
  phone: "0905123456",
  childName: "Bé Minh",
  source: null,
  facebookUrl: null,
  centerCode: "CS1",
  note: null,
};

/** Rút gọn: mapper không bao giờ trả `ok:false` nữa, nhưng kiểu vẫn là union. */
function lead(
  input: Parameters<typeof mapInternalForm>[0],
  staff: Parameters<typeof mapInternalForm>[1] = STAFF,
) {
  const r = mapInternalForm(input, staff);
  if (!r.ok) throw new Error(`mapper từ chối phiếu: ${r.error}`);
  return r.lead;
}

describe("mapInternalForm — danh tính người nhập", () => {
  it("mã nhân viên LẤY TỪ PHIÊN, không lấy từ dữ liệu người dùng gửi lên", () => {
    // Kể cả khi client cố nhét mã người khác vào payload, mapper không đọc tới nó.
    const l = lead({ ...BASE, employeeCode: "CS2.TVV.999" } as never);
    expect(l.employeeCode).toBe("CS1.TVV.007");
    expect(l.noteLines.join("\n")).toContain("CS1.TVV.007");
  });

  it("tài khoản chưa gắn mã NV → vẫn lưu, ghi tên người nhập + cảnh báo", () => {
    const l = lead(BASE, { employeeCode: null, displayName: "Trần Văn A" });
    expect(l.employeeCode).toBeNull();
    expect(l.noteLines.join("\n")).toContain("Trần Văn A");
    expect(l.warnings.join(" ")).toContain("chưa gắn mã nhân viên");
  });
});

describe("mapInternalForm — SĐT", () => {
  it("chuẩn hoá về dạng nội bộ 84… (KHÔNG dấu +)", () => {
    const l = lead(BASE);
    expect(l.phone).toBe("84905123456");
    expect(l.phone.startsWith("+")).toBe(false);
  });

  it("🔴 bỏ trống SĐT là HỢP LỆ — phiếu vẫn lưu, chỉ cảnh báo", () => {
    const l = lead({ ...BASE, phone: null, facebookUrl: "facebook.com/chi.huong" });
    expect(l.phone).toBe("");
    expect(l.warnings.join(" ")).toContain("chưa có số điện thoại");
  });

  it("không có SĐT lẫn link FB → nói thẳng là chưa có cách liên hệ", () => {
    const l = lead({ ...BASE, phone: null });
    expect(l.warnings.join(" ")).toContain("chưa có cách liên hệ");
  });

  it("SĐT gõ sai → bỏ số + cảnh báo, KHÔNG vứt cả phiếu", () => {
    const l = lead({ ...BASE, phone: "123" });
    expect(l.phone).toBe("");
    expect(l.warnings.join(" ")).toContain("không đọc được");
    // Phần còn lại của phiếu vẫn nguyên vẹn.
    expect(l.parentName).toBe("Chị Hương");
    expect(l.children?.[0]?.fullName).toBe("Bé Minh");
  });
});

describe("mapInternalForm — tên phụ huynh", () => {
  it("thiếu tên PH nhưng có tên bé → suy ra tên hiển thị + cảnh báo", () => {
    const l = lead({ ...BASE, parentName: null });
    expect(l.parentName).toBe("PH của Bé Minh");
    expect(l.warnings.join(" ")).toContain("không có tên phụ huynh");
  });

  it("thiếu cả tên PH lẫn tên bé → vẫn lưu (không ô nào bắt buộc)", () => {
    const l = lead({ ...BASE, parentName: null, childName: null });
    expect(l.parentName).toBe("Phụ huynh (chưa rõ tên)");
    expect(l.children).toEqual([]);
    expect(l.warnings.join(" ")).toContain("tên bé");
  });
});

describe("mapInternalForm — ô mới: nguồn & link Facebook", () => {
  it("ô Nguồn gõ tự do → đi thẳng vào Lead.source qua leadSource", () => {
    const l = lead({ ...BASE, source: "  Facebook Ads  " });
    expect(l.leadSource).toBe("Facebook Ads");
  });

  it("bỏ trống Nguồn → không đè kênh kỹ thuật của tầng ingest", () => {
    expect(lead(BASE).leadSource).toBeNull();
  });

  it("link FB thiếu scheme → tự thêm https://", () => {
    expect(lead({ ...BASE, facebookUrl: "facebook.com/chi.huong" }).facebookUrl).toBe(
      "https://facebook.com/chi.huong",
    );
  });

  it("🔴 scheme nguy hiểm → KHÔNG lưu vào ô link (nó được render thành <a href>)", () => {
    const l = lead({ ...BASE, facebookUrl: "javascript:alert(1)" });
    expect(l.facebookUrl).toBeNull();
    expect(l.warnings.join(" ")).toContain("giao thức không cho phép");
    // Không đọc được KHÔNG có nghĩa là vứt: chuỗi gốc phải còn trong ghi chú.
    expect(l.noteLines.join("\n")).toContain("javascript:alert(1)");
  });
});

describe("mapInternalForm — cơ sở, ghi chú, consent", () => {
  it("cơ sở chọn từ danh sách → hint dạng mã (viết hoa)", () => {
    expect(lead({ ...BASE, centerCode: "cs2" }).centerHint).toEqual({
      kind: "code",
      value: "CS2",
    });
  });

  it("bỏ trống cơ sở → không có hint (tầng ingest tự chia)", () => {
    expect(lead({ ...BASE, centerCode: null }).centerHint).toBeNull();
  });

  it("ghi chú người nhập nằm SAU dòng dấu vết nhân viên", () => {
    const l = lead({ ...BASE, note: "Khách hỏi lớp thứ Bảy" });
    expect(l.noteLines[0]).toContain("Nhân viên nhập");
    expect(l.noteLines.at(-1)).toBe("Khách hỏi lớp thứ Bảy");
  });

  it("bộ ô mới KHÔNG còn email/trường/lớp — con chỉ mang tên", () => {
    const l = lead(BASE);
    expect(l.email).toBeNull();
    expect(l.children).toEqual([{ fullName: "Bé Minh", interestedCourseId: null }]);
  });

  it("consent giữ true (nhân viên nhập hộ, không có ô tick) + không có externalId", () => {
    const l = lead(BASE);
    expect(l.consentMarketing).toBe(true);
    expect(l.externalId).toBeNull();
  });
});
