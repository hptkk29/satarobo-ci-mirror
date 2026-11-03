"use server";

// Danh mục PHÂN LOẠI BUỔI — học chính thức / lớp Coach / bù / vượt / workshop / sự kiện.
//
// Vì sao là danh mục chứ không phải enum trong mã: chủ dự án đặt luật "tự tạo tự add được qua hệ
// thống chứ không cần code". Enum thì thêm "Sự kiện hè 2027" là phải deploy.
//
// Danh mục DÙNG CHUNG toàn hệ thống ⇒ quyền `hr_attendance:config` cấp Hội sở, giống Loại nghỉ.
// Để cấp cơ sở sửa được là mỗi nơi một cách phân loại, rồi tổng công dạy toàn hệ thống không ai
// giải thích nổi.
//
// ⚠️ `countsTowardQuota` KHÔNG NHẬN TỪ ĐẦU VÀO (chốt chủ dự án 07/09 — phương án (b)).
// Cột vẫn còn, dữ liệu đã có vẫn còn, nhưng KHÔNG có đường ghi giá trị mới cho tới khi bộ đếm
// định mức thật sự chạy. Lý do chặn không phải công sức mà là LỖ QUYỀN: bộ đếm 50/30/20 phải đọc
// `Employee.contractType`, vốn thuộc nhóm trường chỉ SUPER_ADMIN/HR xem được — bày con số định mức
// cho Quản lý cơ sở là kênh để họ suy ngược ra loại hợp đồng của đồng nghiệp.
//
// GỠ KHỎI SCHEMA ĐẦU VÀO chứ không chỉ ẩn ô trên giao diện: Server Action là endpoint HTTP riêng,
// ẩn ô mà vẫn nhận trường thì ai gọi thẳng vẫn ghi được. Đây đúng cách đã vá `Payment.method`.
//
// KHÔNG CÓ XOÁ — chỉ tắt. Một phân loại đã bị buổi cũ trỏ tới thì xoá đi là mất dấu vì sao buổi
// đó từng có hệ số riêng; và `TeachingCreditType.categoryId` để `onDelete: Restrict` nên xoá còn
// vỡ ngay ở tầng DB. Tắt thì buổi cũ rơi về dòng mặc định, có đường lùi.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { HO_CENTER_ID } from "@/lib/cham-cong/home-center";

type Res = { ok: true; id: string } | { ok: false; error: string };

const schema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Thiếu mã")
    .max(24)
    .regex(/^[A-Z0-9_]+$/, "Mã chỉ gồm chữ hoa/số/_")
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1, "Thiếu tên").max(80),
  isDefault: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
});
export type SessionCategoryInput = z.input<typeof schema>;

export async function saveSessionCategoryAction(id: string | null, input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("hr_attendance:config", { centerId: HO_CENTER_ID }))) {
    return { ok: false, error: "Danh mục phân loại buổi dùng chung — cần quyền cấu hình cấp Hội sở" };
  }
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = p.data;

  // Dòng mặc định là nơi mọi buổi CHƯA phân loại rơi vào — nó phải luôn dùng được. Hai điều kiện
  // dưới đây chặn hai đường tự bắn chân: bật mặc định cho một dòng đang tắt, và tắt chính dòng
  // mặc định (khi đó buổi chưa phân loại không có hệ số nào, công dạy tụt im lặng).
  if (d.isDefault && !d.isActive) {
    return { ok: false, error: "Dòng mặc định phải đang dùng — buổi chưa phân loại rơi vào đây." };
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const dup = await sdb.sessionCategory.findUnique({ where: { code: d.code }, select: { id: true } });
  if (dup && dup.id !== id) return { ok: false, error: `Mã "${d.code}" đã tồn tại` };

  const old = id
    ? await sdb.sessionCategory.findUnique({
        where: { id },
        select: { code: true, name: true, isDefault: true, isActive: true },
      })
    : null;
  if (id && !old) return { ok: false, error: "Không tìm thấy phân loại buổi" };
  if (old?.isDefault && !d.isDefault) {
    return {
      ok: false,
      error: "Không bỏ được dòng mặc định — hãy đặt mặc định cho một dòng khác, hệ thống tự nhả dòng này.",
    };
  }

  // Partial unique index `SessionCategory_one_default` chỉ cho ĐÚNG MỘT dòng mặc định, nên phải
  // nhả dòng cũ TRƯỚC khi đặt dòng mới, và cả hai bước phải nằm trong một transaction — nhả xong
  // mà bước đặt hỏng thì hệ thống không còn dòng mặc định nào.
  const savedId = await sdb.$transaction(async (tx) => {
    if (d.isDefault) {
      await tx.sessionCategory.updateMany({
        where: { isDefault: true, ...(id ? { id: { not: id } } : {}) },
        data: { isDefault: false },
      });
    }
    if (id) {
      await tx.sessionCategory.update({ where: { id }, data: d });
      return id;
    }
    const max = await tx.sessionCategory.findFirst({
      orderBy: { displayOrder: "desc" },
      select: { displayOrder: true },
    });
    const created = await tx.sessionCategory.create({
      data: { ...d, displayOrder: (max?.displayOrder ?? 0) + 1 },
      select: { id: true },
    });
    return created.id;
  });

  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "SessionCategory",
    entityId: savedId,
    action: id ? "UPDATE" : "CREATE",
    ...(old ? { oldValues: old } : {}),
    newValues: d,
  });
  revalidatePath("/cham-cong/phan-loai-buoi");
  revalidatePath("/cham-cong/cong-day");
  return { ok: true, id: savedId };
}
