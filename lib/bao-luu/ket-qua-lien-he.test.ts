import { describe, expect, it } from "vitest";
import {
  KET_QUA_LIEN_HE,
  LOI_THIEU_KET_QUA_LIEN_HE,
  daLeoThangSauLienHe,
  docKetQuaLienHe,
  dungDongHoLeoThang,
  laKetQuaLienHe,
} from "@/lib/bao-luu/ket-qua-lien-he";

const t = (n: number) => new Date(Date.UTC(2026, 9, n, 3));

describe("[KQLH] kết quả liên hệ phụ huynh — chỉ 'PH đã phản hồi' mới dừng đồng hồ leo thang", () => {
  it("[KQLH-01] đúng hai giá trị; chuỗi lạ / rỗng / không phải chuỗi bị từ chối", () => {
    expect([...KET_QUA_LIEN_HE]).toEqual(["PH_DA_PHAN_HOI", "KHONG_LIEN_LAC_DUOC"]);
    for (const v of ["", "ph_da_phan_hoi", "OK", null, undefined, 1, {}]) expect(laKetQuaLienHe(v), String(v)).toBe(false);
    expect(LOI_THIEU_KET_QUA_LIEN_HE).toMatch(/phản hồi.*không liên lạc được/);
  });

  it("[KQLH-02] đọc từ `after` của sự kiện: có khoá hợp lệ ⇒ giá trị; sự kiện CŨ (không khoá / after null / mảng) ⇒ null", () => {
    expect(docKetQuaLienHe({ henNgay: null, ketQua: "PH_DA_PHAN_HOI" })).toBe("PH_DA_PHAN_HOI");
    expect(docKetQuaLienHe({ ketQua: "KHONG_LIEN_LAC_DUOC" })).toBe("KHONG_LIEN_LAC_DUOC");
    expect(docKetQuaLienHe({ henNgay: null })).toBeNull(); // sự kiện CONTACT trước vòng 4
    expect(docKetQuaLienHe(null)).toBeNull();
    expect(docKetQuaLienHe(["PH_DA_PHAN_HOI"])).toBeNull();
    expect(docKetQuaLienHe({ ketQua: "khác" })).toBeNull();
  });

  it("[KQLH-03] dữ liệu cũ (null) KHÔNG dừng đồng hồ — sai về phía an toàn (vẫn leo thang)", () => {
    expect(dungDongHoLeoThang("PH_DA_PHAN_HOI")).toBe(true);
    expect(dungDongHoLeoThang("KHONG_LIEN_LAC_DUOC")).toBe(false);
    expect(dungDongHoLeoThang(null)).toBe(false);
  });

  it("[KQLH-04] chống lặp: chưa từng leo thang ⇒ false; đã leo thang rồi mà chỉ có cuộc gọi HỤT / dữ liệu cũ sau đó ⇒ vẫn true (không 'kích' được cron bằng cách ghi liên hệ)", () => {
    expect(daLeoThangSauLienHe({ lanLeoThangCuoi: null, lastContactAt: t(5), ketQuaLienHeCuoi: "KHONG_LIEN_LAC_DUOC" })).toBe(false);
    // leo thang ngày 3, gọi hụt ngày 5 ⇒ đã leo thang, KHÔNG mở lượt mới
    expect(daLeoThangSauLienHe({ lanLeoThangCuoi: t(3), lastContactAt: t(5), ketQuaLienHeCuoi: "KHONG_LIEN_LAC_DUOC" })).toBe(true);
    expect(daLeoThangSauLienHe({ lanLeoThangCuoi: t(3), lastContactAt: t(5), ketQuaLienHeCuoi: null })).toBe(true);
    // chưa có liên hệ nào
    expect(daLeoThangSauLienHe({ lanLeoThangCuoi: t(3), lastContactAt: null, ketQuaLienHeCuoi: null })).toBe(true);
  });

  it("[KQLH-05] PH phản hồi SAU lần leo thang ⇒ đặt lại (được leo thang lượt mới khi hết hoãn); phản hồi TRƯỚC lần leo thang ⇒ đã leo thang", () => {
    expect(daLeoThangSauLienHe({ lanLeoThangCuoi: t(3), lastContactAt: t(5), ketQuaLienHeCuoi: "PH_DA_PHAN_HOI" })).toBe(false);
    expect(daLeoThangSauLienHe({ lanLeoThangCuoi: t(8), lastContactAt: t(5), ketQuaLienHeCuoi: "PH_DA_PHAN_HOI" })).toBe(true);
  });
});
