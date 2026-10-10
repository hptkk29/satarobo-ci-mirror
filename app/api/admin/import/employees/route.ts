import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  DepartmentEnum,
  GenderEnum,
  ContractTypeEnum,
  EmploymentStatusEnum,
} from "@/lib/validators/employee";
import { checkPermission } from "@/lib/auth/check-permission";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { ANH_XA_COT, cotCoMat, dungPatchNhanSu } from "@/lib/hr/import-patch";
import { writeAudit } from "@/lib/audit/audit-log";
import { boMocUnix } from "@/lib/hr/ngay-vao-lam";

// Excel date parser — reused pattern from B3 holidays / B2 rooms.
function parseExcelDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    return new Date(
      Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()),
    );
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + v * 86400000;
    const d = new Date(ms);
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
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
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
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
  .transform((v) => {
    if (!v) return null;
    const s = v.trim();
    if (!s) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
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

const EmployeeImportSchema = z.object({
  employeeCode: requiredString.refine(
    (s) => /^[A-Za-z0-9.-]+$/.test(s),
    "Mã NV chỉ chứa chữ, số, dấu chấm/gạch",
  ),
  // ⚠️ BA TRƯỜNG DƯỚI ĐÂY BẮT BUỘC Ở ĐƯỜNG TẠO MỚI, KHÔNG bắt buộc ở đường cập nhật
  // (08/09/2026). Bắt buộc ở tầng schema thì một file "chỉ sửa một cột" bị từ chối,
  // buộc người dùng phải chép lại toàn bộ hồ sơ vào file — mà chép lại chính là cách
  // dữ liệu bị ghi đè nhầm. Cổng bắt buộc chuyển xuống Stage 3, nơi biết hồ sơ đã tồn
  // tại hay chưa.
  fullName: requiredString.optional(),
  jobTitle: requiredString.optional(),
  department: DepartmentEnum.optional(),
  // KHÔNG `.default("ACTIVE")` nữa: trên đường CẬP NHẬT nó có nghĩa "im lặng cho người
  // này đi làm lại". Mặc định ACTIVE nay đặt ở đúng chỗ — nhánh tạo mới ở Stage 3.
  status: EmploymentStatusEnum.optional(),
  phone: optionalString,
  email: optionalEmail,
  dateOfBirth: z
    .unknown()
    .optional()
    .transform((v) => parseExcelDate(v)),
  gender: z
    .union([GenderEnum, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === null || v === undefined ? null : v)),
  nationalId: optionalString,
  contractType: z
    .union([ContractTypeEnum, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === null || v === undefined ? null : v)),
  centerSlug: optionalString,
  managerCode: optionalString,
  // ⚠️ `boMocUnix` loại mốc Unix khỏi NGÀY CÔNG VIỆC — cùng cổng với validator form.
  // Excel gửi ô trống thành số `0` thì `parseExcelDate` trả 1899-12-30, và một chuỗi
  // "1970-01-01" chép từ bản xuất cũ sẽ ghi lại đúng cái mốc ta đang dọn.
  // KHÔNG áp cho `dateOfBirth`: sinh 01/01/1970 là ngày THẬT.
  joinedAt: z
    .unknown()
    .optional()
    .transform((v) => boMocUnix(parseExcelDate(v))),
  endDate: z
    .unknown()
    .optional()
    .transform((v) => boMocUnix(parseExcelDate(v))),
  address: optionalString,
  subjects: arrayFromCsv,
  certifications: arrayFromCsv,
  bio: optionalString,
  emergencyContact: optionalString,
  notes: optionalString,
});

type ImportError = { row: number; error: string };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await checkPermission("employees:create"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // CHẠY THỬ: mặc định của MÀN là chạy thử; ghi thật là bước xác nhận thứ hai.
  // Ở endpoint thì mặc định phải là GHI THẬT — nếu không, một client cũ (hoặc một
  // script) gọi endpoint sẽ im lặng không ghi gì và báo thành công.
  const dryRun = (body as { dryRun?: unknown })?.dryRun === true;

  const rows = (body as { rows?: unknown[] })?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "Không có dữ liệu" }, { status: 400 });
  }
  if (rows.length > 5000) {
    return NextResponse.json({ error: "Quá 5000 rows" }, { status: 400 });
  }

  // Stage 1: schema parse each row
  type Parsed = z.infer<typeof EmployeeImportSchema>;
  const stageOne: (
    | { ok: true; data: Parsed; coMat: Set<string> }
    | { ok: false; row: number; error: string }
  )[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = EmployeeImportSchema.safeParse(rows[i]);
    if (r.success) {
      // ── CỘT NÀO THỰC SỰ CÓ TRONG FILE (08/09/2026) ────────────────────────
      //
      // Phải bắt TRƯỚC Zod: schema biến `undefined` thành `null` (và `status` rơi về
      // `.default("ACTIVE")`), nên sau khi parse thì "không có cột" và "cột rỗng"
      // không phân biệt được nữa.
      //
      // ⚠️ Client dựng object đủ khoá rồi `JSON.stringify` — khoá `undefined` bị bỏ.
      // Nên Ô TRỐNG và CỘT THIẾU tới đây giống hệt nhau, và cả hai đều nghĩa là
      // KHÔNG ĐỤNG TỚI. Muốn XOÁ một trường thì sửa ở màn hồ sơ, không qua import —
      // đây là chiều an toàn, chọn có chủ đích.
      stageOne.push({
        ok: true,
        data: r.data,
        coMat: cotCoMat((rows[i] ?? {}) as Record<string, unknown>),
      });
    } else {
      stageOne.push({
        ok: false,
        row: i + 2,
        error: r.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
      });
    }
  }

  // Stage 2: resolve centerSlug → centerId + managerCode → managerId
  const slugs = [
    ...new Set(
      stageOne.flatMap((r) =>
        r.ok && r.data.centerSlug ? [r.data.centerSlug] : [],
      ),
    ),
  ];
  const managerCodes = [
    ...new Set(
      stageOne.flatMap((r) =>
        r.ok && r.data.managerCode ? [r.data.managerCode] : [],
      ),
    ),
  ];

  // Cách ly cơ sở: Employee ∈ SCOPED_MODELS → lookup manager tự giới hạn theo tầm
  // nhìn actor; write theo centerId form → guard passesScope per-row (CM chỉ import
  // nhân sự vào cơ sở mình; nhân sự HO/không cơ sở cần quyền HO/SUPER_ADMIN).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [centers, managers] = await Promise.all([
    slugs.length
      ? sdb.center.findMany({
          where: { slug: { in: slugs } },
          select: { id: true, slug: true },
        })
      : Promise.resolve([] as { id: string; slug: string }[]),
    managerCodes.length
      ? sdb.employee.findMany({
          where: { employeeCode: { in: managerCodes } },
          select: { id: true, employeeCode: true },
        })
      : Promise.resolve([] as { id: string; employeeCode: string }[]),
  ]);
  const slugToId = new Map(centers.map((c) => [c.slug, c.id]));
  const codeToManagerId = new Map(managers.map((m) => [m.employeeCode, m.id]));

  // Dual-write 2-phase: dựng map centerId → orgUnitId 1 lần (số cơ sở nhỏ).
  const centerIdToOrgUnitId = new Map<string, string | null>();
  for (const c of centers) {
    centerIdToOrgUnitId.set(c.id, await orgUnitIdForCenter(c.id));
  }

  const errors: ImportError[] = [];
  const validRows: {
    data: Parsed;
    centerId: string | null;
    coMat: Set<string>;
    orgUnitId: string | null;
    managerId: string | null;
  }[] = [];

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

    let managerId: string | null = null;
    if (entry.data.managerCode) {
      const id = codeToManagerId.get(entry.data.managerCode);
      if (!id) {
        errors.push({
          row: i + 2,
          error: `Không tìm thấy manager với mã "${entry.data.managerCode}"`,
        });
        continue;
      }
      managerId = id;
    }

    if (!passesScope("Employee", { centerId }, actor)) {
      errors.push({
        row: i + 2,
        error: entry.data.centerSlug
          ? `Cơ sở "${entry.data.centerSlug}" ngoài phạm vi quyền của bạn`
          : "Nhân sự không gắn cơ sở (HO/toàn hệ thống) cần quyền HO/SUPER_ADMIN",
      });
      continue;
    }

    const orgUnitId = centerId
      ? (centerIdToOrgUnitId.get(centerId) ?? null)
      : null;
    validRows.push({
      data: entry.data,
      centerId,
      orgUnitId,
      managerId,
      coMat: entry.coMat,
    });
  }

  if (validRows.length === 0) {
    return NextResponse.json({
      success: 0,
      errors,
      ...(dryRun ? { dryRun: true, thayDoi: [], cotCoTrongFile: [] } : {}),
    });
  }

  // Trường được phép xuất hiện trong AuditLog của lượt nhập — đúng tập trường mà
  // `dungPatchNhanSu` có thể ghi. KHÔNG thêm trường nhạy cảm ngoài tập này.
  const IMPORT_AUDIT_SELECT = Object.fromEntries(
    [...new Set(Object.values(ANH_XA_COT).flat())].map((t) => [t, true]),
  ) as Record<string, true>;

  // Stage 3: TẠO MỚI hoặc VÁ, theo employeeCode.
  //
  // Không dùng `upsert` nữa: `create` và `update` nay có luật khác nhau (tạo mới đòi đủ
  // 3 trường + mặc định ACTIVE; cập nhật chỉ đụng cột có trong file), nên phải biết hồ
  // sơ đã tồn tại hay chưa TRƯỚC khi ghi.
  //
  // Đọc TRỌN hồ sơ cũ (không chỉ mã) để có ảnh BEFORE cho AuditLog — endpoint này ghi
  // hàng loạt, và trước 08/09/2026 nó KHÔNG ghi audit dòng nào, trong khi đường sửa
  // từng người ghi 9 chỗ. Hệ quả: câu "prod sạch" chỉ là "không thấy dấu", không phải
  // "không xảy ra". Đọc một lượt, không N+1.
  const hoSoCu = new Map<string, Record<string, unknown>>(
    (
      await sdb.employee.findMany({
        where: {
          employeeCode: { in: validRows.map((r) => r.data.employeeCode) },
        },
        select: { ...IMPORT_AUDIT_SELECT, id: true, employeeCode: true },
      })
    ).map((e) => [e.employeeCode, e as unknown as Record<string, unknown>]),
  );
  const daCo = new Set(hoSoCu.keys());

  // ── KẾ HOẠCH GHI — tính MỘT LẦN, dùng chung cho CHẠY THỬ lẫn ghi thật ───────
  //
  // Tính hai đường thì bản xem trước không còn là bằng chứng: nó sẽ trả lời "cái tôi
  // TƯỞNG sẽ ghi" chứ không phải "cái sẽ ghi". Sự cố 08/09/2026 chính là một khoảng
  // lệch kiểu đó, ở tầng khác (test gõ tay `coMat` thay vì để route dựng).
  const keHoach = validRows.map((r, i) => {
    const base = {
      fullName: r.data.fullName,
      jobTitle: r.data.jobTitle,
      department: r.data.department,
      status: r.data.status,
      phone: r.data.phone,
      email: r.data.email,
      dateOfBirth: r.data.dateOfBirth,
      gender: r.data.gender,
      nationalId: r.data.nationalId,
      contractType: r.data.contractType,
      centerId: r.centerId,
      orgUnitId: r.orgUnitId, // dual-write 2-phase
      managerId: r.managerId,
      joinedAt: r.data.joinedAt,
      endDate: r.data.endDate,
      address: r.data.address,
      subjects: r.data.subjects ?? [],
      certifications: r.data.certifications ?? [],
      bio: r.data.bio,
      emergencyContact: r.data.emergencyContact,
      notes: r.data.notes,
      // Sync legacy isActive flag with new status field
      isActive: r.data.status === "ACTIVE",
    };
    // Đường CẬP NHẬT là VÁ — chỉ đụng cột thực sự có trong file.
    // Luật + lý do: `lib/hr/import-patch.ts`.
    const patch = dungPatchNhanSu(base as Record<string, unknown>, r.coMat);
    const laTaoMoi = !daCo.has(r.data.employeeCode);
    const truoc = hoSoCu.get(r.data.employeeCode) ?? {};
    // Chỉ giữ những trường THỰC SỰ ĐỔI — một lượt nhập lại cùng file không được đẻ ra
    // audit rỗng, nếu không sổ audit thành nhiễu và mất tác dụng truy vết.
    const cu: Record<string, unknown> = {};
    const moi: Record<string, unknown> = {};
    if (!laTaoMoi) {
      for (const [k, v] of Object.entries(patch)) {
        const a = truoc[k];
        if (JSON.stringify(a ?? null) === JSON.stringify(v ?? null)) continue;
        cu[k] = a ?? null;
        moi[k] = v ?? null;
      }
    }
    return { r, i, base, patch, truoc, cu, moi, laTaoMoi };
  });

  // ── CHẠY THỬ (08/09/2026) — in ra sẽ đổi gì, KHÔNG ghi gì ──────────────────
  //
  // Vì sao có: bản vá "ô trống = giữ nguyên" đã một lần được tuyên bố kín rồi vẫn xoá
  // trắng ba cột ngày trên 9 hồ sơ PROD. Thứ DUY NHẤT phát hiện ra là ảnh chụp trước/sau
  // của người vận hành. Chạy thử là biến việc chụp đó thành một bước của chính công cụ.
  //
  // Trả về TRƯỚC → sau cho từng người, từng cột. Không mở transaction, không ghi audit.
  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      success: 0,
      errors,
      cotCoTrongFile: [
        ...new Set(keHoach.flatMap((k) => [...k.r.coMat])),
      ].sort(),
      thayDoi: keHoach.map((k) => ({
        row: k.i + 2,
        employeeCode: k.r.data.employeeCode,
        loai: k.laTaoMoi ? ("TAO_MOI" as const) : ("CAP_NHAT" as const),
        // Tạo mới: mọi trường đều là "sẽ ghi"; cập nhật: chỉ trường THỰC SỰ đổi.
        cot: k.laTaoMoi
          ? Object.entries(k.base)
              .filter(([, v]) => v !== null && v !== undefined)
              .map(([ten, sau]) => ({ ten, truoc: null, sau }))
          : Object.keys(k.moi).map((ten) => ({
              ten,
              truoc: k.cu[ten] ?? null,
              sau: k.moi[ten] ?? null,
            })),
      })),
    });
  }

  let success = 0;
  try {
    await sdb.$transaction(async (tx) => {
      for (const { r, i, base, patch, truoc, cu, moi, laTaoMoi } of keHoach) {
        try {
          if (!laTaoMoi) {
            // Hồ sơ ĐÃ CÓ → chỉ VÁ. Không cột nào trong file thì không ghi gì.
            if (Object.keys(patch).length > 0) {
              if (Object.keys(moi).length > 0) {
                await tx.employee.update({
                  where: { employeeCode: r.data.employeeCode },
                  data: patch,
                });
                await writeAudit({
                  actor: { id: session.user.id, name: session.user.name ?? "" },
                  module: "hr",
                  entityType: "Employee",
                  entityId: String(truoc.id ?? r.data.employeeCode),
                  action: "IMPORT_UPDATE",
                  oldValues: cu,
                  newValues: moi,
                  changedFields: Object.keys(moi),
                  reason: `Nhập hàng loạt từ file — cột có trong file: ${[...r.coMat].sort().join(", ")}`,
                  // `sdb.$transaction` trả client MỞ RỘNG: cùng API runtime, khác kiểu
                  // generic (như `generateMonthAction` cũng phải ép). Audit phải nằm
                  // TRONG cùng transaction — ghi ngoài là audit sống sót khi ghi hỏng.
                  tx: tx as unknown as Parameters<typeof writeAudit>[0]["tx"],
                });
              }
            }
          } else {
            // TẠO MỚI → đòi đủ ba trường, và mặc định ACTIVE đặt ở ĐÂY (không phải ở schema).
            if (!base.fullName || !base.jobTitle || !base.department) {
              const thieu = [
                base.fullName ? null : "fullName",
                base.jobTitle ? null : "jobTitle",
                base.department ? null : "department",
              ].filter(Boolean);
              errors.push({
                row: i + 2,
                error: `Tạo mới nhân sự "${r.data.employeeCode}" cần đủ: ${thieu.join(", ")}`,
              });
              continue;
            }
            // Dựng MỘT LẦN rồi vừa ghi vừa audit CÙNG object.
            //
            // ⚠️ Trước 08/09/2026 chỗ này ghi `base` nhưng audit `patch`. `patch` chỉ
            // gồm cột CÓ TRONG FILE, còn tạo mới thì ghi TRỌN `base` — nên sổ audit của
            // một lượt tạo mới BÁO THIẾU đúng những trường được điền bằng mặc định
            // (`status`/`isActive` khi file không có cột `status`, mảng rỗng của
            // `subjects`/`certifications`).
            //
            // Vì sao đáng sửa dù nhỏ: chính sổ audit là thứ đã đo ra gốc của sự cố xoá
            // trắng ba cột ngày cùng ngày. Một công cụ chẩn đoán nói thiếu là công cụ
            // sẽ dẫn lạc đúng lúc cần nó nhất.
            const duLieuTao = {
              ...base,
              employeeCode: r.data.employeeCode,
              fullName: base.fullName,
              jobTitle: base.jobTitle,
              department: base.department,
              status: base.status ?? "ACTIVE",
              isActive: (base.status ?? "ACTIVE") === "ACTIVE",
            };
            const tao = await tx.employee.create({
              data: duLieuTao,
              select: { id: true },
            });
            await writeAudit({
              actor: { id: session.user.id, name: session.user.name ?? "" },
              module: "hr",
              entityType: "Employee",
              entityId: tao.id,
              action: "IMPORT_CREATE",
              // ĐÚNG object vừa ghi — không phải một bản tóm tắt của nó.
              newValues: duLieuTao,
              changedFields: Object.keys(duLieuTao),
              reason: `Nhập hàng loạt từ file — tạo mới; cột có trong file: ${[...r.coMat].sort().join(", ")}`,
              tx: tx as unknown as Parameters<typeof writeAudit>[0]["tx"],
            });
          }
          success++;
        } catch (err) {
          // Most likely cause: email unique-constraint conflict with a row not
          // owned by this employeeCode. Wrap so the outer handler can report
          // which row failed without losing the original stack.
          throw new Error(
            `Row ${i + 2} (code=${r.data.employeeCode}): ${
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

  revalidatePath("/admin/nhan-su");

  return NextResponse.json({ success, errors });
}
