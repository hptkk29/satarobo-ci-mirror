import { publishEvent } from "@/lib/events/publish";

type ClientToiThieu = {
  trnEnrollment: {
    findMany: (a: unknown) => Promise<{ id: string }[]>;
    findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
    update: (a: unknown) => Promise<unknown>;
  };
  trnLessonProgress: { count: (a: unknown) => Promise<number> };
  trnLesson: { count: (a: unknown) => Promise<number> };
};

/**
 * EL-06 — PHÁT `elearning.enrollment.created` cho các dòng vừa tạo.
 *
 * ⚠️ Phải tra lại id sau `createMany`: Prisma `createMany` KHÔNG trả về id, và
 * handler thông báo cần id để dựng liên kết "vào học". Ở quy mô module (15 nhân
 * sự) một câu tra thêm là rẻ; ở quy mô lớn hơn thì đổi sang `create` từng dòng
 * trong transaction, đừng đổi sang đoán id.
 *
 * ⚠️ `dedupeKey` suy từ id bản ghi, KHÔNG từ thời gian: `dispatch-events` chạy
 * lại sự kiện khi handler ném lỗi giữa chừng, và khoá theo thời gian sẽ cho phát
 * lại — người học nhận hai lần "bạn được giao khoá X".
 */
export async function phatSuKienGhiDanhMoi(
  client: Pick<ClientToiThieu, "trnEnrollment">,
  input: { assignmentId: string; userIds: string[]; tx?: unknown },
): Promise<number> {
  if (!input.userIds.length) return 0;

  const rows = await client.trnEnrollment.findMany({
    where: { assignmentId: input.assignmentId, userId: { in: input.userIds } },
    select: { id: true },
  });

  for (const r of rows) {
    await publishEvent(
      "elearning.enrollment.created",
      { enrollmentId: r.id, assignmentId: input.assignmentId },
      { tx: input.tx as never, dedupeKey: `el.enr:${r.id}` },
    );
  }
  return rows.length;
}
