import { describe, it, expect } from "vitest";
import {
  buildNote,
  centerHintFromIndex,
  normalizeFacebookUrl,
  centerHintFromText,
  isSameChildName,
  matchCenter,
  normalizeVi,
  parentNameFallback,
  str,
  type CenterRow,
} from "./normalize";

// Danh sách cơ sở giả lập đúng hình dạng đọc từ DB (id/code/name/address).
const CENTERS: CenterRow[] = [
  { id: "c1", code: "CS1", name: "Cơ sở 1", address: "211 Nguyễn Hữu Thọ" },
  { id: "c2", code: "CS2", name: "Cơ sở 2", address: "114 Hoàng Diệu" },
];

describe("normalizeVi", () => {
  it("bỏ dấu, hạ chữ thường, gộp khoảng trắng", () => {
    expect(normalizeVi("  Cơ  sở 2 - 114 Hoàng Diệu ")).toBe(
      "co so 2 - 114 hoang dieu",
    );
  });

  it("đổi đ/Đ thành d", () => {
    expect(normalizeVi("Hoàng Diệu")).toBe("hoang dieu");
    expect(normalizeVi("ĐÀ NẴNG")).toBe("da nang");
  });

  it("nhận null/undefined mà không ném", () => {
    expect(normalizeVi(null)).toBe("");
    expect(normalizeVi(undefined)).toBe("");
  });
});

describe("str", () => {
  it("trim và đổi chuỗi rỗng thành null", () => {
    expect(str("  a ")).toBe("a");
    expect(str("   ")).toBeNull();
    expect(str(undefined)).toBeNull();
  });
});

describe("parentNameFallback", () => {
  it("dựng tên từ tên con khi phiếu thiếu tên PH", () => {
    expect(parentNameFallback("Nguyễn Minh Khoa")).toBe(
      "PH của Nguyễn Minh Khoa",
    );
  });

  it("không có cả tên con thì vẫn trả chuỗi dùng được (cột NOT NULL)", () => {
    expect(parentNameFallback(null)).toBe("Phụ huynh (chưa rõ tên)");
  });
});

describe("centerHint", () => {
  it("số thứ tự của form MISA quy ra mã cơ sở", () => {
    expect(centerHintFromIndex("2")).toEqual({ kind: "code", value: "CS2" });
    // CS3 mở thêm chỉ là thêm data — không phải sửa hàm này.
    expect(centerHintFromIndex("3")).toEqual({ kind: "code", value: "CS3" });
  });

  it("giá trị không phải số ⇒ null (không đoán)", () => {
    expect(centerHintFromIndex("")).toBeNull();
    expect(centerHintFromIndex("CS1")).toBeNull();
    expect(centerHintFromIndex("0")).toBeNull();
  });

  it("chuỗi tự do giữ nguyên cho tầng ingest so khớp", () => {
    expect(centerHintFromText(" Cơ sở 2 ")).toEqual({
      kind: "text",
      value: "Cơ sở 2",
    });
    expect(centerHintFromText("  ")).toBeNull();
  });
});

describe("matchCenter", () => {
  it("khớp theo mã (đường của form Sale)", () => {
    expect(matchCenter({ kind: "code", value: "CS1" }, CENTERS)).toBe("c1");
  });

  it("mã không tồn tại trong DB ⇒ null, không rơi sang khớp lỏng", () => {
    expect(matchCenter({ kind: "code", value: "CS9" }, CENTERS)).toBeNull();
  });

  it("khớp chuỗi tự do kiểu CŨ của quatang", () => {
    expect(matchCenter({ kind: "text", value: "114 Hoàng Diệu" }, CENTERS)).toBe(
      "c2",
    );
  });

  it("khớp chuỗi tự do kiểu MỚI của quatang (địa chỉ là chuỗi con)", () => {
    expect(
      matchCenter(
        { kind: "text", value: "Cơ sở 1 - 211 Nguyễn Hữu Thọ, Đà Nẵng" },
        CENTERS,
      ),
    ).toBe("c1");
  });

  it("khác dấu/hoa-thường vẫn khớp", () => {
    expect(
      matchCenter({ kind: "text", value: "co so 2 - 114 HOANG DIEU" }, CENTERS),
    ).toBe("c2");
  });

  it("chuỗi không nhận ra ⇒ null (để rơi về auto-chia, không đoán bừa)", () => {
    expect(matchCenter({ kind: "text", value: "Cơ sở Hà Nội" }, CENTERS)).toBeNull();
    expect(matchCenter(null, CENTERS)).toBeNull();
  });

  it("mơ hồ (2 cơ sở cùng khớp) ⇒ null thay vì chọn bừa", () => {
    const dup: CenterRow[] = [
      ...CENTERS,
      { id: "c3", code: "CS3", name: "Cơ sở 3", address: "114 Hoàng Diệu" },
    ];
    expect(matchCenter({ kind: "text", value: "114 Hoàng Diệu" }, dup)).toBeNull();
  });

  it("địa chỉ quá ngắn không được dùng để khớp lỏng", () => {
    const odd: CenterRow[] = [{ id: "x", code: null, name: "Tạm", address: "A1" }];
    expect(matchCenter({ kind: "text", value: "Cơ sở A1 xyz" }, odd)).toBeNull();
  });
});

describe("isSameChildName", () => {
  it("khác dấu/hoa-thường vẫn là cùng một đứa", () => {
    expect(isSameChildName("Nguyễn Minh Khoa", "nguyen minh khoa")).toBe(true);
  });

  it("tên khác nhau ⇒ khác con", () => {
    expect(isSameChildName("Minh Khoa", "Minh Anh")).toBe(false);
  });

  it("thiếu một bên ⇒ KHÔNG coi là khác con (tránh đẻ LeadChild rác)", () => {
    expect(isSameChildName(null, "Minh Anh")).toBe(false);
    expect(isSameChildName("Minh Anh", null)).toBe(false);
  });
});

describe("buildNote", () => {
  it("ghép ghi chú và gắn cờ cảnh báo", () => {
    expect(buildNote(["Tỉnh/TP: Đà Nẵng"], ["Mã NV sai"])).toBe(
      "Tỉnh/TP: Đà Nẵng\n⚠️ Mã NV sai",
    );
  });

  it("không có gì ⇒ null (đừng ghi chuỗi rỗng)", () => {
    expect(buildNote([], [])).toBeNull();
  });
});

// ── Hồi quy: bẫy Hội sở (phát hiện 16/08 khi đối chiếu prisma/seed.ts) ───────
describe("matchCenter — cơ sở khớp lỏng CHỒNG NHAU", () => {
  // Đúng hình dạng dữ liệu prod: Center("hoi-so").address = "Đà Nẵng", mà chuỗi
  // quatang luôn kết thúc bằng ", Đà Nẵng" ⇒ Hội sở khớp cùng lúc với cơ sở thật.
  const WITH_HO: CenterRow[] = [
    ...CENTERS,
    { id: "ho", code: "HO", name: "Hội sở", address: "Đà Nẵng" },
  ];

  it("địa chỉ CỤ THỂ HƠN thắng, không trả null vì tưởng mơ hồ", () => {
    expect(
      matchCenter(
        { kind: "text", value: "Cơ sở 1 - 211 Nguyễn Hữu Thọ, Đà Nẵng" },
        WITH_HO,
      ),
    ).toBe("c1");
    expect(
      matchCenter(
        { kind: "text", value: "Cơ sở 2 - 114 Hoàng Diệu, Đà Nẵng" },
        WITH_HO,
      ),
    ).toBe("c2");
  });

  it("chỉ nhắc tên tỉnh thì vẫn khớp Hội sở (không có ứng viên cụ thể hơn)", () => {
    expect(matchCenter({ kind: "text", value: "Đà Nẵng" }, WITH_HO)).toBe("ho");
  });

  it("hai địa chỉ dài BẰNG NHAU cùng khớp ⇒ mới thật sự là mơ hồ", () => {
    const tie: CenterRow[] = [
      { id: "x", code: "X", name: "X", address: "12 Lê Lợi" },
      { id: "y", code: "Y", name: "Y", address: "34 Lê Lai" },
    ];
    expect(
      matchCenter({ kind: "text", value: "12 Lê Lợi và 34 Lê Lai" }, tie),
    ).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ô "Link Facebook" (22/08/2026) — người nhập dán đủ kiểu, và giá trị này được
// render thành <a href> trong màn admin nên phải chặn scheme lạ.
// ───────────────────────────────────────────────────────────────────────────

describe("normalizeFacebookUrl", () => {
  it("URL đầy đủ → giữ nguyên", () => {
    expect(normalizeFacebookUrl("https://facebook.com/abc").url).toBe(
      "https://facebook.com/abc",
    );
    expect(normalizeFacebookUrl("http://m.me/abc").url).toBe("http://m.me/abc");
  });

  it("thiếu scheme → thêm https://", () => {
    expect(normalizeFacebookUrl("facebook.com/abc").url).toBe(
      "https://facebook.com/abc",
    );
    expect(normalizeFacebookUrl("m.me/abc").url).toBe("https://m.me/abc");
  });

  it("chỉ có tên tài khoản → dựng link hồ sơ Facebook", () => {
    expect(normalizeFacebookUrl("minh.nguyen.549").url).toBe(
      "https://www.facebook.com/minh.nguyen.549",
    );
  });

  it("🔴 scheme nguy hiểm → null + cảnh báo (chống XSS qua thẻ <a href>)", () => {
    for (const raw of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>",
      "vbscript:msgbox(1)",
    ]) {
      const r = normalizeFacebookUrl(raw);
      expect(r.url).toBeNull();
      expect(r.warning).toContain("giao thức không cho phép");
    }
  });

  it("cả câu chữ (có khoảng trắng) → null + cảnh báo, không đoán bừa", () => {
    const r = normalizeFacebookUrl("chị Hương ở Hoà Khánh");
    expect(r.url).toBeNull();
    expect(r.warning).toContain("không phải một đường dẫn");
  });

  it("rỗng → null, KHÔNG cảnh báo (ô không bắt buộc)", () => {
    for (const raw of ["", "   ", null, undefined]) {
      expect(normalizeFacebookUrl(raw)).toEqual({ url: null, warning: null });
    }
  });
});
