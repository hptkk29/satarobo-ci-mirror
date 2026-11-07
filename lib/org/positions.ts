// lib/org/positions.ts — P2 · US-08: VỊ TRÍ CÔNG VIỆC (BA §2.4).
//
// Hai việc, và chỉ hai:
//   1. `assertNoReportingCycle` — chống vòng lặp trên cây báo cáo (TS-09).
//   2. `loadPositionRoleRows` — nạp vai của các vị trí mà user đang giữ, TRẢ VỀ ĐÚNG
//      KHUÔN `UserOrgRoleRow` để đổ thẳng vào `buildActor`.
//
// ⚠️ VÌ SAO TRẢ VỀ KHUÔN `UserOrgRoleRow` CHỨ KHÔNG ĐẺ ĐƯỜNG QUYỀN THỨ HAI: mọi logic
// scope đã nằm trong `buildActor` — `centerScope` theo subtree, `isHoLevel` khi vai đặt
// tại HO/ROOT, `visibleCenterIds`, `visibleOrgUnitIds`. Nếu Position resolve riêng thì
// hai đường sẽ trôi lệch nhau, và cái lệch đó chỉ lộ ra khi ai đó vừa có `UserOrgRole`
// vừa có `PositionAssignment` — đúng tập người khó dựng lại nhất. Position vì thế chỉ là
// một NGUỒN THỨ HAI của cùng một loại dữ liệu: "vai X tại đơn vị Y, hiệu lực từ… đến…".
//
// ⚠️ HẾT HẠN LÀ THUỘC TÍNH CỦA RESOLVER, KHÔNG PHẢI VIỆC CỦA CRON (luật cứng #8 + US-09
// AC2): bộ lọc thời gian nằm ngay trong truy vấn dưới đây, nên assignment quá hạn tắt
// quyền ngay ở request kế tiếp mà không ai phải đi dọn.
import { db } from "@/lib/db";
import type { ScopeType, UserOrgRoleRow } from "@/lib/auth/actor-types";

/** Trần độ sâu khi lần cây báo cáo — chặn vòng lặp do dữ liệu hỏng sẵn trong DB. */
const MAX_REPORTING_DEPTH = 64;

export class ReportingCycleError extends Error {
  readonly code = "REPORTING_CYCLE";
  constructor(public readonly chain: string[]) {
    super(
      `Vòng lặp trong cây báo cáo: ${chain.join(" → ")}. Một vị trí không được báo cáo về chính chuỗi cấp dưới của nó.`,
    );
    this.name = "ReportingCycleError";
  }
}

type PositionNode = { id: string; title: string; reportsToPositionId: string | null };

/**
 * **TS-09** — chặn `positionId` báo cáo về `nextReportsToId` nếu điều đó tạo vòng.
 *
 * Chạy Ở TẦNG GHI vì Postgres không khai báo được ràng buộc đệ quy: FK chỉ biết "có tồn
 * tại" chứ không biết "có tạo vòng". Gọi hàm này trong CÙNG transaction với lệnh ghi.
 *
 * Thông báo lỗi NÊU RA CHUỖI VÒNG (`A → B → C → A`) chứ không chỉ nói "không hợp lệ":
 * người sửa cây tổ chức cần biết mắt xích nào phải cắt.
 */
export async function assertNoReportingCycle(
  positionId: string,
  nextReportsToId: string | null,
  client: Pick<typeof db, "position"> = db,
): Promise<void> {
  if (!nextReportsToId) return;
  if (nextReportsToId === positionId) {
    const self = await client.position.findUnique({
      where: { id: positionId },
      select: { title: true },
    });
    throw new ReportingCycleError([self?.title ?? positionId, self?.title ?? positionId]);
  }

  // Lần NGƯỢC từ cấp trên mới: nếu gặp lại chính mình thì đóng vòng.
  const chain: string[] = [];
  let cursor: string | null = nextReportsToId;
  for (let i = 0; i < MAX_REPORTING_DEPTH && cursor; i++) {
    const node: PositionNode | null = await client.position.findUnique({
      where: { id: cursor },
      select: { id: true, title: true, reportsToPositionId: true },
    });
    if (!node) return; // cấp trên không tồn tại → FK sẽ tự chặn, không phải việc của hàm này
    chain.push(node.title);
    if (node.id === positionId) {
      const self = await client.position.findUnique({
        where: { id: positionId },
        select: { title: true },
      });
      throw new ReportingCycleError([self?.title ?? positionId, ...chain]);
    }
    cursor = node.reportsToPositionId;
  }
  if (cursor) {
    // Vượt trần độ sâu = cây đã hỏng sẵn từ trước. Fail-closed, không ghi thêm vào đống hỏng.
    throw new ReportingCycleError([...chain, `…(quá ${MAX_REPORTING_DEPTH} cấp)`]);
  }
}

export class PrimaryAssignmentConflictError extends Error {
  readonly code = "PRIMARY_ASSIGNMENT_CONFLICT";
  constructor(public readonly existingPositionTitle: string) {
    super(
      `Người này đã có phân công CHÍNH còn hiệu lực tại vị trí “${existingPositionTitle}”. ` +
        `Đóng hiệu lực phân công cũ trước, hoặc chọn kiểu KIÊM NHIỆM / UỶ QUYỀN.`,
    );
    this.name = "PrimaryAssignmentConflictError";
  }
}

/** Hai khoảng thời gian có giao nhau không (null = vô thời hạn). */
function giaoNhau(
  aFrom: Date,
  aTo: Date | null,
  bFrom: Date,
  bTo: Date | null,
): boolean {
  return (aTo === null || aTo >= bFrom) && (bTo === null || bTo >= aFrom);
}

/**
 * **US-09 AC1** — một user có ĐÚNG MỘT phân công `PRIMARY` còn hiệu lực; `CONCURRENT`/
 * `DELEGATED` không giới hạn.
 *
 * ⚠️ VÌ SAO KHÔNG DÙNG UNIQUE INDEX: "còn hiệu lực" là một KHOẢNG THỜI GIAN, không phải
 * một cờ. Partial unique index chỉ diễn tả được `status='ACTIVE'`, không diễn tả nổi
 * "hai khoảng [from,to) giao nhau" — mà đó mới là điều cần cấm. Postgres làm được bằng
 * EXCLUDE constraint với btree_gist, nhưng nó đòi cài extension trên PROD chỉ để phục vụ
 * một quy tắc; ràng buộc ở tầng ghi rẻ hơn và nêu được lý do cho người dùng.
 *
 * ⚠️ Gọi TRONG transaction của lệnh ghi. Kiểm ngoài transaction là để hở khe hai request
 * song song cùng tạo PRIMARY.
 *
 * So GIAO KHOẢNG chứ không chỉ so "đang hiệu lực lúc này": tạo trước một PRIMARY cho
 * tháng sau trong khi PRIMARY hiện tại chưa đóng vẫn là hai chính chồng nhau.
 */
export async function assertSinglePrimary(input: {
  userId: string;
  kind: "PRIMARY" | "CONCURRENT" | "DELEGATED";
  effectiveFrom: Date;
  effectiveTo: Date | null;
  /** Bỏ qua chính bản ghi đang sửa. */
  ignoreAssignmentId?: string;
  client?: Pick<typeof db, "positionAssignment">;
}): Promise<void> {
  if (input.kind !== "PRIMARY") return;
  const client = input.client ?? db;
  const dangCo = await client.positionAssignment.findMany({
    where: {
      userId: input.userId,
      kind: "PRIMARY",
      status: "ACTIVE",
      ...(input.ignoreAssignmentId ? { id: { not: input.ignoreAssignmentId } } : {}),
    },
    select: {
      effectiveFrom: true,
      effectiveTo: true,
      position: { select: { title: true } },
    },
  });
  const va = dangCo.find((a) =>
    giaoNhau(a.effectiveFrom, a.effectiveTo, input.effectiveFrom, input.effectiveTo),
  );
  if (va) throw new PrimaryAssignmentConflictError(va.position.title);
}

/**
 * Vai trò user hưởng QUA VỊ TRÍ, ở đúng khuôn `UserOrgRoleRow` của `buildActor`.
 *
 * Lọc hiệu lực ngay trong truy vấn: `status = ACTIVE`, `effectiveFrom <= now`, và
 * (`effectiveTo` null hoặc >= now). Vị trí bị xoá mềm/tắt cũng rụng ở đây.
 */
export async function loadPositionRoleRows(
  userId: string,
  now: Date = new Date(),
): Promise<UserOrgRoleRow[]> {
  if (!userId) return [];
  const assignments = await db.positionAssignment.findMany({
    where: {
      userId,
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      position: { isActive: true, deletedAt: null },
    },
    select: {
      effectiveFrom: true,
      effectiveTo: true,
      // US-10 — nơi TÁC NGHIỆP. Lọc hiệu lực NGAY TRONG truy vấn, cùng lý do với phân
      // công: hết hạn thì đơn vị đó không có mặt trong kết quả, quyền rụng ở request kế
      // tiếp mà không ai phải đi dọn (luật cứng #8).
      workScopes: {
        where: {
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          orgUnit: { isActive: true, deletedAt: null },
        },
        select: { orgUnitId: true },
      },
      position: {
        select: {
          orgUnitId: true,
          roles: {
            select: {
              role: {
                select: {
                  id: true,
                  code: true,
                  isActive: true,
                  permissions: { select: { action: true, scopeType: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const rows: UserOrgRoleRow[] = [];
  for (const a of assignments) {
    const workScopeOrgUnitIds = [...new Set(a.workScopes.map((w) => w.orgUnitId))];
    for (const pr of a.position.roles) {
      rows.push({
        orgUnitId: a.position.orgUnitId,
        workScopeOrgUnitIds,
        roleId: pr.role.id,
        status: "ACTIVE",
        effectiveFrom: a.effectiveFrom,
        effectiveTo: a.effectiveTo,
        role: {
          code: pr.role.code,
          isActive: pr.role.isActive,
          permissions: pr.role.permissions.map((p) => ({
            action: p.action,
            scopeType: p.scopeType as ScopeType,
          })),
        },
      });
    }
  }
  return rows;
}
