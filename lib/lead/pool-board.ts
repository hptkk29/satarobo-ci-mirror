import "server-only";
// lib/lead/pool-board.ts — DỮ LIỆU CHO MÀN "Quản lý chia lead" (chỉ đọc).
//
// Tách khỏi page để test được và để hai tab không tự dựng truy vấn riêng.
//
// ⚠️ Bảng này phải nói ĐÚNG hai con số khác nhau, đừng gộp:
//   · "Lượt đã nhận"      = `turns - seedTurns` — chỉ đếm lead do MÁY chia;
//   · "Tổng lead đang giữ" = đếm trên bảng Lead — gồm cả lead sale tự nhập, quản lý
//     giao tay, import có sẵn tên sale.
// Số thứ hai gần như luôn cao hơn số thứ nhất. Đó KHÔNG phải lỗi, và banner dưới
// bảng nói đúng câu đó — xem `app/(admin)/admin/quan-ly-chia-lead/page.tsx`.

import { db } from "@/lib/db";
import { LEAD_CLOSED_STATUSES } from "@/lib/leads/status";
import { orgUnitIdCuaCoSo } from "./pool";

/**
 * "Lead đang mở" — CÙNG định nghĩa với `lib/lead/assign.ts`.
 *
 * `convertedAt: null` là vế dễ quên nhất: sau GĐ5, lead đã convert thành học viên vẫn
 * mang `DA_DANG_KY` (không phải trạng thái kết thúc), nên thiếu vế này thì Sale lâu
 * năm bị đếm là quá tải vĩnh viễn.
 */
const LEAD_DANG_MO = {
  deletedAt: null,
  status: { notIn: LEAD_CLOSED_STATUSES },
  convertedAt: null,
} as const;

export type DongPool = {
  userId: string;
  name: string | null;
  email: string | null;
  /** Đang nhận lead không. */
  dangNhan: boolean;
  /** `turns - seedTurns` — số lead MÁY chia cho người này. */
  luotDaNhan: number;
  /** Vị trí trong vòng (`turns`) — cần cho ô "chỉnh lượt thủ công". */
  viTriVong: number;
  /** Tổng lead đang giữ (mọi nguồn, chưa đóng). */
  tongDangGiu: number;
  lanChiaGanNhat: Date | null;
  lyDoTam: string | null;
  /** `false` = chưa có hàng trong sổ (chưa từng được chia, vẫn nằm trong pool). */
  daCoHang: boolean;
};

/**
 * Bảng pool của MỘT cơ sở.
 *
 * Tập người = pool đang bật ∪ người đã bị tắt ∪ sale của cơ sở chưa có hàng. Phải
 * gồm CẢ NGƯỜI ĐÃ TẮT, nếu không thì tắt xong họ biến mất khỏi màn và không ai bật
 * lại được — đúng kiểu bẫy một chiều.
 */
export async function layBangPool(centerId: string): Promise<DongPool[]> {
  const orgUnitId = await orgUnitIdCuaCoSo(centerId);
  const [rows, sales] = await Promise.all([
    orgUnitId
      ? db.leadRotationTurn.findMany({
          where: { orgUnitId },
          select: {
            userId: true,
            turns: true,
            seedTurns: true,
            lastTurnAt: true,
            isActive: true,
            pausedReason: true,
          },
        })
      : Promise.resolve([]),
    db.user.findMany({
      where: { centerId, isActive: true, deletedAt: null, roles: { has: "SALES_CSM" } },
      select: { id: true, name: true, email: true },
    }),
  ]);

  const theoUser = new Map(rows.map((r) => [r.userId, r]));
  const ids = new Set<string>([...rows.map((r) => r.userId), ...sales.map((s) => s.id)]);
  if (ids.size === 0) return [];

  const [nguoi, dangGiu] = await Promise.all([
    db.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true, email: true },
    }),
    db.lead.groupBy({
      by: ["assignedToId"],
      where: { assignedToId: { in: [...ids] }, ...LEAD_DANG_MO },
      _count: { id: true },
    }),
  ]);
  const tenTheoId = new Map(nguoi.map((u) => [u.id, u]));
  const giuTheoId = new Map(dangGiu.map((g) => [g.assignedToId, g._count.id]));

  const out: DongPool[] = [...ids].map((id) => {
    const r = theoUser.get(id);
    const u = tenTheoId.get(id);
    return {
      userId: id,
      name: u?.name ?? null,
      email: u?.email ?? null,
      // Chưa có hàng = người mới, pool tự vớt (xem `layPoolDangBat`) ⇒ ĐANG nhận.
      dangNhan: r ? r.isActive : true,
      luotDaNhan: r ? r.turns - r.seedTurns : 0,
      viTriVong: r?.turns ?? 0,
      tongDangGiu: giuTheoId.get(id) ?? 0,
      lanChiaGanNhat: r?.lastTurnAt ?? null,
      lyDoTam: r?.isActive === false ? r.pausedReason : null,
      daCoHang: !!r,
    };
  });

  // Người đang nhận lên trước, trong đó ít lượt đứng trước — cùng thứ tự với vòng
  // chia, để nhìn bảng là đoán được ai sắp tới lượt.
  return out.sort((a, b) => {
    if (a.dangNhan !== b.dangNhan) return a.dangNhan ? -1 : 1;
    if (a.luotDaNhan !== b.luotDaNhan) return a.luotDaNhan - b.luotDaNhan;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

export type CoSoTheoKhuVuc = {
  id: string;
  name: string;
  /** Khu vực (OrgUnit type REGION) chứa cơ sở này; null = chưa gắn khu vực nào. */
  khuVucId: string | null;
  khuVucTen: string | null;
};

/**
 * Cơ sở kèm KHU VỰC — cho ô chọn hai tầng ở màn Quản lý chia lead.
 *
 * Cây tổ chức là HO → REGION → CENTER (chốt 11/08), nên khu vực là CHA của node cơ sở.
 * Cơ sở chưa gắn khu vực (hoặc cha không phải REGION) vẫn PHẢI trả về — gom vào nhóm
 * "Chưa gắn khu vực" ở UI. Lọc bỏ là người vận hành mất hẳn đường vào cơ sở đó mà
 * không có lỗi nào báo.
 */
export async function layCoSoTheoKhuVuc(centerIds: string[]): Promise<CoSoTheoKhuVuc[]> {
  if (centerIds.length === 0) return [];
  const centers = await db.center.findMany({
    where: { id: { in: centerIds } },
    select: { id: true, name: true, code: true, displayOrder: true },
    orderBy: { displayOrder: "asc" },
  });
  // Nối Center → OrgUnit theo `code` (cầu nối chuẩn — xem lib/org/center-bridge.ts),
  // rồi lấy CHA nếu cha là REGION.
  const units = await db.orgUnit.findMany({
    where: { code: { in: centers.map((c) => c.code).filter(Boolean) as string[] }, deletedAt: null },
    select: { code: true, parent: { select: { id: true, name: true, type: true } } },
  });
  const chaTheoCode = new Map(units.map((u) => [u.code, u.parent]));
  return centers.map((c) => {
    const cha = c.code ? chaTheoCode.get(c.code) : null;
    const laKhuVuc = cha?.type === "REGION";
    return {
      id: c.id,
      name: c.name,
      khuVucId: laKhuVuc ? cha!.id : null,
      khuVucTen: laKhuVuc ? cha!.name : null,
    };
  });
}

export type DongSoChia = {
  id: string;
  createdAt: Date;
  leadId: string | null;
  parentName: string | null;
  phone: string | null;
  centerName: string | null;
  nguoiNhap: string | null;
  chiaCho: string | null;
  source: string;
  consumedTurn: boolean;
  turnCountAfter: number | null;
  poolSnapshot: unknown;
};

export type LocSoChia = {
  orgUnitIds: string[];
  tuNgay: Date;
  denNgay: Date;
  saleId?: string | null;
  source?: string | null;
  tieuLuot?: "co" | "khong" | null;
  trang: number;
  moiTrang: number;
};

/** Sổ chia lead — phân trang phía server (bảng này chỉ có thêm, không bao giờ bớt). */
export async function laySoChia(
  loc: LocSoChia,
): Promise<{ rows: DongSoChia[]; tong: number }> {
  const where = {
    orgUnitId: { in: loc.orgUnitIds },
    createdAt: { gte: loc.tuNgay, lte: loc.denNgay },
    ...(loc.saleId ? { assignedToId: loc.saleId } : {}),
    ...(loc.source ? { source: loc.source as never } : {}),
    ...(loc.tieuLuot ? { consumedTurn: loc.tieuLuot === "co" } : {}),
  };
  const [tong, raw] = await Promise.all([
    db.leadAssignmentLog.count({ where }),
    db.leadAssignmentLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (loc.trang - 1) * loc.moiTrang,
      take: loc.moiTrang,
      select: {
        id: true,
        createdAt: true,
        leadId: true,
        assignedToId: true,
        createdById: true,
        source: true,
        consumedTurn: true,
        turnCountAfter: true,
        poolSnapshot: true,
      },
    }),
  ]);
  if (raw.length === 0) return { rows: [], tong };

  // Nạp phụ TỪNG MẺ thay vì `include`: sổ này chỉ hiện tên, mà `include` kéo cả quan
  // hệ Lead → Center trên mỗi dòng là 3 lượt join cho một cột chữ.
  const leadIds = raw.map((r) => r.leadId).filter(Boolean) as string[];
  const userIds = [
    ...new Set([...raw.map((r) => r.assignedToId), ...raw.map((r) => r.createdById)].filter(Boolean)),
  ] as string[];
  const [leads, users] = await Promise.all([
    leadIds.length
      ? db.lead.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, parentName: true, phone: true, center: { select: { name: true } } },
        })
      : Promise.resolve([]),
    userIds.length
      ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const userById = new Map(users.map((u) => [u.id, u.name]));

  return {
    tong,
    rows: raw.map((r) => {
      const l = r.leadId ? leadById.get(r.leadId) : null;
      return {
        id: r.id,
        createdAt: r.createdAt,
        leadId: r.leadId,
        parentName: l?.parentName ?? null,
        phone: l?.phone ?? null,
        centerName: l?.center?.name ?? null,
        nguoiNhap: r.createdById ? (userById.get(r.createdById) ?? null) : null,
        chiaCho: r.assignedToId ? (userById.get(r.assignedToId) ?? null) : null,
        source: r.source,
        consumedTurn: r.consumedTurn,
        turnCountAfter: r.turnCountAfter,
        poolSnapshot: r.poolSnapshot,
      };
    }),
  };
}
