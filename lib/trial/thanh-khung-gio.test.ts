import { describe, it, expect } from "vitest";
import { xepLenThanh, soLan, mocGio } from "./thanh-khung-gio";

/** Khung lớp của ví dụ chủ dự án đưa ra: 23/09, 17:30–21:00 (210 phút). */
const KHUNG = { startTime: "17:30", endTime: "21:00" };

/** Ba case thật trong ví dụ đó. Giữ nguyên số liệu — đừng làm tròn cho đẹp. */
const SALE_1_A = { id: "s1a", startTime: "18:00", endTime: "19:00" }; // Sale 1, Sata 3
const SALE_2_A = { id: "s2a", startTime: "17:30", endTime: "18:30" }; // Sale 2, Sata 4
const SALE_2_B = { id: "s2b", startTime: "19:00", endTime: "20:00" }; // Sale 2, Sata 6

describe("[TKG-00] tự kiểm số liệu của ví dụ gốc", () => {
  // Nếu ca này đỏ thì mọi ca dưới đang đo một khung khác với khung chủ dự án nói.
  it("khung lớp dài đúng 210 phút", () => {
    // Đo bằng CHÍNH phép tính mà các ca dưới dựa vào: một case 21 phút phải rộng
    // đúng 10%. Nếu khung không phải 210 phút thì con số này lệch ngay.
    //
    // ⚠️ Bản đầu của ca này dùng `mocGio(KHUNG, 210)` và chờ `["21:00"]` — SAI, vì
    // 17:30 = 1050 phút và 1050 chia hết cho 210, nên 17:30 CŨNG là mốc tròn. Mã đúng,
    // phép đo sai — giữ ghi chú này để người sau không "sửa" lại `mocGio` theo nó.
    const [x] = xepLenThanh(KHUNG, [{ id: "do", startTime: "18:00", endTime: "18:21" }]);
    expect(x?.width).toBeCloseTo(10, 6);
  });
});

describe("[TKG-01] vị trí trên trục", () => {
  it("case bắt đầu đúng mốc mở lớp thì dính mép trái", () => {
    const [x] = xepLenThanh(KHUNG, [SALE_2_A]);
    expect(x?.left).toBe(0);
    // 60/210 = 28,57%
    expect(x?.width).toBeCloseTo((60 / 210) * 100, 6);
  });

  it("case giữa khung ra đúng tỷ lệ", () => {
    const [x] = xepLenThanh(KHUNG, [SALE_1_A]);
    // 18:00 là phút thứ 30 của khung ⇒ 30/210
    expect(x?.left).toBeCloseTo((30 / 210) * 100, 6);
    expect(x?.width).toBeCloseTo((60 / 210) * 100, 6);
  });

  it("case chạm mốc đóng lớp KHÔNG thò ra ngoài thanh", () => {
    const [x] = xepLenThanh(KHUNG, [{ id: "cuoi", startTime: "20:00", endTime: "21:00" }]);
    expect((x?.left ?? 0) + (x?.width ?? 0)).toBeCloseTo(100, 6);
  });
});

describe("[TKG-02] chia làn — hai case chồng giờ KHÔNG bao giờ chung làn", () => {
  it("ví dụ gốc: 3 case ⇒ đúng 2 làn", () => {
    const xep = xepLenThanh(KHUNG, [SALE_1_A, SALE_2_A, SALE_2_B]);
    expect(xep).toHaveLength(3);
    expect(soLan(xep)).toBe(2);

    const lan = new Map(xep.map((x) => [x.item.id, x.lane]));
    // 17:30–18:30 và 18:00–19:00 CHỒNG nhau (30 phút) ⇒ phải khác làn.
    expect(lan.get("s2a")).not.toBe(lan.get("s1a"));
    // 19:00–20:00 bắt đầu đúng lúc 18:00–19:00 kết thúc ⇒ KHÔNG chồng, tái dùng làn 0.
    expect(lan.get("s2b")).toBe(lan.get("s2a"));
  });

  it("[TKG-02b] chạm đầu-đuôi KHÔNG tính là chồng", () => {
    // Đây là ca một bản kiểm "hợp lý" hay sai: dùng `<` thay `<=` là 19:00–20:00 bị đẩy
    // xuống làn mới, và thanh cao gấp đôi cần thiết ngay ở ví dụ thường gặp nhất.
    const xep = xepLenThanh(KHUNG, [
      { id: "a", startTime: "17:30", endTime: "18:30" },
      { id: "b", startTime: "18:30", endTime: "19:30" },
    ]);
    expect(soLan(xep)).toBe(1);
  });

  it("ba case chồng nhau hoàn toàn ⇒ ba làn", () => {
    const xep = xepLenThanh(KHUNG, [
      { id: "a", startTime: "18:00", endTime: "19:00" },
      { id: "b", startTime: "18:15", endTime: "19:15" },
      { id: "c", startTime: "18:30", endTime: "19:30" },
    ]);
    expect(soLan(xep)).toBe(3);
  });

  it("thứ tự đầu vào KHÔNG đổi kết quả chia làn", () => {
    const a = xepLenThanh(KHUNG, [SALE_1_A, SALE_2_A, SALE_2_B]);
    const b = xepLenThanh(KHUNG, [SALE_2_B, SALE_1_A, SALE_2_A]);
    const key = (x: typeof a) => x.map((c) => `${c.item.id}:${c.lane}`).sort();
    expect(key(b)).toEqual(key(a));
  });
});

describe("[TKG-03] case ngắn vẫn bấm được", () => {
  it("case 5 phút được nới lên sàn 2%, và TỰ KHAI là đã nới", () => {
    const [x] = xepLenThanh(KHUNG, [{ id: "n", startTime: "18:00", endTime: "18:05" }]);
    // 5/210 = 2,38% — trên sàn, nên KHÔNG bị nới.
    expect(x?.width).toBeCloseTo((5 / 210) * 100, 6);
  });

  it("khung DÀI thì case ngắn mới chạm sàn", () => {
    const dai = { startTime: "08:00", endTime: "21:00" }; // 780 phút
    const [x] = xepLenThanh(dai, [{ id: "n", startTime: "10:00", endTime: "10:05" }]);
    // 5/780 = 0,64% ⇒ nới lên 2%.
    expect(x?.width).toBe(2);
  });
});

describe("[TKG-04] dữ liệu ngoài khung phải TỰ KHAI, không im lặng kẹp", () => {
  it("case tràn khỏi khung lớp bị đánh dấu ngoaiKhung", () => {
    const [x] = xepLenThanh(KHUNG, [{ id: "x", startTime: "16:00", endTime: "22:00" }]);
    expect(x?.ngoaiKhung).toBe(true);
    // Vẫn vẽ được — kẹp vào [0, 100] chứ không biến mất khỏi thanh.
    expect(x?.left).toBe(0);
    expect(x?.width).toBe(100);
  });

  it("case nằm trọn trong khung thì KHÔNG bị đánh dấu", () => {
    const [x] = xepLenThanh(KHUNG, [SALE_1_A]);
    expect(x?.ngoaiKhung).toBe(false);
  });

  it("giờ hỏng thì BỎ case đó, không ném và không đẩy lệch làn của case còn lại", () => {
    const xep = xepLenThanh(KHUNG, [
      { id: "hong", startTime: "khong-phai-gio", endTime: "19:00" },
      SALE_1_A,
    ]);
    expect(xep.map((x) => x.item.id)).toEqual(["s1a"]);
    expect(soLan(xep)).toBe(1);
  });
});

describe("[TKG-05] không có khung lớp ⇒ KHÔNG vẽ thanh", () => {
  // Lớp tạo trước 22/09/2026 không có khung. Trả rỗng để người gọi biết mà không vẽ,
  // thay vì vẽ một thanh mà mọi case đều nằm ở 0% — trông như dữ liệu, thật ra là rác.
  it("khung null", () => {
    expect(xepLenThanh(null, [SALE_1_A])).toEqual([]);
    expect(mocGio(null)).toEqual([]);
  });

  it("khung ngược (kết thúc không sau bắt đầu)", () => {
    expect(xepLenThanh({ startTime: "21:00", endTime: "17:30" }, [SALE_1_A])).toEqual([]);
    expect(xepLenThanh({ startTime: "18:00", endTime: "18:00" }, [SALE_1_A])).toEqual([]);
  });

  it("soLan của mảng rỗng là 0, không phải 1", () => {
    expect(soLan([])).toBe(0);
  });
});

describe("[TKG-06] mốc giờ trên thanh", () => {
  it("chỉ lấy mốc TRÒN nằm trong khung", () => {
    // Lớp mở 17:30 ⇒ KHÔNG được có vạch 17:00 (mốc không tồn tại trong khung này).
    expect(mocGio(KHUNG, 30).map((m) => m.nhan)).toEqual([
      "17:30",
      "18:00",
      "18:30",
      "19:00",
      "19:30",
      "20:00",
      "20:30",
      "21:00",
    ]);
  });

  it("mốc đầu và mốc cuối nằm đúng hai mép", () => {
    const m = mocGio(KHUNG, 30);
    expect(m[0]?.left).toBe(0);
    expect(m[m.length - 1]?.left).toBeCloseTo(100, 6);
  });

  it("khung lẻ: mốc đầu tiên là mốc tròn ĐẦU TIÊN SAU giờ mở", () => {
    const m = mocGio({ startTime: "17:45", endTime: "19:15" }, 30);
    expect(m.map((x) => x.nhan)).toEqual(["18:00", "18:30", "19:00"]);
    expect(m[0]?.left).toBeGreaterThan(0);
  });

  it("bước 0 hoặc âm thì trả rỗng, không treo vòng lặp", () => {
    expect(mocGio(KHUNG, 0)).toEqual([]);
    expect(mocGio(KHUNG, -30)).toEqual([]);
  });
});
