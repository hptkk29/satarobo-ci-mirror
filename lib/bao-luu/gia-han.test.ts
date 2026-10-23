import { describe, it, expect } from "vitest";
import { hanToiDaBaoLuu } from "@/lib/bao-luu/tran-bao-luu";
import { vnDateAt } from "@/lib/time/vn";
import { kiemGiaHan, type DauVaoGiaHan, type ChinhSachGiaHan } from "@/lib/bao-luu/gia-han";

// Bắt đầu 07/01/2026, trần 3 tháng ⇒ hạn 07/04/2026. Gia hạn 1 THÁNG LỊCH ⇒ tối đa 07/05/2026 (= +30 ngày). Cố ý chọn mốc này để
// TC-08 ("30 ngày được, 31 ngày chặn") rơi đúng: tháng 4 có 30 ngày.
const BAT_DAU = vnDateAt(2026, 0, 7);
const HAN = hanToiDaBaoLuu(BAT_DAU, 3);
const CS: ChinhSachGiaHan = { maxMonths: 3, extendTimes: 1, extendMaxMonths: 1 };
const GOC: DauVaoGiaHan = {
  type: "PARENT", status: "ACTIVE", startedAt: BAT_DAU, standardEndDate: HAN, extendedEndDate: null, extendCount: 0, coDeNghiDangCho: false,
};
const ngay = (n: number) => new Date(HAN.getTime() + n * 86_400_000);
const dung = (h: Partial<DauVaoGiaHan>, denNgay: Date, o: { lyDo?: string; vuotTran?: boolean } = {}, cs = CS) =>
  kiemGiaHan({ ...GOC, ...h }, { denNgay, lyDo: o.lyDo ?? "Phụ huynh xin thêm một tháng", vuotTran: o.vuotTran ?? false }, cs);
const loi = (r: ReturnType<typeof dung>) => (r.ok ? "" : r.loi.join(" | "));

describe("[BL5-GH] gia hạn bảo lưu (BR-11)", () => {
  it("[BL5-GH-00] fixture: hạn 07/04, một tháng lịch sau là 07/05 = đúng 30 ngày", () => {
    expect(Math.round((hanToiDaBaoLuu(HAN, 1).getTime() - HAN.getTime()) / 86_400_000)).toBe(30);
  });

  it("[BL5-GH-01] TC-08: gia hạn 30 ngày ĐƯỢC; 31 ngày CHẶN", () => {
    expect(dung({}, ngay(30)).ok).toBe(true);
    expect(loi(dung({}, ngay(31)))).toMatch(/tối đa 1 tháng/);
  });

  it("[BL5-GH-02] TC-09: lần thứ hai (đã dùng hết extendTimes) bị từ chối", () => {
    expect(loi(dung({ extendCount: 1, extendedEndDate: ngay(30) }, ngay(40)))).toMatch(/hết 1 lần gia hạn/);
  });

  it("[BL5-GH-03] hạn mới phải SAU hạn hiện tại (kể cả cùng ngày)", () => {
    expect(loi(dung({}, ngay(0)))).toMatch(/sau hạn hiện tại/);
    expect(loi(dung({}, ngay(-3)))).toMatch(/sau hạn hiện tại/);
  });

  it("[BL5-GH-04] lý do bắt buộc ≥ 5 ký tự", () => {
    expect(loi(dung({}, ngay(10), { lyDo: "ko" }))).toMatch(/lý do/);
    expect(loi(dung({}, ngay(10), { lyDo: "     " }))).toMatch(/lý do/);
  });

  it("[BL5-GH-05] BR-23: loại CENTER không gia hạn", () => {
    expect(loi(dung({ type: "CENTER" }, ngay(10)))).toMatch(/Trung tâm/);
  });

  it("[BL5-GH-06] chỉ ACTIVE / OVERDUE / NOTICE_SENT; RESUME_PENDING, PENDING, ENDED… bị chặn", () => {
    for (const status of ["ACTIVE", "OVERDUE", "NOTICE_SENT"] as const) expect(dung({ status }, ngay(10)).ok, status).toBe(true);
    for (const status of ["PENDING", "APPROVED", "RESUME_PENDING", "ENDED", "REJECTED", "CANCELLED", "TERMINATED"] as const) {
      expect(dung({ status }, ngay(10)).ok, status).toBe(false);
    }
  });

  it("[BL5-GH-07] đã có đề nghị đang chờ ⇒ không đề nghị thứ hai", () => {
    expect(loi(dung({ coDeNghiDangCho: true }, ngay(10)))).toMatch(/đang chờ duyệt/);
  });

  it("[BL5-GH-08] BR-11 tổng: nhiều lần cho phép vẫn không vượt maxMonths + extendMaxMonths từ ngày bắt đầu — trừ khi có ngoại lệ", () => {
    const cs: ChinhSachGiaHan = { ...CS, extendTimes: 3 };
    const lanHai = { extendCount: 1, extendedEndDate: hanToiDaBaoLuu(HAN, 1) }; // đã gia hạn 1 tháng ⇒ 4 tháng từ đầu (= trần)
    const denNam = hanToiDaBaoLuu(lanHai.extendedEndDate, 1); // tháng thứ 5
    expect(loi(dung(lanHai, denNam, {}, cs))).toMatch(/vượt 4 tháng/);
    expect(dung(lanHai, denNam, { vuotTran: true }, cs)).toMatchObject({ ok: true, vuotTran: true });
  });

  it("[BL5-GH-09] hồ sơ chưa có hạn ⇒ không gia hạn (không đoán)", () => {
    expect(loi(dung({ standardEndDate: null }, ngay(10)))).toMatch(/chưa có hạn/);
  });

  it("[BL5-GH-10] gia hạn LẦN HAI tính từ extendedEndDate, không từ standardEndDate", () => {
    const cs: ChinhSachGiaHan = { ...CS, extendTimes: 3, maxMonths: 6 };
    const daGiaHan = { extendCount: 1, extendedEndDate: ngay(30) };
    expect(dung(daGiaHan, hanToiDaBaoLuu(ngay(30), 1), {}, cs).ok).toBe(true);
    expect(loi(dung(daGiaHan, hanToiDaBaoLuu(HAN, 1), {}, cs))).toMatch(/sau hạn hiện tại/); // mốc cũ không còn
  });
});
