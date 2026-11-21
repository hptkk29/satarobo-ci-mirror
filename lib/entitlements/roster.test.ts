import { describe, expect, it } from "vitest";
import { nhanLyDo, xetBuoiTheoQuyenHoc, type QuyenHocChoRoster } from "./roster";
import { nhanHoaDon, nhanPhamVi, nhanTienDo } from "./nhan-hoa-don";

let n = 0;
function q(o: Partial<QuyenHocChoRoster> = {}): QuyenHocChoRoster {
  return {
    id: `q${++n}`,
    status: "ACTIVE",
    purchaseSessions: 12,
    startLessonOrder: 13,
    endLessonOrder: 24,
    baiBoQua: [],
    freeMakeupSessions: 0,
    graceSessionsGranted: 2,
    consumedSessions: 0,
    graceSessionsUsed: 0,
    ...o,
  };
}

describe("[ROS] học viên có được học bài này theo quyền học", () => {
  it("[ROS-01] KHÔNG có quyền học nào ⇒ LEGACY (người gọi giữ luật cũ) — KHÔNG phải 'không được học'", () => {
    expect(xetBuoiTheoQuyenHoc([], 5)).toEqual({ loai: "LEGACY" });
  });

  it("[ROS-02] bài trong phạm vi của quyền ACTIVE còn buổi ⇒ được", () => {
    const a = q();
    expect(xetBuoiTheoQuyenHoc([a], 13)).toEqual({ loai: "DUOC", nguon: "TRONG_PHAM_VI", quyenHocId: a.id });
    expect(xetBuoiTheoQuyenHoc([a], 24)).toMatchObject({ loai: "DUOC" });
  });

  it("[ROS-03] các bài TRƯỚC phạm vi và SAU phạm vi ⇒ ngoài phạm vi (đối chứng dương: bài 13 được)", () => {
    const a = q();
    expect(xetBuoiTheoQuyenHoc([a], 12)).toEqual({ loai: "KHONG", lyDo: "NGOAI_PHAM_VI" });
    expect(xetBuoiTheoQuyenHoc([a], 30)).toEqual({ loai: "KHONG", lyDo: "NGOAI_PHAM_VI" });
    expect(xetBuoiTheoQuyenHoc([a], 13).loai).toBe("DUOC");
  });

  it("[ROS-04] bài bị bỏ qua vì vượt trần học vượt ⇒ không được, lý do BO_QUA", () => {
    expect(xetBuoiTheoQuyenHoc([q({ baiBoQua: [13] })], 13)).toEqual({ loai: "KHONG", lyDo: "BO_QUA" });
    expect(xetBuoiTheoQuyenHoc([q({ baiBoQua: [13] })], 14).loai).toBe("DUOC");
  });

  it("[ROS-05] ân hạn: chỉ khi EXHAUSTED và còn ân hạn; dùng hết ân hạn thì không", () => {
    const het = { status: "EXHAUSTED" as const, consumedSessions: 12 };
    expect(xetBuoiTheoQuyenHoc([q(het)], 25)).toMatchObject({ loai: "DUOC", nguon: "AN_HAN" });
    expect(xetBuoiTheoQuyenHoc([q({ ...het, graceSessionsUsed: 2 })], 25)).toEqual({ loai: "KHONG", lyDo: "DA_HET_QUYEN" });
    // quyền còn ACTIVE thì bài ở dải ân hạn chưa phải lúc
    expect(xetBuoiTheoQuyenHoc([q()], 25)).toEqual({ loai: "KHONG", lyDo: "DA_HET_QUYEN" });
  });

  it("[ROS-06] ACTIVE nhưng đã dùng hết buổi (dữ liệu lệch) ⇒ không cho học bài trong phạm vi", () => {
    expect(xetBuoiTheoQuyenHoc([q({ consumedSessions: 12 })], 20)).toEqual({ loai: "KHONG", lyDo: "DA_HET_QUYEN" });
  });

  it("[ROS-07] bảo lưu, chưa xếp lớp, giữ chỗ, đã đóng ⇒ không được, mỗi trạng thái một lý do", () => {
    expect(xetBuoiTheoQuyenHoc([q({ status: "FROZEN" })], 14)).toEqual({ loai: "KHONG", lyDo: "DANG_BAO_LUU" });
    expect(xetBuoiTheoQuyenHoc([q({ status: "AWAITING_PLACEMENT" })], 14)).toEqual({ loai: "KHONG", lyDo: "CHUA_XEP_LOP" });
    for (const status of ["SEAT_HOLD", "COMPLETED", "EXPIRED", "STOPPED", "VOIDED"] as const) {
      expect(xetBuoiTheoQuyenHoc([q({ status })], 14), status).toEqual({ loai: "KHONG", lyDo: "DA_HET_QUYEN" });
    }
  });

  it("[ROS-08] nhiều quyền học trên cùng khoá (mua tiếp): bài thuộc quyền SAU vẫn được; quyền cũ đã COMPLETED không cản", () => {
    const cu = q({ status: "COMPLETED", startLessonOrder: 1, endLessonOrder: 12, consumedSessions: 12 });
    const moi = q({ startLessonOrder: 13, endLessonOrder: 24 });
    expect(xetBuoiTheoQuyenHoc([cu, moi], 14)).toMatchObject({ loai: "DUOC", quyenHocId: moi.id });
    expect(xetBuoiTheoQuyenHoc([moi, cu], 14)).toMatchObject({ loai: "DUOC", quyenHocId: moi.id });
  });

  it("[ROS-09] không quyền nào cho học ⇒ chọn lý do theo ưu tiên: bảo lưu > chưa xếp lớp > hết quyền > bỏ qua > ngoài phạm vi", () => {
    const ngoai = q({ startLessonOrder: 25, endLessonOrder: 36 });
    expect(xetBuoiTheoQuyenHoc([ngoai, q({ status: "FROZEN" })], 14)).toEqual({ loai: "KHONG", lyDo: "DANG_BAO_LUU" });
    expect(xetBuoiTheoQuyenHoc([ngoai, q({ status: "AWAITING_PLACEMENT" })], 14)).toEqual({ loai: "KHONG", lyDo: "CHUA_XEP_LOP" });
    expect(xetBuoiTheoQuyenHoc([ngoai, q({ consumedSessions: 12 })], 14)).toEqual({ loai: "KHONG", lyDo: "DA_HET_QUYEN" });
    expect(xetBuoiTheoQuyenHoc([ngoai], 14)).toEqual({ loai: "KHONG", lyDo: "NGOAI_PHAM_VI" });
  });

  it("[ROS-10] nhãn lý do: nói rõ phạm vi khi có, và mỗi lý do có chữ riêng", () => {
    expect(nhanLyDo("NGOAI_PHAM_VI", { start: 13, end: 36 })).toBe("Ngoài phạm vi đăng ký (bài 13–36)");
    expect(nhanLyDo("NGOAI_PHAM_VI")).toBe("Ngoài phạm vi đăng ký");
    const chu = (["NGOAI_PHAM_VI", "BO_QUA", "DANG_BAO_LUU", "CHUA_XEP_LOP", "DA_HET_QUYEN"] as const).map((l) => nhanLyDo(l));
    expect(new Set(chu).size).toBe(5);
  });
});

describe("[NHD] nhãn hoá đơn và cổng phụ huynh (QĐ-52, QĐ-54)", () => {
  it("[NHD-01] ví dụ của yêu cầu: Sata4 24 buổi bài 13–36", () => {
    expect(nhanHoaDon({ tenKhoa: "Sata4", soBuoi: 24, start: 13, end: 36 })).toBe("Học phí Sata4 – 24 buổi (bài 13–36)");
  });

  it("[NHD-02] gói trọn ghi bài 1–48; chưa chốt phạm vi thì KHÔNG đoán bài", () => {
    expect(nhanHoaDon({ tenKhoa: "Sata7", soBuoi: 48, start: 1, end: 48 })).toBe("Học phí Sata7 – 48 buổi (bài 1–48)");
    expect(nhanHoaDon({ tenKhoa: "Sata4", soBuoi: 24 })).toBe("Học phí Sata4 – 24 buổi");
    expect(nhanHoaDon({ tenKhoa: "Sata4", soBuoi: 24, start: null, end: null })).toBe("Học phí Sata4 – 24 buổi");
    expect(nhanHoaDon({ tenKhoa: "Sata4", soBuoi: 24, start: 13 })).toBe("Học phí Sata4 – 24 buổi");
  });

  it("[NHD-03] phạm vi không khớp số buổi ⇒ null (không in một con số có thể sai ra giấy tờ)", () => {
    expect(nhanHoaDon({ tenKhoa: "Sata4", soBuoi: 24, start: 13, end: 35 })).toBeNull();
  });

  it("[NHD-04] đầu vào thiếu ⇒ null", () => {
    expect(nhanHoaDon({ tenKhoa: "  ", soBuoi: 24 })).toBeNull();
    expect(nhanHoaDon({ tenKhoa: "Sata4", soBuoi: 0 })).toBeNull();
    expect(nhanHoaDon({ tenKhoa: "Sata4", soBuoi: 2.5 })).toBeNull();
  });

  it("[NHD-05] tên khoá được cắt khoảng trắng đầu/cuối", () => {
    expect(nhanHoaDon({ tenKhoa: "  Sata4 ", soBuoi: 12, start: 1, end: 12 })).toBe("Học phí Sata4 – 12 buổi (bài 1–12)");
  });

  it("[NHD-06] nhãn phạm vi và tiến độ cho cổng phụ huynh", () => {
    expect(nhanPhamVi(13, 36)).toBe("Bài 13–36");
    expect(nhanPhamVi(5, 5)).toBe("Bài 5");
    expect(nhanTienDo(9, 24, 13, 36)).toBe("9/24 buổi (bài 13–36)");
    expect(nhanTienDo(0, 12)).toBe("0/12 buổi");
  });
});
