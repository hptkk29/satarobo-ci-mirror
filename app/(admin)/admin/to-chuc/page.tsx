// P1 · US-05 AC4 (Nền Hệ thống) — màn "Cây tổ chức": cây OrgUnit CHỈ ĐỌC
// (expand/collapse bằng <details>/<summary> gốc — không kéo thêm thư viện) + form
// tạo/sửa node (Dialog shadcn ở _components).
//
// QUYỀN: đọc `centers:view`, ghi `centers:edit` — 2 key CÓ SẴN trong registry
// (lib/permissions/registry/system.ts). `centers:edit` = ["SUPER_ADMIN"] và vốn đã là
// gate của mọi thao tác "cấu trúc tổ chức" (app/(admin)/admin/centers/_actions.ts).
// KHÔNG chế key mới — registry là một nguồn sự thật, có test chặn trùng key.
//
// LỌC TẦM NHÌN: OrgUnit ∈ SCOPE_EXEMPT (lib/db-scope.ts) ⇒ scopedDb KHÔNG tự lọc. Nên
// lọc TAY y như /centers: SUPER_ADMIN + cấp Hội sở thấy cả cây; người cấp cơ sở chỉ
// thấy nhánh cơ sở mình (kèm đường tổ tiên để cây còn liền mạch, không lộ cơ sở khác).
//
// Cây dựng từ `parentId` trong bộ nhớ: dữ liệu < 50 node, đừng tối ưu sớm.
import { redirect } from "next/navigation";
import { ChevronRight, Network } from "lucide-react";
import { PageHelp } from "@/components/admin/ui/page-help";
import { auth } from "@/lib/auth";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type {
  OrgRelationshipType,
  OrgUnitStatus,
  OrgUnitType,
} from "@/lib/org/types";
import {
  ORG_RELATIONSHIP_LABEL,
  ORG_STATUS_LABEL,
  ORG_UNIT_TYPE_LABEL,
} from "./_labels";
import { CreateOrgUnitButton } from "./_components/create-org-unit-button";
import { OrgUnitRowActions } from "./_components/org-unit-row-actions";
import type {
  LegalEntityOption,
  ParentOption,
} from "./_components/org-unit-form";

export const metadata = { title: "Cây tổ chức | Admin" };
export const dynamic = "force-dynamic";

type UnitRow = {
  id: string;
  code: string;
  name: string;
  type: OrgUnitType;
  parentId: string | null;
  path: string | null;
  address: string | null;
  relationshipType: OrgRelationshipType;
  status: OrgUnitStatus;
  legalEntityId: string | null;
  centerId: string | null;
  legalEntity: { legalName: string; taxCode: string } | null;
};

/**
 * Giữ lại node mà chính nó HOẶC một tổ tiên của nó gắn với cơ sở actor được thấy,
 * cộng toàn bộ đường tổ tiên của những node đó (không có đường này thì cây gãy đoạn
 * và React không có gốc để render).
 */
function keepVisibleBranches(
  rows: UnitRow[],
  allowedCenterIds: string[],
): UnitRow[] {
  const allowed = new Set(allowedCenterIds);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const matched = new Set(
    rows
      .filter((r) => r.centerId != null && allowed.has(r.centerId))
      .map((r) => r.id),
  );
  if (matched.size === 0) return [];

  const keep = new Set<string>();
  for (const row of rows) {
    const chain: string[] = [];
    const guard = new Set<string>();
    let cur: UnitRow | undefined = row;
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      chain.push(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    if (chain.some((id) => matched.has(id)))
      for (const id of chain) keep.add(id);
  }
  return rows.filter((r) => keep.has(r.id));
}

function statusBadgeVariant(status: OrgUnitStatus) {
  if (status === "ACTIVE") return "secondary" as const;
  if (status === "SUSPENDED") return "outline" as const;
  return "destructive" as const;
}

function OrgTreeNode({
  node,
  childrenOf,
  canEdit,
  parents,
  legalEntities,
}: {
  node: UnitRow;
  childrenOf: Map<string, UnitRow[]>;
  canEdit: boolean;
  parents: ParentOption[];
  legalEntities: LegalEntityOption[];
}) {
  const kids = childrenOf.get(node.id) ?? [];

  return (
    <details open className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90",
            kids.length === 0 && "invisible",
          )}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-xs font-bold text-foreground">
            {node.code}
          </span>
          <span className="truncate font-semibold text-foreground">
            {node.name}
          </span>
          <Badge variant="outline">{ORG_UNIT_TYPE_LABEL[node.type]}</Badge>
          <Badge
            variant={node.relationshipType === "OWNED" ? "outline" : "default"}
          >
            {ORG_RELATIONSHIP_LABEL[node.relationshipType]}
          </Badge>
          <Badge variant={statusBadgeVariant(node.status)}>
            {ORG_STATUS_LABEL[node.status]}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {node.path ?? "(chưa có đường dẫn)"}
          </span>
          {node.legalEntity && (
            <span className="text-xs text-muted-foreground">
              Pháp nhân: {node.legalEntity.legalName} · MST{" "}
              {node.legalEntity.taxCode}
            </span>
          )}
        </div>
        {canEdit && (
          <OrgUnitRowActions
            unit={{
              id: node.id,
              code: node.code,
              name: node.name,
              type: node.type,
              parentId: node.parentId,
              path: node.path,
              address: node.address,
              relationshipType: node.relationshipType,
              status: node.status,
              legalEntityId: node.legalEntityId,
            }}
            parents={parents}
            legalEntities={legalEntities}
          />
        )}
      </summary>

      {kids.length > 0 && (
        <div className="ml-4 border-l border-border pl-3">
          {kids.map((kid) => (
            <OrgTreeNode
              key={kid.id}
              node={kid}
              childrenOf={childrenOf}
              canEdit={canEdit}
              parents={parents}
              legalEntities={legalEntities}
            />
          ))}
        </div>
      )}
    </details>
  );
}

export default async function ToChucPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission([...PAGE_GATES["/to-chuc"]]))) {
    redirect("/dashboard?error=unauthorized");
  }
  const canEdit = await checkPermission("centers:edit");

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // OrgUnit/LegalEntity ∉ SOFT_DELETE_MODELS (không tự lọc) → tự lọc deletedAt null.
  const [rawUnits, legalEntities] = await Promise.all([
    sdb.orgUnit.findMany({
      where: { deletedAt: null },
      orderBy: [{ depth: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        parentId: true,
        path: true,
        address: true,
        relationshipType: true,
        status: true,
        legalEntityId: true,
        centerId: true,
        legalEntity: { select: { legalName: true, taxCode: true } },
      },
    }),
    sdb.legalEntity.findMany({
      where: { deletedAt: null },
      orderBy: [{ isPrimary: "desc" }, { legalName: "asc" }],
      select: { id: true, legalName: true, taxCode: true },
    }),
  ]);

  const allUnits: UnitRow[] = rawUnits.map((u) => ({
    ...u,
    type: u.type as OrgUnitType,
    relationshipType: u.relationshipType as OrgRelationshipType,
    status: u.status as OrgUnitStatus,
  }));

  const seeAllUnits = actor.isSuperAdmin || actor.isHoLevel;
  const units = seeAllUnits
    ? allUnits
    : keepVisibleBranches(allUnits, actor.visibleCenterIds);

  const byId = new Map(units.map((u) => [u.id, u]));
  const childrenOf = new Map<string, UnitRow[]>();
  for (const u of units) {
    if (u.parentId == null || !byId.has(u.parentId)) continue;
    const list = childrenOf.get(u.parentId);
    if (list) list.push(u);
    else childrenOf.set(u.parentId, [u]);
  }
  // Gốc = node không cha, HOẶC node có cha nằm ngoài tầm nhìn (đừng nuốt cả nhánh).
  const roots = units.filter(
    (u) => u.parentId == null || !byId.has(u.parentId),
  );

  const parentOptions: ParentOption[] = units.map((u) => ({
    id: u.id,
    code: u.code,
    name: u.name,
    type: u.type,
    path: u.path,
  }));

  const activeCount = units.filter((u) => u.status === "ACTIVE").length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-black text-foreground">
            <Network className="h-7 w-7 text-primary" />
            Cây tổ chức
          </h1>
          {/* Dòng phụ chỉ nói TRẠNG THÁI, không giải thích cách dùng — phần hướng dẫn
              nằm ở <PageHelp> bên dưới, đóng sẵn. Người vận hành mở trang này mỗi ngày
              và cần nhìn thấy cây ngay, không phải đọc lại một đoạn văn. */}
          <p className="mt-1 text-sm text-muted-foreground">
            {activeCount}/{units.length} đơn vị đang hoạt động
          </p>
        </div>
        {canEdit && (
          <CreateOrgUnitButton
            parents={parentOptions}
            legalEntities={legalEntities}
          />
        )}
      </div>

      <PageHelp>
        <p>
          Cây tổ chức xếp theo ba tầng:{" "}
          <strong>Hội sở → Khối vùng → Cơ sở</strong>.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Mở cơ sở mới là thêm đơn vị ở đây — không cần lập trình viên.</li>
          <li>
            Đổi đơn vị cha sẽ tính lại đường dẫn của{" "}
            <strong>cả nhánh con</strong>, và đường dẫn đó quyết định ai nhìn
            thấy dữ liệu của cơ sở nào.
          </li>
          <li>Đơn vị còn đơn vị con đang hoạt động thì không xoá được.</li>
        </ul>
      </PageHelp>

      <div className="rounded-xl border border-border bg-card p-3">
        {roots.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Chưa có đơn vị nào trong tầm nhìn của bạn.
          </p>
        ) : (
          roots.map((root) => (
            <OrgTreeNode
              key={root.id}
              node={root}
              childrenOf={childrenOf}
              canEdit={canEdit}
              parents={parentOptions}
              legalEntities={legalEntities}
            />
          ))
        )}
      </div>

      {!canEdit && (
        <p className="mt-3 text-xs text-muted-foreground">
          Bạn đang xem ở chế độ chỉ đọc — tạo/sửa đơn vị cần quyền quản trị cơ
          sở (centers:edit).
        </p>
      )}
    </div>
  );
}
