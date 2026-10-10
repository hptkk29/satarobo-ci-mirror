/**
 * PTTT-THEO-CƠ-SỞ — danh mục phương thức thanh toán nay thuộc cơ sở (30/08/2026).
 * Postgres LOCAL (.env.test). Test service-level: gọi thẳng `scopedDb` + core, không
 * dựng HTTP (runner Playwright stub `@/lib/auth` nên server action không chạy happy-path
 * — cùng lý do đã ghi ở qr-session.spec.ts).
 *
 * Yêu cầu gốc đang được khoá ở đây: "cơ sở nào thì dùng ngân hàng của cơ sở đó để thanh
 * toán và KHÔNG hiển thị phương thức thanh toán của cơ sở khác".
 *
 * Phủ:
 *  [PTTT-01] người cấp cơ sở CS1 KHÔNG đọc được phương thức của CS2 (scopedDb).
 *  [PTTT-02] phương thức DÙNG CHUNG (centerId null) vẫn thấy được — không bị scope nuốt.
 *  [PTTT-03] findUnique theo id phương thức của cơ sở khác → null (không mở bằng đoán id).
 *  [PTTT-04] passesScope chặn ĐƯỜNG GHI lên phương thức của cơ sở khác.
 *  [PTTT-05] Hội sở / SUPER_ADMIN vẫn thấy toàn bộ.
 *  [PTTT-06] mã QR lấy tài khoản THEO PHƯƠNG THỨC của đơn, lùi dần đúng thứ tự.
 *  [PTTT-07] tra mã để CHẶN phải KHÔNG-SCOPE — nếu không, mã cần chặn bị lọc mất và lọt.
 *  [PTTT-08] kiểm trùng mã thấy được mã của cơ sở khác (`code` @unique toàn cục).
 *  [PTTT-09] `payments:* scopeType GLOBAL` KHÔNG biến vai cấp cơ sở thành cross-center.
 *  [PTTT-10] người cấp cơ sở KHÔNG kéo/tắt được phương thức DÙNG CHUNG (đã tái hiện được).
 *  [PTTT-11] `checkPermission(..., {centerId})` KHÔNG cách ly khi quyền seed GLOBAL —
 *            cách ly phải do `passesScope` làm. (Bẫy đã làm lộ TK ngân hàng CS2.)
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached, type Actor } from "../../../lib/auth/actor";
import {
  scopedDb,
  passesScope,
  getModelVisibleCenterIds,
} from "../../../lib/db-scope";
import { resolveOrderPaymentConfig } from "../../../lib/payments/vietqr";
import { can } from "../../../lib/auth/can";
import {
  lookupMethodCenterByCode,
  paymentMethodCodeTaken,
} from "../../../lib/payments/method-lookup";
import {
  methodServesCenter,
  canWriteSharedMethod,
} from "../../../lib/payments/method-scope";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

let seq = 0;
const uniq = () => `${Date.now().toString(36)}-${seq++}`;

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerIdOf(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!
    .centerId!;
}

/** Actor cấp CƠ SỞ (CENTER_MANAGER) — visibleCenterIds = đúng cơ sở đó. */
async function makeCenterActor(orgCode: string): Promise<Actor> {
  const u = await seedUser({
    email: testEmail(`pttt-${orgCode}-${uniq()}`),
    role: "CENTER_MANAGER",
  });
  const roleId = (await db.roleDef.findUnique({
    where: { code: "CENTER_MANAGER" },
    select: { id: true },
  }))!.id;
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: await orgId(orgCode),
    roleId,
    reason: "seed pttt-per-center",
  });
  return resolveActorUncached(u.id);
}

async function makeMethod(
  code: string,
  centerId: string | null,
  bank?: { bin: string; acc: string; name: string },
) {
  return db.paymentMethod.create({
    data: {
      code,
      name: `PT ${code}`,
      type: "BANK_TRANSFER",
      centerId,
      isActive: true,
      ...(bank
        ? {
            bankBin: bank.bin,
            bankAccountNumber: bank.acc,
            bankAccountName: bank.name,
          }
        : {}),
    },
  });
}

test.describe("[PTTT] Phương thức thanh toán theo cơ sở", () => {
  let cs1 = "";
  let cs2 = "";
  let actorCs1: Actor;
  let actorHo: Actor;
  let pmCs1 = "";
  let pmCs2 = "";
  let pmChung = "";
  let codeCs2 = "";

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({
      data: { code: "CS1", name: "CS1", slug: `cs1-pttt-${uniq()}`, address: "a" },
    });
    await db.center.create({
      data: { code: "CS2", name: "CS2", slug: `cs2-pttt-${uniq()}`, address: "b" },
    });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    cs1 = await centerIdOf("CS1");
    cs2 = await centerIdOf("CS2");

    pmCs1 = (await makeMethod(`BANK_CS1_${uniq()}`, cs1)).id;
    const mCs2 = await makeMethod(`BANK_CS2_${uniq()}`, cs2);
    pmCs2 = mCs2.id;
    codeCs2 = mCs2.code;
    pmChung = (await makeMethod(`CASH_${uniq()}`, null)).id;

    actorCs1 = await makeCenterActor("CS1");
    actorHo = await makeCenterActor("HO");
  });

  test("[PTTT-01] người CS1 KHÔNG thấy phương thức của CS2", async () => {
    const rows = await scopedDb(actorCs1).paymentMethod.findMany({
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(pmCs2);
  });

  test("[PTTT-02] phương thức DÙNG CHUNG vẫn thấy được (centerId null ≠ bị ẩn)", async () => {
    // Đây là nửa dễ quên của thiết kế: khai PaymentMethod vào SCOPED_MODELS mà quên
    // NULL_IS_GLOBAL_MODELS thì `centerId IN (...)` nuốt luôn tiền mặt/cổng online ⇒
    // form tạo đơn hiện danh sách RỖNG và không ai tạo được đơn nào.
    const rows = await scopedDb(actorCs1).paymentMethod.findMany({
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(pmChung);
    expect(ids).toContain(pmCs1);
  });

  test("[PTTT-03] mở phương thức cơ sở khác bằng id → null", async () => {
    const row = await scopedDb(actorCs1).paymentMethod.findUnique({
      where: { id: pmCs2 },
      select: { id: true },
    });
    expect(row).toBeNull();
  });

  test("[PTTT-04] passesScope chặn ĐƯỜNG GHI sang phương thức cơ sở khác", async () => {
    // scopedDb không che write (CLAUDE.md §5) — đây là lưới mà 3 server action của màn
    // danh mục dựa vào để không thành lỗ IDOR ghi.
    expect(passesScope("PaymentMethod", { centerId: cs2 }, actorCs1)).toBe(false);
    expect(passesScope("PaymentMethod", { centerId: cs1 }, actorCs1)).toBe(true);
    // Dòng dùng chung: mọi cơ sở đều sửa được — cố ý, vì nó thuộc về cả hệ thống.
    expect(passesScope("PaymentMethod", { centerId: null }, actorCs1)).toBe(true);
  });

  test("[PTTT-05] Hội sở thấy toàn bộ phương thức của mọi cơ sở", async () => {
    const rows = await scopedDb(actorHo).paymentMethod.findMany({ select: { id: true } });
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([pmCs1, pmCs2, pmChung]));
  });

  test("[PTTT-06] mã QR lấy tài khoản THEO PHƯƠNG THỨC của đơn", async () => {
    // 31/08/2026 — nguồn tài khoản chuyển từ "theo cơ sở" (IntegrationConfig VIETQR)
    // sang "theo phương thức thanh toán của đơn". Ca này khoá đúng thứ tự lùi.
    const mCs1 = await makeMethod(`BANKACC_CS1_${uniq()}`, cs1, {
      bin: "970436",
      acc: "1111111111",
      name: "SATA ROBO CS1",
    });
    await makeMethod(`BANKACC_CHUNG_${uniq()}`, null, {
      bin: "970415",
      acc: "9999999999",
      name: "SATA ROBO CHUNG",
    });

    // (1) Đơn CHỌN phương thức của CS1 → đúng tài khoản CS1. Đây là yêu cầu gốc:
    // "sale cs1 xuất QR thì chỉ thấy mã QR tài khoản được khai cho cs1".
    expect(
      (await resolveOrderPaymentConfig({ centerId: cs1, paymentMethodId: mCs1.id }))
        ?.accountNumber,
    ).toBe("1111111111");

    // (2) Đơn CS1 CHƯA chọn phương thức (đơn từ convert lead luôn rơi vào đây) →
    // lùi về phương thức chuyển khoản của chính CS1, KHÔNG lấy tài khoản chung.
    expect(
      (await resolveOrderPaymentConfig({ centerId: cs1, paymentMethodId: null }))
        ?.accountNumber,
    ).toBe("1111111111");

    // (3) Đơn CS2 chưa khai tài khoản riêng → lùi về DÙNG CHUNG, tuyệt đối KHÔNG
    // mượn tài khoản của CS1.
    expect(
      (await resolveOrderPaymentConfig({ centerId: cs2, paymentMethodId: null }))
        ?.accountNumber,
    ).toBe("9999999999");

    // (4) Đơn không gắn cơ sở → tài khoản dùng chung.
    expect(
      (await resolveOrderPaymentConfig({ centerId: null, paymentMethodId: null }))
        ?.accountNumber,
    ).toBe("9999999999");
  });

  test("[PTTT-06b] phương thức khai THIẾU tài khoản thì bị bỏ qua, không dựng QR hỏng", async () => {
    // `makeMethod` không truyền `bank` ⇒ 3 cột tài khoản để trống. Nếu resolver không
    // kiểm đủ 3 mảnh thì nó trả về một PaymentConfig rỗng và ảnh QR dựng ra trỏ vào hư
    // không — phụ huynh quét, chuyển tiền, và tiền đi đâu không ai biết.
    const thieu = await makeMethod(`BANKACC_THIEU_${uniq()}`, cs1);
    expect(
      await resolveOrderPaymentConfig({ centerId: cs1, paymentMethodId: thieu.id }),
    ).toBeNull();
  });

  test("[PTTT-07] tra mã để CHẶN phải KHÔNG-SCOPE, nếu không cổng tự mở", async () => {
    // Đây là cái bẫy tinh vi nhất của thiết kế này: cổng chặn "phương thức cơ sở khác"
    // hoạt động bằng cách tra mã ra cơ sở sở hữu rồi so. Nếu câu tra ĐÓ đi qua scopedDb
    // thì đúng mã cần chặn bị lọc mất, trả null, cổng đọc null thành "mã lạ, cho qua"
    // ⇒ mở toang đúng lúc phải đóng. Ca này khoá bất biến "câu tra không được scope".
    const looked = await lookupMethodCenterByCode(codeCs2);
    expect(looked.found).toBe(true);
    expect(looked.centerId).toBe(cs2);

    // Và đây là hệ quả nghiệp vụ: mã đó KHÔNG phục vụ được đơn của CS1.
    expect(methodServesCenter(looked, cs1)).toBe(false);

    // Mã không có trong danh mục ("auto" của đường ghi tự động) → found=false ⇒ cho qua,
    // không khoá nhầm khoản thu hợp lệ đã tồn tại.
    expect((await lookupMethodCenterByCode("auto")).found).toBe(false);
  });

  test("[PTTT-08] kiểm trùng mã thấy được mã của cơ sở khác", async () => {
    // `code` @unique TOÀN CỤC: nếu câu kiểm bị scope thì người CS1 đặt trùng mã CS2 sẽ
    // được báo "chưa ai dùng", lưu xuống rồi mới ăn lỗi unique thô của Postgres.
    expect(await paymentMethodCodeTaken(codeCs2)).toBe(true);
    // Trừ chính dòng đang sửa — form gửi lại mã cũ ở mọi lần lưu.
    expect(await paymentMethodCodeTaken(codeCs2, pmCs2)).toBe(false);
    expect(await paymentMethodCodeTaken(`KHONG_TON_TAI_${uniq()}`)).toBe(false);
  });

  test("[PTTT-09] payments:* seed GLOBAL KHÔNG cho vai cấp cơ sở thấy mọi cơ sở", async () => {
    // ⚠️ Ca này khoá lại một HIỂU NHẦM rất dễ mắc, đã suýt làm hỏng thiết kế.
    //
    // `PaymentMethod` được khai prefix ["payments:"] trong getModelPrefixes. Nhìn
    // prisma/seed-roles.ts thấy CENTER_MANAGER/CENTER_ACCOUNTANT/CENTER_SALES_CSM đều
    // giữ `payments:*` với `scopeType: "GLOBAL"`, rất dễ kết luận "vậy họ sẽ có
    // centerScope ALL và nhìn thấy phương thức của mọi cơ sở" rồi đi GỠ prefix.
    //
    // KHÔNG PHẢI: `centerScope` suy từ NƠI NEO VAI (HO/ROOT → "ALL"), không phải từ
    // `scopeType` — lib/auth/actor.ts:50-56. Gỡ prefix mới là nới quyền, vì khi đó
    // model rơi về nhánh `isHoLevel ? "ALL" : visibleCenterIds` và BẤT KỲ ai có một
    // vai neo tại Hội sở (kể cả vai chẳng dính tiền nong) đọc được danh mục mọi cơ sở.
    expect(actorCs1.isHoLevel).toBe(false);
    expect(getModelVisibleCenterIds("PaymentMethod", actorCs1)).toEqual([cs1]);
    // Cùng kết quả với họ tiền còn lại — prefix chung nên hành vi phải khớp.
    expect(getModelVisibleCenterIds("Payment", actorCs1)).toEqual([cs1]);
    // Và vai neo tại Hội sở thì đúng là thấy hết.
    expect(getModelVisibleCenterIds("PaymentMethod", actorHo)).toBe("ALL");
  });

  test("[PTTT-10] người cấp cơ sở KHÔNG đụng được phương thức DÙNG CHUNG", async () => {
    // ⚠️ Ca này khoá một lỗ hổng ĐÃ TÁI HIỆN ĐƯỢC, không phải lo xa.
    //
    // `passesScope("PaymentMethod", { centerId: null }, actorCs1)` trả TRUE — đúng theo
    // nghĩa NULL_IS_GLOBAL ("ai cũng ĐỌC được dòng dùng chung"). Nhưng hai cổng
    // update/toggle của màn danh mục chỉ dựa vào passesScope, nên trước khi có
    // `canWriteSharedMethod` thì kịch bản sau CHẠY ĐƯỢC:
    //   Kế toán CS1 mở "Tiền mặt" (dùng chung) → đổi ô "Cơ sở áp dụng" sang CS1 → Lưu.
    //   Sau đó CS2 còn ĐÚNG 0 phương thức thanh toán, tức mất sạch đường thu tiền, do
    //   một người không có quyền gì với CS2 bấm một ô.
    const cs1SeesAll = getModelVisibleCenterIds("PaymentMethod", actorCs1) === "ALL";
    const hoSeesAll = getModelVisibleCenterIds("PaymentMethod", actorHo) === "ALL";
    expect(cs1SeesAll).toBe(false);
    expect(hoSeesAll).toBe(true);

    // Đọc thì vẫn được — dòng dùng chung phải hiện ra để CS1 chọn khi tạo đơn.
    expect(passesScope("PaymentMethod", { centerId: null }, actorCs1)).toBe(true);

    // KÉO dòng dùng chung về CS1 → CHẶN.
    expect(
      canWriteSharedMethod({
        currentCenterId: null,
        nextCenterId: cs1,
        actorSeesAllCenters: cs1SeesAll,
      }),
    ).toBe(false);

    // SỬA/TẮT dòng dùng chung (giữ nguyên null) → CHẶN.
    expect(
      canWriteSharedMethod({
        currentCenterId: null,
        nextCenterId: null,
        actorSeesAllCenters: cs1SeesAll,
      }),
    ).toBe(false);

    // ĐẨY phương thức riêng của CS1 thành dùng chung → CHẶN.
    expect(
      canWriteSharedMethod({
        currentCenterId: cs1,
        nextCenterId: null,
        actorSeesAllCenters: cs1SeesAll,
      }),
    ).toBe(false);

    // Phương thức CỦA CHÍNH CƠ SỞ MÌNH → vẫn toàn quyền, không chặn oan.
    expect(
      canWriteSharedMethod({
        currentCenterId: cs1,
        nextCenterId: cs1,
        actorSeesAllCenters: cs1SeesAll,
      }),
    ).toBe(true);

    // Hội sở làm được mọi thứ trên.
    expect(
      canWriteSharedMethod({
        currentCenterId: null,
        nextCenterId: cs1,
        actorSeesAllCenters: hoSeesAll,
      }),
    ).toBe(true);
  });

  test("[PTTT-11] quyền seed GLOBAL bỏ qua đích ⇒ cách ly phải do passesScope làm", async () => {
    // ⚠️ Ca này khoá lại một BẪY đã gây lộ dữ liệu thật trong chính đợt sửa này.
    //
    // Trang /centers/<id>/edit không có cổng quyền ở đầu và `Center` ∈ SCOPE_EXEMPT nên
    // mở được bằng id bất kỳ. Bản đầu tôi gác khối Thanh toán bằng
    // `checkPermission("payments:view", { centerId })` và tưởng truyền đích là đủ cách ly.
    // KHÔNG PHẢI: `payments:view` seed `scopeType: "GLOBAL"`, mà lib/auth/can.ts:14-15 là
    // `case "GLOBAL": return true` — ĐÍCH BỊ VỨT HẲN. Kết quả: Kế toán/QLCS của CS1 mở
    // `/centers/<id-CS2>/edit` và đọc trọn số tài khoản nhận tiền của CS2.
    //
    // Bài học đóng đinh ở đây: quyền trả lời "được làm việc gì", `passesScope` trả lời
    // "được đụng cơ sở nào". Đừng nhờ cái thứ nhất làm việc của cái thứ hai.

    // (a) Quyền CHO QUA dù đích là cơ sở khác — đây chính là chỗ dễ hiểu nhầm.
    expect(can(actorCs1, "payments:view", { centerId: cs2 })).toBe(true);

    // (b) Nhưng scope thì CHẶN đúng. Đây mới là thứ được dùng để cách ly.
    expect(passesScope("PaymentMethod", { centerId: cs2 }, actorCs1)).toBe(false);
    expect(passesScope("PaymentMethod", { centerId: cs1 }, actorCs1)).toBe(true);
  });
});
