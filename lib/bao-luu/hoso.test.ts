// lib/bao-luu/hoso.test.ts — luật LẬP / DUYỆT hồ sơ bảo lưu (THUẦN). PHIÊN 3.
//
// Mọi ngày TUYỆT ĐỐI, `now` luôn được TRUYỀN (luật 19). Vitest chạy TZ=UTC còn các hàm đọc ngày theo lịch VN, nên
// ca dùng giờ gần nửa đêm VN để lộ lỗi nếu ai đổi sang `getDate()` của máy.
import { describe, it, expect } from "vitest";
import {
  chanDuyetVeNo,
  chanTuDuyet,
  kiemLapHoSo,
  soNgayLich,
  soNgayQuaHanLonNhat,
  tinhNgayBatDau,
  type BoiCanhLap,
  type ChinhSach,
  type DauVaoLap,
} from "./hoso";

/** 10:00 sáng thứ Tư 07/10/2026 giờ VN. */
const NOW = new Date("2026-10-07T03:00:00Z");
const CS: ChinhSach = {
  maxMonths: 3, minDays: 0, maxPerEnrollment: 1, medicalProofDays: 30, backdateMaxSessions: 2,
  maxOverdueDebtDays: 7, extendTimes: 1, extendMaxMonths: 1,
};
const BOI_CANH: BoiCanhLap = {
  now: NOW, khoaChoPhep: true, trangThaiGhiDanh: "ACTIVE", daXoa: false, soLanDaDung: 0, coHoSoMo: false, chinhSach: CS,
};
const DAU_VAO: DauVaoLap = {
  reasonCode: "FAMILY", reasonNote: "", expectedReturnDate: null, firstAbsentDate: null, coDon: true, soMinhChung: 0, vuotTran: null,
};
const lap = (v: Partial<DauVaoLap> = {}, c: Partial<BoiCanhLap> = {}) => kiemLapHoSo({ ...DAU_VAO, ...v }, { ...BOI_CANH, ...c });
const loi = (r: ReturnType<typeof lap>) => (r.ok ? [] : r.loi);

describe("[BL3-LAP] kiemLapHoSo", () => {
  it("[BL3-LAP-01] đủ điều kiện ⇒ ok; hạn tiêu chuẩn dự kiến = hôm nay + maxMonths tháng lịch", () => {
    const r = lap();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.standardEndDateDuKien.toISOString()).toBe("2027-01-06T17:00:00.000Z"); // 07/01/2027 00:00 VN
  });

  it("[BL3-LAP-02] BR-02: khoá tắt allowPause ⇒ chặn (TC-21)", () => {
    expect(loi(lap({}, { khoaChoPhep: false })).join(" ")).toMatch(/không áp dụng bảo lưu/);
  });

  it("[BL3-LAP-03] BR-03: chỉ ACTIVE/STUDYING được; PENDING (chưa xếp lớp), CONFIRMED (chưa bắt đầu), PAUSED, COMPLETED… bị chặn", () => {
    for (const t of ["ACTIVE", "STUDYING"]) expect(lap({}, { trangThaiGhiDanh: t }).ok, t).toBe(true);
    for (const t of ["PENDING", "CONFIRMED", "PAUSED", "COMPLETED", "WITHDREW", "TRANSFERRED", "CANCELLED"]) {
      expect(lap({}, { trangThaiGhiDanh: t }).ok, t).toBe(false);
    }
    expect(loi(lap({}, { daXoa: true })).join(" ")).toMatch(/đã bị xoá/);
  });

  it("[BL3-LAP-04] BR-07: thiếu đơn ⇒ chặn (TC-02)", () => {
    expect(loi(lap({ coDon: false })).join(" ")).toMatch(/đơn bảo lưu đã ký/);
  });

  it("[BL3-LAP-05] BR-08: đã đủ maxPerEnrollment lần ⇒ chặn; chưa đủ ⇒ qua (TC-19)", () => {
    expect(lap({}, { soLanDaDung: 1 }).ok).toBe(false);
    expect(lap({}, { soLanDaDung: 0 }).ok).toBe(true);
    expect(lap({}, { soLanDaDung: 1, chinhSach: { ...CS, maxPerEnrollment: 2 } }).ok).toBe(true);
  });

  it("[BL3-LAP-06] đang có hồ sơ mở ⇒ chặn (một ghi danh một hồ sơ mở)", () => {
    expect(loi(lap({}, { coHoSoMo: true })).join(" ")).toMatch(/đang có hồ sơ bảo lưu còn hiệu lực/);
  });

  it("[BL3-LAP-07] BR-04: bắt buộc lý do; 'Khác' bắt buộc ghi chú ≥5 ký tự", () => {
    expect(lap({ reasonCode: null }).ok).toBe(false);
    expect(lap({ reasonCode: "OTHER", reasonNote: "" }).ok).toBe(false);
    expect(lap({ reasonCode: "OTHER", reasonNote: "abcd" }).ok).toBe(false);
    expect(lap({ reasonCode: "OTHER", reasonNote: "đi công tác dài" }).ok).toBe(true);
    expect(lap({ reasonCode: "FAMILY", reasonNote: "" }).ok).toBe(true);
  });

  it("[BL3-LAP-08] BR-05: ốm đau > 30 ngày bắt buộc minh chứng; ≤ 30 ngày không; có minh chứng thì qua", () => {
    const ngay = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
    expect(lap({ reasonCode: "ILLNESS", expectedReturnDate: ngay(31) }).ok).toBe(false);
    expect(lap({ reasonCode: "ILLNESS", expectedReturnDate: ngay(30) }).ok).toBe(true); // đúng bằng thì không bắt buộc
    expect(lap({ reasonCode: "ILLNESS", expectedReturnDate: ngay(31), soMinhChung: 1 }).ok).toBe(true);
    // Lý do khác ốm đau không bị đòi minh chứng dù dài:
    expect(lap({ reasonCode: "FAMILY", expectedReturnDate: ngay(80) }).ok).toBe(true);
  });

  it("[BL3-LAP-09] BR-05 khi KHÔNG khai ngày quay lại: coi là dài ⇒ đòi minh chứng (TODO Q-medical-no-date)", () => {
    expect(lap({ reasonCode: "ILLNESS", expectedReturnDate: null }).ok).toBe(false);
    expect(lap({ reasonCode: "ILLNESS", expectedReturnDate: null, soMinhChung: 2 }).ok).toBe(true);
  });

  it("[BL3-LAP-10] BR-12: ngày quay lại KHÔNG bắt buộc; khai thì phải nằm trong trần maxMonths (tháng lịch)", () => {
    expect(lap({ expectedReturnDate: null }).ok).toBe(true);
    // 07/10 + 3 tháng = 07/01/2027
    expect(lap({ expectedReturnDate: new Date("2027-01-07T00:00:00Z") }).ok).toBe(true);
    const vuot = lap({ expectedReturnDate: new Date("2027-01-08T00:00:00Z") });
    expect(vuot.ok).toBe(false);
    expect(loi(vuot).join(" ")).toMatch(/ngoại lệ/);
  });

  it("[BL3-LAP-11] vượt trần chỉ qua được với vuotTran có lý do ≥10 ký tự (đường bao-luu:exception)", () => {
    const d = new Date("2027-02-01T00:00:00Z");
    expect(lap({ expectedReturnDate: d, vuotTran: { lyDo: "ngắn" } }).ok).toBe(false);
    expect(lap({ expectedReturnDate: d, vuotTran: { lyDo: "Bé phẫu thuật, bác sĩ hẹn tái khám tháng 2" } }).ok).toBe(true);
  });

  it("[BL3-LAP-12] ngày quay lại không sau hôm nay ⇒ chặn; minDays: ngắn hơn tối thiểu ⇒ chặn", () => {
    expect(lap({ expectedReturnDate: new Date("2026-10-07T00:00:00Z") }).ok).toBe(false);
    const cs = { ...CS, minDays: 30 };
    expect(lap({ expectedReturnDate: new Date("2026-10-20T00:00:00Z") }, { chinhSach: cs }).ok).toBe(false);
    expect(lap({ expectedReturnDate: new Date("2026-11-06T00:00:00Z") }, { chinhSach: cs }).ok).toBe(true);
    // minDays=0 (mặc định) = không quy định:
    expect(lap({ expectedReturnDate: new Date("2026-10-08T00:00:00Z") }).ok).toBe(true);
  });

  it("[BL3-LAP-13] buổi nghỉ đầu tiên ở tương lai ⇒ chặn", () => {
    expect(lap({ firstAbsentDate: new Date("2026-10-09T00:00:00Z") }).ok).toBe(false);
    expect(lap({ firstAbsentDate: new Date("2026-10-05T00:00:00Z") }).ok).toBe(true);
  });

  it("[BL3-LAP-14] thu thập MỌI lỗi một lượt (không dừng ở lỗi đầu)", () => {
    const r = lap({ coDon: false, reasonCode: null }, { khoaChoPhep: false, soLanDaDung: 1 });
    expect(loi(r).length).toBeGreaterThanOrEqual(4);
  });
});

describe("[BL3-MC] maker–checker", () => {
  it("[BL3-MC-01] người lập KHÔNG duyệt hồ sơ của chính mình (TC-01); người khác duyệt được", () => {
    expect(chanTuDuyet("u1", "u1")).toMatch(/không được duyệt/);
    expect(chanTuDuyet("u2", "u1")).toBeNull();
  });
  it("[BL3-MC-02] hồ sơ không có người lập (hệ thống/di trú) ⇒ không ai là 'chính mình'", () => {
    expect(chanTuDuyet("u1", null)).toBeNull();
    expect(chanTuDuyet("u1", undefined)).toBeNull();
  });
});

describe("[BL3-NO] BR-06 — chặn DUYỆT khi nợ quá hạn", () => {
  const han = (ngayTruoc: number) => new Date(NOW.getTime() - ngayTruoc * 86_400_000);
  it("[BL3-NO-01] quá hạn 8 ngày > 7 ⇒ chặn (TC-03); đúng 7 ngày ⇒ qua", () => {
    expect(chanDuyetVeNo([{ dueDate: han(8), conNo: 1_000_000 }], 7, NOW)).toMatch(/quá 8 ngày/);
    expect(chanDuyetVeNo([{ dueDate: han(7), conNo: 1_000_000 }], 7, NOW)).toBeNull();
  });
  it("[BL3-NO-02] khoản đã đóng đủ (conNo ≤ 0) không tính; chưa tới hạn không tính", () => {
    expect(chanDuyetVeNo([{ dueDate: han(30), conNo: 0 }, { dueDate: han(30), conNo: -5 }], 7, NOW)).toBeNull();
    expect(chanDuyetVeNo([{ dueDate: han(-10), conNo: 1_000_000 }], 7, NOW)).toBeNull();
  });
  it("[BL3-NO-03] lấy khoản quá hạn LÂU NHẤT; danh sách rỗng ⇒ 0", () => {
    expect(soNgayQuaHanLonNhat([{ dueDate: han(3), conNo: 1 }, { dueDate: han(20), conNo: 1 }], NOW)).toBe(20);
    expect(soNgayQuaHanLonNhat([], NOW)).toBe(0);
  });
  it("[BL3-NO-04] đếm theo NGÀY LỊCH VN: hạn 23:30 VN hôm qua (16:30Z) chưa tính là 'quá 1 ngày' hai lần", () => {
    // NOW = 10:00 VN 07/10. Hạn = 23:30 VN 06/10 ⇒ lịch VN: 1 ngày.
    expect(soNgayLich(new Date("2026-10-06T16:30:00Z"), NOW)).toBe(1);
    expect(soNgayLich(NOW, NOW)).toBe(0);
    expect(soNgayLich(new Date("2026-10-08T00:00:00Z"), NOW)).toBe(-1);
  });
});

describe("[BL3-LUI] BR-09 — ngày bắt đầu", () => {
  const f = (firstAbsentDate: Date | null, n: number) =>
    tinhNgayBatDau({ now: NOW, firstAbsentDate, soBuoiTuNgayDauDenNay: n, backdateMaxSessions: 2 });

  it("[BL3-LUI-01] không xin lùi ⇒ ngày bắt đầu = ngày duyệt (đúng `now`)", () => {
    const r = f(null, 0);
    expect(r.ok && r.startedAt.getTime()).toBe(NOW.getTime());
    expect(r.ok && r.soBuoiLui).toBe(0);
  });
  it("[BL3-LUI-02] lùi 2 buổi ⇒ OK (TC-05), ngày bắt đầu = 00:00 VN của buổi nghỉ đầu tiên", () => {
    const r = f(new Date("2026-09-26T05:00:00Z"), 2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.startedAt.toISOString()).toBe("2026-09-25T17:00:00.000Z"); // 26/09 00:00 VN
      expect(r.soBuoiLui).toBe(2);
    }
  });
  it("[BL3-LUI-03] lùi 3 buổi ⇒ chặn (TC-04); nêu rõ mức và số buổi thật", () => {
    const r = f(new Date("2026-09-19T05:00:00Z"), 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi).toMatch(/tối đa 2 buổi.*đã có 3 buổi/);
  });
  it("[BL3-LUI-04] không có buổi nào trong khoảng ⇒ chặn; ngày tương lai ⇒ chặn", () => {
    expect(f(new Date("2026-10-01T00:00:00Z"), 0).ok).toBe(false);
    expect(f(new Date("2026-10-09T00:00:00Z"), 1).ok).toBe(false);
  });
  it("[BL3-LUI-05] backdateMaxSessions = 0 ⇒ mọi xin lùi đều bị chặn (cấu hình tắt tính năng lùi ngày)", () => {
    const r = tinhNgayBatDau({ now: NOW, firstAbsentDate: new Date("2026-10-05T00:00:00Z"), soBuoiTuNgayDauDenNay: 1, backdateMaxSessions: 0 });
    expect(r.ok).toBe(false);
  });
});
