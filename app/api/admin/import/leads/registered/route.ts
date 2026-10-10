// Task #07 Việc 1 — POST /api/admin/import/leads/registered
// Import danh sách "khách ĐÃ ĐĂNG KÝ" (file Excel thật của Sale, 3 sheet theo
// tháng) → Lead status DA_DANG_KY (convertedAt vẫn null) + LeadChild per học viên.
//
// - multipart/form-data: file (.xlsx) + mode ("dry-run" | "confirm").
// - Dry-run BẮT BUỘC trước: trả preview {tổng, hợp lệ, lỗi, sẽ gộp, bỏ qua} —
//   KHÔNG ghi DB. Chỉ ghi khi mode=confirm.
// - Idempotent: import lại cùng file → 0 record mới (dedupe SĐT + tên con,
//   note đã có marker thì không append lại).
// - Parse/plan thuần ở lib/lead/import-registered.ts (unit-tested).
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { canonicalPhone, expandPhoneVariants, phoneKey } from "@/lib/phone";
import { resolveActor } from "@/lib/auth/actor";
import {
  scopedDb,
  passesScope,
  getModelVisibleCenterIds,
  logScopeBypass,
} from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { getAuditActor } from "@/lib/audit/log";
import type { Prisma } from "@prisma/client";
import { setLeadStatus } from "@/lib/leads/set-status";
import { checkPermission } from "@/lib/auth/check-permission";
import { getNonEnrollableCenterIds } from "@/lib/enrollment-flow";
import { planRowFee, detectSameStudent } from "@/lib/lead/import-fee-plan";
import {
  parseRegisteredSheets,
  type RegisteredRowOverride,
  planRegisteredImport,
  splitMergesByScope,
  buildCourseKeyMap,
  compactKey,
  normalizeVi,
  parentDisplayName,
  planStudentSync,
  CROSS_SHEET_FEE_WARNING,
  type SheetAoA,
  type CellValue,
  type ExistingLead,
} from "@/lib/lead/import-registered";

// File thật của Sale: 11.071 dòng / 75 lead / 81 học viên. Ghi tuần tự từng lead
// vượt 60s và transaction bị đóng giữa chừng (đo 05/08: "60123 ms passed") ⇒ rollback
// sạch, không ghi được gì. Nới hạn + ghi theo lô song song (xem inBatches).
export const maxDuration = 300;

/**
 * Chạy `fn` cho từng phần tử, mỗi lô `size` cái CHẠY SONG SONG.
 *
 * Vì sao cần: mỗi lệnh ghi là một vòng đi-về Supabase (~300ms từ máy dev). 75 lead
 * nối đuôi nhau = quá 60s và transaction chết. Gửi song song thì độ trễ chồng lên
 * nhau thay vì cộng dồn. Vẫn giới hạn theo lô để không mở quá nhiều lệnh cùng lúc
 * trên một connection. Mỗi lead là một row riêng nên không có nguy cơ khoá chéo.
 */
async function inBatches<T>(items: T[], fn: (item: T) => Promise<unknown>, size = 10) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

function err(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

const OVERRIDABLE = new Set([
  "grade", "course", "tuition", "center",
  "parentName", "parentCccd", "address", "note", "source", "sales",
  "payIn2", "discountKind", "discountValue", "discountReason", "dueDate2",
]);

/**
 * Đọc danh sách ô đã sửa từ form. Bỏ qua im lặng những gì không hợp lệ thay vì
 * 400: một ô sửa hỏng không đáng làm hỏng cả lượt import 100 dòng — và cột không
 * nằm trong allowlist thì KHÔNG được đè (SĐT/tên học viên là định danh gộp trùng).
 */
function parseOverrides(raw: FormDataEntryValue | null): RegisteredRowOverride[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: RegisteredRowOverride[] = [];
  for (const it of arr.slice(0, 2000)) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const sheet = typeof o.sheet === "string" ? o.sheet : null;
    const row = typeof o.row === "number" && Number.isInteger(o.row) ? o.row : null;
    if (!sheet || row === null || row < 1) continue;
    const vals = o.values;
    if (!vals || typeof vals !== "object") continue;
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(vals as Record<string, unknown>)) {
      if (!OVERRIDABLE.has(k)) continue;
      if (typeof v !== "string") continue;
      values[k] = v.slice(0, 300);
    }
    if (Object.keys(values).length > 0) {
      out.push({ sheet, row, values } as RegisteredRowOverride);
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return err(401, "UNAUTHORIZED", "Chưa đăng nhập");
  // Guard leads:import (đã thêm vào registry lib/auth/permissions.ts —
  // SUPER_ADMIN/CENTER_MANAGER, pattern students:import).
  if (!(await checkPermission("leads:import"))) {
    return err(403, "FORBIDDEN", "Không có quyền import lead");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err(400, "INVALID_BODY", "Body phải là multipart/form-data");
  }
  const file = form.get("file");
  const mode = String(form.get("mode") ?? "dry-run");
  if (!(file instanceof File)) return err(400, "MISSING_FILE", "Thiếu file Excel");
  if (mode !== "dry-run" && mode !== "confirm") {
    return err(400, "INVALID_MODE", "mode phải là dry-run hoặc confirm");
  }
  if (file.size > 15 * 1024 * 1024) return err(400, "FILE_TOO_LARGE", "File quá 15MB");

  // ── Đọc workbook → AoA (KHÔNG cellDates: serial number giữ nguyên, parser tự
  // làm tròn về ngày — tránh lệch timezone).
  let sheets: SheetAoA[];
  try {
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
    sheets = wb.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json<CellValue[]>(wb.Sheets[name], {
        header: 1,
        defval: null,
        raw: true,
      }),
    }));
  } catch (e) {
    return err(400, "INVALID_XLSX", `Không đọc được file Excel: ${e instanceof Error ? e.message : "Unknown"}`);
  }

  // 04/08 — sửa tay ở màn xem thử. Nhận danh sách ô đã sửa, đè vào lúc phân tích
  // để MỌI suy diễn (tuổi, tiền, cơ sở, gộp trùng, cảnh báo) tính lại theo giá trị
  // người nhập nhìn thấy — không có khoảng lệch giữa bản xem và bản ghi.
  const overrides = parseOverrides(form.get("overrides"));
  const parsed = parseRegisteredSheets(sheets, overrides);

  // ── Context resolve từ DB (center/orgUnit theo code — dual-write 2-phase như
  // route import leads sự kiện; course theo tên/slug; user active cho fuzzy Sales).
  // Cách ly cơ sở: Center/OrgUnit/User exempt, Course global → sdb pass-through.
  // Lead trùng SĐT phải tra TOÀN HỆ THỐNG (câu 34 BGĐ: gộp về record CŨ NHẤT bất kể
  // cơ sở — sdb sẽ ẩn lead cơ sở khác và gây TẠO TRÙNG) → bypass HẸP cho đúng truy
  // vấn này + ghi audit AC10 khi actor không phải HO/SUPER_ADMIN.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const phones = parsed.parents.map((p) => p.phone);
  if (phones.length > 0 && getModelVisibleCenterIds("Lead", actor) !== "ALL") {
    await logScopeBypass(actor, "import/leads/registered: dedupe+gộp lead theo SĐT toàn hệ thống");
  }
  const [centers, orgUnits, courses, users, existingLeads] = await Promise.all([
    sdb.center.findMany({ where: { code: { not: null } }, select: { id: true, code: true } }),
    sdb.orgUnit.findMany({ where: { deletedAt: null }, select: { id: true, code: true, type: true } }),
    sdb.course.findMany({ select: { id: true, name: true, slug: true, price: true } }),
    sdb.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, role: true, roles: true },
    }),
    phones.length > 0
      ? scopedDb(actor, { bypass: true }).lead.findMany({
          // AUTH-SĐT P1 — tìm cả bản ghi `0…` cũ chưa backfill, nếu không thì
          // đường GỘP ngừng thấy lead cũ và import sẽ tạo lead trùng.
          where: { phone: { in: expandPhoneVariants(phones) }, deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            parentName: true,
            phone: true,
            status: true,
            note: true,
            centerId: true,
            orgUnitId: true,
            courseId: true,
            assignedToId: true,
            children: {
              select: {
                id: true,
                fullName: true,
                gradeLevel: true,
                ageYears: true,
                note: true,
                interestedCourseId: true,
                interestedCenterId: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  // DB có thể chứa lead trùng SĐT (data cũ) → GỘP vào lead CŨ NHẤT (câu 34: giữ record cũ).
  const existingByPhone = new Map<string, ExistingLead>();
  for (const l of existingLeads) {
    // Key theo canonical: query trên trả về cả 2 dạng, key thô sẽ tra trượt.
    const k = phoneKey(l.phone);
    if (!existingByPhone.has(k)) existingByPhone.set(k, l as ExistingLead);
  }

  const courseKeyMap = buildCourseKeyMap(courses);
  const priceByCourseId = new Map(courses.map((c) => [c.id, c.price ?? 0]));

  /** Giá niêm yết của dòng (0 nếu chưa khớp được khoá). */
  const listPriceOf = (c: {
    courseRaw: string | null;
  }): number => {
    const id =
      (c.courseRaw &&
        (courseKeyMap.get(normalizeVi(c.courseRaw)) ?? courseKeyMap.get(compactKey(c.courseRaw)))) ||
      null;
    return id ? (priceByCourseId.get(id) ?? 0) : 0;
  };

  /**
   * Chia phần chênh giữa giá niêm yết và tiền đã thu thành giảm giá / công nợ.
   * Luật ở lib/lead/import-fee-plan.ts (thuần, test bằng chính dòng thật trong file).
   * Ô người nhập tự sửa ở màn xem thử THẮNG suy đoán của máy.
   */
  const feePlanFor = (
    c: {
      paidAmount: number | null;
      noteRaw: string | null;
      payIn2: boolean;
      discountKind: "PERCENT" | "AMOUNT" | null;
      discountValue: number | null;
      discountReason: string | null;
    },
    listPrice: number,
  ) =>
    planRowFee({
      listPrice,
      paid: c.paidAmount ?? 0,
      note: c.noteRaw,
      payIn2: c.payIn2,
      manualDiscountAmount:
        c.discountValue === null || !c.discountKind
          ? null
          : c.discountKind === "PERCENT"
            ? Math.round((listPrice * c.discountValue) / 100)
            : Math.min(c.discountValue, listPrice),
      manualDiscountReason: c.discountReason,
    });

  // Hội sở KHÔNG nhận lead → loại khỏi bảng tra ngay từ đầu. File Excel ghi mã HO thì
  // rơi vào `unmatchedCenters` (cảnh báo ở màn xem thử) chứ KHÔNG âm thầm gắn vào HO.
  const nonEnrollable = await getNonEnrollableCenterIds();
  const plan = planRegisteredImport(parsed, {
    centerByCode: new Map(
      centers
        .filter((c) => c.code && !nonEnrollable.includes(c.id))
        .map((c) => [c.code as string, c.id]),
    ),
    orgUnitByCode: new Map(
      orgUnits.filter((o) => o.code && o.type === "CENTER").map((o) => [o.code, o.id]),
    ),
    courseByKey: buildCourseKeyMap(courses),
    salesUsers: users.map((u) => ({
      id: u.id,
      name: u.name,
      roles: [...new Set([u.role, ...u.roles])],
    })),
    existingByPhone,
  });

  // ── Câu 34 (user chốt 09/07/2026): CHẶN gộp cross-center ──────────────────
  // Trước đây đường GỘP là dedupe SĐT toàn hệ thống: Sale CS1 import một SĐT đang thuộc
  // lead của CS2 thì ghi đè/bổ sung thẳng vào lead CS2 — vượt qua cách ly cơ sở, và
  // đường ghi KHÔNG được scopedDb bảo vệ (scopedDb chỉ scope READ).
  // Nay: existing lead có centerId ngoài phạm vi actor → KHÔNG gộp, KHÔNG tạo mới, chỉ
  // báo SĐT. Không trả tên phụ huynh / trạng thái / người phụ trách (không lộ cơ sở khác).
  // Lead untagged (centerId null) vẫn gộp — không phải dữ liệu của cơ sở nào.
  const { allowed: scopedMerges, rejectedPhones } = splitMergesByScope(
    plan.merges,
    new Map([...existingByPhone].map(([phone, l]) => [phone, l.centerId])),
    (centerId) => passesScope("Lead", { centerId }, actor),
  );
  const mergeRejected = rejectedPhones.map((sdt) => ({ sdt }));

  const changedMerges = scopedMerges.filter((m) => m.changed);

  // ── Đồng bộ ngược sang HỒ SƠ HỌC VIÊN (chốt 05/08). Con của lead đã được chốt
  // thành học viên từ đợt trước thì import lại phải đắp luôn cho học viên đó, chứ
  // không dừng ở Lead. Đường đi: LeadChild → Enrollment.leadChildId → Student.
  // CCCD là PII → chỉ ghi khi actor có quyền, giống màn hồ sơ học viên.
  const canWritePii = await checkPermission("payments:view-pii");
  const childIdsInMerge = scopedMerges.flatMap((m) => [
    ...m.childUpdates.map((cu) => cu.childId),
    ...(existingByPhone.get(m.phone)?.children.map((c) => c.id) ?? []),
  ]);
  const studentSyncs: { studentId: string; set: ReturnType<typeof planStudentSync> }[] = [];
  if (childIdsInMerge.length > 0) {
    const links = await sdb.enrollment.findMany({
      where: { leadChildId: { in: [...new Set(childIdsInMerge)] } },
      select: { leadChildId: true, studentId: true },
    });
    const studentIdByChild = new Map(
      links.filter((l) => l.leadChildId).map((l) => [l.leadChildId as string, l.studentId]),
    );
    const students = await sdb.student.findMany({
      where: { id: { in: [...new Set([...studentIdByChild.values()])] }, deletedAt: null },
      select: { id: true, parentName: true, parentPhone: true, parentNationalId: true, address: true },
    });
    const studentById = new Map(students.map((s) => [s.id, s]));

    for (const m of scopedMerges) {
      const p = parsed.parents.find((x) => x.phone === m.phone);
      if (!p) continue;
      const info = {
        parentName: p.parentName,
        parentPhone: canonicalPhone(p.phone) ?? p.phone,
        cccd: p.parentCccd,
        address: p.address,
      };
      const childIds = [
        ...m.childUpdates.map((cu) => cu.childId),
        ...(existingByPhone.get(m.phone)?.children.map((c) => c.id) ?? []),
      ];
      for (const sid of new Set(
        childIds.map((cid) => studentIdByChild.get(cid)).filter((x): x is string => !!x),
      )) {
        const s = studentById.get(sid);
        if (!s) continue;
        const set = planStudentSync(s, info, { canWritePii });
        if (Object.keys(set).length > 0) studentSyncs.push({ studentId: sid, set });
      }
    }
  }

  // ── Cách ly cơ sở trên đường TẠO lead (DoD#4). scopedDb chỉ scope READ, KHÔNG
  // scope WRITE → chốt WRITE bằng passesScope per-lead như route import sự kiện
  // (app/api/admin/import/leads/route.ts): actor center-level KHÔNG được tạo lead
  // cho cơ sở NGOÀI phạm vi (vd Sale CS1 gặp dòng gắn CS2 → loại, không tạo lead CS2).
  // Lead untagged (centerId null) KHÔNG phải leak cross-center → giữ (tạo như hiện trạng;
  // gán cơ sở sau). Đường GỘP nay cũng bị chặn cross-center — xem `mergeRejected` bên dưới.
  const scopeRejected: { sdt: string; tenPH: string; coSo: string }[] = [];
  const scopedCreates = plan.creates.filter((c) => {
    if (c.centerId == null || passesScope("Lead", { centerId: c.centerId }, actor)) {
      return true;
    }
    scopeRejected.push({ sdt: c.phone, tenPH: c.parentName, coSo: c.centerId });
    return false;
  });

  const summary = {
    // Số hồ sơ HỌC VIÊN đã tồn tại sẽ được đắp thêm thông tin từ file này.
    seDongBoHocVien: studentSyncs.length,
    // Preview dry-run theo spec task #07.
    tongDongDoc: parsed.totalDataRows,
    boQua: parsed.skippedEmpty,
    hopLe: parsed.validRows,
    gopTrongFile: parsed.mergedDuplicateRows,
    loi: parsed.errors.map((e) => ({ sheet: e.sheet, dong: e.row, lyDo: e.reason })),
    phuHuynh: parsed.parents.length,
    hocVien: parsed.parents.reduce((n, p) => n + p.children.length, 0),
    seTao: scopedCreates.map((c) => ({
      sdt: c.phone,
      tenPH: c.parentName,
      soCon: c.children.length,
    })),
    ngoaiPhamVi: scopeRejected,
    seGop: scopedMerges.map((m) => ({
      sdt: m.phone,
      tenPH: m.parentName,
      soConMoi: m.newChildren.length,
      coThayDoi: m.changed,
    })),
    // Câu 34 — SĐT trùng lead cơ sở khác: không gộp, không tạo. Chỉ SĐT (không lộ tên).
    trungCoSoKhac: mergeRejected,
    salesKhongKhop: plan.unmatchedSales,
    khoaKhongKhop: plan.unmatchedCourses,
    coSoKhongKhop: plan.unmatchedCenters,
    // 04/08 — DÒNG CẦN KIỂM TRA: vẫn import được, nhưng thiếu/mờ thông tin. Liệt kê
    // ở màn xem thử để người nhập sửa NGAY TRONG EXCEL rồi tải lại, thay vì import
    // xong mới đi dò từng lead từng phụ huynh.
    // Cùng phụ huynh + cùng khoá tách thành 2 dòng: 1 em trả 2 đợt hay 2 em thật?
    // Ca thật 04/08: "Quân" + "Nguyễn Ngọc Quân" (4.000.000 + 4.640.000 = đúng giá
    // niêm yết) — bộ nhập cũ tạo 2 học viên + 2 đơn hàng.
    nghiTrung: parsed.parents.flatMap((p) => {
      const byCourse = new Map<string, typeof p.children>();
      for (const c of p.children) {
        const k = c.courseRaw ?? "(trống)";
        if (!byCourse.has(k)) byCourse.set(k, []);
        byCourse.get(k)!.push(c);
      }
      return [...byCourse.values()]
        .filter((rows) => rows.length > 1)
        .map((rows) => {
          const d = detectSameStudent(
            rows.map((r) => ({ fullName: r.fullName, paid: r.paidAmount ?? 0 })),
            listPriceOf(rows[0]!),
          );
          return {
            sdt: p.phone,
            tenPH: p.parentName,
            hocVien: rows.map((r) => r.fullName),
            khoa: rows[0]!.courseRaw,
            ketLuan: d.verdict,
            canCu: d.evidence,
          };
        })
        .filter((r) => r.ketLuan !== "DIFFERENT_STUDENTS");
    }),
    // Bảng đối chứng: người nhập KHÔNG kiểm nổi 81 dòng, nhưng kiểm được 1 con số —
    // "tổng đã thu" đối chiếu sao kê/sổ quỹ. Sai ở đâu thì lệch tổng lộ ra ngay.
    doiChung: (() => {
      let daThu = 0, giam = 0, no = 0, boQua = 0;
      for (const p of parsed.parents)
        for (const c of p.children) {
          const fp = feePlanFor(c, listPriceOf(c));
          if (fp.treatment === "REFUND") { boQua++; continue; }
          daThu += c.paidAmount ?? 0;
          giam += fp.discountAmount;
          no += fp.remaining;
        }
      return { daThu, giam, no, boQuaHoanPhi: boQua };
    })(),
    // 04/08 — DÒNG CẦN KIỂM TRA: vẫn import được, nhưng thiếu/mờ thông tin, HOẶC máy
    // không đủ căn cứ chia phần chênh học phí (giảm giá hay công nợ?).
    canKiemTra: parsed.parents.flatMap((p) =>
      p.children
        .filter((c) => c.warnings.length > 0 || feePlanFor(c, listPriceOf(c)).needsHuman)
        .map((c) => ({
          sdt: p.phone,
          hocVien: c.fullName,
          sheet: c.sources[0]?.sheet ?? "",
          dong: c.sources[0]?.row ?? 0,
          thieu: c.warnings,
          daDong: c.paidAmount,
          cachDong: c.feeMode,
          tuoi: c.ageYears,
          // Tiền — tính TẠI ĐÂY vì cần giá niêm yết của khoá (parser thuần, không có DB).
          ...(() => {
            const giaNiemYet = listPriceOf(c);
            const p = feePlanFor(c, giaNiemYet);
            return {
              giaNiemYet,
              giamTinhRa: p.discountAmount,
              tongPhaiNop: p.totalAmount,
              conLai: p.remaining,
              tra2Dot: c.payIn2,
              hanDot2: c.dueDate2,
              giamKieu: c.discountKind,
              giamGiaTri: c.discountValue,
              giamLyDo: c.discountReason || p.reason,
              // 04/08 — máy tự phân loại phần chênh: giảm giá thật / công nợ / phải hỏi.
              xuLy: p.treatment,
              canCu: p.evidence,
              // Học phí lệch giữa các sheet = tiền, không phải chuyện nhỏ. Nếu chỉ
              // để nó là một dòng cảnh báo nằm lẫn giữa hàng chục dòng khác thì rất
              // dễ bấm ghi thẳng và ghi nhận THIẾU tiền (đo file thật: 7 dòng, lệch
              // 30.736.000). Nâng thành dòng BẮT BUỘC QUYẾT → nổi lên đầu, viền đỏ.
              phaiXem: p.needsHuman || c.warnings.some((w) => w.includes(CROSS_SHEET_FEE_WARNING)),
            };
          })(),
          // Giá trị ĐANG dùng (đã tính cả ô người nhập vừa sửa) → đổ vào ô nhập
          // trên màn, để sửa tiếp là sửa trên chính con số mình đang nhìn.
          giaTri: {
            grade: c.grade ?? "",
            course: c.courseRaw ?? "",
            tuition: c.tuitionRaw ?? "",
            center: c.centerCode ?? "",
            // File không ghi tên PH → hiện SẴN tên sẽ được ghi ("Phụ huynh của <tên con>")
            // thay vì ô trống, để người nhập thấy đúng cái hệ thống sắp lưu và sửa đè được.
            parentName: parentDisplayName(p.parentName, p.children, p.phone),
            parentCccd: p.parentCccd ?? "",
            address: p.address ?? "",
            note: c.noteRaw ?? "",
          },
        })),
    ),
  };

  if (mode === "dry-run") {
    return NextResponse.json({ ok: true, data: { mode, ...summary } });
  }

  // ── mode=confirm: ghi DB trong transaction.
  const { actorId, actorName } = getAuditActor(session);
  let createdLeads = 0;
  let createdChildren = 0;
  let mergedLeads = 0;
  try {
    await sdb.$transaction(
      async (txRaw) => {
        // `sdb.$transaction` trả client ĐÃ mở rộng (scopedDb), khác kiểu với
        // `Prisma.TransactionClient` mà các helper dùng chung nhận. Cùng một ép kiểu
        // với `lop-trial/_actions.ts` — cùng lý do, cùng chỗ đọc.
        const tx = txRaw as unknown as Prisma.TransactionClient;
        await inBatches(scopedCreates, async (c) => {
          await tx.lead.create({
            data: {
              parentName: c.parentName,
              phone: c.phone,
              centerId: c.centerId,
              orgUnitId: c.orgUnitId, // dual-write 2-phase
              courseId: c.courseId,
              assignedToId: c.assignedToId,
              assignedAt: c.assignedToId ? new Date() : null,
              // 15/09/2026 — BẮT BUỘC. Danh sách /leads sắp theo `lastInboundAt` với
              // `nulls: 'last'`, nên lead tạo mà bỏ trống cột này bị đẩy xuống CUỐI mọi
              // trang. Cùng lỗ với đường import Excel sự kiện: người dùng báo "nhập xong
              // không thấy lead đâu", nhưng tìm theo SĐT/nguồn thì lại ra.
              lastInboundAt: new Date(),
              // BGĐ câu 4(1): khách ĐÃ đăng ký → DA_DANG_KY trực tiếp (backfill,
              // không đi transition guard C4). Convert → flow convert v2.
              // GĐ5 — lead nhập kiểu này CHƯA convert; mốc phân biệt là `convertedAt`
              // (vẫn null ở đây), không còn là bậc status riêng như REGISTERED cũ.
              status: "DA_DANG_KY",
              // `statusChangedAt` KHÔNG set ở đây — `Lead.statusChangedAt` có
              // `@default(now())`, đóng mốc cho MỌI đường tạo lead thay vì chỗ này
              // tự lo phần mình. Lead sinh ra ở đây cũng cố ý không có dòng sổ mở
              // đầu: không đường tạo lead nào khác ghi dòng mở đầu, thêm riêng ở đây
              // là làm sổ lệch chuẩn giữa các đường vào.
              source: c.source,
              note: c.note,
              children: {
                create: c.children.map((ch) => ({
                  fullName: ch.fullName,
                  gradeLevel: ch.gradeLevel,
                  ageYears: ch.ageYears,
                  interestedCourseId: ch.interestedCourseId,
                  interestedCenterId: ch.interestedCenterId,
                  note: ch.note,
                })),
              },
              activities: {
                create: {
                  actorId,
                  actorName,
                  type: "NOTE",
                  content: `Nhập từ Excel danh sách đăng ký (Đã đăng ký, ${c.children.length} học viên)`,
                  metadata: { system: true, import: "registered-excel" },
                },
              },
            },
            select: { id: true },
          });
          createdLeads++;
          createdChildren += c.children.length;
        });

        await inBatches(changedMerges, async (m) => {
          const existing = existingByPhone.get(m.phone);
          // ⚠️ `status` được TÁCH khỏi `m.set` và đi qua cửa ghi `setLeadStatus`.
          //
          // Đây là lượt nâng bậc trên lead ĐANG CÓ (đường gộp), tức một lần đổi trạng
          // thái thật. Trải nó vào `...m.set` thì cột đổi nhưng sổ `LeadStatusHistory`
          // trống, `statusChangedAt` đứng im, và nếu sau này bảng gộp có nhánh hạ bậc
          // thì `droppedAtStage` cũng mất. Nhập tệp là đường đổi trạng thái HÀNG LOẠT
          // — chỗ khuyết sổ ở đây làm hỏng phễu nhiều lead một lượt chứ không phải một.
          const { status: bacMoi, ...setKhongStatus } = m.set;
          if (bacMoi) {
            await setLeadStatus({
              tx,
              leadId: m.leadId,
              to: bacMoi,
              source: "import",
              actorId,
              actorName,
              reason: "Gộp từ Excel danh sách đăng ký",
            });
          }
          await tx.lead.update({
            where: { id: m.leadId },
            data: {
              ...setKhongStatus,
              ...(m.noteAppend
                ? { note: existing?.note ? `${existing.note}\n\n${m.noteAppend}` : m.noteAppend }
                : {}),
              ...(m.set.assignedToId ? { assignedAt: new Date() } : {}),
              children: {
                create: m.newChildren.map((ch) => ({
                  fullName: ch.fullName,
                  gradeLevel: ch.gradeLevel,
                  // Nhánh TẠO có ageYears, nhánh GỘP thì thiếu — con thêm vào lead
                  // đã có bị mất tuổi. Cùng họ lỗi với childUpdates (vá 05/08).
                  ageYears: ch.ageYears,
                  interestedCourseId: ch.interestedCourseId,
                  interestedCenterId: ch.interestedCenterId,
                  note: ch.note,
                })),
              },
              activities: {
                create: {
                  actorId,
                  actorName,
                  type: "NOTE",
                  content: `Gộp từ Excel danh sách đăng ký (bổ sung field trống${m.newChildren.length > 0 ? `, +${m.newChildren.length} học viên` : ""}${m.set.status ? ", chuyển Đã đăng ký" : ""})`,
                  metadata: { system: true, import: "registered-excel", merge: true },
                },
              },
            },
          });
          await Promise.all(
            m.childUpdates.map((cu) => {
              const before = existing?.children.find((ch) => ch.id === cu.childId);
              return tx.leadChild.update({
                where: { id: cu.childId },
                data: {
                  ...cu.set,
                  ...(cu.noteAppend
                    ? { note: before?.note ? `${before.note}\n\n${cu.noteAppend}` : cu.noteAppend }
                    : {}),
                },
              });
            }),
          );
          mergedLeads++;
          createdChildren += m.newChildren.length;
        });

        // Đắp sang hồ sơ học viên đã tồn tại (chỉ field đang trống — planStudentSync).
        await inBatches(studentSyncs, (su) =>
          tx.student.update({ where: { id: su.studentId }, data: su.set }),
        );
      },
      { timeout: 180_000 },
    );
  } catch (e) {
    return err(500, "WRITE_FAILED", `Lỗi ghi DB: ${e instanceof Error ? e.message : "Unknown"}`);
  }

  revalidatePath("/leads");
  return NextResponse.json({
    ok: true,
    data: {
      mode,
      ...summary,
      daTaoLead: createdLeads,
      daTaoHocVien: createdChildren,
      daGopLead: mergedLeads,
      daDongBoHocVien: studentSyncs.length,
      khongDoi: plan.merges.length - changedMerges.length,
    },
  });
}
