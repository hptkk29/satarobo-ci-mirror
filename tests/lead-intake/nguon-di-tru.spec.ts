import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { docDuLieuDiTru } from "../../lib/nguon/di-tru-db";
import { tomTatDiTru } from "../../lib/nguon/anh-xa-nhan-cu";
import { taoNguonBanDau } from "../../lib/nguon/ghi-nguon";
import type { MaNhomGoc } from "../../lib/nguon/danh-muc-goc";
import { damBaoDanhMucGoc, duLieuNguon } from "./_nguon-fixture";

// =============================================================================
// DI TRÚ NGUỒN CŨ — tầng ĐỌC trên Postgres LOCAL thật (07 §2.6.6, ca [NHH-SRC-19c])
//
// Cách ly (PB-19): tiền tố `NDT_`, dải SĐT riêng 09904xxxxx, mã nhân viên mang đoạn `NDT`, và mọi lời
// gọi `docDuLieuDiTru` truyền PHẠM VI = đúng id fixture — KHÔNG BAO GIỜ "TAT_CA" ở ca test. `RoleDef` tự
// upsert theo `code`: không tin seed vai còn sống (E3).
//
// Mốc thời gian TUYỆT ĐỐI (luật 19): 01/10/2026 00:00 giờ VN = 2026-09-30T17:00Z.
// =============================================================================

const RUN = RUN_DB_TESTS;
const db = new PrismaClient();
const P = "NDT_";
const TRUOC = new Date("2026-09-15T03:00:00.000Z");
const SAU_MOC = new Date("2026-10-02T03:00:00.000Z");

/** 28 nhãn NGUYÊN VĂN + nhóm mong đợi cho phiếu tạo TRƯỚC mọi mốc. */
const BANG_28: readonly [string, MaNhomGoc][] = [
  ["Quản Lý Trung Tâm", "EMPLOYEE_REFERRAL"],
  ["legacy-sheet", "PAID_ADS"],
  ["Nguồn từ Marketing Hội Sở từ Quảng Cáo", "PAID_ADS"],
  ["Nguồn từ Ban lãnh đạo công ty", "EMPLOYEE_REFERRAL"],
  ["quatang", "PAID_ADS"],
  ["Ads", "PAID_ADS"],
  ["sale-form", "PAID_ADS"],
  ["Quản lý trung tâm", "EMPLOYEE_REFERRAL"],
  ["covua.quatang.edu.vn", "PAID_ADS"],
  ["Khác", "EMPLOYEE_REFERRAL"],
  ["Giới thiệu", "PARENT_REFERRAL"],
  ["sale-form-app", "PAID_ADS"],
  ["Form", "PAID_ADS"],
  ["Nguồn khác", "EMPLOYEE_REFERRAL"],
  ["Organic", "CENTER_ORGANIC"], // ĐẢO bảng 06/10 (khi đó là quảng cáo) theo yêu cầu 09/10 của chủ dự án
  ["Website", "WALK_IN"],
  ["Nguồn từ Marketing Hội Sở từ Organic", "CENTER_ORGANIC"],
  ["Sale tự kiếm", "EMPLOYEE_REFERRAL"],
  ["Nguồn từ Sale tự kiếm", "EMPLOYEE_REFERRAL"],
  ["Quản lý Trung Tâm", "EMPLOYEE_REFERRAL"],
  ["Con cổ đông", "EMPLOYEE_REFERRAL"],
  ["Nhập tay", "EMPLOYEE_REFERRAL"],
  ["Tự khai thác", "EMPLOYEE_REFERRAL"],
  ["lead cũ khi làm bên LTN gọi học trải nghiệm 5 buổi", "EMPLOYEE_REFERRAL"],
  ["Nguồn từ phụ huynh giới thiệu", "PARENT_REFERRAL"],
  ["Import Excel ĐK", "EMPLOYEE_REFERRAL"],
  ["lien-he", "WALK_IN"],
  ["Nguồn KH tự đến Trung Tâm", "WALK_IN"],
];

async function don() {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length) {
    await db.leadActivity.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadStatusHistory.deleteMany({ where: { leadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } }); // quy nguồn đi theo (Cascade)
  }
  const nv = await db.employee.findMany({ where: { employeeCode: { startsWith: "NDT." } }, select: { id: true } });
  const nvIds = nv.map((e) => e.id);
  await db.auditLog.deleteMany({ where: { entityType: "Employee", entityId: { in: [...nvIds, "ndt-khong-phai-id"] } } });
  const us = await db.user.findMany({ where: { email: { startsWith: "ndt-" } }, select: { id: true } });
  const usIds = us.map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: usIds } } });
  await db.user.deleteMany({ where: { id: { in: usIds } } });
  await db.employee.deleteMany({ where: { id: { in: nvIds } } });
}

let stt = 0;
const sdt = () => `0990400${String(++stt).padStart(3, "0")}`;

async function taoLead(ten: string, source: string | null, extra: Record<string, unknown> = {}) {
  return db.lead.create({
    data: { parentName: `${P}${ten}`, phone: sdt(), status: "MOI", source, createdAt: TRUOC, ...extra },
  });
}

async function taoNhanVien(ma: string, tenVai: string[], moc: { tu: string; den?: string; trangThai?: "ACTIVE" | "EXPIRED" }[]) {
  const emp = await db.employee.create({
    data: { employeeCode: ma, fullName: `Nhân viên ${ma}`, jobTitle: "Kiểm thử", department: "KINH_DOANH" },
  });
  const user = await db.user.create({ data: { name: ma, email: `ndt-${ma.toLowerCase()}@example.test`, employeeId: emp.id } });
  for (let i = 0; i < tenVai.length; i++) {
    const role = await db.roleDef.upsert({ where: { code: tenVai[i]! }, create: { code: tenVai[i]!, name: tenVai[i]! }, update: {} });
    await db.userOrgRole.create({
      data: {
        userId: user.id,
        orgUnitId: "ndt-don-vi",
        roleId: role.id,
        effectiveFrom: new Date(moc[i]!.tu),
        effectiveTo: moc[i]!.den ? new Date(moc[i]!.den!) : null,
        status: moc[i]!.trangThai ?? "ACTIVE",
        grantedById: "ndt",
      },
    });
  }
  return { emp, user };
}

describe.skipIf(!RUN)("Di trú nguồn — tầng đọc (PB-19)", () => {
  beforeEach(don, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  it("[NHH-SRC-19c] đọc đúng 28 nhãn + nhãn lạ + đã xoá + đã có quy nguồn + trùng SĐT + vai theo ngày + mã NV theo ngày", async () => {
    const nhom = await damBaoDanhMucGoc(db);

    // 28 nhãn nguyên văn.
    const lead28 = new Map<string, string>(); // nhãn → leadId
    for (const [nhan] of BANG_28) lead28.set(nhan, (await taoLead(`n${lead28.size}`, nhan)).id);
    // Nhãn lạ ⇒ INVALID.
    const la = await taoLead("la", "Nguồn từ sự kiện");
    // Đã xoá mềm ⇒ đếm riêng, không vào `hang`.
    const daXoa = await taoLead("daxoa", "Website", { deletedAt: TRUOC });
    // Đã có quy nguồn ⇒ bỏ qua, đếm riêng.
    const coQN = await taoLead("coqn", "Website");
    await db.$transaction((tx) => taoNguonBanDau(tx, coQN.id, duLieuNguon(nhom.WALK_IN), null));
    // Lead CÒN SỐNG, cùng tiền tố, nhưng KHÔNG nằm trong phạm vi truyền vào ⇒ không được lọt vào `hang`
    // (fixture phải LỆCH: không có kẻ ngoài phạm vi thì phép cấy "bỏ phạm vi" vẫn xanh — lượt cấy 07/10).
    const ngoai = await taoLead("ngoai", "Ads");
    // Hai lead trùng SĐT (0… / 84…).
    const so = sdt();
    const t1 = await db.lead.create({ data: { parentName: `${P}tr1`, phone: so, status: "MOI", source: "Website", createdAt: TRUOC } });
    const t2 = await db.lead.create({
      data: { parentName: `${P}tr2`, phone: `84${so.slice(1)}`, status: "MOI", source: "Website", createdAt: TRUOC },
    });

    // (1) phiếu sale-form-app ≥ mốc, createdById → User → Employee → vai CSKH hiệu lực từ TRƯỚC phiếu.
    const cskh = await taoNhanVien("NDT.NV.901", ["CENTER_SALES_CSM"], [{ tu: "2026-09-01T00:00:00.000Z" }]);
    const l1 = await taoLead("app", "sale-form-app", { createdAt: SAU_MOC, createdById: cskh.user.id });

    // (2) phiếu sale-form ≥ mốc chỉ có MÃ trong note: nv.ndt.902 — mã đổi trong lịch sử AuditLog;
    //     nhân viên giữ mã đó LÚC ĐÓ nay là NDT.NV.905 và có User + vai TEACHER (chứng minh câu 7).
    const gv = await taoNhanVien("NDT.NV.905", ["TEACHER"], [{ tu: "2026-09-01T00:00:00.000Z" }]);
    await db.auditLog.create({
      data: {
        actorName: "ndt",
        module: "employees",
        entityType: "Employee",
        entityId: gv.emp.id,
        action: "UPDATE",
        oldValues: { employeeCode: "NDT.NV.902" },
        newValues: { employeeCode: "NDT.NV.905" },
        changedFields: ["employeeCode"],
        createdAt: new Date("2026-10-03T00:00:00.000Z"),
      },
    });
    // Dòng lịch sử có entityId KHÔNG phải Employee.id ⇒ phải bị bỏ và ĐẾM vào lichSuKhongDung.
    await db.auditLog.create({
      data: {
        actorName: "ndt",
        module: "employees",
        entityType: "Employee",
        entityId: "ndt-khong-phai-id",
        action: "UPDATE",
        oldValues: { employeeCode: "NDT.NV.800" },
        newValues: { employeeCode: "NDT.NV.801" },
        changedFields: ["employeeCode"],
      },
    });
    const l2 = await taoLead("ma", "sale-form", {
      createdAt: new Date("2026-10-02T04:00:00.000Z"),
      note: "Khách hỏi lịch\nNhân viên nhập: nv.ndt.902",
    });

    // (3) ca VAI ĐỔI: TEACHER tới 03/10 rồi CSKH từ 03/10; phiếu 02/10 ⇒ EMPLOYEE_REFERRAL.
    const doi = await taoNhanVien(
      "NDT.NV.903",
      ["TEACHER", "CENTER_SALES_CSM"],
      [
        { tu: "2026-09-01T00:00:00.000Z", den: "2026-10-03T00:00:00.000Z", trangThai: "EXPIRED" },
        { tu: "2026-10-03T00:00:00.000Z" },
      ],
    );
    const l3 = await taoLead("doi", "sale-form-app", { createdAt: SAU_MOC, createdById: doi.user.id });

    // (4) ca VAI CẤP LẠI: vai duy nhất có effectiveFrom SAU ngày phiếu ⇒ VAI_SUY_TU_HIEN_TAI.
    const lai = await taoNhanVien("NDT.NV.904", ["CENTER_SALES_CSM"], [{ tu: "2026-10-05T00:00:00.000Z" }]);
    const l4 = await taoLead("lai", "sale-form-app", { createdAt: SAU_MOC, createdById: lai.user.id });

    const ids = [
      ...lead28.values(),
      la.id,
      daXoa.id,
      coQN.id,
      t1.id,
      t2.id,
      l1.id,
      l2.id,
      l3.id,
      l4.id,
    ];
    const truocQN = await db.leadAttribution.count();

    const kq = await db.$transaction(
      (tx) => docDuLieuDiTru(tx, { coBangQuyNguon: true, phamVi: { leadIds: ids } }),
      { timeout: 60_000, maxWait: 15_000 },
    );

    // Phạm vi: chỉ id fixture; đã xoá + đã có quy nguồn KHÔNG vào hang.
    const idHang = new Set(kq.hang.map((h) => h.leadId));
    expect(idHang.has(daXoa.id)).toBe(false);
    expect(idHang.has(coQN.id)).toBe(false);
    expect(idHang.has(ngoai.id)).toBe(false);
    for (const h of kq.hang) expect(ids, h.leadId).toContain(h.leadId);
    expect(kq.daXoa).toBe(1);
    expect(kq.daCoQuyNguon).toBe(1);
    expect(kq.thieuDanhMuc).toEqual([]);
    expect(kq.lichSuKhongDung).toBeGreaterThanOrEqual(1);

    const theoLead = new Map(kq.hang.map((h) => [h.leadId, h.kq]));
    const nhomCua = (id: string) => {
      const k = theoLead.get(id);
      return k && k.loai !== "INVALID" ? k.nhom : k?.loai;
    };

    // 28 nhãn nguyên văn ⇒ đúng nhóm (phiếu trước mọi mốc).
    for (const [nhan, mong] of BANG_28) expect(nhomCua(lead28.get(nhan)!), nhan).toBe(mong);
    // Nhãn lạ.
    expect(nhomCua(la.id)).toBe("INVALID");

    // Trùng SĐT: cả hai nằm trong trungSdt, không lead nào khác.
    expect([...kq.trungSdt].sort()).toEqual([t1.id, t2.id].sort());

    // (1) CSKH hiệu lực ⇒ EMPLOYEE_REFERRAL + người; không xem tay.
    const k1 = theoLead.get(l1.id)!;
    // Bốn nhóm nhân sự đã gộp ⇒ VAI (SALE) là thứ duy nhất còn phân biệt được người nhập CSKH với giáo viên: phải khẳng định nó.
    expect(k1.loai === "INVALID" ? null : [k1.nhom, k1.vaiNguon, k1.nguoi, k1.xemTay]).toEqual([
      "EMPLOYEE_REFERRAL",
      "SALE",
      { kind: "EMPLOYEE", employeeId: cskh.emp.id },
      [],
    ]);
    // (2) mã nv.ndt.902 giải qua LỊCH SỬ ⇒ nhân viên NDT.NV.905 ⇒ vai TEACHER ⇒ EMPLOYEE_REFERRAL (câu 7).
    const k2 = theoLead.get(l2.id)!;
    expect(k2.loai === "INVALID" ? null : [k2.nhom, k2.vaiNguon, k2.nguoi]).toEqual([
      "EMPLOYEE_REFERRAL",
      "TEACHER",
      { kind: "EMPLOYEE", employeeId: gv.emp.id },
    ]);
    // (3) vai ĐỔI: tại 02/10 người đó là TEACHER (nay là CSKH) ⇒ EMPLOYEE_REFERRAL, KHÔNG xem tay.
    const k3 = theoLead.get(l3.id)!;
    // Vai lúc đó là TEACHER (không phải CSKH hôm nay) — đây là chỗ phép "vai theo ngày" còn cắn được sau khi nhóm gộp.
    expect(k3.loai === "INVALID" ? null : [k3.nhom, k3.vaiNguon, k3.xemTay]).toEqual(["EMPLOYEE_REFERRAL", "TEACHER", []]);
    // (4) vai cấp lại ⇒ nhóm theo vai đó + VAI_SUY_TU_HIEN_TAI.
    const k4 = theoLead.get(l4.id)!;
    expect(k4.loai === "INVALID" ? null : [k4.nhom, k4.vaiNguon, k4.xemTay]).toEqual(["EMPLOYEE_REFERRAL", "SALE", ["VAI_SUY_TU_HIEN_TAI"]]);

    // Mã NV nhãn máy ≥ mốc: nv.ndt.902 xuất hiện, giải được.
    const m902 = kq.maNv.find((m) => m.ma === "NDT.NV.902");
    expect(m902).toMatchObject({ soPhieu: 1, employeeId: gv.emp.id, nhom: "EMPLOYEE_REFERRAL", vai: "TEACHER" });

    // Tóm tắt trên ĐÚNG tập fixture: phân hoạch cộng lại bằng tổng.
    const t = tomTatDiTru(kq.hang, kq.trungSdt);
    expect(t.total).toBe(kq.hang.length);
    expect(t.mapped + t.unknown + t.invalid + t.duplicate + t.manualReview).toBe(t.total);
    expect(t.invalid).toBe(1);
    expect(t.duplicate).toBe(2);
    expect(t.seGhi).toBe(t.total - 1);

    // Đọc KHÔNG ghi: số dòng quy nguồn trước = sau.
    expect(await db.leadAttribution.count()).toBe(truocQN);
  }, 120_000);

  it("[NHH-SRC-19c'] chưa có bảng quy nguồn (coBangQuyNguon=false) ⇒ KHÔNG chạm bảng đó, Total = mọi lead còn sống trong phạm vi", async () => {
    const a = await taoLead("a", "Website");
    const b = await taoLead("b", "Ads");
    const kq = await db.$transaction((tx) => docDuLieuDiTru(tx, { coBangQuyNguon: false, phamVi: { leadIds: [a.id, b.id] } }));
    expect(kq.hang.map((h) => h.leadId).sort()).toEqual([a.id, b.id].sort());
    expect(kq.daCoQuyNguon).toBe(0);
    expect(kq.thieuDanhMuc).toEqual([]);
  }, 60_000);
});
