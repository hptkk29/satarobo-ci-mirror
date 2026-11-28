import { describe, expect, it } from "vitest";
import {
  canonicalPhone,
  formatPhoneVN,
  isValidPhoneVN,
  phoneSearchTerm,
  phoneVariants,
  telHrefVN,
  PHONE_VN_RE,
} from "./phone";

describe("[AUTH-SDT-P1-C1] canonicalPhone — gom 3 định dạng mâu thuẫn về 84XXXXXXXXX", () => {
  it.each([
    ["0905123456", "84905123456"],
    ["+84905123456", "84905123456"],
    ["0084905123456", "84905123456"],
    ["84905123456", "84905123456"],
    ["905123456", "84905123456"], // Excel lưu number → mất số 0 đầu
  ])("%s → %s", (input, expected) => {
    expect(canonicalPhone(input)).toBe(expected);
  });

  it.each([
    ["0905.123.456", "84905123456"],
    ["0905 123 456", "84905123456"],
    ["090-512-3456", "84905123456"],
    ["(090) 512 3456", "84905123456"],
  ])("bỏ ký tự trình bày: %s → %s", (input, expected) => {
    expect(canonicalPhone(input)).toBe(expected);
  });

  it('HỒI QUY: "+84 0905 123 456" — bản cũ cho ra "00905123456" SAI', () => {
    expect(canonicalPhone("+84 0905 123 456")).toBe("84905123456");
  });

  it.each([
    { v: "02363123456" as unknown, why: "số cố định Đà Nẵng — không phải di động" },
    { v: "0123456789" as unknown, why: "đầu số 1 không còn tồn tại" },
    { v: "0405123456" as unknown, why: "đầu số 4 không hợp lệ" },
    { v: "090512345" as unknown, why: "thiếu 1 chữ số" },
    { v: "09051234567" as unknown, why: "thừa 1 chữ số" },
    { v: "abc" as unknown, why: "không phải số" },
    { v: "" as unknown, why: "rỗng" },
    { v: null as unknown, why: "null" },
    { v: undefined as unknown, why: "undefined" },
  ])("từ chối $why", ({ v }) => {
    expect(canonicalPhone(v)).toBeNull();
  });

  it("mọi output hợp lệ đều khớp PHONE_VN_RE", () => {
    for (const raw of ["0905123456", "+84332221111", "0788889999", "0522223333", "0712345678"]) {
      const c = canonicalPhone(raw)!;
      expect(c).not.toBeNull();
      expect(PHONE_VN_RE.test(c)).toBe(true);
    }
  });

  it("idempotent — chuẩn hoá lần 2 không đổi", () => {
    const once = canonicalPhone("0905 123 456")!;
    expect(canonicalPhone(once)).toBe(once);
  });
});

describe("[AUTH-SDT-P1-C2] formatPhoneVN — hiển thị nội địa", () => {
  it("canonical → 0XXXXXXXXX", () => {
    expect(formatPhoneVN("84905123456")).toBe("0905123456");
    expect(formatPhoneVN("+84 905 123 456")).toBe("0905123456");
  });

  it("không chuẩn hoá được → giữ nguyên chuỗi gốc (không nuốt dữ liệu)", () => {
    expect(formatPhoneVN("02363123456")).toBe("02363123456");
  });
});

describe("[AUTH-SDT-P1-C3] phoneVariants — đọc chịu được giai đoạn chuyển tiếp", () => {
  it("trả cả dạng mới lẫn dạng cũ đang nằm trong DB", () => {
    expect(phoneVariants("0905123456")).toEqual(["84905123456", "0905123456"]);
    expect(phoneVariants("84905123456")).toEqual(["84905123456", "0905123456"]);
  });

  it("hai cách gõ khác nhau của CÙNG một số cho CÙNG tập tra cứu", () => {
    expect(phoneVariants("+84 905 123 456")).toEqual(phoneVariants("0905.123.456"));
  });

  it("số rác không chuẩn hoá được → vẫn tra đúng chuỗi gốc, không trả rỗng", () => {
    expect(phoneVariants("02363123456")).toEqual(["02363123456"]);
  });

  it("rỗng → mảng rỗng (caller phải tự bỏ qua, không tra `in: []`)", () => {
    expect(phoneVariants("")).toEqual([]);
    expect(phoneVariants(null)).toEqual([]);
  });
});

describe("[AUTH-SDT-P1-C4] isValidPhoneVN", () => {
  it("nhận mọi dạng đầu vào hợp lệ", () => {
    expect(isValidPhoneVN("0905123456")).toBe(true);
    expect(isValidPhoneVN("+84 905 123 456")).toBe(true);
    expect(isValidPhoneVN("02363123456")).toBe(false);
  });
});

describe("[AUTH-SDT-P1-C5] phoneSearchTerm — ô Tìm phải bắt được CẢ 0… lẫn 84…", () => {
  // Ca thật 03/08: lead tạo tay lưu 84328545229, nhân viên gõ 0328545229 → không ra.
  it("số đầy đủ dạng nội địa và dạng canonical cho CÙNG một lõi", () => {
    expect(phoneSearchTerm("0328545229")).toBe("328545229");
    expect(phoneSearchTerm("84328545229")).toBe("328545229");
    expect(phoneSearchTerm("+84 328 545 229")).toBe("328545229");
  });

  it("lõi là tiền tố → gõ dở vẫn tìm được", () => {
    expect("84328545229".includes(phoneSearchTerm("03285")!)).toBe(true);
    expect("0328545229".includes(phoneSearchTerm("03285")!)).toBe(true);
  });

  it("không phải chuỗi số → null để caller tìm theo tên", () => {
    expect(phoneSearchTerm("Nguyễn Văn A")).toBeNull();
    expect(phoneSearchTerm("")).toBeNull();
    expect(phoneSearchTerm("84")).toBeNull();
  });

  it("số cố định vẫn tra được (ô tìm không được kén như canonicalPhone)", () => {
    expect(phoneSearchTerm("02363123456")).toBe("2363123456");
  });
});

describe("telHrefVN — giá trị href cho nút gọi", () => {
  it("LUÔN có scheme `tel:` và dấu `+`", () => {
    // Thiếu `tel:` thì href thành đường dẫn TƯƠNG ĐỐI: bấm vào là điều hướng lạc
    // trong app chứ không mở trình gọi. Thiếu `+` thì máy quay đúng chuỗi
    // "84941000000" như số nội địa và báo không tồn tại. Cả hai lỗi đều KHÔNG lộ ra
    // trên màn hình — số vẫn hiện đẹp — nên khoá bằng test.
    expect(telHrefVN("0941000000")).toBe("tel:+84941000000");
    expect(telHrefVN("84941000000")).toBe("tel:+84941000000");
    expect(telHrefVN("+84 941 000 000")).toBe("tel:+84941000000");
  });

  it("số rác cũ vẫn ra một href có scheme, không ra chuỗi trần", () => {
    expect(telHrefVN("02363123456")).toBe("tel:02363123456");
    expect(telHrefVN(null)).toBe("tel:");
  });
});
