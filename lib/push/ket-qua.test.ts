// Luật thử-lại của Web Push: phân loại mã HTTP, đọc Retry-After, backoff, chốt số phận dòng.
//
// THUẦN — không DB, không mạng, không gói `web-push`. Đây là chỗ ~80% ma trận lỗi được chứng
// minh mà không phải dựng gì; `engine.test.ts` chỉ còn phải chứng minh phần nối dây.

import { describe, expect, it } from "vitest";
import {
  backoffMs,
  bamEndpoint,
  chotKetCuc,
  CHO_CO_SO_MS,
  docRetryAfterMs,
  docSoKetQua,
  nhanEndpoint,
  phanLoaiMa,
  TRAN_CHO_MS,
  TRAN_RETRY_AFTER_MS,
} from "./ket-qua";

const NOW = new Date("2026-09-08T10:00:00.000Z");
const EP = "https://fcm.googleapis.com/wp/dGhpcy1pcy1hLXRlc3QtZW5kcG9pbnQ";

describe("[PUSH-D4-T01] phân loại mã HTTP", () => {
  it("201 (mã push service THẬT trả về khi nhận) ⇒ THÀNH CÔNG", () => {
    // 201 chứ không phải 200: đây là mã thật của FCM/autopush. Một nhánh chỉ bắt 200 sẽ coi
    // mọi cú gửi thành công là thất bại và bắn lại tới khi cạn lượt.
    expect(phanLoaiMa(201)).toBe("THANH_CONG");
    expect(phanLoaiMa(200)).toBe("THANH_CONG");
    expect(phanLoaiMa(204)).toBe("THANH_CONG");
  });

  it("404 và 410 ⇒ HẾT HẠN — hai mã khác nhau, cùng một nghĩa (RFC 8030 §7.3)", () => {
    expect(phanLoaiMa(404)).toBe("HET_HAN");
    expect(phanLoaiMa(410)).toBe("HET_HAN");
  });

  it("429 · 408 · mọi 5xx ⇒ THỬ LẠI", () => {
    expect(phanLoaiMa(429)).toBe("THU_LAI");
    expect(phanLoaiMa(408)).toBe("THU_LAI");
    expect(phanLoaiMa(500)).toBe("THU_LAI");
    expect(phanLoaiMa(502)).toBe("THU_LAI");
    expect(phanLoaiMa(503)).toBe("THU_LAI");
  });

  it("400 · 413 ⇒ CHẾT: lỗi của TA, thử lại là lặp lại đúng lỗi cũ", () => {
    expect(phanLoaiMa(400)).toBe("CHET");
    expect(phanLoaiMa(413)).toBe("CHET");
  });

  it("403 ⇒ CHẾT chứ KHÔNG hết hạn — khoá server xoay, máy người dùng vẫn tốt", () => {
    // Phân biệt này là cả một quyết định vận hành: gộp 403 vào HẾT_HẠN thì ngày xoay khoá
    // VAPID, hệ thống tự gỡ TOÀN BỘ thiết bị của công ty và mọi người phải bật lại bằng tay —
    // trong khi việc phải làm chỉ là dán lại khoá cũ.
    expect(phanLoaiMa(403)).toBe("CHET");
  });

  it("không có phản hồi (đứt mạng / socket timeout) ⇒ THỬ LẠI, không gỡ thiết bị", () => {
    // Hạ tầng của TA hỏng, không phải đăng ký của người dùng hỏng. Gỡ ở đây là tự huỷ kênh
    // của cả công ty trong một sự cố mạng 5 phút.
    expect(phanLoaiMa(null)).toBe("THU_LAI");
    expect(phanLoaiMa(undefined)).toBe("THU_LAI");
  });
});

describe("[PUSH-D4-T02] đọc Retry-After", () => {
  it("dạng số giây", () => {
    expect(docRetryAfterMs({ "retry-after": "120" }, NOW)).toBe(120_000);
  });

  it("dạng mốc HTTP-date — dạng thứ hai mà RFC cho phép và push service DÙNG THẬT", () => {
    // Chỉ parse `Number()` là bỏ sót im lặng nửa số ca, và "bỏ sót" ở đây nghĩa là thử lại
    // sớm hơn push service yêu cầu, tức tự chuốc thêm 429.
    const moc = new Date(NOW.getTime() + 90_000).toUTCString();
    expect(docRetryAfterMs({ "retry-after": moc }, NOW)).toBe(90_000);
  });

  it("khoá header phải VIẾT THƯỜNG — đúng hình dạng `node:http` đưa ra", () => {
    // Đây là hình dạng đường THẬT: `web-push` truyền thẳng `http.IncomingMessage.headers`, mà
    // Node hạ mọi khoá về chữ thường. Một cổng chỉ đọc "Retry-After" sẽ xanh trong test tự
    // viết và trượt trên prod.
    expect(docRetryAfterMs({ "retry-after": "30" }, NOW)).toBe(30_000);
  });

  it("vắng header / chuỗi rác / mảng rỗng ⇒ null, KHÔNG phải NaN", () => {
    // `Number(undefined)` = NaN, và `new Date(now + NaN)` là Invalid Date — Prisma sẽ ném ở
    // tận đường ghi, cách xa chỗ sinh lỗi.
    expect(docRetryAfterMs({}, NOW)).toBeNull();
    expect(docRetryAfterMs(undefined, NOW)).toBeNull();
    expect(docRetryAfterMs(null, NOW)).toBeNull();
    expect(docRetryAfterMs({ "retry-after": "lát nữa nhé" }, NOW)).toBeNull();
    expect(docRetryAfterMs({ "retry-after": "" }, NOW)).toBeNull();
  });

  it("giá trị mảng (Node cho phép) ⇒ lấy phần tử đầu", () => {
    expect(docRetryAfterMs({ "retry-after": ["45", "99"] }, NOW)).toBe(45_000);
  });

  it("mốc trong QUÁ KHỨ ⇒ 0, không bao giờ âm", () => {
    const cu = new Date(NOW.getTime() - 600_000).toUTCString();
    expect(docRetryAfterMs({ "retry-after": cu }, NOW)).toBe(0);
  });

  it("Retry-After 1 GIỜ được tôn trọng nguyên vẹn, KHÔNG bị kẹp xuống trần backoff", () => {
    // Ca này là cả một lỗi từng có: kẹp `Retry-After` xuống 30 phút nghĩa là gọi lại khi vẫn
    // còn trong cửa sổ push service vừa xin ⇒ ăn thêm 429 ⇒ lặp tới khi cạn lượt rồi DEAD.
    // Đúng lúc bị bóp, hệ thống tự đốt hết lượt thử và mất push im lặng.
    expect(docRetryAfterMs({ "retry-after": "3600" }, NOW)).toBe(3_600_000);
    expect(3_600_000).toBeGreaterThan(TRAN_CHO_MS);
  });

  it("Retry-After khổng lồ vẫn bị kẹp — không cho một dòng thành xác sống", () => {
    // `Retry-After: 86400` (24h) mà tôn trọng nguyên xi thì `nextAttemptAt` vượt xa `expiresAt`
    // (6 giờ), dòng không bao giờ tới lượt và cũng không bao giờ chết.
    expect(docRetryAfterMs({ "retry-after": "86400" }, NOW)).toBe(TRAN_RETRY_AFTER_MS);
  });
});

describe("[PUSH-D4-T03] backoff nhân đôi", () => {
  it("1→1 phút, 2→2, 3→4, 4→8 phút", () => {
    expect(backoffMs(1)).toBe(CHO_CO_SO_MS);
    expect(backoffMs(2)).toBe(2 * CHO_CO_SO_MS);
    expect(backoffMs(3)).toBe(4 * CHO_CO_SO_MS);
    expect(backoffMs(4)).toBe(8 * CHO_CO_SO_MS);
  });

  it("kẹp trần 30 phút, và không tràn số dù maxAttempts bị đặt to", () => {
    expect(backoffMs(50)).toBe(TRAN_CHO_MS);
    expect(Number.isFinite(backoffMs(1000))).toBe(true);
  });

  it("số lần thử 0 hoặc âm vẫn cho khoảng chờ dương", () => {
    expect(backoffMs(0)).toBe(CHO_CO_SO_MS);
    expect(backoffMs(-3)).toBe(CHO_CO_SO_MS);
  });
});

describe("[PUSH-D4-T04] băm + nhãn endpoint", () => {
  it("băm TẤT ĐỊNH — cùng endpoint ra cùng khoá, khác endpoint ra khác khoá", () => {
    // Tất định là tính chất DUY NHẤT khoá này cần: lượt thử sau tra lại "máy này đã nhận chưa".
    expect(bamEndpoint(EP)).toBe(bamEndpoint(EP));
    expect(bamEndpoint(EP)).not.toBe(bamEndpoint(`${EP}x`));
  });

  it("băm KHÔNG chứa lại endpoint — nó là khả năng gửi, không phải một cái id vô hại", () => {
    const b = bamEndpoint(EP);
    expect(b).toMatch(/^[0-9a-f]{16}$/);
    expect(EP).not.toContain(b);
  });

  it("nhãn có host (để lần ra nhà cung cấp) nhưng KHÔNG đủ để gửi lại", () => {
    const n = nhanEndpoint(EP);
    expect(n).toContain("fcm.googleapis.com");
    expect(n.length).toBeLessThan(EP.length);
    expect(EP.startsWith(n)).toBe(false);
  });

  it("endpoint rác vẫn ra được một nhãn, không ném", () => {
    expect(() => nhanEndpoint("không-phải-url")).not.toThrow();
  });
});

describe("[PUSH-D4-T05] đọc sổ kết quả từ cột Json", () => {
  it("đọc lại đúng dòng đã ghi", () => {
    const so = { abc: { may: "fcm/…123", code: 201, loai: "THANH_CONG", at: "2026-09-08" } };
    expect(docSoKetQua(so).abc?.loai).toBe("THANH_CONG");
  });

  it("null / số / mảng / chuỗi ⇒ sổ rỗng, KHÔNG ném", () => {
    // Cột là `Json?`: Prisma trả về được cả bốn thứ này. Ép kiểu bằng `as` là mời một
    // TypeError ở đúng đường gửi.
    expect(docSoKetQua(null)).toEqual({});
    expect(docSoKetQua(7)).toEqual({});
    expect(docSoKetQua([1, 2])).toEqual({});
    expect(docSoKetQua("x")).toEqual({});
  });

  it("dòng có `loai` lạ bị BỎ — coi như chưa gửi cho máy đó", () => {
    // Fail-safe đúng chiều: hình dạng hỏng ⇒ gửi lại (phiền) chứ không ⇒ coi là đã gửi (mất tin).
    const so = { a: { loai: "XONG_ROI", code: 201 }, b: { loai: "THANH_CONG", code: 201 } };
    const doc = docSoKetQua(so);
    expect(Object.keys(doc)).toEqual(["b"]);
  });
});

describe("[PUSH-D4-T06] chốt số phận dòng outbox", () => {
  const CO_BAN = { soLanDaThu: 1, maxAttempts: 5, now: NOW };

  it("không còn thiết bị nào ⇒ SKIPPED, không phải DEAD", () => {
    // Người đó chỉ là chưa bật thông báo trên máy nào — không có gì hỏng. Đánh DEAD là nhuộm
    // đỏ sổ vận hành bằng những dòng không ai phải làm gì cả.
    const k = chotKetCuc({ ...CO_BAN, ketQua: [] });
    expect(k.status).toBe("SKIPPED");
    expect(k.sentAt).toBeNull();
  });

  it("mọi máy nhận được ⇒ SENT + có mốc gửi", () => {
    const k = chotKetCuc({ ...CO_BAN, ketQua: [{ loai: "THANH_CONG" }, { loai: "THANH_CONG" }] });
    expect(k.status).toBe("SENT");
    expect(k.sentAt).toEqual(NOW);
    expect(k.nextAttemptAt).toBeNull();
  });

  it("còn máy đáng thử lại và chưa cạn lượt ⇒ FAILED + hẹn giờ theo backoff", () => {
    const k = chotKetCuc({ ...CO_BAN, ketQua: [{ loai: "THU_LAI" }] });
    expect(k.status).toBe("FAILED");
    expect(k.nextAttemptAt?.getTime()).toBe(NOW.getTime() + backoffMs(1));
  });

  it("429 có Retry-After DÀI hơn backoff ⇒ tôn trọng Retry-After", () => {
    const k = chotKetCuc({ ...CO_BAN, ketQua: [{ loai: "THU_LAI", choMs: 600_000 }] });
    expect(k.nextAttemptAt?.getTime()).toBe(NOW.getTime() + 600_000);
  });

  it("Retry-After NGẮN hơn nhịp cron ⇒ vẫn chờ ít nhất một nhịp", () => {
    // "Tôn trọng Retry-After" nghĩa là không gọi lại SỚM hơn nó xin. Lấy thẳng số 1 giây thì
    // lượt cron kế (1 phút nữa) mới chạy — hẹn 1 giây chỉ là một con số vô nghĩa trong DB.
    const k = chotKetCuc({ ...CO_BAN, ketQua: [{ loai: "THU_LAI", choMs: 1_000 }] });
    expect(k.nextAttemptAt?.getTime()).toBe(NOW.getTime() + backoffMs(1));
  });

  it("cạn lượt mà vẫn còn máy đáng thử ⇒ DEAD", () => {
    const k = chotKetCuc({ ...CO_BAN, soLanDaThu: 5, ketQua: [{ loai: "THU_LAI" }] });
    expect(k.status).toBe("DEAD");
    expect(k.nextAttemptAt).toBeNull();
  });

  it("một máy nhận được, máy kia cạn lượt ⇒ SENT — người đó ĐÃ được báo", () => {
    // Đánh DEAD ở đây là nói dối trong sổ và kéo người trực đi xử lý một việc không tồn tại.
    const k = chotKetCuc({
      ...CO_BAN,
      soLanDaThu: 5,
      ketQua: [{ loai: "THANH_CONG" }, { loai: "THU_LAI" }],
    });
    expect(k.status).toBe("SENT");
  });

  it("mọi máy chết hẳn (410 + 400), không máy nào nhận ⇒ DEAD", () => {
    const k = chotKetCuc({ ...CO_BAN, ketQua: [{ loai: "HET_HAN" }, { loai: "CHET" }] });
    expect(k.status).toBe("DEAD");
  });

  it("410 ở máy này + thành công ở máy kia ⇒ SENT ngay lượt đầu, không chờ thêm", () => {
    const k = chotKetCuc({ ...CO_BAN, ketQua: [{ loai: "HET_HAN" }, { loai: "THANH_CONG" }] });
    expect(k.status).toBe("SENT");
    expect(k.nextAttemptAt).toBeNull();
  });
});
