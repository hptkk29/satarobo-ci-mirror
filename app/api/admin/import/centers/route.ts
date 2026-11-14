import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/check-permission";

const optionalString = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  });

const boolish = z
  .union([z.boolean(), z.number(), z.string()])
  .optional()
  .transform((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      return t === "true" || t === "1" || t === "yes" || t === "y" || t === "có";
    }
    return true;
  });

const intish = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => {
    if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : 0;
    if (typeof v === "string") {
      const n = parseInt(v.trim(), 10);
      return Number.isNaN(n) ? 0 : n;
    }
    return 0;
  });

const CenterImportSchema = z.object({
  name: z.string().trim().min(1, "Thiếu name"),
  slug: z
    .string()
    .trim()
    .min(1, "Thiếu slug")
    .regex(/^[a-z0-9-]+$/, "Slug chỉ chứa a-z, 0-9, dấu -"),
  address: z.string().trim().min(1, "Thiếu address"),
  ward: optionalString,
  district: optionalString,
  city: z.string().trim().min(1, "Thiếu city"),
  phone: optionalString,
  email: optionalString.pipe(
    z
      .union([z.literal(null), z.string().email("Email không hợp lệ")])
      .nullable(),
  ),
  googleMapUrl: optionalString,
  workingHours: optionalString,
  managerName: optionalString,
  description: optionalString,
  isActive: boolish,
  displayOrder: intish,
});

type ImportError = { row: number; error: string };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await checkPermission("centers:edit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rows = (body as { rows?: unknown[] })?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "Không có dữ liệu" }, { status: 400 });
  }
  if (rows.length > 5000) {
    return NextResponse.json({ error: "Quá 5000 rows" }, { status: 400 });
  }

  const errors: ImportError[] = [];
  const validRows: z.infer<typeof CenterImportSchema>[] = [];

  for (let i = 0; i < rows.length; i++) {
    const result = CenterImportSchema.safeParse(rows[i]);
    if (result.success) {
      validRows.push(result.data);
    } else {
      errors.push({
        row: i + 2,
        error: result.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
      });
    }
  }

  if (validRows.length === 0) {
    return NextResponse.json({ success: 0, errors }, { status: 200 });
  }

  // Center SCOPE_EXEMPT (ranh giới tenant, RBAC-DECISION #5) → sdb pass-through;
  // quyền tạo/sửa cơ sở đã gate tường minh bằng checkPermission("centers:edit").
  const sdb = scopedDb(await resolveActor(session.user.id));

  try {
    await sdb.$transaction(
      validRows.map((r) =>
        sdb.center.upsert({
          where: { slug: r.slug },
          create: {
            name: r.name,
            slug: r.slug,
            address: r.address,
            ward: r.ward,
            district: r.district,
            city: r.city,
            phone: r.phone,
            email: r.email,
            googleMapUrl: r.googleMapUrl,
            workingHours: r.workingHours,
            managerName: r.managerName,
            description: r.description,
            isActive: r.isActive ?? true,
            displayOrder: r.displayOrder ?? 0,
          },
          update: {
            name: r.name,
            address: r.address,
            ward: r.ward,
            district: r.district,
            city: r.city,
            phone: r.phone,
            email: r.email,
            googleMapUrl: r.googleMapUrl,
            workingHours: r.workingHours,
            managerName: r.managerName,
            description: r.description,
            isActive: r.isActive ?? true,
            displayOrder: r.displayOrder ?? 0,
          },
        }),
      ),
    );
  } catch (err) {
    return NextResponse.json(
      {
        success: 0,
        errors: [
          ...errors,
          {
            row: 0,
            error: `Transaction failed: ${err instanceof Error ? err.message : "Unknown"}`,
          },
        ],
      },
      { status: 500 },
    );
  }

  revalidatePath("/admin/centers");
  revalidatePath("/lien-he");

  return NextResponse.json({ success: validRows.length, errors });
}
