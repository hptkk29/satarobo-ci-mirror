import { formatPhoneVN } from "@/lib/phone";

// =============================================================================
// Bảng khai THAM SỐ của các mẫu ZNS đã được Zalo duyệt + hàm dựng params.
//
// ⚠️ Tên tham số là HỢP ĐỒNG với mẫu đã duyệt, KHÔNG phải tên ta tự đặt lúc soạn
// nội dung. Gửi sai tên / thiếu tham số → Zalo trả `-1122 template data is
// missing a parameter`, tin KHÔNG tới, mà luồng gọi vẫn báo thành công (mọi nơi
// gọi đều `.catch(() => {})` để không chặn luồng tiền). Đó đúng là bug PR #77:
// mẫu Xác thực bắt buộc tên `otp`, code gửi `code`.
//
// Trước bản vá này, hai nơi gọi mẫu học phí gửi bộ tham số hoàn toàn khác bảng
// khai của 616258 — đặt env `ZALO_ZNS_TEMPLATE_PAYMENT` là hỏng ngay cả hai
// đường mà không ai thấy. File này gom hợp đồng về một chỗ; `templates.test.ts`
// đối chiếu bộ khoá do hàm dựng sinh ra với bảng khai, nên sửa lệch một bên là
// test đỏ chứ không phải phụ huynh im lặng không nhận tin.
//
// Đổi mẫu bên Zalo (thêm/bớt/đổi tên tham số) ⇒ PHẢI sửa bảng này theo.
// =============================================================================

type ParamSpec = { readonly type: "string" | "number"; readonly max: number };

/**
 * Mẫu **"Thông báo xác nhận học phí"** — ZBS `616258`, Mẫu tuỳ chỉnh,
 * 700đ/tin qua SĐT · 490đ/tin qua UID · Ztime 7200s.
 *
 * `max` là giới hạn ký tự Zalo khai trong mẫu — vượt là bị từ chối.
 */
export const ZNS_TUITION_PARAM_SPEC = {
  date: { type: "string", max: 20 },
  phone: { type: "string", max: 15 },
  course: { type: "string", max: 200 },
  total_course_fee: { type: "number", max: 20 },
  paid_fee: { type: "number", max: 20 },
  studentName: { type: "string", max: 50 },
} as const satisfies Record<string, ParamSpec>;

/**
 * Mẫu **"Thông báo nhận mã OTP"** — ZBS `616128`, Mẫu OTP,
 * 400đ/tin qua SĐT · 280đ/tin qua UID · Ztime 15s.
 *
 * Mẫu chỉ khai đúng một tham số. `lib/zalo/otp-provider.ts` gửi kèm `minutes`:
 * Zalo bỏ qua tham số thừa (đã chứng minh bằng tin thật 01/08/2026) nên không
 * gãy, nhưng đó là dư thừa — đừng lấy làm tiền lệ.
 */
export const ZNS_OTP_PARAM_SPEC = {
  otp: { type: "string", max: 10 },
} as const satisfies Record<string, ParamSpec>;

/**
 * Mẫu **"Cấp tài khoản"** — ZBS `616899`, Mẫu tuỳ chỉnh,
 * 400đ/tin qua SĐT · 280đ/tin qua UID · Ztime 7200s, mục đích Giao dịch.
 *
 * ⚠️ **Tạo 14h10 01/08/2026, ĐANG CHỜ ZALO DUYỆT (2–3 ngày làm việc).** Trước
 * khi được duyệt, đặt `ZALO_ZNS_TEMPLATE_ACCOUNT="616899"` thì mọi cú gửi đều
 * hỏng — mà `lib/parents/provision.ts` nuốt lỗi nên sẽ im lặng. Duyệt xong PHẢI
 * mở lại bảng tham số thật trên ZBS đối chiếu với bảng dưới rồi mới bật.
 *
 * Mẫu khai đúng 2 tham số. **Không có `login_url`** — đường dẫn kích hoạt nằm
 * trong phần nội dung TĨNH của mẫu, không phải tham số; bản `provision.ts` đầu
 * tiên gửi kèm `login_url` là thừa (chưa từng tới Zalo vì mẫu chưa duyệt).
 */
export const ZNS_ACCOUNT_PARAM_SPEC = {
  name: { type: "string", max: 30 },
  login_id: { type: "string", max: 15 },
} as const satisfies Record<string, ParamSpec>;

/**
 * Mẫu **"Chúc mừng sinh nhật"** — mục đích *Chăm sóc khách hàng*.
 *
 * 🔴 **MẪU CHƯA TỒN TẠI TRÊN ZBS** (06/08/2026). Bảng dưới là bộ tham số ĐỀ XUẤT
 * khi soạn mẫu. Sau khi Zalo duyệt (2–3 ngày làm việc) PHẢI mở bảng "Nội dung tham
 * số" thật trên ZBS đối chiếu rồi mới đặt `zalo.znsTemplateBirthday` — đặt ID mẫu
 * chưa duyệt / lệch tham số thì Zalo trả `-1122` và tin không tới, trong khi luồng
 * gọi vẫn báo thành công. Đúng vết mẫu 616899 và bug PR #77.
 *
 * ⚠️ Khác mẫu Xác thực (Tag 1, gửi 24/7): tin CSKH **dính khung cấm 22:00–06:00**
 * (mã lỗi `-133`). Cron chạy 08:00 giờ VN nên an toàn — đừng dời lịch cron ra ngoài
 * khung cho phép.
 */
export const ZNS_BIRTHDAY_PARAM_SPEC = {
  studentName: { type: "string", max: 50 },
  /** Ngày sinh nhật dạng `dd/MM/yyyy` — 10 ký tự. */
  date: { type: "string", max: 20 },
} as const satisfies Record<string, ParamSpec>;

/**
 * Mẫu **"Có tin nhắn mới trong nhóm lớp"** (US-14) — mục đích *Chăm sóc khách hàng*.
 *
 * ⚠️ **KHÔNG có tham số nội dung tin nhắn — và đừng bao giờ thêm.** ZNS rời khỏi hệ
 * thống (không thu hồi được, không kiểm soát được ai đọc trên máy phụ huynh); BR-30
 * cấm đưa nội dung/liên hệ ra ngoài. Tin chỉ nói "lớp nào, ai nhắn, lúc mấy giờ" —
 * muốn đọc thì mở portal, nơi quyền đọc được kiểm đúng một chỗ.
 *
 * Bộ tham số dưới đây khớp mẫu chủ dự án đã tạo trên ZBS (chốt 09/08/2026): đúng 3
 * khoá. Đổi mẫu bên Zalo ⇒ sửa bảng này theo, `templates.test.ts` sẽ bắt lệch.
 *
 * ⚠️ Tin CSKH **dính khung cấm 22:00–06:00 giờ VN** (mã `-133`) — cron gửi phải tự
 * hoãn qua khung, xem `lib/chat/zns-notify-rules.ts` (`isVnQuietHour`).
 */
export const ZNS_CHAT_NEW_MESSAGE_PARAM_SPEC = {
  className: { type: "string", max: 50 },
  senderName: { type: "string", max: 50 },
  /** Mốc tin nhắn dạng `HH:mm dd/MM/yyyy` — 16 ký tự. */
  time: { type: "string", max: 20 },
} as const satisfies Record<string, ParamSpec>;

const VN_TZ = "Asia/Ho_Chi_Minh";

/**
 * Định dạng `HH:mm:ss dd/MM/yyyy` — đúng bản mẫu khai ở ô "Nội dung tham số"
 * của 616258 (`12:00:00 31/07/2026`), dài 19 ký tự ≤ 20.
 *
 * Ép múi giờ Việt Nam: app chạy region `hnd1` (UTC+9), lấy giờ máy sẽ lệch 2
 * tiếng so với giờ phụ huynh đọc trên tin.
 */
export function formatZnsDateTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}:${get("second")} ${get("day")}/${get("month")}/${get("year")}`;
}

/**
 * Định dạng `HH:mm dd/MM/yyyy` (16 ký tự) — mẫu tin nhắn mới khai `time` không có giây.
 * Cùng lý do ép múi giờ VN như `formatZnsDateTime`: app chạy region `hnd1` (UTC+9),
 * lấy giờ máy thì phụ huynh đọc lệch 2 tiếng so với lúc giáo viên thực sự nhắn.
 */
export function formatZnsShortDateTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")} ${get("day")}/${get("month")}/${get("year")}`;
}

/** Cắt theo giới hạn mẫu + thay rỗng bằng chữ đỡ, để không gửi chuỗi trống. */
function clamp(raw: string | null | undefined, max: number, fallback: string): string {
  const s = (raw ?? "").trim() || fallback;
  return s.length > max ? s.slice(0, max) : s;
}

/** Tiền gửi đi phải là SỐ (mẫu khai kiểu number) — không phải chuỗi "1.000.000". */
function money(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

export type TuitionZnsInput = {
  /** Mốc thời gian hiển thị trên tin — dùng `paidAt` nếu đã thu, không thì `createdAt`. */
  at: Date;
  /** SĐT phụ huynh (dạng nào cũng được, hàm tự đưa về `0XXXXXXXXX` để đọc). */
  phone: string;
  courseName: string | null;
  totalFee: number;
  paidFee: number;
  studentName: string | null;
};

/**
 * Dựng params cho mẫu học phí `616258` — đúng 6 khoá, đúng kiểu, đúng giới hạn.
 * THUẦN: không chạm DB/mạng nên test được trực tiếp.
 */
export function buildTuitionZnsParams(input: TuitionZnsInput): Record<string, string | number> {
  return {
    date: formatZnsDateTime(input.at),
    phone: clamp(formatPhoneVN(input.phone), ZNS_TUITION_PARAM_SPEC.phone.max, "—"),
    course: clamp(input.courseName, ZNS_TUITION_PARAM_SPEC.course.max, "Khoá học"),
    total_course_fee: money(input.totalFee),
    paid_fee: money(input.paidFee),
    studentName: clamp(input.studentName, ZNS_TUITION_PARAM_SPEC.studentName.max, "Quý phụ huynh"),
  };
}

export type AccountZnsInput = {
  /** Tên phụ huynh đứng đơn — mẫu giới hạn 30 ký tự, tên dài bị cắt chứ không bị từ chối. */
  customerName: string | null;
  /** SĐT đăng nhập (dạng nào cũng được, hàm tự đưa về `0XXXXXXXXX` để đọc). */
  phone: string;
};

/**
 * Dựng params cho mẫu cấp tài khoản `616899` — đúng 2 khoá mẫu khai.
 * THUẦN: không chạm DB/mạng nên test được trực tiếp.
 */
export function buildAccountZnsParams(input: AccountZnsInput): Record<string, string | number> {
  return {
    name: clamp(input.customerName, ZNS_ACCOUNT_PARAM_SPEC.name.max, "Quý phụ huynh"),
    login_id: clamp(formatPhoneVN(input.phone), ZNS_ACCOUNT_PARAM_SPEC.login_id.max, "—"),
  };
}

export type BirthdayZnsInput = {
  studentName: string | null;
  /** Ngày sinh nhật ĐÃ định dạng `dd/MM/yyyy` theo ngày lịch VN.
   *  Chuỗi chứ không phải Date: chỗ gọi đã quy về ngày lịch đúng qua `vnDayKey`,
   *  nhận Date ở đây là mở lại đường format theo giờ máy chạy (lệch 1 ngày). */
  dateText: string;
};

/**
 * Dựng params cho mẫu chúc mừng sinh nhật — đúng bộ khoá `ZNS_BIRTHDAY_PARAM_SPEC`.
 * THUẦN: không chạm DB/mạng nên test được trực tiếp.
 */
export function buildBirthdayZnsParams(input: BirthdayZnsInput): Record<string, string | number> {
  return {
    studentName: clamp(input.studentName, ZNS_BIRTHDAY_PARAM_SPEC.studentName.max, "Bé yêu"),
    date: clamp(input.dateText, ZNS_BIRTHDAY_PARAM_SPEC.date.max, "—"),
  };
}

export type ChatNewMessageZnsInput = {
  /** Tên lớp — KHÔNG phải tên hội thoại tự do do người dùng đặt. */
  className: string | null;
  /** Tên người gửi (GV/QLCS). Chỗ gọi đã che liên hệ bằng `redactContactLike`. */
  senderName: string | null;
  /** Mốc tin nhắn — hàm tự ép về đồng hồ VN, truyền `Date` thô là đúng. */
  at: Date;
};

/**
 * Dựng params cho mẫu "có tin nhắn mới" — đúng bộ khoá `ZNS_CHAT_NEW_MESSAGE_PARAM_SPEC`.
 * THUẦN: không chạm DB/mạng nên test được trực tiếp.
 *
 * ⚠️ Không nhận `body`/`preview`: nội dung tin KHÔNG được rời hệ thống (BR-30).
 */
export function buildChatNewMessageZnsParams(
  input: ChatNewMessageZnsInput,
): Record<string, string | number> {
  return {
    className: clamp(input.className, ZNS_CHAT_NEW_MESSAGE_PARAM_SPEC.className.max, "Lớp của con"),
    senderName: clamp(input.senderName, ZNS_CHAT_NEW_MESSAGE_PARAM_SPEC.senderName.max, "Giáo viên"),
    time: clamp(formatZnsShortDateTime(input.at), ZNS_CHAT_NEW_MESSAGE_PARAM_SPEC.time.max, "—"),
  };
}
