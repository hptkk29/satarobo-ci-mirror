// lib/parttime/bao-cao-thang-kieu.ts — KIỂU dòng tháng dùng chung giữa lớp đọc (server) và bộ tổng hợp thuần. Chỉ kiểu.
import type { StaffAssignmentType } from "@prisma/client";
import type { MucDieuChinh } from "./dieu-chinh";
import type { KetQuaNhanXet } from "./nhan-xet-han";
import type { DongDoiSoat } from "./workunit-db";

export type DongDieuChinhThang = {
  dong: DongDoiSoat;
  assignmentType: StaffAssignmentType;
  sourceWorkRequestId: string | null;
  nhanXet: KetQuaNhanXet | null;
  muc: MucDieuChinh[];
  dieuChinh: { id: string; type: string; amount: number; ruleCode: string; status: string; decisionReason: string | null }[];
};
