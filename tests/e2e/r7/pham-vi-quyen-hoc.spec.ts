/**
 * [R7-PV] THU HỌC PHÍ THEO PHẠM VI HỌC — luồng tạo đơn → tiền xác nhận → quyền học → hàng chờ, và các cổng "đơn SCOPE không sửa".
 *
 * Spec R7 ĐẦU TIÊN cho luồng này. Trước nó `git grep -i "phamVi\|StudyEntitlement" tests/e2e/r7` ra 0 dòng: mọi ca của chương trình nằm ở
 * Vitest (`tests/finance/*-db.test.ts`) — bộ KHÔNG nằm trong cổng R7 "chạm tiền thì phải chạy R7" (CLAUDE.md).
 *
 * ── MÔ HÌNH ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Service-level (mẫu bulk-convert / payment-request-lifecycle): Server Action gọi `auth()` nên không chạy được trong runner này, và job R7
 * KHÔNG cài trình duyệt — spec này KHÔNG dùng `page`. "Tạo đơn" = ĐÚNG hai lời gọi mà `createOrderManualAction` làm với mô hình phạm vi:
 * `apDungMoHinhPhamVi` (cổng cờ + planner giá) rồi `metadataChoDong` (đóng dấu SCOPE) — sau đó ghi đơn/dòng + `ensureFullOrderRequest`.
 * Tiền: `recordPayment` (Sale ghi, luôn PENDING) → `confirmPayment` (kế toán xác nhận) — đường THẬT; sự kiện `payment.confirmed` mà nó ghi vào
 * outbox được ĐỌC từ DB rồi giao cho handler đã đăng ký (Playwright không chạy dispatcher; không dựng payload tay).
 *
 * Chạy: R7_SKIP_WEBSERVER=1 DATABASE_URL=…/satarobo_test_xxx DIRECT_URL=$DATABASE_URL NEXTAUTH_SECRET=<≥32 ký tự> AUTH_SECRET=<cùng chuỗi> \
 *       pnpm exec playwright test -c playwright.r7.config.ts pham-vi-quyen-hoc
 * Mỗi ca `resetDb()` ở đầu ⇒ database PHẢI riêng cho bộ này (CLAUDE.md: R7 hai shard hai database; nay CI chia 3 shard — mỗi shard một container).
 * Đồng hồ ĐÓNG BĂNG ở tham số (luật 19): không `new Date()` trong luồng đo.
 */
import { test, expect } from "@playwright/test";
import type { Prisma } from "@prisma/client";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedUser } from "../_helpers/seed";
import { clearSettingsCache } from "../../../lib/settings/service";
import { KHOA_CONG_TAC_PHAM_VI } from "../../../lib/entitlements/feature";
import { registerCapQuyenHocHandlers } from "../../../lib/entitlements/su-kien";
import { hichCapQuyenHocChoDon } from "../../../lib/entitlements/hich";
import { clearHandlers, getHandlers } from "../../../lib/events/registry";
import { apDungMoHinhPhamVi, xemTruocMoHinhPhamVi } from "../../../lib/orders/pham-vi/ap-dung";
import { docPhamViDong, laDonPhamVi, metadataChoDong } from "../../../lib/orders/pham-vi/doc-dong";
import { veMetadataConLead } from "../../../lib/orders/hoc-vien-dong-don";
import { confirmPayment, recordPayment } from "../../../lib/finance/payment";
import { ensureFullOrderRequest } from "../../../lib/payments/payment-request";
import { recordInstallmentPlan } from "../../../lib/orders/installments";
import { themConVaoDon } from "../../../lib/finance/them-con-vao-don";
import { doiKhoaChoCon } from "../../../lib/finance/doi-khoa-db";
import { CHINH_SACH_MAC_DINH } from "../../../lib/orders/chinh-sach-uu-dai";
import { LY_DO_DON_PHAM_VI_KHONG_KE_HOACH_DOT } from "../../../lib/orders/pham-vi/khoi-ke-hoach";
import { LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA, LY_DO_DON_PHAM_VI_KHONG_THEM_CON } from "../../../lib/orders/pham-vi/cong-sua-don";

const GIA48 = 10_560_000;
/** Thành tiền dòng 48 buổi (con 1, sản phẩm 1) — planner thật tính; ghim lại ở ca đầu để đổi chính sách thì đỏ đúng chỗ. */
const TIEN = 8_976_000;
const NOW = new Date("2026-10-19T03:00:00Z");
/** Hằng thay cho literal sau tên cột trạng thái kế toán: lưới [BUOC-6] (lib/finance/truc-a.test.ts) cấm cặp đó ngoài debt.ts. */
const DA_XAC_NHAN = "CONFIRMED" as const;

let CS1 = "";
let OU1 = "";
let KT = "";
let SALE = "";
let KHOA = "";
let HV = "";
let GD = "";
let dem = 0;

async function datCo(bat: boolean | null) {
  if (bat === null) await db.centerSetting.deleteMany({ where: { orgUnitId: OU1, key: KHOA_CONG_TAC_PHAM_VI } });
  else {
    await db.centerSetting.upsert({
      where: { orgUnitId_key: { orgUnitId: OU1, key: KHOA_CONG_TAC_PHAM_VI } },
      create: { orgUnitId: OU1, key: KHOA_CONG_TAC_PHAM_VI, valueJson: bat },
      update: { valueJson: bat },
    });
  }
  clearSettingsCache();
}

/**
 * Tạo đơn 1 dòng đúng như `createOrderManualAction` làm với mô hình phạm vi: cổng cờ + planner (`apDungMoHinhPhamVi`) → dấu (`metadataChoDong`) →
 * ghi đơn/dòng → `ensureFullOrderRequest`. Trả cả kết quả planner để ca đo "cờ BẬT ⇒ SCOPE, cờ TẮT ⇒ LEGACY".
 */
async function taoDon(o: { leadChildId?: string | null; studentId?: string | null; soBuoi?: number } = {}) {
  const studentId = o.studentId === undefined ? HV : o.studentId;
  const leadChildId = o.leadChildId ?? null;
  const soBuoi = o.soBuoi ?? 48;
  const metadataKhach = { courseId: KHOA, soBuoi, coachFormat: "GROUP" } as Record<string, unknown>;
  const dong = (unitPrice: number) => [
    { type: "COURSE_ENROLLMENT" as const, itemName: "Sata 3", quantity: 1, unitPrice, metadata: metadataKhach, studentId, leadChildId },
  ];
  const chung = { centerId: CS1, orgUnitId: OU1, khoa: [{ id: KHOA, price: GIA48, totalSessions: 48 }], taoDon: NOW };
  // Giá do MÁY CHỦ tính (như form: xem trước rồi mới điền ô Đơn giá). Gõ tay số 12 buổi là fixture tròn — không phân biệt được "buổi đã mua" với "buổi của khoá".
  let gia = TIEN;
  if (soBuoi !== 48) {
    const xt = await xemTruocMoHinhPhamVi({ ...chung, items: dong(0) as never });
    if (xt.kieu !== "SCOPE") throw new Error(`fixture: xem trước giá ${soBuoi} buổi không ra SCOPE (${xt.kieu})`);
    gia = xt.dong[0]!.thanhTien;
  }
  const items = dong(gia);
  const ketQua = await apDungMoHinhPhamVi({ ...chung, items: items as never, coKeHoachDot: false });
  const metadata = veMetadataConLead(metadataChoDong(ketQua, 0, metadataKhach, KHOA), leadChildId);
  const orderId = `r7pv-don-${++dem}`;
  const code = `ORD-261019-${String(900_000 + dem)}`;
  await db.order.create({
    data: { id: orderId, code, type: "COURSE", status: "PENDING_PAYMENT", customerName: "PH R7 phạm vi", customerPhone: "0399000333", subtotal: gia, discountAmount: 0, totalAmount: gia, centerId: CS1 },
  });
  const item = await db.orderItem.create({
    data: {
      orderId,
      type: "COURSE_ENROLLMENT",
      itemName: "Sata 3",
      quantity: 1,
      unitPrice: gia,
      totalPrice: gia,
      discountAmount: 0,
      studentId,
      status: "ACTIVE",
      metadata: metadata as Prisma.InputJsonValue,
    },
    select: { id: true, metadata: true },
  });
  await db.$transaction(async (tx) => {
    await ensureFullOrderRequest(tx as unknown as Prisma.TransactionClient, { id: orderId, code, totalAmount: gia, centerId: CS1 });
  });
  return { orderId, itemId: item.id, kieu: ketQua.kieu, metadata: item.metadata, gia };
}

/**
 * Sale ghi tiền mặt (luôn PENDING) rồi KẾ TOÁN (người khác) xác nhận — cả hai qua hàm THẬT.
 *
 * ⚠️ Khoản bám vào GHI DANH CŨ của học viên (`GD`) — cố ý. Khoản chưa gắn ghi danh đi nhánh `import("@/lib/entitlements/xac-nhan-truoc")` ĐỘNG trong
 * `confirmPayment`, mà runner Playwright nạp `.ts` bằng Node ESM thuần (không qua bộ biên dịch của Next) nên ném
 * "Cannot use import statement outside a module" — hạn chế của RUNNER, không phải của sản phẩm (đo 19/10/2026). Nhánh "xác nhận trước ghi danh" đã có ca
 * Vitest riêng (`[NOI-DB-04]`, `[NOI-DB-30]`). Khách MỚI (chưa có học viên) đi nhánh tiền ngân hàng — xem `thuNganHang`.
 */
async function thuVaXacNhan(orderId: string, amount: number, enrollmentId: string | null = GD) {
  const r = await recordPayment({ orderId, enrollmentId, amount, method: "cash", paidDate: NOW, recordedById: SALE, centerId: CS1 });
  if (!r.ok) throw new Error(`fixture: recordPayment từ chối — ${r.error}`);
  const c = await confirmPayment({ paymentId: r.paymentId, confirmedById: KT });
  return { paymentId: r.paymentId, xacNhan: c };
}

/**
 * Tiền NGÂN HÀNG đã đối khớp (hình dạng webhook / phiếu gộp để lại): giao dịch MATCHED + phiếu thu PAID + phân bổ + dòng `Payment` PENDING mang marker.
 * Dùng cho khách MỚI — chưa có ghi danh nào để khoản tiền bám vào.
 */
async function thuNganHang(orderId: string, amount: number, txn: string) {
  const providerTxnId = `r7pv-${txn}`;
  const bt = await db.bankTransaction.create({
    data: { provider: "SEPAY", providerTxnId, amount, transferredAt: NOW, status: "MATCHED", centerId: CS1 },
  });
  const dot = await db.paymentRequest.create({
    data: { orderId, centerId: CS1, installmentNo: 100 + ++dem, amountDue: amount, status: "PAID", sortOrder: 100 + dem },
  });
  await db.paymentAllocation.create({ data: { bankTransactionId: bt.id, paymentRequestId: dot.id, amount, centerId: CS1 } });
  return db.payment.create({
    data: {
      orderId,
      amount,
      method: "sepay",
      paidDate: NOW,
      note: `Tiền về qua SEPAY ${providerTxnId} [auto:sepay:${providerTxnId}]`,
      saleStatus: "RECORDED",
      accountantStatus: "PENDING",
      centerId: CS1,
    },
  });
}

/** Giao các sự kiện `payment.confirmed` CHƯA giao của đơn cho handler đã đăng ký, với NGUYÊN payload trong DB. */
const daGiao = new Set<string>();
async function giaoSuKien(orderId: string): Promise<number> {
  const evs = await db.domainEvent.findMany({
    where: { type: "payment.confirmed", payloadJson: { path: ["orderId"], equals: orderId } },
    orderBy: { createdAt: "asc" },
  });
  let n = 0;
  for (const ev of evs) {
    if (daGiao.has(ev.id)) continue;
    daGiao.add(ev.id);
    const hs = getHandlers(ev.type);
    expect(hs, "chỉ handler quyền học được đăng ký ở bộ này").toHaveLength(1);
    await hs[0]!({ id: ev.id, type: ev.type, payload: (ev.payloadJson ?? {}) as Record<string, unknown> });
    n++;
  }
  return n;
}

const quyenCua = (orderId: string) => db.studyEntitlement.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
const choCua = (orderId: string) => db.studyEntitlementXuLy.findMany({ where: { orderId, loai: "CHO_CHUYEN_DOI" }, orderBy: { createdAt: "asc" } });

/** Mọi thứ của đơn mà ba đường sửa đơn CÓ THỂ làm đổi. Bằng nhau trước/sau ⇒ không phép ghi nào xảy ra. */
async function anhChup(orderId: string) {
  const [don, dong, phieu, dot, pay, audit] = await Promise.all([
    db.order.findUniqueOrThrow({ where: { id: orderId }, select: { subtotal: true, discountAmount: true, totalAmount: true, status: true, updatedAt: true } }),
    db.orderItem.findMany({ where: { orderId }, orderBy: { id: "asc" }, select: { id: true, metadata: true, unitPrice: true, totalPrice: true, discountAmount: true, status: true, enrollmentId: true } }),
    db.paymentRequest.findMany({ where: { orderId }, orderBy: [{ installmentNo: "asc" }, { id: "asc" }], select: { id: true, installmentNo: true, amountDue: true, status: true, orderItemId: true } }),
    db.orderInstallment.count({ where: { orderId } }),
    db.payment.count({ where: { orderId } }),
    db.auditLog.count({ where: { entityType: "Order", entityId: orderId } }),
  ]);
  return JSON.stringify({ don, dong, phieu, dot, pay, audit });
}

test.describe("[R7-PV] Thu học phí theo phạm vi học — tạo đơn → tiền → quyền học → hàng chờ", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    OU1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    KT = (await seedUser({ email: "ketoan-pv@test.local", role: "ACCOUNTANT" })).id;
    SALE = (await seedUser({ email: "sale-pv@test.local", role: "SALES_CSM" })).id;
    KHOA = (await db.course.create({ data: { name: "Sata 3 (R7 PV)", slug: "r7pv-sata3", price: GIA48, totalSessions: 48 } })).id;
    HV = (await db.student.create({ data: { name: "Bé A (R7 PV)", centerId: CS1, status: "ACTIVE" } })).id;
    // Học viên ĐÃ có một ghi danh (học viên cũ mua thêm buổi) — chỗ để khoản tiền mặt bám vào cho qua cổng "khoản chưa gắn ghi danh".
    const lop = await db.class.create({ data: { name: "Lớp cũ (R7 PV)", courseId: KHOA, centerId: CS1, status: "ACTIVE", maxStudents: 12 } });
    GD = (await db.enrollment.create({ data: { studentId: HV, classId: lop.id, courseId: KHOA, centerId: CS1, status: "STUDYING" } })).id;
    clearSettingsCache();
    daGiao.clear();
    clearHandlers();
    registerCapQuyenHocHandlers();
  });

  test("[R7-PV-01] cờ BẬT: tạo đơn ⇒ dấu SCOPE + không kế hoạch đợt; kế toán xác nhận đủ tiền ⇒ sự kiện ⇒ ĐÚNG MỘT quyền học 48 buổi (chưa tiêu thụ)", async () => {
    await datCo(true);
    const d = await taoDon();
    expect(d.kieu).toBe("SCOPE");
    expect(docPhamViDong(d.metadata)?.thanhTien, "thành tiền planner").toBe(TIEN);
    expect(laDonPhamVi([{ metadata: d.metadata }])).toBe(true);
    expect(await db.orderInstallment.count({ where: { orderId: d.orderId } }), "đơn SCOPE không có kế hoạch đợt").toBe(0);
    const phieu = await db.paymentRequest.findMany({ where: { orderId: d.orderId } });
    expect(phieu.map((p) => [p.installmentNo, p.amountDue])).toEqual([[0, TIEN]]);

    const t = await thuVaXacNhan(d.orderId, TIEN);
    expect(t.xacNhan.ok, JSON.stringify(t.xacNhan)).toBe(true);
    // Mốc 1 — sự kiện đã nằm trong outbox, CHƯA ai giao: chưa có quyền học.
    expect(await quyenCua(d.orderId)).toHaveLength(0);
    // Mốc 2 — giao sự kiện thật cho handler thật.
    expect(await giaoSuKien(d.orderId)).toBe(1);
    const [q, ...conLai] = await quyenCua(d.orderId);
    expect(conLai, "đúng MỘT quyền học").toHaveLength(0);
    expect(q).toMatchObject({ studentId: HV, courseId: KHOA, orderItemId: d.itemId, status: "AWAITING_PLACEMENT", netAmount: TIEN, purchaseSessions: 48, consumedSessions: 0 });
    // Giao lại / hích lại không cấp đôi.
    await giaoSuKien(d.orderId);
    expect(await quyenCua(d.orderId)).toHaveLength(1);
  });

  test("[R7-PV-02] cờ TẮT: cùng đầu vào ⇒ LEGACY (không dấu); tiền vẫn xác nhận, KHÔNG quyền học / dòng chờ — đối chứng của [PV-01]", async () => {
    await datCo(false);
    const d = await taoDon();
    expect(d.kieu).toBe("LEGACY");
    expect(docPhamViDong(d.metadata)).toBeNull();
    expect(laDonPhamVi([{ metadata: d.metadata }])).toBe(false);
    const t = await thuVaXacNhan(d.orderId, TIEN);
    expect(t.xacNhan.ok, JSON.stringify(t.xacNhan)).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: t.paymentId } })).accountantStatus, "tiền ĐÃ vào sổ").toBe(DA_XAC_NHAN);
    await giaoSuKien(d.orderId);
    expect(await quyenCua(d.orderId)).toHaveLength(0);
    expect(await choCua(d.orderId)).toHaveLength(0);
    expect(await db.studyEntitlement.count()).toBe(0);
  });

  test("[R7-PV-03] đơn SCOPE: kế hoạch nhiều đợt · thêm con · đổi khoá đều bị TỪ CHỐI đúng câu, KHÔNG phép ghi nào; ĐỐI CHỨNG đơn thường vẫn lưu được kế hoạch", async () => {
    await datCo(true);
    const d = await taoDon();
    expect(d.kieu).toBe("SCOPE");
    const truoc = await anhChup(d.orderId);

    const han = new Date("2026-11-20T00:00:00+07:00");
    const ke = await recordInstallmentPlan({
      orderId: d.orderId,
      dots: [
        { amount: TIEN / 2, daThu: false, dueDate: han },
        { amount: TIEN / 2, daThu: false, dueDate: han },
      ],
      actorId: KT,
    });
    expect(ke).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_KE_HOACH_DOT });

    const them = await themConVaoDon({
      orderId: d.orderId,
      conMoi: { itemName: "Bé B", courseId: KHOA, quantity: 1, unitPrice: GIA48 },
      chinhSach: CHINH_SACH_MAC_DINH,
      tranPhanTram: 50,
      lyDo: "Em thứ hai vào học",
      actor: { id: KT, name: "Kế toán" },
    });
    expect(them).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_THEM_CON });

    const doi = await doiKhoaChoCon({
      orderId: d.orderId,
      orderItemId: d.itemId,
      targetClassId: "r7pv-lop-dich-khong-ton-tai",
      buoiCuoiId: null,
      unitPriceMoi: GIA48,
      tranPhanTram: 50,
      lyDo: "Đổi khoá",
      actor: { id: KT, name: "Kế toán" },
      now: NOW,
    });
    expect(doi).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA });
    expect(await anhChup(d.orderId), "không bảng nào đổi").toBe(truoc);

    // Cờ TẮT sau khi tạo đơn: dấu đọc từ DB ⇒ vẫn bị chặn.
    await datCo(null);
    expect(await recordInstallmentPlan({ orderId: d.orderId, dots: [{ amount: TIEN, daThu: false, dueDate: han }], actorId: KT })).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_KE_HOACH_DOT });
    expect(await anhChup(d.orderId)).toBe(truoc);

    // ĐỐI CHỨNG DƯƠNG — đơn thường (cờ TẮT): lưu kế hoạch 2 đợt chạy bình thường ⇒ các lời từ chối trên đến từ cổng phạm vi chứ không từ nơi khác.
    const thuong = await taoDon();
    expect(thuong.kieu).toBe("LEGACY");
    const ok = await recordInstallmentPlan({
      orderId: thuong.orderId,
      dots: [
        { amount: TIEN / 2, daThu: false, dueDate: han },
        { amount: TIEN / 2, daThu: false, dueDate: han },
      ],
      actorId: KT,
    });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(await db.orderInstallment.count({ where: { orderId: thuong.orderId } })).toBe(2);
  });

  test("[R7-PV-04] tiền THIẾU rồi ĐỦ: xác nhận thiếu 1.000đ ⇒ chưa quyền học; xác nhận nốt 1.000đ ⇒ có đúng MỘT", async () => {
    await datCo(true);
    const d = await taoDon();
    expect((await thuVaXacNhan(d.orderId, TIEN - 1_000)).xacNhan.ok).toBe(true);
    expect(await giaoSuKien(d.orderId)).toBe(1);
    expect(await quyenCua(d.orderId), "thiếu 1.000đ").toHaveLength(0);
    expect(await choCua(d.orderId), "đã biết học viên mà chưa đủ tiền ⇒ không dòng chờ").toHaveLength(0);

    expect((await thuVaXacNhan(d.orderId, 1_000)).xacNhan.ok).toBe(true);
    expect(await giaoSuKien(d.orderId)).toBe(1);
    const q = await quyenCua(d.orderId);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ orderItemId: d.itemId, netAmount: TIEN, purchaseSessions: 48 });
  });

  test("[R7-PV-05] HÀNG CHỜ: khách mới (chưa có học viên) đủ tiền NGÂN HÀNG ⇒ KHÔNG quyền học, đúng MỘT dòng CHO_CHUYEN_DOI (OPEN); hích lại không đẻ thêm dòng", async () => {
    await datCo(true);
    const lead = await db.lead.create({ data: { parentName: "PH khách mới (R7 PV)", phone: "0399000444", centerId: CS1 }, select: { id: true } });
    const con = await db.leadChild.create({ data: { leadId: lead.id, fullName: "Bé mới (R7 PV)" }, select: { id: true } });
    const d = await taoDon({ studentId: null, leadChildId: con.id });
    expect(d.kieu).toBe("SCOPE");
    await db.order.update({ where: { id: d.orderId }, data: { leadId: lead.id } });

    await thuNganHang(d.orderId, TIEN, "05");
    await hichCapQuyenHocChoDon(d.orderId, "WEBHOOK_CU", NOW);
    expect(await quyenCua(d.orderId), "chưa có Student ⇒ không quyền học").toHaveLength(0);
    const [cho, ...thua] = await choCua(d.orderId);
    expect(thua).toHaveLength(0);
    expect(cho).toMatchObject({ trangThai: "OPEN", orderId: d.orderId, orderItemId: d.itemId, courseId: KHOA, leadChildId: con.id, studentId: null, entitlementId: null });

    // Hích lần nữa (nguồn khác) không đẻ dòng chờ thứ hai và không chạm `updatedAt` (idempotent).
    await hichCapQuyenHocChoDon(d.orderId, "GAN_TAY", new Date("2026-10-19T05:00:00Z"));
    const [sau, ...thua2] = await choCua(d.orderId);
    expect(thua2).toHaveLength(0);
    expect(sau!.updatedAt.toISOString()).toBe(cho!.updatedAt.toISOString());
  });

  test("[R7-PV-06] CỜ TẮT SAU KHI TẠO ĐƠN: tiền vẫn xác nhận nhưng KHÔNG cấp quyền học (đơn đã là SCOPE — dấu đọc từ DB); bật lại cờ + hích ⇒ cấp bù đúng MỘT", async () => {
    await datCo(true);
    const d = await taoDon();
    expect(d.kieu).toBe("SCOPE");
    await datCo(false);
    const t = await thuVaXacNhan(d.orderId, TIEN);
    expect(t.xacNhan.ok, JSON.stringify(t.xacNhan)).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: t.paymentId } })).accountantStatus, "tiền ĐÃ vào sổ").toBe(DA_XAC_NHAN);
    expect(await giaoSuKien(d.orderId)).toBe(1);
    expect(await quyenCua(d.orderId), "cờ tắt ⇒ không cấp").toHaveLength(0);
    expect(await choCua(d.orderId)).toHaveLength(0);

    await datCo(true);
    await hichCapQuyenHocChoDon(d.orderId, "HANG_DOI_THU_LAI", new Date("2026-10-19T05:00:00Z"));
    expect(await quyenCua(d.orderId), "cấp bù khi cờ bật lại").toHaveLength(1);
    await hichCapQuyenHocChoDon(d.orderId, "HANG_DOI_THU_LAI", new Date("2026-10-19T06:00:00Z"));
    expect(await quyenCua(d.orderId), "hích lại không cấp đôi").toHaveLength(1);
  });

  test("[R7-PV-07] SỐ BUỔI ĐÃ MUA ≠ SỐ BUỔI CỦA KHOÁ: mua 12 buổi của khoá 48 buổi (giá do máy chủ tính) ⇒ quyền học 12 buổi, loại MILESTONE — không phải 48", async () => {
    await datCo(true);
    const d = await taoDon({ soBuoi: 12 });
    expect(d.kieu).toBe("SCOPE");
    expect(d.gia, "giá 12 buổi khác giá 48 buổi").toBeLessThan(TIEN);
    expect(docPhamViDong(d.metadata)).toMatchObject({ soBuoiMua: 12, loaiMua: "MILESTONE", thanhTien: d.gia });
    const t = await thuVaXacNhan(d.orderId, d.gia);
    expect(t.xacNhan.ok, JSON.stringify(t.xacNhan)).toBe(true);
    expect(await giaoSuKien(d.orderId)).toBe(1);
    const [q, ...conLai] = await quyenCua(d.orderId);
    expect(conLai).toHaveLength(0);
    expect(q).toMatchObject({ studentId: HV, courseId: KHOA, orderItemId: d.itemId, netAmount: d.gia, purchaseSessions: 12, purchaseKind: "MILESTONE", consumedSessions: 0 });
    expect((await db.course.findUniqueOrThrow({ where: { id: KHOA }, select: { totalSessions: true } })).totalSessions, "khoá vẫn 48 buổi").toBe(48);
  });
});
