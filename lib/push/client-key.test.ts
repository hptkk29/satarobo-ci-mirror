import { describe, it, expect } from "vitest";
import {
  bamEndpointOClient,
  khoaVapidSangBytes,
  laKhoaVapidHopLeOClient,
  DO_DAI_KHOA_BYTE,
} from "./client-key";
import { bamEndpoint } from "./ket-qua";
import { taoCapKhoaVapid, giaiBase64Url } from "./vapid";

/** Khoá THẬT, sinh bằng đúng bộ sinh của Đợt 1 — không gõ tay một chuỗi mẫu. */
const KHOA = taoCapKhoaVapid().publicKey;

describe("[PUSH-D3-T04] chuyển khoá cho trình duyệt — KHÔNG dùng Buffer", () => {
  it("khoá thật ra đúng 65 byte, tiền tố 0x04", () => {
    const b = khoaVapidSangBytes(KHOA);
    expect(b).toBeInstanceOf(Uint8Array);
    expect(b.length).toBe(DO_DAI_KHOA_BYTE);
    expect(b[0]).toBe(0x04);
  });

  it("cho ra ĐÚNG cùng byte với bộ giải phía Node — hai bản không được lệch nhau", () => {
    // `lib/push/vapid.ts` là NODE-ONLY (dùng Buffer) nên client phải có bản riêng. Trùng lặp có
    // chủ đích; test này là thứ giữ hai bản nói cùng một chuyện.
    const nodeBytes = giaiBase64Url(KHOA);
    expect(nodeBytes).not.toBeNull();
    expect(Array.from(khoaVapidSangBytes(KHOA))).toEqual(Array.from(nodeBytes!));
  });

  it("tự đệm '=' cho chuỗi 87 ký tự — thiếu bước này là atob ném và trông như 'khoá sai'", () => {
    expect(KHOA.length % 4).toBe(3);
    expect(() => khoaVapidSangBytes(KHOA)).not.toThrow();
  });

  it("KHÔNG dùng Buffer — hàm chạy được khi Buffer vắng mặt", () => {
    // Mô phỏng bundle client của Next 16: không có `Buffer`. Nếu ai đó lỡ import
    // `giaiBase64Url` của vapid.ts vào đây thì ca này đỏ.
    const luu = (globalThis as { Buffer?: unknown }).Buffer;
    delete (globalThis as { Buffer?: unknown }).Buffer;
    try {
      expect(khoaVapidSangBytes(KHOA).length).toBe(DO_DAI_KHOA_BYTE);
    } finally {
      (globalThis as { Buffer?: unknown }).Buffer = luu;
    }
  });
});

describe("[PUSH-D3-T05] kiểm khoá TRƯỚC khi gọi subscribe", () => {
  it("nhận khoá thật", () => {
    expect(laKhoaVapidHopLeOClient(KHOA)).toBe(true);
  });

  it("loại chuỗi rỗng / undefined / null — ca env chưa cấu hình", () => {
    // Biến `NEXT_PUBLIC_VAPID_PUBLIC_KEY` nhúng lúc build; để nhầm biến Sensitive trên Vercel là
    // trình duyệt nhận undefined. Bắt ở đây thì màn hình nói được "chưa cấu hình khoá".
    for (const x of ["", undefined, null]) expect(laKhoaVapidHopLeOClient(x)).toBe(false);
  });

  it("loại chuỗi rác và khoá sai độ dài, không ném ra ngoài", () => {
    for (const x of ["khong-phai-khoa", "!!!", KHOA.slice(0, 40), `${KHOA}AAAA`]) {
      expect(() => laKhoaVapidHopLeOClient(x)).not.toThrow();
      expect(laKhoaVapidHopLeOClient(x)).toBe(false);
    }
  });

  it("loại điểm EC NÉN (0x02) dù đủ độ dài", () => {
    const b = khoaVapidSangBytes(KHOA);
    b[0] = 0x02;
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    const nen = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(laKhoaVapidHopLeOClient(nen)).toBe(false);
  });
});

// ── ĐỢT 5: băm endpoint ở trình duyệt phải KHỚP bản Node ────────────────────────────────
describe("[PUSH-D5-T12] bamEndpointOClient khớp từng byte với bamEndpoint (Node)", () => {
  it("bốn hình dạng endpoint thật đều ra cùng chuỗi", async () => {
    // Lệch một byte là màn hình không bao giờ nhận ra máy đang dùng, và triệu chứng ("không
    // thấy nhãn máy này") trông y hệt "chưa đăng ký" — người dùng sẽ bấm bật lại lần nữa, tạo
    // thêm một đăng ký. Đây là lý do hai bản song song PHẢI có test so hai đầu, đúng như cặp
    // `khoaVapidSangBytes` / `giaiBase64Url` ở trên.
    const eps = [
      "https://fcm.googleapis.com/wp/dGhpcy1pcy1hLXRlc3QtZW5kcG9pbnQ",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA_abc-123",
      "https://abc.notify.windows.com/w/?token=Ab%2bCd%2fEf",
      // Có dấu tiếng Việt trong query: bảo đảm hai bản cùng mã hoá UTF-8 (TextEncoder vs
      // Buffer.from(..., "utf8")) chứ không phải latin1.
      "https://fcm.googleapis.com/wp/co-dau-nhé",
    ];
    for (const ep of eps) {
      expect(await bamEndpointOClient(ep)).toBe(bamEndpoint(ep));
    }
  });

  it("chuỗi rỗng ⇒ null, không ném (mất nhãn 'máy này' chứ không vỡ màn hình)", async () => {
    expect(await bamEndpointOClient("")).toBeNull();
  });
});
