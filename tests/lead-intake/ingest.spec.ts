import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ingestIntakeLead as ingestIntakeLeadGoc, type IntakeContext } from "../../lib/lead/intake/ingest";
import { KHONG_CO_TIN_HIEU_NGUON } from "../../lib/nguon/tin-hieu";
import { mapSaleForm, SALE_FORM_FIELDS } from "../../lib/lead/intake/map-sale-form";
import { mapQuatang, quatangClientMeta } from "../../lib/lead/intake/map-quatang";
import { mapInternalForm } from "../../lib/lead/intake/map-internal-form";
import type { MappedLead } from "../../lib/lead/intake/types";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

// =============================================================================
// LEAD INTAKE · tầng DB thật (Postgres LOCAL)
//
// Phủ những thứ unit test thuần KHÔNG chạm được: tra cơ sở/chủ sở hữu trong DB,
// luật chống trùng, và QĐ-D1 "trùng SĐT nhưng KHÁC con ⇒ gắn thêm LeadChild".
//
// ⚠️ CỔNG CHẠY: chỉ chạy khi DATABASE_URL trỏ Postgres LOCAL (localhost /
// 127.0.0.1 / satarobo_test). Máy không có DB test ⇒ SKIP sạch, không đỏ CI.
//   pnpm test:lead-intake   (nhớ nạp .env.test)
// =============================================================================

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
// 16/09/2026 — dùng CỔNG DUY NHẤT `RUN_DB_TESTS` (tests/_helpers/db-gate.ts) thay cho
// biểu thức chép tay. Bản chép tay chỉ hỏi "URL có trỏ Postgres cục bộ không" nên BỎ MẤT
// cờ `ALLOW_DB_RESET` — đúng cái chốt dựng sau sự cố mất DB 04/09/2026. Hệ quả đo được:
// trên máy dev (DATABASE_URL = 127.0.0.1/satarobo_local) các bộ này CHẠY THẬT trên DB
// đang làm việc, nên `pnpm test:unit` lúc xanh lúc đỏ tuỳ thứ tự, còn `assertTestDb()`
// thì từ chối dọn ⇒ đỏ câm không liên quan gì tới mã.
const RUN = RUN_DB_TESTS;

if (!RUN) {
  console.warn(
    `[lead-intake] SKIP: DATABASE_URL không trỏ Postgres local (${
      DB_URL.replace(/:[^:@]*@/, ":***@") || "trống"
    }). Xem .claude/rules/prisma-db.md để dựng DB test.`,
  );
}

// Tiền tố riêng để dọn sạch mà không đụng dữ liệu khác trong DB test.
const P = "ITLI_";
const CODE_A = "CS91";
const CODE_B = "CS92";
const EMP_CODE = `${P}NV001`;
/** Sale thuộc CƠ SỞ B — dùng cho ca gán chéo cơ sở. */
const EMP_CODE_B = `${P}NV002`;
/** Giáo viên (KHÔNG giữ vai Sale) — mã NV hợp lệ nhưng không được nhận lead. */
const EMP_CODE_TEACHER = `${P}GV001`;

// SĐT cố định (KHÔNG sinh từ Date.now — đã burn: `% 1e8` đẻ số 9 chữ số làm
// test đỏ theo GIỜ chạy). Mỗi ca một số riêng để chạy song song không đụng nhau.
const PHONE = {
  basic: "0900000101",
  twoChildren: "0900000102",
  sameChild: "0900000103",
  altFormat: "0900000104",
  badEmployee: "0900000105",
  unknownCenter: "0900000106",
  idempotent: "0900000107",
  noCenter: "0900000108",
  crossCenter: "0900000109",
  teacherCode: "0900000110",
  dupWarnings: "0900000111",
  closedLead: "0900000112",
  quatang: "0900000113",
  webhookCuGiuChu: "0900000114",
  dangKyCungCon: "0900000115",
  daMat: "0900000116",
  moCu: "0900000117",
  matCu: "0900000118",
} as const;
const ALL_PHONES = Object.values(PHONE);
/** Cùng SĐT nhưng ghi dạng canonical — dùng cho ca "nhận ra trùng dù khác dạng". */
const ALL_CANONICAL = ALL_PHONES.map((p) => `84${p.slice(1)}`);

const db = new PrismaClient();

/**
 * PR2: `tinHieuNguon` BẮT BUỘC khai ở `IntakeContext` (luật 7). Bộ này kiểm CHỐNG TRÙNG / chia chủ / cơ sở — không bàn chuyện
 * nguồn (đã có `nguon-noi-day.spec.ts`) — nên bọc một lần ở đây thay vì sửa 31 chỗ gọi. Cờ `nguon.enabled` mặc định TẮT
 * ⇒ hành vi của bộ này KHÔNG đổi (đó cũng là bằng chứng 0-thay-đổi khi tắt cờ).
 */
const ingestIntakeLead = (m: Parameters<typeof ingestIntakeLeadGoc>[0], c: Omit<IntakeContext, "tinHieuNguon">) =>
  ingestIntakeLeadGoc(m, { ...c, tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON });

function lead(over: Partial<MappedLead> = {}): MappedLead {
  return {
    parentName: "Chị Test",
    phone: PHONE.basic,
    email: null,
    centerHint: { kind: "code", value: CODE_A },
    children: [],
    employeeCode: null,
    noteLines: [],
    externalId: null,
    consentMarketing: true,
    warnings: [],
    ...over,
  };
}

async function purge() {
  // ⚠️ Phải dọn cả OrgUnit test. `nonEnrollableCenterIds` có đường thoát "cây
  // OrgUnit RỖNG ⇒ không lọc gì"; để sót OrgUnit của suite này là làm mất đường
  // thoát đó cho suite khác chạy sau trên cùng DB `ci_test` — đúng cơ chế đã làm
  // 3 ca ở đây đỏ, chỉ là theo chiều ngược lại.
  await db.orgUnit.deleteMany({ where: { code: { startsWith: P } } });

  const leads = await db.lead.findMany({
    where: { phone: { in: [...ALL_PHONES, ...ALL_CANONICAL] } },
    select: { id: true },
  });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.leadActivity.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadAuditLog.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadChild.deleteMany({ where: { leadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
}

describe.skipIf(!RUN)("Lead intake · tầng DB thật", () => {
  let centerAId = "";
  let centerBId = "";

  beforeAll(async () => {
    await purge();

    const centerA = await db.center.upsert({
      where: { slug: `${P}co-so-a` },
      update: { code: CODE_A, isActive: true },
      create: {
        code: CODE_A,
        name: `${P}Cơ sở A`,
        slug: `${P}co-so-a`,
        address: "911 Đường Kiểm Thử",
        isActive: true,
      },
      select: { id: true },
    });
    centerAId = centerA.id;

    const centerB = await db.center.upsert({
      where: { slug: `${P}co-so-b` },
      update: { code: CODE_B, isActive: true },
      create: {
        code: CODE_B,
        name: `${P}Cơ sở B`,
        slug: `${P}co-so-b`,
        address: "922 Đường Kiểm Thử",
        isActive: true,
      },
      select: { id: true },
    });
    centerBId = centerB.id;

    // ⚠️ PHẢI có `OrgUnit type=CENTER` trỏ vào 2 cơ sở này.
    //
    // `resolveCenter` loại cơ sở không nhận ghi danh qua `getNonEnrollableCenterIds()`,
    // mà hàm đó định nghĩa "nhận ghi danh" = CÓ một OrgUnit type=CENTER trỏ tới
    // (lib/enrollment-flow.ts). Nó chỉ trả `[]` khi cây OrgUnit RỖNG HOÀN TOÀN.
    //
    // Hệ quả đã burn: máy dev không có OrgUnit nào ⇒ không lọc gì ⇒ xanh; còn CI
    // dùng chung DB `ci_test` với bộ test `nen` (đã seed cây OrgUnit) ⇒ cơ sở test
    // thành "mồ côi" ⇒ bị lọc ⇒ khớp cơ sở trượt ⇒ 3 ca đỏ CHỈ trên CI.
    // Dựng OrgUnit ở đây để thế giới test giống prod, thay vì nới lỏng logic thật.
    for (const [code, centerId] of [
      [CODE_A, centerA.id],
      [CODE_B, centerB.id],
    ] as const) {
      await db.orgUnit.upsert({
        where: { code: `${P}${code}` },
        update: { centerId, isActive: true, deletedAt: null },
        create: {
          type: "CENTER",
          code: `${P}${code}`,
          name: `${P}OrgUnit ${code}`,
          centerId,
          path: `/${P.toLowerCase()}${code.toLowerCase()}/`,
          depth: 2,
          isActive: true,
        },
      });
    }

    // "Hội sở" giả lập — ĐÚNG hình dạng prod: `address = "Đà Nẵng"` (prisma/seed.ts).
    // CỐ Ý KHÔNG tạo OrgUnit cho nó: `Center("hoi-so")` trên prod là bản ghi MỒ CÔI.
    // Chuỗi cơ sở của quatang luôn kết thúc ", Đà Nẵng" nên nó khớp lỏng với MỌI
    // phiếu. Bản matchCenter đầu tiên coi đó là "mơ hồ" và trả null ⇒ toàn bộ
    // lead quatang mất cơ sở trên prod. Giữ dòng này để lỗi đó không quay lại.
    await db.center.upsert({
      where: { slug: `${P}hoi-so` },
      update: { code: `${P}HO`, isActive: true },
      create: {
        code: `${P}HO`,
        name: `${P}Hội sở`,
        slug: `${P}hoi-so`,
        address: "Đà Nẵng",
        isActive: true,
      },
    });

    // Sale thuộc CƠ SỞ B — để dựng ca "phiếu ghi cơ sở A, người nhập ở cơ sở B".
    const employeeB = await db.employee.upsert({
      where: { employeeCode: EMP_CODE_B },
      update: { isActive: true, centerId: centerB.id },
      create: {
        employeeCode: EMP_CODE_B,
        fullName: `${P}Sale cơ sở B`,
        jobTitle: "Tư vấn tuyển sinh",
        department: "TUYEN_SINH",
        centerId: centerB.id,
        isActive: true,
      },
      select: { id: true },
    });
    await db.user.upsert({
      where: { email: `${P}sale-b@example.test` },
      update: { isActive: true, employeeId: employeeB.id },
      create: {
        name: `${P}Sale cơ sở B`,
        email: `${P}sale-b@example.test`,
        role: "SALES_CSM",
        roles: ["SALES_CSM"],
        centerId: centerB.id,
        employeeId: employeeB.id,
        isActive: true,
      },
    });

    // Giáo viên: mã NV hợp lệ, tài khoản hoạt động, nhưng KHÔNG giữ vai Sale.
    const teacher = await db.employee.upsert({
      where: { employeeCode: EMP_CODE_TEACHER },
      update: { isActive: true, centerId: centerA.id },
      create: {
        employeeCode: EMP_CODE_TEACHER,
        fullName: `${P}Giáo viên`,
        jobTitle: "Giáo viên",
        department: "GIANG_DAY",
        centerId: centerA.id,
        isActive: true,
      },
      select: { id: true },
    });
    await db.user.upsert({
      where: { email: `${P}gv@example.test` },
      update: { isActive: true, employeeId: teacher.id },
      create: {
        name: `${P}Giáo viên`,
        email: `${P}gv@example.test`,
        role: "TEACHER",
        roles: ["TEACHER"],
        centerId: centerA.id,
        employeeId: teacher.id,
        isActive: true,
      },
    });

    const employee = await db.employee.upsert({
      where: { employeeCode: EMP_CODE },
      update: { isActive: true, centerId: centerA.id },
      create: {
        employeeCode: EMP_CODE,
        fullName: `${P}Nhân viên Sale`,
        jobTitle: "Tư vấn tuyển sinh",
        department: "TUYEN_SINH",
        centerId: centerA.id,
        isActive: true,
      },
      select: { id: true },
    });

    await db.user.upsert({
      where: { email: `${P}sale@example.test` },
      update: { isActive: true, employeeId: employee.id },
      create: {
        name: `${P}Nhân viên Sale`,
        email: `${P}sale@example.test`,
        role: "SALES_CSM",
        roles: ["SALES_CSM"],
        centerId: centerA.id,
        employeeId: employee.id,
        isActive: true,
      },
    });
  }, 120_000);

  afterAll(async () => {
    await purge();
    await db.$disconnect();
  }, 120_000);

  it("tạo Lead + LeadChild, gán đúng cơ sở theo mã", async () => {
    const r = await ingestIntakeLead(
      lead({
        phone: PHONE.basic,
        children: [{ fullName: "Bé An", schoolName: "TH Phù Đổng", gradeLevel: "Lớp 3" }],
      }),
      { source: "sale-form" },
    );

    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(false);

    const row = await db.lead.findUnique({
      where: { id: r.leadId! },
      select: { centerId: true, childName: true, phone: true, source: true },
    });
    expect(row?.centerId).toBe(centerAId);
    expect(row?.childName).toBe("Bé An");
    expect(row?.source).toBe("sale-form");
    // SĐT luôn lưu canonical 84… — dedup của repo dựa vào đó.
    expect(row?.phone).toBe("84900000101");

    const children = await db.leadChild.findMany({
      where: { leadId: r.leadId! },
      select: { fullName: true, schoolName: true, gradeLevel: true, interestedCenterId: true },
    });
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      fullName: "Bé An",
      schoolName: "TH Phù Đổng",
      gradeLevel: "Lớp 3",
      interestedCenterId: centerAId,
    });
  }, 60_000);

  // ── QĐ-D1: ca có thật trong dữ liệu quatang (1 PH, 2 con, cách nhau 2 phút) ──
  it("trùng SĐT nhưng KHÁC con ⇒ gắn thêm LeadChild vào lead cũ, KHÔNG đẻ lead mới", async () => {
    const first = await ingestIntakeLead(
      lead({ phone: PHONE.twoChildren, children: [{ fullName: "Bé Một", gradeLevel: "Lớp 3" }] }),
      { source: "quatang" },
    );
    expect(first.ok).toBe(true);

    const second = await ingestIntakeLead(
      lead({ phone: PHONE.twoChildren, children: [{ fullName: "Bé Hai", gradeLevel: "Lớp 8" }] }),
      { source: "quatang" },
    );

    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.childAdded).toBe(true);
    expect(second.leadId).toBe(first.leadId);

    const children = await db.leadChild.findMany({
      where: { leadId: first.leadId! },
      select: { fullName: true },
      orderBy: { createdAt: "asc" },
    });
    expect(children.map((c) => c.fullName)).toEqual(["Bé Một", "Bé Hai"]);

    // Chỉ đúng 1 lead cho SĐT này.
    const count = await db.lead.count({ where: { phone: "84900000102" } });
    expect(count).toBe(1);

    // Người xử lý phải thấy được chuyện gì vừa xảy ra.
    const notes = await db.leadActivity.findMany({
      where: { leadId: first.leadId! },
      select: { content: true },
    });
    expect(notes.some((n) => n.content.includes("[Thêm con]"))).toBe(true);
  }, 60_000);

  it("trùng SĐT + CÙNG tên con ⇒ không thêm LeadChild (chống bấm gửi 2 lần)", async () => {
    const first = await ingestIntakeLead(
      lead({ phone: PHONE.sameChild, children: [{ fullName: "Bé Trùng" }] }),
      { source: "sale-form" },
    );
    // Khác dấu/hoa-thường vẫn phải coi là cùng một đứa.
    const second = await ingestIntakeLead(
      lead({ phone: PHONE.sameChild, children: [{ fullName: "bé trùng" }] }),
      { source: "sale-form" },
    );

    expect(second.duplicate).toBe(true);
    expect(second.childAdded).toBe(false);
    expect(
      await db.leadChild.count({ where: { leadId: first.leadId! } }),
    ).toBe(1);
  }, 60_000);

  it("SĐT ghi khác dạng (0… và 84…) vẫn nhận ra là trùng", async () => {
    const first = await ingestIntakeLead(lead({ phone: PHONE.altFormat }), {
      source: "sale-form",
    });
    const second = await ingestIntakeLead(
      lead({ phone: `84${PHONE.altFormat.slice(1)}` }),
      { source: "sale-form" },
    );

    expect(second.duplicate).toBe(true);
    expect(second.leadId).toBe(first.leadId);
  }, 60_000);

  it("mã NV có thật ⇒ gán thẳng cho người đó (assignedTo + assignedAt)", async () => {
    const r = await ingestIntakeLead(
      lead({ phone: PHONE.noCenter, employeeCode: EMP_CODE, centerHint: null }),
      { source: "sale-form" },
    );

    const row = await db.lead.findUnique({
      where: { id: r.leadId! },
      select: {
        status: true,
        assignedAt: true,
        centerId: true,
        assignedTo: { select: { email: true } },
      },
    });
    expect(row?.assignedTo?.email).toBe(`${P}sale@example.test`);
    // GĐ5 gỡ bậc ASSIGNED khỏi phễu: "đã phân công" nay đọc ở `assignedToId`/`assignedAt`
    // (hai dòng quanh đây), còn status ở lại MOI. Giữ dòng này để bắt trường hợp việc
    // gán người lỡ tay đẩy lead sang bậc khác.
    expect(row?.status).toBe("MOI");
    expect(row?.assignedAt).not.toBeNull();
    // Không chọn cơ sở trên phiếu ⇒ lấy cơ sở của chính nhân viên nhập.
    expect(row?.centerId).toBe(centerAId);
  }, 60_000);

  it("webhook CŨ + mã NV có thật ⇒ GIỮ chủ theo mã, KHÔNG bị vòng chia đè", async () => {
    // HỒI QUY 05/09/2026 — mã giới thiệu trên link bị ghi đè im lặng.
    //
    // Bốn webhook công khai (facebook · google-form · quatang · zalo) đi `ingestLead`
    // với `legacyWebhook: true`. Khi ĐÃ biết cơ sở, khối tạo lead gán sẵn chủ theo mã NV
    // rồi `autoAssignLead` rút một người khác từ vòng chia và ĐÈ LÊN — không lỗi nào nổ.
    // `autoAssignNewLead` không dính vì nó tự thoát khi lead đã có chủ
    // (`lib/lead/auto-assign.ts:174`); chênh lệch giữa hai hàm chính là gốc của bug.
    //
    // ⚠️ CA NÀY PHẢI TỰ DỰNG ĐỦ BỐI CẢNH, và mỗi mảnh đều là một cách nó từng XANH GIẢ:
    //   1. OrgUnit cho cơ sở — thiếu thì `autoAssignLead` thoát ngay ở "Lead chưa thuộc
    //      cơ sở nào" và chẳng đè gì cả.
    //   2. HAI sale — một người thì vòng chia rút lại đúng người cũ, việc đè vô hình.
    //   3. Sổ lượt ĐẶT SẴN lệch hẳn — không thì kết quả phụ thuộc vòng đang ở bước nào,
    //      và ca đỏ/xanh theo thứ tự chạy. Đo tay đã thấy: cùng một chủ, lead thứ nhất
    //      không đổi tay còn lead thứ hai thì đổi.
    const hau = `${P}WH${Date.now().toString(36).slice(-5)}`;
    const coSo = await db.center.create({
      data: { code: hau, name: `Cơ sở ${hau}`, slug: hau.toLowerCase(), address: "x" },
      select: { id: true },
    });
    const donVi = await db.orgUnit.create({
      data: { code: `OU_${hau}`, name: `Đơn vị ${hau}`, type: "CENTER", centerId: coSo.id },
      select: { id: true },
    });
    const nhanVien = await db.employee.create({
      data: {
        employeeCode: `${hau}_NV`,
        fullName: `${P}NV mang mã`,
        jobTitle: "Tư vấn tuyển sinh",
        department: "TUYEN_SINH",
        centerId: coSo.id,
        isActive: true,
      },
      select: { id: true },
    });
    const chuTheoMa = await db.user.create({
      data: {
        email: `${hau}_chu@example.test`,
        name: `${P}Chủ theo mã`,
        role: "SALES_CSM",
        roles: ["SALES_CSM"],
        centerId: coSo.id,
        employeeId: nhanVien.id,
        isActive: true,
      },
      select: { id: true },
    });
    const nguoiVongChia = await db.user.create({
      data: {
        email: `${hau}_vong@example.test`,
        name: `${P}Người vòng chia`,
        role: "SALES_CSM",
        roles: ["SALES_CSM"],
        centerId: coSo.id,
        isActive: true,
      },
      select: { id: true },
    });
    // Ép vòng chia CHẮC CHẮN rút `nguoiVongChia`: người kia nhiều lượt hơn hẳn.
    await db.leadRotationTurn.createMany({
      data: [
        { orgUnitId: donVi.id, userId: chuTheoMa.id, turns: 99, seedTurns: 0, lastTurnAt: new Date() },
        { orgUnitId: donVi.id, userId: nguoiVongChia.id, turns: 0, seedTurns: 0, lastTurnAt: null },
      ],
    });

    try {
      const r = await ingestIntakeLead(
        lead({
          phone: PHONE.webhookCuGiuChu,
          employeeCode: `${hau}_NV`,
          centerHint: { kind: "code", value: hau },
        }),
        { source: "quatang", legacyWebhook: true },
      );

      const row = await db.lead.findUnique({
        where: { id: r.leadId! },
        select: { centerId: true, assignedToId: true, assignedAt: true },
      });
      expect(row?.centerId).toBe(coSo.id);
      expect(row?.assignedAt).not.toBeNull();
      // Chủ phải là người MANG MÃ NV — không phải người vòng chia rút ra.
      expect(row?.assignedToId).toBe(chuTheoMa.id);
      expect(row?.assignedToId).not.toBe(nguoiVongChia.id);
    } finally {
      await db.lead.deleteMany({ where: { centerId: coSo.id } });
      await db.leadRotationTurn.deleteMany({ where: { orgUnitId: donVi.id } });
      await db.orgUnit.delete({ where: { id: donVi.id } });
      await db.user.deleteMany({ where: { id: { in: [chuTheoMa.id, nguoiVongChia.id] } } });
      await db.employee.delete({ where: { id: nhanVien.id } });
      await db.center.delete({ where: { id: coSo.id } });
    }
  }, 60_000);

  it("mã NV không tồn tại ⇒ VẪN tạo lead, ghi cảnh báo vào note (không nuốt im lặng)", async () => {
    const r = await ingestIntakeLead(
      lead({ phone: PHONE.badEmployee, employeeCode: `${P}KHONG_CO` }),
      { source: "sale-form" },
    );

    expect(r.ok).toBe(true);
    const row = await db.lead.findUnique({
      where: { id: r.leadId! },
      select: { note: true },
    });
    expect(row?.note).toContain(`${P}KHONG_CO`);
    expect(row?.note).toContain("không có trong hệ thống");
  }, 60_000);

  it("cơ sở không nhận ra ⇒ tạo lead + cảnh báo, không đoán bừa cơ sở", async () => {
    const r = await ingestIntakeLead(
      lead({
        phone: PHONE.unknownCenter,
        centerHint: { kind: "text", value: "Cơ sở Sao Hoả" },
      }),
      { source: "quatang" },
    );

    const row = await db.lead.findUnique({
      where: { id: r.leadId! },
      select: { note: true },
    });
    expect(row?.note).toContain("Sao Hoả");
  }, 60_000);

  it("cùng externalId gửi 2 lần ⇒ chỉ 1 lead (idempotent)", async () => {
    const input = lead({ phone: PHONE.idempotent, externalId: "row-42" });
    const first = await ingestIntakeLead(input, { source: "quatang" });
    const second = await ingestIntakeLead(input, { source: "quatang" });

    expect(second.duplicate).toBe(true);
    expect(second.leadId).toBe(first.leadId);
    expect(await db.lead.count({ where: { eventId: "quatang:row-42" } })).toBe(1);
  }, 60_000);

  // ── Các ca vá sau vòng review đối kháng 16/08 ────────────────────────────

  it("mã NV KHÔNG giữ vai Sale (giáo viên) ⇒ không gán cho họ, và KHÔNG cảnh báo", async () => {
    const r = await ingestIntakeLead(
      lead({ phone: PHONE.teacherCode, employeeCode: EMP_CODE_TEACHER }),
      { source: "sale-form" },
    );

    const row = await db.lead.findUnique({
      where: { id: r.leadId! },
      select: {
        note: true,
        assignedTo: { select: { email: true, role: true } },
      },
    });
    // Bất biến của repo: chủ lead luôn là Sale. Giáo viên KHÔNG được nhận.
    expect(row?.assignedTo?.email).not.toBe(`${P}gv@example.test`);
    if (row?.assignedTo) expect(row.assignedTo.role).toBe("SALES_CSM");
    // 24/08 — KHÔNG còn câu cảnh báo: đây là đường đi bình thường (Marketing/Sale Hội sở,
    // giáo viên thu số ở sự kiện), không phải sự cố.
    //
    // `?? ""` là cần thiết chứ không phải cho chắc: ca này dựng `MappedLead` THẲNG,
    // không qua mapper, nên `noteLines` rỗng — bỏ nốt câu cảnh báo thì
    // `buildNote([], [])` trả `null`, và `.not.toContain` trên `null` là lỗi KIỂU
    // chứ không phải sai hành vi (đã làm đỏ CI ngay lần đầu).
    expect(row?.note ?? "").not.toContain("không giữ vai Sale");
    // Và câu đó cũng không về tới người vừa gõ phiếu qua `warnings`.
    // Cố ý KHÔNG assert `warnings` RỖNG: tuỳ cơ sở của tài khoản giáo viên trong
    // seed, nhánh "người nhập thuộc cơ sở khác" vẫn có thể kêu — đó là cảnh báo
    // KHÁC và vẫn đúng. Chỉ khoá đúng câu đã gỡ.
    expect((r.warnings ?? []).join(" ")).not.toContain("không giữ vai Sale");
    // Công người mang lead về không mất — nhưng dòng "Nhân viên nhập: <mã>" do
    // MAPPER ghi, nên bất biến đó khoá ở map-sale-form.test.ts chứ không phải ở đây.
  }, 60_000);

  it("người nhập ở cơ sở KHÁC cơ sở trên phiếu ⇒ không gán chéo (lead không thành vô hình)", async () => {
    const r = await ingestIntakeLead(
      lead({
        phone: PHONE.crossCenter,
        centerHint: { kind: "code", value: CODE_A }, // gia đình học ở cơ sở A
        employeeCode: EMP_CODE_B, // người nhập thuộc cơ sở B
      }),
      { source: "sale-form" },
    );

    const row = await db.lead.findUnique({
      where: { id: r.leadId! },
      select: {
        centerId: true,
        note: true,
        assignedTo: { select: { email: true, centerId: true } },
      },
    });

    // Cơ sở của GIA ĐÌNH thắng — đó mới là nơi phục vụ.
    expect(row?.centerId).toBe(centerAId);
    // Và tuyệt đối không được gán cho người ở cơ sở B: `scopedDb` sẽ giấu lead
    // này khỏi chính họ, trong khi auto-chia đã thoát sớm ⇒ lead nằm chết.
    expect(row?.assignedTo?.email).not.toBe(`${P}sale-b@example.test`);
    if (row?.assignedTo?.centerId) {
      expect(row.assignedTo.centerId).toBe(centerAId);
    }
    expect(row?.note).toContain("thuộc cơ sở khác");
  }, 60_000);

  it("trùng SĐT ⇒ cảnh báo KHÔNG bị nuốt, phải xuất hiện trên lead cũ", async () => {
    const first = await ingestIntakeLead(
      lead({ phone: PHONE.dupWarnings, children: [{ fullName: "Bé Đầu" }] }),
      { source: "sale-form" },
    );

    await ingestIntakeLead(
      lead({
        phone: PHONE.dupWarnings,
        children: [{ fullName: "Bé Sau" }],
        employeeCode: `${P}MA_SAI`,
        noteLines: ["Tỉnh/TP: Đà Nẵng"],
      }),
      { source: "sale-form" },
    );

    const acts = await db.leadActivity.findMany({
      where: { leadId: first.leadId! },
      select: { content: true },
    });
    const all = acts.map((a) => a.content).join("\n");
    expect(all).toContain("[Phiếu mới cùng SĐT]");
    expect(all).toContain(`${P}MA_SAI`);
    expect(all).toContain("Tỉnh/TP: Đà Nẵng");
  }, 60_000);

  // ── CHỐNG TRÙNG SĐT — luật chốt 26/09/2026 ──────────────────────────────────
  // Sự cố prod 26/09: 0368829724 (hồ sơ ĐÃ ĐĂNG KÝ ⇒ phiếu con thứ hai đẻ lead MỚI, rồi
  // đẻ đơn thứ hai) và 0985779965 (lead nhập từ sheet lùi `createdAt` về 21/05 ⇒ quá cửa
  // sổ 90 ngày ⇒ lead mới dù lead cũ VẪN ĐANG MỞ). Chủ dự án chốt:
  //   · lead còn mở (mọi trạng thái trừ DA_MAT) ⇒ LUÔN gộp, không xét tuổi hồ sơ;
  //   · lead ĐÃ ĐĂNG KÝ ⇒ gộp, gắn con mới vào + ghi rõ "có con mới cần tư vấn";
  //   · chỉ DA_MAT mới tạo lead mới (và chỉ khi còn trong cửa sổ mới ghi truy vết);
  //   · dòng lịch sử trên lead cũ phải nói ĐÚNG việc đã làm (không "đã chặn" khi đã tạo).
  async function lichSu(leadId: string): Promise<string> {
    const acts = await db.leadActivity.findMany({ where: { leadId }, select: { content: true } });
    return acts.map((a) => a.content).join("\n");
  }

  it("[TRUNG-01] hồ sơ ĐÃ ĐĂNG KÝ + phiếu con MỚI ⇒ gắn con vào CHÍNH hồ sơ đó, không đẻ lead", async () => {
    const first = await ingestIntakeLead(
      lead({ phone: PHONE.closedLead, children: [{ fullName: "Bé Anh Cả" }] }),
      { source: "sale-form" },
    );
    await db.lead.update({ where: { id: first.leadId! }, data: { status: "DA_DANG_KY" } });

    const second = await ingestIntakeLead(
      lead({ phone: PHONE.closedLead, children: [{ fullName: "Bé Em Út" }] }),
      { source: "sale-form" },
    );

    expect(second.leadId).toBe(first.leadId);
    expect(second.duplicate).toBe(true);
    expect(second.childAdded).toBe(true);
    expect(await db.lead.count({ where: { phone: "84900000112" } })).toBe(1);
    const con = await db.leadChild.findMany({
      where: { leadId: first.leadId! },
      select: { fullName: true },
      orderBy: { createdAt: "asc" },
    });
    expect(con.map((c) => c.fullName)).toEqual(["Bé Anh Cả", "Bé Em Út"]);
    // Việc của con mới không được chôn: hồ sơ đã chốt phải NÓI RA là có con mới cần tư vấn.
    expect(await lichSu(first.leadId!)).toContain("có con mới cần tư vấn");
  }, 60_000);

  it("[TRUNG-02] hồ sơ ĐÃ ĐĂNG KÝ + phiếu CÙNG bé ⇒ không thêm bé, không đẻ lead", async () => {
    const first = await ingestIntakeLead(
      lead({ phone: PHONE.dangKyCungCon, children: [{ fullName: "Nguyễn Hồ Tuấn Khang" }] }),
      { source: "sale-form" },
    );
    await db.lead.update({ where: { id: first.leadId! }, data: { status: "DA_DANG_KY" } });

    const second = await ingestIntakeLead(
      lead({ phone: PHONE.dangKyCungCon, children: [{ fullName: "nguyễn hồ tuấn khang" }] }),
      { source: "sale-form-app" },
    );

    expect(second.leadId).toBe(first.leadId);
    expect(second.childAdded).toBe(false);
    expect(await db.lead.count({ where: { phone: "84900000115" } })).toBe(1);
    expect(await db.leadChild.count({ where: { leadId: first.leadId! } })).toBe(1);
  }, 60_000);

  it("[TRUNG-03] hồ sơ ĐÃ MẤT ⇒ tạo lead MỚI, và lịch sử lead cũ nói đúng là ĐÃ TẠO (kèm mã lead mới)", async () => {
    const first = await ingestIntakeLead(
      lead({ phone: PHONE.daMat, children: [{ fullName: "Bé Cũ" }] }),
      { source: "sale-form" },
    );
    await db.lead.update({ where: { id: first.leadId! }, data: { status: "DA_MAT" } });

    const second = await ingestIntakeLead(
      lead({ phone: PHONE.daMat, children: [{ fullName: "Bé Cũ" }] }),
      { source: "sale-form" },
    );

    expect(second.leadId).not.toBe(first.leadId);
    expect(second.duplicate).toBeFalsy();
    const cu = await lichSu(first.leadId!);
    expect(cu, "câu cũ 'đã chặn tạo lead trùng' nói dối khi lead MỚI đã được tạo").not.toContain(
      "đã chặn tạo lead trùng",
    );
    expect(cu).toContain(second.leadId!);
    // Vẫn truy vết được mối liên hệ giữa hai hồ sơ.
    expect(await db.leadDuplicate.count({ where: { primaryLeadId: first.leadId! } })).toBeGreaterThan(0);
  }, 60_000);

  it("[TRUNG-04] lead CÒN MỞ nhưng tạo từ 120 ngày trước (nhập sheet lùi ngày) ⇒ VẪN gộp", async () => {
    const first = await ingestIntakeLead(
      lead({ phone: PHONE.moCu, children: [{ fullName: "Bé Ngân" }] }),
      { source: "legacy-sheet" },
    );
    await db.lead.update({
      where: { id: first.leadId! },
      data: { status: "DANG_NUOI_DUONG", createdAt: new Date(Date.now() - 120 * 86400_000) },
    });

    const second = await ingestIntakeLead(
      lead({ phone: PHONE.moCu, children: [{ fullName: "Bé Ngân" }] }),
      { source: "sale-form-app" },
    );

    expect(second.leadId).toBe(first.leadId);
    expect(second.duplicate).toBe(true);
    expect(await db.lead.count({ where: { phone: "84900000117" } })).toBe(1);
    const cu = await lichSu(first.leadId!);
    expect(cu).toContain("đã gộp vào lead này");
    expect(cu).not.toContain("đã chặn tạo lead trùng");
  }, 60_000);

  it("[TRUNG-05] lead ĐÃ MẤT từ 120 ngày trước (ngoài cửa sổ) ⇒ tạo lead mới như cũ", async () => {
    const first = await ingestIntakeLead(lead({ phone: PHONE.matCu }), { source: "sale-form" });
    await db.lead.update({
      where: { id: first.leadId! },
      data: { status: "DA_MAT", createdAt: new Date(Date.now() - 120 * 86400_000) },
    });

    const second = await ingestIntakeLead(lead({ phone: PHONE.matCu }), { source: "sale-form" });

    expect(second.leadId).not.toBe(first.leadId);
    expect(second.duplicate).toBeFalsy();
  }, 60_000);

  it("đi trọn đường quatang: JSON thô của doPost → Lead trong DB", async () => {
    const mapped = mapQuatang({
      ho_ten_con: "Bé Quà Tặng",
      ho_ten: "Chị Quà Tặng",
      sdt: "900000113", // sheet nuốt số 0 đầu
      // Chuỗi cơ sở kiểu MỚI của quatang — phải khớp theo địa chỉ là chuỗi con.
      co_so: `Cơ sở B - 922 Đường Kiểm Thử, Đà Nẵng`,
      tinh: "Đà Nẵng",
      truong: "TH Kiểm Thử",
      lop: "Lớp 6",
      ip: "203.0.113.10",
      user_agent: "UA-của-phụ-huynh",
      aff_ten_nv: "Chị Diệu",
      aff_ma_link_cuoi: "LINK9",
      event_id: "row-quatang-1",
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;

    const meta = quatangClientMeta({
      ip: "203.0.113.10",
      user_agent: "UA-của-phụ-huynh",
    });
    const r = await ingestIntakeLead(mapped.lead, {
      source: "quatang",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const row = await db.lead.findUnique({
      where: { id: r.leadId! },
      select: {
        phone: true,
        centerId: true,
        source: true,
        eventId: true,
        ipAddress: true,
        userAgent: true,
        note: true,
        children: { select: { fullName: true, gradeLevel: true } },
      },
    });
    expect(row?.phone).toBe("84900000113");
    expect(row?.centerId).toBe(centerBId); // khớp bằng chuỗi con của địa chỉ
    expect(row?.source).toBe("quatang");
    expect(row?.eventId).toBe("quatang:row-quatang-1");
    // IP phải là của PHỤ HUYNH (từ payload), không phải của máy chủ Google.
    expect(row?.ipAddress).toBe("203.0.113.10");
    expect(row?.userAgent).toBe("UA-của-phụ-huynh");
    expect(row?.note).toContain("NV giới thiệu: Chị Diệu");
    expect(row?.children).toEqual([{ fullName: "Bé Quà Tặng", gradeLevel: "Lớp 6" }]);
  }, 60_000);

  it("đi trọn đường form Sale: payload thô → Lead trong DB", async () => {
    await db.lead.deleteMany({ where: { phone: "84900000101" } });

    const mapped = mapSaleForm({
      [SALE_FORM_FIELDS.childName]: "Bé Toàn Trình",
      [SALE_FORM_FIELDS.parentName]: "",
      [SALE_FORM_FIELDS.phone]: "900000101", // ô số nuốt mất số 0 đầu
      [SALE_FORM_FIELDS.centerIndex]: "91", // → CS91
      [SALE_FORM_FIELDS.gradeLevel]: "Lớp 5",
      [SALE_FORM_FIELDS.provinceId]: "7480",
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;

    const r = await ingestIntakeLead(mapped.lead, { source: "sale-form" });
    const row = await db.lead.findUnique({
      where: { id: r.leadId! },
      select: { parentName: true, phone: true, centerId: true, note: true },
    });

    expect(row?.phone).toBe("84900000101");
    expect(row?.centerId).toBe(centerAId);
    // Phiếu thiếu tên PH ⇒ dựng từ tên con + cảnh báo, không rơi lead.
    expect(row?.parentName).toBe("PH của Bé Toàn Trình");
    expect(row?.note).toContain("Tỉnh/TP: Đà Nẵng");
    expect(row?.note).toContain("không có tên phụ huynh");
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════
  // Biểu mẫu `/nhap-khach-hang` (22/08/2026) — KHÔNG ô nào bắt buộc.
  //
  // Đây là phần unit test thuần KHÔNG chạm được: `Lead.phone` là cột NOT NULL,
  // và luật chống trùng nằm trong DB. Nếu chuỗi rỗng không lưu được, hoặc dedup
  // gộp mọi lead chưa có số vào làm một, thì chỉ ở đây mới lộ ra.
  // ═══════════════════════════════════════════════════════════════════════
  describe("nhập khách hàng nội bộ — phiếu không có số điện thoại", () => {
    const STAFF = { employeeCode: null, displayName: `${P}Người nhập` };

    afterAll(async () => {
      // `purge()` dọn theo danh sách SĐT nên không với tới lead phone="".
      const rows = await db.lead.findMany({
        where: { phone: "", parentName: { startsWith: P } },
        select: { id: true },
      });
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) {
        await db.leadChild.deleteMany({ where: { leadId: { in: ids } } });
        await db.leadActivity.deleteMany({ where: { leadId: { in: ids } } });
        await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
        await db.lead.deleteMany({ where: { id: { in: ids } } });
      }
    }, 60_000);

    async function nhap(over: Record<string, string | null>) {
      const mapped = mapInternalForm(
        {
          parentName: `${P}Chị Không Số`,
          phone: null,
          childName: null,
          source: null,
          facebookUrl: null,
          centerCode: CODE_A,
          note: null,
          ...over,
        },
        STAFF,
      );
      expect(mapped.ok).toBe(true);
      if (!mapped.ok) throw new Error(mapped.error);
      return ingestIntakeLead(mapped.lead, {
        source: "sale-form-app",
        allowMissingPhone: true,
      });
    }

    it("lưu được lead chỉ có link Facebook (cột phone NOT NULL nhận chuỗi rỗng)", async () => {
      const r = await nhap({ facebookUrl: "facebook.com/chi.khong.so" });
      expect(r.ok).toBe(true);
      expect(r.duplicate).toBe(false);

      const row = await db.lead.findUnique({
        where: { id: r.leadId! },
        select: { phone: true, facebookUrl: true, centerId: true, source: true, note: true },
      });
      expect(row?.phone).toBe("");
      expect(row?.facebookUrl).toBe("https://facebook.com/chi.khong.so");
      expect(row?.centerId).toBe(centerAId);
      // Không gõ ô "Nguồn" ⇒ giữ nguyên kênh kỹ thuật của tầng ingest.
      expect(row?.source).toBe("sale-form-app");
      expect(row?.note).toContain("chưa có số điện thoại");
    }, 60_000);

    it("🔴 hai phiếu chưa có số KHÔNG bị dedup gộp làm một", async () => {
      const a = await nhap({ facebookUrl: "facebook.com/khach.mot" });
      const b = await nhap({ facebookUrl: "facebook.com/khach.hai" });

      expect(a.ok && b.ok).toBe(true);
      expect(b.duplicate).toBe(false);
      expect(b.leadId).not.toBe(a.leadId);
    }, 60_000);

    it("ô Nguồn người nhập gõ thắng kênh kỹ thuật khi ghi Lead.source", async () => {
      const r = await nhap({ source: "Facebook Ads", facebookUrl: "facebook.com/khach.ba" });
      const row = await db.lead.findUnique({
        where: { id: r.leadId! },
        select: { source: true },
      });
      expect(row?.source).toBe("Facebook Ads");
    }, 60_000);

    it("nguồn NGOÀI vẫn bị từ chối khi thiếu số (cờ không rò sang đường khác)", async () => {
      const mapped = mapInternalForm(
        { parentName: `${P}Chị Ngoài`, phone: null, centerCode: CODE_A },
        STAFF,
      );
      expect(mapped.ok).toBe(true);
      if (!mapped.ok) return;
      // KHÔNG truyền allowMissingPhone → đúng luật cũ của mọi nguồn ngoài.
      const r = await ingestIntakeLead(mapped.lead, { source: "sale-form" });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("Số điện thoại");
    }, 60_000);
  });

});
