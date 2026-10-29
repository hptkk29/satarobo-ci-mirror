/**
 * LOẠI BÀI HỌC NÀO ĐÃ MỞ — nguồn sự thật DUY NHẤT.
 *
 * ⚠️ Vì sao cần tệp này: `TrnLessonKind` khai đủ 6 loại từ GĐ1 (đúng — thêm giá trị
 * enum sau là `ALTER TYPE` trên prod), nhưng chỉ 3 loại có đường đi thật. Trước
 * tệp này, trình soạn cho chọn CẢ SÁU:
 *
 *  · người soạn tạo được bài "Bài kiểm tra",
 *  · cổng xuất bản `kiemDanBai` KHÔNG kiểm loại đó (nó chỉ soi bài đọc trống),
 *  · khoá xuất bản trót lọt,
 *  · và người học mở bài ra thì nhận "Loại bài này chưa mở".
 *
 * Không có gì báo lỗi ở ba bước đầu. Người phát hiện là NGƯỜI HỌC, giữa lúc học,
 * trên một bài bắt buộc có hạn chót cứng — và người soạn thì đã đóng máy về.
 *
 * ⚠️ Đây là quy ước 20 ("cổng chặn và đường thoả mãn cổng phải về cùng một PR")
 * nhìn từ phía ngược lại: đừng mở một LỰA CHỌN khi chưa có đường đi cho nó. Thêm
 * cổng chặn lúc chưa có cửa cũng sai — nó chỉ đổi chỗ người bị kẹt.
 *
 * ⚠️ Mở một loại = sửa ĐÚNG MỘT chỗ ở đây, cùng PR với đường đi của nó.
 */

import type { TrnLessonKind } from "@prisma/client";

/**
 * Loại bài có ĐỦ hai đầu: đường soạn và đường tới được người học.
 *
 * `LIVE_SESSION` nằm trong này dù trang học không vẽ gì cho nó — đường của nó là
 * giảng viên tick "đã dự" (`lib/elearning/equivalence.ts`), không phải người học tự
 * bấm. Đủ hai đầu, chỉ khác hình dạng.
 *
 * `QUIZ` mở ở EL-14d, ĐÚNG PR có đường làm bài — không mở sớm hơn ở EL-14c dù lúc
 * đó đã dựng được đề. Mở khi mới có một đầu là dựng lại đúng cái bẫy tệp này sinh
 * ra để gỡ.
 *
 * `TASK` mở ở EL-15c, ĐÚNG PR có ĐỦ BỐN mảnh: gắn khung vào bài · đường nộp (kèm
 * tệp đính kèm) · đường chấm theo khung · phép BÙ hạn khi người chấm trễ. Mảnh thứ
 * tư cũng là điều kiện mở, không phải phần thêm: mở đường nộp mà chưa có phép bù là
 * để người học bị khoá và bị đánh quá hạn vì người chấm chậm — dựng một mối nguy
 * rồi hẹn đợt sau đúng bằng việc mở một cửa không có lối ra.
 */
export const LOAI_BAI_DA_MO = [
  "READ",
  "VIDEO",
  "LIVE_SESSION",
  "QUIZ",
  "TASK",
] as const;

export type LoaiBaiDaMo = (typeof LOAI_BAI_DA_MO)[number];

/**
 * Loại CHƯA mở, và ticket nào mở nó.
 *
 * Ghi tên ticket chứ không ghi "sắp có": người đọc cần biết chờ ai, và khi ticket
 * đó xong thì người làm nó tìm được đúng chỗ phải sửa.
 */
export const LOAI_BAI_CHUA_MO: Record<string, string> = {
  SCORM: "chưa có đường tải gói SCORM cho khu đào tạo nội bộ",
};

export const NHAN_LOAI_BAI: Record<string, string> = {
  READ: "Bài đọc",
  VIDEO: "Video",
  SCORM: "SCORM",
  QUIZ: "Bài kiểm tra",
  TASK: "Bài tập",
  LIVE_SESSION: "Buổi trực tiếp",
};

export function laLoaiBaiDaMo(kind: string): kind is LoaiBaiDaMo {
  return (LOAI_BAI_DA_MO as readonly string[]).includes(kind);
}

/**
 * Câu giải thích cho người học khi họ mở một bài chưa có đường đi.
 *
 * Nói THẲNG là hệ thống chưa mở, không để họ tưởng máy mình hỏng và đi báo sai chỗ.
 */
export function vaySaoChuaMo(kind: string): string {
  const ly = LOAI_BAI_CHUA_MO[kind];
  return ly
    ? `Loại bài "${NHAN_LOAI_BAI[kind] ?? kind}" chưa mở — ${ly}. Báo với Đào tạo để họ đổi loại bài.`
    : `Loại bài "${kind}" chưa mở.`;
}

/** Danh sách cho ô chọn trên trình soạn — chỉ loại đã mở. */
export function loaiBaiChoTrinhSoan(): { ma: LoaiBaiDaMo; nhan: string }[] {
  return LOAI_BAI_DA_MO.map((ma) => ({ ma, nhan: NHAN_LOAI_BAI[ma]! }));
}

/**
 * Ép kiểu cho zod của đường soạn.
 *
 * Trả về mảng có kiểu hẹp để `z.enum(...)` giữ được kiểu, thay vì nhận `string[]`.
 */
export const LOAI_BAI_ZOD = LOAI_BAI_DA_MO as unknown as readonly [
  TrnLessonKind,
  ...TrnLessonKind[],
];
