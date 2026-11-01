// Cửa sổ ngày của bảng trải nghiệm site Sale.
//
// Vé gốc: `/sale/trial` đóng cứng "hôm nay → +21 ngày" ⇒ buổi vừa dạy hôm qua (nơi
// giáo viên vừa chấm phiếu) không còn đường nào nhìn thấy. Bộ test này khoá đúng ba
// điều dễ vỡ: mặc định không đổi, "đã diễn ra" phải chứa HẾT hôm nay, và mọi mốc
// phải là nửa đêm UTC (khớp `@db.Date`) kể cả khi chạy lúc rạng sáng giờ VN.
import { describe, it, expect } from "vitest";
import {
  cuaSoTrial,
  docPhamVi,
  laPhamVi,
  moTaPhamVi,
  PHAM_VI,
  PHAM_VI_MAC_DINH,
} from "./sale-window";

const NGAY = 24 * 60 * 60 * 1000;
/** 03/09/2026 lúc 15:00 giờ VN (= 08:00Z) — giữa ban ngày, ngày UTC trùng ngày VN. */
const BAN_NGAY = new Date("2026-09-03T08:00:00.000Z");
/** 03/09/2026 lúc 02:00 giờ VN (= 02/09 19:00Z) — ngày UTC LÙI một hôm so với VN. */
const RANG_SANG = new Date("2026-09-02T19:00:00.000Z");
const NUA_DEM_0309 = new Date("2026-09-03T00:00:00.000Z");

describe("docPhamVi — giá trị lạ không được làm vỡ trang", () => {
  it("thiếu / rác / sai kiểu đều rơi về mặc định", () => {
    for (const v of [undefined, null, "", "linh-tinh", 7, {}, ["sap-toi"]]) {
      expect(docPhamVi(v)).toBe(PHAM_VI_MAC_DINH);
    }
  });

  it("nhận đúng ba giá trị đang in trên thanh chip", () => {
    for (const p of PHAM_VI) {
      expect(laPhamVi(p.value)).toBe(true);
      expect(docPhamVi(p.value)).toBe(p.value);
      expect(moTaPhamVi(p.value)).not.toBe("");
    }
  });

  it("mặc định vẫn là 'Sắp tới' — đổi mặc định là đổi hành vi trang", () => {
    expect(PHAM_VI_MAC_DINH).toBe("sap-toi");
  });
});

describe("cuaSoTrial — mốc phải là nửa đêm UTC của NGÀY VN", () => {
  it.each(PHAM_VI.map((p) => p.value))("%s: cả hai mốc đều 00:00 UTC", (p) => {
    for (const now of [BAN_NGAY, RANG_SANG]) {
      const { tu, den } = cuaSoTrial(p, now);
      for (const m of [tu, den]) {
        expect(m.getTime() % NGAY).toBe(0);
      }
    }
  });

  it("2h sáng giờ VN vẫn tính là NGÀY 03/09, không lùi về 02/09", () => {
    // Đây là lỗi của bản cũ (`setUTCHours(0,0,0,0)` trên giờ máy): mở bảng lúc rạng
    // sáng thì "Sắp tới" kéo thêm buổi của hôm qua vào.
    expect(cuaSoTrial("sap-toi", RANG_SANG).tu).toEqual(NUA_DEM_0309);
    expect(cuaSoTrial("sap-toi", BAN_NGAY).tu).toEqual(NUA_DEM_0309);
  });
});

describe("cuaSoTrial — phạm vi nào chứa buổi nào", () => {
  const homQua = new Date(NUA_DEM_0309.getTime() - NGAY);
  const homNay = NUA_DEM_0309;
  const tuanSau = new Date(NUA_DEM_0309.getTime() + 7 * NGAY);
  const trong = (p: Parameters<typeof cuaSoTrial>[0], d: Date) => {
    const { tu, den } = cuaSoTrial(p, BAN_NGAY);
    return d >= tu && d < den;
  };

  it("'Sắp tới' cố ý BỎ buổi hôm qua — đó là lý do phải có phạm vi thứ hai", () => {
    expect(trong("sap-toi", homQua)).toBe(false);
    expect(trong("sap-toi", homNay)).toBe(true);
    expect(trong("sap-toi", tuanSau)).toBe(true);
  });

  it("'Đã diễn ra' chứa hôm qua VÀ hết hôm nay", () => {
    // Buổi dạy sáng nay, phiếu chấm chiều nay — phải thấy ngay trong hôm nay.
    expect(trong("da-qua", homQua)).toBe(true);
    expect(trong("da-qua", homNay)).toBe(true);
    expect(trong("da-qua", tuanSau)).toBe(false);
  });

  it("'Tất cả' phủ cả hai chiều", () => {
    expect(trong("tat-ca", homQua)).toBe(true);
    expect(trong("tat-ca", homNay)).toBe(true);
    expect(trong("tat-ca", tuanSau)).toBe(true);
  });

  it("mọi phạm vi đều CÓ CHẶN TRÊN lẫn chặn dưới — không quét cả bảng", () => {
    for (const p of PHAM_VI) {
      const { tu, den } = cuaSoTrial(p.value, BAN_NGAY);
      expect(den.getTime()).toBeGreaterThan(tu.getTime());
      expect(den.getTime() - tu.getTime()).toBeLessThanOrEqual(120 * NGAY);
    }
  });
});
