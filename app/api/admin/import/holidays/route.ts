import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/check-permission";
import { orgUnitIdForCenter } from "@/lib/org/org-service";

// Parse a date from Excel: Date object, ISO string YYYY-MM-DD, DD/MM/YYYY,
// or Excel serial number (days since 1899-12-30).
function parseExcelDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + v * 86400000;
    const d = new Date(ms);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (iso) {
      return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    }
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (dmy) {
      return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));
    }
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    const d = new Date(t);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return null;
}

const dateField = z.unknown().transform((v, ctx) => {
  const d = parseExcelDate(v);
  if (!d) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Ngày không hợp lệ — dùng YYYY-MM-DD",
    });
    return z.NEVER;
  }
  return d;
});

const optionalDate = z
  .unknown()
  .optional()
  .transform((v) => parseExcelDate(v));

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (!v) return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  });

const HolidayImportSchema = z
  .object({
    name: z.string().trim().min(1, "Thiếu tên"),
    date: dateField,
    endDate: optionalDate,
    centerSlug: optionalString,
    type: z.enum(["HOLIDAY", "MAINTENANCE", "EVENT", "OTHER"]).default("HOLIDAY"),
    note: optionalString,
  })
  .refine(
    (d) => d.endDate === null || d.endDate.getTime() >= d.date.getTime(),
    { message: "endDate phải >= date", path: ["endDate"] },
  );

type ImportError = { row: number; error: string };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await checkPermission("holidays:edit"))) {
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

  // Stage 1: schema parse
  const stageOne: (
    | { ok: true; data: z.infer<typeof HolidayImportSchema> }
    | { ok: false; row: number; error: string }
  )[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = HolidayImportSchema.safeParse(rows[i]);
    if (r.success) {
      stageOne.push({ ok: true, data: r.data });
    } else {
      stageOne.push({
        ok: false,
        row: i + 2,
        error: r.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
      });
    }
  }

  // Cách ly cơ sở: Holiday ∈ SCOPED_MODELS. Write theo centerId form → guard
  // passesScope per-row; row KHÔNG có centerSlug = ngày nghỉ TOÀN HỆ THỐNG
  // (centerId null) → chỉ SUPER_ADMIN/HO được import. Center exempt.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // Stage 2: resolve centerSlug → id
  const slugs = [
    ...new Set(
      stageOne.flatMap((r) =>
        r.ok && r.data.centerSlug ? [r.data.centerSlug] : [],
      ),
    ),
  ];
  const centers = slugs.length
    ? await sdb.center.findMany({
        where: { slug: { in: slugs } },
        select: { id: true, slug: true },
      })
    : [];
  const slugToId = new Map(centers.map((c) => [c.slug, c.id]));

  // Dual-write 2-phase: dựng map centerId → orgUnitId 1 lần (số cơ sở nhỏ).
  const centerIdToOrgUnitId = new Map<string, string | null>();
  for (const c of centers) {
    centerIdToOrgUnitId.set(c.id, await orgUnitIdForCenter(c.id));
  }

  const validRows: {
    data: z.infer<typeof HolidayImportSchema>;
    centerId: string | null;
    orgUnitId: string | null;
  }[] = [];
  const errors: ImportError[] = [];

  for (let i = 0; i < stageOne.length; i++) {
    const entry = stageOne[i];
    if (!entry.ok) {
      errors.push({ row: entry.row, error: entry.error });
      continue;
    }
    let centerId: string | null = null;
    if (entry.data.centerSlug) {
      const id = slugToId.get(entry.data.centerSlug);
      if (!id) {
        errors.push({
          row: i + 2,
          error: `Không tìm thấy cơ sở với slug "${entry.data.centerSlug}"`,
        });
        continue;
      }
      centerId = id;
    }
    if (!passesScope("Holiday", { centerId }, actor)) {
      errors.push({
        row: i + 2,
        error: entry.data.centerSlug
          ? `Cơ sở "${entry.data.centerSlug}" ngoài phạm vi quyền của bạn`
          : "Ngày nghỉ toàn hệ thống (không có centerSlug) cần quyền HO/SUPER_ADMIN",
      });
      continue;
    }
    const orgUnitId = centerId
      ? (centerIdToOrgUnitId.get(centerId) ?? null)
      : null;
    validRows.push({ data: entry.data, centerId, orgUnitId });
  }

  if (validRows.length === 0) {
    return NextResponse.json({ success: 0, errors });
  }

  // Stage 3: skip-existing (PostgreSQL NULL semantics make composite-unique
  // upserts on (date, name, centerId) awkward; explicit check is clearer).
  let success = 0;
  try {
    await sdb.$transaction(async (tx) => {
      for (let i = 0; i < validRows.length; i++) {
        const r = validRows[i];
        const existing = await tx.holiday.findFirst({
          where: {
            name: r.data.name,
            date: r.data.date,
            centerId: r.centerId,
          },
          select: { id: true },
        });
        if (existing) {
          const dateStr = r.data.date.toISOString().slice(0, 10);
          errors.push({
            row: i + 2,
            error: `Đã tồn tại: "${r.data.name}" ngày ${dateStr}`,
          });
          continue;
        }
        await tx.holiday.create({
          data: {
            name: r.data.name,
            date: r.data.date,
            endDate: r.data.endDate,
            centerId: r.centerId,
            orgUnitId: r.orgUnitId, // dual-write 2-phase
            type: r.data.type,
            note: r.data.note,
          },
        });
        success++;
      }
    });
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

  revalidatePath("/admin/holidays");

  return NextResponse.json({ success, errors });
}
