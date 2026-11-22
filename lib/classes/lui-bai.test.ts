/**
 * "Nghỉ & lùi lịch" theo LỚP — kể cả buổi ĐÃ QUA (chủ dự án chốt 27/09/2026: "lùi TÊN BÀI").
 *
 * Buổi đã qua thường ĐÃ được điểm danh ở các buổi sau ngày nghỉ, và ngày điểm danh là sự
 * thật đã xảy ra ⇒ KHÔNG dời ngày. Thay vào đó NỘI DUNG BÀI dịch lùi một buổi: buổi nghỉ
 * thành "Đã hủy", mỗi buổi sau nhận bài của buổi trước nó, cuối khoá thêm một buổi mang bài
 * cuối. Ngày, điểm danh, nhận xét giữ nguyên trên buổi.
 */
import { describe, it, expect } from "vitest";
import { keHoachLuiBai, type BuoiLuiBai, type NoiDungBuoi } from "./lui-bai";

const nd = (so: number): NoiDungBuoi => ({
  planId: `p${so}`,
  lessonId: `l${so}`,
  topic: `Bài ${so}`,
  lessonNotes: null,
  sessionCategoryId: null,
});
const buoi = (id: string, ngay: number, so: number, huy = false): BuoiLuiBai => ({
  id,
  date: new Date(Date.UTC(2026, 8, ngay, 10)),
  huy,
  noiDung: nd(so),
});

describe("keHoachLuiBai — lùi tên bài một buổi", () => {
  it("[LB-01] nghỉ buổi Bài 2 ⇒ Bài 2 sang buổi kế, … Bài 5 sang buổi MỚI ở cuối", () => {
    const kh = keHoachLuiBai({
      buoi: [buoi("s1", 18, 1), buoi("s2", 20, 2), buoi("s3", 22, 3), buoi("s4", 24, 4), buoi("s5", 26, 5)],
      buoiNghiId: "s2",
    });
    expect(kh.buoiNghiId).toBe("s2");
    expect(kh.doiNoiDung.map((d) => [d.id, d.noiDung.topic])).toEqual([
      ["s3", "Bài 2"],
      ["s4", "Bài 3"],
      ["s5", "Bài 4"],
    ]);
    expect(kh.noiDungBuoiMoi.topic).toBe("Bài 5");
    // Buổi TRƯỚC ngày nghỉ không đụng.
    expect(kh.doiNoiDung.find((d) => d.id === "s1")).toBeUndefined();
  });

  it("[LB-02] mang đủ bộ nội dung (plan, lesson, tên, ghi chú bài, loại buổi) — không chỉ tên", () => {
    const kh = keHoachLuiBai({
      buoi: [buoi("s1", 18, 1), buoi("s2", 20, 2)],
      buoiNghiId: "s1",
    });
    expect(kh.doiNoiDung).toEqual([{ id: "s2", noiDung: nd(1) }]);
    expect(kh.noiDungBuoiMoi).toEqual(nd(2));
  });

  it("[LB-03] buổi ĐÃ HUỶ xen giữa đứng ngoài chuỗi — không nhận bài, không trao bài", () => {
    const kh = keHoachLuiBai({
      buoi: [buoi("s1", 18, 1), buoi("x", 19, 9, true), buoi("s2", 20, 2), buoi("s3", 22, 3)],
      buoiNghiId: "s1",
    });
    expect(kh.doiNoiDung.map((d) => [d.id, d.noiDung.topic])).toEqual([
      ["s2", "Bài 1"],
      ["s3", "Bài 2"],
    ]);
    expect(kh.noiDungBuoiMoi.topic).toBe("Bài 3");
  });

  it("[LB-04] thứ tự đầu vào lộn xộn vẫn xếp theo NGÀY", () => {
    const kh = keHoachLuiBai({
      buoi: [buoi("s3", 22, 3), buoi("s1", 18, 1), buoi("s2", 20, 2)],
      buoiNghiId: "s1",
    });
    expect(kh.doiNoiDung.map((d) => d.id)).toEqual(["s2", "s3"]);
  });

  it("[LB-05] nghỉ buổi CUỐI ⇒ không buổi nào đổi bài, buổi mới mang bài của nó", () => {
    const kh = keHoachLuiBai({ buoi: [buoi("s1", 18, 1), buoi("s2", 20, 2)], buoiNghiId: "s2" });
    expect(kh.doiNoiDung).toEqual([]);
    expect(kh.noiDungBuoiMoi.topic).toBe("Bài 2");
  });

  it("[LB-06] buổi nghỉ không có trong danh sách (hoặc đã huỷ) ⇒ ném lỗi, không đoán", () => {
    expect(() => keHoachLuiBai({ buoi: [buoi("s1", 18, 1)], buoiNghiId: "khong-co" })).toThrow();
    expect(() => keHoachLuiBai({ buoi: [buoi("s1", 18, 1, true)], buoiNghiId: "s1" })).toThrow();
  });
});
