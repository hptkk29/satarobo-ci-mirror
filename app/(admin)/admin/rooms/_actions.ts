"use server";

import { auth } from "@/lib/auth";
import { hasAnyRole } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { centerIdForOrgUnit } from "@/lib/org/org-service";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";

// Cách ly cơ sở: Room ∈ SCOPED_MODELS. CENTER_MANAGER chỉ thao tác phòng thuộc
// cơ sở mình; không re-home phòng sang cơ sở ngoài tầm nhìn (chống IDOR ghi).
// GHI đối xứng với ĐỌC (vá 24/07): scope per-model qua passesScope — role HO không
// có quyền rooms:/centers: không được tạo/chuyển phòng cơ sở khác.
function actorCanUseCenter(actor: Actor, centerId: string): boolean {
  return passesScope("Room", { centerId }, actor);
}

type ActionResult = { error?: string };

const ROOM_STATUSES = ["ACTIVE", "MAINTENANCE", "INACTIVE"] as const;

const roomSchema = z.object({
  name: z.string().trim().min(1, "Tên phòng không được để trống"),
  code: z
    .string()
    .trim()
    .min(1, "Mã phòng không được để trống")
    .regex(/^[A-Z0-9-]+$/, "Mã chỉ A-Z, 0-9, dấu -"),
  // PR-C: đơn vị (OrgUnit) là nguồn chính; centerId suy ra (CENTER-only nên non-null).
  orgUnitId: z.string().trim().min(1, "Chọn cơ sở"),
  capacity: z.number().int().min(1, "Sức chứa tối thiểu 1"),
  equipment: z.array(z.string().trim().min(1)).default([]),
  status: z.enum(ROOM_STATUSES).default("ACTIVE"),
  notes: z.string().nullable().optional(),
  displayOrder: z.number().int().default(0),
});

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseInteger(value: FormDataEntryValue | null, fallback = 0): number {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function parseEquipment(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((s) => (typeof s === "string" ? s.trim() : String(s).trim()))
        .filter((s) => s.length > 0);
    }
  } catch {
    // fall through
  }
  return [];
}

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasAnyRole(session.user, ["SUPER_ADMIN", "CENTER_MANAGER"])) {
    redirect("/dashboard?error=unauthorized");
  }
  return session.user;
}

function readForm(formData: FormData) {
  return {
    name: emptyToUndefined(formData.get("name")) ?? "",
    code: (emptyToUndefined(formData.get("code")) ?? "").toUpperCase(),
    orgUnitId: emptyToUndefined(formData.get("orgUnitId")) ?? "",
    capacity: parseInteger(formData.get("capacity"), 15),
    equipment: parseEquipment(formData.get("equipment")),
    status: (emptyToUndefined(formData.get("status")) ?? "ACTIVE") as
      | "ACTIVE"
      | "MAINTENANCE"
      | "INACTIVE",
    notes: emptyToUndefined(formData.get("notes")) ?? null,
    displayOrder: parseInteger(formData.get("displayOrder"), 0),
  };
}

// PR-C dual-write: ghi orgUnitId (nguồn chính) + centerId (suy ra, scopedDb cũ).
function toCreate(
  c: z.infer<typeof roomSchema>,
  centerId: string,
): Prisma.RoomCreateInput {
  return {
    name: c.name,
    code: c.code,
    capacity: c.capacity,
    equipment: c.equipment,
    status: c.status,
    notes: c.notes ?? null,
    displayOrder: c.displayOrder,
    orgUnitId: c.orgUnitId,
    center: { connect: { id: centerId } },
  };
}

function toUpdate(
  c: z.infer<typeof roomSchema>,
  centerId: string,
): Prisma.RoomUpdateInput {
  return {
    name: c.name,
    code: c.code,
    capacity: c.capacity,
    equipment: c.equipment,
    status: c.status,
    notes: c.notes ?? null,
    displayOrder: c.displayOrder,
    orgUnitId: c.orgUnitId,
    center: { connect: { id: centerId } },
  };
}

/**
 * 01/10/2026 — phòng học nay quản lý NGAY trong trang cơ sở. Form mở từ đó mang ẩn
 * `quayVe=/centers/<id>/edit` để lưu xong quay lại đúng chỗ. CHỈ nhận đúng dạng đường đó
 * (không mở cửa chuyển hướng tuỳ ý); mọi giá trị khác rơi về /rooms như cũ.
 */
function duongQuayVe(formData: FormData): string {
  const v = formData.get("quayVe");
  return typeof v === "string" && /^\/centers\/[A-Za-z0-9_-]+\/edit$/.test(v) ? v : "/rooms";
}

export async function createRoom(formData: FormData): Promise<ActionResult> {
  const user = await requireAdmin();

  const parsed = roomSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  // PR-C: suy centerId từ orgUnitId (Room phải là CENTER nên centerId non-null).
  const centerId = await centerIdForOrgUnit(parsed.data.orgUnitId);
  if (!centerId) {
    return { error: "Đơn vị không hợp lệ — phòng học phải thuộc một cơ sở" };
  }

  // Cách ly cơ sở: chỉ tạo phòng cho cơ sở trong tầm nhìn actor.
  const actor = await resolveActor(user.id);
  if (!actorCanUseCenter(actor, centerId)) {
    return { error: "Không có quyền tạo phòng cho cơ sở này" };
  }

  try {
    await scopedDb(actor).room.create({ data: toCreate(parsed.data, centerId) });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "Mã phòng đã tồn tại trong cơ sở này" };
    }
    return { error: "Lỗi cơ sở dữ liệu — không tạo được phòng" };
  }

  revalidatePath("/rooms");
  const ve = duongQuayVe(formData);
  if (ve !== "/rooms") revalidatePath(ve);
  redirect(ve);
}

export async function updateRoom(id: string, formData: FormData): Promise<ActionResult> {
  const user = await requireAdmin();

  const parsed = roomSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  // PR-C: suy centerId từ orgUnitId (Room phải là CENTER nên centerId non-null).
  const centerId = await centerIdForOrgUnit(parsed.data.orgUnitId);
  if (!centerId) {
    return { error: "Đơn vị không hợp lệ — phòng học phải thuộc một cơ sở" };
  }

  // Cách ly cơ sở (chống IDOR ghi): phòng HIỆN TẠI phải trong tầm nhìn actor, và
  // cơ sở ĐÍCH (sau khi đổi orgUnitId) cũng phải trong tầm nhìn actor.
  const actor = await resolveActor(user.id);
  const sdb = scopedDb(actor);
  const existing = await sdb.room.findUnique({ where: { id }, select: { centerId: true } });
  if (!existing || !passesScope("Room", existing, actor)) {
    return { error: "Phòng không tồn tại" };
  }
  if (!actorCanUseCenter(actor, centerId)) {
    return { error: "Không có quyền chuyển phòng sang cơ sở này" };
  }

  try {
    await sdb.room.update({ where: { id }, data: toUpdate(parsed.data, centerId) });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "Mã phòng đã tồn tại trong cơ sở này" };
    }
    return { error: "Phòng không tồn tại hoặc lỗi cơ sở dữ liệu" };
  }

  revalidatePath("/rooms");
  revalidatePath(`/rooms/${id}/edit`);
  const ve = duongQuayVe(formData);
  if (ve !== "/rooms") revalidatePath(ve);
  redirect(ve);
}

export async function deleteRoom(id: string): Promise<ActionResult> {
  const user = await requireAdmin();
  // Cách ly cơ sở: chỉ xoá phòng trong tầm nhìn cơ sở của actor (chống IDOR).
  const actor = await resolveActor(user.id);
  const sdb = scopedDb(actor);
  const existing = await sdb.room.findUnique({ where: { id }, select: { centerId: true } });
  if (!existing || !passesScope("Room", existing, actor)) {
    return { error: "Phòng không tồn tại" };
  }
  try {
    await sdb.room.delete({ where: { id } });
  } catch {
    return { error: "Không thể xoá phòng này" };
  }
  revalidatePath("/rooms");
  revalidatePath(`/centers/${existing.centerId}/edit`);
  return {};
}
