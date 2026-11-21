"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import {
  detectDocumentType,
  documentSchema,
  type DocumentInput,
} from "@/lib/validators/document";

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// Nhóm 01 L1 — Document/Lesson = học liệu toàn cục (không center-scope),
// scopedDb pass-through; dùng để sạch whitelist db trần.
async function requireRole(): Promise<
  | { ok: true; userId: string; sdb: ReturnType<typeof scopedDb> }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("documents:upload"))) {
    return { ok: false, error: "Không có quyền quản lý tài liệu" };
  }
  const actor = await resolveActor(session.user.id);
  return { ok: true, userId: session.user.id ?? "", sdb: scopedDb(actor) };
}

async function resolveEmployeeId(
  sdb: ReturnType<typeof scopedDb>,
  userId: string,
): Promise<string | null> {
  if (!userId) return null;
  try {
    const u = await sdb.user.findUnique({
      where: { id: userId },
      select: { employeeId: true },
    });
    return u?.employeeId ?? null;
  } catch {
    return null;
  }
}

export async function createDocument(
  input: DocumentInput,
): Promise<Result<{ documentId: string }>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  if (data.documentCode) {
    const dup = await gate.sdb.document.findUnique({
      where: { documentCode: data.documentCode },
      select: { id: true },
    });
    if (dup) return { ok: false, error: `Mã tài liệu "${data.documentCode}" đã tồn tại` };
  }

  const uploadedById = await resolveEmployeeId(gate.sdb, gate.userId);

  try {
    const doc = await gate.sdb.document.create({
      data: {
        ...data,
        type: detectDocumentType(data.mimeType),
        uploadedById,
      },
      select: { id: true },
    });
    revalidatePath("/documents");
    return { ok: true, data: { documentId: doc.id } };
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}

export async function createDocumentAndRedirect(input: DocumentInput) {
  const res = await createDocument(input);
  if (!res.ok) return res;
  redirect(`/documents/${res.data!.documentId}/edit`);
}

export async function updateDocument(
  id: string,
  input: DocumentInput,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const current = await gate.sdb.document.findUnique({
    where: { id },
    select: { documentCode: true },
  });
  if (!current) return { ok: false, error: "Tài liệu không tồn tại" };

  if (data.documentCode && data.documentCode !== current.documentCode) {
    const dup = await gate.sdb.document.findUnique({
      where: { documentCode: data.documentCode },
      select: { id: true },
    });
    if (dup && dup.id !== id) {
      return { ok: false, error: `Mã tài liệu "${data.documentCode}" đã tồn tại` };
    }
  }

  try {
    await gate.sdb.document.update({
      where: { id },
      data: { ...data, type: detectDocumentType(data.mimeType) },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath("/documents");
  revalidatePath(`/documents/${id}/edit`);
  return { ok: true };
}

// NOTE: Chỉ xoá DB record; file trên R2 vẫn còn (cleanup job riêng sẽ
// quét orphan files theo lịch — tránh xoá nhầm khi user revert).
export async function deleteDocument(id: string): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  try {
    await gate.sdb.document.delete({ where: { id } });
  } catch (err) {
    return {
      ok: false,
      error: `Không xoá được: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/documents");
  return { ok: true };
}

export async function deleteDocumentAndRedirect(id: string): Promise<Result> {
  const res = await deleteDocument(id);
  if (!res.ok) return res;
  redirect("/documents");
}
