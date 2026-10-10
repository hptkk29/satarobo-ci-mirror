import { chamCue, type CauHoiCue } from "@/lib/elearning/lesson-cue";

/**
 * EL-14 — CHẤM BÀI THI, thuần.
 *
 * Không DB, không giờ hệ thống, không mạng.
 *
 * ⚠️ KHÔNG có "thư viện chấm" nào để tái dùng, dù kế hoạch nói thế. Chỗ được dẫn
 * (`question-content-db.ts`) là hàm DỊCH một dòng DB thành object — không có một
 * phép so đáp án nào trong đó. Mã chấm thật của repo nằm rải trong `app/`, chép
 * nhau, và chỉ phủ ba loại.
 *
 * ⚠️ `isAutoGraded()` của repo trả `true` cho 6/8 loại nhưng repo KHÔNG có mã chấm
 * cho `FILL_BLANK`/`MATCHING`/`ORDERING`. Đừng tái dùng nó — nó nói dối, và ở bài
 * thi tính điểm nhân sự thì lời nói dối đó thành điểm 0 cho người làm đúng.
 *
 * ⚠️ `SHORT_ANSWER` KHÔNG chấm máy ở đây, dù repo có chỗ chấm nó bằng so chuỗi
 * bằng-nhau-tuyệt-đối. "5" với "5.0" ra 0 điểm; "PCCC" với "pccc " ra 0 điểm. Đó
 * là chấm-máy giả dạng chấm-đúng, và mang nó vào bài thi nhân sự là gây thiệt hại
 * thật cho người trả lời đúng.
 */

/**
 * Ba mức khó của câu hỏi.
 *
 * ⚠️ Ở module THUẦN này chứ không ở `question-bank.ts`, vì trình soạn (component
 * client) cũng cần nó. `question-bank.ts` nhập `orgUnitIdForCenter` — tức chạm DB —
 * nên một tệp `"use client"` nhập hằng từ đó sẽ kéo mã máy chủ vào gói client và
 * làm VỠ BUILD, với thông báo nói về `next/headers` chứ không nói về hằng số.
 */
export const MUC_KHO = ["EASY", "MEDIUM", "HARD"] as const;

/** Loại chấm được BẰNG MÁY — đúng ba loại repo thật sự có mã chấm. */
export const LOAI_CHAM_MAY = ["SINGLE", "MULTIPLE", "TRUE_FALSE"] as const;
/** Loại chấm TAY — người chấm đọc và cho điểm. */
export const LOAI_CHAM_TAY = ["SHORT_ANSWER", "ESSAY"] as const;
/**
 * Loại khai trong enum nhưng CHƯA mở cho vào đề.
 *
 * Khai enum đủ 9 là đúng (bỏ giá trị rồi thêm lại là `ALTER TYPE` trên prod), còn
 * phạm vi thi hành khoá ở tầng Zod — sửa được mà không đụng schema.
 */
export const LOAI_CHUA_MO = ["FILL_BLANK", "MATCHING", "ORDERING", "CASE"] as const;

export type LoaiChamMay = (typeof LOAI_CHAM_MAY)[number];
export type LoaiChamTay = (typeof LOAI_CHAM_TAY)[number];
export type LoaiDuocVaoDe = LoaiChamMay | LoaiChamTay;

export function chamMayDuoc(type: string): type is LoaiChamMay {
  return (LOAI_CHAM_MAY as readonly string[]).includes(type);
}

export function duocVaoDe(type: string): type is LoaiDuocVaoDe {
  return chamMayDuoc(type) || (LOAI_CHAM_TAY as readonly string[]).includes(type);
}

// ── Chấm một câu ───────────────────────────────────────────────────────────

export type KetQuaChamCau =
  | { cham: "MAY"; dung: boolean; diem: number }
  /** Chờ người chấm. `diem` và `dung` đều `null` — KHÔNG phải 0/false. */
  | { cham: "TAY" };

/**
 * Chấm một câu.
 *
 * ⚠️ Câu chấm tay trả `{cham:"TAY"}`, không trả `{dung:false, diem:0}`. Gộp hai
 * thứ đó là đóng sổ 0 điểm cho người chưa được ai đọc bài — và lượt thi đó sẽ
 * không nằm trong hàng chờ chấm của ai.
 */
export function chamMotCau(input: {
  type: string;
  /** Nội dung câu theo khuôn dùng chung. */
  cau: CauHoiCue | null;
  /** Lựa chọn người học chọn, dạng chỉ số. */
  chon: number[];
  diemToiDa: number;
}): KetQuaChamCau {
  if (!chamMayDuoc(input.type)) return { cham: "TAY" };
  if (!input.cau) {
    // Nội dung câu hỏng khuôn: KHÔNG chấm máy thành sai. Cho người chấm xử — một
    // bản ghi bẩn không được biến thành điểm 0 của người học.
    return { cham: "TAY" };
  }

  const dung = chamCue(input.cau, input.chon.join(","));
  return { cham: "MAY", dung, diem: dung ? input.diemToiDa : 0 };
}

// ── Chấm cả lượt ───────────────────────────────────────────────────────────

export type CauDaCham = {
  /** `null` = chưa chấm (đang chờ người). */
  diem: number | null;
};

export type KetQuaChamLuot = {
  /** `null` khi còn câu chưa chấm — không được cộng tạm rồi chốt. */
  totalScore: number | null;
  passed: boolean | null;
  /** `true` = còn câu chờ người chấm. */
  choChamTay: boolean;
};

/**
 * Tổng điểm một lượt.
 *
 * ⚠️ Còn MỘT câu chưa chấm thì `totalScore` và `passed` đều là `null`. Cộng tạm
 * phần đã chấm rồi so với điểm đạt là chốt TRƯỢT cho người mà bài tự luận của họ
 * chưa ai đọc — và con số đó sẽ hiện trên báo cáo tuân thủ như một sự thật.
 */
export function tinhDiemLuot(input: {
  cacCau: CauDaCham[];
  passScore: number;
}): KetQuaChamLuot {
  const choChamTay = input.cacCau.some((c) => c.diem == null);
  if (choChamTay) return { totalScore: null, passed: null, choChamTay: true };

  const tong = input.cacCau.reduce((s, c) => s + (c.diem ?? 0), 0);
  return {
    totalScore: tong,
    // Bằng ĐÚNG điểm đạt là ĐẠT. Viết `>` là dời ngưỡng lên một điểm so với con
    // số người soạn đề đặt, im lặng.
    passed: tong >= input.passScore,
    choChamTay: false,
  };
}

// ── Trần lượt thi và thời gian chờ ─────────────────────────────────────────

/**
 * Số lượt được phép = `maxAttempts` + số lần được mở khoá.
 *
 * ⚠️ Mỗi bản ghi mở khoá cho THÊM MỘT lượt, không reset về 0 và không nhân đôi
 * `maxAttempts`. Reset thì mất lịch sử; nhân đôi thì mỗi lần mở khoá lại nới theo
 * cấp số nhân, và `previousAttemptCount` mất ý nghĩa.
 */
export function soLuotChoPhep(input: { maxAttempts: number; soLanMoKhoa: number }): number {
  return Math.max(0, input.maxAttempts) + Math.max(0, input.soLanMoKhoa);
}

export type KetQuaChoCooldown =
  | { duoc: true }
  | { duoc: false; conLaiPhut: number };

/**
 * Còn phải chờ bao lâu mới được thi lại.
 *
 * ⚠️ Đếm từ `submittedAt` của lượt trước, KHÔNG từ `startedAt`. Đếm từ lúc bắt đầu
 * cho phép mở một lượt rồi bỏ đó để "đốt" thời gian chờ — 24 giờ biến thành 0.
 *
 * ⚠️ Đúng biên là ĐƯỢC (`>=`). Viết `>` thì người chờ tròn 24 giờ vẫn bị từ chối,
 * và họ không hiểu vì sao đồng hồ báo hết mà nút vẫn khoá.
 */
export function conChoCooldown(input: {
  nopLanTruoc: Date | null;
  cooldownHours: number;
  now: Date;
}): KetQuaChoCooldown {
  if (!input.nopLanTruoc || input.cooldownHours <= 0) return { duoc: true };
  const moc = input.nopLanTruoc.getTime() + input.cooldownHours * 3_600_000;
  if (input.now.getTime() >= moc) return { duoc: true };
  return { duoc: false, conLaiPhut: Math.ceil((moc - input.now.getTime()) / 60_000) };
}

/** Ân hạn sau khi hết giờ — mạng chậm không được biến thành mất bài. */
export const AN_HAN_GIAY = 60;

/**
 * Đã quá giờ làm bài chưa.
 *
 * ⚠️ SERVER là đồng hồ. Đồng hồ trình duyệt sửa được bằng một dòng trong bảng điều
 * khiển, và người sửa được thêm bao nhiêu thời gian tuỳ thích.
 */
export function hetGio(input: {
  startedAt: Date;
  durationMin: number;
  now: Date;
  anHanGiay?: number;
}): boolean {
  const han =
    input.startedAt.getTime() +
    input.durationMin * 60_000 +
    (input.anHanGiay ?? AN_HAN_GIAY) * 1000;
  return input.now.getTime() > han;
}

// ── Chính sách hiện đáp án ─────────────────────────────────────────────────

/**
 * Có được xem đáp án đúng chưa.
 *
 * ⚠️ Thi hành ở tầng DỮ LIỆU, không ở tầng giao diện. Ẩn bằng CSS thì đáp án vẫn
 * nằm trong thân phản hồi, và mở tab Network ra là thấy.
 */
export function duocXemDapAn(input: {
  policy: string;
  soLuotDaDung: number;
  soLuotChoPhep: number;
}): boolean {
  switch (input.policy) {
    case "NEVER":
      return false;
    case "AFTER_EACH_ATTEMPT":
      return true;
    case "AFTER_LAST_ATTEMPT":
      return input.soLuotDaDung >= input.soLuotChoPhep;
    default:
      // Giá trị lạ ⇒ chọn phía CHẶT. Đây là đường lộ đề; đoán sai theo hướng dễ
      // dãi thì cả ngân hàng câu hỏi mất giá trị.
      return false;
  }
}
