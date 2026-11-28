// @vitest-environment node
/** [ATH-*] P7 — chạy thử luật (thuần) + câu mô tả Khi/Thì. Ca có DB (đọc thật, không ghi gì): `tests/elearning/tu-dong-hoa-thu-db.spec.ts`. */
import { describe, expect, it } from "vitest";
import { TRAN_DONG_CHAY_THU, xetDanhSach } from "./automation-thu";
import { moTaKhi, moTaThi } from "./automation-mota";

const NOW = new Date("2026-11-20T05:00:00.000Z");
const ngay = (d: number) => new Date(NOW.getTime() + d * 86_400_000);
const nv = (ten: string, joinedAt: Date | null, departmentId: string | null = null) => ({ ten, moTa: "x", doiTuong: { userId: ten, departmentId, joinedAt } });

describe("[ATH] xetDanhSach dùng ĐÚNG xetLuat của cỗ máy thật", () => {
  it("[ATH-01] 🔴 nhân sự mới: trong ngưỡng ⇒ sẽ thi hành; quá ngưỡng / thiếu ngày vào làm / khác phòng ⇒ bỏ qua KÈM LÝ DO; nhóm khớp xếp trước", () => {
    const r = xetDanhSach(
      "NHAN_SU_MOI",
      { trongVongNgay: 5, departmentId: "d1" },
      [nv("A", ngay(-2), "d1"), nv("B", ngay(-6), "d1"), nv("C", null, "d1"), nv("D", ngay(-1), "d2"), nv("E", ngay(-5), "d1")],
      NOW,
    );
    expect(r.soKhop).toBe(2);
    expect(r.soBoQua).toBe(3);
    expect(r.dong.map((x) => x.ten)).toEqual(["A", "E", "B", "C", "D"]);
    expect(r.dong.find((x) => x.ten === "B")!.lyDo).toMatch(/quá ngưỡng 5 ngày/);
    expect(r.dong.find((x) => x.ten === "C")!.lyDo).toMatch(/chưa có ngày vào làm/);
    expect(r.dong.find((x) => x.ten === "D")!.lyDo).toMatch(/phòng ban/);
  });

  it("[ATH-02] khoá hoàn thành: chỉ khớp đúng khoá luật chờ; không khai khoá ⇒ mọi khoá khớp", () => {
    const ds = [
      { ten: "A", moTa: "", doiTuong: { userId: "a", departmentId: null, joinedAt: null, courseId: "k1" } },
      { ten: "B", moTa: "", doiTuong: { userId: "b", departmentId: null, joinedAt: null, courseId: "k2" } },
    ];
    expect(xetDanhSach("KHOA_HOAN_THANH", { courseId: "k1" }, ds, NOW).dong.map((x) => [x.ten, x.khop])).toEqual([["A", true], ["B", false]]);
    expect(xetDanhSach("KHOA_HOAN_THANH", {}, ds, NOW).soKhop).toBe(2);
  });

  it("[ATH-03] 🔴 trần dòng: cắt ở TRAN_DONG_CHAY_THU nhưng ĐẾM đủ và báo biCat — không im lặng bỏ bớt", () => {
    const nhieu = Array.from({ length: TRAN_DONG_CHAY_THU + 7 }, (_, i) => nv(`N${i}`, ngay(-1)));
    const r = xetDanhSach("NHAN_SU_MOI", { trongVongNgay: 30 }, nhieu, NOW);
    expect(r.dong).toHaveLength(TRAN_DONG_CHAY_THU);
    expect(r.soKhop).toBe(TRAN_DONG_CHAY_THU + 7);
    expect(r.biCat).toBe(true);
    expect(xetDanhSach("NHAN_SU_MOI", { trongVongNgay: 30 }, nhieu.slice(0, 3), NOW).biCat).toBe(false);
  });

  it("[ATH-04] danh sách rỗng ⇒ 0/0, không ném lỗi", () => {
    expect(xetDanhSach("NHAN_SU_MOI", { trongVongNgay: 5 }, [], NOW)).toEqual({ dong: [], soKhop: 0, soBoQua: 0, biCat: false });
  });
});

describe("[ATM] câu mô tả Khi / Thì", () => {
  const ten = { phongBan: new Map([["d1", "Giảng dạy"]]), khoa: new Map([["k1", "An toàn điện"]]), loTrinh: new Map([["p1", "Giáo viên mới"]]) };
  it("[ATM-01] Khi: nhân sự mới + phòng + ngưỡng; khoá hoàn thành + tên khoá; id không tra được ⇒ câu trung tính (không in id thô)", () => {
    expect(moTaKhi("NHAN_SU_MOI", { trongVongNgay: 30, departmentId: "d1" }, ten)).toBe("Nhân sự mới vào làm · trong 30 ngày đầu · Giảng dạy");
    expect(moTaKhi("CHUNG_NHAN_HET_HAN", { courseId: "k1" }, ten)).toBe("Chứng nhận hết hiệu lực · khoá An toàn điện");
    expect(moTaKhi("KHOA_HOAN_THANH", { courseId: "k-xoa" }, ten)).toBe("Hoàn thành một khoá · khoá đã chọn");
    expect(moTaKhi("YEU_CAU_MOI_AP_DUNG", {}, ten)).toBe("Yêu cầu đào tạo mới áp dụng");
  });
  it("[ATM-02] Thì: giao khoá/lộ trình kèm hạn; hạn 0 ⇒ không nói hạn; gửi nhắc nêu tiêu đề", () => {
    expect(moTaThi("GIAO_KHOA", { courseId: "k1" }, 14, ten)).toBe("Giao khoá An toàn điện · hạn 14 ngày");
    expect(moTaThi("GIAO_LO_TRINH", { pathId: "p1" }, 0, ten)).toBe("Giao trọn lộ trình Giáo viên mới");
    expect(moTaThi("GUI_NHAC", { tieuDe: "Nhớ học", noiDung: "x" }, 30, ten)).toBe("Gửi nhắc: Nhớ học");
    expect(moTaThi("GIAO_KHOA", {}, 30, ten)).toContain("(chưa chọn)");
  });
});
