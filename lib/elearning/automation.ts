import { z } from "zod";

/**
 * EL-18 — CỖ MÁY TỰ ĐỘNG HOÁ: kích hoạt → điều kiện → hành động.
 *
 * ⚠️ Ba luật cứng của cỗ máy này, và cả ba đều là quyết định đã ký chứ không phải sở
 * thích thiết kế:
 *
 *  1. **Điều kiện có CẤU TRÚC, không phải biểu thức tự do.** Một cỗ máy cho phép viết
 *     biểu thức tuỳ ý là một ngôn ngữ lập trình thứ hai nằm trong DB: không ai review
 *     được, không test được, và nó chạy với quyền hệ thống trên hồ sơ của người thật.
 *
 *  2. **Gợi ý khoá là RULE-BASED, luật viết ra.** Doc 15 §0 loại thẳng "AI learning
 *     path/prediction" khỏi phạm vi. Mọi thứ ở tệp này phải trả lời được câu "vì sao
 *     người này được giao khoá đó" bằng một câu tiếng Việt, không bằng một điểm số.
 *
 *  3. **KHÔNG có hành động chế tài.** QĐ-CDA-06: chạy chế độ chỉ-báo-cáo — "không leo
 *     thang kỷ luật, KHÔNG cờ đỏ hồ sơ nhân sự ở BẤT KỲ giá trị cấu hình nào". Vì vậy
 *     enum hành động thiếu chúng, chứ không phải chúng bị tắt bằng một cờ: cờ tắt
 *     được thì bật được, còn giá trị không có trong enum thì phải qua migration.
 */

export const KICH_HOAT = [
  "NHAN_SU_MOI",
  "KHOA_HOAN_THANH",
  "CHUNG_NHAN_HET_HAN",
  "YEU_CAU_MOI_AP_DUNG",
] as const;

export const HANH_DONG = ["GIAO_KHOA", "GIAO_LO_TRINH", "GUI_NHAC"] as const;

export type KichHoat = (typeof KICH_HOAT)[number];
export type HanhDong = (typeof HANH_DONG)[number];

/**
 * Hành động BỊ CẤM — danh sách viết ra để test canh được.
 *
 * Không phải để lọc lúc chạy (chúng không tồn tại trong enum). Nó ở đây để một người
 * đọc mã hiểu rằng sự vắng mặt là CÓ CHỦ ĐÍCH, và để test đỏ nếu ai đó thêm vào.
 */
export const HANH_DONG_BI_CAM = [
  "GAN_CO_HO_SO",
  "TRU_DIEM_DANH_GIA",
  "BAO_KY_LUAT",
  "LEO_THANG",
] as const;

/**
 * Điều kiện — mỗi kích hoạt có đúng những khoá của nó, không hơn.
 *
 * `.strict()` ở mọi nhánh: một khoá viết sai chính tả sẽ bị BÁC ngay lúc lưu, thay vì
 * lặng lẽ không khớp gì và người vận hành ngồi đợi một luật không bao giờ chạy.
 */
export const dieuKienSchema = z
  .object({
    /** NHAN_SU_MOI: vào làm trong vòng N ngày. */
    trongVongNgay: z.coerce.number().int().min(1).max(365).optional(),
    /** Lọc theo phòng ban — để trống là mọi phòng. */
    departmentId: z.string().trim().min(1).nullable().optional(),
    /** KHOA_HOAN_THANH: chỉ kích hoạt khi khoá vừa xong là khoá này. */
    courseId: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const hanhDongSchema = z
  .object({
    /** GIAO_KHOA */
    courseId: z.string().trim().min(1).nullable().optional(),
    /** GIAO_LO_TRINH */
    pathId: z.string().trim().min(1).nullable().optional(),
    /** GUI_NHAC */
    tieuDe: z.string().trim().min(1).max(200).nullable().optional(),
    noiDung: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict();

export type DieuKien = z.infer<typeof dieuKienSchema>;
export type ThamSoHanhDong = z.infer<typeof hanhDongSchema>;

export const luatSchema = z
  .object({
    code: z.string().trim().min(3).max(60),
    title: z.string().trim().min(3).max(200),
    trigger: z.enum(KICH_HOAT),
    action: z.enum(HANH_DONG),
    conditionJson: dieuKienSchema.default({}),
    actionJson: hanhDongSchema.default({}),
    enabled: z.boolean().default(false),
    dueDays: z.coerce.number().int().min(0).max(365).default(30),
    centerId: z.string().trim().min(1).nullable().optional().default(null),
  })
  .strict()
  .superRefine((d, ctx) => {
    // Hành động phải có đủ tham số của nó. Thiếu thì luật lưu được nhưng chạy vào
    // hư không — và nhật ký sẽ đầy dòng FAILED mà không ai biết vì sao.
    if (d.action === "GIAO_KHOA" && !d.actionJson.courseId) {
      ctx.addIssue({
        code: "custom",
        path: ["actionJson", "courseId"],
        message: "Hành động giao khoá phải chọn khoá",
      });
    }
    if (d.action === "GIAO_LO_TRINH" && !d.actionJson.pathId) {
      ctx.addIssue({
        code: "custom",
        path: ["actionJson", "pathId"],
        message: "Hành động giao lộ trình phải chọn lộ trình",
      });
    }
    if (d.action === "GUI_NHAC" && (!d.actionJson.tieuDe || !d.actionJson.noiDung)) {
      ctx.addIssue({
        code: "custom",
        path: ["actionJson", "tieuDe"],
        message: "Hành động gửi nhắc phải có tiêu đề và nội dung",
      });
    }
    if (d.trigger === "NHAN_SU_MOI" && d.conditionJson.trongVongNgay == null) {
      ctx.addIssue({
        code: "custom",
        path: ["conditionJson", "trongVongNgay"],
        message: "Kích hoạt 'nhân sự mới' phải nói rõ trong vòng bao nhiêu ngày",
      });
    }
  });

export type LuatTuDong = z.infer<typeof luatSchema>;

/** Người bị/được một luật xét. */
export type DoiTuong = {
  userId: string;
  departmentId: string | null;
  joinedAt: Date | null;
  /** Khoá vừa hoàn thành / chứng nhận vừa hết hạn — tuỳ kích hoạt. */
  courseId?: string | null;
};

export type KetQuaXet = {
  khop: boolean;
  /**
   * Câu tiếng Việt nói VÌ SAO khớp hoặc không.
   *
   * ⚠️ Bắt buộc, kể cả khi khớp. Đây là thứ phân biệt một cỗ máy luật với một mô hình
   * đoán: mọi lần hệ thống giao việc cho một con người, phải trả lời được "vì sao"
   * bằng một câu đọc được, không bằng một điểm số.
   */
  lyDo: string;
};

/**
 * XÉT một luật với một người. THUẦN — không chạm DB, test được từng nhánh.
 */
export function xetLuat(
  luat: { trigger: string; conditionJson: DieuKien },
  nguoi: DoiTuong,
  now: Date,
): KetQuaXet {
  const dk = luat.conditionJson;

  if (dk.departmentId != null && dk.departmentId !== nguoi.departmentId) {
    return {
      khop: false,
      lyDo: "Không thuộc phòng ban mà luật này áp",
    };
  }

  switch (luat.trigger) {
    case "NHAN_SU_MOI": {
      if (nguoi.joinedAt == null) {
        // ⚠️ Thiếu ngày vào làm ⇒ KHÔNG khớp, và nói rõ là thiếu dữ liệu chứ không
        // phải "không đủ điều kiện". Hai câu đó dẫn tới hai việc khác nhau: một bên
        // là bổ sung hồ sơ, bên kia là không làm gì cả.
        return { khop: false, lyDo: "Hồ sơ chưa có ngày vào làm — không xét được" };
      }
      const n = dk.trongVongNgay;
      if (n == null) {
        return { khop: false, lyDo: "Luật chưa khai 'trong vòng bao nhiêu ngày'" };
      }
      const soNgay = Math.floor(
        (now.getTime() - nguoi.joinedAt.getTime()) / 86_400_000,
      );
      if (soNgay < 0) {
        return { khop: false, lyDo: "Ngày vào làm ở tương lai — chưa xét" };
      }
      return soNgay <= n
        ? { khop: true, lyDo: `Vào làm ${soNgay} ngày trước, trong ngưỡng ${n} ngày` }
        : { khop: false, lyDo: `Vào làm ${soNgay} ngày trước, quá ngưỡng ${n} ngày` };
    }

    case "KHOA_HOAN_THANH": {
      if (dk.courseId != null && dk.courseId !== nguoi.courseId) {
        return { khop: false, lyDo: "Khoá vừa hoàn thành không phải khoá luật này chờ" };
      }
      return { khop: true, lyDo: "Vừa hoàn thành khoá mà luật này chờ" };
    }

    case "CHUNG_NHAN_HET_HAN": {
      if (dk.courseId != null && dk.courseId !== nguoi.courseId) {
        return { khop: false, lyDo: "Chứng nhận hết hạn thuộc khoá khác" };
      }
      return { khop: true, lyDo: "Chứng nhận của khoá này vừa hết hiệu lực" };
    }

    case "YEU_CAU_MOI_AP_DUNG":
      return { khop: true, lyDo: "Một yêu cầu đào tạo mới vừa áp cho người này" };

    default:
      // ⚠️ Kích hoạt lạ KHÔNG được coi là "không khớp". Thêm một giá trị vào enum mà
      // quên viết luật xét thì nó phải nổi lên, không lặng lẽ thành một luật chết.
      return { khop: false, lyDo: `Kích hoạt "${luat.trigger}" chưa có luật xét` };
  }
}

/**
 * KHOÁ CHỐNG TRÙNG của một lần thi hành.
 *
 * ⚠️ Phải gắn với MỘT MỐC NGHIỆP VỤ, không gắn với thời gian. Dùng timestamp là mỗi
 * nhịp chạy sinh một khoá mới, tức không chống được gì; dùng `<ruleId>:<userId>` trần
 * thì một luật "khoá hoàn thành → giao khoá kế" chỉ chạy được đúng một lần trong đời
 * người đó, kể cả cho những khoá khác.
 */
export function khoaChongTrungLuat(input: {
  ruleId: string;
  userId: string;
  moc: string;
}): string {
  return `${input.ruleId}:${input.userId}:${input.moc}`;
}
