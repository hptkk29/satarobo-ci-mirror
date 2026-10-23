// [PT-*] — CỔNG PHỤ THUỘC HỌC BÙ, phần THUẦN (T14). Đường chạm Postgres: tests/hoc-bu/phu-thuoc.test.ts.
import { describe, expect, it } from "vitest";
import { lyDoChanXoa, type DemPhuThuoc, type LoaiXoa } from "./phu-thuoc-thuan";

const KHONG: DemPhuThuoc = { dongBu: 0, mucCase: 0, caseTrongBo: 0, diemDanhDaBu: 0 };
const LOAI: LoaiXoa[] = ["BUOI", "BAI", "DIEM_DANH"];

describe("[PT] cổng phụ thuộc học bù", () => {
  it("[PT-01] không gì trỏ tới ⇒ null (xoá được), với cả ba loại", () => {
    for (const l of LOAI) expect(lyDoChanXoa(l, KHONG), l).toBeNull();
  });

  it("[PT-02] TỪNG ô đếm chặn được một mình, và câu lỗi nói đúng vướng gì", () => {
    const o: [keyof DemPhuThuoc, string][] = [
      ["dongBu", "dòng học bù"],
      ["mucCase", "mục trong case"],
      ["caseTrongBo", "case dạy bù có bài này"],
      ["diemDanhDaBu", "đã học bù"],
    ];
    for (const l of LOAI) {
      for (const [k, chu] of o) {
        const r = lyDoChanXoa(l, { ...KHONG, [k]: 2 });
        expect(r, `${l}/${k}`).not.toBeNull();
        expect(r, `${l}/${k}`).toContain("2 ");
        expect(r, `${l}/${k}`).toContain(chu);
      }
    }
  });

  it("[PT-03] nhiều vướng cùng lúc ⇒ liệt kê ĐỦ trong một câu; câu nói rõ KỂ CẢ dòng đã huỷ / đã bù xong (lịch sử)", () => {
    const r = lyDoChanXoa("BUOI", { dongBu: 3, mucCase: 2, caseTrongBo: 0, diemDanhDaBu: 1 })!;
    expect(r).toContain("3 dòng học bù");
    expect(r).toContain("kể cả đã huỷ hoặc đã bù xong");
    expect(r).toContain("2 mục trong case");
    expect(r).toContain("1 bản ghi điểm danh");
  });

  it("[PT-04] gợi ý thay thế đúng loại: buổi ⇒ HUỶ (không xoá); bài ⇒ giữ bài; điểm danh ⇒ sửa trạng thái", () => {
    expect(lyDoChanXoa("BUOI", { ...KHONG, dongBu: 1 })).toContain("HUỶ buổi");
    expect(lyDoChanXoa("BAI", { ...KHONG, dongBu: 1 })).toContain("giữ bài");
    expect(lyDoChanXoa("DIEM_DANH", { ...KHONG, dongBu: 1 })).toContain("sửa trạng thái điểm danh");
  });
});
