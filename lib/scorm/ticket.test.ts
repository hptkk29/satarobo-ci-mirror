import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  SCORM_GIA_HAN_KHI_CON_MS,
  SCORM_GIA_HAN_TOI_DA_MS,
  SCORM_TICKET_TTL_S,
  giaHanScormTicket,
  giaHanVeChuDong,
  signScormTicket,
  verifyScormTicket,
  xacThucVeChoGiaHan,
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

describe("[SCG] gia hạn CHỦ ĐỘNG: luôn cấp vé mới trong trần, vé vừa hết hạn vẫn đổi được", () => {
  const goc = () => verifyScormTicket(signScormTicket(GOC, 600, T0), T0).payload!;

  it("[SCG-01] còn nhiều thời gian (tab ngồi yên 4 phút) vẫn cấp vé mới — khác `giaHanScormTicket` chỉ gia hạn khi còn < 5 phút", () => {
    const p = goc();
    expect(giaHanScormTicket(p, T0 + 4 * 60_000)).toBeNull(); // 6 phút còn lại ⇒ kiểu trượt KHÔNG gia hạn
    const kq = giaHanVeChuDong(p, T0 + 4 * 60_000);
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.exp).toBe(T0 + 4 * 60_000 + 600_000);
    expect(kq.expiresInSec).toBe(600);
    const pm = verifyScormTicket(kq.ticket, T0 + 4 * 60_000).payload!;
    expect({ ...pm, exp: 0 }).toEqual({ ...p, exp: 0 }); // không nâng quyền, giữ iat gốc, prefix, buổi, người dùng
  });

  it("[SCG-02] vé VỪA HẾT HẠN (ngồi yên > 10 phút) vẫn đổi được nếu còn trong trần; `verifyScormTicket` thì từ chối nó", () => {
    const ve = signScormTicket(GOC, 600, T0);
    const sau = T0 + 25 * 60_000;
    expect(verifyScormTicket(ve, sau).ok).toBe(false);
    const p = xacThucVeChoGiaHan(ve);
    expect(p).not.toBeNull();
    const kq = giaHanVeChuDong(p!, sau);
    expect(kq.ok).toBe(true);
    if (kq.ok) expect(verifyScormTicket(kq.ticket, sau).ok).toBe(true);
  });

  it("[SCG-03] TRẦN: tại/sau iat + 3 giờ ⇒ het-han-toi-da; ngay trước trần thì còn được và hạn mới KẸP về đúng mốc trần", () => {
    const p = goc();
    expect(giaHanVeChuDong(p, T0 + SCORM_GIA_HAN_TOI_DA_MS)).toEqual({ ok: false, reason: "het-han-toi-da" });
    expect(giaHanVeChuDong(p, T0 + SCORM_GIA_HAN_TOI_DA_MS + 60_000)).toEqual({ ok: false, reason: "het-han-toi-da" });
    const sat = T0 + SCORM_GIA_HAN_TOI_DA_MS - 120_000;
    const kq = giaHanVeChuDong(p, sat);
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.exp).toBe(T0 + SCORM_GIA_HAN_TOI_DA_MS); // KHÔNG phải sat + 600s
    expect(kq.expiresInSec).toBe(120);
  });

  it("[SCG-04] chuỗi gia hạn nhiều lần KHÔNG kéo dài trần (iat gốc được ghim) và tổng tuổi vé không bao giờ vượt trần", () => {
    let p = goc();
    let now = T0;
    for (let i = 0; i < 100; i++) {
      now += 4 * 60_000;
      const kq = giaHanVeChuDong(p, now);
      if (!kq.ok) break;
      p = verifyScormTicket(kq.ticket, now).payload!;
      expect(p.iat).toBe(T0);
      expect(p.exp).toBeLessThanOrEqual(T0 + SCORM_GIA_HAN_TOI_DA_MS);
    }
    expect(now - T0).toBeGreaterThanOrEqual(SCORM_GIA_HAN_TOI_DA_MS);
    expect(giaHanVeChuDong(p, now).ok).toBe(false);
  });

  it("[SCG-05] vé CŨ không iat: mốc gốc suy từ `exp − TTL`; còn trần thì đổi được, quá trần thì không", () => {
    const { iat: _bo, ...khongIat } = goc();
    void _bo;
    expect(khongIat.exp - SCORM_TICKET_TTL_S * 1000).toBe(T0);
    expect(giaHanVeChuDong(khongIat, T0 + 60_000).ok).toBe(true);
    expect(giaHanVeChuDong(khongIat, T0 + SCORM_GIA_HAN_TOI_DA_MS).ok).toBe(false);
  });

  it("[SCG-06] xacThucVeChoGiaHan: sai chữ ký / rác / sửa payload ⇒ null — không bao giờ ký lại vé giả", () => {
    const ve = signScormTicket(GOC, 600, T0);
    const [body, sig] = ve.split(".");
    expect(xacThucVeChoGiaHan("")).toBeNull();
    expect(xacThucVeChoGiaHan("rac")).toBeNull();
    expect(xacThucVeChoGiaHan("a.b.c")).toBeNull();
    expect(xacThucVeChoGiaHan(`${body}.${sig!.slice(0, -2)}xx`)).toBeNull();
    // đổi userId trong payload giữ nguyên chữ ký cũ
    const sua = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    sua.userId = "gv-khac";
    expect(xacThucVeChoGiaHan(`${Buffer.from(JSON.stringify(sua)).toString("base64url")}.${sig}`)).toBeNull();
    // đẩy iat về tương lai để nới trần: chữ ký không còn khớp
    const nuoi = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    nuoi.iat = T0 + 10 * 3600_000;
    expect(xacThucVeChoGiaHan(`${Buffer.from(JSON.stringify(nuoi)).toString("base64url")}.${sig}`)).toBeNull();
  });

  it("[SCG-07] `verifyScormTicket` vẫn từ chối vé hết hạn (tách helper không làm lỏng đường phục vụ asset)", () => {
    const ve = signScormTicket(GOC, 600, T0);
    expect(verifyScormTicket(ve, T0 + 600_000).ok).toBe(true);
    expect(verifyScormTicket(ve, T0 + 600_001).ok).toBe(false);
  });

  it("[SCG-08] `giaHanScormTicket` (trượt) cũng kẹp trần: sát trần không ký lại vé dài hơn vé đang có", () => {
    const conLai = { ...goc(), exp: T0 + SCORM_GIA_HAN_TOI_DA_MS - 60_000 };
    expect(giaHanScormTicket(conLai, T0 + SCORM_GIA_HAN_TOI_DA_MS - 120_000)).not.toBeNull();
    const dungTran = { ...goc(), exp: T0 + SCORM_GIA_HAN_TOI_DA_MS };
    expect(giaHanScormTicket(dungTran, T0 + SCORM_GIA_HAN_TOI_DA_MS - 120_000)).toBeNull(); // hạn mới bị kẹp = hạn hiện có
  });

  it("[SCG-09] trần tổng GHIM theo số cụ thể: không quá 3 giờ (nới trần là quyết định bảo mật, phải sửa test này có chủ đích) và đủ một buổi dạy", () => {
    expect(SCORM_GIA_HAN_TOI_DA_MS).toBeLessThanOrEqual(3 * 60 * 60 * 1000);
    expect(SCORM_GIA_HAN_TOI_DA_MS).toBeGreaterThanOrEqual(90 * 60 * 1000);
    expect(SCORM_TICKET_TTL_S).toBeLessThanOrEqual(600); // TTL một vé không dài thêm
  });
});
