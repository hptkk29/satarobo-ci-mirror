// lib/parttime/cong-tac-thuan.ts — luật THUẦN của BỐN công tắc Parttime (tách khỏi `shift.phanCongNhanLopBat`, 18/10/2026).
// Không DB, không đồng hồ. Phần đọc DB ở `cong-tac.ts`.
//
// Vì sao tách: một công tắc gánh bốn hành vi ⇒ không bật được từng bước (đợt 1 chỉ phân công, đợt 2 thêm chấm công theo ngữ
// cảnh, đợt 3 chạy bóng, đợt 5 mới tới tiền), và không thí điểm được một cơ sở (công tắc cũ không xét cơ sở).
//
//   STAFFING            — phân công buổi, xác nhận nhận lớp, màn QLCS, màn "Phân công" của GV, đồng bộ tự động từ đơn / lịch.
//   ATTENDANCE_CONTEXT  — nút Chấm công theo ngữ cảnh (hướng theo hiện diện, thẻ ngữ cảnh, không gắn CHAM_NGOAI_LICH cho việc
//                         Parttime hợp lệ).
//   WORKUNIT_SHADOW     — đối soát / xác nhận thực hiện / WorkUnit / báo cáo tháng — KHÔNG phải căn cứ trả lương.
//   COMPENSATION        — khoản điều chỉnh tiền được QUYẾT, và số liệu tháng được coi là căn cứ lương.
//
// Mỗi công tắc ĐỘC LẬP (bật một cái không kéo cái khác — lưới M-FLAG-02) và có mặc định toàn hệ thống + ghi đè theo cơ sở
// (`CenterSetting`, chỉ Quản trị tối cao ghi được — khoá KHÔNG khai `qlcsSuaDuoc`).
//
// RBAC v2 là điều kiện CỨNG cho mọi công tắc có GHI (STAFFING · WORKUNIT_SHADOW · COMPENSATION): RBAC v1 không xét cơ sở
// (`[SCOPE-V1]`) ⇒ QLCS CS1 ghi được dữ liệu CS2. Công tắc bật mà v1 ⇒ thao tác của người dùng trả `RBAC_V2_REQUIRED_FOR_PARTTIME`,
// đường tự động coi như TẮT. ATTENDANCE_CONTEXT không bị chặn: lượt chấm công của chính mình không bao giờ được hỏng vì cờ quyền.

export const KHOA_CONG_TAC = {
  STAFFING: "shift.parttimeStaffingEnabled",
  ATTENDANCE_CONTEXT: "shift.parttimeAttendanceContextEnabled",
  WORKUNIT_SHADOW: "shift.parttimeWorkUnitShadowEnabled",
  COMPENSATION: "shift.parttimeCompensationEnabled",
} as const;

export type LoaiCongTac = keyof typeof KHOA_CONG_TAC;
export const LOAI_CONG_TAC = Object.keys(KHOA_CONG_TAC) as LoaiCongTac[];

/** Công tắc có đường GHI ⇒ đòi RBAC v2. */
export const CAN_RBAC_V2: Readonly<Record<LoaiCongTac, boolean>> = {
  STAFFING: true,
  ATTENDANCE_CONTEXT: false,
  WORKUNIT_SHADOW: true,
  COMPENSATION: true,
};

export const LOI_RBAC_V2 = "RBAC_V2_REQUIRED_FOR_PARTTIME" as const;

/** Mặc định toàn hệ thống + ghi đè theo đơn vị. `theoCoSo` = cùng ghi đè, khoá theo Center.id (OrgUnit.centerId). */
export type PhamViCongTac = {
  macDinh: boolean;
  theoDonVi: ReadonlyMap<string, boolean>;
  theoCoSo: ReadonlyMap<string, boolean>;
};

export const PHAM_VI_TAT: PhamViCongTac = { macDinh: false, theoDonVi: new Map(), theoCoSo: new Map() };

/** Có nơi nào đang bật không — `false` ⇒ người gọi trả lời TẮT ngay, không câu tra nào thêm. */
export function coNoiNaoBat(pv: PhamViCongTac): boolean {
  return pv.macDinh || [...pv.theoDonVi.values()].some(Boolean);
}

/**
 * Bật tại một cơ sở / đơn vị. Không biết cơ sở (`null`) ⇒ chỉ mặc định toàn hệ thống — KHÔNG lấy "có cơ sở nào bật" (đó là nới
 * phạm vi). Ưu tiên `orgUnitId` khi có (điểm chấm / ô ca đã mang sẵn), rơi về `centerId`.
 */
export function batTai(pv: PhamViCongTac, noi: { orgUnitId?: string | null; centerId?: string | null }): boolean {
  if (noi.orgUnitId && pv.theoDonVi.has(noi.orgUnitId)) return pv.theoDonVi.get(noi.orgUnitId)!;
  if (noi.centerId && pv.theoCoSo.has(noi.centerId)) return pv.theoCoSo.get(noi.centerId)!;
  return pv.macDinh;
}

export type TrangThaiCongTac = { bat: boolean; chan: typeof LOI_RBAC_V2 | null };

/** Bật + chặn RBAC v2 ⇒ trạng thái dùng cho THAO TÁC của người dùng (nói rõ vì sao không chạy). */
export function trangThaiCongTac(loai: LoaiCongTac, bat: boolean, rbacV2: boolean): TrangThaiCongTac {
  return { bat, chan: bat && CAN_RBAC_V2[loai] && !rbacV2 ? LOI_RBAC_V2 : null };
}

/** Có HIỆU LỰC cho đường tự động: bật VÀ (không cần v2 HOẶC đang v2). */
export function hieuLuc(loai: LoaiCongTac, bat: boolean, rbacV2: boolean): boolean {
  return trangThaiCongTac(loai, bat, rbacV2).chan === null && bat;
}

export const CAU_RBAC_V2 =
  "Công Parttime cần RBAC v2 (RBAC_V2_ENABLED=true) để cách ly cơ sở — đang chạy RBAC v1 nên thao tác bị chặn (RBAC_V2_REQUIRED_FOR_PARTTIME).";
