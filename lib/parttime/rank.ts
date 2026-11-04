// lib/parttime/rank.ts — Rank GV đứng chính (1–4) tại một ngày, từ TeacherRankHistory.
//
// THUẦN. Rank tại ngày D = dòng có effectiveFrom ≤ D gần nhất. Không có dòng ⇒ rank mặc định của chính sách
// (SR.QD.238: "Nhân sự mới mặc định Rank 1"). Đổi Rank là THÊM dòng có ngày hiệu lực — không sửa dòng cũ — nên
// tiết của kỳ đã qua luôn đọc được đúng Rank lúc dạy.

export type DongRank = { rank: number; hieuLucTu: string /* "YYYY-MM-DD" */ };

export type RankTaiNgay = { rank: number; nguon: "LICH_SU" | "MAC_DINH" };

export function rankTaiNgay(lichSu: readonly DongRank[], ymd: string, rankMacDinh: number): RankTaiNgay {
  let tot: DongRank | null = null;
  for (const d of lichSu) {
    if (d.rank < 1 || d.rank > 4 || !Number.isInteger(d.rank)) throw new Error(`Rank ngoài 1–4: ${d.rank}`);
    if (d.hieuLucTu <= ymd && (tot == null || d.hieuLucTu > tot.hieuLucTu)) tot = d;
  }
  return tot ? { rank: tot.rank, nguon: "LICH_SU" } : { rank: rankMacDinh, nguon: "MAC_DINH" };
}
