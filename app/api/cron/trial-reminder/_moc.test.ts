import { describe, expect, it } from "vitest";
import { chonMoc, MOC, type Moc, mocBatDau, nhanThoiDiem } from "./_moc";

// Buổi 09:00 giờ VN ngày 26/08/2026. Cột `@db.Date` ⇒ Prisma trả UTC-midnight của ngày VN.
const NGAY = new Date("2026-08-26T00:00:00.000Z");

describe("mocBatDau — ghép cột `date` (UTC-midnight ngày VN) với chuỗi giờ VN", () => {
  it("09:00 giờ VN ngày 26/08 = 02:00Z cùng ngày", () => {
    expect(mocBatDau(NGAY, "09:00")?.toISOString()).toBe("2026-08-26T02:00:00.000Z");
  });

  it("00:00 giờ VN lùi sang 17:00Z NGÀY HÔM TRƯỚC — chỗ dễ lệch 1 ngày nhất", () => {
    expect(mocBatDau(NGAY, "00:00")?.toISOString()).toBe("2026-08-25T17:00:00.000Z");
  });

  it("23:59 giờ VN vẫn nằm trong ngày UTC 26/08", () => {
    expect(mocBatDau(NGAY, "23:59")?.toISOString()).toBe("2026-08-26T16:59:00.000Z");
  });

  it("giữ nguyên phút lẻ", () => {
    expect(mocBatDau(NGAY, "17:45")?.toISOString()).toBe("2026-08-26T10:45:00.000Z");
  });

  it("startTime hỏng → null (không đoán bừa)", () => {
    for (const xau of ["", "9:00", "24:00", "09:60", "09h00", "0900"]) {
      expect(mocBatDau(NGAY, xau)).toBeNull();
    }
  });
});

/**
 * Đếm số LƯỢT CRON rơi vào cửa sổ của `moc`, mô phỏng đúng lưới lấy mẫu thật.
 *
 * Lưới: buổi bắt đầu ở một thời điểm cố định; cron chạy lặp, nên "số giờ còn lại" ở các lượt
 * là một dãy GIẢM DẦN theo bước `khoangCachPhut`. `phaPhut` là pha của dãy đó so với giờ tròn —
 * thứ mà hệ thống KHÔNG điều khiển được (buổi bắt đầu lúc 18:00, 18:06, 18:30… đều có).
 *
 * So bằng ĐỒNG NHẤT THỨC (`=== moc`) chứ không so `.ten`: như vậy phép đếm đi qua đúng `.find`
 * của `chonMoc`, nên một mốc bị mốc đứng trước nuốt sẽ đếm ra 0 — hỏng CÂM bị lộ ra ở đây.
 */
function demLuotBat(moc: Moc, phaPhut: number, khoangCachPhut: number): number {
  let n = 0;
  for (let j = 0; ; j++) {
    // Bắt đầu đếm từ 30h trước buổi: xa hơn mọi mép trên (25h).
    const conBaoLau = (30 * 60 - phaPhut - j * khoangCachPhut) / 60;
    if (conBaoLau < -1) break;
    if (chonMoc(conBaoLau) === moc) n++;
  }
  return n;
}

/** 10 pha, cách nhau 0,1h = 6 phút — số nguyên phút nên không có sai số dấu phẩy động. */
const PHA_PHUT: readonly number[] = [0, 6, 12, 18, 24, 30, 36, 42, 48, 54];

describe("chonMoc — cửa sổ nhắc", () => {
  it("mốc 1 ngày chỉ nhận 23h–25h, KHÔNG nhận 36h (bug #21: chuông phát trước 1,5 ngày)", () => {
    expect(chonMoc(24)?.ten).toBe("1-ngay");
    expect(chonMoc(23)?.ten).toBe("1-ngay");
    expect(chonMoc(24.99)?.ten).toBe("1-ngay");
    expect(chonMoc(25)).toBeUndefined();
    expect(chonMoc(36)).toBeUndefined();
    expect(chonMoc(22.9)).toBeUndefined();
  });

  it("mốc 2 giờ chỉ nhận 1,5h–2,5h", () => {
    expect(chonMoc(2)?.ten).toBe("2-gio");
    expect(chonMoc(1.5)?.ten).toBe("2-gio");
    expect(chonMoc(2.49)?.ten).toBe("2-gio");
    expect(chonMoc(2.5)).toBeUndefined();
    // ⚠️ 1,4h KHÔNG còn là khoảng chết: từ 17/09 nó thuộc mốc "1-gio" (nhắc GIÁO VIÊN).
    // Ca này trước đó khẳng định `toBeUndefined()` — giữ nguyên là khoá luật ĐÃ BỊ ĐẢO.
    expect(chonMoc(1.4)?.ten).toBe("1-gio");
  });

  it("mốc 1 giờ (nhắc GIÁO VIÊN) nhận 0,4h–1,5h", () => {
    expect(chonMoc(1)?.ten).toBe("1-gio");
    expect(chonMoc(0.4)?.ten).toBe("1-gio");
    expect(chonMoc(1.49)?.ten).toBe("1-gio");
    // Mép trên đụng đúng mép dưới của "2-gio" — không lấn, xem ca "đôi một không chồng".
    expect(chonMoc(1.5)?.ten).toBe("2-gio");
    // Dưới mép dưới là hết mốc: buổi tạo khi còn <24 phút KHÔNG BAO GIỜ nhận chuông này.
    expect(chonMoc(0.39)).toBeUndefined();
    expect(chonMoc(0.1)).toBeUndefined();
  });

  it("buổi đã bắt đầu hoặc còn quá xa thì không nhắc", () => {
    expect(chonMoc(0)).toBeUndefined();
    expect(chonMoc(-3)).toBeUndefined();
    expect(chonMoc(48)).toBeUndefined();
  });

  it("bề rộng cửa sổ nằm giữa nhịp cron (1h) và trần 2h", () => {
    for (const m of MOC) {
      // ≥ nhịp cron 1h: hẹp hơn thì buổi lọt khe giữa hai lần chạy, không ai được nhắc.
      // ⚠️ Mốc "2 giờ" rộng ĐÚNG 1h = biên tối thiểu: nếu một lượt cron trễ vài phút so
      // với lượt trước thì buổi rơi vào đúng khe đó vẫn có thể trượt. Chấp nhận có chủ
      // đích — nới lên 2h thì chuông "sắp bắt đầu" phát từ 3,5 tiếng trước.
      expect(m.denGio - m.tuGio).toBeGreaterThanOrEqual(1);
      // ≤ 2h: `dedupeKey` vĩnh viễn ⇒ chuông phát ngay ở MÉP TRÊN của cửa sổ. Cửa sổ
      // 12h–36h của bản cũ chính là lỗi #21 (phát trước 1,5 ngày, in "ngày mai").
      expect(m.denGio - m.tuGio).toBeLessThanOrEqual(2);
    }
  });

  it("ba cửa sổ ĐÔI MỘT KHÔNG CHỒNG — chồng là mốc đứng SAU bị `.find` nuốt vĩnh viễn", () => {
    // `chonMoc` dùng `.find` ⇒ trả mốc ĐẦU TIÊN khớp theo thứ tự mảng. Hai cửa sổ giao nhau
    // thì mốc đứng sau không bao giờ bắn trong phần giao — và cả hai mốc vẫn "có mặt, vẫn
    // chạy", nên không có gì đỏ, không có gì log. Ca này là thứ duy nhất canh được.
    const chongNhau: string[] = [];
    for (let i = 0; i < MOC.length; i++) {
      for (let j = i + 1; j < MOC.length; j++) {
        const a = MOC[i]!;
        const b = MOC[j]!;
        if (a.tuGio < b.denGio && b.tuGio < a.denGio) chongNhau.push(`${a.ten}×${b.ten}`);
      }
    }
    expect(chongNhau).toEqual([]);
  });

  it("PHỦ KÍN LƯỚI, nhịp cron danh nghĩa 60′: mọi mốc bắt được ≥1 lượt ở MỌI pha", () => {
    for (const m of MOC) {
      for (const pha of PHA_PHUT) {
        expect({ moc: m.ten, pha, batDuoc: demLuotBat(m, pha, 60) >= 1 }).toEqual({
          moc: m.ten,
          pha,
          batDuoc: true,
        });
      }
    }
  });

  it("PHỦ KÍN LƯỚI, lượt cron cách nhau tới 65′: chuông GIÁO VIÊN không được trượt pha nào", () => {
    // PHÉP TÍNH: nhịp danh nghĩa 60′ + jitter Vercel vài phút ⇒ khoảng cách hai lượt LIÊN
    // TIẾP có thể tới ~65′. Cửa sổ nửa mở rộng W chắc chắn bắt ≥1 lượt ⟺ W ≥ khoảng cách
    // lớn nhất ⇒ W ≥ 65′. Cửa sổ "1-gio" rộng 1.5−0.4 = 1.1h = 66′, dư đúng 1 phút.
    //
    // ⚠️ CỐ Ý CHỈ SOI MỐC GIÁO VIÊN, và soi theo TRƯỜNG `nhan` chứ không theo bề rộng.
    // Mốc "2-gio" rộng đúng 60′ nên nó TRƯỢT ở pha 24′ — đó là lỗ ĐÃ BIẾT và đã được chấp
    // nhận có chủ đích (xem ca bề rộng ở trên): Sale còn mốc "1-ngay" đỡ, giáo viên thì
    // không còn mốc nào ở dưới. Lọc theo bề rộng ⇒ mốc bị bóp hẹp tự rơi khỏi vòng lặp và
    // ca này XANH GIẢ — đúng lỗi mà việc cấy `denGio: 1.4` dùng để kiểm.
    const mocGv = MOC.filter((m) => m.nhan === "giao-vien");
    expect(mocGv.length).toBeGreaterThanOrEqual(1);
    for (const m of mocGv) {
      // HÀNH VI trước, số đo sau (luật 11): khẳng định "có lượt cron nào bắt được không"
      // là thứ người dùng cảm thấy; bề rộng chỉ là cách giải thích vì sao. Đặt ngược thứ tự
      // thì khi bóp hẹp cửa sổ, ca đỏ ở dòng số đo và người đọc không biết hậu quả THẬT.
      for (const pha of PHA_PHUT) {
        expect({ moc: m.ten, pha, batDuoc: demLuotBat(m, pha, 65) >= 1 }).toEqual({
          moc: m.ten,
          pha,
          batDuoc: true,
        });
      }
      expect(m.denGio - m.tuGio).toBeGreaterThanOrEqual(65 / 60);
    }
  });

  it("mỗi mốc khai rõ NGƯỜI NHẬN — nơi chạy rẽ nhánh theo trường này, không theo tên mốc", () => {
    expect(MOC.map((m) => m.nhan)).toEqual(["sale", "sale", "giao-vien"]);
  });

  it("giữ đúng con số cửa sổ đã chốt", () => {
    expect(MOC.map((m) => [m.ten, m.tuGio, m.denGio, m.nhan])).toEqual([
      ["1-ngay", 23, 25, "sale"],
      ["2-gio", 1.5, 2.5, "sale"],
      ["1-gio", 0.4, 1.5, "giao-vien"],
    ]);
  });
});

describe("nhanThoiDiem — in giờ/ngày theo đồng hồ VN", () => {
  it("mốc UTC được đọc lại thành giờ VN, không phải giờ máy chạy", () => {
    // 2026-08-25T17:00:00Z = 00:00 ngày 26/08 giờ VN.
    expect(nhanThoiDiem(new Date("2026-08-25T17:00:00.000Z"))).toEqual({
      gio: "00:00",
      ngay: "26/08",
    });
  });

  it("đệm 0 cho giờ và ngày một chữ số", () => {
    expect(nhanThoiDiem(new Date("2026-09-02T01:05:00.000Z"))).toEqual({
      gio: "08:05",
      ngay: "02/09",
    });
  });

  it("khớp vòng với mocBatDau", () => {
    const batDau = mocBatDau(NGAY, "09:00");
    expect(batDau).not.toBeNull();
    expect(nhanThoiDiem(batDau as Date)).toEqual({ gio: "09:00", ngay: "26/08" });
  });
});
