// QoImport — GHI câu hỏi đã kiểm vào ngân hàng câu hỏi của MỘT khoá online. Tất cả hoặc không: một giao dịch, kiểm hết TRƯỚC khi ghi.
// "Đích" (thiết kế QoImport): tuỳ chọn gắn luôn các câu vừa nhập vào MỘT đề của CHÍNH khoá đó (nối đuôi) — cùng giao dịch, nên không có chuyện câu vào ngân hàng mà không vào đề.
import type { Prisma, PrismaClient } from "@prisma/client";
import { cauHoiSchema, kiemCauHoi } from "./cham-diem";
import { TOI_DA_DONG, type CauNhap } from "./nhap-cau-hoi";

export type KetQuaNhap =
  | { ok: true; soDaNhap: number; soGanVaoDe: number }
  | { ok: false; ma: "KHOA_KHONG_TON_TAI" | "NHAP_RONG" | "NHAP_QUA_NHIEU" | "CAU_HOI_KHONG_HOP_LE" | "DE_KHONG_TON_TAI"; thongBao: string };

export async function nhapCauHoi(db: PrismaClient, input: { courseId: string; cau: CauNhap[]; /** Gắn vào đề này (phải thuộc khoá, chưa lưu trữ). Trống = chỉ vào ngân hàng câu hỏi. */ deThiId?: string | null }, actorUserId: string | null): Promise<KetQuaNhap> {
  if (input.cau.length === 0) return { ok: false, ma: "NHAP_RONG", thongBao: "Không có câu hợp lệ nào để nhập" };
  if (input.cau.length > TOI_DA_DONG) return { ok: false, ma: "NHAP_QUA_NHIEU", thongBao: `Tối đa ${TOI_DA_DONG} câu mỗi lần` };
  // CỔNG trước phép ghi đầu tiên: khoá tồn tại, rồi MỌI câu qua đúng luật của đường lưu từng câu (`luuCauHoi` → `kiemCauHoi`).
  const khoa = await db.onlCourse.findFirst({ where: { id: input.courseId, deletedAt: null }, select: { id: true } });
  if (!khoa) return { ok: false, ma: "KHOA_KHONG_TON_TAI", thongBao: "Khoá không tồn tại" };
  const data: Prisma.OnlQuestionCreateManyInput[] = [];
  for (let i = 0; i < input.cau.length; i++) {
    const p = cauHoiSchema.safeParse({ ...input.cau[i], courseId: input.courseId });
    if (!p.success) return { ok: false, ma: "CAU_HOI_KHONG_HOP_LE", thongBao: `Câu ${i + 1}: ${p.error.issues[0]?.message ?? "không hợp lệ"}` };
    const k = kiemCauHoi(p.data);
    if (!k.ok) return { ok: false, ma: "CAU_HOI_KHONG_HOP_LE", thongBao: `Câu ${i + 1}: ${k.thongBao}` };
    data.push({
      courseId: input.courseId,
      type: p.data.type,
      stem: p.data.stem,
      optionsJson: k.optionsJson as unknown as Prisma.InputJsonValue,
      answerKeyJson: k.answerKeyJson as unknown as Prisma.InputJsonValue,
      explanation: p.data.explanation ?? null,
      points: p.data.points ?? 1,
      createdByUserId: actorUserId,
    });
  }
  return db.$transaction(async (tx): Promise<KetQuaNhap> => {
    // CỔNG trước phép ghi đầu tiên: đề đích phải thuộc ĐÚNG khoá này và chưa lưu trữ (TỪ CHỐI bằng return ở đây là an toàn — chưa ghi gì).
    if (input.deThiId) {
      const de = await tx.onlAssessment.findUnique({ where: { id: input.deThiId }, select: { courseId: true, status: true } });
      if (!de || de.courseId !== input.courseId || de.status === "ARCHIVED") return { ok: false, ma: "DE_KHONG_TON_TAI", thongBao: "Đề đích không tồn tại trong khoá này (hoặc đã lưu trữ)" };
    }
    const moi = await tx.onlQuestion.createManyAndReturn({ data, select: { id: true } });
    let soGan = 0;
    if (input.deThiId) {
      const max = await tx.onlAssessmentQuestion.aggregate({ where: { assessmentId: input.deThiId }, _max: { orderIndex: true } });
      const goc = (max._max.orderIndex ?? -1) + 1;
      const g = await tx.onlAssessmentQuestion.createMany({ data: moi.map((c, i) => ({ assessmentId: input.deThiId!, questionId: c.id, orderIndex: goc + i })) });
      soGan = g.count;
    }
    return { ok: true, soDaNhap: moi.length, soGanVaoDe: soGan };
  });
}
