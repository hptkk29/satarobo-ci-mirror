/**
 * Máy trạng thái PHIÊN portal (roadmap §6 GĐ5, hợp đồng §4.2/§8.5).
 *
 * Ba tín hiệu hết phiên: session không có `user` · API 401/403 · bị chuyển về /login
 * ⇒ SESSION_EXPIRED ĐÚNG MỘT LẦN mỗi lần chuyển; `user` xuất hiện lại ⇒ SESSION_READY + quét bù.
 *
 * TỰ QUYẾT chống "nháy": hết phiên vì 401/403 mà `user` VẪN còn (header cũ bị từ chối chứ chưa
 * chắc phiên chết) ⇒ chỉ READY lại khi có bằng chứng phiên MỚI: mốc `exp` đổi, hoặc app vừa
 * gọi search thành công (header mới được bắt sau lúc hết phiên). Không vậy thì mỗi 10′ sẽ
 * READY → 401 → EXPIRED → báo admin lặp lại.
 */
import { describe, expect, it } from "vitest";
import { PHIEN_DAU, xuLyTinHieu, type Phien, type TinHieuPhien } from "../src/lib/phien";
import { thanStatus } from "../src/lib/than-api";
import { T0 } from "./ho-tro/du-lieu";

const EXP_1 = "2026-10-08T08:15:00+07:00";
const EXP_2 = "2026-10-09T08:00:00+07:00";
const DAU_1 = { maTrang: "trang-a", soBat: 1, coHeader: true };

function coUser(hetHanLuc: string | null = EXP_1, dau = DAU_1): TinHieuPhien {
  return { loai: "PHIEN", coUser: true, hetHanLuc, nguonHetHan: hetHanLuc ? "ACCESS_TOKEN" : null, dau };
}
const khongUser: TinHieuPhien = { loai: "PHIEN", coUser: false, hetHanLuc: null, nguonHetHan: null, dau: null };
const http401: TinHieuPhien = { loai: "HTTP", httpStatus: 401, dau: { ...DAU_1, coHeader: false } };
const http403: TinHieuPhien = { loai: "HTTP", httpStatus: 403, dau: { ...DAU_1, coHeader: false } };
const veLogin: TinHieuPhien = { loai: "VE_DANG_NHAP" };
/** RV5: search của extension bị chuyển hướng (3xx/opaqueredirect — đích không rõ) trong lúc session còn user. */
const apiChuyenHuong: TinHieuPhien = { loai: "API_CHUYEN_HUONG", dau: { ...DAU_1, coHeader: false } };

function chay(p: Phien, ds: TinHieuPhien[], now = T0) {
  const suKien: Array<{ state: string; reason: string }> = [];
  let quetBu = 0;
  let cur = p;
  ds.forEach((th, i) => {
    const r = xuLyTinHieu(cur, th, now + i * 1000);
    cur = r.phien;
    if (r.suKien) suKien.push({ state: r.suKien.state, reason: r.suKien.reason });
    if (r.quetBu) quetBu++;
  });
  return { phien: cur, suKien, quetBu };
}

describe("Máy trạng thái phiên portal", () => {
  it("[EXT-PH-01] khởi động thấy user ⇒ READY (EXTENSION_START) một lần + quét bù; ghi mốc exp", () => {
    const r = chay(PHIEN_DAU, [coUser(), coUser(), coUser()]);
    expect(r.phien.trangThai).toBe("READY");
    expect(r.phien.hetHanLuc).toBe(EXP_1);
    expect(r.suKien).toEqual([{ state: "SESSION_READY", reason: "EXTENSION_START" }]);
    expect(r.quetBu).toBe(1);
  });

  it("[EXT-PH-02] khởi động KHÔNG có user ⇒ EXPIRED (NO_USER) một lần, không quét bù", () => {
    const r = chay(PHIEN_DAU, [khongUser, khongUser]);
    expect(r.phien.trangThai).toBe("EXPIRED");
    expect(r.suKien).toEqual([{ state: "SESSION_EXPIRED", reason: "NO_USER" }]);
    expect(r.quetBu).toBe(0);
  });

  const BA_TIN_HIEU: Array<[string, TinHieuPhien, string]> = [
    ["session không có user", khongUser, "NO_USER"],
    ["API 401", http401, "HTTP_401"],
    ["API 403", http403, "HTTP_403"],
    ["chuyển về /login", veLogin, "REDIRECT_LOGIN"],
  ];
  for (const [ten, th, lyDo] of BA_TIN_HIEU) {
    it(`[EXT-PH-03/${lyDo}] READY + ${ten} ⇒ SESSION_EXPIRED (${lyDo}) ĐÚNG MỘT LẦN dù tín hiệu lặp`, () => {
      const r = chay(PHIEN_DAU, [coUser(), th, th, th, khongUser, veLogin, http401]);
      expect(r.phien.trangThai).toBe("EXPIRED");
      expect(r.phien.lyDo).toBe(lyDo);
      expect(r.suKien.filter((s) => s.state === "SESSION_EXPIRED")).toEqual([{ state: "SESSION_EXPIRED", reason: lyDo }]);
    });
  }

  it("[EXT-PH-04] hết phiên vì không có user ⇒ user xuất hiện lại ⇒ SESSION_READY (USER_PRESENT) một lần + quét bù", () => {
    const r = chay(PHIEN_DAU, [coUser(), khongUser, khongUser, coUser(EXP_2), coUser(EXP_2)]);
    expect(r.phien.trangThai).toBe("READY");
    expect(r.suKien).toEqual([
      { state: "SESSION_READY", reason: "EXTENSION_START" },
      { state: "SESSION_EXPIRED", reason: "NO_USER" },
      { state: "SESSION_READY", reason: "USER_PRESENT" },
    ]);
    expect(r.quetBu).toBe(2);
  });

  it("[EXT-PH-05] hết phiên vì /login ⇒ đăng nhập lại (user có) ⇒ READY", () => {
    const r = chay(PHIEN_DAU, [coUser(), veLogin, coUser(EXP_2)]);
    expect(r.phien.trangThai).toBe("READY");
    expect(r.suKien.at(-1)).toEqual({ state: "SESSION_READY", reason: "USER_PRESENT" });
  });

  it("[EXT-PH-06] CHỐNG NHÁY: 401 mà user vẫn còn, CÙNG exp, KHÔNG header mới ⇒ ở yên EXPIRED (không READY lại)", () => {
    const r = chay(PHIEN_DAU, [coUser(), http401, coUser(EXP_1, { ...DAU_1, coHeader: false }), coUser(EXP_1, { ...DAU_1, coHeader: false })]);
    expect(r.phien.trangThai).toBe("EXPIRED");
    expect(r.suKien).toEqual([
      { state: "SESSION_READY", reason: "EXTENSION_START" },
      { state: "SESSION_EXPIRED", reason: "HTTP_401" },
    ]);
  });

  it("[EXT-PH-07] sau 401: exp ĐỔI (đăng nhập lại ⇒ token mới) ⇒ READY + quét bù", () => {
    const r = chay(PHIEN_DAU, [coUser(), http401, coUser(EXP_2, { ...DAU_1, coHeader: false })]);
    expect(r.phien.trangThai).toBe("READY");
    expect(r.suKien.at(-1)).toEqual({ state: "SESSION_READY", reason: "USER_PRESENT" });
    expect(r.quetBu).toBe(2);
  });

  it("[EXT-PH-08] sau 401: app vừa bắt header MỚI (trang mới, hoặc soBat tăng) ⇒ READY dù exp không đổi", () => {
    const trangMoi = chay(PHIEN_DAU, [coUser(), http401, coUser(EXP_1, { maTrang: "trang-b", soBat: 1, coHeader: true })]);
    expect(trangMoi.phien.trangThai).toBe("READY");
    const batLai = chay(PHIEN_DAU, [coUser(), http401, coUser(EXP_1, { maTrang: "trang-a", soBat: 2, coHeader: true })]);
    expect(batLai.phien.trangThai).toBe("READY");
    // trang mới nhưng CHƯA bắt được header ⇒ chưa đủ bằng chứng
    const chuaBat = chay(PHIEN_DAU, [coUser(), http401, coUser(EXP_1, { maTrang: "trang-c", soBat: 0, coHeader: false })]);
    expect(chuaBat.phien.trangThai).toBe("EXPIRED");
  });

  it("[EXT-PH-09] READY + user (mốc exp mới do portal tự gia hạn) ⇒ cập nhật mốc, KHÔNG phát sự kiện", () => {
    const r = chay(PHIEN_DAU, [coUser(EXP_1), coUser(EXP_2)]);
    expect(r.phien.hetHanLuc).toBe(EXP_2);
    expect(r.suKien).toHaveLength(1);
  });

  it("[EXT-PH-10] sự kiện mang mốc thời điểm + httpStatus (401) + sessionExpiresAt khi READY — không mang gì khác", () => {
    const a = xuLyTinHieu(PHIEN_DAU, coUser(), T0);
    expect(a.suKien).toEqual({
      state: "SESSION_READY",
      reason: "EXTENSION_START",
      occurredAt: T0,
      httpStatus: null,
      sessionExpiresAt: EXP_1,
    });
    const b = xuLyTinHieu(a.phien, http401, T0 + 5);
    expect(b.suKien).toEqual({
      state: "SESSION_EXPIRED",
      reason: "HTTP_401",
      occurredAt: T0 + 5,
      httpStatus: 401,
      sessionExpiresAt: null,
    });
  });

  it("[EXT-PH-11] RV5 — search bị CHUYỂN HƯỚNG (API, đích không rõ) mà user còn, cùng exp, không header mới ⇒ ở yên EXPIRED (REDIRECT_LOGIN), không nháy READY; exp đổi ⇒ READY", () => {
    const vang = coUser(EXP_1, { ...DAU_1, coHeader: false });
    const r = chay(PHIEN_DAU, [coUser(), apiChuyenHuong, vang, apiChuyenHuong, vang, vang]);
    expect(r.phien.trangThai).toBe("EXPIRED");
    expect(r.suKien).toEqual([
      { state: "SESSION_READY", reason: "EXTENSION_START" },
      { state: "SESSION_EXPIRED", reason: "REDIRECT_LOGIN" },
    ]);
    const dangNhapLai = chay(PHIEN_DAU, [coUser(), apiChuyenHuong, coUser(EXP_2, { ...DAU_1, coHeader: false })]);
    expect(dangNhapLai.phien.trangThai).toBe("READY");
    // Đối chứng dương: tab điều hướng tới /login (người thấy trang đăng nhập) vẫn READY lại ngay khi có user.
    const tabLogin = chay(PHIEN_DAU, [coUser(), veLogin, vang]);
    expect(tabLogin.phien.trangThai).toBe("READY");
  });

  it("[EXT-PH-12] RV5 — mốc nguồn SESSION (`expires` TRƯỢT của NextAuth) đổi KHÔNG phải bằng chứng phiên mới; nguồn ACCESS_TOKEN đổi thì là", () => {
    const sess = (h: string): TinHieuPhien => ({ loai: "PHIEN", coUser: true, hetHanLuc: h, nguonHetHan: "SESSION", dau: { ...DAU_1, coHeader: false } });
    const truot = chay(PHIEN_DAU, [sess(EXP_1), http401, sess(EXP_2), sess("2026-10-10T08:00:00+07:00")]);
    expect(truot.phien.trangThai).toBe("EXPIRED");
    expect(truot.suKien.filter((s) => s.state === "SESSION_READY")).toHaveLength(1);
    const token = chay(PHIEN_DAU, [coUser(EXP_1), http401, coUser(EXP_2, { ...DAU_1, coHeader: false })]);
    expect(token.phien.trangThai).toBe("READY");
  });

  it("[EXT-PH-13] hợp đồng 1.1 §4.2 — /status SESSION_READY chỉ mang mốc `exp` của ACCESS TOKEN: nguồn SESSION / không rõ ⇒ sự kiện KHÔNG có mốc và thân /status KHÔNG có khoá sessionExpiresAt (không gửi null đè hạn đã biết)", () => {
    const sess = (h: string): TinHieuPhien => ({ loai: "PHIEN", coUser: true, hetHanLuc: h, nguonHetHan: "SESSION", dau: DAU_1 });
    const khongRo = (h: string): TinHieuPhien => ({ loai: "PHIEN", coUser: true, hetHanLuc: h, nguonHetHan: null, dau: DAU_1 });
    for (const th of [sess(EXP_1), khongRo(EXP_1)]) {
      // khởi động (EXTENSION_START) và đăng nhập lại (USER_PRESENT) — cả hai lần chuyển sang READY
      const a = xuLyTinHieu(PHIEN_DAU, th, T0);
      const b = xuLyTinHieu(xuLyTinHieu(a.phien, khongUser, T0 + 1).phien, th, T0 + 2);
      for (const r of [a, b]) {
        expect(r.suKien?.state).toBe("SESSION_READY");
        expect(r.suKien?.sessionExpiresAt).toBeNull();
        if (r.suKien) expect(Object.keys(thanStatus({ ...r.suKien }, "CS1"))).not.toContain("sessionExpiresAt");
      }
      // mốc vẫn GHI vào phiên (heartbeat gửi kèm nguồn — máy chủ tự coi SESSION là không rõ hạn, §4.1)
      expect(a.phien.hetHanLuc).toBe(EXP_1);
    }
    // đối chứng dương: nguồn ACCESS_TOKEN ⇒ /status mang đúng mốc exp
    const tok = xuLyTinHieu(PHIEN_DAU, coUser(EXP_1), T0);
    expect(tok.suKien?.sessionExpiresAt).toBe(EXP_1);
    if (tok.suKien) expect(thanStatus({ ...tok.suKien }, "CS1")).toMatchObject({ state: "SESSION_READY", sessionExpiresAt: EXP_1 });
  });
});
