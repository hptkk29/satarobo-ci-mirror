"use server";

// app/(admin)/admin/cham-cong/diem-cham/_actions.ts — L4: điểm chấm công (WorkLocation): toạ độ dán từ
// Google Maps, bán kính, bật/tắt geofence từng cơ sở (Q-02: chưa toạ độ thì không bật). Quyền `config`.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";

type Res = { ok: true } | { ok: false; error: string };

const schema = z
  .object({
    id: z.string().optional(),
    centerId: z.string().min(1),
    code: z.string().trim().min(1).max(16).regex(/^[A-Z0-9_-]+$/, "Mã chỉ gồm chữ hoa/số"),
    name: z.string().trim().min(1).max(80),
    latitude: z.coerce.number().min(-90).max(90).nullable().default(null),
    longitude: z.coerce.number().min(-180).max(180).nullable().default(null),
    radiusMeters: z.coerce.number().int().min(10).max(2000).default(100),
    geofenceEnabled: z.coerce.boolean().default(false),
    isActive: z.coerce.boolean().default(true),
  })
  .refine((v) => !v.geofenceEnabled || (v.latitude != null && v.longitude != null), { message: "Chưa có toạ độ thì không bật geofence được" });

export async function saveWorkLocationAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  if (!(await checkPermission("hr_attendance:config", { centerId: p.data.centerId }))) return { ok: false, error: "Không có quyền cấu hình điểm chấm công ở cơ sở này" };
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const { id, ...data } = p.data;
  if (id) {
    const existing = await sdb.workLocation.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Không tìm thấy điểm chấm công" };
    if (!(await checkPermission("hr_attendance:config", { centerId: existing.centerId }))) return { ok: false, error: "Không có quyền" };
    await sdb.workLocation.update({ where: { id }, data });
    await writeAudit({ actor: { id: session.user.id, name: session.user.name ?? "" }, module: "hr_attendance", entityType: "WorkLocation", entityId: id, action: "UPDATE", oldValues: { latitude: existing.latitude, longitude: existing.longitude, radiusMeters: existing.radiusMeters, geofenceEnabled: existing.geofenceEnabled, isActive: existing.isActive }, newValues: data });
  } else {
    const created = await sdb.workLocation.create({ data, select: { id: true } });
    await writeAudit({ actor: { id: session.user.id, name: session.user.name ?? "" }, module: "hr_attendance", entityType: "WorkLocation", entityId: created.id, action: "CREATE", newValues: data });
  }
  revalidatePath("/cham-cong/diem-cham");
  return { ok: true };
}

// ── Thu hồi mã QR đã in (đợt 2, 07/09/2026) ────────────────────────────────────────────
//
// Vì sao phải có nút này: mã QR nay là mã TĨNH in ra dán ở quầy. Tờ giấy đó mất, hoặc nhân
// viên nghỉ việc còn giữ ảnh chụp, thì cách DUY NHẤT vô hiệu hoá nó là tăng `qrKeyVersion`.
// Không có nút thì việc đó phải chạy SQL trên prod — mà theo luật dự án prod chỉ chạm được
// qua workflow GitHub, tức lớp thu hồi duy nhất trên thực tế là không dùng được.
//
// Đổi khoá là hành động MỘT CHIỀU với người đang đứng ở quầy: mọi tờ cũ chết ngay lập tức.
// Nên buộc nêu lý do (vào audit) và chỗ gọi phải hỏi lại trước khi bấm.
const thuHoiSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(5, "Nêu lý do thu hồi (mất tờ giấy, nhân viên nghỉ…)").max(300),
});

export async function revokeQrKeyAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = thuHoiSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  const sdb = scopedDb(await resolveActor(session.user.id));
  const wl = await sdb.workLocation.findUnique({
    where: { id: p.data.id },
    select: { id: true, centerId: true, name: true, qrKeyVersion: true },
  });
  if (!wl) return { ok: false, error: "Không tìm thấy điểm chấm công" };
  // `scopedDb` không che đường ghi — gác bằng target thật.
  if (!(await checkPermission("hr_attendance:config", { centerId: wl.centerId }))) {
    return { ok: false, error: "Thu hồi mã QR cần quyền cấu hình tại cơ sở này" };
  }

  await sdb.workLocation.update({
    where: { id: wl.id },
    data: { qrKeyVersion: { increment: 1 } },
  });
  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "WorkLocation",
    entityId: wl.id,
    action: "REVOKE_QR_KEY",
    oldValues: { qrKeyVersion: wl.qrKeyVersion },
    newValues: { qrKeyVersion: wl.qrKeyVersion + 1 },
    reason: p.data.reason,
  });
  revalidatePath("/cham-cong/diem-cham");
  revalidatePath("/cham-cong/man-hinh");
  return { ok: true };
}
