// lib/bao-luu/qua-han-tru-bao-luu.test.ts — K19 (vòng 3 sau nghiệm thu): SỐ NGÀY QUÁ HẠN TRỪ THỜI GIAN BẢO LƯU. THUẦN.
//
// Quy chế SR.QD.236 Phụ lục 01 Mục 15: "Đợt đã quá hạn trước ngày bảo lưu chỉ được tạm dừng tính quá hạn trong thời gian bảo lưu; khi phục học nghĩa vụ thanh toán tiếp tục."
// Bốn ca chủ dự án nêu (a–d) + các ca biên. Ngày TUYỆT ĐỐI, `homNay` luôn truyền vào (luật 19). Mã TRƯỚC bản vá (A6 vòng 2) đóng băng bằng `min(hôm nay, ngày bắt đầu) − hạn` nên
// SAU phục học nó quay về đồng hồ thật: ca (a) ra 42 thay vì 12, ca (b) ra 30 thay vì 0.
import { describe, expect, it } from "vitest";
import {
  giaoKhoang,
  hopNhatKhoang,
  nhomTheoSoNgay,
  tinhSoNgayQuaHanTruBaoLuu,
  type KhoangTamDung,
} from "./qua-han-tru-bao-luu";

const ngay = (s: string) => new Date(`${s}T00:00:00+07:00`);
const cong = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const HAN = ngay("2026-06-01");
const BAT_DAU = cong(HAN, 12); // quá hạn 12 ngày lúc bắt đầu bảo lưu
const PHUC_HOC = cong(BAT_DAU, 30);
const MOT_LAN: KhoangTamDung[] = [{ tu: BAT_DAU, den: PHUC_HOC }];

describe("[QH] tinhSoNgayQuaHanTruBaoLuu", () => {
  it("[QH-01] (a) quá hạn 12 ngày → bảo lưu 30 ngày → phục học hôm nay ⇒ 12; sau 5 ngày ⇒ 17 (đếm tiếp từ chỗ đã dừng)", () => {
    expect(tinhSoNgayQuaHanTruBaoLuu(HAN, PHUC_HOC, MOT_LAN)).toBe(12);
    expect(tinhSoNgayQuaHanTruBaoLuu(HAN, cong(PHUC_HOC, 5), MOT_LAN)).toBe(17);
    // Đối chứng: không trừ thì là 42 / 47 — số mà mã cũ (đồng hồ thật) trả sau phục học.
    expect(tinhSoNgayQuaHanTruBaoLuu(HAN, PHUC_HOC, [])).toBe(42);
    expect(tinhSoNgayQuaHanTruBaoLuu(HAN, cong(PHUC_HOC, 5), [])).toBe(47);
  });

  it("[QH-02] ĐANG bảo lưu ⇒ đóng băng đúng 12 ở MỌI ngày của kỳ nghỉ (khoảng mở `den = null`)", () => {
    const dang: KhoangTamDung[] = [{ tu: BAT_DAU, den: null }];
    for (const n of [0, 1, 10, 29, 400]) expect(tinhSoNgayQuaHanTruBaoLuu(HAN, cong(BAT_DAU, n), dang), `+${n}`).toBe(12);
  });

  it("[QH-03] (b) đợt tới hạn GIỮA kỳ bảo lưu ⇒ 0 ngày lúc phục học, rồi tính từ đó", () => {
    const giuaKy = cong(BAT_DAU, 10);
    expect(tinhSoNgayQuaHanTruBaoLuu(giuaKy, PHUC_HOC, MOT_LAN)).toBe(0);
    expect(tinhSoNgayQuaHanTruBaoLuu(giuaKy, cong(PHUC_HOC, 5), MOT_LAN)).toBe(5);
    // Đang nghỉ mà tới hạn: cũng 0 (không quá hạn trong lúc nghỉ).
    expect(tinhSoNgayQuaHanTruBaoLuu(giuaKy, cong(BAT_DAU, 20), [{ tu: BAT_DAU, den: null }])).toBe(0);
  });

  it("[QH-04] (c) hai lần bảo lưu, hai khoảng KHÔNG chồng nhau ⇒ trừ cả hai", () => {
    const hai: KhoangTamDung[] = [
      { tu: cong(HAN, 5), den: cong(HAN, 15) }, // 10 ngày
      { tu: cong(HAN, 40), den: cong(HAN, 70) }, // 30 ngày
    ];
    expect(tinhSoNgayQuaHanTruBaoLuu(HAN, cong(HAN, 100), hai)).toBe(100 - 10 - 30);
  });

  it("[QH-05] hai hồ sơ CHỒNG nhau (bé học hai khoá cùng nghỉ) được hợp nhất — không trừ hai lần", () => {
    const chong: KhoangTamDung[] = [
      { tu: cong(HAN, 10), den: cong(HAN, 30) },
      { tu: cong(HAN, 20), den: cong(HAN, 40) },
    ];
    expect(tinhSoNgayQuaHanTruBaoLuu(HAN, cong(HAN, 50), chong)).toBe(50 - 30); // hợp [10,40] = 30 ngày, không phải 40
    expect(hopNhatKhoang(chong)).toHaveLength(1);
  });

  it("[QH-06] (d) đợt sổ MỚI đã được dời hạn (nằm SAU ngày phục học) ⇒ không trừ lần hai", () => {
    const hanDaDoi = cong(PHUC_HOC, 7); // `apDungDoiHanBaoLuu` đã dời qua kỳ nghỉ
    expect(tinhSoNgayQuaHanTruBaoLuu(hanDaDoi, cong(PHUC_HOC, 10), MOT_LAN)).toBe(3);
    expect(tinhSoNgayQuaHanTruBaoLuu(hanDaDoi, cong(PHUC_HOC, 10), [])).toBe(3); // y hệt khi không có khoảng nào
  });

  it("[QH-07] khoảng nằm hoàn toàn TRƯỚC hạn, hoặc SAU hôm nay ⇒ không trừ", () => {
    expect(tinhSoNgayQuaHanTruBaoLuu(HAN, cong(HAN, 20), [{ tu: cong(HAN, -30), den: cong(HAN, -5) }])).toBe(20);
    expect(tinhSoNgayQuaHanTruBaoLuu(HAN, cong(HAN, 20), [{ tu: cong(HAN, 30), den: cong(HAN, 60) }])).toBe(20);
  });

  it("[QH-08] chưa tới hạn / đúng hạn ⇒ 0; không bao giờ âm", () => {
    expect(tinhSoNgayQuaHanTruBaoLuu(cong(HAN, 5), HAN, [])).toBe(0);
    expect(tinhSoNgayQuaHanTruBaoLuu(HAN, HAN, [])).toBe(0);
    expect(tinhSoNgayQuaHanTruBaoLuu(HAN, cong(HAN, 3), [{ tu: cong(HAN, -100), den: null }])).toBe(0);
  });

  it("[QH-09] đếm theo NGÀY LỊCH VN, không giờ: hạn 23:30 VN và hôm nay 00:10 VN hôm sau = 1 ngày", () => {
    expect(tinhSoNgayQuaHanTruBaoLuu(new Date("2026-06-01T23:30:00+07:00"), new Date("2026-06-02T00:10:00+07:00"), [])).toBe(1);
    expect(tinhSoNgayQuaHanTruBaoLuu(new Date("2026-06-01T00:30:00+07:00"), new Date("2026-06-01T23:50:00+07:00"), [])).toBe(0);
  });
});

describe("[QH-G] giaoKhoang — đơn nhiều con", () => {
  const a: KhoangTamDung[] = [{ tu: cong(HAN, 10), den: cong(HAN, 40) }];
  const b: KhoangTamDung[] = [{ tu: cong(HAN, 20), den: cong(HAN, 60) }];
  it("[QH-G1] chỉ những ngày CẢ HAI bé cùng bảo lưu mới được trừ", () => {
    const g = giaoKhoang([a, b]);
    expect(g).toHaveLength(1);
    expect(tinhSoNgayQuaHanTruBaoLuu(HAN, cong(HAN, 100), g)).toBe(100 - 20);
  });
  it("[QH-G2] một bé không bảo lưu lần nào ⇒ giao rỗng ⇒ đếm như thường (khoản của bé còn đi học)", () => {
    expect(giaoKhoang([a, []])).toEqual([]);
    expect(giaoKhoang([])).toEqual([]);
  });
  it("[QH-G3] khoảng mở giao với khoảng đóng vẫn đúng", () => {
    const g = giaoKhoang([[{ tu: cong(HAN, 10), den: null }], [{ tu: cong(HAN, 20), den: cong(HAN, 30) }]]);
    expect(tinhSoNgayQuaHanTruBaoLuu(HAN, cong(HAN, 50), g)).toBe(50 - 10);
  });
});

describe("[QH-N] nhomTheoSoNgay", () => {
  it("[QH-N1] cùng ngưỡng với overdueBucket cũ: 0→none · 1..7 · 8..30 · >30", () => {
    expect([0, -3, 1, 7, 8, 30, 31].map(nhomTheoSoNgay)).toEqual(["none", "none", "1-7", "1-7", "8-30", "8-30", ">30"]);
  });
});
