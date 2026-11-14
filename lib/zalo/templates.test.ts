import { describe, it, expect } from "vitest";
import {
  ZNS_TUITION_PARAM_SPEC,
  ZNS_ACCOUNT_PARAM_SPEC,
  ZNS_BIRTHDAY_PARAM_SPEC,
  ZNS_CHAT_NEW_MESSAGE_PARAM_SPEC,
  buildTuitionZnsParams,
  buildAccountZnsParams,
  buildBirthdayZnsParams,
  buildChatNewMessageZnsParams,
  formatZnsDateTime,
  type TuitionZnsInput,
} from "./templates";

// =============================================================================
// Bất biến: params gửi đi PHẢI khớp bảng khai của mẫu đã duyệt.
//
// Vì sao cần lưới này: mọi nơi gọi ZNS đều nuốt lỗi (`.catch(() => {})`) để
// không chặn luồng tiền ⇒ gửi sai tham số thì Zalo trả -1122, tin không tới,
// mà log ứng dụng vẫn sạch và người dùng vẫn thấy "thành công". Không có test
// nào bắt được, chỉ phụ huynh im lặng không nhận tin. Bug PR #77 sống được là
// vì vậy — và trước bản vá này nó đang lặp lại ở 2 chỗ gọi mẫu 616258.
// =============================================================================

const BASE: TuitionZnsInput = {
  at: new Date("2026-07-31T05:00:00.000Z"), // 12:00:00 giờ VN
  phone: "84901234567",
  courseName: "Sata 4",
  totalFee: 5_000_000,
  paidFee: 2_500_000,
  studentName: "Nguyễn Văn A",
};

describe("buildTuitionZnsParams — hợp đồng với mẫu 616258", () => {
  it("trả ĐÚNG bộ khoá mà mẫu khai — không thiếu, không thừa", () => {
    const params = buildTuitionZnsParams(BASE);
    expect(Object.keys(params).sort()).toEqual(Object.keys(ZNS_TUITION_PARAM_SPEC).sort());
  });

  it("mỗi tham số đúng KIỂU mẫu khai (tiền là number, không phải chuỗi có dấu chấm)", () => {
    const params = buildTuitionZnsParams(BASE);
    for (const [key, spec] of Object.entries(ZNS_TUITION_PARAM_SPEC)) {
      expect(typeof params[key], `tham số ${key}`).toBe(spec.type);
    }
    expect(params.total_course_fee).toBe(5_000_000);
    expect(params.paid_fee).toBe(2_500_000);
  });

  it("không tham số nào vượt giới hạn ký tự của mẫu", () => {
    const params = buildTuitionZnsParams({
      ...BASE,
      courseName: "K".repeat(500),
      studentName: "T".repeat(200),
    });
    for (const [key, spec] of Object.entries(ZNS_TUITION_PARAM_SPEC)) {
      expect(String(params[key]).length, `tham số ${key}`).toBeLessThanOrEqual(spec.max);
    }
  });

  it("SĐT hiển thị dạng nội địa 0… (mẫu khai ví dụ 0987654321), nhận vào dạng nào cũng được", () => {
    expect(buildTuitionZnsParams({ ...BASE, phone: "84901234567" }).phone).toBe("0901234567");
    expect(buildTuitionZnsParams({ ...BASE, phone: "0901234567" }).phone).toBe("0901234567");
    expect(buildTuitionZnsParams({ ...BASE, phone: "+84 901 234 567" }).phone).toBe("0901234567");
  });

  it("thiếu tên học viên / tên khoá thì thay bằng chữ đỡ, KHÔNG gửi chuỗi rỗng", () => {
    const params = buildTuitionZnsParams({ ...BASE, courseName: null, studentName: "  " });
    expect(params.course).toBe("Khoá học");
    expect(params.studentName).toBe("Quý phụ huynh");
  });

  it("số tiền âm / NaN bị kéo về 0 thay vì đẩy rác sang Zalo", () => {
    const params = buildTuitionZnsParams({ ...BASE, totalFee: Number.NaN, paidFee: -1 });
    expect(params.total_course_fee).toBe(0);
    expect(params.paid_fee).toBe(0);
  });
});

describe("buildAccountZnsParams — hợp đồng với mẫu 616899", () => {
  it("trả ĐÚNG bộ khoá mà mẫu khai — không thiếu, không thừa (login_url là nội dung tĩnh)", () => {
    const params = buildAccountZnsParams({ customerName: "Nguyễn Văn A", phone: "84901234567" });
    expect(Object.keys(params).sort()).toEqual(Object.keys(ZNS_ACCOUNT_PARAM_SPEC).sort());
  });

  it("không tham số nào vượt giới hạn ký tự của mẫu", () => {
    const params = buildAccountZnsParams({ customerName: "T".repeat(200), phone: "84901234567" });
    for (const [key, spec] of Object.entries(ZNS_ACCOUNT_PARAM_SPEC)) {
      expect(String(params[key]).length, `tham số ${key}`).toBeLessThanOrEqual(spec.max);
    }
  });

  it("login_id là SĐT dạng nội địa 0…, nhận vào dạng nào cũng được", () => {
    expect(buildAccountZnsParams({ customerName: "A", phone: "84901234567" }).login_id).toBe("0901234567");
    expect(buildAccountZnsParams({ customerName: "A", phone: "0901234567" }).login_id).toBe("0901234567");
  });

  it("thiếu tên thì thay bằng chữ đỡ, KHÔNG gửi chuỗi rỗng", () => {
    expect(buildAccountZnsParams({ customerName: "  ", phone: "84901234567" }).name).toBe("Quý phụ huynh");
    expect(buildAccountZnsParams({ customerName: null, phone: "84901234567" }).name).toBe("Quý phụ huynh");
  });
});

describe("buildBirthdayZnsParams — hợp đồng với mẫu chúc mừng sinh nhật", () => {
  const BIRTHDAY = { studentName: "Nguyễn Văn A", dateText: "20/08/2026" };

  it("trả ĐÚNG bộ khoá mà mẫu khai — không thiếu, không thừa", () => {
    expect(Object.keys(buildBirthdayZnsParams(BIRTHDAY)).sort()).toEqual(
      Object.keys(ZNS_BIRTHDAY_PARAM_SPEC).sort(),
    );
  });

  it("mỗi tham số đúng KIỂU mẫu khai", () => {
    const params = buildBirthdayZnsParams(BIRTHDAY);
    for (const [key, spec] of Object.entries(ZNS_BIRTHDAY_PARAM_SPEC)) {
      expect(typeof params[key], `tham số ${key}`).toBe(spec.type);
    }
  });

  it("không tham số nào vượt giới hạn ký tự của mẫu", () => {
    const params = buildBirthdayZnsParams({ studentName: "T".repeat(200), dateText: "20/08/2026" });
    for (const [key, spec] of Object.entries(ZNS_BIRTHDAY_PARAM_SPEC)) {
      expect(String(params[key]).length, `tham số ${key}`).toBeLessThanOrEqual(spec.max);
    }
  });

  it("thiếu tên học viên thì thay bằng chữ đỡ, KHÔNG gửi chuỗi rỗng", () => {
    expect(buildBirthdayZnsParams({ ...BIRTHDAY, studentName: "  " }).studentName).toBe("Bé yêu");
    expect(buildBirthdayZnsParams({ ...BIRTHDAY, studentName: null }).studentName).toBe("Bé yêu");
  });
});

describe("buildChatNewMessageZnsParams — hợp đồng với mẫu 'có tin nhắn mới' (US-14)", () => {
  const CHAT = {
    className: "Sata 4 — T3/T5",
    senderName: "Cô Lan",
    at: new Date("2026-08-10T03:05:00.000Z"), // 10:05 giờ VN
  };

  it("trả ĐÚNG bộ khoá mà mẫu khai — không thiếu, không thừa", () => {
    expect(Object.keys(buildChatNewMessageZnsParams(CHAT)).sort()).toEqual(
      Object.keys(ZNS_CHAT_NEW_MESSAGE_PARAM_SPEC).sort(),
    );
  });

  it("KHÔNG có tham số nào mang nội dung tin nhắn (BR-30)", () => {
    // Cột mốc của story: ZNS rời khỏi hệ thống, không thu hồi được. Thêm `body`/`preview`
    // vào mẫu là đưa nội dung trao đổi của lớp ra ngoài — cấm tuyệt đối.
    const keys = Object.keys(ZNS_CHAT_NEW_MESSAGE_PARAM_SPEC);
    for (const banned of ["body", "message", "preview", "content", "phone", "email"]) {
      expect(keys, `mẫu không được có tham số ${banned}`).not.toContain(banned);
    }
  });

  it("mỗi tham số đúng KIỂU mẫu khai", () => {
    const params = buildChatNewMessageZnsParams(CHAT);
    for (const [key, spec] of Object.entries(ZNS_CHAT_NEW_MESSAGE_PARAM_SPEC)) {
      expect(typeof params[key], `tham số ${key}`).toBe(spec.type);
    }
  });

  it("không tham số nào vượt giới hạn ký tự của mẫu", () => {
    const params = buildChatNewMessageZnsParams({
      className: "L".repeat(300),
      senderName: "T".repeat(300),
      at: CHAT.at,
    });
    for (const [key, spec] of Object.entries(ZNS_CHAT_NEW_MESSAGE_PARAM_SPEC)) {
      expect(String(params[key]).length, `tham số ${key}`).toBeLessThanOrEqual(spec.max);
    }
  });

  it("thiếu tên lớp / tên người gửi thì thay bằng chữ đỡ, KHÔNG gửi chuỗi rỗng", () => {
    const params = buildChatNewMessageZnsParams({ className: null, senderName: "  ", at: CHAT.at });
    expect(params.className).toBe("Lớp của con");
    expect(params.senderName).toBe("Giáo viên");
  });

  it("mốc giờ là GIỜ VIỆT NAM của tin, không phải giờ máy chủ", () => {
    expect(buildChatNewMessageZnsParams(CHAT).time).toBe("10:05 10/08/2026");
  });
});

describe("formatZnsDateTime", () => {
  it("đúng định dạng HH:mm:ss dd/MM/yyyy", () => {
    expect(formatZnsDateTime(BASE.at)).toMatch(/^\d{2}:\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
  });

  it("lấy GIỜ VIỆT NAM, không lấy giờ máy chủ (Vercel chạy hnd1 = UTC+9)", () => {
    // 2026-07-31T05:00:00Z = 12:00 VN (UTC+7). Lấy giờ hnd1 sẽ ra 14:00 → sai.
    expect(formatZnsDateTime(BASE.at)).toBe("12:00:00 31/07/2026");
  });

  it("nửa đêm ra 00:xx chứ không phải 24:xx", () => {
    // 2026-07-30T17:00:00Z = 00:00 ngày 31/07 giờ VN.
    expect(formatZnsDateTime(new Date("2026-07-30T17:00:00.000Z"))).toBe("00:00:00 31/07/2026");
  });
});

// 07/08 — 2 công tắc ZNS chuyển từ env sang SystemSetting để admin tự chỉnh.
// Khoá TRẠNG THÁI AN TOÀN: rỗng/false = KHÔNG gửi. Đây là 2 công tắc đụng tiền
// thật (400đ/tin) và khách thật, nên mặc định phải là không gửi.
describe("công tắc ZNS trong cấu hình hệ thống", () => {
  it("công tắc gửi Cấp tài khoản mặc định TẮT — chưa cấp TK cho PH (chốt 07/08)", async () => {
    const { SETTINGS } = await import("@/lib/settings/registry");
    expect(SETTINGS["zalo.znsAccountEnabled"].default).toBe(false);
  });

  it("mã mẫu GIỮ NGUYÊN giá trị dù công tắc tắt — tắt/bật không mất số đã nhập", async () => {
    const { SETTINGS } = await import("@/lib/settings/registry");
    expect(SETTINGS["zalo.znsTemplateAccount"].default).toBe("616899");
  });

  it("gửi ZNS thật mặc định TẮT — bật nhầm là mất tiền hàng loạt", async () => {
    const { SETTINGS } = await import("@/lib/settings/registry");
    expect(SETTINGS["zalo.znsLive"].default).toBe(false);
  });

  it("US-14: báo tin nhắn mới mặc định TẮT và CHƯA có mã mẫu — không tự tiêu tiền", async () => {
    const { SETTINGS } = await import("@/lib/settings/registry");
    expect(SETTINGS["chat.znsNotifyEnabled"].default).toBe(false);
    // Rỗng = skip an toàn. Chỉ điền sau khi mẫu được Zalo duyệt và đã đối chiếu
    // bảng tham số thật với ZNS_CHAT_NEW_MESSAGE_PARAM_SPEC.
    expect(SETTINGS["chat.znsTemplateNewMessage"].default).toBe("");
  });

  it("US-14: ngưỡng mặc định 6 tiếng, thông báo có ô RIÊNG hạ được xuống 30 phút", async () => {
    const { SETTINGS } = await import("@/lib/settings/registry");
    expect(SETTINGS["chat.znsUnreadMinutes"].default).toBe(360);
    expect(SETTINGS["chat.znsAnnouncementUnreadMinutes"].default).toBe(360);
    expect(SETTINGS["chat.znsAnnouncementUnreadMinutes"].schema.safeParse(30).success).toBe(true);
    expect(SETTINGS["chat.znsCooldownMinutes"].default).toBe(360);
  });

  it("mẫu Cấp tài khoản chỉ nhận chữ số — chặn gõ nhầm tên mẫu", async () => {
    const { SETTINGS } = await import("@/lib/settings/registry");
    const s = SETTINGS["zalo.znsTemplateAccount"].schema;
    expect(s.safeParse("616899").success).toBe(true);
    expect(s.safeParse("").success).toBe(true); // rỗng vẫn hợp lệ (chưa có mẫu)
    expect(s.safeParse("Cấp tài khoản").success).toBe(false);
  });
});
