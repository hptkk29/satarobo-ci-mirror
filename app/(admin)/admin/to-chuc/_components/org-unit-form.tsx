"use client";

// P1 · US-05 AC4 — form tạo/sửa node cây tổ chức (shadcn/ui thuần: Input/Label/Button
// + <select> gốc như các form admin khác; KHÔNG Magic UI, KHÔNG framer-motion).
//
// Hai điểm cố ý:
//   1. `code` CHỈ hiện khi TẠO. Service đổi mã được (tính lại path cả nhánh trong 1
//      transaction) nhưng UI không phơi — mã nằm trong path, tức nằm trong đường tính
//      quyền; sửa nhầm là kéo theo toàn bộ cây con.
//   2. Danh sách đơn vị cha khi SỬA loại bỏ chính nó + toàn bộ nhánh con (so tiền tố
//      `path`) — chống vòng lặp ngay trên UI. Server vẫn kiểm lại (wouldCreateCycle):
//      UI chỉ là lớp thân thiện, không phải lớp bảo vệ.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ORG_RELATIONSHIP_TYPES,
  ORG_UNIT_STATUSES,
  ORG_UNIT_TYPES,
  type OrgRelationshipType,
  type OrgUnitStatus,
  type OrgUnitType,
} from "@/lib/org/types";
import {
  ORG_RELATIONSHIP_LABEL,
  ORG_STATUS_LABEL,
  ORG_UNIT_TYPE_LABEL,
} from "../_labels";
import { createOrgUnitAction, updateOrgUnitAction } from "../_actions";

export type ParentOption = {
  id: string;
  code: string;
  name: string;
  type: OrgUnitType;
  path: string | null;
};

export type LegalEntityOption = {
  id: string;
  legalName: string;
  taxCode: string;
};

export type EditableUnit = {
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
};

type Props = {
  parents: ParentOption[];
  legalEntities: LegalEntityOption[];
  /** Bỏ trống = chế độ TẠO; có = chế độ SỬA. */
  unit?: EditableUnit;
  /** Đơn vị cha gợi ý sẵn khi tạo (bấm "Thêm đơn vị con" trên một node). */
  defaultParentId?: string | null;
  onDone?: () => void;
};

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function OrgUnitForm({
  parents,
  legalEntities,
  unit,
  defaultParentId = null,
  onDone,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [code, setCode] = useState(unit?.code ?? "");
  const [name, setName] = useState(unit?.name ?? "");
  const [type, setType] = useState<OrgUnitType>(unit?.type ?? "CENTER");
  const [parentId, setParentId] = useState<string>(unit?.parentId ?? defaultParentId ?? "");
  const [address, setAddress] = useState(unit?.address ?? "");
  const [relationshipType, setRelationshipType] = useState<OrgRelationshipType>(
    unit?.relationshipType ?? "OWNED",
  );
  const [status, setStatus] = useState<OrgUnitStatus>(unit?.status ?? "ACTIVE");
  const [legalEntityId, setLegalEntityId] = useState<string>(unit?.legalEntityId ?? "");

  // Nhánh con của chính nó không được làm cha (so tiền tố path — "/ho/cs1/" chứa
  // "/ho/cs1/lop-a/"). Node chưa có path (dòng cũ chưa backfill) → chỉ loại chính nó.
  const parentChoices = unit
    ? parents.filter(
        (p) =>
          p.id !== unit.id &&
          !(unit.path && p.path && p.path.startsWith(unit.path)),
      )
    : parents;

  function submit() {
    startTransition(async () => {
      const shared = {
        name,
        parentId: parentId === "" ? null : parentId,
        address: address.trim() === "" ? null : address,
        relationshipType,
        legalEntityId: legalEntityId === "" ? null : legalEntityId,
      };
      const res = unit
        ? await updateOrgUnitAction(unit.id, { ...shared, status })
        : await createOrgUnitAction({ ...shared, type, code });

      if (res.ok) {
        toast.success(unit ? "Đã lưu thay đổi" : "Đã tạo đơn vị");
        router.refresh();
        onDone?.();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {!unit && (
        <div>
          <Label htmlFor="org-code">Mã đơn vị</Label>
          <Input
            id="org-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="CS3"
            maxLength={20}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            2–20 ký tự A–Z, 0–9 hoặc gạch dưới. Không sửa được sau khi tạo.
          </p>
        </div>
      )}

      <div>
        <Label htmlFor="org-name">Tên đơn vị</Label>
        <Input
          id="org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Cơ sở 3 — Hoà Khánh"
          maxLength={200}
        />
      </div>

      {!unit && (
        <div>
          <Label htmlFor="org-type">Loại đơn vị</Label>
          <select
            id="org-type"
            className={selectClass}
            value={type}
            onChange={(e) => setType(e.target.value as OrgUnitType)}
          >
            {ORG_UNIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ORG_UNIT_TYPE_LABEL[t]} ({t})
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Không đổi được sau khi tạo — loại đơn vị quyết định luật cha/con.
          </p>
        </div>
      )}

      <div>
        <Label htmlFor="org-parent">Đơn vị cha</Label>
        <select
          id="org-parent"
          className={selectClass}
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">— Không có (chỉ Hội sở / gốc hệ thống) —</option>
          {parentChoices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name} ({ORG_UNIT_TYPE_LABEL[p.type]})
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="org-relationship">Quan hệ sở hữu</Label>
        <select
          id="org-relationship"
          className={selectClass}
          value={relationshipType}
          onChange={(e) => setRelationshipType(e.target.value as OrgRelationshipType)}
        >
          {ORG_RELATIONSHIP_TYPES.map((r) => (
            <option key={r} value={r}>
              {ORG_RELATIONSHIP_LABEL[r]}
            </option>
          ))}
        </select>
      </div>

      {unit && (
        <div>
          <Label htmlFor="org-status">Trạng thái</Label>
          <select
            id="org-status"
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as OrgUnitStatus)}
          >
            {ORG_UNIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORG_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Chỉ &quot;Đang hoạt động&quot; mới được coi là đơn vị còn sống khi tính quyền.
          </p>
        </div>
      )}

      <div>
        <Label htmlFor="org-legal-entity">Pháp nhân</Label>
        <select
          id="org-legal-entity"
          className={selectClass}
          value={legalEntityId}
          onChange={(e) => setLegalEntityId(e.target.value)}
        >
          <option value="">— Chưa gắn pháp nhân —</option>
          {legalEntities.map((l) => (
            <option key={l.id} value={l.id}>
              {l.legalName} · MST {l.taxCode}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <Label htmlFor="org-address">Địa chỉ</Label>
        <Input
          id="org-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="211 Nguyễn Hữu Thọ, Đà Nẵng"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Chỉ là thông tin — KHÔNG dùng địa chỉ để suy quan hệ quản lý.
        </p>
      </div>

      <div className="flex items-center gap-2 sm:col-span-2">
        <Button
          onClick={submit}
          disabled={pending || name.trim().length === 0 || (!unit && code.trim().length === 0)}
        >
          {pending ? "Đang lưu..." : unit ? "Lưu thay đổi" : "Tạo đơn vị"}
        </Button>
        {onDone && (
          <Button variant="outline" onClick={onDone} disabled={pending}>
            Huỷ
          </Button>
        )}
      </div>
    </div>
  );
}
