// lib/lead/pool.ts — AI ĐANG NHẬN LEAD Ở ĐƠN VỊ NÀY.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ĐÂY LÀ NƠI DUY NHẤT ĐỊNH NGHĨA "POOL". Mọi đường chia — luân phiên, tỷ lệ chốt,
// màn quản lý — đều hỏi hàm này. Có hai định nghĩa là có hai câu trả lời khác nhau
// cho cùng một câu hỏi, và người vận hành sẽ thấy màn quản lý nói một đằng, lead
// chạy một nẻo.
// ═══════════════════════════════════════════════════════════════════════════════
//
// Luật (29/08/2026):
//
//   pool = (hàng `LeadRotationTurn` có `isActive = true`)
//        ∪ (sale của đơn vị CHƯA CÓ hàng nào — người mới, tự vào)
//
// Vế thứ hai bắt buộc phải có. Trước 29/08 hàng chỉ sinh ra lúc ai đó được chia
// LẦN ĐẦU; migration đã dựng hàng cho toàn bộ sale đang có, nhưng **tài khoản tạo
// SAU migration thì không ai dựng hộ**. Bỏ vế này đi thì sale mới tuyển lặng lẽ
// không nhận lead nào cho tới khi có người phát hiện — hỏng đúng kiểu không báo lỗi.
//
// Còn người BỊ TẮT thì có hàng với `isActive = false` ⇒ vế hai không vớt họ lại.
// Hai vế cộng lại cho đúng cả hai điều: người mới tự vào, người bị tắt đứng ngoài.

import { db } from "@/lib/db";
import type { Prisma, PrismaClient } from "@prisma/client";

/** Client hoặc transaction — hàm dưới gọi được từ trong `$transaction`. */
type Db = PrismaClient | Prisma.TransactionClient;

export type ThanhVienPool = {
  userId: string;
  turns: number;
  seedTurns: number;
  lastTurnAt: Date | null;
  /** `false` = người mới chưa có hàng trong sổ (sẽ được ghi danh lúc chia). */
  daCoHang: boolean;
};

/**
 * Tra `orgUnitId` của một cơ sở — MỘT truy vấn, không phải hai.
 *
 * ⚠️ 30/08 — bản đầu đi vòng qua `Center.code` rồi tra `OrgUnit.code`: hai lượt hỏi DB
 * cho MỖI lead được chia. Trên CI bộ R7 phình từ 7 phút lên 25 phút và bị cắt giữa
 * chừng. `OrgUnit.centerId` là cột @unique có sẵn (ánh xạ 1-1, chỉ type=CENTER mang
 * giá trị) nên hỏi thẳng là đủ — đây cũng đúng hàm `orgUnitIdForCenter` mà đường chia
 * cũ vẫn dùng, chỉ là tôi đã vô tình dựng bản thứ hai.
 *
 * CỐ Ý KHÔNG đệm ở cấp module: bộ test dựng lại DB nhiều lần trong CÙNG một tiến
 * trình, nên một id nhớ sai sống qua `resetDb()` sẽ làm hỏng các ca sau theo kiểu
 * rất khó truy. Một truy vấn có index là đủ rẻ.
 */
export async function orgUnitIdCuaCoSo(centerId: string, dbc: Db = db): Promise<string | null> {
  const unit = await dbc.orgUnit.findFirst({
    where: { centerId, deletedAt: null },
    select: { id: true },
  });
  return unit?.id ?? null;
}

/**
 * Danh sách người ĐANG NHẬN LEAD của một đơn vị.
 *
 * `centerId` dùng để tìm sale "chưa có hàng" (vai trò gắn với `User.centerId`);
 * truyền `null` thì chỉ trả những người đã có hàng đang bật.
 *
 * Trả về theo thứ tự CHIA: `turns` tăng dần → `lastTurnAt` cũ nhất (chưa bao giờ
 * nhận thì đứng trước) → `userId`. Cùng thứ tự với `pickFairTurn` trong
 * `rotation.ts`, cố ý — màn quản lý và đường chia phải xếp giống nhau, nếu không
 * người vận hành nhìn bảng rồi đoán sai ai là người kế tiếp.
 */
export async function layPoolDangBat(
  orgUnitId: string,
  centerId: string | null,
  dbc: Db = db,
): Promise<ThanhVienPool[]> {
  const rows = await dbc.leadRotationTurn.findMany({
    where: { orgUnitId },
    select: { userId: true, turns: true, seedTurns: true, lastTurnAt: true, isActive: true },
  });
  const daBiTat = new Set(rows.filter((r) => !r.isActive).map((r) => r.userId));
  const daCoHang = new Set(rows.map((r) => r.userId));

  const out: ThanhVienPool[] = rows
    .filter((r) => r.isActive)
    .map((r) => ({
      userId: r.userId,
      turns: r.turns,
      seedTurns: r.seedTurns,
      lastTurnAt: r.lastTurnAt,
      daCoHang: true,
    }));

  if (centerId) {
    const sales = await dbc.user.findMany({
      where: {
        centerId,
        isActive: true,
        deletedAt: null,
        roles: { has: "SALES_CSM" },
      },
      select: { id: true },
    });
    // Khởi điểm của người mới = MIN của vòng đang bật, KHÔNG phải 0. Seed 0 giữa
    // một vòng đã chạy 100 lượt là người mới hút sạch lead cho tới khi đuổi kịp.
    const min = out.length ? Math.min(...out.map((m) => m.turns)) : 0;
    for (const s of sales) {
      if (daCoHang.has(s.id) || daBiTat.has(s.id)) continue;
      out.push({ userId: s.id, turns: min, seedTurns: min, lastTurnAt: null, daCoHang: false });
    }
  }

  return out.sort((a, b) => {
    if (a.turns !== b.turns) return a.turns - b.turns;
    const ta = a.lastTurnAt ? a.lastTurnAt.getTime() : -Infinity;
    const tb = b.lastTurnAt ? b.lastTurnAt.getTime() : -Infinity;
    if (ta !== tb) return ta - tb;
    return a.userId.localeCompare(b.userId);
  });
}

/** Ảnh chụp pool để lưu vào `LeadAssignmentLog.poolSnapshot`. */
export function anhChupPool(pool: ThanhVienPool[]): { userId: string; turns: number; isActive: true }[] {
  return pool.map((m) => ({ userId: m.userId, turns: m.turns, isActive: true as const }));
}
