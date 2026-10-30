// P1 · US-05 AC4 — nhãn tiếng Việt cho 3 enum của OrgUnit. Dùng chung cho page (RSC)
// và form (client) nên để ở module thuần, không "use server"/"use client".
//
// Ghi chú nhãn: loại `FRANCHISE` là GIÁ TRỊ CHẾT (lib/org/types.ts) — sở hữu nằm ở trục
// `relationshipType`, không suy từ `type`. Giữ nhãn để dòng dữ liệu cũ (nếu có) vẫn đọc được.
import type {
  OrgRelationshipType,
  OrgUnitStatus,
  OrgUnitType,
} from "@/lib/org/types";

export const ORG_UNIT_TYPE_LABEL: Record<OrgUnitType, string> = {
  ROOT: "Gốc hệ thống",
  HO: "Hội sở",
  REGION: "Khối vùng",
  DEPARTMENT: "Phòng ban",
  CENTER: "Cơ sở",
  CAMPUS: "Điểm dạy",
  PARTNER: "Đối tác",
  FRANCHISE: "Nhượng quyền (loại cũ)",
};

export const ORG_RELATIONSHIP_LABEL: Record<OrgRelationshipType, string> = {
  OWNED: "Sở hữu",
  FRANCHISEE: "Nhượng quyền",
  AFFILIATE: "Liên kết",
};

export const ORG_STATUS_LABEL: Record<OrgUnitStatus, string> = {
  ACTIVE: "Đang hoạt động",
  SUSPENDED: "Tạm dừng",
  CLOSED: "Đã đóng",
};
