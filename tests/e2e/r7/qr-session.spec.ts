/**
 * QR-SESSION — xuất QR THEO TỪNG PHIẾU THU (đợt), không phải mức đơn.
 * Postgres LOCAL (.env.test). Test service-level: gọi thẳng core của màn đơn
 * (`app/(admin)/admin/orders/_qr-core`), không dựng HTTP.
 *
 * Vì sao gọi core chứ không gọi server action: runner Playwright stub `@/lib/auth`
 * → `auth()` trả null nên `_qr-actions.ts` không chạy được happy-path. Core nhận
 * `actor` tường minh (đã resolveActorUncached từ UserOrgRole thật) nên vẫn phủ
 * đúng phần rủi ro: số tiền, chống 2 QR song song, bất biến matchKey, cách ly cơ sở.
 *
 * Phủ:
 *  [QR-01] QR đợt 1 in phần CÒN THIẾU CỦA ĐỢT (không phải tổng đơn).
 *  [QR-02] bấm 2 lần → dùng lại phiên cũ, không đẻ 2 QR ACTIVE.
 *  [QR-03] tạo lại 5 lần → 5 phiên (4 EXPIRED + 1 ACTIVE), matchKey KHÔNG đổi.
 *  [QR-04] phiếu PAID → từ chối.
 *  [QR-05] phiếu cơ sở khác → "không tìm thấy" (không lộ tồn tại), không tạo phiên.
 *  [QR-06] phiên ACTIVE ĐÃ QUÁ HẠN không được tái sử dụng → mở phiên mới.
 *  [QR-10] chữ IN RA = chuỗi NẰM TRONG ẢNH (không phải chuỗi tính lại).
 *  [QR-11] đổi dữ liệu đơn sau khi xuất mã → chữ GIỮ NGUYÊN theo ảnh, và `anhDaCu` bật.
 *  [QR-12] đường RENDER TRANG và đường BẤM NÚT trả CÙNG một chuỗi cho cùng phiếu.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached, type Actor } from "../../../lib/auth/actor";
import { paymentMatchKey } from "../../../lib/payments/payment-request";
import { coKhoaDoiKhop } from "../../../lib/payments/noi-dung-ck";
import { noiDungTrongAnhQr } from "../../../lib/payments/noi-dung-trong-anh";
import {
  transferContentForOrder,
  VIETQR_ADDINFO_MAX,
} from "../../../lib/payments/vietqr";
import {
  issueQrForRequestCore,
  loadActiveQrSessions,
  regenerateQrCore,
} from "../../../app/(admin)/admin/orders/_qr-core";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const AUDIT = { id: null, name: "Sale Test" };

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
  const u = await seedUser({ email: testEmail(`qr-${orgCode}-${uniq()}`), role: "CENTER_MANAGER" });
  const roleId = (await db.roleDef.findUnique({
    where: { code: "CENTER_MANAGER" },
    select: { id: true },
  }))!.id;
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: await orgId(orgCode),
    roleId,
    reason: "seed qr-session",
  });
  return resolveActorUncached(u.id);
}

async function seedOrder(centerId: string, totalAmount: number) {
  return db.order.create({
    data: {
      code: `ORD-260803-${String(100000 + seq++).slice(-6)}`,
      type: "COURSE",
      customerName: "PH QR",
      customerPhone: "0905123456",
      centerId,
      totalAmount,
      subtotal: totalAmount,
    },
  });
}

async function seedRequest(
  order: { id: string; code: string; centerId: string | null },
  installmentNo: number,
  amountDue: number,
) {
  return db.paymentRequest.create({
    data: {
      orderId: order.id,
      centerId: order.centerId,
      installmentNo,
      amountDue,
      matchKey: paymentMatchKey(order.code, installmentNo),
      sortOrder: installmentNo,
    },
  });
}

/** Rót `amount` vào phiếu (qua BankTransaction thật) để có "đã thu / còn thiếu". */
async function allocate(paymentRequestId: string, centerId: string | null, amount: number) {
  const txn = await db.bankTransaction.create({
    data: {
      provider: "PAYOS",
      providerTxnId: `txn-${uniq()}`,
      amount,
      transferredAt: new Date(),
      centerId,
      status: "MATCHED",
    },
  });
  await db.paymentAllocation.create({
    data: { bankTransactionId: txn.id, paymentRequestId, centerId, amount },
  });
}

test.describe("[QR] Xuất QR theo từng phiếu thu", () => {
  let cs1 = "";
  let cs2 = "";
  let actorCs1: Actor;

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: `cs1-qr-${uniq()}`, address: "a" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: `cs2-qr-${uniq()}`, address: "b" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    cs1 = await centerIdOf("CS1");
    cs2 = await centerIdOf("CS2");
    // Tài khoản nhận tiền (QR ảnh tĩnh VietQR) — payOS không cấu hình trong .env.test
    // nên core rơi về nhánh này; đây đúng là nhánh cần chắc chắn chạy được ở go-live.
    await db.integrationConfig.create({
      data: {
        provider: "VIETQR",
        isEnabled: true,
        settings: { bankBin: "970415", accountNumber: "0123456789", accountName: "SATA ROBO" },
      },
    });
    actorCs1 = await makeCenterActor("CS1");
  });

  test("[QR-01] QR đợt 1 in PHẦN CÒN THIẾU CỦA ĐỢT ĐÓ, không phải tổng đơn", async () => {
    const order = await seedOrder(cs1, 10_000_000);
    const dot1 = await seedRequest(order, 1, 4_000_000);
    await seedRequest(order, 2, 6_000_000);
    await allocate(dot1.id, cs1, 1_000_000); // đã thu 1tr của đợt 1

    const res = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: dot1.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // 3tr = 4tr (đợt 1) − 1tr đã thu. KHÔNG phải 10tr (tổng đơn), không phải 4tr.
    expect(res.session.amountShown).toBe(3_000_000);
    expect(res.reused).toBe(false);

    const rows = await db.qrSession.findMany({ where: { paymentRequestId: dot1.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("ACTIVE");
    expect(rows[0]!.amountShown).toBe(3_000_000);
    expect(rows[0]!.centerId).toBe(cs1);
    expect(rows[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // ⚠️ SỬA 17/09/2026 — ca này ĐỎ TRÊN CI. Mã đúng, TEST CŨ.
    //
    // Bản cũ khoá luật 20/08: *"nội dung QR là dạng NGƯỜI ĐỌC, KHÔNG còn là matchKey"* và
    // khẳng định `not.toContain(paymentMatchKey(...))`. Luật đó bị `361ea7d4` đảo có chủ
    // đích — nội dung nay MANG KHOÁ LÊN ĐẦU (`ORD…D1 NguyenV`) để nhánh (a) khớp thẳng một
    // truy vấn, thay vì rơi xuống nhánh (d) đoán theo SĐT. Xem khối chú thích đầu
    // `lib/payments/noi-dung-ck.ts`: *"khoá được ưu tiên tuyệt đối; hết chỗ thì phần người
    // đọc bị cắt, không bao giờ ngược lại."*
    //
    // Dùng `coKhoaDoiKhop` — chính hàm tệp đó dựng ra "để test khẳng định QR mới KHÁC QR cũ
    // ở đúng điểm đó" — thay vì so chuỗi cứng.
    // `qrContent` là `string | null` trên lược đồ — khẳng định nó CÓ trước, kẻo `null` lọt
    // qua thành "không mang khoá" và ca này đỏ vì một lý do khác hẳn.
    expect(rows[0]!.qrContent).not.toBeNull();
    expect(coKhoaDoiKhop(rows[0]!.qrContent!, paymentMatchKey(order.code, 1))).toBe(true);
    // Phần người đọc vẫn còn chỗ nào thì vẫn in: SĐT nay là dạng NỘI ĐỊA `0…` (`c95c6c25`).
    expect(rows[0]!.qrContent).toContain("PHQR_0");
    // Phiếu đợt 2 không bị đụng tới.
    expect(await db.qrSession.count()).toBe(1);
  });

  test("[QR-01b] đợt 1 và đợt 2 có nội dung CK KHÁC NHAU — mỗi đợt mang khoá của chính nó", async () => {
    // ⚠️ SỬA 17/09/2026 — ca này ĐỎ TRÊN CI, và nó bị ĐẢO NGƯỢC HOÀN TOÀN, không phải chỉnh
    // vài ký tự. Bản cũ khoá đúng điều ngược lại: *"hai đợt dùng CHUNG một nội dung CK"*, kèm
    // lời dặn *"người sau đừng sửa nó thành mỗi đợt một chuỗi (sẽ vỡ đường đối khớp theo
    // SĐT)"*.
    //
    // Lời dặn ấy đã bị chính chủ dự án đảo ở `361ea7d4`: nội dung nay MANG `matchKey` lên
    // đầu, mà khoá thì riêng từng đợt (`…D1`, `…D2`) ⇒ hai chuỗi KHÁC nhau, và đó chính là
    // mục đích — tiền về rơi đúng đợt bằng nhánh (a), không phải đoán bằng số tiền.
    // Đường đối khớp theo SĐT KHÔNG vỡ: nó vẫn là nhánh (d), chạy khi nhánh (a) trượt.
    //
    // Giữ nguyên ca cũ là ghim một luật đã chết ở đúng chỗ nguy hiểm nhất: người sau đọc nó
    // như đặc tả rồi gỡ khoá khỏi nội dung CK, và cả bản vá `361ea7d4` biến mất.
    const order = await seedOrder(cs1, 10_000_000);
    const dot1 = await seedRequest(order, 1, 4_000_000);
    const dot2 = await seedRequest(order, 2, 6_000_000);

    const a = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: dot1.id });
    const b = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: dot2.id });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    // Mỗi đợt mang khoá của CHÍNH NÓ ⇒ hai chuỗi khác nhau.
    expect(coKhoaDoiKhop(a.session.transferContent, paymentMatchKey(order.code, 1))).toBe(true);
    expect(coKhoaDoiKhop(b.session.transferContent, paymentMatchKey(order.code, 2))).toBe(true);
    expect(a.session.transferContent).not.toBe(b.session.transferContent);
    // Và SỐ TIỀN cũng khác nhau — nay là lớp phân biệt THỨ HAI, không còn là lớp duy nhất.
    expect(a.session.amountShown).toBe(4_000_000);
    expect(b.session.amountShown).toBe(6_000_000);
    // matchKey vẫn nguyên trong DB — đường khớp của mọi QR phát trước 20/08.
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: dot1.id } })).matchKey).toBe(
      paymentMatchKey(order.code, 1),
    );
  });

  test("[QR-02] bấm Xuất QR 2 lần liên tiếp → KHÔNG có 2 phiên ACTIVE (dùng lại phiên cũ)", async () => {
    const order = await seedOrder(cs1, 5_000_000);
    const req = await seedRequest(order, 1, 5_000_000);

    const first = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: req.id });
    const second = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: req.id });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.reused).toBe(true);
    expect(second.session.id).toBe(first.session.id);

    expect(await db.qrSession.count({ where: { paymentRequestId: req.id } })).toBe(1);
    expect(
      await db.qrSession.count({ where: { paymentRequestId: req.id, status: "ACTIVE" } }),
    ).toBe(1);
  });

  test("[QR-03] tạo lại QR 5 lần → 5 phiên (4 EXPIRED + 1 ACTIVE) nhưng matchKey của phiếu KHÔNG ĐỔI", async () => {
    const order = await seedOrder(cs1, 3_000_000);
    const req = await seedRequest(order, 1, 3_000_000);
    const matchKeyBefore = req.matchKey;
    expect(matchKeyBefore).toBe(paymentMatchKey(order.code, 1));

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await regenerateQrCore(actorCs1, AUDIT, { paymentRequestId: req.id });
      expect(res.ok).toBe(true);
      if (res.ok) ids.push(res.session.id);
    }
    expect(new Set(ids).size).toBe(5); // 5 phiên KHÁC NHAU

    const all = await db.qrSession.findMany({ where: { paymentRequestId: req.id } });
    expect(all).toHaveLength(5);
    expect(all.filter((s) => s.status === "EXPIRED")).toHaveLength(4);
    expect(all.filter((s) => s.status === "ACTIVE")).toHaveLength(1);

    // BẤT BIẾN #3 — định danh đối khớp bền theo ĐỜI PHIẾU: tạo lại lần thứ 5 thì
    // tiền của mọi QR cũ vẫn rơi đúng đợt này.
    const after = await db.paymentRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.matchKey).toBe(matchKeyBefore);
    // Mọi phiên (kể cả đã EXPIRED) vẫn trỏ về CÙNG một phiếu thu.
    expect(new Set(all.map((s) => s.paymentRequestId))).toEqual(new Set([req.id]));
  });

  test("[QR-04] phiếu đã PAID → từ chối xuất QR, không tạo phiên", async () => {
    const order = await seedOrder(cs1, 2_000_000);
    const req = await seedRequest(order, 1, 2_000_000);
    await allocate(req.id, cs1, 2_000_000);
    await db.paymentRequest.update({ where: { id: req.id }, data: { status: "PAID" } });

    const res = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: req.id });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("đã đóng đủ");
    expect(await db.qrSession.count()).toBe(0);

    // Tạo lại QR cũng phải bị chặn (không có cửa sau qua nút "Tạo lại").
    const again = await regenerateQrCore(actorCs1, AUDIT, { paymentRequestId: req.id });
    expect(again.ok).toBe(false);
    expect(await db.qrSession.count()).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // [QR-07..09] — CỔNG DUYỆT THEO NGƯỠNG [23/09/2026]
  //
  // Chủ dự án chốt 22/09: vượt 4 đợt hoặc vượt 1 ưu đãi/dòng thì "cần quản lý duyệt thì
  // mới được xuất mã QR".
  //
  // ⚠️ Cổng đặt ở khâu PHÁT RA, KHÔNG ở khâu NHẬN TIỀN — và đó là cả bài học. Cổng duyệt
  // CŨ nằm ở `decideSepayAction` và nó LÀM MẤT TIỀN: webhook trả MANUAL ⇒ ba sổ trống
  // (xem `lib/orders/bo-duyet.test.ts`). Chặn lúc phát thì chưa có tiền để mất.
  // Ca [QR-09] khoá lại chính ranh giới đó.

  test("[QR-07] đơn chờ duyệt KẾ HOẠCH → từ chối xuất QR, và tạo lại cũng bị chặn", async () => {
    const order = await seedOrder(cs1, 5_000_000);
    const req = await seedRequest(order, 1, 1_000_000);
    await db.order.update({
      where: { id: order.id },
      data: { installmentApprovalStatus: "PENDING_APPROVAL" },
    });

    const res = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: req.id });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // Câu lỗi nói bằng ngôn ngữ của NGUYÊN NHÂN, không phải "không có quyền" — sale phải
    // đọc được mình đang chờ ai và vì sao (luật 12).
    expect(res.error).toContain("chia đợt");
    expect(res.error).toContain("Quản lý cơ sở duyệt");
    expect(await db.qrSession.count()).toBe(0);

    // Nút "Tạo lại" là cửa sau kinh điển — `guardIssuable` dùng chung nên nó cũng chặn.
    const again = await regenerateQrCore(actorCs1, AUDIT, { paymentRequestId: req.id });
    expect(again.ok).toBe(false);
    expect(await db.qrSession.count()).toBe(0);
  });

  test("[QR-08] đơn chờ duyệt ƯU ĐÃI → từ chối, lý do nói đúng về ưu đãi", async () => {
    const order = await seedOrder(cs1, 5_000_000);
    const req = await seedRequest(order, 1, 1_000_000);
    await db.order.update({
      where: { id: order.id },
      data: { discountApprovalStatus: "PENDING_APPROVAL" },
    });

    const res = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: req.id });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // Hai cột, hai lý do KHÁC NHAU — Quản lý cơ sở cần biết mình đang duyệt cái gì.
    expect(res.error).toContain("Ưu đãi");
    expect(res.error).not.toContain("chia đợt");
    expect(await db.qrSession.count()).toBe(0);
  });

  test("[QR-09] đơn ĐÃ DUYỆT (hoặc chưa từng phải duyệt) → xuất QR bình thường", async () => {
    // Ca ngược, và nó cần thiết: không có nó thì "chặn mọi thứ" cũng xanh.
    const order = await seedOrder(cs1, 5_000_000);
    const req = await seedRequest(order, 1, 1_000_000);
    await db.order.update({
      where: { id: order.id },
      data: { installmentApprovalStatus: "APPROVED", discountApprovalStatus: "APPROVED" },
    });

    const res = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: req.id });
    expect(res.ok).toBe(true);
    expect(await db.qrSession.count()).toBe(1);
  });

  // ── 24/09/2026 · ẢNH VÀ CHỮ PHẢI LÀ MỘT ────────────────────────────────────
  //
  // Chủ dự án: *"mã QR khi in ra bị sai nội dung CK, đợi một chút F5 thì ra đúng chỗ Nội
  // dung CK, nhưng khi KH quét QR thì vẫn là nội dung cũ mặc dù ở web là nội dung đúng."*
  //
  // Gốc: `QrSessionView` lấy ẢNH từ `QrSession.qrContent` (ảnh chụp, bất biến) còn CHỮ từ
  // một tham số được TÍNH LẠI mỗi lượt render — hai nguồn, nên có ngày lệch. Ba ca dưới
  // khoá cả ba mặt của nó.

  /** Chuỗi người-đọc mức ĐƠN, dựng y như `[id]/page.tsx` dựng trước khi truyền xuống core. */
  async function phanNguoiDocCuaDon(orderId: string): Promise<string> {
    const o = (await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        customerName: true,
        customerPhone: true,
        student: { select: { name: true } },
        items: { orderBy: { createdAt: "asc" }, take: 1, select: { itemName: true } },
      },
    }))!;
    return transferContentForOrder(
      {
        studentName: o.student?.name,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        courseName: o.items[0]?.itemName,
      },
      VIETQR_ADDINFO_MAX,
    );
  }

  test("[QR-10] chữ in ra ĐỌC TỪ ẢNH — không phải chuỗi dựng lại", async () => {
    const order = await seedOrder(cs1, 5_000_000);
    const req = await seedRequest(order, 1, 3_000_000);

    const res = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: req.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Ảnh phải là URL VietQR (payOS không cấu hình trong .env.test) — nếu một ngày nó
    // thành chuỗi EMVCo thì ca này phải ĐỎ chứ không được lặng lẽ bỏ qua, vì khi đó
    // `noiDungTrongAnhQr` trả null và phép so dưới hoá vô nghĩa.
    expect(res.session.qrContent).toMatch(/^https:\/\/img\.vietqr\.io\//);
    const trongAnh = noiDungTrongAnhQr(res.session.qrContent);
    expect(trongAnh, "đọc được nội dung CK ra khỏi ảnh").not.toBeNull();
    expect(res.session.transferContent).toBe(trongAnh);
    // Và nó vẫn mang khoá đối khớp — bản vá KHÔNG được làm mất khoá (nhánh (a) sống nhờ nó).
    expect(coKhoaDoiKhop(res.session.transferContent, paymentMatchKey(order.code, 1))).toBe(true);
    expect(res.session.anhDaCu).toBe(false);
  });

  test("[QR-11] đổi dữ liệu đơn sau khi xuất mã → chữ THEO ẢNH, và màn báo mã đã cũ", async () => {
    const order = await seedOrder(cs1, 5_000_000);
    const req = await seedRequest(order, 1, 3_000_000);

    const res = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: req.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const chuoiTrongAnh = res.session.transferContent;

    // Sale sửa TÊN trên đơn SAU khi đã phát mã. Ảnh QR trong DB không đổi theo.
    //
    // ⚠️ Sửa SĐT thì ca này KHÔNG đỏ, và đó là một PHÁT HIỆN chứ không phải giới hạn của
    // ca test: khuôn đời CŨ chỉ có 25 ký tự, khoá `ORD…D1` chiếm 17 + 1 dấu cách, nên phần
    // người đọc còn đúng 7 ký tự — tức CHỈ mấy chữ đầu của tên. SĐT bị cắt sạch khỏi mọi
    // mã QR đời cũ kể từ 14/09. Hệ quả phải biết: nhánh đối khớp theo SĐT (nhánh (d) của
    // `payos-ingest`) KHÔNG dùng được với các mã này — tiền về đúng phiếu hoàn toàn nhờ
    // khoá. Đây cũng là lý do chuỗi trên màn trông "cụt" với sale.
    await db.order.update({
      where: { id: order.id },
      data: { customerName: "Tran Minh Khoa" },
    });

    const map = await loadActiveQrSessions(
      actorCs1,
      [{ id: req.id, matchKey: req.matchKey }],
      await phanNguoiDocCuaDon(order.id),
      { canViewPii: true },
    );
    const s = map[req.id]!;
    expect(s, "phiên ACTIVE vẫn phải xuống trang").toBeTruthy();
    // Chữ KHÔNG được chạy theo dữ liệu mới — nó phải nói đúng thứ khách sẽ quét ra.
    expect(s.transferContent).toBe(chuoiTrongAnh);
    // …nhưng màn PHẢI nói ra là mã đã lỗi thời, kèm chuỗi sẽ phát nếu xuất lại.
    expect(s.anhDaCu).toBe(true);
    expect(s.noiDungHomNay).not.toBe(chuoiTrongAnh);
    // Khoá giữ nguyên (bất biến #3) — chỉ phần người đọc đổi.
    expect(coKhoaDoiKhop(s.noiDungHomNay, paymentMatchKey(order.code, 1))).toBe(true);
  });

  test("[QR-12] đường RENDER TRANG và đường BẤM NÚT trả CÙNG một chuỗi", async () => {
    const order = await seedOrder(cs1, 5_000_000);
    const req = await seedRequest(order, 1, 3_000_000);

    // (1) Sale bấm "Xuất QR".
    const bam = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: req.id });
    expect(bam.ok).toBe(true);
    if (!bam.ok) return;

    // (2) F5 — trang tự đọc lại phiên ACTIVE.
    const map = await loadActiveQrSessions(
      actorCs1,
      [{ id: req.id, matchKey: req.matchKey }],
      await phanNguoiDocCuaDon(order.id),
      { canViewPii: true },
    );

    // Trước bản vá: (1) trả chuỗi CÓ khoá còn (2) trả chuỗi KHÔNG khoá ⇒ cùng một phiếu
    // đổi chữ tuỳ lúc, đúng cái mà chủ dự án tả là "F5 thì ra đúng".
    expect(map[req.id]!.transferContent).toBe(bam.session.transferContent);
    expect(map[req.id]!.noiDungHomNay).toBe(bam.session.noiDungHomNay);
    expect(map[req.id]!.anhDaCu).toBe(false);
  });

  test("[QR-05] phiếu của cơ sở khác → không xuất được, báo 'không tìm thấy' (không lộ tồn tại)", async () => {
    const orderCs2 = await seedOrder(cs2, 7_000_000);
    const reqCs2 = await seedRequest(orderCs2, 1, 7_000_000);

    const res = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: reqCs2.id });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Không tìm thấy phiếu thu");
    expect(await db.qrSession.count()).toBe(0);

    const regen = await regenerateQrCore(actorCs1, AUDIT, { paymentRequestId: reqCs2.id });
    expect(regen.ok).toBe(false);
    expect(await db.qrSession.count()).toBe(0);

    // Actor CS2 thì vẫn xuất được — chứng minh chặn là do CÁCH LY, không phải phiếu hỏng.
    const actorCs2 = await makeCenterActor("CS2");
    const ok = await issueQrForRequestCore(actorCs2, AUDIT, { paymentRequestId: reqCs2.id });
    expect(ok.ok).toBe(true);
  });

  test("[QR-06] phiên ACTIVE đã quá hạn KHÔNG được tái sử dụng → mở phiên mới", async () => {
    const order = await seedOrder(cs1, 1_500_000);
    const req = await seedRequest(order, 1, 1_500_000);

    const first = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: req.id });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Đẩy phiên hiện tại về quá khứ (giữ status ACTIVE — mô phỏng hết hạn tự nhiên).
    await db.qrSession.update({
      where: { id: first.session.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const second = await issueQrForRequestCore(actorCs1, AUDIT, { paymentRequestId: req.id });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reused).toBe(false);
    expect(second.session.id).not.toBe(first.session.id);
    expect(await db.qrSession.count({ where: { paymentRequestId: req.id } })).toBe(2);
  });
});
