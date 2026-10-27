import { describe, it, expect } from "vitest";
import { webPushSubscriptionSchema, DO_DAI_ENDPOINT_TOI_DA } from "./subscription";
import { taoCapKhoaVapid } from "./vapid";

/** p256dh thật là điểm P-256 không nén — mượn luôn bộ sinh khoá để có 65 byte đúng khuôn. */
const p256dh = taoCapKhoaVapid().publicKey;
/** auth thật là 16 byte ngẫu nhiên. */
const auth = Buffer.alloc(16, 7).toString("base64url");

function dangKy(ghiDe: Record<string, unknown> = {}) {
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/cH4nGeD-t0k3n:APA91bF_xyz",
    keys: { p256dh, auth },
    expirationTime: null,
    ...ghiDe,
  };
}

describe("[PUSH-D1-T04] hợp đồng đăng ký từ trình duyệt", () => {
  it("nhận một đăng ký thật", () => {
    expect(webPushSubscriptionSchema.safeParse(dangKy()).success).toBe(true);
  });

  it("nhận cả khi trình duyệt bỏ trống expirationTime", () => {
    const { expirationTime: _bo, ...khongCoHan } = dangKy();
    expect(webPushSubscriptionSchema.safeParse(khongCoHan).success).toBe(true);
  });
});

describe("[PUSH-D1-T05] endpoint", () => {
  it("loại http:// — nếu không, bảng thành bàn đạp SSRF cho engine gửi", () => {
    const r = webPushSubscriptionSchema.safeParse(dangKy({ endpoint: "http://vi-du.test/x" }));
    expect(r.success).toBe(false);
  });

  it("loại scheme lạ và URL tương đối", () => {
    for (const e of ["file:///etc/passwd", "javascript:alert(1)", "/fcm/send/abc", "khong-phai-url"]) {
      expect(webPushSubscriptionSchema.safeParse(dangKy({ endpoint: e })).success).toBe(false);
    }
  });

  it("loại endpoint vượt trần — btree từ chối khoá quá ~2704 byte", () => {
    const qua = `https://fcm.googleapis.com/fcm/send/${"a".repeat(DO_DAI_ENDPOINT_TOI_DA)}`;
    expect(webPushSubscriptionSchema.safeParse(dangKy({ endpoint: qua })).success).toBe(false);
  });

  it("nhận endpoint dài sát trần — đừng chặn nhầm nhà cung cấp có token dài", () => {
    const con = 42;
    const vua = `https://x.test/${"a".repeat(DO_DAI_ENDPOINT_TOI_DA - con)}`;
    expect(vua.length).toBeLessThanOrEqual(DO_DAI_ENDPOINT_TOI_DA);
    expect(webPushSubscriptionSchema.safeParse(dangKy({ endpoint: vua })).success).toBe(true);
  });

  it("loại endpoint rỗng", () => {
    expect(webPushSubscriptionSchema.safeParse(dangKy({ endpoint: "" })).success).toBe(false);
  });
});

describe("[PUSH-D1-T06] khoá mã hoá", () => {
  it("loại p256dh sai độ dài", () => {
    for (const k of ["", p256dh.slice(0, 40), `${p256dh}AAAA`]) {
      const r = webPushSubscriptionSchema.safeParse(dangKy({ keys: { p256dh: k, auth } }));
      expect(r.success).toBe(false);
    }
  });

  it("loại auth sai độ dài — 16 byte, không phải 32", () => {
    const ba2 = Buffer.alloc(32, 7).toString("base64url");
    expect(webPushSubscriptionSchema.safeParse(dangKy({ keys: { p256dh, auth: ba2 } })).success).toBe(
      false,
    );
  });

  it("loại base64 CHUẨN (có + / =) — Web Push chỉ dùng base64url", () => {
    const chuan = Buffer.alloc(16, 251).toString("base64");
    expect(chuan).toMatch(/[+/=]/);
    expect(
      webPushSubscriptionSchema.safeParse(dangKy({ keys: { p256dh, auth: chuan } })).success,
    ).toBe(false);
  });

  it("loại khi thiếu hẳn khối keys", () => {
    const { keys: _bo, ...thieu } = dangKy();
    expect(webPushSubscriptionSchema.safeParse(thieu).success).toBe(false);
  });
});

describe("[PUSH-D1-T08] endpoint — chống SSRF bằng HOST, không phải bằng scheme", () => {
  it("loại địa chỉ IP trần, kể cả khi là https hợp lệ", () => {
    // Đây là ca mà kiểm `https:` KHÔNG bắt được: engine Đợt 4 sẽ tự POST vào endpoint này từ
    // runtime Vercel kèm header VAPID thật, rồi ghi mã trả về vào lastErrorCode — tức kẻ tấn
    // công có cả kênh đọc kết quả.
    for (const e of [
      "https://169.254.169.254/latest/meta-data/", // metadata của máy ảo đám mây
      "https://127.0.0.1:8443/x",
      "https://10.0.0.5/probe",
      "https://192.168.1.1/x",
      "https://[::1]/x",
    ]) {
      expect(webPushSubscriptionSchema.safeParse(dangKy({ endpoint: e })).success).toBe(false);
    }
  });

  it("loại host một nhãn — localhost và tên máy nội bộ", () => {
    for (const e of ["https://localhost/x", "https://metadata/x", "https://intranet/x"]) {
      expect(webPushSubscriptionSchema.safeParse(dangKy({ endpoint: e })).success).toBe(false);
    }
  });

  it("vẫn nhận đủ 4 host push service thật — cổng chặn không được có dương tính giả", () => {
    for (const e of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/abc",
      "https://db5p.notify.windows.com/w/?token=abc",
    ]) {
      expect(webPushSubscriptionSchema.safeParse(dangKy({ endpoint: e })).success).toBe(true);
    }
  });
});

describe("[PUSH-D1-T09] endpoint — chuẩn hoá trước khi lưu", () => {
  it("host viết hoa và dấu cách thừa cho ra CÙNG một giá trị", () => {
    // Cột endpoint là @unique và đường ghi là upsert theo nó. Không chuẩn hoá thì hai chuỗi
    // lệch nhau một ký tự trắng cho ra HAI dòng trỏ về cùng một thiết bị ⇒ máy đó ăn 2 push.
    const a = webPushSubscriptionSchema.safeParse(
      dangKy({ endpoint: "https://FCM.GOOGLEAPIS.COM/fcm/send/abc" }),
    );
    const b = webPushSubscriptionSchema.safeParse(
      dangKy({ endpoint: "  https://fcm.googleapis.com/fcm/send/abc  " }),
    );
    expect(a.success && b.success).toBe(true);
    expect(a.success && b.success && a.data.endpoint).toBe(b.success ? b.data.endpoint : null);
    expect(a.success && a.data.endpoint).toBe("https://fcm.googleapis.com/fcm/send/abc");
  });
});

describe("[PUSH-D1-T10] trần endpoint đo bằng BYTE, không phải ký tự", () => {
  it("loại endpoint đủ ngắn theo ký tự nhưng quá nặng theo byte", () => {
    // btree từ chối khoá quá ~2704 BYTE. `.max()` của Zod đếm code unit UTF-16, nên chuỗi này
    // (2015 ký tự / hơn 4000 byte) từng lọt qua rồi ném Postgres 54000 ở tận môi trường thật.
    const nhieuByte = `https://x.test/${"é".repeat(2000)}`;
    expect(nhieuByte.length).toBeLessThanOrEqual(DO_DAI_ENDPOINT_TOI_DA);
    expect(Buffer.byteLength(nhieuByte, "utf8")).toBeGreaterThan(DO_DAI_ENDPOINT_TOI_DA);
    expect(webPushSubscriptionSchema.safeParse(dangKy({ endpoint: nhieuByte })).success).toBe(false);
  });
});

describe("[PUSH-D1-T07] userId và origin KHÔNG được nhận từ client", () => {
  it("client gửi kèm userId thì giá trị đó bị bỏ, không lọt vào dữ liệu đã kiểm", () => {
    // Luật: userId lấy từ phiên đăng nhập phía server. Test này khoá lời hứa đó ở tầng
    // hợp đồng — nếu ai đó thêm `userId` vào schema, test đỏ và họ phải đọc lại lý do.
    const r = webPushSubscriptionSchema.safeParse(
      dangKy({ userId: "usr_ke_tan_cong", origin: "https://ke-tan-cong.test" }),
    );
    expect(r.success).toBe(true);
    expect(r.success && "userId" in r.data).toBe(false);
    expect(r.success && "origin" in r.data).toBe(false);
  });
});
