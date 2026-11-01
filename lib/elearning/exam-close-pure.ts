import { cueInlineSchema, laCauChamDuoc } from "@/lib/elearning/lesson-cue";
import { AN_HAN_GIAY, chamMotCau, tinhDiemLuot } from "@/lib/elearning/exam-grading";

/**
 * F-05 — PHẦN THUẦN của việc ĐÓNG một lượt thi (người học nộp, hoặc hệ thống đóng lượt bỏ dở).
 *
 * Một nguồn chấm duy nhất: `nopBai` và cron đóng lượt hết hạn cùng gọi `chamLuotThi`. Chép hai bản là hai luật chấm.
 */

export type CauDeLuot = {
  id: string;
  points: number;
  question: { type: string; contentJson: unknown };
};
export type TraLoiLuot = {
  id: string;
  examQuestionId: string;
  selectedChoiceIds: string[];
};

export type KetQuaChamLuot = {
  ketCau: {
    examQuestionId: string;
    answerId: string | null;
    kq: ReturnType<typeof chamMotCau>;
  }[];
  tong: ReturnType<typeof tinhDiemLuot>;
};

/**
 * CHẤM ở server, đáp án đọc từ DB. Không đụng `selectedChoiceIds`/`textAnswer` — chỉ sinh `isCorrect`/`score` của câu chấm
 * máy. Câu chấm tay để `null` (chưa ai chấm ≠ 0 điểm).
 */
export function chamLuotThi(i: {
  cacCau: readonly CauDeLuot[];
  traLoi: readonly TraLoiLuot[];
  passScore: number;
}): KetQuaChamLuot {
  const traLoiCua = new Map(i.traLoi.map((a) => [a.examQuestionId, a]));
  const ketCau = i.cacCau.map((c) => {
    const a = traLoiCua.get(c.id);
    const r = cueInlineSchema.safeParse(c.question.contentJson);
    const cau = r.success && laCauChamDuoc(r.data) ? r.data : null;
    const kq = chamMotCau({
      type: c.question.type,
      cau,
      chon: (a?.selectedChoiceIds ?? []).map(Number).filter(Number.isInteger),
      diemToiDa: c.points,
    });
    return { examQuestionId: c.id, answerId: a?.id ?? null, kq };
  });
  const tong = tinhDiemLuot({
    cacCau: ketCau.map((k) => ({ diem: k.kq.cham === "MAY" ? k.kq.diem : null })),
    passScore: i.passScore,
  });
  return { ketCau, tong };
}

/** Hạn chót làm bài — KHÔNG gồm ân hạn. Đây là mốc ghi `submittedAt` cho lượt hệ thống đóng. */
export function hanChotLuot(i: { startedAt: Date; durationMin: number }): Date {
  return new Date(i.startedAt.getTime() + i.durationMin * 60_000);
}

export const BIEN_MARGIN = "ELEARNING_EXAM_AUTO_CLOSE_MARGIN_MIN";
export const MARGIN_MAC_DINH_PHUT = 15;
const MARGIN_MIN = 5;
const MARGIN_MAX = 1440;

/**
 * Đọc biên chờ sau (hạn chót + ân hạn) trước khi hệ thống được đóng lượt. Không đặt ⇒ 15. Số ngoài [5, 1440] hoặc không
 * phải số nguyên ⇒ `null` (cron TỪ CHỐI chạy và báo lỗi) — đóng lượt là hành vi chấm điểm, đoán một giá trị là sai.
 */
export function docMarginPhut(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return MARGIN_MAC_DINH_PHUT;
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= MARGIN_MIN && n <= MARGIN_MAX ? n : null;
}

/**
 * Hệ thống được đóng lượt chưa: đã quá hạn chót + ân hạn của máy chủ (`AN_HAN_GIAY`, đúng cổng `hetGio` của việc lưu câu)
 * + biên chờ. Biên chờ ≥ 5 phút bảo đảm KHÔNG còn câu nào được lưu nữa (lưu dừng ở hạn chót + 60 giây), nên chấm lúc này
 * chấm đúng tập câu đã đóng băng.
 */
export function canDongLuot(i: {
  startedAt: Date;
  durationMin: number;
  now: Date;
  marginPhut: number;
}): boolean {
  const han = hanChotLuot(i).getTime() + (AN_HAN_GIAY + i.marginPhut * 60) * 1000;
  return i.now.getTime() > han;
}

export const BIEN_TUOI_TOI_DA = "ELEARNING_EXAM_AUTO_CLOSE_MAX_AGE_DAYS";
const TUOI_MIN = 1;
const TUOI_MAX = 3650;

/**
 * Tuổi TỐI ĐA (ngày, tính từ hạn chót làm bài) của lượt tồn đọng mà hệ thống còn được đóng — đòn bẩy cho câu hỏi owner #7 "lượt
 * tồn đọng cũ khi bật lần đầu". Không đặt ⇒ `undefined` (không giới hạn — mặc định đang hiện thực: đóng hết). Số ngoài [1, 3650] hoặc
 * không phải số nguyên ⇒ `null` (cron TỪ CHỐI chạy, như biên chờ). Lượt cũ hơn mốc này GIỮ NGUYÊN trạng thái đang làm.
 */
export function docTuoiToiDaNgay(raw: string | undefined): number | null | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= TUOI_MIN && n <= TUOI_MAX ? n : null;
}

/** Chỉ báo người học khi lượt vừa mới hết hạn: lượt tồn đọng cũ đóng IM LẶNG (câu hỏi owner #7). */
export const CUA_SO_BAO_NGUOI_HOC_MS = 24 * 3_600_000;
