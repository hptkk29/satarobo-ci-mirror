// lib/affiliate/giai-nguon.ts — ĐỐI TÁC + CAMPAIGN → NGUỒN KHÁCH (`LeadSourceGroup`). THUẦN: không DB, không đồng hồ.
//
// Đặc tả Affiliate §12, §44–§46: nguồn của lead đi từ link KHÔNG BAO GIỜ là chính mã/token (`Lead.source = ABC123` là sai); nó được GIẢI từ cấu hình,
// theo thứ tự ưu tiên, và THIẾU CẤU HÌNH ⇒ XEM TAY (MANUAL_REVIEW), không bao giờ rơi về UNKNOWN âm thầm.
//
//   1. rule (campaign) khớp CẢ loại LẪN nhãn của đối tác
//   2. rule khớp riêng LOẠI
//   3. rule khớp riêng NHÃN
//   4. nguồn mặc định của CAMPAIGN
//   5. nguồn mặc định của LOẠI đối tác
//   6. không có gì ⇒ XEM TAY (kèm lý do)
//
// Hai rule CÙNG bậc cho hai nguồn KHÁC nhau (vd đối tác mang hai nhãn, mỗi nhãn một nguồn) là MÂU THUẪN cấu hình ⇒ XEM TAY, không chọn bừa theo thứ tự
// lưu. Cùng bậc mà cùng nguồn thì không mâu thuẫn.
//
// Hàm này CHỈ chọn id nguồn. Nguồn đó còn dùng được không (ACTIVE · selectable · trong hiệu lực) là việc của tầng đọc khi ghi attribution (AFF-P1) —
// nếu để ở đây thì cấu hình đúng hôm nay thành "xem tay" ngày mai chỉ vì một nguồn bị ngừng, và người xem không biết vì sao.

export type QuyTacNguon = {
  /** null = quy tắc không xét loại. */
  typeId: string | null;
  /** null = quy tắc không xét nhãn. */
  tagId: string | null;
  sourceGroupId: string;
};

export type DauVaoGiaiNguon = {
  /** Các quy tắc CỦA MỘT campaign. */
  quyTac: readonly QuyTacNguon[];
  campaignMacDinh: string | null;
  doiTacLoaiId: string | null;
  doiTacNhanIds: readonly string[];
  loaiMacDinh: string | null;
};

export type TuDauGiaiNguon = "RULE_LOAI_VA_NHAN" | "RULE_LOAI" | "RULE_NHAN" | "MAC_DINH_CAMPAIGN" | "MAC_DINH_LOAI";

export type KetQuaGiaiNguon =
  | { sourceGroupId: string; tu: TuDauGiaiNguon }
  | { sourceGroupId: null; tu: "XEM_TAY"; lyDo: string };

/** Nhãn người đọc cho "nguồn đến từ đâu" — dùng ở màn xem trước và ngăn «Vì sao con số này». */
export const NHAN_TU_DAU: Readonly<Record<TuDauGiaiNguon, string>> = {
  RULE_LOAI_VA_NHAN: "Quy tắc campaign theo loại và nhãn",
  RULE_LOAI: "Quy tắc campaign theo loại đối tác",
  RULE_NHAN: "Quy tắc campaign theo nhãn đối tác",
  MAC_DINH_CAMPAIGN: "Nguồn mặc định của campaign",
  MAC_DINH_LOAI: "Nguồn mặc định của loại đối tác",
};

export function giaiNguonCuaDoiTac(v: DauVaoGiaiNguon): KetQuaGiaiNguon {
  const nhan = new Set(v.doiTacNhanIds);

  const theoBac: { tu: TuDauGiaiNguon; ds: string[] }[] = [
    {
      tu: "RULE_LOAI_VA_NHAN",
      ds: v.quyTac.filter((r) => r.typeId !== null && r.tagId !== null && r.typeId === v.doiTacLoaiId && nhan.has(r.tagId)).map((r) => r.sourceGroupId),
    },
    { tu: "RULE_LOAI", ds: v.quyTac.filter((r) => r.typeId !== null && r.tagId === null && r.typeId === v.doiTacLoaiId).map((r) => r.sourceGroupId) },
    { tu: "RULE_NHAN", ds: v.quyTac.filter((r) => r.typeId === null && r.tagId !== null && nhan.has(r.tagId)).map((r) => r.sourceGroupId) },
  ];

  for (const { tu, ds } of theoBac) {
    const rieng = [...new Set(ds)];
    if (rieng.length === 0) continue;
    if (rieng.length > 1) {
      return { sourceGroupId: null, tu: "XEM_TAY", lyDo: "Cấu hình campaign mâu thuẫn: đối tác khớp nhiều quy tắc cùng mức nhưng trỏ tới các nguồn khác nhau." };
    }
    return { sourceGroupId: rieng[0]!, tu };
  }

  if (v.campaignMacDinh) return { sourceGroupId: v.campaignMacDinh, tu: "MAC_DINH_CAMPAIGN" };
  if (v.loaiMacDinh) return { sourceGroupId: v.loaiMacDinh, tu: "MAC_DINH_LOAI" };
  return { sourceGroupId: null, tu: "XEM_TAY", lyDo: "Chưa cấu hình nguồn cho loại/nhãn của đối tác này trong campaign, và campaign lẫn loại đối tác đều không có nguồn mặc định." };
}
