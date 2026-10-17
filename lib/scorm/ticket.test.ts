import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  SCORM_GIA_HAN_KHI_CON_MS,
  SCORM_GIA_HAN_TOI_DA_MS,
  giaHanScormTicket,
  signScormTicket,
  verifyScormTicket,
} from "./ticket";

const T0 = Date.UTC(2026, 9, 12, 3, 0, 0); // đồng hồ ĐÓNG BĂNG (luật 19)
const GOC = { packageId: "cmuz8xsix01vlh3dv9t2bz8d1", sessionId: "buoi-1", userId: "gv-1", prefix: "scorm/cmuz8xsix01vlh3dv9t2bz8d1/" };

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
  process.env.AUTH_SECRET = process.env.NEXTAUTH_SECRET;
});

describe("[SCT] vé SCORM: prefix + gia hạn trượt có trần", () => {
  it("[SCT-01] prefix + iat được KÝ cùng vé; sửa prefix ⇒ chữ ký sai", () => {
    const ve = signScormTicket(GOC, 600, T0);
    const r = verifyScormTicket(ve, T0 + 1000);
    expect(r.ok).toBe(true);
    expect(r.payload?.prefix).toBe(GOC.prefix);
    expect(r.payload?.iat).toBe(T0);

    const [body, sig] = ve.split(".");
    const sua = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    sua.prefix = "scorm/goi-khac/";
    const gia = `${Buffer.from(JSON.stringify(sua)).toString("base64url")}.${sig}`;
    expect(verifyScormTicket(gia, T0 + 1000).ok).toBe(false);
  });

  it("[SCT-02] vé KHÔNG prefix (vé cũ đang bay) vẫn xác thực được", () => {
    const { prefix: _bo, ...khong } = GOC;
    void _bo;
    const ve = signScormTicket(khong, 600, T0);
    const r = verifyScormTicket(ve, T0 + 1000);
    expect(r.ok).toBe(true);
    expect(r.payload?.prefix).toBeUndefined();
  });

  it("[SCT-03] hết hạn ⇒ không xác thực", () => {
    const ve = signScormTicket(GOC, 600, T0);
    expect(verifyScormTicket(ve, T0 + 601_000).ok).toBe(false);
  });

  it("[SCT-04] còn nhiều thời gian ⇒ KHÔNG gia hạn; sắp hết ⇒ cấp vé mới giữ nguyên quyền", () => {
    const ve = signScormTicket(GOC, 600, T0);
    const p = verifyScormTicket(ve, T0).payload!;
    expect(giaHanScormTicket(p, T0 + 60_000)).toBeNull(); // còn 9 phút

    const sapHet = T0 + 600_000 - SCORM_GIA_HAN_KHI_CON_MS + 1000; // còn < 5 phút
    const moi = giaHanScormTicket(p, sapHet);
    expect(moi).not.toBeNull();
    const pm = verifyScormTicket(moi!, sapHet).payload!;
    expect(pm.exp).toBe(sapHet + 600_000);
    // không nâng quyền: cùng gói / buổi / người dùng / prefix, và giữ mốc cấp GỐC.
    expect({ ...pm, exp: 0 }).toEqual({ ...p, exp: 0 });
  });

  it("[SCT-05] chuỗi gia hạn có TRẦN: quá mốc tổng ⇒ null, phải mở lại bài (page kiểm quyền lại)", () => {
    const ve = signScormTicket(GOC, 600, T0);
    let p = verifyScormTicket(ve, T0).payload!;
    let now = T0;
    // gia hạn liên tục mỗi ~6 phút cho tới khi chạm trần
    let n = 0;
    for (; n < 100; n++) {
      now += 6 * 60_000;
      if (now > p.exp) break;
      const moi = giaHanScormTicket(p, now);
      if (!moi) break;
      p = verifyScormTicket(moi, now).payload!;
    }
    expect(n).toBeGreaterThan(5); // gia hạn được nhiều lần trong một buổi dạy
    expect(now - T0).toBeLessThanOrEqual(SCORM_GIA_HAN_TOI_DA_MS + 6 * 60_000);
    // và KHÔNG gia hạn được sau trần:
    expect(giaHanScormTicket({ ...p, exp: T0 + SCORM_GIA_HAN_TOI_DA_MS + 1000 }, T0 + SCORM_GIA_HAN_TOI_DA_MS)).toBeNull();
  });

  it("[SCT-06] vé cũ không có iat: gia hạn được MỘT chuỗi mới, mốc gốc suy từ `exp − TTL` rồi được ghim vào vé mới", () => {
    const ve = signScormTicket(GOC, 600, T0);
    const p = verifyScormTicket(ve, T0).payload!;
    const { iat: _bo, ...khongIat } = p;
    void _bo;
    const sapHet = T0 + 600_000 - SCORM_GIA_HAN_KHI_CON_MS + 1000;
    const moi = giaHanScormTicket(khongIat, sapHet);
    expect(moi).not.toBeNull();
    // mốc gốc = lúc vé cũ được cấp (exp − 600s), KHÔNG phải lúc gia hạn — nên trần vẫn tính từ lúc mở bài.
    expect(verifyScormTicket(moi!, sapHet).payload?.iat).toBe(T0);
  });
});
