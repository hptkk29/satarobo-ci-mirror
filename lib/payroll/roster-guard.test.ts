import { describe, it, expect } from "vitest";
import {
  SiSoKhongDungDeTinhTien,
  chanLoTruocKhiTinh,
  loaiVi,
  locDongKhongDung,
  siSoDeTinhTien,
  type SiSoBuoi,
} from "./roster-guard";

function buoi(p: Partial<SiSoBuoi> = {}): SiSoBuoi {
  return { sessionId: "s1", rosterSize: 8, rosterSource: "SNAPSHOT", ...p };
}

describe("loaiVi — chỉ SNAPSHOT thật mới qua cổng", () => {
  it("số đo lúc dạy ⇒ qua", () => {
    expect(loaiVi(buoi())).toBeNull();
  });

  it("cả BA tầng backfill đều bị loại — kể cả tầng sát nhất", () => {
    // FROM_ATTENDANCE là tầng sát nhất và rất dễ bị coi là "đủ tốt". Nhưng buổi cũ đã trả lương
    // xong rồi, không ai tính lại; backfill chỉ phục vụ báo cáo và đối chiếu.
    for (const src of ["FROM_ATTENDANCE", "FROM_ENROLLMENT", "UNKNOWN"]) {
      expect(loaiVi(buoi({ rosterSource: src }))).toBe("SI_SO_SUY_DOAN");
    }
  });

  it("chưa chạy backfill (rosterSource null) ⇒ CHUA_CO_SI_SO, khác nghĩa với suy đoán", () => {
    expect(loaiVi(buoi({ rosterSource: null, rosterSize: null }))).toBe("CHUA_CO_SI_SO");
  });

  it("tầng UNKNOWN vẫn báo là SUY ĐOÁN, không báo 'chưa có số'", () => {
    // Dòng backfill LUÔN có rosterSource, kể cả khi rosterSize null. Báo "suy đoán" cho người đọc
    // biết là đã xét rồi, chứ không phải quên chạy backfill.
    expect(loaiVi(buoi({ rosterSource: "UNKNOWN", rosterSize: null }))).toBe("SI_SO_SUY_DOAN");
  });

  it("SNAPSHOT mà thiếu số hoặc số âm là dữ liệu tự mâu thuẫn ⇒ loại, không đoán hộ", () => {
    expect(loaiVi(buoi({ rosterSize: null }))).toBe("CHUA_CO_SI_SO");
    expect(loaiVi(buoi({ rosterSize: -1 }))).toBe("CHUA_CO_SI_SO");
  });

  it("sĩ số 0 là số HỢP LỆ — lớp không còn ai vẫn là một sự thật cần tính", () => {
    expect(loaiVi(buoi({ rosterSize: 0 }))).toBeNull();
    expect(siSoDeTinhTien(buoi({ rosterSize: 0 }))).toBe(0);
  });
});

describe("siSoDeTinhTien — TỪ CHỐI, không bỏ qua", () => {
  it("qua cổng thì trả đúng số", () => {
    expect(siSoDeTinhTien(buoi({ rosterSize: 12 }))).toBe(12);
  });

  it("không qua thì NÉM, không trả 0", () => {
    // Đây là điểm chốt: bỏ qua dòng thiếu snapshot là lặng lẽ tính người đó thiếu tiền, và bảng
    // vẫn ra một con số trông hợp lệ. Khoá lại bằng test để không ai "vá" thành `?? 0`.
    expect(() => siSoDeTinhTien(buoi({ rosterSource: "FROM_ENROLLMENT" }))).toThrow(
      SiSoKhongDungDeTinhTien,
    );
    expect(() => siSoDeTinhTien(buoi({ rosterSource: null, rosterSize: null }))).toThrow(
      SiSoKhongDungDeTinhTien,
    );
  });

  it("câu lỗi chỉ đúng buổi nào và vì sao", () => {
    try {
      siSoDeTinhTien(buoi({ sessionId: "buoi-abc", rosterSource: "FROM_ATTENDANCE" }));
      expect.unreachable("phải ném");
    } catch (e) {
      expect(e).toBeInstanceOf(SiSoKhongDungDeTinhTien);
      const err = e as SiSoKhongDungDeTinhTien;
      expect(err.message).toContain("buoi-abc");
      expect(err.message).toContain("suy đoán");
      expect(err.dong).toEqual([
        { sessionId: "buoi-abc", lyDo: "SI_SO_SUY_DOAN", rosterSource: "FROM_ATTENDANCE" },
      ]);
    }
  });
});

describe("chặn cả lô — báo một lượt, không sửa từng buổi rồi chạy lại", () => {
  const lo = [
    buoi({ sessionId: "ok-1" }),
    buoi({ sessionId: "hong-1", rosterSource: "FROM_ENROLLMENT" }),
    buoi({ sessionId: "ok-2", rosterSize: 4 }),
    buoi({ sessionId: "hong-2", rosterSource: null, rosterSize: null }),
  ];

  it("lọc ra đúng những dòng hỏng, giữ nguyên thứ tự", () => {
    expect(locDongKhongDung(lo).map((d) => d.sessionId)).toEqual(["hong-1", "hong-2"]);
  });

  it("lô sạch thì không ném", () => {
    expect(() => chanLoTruocKhiTinh([buoi({ sessionId: "a" }), buoi({ sessionId: "b" })])).not.toThrow();
  });

  it("lô rỗng không ném — không có gì để tính khác với có thứ hỏng", () => {
    expect(() => chanLoTruocKhiTinh([])).not.toThrow();
  });

  it("ném MỘT lỗi mang đủ danh sách", () => {
    try {
      chanLoTruocKhiTinh(lo);
      expect.unreachable("phải ném");
    } catch (e) {
      const err = e as SiSoKhongDungDeTinhTien;
      expect(err.dong).toHaveLength(2);
      expect(err.message).toContain("2 buổi");
    }
  });

  it("lô lớn: câu lỗi rút gọn nhưng `dong` giữ đủ để màn liệt kê", () => {
    const nhieu = Array.from({ length: 9 }, (_, i) =>
      buoi({ sessionId: `x${i}`, rosterSource: "UNKNOWN" }),
    );
    try {
      chanLoTruocKhiTinh(nhieu);
      expect.unreachable("phải ném");
    } catch (e) {
      const err = e as SiSoKhongDungDeTinhTien;
      expect(err.dong).toHaveLength(9);
      expect(err.message).toContain("và 4 buổi nữa");
    }
  });
});
