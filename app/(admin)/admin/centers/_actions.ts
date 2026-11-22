"use server";

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { datQuanLyCoSo, PhanCongError } from "@/lib/crm/commission-assignee-store";

type ActionResult = { error?: string };

const centerSchema = z.object({
  name: z.string().trim().min(1, "Tên cơ sở không được để trống"),
  slug: z
    .string()
    .trim()
    .min(1, "Slug không được để trống")
    .regex(/^[a-z0-9-]+$/, "Slug chỉ chứa chữ thường, số và dấu gạch"),
  address: z.string().trim().min(1, "Địa chỉ không được để trống"),
  ward: z.string().trim().optional(),
  district: z.string().trim().optional(),
  city: z.string().trim().min(1, "Tỉnh/TP không được để trống"),
  phone: z.string().trim().optional(),
  email: z
    .union([z.string().trim().email("Email không hợp lệ"), z.literal("")])
    .optional(),
  googleMapUrl: z.string().trim().optional(),
  workingHours: z.string().trim().optional(),
  managerName: z.string().trim().optional(),
  // 27/08 — LIÊN KẾT TÀI KHOẢN quản lý cơ sở (nguồn hoa hồng QL TT 2%).
  // Optional ở schema chung vì cơ sở CŨ chưa khai; bắt buộc khi TẠO — xem
  // `centerCreateSchema` ngay dưới. Cột này KHÔNG đi qua `toData()`: nó chỉ được ghi
  // bởi `datQuanLyCoSo()` để cột và sổ phân công không bao giờ lệch nhau.
  managerUserId: z.string().trim().optional(),
  logoUrl: z.string().trim().optional(),
  bannerUrl: z.string().trim().optional(),
  description: z.string().trim().optional(),
  isActive: z.boolean(),
  displayOrder: z.number().int().default(0),
  // Phase NHÓM 4 — geofence chấm công.
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  allowedRadiusMeters: z.number().int().min(10).max(5000).nullable(),
});

/**
 * Tạo cơ sở mới BẮT BUỘC có tài khoản quản lý (chủ dự án chốt 27/08/2026).
 *
 * Ép ở tầng validator chứ không phải NOT NULL ở DB: 3 cơ sở đang chạy trên PROD chưa
 * khai, nên NOT NULL sẽ chặn deploy. Sửa cơ sở CŨ vẫn cho để trống — bắt điền mới sửa
 * được địa chỉ là chặn việc chẳng liên quan.
 */
const centerCreateSchema = centerSchema.extend({
  managerUserId: z
    .string()
    .trim()
    .min(1, "Phải chọn tài khoản quản lý cơ sở — nếu không, 2% hoa hồng của cơ sở này treo mỗi kỳ"),
});

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function emptyToNull(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

function parseInteger(value: FormDataEntryValue | null): number {
  if (typeof value !== "string" || value.trim() === "") return 0;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}

function parseFloatOrNull(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

function parseIntOrNull(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

// Quản trị tổ chức (tạo/sửa/xoá/đổi trạng thái Center) là cấu trúc tổ chức →
// SUPER_ADMIN-only (Doc 15: chỉ SUPER_ADMIN tạo/sửa cấu trúc tổ chức). `centers:edit`
// trong ma trận quyền = ["SUPER_ADMIN"]. Trước đây gate cho cả CENTER_MANAGER ⇒
// BẤT KỲ CM nào sửa/xoá Center BẤT KỲ qua id (Center ∉ SCOPED_MODELS, không cách ly).
//
// RBAC-DECISION #5 (06/07): Center ∈ SCOPE_EXEMPT (ranh giới tenant, không tự scope) →
// scopedDb pass-through, hành vi y nguyên; lớp bảo vệ là gate `centers:edit` ở trên.
async function requireOrgAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("centers:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }
  const actor = await resolveActor(session.user.id);
  return { user: session.user, sdb: scopedDb(actor) };
}

function readForm(formData: FormData) {
  return {
    name: emptyToUndefined(formData.get("name")) ?? "",
    slug: emptyToUndefined(formData.get("slug")) ?? "",
    address: emptyToUndefined(formData.get("address")) ?? "",
    ward: emptyToUndefined(formData.get("ward")),
    district: emptyToUndefined(formData.get("district")),
    city: emptyToUndefined(formData.get("city")) ?? "",
    phone: emptyToUndefined(formData.get("phone")),
    email: emptyToUndefined(formData.get("email")) ?? "",
    googleMapUrl: emptyToUndefined(formData.get("googleMapUrl")),
    workingHours: emptyToUndefined(formData.get("workingHours")),
    managerName: emptyToUndefined(formData.get("managerName")),
    managerUserId: emptyToUndefined(formData.get("managerUserId")),
    logoUrl: emptyToUndefined(formData.get("logoUrl")),
    bannerUrl: emptyToUndefined(formData.get("bannerUrl")),
    description: emptyToUndefined(formData.get("description")),
    isActive: formData.get("isActive") === "on",
    displayOrder: parseInteger(formData.get("displayOrder")),
    latitude: parseFloatOrNull(formData.get("latitude")),
    longitude: parseFloatOrNull(formData.get("longitude")),
    allowedRadiusMeters: parseIntOrNull(formData.get("allowedRadiusMeters")),
  };
}

/**
 * ⚠️ CỐ Ý KHÔNG CÓ `managerUserId` Ở ĐÂY. Cột đó là bản sao "hiện tại" của sổ
 * `CenterCommissionAssignee(QL_TT)`, và hoa hồng 2% đi theo SỔ. Cho form ghi thẳng cột
 * là mở đường cho hai nguồn lệch nhau: hồ sơ cơ sở nói người A, tiền chảy về người B,
 * và không gì báo lỗi. Đường ghi duy nhất là `datQuanLyCoSo()` (ghi cả hai trong một
 * transaction).
 */
function toData(c: z.infer<typeof centerSchema>): Prisma.CenterCreateInput {
  return {
    name: c.name,
    slug: c.slug,
    address: c.address,
    ward: emptyToNull(c.ward),
    district: emptyToNull(c.district),
    city: c.city,
    phone: emptyToNull(c.phone),
    email: c.email ? c.email : null,
    googleMapUrl: emptyToNull(c.googleMapUrl),
    workingHours: emptyToNull(c.workingHours),
    managerName: emptyToNull(c.managerName),
    logoUrl: emptyToNull(c.logoUrl),
    bannerUrl: emptyToNull(c.bannerUrl),
    description: emptyToNull(c.description),
    isActive: c.isActive,
    displayOrder: c.displayOrder,
    latitude: c.latitude,
    longitude: c.longitude,
    allowedRadiusMeters: c.allowedRadiusMeters,
  };
}

export async function createCenter(formData: FormData): Promise<ActionResult> {
  const { user, sdb } = await requireOrgAdmin();

  const parsed = centerCreateSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  let created: { id: string };
  try {
    created = await sdb.center.create({ data: toData(parsed.data), select: { id: true } });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "Slug đã tồn tại — chọn slug khác" };
    }
    return { error: "Lỗi cơ sở dữ liệu — không tạo được cơ sở" };
  }

  // Cơ sở đã tồn tại rồi; nếu bước này hỏng thì cơ sở nằm đó KHÔNG có quản lý — trạng
  // thái đó HIỆN RÕ ("Chưa khai: Quản lý TT 2%") ở màn người hưởng, không âm thầm.
  const loi = await datQuanLy(user, created.id, parsed.data.managerUserId);
  revalidatePath("/centers");
  revalidatePath("/lien-he");
  if (loi) return { error: loi };
  // Thành công → trả {} để client toast + điều hướng (QA 20/07 — không redirect âm thầm).
  return {};
}

/** Đặt/đổi quản lý cơ sở qua ĐÚNG một đường ghi. Trả về câu lỗi cho UI, hoặc null. */
async function datQuanLy(
  user: { id: string; name?: string | null; email?: string | null },
  centerId: string,
  managerUserId: string | undefined,
): Promise<string | null> {
  if (!managerUserId) return null;
  try {
    await datQuanLyCoSo(
      { id: user.id, name: user.name ?? user.email ?? user.id },
      { centerId, userId: managerUserId },
    );
    return null;
  } catch (e) {
    if (e instanceof PhanCongError) {
      return `Đã lưu hồ sơ cơ sở, nhưng KHÔNG gán được tài khoản quản lý: ${e.message}`;
    }
    return "Đã lưu hồ sơ cơ sở, nhưng không gán được tài khoản quản lý — thử lại ở màn Người hưởng hoa hồng theo cơ sở.";
  }
}

export async function updateCenter(id: string, formData: FormData): Promise<ActionResult> {
  const { user, sdb } = await requireOrgAdmin();

  const parsed = centerSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  try {
    await sdb.center.update({ where: { id }, data: toData(parsed.data) });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "Slug đã tồn tại — chọn slug khác" };
    }
    return { error: "Cơ sở không tồn tại hoặc lỗi cơ sở dữ liệu" };
  }

  // `datQuanLyCoSo` tự bỏ qua khi không đổi người ⇒ bấm Lưu địa chỉ không đẻ dòng sổ.
  // Để trống ô này KHÔNG gỡ quản lý hiện tại: gỡ là việc tường minh, làm ở màn người
  // hưởng bằng nút "Kết thúc" (có ngày hiệu lực), không phải hệ quả phụ của một lần lưu.
  const loi = await datQuanLy(user, id, parsed.data.managerUserId);

  revalidatePath("/centers");
  revalidatePath(`/centers/${id}/edit`);
  revalidatePath("/lien-he");
  if (loi) return { error: loi };
  return {};
}

export async function deleteCenter(id: string): Promise<ActionResult> {
  const { sdb } = await requireOrgAdmin();

  // Check linked relations — Center có quan hệ với users, leads, classes, students, employees.
  // Prisma onDelete mặc định Restrict — sẽ throw nếu có liên kết.
  // Đếm trước để báo lỗi rõ ràng.
  const counts = await sdb.center
    .findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            users: true,
            leads: true,
            classes: true,
            students: true,
            employees: true,
            // 30/08/2026 — phương thức thanh toán RIÊNG của cơ sở. FK là RESTRICT ở tầng
            // DB, nên thiếu dòng này thì xoá cơ sở chỉ còn phương thức treo sẽ ném lỗi
            // Prisma và người dùng nhận câu "Không thể xoá cơ sở này" không nói vì sao.
            paymentMethods: true,
          },
        },
      },
    })
    .catch(() => null);

  if (counts) {
    const c = counts._count;
    const total =
      c.users + c.leads + c.classes + c.students + c.employees + c.paymentMethods;
    if (total > 0) {
      return {
        error: `Không thể xoá — cơ sở đang liên kết: ${c.users} user, ${c.leads} lead, ${c.classes} lớp, ${c.students} HV, ${c.employees} nhân sự, ${c.paymentMethods} phương thức thanh toán. Vui lòng chuyển liên kết trước.`,
      };
    }
  }

  try {
    await sdb.center.delete({ where: { id } });
  } catch {
    return { error: "Không thể xoá cơ sở này" };
  }

  revalidatePath("/centers");
  revalidatePath("/lien-he");
  return {};
}

export async function toggleCenterActive(id: string, newValue: boolean): Promise<ActionResult> {
  const { sdb } = await requireOrgAdmin();
  try {
    await sdb.center.update({ where: { id }, data: { isActive: newValue } });
  } catch {
    return { error: "Không thể cập nhật trạng thái" };
  }
  revalidatePath("/centers");
  revalidatePath("/lien-he");
  return {};
}
