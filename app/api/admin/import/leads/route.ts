import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { expandPhoneVariants, phoneKey } from "@/lib/phone";
import { resolveActor } from "@/lib/auth/actor";
import {
  scopedDb,
  passesScope,
  getModelVisibleCenterIds,
  logScopeBypass,
} from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { getAuditActor, logLeadAudit } from "@/lib/audit/log";
import type { Prisma } from "@prisma/client";
import { dongBoTuLead } from "@/lib/students/dong-bo-lead-db";
import { chiOPhLead, type PhLead } from "@/lib/students/dong-bo-lead";
import {
  conMoDeChiaLai,
  dungBanCapNhatLeadTrung,
  moTaLuotCapNhat,
  type OLeadDangCo,
  type OLeadTuFile,
} from "@/lib/lead/nhap-trung";
import { TERMINAL_LEAD_STATUSES } from "@/lib/lead/assign";
import { parseLeadImportRow, resolveDefaultCenterId } from "@/lib/lead/import";
import { normalizeVi } from "@/lib/lead/import-registered";
import { autoAssignNewLead } from "@/lib/lead/auto-assign";
import { chiaChoLead, baoLoLeadMoi } from "@/lib/lead/assign-lead";
import { db } from "@/lib/db";
import { canManualAssign } from "@/lib/lead/assign-guard";
import { checkPermission } from "@/lib/auth/check-permission";
import { orgUnitIdForCenter } from "@/lib/org/org-service";

type ImportError = { row: number; error: string };

/**
 * ⚠️ HAI TRẦN THỜI GIAN, PHẢI ĐẶT CẢ HAI — nới một cái là lỗi chỉ ĐỔI CHỖ.
 *
 * Sự cố prod 16/09/2026, chủ dự án chụp màn hình. Người dùng nhập một file lead và nhận:
 *
 *   Lỗi ghi: Invalid `prisma.auditLog.create()` invocation: Transaction API error:
 *   Transaction not found. Transaction ID is invalid, refers to an old closed transaction
 *
 * Đó KHÔNG phải lỗi dữ liệu. Đó là Prisma tự đóng giao dịch vì quá hạn **mặc định 5 giây**,
 * rồi lệnh ghi tiếp theo đập vào một giao dịch đã chết. Thân `$transaction` ở đây lặp qua
 * TỪNG dòng và mỗi dòng tốn 2–4 lượt đi-về DB (`lead.create`/`lead.update` + `LeadChild` +
 * `LeadActivity` + `AuditLog`), nên file chỉ cần vài trăm dòng là vượt 5 giây trên Supabase.
 *
 * Hậu quả tệ nhất có thể: ROLLBACK SẠCH. Người dùng nhập file đúng, chờ, rồi nhận thông báo
 * hỏng và KHÔNG dòng nào vào hệ thống — trong khi chẳng có dòng nào sai cả.
 *
 * Nợ CÓ SẴN, không do đợt ghi đè 16/09 sinh ra: `$transaction` ở đây chưa từng khai
 * `timeout`. Nó chỉ chưa nổ vì file nhập trước đây nhỏ.
 *
 * Cách vá theo đúng NẾP ĐÃ ĐO của repo — `app/api/admin/import/leads/registered/route.ts`
 * gặp y hệt bài này ngày 05/08 ("60123 ms passed", 75 lead, rollback sạch) và chốt:
 *   · `maxDuration` cho HÀM  — không nới thì nới `timeout` cũng vô nghĩa, Vercel giết hàm
 *     trước khi giao dịch kịp xong, và triệu chứng đổi thành 504 chứ không hết;
 *   · `timeout` cho GIAO DỊCH — 5 giây mặc định là con số dành cho một lệnh ghi lẻ, không
 *     phải cho một vòng lặp ghi hàng nghìn dòng.
 */
export const maxDuration = 300;

// POST /api/admin/import/leads — nhập nhiều lead từ Excel (thu ở sự kiện).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkPermission("leads:create"))) {
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
  if (rows.length > 5000) return NextResponse.json({ error: "Quá 5000 rows" }, { status: 400 });

  // ── DÒNG ĐƯỢC TICK "GHI ĐÈ" (chốt 16/09/2026) ─────────────────────────────
  //
  // Chỉ số 0-BASED TRONG `rows` — không phải SĐT, không phải số dòng Excel.
  //
  // ⚠️ Cố ý KHÔNG nhận SĐT: chuẩn hoá SĐT ở trình duyệt (`normalizePhone`) và ở
  // đây (`phoneKey` + `expandPhoneVariants`) là HAI cỗ máy khác nhau. Lệch một ca
  // biên nào đó là cái tick rơi mất — mà rơi mất một lệnh GHI ĐÈ thì không ai
  // thấy: lead vẫn được cập nhật, chỉ là không đè, và người vận hành đinh ninh
  // mình đã đè. Chỉ số thì client và server cầm chung đúng một mảng.
  //
  // Mặc định RỖNG — không tick gì thì không đè gì. Fail-closed có chủ đích: body
  // dị dạng, gõ sai tên khoá, hay một bản client cũ đều rơi về luật 15/09 (giữ giá
  // trị đang lưu), chứ không rơi vào nhánh xoá dữ liệu.
  //
  // ⚠️ 17/09/2026 — CẦN THÊM QUYỀN `leads:overwrite`.
  //
  // Chủ dự án: "role sale nhập chỉ thêm vào ghi chú nếu trùng […] khi sale nhập =
  // excel cũng vậy luôn nhé, không có chức năng ghi đè dành cho sale". Màn hình đã
  // ẩn cột Đè cho người không có quyền, NHƯNG ẩn ở giao diện không phải là chặn:
  // `POST /api/admin/import/leads` là một endpoint riêng, gọi thẳng bằng `curl` kèm
  // `ghiDe: [0,1,2]` là đè được hết. Cổng thật nằm ở đây.
  //
  // Bỏ QUA IM LẮNG chứ không trả 403: người không có quyền vẫn được nhập bình thường
  // (trùng thì nối ghi chú — đúng chốt), nên chặn cả lượt là hỏng việc của họ vì
  // một cái cờ mà màn hình của họ còn không bày ra.
  const duocDe = await checkPermission("leads:overwrite");
  const ghiDeRaw = duocDe ? (body as { ghiDe?: unknown })?.ghiDe : null;
  const ghiDeIdx = new Set<number>(
    Array.isArray(ghiDeRaw)
      ? ghiDeRaw.filter(
          (v): v is number =>
            typeof v === "number" && Number.isInteger(v) && v >= 0 && v < rows.length,
        )
      : [],
  );

  // Stage 1: parse thuần từng dòng.
  const parsed = rows.map((r) => parseLeadImportRow((r ?? {}) as Record<string, unknown>));

  // Resolve cơ sở (mã CS → centerId, mọi cơ sở có code) + khoá (tên/slug → courseId).
  // Dual-write 2-phase: resolve OrgUnit theo mã (tự nhiên gồm cả HO "HO" — HO
  // không có Center row nên chỉ map được qua OrgUnit).
  // Cách ly cơ sở: Lead ∈ SCOPED_MODELS. Write theo centerId form → guard passesScope
  // per-row (CM chỉ import lead vào cơ sở mình; Sale HO/SUPER_ADMIN chọn cơ sở tự do
  // — câu 4.1 BGĐ). Center/OrgUnit exempt, Course catalog global → pass-through.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [centers, orgUnits, courses] = await Promise.all([
    sdb.center.findMany({ where: { code: { not: null } }, select: { id: true, code: true } }),
    sdb.orgUnit.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true },
    }),
    sdb.course.findMany({ select: { id: true, name: true, slug: true } }),
  ]);
  const centerByCode = new Map(centers.map((c) => [c.code, c.id]));
  const orgUnitByCode = new Map(orgUnits.map((o) => [o.code, o.id]));

  // 26/07 — QL cơ sở BỎ TRỐNG cột "Cơ sở" → lead tự về cơ sở của họ. Trước đây dòng
  // không có mã CS bị chặn ("cần quyền HO/SUPER_ADMIN") nên QL cơ sở vừa không import
  // được, vừa không có lead nào để chia. Người nhìn thấy NHIỀU cơ sở (HO/SUPER_ADMIN)
  // giữ nguyên hành vi cũ: để trống = lead không gắn cơ sở.
  const defaultCenterId = resolveDefaultCenterId(
    getModelVisibleCenterIds("Lead", actor),
    session.user.centerId,
  );
  const defaultOrgUnitId = defaultCenterId ? await orgUnitIdForCenter(defaultCenterId) : null;
  const courseByKey = new Map<string, string>();
  for (const c of courses) {
    courseByKey.set(c.name.trim().toLowerCase(), c.id);
    if (c.slug) courseByKey.set(c.slug.trim().toLowerCase(), c.id);
  }

  // ── BẢNG TRA SALE cho cột "Sale phụ trách" (tuỳ chọn, 04/09/2026) ─────────
  //
  // Nhận EMAIL hoặc MÃ NHÂN VIÊN — người nhập cầm bảng nào thì gõ bảng đó.
  // Chỉ lấy người CÓ vai SALES_CSM: giao lead cho người không phải sale là giao
  // vào chỗ không ai xử lý.
  //
  // Tra MỘT LẦN cho cả file thay vì mỗi dòng một truy vấn: file 300 dòng thì
  // cách kia là 300 lượt đi DB cho một cột tuỳ chọn.
  const saleUsers = await sdb.user.findMany({
    where: { roles: { has: "SALES_CSM" }, deletedAt: null },
    select: { id: true, email: true, isActive: true, deletedAt: true, centerId: true, employee: { select: { employeeCode: true } } },
  });
  const saleByKey = new Map<string, (typeof saleUsers)[number]>();
  for (const u of saleUsers) {
    if (u.email) saleByKey.set(u.email.trim().toLowerCase(), u);
    const ma = u.employee?.employeeCode;
    if (ma) saleByKey.set(ma.trim().toLowerCase(), u);
  }

  const errors: ImportError[] = [];
  type Valid = {
    parentName: string;
    phone: string;
    email: string | null;
    childName: string | null;
    childAge: number | null;
    centerId: string | null;
    orgUnitId: string | null;
    courseId: string | null;
    source: string;
    /**
     * Nguồn NGƯỜI TA THỰC SỰ GÕ (`null` = ô trống) — chỉ dùng cho đường CẬP NHẬT.
     * Xem `ParsedLeadRow.sourceRaw`: mặc định "Import Excel" đúng cho lượt TẠO nhưng ở lượt
     * cập nhật nó biến ô trống thành lệnh ghi đè nguồn thật.
     */
    sourceRaw: string | null;
    note: string | null;
    /** Sale được chỉ định trên dòng Excel. `null` = để trống ⇒ máy chia. */
    saleId: string | null;
  };
  // Gộp con (1 PH nhiều con): nhóm theo SĐT. 26/07 — GỘP TỰ ĐỘNG, không cần bấm
  // "Xác nhận gộp con" nữa: các dòng cùng SĐT (kể cả ghi KHÁC tên phụ huynh — bố/mẹ
  // ghi khác nhau) coi như CÙNG MỘT NHÀ, con dồn vào 1 lead. Tên PH khác được ghi lại
  // trong hoạt động lead để sale đối chiếu, KHÔNG ghi đè tên đang có.
  type Child = { name: string | null; age: number | null };
  type Group = {
    base: Valid;
    children: Child[];
    otherParentNames: string[];
    /**
     * Có dòng nào của nhóm SĐT này được tick "ghi đè" không.
     *
     * Nhiều dòng Excel cùng SĐT = MỘT nhà = một lead, nên lệnh ghi đè cũng phải gộp về một.
     * Gộp bằng HOẶC (tick một dòng là cả nhóm đè) chứ không phải VÀ: người vận hành tick
     * theo từng dòng họ NHÌN THẤY trên màn hình, và cái họ vừa nói là "bản trong file mới
     * hơn". Bắt tick đủ cả ba dòng con mới được đè là một luật không ai đoán ra, và lúc nó
     * nuốt lệnh thì nuốt im lặng.
     */
    ghiDe: boolean;
  };
  const groups = new Map<string, Group>();

  for (let i = 0; i < parsed.length; i++) {
    const rowNo = i + 2;
    const p = parsed[i];
    if (!p.ok) {
      errors.push({ row: rowNo, error: p.error });
      continue;
    }
    const d = p.data;

    let centerId: string | null = defaultCenterId;
    let orgUnitId: string | null = defaultOrgUnitId;
    if (d.centerCode) {
      centerId = centerByCode.get(d.centerCode) ?? null;
      orgUnitId = orgUnitByCode.get(d.centerCode) ?? null;
      // HO không có Center row → cho phép nếu khớp OrgUnit theo mã.
      if (!centerId && !orgUnitId) {
        errors.push({ row: rowNo, error: `Không tìm thấy cơ sở ${d.centerCode}` });
        continue;
      }
    }

    let courseId: string | null = null;
    if (d.courseRaw) {
      courseId = courseByKey.get(d.courseRaw.trim().toLowerCase()) ?? null;
      if (!courseId) {
        errors.push({ row: rowNo, error: `Khoá "${d.courseRaw}" không khớp khoá có thật` });
        continue;
      }
    }

    // ── SALE PHỤ TRÁCH (cột tuỳ chọn) ──────────────────────────────────────
    //
    // Để trống ⇒ `null` ⇒ máy chia theo vòng luân phiên (chủ dự án chốt 04/09).
    //
    // Gõ sai thì CẢNH BÁO rồi vẫn nhận dòng, KHÔNG bỏ dòng: mất một lead thật vì
    // gõ sai một ô TUỲ CHỌN là đổi hỏng lấy hỏng. Lead đó rơi về máy chia — vẫn
    // có người nhận, và dòng cảnh báo nói rõ để người nhập sửa lại sau.
    let saleId: string | null = null;
    if (d.saleRaw) {
      const u = saleByKey.get(d.saleRaw.trim().toLowerCase());
      if (!u) {
        errors.push({
          row: rowNo,
          error: `⚠️ Không tìm thấy sale "${d.saleRaw}" — để máy chia dòng này.`,
        });
      } else {
        // Cùng luật với ô gán sale trên trang lead: còn làm việc, có gắn cơ sở, và
        // đúng cơ sở của lead (trừ khi người nhập ở cấp Hội sở, được điều liên cơ sở).
        const guard = canManualAssign({
          sale: u,
          leadCenterId: centerId,
          actorIsHoLevel: actor.isHoLevel,
        });
        if (!guard.ok) {
          errors.push({ row: rowNo, error: `⚠️ ${d.saleRaw}: ${guard.error} Để máy chia dòng này.` });
        } else {
          saleId = u.id;
        }
      }
    }

    if (!passesScope("Lead", { centerId }, actor)) {
      errors.push({
        row: rowNo,
        error: d.centerCode
          ? `Cơ sở "${d.centerCode}" ngoài phạm vi quyền của bạn`
          : "Lead không gắn cơ sở cần quyền HO/SUPER_ADMIN",
      });
      continue;
    }

    const g = groups.get(d.phone);
    if (g) {
      // Trùng SĐT trong file → gộp con vào lead của nhóm (tự động).
      g.children.push({ name: d.childName, age: d.childAge });
      // Nhiều dòng cùng SĐT = một nhà = MỘT lead. Dòng đầu tiên có ghi sale thì
      // lấy; các dòng sau không ghi đè — người nhập ghi hai sale khác nhau cho
      // cùng một số là mâu thuẫn trong chính file họ, và im lặng chọn dòng cuối
      // thì kết quả phụ thuộc thứ tự dòng.
      if (!g.base.saleId && d.saleRaw) {
        const u = saleByKey.get(d.saleRaw.trim().toLowerCase());
        if (u) {
          const guard = canManualAssign({
            sale: u,
            leadCenterId: g.base.centerId,
            actorIsHoLevel: actor.isHoLevel,
          });
          if (guard.ok) g.base.saleId = u.id;
        }
      }
      if (normalizeVi(d.parentName) !== normalizeVi(g.base.parentName)) {
        g.otherParentNames.push(d.parentName);
      }
      // Gộp bằng HOẶC — xem chú thích `Group.ghiDe`.
      if (ghiDeIdx.has(i)) g.ghiDe = true;
      continue;
    }
    groups.set(d.phone, {
      base: {
        parentName: d.parentName,
        phone: d.phone,
        email: d.email,
        childName: d.childName,
        childAge: d.childAge,
        centerId,
        orgUnitId,
        courseId,
        source: d.source,
        sourceRaw: d.sourceRaw,
        note: d.note,
        saleId,
      },
      children: [{ name: d.childName, age: d.childAge }],
      otherParentNames: [],
      ghiDe: ghiDeIdx.has(i),
    });
  }

  // Đối chiếu lead đã tồn tại (theo SĐT) — dedupe TOÀN HỆ THỐNG. sdb ẩn lead cơ sở
  // khác → bypass HẸP (id/phone/centerId + tên PH/tên con để dedupe khi GỘP, không lộ
  // note/email) + ghi audit AC10. 26/07 — SĐT đã có trong CRM thì LUÔN gộp con vào lead
  // cũ (không tạo lead trùng số, không cần xác nhận), kể cả khi file ghi khác tên PH.
  type MergeOp = {
    leadId: string;
    phone: string;
    children: Child[];
    legacyChild: Child | null; // childName cũ (backfill thành LeadChild khi children[] rỗng)
    existingNames: string[];
    /** Tên PH trong file khác tên PH của lead cũ → ghi vào nhật ký kèm lượt cập nhật. */
    otherParentNames: string[];
    /** Ảnh chụp lead đang có — đầu vào của luật ghi đè. */
    cu: OLeadDangCo;
    /** Giá trị file mang tới cho chính lead này. */
    file: OLeadTuFile;
    /** Sale ghi đích danh trong file (nếu có) — truyền cho vòng chia. */
    saleId: string | null;
    /** Lead còn được chia lại không — xem `conMoDeChiaLai`. */
    chiaLai: boolean;
    /** Người vận hành đã tick "ghi đè" cho nhóm SĐT này chưa. */
    ghiDe: boolean;
  };
  const mergeOps: MergeOp[] = [];
  if (groups.size > 0) {
    if (getModelVisibleCenterIds("Lead", actor) !== "ALL") {
      await logScopeBypass(actor, "import/leads: dedupe SĐT lead toàn hệ thống");
    }
    const existing = await scopedDb(actor, { bypass: true }).lead.findMany({
      // AUTH-SĐT P1 — xem "phoneVariants" trong lib/phone.ts.
      where: { phone: { in: expandPhoneVariants([...groups.keys()]) }, deletedAt: null },
      select: {
        id: true,
        phone: true,
        centerId: true,
        parentName: true,
        childName: true,
        childAge: true,
        // 15/09/2026 — bốn cột dưới đây nạp thêm cho LUẬT GHI ĐÈ: phải so được giá trị cũ
        // với giá trị file thì mới biết cột nào THỰC SỰ đổi, và mới nối được ghi chú thay vì
        // đè lên nó.
        email: true,
        courseId: true,
        source: true,
        note: true,
        // Hai cột quyết định có chia lại hay không. `status` một mình là thiếu — xem
        // `conMoDeChiaLai`.
        status: true,
        convertedAt: true,
        children: { select: { fullName: true } },
      },
    });
    for (const ex of existing) {
      const g = groups.get(phoneKey(ex.phone));
      if (!g) continue;
      groups.delete(phoneKey(ex.phone));
      // Gộp = GHI vào lead cũ → phải trong phạm vi quyền (không gộp chéo cơ sở).
      if (!passesScope("Lead", { centerId: ex.centerId }, actor)) {
        errors.push({
          row: 0,
          error: `SĐT ${ex.phone} thuộc lead cơ sở khác — không thể gộp (liên hệ HO)`,
        });
        continue;
      }
      const fileNames = [g.base.parentName, ...g.otherParentNames];
      mergeOps.push({
        leadId: ex.id,
        phone: ex.phone,
        children: g.children,
        legacyChild: ex.childName ? { name: ex.childName, age: ex.childAge } : null,
        existingNames: ex.children.map((c) => c.fullName),
        cu: ex,
        file: {
          parentName: g.base.parentName,
          email: g.base.email,
          childName: g.base.childName,
          childAge: g.base.childAge,
          centerId: g.base.centerId,
          orgUnitId: g.base.orgUnitId,
          courseId: g.base.courseId,
          // ⚠️ `sourceRaw`, KHÔNG phải `source`: xem `ParsedLeadRow.sourceRaw`.
          source: g.base.sourceRaw,
          note: g.base.note,
        },
        saleId: g.base.saleId,
        ghiDe: g.ghiDe,
        chiaLai: conMoDeChiaLai({
          status: ex.status,
          convertedAt: ex.convertedAt,
          trangThaiDong: TERMINAL_LEAD_STATUSES,
        }),
        otherParentNames: [
          ...new Set(fileNames.filter((n) => normalizeVi(n) !== normalizeVi(ex.parentName))),
        ],
      });
    }
  }

  if (groups.size === 0 && mergeOps.length === 0) {
    return NextResponse.json({ success: 0, errors });
  }

  const { actorId, actorName } = getAuditActor(session);
  let success = 0;
  let mergedChildren = 0;
  let mergedLeads = 0;
  // Mang theo sale được chỉ định để vòng chia bên dưới truyền `explicitOwnerId`.
  const createdIds: { id: string; saleId: string | null }[] = [];
  // Lead ĐÃ CÓ vừa được cập nhật và còn đủ điều kiện chia lại — dồn chung vào vòng chia bên
  // dưới. Trước 15/09 mảng này không tồn tại: lead trùng không đi qua vòng chia nên nó ở
  // nguyên với sale cũ, đúng thứ chủ dự án yêu cầu bỏ.
  const chiaLaiOps: { id: string; saleId: string | null }[] = [];
  // MỘT mốc cho cả lượt, dùng ở HAI chỗ: `lastInboundAt` của mọi dòng, và `dedupeKey` của
  // tin gộp. Tính lại ở mỗi chỗ là hai lượt nhập cách nhau một nhịp đồng hồ cũng ra hai
  // khoá — đúng thứ khoá chống trùng sinh ra để chặn.
  const mocNhap = new Date();
  const mocLuot = mocNhap.getTime();
  try {
    await sdb.$transaction(
      async (tx) => {
      for (const g of groups.values()) {
        const v = g.base;
        // Nhiều con (đã xác nhận gộp trong file) → tạo LeadChild cho các con CÓ TÊN
        // (convention R7-01 như import "đã đăng ký"); childName legacy = con đầu.
        const namedChildren =
          g.children.length > 1
            ? g.children.filter((c) => c.name && c.name.trim())
            : [];
        const created = await tx.lead.create({
          data: {
            parentName: v.parentName,
            phone: v.phone,
            email: v.email,
            childName: v.childName,
            childAge: v.childAge,
            centerId: v.centerId,
            orgUnitId: v.orgUnitId, // dual-write 2-phase
            courseId: v.courseId,
            source: v.source,
            note: v.note,
            status: "MOI",
            // 15/09/2026 — BẮT BUỘC. Danh sách /leads sắp theo `lastInboundAt` với
            // `nulls: 'last'`, nên lead tạo mà bỏ trống cột này bị đẩy xuống CUỐI mọi
            // trang — người dùng báo "nhập xong không thấy lead đâu", nhưng tìm theo
            // SĐT/nguồn thì lại ra (tập kết quả nhỏ nên nó lọt trang 1).
            // Quy ước: lúc tạo, `lastInboundAt` = `createdAt`; `laNhapLai()` chỉ đúng
            // khi nó LỚN HƠN `createdAt`. Xem `lib/tables/lead-columns.ts`.
            lastInboundAt: mocNhap,
            ...(namedChildren.length > 0
              ? {
                  children: {
                    create: namedChildren.map((c) => ({
                      fullName: c.name!.trim(),
                      ageYears: c.age,
                    })),
                  },
                }
              : {}),
            activities: {
              create: {
                actorId,
                actorName,
                type: "NOTE",
                content:
                  (g.children.length > 1
                    ? `Nhập lead từ Excel (sự kiện) — gộp ${g.children.length} con cùng SĐT`
                    : "Nhập lead từ Excel (sự kiện)") +
                  (g.otherParentNames.length > 0
                    ? ` · file còn ghi tên PH khác cùng số: ${g.otherParentNames.join(", ")}`
                    : ""),
                metadata: { system: true },
              },
            },
          },
          select: { id: true },
        });
        createdIds.push({ id: created.id, saleId: g.base.saleId });
        success++;
      }

      // ── NHẬP LẠI LEAD ĐÃ CÓ ───────────────────────────────────────────────────
      //
      // 15/09/2026 — chủ dự án chốt đổi hẳn ngữ nghĩa. TRƯỚC đây đường này chỉ GỘP CON:
      // thêm `LeadChild` nào chưa có tên, còn tên PH / email / nguồn / khoá / ghi chú trong
      // file thì BỎ QUA hoàn toàn (tên PH khác chỉ ghi vào nhật ký). Con đã có sẵn thì dòng
      // đó không làm gì cả, báo "ℹ️ không thêm gì". Và lead trùng KHÔNG đi qua vòng chia nên
      // nó ở nguyên với sale cũ.
      //
      // NAY: "ghi đè các thông tin cũ, thông tin nào chưa có thì fill vào" + chia lại lead.
      // Luật ghi đè nằm ở `lib/lead/nhap-trung.ts` (hàm thuần, có test) chứ không trải ra
      // đây — đây là chỗ DUY NHẤT trong repo cố ý ghi đè dữ liệu người dùng nhập tay, và
      // một phép ghi đè viết lỏng tay không ném lỗi, không làm test đỏ.
      for (const m of mergeOps) {
        const banCapNhat = dungBanCapNhatLeadTrung({
          cu: m.cu,
          file: m.file,
          moc: mocNhap,
          ghiDe: m.ghiDe,
        });

        // Con: vẫn THÊM theo tên chuẩn hoá (không xoá con cũ — file thiếu một con không có
        // nghĩa là đứa đó nghỉ học). Backfill `childName` legacy thành `LeadChild` để danh
        // sách con đầy đủ.
        const seen = new Set(m.existingNames.map((n) => normalizeVi(n)));
        if (m.legacyChild?.name) seen.add(normalizeVi(m.legacyChild.name));
        const toCreate: Child[] = [];
        if (m.existingNames.length === 0 && m.legacyChild?.name) {
          toCreate.push(m.legacyChild); // backfill con cũ
        }
        let added = 0;
        for (const ch of m.children) {
          const name = ch.name?.trim();
          if (!name) continue;
          if (seen.has(normalizeVi(name))) continue;
          seen.add(normalizeVi(name));
          toCreate.push(ch);
          added++;
        }

        const phanCon =
          added > 0 ? ` · thêm ${added} con vào lead` : "";
        const phanTenKhac =
          m.otherParentNames.length > 0
            ? ` · file còn ghi tên PH khác cùng số: ${m.otherParentNames.join(", ")}`
            : "";

        await tx.lead.update({
          where: { id: m.leadId },
          data: {
            ...banCapNhat.data,
            ...(toCreate.length > 0
              ? {
                  children: {
                    create: toCreate.map((c) => ({
                      fullName: c.name!.trim(),
                      ageYears: c.age,
                    })),
                  },
                }
              : {}),
            activities: {
              create: {
                actorId,
                actorName,
                type: "NOTE",
                content: moTaLuotCapNhat(banCapNhat, m.chiaLai) + phanCon + phanTenKhac,
                metadata: { system: true, import: "event-excel", capNhat: true },
              },
            },
          },
        });

        // Ghi sổ kiểm toán cho ĐÚNG những cột vừa ghi. Nhật ký hoạt động ở trên là thứ Sale
        // đọc; `logLeadAudit` là thứ tra khi có tranh chấp "ai sửa dữ liệu của tôi".
        //
        // Từ bản chốt thứ hai (15/09) lượt nhập KHÔNG còn ghi đè ô đã có giá trị, nên sổ chỉ
        // ghi khi thực sự có ô trống được điền. Phần file ghi khác nằm ở `khacBiet` và đã đi
        // vào ghi chú — không phải một lượt sửa dữ liệu nên không vào sổ kiểm toán.
        //
        // ⚠️ 16/09 — `daDe` PHẢI nằm trong cổng này. Ghi đè là lượt sửa dữ liệu NẶNG NHẤT
        // đường này làm được: nó xoá giá trị Sale nhập tay. Bỏ sót vế đó là đúng những lượt
        // cần tra nhất lại không có dòng nào trong sổ, còn lượt vô hại (điền ô trống) thì
        // có — sổ kiểm toán im lặng ở đúng chỗ tranh chấp.
        if (banCapNhat.daDien.length > 0 || banCapNhat.daDe.length > 0) {
          await logLeadAudit({
            leadId: m.leadId,
            action: "UPDATE",
            actorId,
            actorName,
            oldValues: Object.fromEntries(
              Object.keys(banCapNhat.data)
                .filter((k) => k !== "lastInboundAt")
                .map((k) => [k, (m.cu as Record<string, unknown>)[k] ?? null]),
            ),
            newValues: banCapNhat.data,
            changedFields: Object.keys(banCapNhat.data).filter((k) => k !== "lastInboundAt"),
            reason: "Nhập lại từ file Excel",
            // `sdb.$transaction` đưa ra một client ĐÃ BỌC phạm vi, kiểu không khớp
            // `Prisma.TransactionClient` mà tầng ghi sổ khai. Cùng dạng ép kiểu với
            // `app/api/admin/import/employees/route.ts` — giữ audit NẰM TRONG transaction,
            // vì một dòng sổ ghi ngoài là dòng sổ có thể sống sót khi lượt ghi bị huỷ.
            tx: tx as unknown as Parameters<typeof logLeadAudit>[0]["tx"],
          });
          // 26/09/2026 — ô phụ huynh của phiếu đổi (tên, email…) ⇒ dội sang học viên đang
          // nối phiếu này ("đổi 1 nơi thì đổi hết" — `lib/students/dong-bo-lead.ts`). Giới hạn
          // đã biết: `sdb.$transaction` ⇒ học viên ở cơ sở NGOÀI tầm nhìn người nhập không đổi.
          await dongBoTuLead({
            tx: tx as unknown as Prisma.TransactionClient,
            leadId: m.leadId,
            truoc: m.cu as unknown as PhLead,
            sau: chiOPhLead(banCapNhat.data as Record<string, unknown>),
            actor: { id: actorId, name: actorName },
          });
        }

        mergedChildren += added;
        mergedLeads++;
        if (m.chiaLai) chiaLaiOps.push({ id: m.leadId, saleId: m.saleId });
      }
      },
      // Xem khối `maxDuration` ở đầu tệp: 5 giây mặc định của Prisma là con số dành cho
      // MỘT lệnh ghi lẻ, không phải cho vòng lặp ghi tới 5.000 dòng. 180 giây khớp với
      // `registered/route.ts` — cùng bài, cùng cách vá, đừng để hai đường nhập lead chọn
      // hai con số khác nhau rồi không ai nhớ vì sao.
      { timeout: 180_000 },
    );
  } catch (err) {
    return NextResponse.json(
      { success: 0, errors: [...errors, { row: 0, error: `Lỗi ghi: ${err instanceof Error ? err.message : "Unknown"}` }] },
      { status: 500 },
    );
  }

  // ── CHIA LEAD CHO CẢ LÔ ─────────────────────────────────────────────────────
  //
  // 29/08/2026 — đi qua `chiaChoLead` (ma trận + sổ chia lead), entryPoint `IMPORT`.
  // File nhập hiện KHÔNG có cột sale, nên mọi dòng rơi vào nhánh AUTO — đúng dòng 6
  // của ma trận. Khai `IMPORT` từ bây giờ để ngày thêm cột sale chỉ phải truyền
  // `explicitOwnerId`, không phải sửa lại chỗ này.
  //
  // ⚠️ KHÔNG bọc cả lô vào MỘT transaction dù đặc tả viết vậy. Mục đích thật của câu
  // đó là "một khoá cho cả lô, chia đúng thứ tự dòng, không xen kẽ với lead nhập tay"
  // — và điều đó đã đạt: `chiaChoLead` giành đúng một khoá theo đơn vị, các lượt
  // xếp hàng theo thứ tự vòng lặp. Bọc chung transaction thì đổi lại một thứ ĐẮT
  // HƠN NHIỀU: dòng thứ 250 hỏng là rollback cả 300 dòng đã đúng, trong khi nếp
  // đang chạy (và người vận hành đang trông đợi) là "hỏng dòng nào bỏ dòng đó".
  // 15/09/2026 — GỘP CHUÔNG. Chủ dự án chốt: "nhập nhiều thì báo là có bao nhiêu lead mới
  // chứ không gửi nhiều thông báo có lead mới".
  //
  // Nên vòng chia chạy với `imLangChuong: true`, gom người nhận lại, rồi báo MỘT lần mỗi
  // người ở cuối. Ai chỉ nhận đúng 1 lead thì vẫn dùng chuông thường — nó trỏ THẲNG trang
  // chi tiết lead, bấm là đọc được số điện thoại, hơn hẳn một tin gộp trỏ về danh sách.
  //
  // ⚠️ `imLangChuong` CHỈ tắt nửa BÁO. Nửa THU HỒI chuông chủ cũ vẫn chạy bên trong
  // `chiaChoLead` — xem chú thích của cờ đó.
  const daChia: { leadId: string; ownerId: string }[] = [];

  // Lead MỚI TẠO và lead VỪA CẬP NHẬT đi chung một vòng: cùng một ma trận, cùng một sổ lượt,
  // cùng thứ tự dòng. Tách hai vòng là mời hai luật chia khác nhau ra đời.
  for (const { id, saleId } of [...createdIds, ...chiaLaiOps]) {
    const lead = await sdb.lead.findUnique({
      where: { id },
      select: { centerId: true },
    });
    if (!lead?.centerId) {
      // Chưa biết cơ sở thì chưa có pool nào để hỏi — đường cũ còn biết CHỌN cơ sở.
      await autoAssignNewLead(id, { actorId, actorName }).catch((err) =>
        console.error("[import/leads] auto-assign error:", err),
      );
      continue;
    }
    const kq = await chiaChoLead(id, {
      targetCenterId: lead.centerId,
      createdById: actorId,
      entryPoint: "IMPORT",
      // Có ghi sale ⇒ giao đích danh, KHÔNG tiêu lượt (ma trận, ca IMPORT).
      // Để trống ⇒ `null` ⇒ về vòng chia và CÓ tiêu lượt.
      explicitOwnerId: saleId,
      imLangChuong: true,
    }).catch((err) => {
      console.error("[import/leads] chia lead:", err);
      return null;
    });
    if (kq?.assignedToId) daChia.push({ leadId: id, ownerId: kq.assignedToId });
  }

  // Báo một lần cho mỗi người nhận. Nuốt lỗi: chuông hỏng không được làm hỏng lượt nhập.
  await baoLoLeadMoi({
    daChia,
    nguon: { kieu: "nhap_danh_sach" },
    mocLuot,
    boQuaNguoi: actorId,
  });

  // Con thêm vào lead có sẵn là việc PHỤ của lượt cập nhật — không phải một con số ngang hàng
  // với "bao nhiêu lead", nên nó đi vào ghi chú chứ không vào thẻ đếm.
  if (mergedChildren > 0) {
    errors.push({
      row: 0,
      error: `ℹ️ Đã thêm ${mergedChildren} con vào lead có sẵn cùng SĐT (không tạo lead trùng số)`,
    });
  }
  // Lead đã chốt thì giữ nguyên người phụ trách — nói ra để người nhập không tưởng hệ thống
  // quên chia. Im lặng ở đây là để họ tự đoán, và đoán sai theo hướng nghi hệ thống hỏng.
  const giuNguyenChu = mergedLeads - chiaLaiOps.length;
  if (giuNguyenChu > 0) {
    errors.push({
      row: 0,
      error:
        `ℹ️ ${giuNguyenChu} lead đã chốt/đã ghi danh: thông tin vẫn được cập nhật nhưng ` +
        `GIỮ NGUYÊN tư vấn viên đang phụ trách (hoa hồng đã tính theo người đó)`,
    });
  }
  revalidatePath("/leads");
  return NextResponse.json({ success, updated: mergedLeads, errors });
}
