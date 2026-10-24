/**
 * lib/nguon/di-tru-du-lieu.ts — DÒNG KẾ HOẠCH → DỮ LIỆU GHI của backfill (hướng E). THUẦN: không DB, không đồng hồ.
 *
 * Tách khỏi `di-tru-ghi.ts` để hình dạng dữ liệu ghi (thứ quyết định tiền về sau) test được không cần Postgres. KHÔNG nằm trong đồ thị import của script chỉ-đọc
 * (nó kéo `nguon-chup` → zod và kiểu của tầng GHI) — chỉ lệnh GHI dùng nó.
 *
 * ── Quy ước ──────────────────────────────────────────────────────────────────────────────────────────────
 *  · `attributedAt` = `Lead.createdAt`: first-claim tính theo lúc lead THẬT SỰ vào, không theo lúc chạy backfill.
 *  · `originalGroupId` = `groupId`, `inheritedFromLeadId` = null: dữ liệu lịch sử không có kế thừa.
 *  · KHÔNG đụng `Lead.source`: nó là KHOÁ ĐỊNH TUYẾN cũ (ảnh chụp đường vào), không phải nguồn; backfill chỉ ghi `LeadAttribution` + `LeadTouchpoint`.
 *  · `referrerKind` = EMPLOYEE chỉ khi CÓ người (CHECK `LeadAttribution_nguoi_gioi_thieu_chk`); không người ⇒ null kể cả `referrerMissing`.
 *  · `referrerRoleCode` = vai ngữ nghĩa của NHÃN (SALE/MANAGER…) kể cả khi chưa có người: 4 nhóm nhân sự cũ đã gộp thành một nguồn, vai là chỗ duy nhất còn giữ phân biệt ấy
 *    (engine hoa hồng không đọc cột này; báo cáo/duyệt tay thì có). Đường sống (`KHAI_TAY`) ghi null cho ca không-người — di trú cố ý khác vì nó là dữ liệu lịch sử.
 *  · `signals.nguon` (chủ + cửa sổ) do NGƯỜI GỌI truyền (`chupNguon`) và LUÔN có mặt — thiếu thì engine rơi về chủ/cửa sổ SỐNG (`nguon-chup.ts` `CHUA_CO`).
 */
import type { Prisma } from "@prisma/client";
import type { DuLieuNguon, TouchpointDiTru } from "./ghi-nguon";
import type { DongKeHoach } from "./di-tru-ke-hoach";
import type { NguonChup } from "./nguon-chup";

export function dungDuLieuGhiDiTru(d: DongKeHoach, nguon: NguonChup): { duLieu: DuLieuNguon; touchpoint: TouchpointDiTru } {
  const signals: Record<string, unknown> = {};
  if (d.nhanChuan !== null) signals.nhanGoc = d.nhanChuan;
  if (d.stt !== null) signals.stt = d.stt;
  signals.diTru = true;
  if (d.xemTay.length > 0) {
    signals.coXemTay = true;
    signals.xemTay = [...d.xemTay];
  }
  if (d.nguoiGioiThieu) {
    signals.nguoiGioiThieu = { employeeCode: d.nguoiGioiThieu.employeeCode, roleCodes: [...d.nguoiGioiThieu.roleCodes], orgUnitId: d.nguoiGioiThieu.orgUnitId };
  }
  // Nguyên bản chụp do `chupNguon` dựng (cùng cách `hoanTat` của quy-nguon.ts: `{ ...nguonChup }`) — hướng BC mở rộng schema thì trường mới đi theo, không phải sửa ở đây.
  signals.nguon = { ...nguon };

  const coNguoi = d.referrerEmployeeId !== null;
  const duLieu: DuLieuNguon = {
    groupId: d.groupId,
    otherSourceNote: d.otherSourceNote,
    referrerKind: coNguoi ? "EMPLOYEE" : null,
    referrerEmployeeId: d.referrerEmployeeId,
    referrerParentUserId: null,
    referrerStudentId: null,
    referrerAffiliateId: null,
    referrerMissing: d.referrerMissing,
    referrerRoleCode: d.referrerRoleCode,
    referrerSaleUserId: null,
    identificationMethod: d.groupCode === "UNKNOWN" ? "UNKNOWN" : "SYSTEM_IMPORT",
    matchedRule: "DI_TRU",
    reasonText: `Di trú nhãn cũ «${d.nhanChuan ?? "(trống)"}»${d.stt !== null ? ` (bảng 06/10 dòng ${d.stt})` : ""} → ${d.groupCode}${d.xemTay.length > 0 ? " — cần người xem" : ""}`,
    canhBao: [],
    originalGroupId: d.groupId,
    inheritedFromLeadId: null,
    conversionEntry: d.conversionEntry,
    signals: signals as Prisma.InputJsonObject,
    attributedAt: d.createdAt,
  };
  const touchpoint: TouchpointDiTru = {
    kind: "TAO_LEAD",
    occurredAt: d.createdAt,
    conversionEntry: d.conversionEntry,
    claimedGroupId: d.groupId,
    signals: { diTru: true, ...(d.nhanChuan !== null ? { nhanGoc: d.nhanChuan } : {}) },
  };
  return { duLieu, touchpoint };
}
