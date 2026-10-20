// @vitest-environment node
/**
 * PR7 — TẦNG DỮ LIỆU + SERVER ACTION của UI GHI tab Nguồn. Postgres LOCAL thật, quyền RBAC v2 THẬT (UserOrgRole), không
 * giả lập `can()`.
 *
 *   [NHH-UI-DB-01..05]  `docChoGanNguon`: dữ liệu Sheet/khối Nguồn; UNKNOWN không có trong danh sách chọn; người giới thiệu
 *                       hiện TÊN không SĐT; quyền đổi nguồn = `quyenDoiNguon` (nêu tên khoá thiếu); thực thu tính từ WHERE_THUC_THU
 *   [NHH-UI-DB-06..08]  cách ly cơ sở: lead cơ sở khác ⇒ null / "Lead không tồn tại." — cả đọc lẫn ghi
 *   [NHH-UI-ACT-01..06] `moGanNguonAction` · `timNguoiGioiThieuAction` · `doiNguonLeadAction`: cổng đăng nhập/cờ/quyền Ở ĐẦU HÀM,
 *                       khoá lạc quan theo màn hình đã xem (`expectedUpdatedAt`), lỗi map về field
 *   [NHH-UI-TN-01..08]  `timNguoiGioiThieu`: nhân sự (chỉ còn làm việc, vai suy ra, không SĐT), phụ huynh (cách ly cơ sở, tìm theo
 *                       SĐT chỉ khi được xem PII, che tên), đối tác (chỉ đang hoạt động), giới hạn kết quả
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `NUIG_`. Mỗi ca tự dựng hiện trường (luật 18).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({
  ...(await orig<typeof import("next/cache")>()),
  revalidatePath: () => {},
}));

import { db } from "../../lib/db";
import { resolveActorUncached } from "../../lib/auth/actor";
import { checkPermission } from "../../lib/auth/check-permission";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { seedOrg, seedRoles } from "../e2e/_helpers/seed";
import { docChoGanNguon } from "../../lib/nguon/doc-gan-nguon";
import { timNguoiGioiThieu } from "../../lib/nguon/tim-nguoi-gioi-thieu";
import { doiNguonLeadAction, moGanNguonAction, timNguoiGioiThieuAction } from "../../app/(admin)/admin/leads/nguon-actions";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, datCoNguon, type IdNhom } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "NUIG_";
const CASE = 90_000;
const NOW = new Date("2026-10-08T03:00:00.000Z");

type Vai = { roleDef: string; roleEnum: string; donVi: "HO" | "CS1" | "CS2" };
const VAI = {
  qlcs1: { roleDef: "CENTER_MANAGER", roleEnum: "CENTER_MANAGER", donVi: "CS1" },
  sale1: { roleDef: "CENTER_SALES_CSM", roleEnum: "SALES_CSM", donVi: "CS1" },
  marketing: { roleDef: "HO_MARKETING", roleEnum: "MARKETING", donVi: "HO" },
  admin: { roleDef: "SUPER_ADMIN", roleEnum: "SUPER_ADMIN", donVi: "HO" },
  giaoVien: { roleDef: "TEACHER", roleEnum: "TEACHER", donVi: "CS1" },
} satisfies Record<string, Vai>;

async function xoaNguoiDung(): Promise<void> {
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
  await db.leadRotationTurn.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: ids } } });
    for (const id of ids) await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${id}:` } } });
    const dons = await db.order.findMany({ where: { leadId: { in: ids } }, select: { id: true } });
    await db.payment.deleteMany({ where: { orderId: { in: dons.map((o) => o.id) } } });
    await db.order.deleteMany({ where: { leadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } }); // nguồn do ADMIN tạo trong ca [NHH-DYN-V1-DB]
  await xoaNguoiDung();
  await db.roleDef.deleteMany({ where: { code: { startsWith: "NUIG_" } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: "NUIGAFF" } } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
}

async function dungNguoiDung(v: Vai, hau = v.roleDef): Promise<{ id: string }> {
  const email = `${P}${hau.toLowerCase()}@example.test`;
  const centerId = v.donVi === "HO" ? null : (await db.center.findUniqueOrThrow({ where: { code: v.donVi }, select: { id: true } })).id;
  const u = await db.user.create({
    data: { name: `${P}${hau}`, email, role: v.roleEnum as never, roles: [v.roleEnum as never], centerId, isActive: true },
    select: { id: true },
  });
  const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: v.donVi }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: v.roleDef }, select: { id: true } });
  // effectiveFrom lùi 1 giờ: đồng hồ DB có thể đi TRƯỚC Node (xem nguon-noi-day-duong.spec) — luật 19.
  await db.userOrgRole.create({
    data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "nuig", effectiveFrom: new Date(Date.now() - 3_600_000) },
  });
  SESS.current = { user: { id: u.id, role: v.roleEnum, roles: [v.roleEnum], centerId, name: `${P}${hau}`, email } };
  return u;
}

/**
 * Dựng một RoleDef THỬ (mã bắt đầu `NUIG_`) với đúng các khoá cho trước. Cần vì mọi vai trong seed mà thấy được lead đều có
 * `leads:view-pii` và mọi khoá nguồn đều GLOBAL — nên hai điều phải đo (cờ PII đi qua action · quyền CẤP CƠ SỞ cần đối tượng lead)
 * không dựng được bằng vai seed. Quyền vẫn đi qua `can()` v2 THẬT, không giả lập.
 */
async function taoVai(code: string, perms: readonly (readonly [string, "GLOBAL" | "CENTER"])[]): Promise<Vai> {
  const r = await db.roleDef.upsert({ where: { code }, update: {}, create: { code, name: `${code} (fixture)` }, select: { id: true } });
  await db.rolePermission.deleteMany({ where: { roleId: r.id } });
  await db.rolePermission.createMany({ data: perms.map(([action, scopeType]) => ({ roleId: r.id, action, scopeType })) });
  return { roleDef: code, roleEnum: "SALES_CSM", donVi: "CS1" };
}

describe.skipIf(!RUN)("PR7 — UI ghi tab Nguồn: dữ liệu Sheet + server action", () => {
  let nhom: IdNhom;
  let cs1 = "";
  let cs2 = "";
  const truocRbac = process.env.RBAC_V2_ENABLED;

  async function dungLead(opts: { centerId?: string; groupId?: string; ten?: string; signals?: object; referrerEmployeeId?: string; note?: string } = {}) {
    const l = await db.lead.create({
      data: {
        parentName: `${P}${opts.ten ?? "Lead"}`,
        phone: `0907${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
        status: "MOI",
        centerId: opts.centerId ?? cs1,
        source: "nhap-tay",
      },
      select: { id: true },
    });
    const g = opts.groupId ?? nhom.PAID_ADS;
    await db.leadAttribution.create({
      data: {
        leadId: l.id,
        groupId: g,
        originalGroupId: g,
        identificationMethod: "SYSTEM_DEFAULT",
        matchedRule: "DUONG_VAO_MAC_DINH",
        reasonText: "ca test",
        attributedAt: new Date("2026-08-01T00:00:00.000Z"),
        otherSourceNote: opts.note ?? null,
        ...(opts.referrerEmployeeId ? { referrerKind: "EMPLOYEE" as const, referrerEmployeeId: opts.referrerEmployeeId } : {}),
        signals: (opts.signals ?? { duongVao: "nhap-tay" }) as object,
      },
    });
    return l.id;
  }

  async function dungNv(hau: string, o: { status?: "ACTIVE" | "RESIGNED"; ten?: string; centerId?: string } = {}) {
    const e = await db.employee.create({
      data: {
        employeeCode: `${P}NV${hau}`,
        fullName: o.ten ?? `${P}Nhân viên ${hau}`,
        jobTitle: "Tư vấn",
        department: "TUYEN_SINH",
        centerId: o.centerId ?? cs1,
        phone: "0911222333",
        email: `${P}nv${hau}@example.test`.toLowerCase(),
        isActive: (o.status ?? "ACTIVE") === "ACTIVE",
        status: o.status ?? "ACTIVE",
      },
      select: { id: true },
    });
    return e.id;
  }

  async function dungDonDaThu(leadId: string, so = 1_000_000): Promise<void> {
    const o = await db.order.create({
      data: { code: `ORD-NUIG-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, type: "COURSE", customerName: "x", customerPhone: "0908000000", totalAmount: 5_000_000, leadId },
      select: { id: true },
    });
    await db.payment.create({
      data: { orderId: o.id, amount: so, method: "chuyen-khoan", paidDate: new Date("2026-09-01T03:00:00.000Z"), accountantStatus: "CONFIRMED" },
    });
  }

  const attr = (id: string) => db.leadAttribution.findUniqueOrThrow({ where: { leadId: id }, include: { group: { select: { code: true } } } });
  const demAudit = (id: string) => db.auditLog.count({ where: { entityType: "Lead", entityId: id, module: "nguon-hoa-hong" } });

  /** Đọc Sheet bằng actor THẬT của phiên hiện tại + `checkPermission` thật. */
  async function doc(leadId: string, canViewPii = true) {
    const actor = await resolveActorUncached(SESS.current!.user.id);
    return docChoGanNguon({ actor, leadId, kiemQuyen: (a, t) => checkPermission(a, t), canViewPii, cuaSoNgay: 90, now: NOW });
  }

  // Dữ liệu NỀN (cơ sở · cây đơn vị · vai) tự dựng, idempotent (upsert, không xoá): bộ này KHÔNG mượn trạng thái mà `test:chat-db` để lại
  // (luật 18 — chạy riêng nó trên DB trắng phải xanh).
  beforeAll(async () => {
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  }, 180_000);

  beforeEach(async () => {
    process.env.RBAC_V2_ENABLED = "true";
    await don();
    nhom = await damBaoDanhMucGoc(db);
    cs1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    cs2 = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    await datCoNguon(CO_NGUON_DAY_DU);
    SESS.current = null;
  }, CASE);

  afterAll(async () => {
    if (truocRbac === undefined) delete process.env.RBAC_V2_ENABLED;
    else process.env.RBAC_V2_ENABLED = truocRbac;
    await don();
    await db.$disconnect();
  }, 180_000);

  // ── docChoGanNguon ───────────────────────────────────────────────────────────────────────────────────
  it("[NHH-UI-DB-01] Sheet: nguồn hiện tại + danh mục CHỌN ĐƯỢC (8 nguồn, KHÔNG UNKNOWN) + mốc khoá lạc quan", async () => {
    await dungNguoiDung(VAI.qlcs1);
    const id = await dungLead({ ten: "A", signals: { duongVao: "nhap-tay", nhanGoc: "Facebook ads cũ", xemTay: ["NHAN_NGUON_LA"], coXemTay: true } });
    const du = await doc(id);
    expect(du).not.toBeNull();
    expect(du!.nguon).toMatchObject({ groupCode: "PAID_ADS", cachXacDinh: "SYSTEM_DEFAULT", nhanGoc: "Facebook ads cũ", xemTay: ["NHAN_NGUON_LA"], khoa: false, nguoi: null });
    expect(du!.duongVao).toBe("nhap-tay");
    expect(du!.coSo).toMatchObject({ code: "CS1" });
    expect(du!.danhMuc).toHaveLength(8);
    expect(du!.danhMuc.map((g) => g.code)).not.toContain("UNKNOWN");
    const luu = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: id }, select: { updatedAt: true, attributedAt: true } });
    expect(du!.nguon!.capNhatLuc).toBe(luu.updatedAt.toISOString());
    // cửa sổ 90 ngày kể từ 01/08 (giờ VN) ⇒ hết ngày 30/10 giờ VN = 16:59:59 UTC ngày 30/10
    expect(du!.nguon!.hanGhiCong).toBe("2026-10-30T16:59:59.999Z");
    expect(du!.nguon!.conHanGhiCong).toBe(true); // NOW = 08/10 — ngày thứ 68
    const quaHan = await docChoGanNguon({ actor: await resolveActorUncached(SESS.current!.user.id), leadId: id, kiemQuyen: (a, t) => checkPermission(a, t), canViewPii: true, cuaSoNgay: 90, now: new Date("2026-10-31T03:00:00.000Z") });
    expect(quaHan!.nguon!.conHanGhiCong).toBe(false); // ngày 91 ⇒ ngoài cửa sổ, nhưng nguồn VẪN được giữ
    expect(quaHan!.nguon!.groupCode).toBe("PAID_ADS");
    // Cửa sổ đọc từ THAM SỐ (setting `nguon.cuaSoGhiCongNgay`), không phải hằng 90: 30 ngày kể từ 01/08 ⇒ hết ngày 31/08 giờ VN, và 08/10 đã quá hạn.
    // (Cấy `hanCuaSoGhiCong(…, 90)` ở docChoGanNguon: mọi ca trên dùng đúng 90 nên không ca nào thấy.)
    const ngan = await docChoGanNguon({ actor: await resolveActorUncached(SESS.current!.user.id), leadId: id, kiemQuyen: (a, t) => checkPermission(a, t), canViewPii: true, cuaSoNgay: 30, now: NOW });
    expect(ngan!.nguon!.hanGhiCong).toBe("2026-08-31T16:59:59.999Z");
    expect(ngan!.nguon!.conHanGhiCong).toBe(false);
  }, CASE);

  it("[NHH-UI-DB-02] người giới thiệu hiện TÊN + mã — không SĐT, không email; nhân viên đã nghỉ có ghi chú", async () => {
    await dungNguoiDung(VAI.qlcs1);
    const e = await dungNv("01", { ten: "Trần Thị Sale" });
    const id = await dungLead({ ten: "B", groupId: nhom.EMPLOYEE_REFERRAL, referrerEmployeeId: e });
    const du = await doc(id);
    expect(du!.nguon!.nguoi).toEqual({ loai: "NHAN_SU", ten: "Trần Thị Sale", ma: `${P}NV01`, moTa: null });
    const json = JSON.stringify(du);
    expect(json).not.toMatch(/0911222333|nv01@example/i);
    await db.employee.update({ where: { id: e }, data: { status: "RESIGNED", isActive: false } });
    expect((await doc(id))!.nguon!.nguoi!.moTa).toBe("đã nghỉ việc");
  }, CASE);

  it("[NHH-UI-DB-03] tên lead che theo PII; có quyền PII ⇒ nguyên văn (đối chứng dương)", async () => {
    await dungNguoiDung(VAI.qlcs1);
    const id = await dungLead({ ten: "Nguyen Van Kin" });
    expect((await doc(id, true))!.tenLead).toBe(`${P}Nguyen Van Kin`);
    const che = (await doc(id, false))!.tenLead;
    expect(che).not.toBe(`${P}Nguyen Van Kin`);
    expect(che).not.toContain("Kin");
  }, CASE);

  it("[NHH-UI-DB-03b] người giới thiệu là PHỤ HUYNH: tên che khi không có quyền PII, nguyên văn khi có (đối chứng dương); mã học viên vẫn hiện", async () => {
    // Cấy `ten = goc ?? "Phụ huynh"` (bỏ nhánh che) ở docNguoiGioiThieu: Sheet/khối lead lộ tên phụ huynh cho người không có leads:view-pii.
    await dungNguoiDung(VAI.qlcs1);
    const hs = await dungHocVien("71", { centerId: cs1, parentName: "Hoàng Thị Cúc" });
    const id = await dungLead({ ten: "PhGt", groupId: nhom.PARENT_REFERRAL });
    await db.leadAttribution.update({ where: { leadId: id }, data: { referrerKind: "PARENT", referrerStudentId: hs.id } });
    expect((await doc(id, true))!.nguon!.nguoi).toMatchObject({ loai: "PHU_HUYNH", ten: "Hoàng Thị Cúc", ma: `${P}HV71` });
    const che = await doc(id, false);
    expect(che!.nguon!.nguoi).toMatchObject({ loai: "PHU_HUYNH", ma: `${P}HV71` });
    expect(JSON.stringify(che)).not.toContain("Cúc");
  }, CASE);

  it("[NHH-UI-DB-04] quyền đổi nguồn: QLCS đổi được lead CHƯA thu; ĐÃ thu ⇒ không, và nêu đúng tên khoá còn thiếu; admin vẫn được", async () => {
    await dungNguoiDung(VAI.qlcs1);
    const chua = await dungLead({ ten: "ChuaThu" });
    expect((await doc(chua))!.quyen).toEqual({ ok: true });
    expect((await doc(chua))!.thucThu).toBeNull();

    const da = await dungLead({ ten: "DaThu" });
    await dungDonDaThu(da, 1_500_000);
    const d = await doc(da);
    expect(d!.thucThu).toEqual({ soKhoan: 1, tong: 1_500_000 });
    expect(d!.quyen).toMatchObject({ ok: false, thieu: ["sources:override-after-payment"], maChan: "DOI_SAU_TT" });

    await dungNguoiDung(VAI.admin);
    expect((await doc(da))!.quyen).toEqual({ ok: true });
  }, CASE);

  it("[NHH-UI-DB-05] chỉ tiền THẬT mới là 'đã thu': khoản chờ kế toán / bị từ chối không làm lead thành 'sau thực thu'", async () => {
    await dungNguoiDung(VAI.qlcs1);
    const id = await dungLead({ ten: "ChoKeToan" });
    const o = await db.order.create({
      data: { code: `ORD-NUIG-${Date.now()}`, type: "COURSE", customerName: "x", customerPhone: "0908000000", totalAmount: 5_000_000, leadId: id },
      select: { id: true },
    });
    await db.payment.createMany({
      data: [
        { orderId: o.id, amount: 1_000_000, method: "chuyen-khoan", paidDate: new Date("2026-09-01T03:00:00.000Z"), accountantStatus: "PENDING" },
        { orderId: o.id, amount: 2_000_000, method: "chuyen-khoan", paidDate: new Date("2026-09-01T03:00:00.000Z"), accountantStatus: "REJECTED" },
      ],
    });
    const d = await doc(id);
    expect(d!.thucThu).toBeNull();
    expect(d!.quyen).toEqual({ ok: true });
  }, CASE);

  it("[NHH-UI-DB-04b] nguồn do Page mapping KHOÁ ⇒ Sheet nói `khoa: true`; QLCS (không sources:manage) không đổi được và thiếu ĐÚNG khoá sources:manage; admin vẫn được", async () => {
    // Cấy `const khoa = false` ở docChoGanNguon: nút "Đổi nguồn" vẽ cho nguồn mà cổng server sẽ từ chối.
    await dungNguoiDung(VAI.qlcs1);
    const id = await dungLead({ ten: "Khoa", signals: { duongVao: "facebook-lead-ads", khoaNguon: true } });
    const d = await doc(id);
    expect(d!.nguon!.khoa).toBe(true);
    expect(d!.quyen).toMatchObject({ ok: false, thieu: ["sources:manage"] });
    await dungNguoiDung(VAI.admin);
    expect((await doc(id))!.quyen).toEqual({ ok: true });
  }, CASE);

  it("[NHH-UI-DB-05b] đơn đã XOÁ MỀM không tính: khoản thu nằm trên đơn đã xoá KHÔNG biến lead thành 'sau thực thu' (cả Sheet lẫn cổng ghi)", async () => {
    // Cấy bỏ `deletedAt: null` ở `docChoGanNguon` / `doiNguonLead`: một đơn nhập nhầm rồi xoá vẫn khoá quyền đổi nguồn của lead.
    await dungNguoiDung(VAI.qlcs1);
    const id = await dungLead({ ten: "DonXoa" });
    await dungDonDaThu(id, 2_000_000);
    expect((await doc(id))!.thucThu).toEqual({ soKhoan: 1, tong: 2_000_000 });
    await db.order.updateMany({ where: { leadId: id }, data: { deletedAt: new Date() } });
    try {
      const d = await doc(id);
      expect(d!.thucThu).toBeNull();
      expect(d!.quyen).toEqual({ ok: true });
      // cổng ghi: QLCS (không có quyền sau-thực-thu) đổi được vì không còn khoản thu nào còn hiệu lực
      const r = await doiNguonLeadAction({ leadId: id, groupId: nhom.WALK_IN, lyDo: "Đơn nhập nhầm đã xoá nên đổi nguồn" });
      expect(r).toEqual({ ok: true, canDieuChinh: false });
    } finally {
      // `don()` tìm đơn qua `db.order.findMany` — đơn đã xoá mềm bị ẩn khỏi đó ⇒ không dọn được payment kèm theo. Trả lại trước khi dọn.
      await db.order.updateMany({ where: { leadId: id }, data: { deletedAt: null } });
    }
  }, CASE);

  it("[NHH-UI-DB-06] CÁCH LY CƠ SỞ: QLCS CS1 đọc lead CS2 ⇒ null (y hệt lead không tồn tại)", async () => {
    await dungNguoiDung(VAI.qlcs1);
    const id = await dungLead({ ten: "CS2", centerId: cs2 });
    expect(await doc(id)).toBeNull();
    expect(await doc("khong-co-lead-nay")).toBeNull();
    // đối chứng dương: admin cấp Hội sở thấy
    await dungNguoiDung(VAI.admin);
    expect(await doc(id)).not.toBeNull();
  }, CASE);

  it("[NHH-UI-DB-07] lead CHƯA có quy nguồn (tạo trước khi bật cờ): nguon = null (giao diện nói thật 'chưa có quy nguồn')", async () => {
    await dungNguoiDung(VAI.qlcs1);
    const l = await db.lead.create({ data: { parentName: `${P}ChuaQuyNguon`, phone: "0907555555", status: "MOI", centerId: cs1 }, select: { id: true } });
    const d = await doc(l.id);
    expect(d).not.toBeNull();
    expect(d!.nguon).toBeNull();
    expect(d!.danhMuc.length).toBeGreaterThan(0);
  }, CASE);

  it("[NHH-UI-DB-08] lead đã xoá mềm ⇒ null", async () => {
    await dungNguoiDung(VAI.qlcs1);
    const id = await dungLead({ ten: "DaXoa" });
    await db.lead.update({ where: { id }, data: { deletedAt: new Date() } });
    expect(await doc(id)).toBeNull();
  }, CASE);

  // ── moGanNguonAction ────────────────────────────────────────────────────────────────────────────────
  it("[NHH-UI-ACT-01] moGanNguonAction: chưa đăng nhập · cờ TẮT · thiếu sources:view · lead CS khác ⇒ từ chối; QLCS đúng cơ sở ⇒ dữ liệu", async () => {
    const id = await dungLead({ ten: "Mo" });
    expect(await moGanNguonAction({ leadId: id })).toEqual({ ok: false, error: "Chưa đăng nhập" });

    await dungNguoiDung(VAI.sale1); // Sale: có leads:create, KHÔNG có sources:view
    const sale = await moGanNguonAction({ leadId: id });
    expect(sale).toMatchObject({ ok: false });
    expect((sale as { error: string }).error).toContain("sources:view");

    await dungNguoiDung(VAI.qlcs1);
    await datCoNguon({});
    const tat = await moGanNguonAction({ leadId: id });
    expect((tat as { error: string }).error).toMatch(/chưa được bật/);
    await datCoNguon(CO_NGUON_DAY_DU);

    const ok = await moGanNguonAction({ leadId: id });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.du.leadId).toBe(id);

    const cs2Id = await dungLead({ ten: "MoCS2", centerId: cs2 });
    expect(await moGanNguonAction({ leadId: cs2Id })).toEqual({ ok: false, error: "Lead không tồn tại." });
    expect(await moGanNguonAction({ leadId: "" })).toMatchObject({ ok: false });
    expect(await moGanNguonAction(null)).toMatchObject({ ok: false });
  }, CASE);

  it("[NHH-UI-ACT-01b] cờ PII đi qua moGanNguonAction: người KHÔNG có leads:view-pii thấy tên lead ĐÃ CHE; người có ⇒ nguyên văn (đối chứng dương)", async () => {
    // Cấy `canViewPii: true` trong action: DB-03 chỉ gọi hàm đọc trực tiếp nên không thấy chỗ action tự quyết cờ.
    const khongPii = await taoVai("NUIG_KHONG_PII", [["sources:view", "GLOBAL"], ["leads:view-all", "GLOBAL"], ["leads:create", "GLOBAL"]]);
    const id = await dungLead({ ten: "Kin Pii" });
    await dungNguoiDung(khongPii);
    const che = await moGanNguonAction({ leadId: id });
    expect(che.ok).toBe(true);
    if (che.ok) {
      expect(che.du.tenLead).not.toBe(`${P}Kin Pii`);
      expect(che.du.tenLead).not.toContain("Pii");
    }
    await dungNguoiDung(VAI.qlcs1);
    const ro = await moGanNguonAction({ leadId: id });
    if (!ro.ok) throw new Error(ro.error);
    expect(ro.du.tenLead).toBe(`${P}Kin Pii`);
  }, CASE);

  it("[NHH-UI-ACT-05b] quyền CẤP CƠ SỞ cần ĐỐI TƯỢNG lead: người có leads:overwrite (CENTER) ở CS1 đổi/vẽ nút cho lead CS1; lead CS2 mà họ chỉ XEM được thì KHÔNG (cả Sheet lẫn cổng ghi)", async () => {
    // Cấy `checkPermission(action)` (bỏ `target`) ở doiNguonLeadAction / moGanNguonAction: quyền CENTER không kèm đối tượng luôn từ chối ⇒ người có quyền thật bị khoá;
    // và mọi ca khác dùng quyền GLOBAL của vai seed nên không ca nào thấy.
    const ghiCs = await taoVai("NUIG_GHI_CS", [["sources:view", "GLOBAL"], ["leads:view-all", "GLOBAL"], ["leads:overwrite", "CENTER"]]);
    const chiXem = await taoVai("NUIG_CHI_XEM", [["sources:view", "GLOBAL"], ["leads:view-all", "GLOBAL"]]);
    const u = await dungNguoiDung(ghiCs);
    const ouCs2 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } });
    const roleXem = await db.roleDef.findUniqueOrThrow({ where: { code: chiXem.roleDef }, select: { id: true } });
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ouCs2.id, roleId: roleXem.id, grantedById: "nuig", effectiveFrom: new Date(Date.now() - 3_600_000) } });
    const cs1Id = await dungLead({ ten: "CapCoSo1" });
    const cs2Id = await dungLead({ ten: "CapCoSo2", centerId: cs2 });

    const m1 = await moGanNguonAction({ leadId: cs1Id });
    if (!m1.ok) throw new Error(m1.error);
    expect(m1.du.quyen).toEqual({ ok: true });
    const m2 = await moGanNguonAction({ leadId: cs2Id }); // thấy được lead CS2 (vai chỉ-xem) nhưng KHÔNG đổi được
    if (!m2.ok) throw new Error(m2.error);
    expect(m2.du.quyen).toMatchObject({ ok: false, thieu: ["leads:overwrite"] });

    expect(await doiNguonLeadAction({ leadId: cs2Id, groupId: nhom.WALK_IN, lyDo: "Đổi lead cơ sở chỉ được xem" })).toMatchObject({ ok: false, field: "quyen" });
    expect((await attr(cs2Id)).group.code).toBe("PAID_ADS");
    expect(await demAudit(cs2Id)).toBe(0);
    expect(await doiNguonLeadAction({ leadId: cs1Id, groupId: nhom.WALK_IN, lyDo: "Đổi lead cơ sở mình quản lý" })).toEqual({ ok: true, canDieuChinh: false });
    expect((await attr(cs1Id)).group.code).toBe("WALK_IN");
  }, CASE);

  // ── timNguoiGioiThieuAction ─────────────────────────────────────────────────────────────────────────
  it("[NHH-UI-ACT-02] timNguoiGioiThieuAction: gác Ở ĐẦU HÀM — Sale (leads:create) tìm được; Giáo viên (không khoá nào) bị từ chối; cờ TẮT ⇒ từ chối; q<2 ký tự ⇒ rỗng", async () => {
    await dungNv("02", { ten: `${P}Lê Văn Tìm` });
    await dungNguoiDung(VAI.giaoVien);
    expect(await timNguoiGioiThieuAction({ loai: "NHAN_SU", q: "Tìm" })).toMatchObject({ ok: false });

    await dungNguoiDung(VAI.sale1);
    const r = await timNguoiGioiThieuAction({ loai: "NHAN_SU", q: "Lê Văn Tìm" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ketQua.map((k) => k.ten)).toEqual([`${P}Lê Văn Tìm`]);

    const ngan = await timNguoiGioiThieuAction({ loai: "NHAN_SU", q: "L" });
    expect(ngan).toEqual({ ok: true, ketQua: [] });
    expect(await timNguoiGioiThieuAction({ loai: "KHONG_PHAI_LOAI", q: "abc" })).toMatchObject({ ok: false });

    await datCoNguon({});
    expect(await timNguoiGioiThieuAction({ loai: "NHAN_SU", q: "Lê Văn Tìm" })).toMatchObject({ ok: false });
    SESS.current = null;
    expect(await timNguoiGioiThieuAction({ loai: "NHAN_SU", q: "Lê Văn Tìm" })).toEqual({ ok: false, error: "Chưa đăng nhập" });
  }, CASE);

  it("[NHH-UI-ACT-02b] cờ PII đi qua timNguoiGioiThieuAction: không có leads:view-pii ⇒ gõ SĐT KHÔNG ra ai và tên phụ huynh ĐÃ CHE; có ⇒ ra, nguyên văn (đối chứng dương)", async () => {
    // Cấy `coTheTimTheoSdt: true` / `canViewPii: true` trong action: TN-05/06 gọi hàm tìm trực tiếp nên không thấy chỗ action tự quyết cờ.
    await dungHocVien("91", { centerId: cs1, parentName: "Phạm Thị Lựu", parentPhone: "0912345678" });
    const khongPii = await taoVai("NUIG_KHONG_PII", [["sources:view", "GLOBAL"], ["leads:view-all", "GLOBAL"], ["leads:create", "GLOBAL"]]);
    await dungNguoiDung(khongPii);
    const theoSdt = await timNguoiGioiThieuAction({ loai: "PHU_HUYNH", q: "0912345678" });
    expect(theoSdt).toEqual({ ok: true, ketQua: [] });
    const theoMa = await timNguoiGioiThieuAction({ loai: "PHU_HUYNH", q: `${P}HV91` });
    if (!theoMa.ok) throw new Error(theoMa.error);
    expect(theoMa.ketQua).toHaveLength(1);
    expect(theoMa.ketQua[0]!.ten).not.toContain("Lựu");

    await dungNguoiDung(VAI.qlcs1);
    const co = await timNguoiGioiThieuAction({ loai: "PHU_HUYNH", q: "0912345678" });
    if (!co.ok) throw new Error(co.error);
    expect(co.ketQua).toHaveLength(1);
    expect(co.ketQua[0]!.ten).toBe("Phạm Thị Lựu");
  }, CASE);

  // ── doiNguonLeadAction (đường GHI mà Sheet gọi) ────────────────────────────────────────────────────
  it("[NHH-UI-ACT-03] khoá lạc quan THEO MÀN HÌNH: Sheet mở lúc T0, người khác đổi lúc T1, bấm Lưu ⇒ 'nguonVuaDoi', 0 audit thêm; mốc đúng ⇒ đổi được", async () => {
    await dungNguoiDung(VAI.qlcs1);
    const id = await dungLead({ ten: "Lac" });
    const mo = await moGanNguonAction({ leadId: id });
    if (!mo.ok) throw new Error(mo.error);
    const mocDaXem = mo.du.nguon!.capNhatLuc;

    // người khác đổi giữa chừng
    const truoc = await doiNguonLeadAction({ leadId: id, groupId: nhom.WALK_IN, lyDo: "Người khác đổi trước tôi", expectedUpdatedAt: mocDaXem });
    expect(truoc).toEqual({ ok: true, canDieuChinh: false });
    expect(await demAudit(id)).toBe(1);

    // tôi bấm Lưu với mốc CŨ
    const sau = await doiNguonLeadAction({ leadId: id, groupId: nhom.CENTER_ORGANIC, lyDo: "Tôi đổi dựa trên màn cũ", expectedUpdatedAt: mocDaXem });
    expect(sau).toMatchObject({ ok: false, field: "nguonVuaDoi" });
    expect((await attr(id)).group.code).toBe("WALK_IN");
    expect(await demAudit(id)).toBe(1);

    // tải lại rồi lưu ⇒ qua
    const lai = await moGanNguonAction({ leadId: id });
    if (!lai.ok) throw new Error(lai.error);
    const ok = await doiNguonLeadAction({ leadId: id, groupId: nhom.CENTER_ORGANIC, lyDo: "Đã tải lại rồi mới đổi", expectedUpdatedAt: lai.du.nguon!.capNhatLuc });
    expect(ok).toEqual({ ok: true, canDieuChinh: false });
    expect((await attr(id)).group.code).toBe("CENTER_ORGANIC");
  }, CASE);

  it("[NHH-UI-ACT-03b] đổi nguồn SAU thu ⇒ mỗi lượt đổi đúng MỘT sự kiện cho engine, khoá chống trùng = (lead, PHIÊN BẢN attribution vừa thay) — không phải đồng hồ", async () => {
    // Cấy `${cu.updatedAt.toISOString()}` → `${Date.now()}`: mỗi lần retry/phát lại sinh khoá mới ⇒ engine nhận cùng một lượt đổi hai lần.
    await dungNguoiDung(VAI.admin);
    const id = await dungLead({ ten: "DedupeKey" });
    await dungDonDaThu(id, 2_000_000);
    const v0 = (await attr(id)).updatedAt;
    expect(await doiNguonLeadAction({ leadId: id, groupId: nhom.WALK_IN, lyDo: "Đổi lần một sau khi đã thu tiền" })).toMatchObject({ ok: true, canDieuChinh: true });
    const v1 = (await attr(id)).updatedAt;
    expect(v1.getTime()).toBeGreaterThan(v0.getTime());
    expect(await doiNguonLeadAction({ leadId: id, groupId: nhom.CENTER_ORGANIC, lyDo: "Đổi lần hai sau khi đã thu tiền" })).toMatchObject({ ok: true });
    const khoa = (v: Date) => `nguon.da-doi-sau-thanh-toan:${id}:${v.toISOString()}`;
    const ev = await db.domainEvent.findMany({
      where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${id}:` } },
      select: { dedupeKey: true },
    });
    expect(ev.map((e) => e.dedupeKey).sort()).toEqual([khoa(v0), khoa(v1)].sort());
    // Nội dung sự kiện là thứ engine hoa hồng đọc: đủ nhóm cũ → mới, lý do, người đổi, và cờ cần điều chỉnh (đổi sau thu ⇒ true).
    // (Cấy `canDieuChinh: false` trong payload: engine không biết phải tạo Adjustment, không lỗi nào báo.)
    const luot1 = await db.domainEvent.findUniqueOrThrow({ where: { dedupeKey: khoa(v0) }, select: { payloadJson: true } });
    expect(luot1.payloadJson).toMatchObject({ leadId: id, tuNhom: "PAID_ADS", denNhom: "WALK_IN", canDieuChinh: true, actorId: SESS.current!.user.id, lyDo: "Đổi lần một sau khi đã thu tiền" });
  }, CASE);

  it("[NHH-UI-ACT-04] lỗi map về ĐÚNG field: thiếu lý do · thiếu giải trình nguồn 'Khác' · thiếu người ở nguồn cần người; mỗi lỗi 0 audit, 0 đổi", async () => {
    await dungNguoiDung(VAI.qlcs1);
    const id = await dungLead({ ten: "Field" });
    const ngan = await doiNguonLeadAction({ leadId: id, groupId: nhom.WALK_IN, lyDo: "ngắn" });
    expect(ngan).toMatchObject({ ok: false, field: "lyDo" });
    const khac = await doiNguonLeadAction({ leadId: id, groupId: nhom.OTHER, lyDo: "Khách nói là nguồn khác", giaiTrinh: "ngắn" });
    expect(khac).toMatchObject({ ok: false, field: "giaiTrinh" });
    const nguoi = await doiNguonLeadAction({ leadId: id, groupId: nhom.EMPLOYEE_REFERRAL, lyDo: "Sale giới thiệu khách này" });
    expect(nguoi).toMatchObject({ ok: false, field: "thamChieu" });
    expect((await attr(id)).group.code).toBe("PAID_ADS");
    expect(await demAudit(id)).toBe(0);
  }, CASE);

  it("[NHH-UI-ACT-04b] đối tác giới thiệu: ĐÃ TẮT hoặc không tồn tại ⇒ field 'thamChieu', 0 audit, 0 đổi; đối tác đang hoạt động (đối chứng dương) ⇒ đổi được", async () => {
    // Cấy bỏ `isActive: true` ở kiemNguoiTonTai: nguồn đối tác trỏ vào một đối tác đã tắt, hoa hồng về cho người không còn hợp tác.
    await dungNguoiDung(VAI.qlcs1);
    const id = await dungLead({ ten: "DoiTac" });
    const tat = await db.affiliate.create({ data: { code: "NUIGAFF03", name: `${P}Đối tác đã tắt`, isActive: false }, select: { id: true } });
    const bat = await db.affiliate.create({ data: { code: "NUIGAFF04", name: `${P}Đối tác đang bật`, isActive: true }, select: { id: true } });
    for (const affiliateId of [tat.id, "khong-co-doi-tac-nay"]) {
      const r = await doiNguonLeadAction({ leadId: id, groupId: nhom.PARTNER, affiliateId, lyDo: "Đối tác giới thiệu khách này" });
      expect(r, affiliateId).toMatchObject({ ok: false, field: "thamChieu" });
      expect((r as { error: string }).error).toMatch(/Đối tác giới thiệu không tồn tại hoặc đã tắt/);
    }
    expect((await attr(id)).group.code).toBe("PAID_ADS");
    expect(await demAudit(id)).toBe(0);
    const ok = await doiNguonLeadAction({ leadId: id, groupId: nhom.PARTNER, affiliateId: bat.id, lyDo: "Đối tác giới thiệu khách này" });
    expect(ok).toMatchObject({ ok: true });
    expect(await attr(id)).toMatchObject({ referrerKind: "AFFILIATE", referrerAffiliateId: bat.id });
  }, CASE);

  it("[NHH-UI-ACT-05] thiếu quyền ⇒ field 'quyen' và câu NÊU quyền; Sale (không leads:overwrite) bị từ chối, 0 đổi", async () => {
    await dungNguoiDung(VAI.sale1);
    const id = await dungLead({ ten: "Sale" });
    const r = await doiNguonLeadAction({ leadId: id, groupId: nhom.WALK_IN, lyDo: "Sale muốn đổi nguồn lead" });
    expect(r).toMatchObject({ ok: false, field: "quyen" });
    expect((await attr(id)).group.code).toBe("PAID_ADS");
    expect(await demAudit(id)).toBe(0);
  }, CASE);

  it("[NHH-UI-ACT-06] CÁCH LY CƠ SỞ cho GHI: QLCS CS1 đổi nguồn lead CS2 ⇒ 'Lead không tồn tại.', 0 audit, nhóm không đổi", async () => {
    await dungNguoiDung(VAI.qlcs1);
    const cs2Id = await dungLead({ ten: "GhiCS2", centerId: cs2 });
    const r = await doiNguonLeadAction({ leadId: cs2Id, groupId: nhom.WALK_IN, lyDo: "Đổi lead cơ sở khác" });
    expect(r).toEqual({ ok: false, error: "Lead không tồn tại.", field: "lead" });
    expect((await attr(cs2Id)).group.code).toBe("PAID_ADS");
    expect(await demAudit(cs2Id)).toBe(0);
  }, CASE);

  /** Nhân sự CÓ tài khoản và MỘT vai hiệu lực (hoặc không vai) — để nhóm suy từ vai (D5) có gì mà suy. */
  async function dungNvVoiVai(hau: string, roleCode: string | null, status: "ACTIVE" | "SUSPENDED" = "ACTIVE"): Promise<string> {
    const emp = await dungNv(hau, { ten: `${P}Nhân sự ${hau}` });
    const u = await db.user.create({
      data: { name: `${P}acc-${hau}`, email: `${P}acc-${hau}@example.test`, role: "TEACHER", roles: ["TEACHER"], isActive: true, employeeId: emp },
      select: { id: true },
    });
    if (roleCode) {
      const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
      const role = await db.roleDef.findUniqueOrThrow({ where: { code: roleCode }, select: { id: true } });
      // lùi 1 ngày: đồng hồ Node ≠ đồng hồ DB, và action đọc đồng hồ thật (luật 19 — fixture phải rộng hơn độ lệch).
      await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "nuig", status, effectiveFrom: new Date(Date.now() - 86_400_000) } });
    }
    return emp;
  }

  it("[NHH-UI-ACT-07] D5 Ở MÁY CHỦ trên đường ĐỔI nguồn: chọn nhân sự thì nhóm GHI = nhóm nhân sự giới thiệu cho MỌI vai (vai chỉ còn là snapshot, không chọn nhóm)", async () => {
    // Bốn nhóm nhân sự đã gộp thành MỘT ⇒ mọi vai về cùng nhóm; nhánh "nhóm client gửi KHÁC nhóm suy từ vai" chỉ còn với nguồn admin
    // tạo — ghim bằng `it.fails` [NHH-DYN-V1-DB] bên dưới (stage B).
    await dungNguoiDung(VAI.qlcs1);
    const gv = await dungNvVoiVai("71", "TEACHER");
    const sale = await dungNvVoiVai("72", "CENTER_SALES_CSM");
    const khac = await dungNvVoiVai("73", null);
    const tamDung = await dungNvVoiVai("74", "TEACHER", "SUSPENDED"); // vai đã bị tạm dừng KHÔNG tính (như ô tìm — [NHH-UI-TN-02b])
    const ca = [
      [gv, "EMPLOYEE_REFERRAL"],
      [sale, "EMPLOYEE_REFERRAL"],
      [khac, "EMPLOYEE_REFERRAL"],
      [tamDung, "EMPLOYEE_REFERRAL"], // vai đã bị tạm dừng KHÔNG tính ⇒ như người không vai, vẫn cùng nhóm
    ] as const;
    for (const [employeeId, mongDoi] of ca) {
      const id = await dungLead({ ten: `D5-${mongDoi}` });
      const r = await doiNguonLeadAction({ leadId: id, groupId: nhom.EMPLOYEE_REFERRAL, employeeId, lyDo: "Khách nói nhân sự này giới thiệu" });
      expect(r, mongDoi).toMatchObject({ ok: true });
      const a = await attr(id);
      expect(a.group.code, mongDoi).toBe(mongDoi);
      expect(a.referrerEmployeeId, mongDoi).toBe(employeeId);
    }
  }, CASE);

  // V1 (SPEC nguồn động §2): nguồn do admin tạo có yêu cầu NHÂN SỰ trước đây bị `doiNguonLead` ghi đè về nhóm nhân sự gốc ⇒ chính sách riêng
  // của nguồn mới không bao giờ áp dụng. Ghim `it.fails` đã GỠ khi vá (nó đỏ đúng lúc vá xong, như thiết kế).
  it("[NHH-DYN-V1-DB] chọn nhân sự ở NGUỒN DO ADMIN TẠO (yêu cầu nhân sự) ⇒ GIỮ nhóm đã chọn, không ghi đè về EMPLOYEE_REFERRAL", async () => {
    await dungNguoiDung(VAI.qlcs1);
    const nv = await dungNvVoiVai("75", "TEACHER");
    const nhomAdmin = await db.leadSourceGroup.create({ data: { code: `${P}NHOM_NV`, name: `${P}Nhóm nhân sự do admin tạo`, referrerRequirement: "EMPLOYEE", sortOrder: 120 } });
    const id = await dungLead({ ten: "V1" });
    const r = await doiNguonLeadAction({ leadId: id, groupId: nhomAdmin.id, employeeId: nv, lyDo: "Khách nói nhân sự này giới thiệu" });
    expect(r).toMatchObject({ ok: true });
    expect((await attr(id)).group.code).toBe(`${P}NHOM_NV`);
  }, CASE);

  it("[DYN-SNAP-01] đổi sang nguồn nhân sự: ẢNH CHỤP vai + dấu vết ghi vào dòng quy nguồn; đổi tiếp sang nguồn KHÔNG nhân sự ⇒ ảnh chụp bị DỌN (không còn vai/dấu vết của người cũ)", async () => {
    // Cấy bỏ `referrerRoleCode` khỏi cotDoi: đổi nguồn từ nhân sự sang Ads mà vai cũ còn nằm lại trên dòng.
    await dungNguoiDung(VAI.qlcs1);
    const nv = await dungNvVoiVai("76", "TEACHER");
    const id = await dungLead({ ten: "Snap1" });
    const r = await doiNguonLeadAction({ leadId: id, groupId: nhom.EMPLOYEE_REFERRAL, employeeId: nv, lyDo: "Khách nói cô giáo này giới thiệu" });
    expect(r).toMatchObject({ ok: true });
    const a = await attr(id);
    expect(a.referrerRoleCode).toBe("TEACHER");
    expect(a.referrerSaleUserId).toBeNull();
    expect(a.signals).toMatchObject({ nguoiGioiThieu: { employeeCode: `${P}NV76`, roleCodes: ["TEACHER"] } });
    // vai của nhân sự đổi SAU đó ⇒ ảnh chụp KHÔNG đổi theo (first-claim, không tính lại)
    const tk = await db.user.findFirstOrThrow({ where: { employeeId: nv }, select: { id: true } });
    await db.userOrgRole.deleteMany({ where: { userId: tk.id } });
    expect((await attr(id)).referrerRoleCode).toBe("TEACHER");
    const r2 = await doiNguonLeadAction({ leadId: id, groupId: nhom.PAID_ADS, lyDo: "Khách đính chính: thấy quảng cáo trên Facebook" });
    expect(r2).toMatchObject({ ok: true });
    const b = await attr(id);
    expect(b.referrerRoleCode).toBeNull();
    expect(b.referrerSaleUserId).toBeNull();
    expect((b.signals as Record<string, unknown>).nguoiGioiThieu).toBeUndefined();
  }, CASE);

  async function dungPhuHuynhCoSale(hau: string, saleUserId: string | null) {
    const ph = await db.user.create({ data: { name: `${P}ph${hau}`, email: `${P}ph${hau}@example.test`, role: "PARENT", roles: ["PARENT"], isActive: true }, select: { id: true } });
    const leadGoc = await db.lead.create({
      data: { parentName: `${P}goc${hau}`, phone: `0906${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`, status: "DA_DANG_KY", centerId: cs1, convertedById: saleUserId },
      select: { id: true },
    });
    const hv = await dungHocVien(hau, { centerId: cs1 });
    await db.student.update({ where: { id: hv.id }, data: { parentUserId: ph.id, leadId: leadGoc.id } });
    return { parentUserId: ph.id, studentId: hv.id, leadGocId: leadGoc.id };
  }
  const dungSaleThuong = (hau: string) =>
    db.user.create({ data: { name: `${P}sale${hau}`, email: `${P}sale${hau}@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], isActive: true }, select: { id: true } });

  it("[DYN-SNAP-02] PH giới thiệu: Sale phụ trách PH LÚC ĐÓ vào ảnh chụp; PH chuyển sang Sale khác SAU ĐÓ ⇒ dòng quy nguồn VẪN ghi Sale cũ; đổi sang nguồn không PH ⇒ cột Sale bị DỌN", async () => {
    // Cấy bỏ `referrerSaleUserId` khỏi cotDoi (hoặc tính lại mỗi lần đọc): hoa hồng acquisition của lead cũ chạy sang Sale mới của PH.
    await dungNguoiDung(VAI.qlcs1);
    const saleX = await dungSaleThuong("x");
    const saleY = await dungSaleThuong("y");
    const ph = await dungPhuHuynhCoSale("91", saleX.id);
    const id = await dungLead({ ten: "Snap2" });
    const r = await doiNguonLeadAction({ leadId: id, groupId: nhom.PARENT_REFERRAL, parentUserId: ph.parentUserId, studentId: ph.studentId, lyDo: "Phụ huynh cũ giới thiệu bạn này" });
    expect(r).toMatchObject({ ok: true });
    const a = await attr(id);
    expect(a.referrerSaleUserId).toBe(saleX.id);
    expect(a.referrerRoleCode).toBeNull();
    expect((a.signals as { coXemTay?: boolean }).coXemTay).not.toBe(true);
    // PH chuyển Sale: lead gốc của bé nay do Sale Y chốt — dòng quy nguồn của lead MỚI không đổi
    await db.lead.update({ where: { id: ph.leadGocId }, data: { convertedById: saleY.id } });
    expect((await attr(id)).referrerSaleUserId).toBe(saleX.id);
    // đối chứng dương: lead MỚI tạo SAU khi PH đổi Sale thì ghi Sale Y (ảnh chụp theo thời điểm, không dính cứng một người)
    const id2 = await dungLead({ ten: "Snap2b" });
    expect(await doiNguonLeadAction({ leadId: id2, groupId: nhom.PARENT_REFERRAL, parentUserId: ph.parentUserId, studentId: ph.studentId, lyDo: "Phụ huynh cũ giới thiệu bạn khác" })).toMatchObject({ ok: true });
    expect((await attr(id2)).referrerSaleUserId).toBe(saleY.id);
    // đổi sang nguồn KHÔNG PH ⇒ Sale ảnh chụp bị dọn
    expect(await doiNguonLeadAction({ leadId: id, groupId: nhom.PAID_ADS, lyDo: "Khách đính chính: thấy quảng cáo trên Facebook" })).toMatchObject({ ok: true });
    expect((await attr(id)).referrerSaleUserId).toBeNull();
  }, CASE);

  it("[DYN-SNAP-03] PH giới thiệu mà KHÔNG tìm được Sale (bé không nối lead gốc): referrerSaleUserId NULL + cờ xem tay THIEU_SALE_PH (coXemTay) — không tự gán Sale đang chăm lead", async () => {
    await dungNguoiDung(VAI.qlcs1);
    const ph = await dungPhuHuynhCoSale("92", null); // lead gốc không có convertedById/assignedToId
    const id = await dungLead({ ten: "Snap3" });
    expect(await doiNguonLeadAction({ leadId: id, groupId: nhom.PARENT_REFERRAL, parentUserId: ph.parentUserId, studentId: ph.studentId, lyDo: "Phụ huynh cũ giới thiệu bạn này" })).toMatchObject({ ok: true });
    const a = await attr(id);
    expect(a.referrerSaleUserId).toBeNull();
    expect(a.signals).toMatchObject({ coXemTay: true, xemTay: ["THIEU_SALE_PH"] });
  }, CASE);

  it("[DYN-WIN-UI] Sheet gán nguồn: hạn ghi công theo cửa sổ RIÊNG của nguồn (30 ngày) chứ không theo setting chung (90) — màn hình và engine cùng một số; nguồn không khai cửa sổ ⇒ setting chung", async () => {
    // Cấy: doc-gan-nguon quay lại dùng `p.cuaSoNgay` — Sheet nói "còn hạn ghi công" trong khi engine đã coi khoản là ngoài cửa sổ.
    await dungNguoiDung(VAI.qlcs1);
    const g30 = await db.leadSourceGroup.create({ data: { code: `${P}CS30`, name: `${P}cửa sổ 30`, referrerRequirement: "NONE", sortOrder: 130, attributionWindowDays: 30 } });
    const rieng = await dungLead({ ten: "Win30", groupId: g30.id }); // attributedAt = 01/08/2026; NOW = 08/10/2026
    const chung = await dungLead({ ten: "WinNull" }); // PAID_ADS, cửa sổ NULL ⇒ 90
    const s30 = (await doc(rieng))!.nguon!;
    expect(s30.hanGhiCong).toBe("2026-08-31T16:59:59.999Z"); // hết ngày VN thứ 30 kể từ 01/08 (= 31/08 giờ VN)
    expect(s30.conHanGhiCong).toBe(false);
    const s90 = (await doc(chung))!.nguon!;
    expect(s90.hanGhiCong).toBe("2026-10-30T16:59:59.999Z"); // 01/08 + 90 ngày = 30/10 giờ VN
    expect(s90.conHanGhiCong).toBe(true);
  }, CASE);

  it("[NHH-UI-ACT-08] quyền quyết ĐỊNH TRƯỚC mọi tra cứu theo id người gửi: người KHÔNG có khoá nguồn nào nhận cùng MỘT câu 'không có quyền' dù gửi nhóm/nhân sự/đối tác không tồn tại (không dò được id)", async () => {
    // Cấy bỏ cổng sớm: câu lỗi đổi theo id ('Nguồn mới không tồn tại.' / 'Nhân sự giới thiệu không còn…') ⇒ dò được id nào có thật.
    await dungNguoiDung(VAI.sale1);
    const id = await dungLead({ ten: "KhongQuyen" });
    const ca = [
      { groupId: "nhom-khong-co" },
      { groupId: nhom.EMPLOYEE_REFERRAL, employeeId: "nhan-su-khong-co" },
      { groupId: nhom.PARTNER, affiliateId: "doi-tac-khong-co" },
      { groupId: nhom.WALK_IN },
    ];
    const cauLoi = new Set<string>();
    for (const c of ca) {
      const r = await doiNguonLeadAction({ leadId: id, lyDo: "Sale muốn đổi nguồn lead này", ...c });
      expect(r, JSON.stringify(c)).toMatchObject({ ok: false, field: "quyen" });
      cauLoi.add((r as { error: string }).error);
    }
    expect([...cauLoi]).toEqual(["Bạn không có quyền đổi nguồn lead."]);
    expect(await demAudit(id)).toBe(0);
    // đối chứng dương: QLCS (có leads:overwrite) với id không có thật ⇒ lỗi theo ô, không phải 'quyền'
    await dungNguoiDung(VAI.qlcs1);
    expect(await doiNguonLeadAction({ leadId: id, groupId: "nhom-khong-co", lyDo: "Quản lý đổi nguồn lead này" })).toMatchObject({ ok: false, field: "nguon" });
  }, CASE);

  it("[NHH-UI-ACT-09] người giới thiệu ĐÃ XOÁ MỀM bị từ chối ở đường đổi nguồn: phụ huynh (User) hoặc học viên đã xoá ⇒ field 'thamChieu'; còn nguyên (đối chứng dương) ⇒ đổi được", async () => {
    // Cấy bỏ `deletedAt: null` ở kiemNguoiTonTai (user hoặc student): gắn hoa hồng cho một hồ sơ đã xoá.
    await dungNguoiDung(VAI.qlcs1);
    const xoaLuc = new Date("2026-09-01T00:00:00.000Z");
    const uXoa = await db.user.create({ data: { name: `${P}phx`, email: `${P}phx@example.test`, role: "PARENT", roles: ["PARENT"], isActive: true, deletedAt: xoaLuc }, select: { id: true } });
    const uCon = await db.user.create({ data: { name: `${P}phc`, email: `${P}phc@example.test`, role: "PARENT", roles: ["PARENT"], isActive: true }, select: { id: true } });
    const hvXoa = await dungHocVien("81", { centerId: cs1 });
    await db.student.update({ where: { id: hvXoa.id }, data: { deletedAt: xoaLuc } });
    const hvCon = await dungHocVien("82", { centerId: cs1 });
    const id = await dungLead({ ten: "XoaMem" });
    for (const tc of [{ parentUserId: uXoa.id }, { studentId: hvXoa.id }]) {
      const r = await doiNguonLeadAction({ leadId: id, groupId: nhom.PARENT_REFERRAL, lyDo: "Phụ huynh giới thiệu khách này", ...tc });
      expect(r, JSON.stringify(tc)).toMatchObject({ ok: false, field: "thamChieu" });
    }
    expect((await attr(id)).group.code).toBe("PAID_ADS");
    expect(await demAudit(id)).toBe(0);
    const ok = await doiNguonLeadAction({ leadId: id, groupId: nhom.PARENT_REFERRAL, parentUserId: uCon.id, studentId: hvCon.id, lyDo: "Phụ huynh giới thiệu khách này" });
    expect(ok).toMatchObject({ ok: true });
  }, CASE);

  it("[NHH-UI-TN-09] ô tìm phụ huynh KHÔNG liệt kê học viên đã xoá mềm (lộ tên/mã hồ sơ đã xoá); còn nguyên (đối chứng dương) ⇒ ra", async () => {
    // Cấy bỏ `deletedAt: null` ở timPhuHuynh.
    const xoa = await dungHocVien("83", { centerId: cs1, parentName: `${P}Mơ Đã Xoá` });
    await db.student.update({ where: { id: xoa.id }, data: { deletedAt: new Date("2026-09-01T00:00:00.000Z") } });
    await dungHocVien("84", { centerId: cs1, parentName: `${P}Mơ Còn Đó` });
    const actor = await resolveActorUncached((await dungNguoiDung(VAI.qlcs1)).id);
    const r = await timNguoiGioiThieu(actor, { loai: "PHU_HUYNH", q: `${P}Mơ`, gioiHan: 10, coTheTimTheoSdt: false, canViewPii: true, now: NOW });
    expect(r.map((x) => (x.loai === "PHU_HUYNH" ? x.ma : null))).toEqual([`${P}HV84`]);
  }, CASE);

  it("[NHH-UI-DB-09] lead KHÔNG đổi được nguồn thì Sheet không mang số tiền đã thu (thực thu chỉ trả cho người đổi được: cảnh báo hệ quả chỉ có nghĩa với họ)", async () => {
    // Cấy `thucThu` luôn được trả: người chỉ có sources:view (không leads:overwrite, không payments:view) đọc được tổng tiền của lead.
    const id = await dungLead({ ten: "ThuAn" });
    await dungDonDaThu(id, 7_000_000);
    await dungNguoiDung(VAI.sale1);
    const khong = await doc(id);
    expect(khong!.quyen.ok).toBe(false);
    expect(khong!.thucThu).toBeNull();
    await dungNguoiDung(VAI.admin);
    const co = await doc(id);
    expect(co!.quyen.ok).toBe(true);
    expect(co!.thucThu).toEqual({ soKhoan: 1, tong: 7_000_000 });
  }, CASE);

  // ── timNguoiGioiThieu ───────────────────────────────────────────────────────────────────────────────
  it("[NHH-UI-TN-01] nhân sự: CHỈ đang làm việc (ACTIVE/ON_LEAVE); đã nghỉ ⇒ KHÔNG hiện (D13); không SĐT/email trong kết quả", async () => {
    await dungNv("11", { ten: `${P}Hoa Đang Làm` });
    await dungNv("12", { ten: `${P}Hoa Đã Nghỉ`, status: "RESIGNED" });
    const actor = await resolveActorUncached((await dungNguoiDung(VAI.qlcs1)).id);
    const r = await timNguoiGioiThieu(actor, { loai: "NHAN_SU", q: "Hoa", gioiHan: 10, coTheTimTheoSdt: false, canViewPii: false, now: NOW });
    expect(r.map((x) => x.ten)).toEqual([`${P}Hoa Đang Làm`]);
    expect(JSON.stringify(r)).not.toMatch(/0911222333|@example\.test/);
  }, CASE);

  it("[NHH-UI-TN-02] nhân sự: tìm theo MÃ cũng được; vai suy từ UserOrgRole hiệu lực (Giáo viên → vai TEACHER); không vai ⇒ vai OTHER_EMPLOYEE; cùng một nhóm nhân sự giới thiệu", async () => {
    const eGv = await dungNv("21", { ten: `${P}Cô Giáo` });
    const eKhong = await dungNv("22", { ten: `${P}Anh Bảo Vệ` });
    const u = await db.user.create({
      data: { name: `${P}gv`, email: `${P}gv-acc@example.test`, role: "TEACHER", roles: ["TEACHER"], isActive: true, employeeId: eGv },
      select: { id: true },
    });
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const role = await db.roleDef.findUniqueOrThrow({ where: { code: "TEACHER" }, select: { id: true } });
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "nuig", effectiveFrom: new Date(NOW.getTime() - 86_400_000) } });
    const actor = await resolveActorUncached((await dungNguoiDung(VAI.qlcs1)).id);
    const gv = await timNguoiGioiThieu(actor, { loai: "NHAN_SU", q: `${P}NV21`, gioiHan: 5, coTheTimTheoSdt: false, canViewPii: false, now: NOW });
    expect(gv).toHaveLength(1);
    expect(gv[0]).toMatchObject({ loai: "NHAN_SU", employeeId: eGv, vai: "TEACHER" });
    expect(gv[0]).not.toHaveProperty("nhomCode"); // vai chỉ là ảnh chụp — kết quả tìm KHÔNG hứa một nhóm nào
    const kv = await timNguoiGioiThieu(actor, { loai: "NHAN_SU", q: `${P}NV22`, gioiHan: 5, coTheTimTheoSdt: false, canViewPii: false, now: NOW });
    expect(kv[0]).toMatchObject({ employeeId: eKhong, vai: "OTHER_EMPLOYEE" });
    // vai CHƯA hiệu lực lúc `now` ⇒ không tính (luật 19: now là tham số)
    const truoc = await timNguoiGioiThieu(actor, { loai: "NHAN_SU", q: `${P}NV21`, gioiHan: 5, coTheTimTheoSdt: false, canViewPii: false, now: new Date(NOW.getTime() - 5 * 86_400_000) });
    expect(truoc[0]).toMatchObject({ vai: "OTHER_EMPLOYEE" });
  }, CASE);

  it("[NHH-UI-TN-02b] vai đã TẠM DỪNG (UserOrgRole.status ≠ ACTIVE) không tính vào nhóm: giáo viên bị tạm dừng vai ⇒ 'nhân sự khác'; vai ACTIVE ⇒ giáo viên (đối chứng dương)", async () => {
    // Cấy bỏ `status: "ACTIVE"` ở timNhanSu: ô chọn hiện "Giáo viên" cho người đã bị dừng vai, trong khi resolver máy chủ không tính vai đó.
    const eDung = await dungNv("23", { ten: `${P}Cô Tạm Dừng` });
    const eChay = await dungNv("24", { ten: `${P}Cô Đang Dạy` });
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const role = await db.roleDef.findUniqueOrThrow({ where: { code: "TEACHER" }, select: { id: true } });
    for (const [emp, hau, status] of [[eDung, "dung", "SUSPENDED"], [eChay, "chay", "ACTIVE"]] as const) {
      const u = await db.user.create({
        data: { name: `${P}gv-${hau}`, email: `${P}gv-${hau}@example.test`, role: "TEACHER", roles: ["TEACHER"], isActive: true, employeeId: emp },
        select: { id: true },
      });
      await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "nuig", status, effectiveFrom: new Date(NOW.getTime() - 86_400_000) } });
    }
    const actor = await resolveActorUncached((await dungNguoiDung(VAI.qlcs1)).id);
    const dau = { loai: "NHAN_SU" as const, gioiHan: 5, coTheTimTheoSdt: false, canViewPii: false, now: NOW };
    expect((await timNguoiGioiThieu(actor, { ...dau, q: `${P}NV23` }))[0]).toMatchObject({ employeeId: eDung, vai: "OTHER_EMPLOYEE" });
    expect((await timNguoiGioiThieu(actor, { ...dau, q: `${P}NV24` }))[0]).toMatchObject({ employeeId: eChay, vai: "TEACHER" });
  }, CASE);

  it("[NHH-UI-TN-03] nhân sự ở cơ sở KHÁC vẫn tìm được (người giới thiệu không bị cách ly theo cơ sở — máy chủ cũng nhận họ)", async () => {
    await dungNv("31", { ten: `${P}Nhân viên CS2`, centerId: cs2 });
    const actor = await resolveActorUncached((await dungNguoiDung(VAI.qlcs1)).id);
    const r = await timNguoiGioiThieu(actor, { loai: "NHAN_SU", q: "Nhân viên CS2", gioiHan: 5, coTheTimTheoSdt: false, canViewPii: false, now: NOW });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ ma: expect.stringContaining("CS2") });
  }, CASE);

  async function dungHocVien(hau: string, o: { centerId: string; parentName?: string | null; parentPhone?: string | null }) {
    return db.student.create({
      data: {
        name: `${P}Bé ${hau}`,
        studentCode: `${P}HV${hau}`,
        centerId: o.centerId,
        parentName: o.parentName === undefined ? `Phụ huynh ${hau}` : o.parentName,
        parentPhone: o.parentPhone ?? null,
      },
      select: { id: true },
    });
  }

  it("[NHH-UI-TN-04] phụ huynh: CÁCH LY CƠ SỞ — QLCS CS1 không dò được phụ huynh của học viên CS2", async () => {
    await dungHocVien("41", { centerId: cs1, parentName: `${P}Mận Một` });
    await dungHocVien("42", { centerId: cs2, parentName: `${P}Mận Hai` });
    const actor = await resolveActorUncached((await dungNguoiDung(VAI.qlcs1)).id);
    const r = await timNguoiGioiThieu(actor, { loai: "PHU_HUYNH", q: `${P}Mận`, gioiHan: 10, coTheTimTheoSdt: false, canViewPii: true, now: NOW });
    expect(r.map((x) => (x.loai === "PHU_HUYNH" ? x.ma : null))).toEqual([`${P}HV41`]);
    const admin = await resolveActorUncached((await dungNguoiDung(VAI.admin)).id);
    const tatCa = await timNguoiGioiThieu(admin, { loai: "PHU_HUYNH", q: `${P}Mận`, gioiHan: 10, coTheTimTheoSdt: false, canViewPii: true, now: NOW });
    expect(tatCa).toHaveLength(2);
  }, CASE);

  it("[NHH-UI-TN-05] phụ huynh: tìm theo SĐT CHỈ khi được xem PII; không thì gõ số không ra ai (không dò được 'SĐT này có phải phụ huynh')", async () => {
    await dungHocVien("51", { centerId: cs1, parentName: "Phạm Thị Lựu", parentPhone: "0912345678" });
    const actor = await resolveActorUncached((await dungNguoiDung(VAI.qlcs1)).id);
    const khong = await timNguoiGioiThieu(actor, { loai: "PHU_HUYNH", q: "0912345678", gioiHan: 10, coTheTimTheoSdt: false, canViewPii: false, now: NOW });
    expect(khong).toEqual([]);
    const co = await timNguoiGioiThieu(actor, { loai: "PHU_HUYNH", q: "0912 345 678", gioiHan: 10, coTheTimTheoSdt: true, canViewPii: true, now: NOW });
    expect(co).toHaveLength(1);
    expect(co[0]).toMatchObject({ loai: "PHU_HUYNH", ma: `${P}HV51` });
    // kết quả không bao giờ mang SĐT
    expect(JSON.stringify(co)).not.toContain("0912345678");
  }, CASE);

  it("[NHH-UI-TN-06] phụ huynh: tên che khi không có quyền PII; có quyền ⇒ nguyên văn; gắn studentId + parentUserId để máy chủ ghi đúng cột", async () => {
    const pu = await db.user.create({ data: { name: `${P}ph`, email: `${P}ph@example.test`, role: "PARENT", roles: ["PARENT"], isActive: true }, select: { id: true } });
    const s = await dungHocVien("61", { centerId: cs1, parentName: "Hoàng Thị Cúc" });
    await db.student.update({ where: { id: s.id }, data: { parentUserId: pu.id } });
    const actor = await resolveActorUncached((await dungNguoiDung(VAI.qlcs1)).id);
    const che = await timNguoiGioiThieu(actor, { loai: "PHU_HUYNH", q: `${P}HV61`, gioiHan: 5, coTheTimTheoSdt: false, canViewPii: false, now: NOW });
    expect(che[0]).toMatchObject({ studentId: s.id, parentUserId: pu.id });
    expect(che[0]!.ten).not.toContain("Cúc");
    const ro = await timNguoiGioiThieu(actor, { loai: "PHU_HUYNH", q: `${P}HV61`, gioiHan: 5, coTheTimTheoSdt: false, canViewPii: true, now: NOW });
    expect(ro[0]!.ten).toBe("Hoàng Thị Cúc");
  }, CASE);

  it("[NHH-UI-TN-07] đối tác: chỉ đang hoạt động; tìm theo tên hoặc mã", async () => {
    await db.affiliate.create({ data: { code: "NUIGAFF01", name: `${P}Công ty Sao Mai`, isActive: true } });
    await db.affiliate.create({ data: { code: "NUIGAFF02", name: `${P}Công ty Sao Hỏa`, isActive: false } });
    const actor = await resolveActorUncached((await dungNguoiDung(VAI.marketing)).id);
    const r = await timNguoiGioiThieu(actor, { loai: "DOI_TAC", q: `${P}Công ty Sao`, gioiHan: 10, coTheTimTheoSdt: false, canViewPii: false, now: NOW });
    expect(r.map((x) => (x.loai === "DOI_TAC" ? x.ma : null))).toEqual(["NUIGAFF01"]);
    expect((await timNguoiGioiThieu(actor, { loai: "DOI_TAC", q: "nuigaff01", gioiHan: 10, coTheTimTheoSdt: false, canViewPii: false, now: NOW })).length).toBe(1);
  }, CASE);

  it("[NHH-UI-TN-08] ô tìm KHÔNG phải đường tải danh bạ: kết quả bị chặn ở gioiHan (≤ 20), q dưới 2 ký tự ⇒ rỗng, ký tự % _ không thành ký tự đại diện", async () => {
    for (let i = 0; i < 25; i++) await dungNv(String(100 + i), { ten: `${P}Nhóm Tìm ${i}` });
    const actor = await resolveActorUncached((await dungNguoiDung(VAI.qlcs1)).id);
    const dau = { loai: "NHAN_SU" as const, coTheTimTheoSdt: false, canViewPii: false, now: NOW };
    expect((await timNguoiGioiThieu(actor, { ...dau, q: "Nhóm Tìm", gioiHan: 500 })).length).toBe(20);
    expect((await timNguoiGioiThieu(actor, { ...dau, q: "Nhóm Tìm", gioiHan: 3 })).length).toBe(3);
    expect(await timNguoiGioiThieu(actor, { ...dau, q: "N", gioiHan: 10 })).toEqual([]);
    expect(await timNguoiGioiThieu(actor, { ...dau, q: "  ", gioiHan: 10 })).toEqual([]);
    expect(await timNguoiGioiThieu(actor, { ...dau, q: "%%", gioiHan: 10 })).toEqual([]);
    expect(await timNguoiGioiThieu(actor, { ...dau, q: "__", gioiHan: 10 })).toEqual([]);
    expect(await timNguoiGioiThieu(actor, { ...dau, q: "\\\\", gioiHan: 10 })).toEqual([]);
    // đối chứng dương: dấu gạch dưới THẬT trong mã vẫn khớp như ký tự thường
    expect((await timNguoiGioiThieu(actor, { ...dau, q: `${P}NV100`, gioiHan: 10 })).length).toBe(1);
  }, CASE);
});
