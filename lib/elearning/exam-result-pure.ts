// Nội dung màn "Xem lại bài kiểm tra" — phần THUẦN. Không import React/DB.

/** Câu giải thích VÌ SAO chưa có đáp án — nói đúng chính sách của đề, không để người thi tưởng hệ thống lỗi. */
export function lyDoChuaCoDapAn(chinhSach: string, soDaDung: number, soChoPhep: number): string {
  if (chinhSach === "AFTER_LAST_ATTEMPT") {
    const con = Math.max(0, soChoPhep - soDaDung);
    return `Đáp án được công bố sau khi bạn dùng hết số lượt thi (đã dùng ${soDaDung}/${soChoPhep}${con > 0 ? `, còn ${con} lượt` : ""}).`;
  }
  return "Đề này không công bố đáp án.";
}

/** Dòng kết luận của lượt: "Đạt 10/12" / "Chưa đạt 4/12" / "Đang chờ người chấm phần tự luận". */
export function dongKetLuanLuot(l: { choChamTay: boolean; passed: boolean | null; totalScore: number | null }, maxScore: number): string {
  if (l.choChamTay) return "Đang chờ người chấm phần tự luận";
  if (l.totalScore == null || l.passed == null) return "Chưa có kết quả";
  return `${l.passed ? "Đạt" : "Chưa đạt"} ${l.totalScore}/${maxScore}`;
}
