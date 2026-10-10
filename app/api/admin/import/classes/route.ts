import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ClassStatusEnum } from "@/lib/validators/class";
import { checkPermission } from "@/lib/auth/check-permission";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { syncConversationMembership } from "@/lib/chat/sync-membership";
import { phaseFromFlatSchedule } from "@/lib/classes/phases";
import { persistPhases } from "@/lib/classes/phases-service";

// Excel date parser — reused from D2 / B3.
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
    if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (dmy) return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    const d = new Date(t);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return null;
}

// "T2, T5" or "1, 4" → [1, 4]. Vietnamese: CN=0, T2=1, ..., T7=6.
function parseScheduleDays(v: unknown): number[] {
  if (v === null || v === undefined || v === "") return [];
  if (typeof v === "number") {
    return Number.isFinite(v) && v >= 0 && v <= 6 ? [v] : [];
  }
  if (typeof v !== "string") return [];

  const dayMap: Record<string, number> = {
    CN: 0,
    T2: 1,
    T3: 2,
    T4: 3,
    T5: 4,
    T6: 5,
    T7: 6,
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
  };

  const out: number[] = [];
  for (const part of v.split(",")) {
    const s = part.trim().toUpperCase();
    if (!s) continue;
    if (dayMap[s] !== undefined) {
      out.push(dayMap[s]);
      continue;
    }
    const n = parseInt(s, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 6) out.push(n);
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

const requiredString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().min(1, "Trường bắt buộc"));

const optionalString = z
  .union([z.string(), z.null(), z.number()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  });

const timeField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined) return null;
    const s = v.trim();
    if (!s) return null;
    if (!/^\d{2}:\d{2}$/.test(s)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Giờ phải định dạng HH:mm (pad số 0 nếu cần)",
      });
      return z.NEVER;
    }
    return s;
  });

const intWithDefault = (def: number) =>
  z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === null || v === undefined || v === "") return def;
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      return Number.isFinite(n) && n >= 1 ? n : def;
    });

const ClassImportSchema = z.object({
  classCode: optionalString,
  name: requiredString,

  courseSlug: requiredString,
  centerSlug: requiredString,
  roomCode: optionalString,
  teacherCode: optionalString,
  assistantCode: optionalString,

  startDate: z.unknown().optional().transform((v) => parseExcelDate(v)),
  endDate: z.unknown().optional().transform((v) => parseExcelDate(v)),
  scheduleDays: z.unknown().optional().transform((v) => parseScheduleDays(v)),
  startTime: timeField,
  endTime: timeField,

  minStudents: intWithDefault(5),
  maxStudents: intWithDefault(20),

  status: z
    .union([ClassStatusEnum, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === null || v === undefined ? "PLANNED" : v))
    .pipe(ClassStatusEnum),

  description: optionalString,
  notes: optionalString,
});

type ImportError = { row: number; error: string };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await checkPermission("classes:create"))) {
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

  // Stage 1: Zod parse each row
  type Parsed = z.infer<typeof ClassImportSchema>;
  const stageOne: (
    | { ok: true; data: Parsed }
    | { ok: false; row: number; error: string }
  )[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = ClassImportSchema.safeParse(rows[i]);
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

  // Stage 2a: Collect unique reference keys
  const courseSlugs = new Set<string>();
  const centerSlugs = new Set<string>();
  const employeeCodes = new Set<string>();
  for (const r of stageOne) {
    if (!r.ok) continue;
    courseSlugs.add(r.data.courseSlug);
    centerSlugs.add(r.data.centerSlug);
    if (r.data.teacherCode) employeeCodes.add(r.data.teacherCode);
    if (r.data.assistantCode) employeeCodes.add(r.data.assistantCode);
  }

  // Cách ly cơ sở: Class/Room/Employee ∈ SCOPED_MODELS → lookup GV/phòng tự giới
  // hạn theo tầm nhìn actor; write theo centerId form → guard passesScope per-row
  // (CM chỉ import lớp vào cơ sở mình; SUPER_ADMIN/HO bypass). Course/Center exempt.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // Stage 2b: bulk lookup (Phase 1 — independent unique-key references)
  const [courses, centers, employees] = await Promise.all([
    courseSlugs.size
      ? sdb.course.findMany({
          where: { slug: { in: [...courseSlugs] } },
          select: { id: true, slug: true },
        })
      : Promise.resolve([] as { id: string; slug: string }[]),
    centerSlugs.size
      ? sdb.center.findMany({
          where: { slug: { in: [...centerSlugs] } },
          select: { id: true, slug: true },
        })
      : Promise.resolve([] as { id: string; slug: string }[]),
    employeeCodes.size
      ? sdb.employee.findMany({
          where: {
            employeeCode: { in: [...employeeCodes] },
            status: "ACTIVE",
            userAccount: {
              isActive: true,
              deletedAt: null,
              // Đa vai trò (3B): TEACHER/CENTER_MANAGER ở bất kỳ vị trí nào.
              roles: { hasSome: ["TEACHER", "CENTER_MANAGER"] },
            },
          },
          select: {
            employeeCode: true,
            userAccount: { select: { id: true } },
          },
        })
      : Promise.resolve(
          [] as { employeeCode: string; userAccount: { id: string } | null }[],
        ),
  ]);

  const courseMap = new Map(courses.map((c) => [c.slug, c.id]));
  const centerMap = new Map(centers.map((c) => [c.slug, c.id]));
  // Dual-write 2-phase: dựng map centerId → orgUnitId 1 lần (số cơ sở nhỏ).
  const centerIdToOrgUnitId = new Map<string, string | null>();
  for (const c of centers) {
    centerIdToOrgUnitId.set(c.id, await orgUnitIdForCenter(c.id));
  }
  // employeeCode → linked User.id (since Class.teacherId FK → User)
  const teacherUserMap = new Map<string, string>();
  for (const e of employees) {
    if (e.userAccount?.id) teacherUserMap.set(e.employeeCode, e.userAccount.id);
  }

  // Stage 2c: Phase 2 — composite (centerId + roomCode) → roomId
  const roomCenterIds = new Set<string>();
  const roomCodes = new Set<string>();
  for (const r of stageOne) {
    if (!r.ok || !r.data.roomCode) continue;
    const cid = centerMap.get(r.data.centerSlug);
    if (!cid) continue;
    roomCenterIds.add(cid);
    roomCodes.add(r.data.roomCode);
  }

  const rooms =
    roomCenterIds.size && roomCodes.size
      ? await sdb.room.findMany({
          where: {
            centerId: { in: [...roomCenterIds] },
            code: { in: [...roomCodes] },
          },
          select: { id: true, centerId: true, code: true },
        })
      : [];
  const roomMap = new Map<string, string>(); // `${centerId}:${code}` → id
  for (const r of rooms) roomMap.set(`${r.centerId}:${r.code}`, r.id);

  // Stage 3: resolve every row + cross-field checks
  const errors: ImportError[] = [];
  const validRows: {
    data: Parsed;
    courseId: string;
    centerId: string;
    orgUnitId: string | null;
    roomId: string | null;
    teacherId: string | null;
    assistantId: string | null;
  }[] = [];

  for (let i = 0; i < stageOne.length; i++) {
    const entry = stageOne[i];
    if (!entry.ok) {
      errors.push({ row: entry.row, error: entry.error });
      continue;
    }
    const d = entry.data;
    const rowNo = i + 2;

    const courseId = courseMap.get(d.courseSlug);
    if (!courseId) {
      errors.push({
        row: rowNo,
        error: `Không tìm thấy khoá học slug "${d.courseSlug}"`,
      });
      continue;
    }

    const centerId = centerMap.get(d.centerSlug);
    if (!centerId) {
      errors.push({
        row: rowNo,
        error: `Không tìm thấy cơ sở slug "${d.centerSlug}"`,
      });
      continue;
    }
    if (!passesScope("Class", { centerId }, actor)) {
      errors.push({
        row: rowNo,
        error: `Cơ sở "${d.centerSlug}" ngoài phạm vi quyền của bạn`,
      });
      continue;
    }

    let roomId: string | null = null;
    if (d.roomCode) {
      const rid = roomMap.get(`${centerId}:${d.roomCode}`);
      if (!rid) {
        errors.push({
          row: rowNo,
          error: `Không tìm thấy phòng "${d.roomCode}" trong cơ sở "${d.centerSlug}"`,
        });
        continue;
      }
      roomId = rid;
    }

    let teacherId: string | null = null;
    if (d.teacherCode) {
      const tid = teacherUserMap.get(d.teacherCode);
      if (!tid) {
        errors.push({
          row: rowNo,
          error: `Không tìm thấy GV "${d.teacherCode}" (cần Employee role TEACHER/CENTER_MANAGER + có User account)`,
        });
        continue;
      }
      teacherId = tid;
    }

    let assistantId: string | null = null;
    if (d.assistantCode) {
      const aid = teacherUserMap.get(d.assistantCode);
      if (!aid) {
        errors.push({
          row: rowNo,
          error: `Không tìm thấy GV phụ "${d.assistantCode}"`,
        });
        continue;
      }
      if (aid === teacherId) {
        errors.push({
          row: rowNo,
          error: "GV phụ không được trùng GV chính",
        });
        continue;
      }
      assistantId = aid;
    }

    if (d.endDate && d.startDate && d.endDate < d.startDate) {
      errors.push({ row: rowNo, error: "endDate phải >= startDate" });
      continue;
    }
    if (d.minStudents > d.maxStudents) {
      errors.push({ row: rowNo, error: "minStudents phải <= maxStudents" });
      continue;
    }

    const orgUnitId = centerIdToOrgUnitId.get(centerId) ?? null;
    validRows.push({ data: d, courseId, centerId, orgUnitId, roomId, teacherId, assistantId });
  }

  if (validRows.length === 0) {
    return NextResponse.json({ success: 0, errors });
  }

  // Stage 4: upsert by classCode in a single transaction.
  let success = 0;
  const now = new Date();
  try {
    await sdb.$transaction(async (tx) => {
      // US-03 chat — gom classId đã tạo/sửa rồi sync MỘT LẦN cho mỗi lớp DUY NHẤT sau
      // vòng lặp (sync idempotent nên gọi sau cũng cho kết quả y hệt). Gọi per-row nhân
      // bội truy vấn theo số dòng file (tối đa 5000) — file có nhiều dòng cùng classCode
      // còn sync lặp lại đúng lớp đó — dễ vượt timeout 30s và rollback CẢ file.
      const touchedClassIds = new Set<string>();
      for (let i = 0; i < validRows.length; i++) {
        const r = validRows[i];
        const base = {
          name: r.data.name,
          description: r.data.description,
          courseId: r.courseId,
          centerId: r.centerId,
          orgUnitId: r.orgUnitId, // dual-write 2-phase
          roomId: r.roomId,
          teacherId: r.teacherId,
          assistantId: r.assistantId,
          startDate: r.data.startDate,
          endDate: r.data.endDate,
          scheduleDays: r.data.scheduleDays ?? [],
          startTime: r.data.startTime,
          endTime: r.data.endTime,
          minStudents: r.data.minStudents,
          maxStudents: r.data.maxStudents,
          status: r.data.status,
          notes: r.data.notes,
        };
        try {
          const saved = r.data.classCode
            ? await tx.class.upsert({
                where: { classCode: r.data.classCode },
                create: { ...base, classCode: r.data.classCode },
                update: base,
                select: { id: true },
              })
            : await tx.class.create({ data: base, select: { id: true } });

          // 08/08 — lớp nhập file cũng phải CÓ Kế hoạch lịch học, y như lớp tạo tay: kế
          // hoạch mới là nguồn sự thật của lịch. Không ghi thì lớp nhập file vô hình với
          // cron đồng bộ bản sao (`resyncLegacyScheduleForAllClasses` chỉ quét lớp có kế
          // hoạch) và với khối sửa lịch — mỗi đường nhập ra một loại lớp khác nhau.
          // File chỉ tả được MỘT nhịp học ⇒ đúng 1 giai đoạn mở từ ngày khai giảng; admin
          // thêm giai đoạn sau ở màn lớp. Thiếu thứ/giờ → bỏ qua, lớp chạy lịch phẳng cũ.
          const phase = phaseFromFlatSchedule({
            scheduleDays: base.scheduleDays,
            startTime: base.startTime ?? null,
            endTime: base.endTime ?? null,
            startDate: base.startDate ?? null,
          });
          if (phase) {
            await persistPhases(tx as unknown as Prisma.TransactionClient, saved.id, [phase], now);
          }
          // US-03 chat — import có thể tạo lớp ACTIVE / đổi GV → nhóm lớp phải đồng bộ
          // trong cùng transaction (trạng thái khác ACTIVE → sync tự no-op). Chỉ GOM
          // ở đây; sync chạy 1 lần/lớp sau vòng lặp.
          touchedClassIds.add(saved.id);
          success++;
        } catch (err) {
          throw new Error(
            `Row ${i + 2}${
              r.data.classCode ? ` (code=${r.data.classCode})` : ""
            }: ${err instanceof Error ? err.message : "Unknown"}`,
            { cause: err },
          );
        }
      }
      // Sync 1 lần cho mỗi lớp DUY NHẤT, vẫn trong transaction của import.
      // Cast: client extension không structurally-assignable vào TransactionClient
      // (tiền lệ students/classes _actions) — runtime không đổi.
      for (const classId of touchedClassIds) {
        await syncConversationMembership(
          tx as unknown as Prisma.TransactionClient,
          classId,
        );
      }
    }, { timeout: 30_000, maxWait: 10_000 });
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

  revalidatePath("/admin/classes");
  return NextResponse.json({ success, errors });
}
