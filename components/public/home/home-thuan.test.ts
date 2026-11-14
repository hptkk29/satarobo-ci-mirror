import { describe, expect, it } from "vitest";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import {
  BO_ROBOT,
  chonBo,
  chonPhanHoiTrangChu,
  doiCauMo,
  dungGiaTrangChu,
  dungCauHoi,
  chuoiGiaThe,
  giaThangTuNam,
  giaTronKhoa,
  lopLuoiBo,
  type GiaTrangChu,
} from "./home-thuan";

const GIA_DU: GiaTrangChu = { sata1: 2_400_000, sata3: 10_560_000, sata4: 11_520_000, sata5: 12_480_000 };
const KHONG_GIA: GiaTrangChu = { sata1: null, sata3: null, sata4: null, sata5: null };

describe("[PUB-HOME-01] giá thẻ khoá học", () => {
  it("học phí năm chia 12 ⇒ giá tháng đúng như thẻ artifact (880.000 / 960.000 / 1.040.000)", () => {
    expect(giaThangTuNam(10_560_000)).toBe("880.000đ");
    expect(giaThangTuNam(11_520_000)).toBe("960.000đ");
    expect(giaThangTuNam(12_480_000)).toBe("1.040.000đ");
    expect(giaTronKhoa(2_400_000)).toBe("2.400.000đ");
  });

  it("giá thiếu / 0 / âm / NaN ⇒ null (không bịa số)", () => {
    for (const v of [null, 0, -5, Number.NaN]) {
      expect(giaThangTuNam(v)).toBeNull();
      expect(giaTronKhoa(v)).toBeNull();
    }
  });

  it("thẻ Sata3/4/5 lấy giá tháng, thẻ combo lấy giá trọn khoá của Sata1", () => {
    expect(chuoiGiaThe(GIA_DU)).toEqual({ combo: "2.400.000đ", sata3: "880.000đ", sata4: "960.000đ", sata5: "1.040.000đ" });
  });

  it("không có giá ⇒ cả bốn thẻ bỏ dòng giá; thiếu MỘT khoá ⇒ chỉ thẻ đó bỏ", () => {
    expect(chuoiGiaThe(KHONG_GIA)).toEqual({ combo: null, sata3: null, sata4: null, sata5: null });
    expect(chuoiGiaThe({ ...GIA_DU, sata4: null })).toEqual({ combo: "2.400.000đ", sata3: "880.000đ", sata4: null, sata5: "1.040.000đ" });
  });
});

describe("[PUB-HOME-02] robot con sẽ tự lắp", () => {
  it("ba bộ Alpha/Beta/Intel; Alpha 6 mô hình, Beta 4, Intel 6", () => {
    expect(BO_ROBOT.map((b) => [b.id, b.moHinh.length])).toEqual([
      ["alpha", 6],
      ["beta", 4],
      ["intel", 6],
    ]);
  });
  it("lưới 4 mô hình dùng c4, còn lại 3 cột", () => {
    expect(lopLuoiBo(chonBo("beta"))).toBe("kit-grid c4");
    expect(lopLuoiBo(chonBo("alpha"))).toBe("kit-grid");
  });
  it("id lạ rơi về Alpha", () => {
    expect(chonBo("khong-co").id).toBe("alpha");
  });
  it("mỗi mô hình có mã ảnh duy nhất trong toàn trang", () => {
    const ma = BO_ROBOT.flatMap((b) => b.moHinh.map((m) => m.ma));
    expect(new Set(ma).size).toBe(ma.length);
  });
});

describe("[PUB-HOME-03] FAQ", () => {
  it("5 câu hỏi; học phí nêu đúng số khi có giá", () => {
    const ch = dungCauHoi(GIA_DU);
    expect(ch).toHaveLength(5);
    expect(ch[2].a).toContain("880.000đ/tháng");
    expect(ch[2].a).toContain("2.400.000đ");
  });
  it("thiếu giá ⇒ câu học phí KHÔNG chứa chữ số tiền", () => {
    const a = dungCauHoi(KHONG_GIA)[2].a;
    // Số TIỀN (có "đ"), không phải mọi "d.ddd": câu nay mang số hotline 0837.312.860 để ba mẹ hỏi giá
    // [ẩn học phí, 06/11/2026] — mẫu cũ /\d\.\d{3}/ bắt nhầm số điện thoại.
    expect(a).not.toMatch(/\d{1,3}(\.\d{3})+\s*đ(?!\p{L})/u);
    expect(a).toContain(SATA_ROBO_PHONE.hien);
  });
  it("thời lượng học thử lấy từ lib/uu-dai (45 + 90 phút)", () => {
    expect(dungCauHoi(GIA_DU)[0].a).toContain("45 phút");
    expect(dungCauHoi(GIA_DU)[0].a).toContain("90 phút");
  });
  it("bấm câu đang mở thì đóng; bấm câu khác thì chuyển", () => {
    expect(doiCauMo(-1, 2)).toBe(2);
    expect(doiCauMo(2, 2)).toBe(-1);
    expect(doiCauMo(2, 4)).toBe(4);
  });
});

describe("[PUB-HOME-04] phản hồi phụ huynh", () => {
  const mau = (n: string, c: string) => ({ name: n, content: c });
  it("rỗng ⇒ rỗng (khối bị ẩn, không dựng thẻ giả)", () => {
    expect(chonPhanHoiTrangChu([])).toEqual([]);
  });
  it("bỏ bản ghi thiếu tên/nội dung và cắt tối đa 4", () => {
    const kq = chonPhanHoiTrangChu([mau("A", "x"), mau("", "y"), mau("B", "  "), mau("C", "z"), mau("D", "w"), mau("E", "v"), mau("F", "u")]);
    expect(kq.map((t) => t.name)).toEqual(["A", "C", "D", "E"]);
  });
});

describe("[PUB-HOME-12] bảng giá trang chủ từ Course", () => {
  const h = (slug: string, price: number | null, isPublished = true) => ({ slug, price, isPublished });
  it("khớp slug CHÍNH XÁC: khoá demo sata-3 / sata-1 không lọt vào", () => {
    const g = dungGiaTrangChu([h("sata-1", 4_400_000), h("sata-3", 5_200_000), h("sata-4", 5_600_000), h("sata3", 10_560_000)]);
    expect(g).toEqual({ sata1: null, sata3: 10_560_000, sata4: null, sata5: null });
  });
  it("khoá chưa công khai hoặc giá 0/null ⇒ null (bỏ dòng giá)", () => {
    const g = dungGiaTrangChu([h("sata1", 2_400_000, false), h("sata3", 0), h("sata4", null), h("sata5", 12_480_000)]);
    expect(g).toEqual({ sata1: null, sata3: null, sata4: null, sata5: 12_480_000 });
  });
  it("không có dòng nào ⇒ cả bốn null", () => {
    expect(dungGiaTrangChu([])).toEqual({ sata1: null, sata3: null, sata4: null, sata5: null });
  });
});
