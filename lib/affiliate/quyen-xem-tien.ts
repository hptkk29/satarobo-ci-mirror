// lib/affiliate/quyen-xem-tien.ts — ĐỐI TÁC có được THẤY SỐ TIỀN hoa hồng ở cổng `/portal/gioi-thieu` không (AFF-L3a). THUẦN: không DB.
//
// MỘT chỗ phân giải (luật 12b — không nơi nào tự viết lại thứ tự này):
//     campaign.partnerCanViewAmount (khai tường minh)  >  loại đối tác.partnerCanViewAmount  >  MẶC ĐỊNH ẨN
// `null` ở một cấp nghĩa là «không khai — hỏi cấp dưới», KHÔNG phải «tắt». Tắt tường minh (`false`) ở campaign thắng cả loại đang bật: chủ campaign nói «ẩn» là ẩn.
// Nơi gọi quyết ĐỊNH TỪNG DÒNG sổ (mỗi dòng có campaign riêng, có thể null) rồi mới cộng — không cộng rồi giấu (xem `lib/affiliate/doc-cua-toi.ts`).
//
// Mặc định ẨN vì đây là con số tiền của người ngoài hệ thống: bật phải là quyết định có chủ đích, không phải thứ rơi ra khi quên khai (fail-closed).

export const XEM_TIEN_MAC_DINH = false;

export function quyenXemTien(p: { campaign: boolean | null; loai: boolean | null }): boolean {
  if (p.campaign !== null) return p.campaign;
  if (p.loai !== null) return p.loai;
  return XEM_TIEN_MAC_DINH;
}

// ── Ô chọn ba trạng thái cho biểu mẫu (checkbox không diễn đạt được «theo cấp trên») ───────────────────────────────────────

export const LUA_CHON_XEM_TIEN = ["THEO_CAP_TREN", "HIEN", "AN"] as const;
export type LuaChonXemTien = (typeof LUA_CHON_XEM_TIEN)[number];

export const NHAN_LUA_CHON_XEM_TIEN: Readonly<Record<LuaChonXemTien, string>> = {
  THEO_CAP_TREN: "Theo cấp trên",
  HIEN: "Hiện số tiền",
  AN: "Ẩn số tiền",
};

export function boolTuLuaChon(v: LuaChonXemTien): boolean | null {
  return v === "THEO_CAP_TREN" ? null : v === "HIEN";
}

export function luaChonTuBool(v: boolean | null): LuaChonXemTien {
  return v === null ? "THEO_CAP_TREN" : v ? "HIEN" : "AN";
}
