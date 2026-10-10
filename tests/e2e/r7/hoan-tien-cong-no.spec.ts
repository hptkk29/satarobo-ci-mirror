/**
 * HT — HOÀN TIỀN PHẢI ĐI VÀO CÔNG NỢ VÀ CỔNG PHỤ HUYNH.
 *
 * 🔴 DỰNG LẠI 17/09/2026 theo mô hình DELTA (NỢ-2 trong `docs/hop-nhat-main-test-1609.md`).
 *
 * Bản gốc (27/08/2026, 8 ca) bị XOÁ trong lượt hợp nhất `main` → `test` ngày 16/09 vì nó
 * viết theo mô hình cũ `accountantStatus in [… ADJUSTED]`, không biên dịch được sau
 * `20260907090000_payment_type_tach_khoi_status`. Bộ được coi là thay thế
 * (`tests/finance/dieu-chinh.test.ts`) nhắc `refund`/`hoàn tiền`/`REFUNDED` ĐÚNG 0 LẦN —
 * nó phủ cơ chế delta ở TẦNG SỔ, không chạm đường hoàn tiền và không chạm màn phụ huynh.
 *
 * ── HAI MÔ HÌNH, ĐỪNG LẪN ────────────────────────────────────────────────────────────
 *   · ĐIỀU CHỈNH — `adjustPayment({ correctAmount })` sinh dòng `paymentType=ADJUSTMENT`
 *     mang **DELTA**, trạng thái `CONFIRMED`. Dòng GỐC **giữ nguyên số** và **vẫn được
 *     cộng**. Tổng = gốc + Σ delta. (Cũ: dòng mới mang SỐ ĐÚNG, trạng thái `ADJUSTED`,
 *     dòng gốc bị LOẠI — dịch thẳng assertion cũ sang đây là encode sai cơ chế.)
 *   · HOÀN TIỀN — `refundPayment()` sinh dòng số ÂM, trạng thái `REFUNDED`,
 *     `adjustmentOfId` trỏ về gốc. Cơ chế này KHÔNG đổi ở lượt 07/09.
 *
 * ── 🔴 LỖI BỘ NÀY ĐO RA, VÀ ĐÃ VÁ (17/09/2026 — NỢ-4) ────────────────────────────────
 * Khi dựng lại, bộ này đo ra: cổng PH + công nợ đọc `KHOAN_DA_XAC_NHAN` (CHỈ `CONFIRMED`)
 * nên dòng hoàn `REFUNDED` VÔ HÌNH, trong khi doanh thu (`WHERE_THUC_THU`) thì thấy —
 * hoàn 2tr trên phiếu 5tr cho ra doanh thu 3tr (đúng) và cổng PH 5tr (sai). Hồi quy do
 * lượt hợp nhất 16/09: bản `test` trước merge đọc `WHERE_THUC_THU` ngay trong
 * `lib/portal/billing.ts` (`9202d782`), bản `main` thắng khối xung đột.
 *
 * VÁ theo hướng TÁCH HAI BỘ LỌC, không nhồi thêm trạng thái vào một bộ lọc:
 *   · câu A "PH đã đóng bao nhiêu"    → `KHOAN_DA_DONG` (ròng, trừ dòng hoàn);
 *   · câu B "ghi danh còn nợ bao nhiêu" → `computeEnrollmentDebt(.., .., status)`, có
 *     ngoại lệ: ghi danh ĐÃ RỜI LỚP thì KHÔNG trừ bút toán hoàn.
 *
 * ⚠️ Vì sao cần ngoại lệ ấy — và vì sao bản vá một dòng là SAI: nhồi `REFUNDED` vào một
 * bộ lọc chung trả lời đúng câu A nhưng làm câu B đẻ NỢ MA (em nghỉ-học-hoàn-đủ bỗng
 * "nợ" đúng số vừa được hoàn). Đo được bằng phép cấy I2 ngày 17/09 — ca `[HT-E1b]` sinh
 * ra để canh đúng điều đó, và nó ĐỎ dưới bản vá ngây thơ.
 *
 * ── VÌ SAO BỘ NÀY PHẢI CHẠM POSTGRES THẬT ────────────────────────────────────────────
 * Thứ nó phủ là những điều hàm thuần không trả lời được: bút toán do CHÍNH
 * `refundPayment()`/`adjustPayment()` sinh ra có khớp thứ mà năm đường đọc mong đợi
 * không; và màn ĐANG ĐÚNG (doanh thu thực thu) có bị lệch đi không.
 *
 * Postgres LOCAL (`.env.test`). Service-level — gọi thẳng hàm, không dựng trình duyệt.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser, seedOrg, seedRoles } from "../_helpers/seed";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { getParentBilling } from "../../../lib/portal/billing";
import { getStudentBilling } from "../../../lib/portal/billing-student";
import { getParentDashboard } from "../../../lib/portal/dashboard";
import { getDebtRows } from "../../../lib/finance/debt";
import { createRefundRequest } from "../../../lib/finance/refund";
import { approveRefund } from "../../../lib/finance/refund";
import { refundPayment, adjustPayment } from "../../../lib/finance/payment";
import { WHERE_THUC_THU } from "../../../lib/finance/thuc-thu";
import { scopedDb } from "../../../lib/db-scope";
import type { EnrollmentStatus } from "@prisma/client";

const HOC_PHI = 9_000_000;
const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

/** Center id thật (OrgUnit "CS1" trỏ tới) — gán ở beforeEach. */
let CENTER = "";

/**
 * scopedDb của một SUPER_ADMIN neo tại HO — thấy mọi cơ sở. Dựng qua ĐÚNG đường RBAC
 * thật (`assignUserOrgRole` + `resolveActorUncached`); actor tự chế bằng object literal
 * sẽ thiếu trường và `db-scope` ném giữa chừng.
 */
async function sdbHoiSo(): Promise<Parameters<typeof getDebtRows>[0]> {
  const u = await seedUser({ email: "sa-ht@test.local", role: "SUPER_ADMIN" });
  const roleId = (await db.roleDef.findUnique({
    where: { code: "SUPER_ADMIN" },
    select: { id: true },
  }))!.id;
  const ho = (await db.orgUnit.findUnique({ where: { code: "HO" }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: ho, roleId, reason: "seed" });
  const actor = await resolveActorUncached(u.id);
  return scopedDb(actor) as unknown as Parameters<typeof getDebtRows>[0];
}

async function seedCenter(): Promise<void> {
  await db.center.create({
    data: { code: "CS1", name: "CS1", slug: "cs1-ht", address: "test", city: "" },
  });
  await seedOrg(["HO", "CS1"]);
  await seedRoles();
  CENTER = (await db.orgUnit.findUnique({
    where: { code: "CS1" },
    select: { centerId: true },
  }))!.centerId!;
}

type Nen = {
  parentUserId: string;
  studentId: string;
  enrollmentId: string;
  classId: string;
  orderId: string;
};

let seq = 0;

/** Dựng PH + con + lớp + ghi danh đã chốt giá + 1 đơn hàng để treo bút toán. */
async function seedNen(slug: string, opts: { soBuoi?: number; daHoc?: number } = {}): Promise<Nen> {
  seq += 1;
  const parent = await seedUser({ email: `${slug}@test.local`, role: "PARENT" });
  const course = await db.course.create({
    data: { name: `Khoá ${slug}`, slug: `${slug}-${seq}` },
    select: { id: true },
  });
  const cls = await db.class.create({
    data: { name: `Lớp ${slug}`, courseId: course.id, centerId: CENTER, status: "ACTIVE" },
    select: { id: true },
  });
  const student = await db.student.create({
    data: { name: `HV ${slug}`, centerId: CENTER, parentUserId: parent.id },
    select: { id: true },
  });
  const enr = await db.enrollment.create({
    data: {
      studentId: student.id,
      classId: cls.id,
      courseId: course.id,
      status: "STUDYING",
      finalPrice: HOC_PHI,
      centerId: CENTER,
    },
    select: { id: true },
  });
  const order = await db.order.create({
    data: {
      code: `ORD-HT-${seq}`,
      type: "COURSE",
      customerName: `PH ${slug}`,
      customerPhone: "0900000000",
      centerId: CENTER,
      studentId: student.id,
    },
    select: { id: true },
  });

  // Buổi học (cho computeRefund): tổng + đã học.
  const soBuoi = opts.soBuoi ?? 0;
  const daHoc = opts.daHoc ?? 0;
  for (let i = 0; i < soBuoi; i++) {
    await db.classSession.create({
      data: {
        classId: cls.id,
        date: new Date(Date.UTC(2026, 5, i + 1)),
        status: i < daHoc ? "COMPLETED" : "SCHEDULED",
        centerId: CENTER,
      },
    });
  }

  return {
    parentUserId: parent.id,
    studentId: student.id,
    enrollmentId: enr.id,
    classId: cls.id,
    orderId: order.id,
  };
}

/** Ghi 1 phiếu thu đã được kế toán xác nhận (`paymentType` mặc định = PAYMENT). */
async function thu(nen: Nen, amount: number): Promise<string> {
  seq += 1;
  const p = await db.payment.create({
    data: {
      orderId: nen.orderId,
      enrollmentId: nen.enrollmentId,
      amount,
      method: "CASH",
      paidDate: new Date("2026-06-01T00:00:00.000Z"),
      accountantStatus: "CONFIRMED",
      confirmedAt: new Date("2026-06-01T00:00:00.000Z"),
      centerId: CENTER,
    },
    select: { id: true },
  });
  await db.receipt.create({
    data: { code: `RCP-HT-${seq}`, enrollmentId: nen.enrollmentId, paymentId: p.id, status: "ACTIVE" },
  });
  return p.id;
}

async function doiTrangThaiGhiDanh(id: string, status: EnrollmentStatus): Promise<void> {
  await db.enrollment.update({ where: { id }, data: { status } });
}

/** Kế toán dùng để đứng tên bút toán hoàn / điều chỉnh. */
async function seedKeToan(slug: string): Promise<string> {
  const u = await seedUser({ email: `ketoan-${slug}@test.local`, role: "ACCOUNTANT", centerId: CENTER });
  return u.id;
}

/** Σ tiền PH nhìn thấy là "đã đóng", đọc qua ĐÚNG đường cổng phụ huynh. */
async function paidCuaPH(parentUserId: string): Promise<number> {
  return (await getParentBilling(parentUserId)).totals.paid;
}

/** Thu 5tr rồi điều chỉnh xuống 3tr. Trả id phiếu gốc + kế toán. */
async function thuRoiDieuChinh(slug: string): Promise<{ nen: Nen; goc: string; acc: string }> {
  const nen = await seedNen(slug);
  const acc = await seedKeToan(slug);
  const goc = await thu(nen, 5_000_000);
  const adj = await adjustPayment({
    paymentId: goc,
    actorId: acc,
    reason: "ghi nhầm số tiền",
    correctAmount: 3_000_000,
  });
  expect(adj.ok, adj.ok ? "" : `adjustPayment hỏng: ${JSON.stringify(adj)}`).toBe(true);
  if (adj.ok) expect(adj.delta, "delta phải là HIỆU, không phải số đúng").toBe(-2_000_000);
  return { nen, goc, acc };
}

test.describe("HT — hoàn tiền vào công nợ & cổng phụ huynh", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedCenter();
  });

  // ───────────────────────────────────────────────────────────────────────────────────
  // ƯU TIÊN 1 — ĐIỀU CHỈNH và GIAO ĐIỂM của nó với hoàn tiền. Đây là chỗ lượt hợp nhất
  // 16/09 vừa thay cơ chế, và là phần duy nhất phủ giao điểm ấy.
  // ───────────────────────────────────────────────────────────────────────────────────

  test("[HT-E4] ĐIỀU CHỈNH ở cổng PH — gốc GIỮ NGUYÊN, dòng delta hiện ra và được cộng", async () => {
    const { nen, goc } = await thuRoiDieuChinh("e4");

    // Bất biến của mô hình delta: dòng gốc KHÔNG bị đụng tới.
    const gocSau = await db.payment.findUnique({ where: { id: goc }, select: { amount: true } });
    expect(gocSau?.amount, "dòng gốc phải giữ nguyên số").toBe(5_000_000);

    const billing = await getParentBilling(nen.parentUserId);
    expect(billing.totals.paid, "5tr + (−2tr) = 3tr").toBe(3_000_000);
    expect(billing.receipts.reduce((s, r) => s + r.amount, 0)).toBe(3_000_000);

    // ⚠️ ĐẢO SO VỚI BẢN CŨ, có chủ đích: mô hình cũ LOẠI dòng gốc khỏi danh sách PH
    // ("bản đã bị thay thế không được xuất hiện"). Mô hình delta thì GIỮ nó — sổ phải
    // đọc được là "đã thu 5tr, rồi sửa −2tr", chứ không phải "đã thu 3tr" từ trên trời.
    // Mất dòng gốc là mất dấu vết kiểm toán.
    const dongGoc = billing.receipts.find((r) => r.id === goc);
    expect(dongGoc, "dòng gốc PHẢI còn trong danh sách của PH").toBeTruthy();
    expect(dongGoc?.amount, "và giữ nguyên số của nó").toBe(5_000_000);
    expect(dongGoc?.daBiDieuChinh, "phải gắn nhãn đã bị điều chỉnh").toBe(true);

    const dongDelta = billing.receipts.find((r) => r.paymentType === "ADJUSTMENT");
    expect(dongDelta?.amount, "dòng điều chỉnh mang DELTA âm").toBe(-2_000_000);
    expect(dongDelta?.adjustmentOfId, "và trỏ về phiếu thu gốc").toBe(goc);
    expect(dongDelta?.lyDoDieuChinh, "lý do phải in được cho PH đọc").toBe("ghi nhầm số tiền");

    // Công nợ đọc cùng một con số — hai đường lệch nhau là một trong hai đang sai.
    const rows = await getDebtRows(await sdbHoiSo());
    expect(rows.find((r) => r.enrollmentId === nen.enrollmentId)?.debt).toBe(HOC_PHI - 3_000_000);
  });

  test("[HT-E4b] GIAO ĐIỂM hoàn tiền × điều chỉnh — delta VÀ dòng hoàn cùng phải được trừ", async () => {
    const { nen, goc, acc } = await thuRoiDieuChinh("e4b");

    // Hoàn luôn trỏ vào PHIẾU THU gốc — dòng ADJUSTMENT là một hiệu số, không phải một
    // khoản tiền để mà trả lại.
    const ref = await refundPayment({
      paymentId: goc,
      confirmedById: acc,
      reason: "hoàn một phần",
      amount: 1_000_000,
    });
    expect(ref.ok, ref.ok ? "" : `refundPayment hỏng: ${JSON.stringify(ref)}`).toBe(true);

    // 5.000.000 − 2.000.000 (delta) − 1.000.000 (hoàn) = 2.000.000.
    const billing = await getParentBilling(nen.parentUserId);
    expect(billing.totals.paid, "PH phải thấy 2tr: gốc trừ delta trừ hoàn").toBe(2_000_000);
    expect(billing.receipts.reduce((s, r) => s + r.amount, 0)).toBe(2_000_000);

    const rows = await getDebtRows(await sdbHoiSo());
    expect(rows.find((r) => r.enrollmentId === nen.enrollmentId)?.debt).toBe(HOC_PHI - 2_000_000);
  });

  test("[HT-E1] hoàn TOÀN BỘ — PH thấy đã thu về 0, biên lai có dòng hoàn", async () => {
    const nen = await seedNen("e1");
    const acc = await seedKeToan("e1");
    const goc = await thu(nen, 5_000_000);

    const res = await refundPayment({ paymentId: goc, confirmedById: acc, reason: "PH xin rút" });
    expect(res.ok).toBe(true);
    // Học viên nghỉ hẳn — đúng bối cảnh sinh ra bút toán hoàn.
    await doiTrangThaiGhiDanh(nen.enrollmentId, "WITHDREW");

    const billing = await getParentBilling(nen.parentUserId);
    expect(billing.totals.paid, "đã trả lại hết thì PH không còn 'đã đóng' đồng nào").toBe(0);
    expect(billing.totals.tuition).toBe(HOC_PHI);

    // Danh sách biên lai phải KHỚP với tổng — nếu không PH gọi lên hỏi ngay.
    expect(billing.receipts.reduce((s, r) => s + r.amount, 0)).toBe(billing.totals.paid);
    // Dòng hoàn phải HIỆN RA, mang số âm: PH cần đọc được "đã nhận lại 5tr".
    expect(billing.receipts.some((r) => r.amount === -5_000_000)).toBe(true);
  });

  test("[HT-E1b] hoàn TOÀN BỘ cho em ĐÃ NGHỈ — công nợ KHÔNG đẻ nợ ma", async () => {
    // Vế này KHÔNG ghim: nó đang đúng, và phải giữ đúng cả sau khi vá ghim ở trên.
    // Vá kiểu "cộng dòng REFUNDED vào mọi phép trừ" mà không nghĩ sẽ đẩy công nợ của em
    // đã nghỉ lên NGUYÊN học phí — một khoản nợ không ai còn nợ. Ca này canh điều đó.
    const nen = await seedNen("e1b");
    const acc = await seedKeToan("e1b");
    const goc = await thu(nen, 5_000_000);
    await refundPayment({ paymentId: goc, confirmedById: acc, reason: "PH xin rút" });
    await doiTrangThaiGhiDanh(nen.enrollmentId, "WITHDREW");

    const billing = await getParentBilling(nen.parentUserId);
    expect(
      billing.enrollments[0]?.outstanding,
      "em đã nghỉ: công nợ không được nhảy lên nguyên học phí",
    ).toBe(HOC_PHI - 5_000_000);

    const rows = await getDebtRows(await sdbHoiSo());
    expect(rows.find((r) => r.enrollmentId === nen.enrollmentId)?.debt).toBe(HOC_PHI - 5_000_000);
  });

  test("[HT-E2] hoàn MỘT PHẦN — trừ đúng phần đã trả lại trên cả 3 màn PH", async () => {
    const nen = await seedNen("e2");
    const acc = await seedKeToan("e2");
    const goc = await thu(nen, 5_000_000);
    await refundPayment({ paymentId: goc, confirmedById: acc, reason: "thu nhầm", amount: 2_000_000 });

    // Ba màn PH phải nói CÙNG một con số. Ba đường đọc khác nhau, nên đây không phải
    // phép lặp: lệch nhau là một trong ba đang dùng bộ lọc khác.
    expect(await paidCuaPH(nen.parentUserId), "màn Học phí").toBe(3_000_000);

    const perChild = await getStudentBilling(nen.studentId);
    expect(perChild.paid, "màn theo từng con").toBe(3_000_000);
    expect(perChild.outstanding).toBe(HOC_PHI - 3_000_000);

    const dash = await getParentDashboard(nen.parentUserId);
    expect(dash.totalDebt, "màn tổng quan").toBe(HOC_PHI - 3_000_000);

    // Ghi danh CÒN HỌC → công nợ tăng lại đúng phần đã trả cho PH.
    const rows = await getDebtRows(await sdbHoiSo());
    expect(rows.find((r) => r.enrollmentId === nen.enrollmentId)?.debt).toBe(HOC_PHI - 3_000_000);
  });

  // ───────────────────────────────────────────────────────────────────────────────────
  // E3 / E3b / E5c — ĐƯỜNG TIỀN RA. Dựng lại 18/09/2026 sau khi `main` (67c7a7fe) GỠ CẦU
  // DAO `REFUND_REQUEST_DISABLED`; ca `[HT-E3b]` cũ là DÂY BẪY đặt sẵn cho đúng ngày này.
  //
  // Cổng nay KHÔNG còn là cầu dao tắt cả tính năng mà là lưới hẹp `canhBaoSoBuoi`: lớp
  // còn buổi ĐÃ QUA NGÀY mà chưa chốt thì TỪ CHỐI đề xuất (hướng an toàn), vì
  // `sessionsLearned` đếm `status = COMPLETED` và trên prod cột đó không phản ánh thực
  // tế đã dạy (2 COMPLETED / 287 SCHEDULED, đo 07/09).
  //
  // ⚠️ LUẬT 19 — mọi ca dưới đây TRUYỀN `now`, không đọc đồng hồ thật. Buổi học seed vào
  // tháng 6/2026; để đồng hồ thật chạy thì 16 buổi SCHEDULED quá hạn làm lưới từ chối
  // mọi đề xuất, và ca sẽ "xanh" hay "đỏ" tuỳ tờ lịch chứ không tuỳ mã.
  // ───────────────────────────────────────────────────────────────────────────────────

  /** Mốc đo: 09/06/2026 — 8 buổi đầu đã qua ngày và ĐỀU đã chốt ⇒ không còn buổi treo. */
  const MOC = new Date("2026-06-09T00:00:00.000Z");

  test("[HT-E3] đề xuất LẦN HAI không phồng trên số GỘP — đường tiền ra", async () => {
    // Đây là ca ĐẮT NHẤT của tệp: sai ở đây là chi ra 12tr trên 9tr đã thu.
    const nen = await seedNen("e3", { soBuoi: 24, daHoc: 8 });
    const acc = await seedKeToan("e3");
    const goc = await thu(nen, HOC_PHI);

    // Lượt 1: đã học 8/24 ⇒ dùng hết 8 × 375.000 = 3.000.000 ⇒ đề xuất hoàn 6.000.000.
    const lan1 = await createRefundRequest({
      enrollmentId: nen.enrollmentId,
      trigger: "WITHDRAW",
      reason: "nghỉ học",
      now: MOC,
    });
    expect(lan1, "lưới buổi chưa chốt phải CHO QUA ở mốc này").not.toBeNull();
    expect(lan1!.paidConfirmed).toBe(HOC_PHI);
    expect(lan1!.proposedAmount, "9tr đã thu − 3tr đã dùng").toBe(6_000_000);

    // Kế toán chi thật: bút toán hoàn 6tr.
    await refundPayment({
      paymentId: goc,
      confirmedById: acc,
      reason: "hoàn theo yêu cầu",
      amount: 6_000_000,
    });

    // Lượt 2 (trigger KHÁC nên không rơi vào nhánh idempotent): phải đọc số RÒNG.
    const lan2 = await createRefundRequest({
      enrollmentId: nen.enrollmentId,
      trigger: "MANUAL",
      reason: "rà lại",
      now: MOC,
    });
    expect(lan2, "vẫn còn 3tr nên vẫn sinh được đề xuất").not.toBeNull();
    expect(
      lan2!.paidConfirmed,
      "PH chỉ còn để lại 3tr — đọc 9tr ở đây là đề xuất hoàn lần hai trên số GỘP",
    ).toBe(3_000_000);
    expect(lan2!.proposedAmount, "3tr còn lại ĐÚNG BẰNG phần đã dùng ⇒ không hoàn thêm").toBe(0);
  });

  test("[HT-E3b] ĐÃ DUYỆT nhưng CHƯA chi — đề xuất kế tiếp có trừ phần đang treo không", async () => {
    // Khoảng hở "đã duyệt / chưa chi" là có thật và kéo dài nhiều ngày: quản lý bấm
    // duyệt, kế toán chưa ghi bút toán âm. Trong khoảng đó, `Payment` chưa có dòng hoàn
    // nào nên `paidConfirmed` vẫn đọc số GỘP.
    const nen = await seedNen("e3b", { soBuoi: 24, daHoc: 8 });
    const acc = await seedKeToan("e3b");
    await thu(nen, HOC_PHI);

    const lan1 = await createRefundRequest({
      enrollmentId: nen.enrollmentId,
      trigger: "WITHDRAW",
      reason: "nghỉ học",
      now: MOC,
    });
    expect(lan1).not.toBeNull();
    await approveRefund(lan1!.id, acc, 6_000_000);

    const lan2 = await createRefundRequest({
      enrollmentId: nen.enrollmentId,
      trigger: "MANUAL",
      reason: "rà lại",
      now: MOC,
    });

    // 🔴 GHIM BUG — đặt `test.fail` TRONG THÂN CA (đặt ở cấp file thì nó đánh dấu mọi ca
    // phía sau; đã trả giá cho chuyện đó ở `[PR-02d]`). Vá xong ca này XANH và Playwright
    // báo lỗi, buộc người vá gỡ ghim.
    test.fail(
      true,
      "NỢ-11: `paidConfirmed` chỉ đọc `Payment`, không trừ phần hoàn ĐÃ DUYỆT chưa chi ⇒ " +
        "đề xuất kế tiếp vẫn thấy 9tr và có thể đề xuất hoàn chồng lên phần đang treo.",
    );
    expect(lan2).not.toBeNull();
    expect(
      lan2!.paidConfirmed,
      "6tr đã duyệt đang chờ chi — số còn có thể hoàn chỉ là 3tr",
    ).toBe(3_000_000);
  });

  test("[HT-E5c] CHƯA THU ĐỒNG NÀO ⇒ KHÔNG đẻ yêu cầu hoàn rỗng", async () => {
    // Ca này từng nằm trong `[HT-E5]` nhưng XANH GIẢ: cầu dao trả `null` trước khi hàm
    // kịp chạm tới cổng `paidConfirmed <= 0`. Cầu dao đã gỡ ⇒ nay nó đo đúng thứ nó nói.
    const nen = await seedNen("e5c", { soBuoi: 24, daHoc: 8 });

    const rr = await createRefundRequest({
      enrollmentId: nen.enrollmentId,
      trigger: "WITHDRAW",
      reason: "nghỉ học",
      now: MOC,
    });
    expect(rr, "chưa thu đồng nào thì không có gì để hoàn").toBeNull();
    expect(await db.refundRequest.count(), "không được đẻ dòng rỗng").toBe(0);
  });

  test("[HT-E8] BA TRỤC KHÔNG ĐƯỢC GỘP — `confirmedPaid` giữ GỘP, `debt` mới RÒNG", async () => {
    // 🔴 LỖ PHỦ TEST, tìm thấy 20/09/2026 bằng PHÉP CẤY (không phải bằng đọc diff).
    //
    // Lượt hợp nhất 18/09 để BA TRỤC cùng sống trong `getDebtRows`:
    //   A `daXacNhan` → `confirmedPaid`  — kế toán đã xác nhận (GỘP, KHÔNG trừ hoàn)
    //   B `daGhiNhan` → `recordedPaid`   — sale đã ghi nhận
    //   RÒNG `daDong` → `debt`           — PH thực đóng (ĐÃ trừ hoàn)
    //
    // `debt.ts` có hẳn một khối chú thích cấm "sửa `confirmedPaid` thành ròng cho gọn".
    // Nhưng cấy thử `tongDaXacNhan(daXacNhan)` → `tongDaXacNhan(daDong)` ⇒ **12/12 ca
    // VẪN XANH**. Chú thích không phải bằng chứng — đúng bài học của repo.
    //
    // VÌ SAO PHẢI KHOÁ: màn `/cong-no` đặt `confirmedPaid` (cột "đã xác nhận") cạnh
    // `recordedPaid` (cột "đã ghi nhận") để ra số CHỜ XÁC NHẬN = B − A. Làm A ròng còn
    // B gộp là đẻ **báo động giả "chờ xác nhận âm"** trên MỌI ghi danh từng hoàn tiền —
    // và kế toán sẽ đi tìm một khoản thất lạc không tồn tại.
    const nen = await seedNen("e8");
    const acc = await seedKeToan("e8");
    const goc = await thu(nen, 5_000_000);
    await refundPayment({ paymentId: goc, confirmedById: acc, reason: "thu nhầm", amount: 2_000_000 });

    const rows = await getDebtRows(await sdbHoiSo());
    const dong = rows.find((r) => r.enrollmentId === nen.enrollmentId);
    expect(dong, "không thấy dòng công nợ của ghi danh vừa dựng").toBeTruthy();

    // TRỤC A — GỘP. Đây là vế mà phép cấy đi lọt.
    expect(
      dong!.confirmedPaid,
      "`confirmedPaid` là TRỤC A: kế toán đã xác nhận 5tr, KHÔNG trừ 2tr đã hoàn",
    ).toBe(5_000_000);

    // RÒNG — và nó phải KHÁC trục A, nếu không thì hai trục đã bị gộp làm một.
    expect(
      dong!.debt,
      "`debt` là số RÒNG: PH còn để lại 3tr nên nợ = học phí − 3tr",
    ).toBe(HOC_PHI - 3_000_000);
    expect(
      HOC_PHI - dong!.confirmedPaid,
      "nếu `debt` bằng đúng `học phí − confirmedPaid` thì hai trục đã bị gộp",
    ).not.toBe(dong!.debt);

    // TRỤC B — cột "đã ghi nhận" của bảng đối soát. Phải có SỐ, không được về 0.
    //
    // 🔴 Vế này bịt một lỗ thứ HAI tìm thấy cùng lượt cấy 20/09: đổi
    // `filter(laKhoanDaGhiNhan)` thành `filter(() => false)` ⇒ `recordedPaid` về 0 cho
    // MỌI dòng, và **13/13 ca vẫn xanh**.
    //
    // Đây KHÔNG phải lỗi giả định: `main` đã dính đúng bug này một lần rồi — khi
    // `KHOAN_DA_GHI_NHAN.saleStatus` đổi thành `{ in: [...] }`, phép so chuỗi-với-đối-
    // tượng luôn false và cột "đã ghi nhận" im lặng về 0. Lần ấy vá bằng CHÚ THÍCH,
    // không có lưới — nên lần sau vẫn đi lọt y như vậy.
    //
    // `Payment.saleStatus` mặc định `RECORDED` (schema) nên khoản `thu()` seed ra đã
    // thuộc trục B; không phải dựng thêm gì.
    expect(
      dong!.recordedPaid,
      "cột 'đã ghi nhận' về 0 ⇒ trục B đọc sai — bảng đối soát mất một vế, im lặng",
    ).toBeGreaterThan(0);
  });

  test("[HT-E5] ghi danh CHƯA THU ĐỒNG NÀO — cổng PH và công nợ nói đúng học phí đầy đủ", async () => {
    const nen = await seedNen("e5", { soBuoi: 24, daHoc: 0 });

    const billing = await getParentBilling(nen.parentUserId);
    expect(billing.totals.paid).toBe(0);
    expect(billing.totals.outstanding).toBe(HOC_PHI);
    expect(billing.receipts).toHaveLength(0);

    const rows = await getDebtRows(await sdbHoiSo());
    expect(rows.find((r) => r.enrollmentId === nen.enrollmentId)?.debt).toBe(HOC_PHI);

    // ⚠️ ĐÃ GỠ một khẳng định XANH GIẢ ở đây (17/09/2026). Bản dựng lại đầu tiên có
    // `expect(createRefundRequest(...)).toBeNull()` kèm lời "chưa thu đồng nào thì không
    // đẻ yêu cầu rỗng" — nhưng cầu dao `REFUND_REQUEST_DISABLED` trả `null` TRƯỚC khi hàm
    // kịp chạm tới cổng ấy, nên nó xanh vì một lý do KHÁC hẳn lý do nó được viết ra. Đo
    // để chắc: không phép cấy nào trong năm phép I1–I5 làm ca này đổi trạng thái.
    //
    // Một ca xanh giả tệ hơn không có ca: người sau đọc danh sách sẽ tưởng vùng đó đang
    // được canh. Yêu cầu dựng lại nó nay nằm ở dây bẫy `[HT-E3b]`, cùng chỗ với hai ca
    // chống phồng đề xuất — tất cả đều chỉ đo được khi cầu dao mở.
    //
    // Phần CÒN LẠI của ca này đo thật và đang canh: ghi danh chưa thu đồng nào thì cổng
    // PH và công nợ phải nói đúng điều đó.
  });

  test("[HT-E6] khoản PENDING vẫn KHÔNG hiện tiền cho PH (AC1 không bị đợt vá nới ra)", async () => {
    const nen = await seedNen("e6");
    await thu(nen, 4_000_000);
    await db.payment.create({
      data: {
        orderId: nen.orderId,
        enrollmentId: nen.enrollmentId,
        amount: 6_000_000,
        method: "CASH",
        paidDate: new Date("2026-06-02T00:00:00.000Z"),
        accountantStatus: "PENDING",
        centerId: CENTER,
      },
    });

    // Cổng này đi NGƯỢC hướng với các ca ghim ở trên: chúng đòi NỚI ra cho dòng REFUNDED
    // được trừ, ca này canh không nới nhầm sang khoản CHƯA đối soát. Tiền chưa xác nhận
    // mà hiện cho PH là hứa với họ một thứ kế toán chưa công nhận.
    const billing = await getParentBilling(nen.parentUserId);
    expect(billing.totals.paid).toBe(4_000_000);
    expect(billing.flags.pendingCount).toBe(1);
    expect(billing.receipts.some((r) => r.amount === 6_000_000)).toBe(false);
  });

  test("[HT-E7] MÀN ĐANG ĐÚNG KHÔNG ĐƯỢC ĐỔI SỐ — doanh thu thực thu vẫn trừ dòng hoàn", async () => {
    // Đường doanh thu (`WHERE_THUC_THU`) vốn ĐÃ đúng: nó tính cả `REFUNDED`. Ca này canh
    // nó KHÔNG bị đợt vá cổng PH làm lệch đi. Không ghim — nó đang xanh và phải giữ xanh.
    const nen = await seedNen("e7");
    const acc = await seedKeToan("e7");
    const goc = await thu(nen, 5_000_000);
    await refundPayment({ paymentId: goc, confirmedById: acc, reason: "hoàn", amount: 2_000_000 });

    const doanhThu = await db.payment.aggregate({ where: WHERE_THUC_THU, _sum: { amount: true } });
    expect(doanhThu._sum.amount, "đường doanh thu không được đổi số").toBe(3_000_000);
  });

  test("[HT-E7b] HAI ĐƯỜNG PHẢI GẶP NHAU — cổng PH khớp đúng doanh thu thực thu", async () => {
    const nen = await seedNen("e7b");
    const acc = await seedKeToan("e7b");
    const goc = await thu(nen, 5_000_000);
    await refundPayment({ paymentId: goc, confirmedById: acc, reason: "hoàn", amount: 2_000_000 });

    const doanhThu = await db.payment.aggregate({ where: WHERE_THUC_THU, _sum: { amount: true } });
    expect(await paidCuaPH(nen.parentUserId), "cổng PH phải khớp đường doanh thu").toBe(
      doanhThu._sum.amount,
    );
  });
});
