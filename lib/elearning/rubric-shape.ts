import { z } from "zod";

/**
 * EL-15 — KHUNG CHẤM: hình dạng dữ liệu, thuần.
 *
 * Không DB, không giờ hệ thống, không mạng.
 *
 * ⚠️ Rubric CŨ của repo (`lib/rubric/criteria.ts`) KHÔNG dùng lại được, dù kế hoạch
 * ban đầu nói "tái dùng". Nó là enum CỨNG 6 tiêu chí robotics × 4 mức, gắn với
 * `RubricCriterion`/`RubricLevel` của lớp học sinh. Nó không biểu diễn nổi thang 100
 * điểm của quy trình tư vấn hay khung ngạch giáo viên — hai thứ EL-15 sinh ra để
 * chấm. Bẻ cong nó là mỗi khung mới lại phải sửa một enum, trên một bảng đang phục
 * vụ tính năng khác.
 */

/** Một MỨC của tiêu chí. */
export const mucSchema = z
  .object({
    label: z.string().trim().min(1, "Mức phải có tên").max(120),
    /**
     * Điểm TUYỆT ĐỐI của tiêu chí khi đạt mức này. **SỐ NGUYÊN.**
     *
     * ⚠️ Cho phép số thập phân ở đây đẻ ra một lớp lỗi không ai đoán được, vì mọi
     * cột đích đều là `Int` (`TrnRubric.totalPoints`, `TrnRubric.passPoints`,
     * `TrnRubricCriterion.weight`, `TrnSubmission.score`). Hai hỏng đã dựng lại
     * được trên Postgres thật:
     *
     *  · **cổng kích hoạt thành may rủi theo bit.** `tongDiemToiDa` cộng double rồi
     *    so `!==` với một `Int`. Vét cạn bộ ba điểm một chữ số thập phân có tổng
     *    toán học đúng 100: **8,19%** cho tổng JS ≠ 100. Người soạn bị chặn với câu
     *    "tổng là 99.99999999999999, không khớp thang 100" và không đoán nổi mình
     *    rơi vào nhóm nào.
     *  · **bài đạt ĐÚNG ngưỡng bị chấm trượt.** Mức cao [20.1, 64.3, 15.6] cộng ra
     *    đúng 100 nên kích hoạt trót lọt; bài chấm [0.1, 64.3, 15.6] = 80 về toán
     *    học ra `79.99999999999999` ⇒ TRƯỢT, trong khi mọi con số trên màn đều là 80.
     *
     * Số nguyên làm cả hai biến mất, và không mất gì: thang 100 với các mức nguyên
     * đủ mịn cho mọi khung mà module này chấm. Cần mịn hơn thì nâng `totalPoints`
     * (vd thang 1000), đừng mở số thập phân.
     */
    points: z.number().int("Điểm mức phải là số nguyên").min(0).max(1000),
    desc: z.union([z.null(), z.string().trim().max(1000)]).optional(),
  })
  .strict();

export type Muc = z.infer<typeof mucSchema>;

/**
 * Các mức của MỘT tiêu chí.
 *
 * ⚠️ Phải có ÍT NHẤT HAI mức. Một tiêu chí một mức không phải tiêu chí — nó là điểm
 * cộng vô điều kiện, và nó làm thang điểm nói dối: bài nào cũng được điểm đó.
 */
export const dsMucSchema = z
  .array(mucSchema)
  .min(2, "Tiêu chí phải có ít nhất hai mức")
  .max(10)
  .superRefine((ds, ctx) => {
    // ⚠️ Mức phải TĂNG DẦN theo điểm. Người chấm đọc danh sách từ trên xuống và
    // hiểu "càng xuống càng tốt"; xếp lộn thì họ chọn nhầm mức mà không nhận ra, và
    // con số đó vào hồ sơ nhân sự.
    for (let i = 1; i < ds.length; i++) {
      if (ds[i]!.points <= ds[i - 1]!.points) {
        ctx.addIssue({
          code: "custom",
          message: "Điểm các mức phải tăng dần từ trên xuống",
        });
        return;
      }
    }
  });

/**
 * Tổng điểm TỐI ĐA của một khung = tổng điểm mức CAO NHẤT của từng tiêu chí.
 *
 * ⚠️ Đây là con số phải khớp `TrnRubric.totalPoints`. Không khớp thì thang điểm nói
 * dối: khung ghi "trên 100" nhưng làm hết sức chỉ được 85, và ngưỡng đạt 80 trở
 * thành gần-như-tuyệt-đối mà không ai cố ý đặt ra thế.
 */
export function tongDiemToiDa(tieuChi: { levels: Muc[] }[]): number {
  return tieuChi.reduce(
    // ⚠️ `Math.max()` của mảng RỖNG là `-Infinity`, không phải 0. Một tiêu chí có
    // `levelsJson` hỏng khuôn sẽ đọc ra mảng rỗng, và không guard thì cả tổng thành
    // `-Infinity` — màn soạn hiện "tổng -Infinity/100" và người soạn không hiểu gì.
    (s, tc) => s + (tc.levels.length === 0 ? 0 : Math.max(...tc.levels.map((m) => m.points))),
    0,
  );
}

export type LoiKhung =
  | { ma: "KHONG_CO_TIEU_CHI"; noi: string }
  | { ma: "TONG_DIEM_LECH"; noi: string; tinhDuoc: number; khai: number }
  | { ma: "NGUONG_VUOT_THANG"; noi: string };

/**
 * Kiểm một khung TRƯỚC khi kích hoạt.
 *
 * ⚠️ Trả về DANH SÁCH lỗi, không ném ở lỗi đầu tiên: người soạn khung sửa một lượt
 * thì xong, thay vì bấm lưu năm lần để lộ ra năm lỗi.
 */
export function kiemKhung(input: {
  totalPoints: number;
  passPoints: number;
  tieuChi: { levels: Muc[] }[];
}): LoiKhung[] {
  const loi: LoiKhung[] = [];

  if (input.tieuChi.length === 0) {
    loi.push({
      ma: "KHONG_CO_TIEU_CHI",
      noi: "Khung chưa có tiêu chí nào — thêm tiêu chí trước khi kích hoạt",
    });
    // Không kiểm tiếp: mọi con số dưới đây đều vô nghĩa khi chưa có tiêu chí nào.
    return loi;
  }

  const tinhDuoc = tongDiemToiDa(input.tieuChi);
  if (tinhDuoc !== input.totalPoints) {
    loi.push({
      ma: "TONG_DIEM_LECH",
      noi: `Tổng điểm các tiêu chí là ${tinhDuoc}, không khớp thang ${input.totalPoints} của khung`,
      tinhDuoc,
      khai: input.totalPoints,
    });
  }

  // ⚠️ Ngưỡng đạt vượt thang = một khung KHÔNG AI qua nổi, và người soạn không có
  // cách nào biết trước khi có người trượt. Cùng lỗi với `passScore > maxScore` ở
  // đề thi, nên chặn ở cùng một chỗ trong vòng đời: trước lúc kích hoạt.
  if (input.passPoints > input.totalPoints) {
    loi.push({
      ma: "NGUONG_VUOT_THANG",
      noi: `Ngưỡng đạt (${input.passPoints}) lớn hơn thang điểm của khung (${input.totalPoints}) — không ai qua được`,
    });
  }

  return loi;
}

/**
 * Cộng điểm một lượt nộp theo khung.
 *
 * ⚠️ Còn MỘT tiêu chí chưa chấm thì `tong` và `dat` đều `null`. Cộng tạm phần đã
 * chấm rồi so ngưỡng là chốt TRƯỢT cho người mà một phần bài của họ chưa ai đọc —
 * y hệt luật của bài thi, và cùng một lý do.
 */
export function tinhDiemBaiNop(input: {
  /** Điểm từng tiêu chí; `null` = chưa chấm. */
  diem: (number | null)[];
  passPoints: number;
}): { tong: number | null; dat: boolean | null; conThieu: number } {
  const conThieu = input.diem.filter((d) => d == null).length;
  if (conThieu > 0) return { tong: null, dat: null, conThieu };
  const tong = input.diem.reduce<number>((s, d) => s + (d ?? 0), 0);
  return { tong, dat: tong >= input.passPoints, conThieu: 0 };
}
