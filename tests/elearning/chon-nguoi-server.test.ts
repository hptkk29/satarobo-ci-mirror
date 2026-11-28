// @vitest-environment node
/**
 * HOTFIX 26/10/2026 — SERVER KHÔNG ĐƯỢC TIN ID NGƯỜI DO GIAO DIỆN GỬI (Postgres thật).
 *
 * Hai action nhận một `userId` từ client rồi GHI nguyên văn:
 *   • `taoChuongTrinh`      → `TrnProgram.contentOwnerUserId`
 *   • `datMucGanDanhGia`    → `TrnEvalLinkConfig.hrApprovedByUserId` (EL-21, luật hai người)
 * Ô chọn nhân sự chỉ liệt kê người hợp lệ, nhưng request tự dựng thì không đi qua ô chọn. Đo TRÊN TEST (26/10): cả hai nhận id giả,
 * người ngoài cơ sở, người đã nghỉ, chuỗi toàn khoảng trắng; EL-21 còn cho tự phê duyệt.
 *
 * Quy ước mọi ca ÂM TÍNH: (1) đúng mã lỗi, (2) KHÔNG ghi gì — đếm dòng trước/sau (luật rollback: `return` không rollback).
 * Mọi ca âm tính có ĐỐI CHỨNG DƯƠNG đứng cạnh (luật 11): vắng-mặt-luôn-ĐẠT khi tính năng hỏng hoàn toàn.
 *
 * Chạy: `pnpm test:elearning-db` (cần Postgres local, đã `migrate deploy`). Không có DB ⇒ SKIP, không phải xanh.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import { resolveActorUncached, type Actor } from "../../lib/auth/actor";
import { runAction, type ActionConfig } from "../../lib/actions/factory";
import { cauHinhTaoChuongTrinh } from "../../lib/elearning/program-create";
import { cauHinhDatMucGanDanhGia } from "../../lib/elearning/eval-link";
import { napNhanSuChon } from "../../lib/elearning/nhan-su-chon";
import { xacMinhNguoiDuocChon, xacMinhNguoiNhanSuDuyet } from "../../lib/elearning/nhan-su-chon-xac-minh";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

type Dang = {
  /** Vai RBAC v2 (UserOrgRole) — null = không giữ vai nào. */
  vai: string | null;
  /** Vai thứ hai (người kiêm nhiệm). */
  vai2?: string;
  coSo: "HO" | "CS1" | "CS2";
  nhanVien?: { status?: "ACTIVE" | "RESIGNED"; isActive?: boolean } | null;
  taiKhoan?: { isActive?: boolean; deletedAt?: Date | null; accountStatus?: "ACTIVE" | "DISABLED" };
};

const IDS: Record<string, string> = {};
let maSo = 0;

/**
 * ⚠️ KHÔNG `resetDb()` (TRUNCATE mọi bảng) — sự cố CI 26/10/2026. Ở CI các bộ DB chạy TUẦN TỰ trên CÙNG một database `ci_test`
 * (`ci-guong/ci.yml`: chat → nền → elearning → lead-intake → … → hoa hồng). TRUNCATE ở đây xoá cả dữ liệu danh mục do MIGRATION seed
 * (CommissionRole, LeadSourceGroup…) và 50 ca của bộ hoa hồng/lead-intake chạy SAU đỏ ("expected [] to deeply equal [SALE…]").
 * Ở máy dev không thấy vì mỗi bộ chạy trên DB riêng. Quy ước của khu này (xem `cach-ly-co-so.spec.ts`): chỉ dọn dữ liệu MANG DẤU
 * của chính bộ test, ở beforeAll VÀ afterAll.
 */
const HAU_TO_EMAIL = "@hotfix.test";
const TIEN_TO_MA_NV = "EL-HF-";

/** Xoá đúng dữ liệu MANG DẤU của bộ này (người dùng giữ lại: `seedUser` upsert theo email nên chạy lại vẫn đúng). */
async function don(): Promise<void> {
  const nguoi = await db.user.findMany({ where: { email: { endsWith: HAU_TO_EMAIL } }, select: { id: true } });
  const ids = nguoi.map((u) => u.id);
  if (ids.length > 0) {
    const ct = await db.trnProgram.findMany({ where: { ownerUserId: { in: ids } }, select: { id: true } });
    const idCt = ct.map((c) => c.id);
    if (idCt.length > 0) {
      await db.trnEvalLinkConfig.deleteMany({ where: { programId: { in: idCt } } });
      await db.trnProgram.deleteMany({ where: { id: { in: idCt } } });
    }
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
  }
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: TIEN_TO_MA_NV } } });
}

async function lap(ten: string, d: Dang): Promise<string> {
  maSo += 1;
  const coSo = await db.center.findUnique({ where: { code: d.coSo }, select: { id: true } });
  let employeeId: string | null = null;
  if (d.nhanVien !== null) {
    const nv = await db.employee.create({
      data: {
        employeeCode: `${TIEN_TO_MA_NV}${maSo}`,
        fullName: `Người ${ten}`,
        jobTitle: "Chuyên viên",
        department: "DAO_TAO",
        isActive: d.nhanVien?.isActive ?? true,
        status: d.nhanVien?.status ?? "ACTIVE",
        centerId: d.coSo === "HO" ? null : (coSo?.id ?? null),
      },
      select: { id: true },
    });
    employeeId = nv.id;
  }
  const u = await seedUser({ email: `${ten}${HAU_TO_EMAIL}`, role: "TEACHER", name: ten });
  await db.user.update({
    where: { id: u.id },
    data: {
      employeeId,
      isActive: d.taiKhoan?.isActive ?? true,
      deletedAt: d.taiKhoan?.deletedAt ?? null,
      accountStatus: d.taiKhoan?.accountStatus ?? "ACTIVE",
    },
  });
  for (const ma of [d.vai, d.vai2]) {
    if (!ma) continue;
    const donVi = await db.orgUnit.findFirstOrThrow({ where: { code: d.coSo }, select: { id: true } });
    const vai = await db.roleDef.findUniqueOrThrow({ where: { code: ma }, select: { id: true } });
    await db.userOrgRole.create({
      data: { userId: u.id, orgUnitId: donVi.id, roleId: vai.id, grantedById: u.id },
    });
  }
  IDS[ten] = u.id;
  return u.id;
}

const actorCua = (ten: string): Promise<Actor> => resolveActorUncached(IDS[ten]);

async function chay<I, T>(cfg: ActionConfig<I, T>, ten: string, input: unknown, reason?: string) {
  const actor = await actorCua(ten);
  return (await runAction(cfg, actor, input, { actorName: ten, reason })).res;
}

const demChuongTrinh = () => db.trnProgram.count();
const demCauHinh = () => db.trnEvalLinkConfig.count();

const dauVaoChuongTrinh = (owner: unknown) => ({
  title: "Chương trình thử hotfix",
  objectives: ["Mục tiêu một", "Mục tiêu hai", "Mục tiêu ba"],
  primaryFunctionTag: "HR",
  functionTags: ["HR"],
  levelTags: ["L1"],
  stageTag: "IN_SERVICE",
  durationTag: "S",
  natureTag: "OPTIONAL",
  formatTag: "ELEARNING",
  securityTag: "INTERNAL",
  needExemptReason: "Miễn phiếu nhu cầu vì kiểm thử tự động",
  contentOwnerUserId: owner,
});

const dauVaoMuc = (programId: string, hr: unknown, extra: Record<string, unknown> = {}) => ({
  programId,
  mode: "LINKED",
  criteria: ["ON_TIME"],
  weightOnTime: 100,
  effectiveFrom: new Date("2099-01-01T00:00:00Z"),
  decisionDocCode: "QD-HOTFIX-01",
  decisionDocEffectiveAt: new Date("2026-01-01T00:00:00Z"),
  hrApprovedByUserId: hr,
  ...extra,
});

const LYDO = "Kiểm thử tự động hotfix";

describe.skipIf(!RUN_DB_TESTS)("server xác minh người được chọn — Postgres thật", () => {
  let progToanCty = "";
  let progCs1 = "";
  let envCu: string | undefined;

  beforeAll(async () => {
    envCu = process.env.ELEARNING_EVAL_LINK_ENABLED;
    process.env.ELEARNING_EVAL_LINK_ENABLED = "true"; // cờ EL-21 BẬT — chỉ trong tiến trình test
    await don(); // dọn dấu vết của lượt chạy trước (nếu có) — KHÔNG TRUNCATE
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();

    // Người thao tác
    await lap("dao_tao_ho", { vai: "TRAINING", coSo: "HO" });
    await lap("dao_tao_cs1", { vai: "TRAINING", coSo: "CS1" });
    await lap("hr_ho", { vai: "HO_HR", coSo: "HO" });
    await lap("ql_cs1", { vai: "CENTER_MANAGER", coSo: "CS1" }); // KHÔNG có elearning:program:manage

    // Ứng viên hợp lệ
    await lap("hr_ho_2", { vai: "HO_HR", coSo: "HO" });
    await lap("sa_thuan", { vai: "SUPER_ADMIN", coSo: "HO" }); // chỉ SUPER_ADMIN, KHÔNG phải HR
    await lap("sa_kiem_hr", { vai: "SUPER_ADMIN", vai2: "HO_HR", coSo: "HO" }); // SUPER_ADMIN nhưng CŨNG giữ vai HR thật
    await lap("hr_cs1", { vai: "CENTER_HR", coSo: "CS1" });
    await lap("hr_cs2", { vai: "CENTER_HR", coSo: "CS2" });
    await lap("nv_cs1", { vai: null, coSo: "CS1" });
    await lap("nv_cs2", { vai: null, coSo: "CS2" });

    // Ứng viên KHÔNG hợp lệ
    await lap("nv_nghi", { vai: null, coSo: "CS1", nhanVien: { status: "RESIGNED" } });
    await lap("nv_thoi_viec", { vai: null, coSo: "CS1", nhanVien: { isActive: false } });
    await lap("nv_khoa_isactive", { vai: null, coSo: "CS1", taiKhoan: { isActive: false } });
    await lap("nv_xoa_mem", { vai: null, coSo: "CS1", taiKhoan: { deletedAt: new Date("2026-01-01T00:00:00Z") } });
    await lap("nv_disabled", { vai: null, coSo: "CS1", taiKhoan: { accountStatus: "DISABLED" } });
    await lap("khong_ho_so", { vai: null, coSo: "CS1", nhanVien: null });
    // Người Nhân sự nhưng đã nghỉ / bị khoá — vai còn nguyên trong DB
    await lap("hr_da_nghi", { vai: "HO_HR", coSo: "HO", nhanVien: { status: "RESIGNED" } });
    await lap("hr_bi_khoa", { vai: "HO_HR", coSo: "HO", taiKhoan: { accountStatus: "DISABLED" } });

    // Hai chương trình: toàn công ty và riêng CS1
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const mk = (seq: number, centerId: string | null) =>
      db.trnProgram.create({
        data: {
          code: `HR-2026-HF${seq}`,
          year: 2026,
          seq,
          title: `CT thử ${seq}`,
          primaryFunctionTag: "HR",
          stageTag: "IN_SERVICE",
          durationTag: "S",
          natureTag: "OPTIONAL",
          formatTag: "ELEARNING",
          ownerUserId: IDS.hr_ho,
          centerId,
        },
        select: { id: true },
      });
    progToanCty = (await mk(901, null)).id;
    progCs1 = (await mk(902, cs1.id)).id;
  });

  afterAll(async () => {
    if (envCu === undefined) delete process.env.ELEARNING_EVAL_LINK_ENABLED;
    else process.env.ELEARNING_EVAL_LINK_ENABLED = envCu;
    await don();
    await disconnectDb();
  });

  // ═══ A. Ô CHỌN VÀ SERVER DÙNG CHUNG MỘT VỊ TỪ ═══════════════════════════════
  describe("ô chọn ⊆ server (lời hứa không suông)", () => {
    it("[CN-P1] ô chọn của Hội sở liệt kê người hợp lệ và LOẠI mọi loại không hợp lệ", async () => {
      const { ds } = await napNhanSuChon(scopedDb(await actorCua("dao_tao_ho")));
      const co = new Set(ds.map((x) => x.userId));
      for (const ten of ["nv_cs1", "nv_cs2", "hr_ho", "hr_cs1"]) expect(co.has(IDS[ten]), ten).toBe(true);
      for (const ten of [
        "nv_nghi", "nv_thoi_viec", "nv_khoa_isactive", "nv_xoa_mem", "nv_disabled", "khong_ho_so", "hr_da_nghi", "hr_bi_khoa",
      ]) {
        expect(co.has(IDS[ten]), `${ten} không được hiện trong ô chọn`).toBe(false);
      }
    });

    it("[CN-P2] người cấp cơ sở chỉ thấy người cơ sở mình", async () => {
      const { ds } = await napNhanSuChon(scopedDb(await actorCua("dao_tao_cs1")));
      const co = new Set(ds.map((x) => x.userId));
      expect(co.has(IDS.nv_cs1)).toBe(true);
      expect(co.has(IDS.nv_cs2)).toBe(false);
      expect(co.has(IDS.hr_cs2)).toBe(false);
    });

    it("[CN-P3] MỌI người mà ô chọn đưa ra, server đều nhận (ô chọn không hứa suông)", async () => {
      for (const ten of ["dao_tao_ho", "dao_tao_cs1"]) {
        const sdb = scopedDb(await actorCua(ten));
        const { ds } = await napNhanSuChon(sdb);
        expect(ds.length).toBeGreaterThan(0);
        for (const x of ds) {
          await expect(xacMinhNguoiDuocChon(sdb, x.userId, "contentOwnerUserId")).resolves.toMatchObject({ userId: x.userId });
        }
      }
    });
  });

  // ═══ B. TẠO CHƯƠNG TRÌNH — contentOwnerUserId ═══════════════════════════════
  describe("taoChuongTrinh — contentOwnerUserId", () => {
    const TU_CHOI: [string, () => unknown, string][] = [
      ["[TC-N1] id giả", () => "khong-ton-tai-123", "VALIDATION"],
      ["[TC-N2] chuỗi toàn khoảng trắng", () => "     ", "VALIDATION"],
      ["[TC-N3] id sai hình dạng (ký tự lạ)", () => "a b'; drop table--", "VALIDATION"],
      ["[TC-N4] id quá dài", () => "x".repeat(65), "VALIDATION"],
      ["[TC-N5] không phải chuỗi (số)", () => 12345, "VALIDATION"],
      ["[TC-N6] nhân sự đã NGHỈ (status RESIGNED)", () => IDS.nv_nghi, "VALIDATION"],
      ["[TC-N7] nhân sự `isActive=false`", () => IDS.nv_thoi_viec, "VALIDATION"],
      ["[TC-N8] tài khoản bị khoá — `User.isActive=false`", () => IDS.nv_khoa_isactive, "VALIDATION"],
      ["[TC-N9] tài khoản xoá mềm — `deletedAt`", () => IDS.nv_xoa_mem, "VALIDATION"],
      ["[TC-N10] tài khoản `accountStatus=DISABLED`", () => IDS.nv_disabled, "VALIDATION"],
      ["[TC-N11] tài khoản không có hồ sơ nhân viên", () => IDS.khong_ho_so, "VALIDATION"],
    ];

    for (const [ten, lay, ma] of TU_CHOI) {
      it(`${ten} ⇒ ${ma}, KHÔNG ghi gì`, async () => {
        const truoc = await demChuongTrinh();
        const r = await chay(cauHinhTaoChuongTrinh, "dao_tao_ho", dauVaoChuongTrinh(lay()));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe(ma);
        expect(await demChuongTrinh()).toBe(truoc);
      });
    }

    it("[TC-N12] NGOÀI CƠ SỞ: Đào tạo cơ sở 1 chọn người cơ sở 2 ⇒ VALIDATION, KHÔNG ghi", async () => {
      const truoc = await demChuongTrinh();
      const r = await chay(cauHinhTaoChuongTrinh, "dao_tao_cs1", dauVaoChuongTrinh(IDS.nv_cs2));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("VALIDATION");
      expect(await demChuongTrinh()).toBe(truoc);
    });

    it("[TC-N13] THIẾU QUYỀN: Quản lý cơ sở (không có program:manage) ⇒ PERMISSION_DENIED, KHÔNG ghi", async () => {
      const truoc = await demChuongTrinh();
      const r = await chay(cauHinhTaoChuongTrinh, "ql_cs1", dauVaoChuongTrinh(IDS.nv_cs1));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("PERMISSION_DENIED");
      expect(await demChuongTrinh()).toBe(truoc);
    });

    it("[TC-P1] ĐỐI CHỨNG DƯƠNG: người hợp lệ cùng cơ sở ⇒ ok, ghi đúng id", async () => {
      const r = await chay(cauHinhTaoChuongTrinh, "dao_tao_cs1", dauVaoChuongTrinh(IDS.nv_cs1));
      expect(r.ok).toBe(true);
      if (r.ok) {
        const ct = await db.trnProgram.findUniqueOrThrow({ where: { id: r.data.programId }, select: { contentOwnerUserId: true } });
        expect(ct.contentOwnerUserId).toBe(IDS.nv_cs1);
      }
    });

    it("[TC-P2] ĐỐI CHỨNG DƯƠNG — quyền HỘI SỞ: Đào tạo Hội sở chọn được người cơ sở 2", async () => {
      const r = await chay(cauHinhTaoChuongTrinh, "dao_tao_ho", dauVaoChuongTrinh(IDS.nv_cs2));
      expect(r.ok).toBe(true);
    });

    it("[TC-P3] id có khoảng trắng hai đầu được cắt rồi mới tra ⇒ ghi id sạch", async () => {
      const r = await chay(cauHinhTaoChuongTrinh, "dao_tao_ho", dauVaoChuongTrinh(`  ${IDS.nv_cs1}  `));
      expect(r.ok).toBe(true);
      if (r.ok) {
        const ct = await db.trnProgram.findUniqueOrThrow({ where: { id: r.data.programId }, select: { contentOwnerUserId: true } });
        expect(ct.contentOwnerUserId).toBe(IDS.nv_cs1);
      }
    });
  });

  // ═══ C. MỨC GẮN ĐÁNH GIÁ — hrApprovedByUserId (luật hai người) ═══════════════
  describe("datMucGanDanhGia — hrApprovedByUserId", () => {
    const TU_CHOI: [string, () => unknown, string][] = [
      ["[EL-N1] id giả", () => "khong-ton-tai-123", "VALIDATION"],
      ["[EL-N2] chuỗi toàn khoảng trắng (LINKED cần người duyệt)", () => "     ", "VALIDATION"],
      ["[EL-N3] id sai hình dạng", () => "a b'; drop table--", "VALIDATION"],
      ["[EL-N4] TỰ PHÊ DUYỆT: người thao tác nêu chính mình", () => IDS.hr_ho, "SELF_APPROVAL"],
      ["[EL-N5] người Nhân sự đã NGHỈ", () => IDS.hr_da_nghi, "VALIDATION"],
      ["[EL-N6] người Nhân sự bị KHOÁ tài khoản", () => IDS.hr_bi_khoa, "VALIDATION"],
      ["[EL-N7] tài khoản xoá mềm", () => IDS.nv_xoa_mem, "VALIDATION"],
      ["[EL-N8] `User.isActive=false`", () => IDS.nv_khoa_isactive, "VALIDATION"],
      ["[EL-N9] đang làm nhưng KHÔNG thuộc Nhân sự", () => IDS.nv_cs1, "PERMISSION_DENIED"],
      ["[EL-N10] Nhân sự CƠ SỞ cho cấu hình TOÀN CÔNG TY (scope CENTER không khớp)", () => IDS.hr_cs1, "PERMISSION_DENIED"],
      ["[EL-N16] SUPER_ADMIN KHÔNG thay thế người Nhân sự (không giữ vai HR)", () => IDS.sa_thuan, "PERMISSION_DENIED"],
    ];

    for (const [ten, lay, ma] of TU_CHOI) {
      it(`${ten} ⇒ ${ma}, KHÔNG ghi gì`, async () => {
        const truoc = await demCauHinh();
        const r = await chay(cauHinhDatMucGanDanhGia, "hr_ho", dauVaoMuc(progToanCty, lay()), LYDO);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe(ma);
        expect(await demCauHinh()).toBe(truoc);
      });
    }

    it("[EL-N11] id RÁC ở chế độ REPORT_ONLY cũng bị từ chối (không để quả mìn chờ ngày bật LINKED)", async () => {
      const truoc = await demCauHinh();
      const r = await chay(
        cauHinhDatMucGanDanhGia,
        "hr_ho",
        { programId: progToanCty, mode: "REPORT_ONLY", hrApprovedByUserId: "khong-ton-tai-123" },
        LYDO,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("VALIDATION");
      expect(await demCauHinh()).toBe(truoc);
    });

    it("[EL-N12] NGOÀI CƠ SỞ: Đào tạo cơ sở 1 nêu Nhân sự cơ sở 2 ⇒ VALIDATION, KHÔNG ghi", async () => {
      const truoc = await demCauHinh();
      const r = await chay(cauHinhDatMucGanDanhGia, "dao_tao_cs1", dauVaoMuc(progCs1, IDS.hr_cs2), LYDO);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("VALIDATION");
      expect(await demCauHinh()).toBe(truoc);
    });

    it("[EL-N13] THIẾU QUYỀN: Quản lý cơ sở ⇒ PERMISSION_DENIED, KHÔNG ghi", async () => {
      const truoc = await demCauHinh();
      const r = await chay(cauHinhDatMucGanDanhGia, "ql_cs1", dauVaoMuc(progCs1, IDS.hr_cs1), LYDO);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("PERMISSION_DENIED");
      expect(await demCauHinh()).toBe(truoc);
    });

    it("[EL-N14] client khai CƠ SỞ khác cơ sở của chương trình ⇒ VALIDATION, KHÔNG ghi", async () => {
      const cs2 = await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } });
      const truoc = await demCauHinh();
      const r = await chay(cauHinhDatMucGanDanhGia, "hr_ho", dauVaoMuc(progCs1, IDS.hr_ho_2, { centerId: cs2.id }), LYDO);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("VALIDATION");
      expect(await demCauHinh()).toBe(truoc);
    });

    it("[EL-N15] thiếu LÝ DO ⇒ VALIDATION, KHÔNG ghi (giữ nguyên luật 3 của EL-21)", async () => {
      const truoc = await demCauHinh();
      const r = await chay(cauHinhDatMucGanDanhGia, "hr_ho", dauVaoMuc(progToanCty, IDS.hr_ho_2));
      expect(r.ok).toBe(false);
      expect(await demCauHinh()).toBe(truoc);
    });

    it("[EL-P1] ĐỐI CHỨNG DƯƠNG — quyền HỘI SỞ: HO_HR khác duyệt cấu hình toàn công ty ⇒ ok", async () => {
      const r = await chay(cauHinhDatMucGanDanhGia, "hr_ho", dauVaoMuc(progToanCty, IDS.hr_ho_2), LYDO);
      expect(r.ok).toBe(true);
      const cfg = await db.trnEvalLinkConfig.findFirstOrThrow({
        where: { programId: progToanCty },
        select: { hrApprovedByUserId: true, centerId: true, createdById: true },
      });
      expect(cfg.hrApprovedByUserId).toBe(IDS.hr_ho_2);
      expect(cfg.centerId).toBeNull();
      expect(cfg.createdById).toBe(IDS.hr_ho);
    });

    it("[EL-P2] ĐỐI CHỨNG DƯƠNG — Nhân sự cơ sở 1 đồng duyệt cấu hình của chương trình cơ sở 1; `centerId` lấy từ CHƯƠNG TRÌNH", async () => {
      const r = await chay(cauHinhDatMucGanDanhGia, "dao_tao_cs1", dauVaoMuc(progCs1, IDS.hr_cs1), LYDO);
      expect(r.ok).toBe(true);
      const cfg = await db.trnEvalLinkConfig.findFirstOrThrow({
        where: { programId: progCs1 },
        select: { hrApprovedByUserId: true, centerId: true },
      });
      expect(cfg.hrApprovedByUserId).toBe(IDS.hr_cs1);
      const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
      expect(cfg.centerId).toBe(cs1.id);
    });

    it("[EL-P5] ĐỐI CHỨNG DƯƠNG — người vừa SUPER_ADMIN vừa giữ vai HR thật vẫn đồng duyệt được (quyền đến từ vai HR)", async () => {
      const r = await chay(cauHinhDatMucGanDanhGia, "hr_ho", dauVaoMuc(progToanCty, IDS.sa_kiem_hr), LYDO);
      expect(r.ok).toBe(true);
    });

    it("[EL-P3] ĐỐI CHỨNG DƯƠNG — REPORT_ONLY không nêu người duyệt ⇒ ok (không bị cổng người chặn oan)", async () => {
      const r = await chay(
        cauHinhDatMucGanDanhGia,
        "hr_ho",
        { programId: progToanCty, mode: "REPORT_ONLY" },
        LYDO,
      );
      expect(r.ok).toBe(true);
    });

    it("[EL-P4] ĐỐI CHỨNG DƯƠNG — người Nhân sự được nêu tên là CHÍNH người từng tạo cấu hình vẫn hợp lệ nếu không phải người đang lưu", async () => {
      // hr_ho_2 lưu, nêu hr_ho (người tạo trước đó) — hai người độc lập theo từng lần lưu.
      const r = await chay(cauHinhDatMucGanDanhGia, "hr_ho_2", dauVaoMuc(progToanCty, IDS.hr_ho), LYDO);
      expect(r.ok).toBe(true);
    });
  });

  // ═══ D. HÀM CỔNG, GỌI TRỰC TIẾP ═════════════════════════════════════════════
  describe("hàm cổng gọi trực tiếp", () => {
    it("[CT-1] `xacMinhNguoiNhanSuDuyet`: tự duyệt bị chặn TRƯỚC khi chạm DB", async () => {
      const dbCam = new Proxy({}, { get: (_t, p) => { throw new Error(`chạm db.${String(p)} trước cổng tự duyệt`); } }) as never;
      await expect(
        xacMinhNguoiNhanSuDuyet(dbCam, { userId: "u1" }, "u1", { centerId: null }),
      ).rejects.toMatchObject({ code: "SELF_APPROVAL" });
    });

    it("[CT-2] mọi lý do từ chối nói CÙNG MỘT câu (không dò được id có tồn tại / thuộc cơ sở khác)", async () => {
      const sdb = scopedDb(await actorCua("dao_tao_cs1"));
      const cau = new Set<string>();
      for (const id of ["khong-ton-tai-123", IDS.nv_cs2, IDS.nv_nghi, IDS.nv_disabled, IDS.khong_ho_so]) {
        const e = await xacMinhNguoiDuocChon(sdb, id, "f").catch((x: Error) => x);
        expect(e).toBeInstanceOf(Error);
        cau.add((e as Error).message);
      }
      expect(cau.size).toBe(1);
    });
  });
});
