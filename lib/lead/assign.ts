import { db } from "@/lib/db";
import { logLeadAudit } from "@/lib/audit/log";
import { recordLeadStatusChange } from "@/lib/lead/status-trail-write";
import { recordLeadActivity } from "@/lib/lead/activity-write";
import { SYSTEM_ACTIVITY_META } from "@/lib/lead/activity-clock";
import { assignmentWrite } from "@/lib/lead/assignment";
import { baoLoLeadMoi, baoSaleCoLeadMoi, thuHoiChuongLeadCu } from "@/lib/lead/assign-lead";
import { takeRotationTurn, takeRotationTurns } from "@/lib/lead/rotation";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { LEAD_CLOSED_STATUSES } from "@/lib/leads/status";
import type { Prisma } from "@prisma/client";

// =============================================================================
// LEAD AUTO-ASSIGN — round-robin theo cơ sở (Phase T1.3)
// =============================================================================

// Lead "đang mở" = chưa kết thúc → tính tải cho round-robin.
// GĐ0 — định nghĩa chuyển về @/lib/leads/status (trước đó cùng danh sách này nằm ở
// 5 file rời: 4 bản giống nhau và 1 bản có thêm REGISTERED, không ai biết vì sao lệch).
/** @deprecated Tên cũ. Dùng `LEAD_CLOSED_STATUSES` từ `@/lib/leads/status`. */
export const TERMINAL_LEAD_STATUSES = LEAD_CLOSED_STATUSES;

/**
 * Điều kiện "lead còn là VIỆC ĐANG MỞ của Sale" (bản sao của cùng luật ở
 * `lib/lead/auto-assign.ts` — hai đường chia độc lập, sửa một bên nhớ sửa bên kia).
 *
 * ⚠️ `status notIn LEAD_CLOSED_STATUSES` MỘT MÌNH LÀ THIẾU: sau GĐ5 tập đóng chỉ còn
 * `DA_MAT`, nên lead đã convert xong (đã thành học viên) vẫn mang `DA_DANG_KY` và bị
 * đếm là tải mở VĨNH VIỄN ⇒ Sale lâu năm bị coi là quá tải, ngừng nhận lead mới.
 * `convertedAt` do chính lượt convert ghi nên nó mới là dấu "đã xong thật".
 */
const LEAD_DANG_MO = {
  deletedAt: null,
  status: { notIn: TERMINAL_LEAD_STATUSES },
  convertedAt: null,
} satisfies Prisma.LeadWhereInput;

export type AssigneeLoad = { id: string; openCount: number };
export type Actor = { actorId: string | null; actorName: string };

// ─── Pure functions (test được, không chạm DB) ───────────────────────────────

/**
 * Chọn sale ít lead mở nhất; tie-break theo id để ổn định.
 *
 * ⚠️ KHÔNG CÒN ĐƯỜNG CHIA NÀO GỌI HÀM NÀY (Đợt D, 22/08/2026) — chủ dự án chốt
 * chia đều theo SỐ LƯỢT, không theo tải. Giữ lại vì hàm thuần, có test riêng, và
 * còn là bản đối chứng khi cần so hai cách chia. Đừng nối lại vào luồng chia.
 */
export function pickAssignee(candidates: AssigneeLoad[]): string | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) => a.openCount - b.openCount || a.id.localeCompare(b.id),
  )[0].id;
}

/**
 * Chia danh sách lead cho các sale theo round-robin, cân bằng TRÊN tải hiện có.
 * Trả về Map leadId → assigneeId.
 *
 * ⚠️ Thay bằng `planFairTurns` (lib/lead/rotation.ts) từ Đợt D — xem ghi chú ở
 * `pickAssignee`. Giữ lại cùng lý do.
 */
export function distributeRoundRobin(
  leadIds: string[],
  initial: AssigneeLoad[],
): Map<string, string> {
  const result = new Map<string, string>();
  if (initial.length === 0) return result;
  const load = initial.map((a) => ({ ...a }));
  for (const leadId of leadIds) {
    load.sort((a, b) => a.openCount - b.openCount || a.id.localeCompare(b.id));
    const target = load[0];
    result.set(leadId, target.id);
    target.openCount++;
  }
  return result;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/** Tải hiện tại của SALES_CSM active (trong cùng cơ sở nếu có centerId). */
export async function getSalesLoad(
  centerId: string | null,
): Promise<AssigneeLoad[]> {
  const sales = await db.user.findMany({
    where: {
      // Đa vai trò (3B): tính cả người có SALES_CSM ở vị trí PHỤ.
      roles: { has: "SALES_CSM" },
      isActive: true,
      deletedAt: null,
      ...(centerId ? { centerId } : {}),
    },
    select: { id: true },
  });
  if (sales.length === 0) return [];

  const counts = await db.lead.groupBy({
    by: ["assignedToId"],
    where: {
      assignedToId: { in: sales.map((s) => s.id) },
      ...LEAD_DANG_MO,
    },
    _count: { id: true },
  });
  const loadMap = new Map(
    counts.map((c) => [c.assignedToId, c._count.id] as const),
  );
  return sales.map((s) => ({ id: s.id, openCount: loadMap.get(s.id) ?? 0 }));
}

/**
 * Tự động gán 1 lead cho sale TỚI LƯỢT trong cùng cơ sở. Ghi audit + activity.
 *
 * ⚠️ Đợt D (22/08/2026) — VIẾT LẠI PHẦN CHỌN NGƯỜI. Đây là đường chia THỨ HAI
 * của repo (đường kia là `autoAssignNewLead`), còn sống ở nút "chia lại lead"
 * trên bảng kanban và ở webhook nhận lead bản cũ. Vá một đường mà bỏ đường này
 * thì luật "chia đều tuyệt đối" chỉ đúng với một phần lead — đúng cái bẫy mà
 * chẩn đoán prod 21/08 đã chỉ ra (69% lead không đi qua vòng chia).
 *
 * Hai thay đổi: (1) chọn theo SỔ LƯỢT thay vì ít-tải-nhất; (2) BỎ fallback chia
 * xuyên cơ sở — người nhận không mở nổi lead ngoài cơ sở mình (`scopedDb`).
 */
export async function autoAssignLead(
  leadId: string,
  actor: Actor,
): Promise<{ ok: boolean; assignedToId?: string; error?: string }> {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, centerId: true, status: true, assignedToId: true },
  });
  if (!lead) return { ok: false, error: "Lead không tồn tại" };

  const load = await getSalesLoad(lead.centerId);
  if (load.length === 0) {
    return { ok: false, error: "Cơ sở này không có tư vấn viên đang hoạt động để giao lead" };
  }
  const orgUnitId = lead.centerId ? await orgUnitIdForCenter(lead.centerId) : null;
  if (!orgUnitId) {
    return { ok: false, error: "Lead chưa thuộc cơ sở nào — chọn cơ sở trước khi chia" };
  }
  const target = await takeRotationTurn(orgUnitId, load.map((l) => l.id));
  if (!target) return { ok: false, error: "Không có SALES_CSM active để gán" };

  const targetUser = await db.user.findUnique({
    where: { id: target },
    select: { name: true },
  });

  await db.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: assignmentWrite(target), // Đợt A — kèm mốc phân công (đường cũ, 3 webhook)
    });
    // GĐ5 — ĐÃ GỠ lượt đổi trạng thái NEW→ASSIGNED ở đây.
    //
    // Điều kiện cũ ("chỉ đổi từ NEW, không kéo ngược lead đã liên hệ về Đã phân
    // công") nay tự thoả: NEW và ASSIGNED cùng ánh xạ về MOI, nên lệnh ghi chỉ có
    // thể là MOI→MOI và `setLeadStatus` sẽ trả KHONG_DOI. `assignmentWrite(target)`
    // ngay trên vẫn ghi assignedToId + assignedAt — đó mới là nơi đọc ra việc phân
    // công — và dòng audit ASSIGN bên dưới vẫn vào sổ.
    await logLeadAudit({
      leadId,
      action: "ASSIGN",
      actorId: actor.actorId,
      actorName: actor.actorName,
      oldValues: { assignedToId: lead.assignedToId },
      newValues: { assignedToId: target },
      changedFields: ["assignedToId"],
      tx,
    });
    await recordLeadActivity({
      tx,
      leadId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      type: "NOTE",
      content: `Phân công cho ${targetUser?.name ?? target} (luân phiên đều lượt)`,
      // S-3 — DÒNG MÁY: điều phối lead, không phải một lần chạm khách. Thiếu dấu
      // này thì lượt chia tự tay đóng luôn mốc "đã liên hệ lần đầu".
      metadata: { ...SYSTEM_ACTIVITY_META, assignedToId: target } as Prisma.InputJsonValue,
    });
    // C-07 — lượt chia LẬT LUÔN trạng thái `MỚI → ĐÃ PHÂN CÔNG` ngay trên dòng
    // `tx.lead.update` ở trên, nhưng vết duy nhất của nó là dòng audit `ASSIGN`
    // chỉ mang `assignedToId`. Tức mốc đầu tiên của mọi phễu KHÔNG được ghi vào
    // bảng nào — không lần ra được "lead nằm ở MỚI bao lâu, ai đẩy nó đi".
    //
    // ⚠️ Điều kiện phải TRÙNG KHÍT với điều kiện lật trạng thái ở trên: lead đang
    // ở bước sau (vd Đang tư vấn) được chia lại thì trạng thái KHÔNG đổi — ghi vết
    // vô điều kiện là bịa ra một lượt "Đang tư vấn → Đã phân công" chưa từng xảy ra.
    if (lead.status === "MOI") {
      await recordLeadStatusChange({
        tx,
        leadId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        from: "NEW",
        to: "ASSIGNED",
        source: "ASSIGN",
      });
    }
  });

  // 15/09/2026 — đồng bộ chuông. Đây là đường MỘT lead (không hàng loạt) nên báo được cả hai
  // đầu, đúng như `chiaChoLead` và `manualAssignLead` vẫn làm.
  //
  // Trước bản vá: đường này ghi `assignedToId` rồi im lặng — chủ mới không biết mình có lead,
  // chủ cũ (nếu có) giữ lại một cái chuông trỏ tới lead đã mất.
  await thuHoiChuongLeadCu({ chuCuId: lead.assignedToId, chuMoiId: target, leadId });
  if (target !== lead.assignedToId) {
    const ten = await db.lead.findUnique({ where: { id: leadId }, select: { parentName: true } });
    await baoSaleCoLeadMoi({
      ownerId: target,
      leadId,
      parentName: ten?.parentName ?? "",
      // Máy rút theo sổ lượt, không phải người giao tay.
      source: "AUTO",
    });
  }

  return { ok: true, assignedToId: target };
}

/**
 * Chia lại toàn bộ lead "đang mở" của 1 sale (vd khi nghỉ việc) cho các sale
 * còn lại theo round-robin. Gọi SAU khi user đã deactivate để getSalesLoad
 * không tính người này.
 */
export async function reassignOpenLeads(
  userId: string,
  actor: Actor,
): Promise<{ ok: boolean; reassigned: number; error?: string }> {
  const leaving = await db.user.findUnique({
    where: { id: userId },
    select: { centerId: true },
  });

  // Chỉ kéo theo lead CÒN VIỆC. Lead đã convert xong không cần người mới tiếp quản —
  // ném chúng sang sale khác chỉ làm phồng sổ lượt và làm loãng bảng hiệu suất.
  const openLeads = await db.lead.findMany({
    where: { assignedToId: userId, ...LEAD_DANG_MO },
    select: { id: true },
  });
  if (openLeads.length === 0) return { ok: true, reassigned: 0 };

  // Đợt D — cùng luật với hai đường chia kia: theo SỔ LƯỢT, KHÔNG xuyên cơ sở.
  // Không còn sale trong cơ sở ⇒ báo lỗi và ĐỂ NGUYÊN lead ở người vừa nghỉ.
  // Nghe khó chịu, nhưng lead nằm ở tài khoản đã khoá thì quản lý vẫn thấy và
  // giao tay được; còn ném sang cơ sở khác thì thành lead không ai mở nổi.
  const load = (await getSalesLoad(leaving?.centerId ?? null)).filter((l) => l.id !== userId);
  if (load.length === 0) {
    return { ok: false, reassigned: 0, error: "Không còn tư vấn viên trong cơ sở để chia lại" };
  }
  const orgUnitId = leaving?.centerId ? await orgUnitIdForCenter(leaving.centerId) : null;
  if (!orgUnitId) {
    return { ok: false, reassigned: 0, error: "Không suy được đơn vị của người nghỉ để ghi sổ lượt" };
  }

  // Một lần khoá cho cả rổ — xem takeRotationTurns.
  const ke = await takeRotationTurns(orgUnitId, load.map((l) => l.id), openLeads.length);
  const dist = new Map<string, string>();
  openLeads.forEach((l, i) => {
    const nguoiNhan = ke[i];
    if (nguoiNhan) dist.set(l.id, nguoiNhan);
  });
  if (dist.size === 0) {
    return { ok: false, reassigned: 0, error: "Không còn tư vấn viên trong cơ sở để chia lại" };
  }

  const nameMap = new Map(
    (
      await db.user.findMany({
        where: { id: { in: [...new Set(dist.values())] } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name] as const),
  );

  await db.$transaction(async (tx) => {
    for (const [leadId, assigneeId] of dist) {
      await tx.lead.update({
        where: { id: leadId },
        data: assignmentWrite(assigneeId), // Đợt A — kèm mốc phân công
      });
      await logLeadAudit({
        leadId,
        action: "ASSIGN",
        actorId: actor.actorId,
        actorName: actor.actorName,
        oldValues: { assignedToId: userId },
        newValues: { assignedToId: assigneeId },
        changedFields: ["assignedToId"],
        tx,
      });
      await recordLeadActivity({
        tx,
        leadId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        type: "NOTE",
        content: `Chia lại lead → ${nameMap.get(assigneeId) ?? assigneeId} (sale cũ nghỉ)`,
        metadata: SYSTEM_ACTIVITY_META, // S-3 — dòng máy, xem ghi chú ở lượt chia trên.
      });
    }
  });

  // 15/09/2026 — THU HỒI chuông "Bạn có lead mới" của sale vừa nghỉ.
  //
  // Thiếu bước này thì mỗi lượt chia lại để lại ở người nghỉ đúng bằng số lead một đống chuông
  // trỏ tới lead họ không còn giữ. Tài khoản đã khoá nên ít ai thấy — nhưng cùng một lỗ này
  // cũng có ở đường bàn giao hàng loạt, nơi người cũ VẪN đang đi làm.
  //
  for (const [leadId, assigneeId] of dist) {
    await thuHoiChuongLeadCu({ chuCuId: userId, chuMoiId: assigneeId, leadId });
  }

  // 15/09/2026 (đợt hai) — BÁO CHO NGƯỜI NHẬN, gộp theo từng người.
  //
  // Đường này chia VÒNG nên một lượt có thể rải cho nhiều người: ai nhận 1 lead thì được
  // chuông thường (trỏ thẳng trang chi tiết), ai nhận từ 2 trở lên thì một tin gộp.
  // `baoLoLeadMoi` tự chọn giùm — đừng tự đếm lại ở đây.
  //
  // MỘT mốc cho cả lượt: tính lại theo từng người là hai lượt chia cách nhau một nhịp đồng hồ
  // cũng ra hai khoá, đúng thứ khoá chống trùng sinh ra để chặn.
  const nguoiNghi = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  await baoLoLeadMoi({
    daChia: [...dist].map(([leadId, ownerId]) => ({ leadId, ownerId })),
    nguon: { kieu: "sale_nghi", tuNguoi: nguoiNghi?.name ?? "tư vấn viên đã nghỉ" },
    mocLuot: Date.now(),
    boQuaNguoi: actor.actorId,
  });

  // Báo đúng số ĐÃ chia, không phải số lead tìm thấy — hai số này bằng nhau ở
  // đường đi thường, nhưng báo theo số thật thì khi lệch còn nhìn ra.
  return { ok: true, reassigned: dist.size };
}
