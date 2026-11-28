import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { orgUnitIdForCenter } from "@/lib/org/org-service";

import { khoaHocVien, LoiDoiQua, soDuVi } from "./doi-qua";
import { khoaHanMucGiaoVien, kiemTraNguoiCapCoin } from "./han-muc";
import { Prisma, type SataCoinTxType } from "@prisma/client";

// =============================================================================
// Cụm C4 — SataCoin: sổ cái BẤT BIẾN. KHÔNG sửa/xoá giao dịch. Điều chỉnh =
// ghi giao dịch đảo (REVERSAL). Số dư = SUM(amount). KHÔNG blockchain.
//
// M2-SC (19/11/2026) — siết TÍNH TOÀN VẸN khi ghi, KHÔNG đổi nghiệp vụ:
//  · Mọi phép GHI chạy trong một transaction và khoá hàng học viên (`khoaHocVien` của `doi-qua.ts` — `SELECT … FOR UPDATE`, CÙNG khoá với đổi quà WP8): hai lượt trừ/đảo đồng thời của CÙNG học viên
//    xếp hàng, nên phép kiểm "số dư đủ không" và phép ghi không còn cửa sổ chen vào giữa (trước đây: đọc số dư rồi ghi ở hai bước rời nhau ⇒ hai lượt
//    trừ cùng lúc đều thấy "đủ" và cộng lại làm số dư ÂM).
//  · `eventKey` (tuỳ chọn): cùng khoá + cùng học viên ⇒ CHỈ MỘT giao dịch; lượt thứ hai trả lại đúng giao dịch đã ghi (`trungLap: true`), không ghi thêm.
//    Dùng cho mọi đường tự động/bấm đúp: bấm liên tục hay thử lại sau lỗi mạng không cộng/trừ hai lần.
//  · Phép kiểm "số dư đủ không" dùng KHẢ DỤNG = sổ cái − coin đang giữ cho yêu cầu đổi quà (`soDuVi` của doi-qua.ts), không phải số dư thô.
//  · Đảo một khoản CỘNG đã bị tiêu mất (số dư không đủ trừ lại) bị TỪ CHỐI — cùng luật "không để số dư âm" với phép trừ. Không có chính sách nào được duyệt cho số dư âm.
//  · Hai lượt đảo đồng thời cùng một giao dịch: lượt thua trả "đã được đảo trước đó" (không ném lỗi P2002 thô).
// Chỉ phép ghi QUA HÀM NÀY mới được bảo vệ: SQL tay / script ghi thẳng vào bảng thì không (đừng làm).
// =============================================================================

// ⚠️ POOL KẾT NỐI: mỗi lượt ghi GIỮ một kết nối suốt lúc chờ khoá. Phần mở rộng ghi kép `orgUnitId` của `lib/db.ts` (lib/org/dual-write.ts) tra OrgUnit bằng client GỐC —
// tức MỘT kết nối thứ hai — nên nếu để nó chạy TRONG transaction, khi mọi kết nối của pool đang chờ khoá thì người giữ khoá không còn kết nối để tra ⇒ treo tới hết hạn
// (đo trên 20 lượt trừ đồng thời của cùng một học viên: "Unable to start a transaction in the given time"). Vì vậy `orgUnitId` được tra TRƯỚC transaction và truyền tường minh
// (cơ chế ghi kép tôn trọng giá trị đã đặt) — kết quả ghi y hệt, chỉ khác thời điểm tra.

/** Số dư = tổng amount của mọi giao dịch học viên. */
export async function getBalance(studentId: string): Promise<number> {
  const agg = await db.sataCoinTransaction.aggregate({
    where: { studentId },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

export async function listTransactions(studentId: string, limit = 100) {
  return db.sataCoinTransaction.findMany({
    where: { studentId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      amount: true,
      type: true,
      reason: true,
      note: true,
      ruleCode: true,
      reversedTxId: true,
      createdAt: true,
    },
  });
}

/** Ghi 1 giao dịch mới (append-only). amount âm = trừ. `trungLap` = khoá `eventKey` đã có ⇒ trả lại giao dịch cũ, KHÔNG ghi thêm. */
export async function recordTransaction(params: {
  studentId: string;
  amount: number;
  type: SataCoinTxType;
  reason: string;
  note?: string | null;
  ruleCode?: string | null;
  createdById?: string | null;
  /** Khoá chống ghi trùng cho MỘT sự kiện; bỏ trống = không khoá. */
  eventKey?: string | null;
  /**
   * HS2-D4 — vai của NGƯỜI cấp (từ phiên). BẮT BUỘC khi có người cấp (kiểm lúc chạy: có `createdById` mà thiếu `roles` ⇒ TỪ CHỐI, fail-closed): người cấp là giáo viên ⇒ chỉ học viên mình phụ trách + trong hạn mức tháng do Admin đặt;
   * QLCS/Admin không bị hạn mức; vai khác bị từ chối. `null` chỉ hợp lệ khi KHÔNG có người cấp (`createdById` rỗng — đường tự động/script); có người cấp mà thiếu `roles` ⇒ từ chối.
   */
  roles?: readonly string[] | null;
}): Promise<{ ok: boolean; error?: string; txId?: string; trungLap?: boolean }> {
  if (!Number.isInteger(params.amount) || params.amount === 0) {
    return { ok: false, error: "Số coin phải là số nguyên khác 0" };
  }
  if (params.createdById && params.roles == null) return { ok: false, error: "Thiếu vai của người cấp coin" };
  const eventKey = params.eventKey?.trim() || null;
  // Đọc + tra OrgUnit NGOÀI transaction (xem ghi chú POOL ở trên). Học viên bị xoá mềm trong khoảng ngắn giữa hai bước không đổi kết quả đáng kể: sổ cái vẫn bất biến.
  const student = await db.student.findFirst({
    where: { id: params.studentId, deletedAt: null },
    select: { id: true, centerId: true },
  });
  if (!student) return { ok: false, error: "Không tìm thấy học viên" };
  const orgUnitId = await orgUnitIdForCenter(student.centerId);
  try {
    return await db.$transaction(async (tx) => {
      await khoaHocVien(tx, params.studentId);

      if (eventKey) {
        const cu = await tx.sataCoinTransaction.findUnique({
          where: { studentId_eventKey: { studentId: params.studentId, eventKey } },
          select: { id: true },
        });
        if (cu) return { ok: true, txId: cu.id, trungLap: true };
      }

      // HS2-D4 — giáo viên: đúng học viên phụ trách + trong hạn mức THÁNG. THỨ TỰ KHOÁ: Student (FOR UPDATE, ở trên) TRƯỚC rồi mới khoá giáo viên (advisory) — mọi đường ghi cùng thứ tự ⇒ không đảo khoá/deadlock.
      // Khoá theo GIÁO VIÊN cần vì hai học viên khác nhau của cùng một giáo viên không chung khoá Student, mà cùng đọc «đã dùng trong tháng».
      if (params.createdById && params.roles) {
        await khoaHanMucGiaoVien(tx, params.createdById);
        const kq = await kiemTraNguoiCapCoin(tx, { userId: params.createdById, roles: params.roles, studentId: params.studentId, amount: params.amount });
        if (!kq.ok) return { ok: false, error: kq.loi };
      }

      // Không cho số dư âm khi trừ. Cổng đứng TRƯỚC phép ghi và dưới khoá học viên.
      if (params.amount < 0) {
        // Khả dụng = sổ cái − coin ĐANG GIỮ cho yêu cầu đổi quà (WP8): trừ thẳng vào phần đã giữ sẽ làm yêu cầu đó không còn đủ coin để hoàn tất.
        const v = await soDuVi(tx, params.studentId);
        if (v.khaDung + params.amount < 0) return { ok: false, error: `Số dư không đủ (hiện ${v.khaDung}${v.dangGiu > 0 ? `, đang giữ ${v.dangGiu} cho yêu cầu đổi quà` : ""})` };
      }

      const ghi = await tx.sataCoinTransaction.create({
        data: {
          studentId: params.studentId,
          amount: params.amount,
          type: params.type,
          reason: params.reason,
          note: params.note ?? null,
          ruleCode: params.ruleCode ?? null,
          centerId: student.centerId,
          orgUnitId, // null tường minh ⇒ cơ chế ghi kép không tra thêm (xem ghi chú POOL)
          createdById: params.createdById ?? null,
          eventKey,
        },
        select: { id: true },
      });
      // V8.24 (BR-COIN-01): báo phụ huynh khi con được CỘNG coin (EARN / ADJUST dương). Trừ / đảo KHÔNG báo (chưa có quy định). Cùng transaction với dòng sổ cái.
      if (params.amount > 0 && (params.type === "EARN" || params.type === "ADJUST")) await publishEvent("coin.earned", { txId: ghi.id, studentId: params.studentId }, { tx, dedupeKey: `coin.earned:${ghi.id}` });
      return { ok: true, txId: ghi.id };
    });
  } catch (e) {
    if (e instanceof LoiDoiQua) return { ok: false, error: e.message };
    // Hai lượt cùng `eventKey` lọt qua cổng đọc cùng lúc (không xảy ra dưới khoá, nhưng giữ làm lưới cuối): chỉ mục duy nhất giữ đúng MỘT dòng.
    if (eventKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const cu = await db.sataCoinTransaction.findUnique({ where: { studentId_eventKey: { studentId: params.studentId, eventKey } }, select: { id: true } });
      if (cu) return { ok: true, txId: cu.id, trungLap: true };
    }
    throw e;
  }
}

/**
 * Ghi MỘT dòng sổ cái TRONG transaction của người gọi — KHÔNG mở transaction riêng, KHÔNG khoá, KHÔNG kiểm số dư. Dành cho `doi-qua.ts`: dòng SPEND lúc DELIVERED phải ghi cùng
 * transaction với đổi trạng thái yêu cầu, nên người gọi tự `khoaHocVien` và tự kiểm. `eventKey` trùng ⇒ trả lại dòng cũ (`trungLap`), không ghi thêm.
 * `centerId` / `orgUnitId` do người gọi tra NGOÀI transaction và truyền vào (xem ghi chú POOL).
 */
export async function ghiGiaoDichTrongTx(
  tx: Prisma.TransactionClient,
  params: {
    studentId: string;
    amount: number;
    type: SataCoinTxType;
    reason: string;
    note?: string | null;
    ruleCode?: string | null;
    createdById?: string | null;
    eventKey?: string | null;
    centerId: string | null;
    orgUnitId: string | null;
  },
): Promise<{ txId: string; trungLap: boolean }> {
  if (!Number.isInteger(params.amount) || params.amount === 0) throw new Error("Số coin phải là số nguyên khác 0");
  const eventKey = params.eventKey?.trim() || null;
  if (eventKey) {
    const cu = await tx.sataCoinTransaction.findUnique({ where: { studentId_eventKey: { studentId: params.studentId, eventKey } }, select: { id: true } });
    if (cu) return { txId: cu.id, trungLap: true };
  }
  const ghi = await tx.sataCoinTransaction.create({
    data: {
      studentId: params.studentId,
      amount: params.amount,
      type: params.type,
      reason: params.reason,
      note: params.note ?? null,
      ruleCode: params.ruleCode ?? null,
      centerId: params.centerId,
      orgUnitId: params.orgUnitId,
      createdById: params.createdById ?? null,
      eventKey,
    },
    select: { id: true },
  });
  return { txId: ghi.id, trungLap: false };
}

/** Cộng coin theo rule đang bật. */
export async function grantByRule(params: {
  studentId: string;
  ruleCode: string;
  note?: string | null;
  createdById?: string | null;
  eventKey?: string | null;
  /** Xem `recordTransaction.roles` — bắt buộc khi có người cấp. */
  roles?: readonly string[] | null;
}): Promise<{ ok: boolean; error?: string; txId?: string; trungLap?: boolean }> {
  const rule = await db.sataCoinRule.findFirst({ where: { code: params.ruleCode, isActive: true } });
  if (!rule) return { ok: false, error: "Rule không tồn tại hoặc đã tắt" };
  return recordTransaction({
    studentId: params.studentId,
    amount: rule.amount,
    type: "EARN",
    reason: rule.code,
    ruleCode: rule.code,
    note: params.note ?? rule.label,
    createdById: params.createdById,
    eventKey: params.eventKey,
    roles: params.roles,
  });
}

/**
 * Điều chỉnh = ĐẢO 1 giao dịch (immutable). Tạo giao dịch REVERSAL với amount
 * âm/đối của giao dịch gốc, gắn reversedTxId. KHÔNG sửa giao dịch gốc.
 * Đảo một khoản CỘNG phải còn đủ số dư để trừ lại (không để số dư âm).
 */
export async function reverseTransaction(
  txId: string,
  createdById: string | null,
  note?: string | null,
): Promise<{ ok: boolean; error?: string; reversalId?: string }> {
  const orig = await db.sataCoinTransaction.findUnique({ where: { id: txId } });
  if (!orig) return { ok: false, error: "Không tìm thấy giao dịch" };
  if (orig.type === "REVERSAL") return { ok: false, error: "Không thể đảo một giao dịch đảo" };

  try {
    return await db.$transaction(async (tx) => {
      await khoaHocVien(tx, orig.studentId);

      // Đã bị đảo trước đó? (đọc LẠI dưới khoá: lượt đảo đồng thời kia có thể vừa ghi xong)
      const existing = await tx.sataCoinTransaction.findUnique({ where: { reversedTxId: txId }, select: { id: true } });
      if (existing) return { ok: false, error: "Giao dịch đã được đảo trước đó" };

      // Khoản TRỪ của một yêu cầu đổi quà ĐÃ GIAO (`SataCoinRedemption.spendTxId`): đảo thẳng ở đây trả coin nhưng yêu cầu vẫn «Đã giao» và tồn kho không hoàn ⇒ sổ cái và phiếu lệch nhau.
      // Chưa có quy định hoàn trả sau khi giao ⇒ TỪ CHỐI (không tự đặt chính sách); khi có quy định, hoàn trả phải đi qua luồng đổi quà (đổi trạng thái + tồn kho + đảo trong MỘT transaction).
      const lienKetDoiQua = await tx.sataCoinRedemption.findFirst({ where: { spendTxId: txId }, select: { id: true } });
      if (lienKetDoiQua) return { ok: false, error: "Đây là khoản trừ của một yêu cầu đổi quà đã giao nên không đảo trực tiếp được (chưa có quy định hoàn trả sau khi giao)." };

      if (orig.amount > 0) {
        const v = await soDuVi(tx, orig.studentId);
        if (v.khaDung - orig.amount < 0) return { ok: false, error: `Không thể đảo: coin đã được dùng, số dư sẽ âm (hiện ${v.khaDung}, cần trừ ${orig.amount})` };
      }

      const reversal = await tx.sataCoinTransaction.create({
        data: {
          studentId: orig.studentId,
          amount: -orig.amount,
          type: "REVERSAL",
          reason: `REVERSAL:${orig.reason}`,
          note: note ?? `Đảo giao dịch ${txId}`,
          centerId: orig.centerId,
          orgUnitId: orig.orgUnitId, // sao từ giao dịch gốc, không tra lại (xem ghi chú POOL)
          reversedTxId: txId,
          createdById,
        },
        select: { id: true },
      });
      return { ok: true, reversalId: reversal.id };
    });
  } catch (e) {
    if (e instanceof LoiDoiQua) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, error: "Giao dịch đã được đảo trước đó" };
    throw e;
  }
}
