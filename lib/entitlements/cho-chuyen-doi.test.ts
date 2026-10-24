// lib/entitlements/cho-chuyen-doi.test.ts — hai hàm THUẦN của trạng thái CHỜ CHUYỂN ĐỔI. Không DB.
// Hành vi trên Postgres thật: `tests/finance/quyen-hoc-noi-duong-tien.test.ts` (`[NOI-DB-*]`).
import { describe, expect, it } from "vitest";
import { chonHocVienChoDong, type DauVaoHocVienCuaDong } from "./hoc-vien-cua-dong";
import { hanhDongChoChuyenDoi } from "./cho-chuyen-doi";

const trong: DauVaoHocVienCuaDong = {
  studentIdDong: null,
  studentIdGhiDanhCuaDong: null,
  leadChildId: null,
  hocVienTuGhiDanhCuaCon: [],
  hocVienTuHoSoCuaCon: [],
};
const voi = (o: Partial<DauVaoHocVienCuaDong>): DauVaoHocVienCuaDong => ({ ...trong, ...o });

describe("[NOI-U-HV] chọn học viên cho dòng đơn — không bao giờ đoán", () => {
  it("[NOI-U-HV-01] học viên ghi thẳng trên dòng đơn thắng mọi nguồn khác", () => {
    const kq = chonHocVienChoDong(
      voi({ studentIdDong: "hv-dong", studentIdGhiDanhCuaDong: "hv-gd", leadChildId: "con-1", hocVienTuHoSoCuaCon: ["hv-khac"] }),
    );
    expect(kq).toEqual({ kieu: "CO", studentId: "hv-dong", nguon: "DONG_DON" });
  });

  it("[NOI-U-HV-02] không ghi trên dòng thì lấy học viên của ghi danh gắn với dòng", () => {
    expect(chonHocVienChoDong(voi({ studentIdGhiDanhCuaDong: "hv-gd" }))).toEqual({ kieu: "CO", studentId: "hv-gd", nguon: "GHI_DANH_CUA_DONG" });
  });

  it("[NOI-U-HV-03] khách mới: con lead khớp ĐÚNG MỘT học viên (cùng một người xuất hiện ở hai nguồn vẫn là một) ⇒ nhận", () => {
    const kq = chonHocVienChoDong(voi({ leadChildId: "con-1", hocVienTuGhiDanhCuaCon: ["hv-1", "hv-1"], hocVienTuHoSoCuaCon: ["hv-1"] }));
    expect(kq).toEqual({ kieu: "CO", studentId: "hv-1", nguon: "CON_LEAD" });
  });

  it("[NOI-U-HV-04] con lead chưa có hồ sơ nào ⇒ CHƯA CÓ (chờ Chuyển đổi), kèm lý do", () => {
    const kq = chonHocVienChoDong(voi({ leadChildId: "con-1" }));
    expect(kq.kieu).toBe("CHUA_CO");
    expect(kq.kieu === "CHUA_CO" && kq.lyDo.length).toBeGreaterThan(20);
  });

  it("[NOI-U-HV-05] dòng không mang con lead và không có học viên ⇒ CHƯA CÓ, KHÔNG suy từ nguồn nào khác", () => {
    // Đối chứng: dù có "ứng viên" đứng sẵn trong đầu vào, thiếu leadChildId thì không được dùng chúng.
    const kq = chonHocVienChoDong(voi({ hocVienTuGhiDanhCuaCon: ["hv-la"], hocVienTuHoSoCuaCon: ["hv-la-2"] }));
    expect(kq.kieu).toBe("CHUA_CO");
  });

  it("[NOI-U-HV-06] con lead khớp HAI học viên khác nhau ⇒ MƠ HỒ, liệt kê ứng viên đã sắp xếp, không chọn", () => {
    const kq = chonHocVienChoDong(voi({ leadChildId: "con-1", hocVienTuGhiDanhCuaCon: ["hv-b"], hocVienTuHoSoCuaCon: ["hv-a"] }));
    expect(kq).toMatchObject({ kieu: "MO_HO", ungVien: ["hv-a", "hv-b"] });
  });
});

describe("[NOI-U-CHO] vòng đời dòng CHỜ — idempotent, lật mở lại chứ không chèn dòng mới", () => {
  const cho = { kieu: "PHAI_CHO", lyDo: "chưa có học viên" } as const;

  it("[NOI-U-CHO-01] chưa có dòng chờ + phải chờ ⇒ tạo mới", () => {
    expect(hanhDongChoChuyenDoi(null, cho)).toEqual({ viec: "TAO_MOI", lyDo: "chưa có học viên" });
  });

  it("[NOI-U-CHO-02] đang mở, cùng lý do ⇒ KHÔNG làm gì (gọi lại không ghi thêm)", () => {
    expect(hanhDongChoChuyenDoi({ trangThai: "OPEN", lyDo: "chưa có học viên", daQuyetDauVan: null }, cho)).toEqual({ viec: "KHONG_LAM_GI" });
  });

  it("[NOI-U-CHO-03] đang mở, lý do đổi (từ chưa có sang mơ hồ) ⇒ chỉ cập nhật lý do", () => {
    expect(hanhDongChoChuyenDoi({ trangThai: "OPEN", lyDo: "cũ", daQuyetDauVan: null }, cho)).toEqual({ viec: "CAP_NHAT_LY_DO", lyDo: "chưa có học viên" });
  });

  it("[NOI-U-CHO-04] đã đóng (xử lý hoặc huỷ) mà phải chờ lại ⇒ MỞ LẠI cùng dòng", () => {
    for (const trangThai of ["DA_XU_LY", "HUY"] as const) {
      expect(hanhDongChoChuyenDoi({ trangThai, lyDo: "cũ", daQuyetDauVan: null }, cho)).toEqual({ viec: "MO_LAI", lyDo: "chưa có học viên" });
    }
  });

  it("[NOI-U-CHO-05] đã có quyền học ⇒ đóng DA_XU_LY nếu đang mở; không có dòng hoặc đã đóng thì không làm gì", () => {
    const co = { kieu: "DA_CO_QUYEN" } as const;
    expect(hanhDongChoChuyenDoi({ trangThai: "OPEN", lyDo: "x", daQuyetDauVan: null }, co)).toMatchObject({ viec: "DONG", trangThai: "DA_XU_LY" });
    expect(hanhDongChoChuyenDoi(null, co)).toEqual({ viec: "KHONG_LAM_GI" });
    expect(hanhDongChoChuyenDoi({ trangThai: "DA_XU_LY", lyDo: "x", daQuyetDauVan: null }, co)).toEqual({ viec: "KHONG_LAM_GI" });
  });

  it("[NOI-U-CHO-06] điều kiện chờ không còn hợp lệ (tiền không còn đủ…) ⇒ đóng HUY kèm lý do của tình huống", () => {
    const hong = { kieu: "KHONG_CON_HOP_LE", lyDo: "tiền không còn đủ" } as const;
    expect(hanhDongChoChuyenDoi({ trangThai: "OPEN", lyDo: "x", daQuyetDauVan: null }, hong)).toEqual({ viec: "DONG", trangThai: "HUY", lyDo: "tiền không còn đủ" });
    expect(hanhDongChoChuyenDoi(null, hong)).toEqual({ viec: "KHONG_LAM_GI" });
    expect(hanhDongChoChuyenDoi({ trangThai: "HUY", lyDo: "x", daQuyetDauVan: null }, hong)).toEqual({ viec: "KHONG_LAM_GI" });
  });
});
