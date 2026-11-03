import { describe, it, expect } from "vitest";
import { xemTruocMoKy } from "./xem-truoc-mo-ky";
import { goiYQuyTac, KHUNG_MAC_DINH } from "./khung-gio-mo-lop";

// Ngày TUYỆT ĐỐI trong fixture, không đọc đồng hồ (luật 19). 21/09/2026 là THỨ 2,
// nên tuần 21→27/09 có đủ bảy thứ: T2 (không mở) · T3–T6 · T7 · CN.
const TU = "2026-09-21";
const DEN = "2026-09-27";

describe("[XTK] xem trước mở lớp cả kỳ — đếm đúng thứ server sẽ mở", () => {
  it("[XTK-01] bộ tuỳ chọn gợi ý, một tuần, một cơ sở: 4 tối T3–T6 + 2 sáng + 2 chiều = 8 lớp", () => {
    const r = xemTruocMoKy({ tu: TU, den: DEN, quyTac: goiYQuyTac(KHUNG_MAC_DINH), soCoSo: 1, cauHinh: KHUNG_MAC_DINH });
    expect(r.loi).toBeNull();
    expect(r.theoTuyChon.map((t) => t.soLop)).toEqual([4, 2, 2]);
    expect(r.moiCoSo).toBe(8);
    expect(r.tong).toBe(8);
    expect(r.ngayDau).toBe("2026-09-22");
    expect(r.ngayCuoi).toBe("2026-09-27");
  });

  it("[XTK-02] áp dụng cho 2 cơ sở ⇒ tổng nhân đôi, số mỗi cơ sở giữ nguyên", () => {
    const r = xemTruocMoKy({ tu: TU, den: DEN, quyTac: goiYQuyTac(KHUNG_MAC_DINH), soCoSo: 2, cauHinh: KHUNG_MAC_DINH });
    expect(r.moiCoSo).toBe(8);
    expect(r.tong).toBe(16);
  });

  it("[XTK-03] hai tuỳ chọn TRÙNG nhau ⇒ tuỳ chọn sau không đếm lại (khớp khử trùng của server)", () => {
    const q = { thu: [2, 3, 4, 5], startTime: "17:30", endTime: "21:00" };
    const r = xemTruocMoKy({ tu: TU, den: DEN, quyTac: [q, q], soCoSo: 1, cauHinh: KHUNG_MAC_DINH });
    expect(r.theoTuyChon.map((t) => t.soLop)).toEqual([4, 0]);
    expect(r.moiCoSo).toBe(4);
  });

  it("[XTK-04] khung vắt qua giờ nghỉ trưa T7 ⇒ bị cổng khung giờ loại, đếm vào boQua", () => {
    const r = xemTruocMoKy({
      tu: TU,
      den: DEN,
      quyTac: [{ thu: [6], startTime: "11:00", endTime: "15:00" }],
      soCoSo: 1,
      cauHinh: KHUNG_MAC_DINH,
    });
    expect(r.moiCoSo).toBe(0);
    expect(r.theoTuyChon[0]).toMatchObject({ soLop: 0, boQua: 1 });
  });

  it("[XTK-05] ngày kết thúc trước ngày bắt đầu ⇒ lỗi cả lượt, 0 lớp", () => {
    const r = xemTruocMoKy({ tu: DEN, den: TU, quyTac: goiYQuyTac(KHUNG_MAC_DINH), soCoSo: 1, cauHinh: KHUNG_MAC_DINH });
    expect(r.loi).toContain("Ngày kết thúc");
    expect(r.tong).toBe(0);
  });

  it("[XTK-06] tuỳ chọn chưa chọn thứ ⇒ nói ra, không đếm", () => {
    const r = xemTruocMoKy({
      tu: TU,
      den: DEN,
      quyTac: [{ thu: [], startTime: "", endTime: "" }],
      soCoSo: 1,
      cauHinh: KHUNG_MAC_DINH,
    });
    expect(r.theoTuyChon[0]?.loi).toBe("Chưa chọn thứ");
    expect(r.tong).toBe(0);
  });

  it("[XTK-07] 0 cơ sở ⇒ tổng 0 (nút mở lớp phải khoá)", () => {
    const r = xemTruocMoKy({ tu: TU, den: DEN, quyTac: goiYQuyTac(KHUNG_MAC_DINH), soCoSo: 0, cauHinh: KHUNG_MAC_DINH });
    expect(r.moiCoSo).toBe(8);
    expect(r.tong).toBe(0);
  });
});
