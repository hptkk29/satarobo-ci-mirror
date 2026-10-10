import "server-only";
// lib/lead/assignment-pool.ts — VÀO POOL / TẠM NGHỈ / QUAY LẠI / CHUYỂN CƠ SỞ.
//
// Đường GHI của pool chia lead. Đường ĐỌC nằm ở `lib/lead/pool.ts` (một chỗ duy nhất
// định nghĩa "ai đang nhận lead"); đường chia nằm ở `assign-lead.ts`.
//
// ═══════════════════════════════════════════════════════════════════════════════
// BA LUẬT KHÔNG ĐƯỢC PHÁ
//
//  1. **Vào vòng thì seed = MIN của vòng đang bật, KHÔNG phải 0.** Seed 0 giữa một
//     vòng đã chạy 100 lượt là người mới hút sạch lead cho tới khi đuổi kịp — hơn
//     trăm phiếu rơi vào một người, và không ai thấy gì bất thường trên màn hình.
//
//  2. **Bật lại KHÔNG đền bù phần đã nghỉ.** Giữ nguyên số cũ (thấp hơn hẳn vì đứng
//     ngoài vài tuần) thì người vừa đi làm lại ôm toàn bộ lead cho tới khi đuổi kịp.
//     Nghỉ phép không phải là quyền được ưu tiên nhận lead lúc quay lại.
//
//  3. **KHÔNG HOÀN LƯỢT** khi lead bị đánh "Đã mất" / trùng / xoá mềm. Hoàn lượt tạo
//     động cơ đánh rớt lead thật nhanh để được chia tiếp. Sai thật thì quản trị dùng
//     `chinhLuotThuCong()` — có lý do bắt buộc, có vết.
// ═══════════════════════════════════════════════════════════════════════════════
//
// MỌI thao tác ở đây chạy trong transaction dưới CÙNG advisory lock với đường chia
// (`lead_rotation:<orgUnitId>`): `activate` phải đọc MIN rồi ghi `turns` nguyên tử,
// mà không khoá thì một lượt chia chen vào giữa hai bước là MIN đã cũ.
//
// KHÔNG kiểm quyền ở tầng này — gate nằm ở Server Action gọi nó (bước 6).

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { orgUnitIdCuaCoSo } from "./pool";

/** Các loại thay đổi pool được ghi vào `LeadAssignmentPoolEvent.action`. */
export type PoolAction =
  | "ADD"
  | "ACTIVATE"
  | "DEACTIVATE"
  | "RESET_UNIT"
  | "MANUAL_ADJUST"
  | "TRANSFER";

export type KetQuaPool = { ok: boolean; error?: string };

type Tx = Prisma.TransactionClient;

/** MIN `turns` của vòng ĐANG BẬT. Vòng rỗng ⇒ 0 (người đầu tiên bắt đầu từ 0). */
async function minVongDangBat(tx: Tx, orgUnitId: string): Promise<number> {
  const rows = await tx.leadRotationTurn.findMany({
    where: { orgUnitId, isActive: true },
    select: { turns: true },
  });
  return rows.length ? Math.min(...rows.map((r) => r.turns)) : 0;
}

async function ghiSuKien(
  tx: Tx,
  p: {
    orgUnitId: string;
    userId: string;
    action: PoolAction;
    fromValue?: Prisma.InputJsonValue;
    toValue?: Prisma.InputJsonValue;
    reason?: string | null;
    actorId: string;
  },
): Promise<void> {
  await tx.leadAssignmentPoolEvent.create({
    data: {
      orgUnitId: p.orgUnitId,
      userId: p.userId,
      action: p.action,
      fromValue: p.fromValue,
      toValue: p.toValue,
      reason: p.reason ?? null,
      actorId: p.actorId,
    },
  });
}

/** Chạy một thao tác pool trong transaction, dưới khoá của đơn vị. */
async function trongKhoa<T>(orgUnitId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lead_rotation:${orgUnitId}`}))`;
      return fn(tx);
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}

/** Cơ sở → đơn vị; không suy được thì mọi thao tác pool đều vô nghĩa. */
async function donVi(centerId: string): Promise<string | null> {
  return orgUnitIdCuaCoSo(centerId);
}

/**
 * THÊM một người vào pool (hoặc bật lại nếu đã có hàng đang tắt).
 *
 * Seed = MIN vòng đang bật — xem luật 1 đầu file.
 */
export async function themVaoPool(params: {
  centerId: string;
  userId: string;
  actorId: string;
  reason?: string | null;
}): Promise<KetQuaPool> {
  const orgUnitId = await donVi(params.centerId);
  if (!orgUnitId) return { ok: false, error: "Cơ sở chưa gắn đơn vị trong cây tổ chức." };

  return trongKhoa(orgUnitId, async (tx) => {
    const cu = await tx.leadRotationTurn.findUnique({
      where: { orgUnitId_userId: { orgUnitId, userId: params.userId } },
      select: { turns: true, seedTurns: true, isActive: true },
    });
    if (cu?.isActive) return { ok: true }; // đã ở trong pool rồi, không làm gì

    const min = await minVongDangBat(tx, orgUnitId);
    await tx.leadRotationTurn.upsert({
      where: { orgUnitId_userId: { orgUnitId, userId: params.userId } },
      update: {
        isActive: true,
        pausedAt: null,
        pausedReason: null,
        turns: min,
        // Giữ nguyên "đã nhận bao nhiêu" cho bảng bằng chứng: dời seed theo đúng mức
        // chênh, nếu không con số `turns - seedTurns` nhảy lung tung sau mỗi lần bật.
        seedTurns: cu ? min - (cu.turns - cu.seedTurns) : min,
      },
      create: {
        orgUnitId,
        userId: params.userId,
        turns: min,
        seedTurns: min,
        isActive: true,
      },
    });
    await ghiSuKien(tx, {
      orgUnitId,
      userId: params.userId,
      action: cu ? "ACTIVATE" : "ADD",
      fromValue: cu ? { turns: cu.turns, isActive: cu.isActive } : undefined,
      toValue: { turns: min, isActive: true },
      reason: params.reason ?? null,
      actorId: params.actorId,
    });
    return { ok: true };
  });
}

/**
 * TẠM NGHỈ — người này thôi nhận lead. Bộ đếm ĐÓNG BĂNG nguyên trạng.
 *
 * ⚠️ `upsert` chứ không `update`: hàng chỉ sinh ra lúc người đó được chia LẦN ĐẦU,
 * nên tắt một người CHƯA từng nhận lead — ca hay gặp nhất ngoài đời — sẽ không có
 * hàng nào để sửa, và `update` ném "Record to update not found".
 *
 * `reason` BẮT BUỘC: tắt là lấy lead khỏi tay người ta.
 */
export async function tamNghiPool(params: {
  centerId: string;
  userId: string;
  reason: string;
  actorId: string;
}): Promise<KetQuaPool> {
  const lyDo = params.reason?.trim();
  if (!lyDo) return { ok: false, error: "Phải ghi lý do khi tắt nhận lead." };

  const orgUnitId = await donVi(params.centerId);
  if (!orgUnitId) return { ok: false, error: "Cơ sở chưa gắn đơn vị trong cây tổ chức." };

  return trongKhoa(orgUnitId, async (tx) => {
    const cu = await tx.leadRotationTurn.findUnique({
      where: { orgUnitId_userId: { orgUnitId, userId: params.userId } },
      select: { turns: true, seedTurns: true, isActive: true },
    });
    const now = new Date();
    await tx.leadRotationTurn.upsert({
      where: { orgUnitId_userId: { orgUnitId, userId: params.userId } },
      update: { isActive: false, pausedAt: now, pausedReason: lyDo },
      create: {
        orgUnitId,
        userId: params.userId,
        turns: 0,
        seedTurns: 0,
        isActive: false,
        pausedAt: now,
        pausedReason: lyDo,
      },
    });
    await ghiSuKien(tx, {
      orgUnitId,
      userId: params.userId,
      action: "DEACTIVATE",
      fromValue: { turns: cu?.turns ?? 0, isActive: cu?.isActive ?? true },
      toValue: { turns: cu?.turns ?? 0, isActive: false },
      reason: lyDo,
      actorId: params.actorId,
    });
    return { ok: true };
  });
}

/** QUAY LẠI nhận lead — seed lại về MIN, KHÔNG đền bù (luật 2 đầu file). */
export async function quayLaiPool(params: {
  centerId: string;
  userId: string;
  actorId: string;
  reason?: string | null;
}): Promise<KetQuaPool> {
  return themVaoPool(params);
}

/**
 * CHUYỂN CƠ SỞ — dựng thành viên ở đơn vị đích (seed MIN), tắt ở đơn vị cũ.
 *
 * Giữ lại hàng cũ chứ không xoá: lịch sử lượt của người đó ở cơ sở cũ là bằng chứng,
 * và họ quay về thì vào đúng chỗ cũ.
 */
export async function chuyenCoSoPool(params: {
  userId: string;
  fromCenterId: string;
  toCenterId: string;
  actorId: string;
  reason?: string | null;
}): Promise<KetQuaPool> {
  if (params.fromCenterId === params.toCenterId) return { ok: true };
  const from = await donVi(params.fromCenterId);
  const to = await donVi(params.toCenterId);
  if (!from || !to) return { ok: false, error: "Cơ sở chưa gắn đơn vị trong cây tổ chức." };

  const lyDo = params.reason?.trim() || "Chuyển cơ sở";
  // Hai đơn vị = hai khoá. KHÔNG gộp vào một transaction giành cả hai khoá: hai người
  // chuyển ngược chiều nhau cùng lúc là ôm khoá chéo rồi deadlock. Tắt bên cũ trước
  // — thứ tự này chỉ có thể để người đó tạm thời không ở pool nào, chứ không bao giờ
  // để họ nhận lead ở hai cơ sở cùng lúc.
  const tat = await tamNghiPool({
    centerId: params.fromCenterId,
    userId: params.userId,
    reason: lyDo,
    actorId: params.actorId,
  });
  if (!tat.ok) return tat;

  const them = await themVaoPool({
    centerId: params.toCenterId,
    userId: params.userId,
    actorId: params.actorId,
    reason: lyDo,
  });
  if (!them.ok) return them;

  await db.leadAssignmentPoolEvent.create({
    data: {
      orgUnitId: to,
      userId: params.userId,
      action: "TRANSFER",
      fromValue: { orgUnitId: from },
      toValue: { orgUnitId: to },
      reason: lyDo,
      actorId: params.actorId,
    },
  });
  return { ok: true };
}

/**
 * ĐẶT LẠI LƯỢT TOÀN ĐƠN VỊ — đưa mọi người đang bật về MIN HIỆN TẠI, **không về 0**.
 *
 * Về 0 nghe công bằng hơn nhưng xoá sạch bằng chứng: sau đó không ai dựng lại được
 * ai đã nhận bao nhiêu. Về MIN đạt đúng mục đích thật (san phẳng chênh lệch) mà vẫn
 * giữ được `turns - seedTurns` của từng người.
 */
export async function datLaiLuotDonVi(params: {
  centerId: string;
  actorId: string;
  reason: string;
}): Promise<KetQuaPool & { soNguoi?: number }> {
  const lyDo = params.reason?.trim();
  if (!lyDo) return { ok: false, error: "Phải ghi lý do khi đặt lại lượt." };
  const orgUnitId = await donVi(params.centerId);
  if (!orgUnitId) return { ok: false, error: "Cơ sở chưa gắn đơn vị trong cây tổ chức." };

  return trongKhoa(orgUnitId, async (tx) => {
    const rows = await tx.leadRotationTurn.findMany({
      where: { orgUnitId, isActive: true },
      select: { userId: true, turns: true, seedTurns: true },
    });
    if (rows.length === 0) return { ok: true, soNguoi: 0 };
    const min = Math.min(...rows.map((r) => r.turns));
    for (const r of rows) {
      if (r.turns === min) continue;
      await tx.leadRotationTurn.update({
        where: { orgUnitId_userId: { orgUnitId, userId: r.userId } },
        data: { turns: min, seedTurns: min - (r.turns - r.seedTurns) },
      });
      await ghiSuKien(tx, {
        orgUnitId,
        userId: r.userId,
        action: "RESET_UNIT",
        fromValue: { turns: r.turns },
        toValue: { turns: min },
        reason: lyDo,
        actorId: params.actorId,
      });
    }
    return { ok: true, soNguoi: rows.length };
  });
}

/**
 * CHỈNH LƯỢT THỦ CÔNG — đường sửa DUY NHẤT khi bộ đếm lệch vì sự cố.
 *
 * Có hàm này nên KHÔNG cần "hoàn lượt" tự động ở bất kỳ đâu (luật 3 đầu file): sai
 * thật thì người có quyền sửa tay, kèm lý do, có vết — chứ không phải hệ thống tự
 * trả lượt mỗi lần một lead bị đánh rớt.
 */
export async function chinhLuotThuCong(params: {
  centerId: string;
  userId: string;
  turns: number;
  reason: string;
  actorId: string;
}): Promise<KetQuaPool> {
  const lyDo = params.reason?.trim();
  if (!lyDo) return { ok: false, error: "Phải ghi lý do khi chỉnh lượt." };
  if (!Number.isInteger(params.turns) || params.turns < 0) {
    return { ok: false, error: "Số lượt phải là số nguyên không âm." };
  }
  const orgUnitId = await donVi(params.centerId);
  if (!orgUnitId) return { ok: false, error: "Cơ sở chưa gắn đơn vị trong cây tổ chức." };

  return trongKhoa(orgUnitId, async (tx) => {
    const cu = await tx.leadRotationTurn.findUnique({
      where: { orgUnitId_userId: { orgUnitId, userId: params.userId } },
      select: { turns: true, seedTurns: true },
    });
    if (!cu) return { ok: false, error: "Người này chưa có trong sổ lượt của cơ sở." };
    await tx.leadRotationTurn.update({
      where: { orgUnitId_userId: { orgUnitId, userId: params.userId } },
      // KHÔNG dời `seedTurns` ở đây — cố ý. Chỉnh tay là sửa SỐ LƯỢT ĐÃ NHẬN (đó là
      // lý do người ta bấm nút này), khác hẳn `activate`/`reset` chỉ dời vị trí trong
      // vòng mà không đụng thành tích.
      data: { turns: params.turns },
    });
    await ghiSuKien(tx, {
      orgUnitId,
      userId: params.userId,
      action: "MANUAL_ADJUST",
      fromValue: { turns: cu.turns, seedTurns: cu.seedTurns },
      toValue: { turns: params.turns, seedTurns: cu.seedTurns },
      reason: lyDo,
      actorId: params.actorId,
    });
    return { ok: true };
  });
}
