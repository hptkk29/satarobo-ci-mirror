// GĐ2 — [LT-U-04] / [LT-U-05].
//
// Điểm chịu lực: màn cũ dựng chuỗi giờ bằng `date.getFullYear()`… của MÁY NGƯỜI DÙNG,
// nên máy đặt múi giờ khác +07 hiện sai giờ rồi lưu đè sai luôn. Màn mới đổi hợp đồng
// sang chuỗi đồng hồ VN và để server quy đổi. Bộ test này khoá cả hai chiều.
import { describe, it, expect } from "vitest";
import {
  toVnInput,
  parseVnInput,
  createClassSchema,
  addSessionSchema,
  updateBookingSchema,
  attendanceSchema,
  gvChoBuoiSchema,
  ngoaiCuaSoNgayGvBuoi,
} from "./schemas";

describe("[LT-U-04] chuỗi giờ VN đi và về", () => {
  it("đổi một mốc UTC sang đồng hồ VN đúng +7", () => {
    // 2026-06-20T10:30Z = 17:30 cùng ngày ở VN.
    expect(toVnInput(new Date("2026-06-20T10:30:00.000Z"))).toBe("2026-06-20T17:30");
  });

  it("qua nửa đêm VN vẫn đúng NGÀY", () => {
    // 2026-06-20T18:00Z = 01:00 NGÀY HÔM SAU ở VN. Đây là ca màn cũ hay sai.
    expect(toVnInput(new Date("2026-06-20T18:00:00.000Z"))).toBe("2026-06-21T01:00");
  });

  it("parse ngược lại ra đúng mốc ban đầu", () => {
    expect(parseVnInput("2026-06-20T17:30")?.toISOString()).toBe("2026-06-20T10:30:00.000Z");
  });

  it("đi rồi về là bất biến, KỂ CẢ khi đổi múi giờ tiến trình", () => {
    const goc = process.env.TZ;
    const moc = new Date("2026-12-31T17:05:00.000Z");
    try {
      for (const tz of ["UTC", "Asia/Ho_Chi_Minh", "America/Los_Angeles"]) {
        process.env.TZ = tz;
        const s = toVnInput(moc);
        expect(s).toBe("2027-01-01T00:05");
        expect(parseVnInput(s)?.getTime()).toBe(moc.getTime());
      }
    } finally {
      process.env.TZ = goc;
    }
  });

  it("chuỗi sai định dạng → null", () => {
    expect(parseVnInput("2026-06-20 17:30")).toBeNull();
    expect(parseVnInput("20/06/2026T17:30")).toBeNull();
    expect(parseVnInput("")).toBeNull();
  });
});

describe("[LT-U-05] zod tạo lớp", () => {
  // 28/08 — form tạo lớp RÚT còn CƠ SỞ + KHOÁ. Bộ cũ khoá sĩ số / giờ / số buổi / tên;
  // bốn thứ đó nay không còn đi qua đây nữa:
  //   · tên  → ~~server tự sinh (`tenLopTrial`), client gửi lên cũng bị bỏ qua~~
  //            **[ĐẢO 18/09/2026]** chủ dự án chốt "được sửa và tự do điều chỉnh tên lớp".
  //            Schema NAY NHẬN `name` (tuỳ chọn, trần 120 ký tự); bỏ trống ⇒ server vẫn
  //            sinh theo quy ước. Xem `lib/trial/service.ts`.
  //   · giờ  → thuộc tính của TỪNG BUỔI (`addSessionSchema` vẫn khoá, xem describe dưới);
  //   · sĩ số → bỏ hẳn, `capacity = null` nghĩa là không giới hạn;
  //   · số buổi → nay là số buổi ĐÃ THÊM, không phải con số khai trước.
  //   · giờ  → ~~chuyển xuống TỪNG BUỔI, lớp là slot tái sử dụng không gắn ngày~~
  //            **[ĐẢO 22/09/2026]** chủ dự án chốt "Tạo lớp Trial theo ngày, thứ, và khung
  //            thời gian có GV đi làm". Lớp NAY BẮT BUỘC có `date` + `startTime` + `endTime`
  //            — đó là KHUNG BAO để Sale chọn chỗ hẹn khách; giờ cụ thể của từng case
  //            VẪN nằm ở `TrialClassSession`. Hai thứ khác nhau, đừng gộp.
  const hopLe = { centerId: "cs1", date: "2026-09-22", startTime: "17:30", endTime: "21:00" };

  it("đủ cơ sở + ngày + khung giờ là qua", () => {
    expect(createClassSchema.safeParse(hopLe).success).toBe(true);
  });

  it("⚠️ THIẾU ngày hoặc khung giờ thì BỊ CHẶN (đảo chốt 28/08)", () => {
    // Lớp không ngày thì Sale không chọn được "lớp trial ngày 22/09" như yêu cầu, và
    // cổng "case phải nằm trong khung lớp" không có gì để so ⇒ im lặng cho qua mọi giờ.
    expect(createClassSchema.safeParse({ centerId: "cs1" }).success).toBe(false);
    const { date: _bo, ...thieuNgay } = hopLe;
    expect(createClassSchema.safeParse(thieuNgay).success).toBe(false);
    const { startTime: _bo2, ...thieuGio } = hopLe;
    expect(createClassSchema.safeParse(thieuGio).success).toBe(false);
  });

  it("ngày sai dạng bị chặn", () => {
    expect(createClassSchema.safeParse({ ...hopLe, date: "22/09/2026" }).success).toBe(false);
  });

  it("giờ sai dạng bị chặn", () => {
    expect(createClassSchema.safeParse({ ...hopLe, startTime: "17h30" }).success).toBe(false);
    expect(createClassSchema.safeParse({ ...hopLe, endTime: "25:00" }).success).toBe(false);
  });

  it("khoá trải nghiệm là tuỳ chọn", () => {
    expect(createClassSchema.safeParse({ ...hopLe, courseId: "kh1" }).success).toBe(true);
    expect(createClassSchema.safeParse({ ...hopLe, courseId: null }).success).toBe(true);
  });

  it("thiếu hẳn trường cơ sở thì bị chặn", () => {
    expect(createClassSchema.safeParse({}).success).toBe(false);
  });

  it("cơ sở là chuỗi rỗng bị chặn, kèm thông điệp người đọc hiểu", () => {
    // Lớp không cơ sở là lớp KHÔNG AI THẤY: `scopedDb` lọc theo `centerId`, nên nó tàng
    // hình với mọi tài khoản cấp cơ sở mà chẳng có thông báo nào.
    const r = createClassSchema.safeParse({ ...hopLe, centerId: "   " });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Chọn cơ sở");
  });

  it("trường cũ gửi kèm KHÔNG làm hỏng: zod bỏ qua khoá lạ", () => {
    // Bản client cũ còn nằm trong tab đang mở của ai đó vẫn POST đủ 6 trường. Chặn ở
    // đây là họ nhận lỗi khó hiểu; bỏ qua là lớp vẫn tạo đúng theo luật mới.
    //
    // ⚠️ ĐỔI 18/09/2026: `name` KHÔNG còn là "khoá lạ". Bản trước của ca này khẳng định
    // `"name" in r.data === false`, tức nó KHOÁ ĐÚNG CHỐT VỪA BỊ ĐẢO — để nguyên thì ai
    // đọc nó như đặc tả sẽ gỡ luôn tính năng vừa mở. Ba trường kia vẫn bị bỏ qua.
    // ⚠️ ĐỔI 22/09/2026 lần hai: `startTime`/`endTime` cũng KHÔNG còn là "khoá lạ" —
    // chúng là KHUNG BAO của lớp và nay bắt buộc. Chỉ `capacity`/`sessionCount` còn bị bỏ.
    const r = createClassSchema.safeParse({
      ...hopLe,
      capacity: 8,
      sessionCount: 8,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect("capacity" in r.data).toBe(false);
      expect("sessionCount" in r.data).toBe(false);
      expect(r.data.startTime).toBe("17:30");
    }
  });

  it("⚠️ TÊN LỚP nay được NHẬN (đảo chốt 28/08)", () => {
    const r = createClassSchema.safeParse({ ...hopLe, name: "Lớp thử T5 chiều" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Lớp thử T5 chiều");
  });

  it("tên lớp bỏ trống vẫn qua — server sinh theo quy ước", () => {
    expect(createClassSchema.safeParse(hopLe).success).toBe(true);
    expect(createClassSchema.safeParse({ ...hopLe, name: null }).success).toBe(true);
  });

  it("⚠️ tên lớp DÀI QUÁ bị chặn, kèm thông điệp người đọc hiểu", () => {
    // Tên này đi thẳng vào phiếu gửi phụ huynh và vào cột bảng; một chuỗi 5.000 ký tự
    // không bị gì chặn thì nó phá mọi màn đọc nó.
    const r = createClassSchema.safeParse({ ...hopLe, name: "x".repeat(121) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Tên lớp tối đa 120 ký tự");
  });
});

describe("zod thêm buổi", () => {
  const hopLe = {
    trialClassId: "lop1",
    date: "2026-09-05",
    startTime: "18:00",
    endTime: "19:30",
  };

  it("hợp lệ thì qua", () => {
    expect(addSessionSchema.safeParse(hopLe).success).toBe(true);
  });

  it("bỏ trống giáo viên vẫn hợp lệ — nghĩa là kế thừa GV của lớp", () => {
    expect(addSessionSchema.safeParse({ ...hopLe, teacherId: undefined }).success).toBe(true);
    expect(addSessionSchema.safeParse({ ...hopLe, teacherId: null }).success).toBe(true);
  });

  it("ngày sai định dạng bị chặn", () => {
    expect(addSessionSchema.safeParse({ ...hopLe, date: "05/09/2026" }).success).toBe(false);
  });
});

describe("zod cập nhật buổi hẹn", () => {
  const hopLe = {
    scheduledAtVn: "2026-09-05T18:00",
    status: "SCHEDULED" as const,
    teacherId: null,
    roomId: null,
    classId: null,
    notes: null,
  };

  it("hợp lệ thì qua", () => {
    expect(updateBookingSchema.safeParse(hopLe).success).toBe(true);
  });

  it("chuỗi rỗng ở ô chọn được quy về null, không lưu chuỗi rỗng xuống DB", () => {
    const r = updateBookingSchema.safeParse({ ...hopLe, teacherId: "", roomId: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.teacherId).toBeNull();
      expect(r.data.roomId).toBeNull();
    }
  });

  it("nhận chuỗi ISO là SAI định dạng — hợp đồng mới dùng đồng hồ VN", () => {
    expect(
      updateBookingSchema.safeParse({ ...hopLe, scheduledAtVn: "2026-09-05T18:00:00.000Z" })
        .success,
    ).toBe(false);
  });

  it("trạng thái ngoài 7 giá trị bị chặn", () => {
    expect(updateBookingSchema.safeParse({ ...hopLe, status: "LINH_TINH" }).success).toBe(false);
  });
});

// 28/08/2026 — bỏ ca kiểm `configSchema`: khối "Cấu hình số buổi (mặc định)" đã gỡ khỏi
// màn Lớp Trial, schema theo đó cũng gỡ. Trần số buổi nay nằm ở tham số vận hành
// `crm.trialMaxSessions`, không phải ở một bản ghi cấu hình.
describe("zod điểm danh", () => {
  it("điểm danh: danh sách rỗng bị chặn", () => {
    const r = attendanceSchema.safeParse({ trialSessionId: "b1", records: [] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Chưa có học viên để điểm danh");
  });

  it("điểm danh: chỉ nhận PRESENT/ABSENT", () => {
    expect(
      attendanceSchema.safeParse({
        trialSessionId: "b1",
        records: [{ trialEnrollmentId: "e1", status: "LATE" }],
      }).success,
    ).toBe(false);
  });
});

// 17/09/2026 — cổng HÌNH DẠNG của đường ĐỌC `layGvChoBuoiAction`.
//
// Vì sao một đường đọc cũng đáng một khối test: bốn action GHI trong cùng tệp đều
// `safeParse`, riêng đường này lúc đầu chỉ có chữ ký TypeScript. Kiểu của Server Action
// là lời hứa với `tsc`, không phải cổng — trình duyệt POST thẳng payload bất kỳ vào
// được, và payload bẩn ở đây KHÔNG rơi vào nhánh `{ ok: false }`: `ngayVnSangUtc` gọi
// `.trim()` nên `date: 123` làm action NÉM. Action ném thì client nhận promise bị từ
// chối, ô chọn giáo viên đứng im với danh sách cũ, không một dòng chữ nào hiện ra.
describe("zod lọc giáo viên theo khung giờ (17/09)", () => {
  const hopLe = {
    trialClassId: "lop-1",
    date: "2026-09-19",
    startTime: "18:00",
    endTime: "19:30",
  };

  it("khung giờ hợp lệ đi qua, `excludeSessionId` bỏ trống được", () => {
    const r = gvChoBuoiSchema.safeParse(hopLe);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.excludeSessionId).toBeUndefined();
  });

  it("`excludeSessionId: null` (cửa THÊM buổi) đi qua", () => {
    expect(gvChoBuoiSchema.safeParse({ ...hopLe, excludeSessionId: null }).success).toBe(true);
  });

  it("ngày KHÔNG phải chuỗi bị chặn — đây là payload làm action NÉM", () => {
    // Ca chịu lực. `123` không có `.trim`, nên thiếu cổng này là TypeError chứ không
    // phải một `error` gọn gàng trả về client.
    const r = gvChoBuoiSchema.safeParse({ ...hopLe, date: 123 });
    expect(r.success).toBe(false);
  });

  it("ngày sai định dạng bị chặn kèm câu người đọc được", () => {
    const r = gvChoBuoiSchema.safeParse({ ...hopLe, date: "19/09/2026" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Ngày buổi học không hợp lệ");
  });

  it("giờ sai định dạng bị chặn", () => {
    expect(gvChoBuoiSchema.safeParse({ ...hopLe, startTime: "25:00" }).success).toBe(false);
    expect(gvChoBuoiSchema.safeParse({ ...hopLe, endTime: "7h30" }).success).toBe(false);
  });

  it("thiếu lớp bị chặn — không cho hỏi danh sách giáo viên mà không nói lớp nào", () => {
    expect(gvChoBuoiSchema.safeParse({ ...hopLe, trialClassId: "  " }).success).toBe(false);
  });

  it("giờ kết thúc KHÔNG sau giờ bắt đầu bị chặn, cùng luật với hai schema ghi", () => {
    // Thiếu vế này thì khung ngược đời lọt tới `caPhuTronKhungGio`, ra KHONG_PHU cho TẤT
    // CẢ, và màn hình đổ lỗi cho lưới ca ("không ai có ca phủ trọn 19:30–18:00") trong
    // khi lỗi nằm ở hai ô giờ người dùng vừa gõ.
    const r = gvChoBuoiSchema.safeParse({ ...hopLe, startTime: "19:30", endTime: "18:00" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Giờ kết thúc phải sau giờ bắt đầu");
    expect(gvChoBuoiSchema.safeParse({ ...hopLe, startTime: "18:00", endTime: "18:00" }).success)
      .toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// VÁ 17/09/2026 — CỬA SỔ NGÀY CỦA `layGvChoBuoiAction`
//
// `gvChoBuoiSchema` chỉ kiểm HÌNH DẠNG `YYYY-MM-DD`; nó KHÔNG buộc ngày phải dính vào một
// buổi nào của lớp. Mà endpoint đó trả về trạng thái ca của TỪNG giáo viên cho đúng ngày
// được hỏi — nên lặp lời gọi theo từng ngày là dựng lại được lưới ca nhiều năm, không ném
// lỗi, không dòng nhật ký nào khác thường. Che nhãn (`duocXemLyDoNghi`) bịt phần CHỮ; cửa
// sổ này bịt phần KHỐI LƯỢNG — thiếu một trong hai vế thì vế kia vẫn rò.
//
// ⚠️ LUẬT 19: `now` là THAM SỐ, mọi mốc dưới đây TUYỆT ĐỐI. Không ca nào đọc đồng hồ thật,
// nên tờ lịch đổi không làm bộ này đổi màu.
//
// ── CẤY LẠI LỖI (luật 15) — đã chạy THẬT, số đo của CẢ TỆP (33 ca, khối này 8 ca) ────
//   · `ngoaiCuaSoNgayGvBuoi` trả thẳng `false` (không chặn gì)   → **5 ĐỎ / 33**
//   · nới hai hằng thành 3650 ngày ("cho rộng rãi")              → **5 ĐỎ / 33**
//   · bỏ vế `!YMD.test(...)` (fail-OPEN cho chuỗi rác)           → **1 ĐỎ / 33**
// ═════════════════════════════════════════════════════════════════════════════════════

describe("ngoaiCuaSoNgayGvBuoi — chặn dò lưới ca bằng cách hỏi lặp theo ngày", () => {
  /** 17/09/2026 lúc 10:00 VN. Mốc TUYỆT ĐỐI. */
  const NOW = new Date("2026-09-17T03:00:00.000Z");
  const trongCuaSo = (ymd: string) => !ngoaiCuaSoNgayGvBuoi({ ymd, now: NOW });

  it("hôm nay và vài ngày quanh đó luôn hỏi được", () => {
    expect(trongCuaSo("2026-09-17")).toBe(true);
    expect(trongCuaSo("2026-09-16")).toBe(true);
    expect(trongCuaSo("2026-09-30")).toBe(true);
  });

  // ⭐ CA KHOÁ hai mép. Con số lấy từ hằng, phép tính ghi ở `schemas.ts`.
  it("mép QUÁ KHỨ: đúng 60 ngày trước còn được, 61 ngày thì KHÔNG", () => {
    // 17/09 − 60 ngày = 19/07/2026.
    expect(trongCuaSo("2026-07-19")).toBe(true);
    expect(trongCuaSo("2026-07-18")).toBe(false);
  });

  it("mép TƯƠNG LAI: đúng 180 ngày sau còn được, 181 ngày thì KHÔNG", () => {
    // 17/09 + 180 ngày = 16/03/2027.
    expect(trongCuaSo("2027-03-16")).toBe(true);
    expect(trongCuaSo("2027-03-17")).toBe(false);
  });

  it("ngày xa hẳn (dò lưới ca năm ngoái / năm sau) bị chặn", () => {
    expect(trongCuaSo("2025-01-05")).toBe(false);
    expect(trongCuaSo("2028-01-05")).toBe(false);
  });

  it("chuỗi KHÔNG phải ngày ⇒ coi là NGOÀI cửa sổ (fail-closed)", () => {
    // Zod đã chặn trước, nên đây là lưới thứ hai. Fail-OPEN ở đây nghĩa là ai bỏ được
    // lưới đầu thì đi thẳng qua lưới hai — hai lưới cùng hướng mới là hai lưới.
    expect(trongCuaSo("hôm nay")).toBe(false);
    expect(trongCuaSo("")).toBe(false);
    expect(trongCuaSo("2026-9-17")).toBe(false);
  });

  // ⚠️ Ca này canh việc "hôm nay" đọc theo LỊCH VN, không theo lịch UTC của tiến trình.
  it("mốc 23:30 giờ VN (= 16:30Z) vẫn tính HÔM NAY theo lịch VN, không lùi một ngày", () => {
    // 2026-09-17T16:30Z = 23:30 ngày 17/09 ở VN. Cửa sổ quá khứ phải neo vào 19/07.
    const khuya = new Date("2026-09-17T16:30:00.000Z");
    expect(ngoaiCuaSoNgayGvBuoi({ ymd: "2026-07-19", now: khuya })).toBe(false);
    expect(ngoaiCuaSoNgayGvBuoi({ ymd: "2026-07-18", now: khuya })).toBe(true);
  });

  it("mốc 00:30 giờ VN (= 17:30Z hôm trước) đã sang NGÀY MỚI theo lịch VN", () => {
    // 2026-09-17T17:30Z = 00:30 ngày 18/09 ở VN ⇒ cửa sổ dịch lên một ngày.
    const nuaDem = new Date("2026-09-17T17:30:00.000Z");
    expect(ngoaiCuaSoNgayGvBuoi({ ymd: "2026-07-20", now: nuaDem })).toBe(false);
    expect(ngoaiCuaSoNgayGvBuoi({ ymd: "2026-07-19", now: nuaDem })).toBe(true);
  });
});
