import { describe, it, expect } from "vitest";
import {
  taoCapKhoaVapid,
  giaiBase64Url,
  laKhoaCongKhaiVapidHopLe,
  laKhoaRiengVapidHopLe,
  chuanHoaVapidSubject,
  vapidKeyIdTuKhoa,
  khoaCongKhaiTuKhoaRieng,
  DO_DAI_KHOA_CONG_KHAI_BYTE,
  DO_DAI_KHOA_RIENG_BYTE,
} from "./vapid";

describe("[PUSH-D1-T01] sinh cặp khoá VAPID", () => {
  it("ra đúng khuôn Web Push: 87 ký tự công khai / 43 ký tự riêng", () => {
    const { publicKey, privateKey } = taoCapKhoaVapid();
    // Con số này không phải chọn cho đẹp: 65 byte và 32 byte mã hoá base64url không đệm ra
    // đúng 87 và 43. Lệch là hình dạng khoá sai, không phải "cách mã hoá khác".
    expect(publicKey).toHaveLength(87);
    expect(privateKey).toHaveLength(43);
  });

  it("khoá công khai là điểm EC KHÔNG NÉN — push service từ chối điểm nén", () => {
    const { publicKey } = taoCapKhoaVapid();
    const buf = giaiBase64Url(publicKey);
    expect(buf).not.toBeNull();
    expect(buf!.length).toBe(DO_DAI_KHOA_CONG_KHAI_BYTE);
    expect(buf![0]).toBe(0x04);
  });

  it("khoá riêng đúng 32 byte", () => {
    const { privateKey } = taoCapKhoaVapid();
    expect(giaiBase64Url(privateKey)!.length).toBe(DO_DAI_KHOA_RIENG_BYTE);
  });

  it("không dùng bảng chữ cái base64 thường — cấm + / =", () => {
    // Đây là lỗi kinh điển của Web Push: dán khoá base64 chuẩn vào `applicationServerKey`
    // thì trình duyệt ném InvalidCharacterError, còn server thì không báo gì cả.
    const { publicKey, privateKey } = taoCapKhoaVapid();
    for (const k of [publicKey, privateKey]) {
      expect(k).not.toMatch(/[+/=]/);
      expect(k).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("mỗi lượt gọi ra một cặp khác nhau", () => {
    // Nếu hai lượt ra giống nhau thì nguồn ngẫu nhiên hỏng — và mọi môi trường sẽ dùng
    // chung một khoá riêng.
    const a = taoCapKhoaVapid();
    const b = taoCapKhoaVapid();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });

  it("khoá vừa sinh phải tự đi qua được chính bộ kiểm hình dạng", () => {
    // 20 lượt để bắt ca toạ độ có số 0 đứng đầu (xác suất ~1/256 mỗi toạ độ) — đúng ca mà
    // `demTrai` sinh ra để xử lý và là ca không bao giờ lộ ra khi thử tay một lần.
    for (let i = 0; i < 20; i++) {
      const { publicKey, privateKey } = taoCapKhoaVapid();
      expect(laKhoaCongKhaiVapidHopLe(publicKey)).toBe(true);
      expect(laKhoaRiengVapidHopLe(privateKey)).toBe(true);
    }
  });
});

describe("[PUSH-D1-T02] kiểm hình dạng khoá", () => {
  const khoaCongKhaiThat = taoCapKhoaVapid().publicKey;

  it("nhận khoá thật", () => {
    expect(laKhoaCongKhaiVapidHopLe(khoaCongKhaiThat)).toBe(true);
  });

  it("loại chuỗi rỗng, chuỗi rác, và base64 có ký tự ngoài bảng", () => {
    for (const xau of ["", "   ", "khong-phai-khoa", "a+b/c=", "!!!"]) {
      expect(laKhoaCongKhaiVapidHopLe(xau)).toBe(false);
    }
  });

  it("loại khoá đúng bảng chữ cái nhưng SAI ĐỘ DÀI", () => {
    // Ca thật hay gặp: dán thiếu vài ký tự cuối lúc copy từ terminal.
    expect(laKhoaCongKhaiVapidHopLe(khoaCongKhaiThat.slice(0, 80))).toBe(false);
    expect(laKhoaRiengVapidHopLe(khoaCongKhaiThat)).toBe(false);
  });

  it("loại điểm EC NÉN (tiền tố 0x02/0x03) dù đủ bảng chữ cái", () => {
    const buf = giaiBase64Url(khoaCongKhaiThat)!;
    const nen = Buffer.from(buf);
    nen[0] = 0x02;
    expect(laKhoaCongKhaiVapidHopLe(nen.toString("base64url"))).toBe(false);
  });

  it("giaiBase64Url không nuốt ký tự lạ im lặng", () => {
    // Buffer.from(..., 'base64url') BỎ QUA ký tự lạ thay vì ném. Không đối chiếu ngược thì
    // một chuỗi rác vẫn ra Buffer và ta tưởng nó hợp lệ.
    expect(giaiBase64Url("abc!def")).toBeNull();
    expect(giaiBase64Url("abcd")).not.toBeNull();
  });
});

describe("[PUSH-D1-T11] nhãn phiên bản khoá suy từ chính khoá", () => {
  it("cùng khoá cho cùng nhãn, khoá khác cho nhãn khác", () => {
    // Đây là thứ làm cột `vapidKeyId` nói thật: xoay khoá thì nhãn TỰ đổi, không phụ thuộc trí
    // nhớ người vận hành. Hằng "v1" gõ tay sẽ nói dối đúng ngày cần nó nhất.
    const a = taoCapKhoaVapid().publicKey;
    const b = taoCapKhoaVapid().publicKey;
    expect(vapidKeyIdTuKhoa(a)).toBe(vapidKeyIdTuKhoa(a));
    expect(vapidKeyIdTuKhoa(a)).not.toBe(vapidKeyIdTuKhoa(b));
  });

  it("nhãn là 8 ký tự hex — vừa cột TEXT, không lộ gì", () => {
    expect(vapidKeyIdTuKhoa(taoCapKhoaVapid().publicKey)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("[PUSH-D1-T03] VAPID_SUBJECT", () => {
  it("nhận mailto: và https:", () => {
    expect(chuanHoaVapidSubject("mailto:it@satarobo.vn")).toBe("mailto:it@satarobo.vn");
    expect(chuanHoaVapidSubject("  https://satarobo.vn  ")).toBe("https://satarobo.vn");
  });

  it("loại scheme khác, và loại scheme trần không có phần thân", () => {
    for (const xau of ["it@satarobo.vn", "http://satarobo.vn", "mailto:", "https://", ""]) {
      expect(chuanHoaVapidSubject(xau)).toBeNull();
    }
  });
});

describe("[PUSH-D1-T05] suy khoá công khai từ khoá riêng", () => {
  it("suy ra ĐÚNG nửa còn lại của chính cặp khoá đó", () => {
    for (let i = 0; i < 5; i++) {
      const cap = taoCapKhoaVapid();
      expect(khoaCongKhaiTuKhoaRieng(cap.privateKey)).toBe(cap.publicKey);
    }
  });

  it("khoá riêng của cặp KHÁC ra khoá công khai KHÁC — đó là điều cổng cấu hình dựa vào", () => {
    // Đây là thứ biến "xoay khoá mà quên deploy" từ một sự cố im lặng (403 cho MỌI thiết bị,
    // cả hàng đợi thành DEAD trong vài phút) thành một dòng lỗi đọc được: `VAPID_PRIVATE_KEY`
    // là biến RUNTIME còn `NEXT_PUBLIC_VAPID_PUBLIC_KEY` bị nhúng lúc BUILD, nên hai nửa có
    // hai vòng đời khác nhau và LỆCH ĐƯỢC.
    const a = taoCapKhoaVapid();
    const b = taoCapKhoaVapid();
    expect(khoaCongKhaiTuKhoaRieng(a.privateKey)).not.toBe(b.publicKey);
  });

  it("khoá riêng rác / sai độ dài / rỗng ⇒ null, không ném", () => {
    expect(khoaCongKhaiTuKhoaRieng("")).toBeNull();
    expect(khoaCongKhaiTuKhoaRieng("khong-phai-base64url!!!")).toBeNull();
    expect(khoaCongKhaiTuKhoaRieng(Buffer.alloc(16).toString("base64url"))).toBeNull();
    // Đúng 32 byte nhưng toàn số 0 — nằm ngoài miền hợp lệ của P-256, `setPrivateKey` ném.
    expect(khoaCongKhaiTuKhoaRieng(Buffer.alloc(32).toString("base64url"))).toBeNull();
  });

  it("khoá suy ra luôn là điểm KHÔNG NÉN 65 byte — đúng khuôn Web Push", () => {
    const cap = taoCapKhoaVapid();
    const suy = khoaCongKhaiTuKhoaRieng(cap.privateKey);
    expect(suy).not.toBeNull();
    expect(laKhoaCongKhaiVapidHopLe(suy as string)).toBe(true);
  });
});
