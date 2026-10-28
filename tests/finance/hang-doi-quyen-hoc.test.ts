// tests/finance/hang-doi-quyen-hoc.test.ts — HÀNG ĐỢI QUYỀN HỌC + CRON ĐỐI SOÁT, trên POSTGRES THẬT. `[HD-DB-*]`.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Hoặc:  DATABASE_URL=…/satarobo_test_hd DIRECT_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/hang-doi-quyen-hoc.test.ts
//
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id. Mỗi ca tự dựng đơn của mình (chạy MỘT MÌNH vẫn xanh — luật 18).
// Đồng hồ truyền vào (luật 19): `NOW` tuyệt đối; `updatedAt` của khoản tiền đặt TƯỜNG MINH (khoảng trễ chờ hích tính theo nó).
// Số tiền lẻ nghìn, không tròn triệu. Người dùng giả = `Actor` dựng tay (quyền là DỮ LIỆU của actor, không cần seed vai).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});

// Công tắc cho ca [HD-DB-10]: bỏ qua bước LÀM TƯƠI (chế độ CHI_GHI_NHAN) của `duyetThuHoi` để mô phỏng lượt đọc CŨ — buổi tiêu thụ xuất hiện SAU lần làm tươi.
// Mặc định trong suốt (gọi hàm thật). Chỉ đụng lời gọi CHI_GHI_NHAN, không đụng "CAP".
const chan = vi.hoisted(() => ({ boQuaLamTuoi: false }));
vi.mock("@/lib/entitlements/hich", async (goc) => {
  const m = await goc<typeof import("@/lib/entitlements/hich")>();
  return {
    ...m,
    xetCapQuyenHocCoKetQua: (...a: Parameters<typeof m.xetCapQuyenHocCoKetQua>) =>
      chan.boQuaLamTuoi && a[3] === "CHI_GHI_NHAN" ? Promise.resolve(undefined as never) : m.xetCapQuyenHocCoKetQua(...a),
  };
});

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { clearSettingsCache } from "@/lib/settings/service";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { xetCapQuyenHocChoDon } from "@/lib/entitlements/cap-tu-don";
import { hichCapQuyenHocChoDon } from "@/lib/entitlements/hich";
import { docDaQuyet } from "@/lib/entitlements/da-quyet";
import { chayDoiSoatQuyenHoc, doiSoatLechMotDon } from "@/lib/entitlements/hang-doi/doi-soat";
import { demDangMo, docHangDoi, type BoLocHangDoi } from "@/lib/entitlements/hang-doi/doc-hang-doi";
import { danhDauCanDuyet, dongDongHangDoi, duyetThuHoi, giuQuyenHoc, thuCapLai, type KetQuaHanhDong } from "@/lib/entitlements/hang-doi/hanh-dong";
import { CHE_SO_TIEN } from "@/lib/entitlements/hang-doi/an-tien";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { keHoachDon, type BoiCanhDon, type DongVao } from "@/lib/orders/pham-vi/ke-hoach-don";
import { docPhamViDong, metadataChoDong } from "@/lib/orders/pham-vi/doc-dong";
import { veMetadataConLead } from "@/lib/orders/hoc-vien-dong-don";

if (!RUN_DB_TESTS) console.warn(`[HD-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const T = "fx-hd-";
const KHOA = `${T}khoa`;
const KHOA_B = `${T}khoa-b`;
const LOP = `${T}lop`;
const HV_A = `${T}hv-a`;
const HV_B = `${T}hv-b`;
const NOW = new Date("2026-10-12T03:00:00Z");
/** Khoản tiền xác nhận từ lâu (quá ngưỡng chờ hích 30 phút của chế độ CHI_GHI_NHAN). */
const CU = new Date("2026-10-11T00:00:00Z");
const GIA48 = 10_560_000;
const TIEN = 8_976_000;
const SDT = "0905123456";
const DA_XAC_NHAN = "CONFIRMED" as const;

const BOI_CANH: BoiCanhDon = {
  phamViBat: true,
  nguonGia48: "Course.price",
  chinhSach: CHINH_SACH_PL02,
  hieuLuc: cuaSoHieuLucPL02(),
  cheDoMocNgay: "ORDER_CREATED",
  thuTuMacDinh: "LOWER_VALUE_FIRST",
  taoDon: NOW,
  coKeHoachDot: false,
};
const dongVao: DongVao = {
  loai: "COURSE_ENROLLMENT",
  tenDong: "Sata 3",
  soLuong: 1,
  donGiaKhach: TIEN,
  soKhoanGiam: 0,
  laLopNhom: true,
  tongSoBuoiKhoa: 48,
  soBuoiMua: 48,
  gia48: GIA48,
  conKhoa: "con-a",
};

function metadataScope(courseId: string, leadChildId: string | null): Record<string, unknown> {
  const kq = keHoachDon([dongVao], BOI_CANH);
  const md = metadataChoDong(kq, 0, { courseId, soBuoi: 48 }, courseId);
  if (kq.kieu !== "SCOPE" || !md) throw new Error("fixture: planner không ra SCOPE");
  expect(docPhamViDong(md)?.thanhTien).toBe(TIEN);
  return veMetadataConLead(md, leadChildId) ?? md;
}

let CS1 = "";
let CS2 = "";
let OU1 = "";
let OU2 = "";
let dem = 0;

interface DongFx {
  id: string;
  studentId?: string | null;
  courseId?: string;
  leadChildId?: string | null;
  enrollmentId?: string | null;
}
interface DonFx {
  id: string;
  dong: DongFx[];
  status?: "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED";
  centerId?: string;
}

async function dungDon(o: DonFx) {
  const tong = o.dong.length * TIEN;
  await db.order.create({
    data: {
      id: o.id,
      code: `ORD-2699-HD-${++dem}-${o.id.slice(-6)}`,
      type: "COURSE",
      status: o.status ?? "PENDING_PAYMENT",
      customerName: `${T}khach`,
      customerPhone: SDT,
      totalAmount: tong,
      subtotal: tong,
      centerId: o.centerId ?? CS1,
    },
  });
  for (const d of o.dong) {
    await db.orderItem.create({
      data: {
        id: d.id,
        orderId: o.id,
        type: "COURSE_ENROLLMENT",
        itemName: "Sata 3",
        quantity: 1,
        unitPrice: TIEN,
        totalPrice: TIEN,
        discountAmount: 0,
        studentId: d.studentId === undefined ? HV_A : d.studentId,
        enrollmentId: d.enrollmentId ?? null,
        status: "ACTIVE",
        metadata: metadataScope(d.courseId ?? KHOA, d.leadChildId ?? null) as Prisma.InputJsonValue,
      },
    });
  }
}

/** Khoản tiền trên sổ `Payment`; `updatedAt` đặt tường minh (mặc định: đã xác nhận từ lâu). */
async function thu(orderId: string, orderItemId: string, amount: number, accountantStatus: "PENDING" | "CONFIRMED" | "REJECTED", updatedAt: Date = CU, centerId: string = CS1) {
  return db.payment.create({
    data: { orderId, orderItemId, amount, method: "cash", paidDate: CU, saleStatus: "RECORDED", accountantStatus, centerId, createdAt: CU, updatedAt },
  });
}

async function datCo(orgUnitId: string, bat: boolean | null) {
  if (bat === null) await db.centerSetting.deleteMany({ where: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI } });
  else {
    await db.centerSetting.upsert({
      where: { orgUnitId_key: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI } },
      create: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI, valueJson: bat },
      update: { valueJson: bat },
    });
  }
  clearSettingsCache();
}

async function donDep() {
  // Đọc id bằng SQL thô: `db.order.findMany` lọc đơn xoá mềm, mà fixture có đơn xoá mềm ([HD-DB-35]) — bỏ sót thì lần chạy sau đụng khoá trùng.
  const ids = (await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Order" WHERE "id" LIKE ${`${T}%`}`).map((d) => d.id);
  await db.studyEntitlementXuLy.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { orderId: { startsWith: T } }] } });
  await db.studyEntitlementUsage.deleteMany({ where: { entitlement: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } } });
  await db.studyEntitlement.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } });
  await db.auditLog.deleteMany({
    where: { OR: [{ actorName: { startsWith: "Hệ thống — " } }, { actorId: { startsWith: T } }, { entityType: "Order", entityId: { in: ids } }] },
  });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
  await db.payment.deleteMany({ where: { orderId: { in: ids } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await db.$executeRaw`DELETE FROM "Order" WHERE "id" = ANY(${ids})`;
  await db.enrollment.deleteMany({ where: { id: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: { startsWith: `${T}lop-` } } });
  await db.student.deleteMany({ where: { id: { startsWith: T }, NOT: { id: { in: [HV_A, HV_B] } } } });
  await db.leadChild.deleteMany({ where: { lead: { parentName: { startsWith: T } } } });
  await db.lead.deleteMany({ where: { parentName: { startsWith: T } } });
}

async function dungLead(ten: string, soCon: number): Promise<{ leadId: string; conIds: string[] }> {
  const lead = await db.lead.create({ data: { parentName: `${T}${ten}`, phone: SDT, centerId: CS1 }, select: { id: true } });
  const conIds: string[] = [];
  for (let i = 0; i < soCon; i++) conIds.push((await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}${ten}-con-${i}` }, select: { id: true } })).id);
  return { leadId: lead.id, conIds };
}

// ── Actor dựng tay ─────────────────────────────────────────────────────────────────────────────────────────────────────
function actorLit(o: { id: string; superAdmin?: boolean; perms?: readonly string[]; centerIds?: readonly string[]; orgUnitIds?: readonly string[] }): Actor {
  const centers = [...(o.centerIds ?? [CS1])];
  const ous = [...(o.orgUnitIds ?? [OU1])];
  return {
    userId: o.id,
    isSuperAdmin: o.superAdmin ?? false,
    isHoLevel: false,
    orgRoles: [],
    permissions: (o.perms ?? []).map((action) => ({ action, scopeType: "CENTER" as const, orgUnitId: ous[0] ?? OU1, roleCode: "TEST_ROLE", centerScope: centers, orgUnitScope: ous })),
    visibleCenterIds: centers,
    visibleOrgUnitIds: ous,
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  };
}
const NGUOI = (id: string) => ({ id, name: `Người ${id}` });
const QL = () => actorLit({ id: `${T}ql`, perms: ["entitlements:view", "entitlements:manage", "entitlements:view-money"] });
const XEM = () => actorLit({ id: `${T}xem`, perms: ["entitlements:view"] });
const QL_CS2 = () => actorLit({ id: `${T}ql2`, perms: ["entitlements:view", "entitlements:manage"], centerIds: [CS2], orgUnitIds: [OU2] });
const ADMIN = () => actorLit({ id: `${T}admin`, superAdmin: true });

const vao = (actor: Actor, dongId: string, lyDo = "Lý do xử lý đủ dài để qua cổng") => ({ actor, nguoi: NGUOI(actor.userId), dongId, lyDo, now: NOW });
/** Danh sách hàng đợi, CHỈ phần của fixture này (DB dùng chung với bộ khác: không đếm dòng của người khác). */
const docToi = async (actor: Actor, loc: BoLocHangDoi, trang: number, now: Date) => {
  const r = await docHangDoi(actor, loc, trang, now);
  const dong = r.dong.filter((d) => d.don?.id.startsWith(T));
  return { ...r, dong, tong: dong.length };
};
const xuLyCua = (orderId: string, loai?: string) => db.studyEntitlementXuLy.findMany({ where: { orderId, ...(loai ? { loai: loai as never } : {}) }, orderBy: { createdAt: "asc" } });
const quyenCua = (orderId: string) => db.studyEntitlement.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
const demHang = async () => ({
  quyen: await db.studyEntitlement.count(),
  usage: await db.studyEntitlementUsage.count(),
  xuLy: await db.studyEntitlementXuLy.count(),
  audit: await db.auditLog.count({ where: { module: "entitlements" } }),
});
/** Chạy cron. LUÔN đòi 0 đơn lỗi: cron nuốt lỗi từng đơn vào báo cáo (một đơn hỏng không được chặn cả lượt), nên nếu test không kiểm `soDonLoi` thì một lỗi ghi (vd. P2002 khi mất dedupe) trượt qua xanh. */
const chay = async (gioiHan = 100, now = NOW) => {
  const bao = await chayDoiSoatQuyenHoc({ now, gioiHanDonMoiCoSo: gioiHan });
  expect({ soDonLoi: bao.soDonLoi, loi: bao.loi }, "cron không được có đơn lỗi").toEqual({ soDonLoi: 0, loi: [] });
  return bao;
};

/** Đơn một dòng, đã biết học viên, đủ tiền XÁC NHẬN từ lâu, và quyền học đã được CẤP bằng đúng đường hích. */
async function donDaCap(id: string, itemId: string): Promise<string> {
  await dungDon({ id, dong: [{ id: itemId }] });
  await thu(id, itemId, TIEN, DA_XAC_NHAN);
  const kq = await xetCapQuyenHocChoDon(id, "KE_TOAN_XAC_NHAN", NOW, "CAP");
  expect(kq.daCap, "fixture: phải cấp được quyền học").toHaveLength(1);
  return kq.daCap[0]!.quyenHocId;
}

const phaiOk = (r: KetQuaHanhDong): Extract<KetQuaHanhDong, { ok: true }> => {
  if (!r.ok) throw new Error(`mong ok, nhận lỗi ${r.ma}: ${r.error}`);
  return r;
};
const phaiLoi = (r: KetQuaHanhDong, ma: string): void => {
  expect({ ok: r.ok, ma: r.ok ? null : r.ma }).toEqual({ ok: false, ma });
};

// ── Bổ sung (vòng rà đối kháng 12/10): chèn dòng hàng đợi trực tiếp, chụp bảng, kịch bản theo loại ─────────────────────────────────────────────────────────
const gio = (h: number, goc: Date = NOW): Date => new Date(goc.getTime() - h * 3_600_000);

/** Chèn THẲNG một dòng hàng đợi (con trỏ mềm — không cần đơn thật) với `updatedAt`/`createdAt` tường minh; `donDep` xoá theo tiền tố `orderId`. */
async function chenXuLy(o: {
  id: string;
  orderId: string;
  orderItemId: string;
  loai: "CHO_XEP_LOP" | "CHO_CHUYEN_DOI" | "CAN_THU_HOI" | "TREO_DUYET_TAY" | "THIEU_QUYEN_HOC" | "LECH_DU_LIEU";
  trangThai?: "OPEN" | "DA_XU_LY" | "HUY";
  centerId?: string;
  courseId?: string | null;
  updatedAt?: Date;
  createdAt?: Date;
}) {
  const centerId = o.centerId ?? CS1;
  return db.studyEntitlementXuLy.create({
    data: {
      id: o.id,
      loai: o.loai,
      trangThai: o.trangThai ?? "OPEN",
      orderId: o.orderId,
      orderItemId: o.orderItemId,
      courseId: o.courseId ?? null,
      centerId,
      orgUnitId: centerId === CS2 ? OU2 : OU1,
      lyDo: `Dòng chèn tay ${o.id}`,
      createdAt: o.createdAt ?? NOW,
      updatedAt: o.updatedAt ?? NOW,
    },
  });
}

/** Ảnh chụp JSON của MỌI bảng mà hàng đợi / cron không được phép đổi (tiền, dòng đơn, ghi danh, học viên, sổ cái buổi). */
async function chupBangBatBien(orderIds: readonly string[]): Promise<Record<string, string>> {
  const ids = [...orderIds];
  const j = (x: unknown): string => JSON.stringify(x);
  return {
    order: j(await db.order.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })),
    orderItem: j(await db.orderItem.findMany({ where: { orderId: { in: ids } }, orderBy: { id: "asc" } })),
    payment: j(await db.payment.findMany({ where: { orderId: { in: ids } }, orderBy: { id: "asc" } })),
    paymentRequest: j(await db.paymentRequest.findMany({ where: { orderId: { in: ids } }, orderBy: { id: "asc" } })),
    paymentAllocation: j(await db.paymentAllocation.findMany({ where: { paymentRequest: { orderId: { in: ids } } }, orderBy: { id: "asc" } })),
    enrollment: j(await db.enrollment.findMany({ where: { id: { startsWith: T } }, orderBy: { id: "asc" } })),
    student: j(await db.student.findMany({ where: { OR: [{ id: { startsWith: T } }, { id: { in: [HV_A, HV_B] } }] }, orderBy: { id: "asc" } })),
    usage: j(await db.studyEntitlementUsage.findMany({ where: { entitlement: { orderId: { in: ids } } }, orderBy: { id: "asc" } })),
  };
}

type KichBan = "THIEU" | "CHO_CHUYEN_DOI" | "CAN_THU_HOI" | "TREO" | "LECH" | "DA_DONG";
const CAC_KICH_BAN: readonly KichBan[] = ["THIEU", "CHO_CHUYEN_DOI", "CAN_THU_HOI", "TREO", "LECH", "DA_DONG"];

/** Dựng MỘT dòng hàng đợi thuộc kịch bản `kb` bằng đúng đường thật (fixture → cron / hích), trả id dòng. Mỗi lần gọi phải sau `donDep()`. */
async function dungKichBan(kb: KichBan, n: string): Promise<string> {
  const DON = `${T}don-kb-${n}`;
  const IT = `${T}it-kb-${n}`;
  const tim = async (loai: string) => (await xuLyCua(DON, loai))[0]!.id;
  switch (kb) {
    case "THIEU":
    case "DA_DONG": {
      await dungDon({ id: DON, dong: [{ id: IT }] });
      await thu(DON, IT, TIEN, DA_XAC_NHAN);
      await chay();
      const id = await tim("THIEU_QUYEN_HOC");
      if (kb === "DA_DONG") phaiOk(await dongDongHangDoi(vao(QL(), id, "Đóng sẵn để dựng kịch bản đã đóng")));
      return id;
    }
    case "CHO_CHUYEN_DOI": {
      const { conIds } = await dungLead(`kb${n}`, 1);
      await dungDon({ id: DON, dong: [{ id: IT, studentId: null, leadChildId: conIds[0]! }] });
      await thu(DON, IT, TIEN, DA_XAC_NHAN);
      await chay();
      return tim("CHO_CHUYEN_DOI");
    }
    case "CAN_THU_HOI":
    case "TREO": {
      const quyenId = await donDaCap(DON, IT);
      if (kb === "TREO") await db.studyEntitlementUsage.create({ data: { entitlementId: quyenId, studentId: HV_A, lessonOrder: 1, source: "MANUAL" } });
      await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } });
      await chay();
      return tim(kb === "TREO" ? "TREO_DUYET_TAY" : "CAN_THU_HOI");
    }
    case "LECH": {
      await db.enrollment.create({ data: { id: `${T}gd-kb-${n}`, studentId: HV_A, classId: LOP, courseId: KHOA, centerId: CS1, status: "STUDYING" } });
      await dungDon({ id: DON, dong: [{ id: IT, enrollmentId: `${T}gd-kb-${n}` }] });
      await chay();
      return tim("LECH_DU_LIEU");
    }
  }
}

/** Khoản tiền xác nhận KHÔNG gắn dòng đơn nào (`orderItemId = null`) — hình dạng làm tiền của đơn nhiều dòng "mơ hồ". */
const thuKhongGanDong = (orderId: string, amount: number) =>
  db.payment.create({
    data: { orderId, orderItemId: null, amount, method: "cash", paidDate: CU, saleStatus: "RECORDED", accountantStatus: DA_XAC_NHAN, centerId: CS1, createdAt: CU, updatedAt: CU },
  });

const maLech = (payload: unknown): string[] => ((payload as { chiTiet?: { ma: string }[] } | null)?.chiTiet ?? []).map((c) => c.ma).sort();

describe.skipIf(!RUN_DB_TESTS)("[HD-DB] hàng đợi quyền học + cron đối soát — Postgres THẬT", () => {
  beforeAll(async () => {
    assertTestDb();
    await donDep();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    CS2 = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    OU1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    OU2 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    for (const [id, ten] of [[KHOA, "Sata 3 (fixture)"], [KHOA_B, "Sata 4 (fixture)"]] as const) {
      await db.course.upsert({ where: { id }, create: { id, name: ten, slug: id, price: GIA48, totalSessions: 48 }, update: { price: GIA48, totalSessions: 48 } });
    }
    await db.class.upsert({ where: { id: LOP }, create: { id: LOP, name: "Lớp (fixture)", courseId: KHOA, centerId: CS1, status: "ACTIVE", maxStudents: 12 }, update: {} });
    for (const [id, ten] of [[HV_A, "Bé A"], [HV_B, "Bé B"]] as const) {
      await db.student.upsert({ where: { id }, create: { id, name: `${T}${ten}`, centerId: CS1, status: "ACTIVE" }, update: {} });
    }
  });
  beforeEach(async () => {
    await donDep();
    await datCo(OU1, true);
    await datCo(OU2, null);
  });
  afterAll(async () => {
    await donDep();
    await datCo(OU1, null);
    await datCo(OU2, null);
    await db.student.deleteMany({ where: { id: { in: [HV_A, HV_B] } } });
    await db.class.deleteMany({ where: { id: LOP } });
    await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA_B] } } });
  });

  // ═══ 1 · CRON TẠO DÒNG, IDEMPOTENT ═════════════════════════════════════════════════════════════════════════════════════

  it("[HD-DB-01] tiền XÁC NHẬN đủ + đã biết học viên + chưa có quyền học lẫn dòng chờ (hích bị lỡ) ⇒ cron tạo ĐÚNG MỘT THIEU_QUYEN_HOC; chạy lại KHÔNG tạo trùng, KHÔNG đổi `updatedAt`; không quyền học nào ra đời", async () => {
    const DON = `${T}don-01`;
    await dungDon({ id: DON, dong: [{ id: `${T}it-01` }] });
    await thu(DON, `${T}it-01`, TIEN, DA_XAC_NHAN);
    const truoc = await demHang();

    const lan1 = await chay();
    expect(lan1.moiTheoLoai.THIEU_QUYEN_HOC).toBe(1);
    const dong1 = await xuLyCua(DON);
    expect(dong1.map((d) => [d.loai, d.trangThai, d.orderItemId, d.studentId, d.centerId])).toEqual([["THIEU_QUYEN_HOC", "OPEN", `${T}it-01`, HV_A, CS1]]);
    expect(dong1[0]!.orgUnitId, "dòng MỚI mang orgUnitId tường minh").toBe(OU1);

    const lan2 = await chay();
    expect(lan2.moiTheoLoai.THIEU_QUYEN_HOC, "chạy lại không tạo gì").toBe(0);
    expect(lan2.giuNguyenTheoLoai.THIEU_QUYEN_HOC, "báo 'đã có'").toBe(1);
    const dong2 = await xuLyCua(DON);
    expect(dong2).toHaveLength(1);
    expect(dong2[0]!.updatedAt.getTime(), "updatedAt đứng yên").toBe(dong1[0]!.updatedAt.getTime());

    const sau = await demHang();
    expect({ quyen: sau.quyen, usage: sau.usage, audit: sau.audit }, "cron KHÔNG cấp quyền, KHÔNG đụng sổ cái, KHÔNG ghi audit").toEqual({ quyen: truoc.quyen, usage: truoc.usage, audit: truoc.audit });
    expect(await quyenCua(DON)).toHaveLength(0);
  });

  it("[HD-DB-02] khoản tiền vừa xác nhận (trong ngưỡng chờ hích) ⇒ CHƯA kết luận lượt hích bị lỡ; qua ngưỡng ⇒ mới ghi", async () => {
    const DON = `${T}don-02`;
    await dungDon({ id: DON, dong: [{ id: `${T}it-02` }] });
    await thu(DON, `${T}it-02`, TIEN, DA_XAC_NHAN, new Date(NOW.getTime() - 10 * 60_000));
    await chay();
    expect(await xuLyCua(DON), "10 phút trước: dispatcher còn đang chạy").toHaveLength(0);
    await chay(100, new Date(NOW.getTime() + 60 * 60_000));
    expect((await xuLyCua(DON)).map((d) => d.loai), "một giờ sau: lỡ thật").toEqual(["THIEU_QUYEN_HOC"]);
  });

  it("[HD-DB-03] đủ tiền nhưng CHƯA có học viên ⇒ cron tạo CHO_CHUYEN_DOI (cùng dòng mà đường hích tạo); chạy lại không trùng", async () => {
    const DON = `${T}don-03`;
    const { conIds } = await dungLead("l03", 1);
    await dungDon({ id: DON, dong: [{ id: `${T}it-03`, studentId: null, leadChildId: conIds[0]! }] });
    await thu(DON, `${T}it-03`, TIEN, DA_XAC_NHAN);
    await chay();
    await chay();
    expect((await xuLyCua(DON)).map((d) => [d.loai, d.trangThai])).toEqual([["CHO_CHUYEN_DOI", "OPEN"]]);
    expect(await quyenCua(DON)).toHaveLength(0);
  });

  // ═══ 2 · THỬ CẤP LẠI ═══════════════════════════════════════════════════════════════════════════════════════════════════

  it("[HD-DB-04] \"Thử cấp lại\" đủ học viên ⇒ cấp ĐÚNG MỘT quyền học, đóng dòng DA_XU_LY, ghi audit RETRY ĐÚNG MỘT dòng; bấm lại ⇒ không đổi gì, không audit thêm", async () => {
    const DON = `${T}don-04`;
    await dungDon({ id: DON, dong: [{ id: `${T}it-04` }] });
    await thu(DON, `${T}it-04`, TIEN, DA_XAC_NHAN);
    await chay();
    const [dong] = await xuLyCua(DON);
    expect(dong!.loai).toBe("THIEU_QUYEN_HOC");

    const r1 = phaiOk(await thuCapLai({ actor: QL(), nguoi: NGUOI(`${T}ql`), dongId: dong!.id, now: NOW }));
    expect(r1.daLam).toBe(true);
    const q = await quyenCua(DON);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ studentId: HV_A, orderItemId: `${T}it-04`, status: "AWAITING_PLACEMENT", netAmount: TIEN });
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: q[0]!.id } })).toBe(0);
    const sau = await db.studyEntitlementXuLy.findUniqueOrThrow({ where: { id: dong!.id } });
    expect(sau.trangThai).toBe("DA_XU_LY");
    const audit = await db.auditLog.findMany({ where: { entityType: "StudyEntitlementXuLy", entityId: dong!.id, action: "RETRY" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: `${T}ql`, module: "entitlements" });

    const r2 = phaiOk(await thuCapLai({ actor: QL(), nguoi: NGUOI(`${T}ql`), dongId: dong!.id, now: NOW }));
    expect(r2.daLam, "đã đóng ⇒ không có gì thay đổi").toBe(false);
    expect(await db.auditLog.count({ where: { entityType: "StudyEntitlementXuLy", entityId: dong!.id, action: "RETRY" } })).toBe(1);
    expect(await quyenCua(DON)).toHaveLength(1);
  });

  it("[HD-DB-05] \"Thử cấp lại\" khi con khớp NHIỀU hồ sơ ⇒ KHÔNG cấp, KHÔNG đoán học viên; dòng VẪN MỞ và lý do được cập nhật; bấm lại ⇒ không audit thêm", async () => {
    const DON = `${T}don-05`;
    const { conIds } = await dungLead("l05", 1);
    await dungDon({ id: DON, dong: [{ id: `${T}it-05`, studentId: null, leadChildId: conIds[0]! }] });
    await thu(DON, `${T}it-05`, TIEN, DA_XAC_NHAN);
    await chay();
    const [dong] = await xuLyCua(DON);
    expect(dong).toMatchObject({ loai: "CHO_CHUYEN_DOI", trangThai: "OPEN" });
    const lyDoCu = dong!.lyDo;

    // Hai hồ sơ học viên cùng một bé ⇒ mơ hồ.
    for (const ten of ["x1", "x2"]) await db.student.create({ data: { id: `${T}hv-${ten}`, name: `${T}${ten}`, centerId: CS1, status: "ACTIVE", leadChildId: conIds[0]! } });
    const r = phaiOk(await thuCapLai({ actor: QL(), nguoi: NGUOI(`${T}ql`), dongId: dong!.id, now: NOW }));
    expect(r.daLam).toBe(true);
    const sau = await db.studyEntitlementXuLy.findUniqueOrThrow({ where: { id: dong!.id } });
    expect(sau.trangThai).toBe("OPEN");
    expect(sau.lyDo).not.toBe(lyDoCu);
    expect(sau.lyDo).toMatch(/khớp 2 hồ sơ/);
    expect(await quyenCua(DON), "không đoán học viên").toHaveLength(0);
    expect(await db.auditLog.count({ where: { entityId: dong!.id, action: "RETRY" } })).toBe(1);

    const r2 = phaiOk(await thuCapLai({ actor: QL(), nguoi: NGUOI(`${T}ql`), dongId: dong!.id, now: NOW }));
    expect(r2.daLam, "không đổi gì").toBe(false);
    expect(await db.auditLog.count({ where: { entityId: dong!.id, action: "RETRY" } })).toBe(1);
  });

  // ═══ 3 · CHIỀU NGƯỢC: CHƯA TIÊU THỤ ⇒ THU HỒI AN TOÀN · ĐÃ TIÊU THỤ ⇒ DUYỆT TAY ═══════════════════════════════════════════

  it("[HD-DB-06] khoản tiền bị TỪ CHỐI sau khi đã cấp, quyền học CHƯA tiêu thụ ⇒ cron tạo CAN_THU_HOI; quyền học và sổ cái KHÔNG đổi một chữ", async () => {
    const DON = `${T}don-06`;
    const quyenId = await donDaCap(DON, `${T}it-06`);
    const q0 = await db.studyEntitlement.findUniqueOrThrow({ where: { id: quyenId } });
    await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } }); // mô phỏng lượt hích chiều ngược bị lỡ
    const truoc = await demHang();

    const bao = await chay();
    expect(bao.moiTheoLoai.CAN_THU_HOI).toBe(1);
    expect(bao.moiTheoLoai.TREO_DUYET_TAY).toBe(0);
    expect((await xuLyCua(DON)).map((d) => [d.loai, d.trangThai, d.entitlementId])).toEqual([["CAN_THU_HOI", "OPEN", quyenId]]);

    const q1 = await db.studyEntitlement.findUniqueOrThrow({ where: { id: quyenId } });
    expect(q1, "KHÔNG tự thu hồi").toEqual(q0);
    const sau = await demHang();
    expect({ quyen: sau.quyen, usage: sau.usage, audit: sau.audit }).toEqual({ quyen: truoc.quyen, usage: truoc.usage, audit: truoc.audit });

    await chay();
    expect(await xuLyCua(DON, "CAN_THU_HOI"), "chạy lại không trùng").toHaveLength(1);
  });

  it("[HD-DB-07] cùng tình huống nhưng quyền học ĐÃ có buổi tiêu thụ ⇒ cron tạo TREO_DUYET_TAY (không phải CAN_THU_HOI); KHÔNG tự thu hồi, KHÔNG đổi sổ cái", async () => {
    const DON = `${T}don-07`;
    const quyenId = await donDaCap(DON, `${T}it-07`);
    await db.studyEntitlementUsage.create({ data: { entitlementId: quyenId, studentId: HV_A, lessonOrder: 1, source: "MANUAL" } });
    await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } });
    const q0 = await db.studyEntitlement.findUniqueOrThrow({ where: { id: quyenId } });
    const usage0 = await db.studyEntitlementUsage.findMany({ where: { entitlementId: quyenId } });

    const bao = await chay();
    expect(bao.moiTheoLoai.TREO_DUYET_TAY).toBe(1);
    expect(bao.moiTheoLoai.CAN_THU_HOI).toBe(0);
    expect((await xuLyCua(DON)).map((d) => [d.loai, d.trangThai])).toEqual([["TREO_DUYET_TAY", "OPEN"]]);
    expect(await db.studyEntitlement.findUniqueOrThrow({ where: { id: quyenId } })).toEqual(q0);
    expect(await db.studyEntitlementUsage.findMany({ where: { entitlementId: quyenId } })).toEqual(usage0);
  });

  it("[HD-DB-08] đơn bị HUỶ sau khi đã cấp ⇒ cron tạo CAN_THU_HOI (chưa tiêu thụ); quyền học nguyên vẹn", async () => {
    const DON = `${T}don-08`;
    const quyenId = await donDaCap(DON, `${T}it-08`);
    await db.order.update({ where: { id: DON }, data: { status: "CANCELLED" } });
    const q0 = await db.studyEntitlement.findUniqueOrThrow({ where: { id: quyenId } });
    await chay();
    expect((await xuLyCua(DON)).map((d) => [d.loai, d.trangThai])).toEqual([["CAN_THU_HOI", "OPEN"]]);
    expect(await db.studyEntitlement.findUniqueOrThrow({ where: { id: quyenId } })).toEqual(q0);
  });

  it("[HD-DB-09] DUYỆT THU HỒI quyền CHƯA tiêu thụ ⇒ quyền học VOIDED (qua đường có sẵn), dòng DA_XU_LY, audit đủ trường; bấm lại ⇒ không đổi, không audit thêm", async () => {
    const DON = `${T}don-09`;
    const quyenId = await donDaCap(DON, `${T}it-09`);
    await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } });
    await chay();
    const [dong] = await xuLyCua(DON);
    expect(dong!.loai).toBe("CAN_THU_HOI");
    const usage0 = await db.studyEntitlementUsage.count();

    const r = phaiOk(await duyetThuHoi(vao(QL(), dong!.id, "Phụ huynh huỷ, đã hoàn tiền ngoài hệ thống")));
    expect(r.daLam).toBe(true);
    expect((await db.studyEntitlement.findUniqueOrThrow({ where: { id: quyenId } })).status).toBe("VOIDED");
    const sau = await db.studyEntitlementXuLy.findUniqueOrThrow({ where: { id: dong!.id } });
    expect(sau).toMatchObject({ trangThai: "DA_XU_LY", entitlementId: quyenId });
    expect(sau.resolvedAt?.getTime(), "thời điểm đóng = đồng hồ TRUYỀN VÀO (luật 19)").toBe(NOW.getTime());
    expect(docDaQuyet(sau.payload)).toMatchObject({ hanhDong: "THU_HOI", boi: { id: `${T}ql` } });
    expect(await db.studyEntitlementUsage.count(), "KHÔNG tạo / xoá dòng sổ cái").toBe(usage0);

    const audit = await db.auditLog.findMany({ where: { entityType: "StudyEntitlementXuLy", entityId: dong!.id, action: "REVOKE_ENTITLEMENT" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: `${T}ql`, actorName: `Người ${T}ql`, module: "entitlements", reason: "Phụ huynh huỷ, đã hoàn tiền ngoài hệ thống", orgUnitId: OU1 });
    expect(audit[0]!.createdAt).toBeInstanceOf(Date);
    expect(audit[0]!.oldValues).toMatchObject({ loai: "CAN_THU_HOI", trangThai: "OPEN", quyenHoc: { id: quyenId } });
    expect(audit[0]!.newValues).toMatchObject({ trangThai: "DA_XU_LY", quyenHoc: { id: quyenId, trangThai: "VOIDED" } });
    const soAuditQuyen = await db.auditLog.count({ where: { entityType: "StudyEntitlement", entityId: quyenId } });

    const r2 = phaiOk(await duyetThuHoi(vao(QL(), dong!.id)));
    expect(r2.daLam).toBe(false);
    expect(await db.auditLog.count({ where: { entityId: dong!.id, action: "REVOKE_ENTITLEMENT" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityType: "StudyEntitlement", entityId: quyenId } })).toBe(soAuditQuyen);
  });

  it("[HD-DB-10] quyền học vừa có buổi tiêu thụ SAU khi dòng CAN_THU_HOI được tạo ⇒ DUYỆT THU HỒI bị từ chối (kiểm dưới khoá), quyền học nguyên vẹn, dòng vẫn mở; dòng TREO_DUYET_TAY không có đường thu hồi", async () => {
    const DON = `${T}don-10`;
    const quyenId = await donDaCap(DON, `${T}it-10`);
    await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } });
    await chay();
    const [dong] = await xuLyCua(DON);
    expect(dong!.loai).toBe("CAN_THU_HOI");
    await db.studyEntitlementUsage.create({ data: { entitlementId: quyenId, studentId: HV_A, lessonOrder: 1, source: "MANUAL" } });
    const q0 = await db.studyEntitlement.findUniqueOrThrow({ where: { id: quyenId } });
    const audit0 = await db.auditLog.count({ where: { module: "entitlements" } });

    // (a) Lượt đọc CŨ (bước làm tươi bị bỏ qua — buổi tiêu thụ xuất hiện sau nó): CHỈ phép kiểm dưới khoá còn lại để chặn.
    chan.boQuaLamTuoi = true;
    try {
      phaiLoi(await duyetThuHoi(vao(QL(), dong!.id)), "KHONG_CHO_PHEP");
    } finally {
      chan.boQuaLamTuoi = false;
    }
    expect(await db.studyEntitlement.findUniqueOrThrow({ where: { id: quyenId } })).toEqual(q0);
    expect((await db.studyEntitlementXuLy.findUniqueOrThrow({ where: { id: dong!.id } })).trangThai).toBe("OPEN");
    expect(await db.auditLog.count({ where: { module: "entitlements" } }), "từ chối ⇒ không ghi gì").toBe(audit0);

    // (b) Đường bình thường: bước làm tươi thấy buổi đã tiêu thụ ⇒ CHUYỂN dòng sang TREO_DUYET_TAY (dòng cũ đóng HUY); duyệt thu hồi ở dòng cũ chỉ là "đã đóng".
    const r = await duyetThuHoi(vao(QL(), dong!.id));
    expect(r.ok && r.daLam, "không thu hồi gì").toBe(false);
    expect(await db.studyEntitlement.findUniqueOrThrow({ where: { id: quyenId } })).toEqual(q0);
    const treo = (await xuLyCua(DON, "TREO_DUYET_TAY"))[0]!;
    expect(treo.trangThai).toBe("OPEN");
    phaiLoi(await duyetThuHoi(vao(QL(), treo.id)), "KHONG_CHO_PHEP");
    expect(await db.studyEntitlement.findUniqueOrThrow({ where: { id: quyenId } })).toEqual(q0);
  });

  it("[HD-DB-11] GIỮ QUYỀN một dòng treo ⇒ DA_XU_LY kèm quyết định của người; cron và lượt hích kế tiếp KHÔNG mở lại cùng điều kiện; điều kiện ĐỔI ⇒ mở lại CHÍNH dòng đó (không dòng thứ hai) và gỡ quyết định cũ", async () => {
    const DON = `${T}don-11`;
    const quyenId = await donDaCap(DON, `${T}it-11`);
    await db.studyEntitlementUsage.create({ data: { entitlementId: quyenId, studentId: HV_A, lessonOrder: 1, source: "MANUAL" } });
    await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } });
    await chay();
    const [dong] = await xuLyCua(DON);
    expect(dong!.loai).toBe("TREO_DUYET_TAY");

    phaiOk(await giuQuyenHoc(vao(QL(), dong!.id, "Phụ huynh hẹn nộp bù cuối tuần")));
    const giu = await db.auditLog.findMany({ where: { entityType: "StudyEntitlementXuLy", entityId: dong!.id, action: "KEEP_ENTITLEMENT" } });
    expect(giu).toHaveLength(1);
    expect(giu[0]).toMatchObject({ actorId: `${T}ql`, reason: "Phụ huynh hẹn nộp bù cuối tuần" });
    expect(await db.auditLog.count({ where: { entityType: "StudyEntitlement", entityId: quyenId } }), "giữ quyền KHÔNG đụng quyền học (không audit của quyền học)").toBe(await db.auditLog.count({ where: { entityType: "StudyEntitlement", entityId: quyenId, action: "CREATE" } }));
    expect(phaiOk(await giuQuyenHoc(vao(QL(), dong!.id))).daLam).toBe(false);
    expect(await db.auditLog.count({ where: { entityId: dong!.id, action: "KEEP_ENTITLEMENT" } })).toBe(1);
    const dong1 = await db.studyEntitlementXuLy.findUniqueOrThrow({ where: { id: dong!.id } });
    expect(dong1.trangThai).toBe("DA_XU_LY");
    expect(docDaQuyet(dong1.payload)).toMatchObject({ hanhDong: "GIU_QUYEN", dauVan: dong1.lyDo });

    await chay();
    await hichCapQuyenHocChoDon(DON, "TIEN_BI_TU_CHOI", NOW);
    const dong2 = await db.studyEntitlementXuLy.findUniqueOrThrow({ where: { id: dong!.id } });
    expect(dong2.trangThai, "cùng điều kiện ⇒ KHÔNG mở lại").toBe("DA_XU_LY");
    expect(dong2.updatedAt.getTime()).toBe(dong1.updatedAt.getTime());

    // Điều kiện ĐỔI (số tiền thiếu đổi) ⇒ mở lại chính dòng đó.
    await thu(DON, `${T}it-11`, 1_000, DA_XAC_NHAN);
    await chay();
    const het = await xuLyCua(DON, "TREO_DUYET_TAY");
    expect(het).toHaveLength(1);
    expect(het[0]!.id).toBe(dong!.id);
    expect(het[0]!.trangThai).toBe("OPEN");
    expect(docDaQuyet(het[0]!.payload), "quyết định cũ không còn áp").toBeNull();
  });

  // ═══ 4 · LỆCH DỮ LIỆU ══════════════════════════════════════════════════════════════════════════════════════════════════

  it("[HD-DB-12] dòng SCOPE đã gắn ghi danh mà không có quyền học lẫn dòng chờ ⇒ cron tạo LECH_DU_LIEU (GHI_DANH_KHONG_QUYEN); chạy lại không trùng; người ĐÓNG ⇒ không mở lại", async () => {
    const DON = `${T}don-12`;
    await db.enrollment.create({ data: { id: `${T}gd-12`, studentId: HV_A, classId: LOP, courseId: KHOA, centerId: CS1, status: "STUDYING" } });
    await dungDon({ id: DON, dong: [{ id: `${T}it-12`, enrollmentId: `${T}gd-12` }] });
    await chay();
    await chay();
    const ds = await xuLyCua(DON);
    expect(ds.map((d) => [d.loai, d.trangThai])).toEqual([["LECH_DU_LIEU", "OPEN"]]);
    expect((ds[0]!.payload as { chiTiet: { ma: string }[] }).chiTiet.map((c) => c.ma)).toEqual(["GHI_DANH_KHONG_QUYEN"]);
    const t1 = ds[0]!.updatedAt.getTime();
    await chay();
    expect((await xuLyCua(DON))[0]!.updatedAt.getTime(), "chạy lại không ghi").toBe(t1);

    phaiOk(await dongDongHangDoi(vao(QL(), ds[0]!.id, "Ghi danh làm tay, đã kiểm với giáo vụ")));
    const dongAudit = await db.auditLog.findMany({ where: { entityType: "StudyEntitlementXuLy", entityId: ds[0]!.id, action: "CLOSE" } });
    expect(dongAudit).toHaveLength(1);
    expect((await db.studyEntitlementXuLy.findUniqueOrThrow({ where: { id: ds[0]!.id } })).resolvedAt?.getTime(), "thời điểm đóng = đồng hồ truyền vào").toBe(NOW.getTime());
    expect(dongAudit[0]).toMatchObject({ actorId: `${T}ql`, module: "entitlements", reason: "Ghi danh làm tay, đã kiểm với giáo vụ", orgUnitId: OU1 });
    expect(dongAudit[0]!.oldValues).toMatchObject({ loai: "LECH_DU_LIEU", trangThai: "OPEN" });
    expect(dongAudit[0]!.newValues).toMatchObject({ trangThai: "DA_XU_LY", hanhDong: "DONG" });
    expect(phaiOk(await dongDongHangDoi(vao(QL(), ds[0]!.id))).daLam, "đóng lần hai: không có gì thay đổi").toBe(false);
    expect(await db.auditLog.count({ where: { entityId: ds[0]!.id, action: "CLOSE" } }), "bấm lại không trùng audit").toBe(1);
    await chay();
    const sau = await xuLyCua(DON);
    expect(sau).toHaveLength(1);
    expect(sau[0]!.trangThai, "người đã đóng ⇒ cron không mở lại").toBe("DA_XU_LY");
  });

  it("[HD-DB-13] HAI bé · HAI khoá · HAI dòng trên một đơn: chỉ dòng có quyền học LẪN khoá bị đánh dấu LECH_DU_LIEU; dòng khớp không sinh gì; các dòng không lẫn sang nhau", async () => {
    const DON = `${T}don-13`;
    const IT_A = `${T}it-13a`;
    const IT_B = `${T}it-13b`;
    await dungDon({ id: DON, dong: [{ id: IT_A, studentId: HV_A, courseId: KHOA }, { id: IT_B, studentId: HV_B, courseId: KHOA_B }] });
    await thu(DON, IT_A, TIEN, DA_XAC_NHAN);
    await thu(DON, IT_B, TIEN, DA_XAC_NHAN);
    const kq = await xetCapQuyenHocChoDon(DON, "KE_TOAN_XAC_NHAN", NOW, "CAP");
    expect(kq.daCap).toHaveLength(2);
    // Lẫn khoá: quyền học của dòng B bị ghi sang khoá A.
    await db.studyEntitlement.updateMany({ where: { orderItemId: IT_B }, data: { courseId: KHOA } });

    await chay();
    const ds = await xuLyCua(DON);
    expect(ds.map((d) => [d.loai, d.orderItemId, d.courseId])).toEqual([["LECH_DU_LIEU", IT_B, KHOA_B]]);
    expect((ds[0]!.payload as { chiTiet: { ma: string }[] }).chiTiet.map((c) => c.ma)).toEqual(["QUYEN_LECH_KHOA"]);
    expect(await xuLyCua(DON, "THIEU_QUYEN_HOC")).toHaveLength(0);

    // Sửa dữ liệu lại ⇒ lượt sau tự ĐÓNG dòng lệch (HUY), không để dòng cũ treo.
    await db.studyEntitlement.updateMany({ where: { orderItemId: IT_B }, data: { courseId: KHOA_B } });
    await chay();
    expect((await xuLyCua(DON))[0]).toMatchObject({ trangThai: "HUY" });
  });

  // ═══ 5 · PHÂN QUYỀN + CÁCH LY CƠ SỞ ════════════════════════════════════════════════════════════════════════════════════

  it("[HD-DB-14] KHÔNG có `entitlements:manage` ⇒ MỌI hành động bị từ chối KHONG_QUYEN và DB đứng yên; đối chứng dương: có quyền / SUPER_ADMIN làm được", async () => {
    const DON = `${T}don-14`;
    await dungDon({ id: DON, dong: [{ id: `${T}it-14` }] });
    await thu(DON, `${T}it-14`, TIEN, DA_XAC_NHAN);
    await chay();
    const [dong] = await xuLyCua(DON);
    const truoc = await demHang();
    const xem = XEM();
    for (const hanhDong of [thuCapLai, dongDongHangDoi, giuQuyenHoc, duyetThuHoi, danhDauCanDuyet] as const) {
      phaiLoi(await hanhDong(vao(xem, dong!.id)), "KHONG_QUYEN");
    }
    expect(await demHang()).toEqual(truoc);
    expect(await quyenCua(DON)).toHaveLength(0);

    // Đối chứng dương.
    phaiOk(await dongDongHangDoi(vao(QL(), dong!.id)));
    expect((await db.studyEntitlementXuLy.findUniqueOrThrow({ where: { id: dong!.id } })).trangThai).toBe("DA_XU_LY");
    // SUPER_ADMIN (nhánh riêng, không cần grant).
    const DON2 = `${T}don-14b`;
    await dungDon({ id: DON2, dong: [{ id: `${T}it-14b` }] });
    await thu(DON2, `${T}it-14b`, TIEN, DA_XAC_NHAN);
    await chay();
    const [dong2] = await xuLyCua(DON2);
    expect(phaiOk(await thuCapLai(vao(ADMIN(), dong2!.id))).daLam).toBe(true);
    expect(await quyenCua(DON2)).toHaveLength(1);
  });

  it("[HD-DB-15] chỉ có `entitlements:view` ⇒ XEM được dòng nhưng `hanhDong` rỗng (nút không hiện); có `manage` ⇒ có nút. Cả hai cùng cờ BẬT.", async () => {
    const DON = `${T}don-15`;
    await dungDon({ id: DON, dong: [{ id: `${T}it-15` }] });
    await thu(DON, `${T}it-15`, TIEN, DA_XAC_NHAN);
    await chay();
    const xem = await docToi(XEM(), { trangThai: ["OPEN"] }, 1, NOW);
    expect(xem.dong.map((d) => d.loai)).toEqual(["THIEU_QUYEN_HOC"]);
    expect(xem.dong[0]!.hanhDong).toEqual([]);
    expect(xem.dong[0]!.coQuyenManage).toBe(false);
    const ql = await docToi(QL(), { trangThai: ["OPEN"] }, 1, NOW);
    expect(ql.dong[0]!.hanhDong).toEqual(["THU_LAI", "DONG", "DANH_DAU_CAN_DUYET"]);
  });

  it("[HD-DB-16] người cấp cơ sở KHÔNG thấy và KHÔNG xử lý được dòng của cơ sở khác (cả đọc lẫn ghi)", async () => {
    const DON = `${T}don-16`;
    await dungDon({ id: DON, dong: [{ id: `${T}it-16` }] });
    await thu(DON, `${T}it-16`, TIEN, DA_XAC_NHAN);
    await chay();
    const [dong] = await xuLyCua(DON);
    const truoc = await demHang();

    const ngoai = await docToi(QL_CS2(), { trangThai: ["OPEN", "DA_XU_LY", "HUY"] }, 1, NOW);
    expect(ngoai.tong).toBe(0);
    expect(ngoai.dong).toEqual([]);
    for (const hanhDong of [thuCapLai, dongDongHangDoi, giuQuyenHoc, duyetThuHoi, danhDauCanDuyet] as const) {
      phaiLoi(await hanhDong(vao(QL_CS2(), dong!.id)), "KHONG_TIM_THAY");
    }
    expect(await demHang()).toEqual(truoc);
    // Đối chứng dương: cùng người đó VỚI cơ sở của mình thì thấy.
    expect((await docToi(QL(), { trangThai: ["OPEN"] }, 1, NOW)).tong).toBe(1);
  });

  // ═══ 6 · CỜ TẮT ════════════════════════════════════════════════════════════════════════════════════════════════════════

  it("[HD-DB-17] cờ TẮT ⇒ cron KHÔNG ghi gì (đếm hàng + `updatedAt` trước/sau), báo cơ sở bị bỏ; hành động ghi bị CHẶN; đọc hàng đợi vẫn xem được lịch sử, nút ẩn", async () => {
    const DON = `${T}don-17`;
    const quyenId = await donDaCap(DON, `${T}it-17`);
    await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } });
    await chay();
    const [dong] = await xuLyCua(DON);
    expect(dong!.loai).toBe("CAN_THU_HOI");

    // Thêm một đơn "lỡ hích" để cron CÓ việc nếu cờ bật.
    const DON2 = `${T}don-17b`;
    await dungDon({ id: DON2, dong: [{ id: `${T}it-17b` }] });
    await thu(DON2, `${T}it-17b`, TIEN, DA_XAC_NHAN);

    // Và một đơn ĐỦ ĐIỀU KIỆN SINH LECH_DU_LIEU (ghi danh gắn dòng SCOPE, không quyền học) — phần đối soát lệch cũng phải đứng yên khi cờ TẮT.
    const DON3 = `${T}don-17c`;
    await db.enrollment.create({ data: { id: `${T}gd-17c`, studentId: HV_A, classId: LOP, courseId: KHOA, centerId: CS1, status: "STUDYING" } });
    await dungDon({ id: DON3, dong: [{ id: `${T}it-17c`, enrollmentId: `${T}gd-17c` }] });

    await datCo(OU1, false);
    const truoc = await demHang();
    const mocCapNhat = (await db.studyEntitlementXuLy.aggregate({ _max: { updatedAt: true } }))._max.updatedAt;
    const bao = await chay();
    expect(bao.soCoSoQuet).toBe(0);
    expect(bao.soDonQuet).toBe(0);
    expect(bao.coSo.find((c) => c.centerId === CS1)?.boQua).toBe("CO_TAT");
    expect(await demHang()).toEqual(truoc);
    expect((await db.studyEntitlementXuLy.aggregate({ _max: { updatedAt: true } }))._max.updatedAt).toEqual(mocCapNhat);
    expect(await xuLyCua(DON2)).toHaveLength(0);
    expect(await xuLyCua(DON3), "cờ TẮT ⇒ đối soát lệch cũng không ghi").toHaveLength(0);

    for (const hanhDong of [thuCapLai, dongDongHangDoi, giuQuyenHoc, duyetThuHoi, danhDauCanDuyet] as const) {
      phaiLoi(await hanhDong(vao(QL(), dong!.id)), "KHONG_CHO_PHEP");
    }
    expect(await demHang()).toEqual(truoc);
    expect((await db.studyEntitlement.findUniqueOrThrow({ where: { id: quyenId } })).status).toBe("AWAITING_PLACEMENT");

    const doc = await docToi(QL(), { trangThai: ["OPEN"] }, 1, NOW);
    expect(doc.dong.map((d) => d.id)).toEqual([dong!.id]);
    expect(doc.dong[0]!.coBat).toBe(false);
    expect(doc.dong[0]!.hanhDong).toEqual([]);
  });

  // ═══ 7 · AUDIT, TIỀN, TRẦN, CẦN DUYỆT TAY ══════════════════════════════════════════════════════════════════════════════

  it("[HD-DB-18] AuditLog đủ trường (ai · lúc nào · trước · sau · lý do · đơn vị) cho ĐÓNG và CẦN DUYỆT TAY; bấm lại ⇒ không audit thêm", async () => {
    const DON = `${T}don-18`;
    await dungDon({ id: DON, dong: [{ id: `${T}it-18` }] });
    await thu(DON, `${T}it-18`, TIEN, DA_XAC_NHAN);
    await chay();
    const [dong] = await xuLyCua(DON);

    phaiOk(await danhDauCanDuyet(vao(QL(), dong!.id, "Cần Giám đốc xem trước khi cấp")));
    const a = await db.auditLog.findMany({ where: { entityType: "StudyEntitlementXuLy", entityId: dong!.id } });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ action: "MARK_MANUAL_REVIEW", actorId: `${T}ql`, actorName: `Người ${T}ql`, module: "entitlements", reason: "Cần Giám đốc xem trước khi cấp", orgUnitId: OU1 });
    expect(a[0]!.oldValues).toMatchObject({ loai: "THIEU_QUYEN_HOC", trangThai: "OPEN" });
    expect(a[0]!.newValues).toMatchObject({ trangThai: "DA_XU_LY", chuyenSang: "TREO_DUYET_TAY" });
    expect(a[0]!.createdAt).toBeInstanceOf(Date);

    // Dòng TREO_DUYET_TAY mới ra đời, OPEN; dòng nguồn đã đóng với quyết định của người.
    expect((await xuLyCua(DON)).map((d) => [d.loai, d.trangThai]).sort()).toEqual([["THIEU_QUYEN_HOC", "DA_XU_LY"], ["TREO_DUYET_TAY", "OPEN"]]);
    const truoc = await demHang();
    expect(phaiOk(await danhDauCanDuyet(vao(QL(), dong!.id))).daLam).toBe(false);
    expect(await demHang()).toEqual(truoc);
    // Cron không mở lại dòng nguồn (người đã quyết), cũng không nhân đôi TREO.
    await chay();
    expect((await xuLyCua(DON)).map((d) => [d.loai, d.trangThai]).sort()).toEqual([["THIEU_QUYEN_HOC", "DA_XU_LY"], ["TREO_DUYET_TAY", "OPEN"]]);
  });

  it("[HD-DB-19] \"Cần duyệt tay\" KHÔNG áp cho dòng ĐÃ có quyền học (cap-tu-don tự quản TREO theo tiền + buổi) ⇒ bị từ chối, DB đứng yên", async () => {
    const DON = `${T}don-19`;
    await donDaCap(DON, `${T}it-19`);
    await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } });
    await chay();
    const [dong] = await xuLyCua(DON);
    expect(dong!.loai).toBe("CAN_THU_HOI");
    const truoc = await demHang();
    phaiLoi(await danhDauCanDuyet(vao(QL(), dong!.id)), "KHONG_CHO_PHEP");
    expect(await demHang()).toEqual(truoc);
  });

  it("[HD-DB-20] `entitlements:view-money`: thiếu quyền ⇒ số tiền bị che CẢ ở cột lẫn trong câu lý do; có quyền ⇒ thấy đủ", async () => {
    const DON = `${T}don-20`;
    await donDaCap(DON, `${T}it-20`);
    await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } });
    await chay();
    const khongTien = actorLit({ id: `${T}kt`, perms: ["entitlements:view", "entitlements:manage"] });
    const a = (await docToi(khongTien, { trangThai: ["OPEN"] }, 1, NOW)).dong[0]!;
    expect(a.coXemTien).toBe(false);
    expect(a.quyenHoc?.soTien).toBeNull();
    expect(a.lyDo).toContain(CHE_SO_TIEN);
    expect(a.lyDo).not.toMatch(/\d{4,}/);
    const b = (await docToi(QL(), { trangThai: ["OPEN"] }, 1, NOW)).dong[0]!;
    expect(b.coXemTien).toBe(true);
    expect(b.quyenHoc?.soTien).toBe(TIEN);
    expect(b.lyDo).toMatch(new RegExp(`${TIEN}đ`));
  });

  it("[HD-DB-21] trần đơn mỗi cơ sở: vượt trần ⇒ chỉ quét đúng trần, báo `catGon`; bộ lọc cơ sở / trạng thái / loại của danh sách chạy đúng", async () => {
    for (const k of ["a", "b"]) {
      await dungDon({ id: `${T}don-21${k}`, dong: [{ id: `${T}it-21${k}` }] });
      await thu(`${T}don-21${k}`, `${T}it-21${k}`, TIEN, DA_XAC_NHAN);
    }
    const bao = await chay(1);
    expect(bao.soDonQuet).toBe(1);
    expect(bao.catGon).toBe(true);
    expect(bao.coSo.find((c) => c.centerId === CS1)).toMatchObject({ soDonQuet: 1, catGon: true });
    await chay(5);
    const tatCa = await docToi(QL(), { trangThai: ["OPEN"], loai: ["THIEU_QUYEN_HOC"], centerId: CS1 }, 1, NOW);
    expect(tatCa.tong).toBe(2);
    expect((await docToi(QL(), { trangThai: ["OPEN"], loai: ["CAN_THU_HOI"] }, 1, NOW)).tong).toBe(0);
    expect((await docToi(QL(), { trangThai: ["DA_XU_LY"] }, 1, NOW)).tong).toBe(0);
    expect((await docToi(QL(), { trangThai: ["OPEN"], centerId: CS2 }, 1, NOW)).tong).toBe(0);
    expect((await docToi(QL(), { trangThai: ["OPEN"], courseId: KHOA_B }, 1, NOW)).tong).toBe(0);
    expect((await docToi(QL(), { trangThai: ["OPEN"], courseId: KHOA }, 1, NOW)).tong).toBe(2);
    expect((await docToi(QL(), { trangThai: ["OPEN"], q: "không-có-ai-tên-này" }, 1, NOW)).tong).toBe(0);
    expect((await docToi(QL(), { trangThai: ["OPEN"], q: "bé a" }, 1, NOW)).tong).toBe(2);
  });

  it("[HD-DB-23] dòng THIEU_QUYEN_HOC đang mở mà học viên của dòng bỗng KHÔNG còn xác định được ⇒ lượt sau ĐÓNG THIEU (HUY) và mở CHO_CHUYEN_DOI — không để hai dòng cùng nói về một nguyên nhân", async () => {
    const DON = `${T}don-23`;
    await dungDon({ id: DON, dong: [{ id: `${T}it-23` }] });
    await thu(DON, `${T}it-23`, TIEN, DA_XAC_NHAN);
    await chay();
    expect((await xuLyCua(DON)).map((d) => [d.loai, d.trangThai])).toEqual([["THIEU_QUYEN_HOC", "OPEN"]]);
    await db.orderItem.update({ where: { id: `${T}it-23` }, data: { studentId: null } });
    await chay();
    expect((await xuLyCua(DON)).map((d) => [d.loai, d.trangThai]).sort()).toEqual([["CHO_CHUYEN_DOI", "OPEN"], ["THIEU_QUYEN_HOC", "HUY"]]);
  });

  it("[HD-DB-22] KHÔNG có `StudyEntitlementUsage` nào bị tạo / xoá bởi cron hay bất kỳ hành động nào của hàng đợi (so tập id sổ cái trước/sau cả một chuỗi thao tác)", async () => {
    const DON = `${T}don-22`;
    const quyenId = await donDaCap(DON, `${T}it-22`);
    await db.studyEntitlementUsage.create({ data: { entitlementId: quyenId, studentId: HV_A, lessonOrder: 1, source: "MANUAL" } });
    await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } });
    const DON2 = `${T}don-22b`;
    await dungDon({ id: DON2, dong: [{ id: `${T}it-22b` }] });
    await thu(DON2, `${T}it-22b`, TIEN, DA_XAC_NHAN);
    const ids = async () => (await db.studyEntitlementUsage.findMany({ select: { id: true, voidedAt: true }, orderBy: { id: "asc" } }));
    const truoc = await ids();

    await chay();
    for (const dong of await db.studyEntitlementXuLy.findMany({ where: { orderId: { in: [DON, DON2] } } })) {
      await thuCapLai(vao(QL(), dong.id));
      await giuQuyenHoc(vao(QL(), dong.id));
      await duyetThuHoi(vao(QL(), dong.id));
      await danhDauCanDuyet(vao(QL(), dong.id));
      await dongDongHangDoi(vao(QL(), dong.id));
    }
    await chay();
    expect(await ids()).toEqual(truoc);
  });

  // ═══ 8 · VÒNG RÀ ĐỐI KHÁNG 12/10 — lỗ do lượt cấy lỗi độc lập tìm ra ═════════════════════════════════════════════════════════════════════════════════════

  it("[HD-DB-24] CỜ THEO CƠ SỞ CỦA ĐƠN: CS1 BẬT, CS2 TẮT ⇒ đơn CS2 (đủ điều kiện sinh THIEU lẫn LECH) KHÔNG sinh dòng nào — cả qua cron lẫn gọi thẳng `doiSoatLechMotDon`; đối chứng dương: CS1 sinh, và bật CS2 thì gọi thẳng cũng sinh", async () => {
    const X1 = `${T}don-24x1`; // LECH-eligible CS1 (ghi danh, không tiền)
    const Y1 = `${T}don-24y1`; // THIEU-eligible CS1 (tiền, không ghi danh)
    const X2 = `${T}don-24x2`;
    const Y2 = `${T}don-24y2`;
    for (const [gd, cs, hv] of [[`${T}gd-24a`, CS1, HV_A], [`${T}gd-24b`, CS2, HV_B]] as const) {
      await db.enrollment.create({ data: { id: gd, studentId: hv, classId: LOP, courseId: KHOA, centerId: cs, status: "STUDYING" } });
    }
    await dungDon({ id: X1, dong: [{ id: `${T}it-24x1`, enrollmentId: `${T}gd-24a` }] });
    await dungDon({ id: Y1, dong: [{ id: `${T}it-24y1` }] });
    await dungDon({ id: X2, centerId: CS2, dong: [{ id: `${T}it-24x2`, enrollmentId: `${T}gd-24b` }] });
    await dungDon({ id: Y2, centerId: CS2, dong: [{ id: `${T}it-24y2` }] });
    await thu(Y1, `${T}it-24y1`, TIEN, DA_XAC_NHAN);
    await thu(Y2, `${T}it-24y2`, TIEN, DA_XAC_NHAN, CU, CS2);

    const bao = await chay();
    expect((await xuLyCua(X1)).map((d) => d.loai)).toEqual(["LECH_DU_LIEU"]);
    expect((await xuLyCua(Y1)).map((d) => d.loai)).toEqual(["THIEU_QUYEN_HOC"]);
    expect(await xuLyCua(X2), "CS2 TẮT cờ ⇒ không LECH").toEqual([]);
    expect(await xuLyCua(Y2), "CS2 TẮT cờ ⇒ không THIEU").toEqual([]);
    expect(bao.coSo.find((c) => c.centerId === CS2)?.boQua).toBe("CO_TAT");

    // Gọi THẲNG hàm đối soát lệch cho đơn CS2 (cờ CS2 tắt): hàm tự kiểm cờ, không tin chỗ gọi.
    const truoc = await demHang();
    const r = await doiSoatLechMotDon(X2, NOW, new Set());
    expect(r).toMatchObject({ moi: 0, daDong: 0 });
    expect(await demHang()).toEqual(truoc);
    expect(await xuLyCua(X2)).toEqual([]);
    // Đối chứng dương: bật CS2 ⇒ cùng lời gọi sinh dòng.
    await datCo(OU2, true);
    expect((await doiSoatLechMotDon(X2, NOW, new Set())).moi).toBe(1);
    expect((await xuLyCua(X2)).map((d) => d.loai)).toEqual(["LECH_DU_LIEU"]);
  });

  it("[HD-DB-25] BẤT BIẾN: cron và MỌI hành động của hàng đợi không đổi một chữ ở Order · OrderItem · Payment · PaymentRequest · PaymentAllocation · Enrollment · Student · StudyEntitlementUsage (so JSON trước/sau)", async () => {
    const D1 = `${T}don-25a`; // THIEU
    const D2 = `${T}don-25b`; // CAN_THU_HOI
    const D3 = `${T}don-25c`; // TREO
    const D4 = `${T}don-25d`; // LECH
    const D5 = `${T}don-25e`; // CHO_CHUYEN_DOI
    await dungDon({ id: D1, dong: [{ id: `${T}it-25a` }] });
    await thu(D1, `${T}it-25a`, TIEN, DA_XAC_NHAN);
    const q2 = await donDaCap(D2, `${T}it-25b`);
    const q3 = await donDaCap(D3, `${T}it-25c`);
    await db.studyEntitlementUsage.create({ data: { entitlementId: q3, studentId: HV_A, lessonOrder: 1, source: "MANUAL" } });
    await db.payment.updateMany({ where: { orderId: { in: [D2, D3] } }, data: { accountantStatus: "REJECTED" } });
    await db.enrollment.create({ data: { id: `${T}gd-25d`, studentId: HV_A, classId: LOP, courseId: KHOA, centerId: CS1, status: "STUDYING" } });
    await dungDon({ id: D4, dong: [{ id: `${T}it-25d`, enrollmentId: `${T}gd-25d` }] });
    const { conIds } = await dungLead("l25", 1);
    await dungDon({ id: D5, dong: [{ id: `${T}it-25e`, studentId: null, leadChildId: conIds[0]! }] });
    await thu(D5, `${T}it-25e`, TIEN, DA_XAC_NHAN);
    expect(q2).not.toBe(q3);

    const DONS = [D1, D2, D3, D4, D5];
    const truoc = await chupBangBatBien(DONS);
    await chay();
    await chay();
    for (const d of await db.studyEntitlementXuLy.findMany({ where: { orderId: { in: DONS }, trangThai: "OPEN" }, orderBy: { id: "asc" } })) {
      await thuCapLai(vao(QL(), d.id));
      await danhDauCanDuyet(vao(QL(), d.id));
      await giuQuyenHoc(vao(QL(), d.id));
      await duyetThuHoi(vao(QL(), d.id));
      await dongDongHangDoi(vao(QL(), d.id));
    }
    await chay();
    const sau = await chupBangBatBien(DONS);
    expect(sau).toEqual(truoc);
    // Chứng minh chuỗi thao tác đã THỰC SỰ làm việc (không phải tất cả đều bị từ chối): có quyền học bị thu hồi / dòng đã đóng.
    expect((await db.studyEntitlementXuLy.count({ where: { orderId: { in: DONS }, trangThai: { not: "OPEN" } } })), "fixture: phải có dòng đã được xử lý").toBeGreaterThan(0);
  });

  it("[HD-DB-26] CHE TIỀN ở MỌI chỗ chữ: chiTiet.moTa của dòng LECH, daQuyet.lyDo / dauVan và ghi chú đóng của dòng đã GIỮ QUYỀN — thiếu `view-money` ⇒ không còn số tiền; có quyền ⇒ nguyên văn", async () => {
    const D1 = `${T}don-26a`;
    const q1 = await donDaCap(D1, `${T}it-26a`);
    await db.studyEntitlement.update({ where: { id: q1 }, data: { netAmount: 5_000_000, listAmount: 5_000_000 + 1_584_000 } }); // lệch số tiền ⇒ LECH QUYEN_LECH_SO_TIEN
    const D2 = `${T}don-26b`;
    const q2 = await donDaCap(D2, `${T}it-26b`);
    await db.studyEntitlementUsage.create({ data: { entitlementId: q2, studentId: HV_A, lessonOrder: 1, source: "MANUAL" } });
    await db.payment.updateMany({ where: { orderId: D2 }, data: { accountantStatus: "REJECTED" } });
    await chay();
    const treo = (await xuLyCua(D2, "TREO_DUYET_TAY"))[0]!;
    phaiOk(await giuQuyenHoc(vao(QL(), treo.id, "Phụ huynh hẹn nộp bù 3.500.000đ vào cuối tuần")));

    const khongTien = actorLit({ id: `${T}kt`, perms: ["entitlements:view", "entitlements:manage"] });
    const lech = (await docToi(khongTien, { trangThai: ["OPEN"], loai: ["LECH_DU_LIEU"] }, 1, NOW)).dong[0]!;
    expect(lech.chiTiet.map((c) => c.ma)).toEqual(["QUYEN_LECH_SO_TIEN"]);
    expect(lech.chiTiet[0]!.moTa).toContain(CHE_SO_TIEN);
    expect(lech.chiTiet[0]!.moTa).not.toMatch(/\d{4,}/);
    expect(lech.lyDo).not.toMatch(/\d{4,}/);

    const dong = (await docToi(khongTien, { trangThai: ["DA_XU_LY"] }, 1, NOW)).dong.find((d) => d.id === treo.id)!;
    for (const [ten, v] of [["daQuyet.lyDo", dong.daQuyet!.lyDo], ["daQuyet.dauVan", dong.daQuyet!.dauVan], ["ghiChuDong", dong.ghiChuDong!], ["lyDo", dong.lyDo]] as const) {
      expect(v, ten).toContain(CHE_SO_TIEN);
      expect(v, ten).not.toMatch(/\d[\d.,]{3,}\s?đ/);
    }
    // Đối chứng dương.
    const co = (await docToi(QL(), { trangThai: ["OPEN"], loai: ["LECH_DU_LIEU"] }, 1, NOW)).dong[0]!;
    expect(co.chiTiet[0]!.moTa).toMatch(/5000000đ/);
    const coDong = (await docToi(QL(), { trangThai: ["DA_XU_LY"] }, 1, NOW)).dong.find((d) => d.id === treo.id)!;
    expect(coDong.daQuyet!.lyDo).toContain("3.500.000đ");
    expect(coDong.daQuyet!.dauVan).toMatch(/8976000đ/);
    expect(coDong.ghiChuDong).toContain("3.500.000đ");
  });

  it("[HD-DB-27] NÚT NÓI THẬT khi đọc: CAN_THU_HOI chưa tiêu thụ có DUYỆT THU HỒI + GIỮ QUYỀN; có buổi tiêu thụ ⇒ MẤT DUYỆT THU HỒI; đã đóng ⇒ rỗng", async () => {
    const DON = `${T}don-27`;
    const quyenId = await donDaCap(DON, `${T}it-27`);
    await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } });
    await chay();
    const hanhDong = async () => (await docToi(QL(), { trangThai: ["OPEN", "DA_XU_LY"], loai: ["CAN_THU_HOI"] }, 1, NOW)).dong[0]!.hanhDong;
    expect(await hanhDong()).toEqual(["THU_LAI", "DONG", "GIU_QUYEN", "DUYET_THU_HOI"]);
    await db.studyEntitlementUsage.create({ data: { entitlementId: quyenId, studentId: HV_A, lessonOrder: 1, source: "MANUAL" } });
    expect(await hanhDong(), "đã có buổi tiêu thụ").toEqual(["THU_LAI", "DONG", "GIU_QUYEN"]);
    const [dong] = await xuLyCua(DON, "CAN_THU_HOI");
    phaiOk(await giuQuyenHoc(vao(QL(), dong!.id)));
    expect(await hanhDong(), "đã đóng").toEqual([]);
  });

  it("[HD-DB-28] NÚT ≡ ACTION trên MỌI (kịch bản × hành động): hanhDong có hd ⇒ action KHÔNG trả KHONG_CHO_PHEP; không có hd ⇒ dòng mở: KHONG_CHO_PHEP, dòng đã đóng: no-op", async () => {
    const TEN: Record<string, (v: ReturnType<typeof vao>) => Promise<KetQuaHanhDong>> = {
      THU_LAI: (v) => thuCapLai({ actor: v.actor, nguoi: v.nguoi, dongId: v.dongId, now: v.now }),
      DONG: dongDongHangDoi,
      GIU_QUYEN: giuQuyenHoc,
      DUYET_THU_HOI: duyetThuHoi,
      DANH_DAU_CAN_DUYET: danhDauCanDuyet,
    };
    const loiSai: string[] = [];
    let n = 0;
    for (const kb of CAC_KICH_BAN) {
      for (const hd of Object.keys(TEN)) {
        await donDep();
        const id = await dungKichBan(kb, `${++n}`);
        const dong = (await docToi(QL(), { trangThai: ["OPEN", "DA_XU_LY", "HUY"] }, 1, NOW)).dong.find((d) => d.id === id)!;
        const coNut = dong.hanhDong.includes(hd as never);
        const r = await TEN[hd]!(vao(QL(), id));
        const khongChoPhep = !r.ok && r.ma === "KHONG_CHO_PHEP";
        const khongLamGi = r.ok && !r.daLam;
        if (coNut && khongChoPhep) loiSai.push(`${kb}/${hd}: có NÚT mà action từ chối (lời hứa suông)`);
        if (!coNut && dong.trangThai === "OPEN" && !khongChoPhep) loiSai.push(`${kb}/${hd}: KHÔNG có nút mà action vẫn cho (cổng mở toang) → ${JSON.stringify(r)}`);
        if (!coNut && dong.trangThai !== "OPEN" && !khongLamGi) loiSai.push(`${kb}/${hd}: dòng đã đóng mà action còn làm gì đó → ${JSON.stringify(r)}`);
      }
    }
    expect(loiSai).toEqual([]);
  });

  it("[HD-DB-29] ĐƠN NHIỀU DÒNG, hai bé: dòng A (chưa có hồ sơ) và B (khớp 2 hồ sơ) cùng loại CHO_CHUYEN_DOI nhưng khác lý do — đóng A không đụng B, sửa A không đóng nhầm B, lý do B không suy từ A", async () => {
    const DON = `${T}don-29`;
    const { conIds } = await dungLead("l29", 2);
    const A = `${T}it-29a`;
    const B = `${T}it-29b`;
    await dungDon({ id: DON, dong: [{ id: A, studentId: null, leadChildId: conIds[0]! }, { id: B, studentId: null, leadChildId: conIds[1]! }] });
    await thu(DON, A, TIEN, DA_XAC_NHAN);
    await thu(DON, B, TIEN, DA_XAC_NHAN);
    for (const ten of ["29a", "29b"]) await db.student.create({ data: { id: `${T}hv-${ten}`, name: `${T}${ten}`, centerId: CS1, status: "ACTIVE", leadChildId: conIds[1]! } });

    await chay();
    await chay();
    const hang = async (item: string) => (await xuLyCua(DON, "CHO_CHUYEN_DOI")).find((d) => d.orderItemId === item)!;
    const a0 = await hang(A);
    const b0 = await hang(B);
    expect(a0.lyDo).not.toBe(b0.lyDo);
    expect(b0.lyDo).toMatch(/khớp 2 hồ sơ/);
    expect(a0.lyDo).not.toMatch(/khớp 2/);
    expect((await xuLyCua(DON, "CHO_CHUYEN_DOI")).length).toBe(2);

    phaiOk(await dongDongHangDoi(vao(QL(), a0.id, "Phụ huynh báo bé A nghỉ học hẳn")));
    const a1 = await hang(A);
    await chay();
    const [a2, b2] = [await hang(A), await hang(B)];
    expect(a2.trangThai, "A đã đóng bởi người").toBe("DA_XU_LY");
    expect(a2.updatedAt.getTime()).toBe(a1.updatedAt.getTime());
    expect({ trangThai: b2.trangThai, lyDo: b2.lyDo, t: b2.updatedAt.getTime() }, "B không bị đụng").toEqual({ trangThai: "OPEN", lyDo: b0.lyDo, t: b0.updatedAt.getTime() });
    expect(docDaQuyet(b2.payload)).toBeNull();

    // Điều kiện của A ĐỔI (xuất hiện đúng một hồ sơ) + hích: A được cấp; B vẫn mở, không quyền học nào cho B.
    await db.student.create({ data: { id: `${T}hv-29c`, name: `${T}29c`, centerId: CS1, status: "ACTIVE", leadChildId: conIds[0]! } });
    await hichCapQuyenHocChoDon(DON, "CHUYEN_DOI", NOW);
    expect((await quyenCua(DON)).map((q) => [q.orderItemId, q.studentId])).toEqual([[A, `${T}hv-29c`]]);
    expect((await hang(B)).trangThai).toBe("OPEN");
    expect((await hang(B)).lyDo).toBe(b0.lyDo);

    // Người đóng B: dấu vân của B là lý do CỦA B, khác dấu vân của A.
    phaiOk(await dongDongHangDoi(vao(QL(), b0.id, "Chờ phụ huynh chọn hồ sơ đúng")));
    const [aa, bb] = [await hang(A), await hang(B)];
    expect(docDaQuyet(aa.payload)!.dauVan).toBe(a0.lyDo);
    expect(docDaQuyet(bb.payload)!.dauVan).toBe(b0.lyDo);
    expect(docDaQuyet(aa.payload)!.dauVan).not.toBe(docDaQuyet(bb.payload)!.dauVan);
  });

  it("[HD-DB-30] CHO_XEP_LOP do người ĐÓNG ⇒ hích lại cùng điều kiện KHÔNG mở lại; điều kiện ĐỔI ⇒ mở lại CHÍNH dòng đó và gỡ quyết định cũ", async () => {
    const DON = `${T}don-30`;
    const IT = `${T}it-30`;
    await donDaCap(DON, IT);
    await db.enrollment.create({ data: { id: `${T}gd-30`, studentId: HV_A, classId: LOP, courseId: KHOA, centerId: CS1, status: "STUDYING" } });
    await db.orderItem.update({ where: { id: IT }, data: { enrollmentId: `${T}gd-30` } });
    await hichCapQuyenHocChoDon(DON, "CHUYEN_DOI", NOW);
    const [xep] = await xuLyCua(DON, "CHO_XEP_LOP");
    expect(xep, "fixture: hích phải ghi dòng CHO_XEP_LOP (lớp không có buổi)").toMatchObject({ trangThai: "OPEN" });

    phaiOk(await dongDongHangDoi(vao(QL(), xep!.id, "Đào tạo sẽ ghim giáo trình tuần sau")));
    const dong1 = await db.studyEntitlementXuLy.findUniqueOrThrow({ where: { id: xep!.id } });
    await hichCapQuyenHocChoDon(DON, "CHUYEN_DOI", NOW);
    await hichCapQuyenHocChoDon(DON, "KE_TOAN_XAC_NHAN", NOW);
    const dong2 = await db.studyEntitlementXuLy.findUniqueOrThrow({ where: { id: xep!.id } });
    expect(dong2.trangThai, "cùng điều kiện ⇒ KHÔNG mở lại").toBe("DA_XU_LY");
    expect(dong2.updatedAt.getTime()).toBe(dong1.updatedAt.getTime());
    expect(docDaQuyet(dong2.payload)).not.toBeNull();

    // Điều kiện ĐỔI: tiền bị từ chối ⇒ quyền học bị đánh dấu thu hồi ⇒ lý do chờ xếp lớp đổi sang "không chốt phạm vi khi đang treo".
    await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } });
    await hichCapQuyenHocChoDon(DON, "CHUYEN_DOI", NOW);
    const ds = await xuLyCua(DON, "CHO_XEP_LOP");
    expect(ds).toHaveLength(1);
    expect(ds[0]!.id).toBe(xep!.id);
    expect(ds[0]!.trangThai).toBe("OPEN");
    expect(ds[0]!.lyDo).not.toBe(dong1.lyDo);
    expect(docDaQuyet(ds[0]!.payload), "quyết định cũ không còn áp").toBeNull();
  });

  it("[HD-DB-31] hai dòng KHÁC số tiền thiếu trên một đơn: mỗi dòng mang ĐÚNG số của mình — không trộn tiền giữa các dòng", async () => {
    const DON = `${T}don-31`;
    const A = `${T}it-31a`;
    const B = `${T}it-31b`;
    await dungDon({ id: DON, dong: [{ id: A, studentId: HV_A, courseId: KHOA }, { id: B, studentId: HV_B, courseId: KHOA_B }] });
    await thu(DON, A, TIEN, DA_XAC_NHAN);
    await thu(DON, B, TIEN, DA_XAC_NHAN);
    expect((await xetCapQuyenHocChoDon(DON, "KE_TOAN_XAC_NHAN", NOW, "CAP")).daCap).toHaveLength(2);
    await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } });
    await thu(DON, B, 3_000_000, DA_XAC_NHAN); // B đã xác nhận lại MỘT PHẦN
    await chay();
    const ds = await xuLyCua(DON, "CAN_THU_HOI");
    const a = ds.find((d) => d.orderItemId === A)!;
    const b = ds.find((d) => d.orderItemId === B)!;
    expect(a.lyDo).toContain(`${TIEN}đ`);
    expect(a.lyDo).not.toContain(`${TIEN - 3_000_000}đ`);
    expect(b.lyDo).toContain(`${TIEN - 3_000_000}đ`);
    expect(b.lyDo).not.toMatch(new RegExp(`thiếu ${TIEN}đ`));
    expect([a.studentId, a.courseId, b.studentId, b.courseId]).toEqual([HV_A, KHOA, HV_B, KHOA_B]);
  });

  // ═══ 9 · BÁO CÁO CRON + CÂU QUÉT ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

  it("[HD-DB-32] báo cáo cron: `moi`/`giuNguyen` của LECH qua hai lượt; `daDong` khi điều kiện hết (CAN_THU_HOI khi tiền đủ lại, LECH khi dữ liệu khớp lại)", async () => {
    const DON = `${T}don-32`;
    await db.enrollment.create({ data: { id: `${T}gd-32`, studentId: HV_A, classId: LOP, courseId: KHOA, centerId: CS1, status: "STUDYING" } });
    await dungDon({ id: DON, dong: [{ id: `${T}it-32`, enrollmentId: `${T}gd-32` }] });
    const l1 = await chay();
    expect(l1.moiTheoLoai.LECH_DU_LIEU).toBe(1);
    expect(l1.giuNguyenTheoLoai.LECH_DU_LIEU).toBe(0);
    const l2 = await chay();
    expect(l2.moiTheoLoai.LECH_DU_LIEU, "lượt 2: không tạo gì").toBe(0);
    expect(l2.giuNguyenTheoLoai.LECH_DU_LIEU, "lượt 2: báo 'đã có'").toBe(1);
    // Dữ liệu khớp lại: gỡ ghi danh khỏi dòng đơn ⇒ lượt sau ĐÓNG dòng lệch.
    await db.orderItem.update({ where: { id: `${T}it-32` }, data: { enrollmentId: null } });
    const l3 = await chay();
    expect(l3.daDongTheoLoai.LECH_DU_LIEU).toBe(1);
    expect(l3.moiTheoLoai.LECH_DU_LIEU).toBe(0);

    const D2 = `${T}don-32b`;
    await donDaCap(D2, `${T}it-32b`);
    await db.payment.updateMany({ where: { orderId: D2 }, data: { accountantStatus: "REJECTED" } });
    expect((await chay()).moiTheoLoai.CAN_THU_HOI).toBe(1);
    await db.payment.updateMany({ where: { orderId: D2 }, data: { accountantStatus: DA_XAC_NHAN } }); // tiền đủ lại
    const l5 = await chay();
    expect(l5.daDongTheoLoai.CAN_THU_HOI).toBe(1);
    expect((await xuLyCua(D2, "CAN_THU_HOI"))[0]).toMatchObject({ trangThai: "HUY" });
  });

  it("[HD-DB-33] TIỀN KHÔNG GẮN ĐƯỢC DÒNG (đơn hai dòng, khoản xác nhận `orderItemId = null`) ⇒ cron KHÔNG kết luận đủ tiền / không cấp, và ghi LECH_DU_LIEU (TIEN_KHONG_GAN_DONG) cho cả hai dòng; \"Thử cấp lại\" cũng ghi (đi qua `chuaXacDinhDuocDong` của lượt cấp), xếp lớp chạy thật", async () => {
    const DON = `${T}don-33`;
    await dungDon({ id: DON, dong: [{ id: `${T}it-33a`, studentId: HV_A }, { id: `${T}it-33b`, studentId: HV_B, courseId: KHOA_B }] });
    await thuKhongGanDong(DON, TIEN);
    const l1 = await chay();
    expect(l1.moiTheoLoai.LECH_DU_LIEU).toBe(2);
    const ds = await xuLyCua(DON);
    expect(ds.map((d) => [d.loai, maLech(d.payload)])).toEqual([["LECH_DU_LIEU", ["TIEN_KHONG_GAN_DONG"]], ["LECH_DU_LIEU", ["TIEN_KHONG_GAN_DONG"]]]);
    expect(await quyenCua(DON), "mơ hồ ⇒ không cấp").toHaveLength(0);
    expect(await xuLyCua(DON, "THIEU_QUYEN_HOC")).toHaveLength(0);

    // "Thử cấp lại" trên một dòng chèn tay của đơn mơ hồ: lượt cấp báo chuaXacDinhDuocDong ⇒ doi soat lech ghi; xếp lớp chạy thật và đóng dòng chờ xếp không còn cơ sở.
    await db.studyEntitlementXuLy.deleteMany({ where: { orderId: DON } });
    await chenXuLy({ id: `${T}xl-33`, orderId: DON, orderItemId: `${T}it-33a`, loai: "CHO_XEP_LOP", courseId: KHOA });
    const r = phaiOk(await thuCapLai({ actor: QL(), nguoi: NGUOI(`${T}ql`), dongId: `${T}xl-33`, now: NOW }));
    expect(r.daLam).toBe(true);
    expect((await db.studyEntitlementXuLy.findUniqueOrThrow({ where: { id: `${T}xl-33` } })).trangThai, "xếp lớp đã chạy ⇒ dòng không còn cơ sở bị đóng").toBe("HUY");
    expect((await xuLyCua(DON, "LECH_DU_LIEU")).map((d) => maLech(d.payload))).toEqual([["TIEN_KHONG_GAN_DONG"], ["TIEN_KHONG_GAN_DONG"]]);
  });

  it("[HD-DB-34] #5 quyền học đã đóng / hết hạn mà ghi danh còn học: ĐẾM đúng bốn ca dương (EXPIRED · STOPPED · SEAT_HOLD · EXHAUSTED hết ân hạn) và KHÔNG đếm ba ca âm (ACTIVE · ghi danh đã rút · EXHAUSTED còn ân hạn); cron không ghi dòng nào cho chúng", async () => {
    const ca = [
      ["EXPIRED", "STUDYING", 0, 0, true],
      ["STOPPED", "ACTIVE", 0, 0, true],
      ["SEAT_HOLD", "CONFIRMED", 0, 0, true],
      ["EXHAUSTED", "STUDYING", 0, 0, true],
      ["ACTIVE", "STUDYING", 0, 0, false],
      ["STOPPED", "CANCELLED", 0, 0, false],
      ["EXHAUSTED", "STUDYING", 2, 1, false],
    ] as const;
    const dung: { id: string; duong: boolean }[] = [];
    let i = 0;
    for (const [status, gdStatus, granted, used, duong] of ca) {
      i++;
      const DON = `${T}don-34-${i}`;
      const quyenId = await donDaCap(DON, `${T}it-34-${i}`);
      await db.class.create({ data: { id: `${T}lop-34-${i}`, name: `Lớp 34-${i} (fixture)`, courseId: KHOA, centerId: CS1, status: "ACTIVE", maxStudents: 12 } });
      await db.enrollment.create({ data: { id: `${T}gd-34-${i}`, studentId: HV_A, classId: `${T}lop-34-${i}`, courseId: KHOA, centerId: CS1, status: gdStatus } });
      await db.studyEntitlement.update({ where: { id: quyenId }, data: { status, enrollmentId: `${T}gd-34-${i}`, graceSessionsGranted: granted, graceSessionsUsed: used } });
      dung.push({ id: quyenId, duong });
    }
    const bao = await chay();
    const trongMau = new Set(bao.quyenDongConGhiDanh.mau.map((m) => m.quyenHocId));
    const duong = dung.filter((d) => d.duong).map((d) => d.id);
    expect(bao.quyenDongConGhiDanh.tong, "tổng = số ca dương của fixture").toBe(duong.length);
    for (const id of duong) expect(trongMau.has(id), id).toBe(true);
    for (const id of dung.filter((d) => !d.duong).map((d) => d.id)) expect(trongMau.has(id), id).toBe(false);
    expect(await db.studyEntitlementXuLy.count({ where: { orderId: { startsWith: `${T}don-34-` } } }), "chỉ ĐẾM — không ghi dòng").toBe(0);
  });

  it("[HD-DB-35] CÂU QUÉT: đơn xoá mềm · đơn không có dấu phạm vi · đơn cơ sở TẮT cờ KHÔNG được quét; đơn thường được quét", async () => {
    const O1 = `${T}don-35a`; // quét
    const O2 = `${T}don-35b`; // xoá mềm
    const O3 = `${T}don-35c`; // đơn thường (không dấu)
    const O4 = `${T}don-35d`; // CS2 (cờ tắt)
    await dungDon({ id: O1, dong: [{ id: `${T}it-35a` }] });
    await dungDon({ id: O2, dong: [{ id: `${T}it-35b` }] });
    await dungDon({ id: O3, dong: [{ id: `${T}it-35c` }] });
    await dungDon({ id: O4, centerId: CS2, dong: [{ id: `${T}it-35d` }] });
    await db.orderItem.update({ where: { id: `${T}it-35c` }, data: { metadata: { courseId: KHOA, soBuoi: 48 } } });
    await db.order.update({ where: { id: O2 }, data: { deletedAt: NOW } });
    await thu(O1, `${T}it-35a`, TIEN, DA_XAC_NHAN);
    await thu(O2, `${T}it-35b`, TIEN, DA_XAC_NHAN);
    await thu(O3, `${T}it-35c`, TIEN, DA_XAC_NHAN);
    await thu(O4, `${T}it-35d`, TIEN, DA_XAC_NHAN, CU, CS2);
    const truoc = await chay(0);
    expect(truoc.soDonQuet, "trần 0 ⇒ không quét đơn nào").toBe(0);
    await chay();
    expect((await xuLyCua(O1)).map((d) => d.loai)).toEqual(["THIEU_QUYEN_HOC"]);
    for (const [ten, o] of [["xoá mềm", O2], ["đơn thường", O3], ["cơ sở tắt cờ", O4]] as const) expect(await xuLyCua(o), ten).toEqual([]);
  });

  it("[HD-DB-36] THỨ TỰ QUÉT + TRẦN: `chay(1)` quét đơn MỚI NHẤT trước; đơn cũ hơn chỉ được quét khi trần đủ", async () => {
    const MOI = `${T}don-36new`;
    const CUHON = `${T}don-36old`;
    for (const [o, ngay] of [[MOI, "2099-02-01T00:00:00Z"], [CUHON, "2099-01-01T00:00:00Z"]] as const) {
      await dungDon({ id: o, dong: [{ id: `${o}-it` }] });
      await thu(o, `${o}-it`, TIEN, DA_XAC_NHAN);
      await db.order.update({ where: { id: o }, data: { createdAt: new Date(ngay) } });
    }
    const bao = await chay(1);
    expect(bao.soDonQuet).toBe(1);
    expect((await xuLyCua(MOI)).map((d) => d.loai)).toEqual(["THIEU_QUYEN_HOC"]);
    expect(await xuLyCua(CUHON), "đơn cũ chưa tới lượt").toEqual([]);
    await chay(2);
    expect((await xuLyCua(CUHON)).map((d) => d.loai)).toEqual(["THIEU_QUYEN_HOC"]);
  });

  it("[HD-DB-37] QUÁ HẠN + SỐ ĐANG MỞ: biên 72 giờ (đúng 72h = quá hạn, 71h59'59\" = chưa); cơ sở TẮT cờ KHÔNG vào `dangMoTheoLoai` / `quaHan`; danh sách lọc `quaHan` cùng biên", async () => {
    const khoa = `${T}khoa-37`;
    const bao0 = await chay();
    await chenXuLy({ id: `${T}xl-37a`, orderId: `${T}don-37`, orderItemId: `${T}it-37a`, loai: "CHO_XEP_LOP", courseId: khoa, updatedAt: gio(72) });
    await chenXuLy({ id: `${T}xl-37b`, orderId: `${T}don-37`, orderItemId: `${T}it-37b`, loai: "CHO_XEP_LOP", courseId: khoa, updatedAt: new Date(gio(72).getTime() + 1000) });
    await chenXuLy({ id: `${T}xl-37c`, orderId: `${T}don-37`, orderItemId: `${T}it-37c`, loai: "CHO_XEP_LOP", courseId: khoa, centerId: CS2, updatedAt: gio(100) });
    const bao1 = await chay();
    expect(bao1.dangMoTheoLoai.CHO_XEP_LOP - bao0.dangMoTheoLoai.CHO_XEP_LOP, "chỉ 2 dòng CS1; dòng CS2 (cờ tắt) không đếm").toBe(2);
    expect(bao1.quaHan.tong - bao0.quaHan.tong, "chỉ dòng đúng 72h").toBe(1);
    expect(bao1.quaHan.theoLoai.CHO_XEP_LOP - bao0.quaHan.theoLoai.CHO_XEP_LOP).toBe(1);
    const ds = await docHangDoi(QL(), { trangThai: ["OPEN"], courseId: khoa, quaHan: true }, 1, NOW);
    expect(ds.dong.map((d) => d.id)).toEqual([`${T}xl-37a`]);
    expect(ds.dong[0]!.quaHan).toBe(true);
    const tatCa = await docHangDoi(QL(), { trangThai: ["OPEN"], courseId: khoa }, 1, NOW);
    expect(tatCa.dong.find((d) => d.id === `${T}xl-37b`)!.quaHan, "71h59'59\"").toBe(false);
  });

  // ═══ 10 · LỌC + PHÂN TRANG + ĐẾM ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

  it("[HD-DB-38] BỘ LỌC danh sách: học viên · lớp · tên học viên · tên bé (nhánh lead) · từ/đến ngày tạo · quá hạn — mỗi bộ lọc lọc ĐÚNG và không lọc nhầm dòng khác", async () => {
    const A = `${T}don-38a`; // HV_A, CAN_THU_HOI, có lớp
    const B = `${T}don-38b`; // HV_B, THIEU, khoá B
    const C = `${T}don-38c`; // chưa có học viên, bé có tên
    const qa = await donDaCap(A, `${T}it-38a`);
    await db.studyEntitlement.update({ where: { id: qa }, data: { classId: LOP } });
    await db.payment.updateMany({ where: { orderId: A }, data: { accountantStatus: "REJECTED" } });
    await dungDon({ id: B, dong: [{ id: `${T}it-38b`, studentId: HV_B, courseId: KHOA_B }] });
    await thu(B, `${T}it-38b`, TIEN, DA_XAC_NHAN);
    const { conIds } = await dungLead("l38", 1);
    await dungDon({ id: C, dong: [{ id: `${T}it-38c`, studentId: null, leadChildId: conIds[0]! }] });
    await thu(C, `${T}it-38c`, TIEN, DA_XAC_NHAN);
    await chay();
    const dat = async (orderId: string, createdAt: Date, updatedAt?: Date) =>
      db.studyEntitlementXuLy.updateMany({ where: { orderId }, data: { createdAt, ...(updatedAt ? { updatedAt } : {}) } });
    await dat(A, gio(24 * 10), gio(100));
    await dat(B, gio(24 * 2));
    await dat(C, gio(24));
    const ids = async (loc: Partial<BoLocHangDoi>) => (await docToi(QL(), { trangThai: ["OPEN"], ...loc }, 1, NOW)).dong.map((d) => d.don!.id).sort();

    expect(await ids({}), "nền: ba đơn").toEqual([A, B, C]);
    expect(await ids({ studentId: HV_A })).toEqual([A]);
    expect(await ids({ studentId: HV_B })).toEqual([B]);
    expect(await ids({ classId: LOP })).toEqual([A]);
    expect(await ids({ q: "bé b" })).toEqual([B]);
    expect(await ids({ q: "l38-con" }), "nhánh tên bé của phiếu lead").toEqual([C]);
    expect(await ids({ tu: gio(24 * 3) })).toEqual([B, C]);
    expect(await ids({ den: gio(24 * 1.5) })).toEqual([A, B]);
    expect(await ids({ tu: gio(24 * 3), den: gio(24 * 1.5) })).toEqual([B]);
    expect(await ids({ quaHan: true })).toEqual([A]);
    expect(await ids({ courseId: KHOA_B })).toEqual([B]);
    expect(await ids({ loai: ["CAN_THU_HOI"] })).toEqual([A]);
  });

  it("[HD-DB-39] PHÂN TRANG (CO_TRANG = 25): 26 dòng ⇒ trang 1 có 25, trang 2 có 1, hợp = 26 id khác nhau; trang vượt ⇒ rỗng; `demDangMo` chỉ đếm OPEN trong TẦM NHÌN của người xem", async () => {
    const khoa = `${T}khoa-pg`;
    await db.studyEntitlementXuLy.createMany({
      data: Array.from({ length: 26 }, (_, i) => ({
        id: `${T}xl-pg-${String(i).padStart(2, "0")}`,
        loai: "CHO_XEP_LOP" as const,
        trangThai: "OPEN" as const,
        orderId: `${T}don-pg`,
        orderItemId: `${T}it-pg-${i}`,
        courseId: khoa,
        centerId: CS1,
        orgUnitId: OU1,
        lyDo: "pg",
        createdAt: NOW,
        updatedAt: new Date(NOW.getTime() - i * 1000),
      })),
    });
    const loc: BoLocHangDoi = { trangThai: ["OPEN"], courseId: khoa };
    const [p1, p2, p3] = [await docHangDoi(QL(), loc, 1, NOW), await docHangDoi(QL(), loc, 2, NOW), await docHangDoi(QL(), loc, 3, NOW)];
    expect([p1.dong.length, p2.dong.length, p3.dong.length]).toEqual([25, 1, 0]);
    expect([p1.tong, p1.soTrang, p2.trang]).toEqual([26, 2, 2]);
    expect(new Set([...p1.dong, ...p2.dong].map((d) => d.id)).size).toBe(26);

    const dem = async (a: Actor) => (await demDangMo(a)).CHO_XEP_LOP;
    const [q1, q2, ad] = [await dem(QL()), await dem(QL_CS2()), await dem(ADMIN())];
    await chenXuLy({ id: `${T}xl-dm-1`, orderId: `${T}don-dm`, orderItemId: `${T}it-dm-1`, loai: "CHO_XEP_LOP" });
    await chenXuLy({ id: `${T}xl-dm-2`, orderId: `${T}don-dm`, orderItemId: `${T}it-dm-2`, loai: "CHO_XEP_LOP", centerId: CS2 });
    await chenXuLy({ id: `${T}xl-dm-3`, orderId: `${T}don-dm`, orderItemId: `${T}it-dm-3`, loai: "CHO_XEP_LOP", trangThai: "DA_XU_LY" });
    expect(await dem(QL()) - q1, "CS1: 1 dòng mở (dòng đóng và dòng CS2 không đếm)").toBe(1);
    expect(await dem(QL_CS2()) - q2, "CS2: chỉ dòng CS2").toBe(1);
    expect(await dem(ADMIN()) - ad, "SUPER_ADMIN: cả hai cơ sở").toBe(2);
  });

  it("[HD-DB-40] CỔNG ĐỌC ở tầng dữ liệu: actor KHÔNG giữ `entitlements:view` ⇒ `docHangDoi` / `demDangMo` ném KHONG_QUYEN (không tin trang đã gác); SUPER_ADMIN và người có view đọc được", async () => {
    const khongView = actorLit({ id: `${T}kv`, perms: ["entitlements:manage"] });
    const rong = actorLit({ id: `${T}rong`, perms: [] });
    for (const a of [khongView, rong]) {
      await expect(docHangDoi(a, { trangThai: ["OPEN"] }, 1, NOW)).rejects.toMatchObject({ ma: "KHONG_QUYEN" });
      await expect(demDangMo(a)).rejects.toMatchObject({ ma: "KHONG_QUYEN" });
    }
    await expect(docHangDoi(XEM(), { trangThai: ["OPEN"] }, 1, NOW)).resolves.toBeDefined();
    await expect(docHangDoi(ADMIN(), { trangThai: ["OPEN"] }, 1, NOW)).resolves.toBeDefined();
    await expect(demDangMo(XEM())).resolves.toBeDefined();
  });

  // ═══ 11 · ĐẦU VÀO + ĐUA NHAU ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

  it("[HD-DB-41] lý do quá ngắn / trống ⇒ DAU_VAO ở TẦNG DỊCH VỤ cho cả bốn hành động cần lý do; DB (hàng + audit) đứng yên", async () => {
    const id = await dungKichBan("THIEU", "41");
    const truoc = await demHang();
    for (const hanhDong of [dongDongHangDoi, giuQuyenHoc, duyetThuHoi, danhDauCanDuyet] as const) {
      for (const lyDo of ["", "   ", "ngắn", "chín ký t"]) phaiLoi(await hanhDong(vao(QL(), id, lyDo)), "DAU_VAO");
    }
    expect(await demHang()).toEqual(truoc);
    expect((await db.studyEntitlementXuLy.findUniqueOrThrow({ where: { id } })).trangThai).toBe("OPEN");
  });

  it("[HD-DB-42] ĐUA NHAU trên cùng một dòng: hai lượt DUYỆT THU HỒI song song ⇒ thu hồi ĐÚNG MỘT lần (một audit REVOKE, một audit VOID của quyền học); đóng + giữ quyền song song ⇒ ĐÚNG MỘT audit", async () => {
    const DON = `${T}don-42`;
    const quyenId = await donDaCap(DON, `${T}it-42`);
    await db.payment.updateMany({ where: { orderId: DON }, data: { accountantStatus: "REJECTED" } });
    await chay();
    const [dong] = await xuLyCua(DON, "CAN_THU_HOI");
    const kq = await Promise.all([duyetThuHoi(vao(QL(), dong!.id, "Lượt thứ nhất, đủ dài")), duyetThuHoi(vao(QL(), dong!.id, "Lượt thứ hai, đủ dài"))]);
    expect(kq.every((r) => r.ok), JSON.stringify(kq)).toBe(true);
    expect(kq.filter((r) => r.ok && r.daLam)).toHaveLength(1);
    expect((await db.studyEntitlement.findUniqueOrThrow({ where: { id: quyenId } })).status).toBe("VOIDED");
    expect(await db.auditLog.count({ where: { entityId: dong!.id, action: "REVOKE_ENTITLEMENT" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityType: "StudyEntitlement", entityId: quyenId, action: "VOID" } })).toBe(1);

    const D2 = `${T}don-42b`;
    const q2 = await donDaCap(D2, `${T}it-42b`);
    await db.studyEntitlementUsage.create({ data: { entitlementId: q2, studentId: HV_A, lessonOrder: 1, source: "MANUAL" } });
    await db.payment.updateMany({ where: { orderId: D2 }, data: { accountantStatus: "REJECTED" } });
    await chay();
    const [treo] = await xuLyCua(D2, "TREO_DUYET_TAY");
    const kq2 = await Promise.all([dongDongHangDoi(vao(QL(), treo!.id, "Đóng song song lượt một")), giuQuyenHoc(vao(QL(), treo!.id, "Giữ quyền song song lượt hai"))]);
    expect(kq2.every((r) => r.ok), JSON.stringify(kq2)).toBe(true);
    expect(kq2.filter((r) => r.ok && r.daLam)).toHaveLength(1);
    expect(await db.auditLog.count({ where: { entityType: "StudyEntitlementXuLy", entityId: treo!.id, action: { in: ["CLOSE", "KEEP_ENTITLEMENT"] } } })).toBe(1);
    expect((await db.studyEntitlementXuLy.findUniqueOrThrow({ where: { id: treo!.id } })).trangThai).toBe("DA_XU_LY");
  });
});
