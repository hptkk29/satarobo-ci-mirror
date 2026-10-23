import { describe, it, expect } from "vitest";
import { xepLopPhucHoc, type LopUngVien } from "@/lib/bao-luu/phuc-hoc";

// An dừng ở bài 20 ⇒ bài kế tiếp 21. Dung sai mặc định 2.
const lop = (classId: string, baiHienTai: number | null, o: Partial<LopUngVien> = {}): LopUngVien => ({ classId, ten: classId, baiHienTai, siSo: 5, toiDa: 12, ...o });
const xep = (ds: LopUngVien[], dungSai = 2) => xepLopPhucHoc({ dungOBai: 20, dungSai, lop: ds });

describe("[BL6-PH] chọn lớp phục học (BR-21/22)", () => {
  it("[BL6-PH-01] TC-13: lớp ở bài 19 (đi sau 2 bài) ⇒ HỌC LẠI 19–20, KHÔNG buổi bù", () => {
    const [l] = xep([lop("a", 19)]);
    expect(l).toMatchObject({ lech: -2, huong: "HOC_LAI", hocLaiTu: 19, hocLaiDen: 20, soBuoiBu: 0 });
  });

  it("[BL6-PH-02] TC-14: lớp ở bài 23 (đi trước 2 bài) ⇒ sinh 2 buổi bù PHUC_HOC (bài 21, 22); không học lại", () => {
    const [l] = xep([lop("a", 23)]);
    expect(l).toMatchObject({ lech: 2, huong: "BU", soBuoiBu: 2, hocLaiTu: null, hocLaiDen: null });
  });

  it("[BL6-PH-03] lớp đúng bài kế tiếp ⇒ KHỚP, không học lại, không bù", () => {
    expect(xep([lop("a", 21)])[0]).toMatchObject({ lech: 0, huong: "KHOP", soBuoiBu: 0, hocLaiTu: null });
  });

  it("[BL6-PH-04] ngoài dung sai bị loại: ở biên ±2 còn nhận, ±3 thì không; dung sai 0 chỉ nhận lớp khớp", () => {
    expect(xep([lop("a", 18), lop("b", 24)])).toEqual([]);
    expect(xep([lop("a", 19), lop("b", 23)]).map((l) => l.classId).sort()).toEqual(["a", "b"]);
    expect(xep([lop("a", 20), lop("b", 21), lop("c", 22)], 0).map((l) => l.classId)).toEqual(["b"]);
  });

  it("[BL6-PH-05] TC-15: không lớp nào trong dung sai ⇒ danh sách rỗng (dịch vụ chuyển hồ sơ sang loại CENTER)", () => {
    expect(xep([lop("a", 10), lop("b", 40)])).toEqual([]);
  });

  it("[BL6-PH-06] BR-21: lớp ĐỦ SĨ SỐ vẫn được đề xuất, chỉ gắn cờ daDay và xếp sau lớp còn chỗ cùng độ lệch", () => {
    const kq = xep([lop("day", 21, { siSo: 12, toiDa: 12 }), lop("con", 21, { siSo: 3, toiDa: 12 })]);
    expect(kq.map((l) => l.classId)).toEqual(["con", "day"]);
    expect(kq.find((l) => l.classId === "day")?.daDay).toBe(true);
  });

  it("[BL6-PH-07] lệch ít xếp trước (khớp > lệch 1 > lệch 2); lớp không biết đang ở bài nào bị bỏ (không đoán)", () => {
    expect(xep([lop("lech2", 23), lop("khop", 21), lop("lech1", 20), lop("khongBiet", null)]).map((l) => l.classId)).toEqual(["khop", "lech1", "lech2"]);
  });
});
