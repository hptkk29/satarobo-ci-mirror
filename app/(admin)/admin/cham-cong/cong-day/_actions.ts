"use server";

// Danh mục LOẠI CÔNG DẠY — sửa hệ số, THÊM dòng, xoá dòng.
//
// Đây là toàn bộ phần "tự tạo tự add được qua hệ thống chứ không cần code" mà chủ dự án yêu cầu.
//
// ⚠️ Bản 06/09 CHỈ sửa được, không thêm được: khoá `unique(source, role)` chặn ở đúng 6 dòng.
// Từ 07/09 khoá thành `(source, role, categoryId)` nên một tổ hợp nguồn × vai có thể có nhiều
// dòng, phân biệt bằng PHÂN LOẠI BUỔI — đó là cách SR.QD.230 PL03 §4 vào được hệ thống mà không
// phải deploy: Workshop 120%, lớp Coach 100%, buổi ≤3 HV 75%.
//
// HAI HẠNG DÒNG, đối xử khác nhau:
//  · BAO SÂN (`categoryId = null`) — 6 dòng seed. Là lưới đỡ cuối cùng của mọi buổi, XOÁ KHÔNG
//    ĐƯỢC: mất nó là mọi buổi thuộc phân loại chưa khai rơi ra ngoài và công dạy tụt im lặng.
//  · RIÊNG (`categoryId` có giá trị) — người vận hành tự thêm, xoá được.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { writeAudit } from "@/lib/audit/audit-log";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { HO_CENTER_ID } from "@/lib/cham-cong/home-center";

type Res = { ok: true } | { ok: false; error: string };

/** Hệ số âm là TRỪ công dạy — không có nghĩa nào đúng. Chặn tại đây thay vì để cả kỳ ra số lạ. */
const heSo = z.coerce.number().min(0).max(10);

const schemaSua = z.object({
  code: z.string().min(1),
  basis: z.enum(["PER_SESSION", "PER_HOUR"]),
  factor: heSo,
  countsInPeriod: z.boolean(),
  isActive: z.boolean(),
});

const schemaThem = z.object({
  source: z.enum(["CLASS", "TRIAL", "MAKEUP"]),
  role: z.enum(["MAIN", "SUBSTITUTE", "ASSISTANT"]),
  categoryCode: z.string().min(1, "Chọn phân loại buổi"),
  basis: z.enum(["PER_SESSION", "PER_HOUR"]),
  factor: heSo,
  countsInPeriod: z.boolean(),
});

/**
 * Danh mục DÙNG CHUNG mọi cơ sở ⇒ gác ở Hội sở, giống Loại nghỉ. Để cấp cơ sở sửa được là mỗi
 * nơi một hệ số mà tổng công dạy toàn hệ thống thì không ai giải thích nổi.
 */
async function gac(): Promise<string | null> {
  if (!(await checkPermission("hr_attendance:config", { centerId: HO_CENTER_ID }))) {
    return "Sửa danh mục công dạy cần quyền cấu hình tại Hội sở";
  }
  return null;
}

function xaBoNho() {
  revalidatePath("/cham-cong/cong-day");
  revalidatePath("/cham-cong/ky-cong");
}

const NHAN_VAI: Record<string, string> = {
  MAIN: "người dạy",
  SUBSTITUTE: "dạy thay",
  ASSISTANT: "trợ giảng",
};

export async function saveTeachingCreditTypeAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = schemaSua.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const chan = await gac();
  if (chan) return { ok: false, error: chan };

  const sdb = scopedDb(await resolveActor(session.user.id));
  const old = await sdb.teachingCreditType.findUnique({
    where: { code: p.data.code },
    select: {
      id: true,
      basis: true,
      factor: true,
      countsInPeriod: true,
      isActive: true,
      categoryId: true,
    },
  });
  if (!old) return { ok: false, error: "Không tìm thấy loại công dạy này" };

  // Tắt một dòng BAO SÂN là bỏ lưới đỡ của cả nguồn × vai đó: mọi buổi không khớp dòng riêng nào
  // rơi ra ngoài và công dạy tụt mà không có thông báo. Chặn thẳng thay vì để lộ ra ở kỳ sau.
  if (old.categoryId == null && !p.data.isActive) {
    return {
      ok: false,
      error:
        "Không tắt được dòng bao sân — nó là lưới đỡ cho mọi buổi chưa có dòng riêng. Muốn thôi tính thì đặt hệ số 0, hoặc bỏ ô Cộng vào kỳ.",
    };
  }

  await sdb.teachingCreditType.update({
    where: { code: p.data.code },
    data: {
      basis: p.data.basis,
      factor: p.data.factor,
      countsInPeriod: p.data.countsInPeriod,
      isActive: p.data.isActive,
    },
  });

  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "TeachingCreditType",
    entityId: p.data.code,
    action: "UPDATE",
    oldValues: {
      basis: old.basis,
      factor: old.factor,
      countsInPeriod: old.countsInPeriod,
      isActive: old.isActive,
    },
    newValues: {
      basis: p.data.basis,
      factor: p.data.factor,
      countsInPeriod: p.data.countsInPeriod,
      isActive: p.data.isActive,
    },
  });
  xaBoNho();
  return { ok: true };
}

export async function createTeachingCreditTypeAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = schemaThem.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const chan = await gac();
  if (chan) return { ok: false, error: chan };

  const sdb = scopedDb(await resolveActor(session.user.id));

  // Buổi trải nghiệm KHÔNG mang phân loại (`TrialClassSession` không có cột đó), nên dòng riêng
  // cho nguồn TRIAL không bao giờ khớp buổi nào — một ô luôn bằng 0 mà không ai hiểu vì sao.
  if (p.data.source === "TRIAL") {
    return {
      ok: false,
      error:
        "Buổi trải nghiệm chưa mang phân loại nên dòng riêng sẽ không nhận được buổi nào. Chỉnh hệ số ở ba dòng Trải nghiệm sẵn có.",
    };
  }

  const pl = await sdb.sessionCategory.findUnique({
    where: { code: p.data.categoryCode },
    select: { id: true, name: true, isActive: true },
  });
  if (!pl) return { ok: false, error: "Không tìm thấy phân loại buổi này" };
  if (!pl.isActive) {
    return { ok: false, error: `Phân loại ${pl.name} đang tắt — bật lại ở màn Phân loại buổi trước.` };
  }

  const trung = await sdb.teachingCreditType.findFirst({
    where: { source: p.data.source, role: p.data.role, categoryId: pl.id },
    select: { code: true },
  });
  if (trung) return { ok: false, error: "Tổ hợp nguồn × vai × phân loại này đã có dòng rồi" };

  // Mã suy từ chính khoá — khoá `(source, role, categoryId)` là duy nhất nên mã cũng duy nhất.
  const code = `${p.data.source}_${p.data.role}_${p.data.categoryCode}`;
  const max = await sdb.teachingCreditType.findFirst({
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });

  await sdb.teachingCreditType.create({
    data: {
      code,
      name: `${pl.name} — ${NHAN_VAI[p.data.role] ?? p.data.role}`,
      source: p.data.source,
      role: p.data.role,
      categoryId: pl.id,
      basis: p.data.basis,
      factor: p.data.factor,
      countsInPeriod: p.data.countsInPeriod,
      isActive: true,
      displayOrder: (max?.displayOrder ?? 0) + 1,
    },
  });

  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "TeachingCreditType",
    entityId: code,
    action: "CREATE",
    newValues: {
      source: p.data.source,
      role: p.data.role,
      categoryCode: p.data.categoryCode,
      factor: p.data.factor,
      countsInPeriod: p.data.countsInPeriod,
    },
  });
  xaBoNho();
  return { ok: true };
}

export async function deleteTeachingCreditTypeAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = z.object({ code: z.string().min(1) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const chan = await gac();
  if (chan) return { ok: false, error: chan };

  const sdb = scopedDb(await resolveActor(session.user.id));
  const row = await sdb.teachingCreditType.findUnique({
    where: { code: p.data.code },
    select: { code: true, name: true, categoryId: true, source: true, role: true, factor: true },
  });
  if (!row) return { ok: false, error: "Không tìm thấy loại công dạy này" };
  if (row.categoryId == null) {
    return {
      ok: false,
      error:
        "Sáu dòng bao sân là lưới đỡ của mọi buổi, không xoá được. Chỉ dòng theo phân loại mới xoá được.",
    };
  }

  await sdb.teachingCreditType.delete({ where: { code: p.data.code } });
  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "TeachingCreditType",
    entityId: row.code,
    action: "DELETE",
    oldValues: { name: row.name, source: row.source, role: row.role, factor: row.factor },
  });
  xaBoNho();
  return { ok: true };
}
