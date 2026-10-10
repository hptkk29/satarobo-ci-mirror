"use server";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { assertPermission } from "@/lib/auth/check-permission";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type Result = { ok: true } | { ok: false; error: string };
type Gate =
  | { ok: true; sdb: ReturnType<typeof scopedDb> }
  | { ok: false; error: string };

async function requireManager(): Promise<Gate> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("courses:create");
  } catch {
    return { ok: false, error: "Không có quyền cấu hình khoá học" };
  }
  // Nhóm 01 L1 — CoursePrerequisite/Course = catalog LMS toàn cục (không center-scope),
  // scopedDb pass-through; dùng để sạch whitelist db trần.
  const actor = await resolveActor(session.user.id);
  return { ok: true, sdb: scopedDb(actor) };
}

/** Phát hiện vòng lặp: khi gán courseId yêu cầu requiredIds, courseId có bị
 *  reachable lại từ chính nó qua đồ thị tiên quyết không. */
async function wouldCreateCycle(
  sdb: ReturnType<typeof scopedDb>,
  courseId: string,
  requiredIds: string[],
): Promise<boolean> {
  const edges = await sdb.coursePrerequisite.findMany({
    select: { courseId: true, requiredCourseId: true },
  });
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.courseId === courseId) continue; // bỏ cạnh cũ của courseId — sẽ thay bằng proposed
    if (!adj.has(e.courseId)) adj.set(e.courseId, new Set());
    adj.get(e.courseId)!.add(e.requiredCourseId);
  }
  adj.set(courseId, new Set(requiredIds));

  const seen = new Set<string>();
  const stack = [...requiredIds];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === courseId) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of adj.get(n) ?? []) stack.push(m);
  }
  return false;
}

const setSchema = z.object({
  courseId: z.string().min(1, "Chọn khoá"),
  requiredCourseIds: z.array(z.string().min(1)).max(20),
});

/** Đặt TOÀN BỘ danh sách khoá tiên quyết cho 1 khoá (thêm/sửa dùng chung). */
export async function setCoursePrerequisites(input: unknown): Promise<Result> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const { sdb } = gate;

  const parsed = setSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { courseId } = parsed.data;
  const requiredCourseIds = [...new Set(parsed.data.requiredCourseIds)];

  if (requiredCourseIds.includes(courseId)) {
    return { ok: false, error: "Khoá không thể là tiên quyết của chính nó" };
  }
  if (requiredCourseIds.length === 0) {
    return { ok: false, error: "Chọn ít nhất 1 khoá tiên quyết (hoặc dùng Xoá)" };
  }
  if (await wouldCreateCycle(sdb, courseId, requiredCourseIds)) {
    return { ok: false, error: "Cấu hình tạo vòng lặp tiên quyết (A cần B, B cần A…)" };
  }

  try {
    await sdb.$transaction([
      sdb.coursePrerequisite.deleteMany({ where: { courseId } }),
      sdb.coursePrerequisite.createMany({
        data: requiredCourseIds.map((requiredCourseId) => ({ courseId, requiredCourseId })),
        skipDuplicates: true,
      }),
    ]);
  } catch (err) {
    return { ok: false, error: `Lỗi lưu: ${err instanceof Error ? err.message : "Unknown"}` };
  }
  revalidatePath("/course-prerequisites");
  return { ok: true };
}

/** Xoá TOÀN BỘ tiên quyết của 1 khoá. */
export async function clearCoursePrerequisites(courseId: string): Promise<Result> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  if (!courseId) return { ok: false, error: "Thiếu khoá" };
  try {
    await gate.sdb.coursePrerequisite.deleteMany({ where: { courseId } });
  } catch (err) {
    return { ok: false, error: `Lỗi xoá: ${err instanceof Error ? err.message : "Unknown"}` };
  }
  revalidatePath("/course-prerequisites");
  return { ok: true };
}

/** Xoá 1 cặp tiên quyết cụ thể. */
export async function removeOnePrerequisite(
  courseId: string,
  requiredCourseId: string,
): Promise<Result> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  try {
    await gate.sdb.coursePrerequisite.deleteMany({ where: { courseId, requiredCourseId } });
  } catch (err) {
    return { ok: false, error: `Lỗi xoá: ${err instanceof Error ? err.message : "Unknown"}` };
  }
  revalidatePath("/course-prerequisites");
  return { ok: true };
}
