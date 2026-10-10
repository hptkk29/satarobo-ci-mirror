import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  StudentStatusEnum,
  BloodTypeEnum,
  GenderEnum,
} from "@/lib/validators/student";
import { checkPermission } from "@/lib/auth/check-permission";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { syncStudentNameToCrm } from "@/lib/students/sync-name";
import { dongBoTuHocVien } from "@/lib/students/dong-bo-lead-db";
import { CHON_CON_HOC_VIEN, CHON_PH_HOC_VIEN } from "@/lib/students/dong-bo-lead";
import { removeStudentFromClasses } from "@/lib/students/remove-from-classes";

// Excel date parser — reused pattern from B3 / C2.
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

const optionalString = z
  .union([z.string(), z.null(), z.number()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  });

const optionalEmail = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const s = v.trim();
    if (!s) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Email PH không hợp lệ",
      });
      return z.NEVER;
    }
    return s;
  });

const arrayFromCsv = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (!v) return [];
    return v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  });

const requiredString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().min(1, "Trường bắt buộc"));

const gradeField = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseInt(String(v), 10);
    if (!Number.isFinite(n) || n < 1 || n > 12) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Lớp phải từ 1 đến 12",
      });
      return z.NEVER;
    }
    return n;
  });

const StudentImportSchema = z.object({
  studentCode: optionalString,
  fullName: requiredString, // DB field is `name`
  dateOfBirth: z.unknown().optional().transform((v) => parseExcelDate(v)),
  gender: z
    .union([GenderEnum, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === null || v === undefined ? null : v)),
  currentGrade: gradeField,
  school: optionalString,

  parentName: requiredString,
  parentPhone: requiredString,
  parentEmail: optionalEmail,
  parentRelation: optionalString,
  parent2Name: optionalString,
  parent2Phone: optionalString,
  parent2Relation: optionalString,

  address: optionalString,
  ward: optionalString,
  district: optionalString,
  city: optionalString,

  centerSlug: optionalString,
  enrollmentDate: z.unknown().optional().transform((v) => parseExcelDate(v)),
  status: z
    .union([StudentStatusEnum, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === null || v === undefined ? "ACTIVE" : v))
    .pipe(StudentStatusEnum),

  bloodType: z
    .union([BloodTypeEnum, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === null || v === undefined ? null : v)),
  allergies: arrayFromCsv,
  healthNotes: optionalString,
  notes: optionalString,
});

type ImportError = { row: number; error: string };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await checkPermission("students:import"))) {
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

  // Stage 1: schema parse each row
  type Parsed = z.infer<typeof StudentImportSchema>;
  const stageOne: (
    | { ok: true; data: Parsed }
    | { ok: false; row: number; error: string }
  )[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = StudentImportSchema.safeParse(rows[i]);
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

  // Cách ly cơ sở: Student ∈ SCOPED_MODELS. Write theo centerSlug form (preferred
  // center) → guard passesScope per-row: CM chỉ import học viên cho cơ sở mình;
  // row không có centerSlug (toàn hệ thống) cần quyền HO/SUPER_ADMIN. Center exempt.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // Stage 2: resolve centerSlug → preferredCenterId
  const slugs = [
    ...new Set(
      stageOne.flatMap((r) => (r.ok && r.data.centerSlug ? [r.data.centerSlug] : [])),
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

  const errors: ImportError[] = [];
  const validRows: {
    data: Parsed;
    preferredCenterId: string | null;
    preferredOrgUnitId: string | null;
  }[] = [];

  for (let i = 0; i < stageOne.length; i++) {
    const entry = stageOne[i];
    if (!entry.ok) {
      errors.push({ row: entry.row, error: entry.error });
      continue;
    }

    let preferredCenterId: string | null = null;
    if (entry.data.centerSlug) {
      const id = slugToId.get(entry.data.centerSlug);
      if (!id) {
        errors.push({
          row: i + 2,
          error: `Không tìm thấy cơ sở với slug "${entry.data.centerSlug}"`,
        });
        continue;
      }
      preferredCenterId = id;
    }

    if (!passesScope("Student", { centerId: preferredCenterId }, actor)) {
      errors.push({
        row: i + 2,
        error: entry.data.centerSlug
          ? `Cơ sở "${entry.data.centerSlug}" ngoài phạm vi quyền của bạn`
          : "Học viên không gắn cơ sở cần quyền HO/SUPER_ADMIN",
      });
      continue;
    }

    const preferredOrgUnitId = preferredCenterId
      ? (centerIdToOrgUnitId.get(preferredCenterId) ?? null)
      : null;

    validRows.push({ data: entry.data, preferredCenterId, preferredOrgUnitId });
  }

  if (validRows.length === 0) {
    return NextResponse.json({ success: 0, errors });
  }

  // Stage 3: upsert by studentCode in a transaction. Empty code → create only.
  let success = 0;
  let renamedAny = false;
  try {
    await sdb.$transaction(async (tx) => {
      for (let i = 0; i < validRows.length; i++) {
        const r = validRows[i];
        // Map Excel fullName → DB name (schema didn't rename in D1).
        const base = {
          name: r.data.fullName,
          dateOfBirth: r.data.dateOfBirth,
          gender: r.data.gender,
          currentGrade: r.data.currentGrade,
          school: r.data.school,
          parentName: r.data.parentName,
          parentPhone: r.data.parentPhone,
          parentEmail: r.data.parentEmail,
          parentRelation: r.data.parentRelation,
          parent2Name: r.data.parent2Name,
          parent2Phone: r.data.parent2Phone,
          parent2Relation: r.data.parent2Relation,
          address: r.data.address,
          ward: r.data.ward,
          district: r.data.district,
          city: r.data.city,
          // ⚠️ VÁ 04/09/2026 — phải set CẢ `centerId`, không chỉ `preferredCenterId`.
          //
          // `Student` ∈ `SCOPED_MODELS` và `scopedDb` lọc theo `centerId`. Bản cũ
          // chỉ ghi `preferredCenterId` ⇒ học viên nhập bằng Excel có
          // `centerId = NULL` và bị cách ly cơ sở GIẤU khỏi mọi vai cấp cơ sở —
          // kể cả chính người vừa bấm nút import. Họ thấy "nhập thành công N dòng"
          // rồi mở danh sách ra trống trơn.
          //
          // Đây là mặt ngược của lỗi ở `/admin/students`: màn đó LỌC theo
          // `preferredCenterId` trong khi luồng chốt lead chỉ ghi `centerId`. Hai
          // đường ghi mỗi bên điền một nửa, nên nửa nào cũng có ca hỏng.
          centerId: r.preferredCenterId,
          orgUnitId: r.preferredOrgUnitId,
          preferredCenterId: r.preferredCenterId,
          preferredOrgUnitId: r.preferredOrgUnitId, // dual-write 2-phase
          enrollmentDate: r.data.enrollmentDate,
          status: r.data.status,
          bloodType: r.data.bloodType,
          allergies: r.data.allergies ?? [],
          healthNotes: r.data.healthNotes,
          notes: r.data.notes,
        };
        try {
          if (r.data.studentCode) {
            // 08/08 — upsert theo mã có thể ĐỔI TÊN học viên đang có → phải dội sang
            // CRM (LeadChild/Lead.childName/ParentFeedback) như màn sửa học viên, nếu
            // không import Excel lại tái tạo đúng bug "lead hiện tên cũ" vừa vá.
            const prev = await tx.student.findUnique({
              where: { studentCode: r.data.studentCode },
              select: {
                id: true,
                name: true,
                status: true,
                centerId: true,
                leadId: true,
                leadChildId: true,
                ...CHON_PH_HOC_VIEN,
                ...CHON_CON_HOC_VIEN,
              },
            });
            const sau = await tx.student.upsert({
              where: { studentCode: r.data.studentCode },
              create: { ...base, studentCode: r.data.studentCode },
              update: base,
              select: { leadId: true, leadChildId: true, ...CHON_PH_HOC_VIEN, ...CHON_CON_HOC_VIEN },
            });
            // 26/09/2026 — dòng Excel sửa hồ sơ đang có ⇒ dội sang phiếu lead nguồn + anh chị
            // em, như màn sửa học viên ("đổi 1 nơi thì đổi hết"). Giới hạn đã biết: import
            // chạy trong `scopedDb` nên phiếu/anh chị em ở cơ sở NGOÀI tầm nhìn người import
            // không đổi theo (màn sửa HV chạy client không scope — `lib/students/ghi-ho-so.ts`).
            if (prev) {
              await dongBoTuHocVien({
                tx: tx as unknown as Prisma.TransactionClient,
                studentId: prev.id,
                leadId: sau.leadId,
                leadChildId: sau.leadChildId,
                truoc: prev,
                sau,
                actor: { id: session.user.id ?? null, name: session.user.name ?? "Import Excel" },
              });
            }
            // 21/08 — cột "Trạng thái" của file Excel đặt được INACTIVE. Trước đây import
            // chỉ ghi `Student.status` mà không đụng `Enrollment` ⇒ học viên hiện "Nghỉ
            // học" ở /students nhưng VẪN nằm trong lớp ở mọi màn roster (roster đọc từ
            // Enrollment, không đọc Student.status). Cùng một lỗ với ô Trạng thái trên form
            // sửa học viên. Form thì CHẶN và chỉ sang nút "Nghỉ học hẳn"; import là nhập
            // liệu hàng loạt nên chặn cả file là tệ hơn — ở đây gỡ lớp luôn cho khớp.
            // KHÔNG tạo yêu cầu hoàn tiền: đó là việc của luồng nghỉ học có lý do
            // (`withdrawStudentAction`), không phải của một dòng Excel.
            if (prev && prev.status !== "INACTIVE" && base.status === "INACTIVE") {
              await removeStudentFromClasses({
                tx: tx as unknown as Prisma.TransactionClient,
                studentId: prev.id,
                actorId: session.user.id ?? null,
                actorName: session.user.name ?? "Import Excel",
                reason: "Import Excel đặt trạng thái Nghỉ học",
                orgUnitId: prev.centerId,
              });
            }
            if (prev && prev.name !== base.name) {
              renamedAny = true;
              await syncStudentNameToCrm({
                // Cùng cast như mọi chỗ khác: client mở rộng của scopedDb ≠ type
                // TransactionClient thuần, nhưng là cùng một connection/tx.
                tx: tx as unknown as Prisma.TransactionClient,
                studentId: prev.id,
                oldName: prev.name,
                newName: base.name,
                parentPhone: base.parentPhone ?? prev.parentPhone,
                leadChildId: prev.leadChildId,
                actor: {
                  id: session.user.id,
                  name: session.user.name ?? "Import Excel",
                },
              });
            }
          } else {
            await tx.student.create({ data: base });
          }
          success++;
        } catch (err) {
          throw new Error(
            `Row ${i + 2}${r.data.studentCode ? ` (code=${r.data.studentCode})` : ""}: ${
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

  revalidatePath("/admin/students");
  if (renamedAny) {
    // Import đổi tên HV đang có → CRM cũng vừa đổi theo (sync-name).
    revalidatePath("/leads");
    revalidatePath("/lop-trial");
  }

  return NextResponse.json({ success, errors });
}
