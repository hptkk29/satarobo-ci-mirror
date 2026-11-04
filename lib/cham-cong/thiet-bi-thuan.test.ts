// lib/cham-cong/thiet-bi-thuan.test.ts — luật thuần của thiết bị chấm công (P2.3). Không DB, không đồng hồ.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  chuyenThietBi,
  hanhDongThietBiHopLe,
  LOI_DAT_LAI_BAO_MAT,
  LOI_DAT_LAI_KHONG_CO_MAY,
  nhanThietBi,
  quyetDinhThietBi,
  thongBaoDatLai,
  trangThaiKhiDangKy,
} from "./thiet-bi-thuan";

describe("[TBT] thiết bị chấm công — luật thuần", () => {
  it("[TBT-01] OFF: luôn cho, không cờ — kể cả máy đã thu hồi (OFF là 'không làm gì')", () => {
    expect(quyetDinhThietBi({ cheDo: "OFF", trangThai: "REVOKED", choPhepKhanCap: false })).toEqual({ cho: true, co: null });
  });

  it("[TBT-02] OBSERVE: KHÔNG BAO GIỜ chặn; máy lạ / máy thu hồi chỉ gắn cờ", () => {
    for (const t of ["PENDING", "TRUSTED", "REVOKED", "LOST"] as const) {
      const q = quyetDinhThietBi({ cheDo: "OBSERVE", trangThai: t, choPhepKhanCap: false });
      expect(q.cho, t).toBe(true);
    }
    expect(quyetDinhThietBi({ cheDo: "OBSERVE", trangThai: "TRUSTED", choPhepKhanCap: false })).toEqual({ cho: true, co: null });
    expect(quyetDinhThietBi({ cheDo: "OBSERVE", trangThai: "PENDING", choPhepKhanCap: false })).toEqual({ cho: true, co: "THIET_BI_CHUA_TIN_CAY" });
    expect(quyetDinhThietBi({ cheDo: "OBSERVE", trangThai: "LOST", choPhepKhanCap: false })).toEqual({ cho: true, co: "THIET_BI_DA_THU_HOI" });
  });

  it("[TBT-03] ENFORCE: máy thu hồi / báo mất LUÔN bị chặn (khẩn cấp không cứu); máy chưa duyệt theo cờ khẩn cấp", () => {
    expect(quyetDinhThietBi({ cheDo: "ENFORCE", trangThai: "REVOKED", choPhepKhanCap: true }).cho).toBe(false);
    expect(quyetDinhThietBi({ cheDo: "ENFORCE", trangThai: "LOST", choPhepKhanCap: true })).toMatchObject({ cho: false, loi: expect.stringMatching(/báo mất/) });
    expect(quyetDinhThietBi({ cheDo: "ENFORCE", trangThai: "TRUSTED", choPhepKhanCap: false })).toEqual({ cho: true, co: null });
    expect(quyetDinhThietBi({ cheDo: "ENFORCE", trangThai: "PENDING", choPhepKhanCap: true })).toEqual({ cho: true, co: "THIET_BI_CHUA_TIN_CAY" });
    expect(quyetDinhThietBi({ cheDo: "ENFORCE", trangThai: "PENDING", choPhepKhanCap: false }).cho).toBe(false);
  });

  it("[TBT-04] đăng ký: máy đầu tiên tự tin cậy (nếu bật); từ máy thứ hai chờ duyệt", () => {
    expect(trangThaiKhiDangKy({ soDangTinCay: 0, tuTinCayDauTien: true })).toBe("TRUSTED");
    expect(trangThaiKhiDangKy({ soDangTinCay: 1, tuTinCayDauTien: true })).toBe("PENDING");
    expect(trangThaiKhiDangKy({ soDangTinCay: 0, tuTinCayDauTien: false })).toBe("PENDING");
  });

  it("[TBT-05] chuyển trạng thái: duyệt chặn ở trần; thu hồi / báo mất; máy mất không duyệt lại được", () => {
    expect(chuyenThietBi({ hienTai: "PENDING", hanhDong: "TIN_CAY", soDangTinCay: 1, toiDa: 2 })).toEqual({ ok: true, den: "TRUSTED" });
    expect(chuyenThietBi({ hienTai: "PENDING", hanhDong: "TIN_CAY", soDangTinCay: 2, toiDa: 2 })).toMatchObject({ ok: false, error: expect.stringMatching(/2\/2/) });
    expect(chuyenThietBi({ hienTai: "TRUSTED", hanhDong: "THU_HOI", soDangTinCay: 2, toiDa: 2 })).toEqual({ ok: true, den: "REVOKED" });
    expect(chuyenThietBi({ hienTai: "LOST", hanhDong: "TIN_CAY", soDangTinCay: 0, toiDa: 2 }).ok).toBe(false);
    expect(hanhDongThietBiHopLe("LOST")).toEqual([]);
    expect(hanhDongThietBiHopLe("PENDING").sort()).toEqual(["BAO_MAT", "THU_HOI", "TIN_CAY"]);
  });

  it("[TBT-06] nhãn máy từ user-agent — chỉ để nhận ra, không làm định danh", () => {
    expect(nhanThietBi("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toEqual({
      deviceName: "iPhone · Safari",
      platform: "iPhone",
    });
    expect(nhanThietBi("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36").deviceName).toBe("Android · Chrome");
    expect(nhanThietBi(null).platform).toBe("Không rõ");
  });
  // D-04 (11/10/2026): thao tác "Đặt lại" phải NÓI là đặt lại — bản đầu báo "Đã thu hồi N máy".
  it("[D04-06] câu báo đặt lại: 1 máy · N máy · chỉ còn máy báo mất (từ chối) · không còn máy · có cả máy mất; không câu nào nói 'thu hồi'", () => {
    expect(thongBaoDatLai({ soMay: 1, soBaoMat: 0 })).toEqual({
      ok: true,
      note: "Đã đặt lại 1 thiết bị. Thiết bị sẽ cần đăng ký lại khi chấm công lần tiếp theo.",
    });
    expect(thongBaoDatLai({ soMay: 3, soBaoMat: 0 })).toEqual({ ok: true, note: "Đã đặt lại 3 thiết bị." });
    expect(thongBaoDatLai({ soMay: 0, soBaoMat: 1 })).toEqual({ ok: false, error: "Thiết bị đã báo mất không thể đặt lại bằng thao tác này." });
    expect(thongBaoDatLai({ soMay: 0, soBaoMat: 0 })).toEqual({ ok: false, error: LOI_DAT_LAI_KHONG_CO_MAY });
    expect(thongBaoDatLai({ soMay: 2, soBaoMat: 1 })).toEqual({ ok: true, note: `Đã đặt lại 2 thiết bị. ${LOI_DAT_LAI_BAO_MAT}` });
    for (const [soMay, soBaoMat] of [[1, 0], [2, 0], [0, 1], [0, 0], [2, 1]]) {
      const r = thongBaoDatLai({ soMay, soBaoMat });
      expect(r.ok ? r.note : r.error).not.toMatch(/thu hồi/i);
    }
  });

  // Lưới ghim DÂY NỐI: action trả đúng câu của `thongBaoDatLai` (qua `r.note` của datLaiThietBi), không tự ghép câu.
  // Mã TRƯỚC bản vá: `note: \`Đã thu hồi ${r.soMay} máy — lần chấm kế tiếp sẽ đăng ký lại\``.
  it("[D04-06b] action Đặt lại trả `r.note` và không còn câu 'thu hồi' tự ghép", () => {
    const src = readFileSync(resolve(process.cwd(), "app/(admin)/admin/cham-cong/thiet-bi/_actions.ts"), "utf8");
    const chiMa = src.replace(/\/\/.*$/gm, "");
    expect(chiMa.match(/note: r\.note/g)?.length).toBe(1);
    expect(chiMa).not.toMatch(/Đã thu hồi/);
  });
});
