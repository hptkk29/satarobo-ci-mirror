// @vitest-environment node
// (jsdom làm jose 6 chê `TextEncoder().encode()` — Uint8Array khác realm. Cùng lý do
//  đã ghi ở `lib/chat/realtime-token.test.ts`, file mà bộ này copy khuôn.)
//
// S1 · SSO sang ZaloCRM. Đây là bộ test DUY NHẤT kiểm được đường ký khi fork CHƯA TỒN
// TẠI: tách "việc KÝ" (repo này) khỏi "việc DÙNG" (F1, repo khác) rồi tự `jwtVerify`
// bằng chính secret. Thứ còn mù là "fork có chấp nhận không" — smoke tay ở GĐ1.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jwtVerify, decodeJwt } from "jose";

// DB giả: 1 user in-memory — chỉnh state từng test (khuôn realtime-token.test.ts).
let dbUser: { tokenVersion: number; isActive: boolean; deletedAt: Date | null } | null = null;

vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: vi.fn(async () => dbUser) } },
}));

import {
  mintSsoToken,
  taoClaimsSso,
  duongDanNhungZaloCrm,
  ZalocrmSsoError,
  ZALOCRM_SSO_TTL_SECONDS,
  KHOA_CLAIM_SSO,
} from "./sso";

const SECRET = "zztest-zalocrm-sso-secret-chi-dung-cho-unit-test";
const KHOA = new TextEncoder().encode(SECRET);

const VAO = {
  userId: "clzztestuser0001abcdefgh",
  tokenVersion: 7,
  orgCode: "cs1",
  role: "member" as const,
  fullName: "Nguyễn Văn Sale",
  email: "sale.cs1@satarobo.vn",
};

let secretCu: string | undefined;

beforeEach(() => {
  secretCu = process.env.ZALOCRM_SSO_SECRET;
  process.env.ZALOCRM_SSO_SECRET = SECRET;
  dbUser = { tokenVersion: 7, isActive: true, deletedAt: null };
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T03:00:00.000Z"));
});

afterEach(() => {
  if (secretCu === undefined) delete process.env.ZALOCRM_SSO_SECRET;
  else process.env.ZALOCRM_SSO_SECRET = secretCu;
  vi.useRealTimers();
});

describe("mintSsoToken — vé SSO 60 giây vào ZaloCRM", () => {
  it("[ZC-SSO-01] claims đủ: sub, orgCode, role, fullName, jti, iat, exp", async () => {
    const { token } = await mintSsoToken(VAO);
    const { payload, protectedHeader } = await jwtVerify(token, KHOA);

    expect(protectedHeader.alg).toBe("HS256");
    // `sub` = User.id THẬT của Sata (cuid). Fork upsert `User` theo cột `external_id`
    // = giá trị này, nên đổi sang uuid dẫn xuất (kiểu realtime-token) là tạo tài khoản
    // mới mỗi lần đổi cách dẫn xuất.
    expect(payload.sub).toBe(VAO.userId);
    expect(payload.orgCode).toBe("cs1");
    expect(payload.role).toBe("member");
    expect(payload.fullName).toBe("Nguyễn Văn Sale");
    expect(typeof payload.jti).toBe("string");
    expect(payload.jti).not.toBe("");
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
  });

  it("[ZC-SSO-02] exp − iat === 60 và expiresAt khớp exp", async () => {
    const { token, expiresAt } = await mintSsoToken(VAO);
    const payload = decodeJwt(token);
    expect(payload.exp! - payload.iat!).toBe(ZALOCRM_SSO_TTL_SECONDS);
    expect(ZALOCRM_SSO_TTL_SECONDS).toBe(60);
    expect(expiresAt.getTime()).toBe(payload.exp! * 1000);
    expect(payload.iat).toBe(Math.floor(Date.now() / 1000));
  });

  it("[ZC-SSO-03] jti khác nhau giữa hai lần ký (fork dùng jti một lần)", async () => {
    const a = decodeJwt((await mintSsoToken(VAO)).token);
    const b = decodeJwt((await mintSsoToken(VAO)).token);
    expect(a.jti).not.toBe(b.jti);
  });

  it("[ZC-SSO-04] verify bằng secret khác ⇒ ném", async () => {
    const { token } = await mintSsoToken(VAO);
    await expect(
      jwtVerify(token, new TextEncoder().encode("mot-secret-hoan-toan-khac-32-ky-tu!!")),
    ).rejects.toThrow();
  });

  it("[ZC-SSO-05] thiếu ZALOCRM_SSO_SECRET ⇒ MISSING_SECRET, KHÔNG ký token rỗng", async () => {
    delete process.env.ZALOCRM_SSO_SECRET;
    await expect(mintSsoToken(VAO)).rejects.toBeInstanceOf(ZalocrmSsoError);
    await expect(mintSsoToken(VAO)).rejects.toMatchObject({ code: "MISSING_SECRET" });

    // Chuỗi rỗng cũng là "thiếu" — env chưa khai trên Vercel về đây dưới dạng "".
    process.env.ZALOCRM_SSO_SECRET = "";
    await expect(mintSsoToken(VAO)).rejects.toMatchObject({ code: "MISSING_SECRET" });
  });

  it("[ZC-SSO-06] token KHÔNG chứa SĐT/email phụ huynh — bộ claim là DANH SÁCH ĐÓNG", async () => {
    const { token } = await mintSsoToken({ ...VAO, role: "admin" });
    const payload = decodeJwt(token);

    // Không assert "không có chuỗi X" (dễ xanh giả), mà chốt cứng BỘ KHOÁ. Thêm một
    // claim mới — kể cả vô hại — buộc người thêm phải đọc lại chú thích ở KHOA_CLAIM_SSO
    // và tự hỏi dữ liệu đó có phải PII không. Vé này đi trong `#fragment` của URL, tức
    // nằm lại trong lịch sử trình duyệt của máy Sale.
    expect(Object.keys(payload).sort()).toEqual([...KHOA_CLAIM_SSO].sort());

    // Lưới thứ hai, độc lập với bộ khoá: không GIÁ TRỊ CHUỖI nào chứa dãy số dài kiểu
    // số điện thoại. Chỉ soi giá trị chuỗi, vì `iat`/`exp` là mốc unix 10 chữ số —
    // quét cả `JSON.stringify(payload)` thì ca này đỏ vĩnh viễn vì lý do sai.
    //
    // ⚠️ `jti` ĐỨNG NGOÀI phép quét này, và không phải để "cho ca xanh": nó là
    // `randomUUID()`, tức 32 chữ số hex ngẫu nhiên — có xác suất thật rơi vào 9 chữ số
    // liền nhau. Bản đầu quét cả nó nên ca này ĐỎ CHẬP CHỜN vài phần trăm số lượt: chạy
    // lẻ thì xanh, chạy cả bộ thì thỉnh thoảng đỏ, và CI đã dính đúng một lần
    // (`jti = …bfe545568673`). Một ca đỏ ngẫu nhiên còn tệ hơn không có ca: nó dạy cả
    // đội thói quen chạy lại cho xanh, rồi lần đỏ THẬT cũng bị chạy lại.
    // Răng của lưới không mất: `jti` do mã này sinh, không nhận gì từ bên gọi, và phép
    // chốt BỘ KHOÁ ở trên vẫn bắt mọi claim mới xuất hiện.
    for (const [khoa, giaTri] of Object.entries(payload)) {
      if (typeof giaTri !== "string" || khoa === "jti") continue;
      expect(giaTri, `claim "${khoa}" chứa dãy số giống SĐT: ${giaTri}`).not.toMatch(/\d{9,}/);
    }
    // Và không claim nào mang tên gợi ý dữ liệu liên hệ của khách.
    const chuoi = JSON.stringify(payload).toLowerCase();
    for (const cam of ["phone", "sdt", "parent", "contact", "zalo_id", "customer"]) {
      expect(chuoi, `claims không được mang "${cam}"`).not.toContain(`"${cam}`);
    }
  });

  it("[ZC-SSO-06b] email nhân viên là TUỲ CHỌN — vắng thì claim biến mất, không thành null", async () => {
    const { token } = await mintSsoToken({ ...VAO, email: null });
    const payload = decodeJwt(token);
    expect("email" in payload).toBe(false);
    // Bộ khoá co lại đúng một phần tử, không sinh khoá lạ.
    expect(Object.keys(payload).sort()).toEqual(
      [...KHOA_CLAIM_SSO].filter((k) => k !== "email").sort(),
    );
  });

  it("tokenVersion trong DB lệch với phiên ⇒ từ chối (chống đăng-xuất-cưỡng-bức)", async () => {
    dbUser = { tokenVersion: 8, isActive: true, deletedAt: null };
    await expect(mintSsoToken(VAO)).rejects.toMatchObject({
      name: "ZalocrmSsoError",
      code: "TOKEN_VERSION_MISMATCH",
    });
  });

  it("user không tồn tại / đã xoá mềm / bị khoá ⇒ USER_NOT_FOUND", async () => {
    dbUser = null;
    await expect(mintSsoToken(VAO)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });

    dbUser = { tokenVersion: 7, isActive: true, deletedAt: new Date() };
    await expect(mintSsoToken(VAO)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });

    dbUser = { tokenVersion: 7, isActive: false, deletedAt: null };
    await expect(mintSsoToken(VAO)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });

  it("orgCode rỗng / sai khuôn ⇒ NO_ORG (không ký vé vào 'org rỗng')", async () => {
    await expect(mintSsoToken({ ...VAO, orgCode: "" })).rejects.toMatchObject({
      code: "NO_ORG",
    });
    // Cùng khuôn `^[a-z0-9-]{1,32}$` với ô cấu hình `zalocrm.orgCodes` và với đường
    // webhook `/api/webhooks/zalocrm/<org>` — ba nơi nói cùng một câu.
    await expect(mintSsoToken({ ...VAO, orgCode: "CS1" })).rejects.toMatchObject({
      code: "NO_ORG",
    });
    await expect(mintSsoToken({ ...VAO, orgCode: "cs1/../cs2" })).rejects.toMatchObject({
      code: "NO_ORG",
    });
  });
});

describe("taoClaimsSso — phần THUẦN, không chạm DB", () => {
  it("[ZC-SSO-09] không ký, không đọc env — chỉ dựng claims (test được ở mọi môi trường)", () => {
    delete process.env.ZALOCRM_SSO_SECRET;
    const claims = taoClaimsSso({ ...VAO, jti: "jti-co-dinh" });
    expect(claims).toEqual({
      sub: VAO.userId,
      orgCode: "cs1",
      role: "member",
      fullName: "Nguyễn Văn Sale",
      email: "sale.cs1@satarobo.vn",
      jti: "jti-co-dinh",
    });
  });

  it("[ZC-SSO-10] fullName rỗng ⇒ NO_ROLE không phải chỗ này; tên trống thành chuỗi rỗng an toàn", () => {
    const claims = taoClaimsSso({ ...VAO, fullName: "", email: undefined, jti: "x" });
    expect(claims.fullName).toBe("");
    expect("email" in claims).toBe(false);
  });
});

describe("duongDanNhungZaloCrm — địa chỉ iframe", () => {
  const APP = "https://zalo.satarobo.vn";

  /** Hàm trả `string | null`; ở các ca "đường vui" phải có URL, thiếu là hỏng ngay tại đây. */
  function duongDan(vao: Parameters<typeof duongDanNhungZaloCrm>[0]): string {
    const url = duongDanNhungZaloCrm(vao);
    expect(url, "phải dựng được địa chỉ nhúng").not.toBeNull();
    return url!;
  }

  it("[ZC-SSO-11] token nằm trong FRAGMENT, tuyệt đối không vào query", () => {
    const url = duongDan({ appUrl: APP, token: "TOKEN.AB.CD" });
    const u = new URL(url);
    expect(u.search).toBe(""); // không một tham số query nào
    expect(u.hash.startsWith("#")).toBe(true);
    const frag = new URLSearchParams(u.hash.slice(1));
    expect(frag.get("token")).toBe("TOKEN.AB.CD");
    expect(frag.get("next")).toBe("/chat");
    // Fragment KHÔNG được gửi lên máy chủ ⇒ không vào access log của Cloudflare/fork.
    expect(url).toContain("#");
    expect(url.split("#")[0]).not.toContain("TOKEN");
  });

  it("[ZC-SSO-12] có compose ⇒ next = /chat?compose=<SĐT chuẩn 84…>", () => {
    const url = duongDan({ appUrl: APP, token: "T", compose: "84912345678" });
    const frag = new URLSearchParams(new URL(url).hash.slice(1));
    expect(frag.get("next")).toBe("/chat?compose=84912345678");
  });

  it("[ZC-SSO-13] compose sai khuôn ⇒ BỎ QUA, không nhét chuỗi lạ vào URL của fork", () => {
    // Mỗi lần tra SĐT là một `PhoneSearchEvent` tính vào hạn mức Zalo (kế hoạch §S2).
    // Chuyển tiếp rác = đốt hạn mức bằng một truy vấn chắc chắn không ra ai.
    for (const rac of ["", "0912345678", "+84912345678", "abc", "84912345678&x=1", "8491234567890123"]) {
      const frag = new URLSearchParams(
        new URL(duongDan({ appUrl: APP, token: "T", compose: rac })).hash.slice(1),
      );
      expect(frag.get("next"), `compose="${rac}" phải bị bỏ`).toBe("/chat");
    }
  });

  it("[ZC-SSO-14] appUrl có dấu / thừa vẫn ra đúng một /sso", () => {
    const url = duongDan({ appUrl: "https://zalo.satarobo.vn/", token: "T" });
    expect(url.split("#")[0]).toBe("https://zalo.satarobo.vn/sso");
  });

  it("[ZC-SSO-15] appUrl rỗng/không hợp lệ ⇒ null (trang tự hiện hướng dẫn, không dựng iframe mù)", () => {
    expect(duongDanNhungZaloCrm({ appUrl: "", token: "T" })).toBeNull();
    expect(duongDanNhungZaloCrm({ appUrl: "khong-phai-url", token: "T" })).toBeNull();
    expect(duongDanNhungZaloCrm({ appUrl: APP, token: "" })).toBeNull();
  });
});
