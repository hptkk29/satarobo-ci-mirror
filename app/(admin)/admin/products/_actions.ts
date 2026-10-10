"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { logProductAudit, getAuditActor } from "@/lib/audit/log";
import {
  productSchema,
  productMovementSchema,
} from "@/lib/validators/product";

// Product/ProductMovement là catalog + sổ kho SP toàn cục (không có centerId,
// không thuộc SCOPED_MODELS) — scopedDb pass-through (A0-04).
async function requireProductsManage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // products:manage chỉ HO_ACCOUNTANT (GLOBAL) — không cần target.
  if (!(await checkPermission("products:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return { session, sdb: scopedDb(await resolveActor(session.user.id)) };
}

// Fields tracked for the UPDATE audit diff. Excludes stockOnHand (changes
// only flow through adjustStockAction) and timestamps.
const TRACKED_UPDATE_FIELDS = [
  "sku",
  "name",
  "description",
  "category",
  "status",
  "salePrice",
  "costPrice",
  "rentalPricePerMonth",
  "minThreshold",
  "imageUrls",
  "zmroboKitId",
  "attributes",
  "notes",
] as const;

// ─── CREATE ─────────────────────────────────────────────────────────
export async function createProductAction(input: unknown) {
  const { session, sdb } = await requireProductsManage();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const data = parsed.data;

  const existing = await sdb.product.findUnique({
    where: { sku: data.sku },
    select: { id: true },
  });
  if (existing) {
    return { ok: false as const, error: `SKU "${data.sku}" đã tồn tại` };
  }

  if (data.zmroboKitId) {
    const kit = await sdb.zMRoboKit.findUnique({
      where: { id: data.zmroboKitId },
      select: { id: true },
    });
    if (!kit) return { ok: false as const, error: "ZMRoboKit không tồn tại" };
  }

  const { actorId, actorName } = getAuditActor(session);

  // A0-04: tx từ scopedDb — cast (tiền lệ); cấu trúc transaction giữ nguyên.
  const product = await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    const p = await tx.product.create({
      data: {
        sku: data.sku,
        name: data.name,
        description: data.description ?? null,
        category: data.category,
        status: data.status,
        salePrice: data.salePrice,
        costPrice: data.costPrice ?? null,
        rentalPricePerMonth: data.rentalPricePerMonth ?? null,
        stockOnHand: data.stockOnHand,
        minThreshold: data.minThreshold,
        imageUrls: data.imageUrls,
        zmroboKitId: data.zmroboKitId ?? null,
        attributes: (data.attributes as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        notes: data.notes ?? null,
      },
    });

    await logProductAudit({
      productId: p.id,
      action: "CREATE",
      actorId,
      actorName,
      newValues: {
        sku: p.sku,
        name: p.name,
        category: p.category,
        salePrice: p.salePrice,
        stockOnHand: p.stockOnHand,
      },
      tx,
    });

    // Initial stock = create a PURCHASE movement record for audit trail.
    if (data.stockOnHand > 0) {
      await tx.productMovement.create({
        data: {
          productId: p.id,
          type: "PURCHASE",
          quantity: data.stockOnHand,
          reason: "Khởi tạo tồn kho ban đầu",
          stockBeforeMovement: 0,
          stockAfterMovement: data.stockOnHand,
          createdByUserId: actorId,
          createdByName: actorName,
        },
      });
    }

    return p;
  });

  revalidatePath("/products");
  return { ok: true as const, productId: product.id };
}

// ─── UPDATE ─────────────────────────────────────────────────────────
export async function updateProductAction(productId: string, input: unknown) {
  const { session, sdb } = await requireProductsManage();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const data = parsed.data;

  const existing = await sdb.product.findUnique({ where: { id: productId } });
  if (!existing) {
    return { ok: false as const, error: "Không tìm thấy sản phẩm" };
  }

  if (data.sku !== existing.sku) {
    const dup = await sdb.product.findUnique({
      where: { sku: data.sku },
      select: { id: true },
    });
    if (dup) {
      return { ok: false as const, error: `SKU "${data.sku}" đã tồn tại` };
    }
  }

  if (data.stockOnHand !== existing.stockOnHand) {
    return {
      ok: false as const,
      error:
        "Không thể sửa tồn kho trực tiếp — dùng chức năng 'Điều chỉnh tồn kho'",
    };
  }

  const { actorId, actorName } = getAuditActor(session);

  // Compute diff (stable JSON comparison).
  const changedFields: string[] = [];
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const f of TRACKED_UPDATE_FIELDS) {
    const oldVal = existing[f] as unknown;
    const newVal = (data[f] as unknown) ?? null;
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changedFields.push(f);
      oldValues[f] = oldVal;
      newValues[f] = newVal;
    }
  }

  if (changedFields.length === 0) {
    return { ok: true as const, productId, noChanges: true };
  }

  const isStatusChange =
    changedFields.length === 1 && changedFields[0] === "status";

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.product.update({
      where: { id: productId },
      data: {
        sku: data.sku,
        name: data.name,
        description: data.description ?? null,
        category: data.category,
        status: data.status,
        salePrice: data.salePrice,
        costPrice: data.costPrice ?? null,
        rentalPricePerMonth: data.rentalPricePerMonth ?? null,
        minThreshold: data.minThreshold,
        imageUrls: data.imageUrls,
        zmroboKitId: data.zmroboKitId ?? null,
        attributes:
          (data.attributes as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        notes: data.notes ?? null,
      },
    });

    await logProductAudit({
      productId,
      action: isStatusChange ? "STATUS_CHANGE" : "UPDATE",
      actorId,
      actorName,
      oldValues,
      newValues,
      changedFields,
      tx,
    });
  });

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  revalidatePath(`/products/${productId}/edit`);
  return { ok: true as const, productId };
}

// ─── DELETE (hard delete blocked if product has movement history) ────
export async function deleteProductAction(productId: string) {
  const { session, sdb } = await requireProductsManage();

  const movementCount = await sdb.productMovement.count({
    where: { productId },
  });
  if (movementCount > 0) {
    return {
      ok: false as const,
      error:
        "Sản phẩm đã có lịch sử nhập/xuất kho. Đặt status DISCONTINUED thay vì xoá.",
    };
  }

  const product = await sdb.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, name: true },
  });
  if (!product) {
    return { ok: false as const, error: "Không tìm thấy sản phẩm" };
  }

  const { actorId, actorName } = getAuditActor(session);

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await logProductAudit({
      productId,
      action: "DELETE",
      actorId,
      actorName,
      oldValues: { sku: product.sku, name: product.name },
      reason: "Hard delete (chưa có lịch sử kho)",
      tx,
    });
    await tx.product.delete({ where: { id: productId } });
  });

  revalidatePath("/products");
  return { ok: true as const };
}

// ─── ADJUST STOCK (manual movement) ──────────────────────────────────
export async function adjustStockAction(input: unknown) {
  const { session, sdb } = await requireProductsManage();
  const parsed = productMovementSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const data = parsed.data;

  const product = await sdb.product.findUnique({
    where: { id: data.productId },
    select: { id: true, stockOnHand: true },
  });
  if (!product) {
    return { ok: false as const, error: "Không tìm thấy sản phẩm" };
  }

  const newStock = product.stockOnHand + data.quantity;
  if (newStock < 0) {
    return {
      ok: false as const,
      error: `Tồn kho không thể âm (hiện tại ${product.stockOnHand}, thay đổi ${data.quantity})`,
    };
  }

  const { actorId, actorName } = getAuditActor(session);

  // Giữ NGUYÊN cấu trúc transaction (update tồn + movement atomic) — chỉ đổi nguồn client.
  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.product.update({
      where: { id: data.productId },
      data: { stockOnHand: newStock },
    });
    await tx.productMovement.create({
      data: {
        productId: data.productId,
        type: data.type,
        quantity: data.quantity,
        reason: data.reason ?? null,
        orderId: data.orderId ?? null,
        stockBeforeMovement: product.stockOnHand,
        stockAfterMovement: newStock,
        createdByUserId: actorId,
        createdByName: actorName,
      },
    });
  });

  revalidatePath("/products");
  revalidatePath(`/products/${data.productId}`);
  return { ok: true as const, newStock };
}
