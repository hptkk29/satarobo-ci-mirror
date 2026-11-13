import { describe, expect, it } from "vitest";
import { chonGhiDanhChoDong, type DauVaoGhiDanhCuaDong, type GhiDanhUngVien } from "./ghi-danh-cua-dong";
import { hanhDongChoXepLop, LY_DO_DA_XEP_XONG } from "./cho-xep-lop";

const gd = (id: string, o: Partial<GhiDanhUngVien> = {}): GhiDanhUngVien => ({
  id,
  studentId: "hv1",
  courseId: "khoa1",
  classId: "lop1",
  status: "STUDYING",
  deletedAt: null,
  ...o,
});
const vao = (o: Partial<DauVaoGhiDanhCuaDong> = {}): DauVaoGhiDanhCuaDong => ({
  courseId: "khoa1",
  studentId: "hv1",
  enrollmentIdCuaDong: null,
  ghiDanhCuaDong: null,
  leadChildId: null,
  ghiDanhCuaCon: [],
  ...o,
});

describe("[XL-GD] chonGhiDanhChoDong — ghép dòng đơn với ghi danh, KHÔNG đoán", () => {
  it("[XL-GD-01] dòng gắn thẳng enrollmentId, ghi danh sống + đúng khoá + đúng học viên ⇒ CO (nguồn DONG_DON)", () => {
    const g = gd("g1");
    expect(chonGhiDanhChoDong(vao({ enrollmentIdCuaDong: "g1", ghiDanhCuaDong: g }))).toEqual({ kieu: "CO", ghiDanh: g, nguon: "DONG_DON" });
  });

  it.each([
    ["không đọc được hàng ghi danh", null, /không còn tồn tại/],
    ["đã xoá mềm", gd("g1", { deletedAt: new Date("2026-10-01") }), /không còn hiệu lực/],
    ["đã rút (WITHDREW)", gd("g1", { status: "WITHDREW" }), /không còn hiệu lực/],
    ["đang bảo lưu (PAUSED)", gd("g1", { status: "PAUSED" }), /không còn hiệu lực/],
    ["khác khoá", gd("g1", { courseId: "khoa2" }), /khoá khác/],
    ["khác học viên của quyền học", gd("g1", { studentId: "hv2" }), /học viên khác/],
  ] as const)("[XL-GD-02] dòng gắn enrollmentId nhưng ghi danh %s ⇒ CHUA_CO, canXem=true (người vận hành phải xem), KHÔNG rơi xuống cầu nối con lead", (_t, g, re) => {
    const kq = chonGhiDanhChoDong(vao({ enrollmentIdCuaDong: "g1", ghiDanhCuaDong: g, leadChildId: "lc1", ghiDanhCuaCon: [gd("g9", { leadChildId: "lc1" } as never)] }));
    expect(kq).toMatchObject({ kieu: "CHUA_CO", canXem: true });
    expect((kq as { lyDo: string }).lyDo).toMatch(re);
  });

  it("[XL-GD-03] không có enrollmentId, con lead khớp ĐÚNG MỘT ghi danh sống cùng khoá + cùng học viên ⇒ CO (nguồn CON_LEAD)", () => {
    const g = gd("g2");
    expect(chonGhiDanhChoDong(vao({ leadChildId: "lc1", ghiDanhCuaCon: [g, gd("g3", { status: "WITHDREW" }), gd("g4", { courseId: "khoa2" }), gd("g5", { studentId: "hv2" })] }))).toEqual({
      kieu: "CO",
      ghiDanh: g,
      nguon: "CON_LEAD",
    });
  });

  it("[XL-GD-04] con lead khớp HAI ghi danh sống cùng khoá ⇒ MO_HO, liệt kê ứng viên đã sắp xếp — KHÔNG chọn cái nào", () => {
    const kq = chonGhiDanhChoDong(vao({ leadChildId: "lc1", ghiDanhCuaCon: [gd("g9"), gd("g2", { classId: "lop2" })] }));
    expect(kq).toMatchObject({ kieu: "MO_HO", ungVien: ["g2", "g9"] });
    expect((kq as { lyDo: string }).lyDo).toMatch(/khớp 2 ghi danh/);
  });

  it("[XL-GD-05] chưa có liên kết nào ⇒ CHUA_CO với canXem=FALSE (chờ bình thường, không mở hàng đợi): không enrollmentId + không leadChildId; hoặc có con lead nhưng chưa ghi danh", () => {
    expect(chonGhiDanhChoDong(vao())).toMatchObject({ kieu: "CHUA_CO", canXem: false });
    expect(chonGhiDanhChoDong(vao({ leadChildId: "lc1" }))).toMatchObject({ kieu: "CHUA_CO", canXem: false });
  });

  it("[XL-GD-06] chưa có quyền học (studentId=null) ⇒ không lọc theo học viên, vẫn lọc sống + khoá", () => {
    expect(chonGhiDanhChoDong(vao({ studentId: null, leadChildId: "lc1", ghiDanhCuaCon: [gd("g2", { studentId: "hv7" })] }))).toMatchObject({ kieu: "CO", ghiDanh: { id: "g2" } });
    expect(chonGhiDanhChoDong(vao({ studentId: null, leadChildId: "lc1", ghiDanhCuaCon: [gd("g2", { courseId: "khoa2" })] }))).toMatchObject({ kieu: "CHUA_CO" });
  });

  it("[XL-GD-07] KHÔNG BAO GIỜ ghép theo (học viên, khoá) một mình: học viên có ghi danh cùng khoá nhưng dòng không có cầu nối ⇒ không chọn", () => {
    // Mua tiếp: hai quyền học cùng (học viên, khoá) sẽ cùng nhận MỘT ghi danh nếu ghép theo cặp đó.
    expect(chonGhiDanhChoDong(vao({ ghiDanhCuaCon: [gd("g1")] }))).toMatchObject({ kieu: "CHUA_CO" });
  });
});

describe("[XL-CH] hanhDongChoXepLop — vòng đời dòng CHO_XEP_LOP", () => {
  const MO = { trangThai: "OPEN", lyDo: "lý do A", daQuyetDauVan: null } as const;
  it("[XL-CH-01] PHAI_CHO: chưa có dòng ⇒ TAO_MOI; dòng đã đóng ⇒ MO_LAI; dòng mở cùng lý do ⇒ KHÔNG_LÀM_GÌ; khác lý do ⇒ CAP_NHAT_LY_DO", () => {
    expect(hanhDongChoXepLop(null, { kieu: "PHAI_CHO", lyDo: "x" })).toEqual({ viec: "TAO_MOI", lyDo: "x" });
    expect(hanhDongChoXepLop({ trangThai: "DA_XU_LY", lyDo: "cũ", daQuyetDauVan: null }, { kieu: "PHAI_CHO", lyDo: "x" })).toEqual({ viec: "MO_LAI", lyDo: "x" });
    expect(hanhDongChoXepLop({ trangThai: "HUY", lyDo: "cũ", daQuyetDauVan: null }, { kieu: "PHAI_CHO", lyDo: "x" })).toEqual({ viec: "MO_LAI", lyDo: "x" });
    expect(hanhDongChoXepLop(MO, { kieu: "PHAI_CHO", lyDo: "lý do A" })).toEqual({ viec: "KHONG_LAM_GI" });
    expect(hanhDongChoXepLop(MO, { kieu: "PHAI_CHO", lyDo: "lý do B" })).toEqual({ viec: "CAP_NHAT_LY_DO", lyDo: "lý do B" });
  });

  it("[XL-CH-02] DA_XEP_XONG đóng DA_XU_LY (không phải HUY) với lời đúng nghĩa; không có dòng mở ⇒ KHÔNG_LÀM_GÌ", () => {
    expect(hanhDongChoXepLop(MO, { kieu: "DA_XEP_XONG" })).toEqual({ viec: "DONG", trangThai: "DA_XU_LY", lyDo: LY_DO_DA_XEP_XONG });
    expect(LY_DO_DA_XEP_XONG).not.toMatch(/học viên — quyền học đã được cấp/);
    expect(hanhDongChoXepLop(null, { kieu: "DA_XEP_XONG" })).toEqual({ viec: "KHONG_LAM_GI" });
    expect(hanhDongChoXepLop({ trangThai: "DA_XU_LY", lyDo: "x", daQuyetDauVan: null }, { kieu: "DA_XEP_XONG" })).toEqual({ viec: "KHONG_LAM_GI" });
  });

  it("[XL-CH-03] KHONG_CON_HOP_LE đóng HUY kèm lý do của người gọi; dòng đã đóng / chưa có ⇒ KHÔNG_LÀM_GÌ", () => {
    expect(hanhDongChoXepLop(MO, { kieu: "KHONG_CON_HOP_LE", lyDo: "đơn huỷ" })).toEqual({ viec: "DONG", trangThai: "HUY", lyDo: "đơn huỷ" });
    expect(hanhDongChoXepLop(null, { kieu: "KHONG_CON_HOP_LE", lyDo: "x" })).toEqual({ viec: "KHONG_LAM_GI" });
    expect(hanhDongChoXepLop({ trangThai: "HUY", lyDo: "x", daQuyetDauVan: null }, { kieu: "KHONG_CON_HOP_LE", lyDo: "y" })).toEqual({ viec: "KHONG_LAM_GI" });
  });
});
