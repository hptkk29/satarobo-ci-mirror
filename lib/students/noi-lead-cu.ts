// lib/students/noi-lead-cu.ts — QUYẾT ĐỊNH nối một học viên CŨ về lead nguồn (25/09/2026).
//
// Phần THUẦN của `scripts/noi-hoc-vien-voi-lead.ts`: script gom BẰNG CHỨNG theo lô, hàm này
// quyết định. Tách ra để test không cần DB, và để luật nằm ở một chỗ đọc được.
//
// ── BỐN CHUỖI BẰNG CHỨNG, theo độ chắc giảm dần ────────────────────────────────────────
//   ① GHI_DANH   — một ghi danh của HV mang `leadChildId` (vết chốt lead v2, R7-06). Chỉ đường
//                  này cho biết ĐỨA TRẺ nào trong phiếu ⇒ duy nhất chuỗi điền `leadChildId`.
//   ② THANH_TOAN — khoản thu gắn ghi danh của HV, thuộc đơn có `leadId`.
//   ③ DON_HANG   — đơn/dòng đơn ghi thẳng `studentId` của HV, đơn có `leadId`.
//   ④ NHAT_KY    — dòng AuditLog của lượt chốt lead (`entityType: "Lead"`) nhắc id HV.
//
// ── LUẬT (chủ dự án chốt 25/09 — đừng nới) ─────────────────────────────────────────────
//   1. Có ① ⇒ ghi danh SỚM NHẤT thắng (lead GỐC — cùng nghĩa với convert: lượt chốt sau
//      không đè). Nó cho luôn `leadChildId`.
//   2. Không có ① ⇒ HỢP các leadId phân biệt của ②③④:
//        · đúng MỘT ⇒ nối (không biết đứa trẻ nào ⇒ `leadChildId` null);
//        · HAI trở lên ⇒ MẬP MỜ — báo cho người rà, KHÔNG BAO GIỜ tự ghi. Chọn bừa một phiếu
//          là gắn hồ sơ con nhà này vào sổ phễu nhà kia, và không ai phát hiện.
//   3. Không có gì ⇒ `null` (HV nhập tay / import Excel — NULL nghĩa "chưa nối", không phải
//      "không đến từ lead").
//
// Đầu vào CHỈ chứa lead CHƯA XOÁ — việc lọc là của script (nó biết `deletedAt`).
// ⛔ Kết quả này ghi vào `Student.leadId/leadChildId`. KHÔNG BAO GIỜ ghi `Enrollment.leadChildId`
// (tín hiệu "đã chốt" của báo cáo chuyển đổi — lib/lead/tuong-tac/ghi.ts).

export type ChuoiBangChung = "GHI_DANH" | "THANH_TOAN" | "DON_HANG" | "NHAT_KY";

export type BangChungNoiLead = {
  tuGhiDanh: { leadId: string; leadChildId: string; enrolledAt: Date }[];
  tuThanhToan: string[];
  tuDonHang: string[];
  tuNhatKy: string[];
};

export type KetQuaNoiLead =
  | { leadId: string; leadChildId: string | null; chain: ChuoiBangChung }
  | { mapHo: true; leadIds: string[] }
  | null;

export function quyetDinhNoiLead(bc: BangChungNoiLead): KetQuaNoiLead {
  // ① — sớm nhất thắng. Hoà giờ ⇒ xếp theo id để kết quả KHÔNG phụ thuộc thứ tự DB trả về
  // (chạy dry-run hai lần phải ra cùng một bảng).
  if (bc.tuGhiDanh.length > 0) {
    const [dau] = [...bc.tuGhiDanh].sort(
      (a, b) =>
        a.enrolledAt.getTime() - b.enrolledAt.getTime() ||
        a.leadId.localeCompare(b.leadId) ||
        a.leadChildId.localeCompare(b.leadChildId),
    );
    return { leadId: dau!.leadId, leadChildId: dau!.leadChildId, chain: "GHI_DANH" };
  }

  // ②③④ — hợp, theo thứ tự độ chắc để nhãn chuỗi là chuỗi CHẮC NHẤT chứa lead đó.
  const theoChuoi: [ChuoiBangChung, string[]][] = [
    ["THANH_TOAN", bc.tuThanhToan],
    ["DON_HANG", bc.tuDonHang],
    ["NHAT_KY", bc.tuNhatKy],
  ];
  const chuoiCuaLead = new Map<string, ChuoiBangChung>();
  for (const [chuoi, ids] of theoChuoi) {
    for (const id of ids) if (!chuoiCuaLead.has(id)) chuoiCuaLead.set(id, chuoi);
  }
  if (chuoiCuaLead.size === 0) return null;
  if (chuoiCuaLead.size > 1) return { mapHo: true, leadIds: [...chuoiCuaLead.keys()].sort() };
  const [[leadId, chain]] = [...chuoiCuaLead.entries()] as [[string, ChuoiBangChung]];
  return { leadId, leadChildId: null, chain };
}
