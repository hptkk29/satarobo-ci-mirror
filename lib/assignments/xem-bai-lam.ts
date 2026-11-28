// lib/assignments/xem-bai-lam.ts — GIÁO VIÊN XEM BÀI LÀM TỪNG CÂU của học viên: phần THUẦN (không DB).
//
// Màn chấm của giáo viên chỉ có văn bản + tệp; bài nhiều câu hỏi thì thầy cô không thấy học viên đã chọn gì. File này dựng bản XEM: mỗi
// câu có đề, câu trả lời của học viên (dạng dòng chữ), đáp án đúng (CHỈ giáo viên thấy — không bao giờ đi vào `CauHoiHocVien`) và kết quả
// máy chấm. Điểm máy chấm chỉ là GỢI Ý: điểm chốt vẫn do giáo viên bấm lưu (`gradeSubmission`).
import { QUESTION_TYPE_META, type ContentQuestion, type ContentQuestionType } from "@/lib/assignments/question-content";
import { chamBai, type DapAn } from "@/lib/assignments/lam-bai";

export type CauXemChoGV = {
  id: string;
  so: number;
  loai: ContentQuestionType;
  nhanLoai: string;
  de: string;
  /** Câu trả lời của học viên, mỗi phần tử một dòng; null = bỏ trống (hoặc câu video — video nằm ở phần tệp). */
  traLoi: string[] | null;
  /** Đáp án đúng, mỗi phần tử một dòng; null = câu chấm tay không có đáp án cố định. */
  dapAnDung: string[] | null;
  /** 0..1 máy chấm; null = chấm tay. */
  tiLe: number | null;
  /** Điểm máy chấm theo thang của bài; null = chấm tay. */
  diem: number | null;
};

export type BaiLamXem = {
  cau: CauXemChoGV[];
  /** Tổng điểm các câu máy chấm được, theo thang của bài. */
  diemTuDong: number;
  /** Còn câu thầy cô phải tự chấm (tự luận, trả lời ngắn, video). */
  conChamTay: boolean;
  soCauChamTay: number;
};

/** Câu trả lời của học viên dưới dạng các dòng chữ đọc được. */
export function traLoiThanhDong(q: ContentQuestion, a: DapAn | null): string[] | null {
  if (!a) return null;
  switch (q.type) {
    case "single":
      return a.k === "single" ? [q.options[a.i] ?? "(lựa chọn không hợp lệ)"] : null;
    case "multiple":
      return a.k === "multiple" && a.i.length > 0 ? a.i.map((i) => q.options[i] ?? "(không hợp lệ)") : null;
    case "boolean":
      return a.k === "boolean" ? [a.v ? "Đúng" : "Sai"] : null;
    case "fill":
      return a.k === "fill" && a.t.some((x) => x.trim()) ? a.t.map((x, i) => `Chỗ trống ${i + 1}: ${x.trim() || "(bỏ trống)"}`) : null;
    case "short":
    case "essay":
      return a.k === "text" && a.t.trim() ? [a.t] : null;
    case "matching":
      return a.k === "matching" && a.r.some((x) => x.trim()) ? q.pairs.map((p, i) => `${p.left} ↔ ${a.r[i]?.trim() || "(bỏ trống)"}`) : null;
    case "ordering":
      return a.k === "ordering" && a.o.length > 0 ? a.o.map((x, i) => `${i + 1}. ${x}`) : null;
    case "video":
      return null;
  }
}

/** Đáp án đúng dưới dạng các dòng chữ — CHỈ để giáo viên đối chiếu. */
export function dapAnDungThanhDong(q: ContentQuestion): string[] | null {
  switch (q.type) {
    case "single":
      return [q.options[q.correctIndex] ?? ""];
    case "multiple":
      return q.correctIndices.map((i) => q.options[i] ?? "");
    case "boolean":
      return [q.correct ? "Đúng" : "Sai"];
    case "fill":
      return q.answers.map((x, i) => `Chỗ trống ${i + 1}: ${x}`);
    case "short":
    case "essay":
      return q.sampleAnswer?.trim() ? [q.sampleAnswer.trim()] : null;
    case "matching":
      return q.pairs.map((p) => `${p.left} ↔ ${p.right}`);
    case "ordering":
      return q.items.map((x, i) => `${i + 1}. ${x}`);
    case "video":
      return null;
  }
}

/** Dựng bản xem cho giáo viên: chấm lại từ đầu bằng chính câu hỏi + đáp án đang lưu (không tin cột `autoRatio` đã lưu). */
export function dungBaiLamXem(
  cau: readonly { q: ContentQuestion; diemCau: number | null }[],
  dapAnTheoCau: ReadonlyMap<string, DapAn>,
  tongDiem: number,
): BaiLamXem {
  const cham = chamBai(
    cau.map((c) => ({ q: c.q, diemCau: c.diemCau, dapAn: dapAnTheoCau.get(c.q.id) ?? null })),
    tongDiem,
  );
  const ra = cau.map(({ q }, i): CauXemChoGV => {
    const k = cham.cau[i];
    return {
      id: q.id,
      so: i + 1,
      loai: q.type,
      nhanLoai: QUESTION_TYPE_META[q.type].label,
      de: q.question,
      traLoi: traLoiThanhDong(q, dapAnTheoCau.get(q.id) ?? null),
      dapAnDung: dapAnDungThanhDong(q),
      tiLe: k?.tiLe ?? null,
      diem: k?.diem ?? null,
    };
  });
  return { cau: ra, diemTuDong: cham.diemTuDong, conChamTay: cham.conChamTay, soCauChamTay: ra.filter((c) => c.tiLe === null).length };
}

/** Dòng "Yêu cầu nộp video: …" mà `ghepDeBaiVideo` từng nối vào hướng dẫn — bỏ đi khi chính câu video đã hiện ở danh sách câu hỏi. */
export function boDeBaiVideoGhep(instructions: string | null): string | null {
  if (!instructions) return instructions;
  const sach = instructions.replace(/\n*Yêu cầu nộp video:(?:\n• [^\n]*)+/g, "").trim();
  return sach || null;
}
