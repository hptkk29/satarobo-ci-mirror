import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { InventoryCategoryEnum } from "@/lib/validators/inventory";
import { checkPermission } from "@/lib/auth/check-permission";
import { orgUnitIdForCenter } from "@/lib/org/org-service";

function parseBoolean(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toUpperCase();
    return s === "TRUE" || s === "1" || s === "YES" || s === "Y" || s === "ĐÚNG";
  }
  return false;
}

const optionalString = z
  .union([z.string(), z.null(), z.number()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  });

const requiredString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().min(1, "Trường bắt buộc"));

const tagsFromCsv = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (!v) return [];
    return Array.from(
      new Set(
        v
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    );
  });

const nullablePrice = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) && n >= 0 ? n : null;
  });

const thresholdField = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return 5;
    const n = typeof v === "number" ? v : parseInt(String(v), 10);
    return Number.isFinite(n) && n >= 0 ? n : 5;
  });

const RowSchema = z.object({
  itemCode: requiredString,
  name: requiredString,
  description: optionalString,
  category: z
    .union([InventoryCategoryEnum, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === null || v === undefined ? "OTHER" : v))
    .pipe(InventoryCategoryEnum),
  unit: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v ? v.trim() || "Cái" : "Cái")),
  pricePerUnit: nullablePrice,
  supplier: optionalString,
  defaultMinThreshold: thresholdField,
  tags: tagsFromCsv,
  isActive: z
    .unknown()
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === "") return true;
      return parseBoolean(v);
    }),
  notes: optionalString,
});

type ImportError = { row: number; error: string };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await checkPermission("inventory:edit"))) {
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

  type Parsed = z.infer<typeof RowSchema>;
  const errors: ImportError[] = [];
  const validRows: Parsed[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = RowSchema.safeParse(rows[i]);
    if (!r.success) {
      errors.push({
        row: i + 2,
        error: r.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
      });
      continue;
    }
    validRows.push(r.data);
  }

  if (validRows.length === 0) {
    return NextResponse.json({ success: 0, errors });
  }

  // A0-04: import là thao tác catalog (InventoryItem không có centerId — upsert theo
  // itemCode toàn cục). StockBalance chỉ được SEED = 0 cho MỌI cơ sở active với
  // skipDuplicates (giống createItem) — không nhận centerId từ form, không đổi
  // quantity đang có → không có vector IDOR ghi chéo cơ sở. Center ∈ SCOPE_EXEMPT.
  const sdb = scopedDb(await resolveActor(session.user.id));

  // Load active centers once — used to seed balances on newly-created items.
  const centers = await sdb.center.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  // Dual-write 2-phase: gắn orgUnitId song song centerId cho từng StockBalance.
  // (InventoryItem là catalog — không có centerId/orgUnitId, không đổi.)
  const centersWithOrg = await Promise.all(
    centers.map(async (c) => ({
      id: c.id,
      orgUnitId: await orgUnitIdForCenter(c.id),
    })),
  );

  let success = 0;
  try {
    await sdb.$transaction(async (tx) => {
      for (let i = 0; i < validRows.length; i++) {
        const r = validRows[i];
        const baseData = {
          name: r.name,
          description: r.description,
          category: r.category,
          unit: r.unit,
          pricePerUnit: r.pricePerUnit,
          supplier: r.supplier,
          defaultMinThreshold: r.defaultMinThreshold,
          tags: r.tags,
          isActive: r.isActive,
          notes: r.notes,
        };
        try {
          const item = await tx.inventoryItem.upsert({
            where: { itemCode: r.itemCode },
            create: { ...baseData, itemCode: r.itemCode },
            update: baseData,
            select: { id: true },
          });

          if (centers.length > 0) {
            // skipDuplicates protects existing balances (quantity stays put
            // when re-importing item metadata).
            await tx.stockBalance.createMany({
              data: centersWithOrg.map((c) => ({
                itemId: item.id,
                centerId: c.id,
                orgUnitId: c.orgUnitId, // dual-write 2-phase
                quantity: 0,
                reserved: 0,
              })),
              skipDuplicates: true,
            });
          }
          success++;
        } catch (err) {
          throw new Error(
            `Row ${i + 2} (code=${r.itemCode}): ${
              err instanceof Error ? err.message : "Unknown"
            }`,
            { cause: err },
          );
        }
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

  revalidatePath("/admin/inventory/items");
  return NextResponse.json({ success, errors });
}
