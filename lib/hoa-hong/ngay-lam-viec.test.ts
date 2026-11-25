// @vitest-environment node
/**
 * [NHH-POL-06] — hiệu lực chính sách ≥ công bố + 15 NGÀY LÀM VIỆC (04 §6.6, A9). THUẦN.
 *
 * Ngày làm việc = không T7/CN và không phải ngày `Holiday` có `type = HOLIDAY` mà `centerId` NULL
 * hoặc nằm trong tập cơ sở của phạm vi version. Giờ VN (UTC+7). Mọi ngày là ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect } from "vitest";
import {
  SO_NGAY_LAM_VIEC_SAU_CONG_BO,
  congNgayLamViec,
  dauNgayVN,
  kiemHieuLucSauCongBo,
  laNgayLamViec,
  ngayCuaCotDate,
  ngayHopLe,
  ngayHieuLucSomNhat,
  ngayVN,
  type NgayNghiLe,
} from "./ngay-lam-viec";

const TAT_CA = new Set<string>(["cs1", "cs2"]);
const MOT_CS = new Set<string>(["cs1"]);
const KHONG_NGHI: readonly NgayNghiLe[] = [];

const le = (tuNgay: string, denNgay: string, p: Partial<NgayNghiLe> = {}): NgayNghiLe => ({
  tuNgay,
  denNgay,
  loai: "HOLIDAY",
  centerId: null,
  ...p,
});

describe("[NHH-POL-06a] ngày theo giờ VN", () => {
  it("23:30 UTC ngày 14 là 06:30 ngày 15 giờ VN; 16:59 UTC vẫn là ngày 14", () => {
    expect(ngayVN(new Date("2026-03-14T23:30:00.000Z"))).toBe("2026-03-15");
    expect(ngayVN(new Date("2026-03-14T16:59:59.999Z"))).toBe("2026-03-14");
    expect(ngayVN(new Date("2026-03-14T17:00:00.000Z"))).toBe("2026-03-15");
  });

  it("cột @db.Date (nửa đêm UTC) đọc đúng ngày, không trượt theo giờ VN", () => {
    expect(ngayCuaCotDate(new Date("2026-03-01T00:00:00.000Z"))).toBe("2026-03-01");
  });
});

describe("[NHH-POL-06b] ngày làm việc", () => {
  it("T7/CN không phải ngày làm việc; T2 là; 2026-03-07 là thứ Bảy", () => {
    expect(laNgayLamViec("2026-03-06", KHONG_NGHI, TAT_CA)).toBe(true); // thứ Sáu
    expect(laNgayLamViec("2026-03-07", KHONG_NGHI, TAT_CA)).toBe(false); // thứ Bảy
    expect(laNgayLamViec("2026-03-08", KHONG_NGHI, TAT_CA)).toBe(false); // Chủ nhật
    expect(laNgayLamViec("2026-03-09", KHONG_NGHI, TAT_CA)).toBe(true); // thứ Hai
  });

  it("ngày HOLIDAY toàn hệ (centerId NULL) bị trừ; khoảng nhiều ngày có endDate trừ cả đầu cuối", () => {
    const tet = [le("2026-02-16", "2026-02-20")];
    for (const n of ["2026-02-16", "2026-02-18", "2026-02-20"]) expect(laNgayLamViec(n, tet, TAT_CA), n).toBe(false);
    expect(laNgayLamViec("2026-02-13", tet, TAT_CA)).toBe(true); // thứ Sáu trước Tết
    expect(laNgayLamViec("2026-02-23", tet, TAT_CA)).toBe(true); // thứ Hai sau Tết
  });

  it("[NHH-POL-06c] MAINTENANCE / EVENT / OTHER KHÔNG trừ; đối chứng HOLIDAY cùng ngày thì trừ", () => {
    for (const loai of ["MAINTENANCE", "EVENT", "OTHER"] as const) {
      expect(laNgayLamViec("2026-03-10", [le("2026-03-10", "2026-03-10", { loai })], TAT_CA), loai).toBe(true);
    }
    expect(laNgayLamViec("2026-03-10", [le("2026-03-10", "2026-03-10")], TAT_CA)).toBe(false);
  });

  it("[NHH-POL-06d] HOLIDAY của cơ sở NGOÀI phạm vi không trừ; của cơ sở TRONG phạm vi thì trừ", () => {
    const cs2 = [le("2026-03-10", "2026-03-10", { centerId: "cs2" })];
    expect(laNgayLamViec("2026-03-10", cs2, MOT_CS)).toBe(true); // phạm vi chỉ có cs1
    expect(laNgayLamViec("2026-03-10", cs2, TAT_CA)).toBe(false); // phạm vi gồm cs2
  });
});

describe("[NHH-POL-06e] cộng N ngày làm việc (đếm từ ngày KẾ TIẾP)", () => {
  it("công bố thứ Hai 2026-03-02 + 15 ngày làm việc = thứ Hai 2026-03-23 (ba tuần)", () => {
    expect(congNgayLamViec("2026-03-02", 15, KHONG_NGHI, TAT_CA)).toBe("2026-03-23");
  });

  it("công bố thứ Sáu 2026-03-06 + 1 = thứ Hai 2026-03-09 (bỏ cuối tuần)", () => {
    expect(congNgayLamViec("2026-03-06", 1, KHONG_NGHI, TAT_CA)).toBe("2026-03-09");
  });

  it("công bố ngay Chủ nhật vẫn đếm từ thứ Hai kế tiếp: CN 2026-03-01 + 1 = thứ Hai 2026-03-02", () => {
    expect(congNgayLamViec("2026-03-01", 1, KHONG_NGHI, TAT_CA)).toBe("2026-03-02");
  });

  it("0 ngày ⇒ chính ngày đó", () => {
    expect(congNgayLamViec("2026-03-04", 0, KHONG_NGHI, TAT_CA)).toBe("2026-03-04");
  });

  it("khoảng Tết nhảy qua: công bố thứ Sáu 2026-02-13 + 3 = 2026-02-26 khi nghỉ 16–20/02 (T2 23, T3 24, T4 25 → ra T5 26? đếm lại)", () => {
    // 16–20/02 nghỉ ⇒ ngày làm việc kế: 23 (1), 24 (2), 25 (3).
    expect(congNgayLamViec("2026-02-13", 3, [le("2026-02-16", "2026-02-20")], TAT_CA)).toBe("2026-02-25");
    // đối chứng không có Tết: 16, 17, 18.
    expect(congNgayLamViec("2026-02-13", 3, KHONG_NGHI, TAT_CA)).toBe("2026-02-18");
  });

  it("số ngày âm bị từ chối (tham số nguy hiểm, không đoán)", () => {
    expect(() => congNgayLamViec("2026-03-02", -1, KHONG_NGHI, TAT_CA)).toThrow();
  });

  it("số ngày KHÔNG NGUYÊN / NaN bị từ chối (cấy 08/10, V05: bỏ isInteger ⇒ 1,5 ngày cộng ra 2 ngày, 0 ca đỏ)", () => {
    for (const sai of [1.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => congNgayLamViec("2026-03-02", sai, KHONG_NGHI, TAT_CA), String(sai)).toThrow();
    }
    // đối chứng dương: số nguyên vẫn chạy
    expect(congNgayLamViec("2026-03-02", 2, KHONG_NGHI, TAT_CA)).toBe("2026-03-04");
  });
});

describe("[NHH-POL-06] biên 14/15 ngày làm việc kể từ công bố", () => {
  // Công bố thứ Hai 2026-03-02 ⇒ sớm nhất = 2026-03-23.
  const congBo = "2026-03-02";
  const somNhat = ngayHieuLucSomNhat(congBo, 15, KHONG_NGHI, TAT_CA);

  it("ngày hiệu lực sớm nhất", () => {
    expect(somNhat).toBe("2026-03-23");
  });

  it("hiệu lực đúng ngày thứ 15 ⇒ qua; ngày thứ 14 ⇒ chặn (biên 14/15)", () => {
    // 14 ngày làm việc sau công bố = 2026-03-20 (thứ Sáu)
    expect(kiemHieuLucSauCongBo({ congBo, hieuLuc: new Date("2026-03-22T17:00:00.000Z"), soNgayLamViec: 15, nghi: KHONG_NGHI, coSoTrongPhamVi: TAT_CA })).toEqual({ ok: true, somNhat: "2026-03-23" });
    const ngay14 = kiemHieuLucSauCongBo({ congBo, hieuLuc: new Date("2026-03-19T17:00:00.000Z"), soNgayLamViec: 15, nghi: KHONG_NGHI, coSoTrongPhamVi: TAT_CA });
    expect(ngay14).toEqual({ ok: false, somNhat: "2026-03-23", hieuLucNgay: "2026-03-20" });
  });

  it("hiệu lực tính theo NGÀY VN: 17:00 UTC ngày 22/03 đã là ngày 23/03 giờ VN ⇒ qua; 16:59 UTC ⇒ chặn", () => {
    const qua = kiemHieuLucSauCongBo({ congBo, hieuLuc: new Date("2026-03-22T17:00:00.000Z"), soNgayLamViec: 15, nghi: KHONG_NGHI, coSoTrongPhamVi: TAT_CA });
    const chan = kiemHieuLucSauCongBo({ congBo, hieuLuc: new Date("2026-03-22T16:59:59.000Z"), soNgayLamViec: 15, nghi: KHONG_NGHI, coSoTrongPhamVi: TAT_CA });
    expect(qua.ok).toBe(true);
    expect(chan.ok).toBe(false);
  });

  it("có ngày lễ giữa chừng đẩy mốc lùi; bỏ trừ Holiday thì ca này đỏ (cấy)", () => {
    const nghi = [le("2026-03-10", "2026-03-11")]; // hai ngày lễ giữa chừng
    expect(ngayHieuLucSomNhat(congBo, 15, nghi, TAT_CA)).toBe("2026-03-25");
  });

  it("dòng MAINTENANCE cùng ngày KHÔNG đẩy mốc; HOLIDAY của cơ sở ngoài phạm vi KHÔNG đẩy mốc", () => {
    expect(ngayHieuLucSomNhat(congBo, 15, [le("2026-03-10", "2026-03-11", { loai: "MAINTENANCE" })], TAT_CA)).toBe("2026-03-23");
    expect(ngayHieuLucSomNhat(congBo, 15, [le("2026-03-10", "2026-03-11", { centerId: "cs2" })], MOT_CS)).toBe("2026-03-23");
  });
});

describe("[NHH-POL-06f] ngày LỊCH phải có thật (cấy lại 08/10: bỏ kiểm định dạng không làm ca nào đỏ)", () => {
  // `Date.parse("2026-02-30T00:00:00.000Z")` của V8 KHÔNG ném — nó trượt sang 02/03. Một hạn pháp lý (công bố + 15 ngày
  // làm việc) tính từ ngày trượt âm thầm là hạn sai, nên phải bị TỪ CHỐI chứ không đoán.
  it("ngày không có trong lịch (30/02, tháng 13, thiếu số 0) bị từ chối ở mọi cửa vào", () => {
    for (const sai of ["2026-02-30", "2026-04-31", "2026-13-01", "2026-3-1", "26-03-02", "2026-03-02T00:00", ""]) {
      expect(() => laNgayLamViec(sai, KHONG_NGHI, TAT_CA), sai).toThrow();
      expect(() => congNgayLamViec(sai, 1, KHONG_NGHI, TAT_CA), sai).toThrow();
      expect(() => ngayHieuLucSomNhat(sai, 15, KHONG_NGHI, TAT_CA), sai).toThrow();
    }
  });

  it("đối chứng dương: 29/02 của năm nhuận và 28/02 năm thường vẫn qua", () => {
    expect(laNgayLamViec("2028-02-29", KHONG_NGHI, TAT_CA)).toBe(true); // thứ Ba
    expect(laNgayLamViec("2026-02-28", KHONG_NGHI, TAT_CA)).toBe(false); // thứ Bảy — qua cổng, rồi bị loại vì cuối tuần
    expect(() => laNgayLamViec("2027-02-29", KHONG_NGHI, TAT_CA)).toThrow();
  });
});

describe("[NHH-POL-06g] ngayHopLe / dauNgayVN — MỘT chỗ kiểm ngày cho service lẫn script seed", () => {
  // Script seed từng tự `Date.parse` sau một regex định dạng ⇒ `--hieu-luc=2026-02-30` trượt sang 02/03 không báo. Hai nơi
  // kiểm cùng một ngày thì phải cùng MỘT hàm.
  it("ngayHopLe: chỉ nhận ngày có thật, đúng định dạng YYYY-MM-DD", () => {
    for (const dung of ["2026-02-28", "2028-02-29", "2026-12-31", "2026-03-23"]) expect(ngayHopLe(dung), dung).toBe(true);
    for (const sai of ["2026-02-30", "2026-02-29", "2026-04-31", "2026-13-01", "2026-3-1", "26-03-02", "2026-03-02T00:00", " 2026-03-02", ""]) {
      expect(ngayHopLe(sai), sai).toBe(false);
    }
  });

  it("dauNgayVN: 00:00 giờ VN của ngày đó = 17:00Z của ngày hôm trước; ngày sai ⇒ ném (không trượt)", () => {
    expect(dauNgayVN("2026-03-23").toISOString()).toBe("2026-03-22T17:00:00.000Z");
    expect(dauNgayVN("2026-01-01").toISOString()).toBe("2025-12-31T17:00:00.000Z");
    expect(() => dauNgayVN("2026-02-30")).toThrow();
    expect(() => dauNgayVN("2026-3-1")).toThrow();
    // khứ hồi với ngayVN
    expect(ngayVN(dauNgayVN("2026-03-23"))).toBe("2026-03-23");
  });
});

describe("[NHH-POL-06h] hằng chủ dự án chốt (A9)", () => {
  it("chính sách hiệu lực sau công bố ÍT NHẤT 15 ngày LÀM VIỆC — đổi con số này là đổi một quyết định của chủ dự án, không phải tinh chỉnh kỹ thuật", () => {
    expect(SO_NGAY_LAM_VIEC_SAU_CONG_BO).toBe(15);
  });
});
