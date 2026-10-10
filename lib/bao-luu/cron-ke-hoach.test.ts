import { describe, it, expect } from "vitest";
import { hanToiDaBaoLuu } from "@/lib/bao-luu/tran-bao-luu";
import { vnDateAt } from "@/lib/time/vn";
import { lapKeHoachCron, type HoSoCron, type ChinhSachCron } from "@/lib/bao-luu/cron-ke-hoach";

// KỊCH BẢN LỆCH ĐỒNG HỒ (luật 19): một hồ sơ bắt đầu 10/01/2026, trần 3 tháng ⇒ hạn 10/04/2026 (= +90 ngày). Mỗi ca TỊNH TIẾN "hôm nay"
// thêm N ngày. Mã không đổi, chỉ tờ lịch đổi — ca đỏ khi ai đó phụ thuộc đồng hồ thật hoặc đổi luật mốc.
const BAT_DAU = vnDateAt(2026, 0, 10);
const HAN = hanToiDaBaoLuu(BAT_DAU, 3);
const CS: ChinhSachCron = { remindBeforeDays: 14, escalateAfterDays: 3 };
const them = (n: number) => new Date(BAT_DAU.getTime() + n * 86_400_000 + 3 * 3_600_000); // 03:00 sáng VN, +n ngày

const goc: HoSoCron = {
  id: "r1",
  type: "PARENT",
  status: "ACTIVE",
  startedAt: BAT_DAU,
  expectedEndAt: null,
  standardEndDate: HAN,
  extendedEndDate: null,
  lastContactAt: null,
  responseDeadline: null,
  daLeoThang: false,
};
const loai = (h: HoSoCron, n: number, cs = CS) => lapKeHoachCron([h], cs, them(n)).map((v) => v.loai);

describe("[BL5-CR] kế hoạch cron bảo lưu — tịnh tiến đồng hồ", () => {
  it("[BL5-CR-00] fixture đúng hình dạng: hạn = +90 ngày kể từ ngày bắt đầu", () => {
    expect(Math.round((HAN.getTime() - BAT_DAU.getTime()) / 86_400_000)).toBe(90);
  });

  it("[BL5-CR-01] ACTIVE: giữa kỳ không việc; +76 (còn 14 ngày) nhắc trước hạn; +90 nhắc ĐÚNG ngày hạn; +91 quá hạn", () => {
    expect(loai(goc, 30)).toEqual([]);
    expect(loai(goc, 75)).toEqual([]);
    expect(loai(goc, 76)).toEqual(["NHAC_TRUOC_HAN"]);
    expect(loai(goc, 89)).toEqual(["NHAC_TRUOC_HAN"]); // lỡ vài ngày vẫn nhắc (dedupeKey theo mốc giữ "đúng 1 lần")
    expect(loai(goc, 90)).toEqual(["NHAC_DUNG_HAN"]);
    expect(loai(goc, 91)).toEqual(["QUA_HAN"]);
    expect(loai(goc, 93)).toEqual(["QUA_HAN"]); // cron nghỉ 3 ngày: lần chạy kế vẫn đưa về OVERDUE
  });

  it("[BL5-CR-02] OVERDUE: +91..+92 chưa leo thang; +93 (3 ngày) leo thang; đã leo thang rồi thì KHÔNG lặp", () => {
    const qua = { ...goc, status: "OVERDUE" as const };
    expect(loai(qua, 91)).toEqual([]);
    expect(loai(qua, 92)).toEqual([]);
    expect(loai(qua, 93)).toEqual(["LEO_THANG"]);
    expect(loai(qua, 100)).toEqual(["LEO_THANG"]);
    expect(loai({ ...qua, daLeoThang: true }, 100)).toEqual([]);
  });

  it("[BL5-CR-03] Q6: 'Đã liên hệ – hẹn ngày' dừng leo thang tối đa 7 ngày rồi lại leo thang", () => {
    const qua = { ...goc, status: "OVERDUE" as const, lastContactAt: them(94) };
    expect(loai(qua, 95)).toEqual([]);
    expect(loai(qua, 101)).toEqual([]); // đúng 7 ngày sau liên hệ: còn hoãn
    expect(loai(qua, 102)).toEqual(["LEO_THANG"]);
  });

  it("[BL5-CR-04] TC-11: quá hạn 30/40 ngày mà CHƯA gửi thông báo chính thức ⇒ KHÔNG BAO GIỜ chấm dứt", () => {
    const qua = { ...goc, status: "OVERDUE" as const, daLeoThang: true };
    for (const n of [120, 130, 400]) expect(loai(qua, n), `+${n}`).not.toContain("CHAM_DUT");
  });

  it("[BL5-CR-05] TC-12: NOTICE_SENT — hạn phản hồi là NGÀY CUỐI còn được trả lời; ngày sau đó mới CHAM_DUT", () => {
    const tb = { ...goc, status: "NOTICE_SENT" as const, responseDeadline: them(107) }; // gửi +100, hạn +107
    expect(loai(tb, 100)).toEqual([]);
    expect(loai(tb, 107)).toEqual([]);
    expect(loai(tb, 108)).toEqual(["CHAM_DUT"]);
    expect(loai(tb, 130)).toEqual(["CHAM_DUT"]);
    expect(loai({ ...tb, responseDeadline: null }, 130)).toEqual([]); // thiếu hạn phản hồi: không đoán
  });

  it("[BL5-CR-06] gia hạn dời mọi mốc: extendedEndDate thắng standardEndDate", () => {
    const giaHan = { ...goc, extendedEndDate: hanToiDaBaoLuu(HAN, 1) }; // +1 tháng ⇒ +121 ngày
    expect(loai(giaHan, 91)).toEqual([]);
    expect(loai(giaHan, 107)).toEqual(["NHAC_TRUOC_HAN"]);
    expect(loai(giaHan, 122)).toEqual(["QUA_HAN"]);
  });

  it("[BL5-CR-07] BR-23: loại CENTER không bao giờ OVERDUE/leo thang/chấm dứt — chỉ NHẮC khi quá ngày dự kiến mở lại", () => {
    const centre = { ...goc, type: "CENTER" as const, expectedEndAt: them(60) };
    expect(loai(centre, 61)).toEqual(["CENTER_NHAC"]); // quá 1 ngày
    expect(loai(centre, 130)).toEqual(["CENTER_NHAC"]);
    expect(loai(centre, 60)).toEqual([]); // đúng ngày dự kiến: chưa quá
    expect(loai({ ...centre, status: "OVERDUE" }, 130)).toEqual([]);
    expect(loai({ ...centre, status: "NOTICE_SENT", responseDeadline: them(10) }, 130)).toEqual([]);
  });

  it("[BL5-CR-08] APPROVED có ngày bắt đầu ≤ hôm nay ⇒ START; chưa tới ngày thì không", () => {
    const duyet = { ...goc, status: "APPROVED" as const, startedAt: them(5) };
    expect(loai(duyet, 4)).toEqual([]);
    expect(loai(duyet, 5)).toEqual(["START"]);
  });

  it("[BL5-CR-09] trạng thái khác (PENDING · RESUME_PENDING · ENDED · TERMINATED …) cron không đụng dù quá hạn rất lâu", () => {
    for (const status of ["PENDING", "RESUME_PENDING", "ENDED", "REJECTED", "CANCELLED", "TERMINATED"] as const) {
      expect(loai({ ...goc, status }, 200), status).toEqual([]);
    }
  });

  it("[BL5-CR-10] hồ sơ không có hạn (dữ liệu cũ) ⇒ bỏ qua luật theo hạn, không đoán", () => {
    const khongHan = { ...goc, standardEndDate: null };
    expect(loai(khongHan, 200)).toEqual([]);
    expect(loai({ ...khongHan, status: "OVERDUE" }, 200)).toEqual([]);
  });

  it("[BL5-CR-11] ranh giới ngày theo LỊCH VN, không theo UTC: 23:30 giờ VN ngày +90 vẫn là ngày hạn", () => {
    const muoiMot = new Date(BAT_DAU.getTime() + 90 * 86_400_000 + 23.5 * 3_600_000);
    expect(lapKeHoachCron([goc], CS, muoiMot).map((v) => v.loai)).toEqual(["NHAC_DUNG_HAN"]);
  });
});
