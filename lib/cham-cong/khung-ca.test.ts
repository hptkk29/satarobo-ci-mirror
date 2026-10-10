import { describe, expect, it } from "vitest";

import {
  chiaLoThem,
  conTrongKhoi,
  doiCho,
  laSection,
  nguoiLechSection,
  sectionChoCum,
  thuTuTheoNguoi,
} from "./khung-ca";

const MO = { effectiveTo: null };
const DONG = { effectiveTo: new Date(Date.UTC(2026, 8, 8)) };

describe("conTrongKhoi", () => {
  it("chỉ dòng còn mở mới tính là đang trong khối", () => {
    expect(conTrongKhoi(MO)).toBe(true);
    expect(conTrongKhoi(DONG)).toBe(false);
  });
});

describe("chiaLoThem — thêm hàng loạt phải idempotent", () => {
  it("người ĐANG trong khối ⇒ bỏ qua, không lỗi, không nhân đôi", () => {
    const kq = chiaLoThem(["a"], [{ userId: "a", ...MO }]);
    expect(kq).toEqual({ themMoi: [], hoiSinh: [], boQua: ["a"] });
  });

  // ⚠️ CA QUAN TRỌNG NHẤT. Gộp "từng ở" vào "đã có" là sinh bug: khoá duy nhất
  // `(userId, centerId, weekday, effectiveFrom)` KHÔNG đổi khi gỡ mềm, nên người này
  // phải được MỞ LẠI cụm cũ, không phải bỏ qua (họ đâu còn trong khối) và cũng không
  // phải tạo mới (sẽ đâm khoá).
  it("người TỪNG ở rồi bị gỡ ⇒ HỒI SINH, không phải bỏ qua và không phải tạo mới", () => {
    const kq = chiaLoThem(["a"], [{ userId: "a", ...DONG }]);
    expect(kq).toEqual({ themMoi: [], hoiSinh: ["a"], boQua: [] });
  });

  it("người CHƯA từng có ⇒ tạo mới", () => {
    expect(chiaLoThem(["z"], [])).toEqual({
      themMoi: ["z"],
      hoiSinh: [],
      boQua: [],
    });
  });

  it("chọn TRÙNG trong cùng một lượt cũng không đẻ hai dòng", () => {
    expect(chiaLoThem(["z", "z", "z"], []).themMoi).toEqual(["z"]);
  });

  // Cụm có thể lẫn: ai đó xoá tay ô Thứ Ba rồi gỡ, hoặc gỡ xong sửa lại một ô. Khi đó
  // người ấy VẪN đang trong khối — hàng của họ vẫn hiện trên màn — nên phải bỏ qua.
  it("cụm LẪN dòng mở và dòng đóng ⇒ vẫn tính là ĐANG trong khối", () => {
    const kq = chiaLoThem(
      ["a"],
      [
        { userId: "a", ...DONG },
        { userId: "a", ...MO },
      ],
    );
    expect(kq.boQua).toEqual(["a"]);
    expect(kq.hoiSinh).toEqual([]);
  });

  it("một lượt trộn cả ba nhóm — mỗi người rơi đúng một nhóm", () => {
    const kq = chiaLoThem(
      ["dang", "dago", "moi"],
      [
        { userId: "dang", ...MO },
        { userId: "dago", ...DONG },
        { userId: "khongchon", ...MO },
      ],
    );
    expect(kq).toEqual({
      themMoi: ["moi"],
      hoiSinh: ["dago"],
      boQua: ["dang"],
    });
    // Anti-vacuity: người không được chọn KHÔNG được lọt vào nhóm nào.
    const tatCa = [...kq.themMoi, ...kq.hoiSinh, ...kq.boQua];
    expect(tatCa).not.toContain("khongchon");
    expect(tatCa).toHaveLength(3);
  });

  it("danh sách rỗng ⇒ ba nhóm rỗng, không ném", () => {
    expect(chiaLoThem([], [{ userId: "a", ...MO }])).toEqual({
      themMoi: [],
      hoiSinh: [],
      boQua: [],
    });
  });
});

describe("thuTuTheoNguoi — một số cho một NGƯỜI", () => {
  it("số tăng dần từ 0 theo thứ tự hiển thị", () => {
    expect([...thuTuTheoNguoi(["a", "b", "c"])]).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("người trùng chỉ lấy lần đầu — đầu vào là thứ tự, không phải tập hợp", () => {
    // Nếu không chặn, "a" nhận hai số và đường ghi `updateMany` chạy hai lần trên cùng
    // cụm — số cuối cùng thắng, tức thứ tự người dùng thấy không phải thứ tự họ kéo.
    expect([...thuTuTheoNguoi(["a", "b", "a"])]).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("rỗng ⇒ map rỗng", () => {
    expect(thuTuTheoNguoi([]).size).toBe(0);
  });
});

describe("doiCho — lên/xuống một bậc", () => {
  const ds = ["a", "b", "c"];

  it("xuống: đổi chỗ với người ngay sau", () => {
    expect(doiCho(ds, "a", "xuong")).toEqual(["b", "a", "c"]);
  });

  it("lên: đổi chỗ với người ngay trước", () => {
    expect(doiCho(ds, "c", "len")).toEqual(["a", "c", "b"]);
  });

  it("ở rìa ⇒ trả nguyên thứ tự, KHÔNG ném", () => {
    // Nút ở rìa đã bị vô hiệu trên màn, nhưng hàm không được phụ thuộc vào điều đó.
    expect(doiCho(ds, "a", "len")).toEqual(ds);
    expect(doiCho(ds, "c", "xuong")).toEqual(ds);
  });

  it("không có trong danh sách ⇒ trả nguyên thứ tự", () => {
    expect(doiCho(ds, "z", "len")).toEqual(ds);
  });

  it("trả mảng MỚI, không sửa mảng gốc", () => {
    const goc = ["a", "b"];
    const ra = doiCho(goc, "a", "xuong");
    expect(goc).toEqual(["a", "b"]);
    expect(ra).not.toBe(goc);
  });
});

describe("nguoiLechSection — cụm mang nhiều hơn một section", () => {
  it("cụm đồng nhất ⇒ RỖNG", () => {
    expect(
      nguoiLechSection([
        { userId: "a", section: "GIAO_VIEN" },
        { userId: "a", section: "GIAO_VIEN" },
      ]).size,
    ).toBe(0);
  });

  // ⚠️ Hình dạng THẬT của bug: thêm một ô qua màn admin cho người đã nhập file với vai
  // giáo viên. Dòng mới rơi về `@default(KINH_DOANH)` của schema — im lặng, không lỗi.
  it("một dòng lệch trong bảy ⇒ BẮT được, kèm đủ hai giá trị", () => {
    const lech = nguoiLechSection([
      ...Array.from({ length: 6 }, () => ({
        userId: "a",
        section: "GIAO_VIEN",
      })),
      { userId: "a", section: "KINH_DOANH" },
    ]);
    expect([...lech]).toEqual([["a", ["GIAO_VIEN", "KINH_DOANH"]]]);
  });

  it("chỉ trả người VI PHẠM, không trả người sạch", () => {
    const lech = nguoiLechSection([
      { userId: "sach", section: "VAN_PHONG" },
      { userId: "lech", section: "VAN_PHONG" },
      { userId: "lech", section: "KINH_DOANH" },
    ]);
    expect([...lech.keys()]).toEqual(["lech"]);
  });

  it("rỗng ⇒ rỗng", () => {
    expect(nguoiLechSection([]).size).toBe(0);
  });
});

describe("sectionChoCum — cụm đã có giá trị thì GIỮ NGUYÊN", () => {
  it("cụm có sẵn ⇒ giữ, KHÔNG nghe đề xuất", () => {
    // Để người gọi tự chọn khi cụm đã có giá trị chính là đường đẻ ra cụm lệch.
    expect(sectionChoCum(["GIAO_VIEN"], "KINH_DOANH")).toBe("GIAO_VIEN");
  });

  it("cụm trống ⇒ lấy đề xuất", () => {
    expect(sectionChoCum([], "VAN_PHONG")).toBe("VAN_PHONG");
  });

  it("cụm trống + đề xuất rác ⇒ mặc định KINH_DOANH (khớp @default của schema)", () => {
    expect(sectionChoCum([], "KHONG_TON_TAI")).toBe("KINH_DOANH");
    expect(sectionChoCum([], null)).toBe("KINH_DOANH");
    expect(sectionChoCum([])).toBe("KINH_DOANH");
  });

  it("cụm ĐÃ lệch sẵn ⇒ lấy giá trị hợp lệ ĐẦU TIÊN, và HỘI TỤ", () => {
    // Quyết định tuỳ tiện nhưng ổn định: cùng đầu vào ⇒ cùng kết quả, nên lượt ghi kế
    // tiếp kéo cả cụm về đúng giá trị đó chứ không dao động.
    const cum = ["GIAO_VIEN", "KINH_DOANH"];
    expect(sectionChoCum(cum)).toBe("GIAO_VIEN");
    expect(sectionChoCum(cum)).toBe(sectionChoCum(cum));
  });

  it("bỏ qua giá trị RÁC trong cụm thay vì trả về nó", () => {
    expect(sectionChoCum(["", "linh tinh", "VAN_PHONG"])).toBe("VAN_PHONG");
  });

  it("laSection chỉ nhận đúng ba giá trị của enum", () => {
    expect(laSection("GIAO_VIEN")).toBe(true);
    expect(laSection("giao_vien")).toBe(false);
    expect(laSection(null)).toBe(false);
    expect(laSection(0)).toBe(false);
  });
});
