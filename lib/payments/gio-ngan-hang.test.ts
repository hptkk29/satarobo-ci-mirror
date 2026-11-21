// lib/payments/gio-ngan-hang.test.ts — `[GNH-*]` giờ ngân hàng thực nhận. Số lấy từ PROD (đối soát T9–T10/2026).
import { describe, it, expect, afterEach } from "vitest";
import { gioNganHangThuc, parseGioNganHang, LECH_GIO_VN_MS } from "./gio-ngan-hang";

const TZ_GOC = process.env.TZ;
afterEach(() => {
  if (TZ_GOC === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_GOC;
});

describe("[GNH] parseGioNganHang — chuỗi KHÔNG múi giờ luôn là giờ VIỆT NAM", () => {
  it("[GNH-01] chuỗi webhook thật của FT26000000000001 (14:57 giờ VN) = 07:57 UTC", () => {
    expect(parseGioNganHang("2026-09-24 14:57:00")?.toISOString()).toBe("2026-09-24T07:57:00.000Z");
  });

  it("[GNH-02] KHÔNG phụ thuộc múi giờ tiến trình — đúng lỗi đã lệch +7h trên 46/87 giao dịch PROD", () => {
    // Vercel chạy UTC tới 24/09; VPS chạy giờ VN từ 28/09. `new Date(chuỗi không múi giờ)` cho hai kết quả KHÁC NHAU ở hai
    // máy đó; hàm này phải cho MỘT kết quả ở mọi máy. Đổi TZ tại chỗ rồi so — nếu hàm lọt về `new Date(chuỗi)` thì ca này đỏ.
    const ket: string[] = [];
    for (const tz of ["UTC", "Asia/Ho_Chi_Minh", "America/Los_Angeles", "Pacific/Auckland"]) {
      process.env.TZ = tz;
      ket.push(parseGioNganHang("2026-09-24 14:57:00")!.toISOString());
    }
    expect(new Set(ket).size, `kết quả theo từng múi giờ: ${ket.join(" | ")}`).toBe(1);
    expect(ket[0]).toBe("2026-09-24T07:57:00.000Z");
  });

  it("[GNH-03] chấp nhận chữ T, thiếu giây, có giây lẻ", () => {
    expect(parseGioNganHang("2026-10-06T16:03:00")?.toISOString()).toBe("2026-10-06T09:03:00.000Z");
    expect(parseGioNganHang("2026-10-06 16:03")?.toISOString()).toBe("2026-10-06T09:03:00.000Z");
    expect(parseGioNganHang("2026-10-06 16:03:00.250")?.toISOString()).toBe("2026-10-06T09:03:00.000Z");
  });

  it("[GNH-04] chuỗi CÓ múi giờ thì tôn trọng múi giờ ấy", () => {
    expect(parseGioNganHang("2026-09-24T14:57:00Z")?.toISOString()).toBe("2026-09-24T14:57:00.000Z");
    expect(parseGioNganHang("2026-09-24T14:57:00+07:00")?.toISOString()).toBe("2026-09-24T07:57:00.000Z");
    // Ghim của nhiều bộ DB cũ: ISO có Z, năm 2699.
    expect(parseGioNganHang("2699-05-01T03:00:00Z")?.toISOString()).toBe("2699-05-01T03:00:00.000Z");
  });

  it("[GNH-05] không đọc được ⇒ null (người gọi quyết), KHÔNG đoán", () => {
    for (const x of ["", "  ", "24/09/2026 14:57", "2026/09/24 14:57:00", "hôm qua", 1790000000000, null, undefined, {}]) {
      expect(parseGioNganHang(x), String(x)).toBeNull();
    }
  });

  it("[GNH-06] ngày không tồn tại bị từ chối, không lặng lẽ cuộn sang tháng sau", () => {
    expect(parseGioNganHang("2026-02-31 10:00:00")).toBeNull();
    expect(parseGioNganHang("2026-13-01 10:00:00")).toBeNull();
  });
});

describe("[GNH] gioNganHangThuc — dòng ĐÃ LƯU, kể cả dòng đời cũ lệch +7h", () => {
  const now = new Date("2026-10-24T05:00:00.000Z");

  it("[GNH-10] dòng bình thường (webhook đến vài chục giây sau giao dịch) ⇒ dùng nguyên transferredAt", () => {
    // FT26000000000002 — 4.320.000đ, 06/10 16:03 giờ VN.
    const r = gioNganHangThuc({ transferredAt: new Date("2026-10-06T09:03:00Z"), createdAt: new Date("2026-10-06T09:03:40Z") }, now);
    expect(r.toISOString()).toBe("2026-10-06T09:03:00.000Z");
  });

  it("[GNH-11] dòng đời cũ lệch +7h (FT26000000000003: lưu 22:53, webhook thực tế đến 15:53) ⇒ trừ 7 giờ", () => {
    const r = gioNganHangThuc({ transferredAt: new Date("2026-09-08T15:53:00Z"), createdAt: new Date("2026-09-08T08:53:05Z") }, now);
    expect(r.toISOString()).toBe("2026-09-08T08:53:00.000Z");
    expect(r.getTime()).toBe(new Date("2026-09-08T15:53:00Z").getTime() - LECH_GIO_VN_MS);
  });

  it("[GNH-12] hệ quả NGÀY của ca trên: DB lưu 04/09 03:11, thực tế 03/09 20:11 (Nguyễn Công Hoàng Khải — Sale ghi 03/09 là ĐÚNG)", () => {
    // Giá trị đang nằm trong DB: 03:11 ngày 04/09 giờ VN = 20:11Z ngày 03/09. Webhook đến lúc 20:11:44 giờ VN ngày 03/09 = 13:11:44Z.
    const r = gioNganHangThuc({ transferredAt: new Date("2026-09-03T20:11:00Z"), createdAt: new Date("2026-09-03T13:11:44Z") }, now);
    expect(r.toISOString()).toBe("2026-09-03T13:11:00.000Z");
  });

  it("[GNH-13] giao dịch đồng bộ MUỘN nhiều ngày vẫn là giờ ngân hàng — không bị kéo về lúc đồng bộ", () => {
    // FT26000000000004: giao dịch 07/08 00:37 giờ VN, hệ thống nhận 12/08.
    const r = gioNganHangThuc({ transferredAt: new Date("2026-08-06T17:37:00Z"), createdAt: new Date("2026-08-12T05:09:31Z") }, now);
    expect(r.toISOString()).toBe("2026-08-06T17:37:00.000Z");
  });

  it("[GNH-14] lệch lạ (không phải 7 giờ) ⇒ lùi về lúc hệ thống NHẬN, không bao giờ trả giờ ở tương lai", () => {
    const nhan = new Date("2026-10-06T09:03:40Z");
    const r = gioNganHangThuc({ transferredAt: new Date("2026-10-06T12:03:00Z"), createdAt: nhan }, now);
    expect(r.getTime()).toBe(nhan.getTime());
  });

  it("[GNH-15] thiếu createdAt ⇒ so với `now` (đường gắn tay không có mốc nhận)", () => {
    expect(gioNganHangThuc({ transferredAt: new Date("2026-10-06T09:03:00Z") }, now).toISOString()).toBe("2026-10-06T09:03:00.000Z");
    expect(gioNganHangThuc({ transferredAt: new Date("2699-05-01T03:00:00Z") }, now).getTime()).toBe(now.getTime());
  });

  it("[GNH-16] ngày không hợp lệ ⇒ mốc nhận", () => {
    const nhan = new Date("2026-10-06T09:03:40Z");
    expect(gioNganHangThuc({ transferredAt: new Date("not a date"), createdAt: nhan }, now).getTime()).toBe(nhan.getTime());
  });

  it("[GNH-17] createdAt trong TƯƠNG LAI so với now bị kẹp về now (đồng hồ DB lệch)", () => {
    const r = gioNganHangThuc({ transferredAt: new Date("2699-05-01T03:00:00Z"), createdAt: new Date("2699-05-01T03:00:05Z") }, now);
    expect(r.getTime()).toBe(now.getTime());
  });
});
