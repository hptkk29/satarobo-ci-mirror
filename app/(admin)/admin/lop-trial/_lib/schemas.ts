// app/(admin)/admin/lop-trial/_lib/schemas.ts — GĐ2.
//
// Zod schema + helper giờ VN riêng cho màn "Lớp Trial". CỐ Ý không dùng lại
// `lib/validators/trial.ts`: schema cũ nhận `scheduledAt` là chuỗi ISO do CLIENT dựng
// từ `new Date(...)`, tức phụ thuộc múi giờ máy người dùng. Màn mới đổi hợp đồng sang
// `scheduledAtVn` là chuỗi đồng hồ VN và để SERVER quy đổi bằng `lib/time/vn.ts`.
//
// File này THUẦN (không chạm DB, không server-only) để test được bằng vitest.
import { z } from "zod";
import { vnDateAt, vnParts, vnYmd } from "@/lib/time/vn";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** Định dạng của `<input type="datetime-local">`. */
const YMD_HM = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

// ─── Giờ VN: đổi qua lại giữa Date và chuỗi ô nhập ───────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Date → "YYYY-MM-DDTHH:mm" theo đồng hồ VN, để đổ vào `<input type="datetime-local">`.
 * KHÔNG dùng `getFullYear()`/`getHours()` vì chúng đọc múi giờ của tiến trình
 * (Vercel chạy UTC, máy dev +07) — đó chính là bug đang có ở màn cũ.
 */
export function toVnInput(d: Date): string {
  const p = vnParts(d);
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" (đồng hồ VN) → Date. Sai định dạng → null. */
export function parseVnInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = vnDateAt(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Mặt phẳng V2 ────────────────────────────────────────────────────────────

/**
 * Tạo lớp trải nghiệm — 28/08: chỉ còn CƠ SỞ + KHOÁ TRẢI NGHIỆM.
 *
 * Tên lớp KHÔNG nhận từ client: server tự sinh theo quy ước `Cơ sở_Lớp trial số`
 * (`tenLopTrial` trong `lib/trial/lop-moi.ts`). Cho client gửi tên là mời hai lớp trùng
 * tên và mời người sửa tay lệch khỏi quy ước.
 *
 * Giờ / phòng / giáo viên / sĩ số ĐÃ RỜI khỏi đây — chúng là thuộc tính của TỪNG BUỔI.
 * `sessionCount` cũng bỏ: số buổi nay là số buổi ĐÃ THÊM, không phải một con số khai
 * trước rồi không ai đối chiếu.
 */
export const createClassSchema = z.object({
  centerId: z.string().trim().min(1, "Chọn cơ sở"),
  /**
   * ⚠️ HAI FORM TRÊN MÀN KHÔNG CÒN GỬI TRƯỜNG NÀY (chốt 22/09/2026):
   * "qlcs không biết khung giờ đó sẽ có học viên trải nghiệm nào nên cũng không biết
   * khoá trải nghiệm nào". Lớp mở từ form mang `courseId = null`.
   *
   * Trường VẪN ở lại vì đường **import Excel** vẫn nhận `courseSlug` tuỳ chọn — file
   * do người dựng thì họ biết mình khai gì. Đừng gỡ nó đi vì "form không dùng nữa".
   */
  courseId: z.string().trim().min(1).nullable().optional(),
  /**
   * Tên lớp — ĐẢO chốt 28/08 theo yêu cầu chủ dự án 18/09 ("được sửa và tự do điều
   * chỉnh tên lớp"). Bỏ trống ⇒ server sinh theo quy ước, y như trước.
   *
   * Có TRẦN 120 ký tự: tên này đi thẳng vào phiếu gửi phụ huynh và vào cột bảng; một
   * chuỗi 5.000 ký tự dán vào đây không bị gì chặn thì nó sẽ phá mọi màn đọc nó.
   */
  name: z.string().trim().min(1).max(120, "Tên lớp tối đa 120 ký tự").nullable().optional(),
  /**
   * NGÀY + KHUNG GIỜ của lớp — ĐẢO chốt 28/08 theo yêu cầu chủ dự án 22/09/2026
   * ("Tạo lớp Trial theo ngày, thứ, và khung thời gian có GV đi làm").
   *
   * Chốt 28/08 đẩy giờ xuống TỪNG BUỔI và để ba cột này null ("lớp là slot tái sử dụng").
   * Nay lớp mang lại ngày + khung, vì đó là thứ Sale nhìn vào để chọn chỗ hẹn khách.
   * KHÔNG đảo phần giờ của BUỔI: lớp chỉ là KHUNG BAO, case vẫn có giờ riêng.
   *
   * BẮT BUỘC với lớp mới (không `.optional()`): lớp không ngày thì Sale không chọn
   * được "lớp trial ngày 22/09" như yêu cầu, và cổng khung giờ không có gì để so.
   */
  date: z.string().regex(YMD, "Chọn ngày mở lớp"),
  startTime: z.string().regex(HHMM, "Giờ bắt đầu không hợp lệ"),
  endTime: z.string().regex(HHMM, "Giờ kết thúc không hợp lệ"),
});

/**
 * Mở lớp cho CẢ KỲ — một khoảng ngày + NHIỀU TUỲ CHỌN.
 *
 * Chủ dự án 22/09/2026 (vòng 2): "chọn từ ngày đến ngày rồi phải chọn thêm giờ của kỳ
 * đó, và có thể + thêm tuỳ chọn khác, ví dụ: tạo kỳ 22/09-30/09 lịch t3-t6 và lịch t7-cn
 * riêng biệt".
 *
 * ~~Bản đầu không nhận giờ, mỗi ngày tự mở đúng các khung đã cấu hình~~ **[ĐẢO 22/09
 * vòng 2]** — yêu cầu mới đòi chọn giờ, và đòi tách lịch T3–T6 với lịch T7–CN. CỔNG
 * KHUNG GIỜ KHÔNG ĐỔI: mỗi tuỳ chọn vẫn phải nằm trọn trong một khung cho phép của TẪT
 * CẢ các thứ nó nhắm tới — kiểm từng NGÀY ở server.
 *
 * Một tuỳ chọn mang ĐÚNG MỘT khung: T7 muốn cả sáng lẫn chiều thì là HAI tuỳ chọn —
 * đó cũng là lý do nút "+ Thêm tuỳ chọn" tồn tại.
 */
export const taoTheoThuSchema = z
  .object({
    /**
     * Áp dụng cho NHỮNG cơ sở nào (chủ dự án 23/09: "thay vì chọn cơ sở thì nên để là áp
     * dụng cho cơ sở nào") — một kỳ mở cho nhiều cơ sở trong một lượt. Mỗi cơ sở vẫn
     * được kiểm quyền RIÊNG ở server.
     */
    centerIds: z
      .array(z.string().trim().min(1))
      .min(1, "Chọn ít nhất một cơ sở áp dụng")
      .max(20, "Tối đa 20 cơ sở một lượt"),
    tu: z.string().regex(YMD, "Chọn ngày bắt đầu"),
    den: z.string().regex(YMD, "Chọn ngày kết thúc"),
    quyTac: z
      .array(
        z.object({
          /** `vnWeekday`: 0=CN … 6=T7. */
          thu: z.array(z.number().int().min(0).max(6)).min(1, "Mỗi tuỳ chọn phải có ít nhất một thứ"),
          startTime: z.string().regex(HHMM, "Giờ bắt đầu không hợp lệ"),
          endTime: z.string().regex(HHMM, "Giờ kết thúc không hợp lệ"),
        }),
      )
      .min(1, "Thêm ít nhất một tuỳ chọn")
      // Trần 10: một kỳ có 7 thứ × vài khung là cùng; hơn thế gần như luôn là bấm nhầm.
      .max(10, "Tối đa 10 tuỳ chọn một lượt"),
  })
  .refine((d) => d.den >= d.tu, {
    message: "Ngày kết thúc phải sau ngày bắt đầu",
    path: ["den"],
  });


export const addSessionSchema = z
  .object({
    trialClassId: z.string().trim().min(1, "Thiếu lớp trải nghiệm"),
    date: z.string().regex(YMD, "Ngày buổi học không hợp lệ"),
    startTime: z.string().regex(HHMM, "Giờ bắt đầu không hợp lệ"),
    endTime: z.string().regex(HHMM, "Giờ kết thúc không hợp lệ"),
    // Bỏ trống → kế thừa GV/phòng của lớp (service tự fallback).
    teacherId: z.string().trim().min(1).nullable().optional(),
    roomId: z.string().trim().min(1).nullable().optional(),
  })
  .refine((d) => d.endTime > d.startTime, {
    message: "Giờ kết thúc phải sau giờ bắt đầu",
    path: ["endTime"],
  });

export const attendanceSchema = z.object({
  trialSessionId: z.string().trim().min(1, "Thiếu buổi học"),
  records: z
    .array(
      z.object({
        trialEnrollmentId: z.string().trim().min(1),
        status: z.enum(["PRESENT", "ABSENT"]),
        note: z.string().trim().max(2000).nullable().optional(),
      }),
    )
    .min(1, "Chưa có học viên để điểm danh"),
});

// ─── Mặt phẳng V1 ────────────────────────────────────────────────────────────

const nullableStr = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v == null || v === "" ? null : v));

export const updateBookingSchema = z.object({
  // Hợp đồng MỚI (khác `lib/validators/trial.ts`): chuỗi đồng hồ VN, không phải ISO.
  scheduledAtVn: z.string().regex(YMD_HM, "Thời gian không hợp lệ"),
  status: z.enum([
    "SCHEDULED",
    "CONFIRMED",
    "ATTENDED",
    "MISSED",
    "POSTPONED",
    "ENROLLED",
    "REJECTED",
  ]),
  teacherId: nullableStr,
  roomId: nullableStr,
  classId: nullableStr,
  notes: z.string().trim().max(2000).nullable().optional().transform((v) => (v ? v : null)),
});

export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

/**
 * SỬA một buổi đã tạo (28/08/2026): ngày · giờ · phòng · giáo viên.
 *
 * `reason` BẮT BUỘC — chủ dự án: "nếu sửa lịch học của buổi thì cần xác nhận và ghi
 * chú là dời lịch". Lý do không phải để lưu trữ cho đẹp: nó là NỘI DUNG thông báo đẩy
 * sang giáo viên. Cho phép bỏ trống thì giáo viên nhận một tin "buổi đã đổi" trống
 * rỗng và phải đi hỏi lại từng người.
 */
export const updateSessionSchema = z
  .object({
    sessionId: z.string().trim().min(1, "Thiếu buổi học"),
    date: z.string().regex(YMD, "Ngày buổi học không hợp lệ"),
    startTime: z.string().regex(HHMM, "Giờ bắt đầu không hợp lệ"),
    endTime: z.string().regex(HHMM, "Giờ kết thúc không hợp lệ"),
    roomId: z.string().trim().min(1).nullable().optional(),
    teacherId: z.string().trim().min(1).nullable().optional(),
    reason: z.string().trim().min(3, "Ghi rõ lý do dời lịch (ít nhất 3 ký tự)").max(500),
  })
  .refine((d) => d.endTime > d.startTime, {
    message: "Giờ kết thúc phải sau giờ bắt đầu",
    path: ["endTime"],
  });

/** HUỶ một buổi. Lý do bắt buộc, và đi thẳng vào thông báo gửi giáo viên. */
export const cancelSessionSchema = z.object({
  sessionId: z.string().trim().min(1, "Thiếu buổi học"),
  reason: z.string().trim().min(3, "Ghi rõ lý do huỷ buổi (ít nhất 3 ký tự)").max(500),
});

/**
 * Đầu vào của `layGvChoBuoiAction` — đường ĐỌC, nhưng vẫn phải gác HÌNH DẠNG.
 *
 * ⚠️ Vì sao một đường đọc cũng cần zod, dù chữ ký TypeScript của action đã khai đủ kiểu:
 * kiểu của một Server Action là lời hứa của TRÌNH BIÊN DỊCH với các chỗ gọi TRONG repo,
 * không phải một cái cổng. Trình duyệt POST thẳng vào endpoint đó được, với payload bất
 * kỳ. Và ở đây payload bẩn không rơi vào nhánh `{ ok: false }` gọn gàng — nó NÉM:
 * `ngayVnSangUtc(input.date)` gọi `.trim()`, còn `date: 123` thì `.trim` không tồn tại.
 * Một action NÉM thì client nhận promise bị từ chối chứ không nhận `error`, nên chỗ gọi
 * đọc thành "không có gì đổi" và ô chọn giáo viên giữ nguyên danh sách CŨ — sai mà không
 * một dòng chữ nào hiện ra (đúng lớp lỗi luật 12). Bốn action ghi cùng tệp đều đã
 * `safeParse`; đây là cái duy nhất sót.
 *
 * `endTime > startTime` khoá cùng luật với `addSessionSchema`/`updateSessionSchema`: thiếu
 * vế này thì khung giờ ngược đời đi lọt tới `caPhuTronKhungGio`, ra `KHONG_PHU` cho TẤT
 * CẢ, và người dùng đọc được đúng một câu "không ai có ca phủ trọn 19:30–18:00" — câu đó
 * đổ lỗi cho lưới ca trong khi lỗi nằm ở hai ô giờ họ vừa gõ.
 */
export const gvChoBuoiSchema = z
  .object({
    trialClassId: z.string().trim().min(1, "Thiếu lớp trải nghiệm"),
    date: z.string().regex(YMD, "Ngày buổi học không hợp lệ"),
    startTime: z.string().regex(HHMM, "Giờ bắt đầu không hợp lệ"),
    endTime: z.string().regex(HHMM, "Giờ kết thúc không hợp lệ"),
    /** Buổi ĐANG SỬA — loại khỏi phép so trùng. Bỏ trống khi đang THÊM buổi mới. */
    excludeSessionId: z.string().trim().min(1).nullable().optional(),
    /**
     * Công tắc "Hiện tất cả giáo viên" — trạng thái UI của MỘT lượt chọn, không phải
     * cấu hình và không phải quyền.
     *
     * `.default(false)` là CÓ CHỦ ĐÍCH và không mâu thuẫn luật 7: luật đó cấm mặc định
     * nguy hiểm, và mặc định ở đây là vế ĐANG LỌC (hẹp), tức fail-closed. Đây là endpoint
     * — payload thiếu khoá đến từ một máy khách bất kỳ, và nó KHÔNG được tự mở bộ lọc.
     * Vế bắt-buộc-viết-ra nằm ở chữ ký TS của `layGvChoBuoiAction`, nơi `tsc` liệt kê
     * được call site; ở đây thì không có call site nào để liệt kê.
     */
    hienTatCa: z.boolean().default(false),
  })
  .refine((d) => d.endTime > d.startTime, {
    message: "Giờ kết thúc phải sau giờ bắt đầu",
    path: ["endTime"],
  });

// ─── Cửa sổ ngày hợp lệ của `layGvChoBuoiAction` ─────────────────────────────

/**
 * Bao nhiêu ngày TRƯỚC hôm nay còn hỏi được. 60 = hai tháng.
 *
 * PHÉP TÍNH: thứ duy nhất cần hỏi về QUÁ KHỨ là sửa lại một buổi đã diễn ra (đổi giáo
 * viên cho đúng người thật sự đã dạy). Kỳ công đóng theo THÁNG, nên ca xa nhất còn thực
 * tế là sửa buổi của tháng trước trong lúc chốt công — cùng lắm ~45 ngày. Lấy 60 cho có
 * biên, không lấy 365: mỗi ngày mở thêm là một ngày lịch ca đọc được bằng cách gọi lặp.
 */
export const GV_BUOI_LUI_TOI_DA_NGAY = 60;

/**
 * Bao nhiêu ngày SAU hôm nay còn hỏi được. 180 = sáu tháng.
 *
 * PHÉP TÍNH: buổi trải nghiệm được đặt trước xa nhất là theo đợt tuyển sinh — hết một
 * học kỳ, ~4–5 tháng. Lấy 180 để không chặn nhầm người đang xếp lịch hè từ mùa xuân.
 * Lưới ca chấm công cũng chỉ sinh trước vài tháng, nên xa hơn nữa thì câu trả lời của
 * hàm lọc cũng chỉ còn là `CHUA_CO_LUOI`.
 */
export const GV_BUOI_TOI_TOI_DA_NGAY = 180;

/**
 * Ngày `ymd` có nằm ngoài cửa sổ hợp lý quanh `now` không.
 *
 * ── VÌ SAO PHẢI CHẶN (vá 17/09/2026) ─────────────────────────────────────────────────
 * `gvChoBuoiSchema` chỉ kiểm HÌNH DẠNG `YYYY-MM-DD`, không buộc ngày phải dính vào buổi
 * nào của lớp — mà endpoint thì trả về trạng thái ca của TỪNG giáo viên cho ngày đó. Gọi
 * lặp theo từng ngày là dựng lại được lưới ca nhiều năm. Che nhãn (`duocXemLyDoNghi`) bịt
 * phần CHỮ; cửa sổ này bịt phần KHỐI LƯỢNG — thiếu một trong hai vế thì vế kia vẫn rò.
 *
 * ⚠️ Hàm THUẦN, `now` là THAM SỐ BẮT BUỘC (luật 19). Tự gọi `new Date()` ở đây là biến
 * mọi ca test thành ca hẹn giờ nổ: mã không đổi, tờ lịch đổi thì đỏ.
 *
 * So bằng CHUỖI "YYYY-MM-DD" theo lịch VN (`vnYmd`), không so bằng mốc `Date`: hai mép
 * cửa sổ chỉ có nghĩa theo NGÀY, và so mốc thì lệch múi giờ đúng một ngày ở hai đầu.
 * Sai định dạng ⇒ `true` (ngoài cửa sổ) — fail-closed; nhánh đó đã bị zod chặn trước,
 * nên đây chỉ là lưới thứ hai.
 */
export function ngoaiCuaSoNgayGvBuoi(input: { ymd: string; now: Date }): boolean {
  if (!YMD.test(input.ymd.trim())) return true;
  const ngay = input.ymd.trim();
  const som = vnYmd(new Date(input.now.getTime() - GV_BUOI_LUI_TOI_DA_NGAY * 86_400_000));
  const muon = vnYmd(new Date(input.now.getTime() + GV_BUOI_TOI_TOI_DA_NGAY * 86_400_000));
  return ngay < som || ngay > muon;
}
