// Ca [LKT-*] — LUẬT THUẦN của LỆNH KÝ hoá đơn (Invoice Hub S9, Signature Engine): máy trạng thái, chính sách duyệt, tách nhiệm vụ, hạn lệnh.
// Không DB, không đồng hồ thật (luật 19): mốc `now` luôn được truyền vào. Mọi ca "KHÔNG được" kèm đối chứng dương.
import { describe, expect, it } from "vitest";
import {
  CHINH_SACH_KY_NGHIEM_NHAT,
  PHUONG_THUC_KY,
  TOI_DA_TTL_PHUT,
  TRANG_THAI_LENH_KY,
  canDuyet,
  chinhSachChoCoSo,
  chuanHoaChinhSachKy,
  chuyenLenhKy,
  daHetHan,
  kiemTachNhiemVu,
  laPhuongThucKy,
  laTrangThaiCuoi,
  laTrangThaiLenhKy,
  laTrangThaiSong,
  NGUOI_YEU_CAU_HE_THONG,
  tinhHetHan,
  type ChinhSachDuyetKy,
} from "./lenh-ky-trang-thai";

const NOW = new Date("2026-11-02T03:00:00.000Z");
const CS1 = "co-so-1";
const CS2 = "co-so-2";

describe("[LKT-01] máy trạng thái: CHO_KY → DANG_KY → DA_KY | LOI_KY | HET_HAN ; CHO_KY → HUY | HET_HAN", () => {
  it("sáu trạng thái, đúng thứ tự và khớp CHECK của DB", () => {
    expect([...TRANG_THAI_LENH_KY]).toEqual(["CHO_KY", "DANG_KY", "DA_KY", "LOI_KY", "HET_HAN", "HUY"]);
  });

  it("các bước đi hợp lệ", () => {
    expect(chuyenLenhKy("CHO_KY", "DANG_KY")).toEqual({ ok: true });
    expect(chuyenLenhKy("CHO_KY", "HUY")).toEqual({ ok: true });
    expect(chuyenLenhKy("CHO_KY", "HET_HAN")).toEqual({ ok: true });
    expect(chuyenLenhKy("DANG_KY", "DA_KY")).toEqual({ ok: true });
    expect(chuyenLenhKy("DANG_KY", "LOI_KY")).toEqual({ ok: true });
    expect(chuyenLenhKy("DANG_KY", "HET_HAN")).toEqual({ ok: true });
  });

  it("KHÔNG được: nhảy cóc, đi lùi, và huỷ khi bộ ký có thể đang chạy (DANG_KY → HUY)", () => {
    for (const [tu, den] of [
      ["CHO_KY", "DA_KY"],
      ["CHO_KY", "LOI_KY"],
      ["DANG_KY", "CHO_KY"],
      ["DANG_KY", "HUY"],
      ["DA_KY", "CHO_KY"],
    ] as const) {
      expect(chuyenLenhKy(tu, den)).toMatchObject({ ok: false });
    }
  });

  it("trạng thái cuối không đi tiếp đâu cả (đối chứng: trạng thái sống vẫn đi được)", () => {
    for (const cuoi of ["DA_KY", "LOI_KY", "HET_HAN", "HUY"] as const) {
      expect(laTrangThaiCuoi(cuoi)).toBe(true);
      for (const den of TRANG_THAI_LENH_KY) expect(chuyenLenhKy(cuoi, den)).toMatchObject({ ok: false });
    }
    for (const song of ["CHO_KY", "DANG_KY"] as const) expect(laTrangThaiCuoi(song)).toBe(false);
  });

  it("'sống' khớp ĐÚNG điều kiện của chỉ mục từng phần (CHO_KY, DANG_KY) — không hơn không kém", () => {
    expect(TRANG_THAI_LENH_KY.filter(laTrangThaiSong)).toEqual(["CHO_KY", "DANG_KY"]);
  });

  it("chuỗi lạ bị từ chối ở cả hai đầu (fail-closed), không ném", () => {
    expect(chuyenLenhKy("LA_HOAC", "DANG_KY")).toMatchObject({ ok: false });
    expect(chuyenLenhKy("CHO_KY", "LA_HOAC")).toMatchObject({ ok: false });
    expect(laTrangThaiLenhKy("DA_KY")).toBe(true);
    expect(laTrangThaiLenhKy("da_ky")).toBe(false);
    expect(laTrangThaiSong("LA_HOAC")).toBe(false);
    expect(laTrangThaiCuoi("LA_HOAC")).toBe(false);
  });
});

describe("[LKT-02] chính sách duyệt: mặc định FAIL-CLOSED — mọi phương thức đều cần duyệt", () => {
  it("bốn phương thức, đúng tên cột phuongThuc", () => {
    expect([...PHUONG_THUC_KY]).toEqual(["HSM_NHA_CUNG_CAP", "USB_TOKEN", "KY_TU_XA", "THU_CONG"]);
  });

  it("hằng mặc định: không cơ sở nào được ngoại lệ ⇒ MỌI phương thức, MỌI cơ sở đều cần duyệt", () => {
    for (const pt of PHUONG_THUC_KY) {
      expect(canDuyet(CHINH_SACH_KY_NGHIEM_NHAT, CS1, pt)).toBe(true);
      expect(canDuyet(CHINH_SACH_KY_NGHIEM_NHAT, CS2, pt)).toBe(true);
    }
  });

  it("cơ sở không có mục trong chính sách ⇒ quy tắc nghiêm nhất (không tự ký HSM, người ký ≠ người yêu cầu)", () => {
    const q = chinhSachChoCoSo({ theoCoSo: {} }, CS1);
    expect(q.hsmTuKy).toBe(false);
    for (const pt of PHUONG_THUC_KY) expect(q.khacNguoi[pt]).toBe(true);
  });

  it("ĐỐI CHỨNG: HSM tự ký CHỈ khi cơ sở đó khai `hsmTuKy: true` — và chỉ cho HSM", () => {
    const cs: ChinhSachDuyetKy = { theoCoSo: { [CS1]: { hsmTuKy: true } } };
    expect(canDuyet(cs, CS1, "HSM_NHA_CUNG_CAP")).toBe(false);
    // dữ liệu KHÔNG nới được ba phương thức còn lại (USB token cần kế toán duyệt — owner đã nói)
    for (const pt of ["USB_TOKEN", "KY_TU_XA", "THU_CONG"] as const) expect(canDuyet(cs, CS1, pt)).toBe(true);
  });

  it("cơ sở A bật HSM tự ký KHÔNG làm cơ sở B được tự ký (chính sách theo cơ sở, không toàn hệ)", () => {
    const cs: ChinhSachDuyetKy = { theoCoSo: { [CS1]: { hsmTuKy: true } } };
    expect(canDuyet(cs, CS1, "HSM_NHA_CUNG_CAP")).toBe(false);
    expect(canDuyet(cs, CS2, "HSM_NHA_CUNG_CAP")).toBe(true);
  });

  it("`hsmTuKy` phải đúng `true` — chuỗi 'true', số 1, 'yes' KHÔNG đủ", () => {
    for (const bay of ["true", 1, "yes", {}, [], null, undefined]) {
      const cs = { theoCoSo: { [CS1]: { hsmTuKy: bay } } } as unknown as ChinhSachDuyetKy;
      expect(canDuyet(cs, CS1, "HSM_NHA_CUNG_CAP")).toBe(true);
    }
    expect(canDuyet({ theoCoSo: { [CS1]: { hsmTuKy: true } } }, CS1, "HSM_NHA_CUNG_CAP")).toBe(false);
  });

  it("phương thức lạ ⇒ cần duyệt (fail-closed); id cơ sở kiểu 'constructor' không đọc nhầm prototype", () => {
    const cs: ChinhSachDuyetKy = { theoCoSo: { [CS1]: { hsmTuKy: true } } };
    expect(canDuyet(cs, CS1, "KY_BANG_TAY_LA")).toBe(true);
    expect(chinhSachChoCoSo(cs, "constructor").hsmTuKy).toBe(false);
    expect(chinhSachChoCoSo(cs, "__proto__").hsmTuKy).toBe(false);
    expect(canDuyet(cs, "toString", "HSM_NHA_CUNG_CAP")).toBe(true);
  });

  it("chuẩn hoá chính sách từ dữ liệu LẠ (JSON cấu hình): rác ⇒ nghiêm nhất; chỉ giữ đúng những gì khai rõ", () => {
    for (const rac of [null, undefined, 5, "x", [], {}, { theoCoSo: 3 }, { theoCoSo: { [CS1]: "bậy" } }]) {
      const cs = chuanHoaChinhSachKy(rac);
      for (const pt of PHUONG_THUC_KY) expect(canDuyet(cs, CS1, pt)).toBe(true);
      expect(chinhSachChoCoSo(cs, CS1).hsmTuKy).toBe(false);
    }
    const cs = chuanHoaChinhSachKy({ theoCoSo: { [CS1]: { hsmTuKy: true, khacNguoi: { USB_TOKEN: false, KY_TU_XA: "false", LA: false } } } });
    expect(canDuyet(cs, CS1, "HSM_NHA_CUNG_CAP")).toBe(false);
    const q = chinhSachChoCoSo(cs, CS1);
    expect(q.khacNguoi.USB_TOKEN).toBe(false);
    expect(q.khacNguoi.KY_TU_XA).toBe(true); // 'false' dạng chuỗi không phải `false`
    expect(q.khacNguoi.THU_CONG).toBe(true);
  });
});

describe("[LKT-03] tách nhiệm vụ: người ký phải KHÁC người yêu cầu — trừ khi chính sách cơ sở đó khai rõ cho phép", () => {
  const A = "nguoi-a";
  const B = "nguoi-b";
  const khoi = (o: Partial<Parameters<typeof kiemTachNhiemVu>[0]> = {}) =>
    kiemTachNhiemVu({ chinhSach: CHINH_SACH_KY_NGHIEM_NHAT, centerId: CS1, phuongThuc: "USB_TOKEN", nguoiYeuCau: A, nguoiKy: B, ...o });

  it("mặc định: cùng một người vừa yêu cầu vừa ký ⇒ TỪ CHỐI, cho cả bốn phương thức; đối chứng: hai người khác nhau ⇒ được", () => {
    for (const pt of PHUONG_THUC_KY) {
      expect(khoi({ phuongThuc: pt, nguoiKy: A })).toMatchObject({ ok: false });
      expect(khoi({ phuongThuc: pt, nguoiKy: B })).toEqual({ ok: true });
    }
  });

  it("ĐỐI CHỨNG DƯƠNG: chính sách cơ sở đó khai `khacNguoi.USB_TOKEN = false` ⇒ cùng người được; phương thức khác của cùng cơ sở vẫn bị chặn; cơ sở khác vẫn bị chặn", () => {
    const cs: ChinhSachDuyetKy = { theoCoSo: { [CS1]: { khacNguoi: { USB_TOKEN: false } } } };
    expect(khoi({ chinhSach: cs, nguoiKy: A })).toEqual({ ok: true });
    expect(khoi({ chinhSach: cs, phuongThuc: "KY_TU_XA", nguoiKy: A })).toMatchObject({ ok: false });
    expect(khoi({ chinhSach: cs, centerId: CS2, nguoiKy: A })).toMatchObject({ ok: false });
  });

  it("[LKT-03b] người yêu cầu = HỆ THỐNG (lệnh tự tạo, BGĐ 04/11/2026): mọi người ký được, KỂ CẢ dưới chính sách nghiêm nhất; đối chứng ÂM: chuỗi gần giống («system», «SYSTEM ») KHÔNG được miễn, và người ký rỗng vẫn bị từ chối", () => {
    for (const pt of PHUONG_THUC_KY) expect(khoi({ phuongThuc: pt, nguoiYeuCau: NGUOI_YEU_CAU_HE_THONG, nguoiKy: A })).toEqual({ ok: true });
    for (const gia of ["system", "SYSTEM ", " SYSTEM", "Hệ thống", NGUOI_YEU_CAU_HE_THONG + "x"]) expect(khoi({ nguoiYeuCau: gia, nguoiKy: gia })).toMatchObject({ ok: false });
    expect(khoi({ nguoiYeuCau: NGUOI_YEU_CAU_HE_THONG, nguoiKy: "" })).toMatchObject({ ok: false });
    expect(khoi({ nguoiYeuCau: A, nguoiKy: A })).toMatchObject({ ok: false }); // người thật vẫn bị luật tách nhiệm vụ
  });

  it("HSM tự ký (cơ sở khai rõ) ⇒ người yêu cầu được là người ký; đối chứng: HSM mà cơ sở KHÔNG khai ⇒ vẫn phải khác người", () => {
    const cs: ChinhSachDuyetKy = { theoCoSo: { [CS1]: { hsmTuKy: true } } };
    expect(khoi({ chinhSach: cs, phuongThuc: "HSM_NHA_CUNG_CAP", nguoiKy: A })).toEqual({ ok: true });
    expect(khoi({ phuongThuc: "HSM_NHA_CUNG_CAP", nguoiKy: A })).toMatchObject({ ok: false });
  });

  it("thiếu người (rỗng/khoảng trắng) ⇒ từ chối, kể cả khi 'khác nhau'; câu từ chối nói ĐƯỢC việc cần làm", () => {
    expect(khoi({ nguoiKy: "" })).toMatchObject({ ok: false });
    expect(khoi({ nguoiYeuCau: "  ", nguoiKy: B })).toMatchObject({ ok: false });
    const r = khoi({ nguoiKy: A });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lyDo).toMatch(/khác/i);
  });
});

describe("[LKT-04] hạn lệnh: đồng hồ do người gọi truyền vào", () => {
  it("tinhHetHan cộng đúng số phút lên `now`, không đổi `now`", () => {
    const copy = NOW.getTime();
    expect(tinhHetHan(NOW, 30).toISOString()).toBe("2026-11-02T03:30:00.000Z");
    expect(tinhHetHan(NOW, 1).toISOString()).toBe("2026-11-02T03:01:00.000Z");
    expect(NOW.getTime()).toBe(copy);
  });

  it("ttl không hợp lệ (0, âm, lẻ, NaN, quá trần) ⇒ NÉM (không đoán, không mặc định); đối chứng: đúng trần thì được", () => {
    for (const xau of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, TOI_DA_TTL_PHUT + 1]) {
      expect(() => tinhHetHan(NOW, xau)).toThrow(RangeError);
    }
    expect(() => tinhHetHan(NOW, TOI_DA_TTL_PHUT)).not.toThrow();
    expect(() => tinhHetHan(NOW, 1)).not.toThrow();
  });

  it("daHetHan: đúng tại mốc là HẾT (>=); trước mốc 1ms là CÒN", () => {
    const han = tinhHetHan(NOW, 30);
    expect(daHetHan(han, new Date(han.getTime() - 1))).toBe(false);
    expect(daHetHan(han, han)).toBe(true);
    expect(daHetHan(han, new Date(han.getTime() + 1))).toBe(true);
  });

  it("lệnh KHÔNG có hạn (hàng chèn tay) ⇒ coi như HẾT HẠN — không lệnh nào được sống vô thời hạn (fail-closed)", () => {
    expect(daHetHan(null, NOW)).toBe(true);
  });
});

describe("[LKT-05] phương thức ký", () => {
  it("laPhuongThucKy nhận đúng bốn mã (phân biệt hoa thường), từ chối phần còn lại", () => {
    for (const pt of PHUONG_THUC_KY) expect(laPhuongThucKy(pt)).toBe(true);
    for (const x of ["hsm_nha_cung_cap", "", "USB", "PIN", "THU_CONG "]) expect(laPhuongThucKy(x)).toBe(false);
  });
});
