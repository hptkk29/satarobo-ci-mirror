/**
 * LUẬT KHUNG GIỜ MỞ LỚP TRẢI NGHIỆM.
 *
 * Ca quan trọng nhất là [KGM-03b]: thứ 7 mở HAI khung (sáng và chiều), nên một lớp
 * 11:00–15:00 vắt qua giờ nghỉ trưa phải bị TỪ CHỐI. Kiểm kiểu "sau giờ mở sớm nhất và
 * trước giờ đóng muộn nhất" sẽ cho lọt đúng ca đó, và nó chỉ lộ ra khi có người xếp giáo
 * viên vào giờ nghỉ.
 *
 * ⚠️ Mọi ngày ở đây là mốc TUYỆT ĐỐI (luật 19). Ngày chọn theo thứ THẬT:
 *   22/09/2026 = Thứ 3 · 26/09/2026 = Thứ 7 · 27/09/2026 = Chủ nhật · 21/09/2026 = Thứ 2.
 */
import { describe, expect, it } from "vitest";
import { vnWeekday } from "@/lib/time/vn";
import { kiemCaseThuocLop,
  docKhungGio,
  goiYQuyTac,
  keKhung,
  khungChungChoThu,
  khungChoNgay,
  kiemCaseTrongLop,
  kiemKhungLop,
  KHUNG_MAC_DINH,
  sinhNgayTheoThu,
  TEN_THU,
  THU_KHOA,
} from "./khung-gio-mo-lop";

// 12:00Z = 19:00 giờ VN — cố ý KHÔNG phải nửa đêm, để lộ ra nếu ai đó đọc bằng UTC.
const T3_22_09 = new Date("2026-09-22T12:00:00.000Z");
const T7_26_09 = new Date("2026-09-26T12:00:00.000Z");
const CN_27_09 = new Date("2026-09-27T12:00:00.000Z");
const T2_21_09 = new Date("2026-09-21T12:00:00.000Z");

describe("[KGM-00] mốc trong bộ test đúng là thứ mình nghĩ", () => {
  // Ca tự kiểm: sai ngày ở đây thì MỌI ca dưới kiểm nhầm thứ mà vẫn xanh.
  it.each([
    [T3_22_09, 2, "Thứ 3"],
    [T7_26_09, 6, "Thứ 7"],
    [CN_27_09, 0, "Chủ nhật"],
    [T2_21_09, 1, "Thứ 2"],
  ])("%s là thứ %i", (d, thu) => {
    expect(vnWeekday(d)).toBe(thu);
  });
});

describe("[KGM-01] đọc chuỗi cấu hình", () => {
  it("một khung", () => {
    expect(docKhungGio("17:30-21:00")).toEqual({
      ok: true,
      giaTri: [{ startTime: "17:30", endTime: "21:00" }],
    });
  });

  it("hai khung, có khoảng trắng thừa", () => {
    const r = docKhungGio("  08:00-11:30 ,  14:00-17:30 ");
    expect(r.ok && r.giaTri).toEqual([
      { startTime: "08:00", endTime: "11:30" },
      { startTime: "14:00", endTime: "17:30" },
    ]);
  });

  it("gạch DÀI cũng đọc được — người vận hành hay dán từ Word", () => {
    const r = docKhungGio("17:30–21:00");
    expect(r.ok && r.giaTri).toEqual([{ startTime: "17:30", endTime: "21:00" }]);
  });

  it("chuỗi RỖNG = ngày đó không mở, KHÔNG phải lỗi", () => {
    expect(docKhungGio("")).toEqual({ ok: true, giaTri: [] });
    expect(docKhungGio("   ")).toEqual({ ok: true, giaTri: [] });
  });

  it("sai dạng ⇒ báo đúng đoạn sai, không nuốt im", () => {
    const r = docKhungGio("17h30-21h");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("17h30-21h");
  });

  it("giờ kết thúc không sau giờ bắt đầu ⇒ từ chối", () => {
    expect(docKhungGio("21:00-17:30").ok).toBe(false);
    expect(docKhungGio("17:30-17:30").ok).toBe(false);
  });

  it("giờ vô nghĩa (25:00) ⇒ từ chối", () => {
    expect(docKhungGio("25:00-26:00").ok).toBe(false);
  });
});

describe("[KGM-02] khung của MỘT NGÀY suy theo thứ (giờ VN)", () => {
  it("thứ 3 ⇒ tối 17:30–21:00", () => {
    const r = khungChoNgay(T3_22_09, KHUNG_MAC_DINH);
    expect(r.ok && r.giaTri).toEqual([{ startTime: "17:30", endTime: "21:00" }]);
  });

  it("thứ 7 và CN ⇒ hai khung sáng + chiều", () => {
    for (const d of [T7_26_09, CN_27_09]) {
      const r = khungChoNgay(d, KHUNG_MAC_DINH);
      expect(r.ok && r.giaTri).toHaveLength(2);
    }
  });

  it("thứ 2 ⇒ RỖNG (không mở), và đó là câu trả lời có nghĩa", () => {
    const r = khungChoNgay(T2_21_09, KHUNG_MAC_DINH);
    expect(r.ok && r.giaTri).toEqual([]);
  });

  it("⚠️ mốc rơi vào đêm theo UTC vẫn tính đúng thứ VN", () => {
    // 21/09 17:30Z = 22/09 00:30 giờ VN ⇒ phải là THỨ 3, không phải thứ 2.
    const r = khungChoNgay(new Date("2026-09-21T17:30:00.000Z"), KHUNG_MAC_DINH);
    expect(r.ok && r.giaTri).toEqual([{ startTime: "17:30", endTime: "21:00" }]);
  });

  it("cấu hình hỏng ⇒ câu lỗi gọi tên THỨ, để người vận hành biết sửa ô nào", () => {
    const r = khungChoNgay(T3_22_09, { ...KHUNG_MAC_DINH, t3: "bậy" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("Thứ 3");
  });
});

describe("[KGM-03] QL mở lớp — khung lớp phải nằm trọn trong khung cho phép", () => {
  const toi = [{ startTime: "17:30", endTime: "21:00" }];
  const t7 = [
    { startTime: "08:00", endTime: "11:30" },
    { startTime: "14:00", endTime: "17:30" },
  ];

  it("đúng nguyên khung ⇒ nhận", () => {
    expect(kiemKhungLop({ khungHopLe: toi, startTime: "17:30", endTime: "21:00", tenThu: "Thứ 3" }))
      .toEqual({ ok: true });
  });

  it("hẹp hơn khung ⇒ vẫn nhận (QL mở lớp ngắn là quyền của họ)", () => {
    expect(kiemKhungLop({ khungHopLe: toi, startTime: "18:00", endTime: "19:30", tenThu: "Thứ 3" }))
      .toEqual({ ok: true });
  });

  it("thò ra ngoài ⇒ từ chối, và câu lỗi NÓI RA khung đang mở", () => {
    const r = kiemKhungLop({
      khungHopLe: toi,
      startTime: "17:00",
      endTime: "21:00",
      tenThu: "Thứ 3",
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("17:30–21:00");
  });

  it("[KGM-03b] ⚠️ VẮT QUA giờ nghỉ trưa thứ 7 ⇒ TỪ CHỐI", () => {
    // 11:00–15:00 nằm sau giờ mở sớm nhất (08:00) và trước giờ đóng muộn nhất (17:30),
    // nên phép kiểm "nằm giữa hai đầu" sẽ CHO QUA. Phải là "trọn trong MỘT khung".
    const r = kiemKhungLop({ khungHopLe: t7, startTime: "11:00", endTime: "15:00", tenThu: "Thứ 7" });
    expect(r.ok, "lớp vắt qua giờ nghỉ trưa mà vẫn cho mở").toBe(false);
  });

  it("nằm trọn trong khung CHIỀU của thứ 7 ⇒ nhận", () => {
    expect(kiemKhungLop({ khungHopLe: t7, startTime: "14:00", endTime: "16:00", tenThu: "Thứ 7" }))
      .toEqual({ ok: true });
  });

  it("ngày không mở ⇒ từ chối và chỉ chỗ sửa", () => {
    const r = kiemKhungLop({ khungHopLe: [], startTime: "17:30", endTime: "21:00", tenThu: "Thứ 2" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("Cấu hình vận hành");
  });

  it("giờ kết thúc không sau giờ bắt đầu ⇒ từ chối", () => {
    expect(kiemKhungLop({ khungHopLe: toi, startTime: "19:00", endTime: "18:00", tenThu: "Thứ 3" }).ok)
      .toBe(false);
  });
});

describe("[KGM-04] Sale thêm case — phải nằm trong khung LỚP", () => {
  const lop = { startTime: "17:30", endTime: "21:00" };

  it("trong khung ⇒ nhận", () => {
    expect(kiemCaseTrongLop({ lop, startTime: "18:00", endTime: "19:00" })).toEqual({ ok: true });
  });

  it("sát hai mép ⇒ nhận", () => {
    expect(kiemCaseTrongLop({ lop, startTime: "17:30", endTime: "21:00" })).toEqual({ ok: true });
  });

  it("thò sớm hơn ⇒ từ chối, câu lỗi nói khung lớp và chỉ đường đi tiếp", () => {
    const r = kiemCaseTrongLop({ lop, startTime: "17:00", endTime: "19:00" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("17:30–21:00");
    expect(!r.ok && r.loi).toContain("Quản lý cơ sở");
  });

  it("thò muộn hơn ⇒ từ chối", () => {
    expect(kiemCaseTrongLop({ lop, startTime: "20:00", endTime: "22:00" }).ok).toBe(false);
  });

  it("⚠️ LỚP CŨ không có khung ⇒ KHÔNG chặn (đừng khoá cứng lớp đang chạy dở)", () => {
    expect(kiemCaseTrongLop({ lop: null, startTime: "07:00", endTime: "23:00" })).toEqual({
      ok: true,
    });
  });

  it("giờ vô lý thì vẫn chặn kể cả lớp cũ", () => {
    expect(kiemCaseTrongLop({ lop: null, startTime: "19:00", endTime: "18:00" }).ok).toBe(false);
  });
});

describe("[KGM-05] sinh ngày theo thứ", () => {
  const tu = new Date("2026-09-21T12:00:00.000Z"); // T2 21/09
  const den = new Date("2026-09-27T12:00:00.000Z"); // CN 27/09

  it("chọn T3–T6 trong một tuần ⇒ đúng 4 ngày", () => {
    const r = sinhNgayTheoThu({ tu, den, thu: [2, 3, 4, 5] });
    expect(r.ok && r.ngay.map((d) => vnWeekday(d))).toEqual([2, 3, 4, 5]);
  });

  it("chọn T7 + CN ⇒ đúng 2 ngày", () => {
    const r = sinhNgayTheoThu({ tu, den, thu: [6, 0] });
    expect(r.ok && r.ngay).toHaveLength(2);
  });

  it("chưa chọn thứ nào ⇒ từ chối", () => {
    expect(sinhNgayTheoThu({ tu, den, thu: [] }).ok).toBe(false);
  });

  it("ngày kết thúc trước ngày bắt đầu ⇒ từ chối", () => {
    expect(sinhNgayTheoThu({ tu: den, den: tu, thu: [2] }).ok).toBe(false);
  });

  it("khoảng không có thứ nào khớp ⇒ từ chối, không trả mảng rỗng im lặng", () => {
    // 21/09 (T2) → 22/09 (T3), chọn Chủ nhật ⇒ không có ngày nào.
    const r = sinhNgayTheoThu({
      tu,
      den: new Date("2026-09-22T12:00:00.000Z"),
      thu: [0],
    });
    expect(r.ok).toBe(false);
  });

  it("⚠️ có TRẦN — một lần bấm nhầm không đẻ ra vài nghìn lớp", () => {
    const r = sinhNgayTheoThu({
      tu,
      den: new Date("2027-09-21T12:00:00.000Z"),
      thu: [0, 1, 2, 3, 4, 5, 6],
      tran: 10,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("10");
  });
});

describe("[KGM-06] bảng thứ khai đủ và đúng thứ tự", () => {
  it("7 khoá, chỉ số khớp `vnWeekday` (0=CN … 6=T7)", () => {
    // Đảo thứ tự mảng này là đổi nghĩa TOÀN BỘ cấu hình mà không lỗi nào báo.
    expect(THU_KHOA).toEqual(["cn", "t2", "t3", "t4", "t5", "t6", "t7"]);
    expect(THU_KHOA[vnWeekday(CN_27_09)]).toBe("cn");
    expect(THU_KHOA[vnWeekday(T7_26_09)]).toBe("t7");
    expect(THU_KHOA[vnWeekday(T3_22_09)]).toBe("t3");
  });

  it("mỗi thứ có TÊN và có mặc định đọc được", () => {
    for (const k of THU_KHOA) {
      expect(TEN_THU[k], `thiếu tên cho ${k}`).toBeTruthy();
      expect(docKhungGio(KHUNG_MAC_DINH[k]).ok, `mặc định của ${k} không đọc được`).toBe(true);
    }
  });

  it("mặc định khớp lời chủ dự án: T3–T6 tối, T7/CN sáng+chiều, T2 nghỉ", () => {
    for (const k of ["t3", "t4", "t5", "t6"] as const) {
      const r = docKhungGio(KHUNG_MAC_DINH[k]);
      expect(r.ok && r.giaTri).toEqual([{ startTime: "17:30", endTime: "21:00" }]);
    }
    for (const k of ["t7", "cn"] as const) {
      const r = docKhungGio(KHUNG_MAC_DINH[k]);
      expect(r.ok && r.giaTri).toHaveLength(2);
    }
    expect(docKhungGio(KHUNG_MAC_DINH.t2).ok && docKhungGio(KHUNG_MAC_DINH.t2)).toEqual({
      ok: true,
      giaTri: [],
    });
  });
});

describe("[KGM-07] câu kể khung đọc được", () => {
  it("nối bằng 'hoặc'", () => {
    expect(
      keKhung([
        { startTime: "08:00", endTime: "11:30" },
        { startTime: "14:00", endTime: "17:30" },
      ]),
    ).toBe("08:00–11:30 hoặc 14:00–17:30");
  });
});

describe("[KGM-08] khung dùng chung cho một NHÓM THỨ = GIAO, không phải hợp", () => {
  it("T3–T6 cùng khung tối ⇒ giao là chính khung đó", () => {
    expect(khungChungChoThu([2, 3, 4, 5], KHUNG_MAC_DINH)).toEqual([
      { startTime: "17:30", endTime: "21:00" },
    ]);
  });

  it("T7 + CN ⇒ giao là cả hai khung sáng và chiều", () => {
    expect(khungChungChoThu([6, 0], KHUNG_MAC_DINH)).toHaveLength(2);
  });

  it("⚠️ T3 + T7 ⇒ RỖNG, vì hai nhóm giờ khác hẳn nhau", () => {
    // Lấy HỢP ở đây là bày khung 17:30–21:00 cho thứ 7 rồi để server từ chối. Rỗng là
    // câu trả lời đúng, và nó chính là thứ đẩy người dùng tách thành hai tuỳ chọn.
    expect(khungChungChoThu([2, 6], KHUNG_MAC_DINH)).toEqual([]);
  });

  it("có thứ KHÔNG mở (T2) trong nhóm ⇒ rỗng — ở CẢ HAI vị trí", () => {
    // ⚠️ Phải kiểm cả khi thứ đóng đứng CUỐI. Bản đầu chỉ có `[1, 2]` và nó XANH GIẢ:
    // cấy lỗi "thứ không mở thì bỏ qua, giữ nguyên giao" vẫn qua, vì T2 đứng đầu nên
    // `giao` khi đó còn `null` ⇒ vẫn ra rỗng do tình cờ. Với `[2, 1]` thì lỗi lộ ra.
    expect(khungChungChoThu([1, 2], KHUNG_MAC_DINH)).toEqual([]);
    expect(khungChungChoThu([2, 1], KHUNG_MAC_DINH), "thứ đóng ở cuối bị bỏ qua").toEqual([]);
    expect(khungChungChoThu([6, 0, 1], KHUNG_MAC_DINH)).toEqual([]);
  });

  it("chưa chọn thứ nào ⇒ rỗng", () => {
    expect(khungChungChoThu([], KHUNG_MAC_DINH)).toEqual([]);
  });
});

describe("[KGM-09] bộ tuỳ chọn gợi ý dựng từ cấu hình", () => {
  it("⚠️ cấu hình mặc định sinh đúng BA tuỳ chọn như ví dụ của chủ dự án", () => {
    // "lịch t3-t6 và lịch t7-cn riêng biệt" — và T7/CN tách thành sáng + chiều vì một
    // tuỳ chọn chỉ mang MỘT khung.
    const r = goiYQuyTac(KHUNG_MAC_DINH);
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ thu: [2, 3, 4, 5], startTime: "17:30", endTime: "21:00" });
    expect(r[1]).toEqual({ thu: [6, 0], startTime: "08:00", endTime: "11:30" });
    expect(r[2]).toEqual({ thu: [6, 0], startTime: "14:00", endTime: "17:30" });
  });

  it("thứ KHÔNG mở không xuất hiện trong tuỳ chọn nào", () => {
    const r = goiYQuyTac(KHUNG_MAC_DINH);
    expect(r.flatMap((x) => x.thu)).not.toContain(1);
  });

  it("cấu hình rỗng hoàn toàn ⇒ không gợi ý gì (không ném)", () => {
    const rong = { cn: "", t2: "", t3: "", t4: "", t5: "", t6: "", t7: "" };
    expect(goiYQuyTac(rong)).toEqual([]);
  });

  it("cấu hình hỏng một thứ ⇒ bỏ qua thứ đó, không làm hỏng cả bộ", () => {
    // `t4` nằm ở CHỈ SỐ 3 của `THU_KHOA` (= `vnWeekday` 3 = Thứ 4), không phải 4.
    // Bản đầu của ca này kỳ vọng `[2, 3, 5]` — tôi đếm nhầm, mã đúng.
    const r = goiYQuyTac({ ...KHUNG_MAC_DINH, t4: "bậy" });
    expect(r[0]!.thu).toEqual([2, 4, 5]);
  });
});

describe("[KGM-10] case thuộc lớp — khung + NGÀY, dùng chung cho cửa THÊM và cửa SỬA", () => {
  // Lớp A của ví dụ chủ dự án: T4 23/09/2026, khung 17:30–21:00.
  const LOP = {
    theoKhung: true,
    startDate: new Date("2026-09-23T00:00:00.000Z"), // @db.Date = nửa đêm UTC của ngày VN
    startTime: "17:30",
    endTime: "21:00",
  };
  const LOP_CU = { theoKhung: false, startDate: null, startTime: null, endTime: null };
  /** Lớp tạo TRƯỚC 28/08: vẫn mang ngày + giờ cấp lớp, nhưng KHÔNG phải lớp theo khung. */
  const LOP_TRUOC_2808 = {
    theoKhung: false,
    startDate: new Date("2026-08-11T00:00:00.000Z"),
    startTime: "14:00",
    endTime: "19:00",
  };

  it("đúng ngày, trong khung ⇒ nhận", () => {
    expect(kiemCaseThuocLop(LOP, { date: "2026-09-23", startTime: "18:00", endTime: "19:00" }).ok).toBe(true);
  });

  it("[KGM-10b] ngoài khung ⇒ từ chối — đúng ca đo được ở cửa SỬA (22:00)", () => {
    const r = kiemCaseThuocLop(LOP, { date: "2026-09-23", startTime: "22:00", endTime: "23:00" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("phải từ chối");
    expect(r.error).toContain("17:30–21:00");
  });

  it("[KGM-10c] đúng giờ nhưng SAI NGÀY ⇒ từ chối, câu lỗi nêu ngày của lớp", () => {
    const r = kiemCaseThuocLop(LOP, { date: "2026-09-30", startTime: "18:00", endTime: "19:00" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("phải từ chối");
    expect(r.error).toContain("2026-09-23");
  });

  it("lớp CŨ (không ngày, không khung) ⇒ không chặn hồi tố", () => {
    expect(kiemCaseThuocLop(LOP_CU, { date: "2026-12-01", startTime: "06:00", endTime: "23:00" }).ok).toBe(true);
  });

  it("[KGM-10d] lớp tạo TRƯỚC 28/08 (vẫn mang giờ cấp lớp) ⇒ KHÔNG chặn", () => {
    // Buổi 2 của lớp này ngày 18/08, lúc 08:30 — ngoài "khung" 14:00–19:00 và khác
    // ngày 11/08. Gác theo giờ cấp lớp là khoá cứng cả việc đổi giáo viên của buổi đó.
    expect(kiemCaseThuocLop(LOP_TRUOC_2808, { date: "2026-08-18", startTime: "08:30", endTime: "10:00" }).ok).toBe(true);
  });
});
