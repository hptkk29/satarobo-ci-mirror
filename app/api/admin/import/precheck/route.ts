import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import type { Action } from "@/lib/auth/permissions";

// POST /api/admin/import/precheck — báo GHI ĐÈ ở preview cho các màn import
// UPSERT theo mã: {kind, keys[]} → {matches: [{key, name}]} các mã ĐÃ CÓ.
// Chỉ là UX (dòng vẫn import được — upsert là chủ ý); mỗi kind gate đúng quyền
// của màn import tương ứng; query qua scopedDb (chỉ thấy trong phạm vi quyền,
// không bypass — cảnh báo theo đúng tầm nhìn của người nhập).
// Riêng LEADS có precheck RIÊNG (trùng = LỖI + bypass hẹp): import/leads/precheck.

type Match = { key: string; name: string };
type Sdb = ReturnType<typeof scopedDb>;
type KindDef = {
  permission: Action;
  run: (sdb: Sdb, keys: string[]) => Promise<Match[]>;
};

const KINDS: Record<string, KindDef> = {
  students: {
    permission: "students:import",
    run: async (sdb, keys) =>
      (
        await sdb.student.findMany({
          where: { studentCode: { in: keys }, deletedAt: null },
          select: { studentCode: true, name: true },
        })
      ).map((r) => ({ key: r.studentCode ?? "", name: r.name })),
  },
  employees: {
    permission: "employees:create",
    run: async (sdb, keys) =>
      (
        await sdb.employee.findMany({
          where: { employeeCode: { in: keys } },
          select: { employeeCode: true, fullName: true },
        })
      ).map((r) => ({ key: r.employeeCode ?? "", name: r.fullName })),
  },
  questions: {
    permission: "questions:author",
    run: async (sdb, keys) =>
      (
        await sdb.question.findMany({
          where: { questionCode: { in: keys } },
          select: { questionCode: true, text: true },
        })
      ).map((r) => ({
        key: r.questionCode ?? "",
        name: r.text.length > 50 ? `${r.text.slice(0, 50)}…` : r.text,
      })),
  },
  classes: {
    permission: "classes:create",
    run: async (sdb, keys) =>
      (
        await sdb.class.findMany({
          where: { classCode: { in: keys }, deletedAt: null },
          select: { classCode: true, name: true },
        })
      ).map((r) => ({ key: r.classCode ?? "", name: r.name })),
  },
  centers: {
    permission: "centers:edit",
    run: async (sdb, keys) =>
      (
        await sdb.center.findMany({
          where: { slug: { in: keys } },
          select: { slug: true, name: true },
        })
      ).map((r) => ({ key: r.slug, name: r.name })),
  },
  rooms: {
    permission: "rooms:edit",
    run: async (sdb, keys) =>
      (
        await sdb.room.findMany({
          where: { code: { in: keys } },
          select: { code: true, name: true, center: { select: { name: true } } },
        })
      ).map((r) => ({
        key: r.code ?? "",
        name: `${r.name}${r.center ? ` @ ${r.center.name}` : ""}`,
      })),
  },
  "inventory-items": {
    permission: "inventory:edit",
    run: async (sdb, keys) =>
      (
        await sdb.inventoryItem.findMany({
          where: { itemCode: { in: keys } },
          select: { itemCode: true, name: true },
        })
      ).map((r) => ({ key: r.itemCode, name: r.name })),
  },
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { kind, keys } = (body ?? {}) as { kind?: string; keys?: unknown[] };
  const def = kind ? KINDS[kind] : undefined;
  if (!def) return NextResponse.json({ error: "kind không hợp lệ" }, { status: 400 });
  if (!Array.isArray(keys)) return NextResponse.json({ matches: [] });
  if (keys.length > 5000) return NextResponse.json({ error: "Quá 5000 mã" }, { status: 400 });

  if (!(await checkPermission(def.permission))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clean = [...new Set(keys.map((k) => String(k ?? "").trim()).filter(Boolean))];
  if (clean.length === 0) return NextResponse.json({ matches: [] });

  const actor = await resolveActor(session.user.id);
  const matches = await def.run(scopedDb(actor), clean);
  return NextResponse.json({ matches: matches.filter((m) => m.key) });
}
