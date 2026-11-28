import { beforeEach, describe, expect, it } from "vitest";

import { kiemLienKetPhieuThu, taoLienKetPhieuThu, TTL_LIEN_KET_PHIEU_THU_GIAY } from "./lien-ket-phieu-thu";

/**
 * [LKPT] liên kết ký tải phiếu thu (THUẦN, đồng hồ đóng băng):
 *   [LKPT-01] token hợp lệ trong hạn ⇒ trả đúng userId + paymentId; TTL tối đa 300 giây (xin dài hơn bị kẹp)
 *   [LKPT-02] sai chữ ký / sửa nội dung / rác / quá dài ⇒ từ chối; hết hạn ⇒ HET_HAN; hạn dài bất thường (không do máy chủ cấp) ⇒ HET_HAN
 *   [LKPT-03] chữ ký ràng buộc CẢ người dùng lẫn khoản: đổi một trong hai ⇒ CHU_KY
 */
const T0 = new Date("2026-11-20T03:00:00.000Z");
const sau = (giay: number) => new Date(T0.getTime() + giay * 1000);

describe("[LKPT] liên kết ký phiếu thu", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
  });

  it("[LKPT-01] hợp lệ trong hạn; TTL bị kẹp 300 giây", () => {
    const { token, hetHanLuc } = taoLienKetPhieuThu("u1", "p1", T0);
    expect(hetHanLuc.getTime() - T0.getTime()).toBe(TTL_LIEN_KET_PHIEU_THU_GIAY * 1000);
    expect(kiemLienKetPhieuThu(token, sau(1))).toEqual({ ok: true, userId: "u1", paymentId: "p1" });
    expect(kiemLienKetPhieuThu(token, sau(299))).toMatchObject({ ok: true });
    const dai = taoLienKetPhieuThu("u1", "p1", T0, 99_999);
    expect(dai.hetHanLuc.getTime() - T0.getTime()).toBe(300_000);
  });

  it("[LKPT-02] hỏng / hết hạn / bất thường ⇒ từ chối", () => {
    const { token } = taoLienKetPhieuThu("u1", "p1", T0);
    expect(kiemLienKetPhieuThu(token, sau(301))).toMatchObject({ ok: false, ly: "HET_HAN" });
    const [payload, ky] = token.split(".") as [string, string];
    expect(kiemLienKetPhieuThu(`${payload}.${ky.slice(0, -2)}AA`, sau(1))).toMatchObject({ ok: false, ly: "CHU_KY" });
    expect(kiemLienKetPhieuThu("abc", sau(1))).toMatchObject({ ok: false, ly: "DINH_DANG" });
    expect(kiemLienKetPhieuThu(".x", sau(1))).toMatchObject({ ok: false, ly: "DINH_DANG" });
    expect(kiemLienKetPhieuThu("a".repeat(700), sau(1))).toMatchObject({ ok: false, ly: "DINH_DANG" });
    // hạn dài bất thường: cấp trong tương lai xa nhưng chữ ký ĐÚNG (như thể ai đó có khoá) vẫn bị từ chối bởi trần hạn
    const xa = taoLienKetPhieuThu("u1", "p1", sau(3600)); // «cấp» sau 1 giờ ⇒ hạn quá xa so với bây giờ
    expect(kiemLienKetPhieuThu(xa.token, T0)).toMatchObject({ ok: false, ly: "HET_HAN" });
  });

  it("[LKPT-03] chữ ký ràng buộc người dùng + khoản", () => {
    const a = taoLienKetPhieuThu("u1", "p1", T0).token;
    const b = taoLienKetPhieuThu("u2", "p1", T0).token;
    const c = taoLienKetPhieuThu("u1", "p2", T0).token;
    const doiPayload = (x: string, y: string) => `${y.split(".")[0]}.${x.split(".")[1]}`;
    expect(kiemLienKetPhieuThu(doiPayload(a, b), sau(1))).toMatchObject({ ok: false, ly: "CHU_KY" });
    expect(kiemLienKetPhieuThu(doiPayload(a, c), sau(1))).toMatchObject({ ok: false, ly: "CHU_KY" });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
