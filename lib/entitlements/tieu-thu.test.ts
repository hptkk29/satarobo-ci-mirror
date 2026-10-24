import { describe, expect, it } from "vitest";
import {
  baiBoQuaTuSo,
  chuyenAnHanSangQuyenMoi,
  phanLoaiBai,
  quyetDinhGhiNhan,
  tinhAnHanDaDung,
  tinhConLai,
  tinhDaTieuThu,
  type DongSoCai,
  type QuyenHocTomTat,
} from "./tieu-thu";
import {
  chuyenTrangThai,
  coTheBaoLuu,
  laTrangThaiCuoi,
  LoiChuyenTrangThai,
  type SuKienQuyenHoc,
  type TrangThaiQuyenHoc,
} from "./trang-thai";
import { LoiHoanTien, tinhHoanTien } from "./hoan-tien";
import { chungChiCanQuanLyDuyet, xetChungChi } from "./chung-chi";

const NGAY = new Date("2026-10-01T00:00:00Z");
const dong = (lessonOrder: number, source: DongSoCai["source"], voided = false): DongSoCai => ({
  lessonOrder,
  source,
  voidedAt: voided ? NGAY : null,
});
// Mua 12 (13–24), bỏ qua bài 13 (vượt trần), ân hạn 2 buổi (25–26).
const Q: QuyenHocTomTat = {
  purchaseSessions: 12,
  startLessonOrder: 13,
  endLessonOrder: 24,
  baiBoQua: [13],
  freeMakeupSessions: 0,
  graceSessionsGranted: 2,
};

describe("[TTH] sổ cái 'đã học' (BA §2.5)", () => {
  it("[TTH-01] đếm bỏ dòng vô hiệu, bỏ GRACE, và không đếm đôi cùng một bài", () => {
    const soCai = [dong(14, "CLASS"), dong(15, "MAKEUP"), dong(16, "CLASS", true), dong(25, "GRACE"), dong(14, "CATCH_UP")];
    expect(tinhDaTieuThu(soCai)).toBe(2); // 14, 15 — 16 bị vô hiệu, 25 là ân hạn, 14 trùng
    expect(tinhAnHanDaDung(soCai)).toBe(1);
  });

  it("[TTH-02] còn lại = mua − đã học − bỏ qua (SUY RA, không lưu)", () => {
    expect(tinhConLai(Q, 0)).toBe(11);
    expect(tinhConLai(Q, 5)).toBe(6);
  });

  it("[TTH-03] sửa điểm danh vắng → có mặt → vắng không làm lệch: đếm lại luôn ra đúng", () => {
    const co = [dong(14, "CLASS")];
    const huy = [dong(14, "CLASS", true)];
    expect(tinhDaTieuThu(co)).toBe(1);
    expect(tinhDaTieuThu(huy)).toBe(0);
    expect(tinhDaTieuThu(co)).toBe(1); // lặp lại vẫn 1, không phải 2
  });

  it("[TTH-04] phân loại bài: trong phạm vi / bỏ qua / ân hạn / ngoài phạm vi", () => {
    expect(phanLoaiBai(Q, 12)).toBe("NGOAI_PHAM_VI");
    expect(phanLoaiBai(Q, 13)).toBe("BO_QUA");
    expect(phanLoaiBai(Q, 14)).toBe("TRONG_PHAM_VI");
    expect(phanLoaiBai(Q, 24)).toBe("TRONG_PHAM_VI");
    expect(phanLoaiBai(Q, 25)).toBe("AN_HAN");
    expect(phanLoaiBai(Q, 26)).toBe("AN_HAN");
    expect(phanLoaiBai(Q, 27)).toBe("NGOAI_PHAM_VI");
  });

  it("[TTH-05] ghi nhận: bài trong phạm vi ⇒ tiêu thụ; trùng ⇒ DA_CO (idempotent)", () => {
    expect(quyetDinhGhiNhan(Q, [], 14, "CLASS")).toEqual({ loai: "TIEU_THU", nguon: "CLASS", kichHoatLai: false });
    expect(quyetDinhGhiNhan(Q, [dong(14, "CLASS")], 14, "CLASS")).toEqual({ loai: "DA_CO" });
  });

  it("[TTH-06] bài có dòng bị vô hiệu ⇒ BẬT LẠI dòng cũ, không chèn dòng mới (khoá duy nhất)", () => {
    expect(quyetDinhGhiNhan(Q, [dong(14, "CLASS", true)], 14, "MAKEUP")).toEqual({
      loai: "TIEU_THU",
      nguon: "MAKEUP",
      kichHoatLai: true,
    });
  });

  it("[TTH-07] bài ngoài phạm vi và bài bị bỏ qua bị từ chối — KHÔNG tính vào quyền học", () => {
    expect(quyetDinhGhiNhan(Q, [], 12, "CLASS")).toEqual({ loai: "TU_CHOI", lyDo: "NGOAI_PHAM_VI" });
    expect(quyetDinhGhiNhan(Q, [], 13, "CLASS")).toEqual({ loai: "TU_CHOI", lyDo: "BO_QUA" });
    expect(quyetDinhGhiNhan(Q, [], 40, "CLASS")).toEqual({ loai: "TU_CHOI", lyDo: "NGOAI_PHAM_VI" });
  });

  it("[TTH-08] hết buổi ⇒ bài kế là ân hạn; ân hạn dùng tối đa số buổi được cấp", () => {
    const het = Array.from({ length: 11 }, (_, i) => dong(14 + i, "CLASS")); // 14..24 = mua 12 − bỏ qua 1
    expect(tinhConLai(Q, tinhDaTieuThu(het))).toBe(0);
    expect(quyetDinhGhiNhan(Q, het, 24, "CLASS")).toEqual({ loai: "DA_CO" });
    expect(quyetDinhGhiNhan(Q, het, 25, "CLASS")).toEqual({ loai: "AN_HAN", kichHoatLai: false });
    expect(quyetDinhGhiNhan(Q, [...het, dong(25, "GRACE"), dong(26, "GRACE")], 26, "CLASS")).toEqual({ loai: "DA_CO" });

    const q1 = { ...Q, graceSessionsGranted: 1 };
    expect(quyetDinhGhiNhan(q1, [...het, dong(25, "GRACE")], 26, "CLASS")).toEqual({
      loai: "TU_CHOI",
      lyDo: "NGOAI_PHAM_VI",
    });
    // dòng ân hạn bị vô hiệu thì không tính là đã dùng ⇒ bật lại được
    expect(quyetDinhGhiNhan(Q, [...het, dong(25, "GRACE"), dong(26, "GRACE", true)], 26, "CLASS")).toEqual({
      loai: "AN_HAN",
      kichHoatLai: true,
    });
  });

  it("[TTH-09] hết ân hạn: bài nằm trong dải ân hạn nhưng số buổi ân hạn đã dùng đủ ⇒ HET_AN_HAN", () => {
    const het = Array.from({ length: 11 }, (_, i) => dong(14 + i, "CLASS"));
    const q = { ...Q, graceSessionsGranted: 3 };
    // 25, 26 đã dùng; còn bài 27 thuộc dải ân hạn nhưng bị chặn bởi số buổi đã dùng = 3?
    expect(quyetDinhGhiNhan(q, [...het, dong(25, "GRACE"), dong(26, "GRACE"), dong(27, "GRACE")], 28, "CLASS")).toEqual({
      loai: "TU_CHOI",
      lyDo: "NGOAI_PHAM_VI",
    });
    // dữ liệu lệch có chủ đích: đã có 3 dòng GRACE ở bài khác nhưng dải ân hạn chỉ cấp 3 ⇒ bài thứ 4 không có
    const lech = [...het, dong(90, "GRACE"), dong(91, "GRACE"), dong(92, "GRACE")];
    expect(quyetDinhGhiNhan(q, lech, 25, "CLASS")).toEqual({ loai: "TU_CHOI", lyDo: "HET_AN_HAN" });
  });

  it("[TTH-10] cạn buổi nhưng bài còn trong phạm vi (dữ liệu hỏng) ⇒ HET_BUOI, không ghi quá số đã mua", () => {
    const q = { purchaseSessions: 3, startLessonOrder: 13, endLessonOrder: 16, baiBoQua: [] as number[], freeMakeupSessions: 0, graceSessionsGranted: 0 };
    const ba = [dong(13, "CLASS"), dong(14, "CLASS"), dong(15, "CLASS")];
    expect(tinhConLai(q, tinhDaTieuThu(ba))).toBe(0);
    expect(quyetDinhGhiNhan(q, ba, 16, "CLASS")).toEqual({ loai: "TU_CHOI", lyDo: "HET_BUOI" });
  });
});

describe("[TTH] bài bỏ qua suy từ số đếm", () => {
  it("[TTH-30] bỏ qua là TIỀN TỐ liên tục của phạm vi, bắt đầu ở start", () => {
    expect(baiBoQuaTuSo(13, 0)).toEqual([]);
    expect(baiBoQuaTuSo(13, 1)).toEqual([13]);
    expect(baiBoQuaTuSo(13, 7)).toEqual([13, 14, 15, 16, 17, 18, 19]);
  });
});

describe("[TTH] chuyển ân hạn sang quyền mới theo R1 (BA §2.4)", () => {
  it("[TTH-20] dòng GRACE rơi vào phạm vi mới đổi nguồn sang CLASS và vào consumed của quyền mới", () => {
    const cu = [dong(14, "CLASS"), dong(25, "GRACE"), dong(26, "GRACE")];
    const { chuyen, giuLai } = chuyenAnHanSangQuyenMoi(cu, { startLessonOrder: 25, endLessonOrder: 36 }, "CLASS");
    expect(chuyen.map((d) => [d.lessonOrder, d.source])).toEqual([
      [25, "CLASS"],
      [26, "CLASS"],
    ]);
    expect(giuLai.map((d) => d.lessonOrder)).toEqual([14]);
    // Thiếu bước đổi nguồn thì consumed(quyền mới) = 0 và R1 mất tác dụng
    expect(tinhDaTieuThu(chuyen)).toBe(2);
    expect(tinhDaTieuThu(cu.filter((d) => d.source === "GRACE"))).toBe(0);
  });

  it("[TTH-21] dòng GRACE ngoài phạm vi mới, hoặc đã vô hiệu, ở lại quyền cũ", () => {
    const cu = [dong(25, "GRACE"), dong(26, "GRACE", true), dong(30, "GRACE")];
    const { chuyen, giuLai } = chuyenAnHanSangQuyenMoi(cu, { startLessonOrder: 25, endLessonOrder: 28 }, "MAKEUP");
    expect(chuyen.map((d) => d.lessonOrder)).toEqual([25]);
    expect(giuLai.map((d) => d.lessonOrder)).toEqual([26, 30]);
  });
});

describe("[TTT] máy trạng thái quyền học (BA §2.4)", () => {
  it("[TTT-01] đường chính: xếp lớp → hết buổi → hết ân hạn → mua tiếp", () => {
    let t: TrangThaiQuyenHoc = "AWAITING_PLACEMENT";
    for (const [sk, den] of [
      ["XEP_LOP", "ACTIVE"],
      ["HET_BUOI", "EXHAUSTED"],
      ["HET_AN_HAN", "SEAT_HOLD"],
      ["MUA_TIEP", "COMPLETED"],
    ] as const) {
      t = chuyenTrangThai(t, sk);
      expect(t).toBe(den);
    }
    expect(laTrangThaiCuoi(t)).toBe(true);
  });

  it("[TTT-02] bảo lưu rồi phục học quay về ĐÚNG trạng thái trước đó", () => {
    expect(chuyenTrangThai("FROZEN", "PHUC_HOC", "ACTIVE")).toBe("ACTIVE");
    expect(chuyenTrangThai("FROZEN", "PHUC_HOC", "AWAITING_PLACEMENT")).toBe("AWAITING_PLACEMENT");
    expect(() => chuyenTrangThai("FROZEN", "PHUC_HOC", null)).toThrow(LoiChuyenTrangThai);
    expect(() => chuyenTrangThai("FROZEN", "PHUC_HOC", "EXHAUSTED")).toThrow(LoiChuyenTrangThai);
    expect(() => chuyenTrangThai("ACTIVE", "PHUC_HOC", "ACTIVE")).toThrow(LoiChuyenTrangThai);
  });

  it("[TTT-03] không bảo lưu khi đã hết buổi / giữ chỗ / ở trạng thái cuối (MM-20)", () => {
    expect(coTheBaoLuu("ACTIVE")).toBe(true);
    expect(coTheBaoLuu("AWAITING_PLACEMENT")).toBe(true);
    for (const t of ["EXHAUSTED", "SEAT_HOLD", "FROZEN", "COMPLETED", "EXPIRED", "STOPPED", "VOIDED"] as const) {
      expect(coTheBaoLuu(t)).toBe(false);
    }
  });

  it("[TTT-04] trạng thái cuối không nhận sự kiện nào", () => {
    const sk: SuKienQuyenHoc[] = [
      "XEP_LOP",
      "BAO_LUU",
      "PHUC_HOC",
      "HET_BUOI",
      "HET_AN_HAN",
      "MUA_TIEP",
      "HET_GIU_CHO",
      "DUNG_HOC",
      "HUY_HOAN",
      "MO_LAI",
    ];
    for (const t of ["COMPLETED", "EXPIRED", "STOPPED", "VOIDED"] as const) {
      expect(laTrangThaiCuoi(t)).toBe(true);
      for (const s of sk) expect(() => chuyenTrangThai(t, s, "ACTIVE")).toThrow(LoiChuyenTrangThai);
    }
  });

  it("[TTT-06] MO_LAI chỉ từ EXHAUSTED về ACTIVE — không mở lại được quyền đã SEAT_HOLD/đóng", () => {
    expect(chuyenTrangThai("EXHAUSTED", "MO_LAI")).toBe("ACTIVE");
    for (const t of ["AWAITING_PLACEMENT", "ACTIVE", "FROZEN", "SEAT_HOLD", "COMPLETED", "EXPIRED", "STOPPED", "VOIDED"] as const) {
      expect(() => chuyenTrangThai(t, "MO_LAI"), t).toThrow(LoiChuyenTrangThai);
    }
  });

  it("[TTT-05] huỷ/hoàn chỉ hợp lệ trước khi học; dừng học không từ chỗ chưa xếp lớp", () => {
    expect(chuyenTrangThai("AWAITING_PLACEMENT", "HUY_HOAN")).toBe("VOIDED");
    expect(() => chuyenTrangThai("ACTIVE", "HUY_HOAN")).toThrow(LoiChuyenTrangThai);
    expect(() => chuyenTrangThai("AWAITING_PLACEMENT", "DUNG_HOC")).toThrow(LoiChuyenTrangThai);
    expect(chuyenTrangThai("ACTIVE", "DUNG_HOC")).toBe("STOPPED");
    expect(chuyenTrangThai("FROZEN", "DUNG_HOC")).toBe("STOPPED");
    expect(chuyenTrangThai("EXHAUSTED", "DUNG_HOC")).toBe("STOPPED");
  });
});

describe("[HTI] hoàn tiền theo lần mua (BA §7, QĐ-47/48)", () => {
  it("[HTI-01] 7a: Sata4 48 buổi đóng 9.792.000đ, học 17 ⇒ hoàn 31 × 204.000 = 6.324.000", () => {
    expect(tinhHoanTien({ purchaseSessions: 48, daTieuThu: 17, soBaiBoQua: 0, netAmount: 9_792_000 })).toEqual({
      soBuoiChuaHoc: 31,
      soTienHoan: 6_324_000,
    });
  });

  it("[HTI-02] 7b: Sata4 24 buổi đóng 5.472.000đ, học 9 ⇒ hoàn 3.420.000", () => {
    expect(tinhHoanTien({ purchaseSessions: 24, daTieuThu: 9, soBaiBoQua: 0, netAmount: 5_472_000 }).soTienHoan).toBe(
      3_420_000,
    );
  });

  it("[HTI-03] 7c: đếm theo BÀI (17) ⇒ 6.324.000; đếm theo BUỔI (13) ⇒ 7.140.000 — chênh 816.000", () => {
    const theoBai = tinhHoanTien({ purchaseSessions: 48, daTieuThu: 17, soBaiBoQua: 0, netAmount: 9_792_000 }).soTienHoan;
    const theoBuoi = tinhHoanTien({ purchaseSessions: 48, daTieuThu: 13, soBaiBoQua: 0, netAmount: 9_792_000 }).soTienHoan;
    expect([theoBai, theoBuoi, theoBuoi - theoBai]).toEqual([6_324_000, 7_140_000, 816_000]);
  });

  it("[HTI-04] bài bỏ qua: mặc định KHÔNG hoàn (trừ khỏi số chưa học); bật tham số thì hoàn", () => {
    const g = { purchaseSessions: 12, daTieuThu: 4, soBaiBoQua: 1, netAmount: 2_400_000 };
    expect(tinhHoanTien(g).soBuoiChuaHoc).toBe(7);
    expect(tinhHoanTien({ ...g, baiBoQuaCoHoan: true }).soBuoiChuaHoc).toBe(8);
  });

  it("[HTI-05] không chia hết ⇒ từ chối REFUND_NOT_INTEGER, KHÔNG làm tròn (QĐ-34)", () => {
    let ma = "";
    try {
      tinhHoanTien({ purchaseSessions: 7, daTieuThu: 3, soBaiBoQua: 0, netAmount: 1_000_000 });
    } catch (e) {
      ma = e instanceof LoiHoanTien ? e.ma : "KHAC";
    }
    expect(ma).toBe("REFUND_NOT_INTEGER");
  });

  it("[HTI-06] học hết ⇒ hoàn 0; học + bỏ qua vượt số mua ⇒ từ chối; đầu vào rác ⇒ từ chối", () => {
    expect(tinhHoanTien({ purchaseSessions: 12, daTieuThu: 12, soBaiBoQua: 0, netAmount: 2_400_000 }).soTienHoan).toBe(0);
    expect(() => tinhHoanTien({ purchaseSessions: 12, daTieuThu: 12, soBaiBoQua: 1, netAmount: 2_400_000 })).toThrow(LoiHoanTien);
    expect(() => tinhHoanTien({ purchaseSessions: 0, daTieuThu: 0, soBaiBoQua: 0, netAmount: 1 })).toThrow(LoiHoanTien);
    expect(() => tinhHoanTien({ purchaseSessions: 12, daTieuThu: -1, soBaiBoQua: 0, netAmount: 1 })).toThrow(LoiHoanTien);
  });
});

describe("[CCH] chứng chỉ theo loại mua (QĐ-50)", () => {
  it("[CCH-01] gói trọn hoàn tất ⇒ được cấp, không cần duyệt", () => {
    expect(chungChiCanQuanLyDuyet("FULL")).toBe(false);
    expect(xetChungChi({ loai: "FULL", hoanTatPhamVi: true, quanLyDaDuyet: false })).toEqual({ duoc: true });
  });

  it("[CCH-02] gói không trọn: hoàn tất mà chưa duyệt ⇒ KHÔNG cấp", () => {
    for (const loai of ["MILESTONE", "CUSTOM"] as const) {
      expect(chungChiCanQuanLyDuyet(loai)).toBe(true);
      expect(xetChungChi({ loai, hoanTatPhamVi: true, quanLyDaDuyet: false })).toEqual({
        duoc: false,
        lyDo: "CHUA_DUOC_DUYET",
      });
      expect(xetChungChi({ loai, hoanTatPhamVi: true, quanLyDaDuyet: true })).toEqual({ duoc: true });
    }
  });

  it("[CCH-03] chưa hoàn tất thì duyệt rồi cũng không cấp (fail-closed)", () => {
    expect(xetChungChi({ loai: "MILESTONE", hoanTatPhamVi: false, quanLyDaDuyet: true })).toEqual({
      duoc: false,
      lyDo: "CHUA_HOAN_TAT",
    });
  });
});
