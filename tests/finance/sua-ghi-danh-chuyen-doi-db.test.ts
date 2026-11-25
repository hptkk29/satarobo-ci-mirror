// tests/finance/sua-ghi-danh-chuyen-doi-db.test.ts — [SGD-*] «SỬA GHI DANH» ở màn chuyển đổi: đổi buổi bắt đầu VÀ/HOẶC LỚP, bù + yêu cầu học vượt + sổ lượt đổi theo
// (chủ dự án 15/11/2026), Postgres THẬT.
//
// Chạy:  DATABASE_URL=…/satarobo_test_sgd DIRECT_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/sua-ghi-danh-chuyen-doi-db.test.ts
//
// Gọi THẲNG `chuyenDoiDonAction` (dựng ghi danh thật) rồi `suaGhiDanhAction` — chỉ mock cổng ngoài (phiên, quyền theo TẬP đặt tay, actor, revalidate, hích quyền học, câu hỏi tiền webhook,
// dấu phạm vi). KHÔNG gọi `resetDb()`: tự dựng, tự dọn theo tiền tố id; mỗi ca tự dựng lại từ đầu (chạy MỘT MÌNH vẫn xanh — luật 18).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({
  actor: null as unknown as Actor,
  uid: "fx-sgd-nguoi-thao-tac",
  quyen: new Set<string>(),
  /** `true` ⇒ dòng đơn được coi là dòng THEO PHẠM VI HỌC. */
  phamVi: false,
  /** Ép bước đồng bộ buổi bắt đầu / bù TỪ CHỐI (sau khi chuyển lớp đã ghi) — để chứng minh từ chối đó LÙI cả chuyển lớp. */
  epTuChoi: false,
}));

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: h.uid, name: "Người thao tác fixture" } }) }));
vi.mock("@/lib/auth/check-permission", () => ({
  checkPermission: async (k: string) => h.quyen.has(k),
  canViewLeadPii: async () => h.quyen.has("leads:view-pii"),
  assertPermission: async (k: string) => {
    if (!h.quyen.has(k)) throw new Error(`thiếu ${k}`);
  },
}));
vi.mock("@/lib/auth/actor", async (goc) => {
  const m = await goc<typeof import("@/lib/auth/actor")>();
  return { ...m, resolveActor: async () => h.actor };
});
vi.mock("@/lib/entitlements/gate-xep-lop", async (goc) => {
  const m = await goc<typeof import("@/lib/entitlements/gate-xep-lop")>();
  return { ...m, dongPhamViDangBat: async (_c: unknown, dong: readonly { id: string }[]) => new Set(h.phamVi ? dong.map((d) => d.id) : []) };
});
vi.mock("@/lib/orders/pham-vi/doc-dong", async (goc) => {
  const m = await goc<typeof import("@/lib/orders/pham-vi/doc-dong")>();
  return { ...m, docPhamViDong: (md: unknown) => (h.phamVi ? ({ giả: true } as unknown as ReturnType<typeof m.docPhamViDong>) : m.docPhamViDong(md)) };
});
vi.mock("@/lib/orders/hoc-vuot-chuyen-doi", async (goc) => {
  const m = await goc<typeof import("@/lib/orders/hoc-vuot-chuyen-doi")>();
  return {
    ...m,
    suaBuoiBatDauGhiDanh: (...a: Parameters<typeof m.suaBuoiBatDauGhiDanh>) =>
      h.epTuChoi ? Promise.resolve({ ok: false as const, error: "giả lập: bước đồng bộ từ chối sau khi đã chuyển lớp" }) : m.suaBuoiBatDauGhiDanh(...a),
  };
});
vi.mock("@/lib/entitlements/hich", () => ({ hichCapQuyenHocChoDon: async () => undefined }));
vi.mock("@/lib/payments/tien-webhook-vao-don", () => ({
  tienWebhookCuaDon: async () => ({ soTien: 1_000, soLuot: 1 }),
  duocChuyenDoi: (t: { soTien: number }) => t.soTien > 0,
  lyDoChuaChuyenDoiDuoc: () => "chưa có tiền",
}));

import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { canonicalPhone } from "@/lib/phone";
import { chuyenDoiDonAction, suaGhiDanhAction } from "@/app/(admin)/admin/orders/[id]/chuyen-doi/_actions";
import { suaGhiDanhCuaDon } from "@/lib/orders/sua-ghi-danh-chuyen-doi";

if (!RUN_DB_TESTS) console.warn(`[SGD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const T = "fx-sgd-";
const CS = `${T}co-so`;
const KA = `${T}khoa`;
const KB = `${T}khoa-khac`;
const LOP = `${T}lop`; // lớp hiện tại: đã dạy 3 buổi
const LOP_CHUA = `${T}lop-chua`; // chưa dạy buổi nào
const LOP_XA = `${T}lop-xa`; // đã dạy 5 buổi (xa hơn lớp hiện tại)
const LOP_DAY = `${T}lop-day`; // sĩ số 1, đã đủ
const LOP_KHAC = `${T}lop-khac-khoa`;
const TAT_CA_LOP = [LOP, LOP_CHUA, LOP_XA, LOP_DAY, LOP_KHAC];
const DON = `${T}don`;
const IT = `${T}it`;
const SDT = "0905777999";
const EMAIL = "sgd-phu-huynh@example.test";
const NOW = new Date();
const NGAY = 24 * 3600_000;

const actor = (): Actor =>
  ({
    userId: h.uid,
    isSuperAdmin: true,
    isHoLevel: true,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) satisfies Actor;

const QLCS_Q = ["enrollments:create", "makeup:waive"];
/** Quản lý cơ sở THẬT (seed `CENTER_MANAGER`): có cả quyền chuyển lớp — khác `QLCS_Q` ở trên (cố ý thiếu chuyển lớp để dựng ca bị từ chối). */
const QLCS_DAY_DU_Q = [...QLCS_Q, "enrollments:transfer"];
/** Sale: có quyền tạo ghi danh + chuyển lớp nhưng KHÔNG phải Quản trị tối cao, KHÔNG phải Quản lý cơ sở. */
const SALE_Q = ["enrollments:create", "enrollments:transfer"];
const ADMIN_Q = ["enrollments:create", "enrollments:override-progress", "enrollments:transfer", "makeup:waive"];

async function don() {
  const sdt = [SDT, canonicalPhone(SDT) ?? SDT];
  const sv = await db.student.findMany({ where: { OR: [{ parentPhone: { in: sdt } }, { name: { startsWith: "Bé SGD" } }] }, select: { id: true } });
  const ids = sv.map((s) => s.id);
  await db.enrollmentCatchUpRequest.deleteMany({ where: { orderId: DON } });
  await db.attendance.deleteMany({ where: { studentId: { in: ids } } });
  await db.makeupCreditEntry.deleteMany({ where: { account: { studentId: { in: ids } } } });
  await db.makeupCreditAccount.deleteMany({ where: { studentId: { in: ids } } });
  await db.makeupNeed.deleteMany({ where: { studentId: { in: ids } } });
  await db.studentConsent.deleteMany({ where: { studentId: { in: ids } } });
  await db.receipt.deleteMany({ where: { payment: { orderId: DON } } });
  await db.payment.updateMany({ where: { orderId: DON }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  const gd = await db.enrollment.findMany({ where: { classId: { in: TAT_CA_LOP } }, select: { id: true } });
  await db.enrollmentAuditLog.deleteMany({ where: { enrollmentId: { in: gd.map((g) => g.id) } } });
  await db.enrollment.deleteMany({ where: { id: { in: gd.map((g) => g.id) } } });
  await db.student.deleteMany({ where: { OR: [{ id: { in: ids } }, { id: { startsWith: T } }] } });
  await db.user.deleteMany({ where: { OR: [{ email: EMAIL }, { phone: { in: sdt } }] } });
  await db.classSession.deleteMany({ where: { classId: { in: TAT_CA_LOP } } });
  await db.classSessionPlan.deleteMany({ where: { classId: { in: TAT_CA_LOP } } });
  await db.class.deleteMany({ where: { id: { in: TAT_CA_LOP } } });
  await db.course.deleteMany({ where: { id: { in: [KA, KB] } } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function dungLop(id: string, daDay: number, o: { courseId?: string; maxStudents?: number; centerId?: string } = {}) {
  const cs = o.centerId ?? CS;
  await db.class.create({ data: { id, name: `Lớp ${id}`, courseId: o.courseId ?? KA, centerId: cs, status: "ACTIVE", maxStudents: o.maxStudents ?? 12 } });
  for (let i = 0; i < daDay + 4; i++) {
    const plan = await db.classSessionPlan.create({ data: { id: `${id}-p${i}`, classId: id, seq: i + 1, order: i } });
    await db.classSession.create({
      data: {
        id: `${id}-s${i}`,
        classId: id,
        centerId: cs,
        planId: plan.id,
        date: i < daDay ? new Date(NOW.getTime() - (daDay - i + 1) * NGAY) : new Date(NOW.getTime() + (i - daDay + 1) * NGAY),
        status: i < daDay ? "COMPLETED" : "SCHEDULED",
      },
    });
  }
}

/** Nền: cơ sở, hai khoá, năm lớp, đơn mua 24 buổi (chưa chuyển đổi). */
async function dungNen() {
  await don();
  await db.center.create({ data: { id: CS, code: `${T}ma-cs1`, name: "Cơ sở SGD", slug: `${T}cs1`, address: "211 Nguyễn Hữu Thọ" } });
  await db.course.create({ data: { id: KA, name: "Sata SGD fixture", slug: `${T}sata`, totalSessions: 48 } });
  await db.course.create({ data: { id: KB, name: "Sata khác khoá SGD", slug: `${T}sata-khac`, totalSessions: 48 } });
  await dungLop(LOP, 3);
  await dungLop(LOP_CHUA, 0);
  await dungLop(LOP_XA, 5);
  await dungLop(LOP_DAY, 0, { maxStudents: 1 });
  await dungLop(LOP_KHAC, 0, { courseId: KB });
  await db.order.create({
    data: { id: DON, code: "ORD-269927-000777", type: "COURSE", status: "CONFIRMED", customerName: "PH fixture SGD", customerPhone: SDT, customerEmail: EMAIL, totalAmount: 6_000_000, centerId: CS },
  });
  await db.orderItem.create({
    data: { id: IT, orderId: DON, type: "COURSE_ENROLLMENT", itemName: IT, quantity: 1, unitPrice: 6_000_000, totalPrice: 6_000_000, metadata: { courseId: KA, coachFormat: "GROUP", soBuoi: 24 } },
  });
}

const dongGui = (extra: Record<string, unknown> = {}) => ({ orderItemId: IT, tenBe: "Bé SGD Một", classId: LOP, ...extra });

/** Chuyển đổi bằng QLCS (tự duyệt): lớp LOP đã dạy 3, bắt đầu buổi 1, bù b = 2 ⇒ yêu cầu APPROVED + 3 dòng bù + 2 lượt. Trả ghi danh + yêu cầu. */
async function chuyenDoiSan() {
  await dungNen();
  h.quyen = new Set(QLCS_Q);
  const kq = await chuyenDoiDonAction({ orderId: DON, dong: [dongGui({ buoiBatDau: 1, hocVuot: { soBuoiBu: 2 } })] });
  expect(kq, JSON.stringify(kq)).toMatchObject({ ok: true });
  const yc = await db.enrollmentCatchUpRequest.findFirstOrThrow({ where: { orderId: DON } });
  const gd = await db.enrollment.findFirstOrThrow({ where: { studentId: yc.studentId, classId: LOP } });
  h.quyen = new Set(ADMIN_Q);
  return { yc, gd, hv: yc.studentId };
}

const LY_DO = "Phụ huynh xin đổi lớp cho bé theo lịch mới";
const luotRong = async (ycId: string) =>
  (await db.makeupCreditEntry.findMany({ where: { idemKey: { startsWith: `ADJUSTMENT:hocvuot:${ycId}` } }, select: { grantedDelta: true } })).reduce((s, e) => s + e.grantedDelta, 0);
const buConSong = (studentId: string, classId?: string) =>
  db.makeupNeed.findMany({ where: { studentId, status: { not: "CANCELLED" }, ...(classId ? { classId } : {}) }, select: { id: true, classId: true, missedSessionId: true } });
/** Ảnh chụp những thứ KHÔNG được đổi khi bị từ chối. */
async function anh(gdId: string, studentId: string) {
  return {
    gd: await db.enrollment.findUniqueOrThrow({ where: { id: gdId }, select: { status: true, classId: true, buoiBatDau: true, transferredToId: true } }),
    soGhiDanh: await db.enrollment.count({ where: { studentId } }),
    item: (await db.orderItem.findUniqueOrThrow({ where: { id: IT }, select: { enrollmentId: true } })).enrollmentId,
    yc: await db.enrollmentCatchUpRequest.findMany({ select: { id: true, enrollmentId: true, classId: true, status: true, startLesson: true, makeupSessions: true } }),
    bu: (await buConSong(studentId)).length,
  };
}

describe.skipIf(!RUN_DB_TESTS)("[SGD-00..] Sửa ghi danh ở màn chuyển đổi: đổi lớp + bù theo — Postgres thật", () => {
  beforeEach(() => {
    h.actor = actor();
    h.uid = `${T}nguoi-thao-tac`;
    h.quyen = new Set(ADMIN_Q);
    h.phamVi = false;
    h.epTuChoi = false;
  });
  afterAll(don);

  it("[SGD-01] đổi sang lớp CHƯA dạy buổi nào: ghi danh mới ở lớp mới, cũ TRANSFERRED, dòng đơn theo, yêu cầu học vượt CANCELLED + rút hết lượt, dòng bù lớp cũ gỡ hết", async () => {
    const { yc, gd, hv } = await chuyenDoiSan();
    expect((await buConSong(hv, LOP)).length).toBe(3);
    expect(await luotRong(yc.id)).toBe(2);

    const kq = await suaGhiDanhAction({ orderId: DON, enrollmentId: gd.id, classId: LOP_CHUA, buoiBatDau: 1, lyDo: LY_DO });
    expect(kq, JSON.stringify(kq)).toMatchObject({ ok: true, doiLop: true, canBu: 0, buoiBatDau: 1 });
    const moiId = (kq as { enrollmentId: string }).enrollmentId;
    expect(moiId).not.toBe(gd.id);

    expect(await db.enrollment.findUniqueOrThrow({ where: { id: gd.id }, select: { status: true, transferredToId: true } })).toMatchObject({ status: "TRANSFERRED", transferredToId: moiId });
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: moiId }, select: { classId: true, studentId: true, status: true } })).toMatchObject({ classId: LOP_CHUA, studentId: hv, status: "STUDYING" });
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: IT } })).enrollmentId, "dòng đơn phải theo ghi danh mới (màn chuyển đổi đọc ghi danh qua dòng đơn)").toBe(moiId);

    const yc2 = await db.enrollmentCatchUpRequest.findMany({ where: { orderId: DON } });
    expect(yc2, "vẫn MỘT yêu cầu duy nhất").toHaveLength(1);
    expect(yc2[0]).toMatchObject({ id: yc.id, status: "CANCELLED", enrollmentId: moiId, classId: LOP_CHUA, startLesson: 1 });
    expect(await luotRong(yc.id), "lượt đã cộng được rút lại").toBe(0);
    expect(await buConSong(hv), "không còn dòng cần bù nào của lớp cũ").toHaveLength(0);
  });

  it("[SGD-02] đổi sang lớp đã dạy XA hơn (5 buổi): CHỈ MỘT yêu cầu (dời sang ghi danh + lớp mới, không đẻ yêu cầu thứ hai), v 3 → 5, b giữ 2 ⇒ lượt KHÔNG cộng đôi; dòng bù chuyển sang buổi lớp mới", async () => {
    const { yc, gd, hv } = await chuyenDoiSan();
    const kq = await suaGhiDanhAction({ orderId: DON, enrollmentId: gd.id, classId: LOP_XA, buoiBatDau: 1, lyDo: LY_DO });
    expect(kq, JSON.stringify(kq)).toMatchObject({ ok: true, doiLop: true, canBu: 5 });
    const moiId = (kq as { enrollmentId: string }).enrollmentId;

    const dsYc = await db.enrollmentCatchUpRequest.findMany({ where: { orderId: DON } });
    expect(dsYc, "KHÔNG đẻ yêu cầu thứ hai").toHaveLength(1);
    expect(dsYc[0]).toMatchObject({ id: yc.id, status: "APPROVED", enrollmentId: moiId, classId: LOP_XA, startLesson: 1, sessionsToCatchUp: 5, makeupSessions: 2 });
    expect(await luotRong(yc.id), "b giữ 2 ⇒ tổng lượt vẫn 2, không +2 lần nữa").toBe(2);
    expect(await db.makeupCreditEntry.count({ where: { account: { studentId: hv } } })).toBe(1);
    const bu = await buConSong(hv);
    expect(bu).toHaveLength(5);
    expect(bu.every((b) => b.classId === LOP_XA)).toBe(true);
    expect(bu.map((b) => b.missedSessionId).sort()).toEqual([0, 1, 2, 3, 4].map((i) => `${LOP_XA}-s${i}`));
  });

  it("[SGD-03] đổi lớp + khai b = 4 ⇒ lượt tăng đúng phần chênh (+2): tổng 4; b > v ⇒ từ chối, KHÔNG ghi gì", async () => {
    const { yc, gd, hv } = await chuyenDoiSan();
    const truoc = await anh(gd.id, hv);
    expect(await suaGhiDanhAction({ orderId: DON, enrollmentId: gd.id, classId: LOP_XA, buoiBatDau: 1, soBuoiBu: 9, lyDo: LY_DO })).toMatchObject({ ok: false });
    expect(await anh(gd.id, hv), "từ chối ⇒ nguyên trạng").toEqual(truoc);

    expect(await suaGhiDanhAction({ orderId: DON, enrollmentId: gd.id, classId: LOP_XA, buoiBatDau: 1, soBuoiBu: 4, lyDo: LY_DO })).toMatchObject({ ok: true });
    expect(await luotRong(yc.id)).toBe(4);
    expect(await db.enrollmentCatchUpRequest.findUniqueOrThrow({ where: { id: yc.id } })).toMatchObject({ makeupSessions: 4, sessionsToCatchUp: 5 });
  });

  it("[SGD-04] giá + khoản thu + dòng đơn ĐI THEO ghi danh mới (khoản đã gắn ghi danh cũ)", async () => {
    const { gd } = await chuyenDoiSan();
    await db.enrollment.update({ where: { id: gd.id }, data: { listPrice: 6_000_000, tuition: 6_000_000, finalPrice: 6_000_000 } });
    const khoan = await db.payment.create({
      data: { orderId: DON, orderItemId: IT, enrollmentId: gd.id, amount: 3_000_000, method: "card_pos", paidDate: NOW, saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: CS },
    });
    const kq = await suaGhiDanhAction({ orderId: DON, enrollmentId: gd.id, classId: LOP_CHUA, buoiBatDau: 1, lyDo: LY_DO });
    expect(kq, JSON.stringify(kq)).toMatchObject({ ok: true });
    const moiId = (kq as { enrollmentId: string }).enrollmentId;
    expect((await db.payment.findUniqueOrThrow({ where: { id: khoan.id } })).enrollmentId).toBe(moiId);
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: IT } })).enrollmentId).toBe(moiId);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: moiId } })).finalPrice).toBe(6_000_000);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: gd.id } })).finalPrice, "giá không nhân đôi").toBeNull();
  });

  it("[SGD-05] CHỈ đổi buổi bắt đầu (không chọn lớp) ⇒ đúng hành vi CŨ: cùng ghi danh, không chuyển lớp; bù 3 → 1 như «Sửa buổi bắt đầu»", async () => {
    const { yc, gd, hv } = await chuyenDoiSan();
    const kq = await suaGhiDanhAction({ orderId: DON, enrollmentId: gd.id, buoiBatDau: 3, lyDo: "Phụ huynh xin dời sang học từ buổi 3" });
    expect(kq, JSON.stringify(kq)).toMatchObject({ ok: true, doiLop: false, canBu: 1, buoiBatDau: 3, enrollmentId: gd.id });
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: gd.id }, select: { status: true, classId: true, buoiBatDau: true } })).toMatchObject({ status: "STUDYING", classId: LOP, buoiBatDau: 3 });
    expect(await db.enrollment.count({ where: { studentId: hv } })).toBe(1);
    expect(await db.enrollmentCatchUpRequest.findUniqueOrThrow({ where: { id: yc.id } })).toMatchObject({ startLesson: 3, sessionsToCatchUp: 1 });
  });

  it("[SGD-06] bước đồng bộ TỪ CHỐI sau khi đã chuyển lớp ⇒ LÙI CẢ chuyển lớp (ghi danh cũ vẫn STUDYING, không ghi danh mới, dòng đơn + yêu cầu + dòng bù nguyên)", async () => {
    const { gd, hv } = await chuyenDoiSan();
    const truoc = await anh(gd.id, hv);
    h.epTuChoi = true;
    const kq = await suaGhiDanhAction({ orderId: DON, enrollmentId: gd.id, classId: LOP_XA, buoiBatDau: 1, lyDo: LY_DO });
    expect(kq).toMatchObject({ ok: false });
    expect((kq as { error: string }).error).toMatch(/giả lập/);
    expect(await anh(gd.id, hv), "nửa chừng KHÔNG được commit").toEqual(truoc);
    expect(await db.enrollment.count({ where: { classId: LOP_XA } })).toBe(0);
  });

  describe("[SGD-07] từ chối ⇒ KHÔNG ghi gì (cổng đứng trước phép ghi đầu tiên)", () => {
    const tuChoi = async (goi: (gdId: string) => Promise<{ ok: boolean }>, truocKhi?: (c: Awaited<ReturnType<typeof chuyenDoiSan>>) => Promise<void>) => {
      const c = await chuyenDoiSan();
      if (truocKhi) await truocKhi(c);
      const truoc = await anh(c.gd.id, c.hv);
      expect(await goi(c.gd.id)).toMatchObject({ ok: false });
      expect(await anh(c.gd.id, c.hv)).toEqual(truoc);
    };

    it("[SGD-07a] lớp KHÁC KHOÁ — qua action (không nằm trong danh sách lớp của dòng) VÀ qua lõi (lib tự kiểm, không tin người gọi)", async () => {
      await tuChoi((g) => suaGhiDanhAction({ orderId: DON, enrollmentId: g, classId: LOP_KHAC, buoiBatDau: 1, lyDo: LY_DO }));
      let cau = "";
      await tuChoi(async (g) => {
        const kq = await suaGhiDanhCuaDon({ orderId: DON, enrollmentId: g, classIdMoi: LOP_KHAC, buoiBatDauMoi: 1, lyDo: LY_DO, vai: "ADMIN", tran: 6 }, { id: null, name: "fx" }, new Date());
        if (!kq.ok) cau = kq.error;
        return kq;
      });
      // Đúng LÝ DO của cổng cùng-khoá — không phải một cổng khác (vd «không dời được dòng đơn») từ chối thay.
      expect(cau).toMatch(/khoá khác/);
    });

    it("[SGD-07b] lớp ĐÃ ĐỦ chỗ", async () => {
      await tuChoi(
        (g) => suaGhiDanhAction({ orderId: DON, enrollmentId: g, classId: LOP_DAY, buoiBatDau: 1, lyDo: LY_DO }),
        async () => {
          await db.student.create({ data: { id: `${T}hv-lap-cho`, name: "Bé SGD Lấp chỗ", centerId: CS, status: "ACTIVE" } });
          await db.enrollment.create({ data: { id: `${T}gd-lap-cho`, studentId: `${T}hv-lap-cho`, classId: LOP_DAY, courseId: KA, centerId: CS, status: "STUDYING" } });
        },
      );
    });

    it("[SGD-07c] dòng mua theo PHẠM VI HỌC: không đổi lớp (quyền học gắn theo lớp)", async () => {
      await tuChoi(
        (g) =>
          suaGhiDanhCuaDon({ orderId: DON, enrollmentId: g, classIdMoi: LOP_CHUA, buoiBatDauMoi: 1, lyDo: LY_DO, vai: "ADMIN", tran: 6 }, { id: null, name: "fx" }, new Date()),
        async () => {
          h.phamVi = true;
        },
      );
    });

    it("[SGD-07d] bé ĐÃ CÓ ĐIỂM DANH ở lớp hiện tại: đổi lớp ở màn Chuyển lớp, không ở đây", async () => {
      await tuChoi(
        (g) => suaGhiDanhAction({ orderId: DON, enrollmentId: g, classId: LOP_CHUA, buoiBatDau: 1, lyDo: LY_DO }),
        async (c) => {
          await db.attendance.create({ data: { sessionId: `${LOP}-s0`, studentId: c.hv, status: "PRESENT" } });
        },
      );
    });

    it("[SGD-07e] dòng cần bù của lớp cũ ĐÃ XẾP buổi bù: không tự huỷ sau lưng người xếp", async () => {
      await tuChoi(
        (g) => suaGhiDanhAction({ orderId: DON, enrollmentId: g, classId: LOP_CHUA, buoiBatDau: 1, lyDo: LY_DO }),
        async (c) => {
          const dong = await db.makeupNeed.findFirstOrThrow({ where: { studentId: c.hv, classId: LOP } });
          await db.makeupNeed.update({ where: { id: dong.id }, data: { status: "SCHEDULED", makeupSessionId: `${LOP_CHUA}-s1` } });
        },
      );
    });

    it("[SGD-07f] thiếu quyền chuyển lớp (`enrollments:transfer`) hoặc là Sale (không phải Quản trị tối cao / Quản lý cơ sở) ⇒ từ chối; ĐỐI CHỨNG DƯƠNG: đủ quyền ⇒ ok", async () => {
      await tuChoi(
        (g) => suaGhiDanhAction({ orderId: DON, enrollmentId: g, classId: LOP_CHUA, buoiBatDau: 1, lyDo: LY_DO }),
        async () => {
          h.quyen = new Set(ADMIN_Q.filter((q) => q !== "enrollments:transfer"));
        },
      );
      await tuChoi(
        (g) => suaGhiDanhAction({ orderId: DON, enrollmentId: g, classId: LOP_CHUA, buoiBatDau: 1, lyDo: LY_DO }),
        async () => {
          h.quyen = new Set(QLCS_Q); // Quản lý cơ sở nhưng thiếu quyền chuyển lớp
        },
      );
      await tuChoi(
        (g) => suaGhiDanhAction({ orderId: DON, enrollmentId: g, classId: LOP_CHUA, buoiBatDau: 1, lyDo: LY_DO }),
        async () => {
          h.quyen = new Set(SALE_Q); // Sale: có chuyển lớp nhưng không phải admin / QLCS
        },
      );
      const c = await chuyenDoiSan();
      expect(await suaGhiDanhAction({ orderId: DON, enrollmentId: c.gd.id, classId: LOP_CHUA, buoiBatDau: 1, lyDo: LY_DO })).toMatchObject({ ok: true });
    });

    it("[SGD-08a] Sale KHÔNG sửa ghi danh dù chỉ đổi buổi bắt đầu (không chạm lớp) — cổng đứng TRƯỚC mọi phép ghi", async () => {
      await tuChoi(
        (g) => suaGhiDanhAction({ orderId: DON, enrollmentId: g, buoiBatDau: 3, lyDo: "Phụ huynh xin dời sang học từ buổi 3" }),
        async () => {
          h.quyen = new Set(SALE_Q);
        },
      );
    });

    it("[SGD-07g] lớp mới trùng lớp hiện tại; không chọn gì để đổi; lý do quá ngắn; ghi danh không thuộc đơn", async () => {
      await tuChoi((g) => suaGhiDanhAction({ orderId: DON, enrollmentId: g, classId: LOP, buoiBatDau: 1, lyDo: LY_DO }));
      await tuChoi((g) => suaGhiDanhAction({ orderId: DON, enrollmentId: g, lyDo: LY_DO }));
      await tuChoi((g) => suaGhiDanhAction({ orderId: DON, enrollmentId: g, classId: LOP_CHUA, buoiBatDau: 1, lyDo: "ngắn" }));
      await tuChoi(() => suaGhiDanhAction({ orderId: DON, enrollmentId: "khong-ton-tai", classId: LOP_CHUA, buoiBatDau: 1, lyDo: LY_DO }));
    });
  });

  describe("[SGD-08] Quản lý cơ sở được sửa ghi danh (chủ dự án 17/11/2026) — trong phạm vi cơ sở của đơn", () => {
    it("[SGD-08b] QLCS (có quyền chuyển lớp, KHÔNG có quyền Quản trị tối cao) đổi sang lớp CÙNG cơ sở ⇒ ok, ghi danh mới ở lớp mới", async () => {
      const { gd } = await chuyenDoiSan();
      h.quyen = new Set(QLCS_DAY_DU_Q);
      const kq = await suaGhiDanhAction({ orderId: DON, enrollmentId: gd.id, classId: LOP_CHUA, buoiBatDau: 1, lyDo: LY_DO });
      expect(kq, JSON.stringify(kq)).toMatchObject({ ok: true, doiLop: true });
      const moiId = (kq as { enrollmentId: string }).enrollmentId;
      expect(await db.enrollment.findUniqueOrThrow({ where: { id: moiId }, select: { classId: true } })).toMatchObject({ classId: LOP_CHUA });
    });

    it("[SGD-08c] QLCS đổi CHỈ buổi bắt đầu (không đổi lớp, không cần quyền chuyển lớp) ⇒ ok", async () => {
      const { gd } = await chuyenDoiSan();
      h.quyen = new Set(QLCS_Q);
      const kq = await suaGhiDanhAction({ orderId: DON, enrollmentId: gd.id, buoiBatDau: 3, lyDo: "Phụ huynh xin dời sang học từ buổi 3" });
      expect(kq, JSON.stringify(kq)).toMatchObject({ ok: true, doiLop: false, buoiBatDau: 3 });
    });

    it("[SGD-08d] QLCS KHÔNG đổi sang lớp của cơ sở KHÁC — qua action (lớp không nằm trong danh sách của vai) VÀ qua lõi (vai QLCS); ĐỐI CHỨNG DƯƠNG: Quản trị tối cao đổi được", async () => {
      const c = await chuyenDoiSan();
      const csKhac = `${T}cs-khac`;
      const lopKhac = `${T}lop-cs-khac`;
      await db.center.create({ data: { id: csKhac, code: `${T}ma-cs2`, name: "CS khác SGD", slug: csKhac, address: "x" } });
      await dungLop(lopKhac, 0, { centerId: csKhac });
      try {
        h.quyen = new Set(QLCS_DAY_DU_Q);
        const truoc = await anh(c.gd.id, c.hv);
        expect(await suaGhiDanhAction({ orderId: DON, enrollmentId: c.gd.id, classId: lopKhac, buoiBatDau: 1, lyDo: LY_DO })).toMatchObject({ ok: false });
        expect(
          await suaGhiDanhCuaDon({ orderId: DON, enrollmentId: c.gd.id, classIdMoi: lopKhac, buoiBatDauMoi: 1, lyDo: LY_DO, vai: "QLCS", tran: 6 }, { id: null, name: "fx" }, new Date()),
          "lõi phải tự từ chối lớp khác cơ sở, không tin người gọi",
        ).toMatchObject({ ok: false });
        expect(await anh(c.gd.id, c.hv), "từ chối ⇒ không ghi gì").toEqual(truoc);
        h.quyen = new Set(ADMIN_Q);
        expect(await suaGhiDanhAction({ orderId: DON, enrollmentId: c.gd.id, classId: lopKhac, buoiBatDau: 1, lyDo: LY_DO })).toMatchObject({ ok: true });
      } finally {
        await db.enrollment.deleteMany({ where: { classId: lopKhac } });
        await db.classSession.deleteMany({ where: { classId: lopKhac } });
        await db.classSessionPlan.deleteMany({ where: { classId: lopKhac } });
        await db.class.deleteMany({ where: { id: lopKhac } });
        await db.center.deleteMany({ where: { id: csKhac } });
      }
    });
  });
});
