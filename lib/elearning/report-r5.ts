/**
 * EL-17 — BÁO CÁO R5: kết quả kiểm tra + PHÂN TÍCH CÂU HỎI.
 *
 * Hai nửa, và nửa sau mới là phần đáng tiền: một câu hỏi mà 90% người làm sai không
 * chứng minh học viên kém — nhiều khả năng câu hỏi ấy mơ hồ, hoặc nội dung dạy chưa
 * phủ. Không đo thì đề thi cứ thế được dùng lại năm này qua năm khác.
 */

/** Lượt thi ĐÃ CHẤM XONG — chỉ những lượt này vào phép đo. */
export type LuotThiDeDo = {
  attemptId: string;
  userId: string;
  examId: string;
  attemptNo: number;
  totalScore: number | null;
  passed: boolean | null;
};

export type CauTraLoiDeDo = {
  attemptId: string;
  examQuestionId: string;
  isCorrect: boolean | null;
};

export type TongHopDeThi = {
  examId: string;
  /** Số lượt LẦN ĐẦU (`attemptNo = 1`) — mẫu số của M6. */
  soLuotLanDau: number;
  /** Số lượt lần đầu ĐẠT. */
  soDatLanDau: number;
  /** M6 — `null` khi chưa có lượt lần đầu nào. */
  tiLeDatLanDau: number | null;
  /** Tổng lượt (mọi lần). */
  tongLuot: number;
  /** Điểm trung bình của lượt đã chấm — `null` khi chưa có. */
  diemTrungBinh: number | null;
};

export function tongHopDeThi(ds: readonly LuotThiDeDo[]): TongHopDeThi[] {
  const bang = new Map<string, TongHopDeThi & { _tongDiem: number; _soCoDiem: number }>();
  for (const l of ds) {
    let t = bang.get(l.examId);
    if (!t) {
      t = {
        examId: l.examId,
        soLuotLanDau: 0,
        soDatLanDau: 0,
        tiLeDatLanDau: null,
        tongLuot: 0,
        diemTrungBinh: null,
        _tongDiem: 0,
        _soCoDiem: 0,
      };
      bang.set(l.examId, t);
    }
    t.tongLuot += 1;
    // ⚠️ M6 đo LẦN ĐẦU. Gộp mọi lần làm vào là đo "cuối cùng có ai đạt không" — một
    // câu hỏi khác hẳn, và nó luôn cho ra con số đẹp hơn vì người ta được làm lại.
    if (l.attemptNo === 1) {
      t.soLuotLanDau += 1;
      if (l.passed === true) t.soDatLanDau += 1;
    }
    if (l.totalScore != null) {
      t._tongDiem += l.totalScore;
      t._soCoDiem += 1;
    }
  }
  return [...bang.values()].map((t) => ({
    examId: t.examId,
    soLuotLanDau: t.soLuotLanDau,
    soDatLanDau: t.soDatLanDau,
    // Mẫu số 0 ⇒ `null`, không phải 0%.
    tiLeDatLanDau:
      t.soLuotLanDau > 0 ? Math.round((t.soDatLanDau / t.soLuotLanDau) * 100) : null,
    tongLuot: t.tongLuot,
    diemTrungBinh:
      t._soCoDiem > 0 ? Math.round((t._tongDiem / t._soCoDiem) * 10) / 10 : null,
  }));
}

export type PhanTichCau = {
  examQuestionId: string;
  soLuot: number;
  soDung: number;
  /** `null` khi chưa lượt nào được chấm câu này. */
  tiLeDung: number | null;
  /**
   * Cờ CẦN RÀ LẠI — câu hỏi này nhiều khả năng có vấn đề, không phải người làm.
   *
   * `null` nghĩa là CHƯA ĐỦ DỮ LIỆU để nói gì, khác hẳn "không có vấn đề".
   */
  canRaLai: boolean | null;
  lyDo: string | null;
};

/**
 * Ngưỡng để một câu bị gắn cờ "cần rà lại".
 *
 * ⚠️ Cả hai đầu, không chỉ đầu khó:
 *  · quá khó (≤ 30% đúng) — câu mơ hồ, hoặc nội dung dạy chưa phủ;
 *  · quá dễ (= 100% đúng trên đủ lượt) — câu không phân loại được ai, tức nó chiếm
 *    chỗ trong đề mà không đo gì.
 */
export const NGUONG_QUA_KHO = 30;
export const NGUONG_QUA_DE = 100;

/**
 * Số lượt TỐI THIỂU trước khi dám kết luận về một câu hỏi.
 *
 * ⚠️ Dưới ngưỡng này trả `canRaLai = null`, KHÔNG trả `false`. Hai người làm sai cả
 * hai không nói lên điều gì về câu hỏi; gắn cờ ở đó là biến nhiễu thành kết luận, và
 * người soạn đề sẽ sửa một câu vốn không sao.
 */
export const SO_LUOT_TOI_THIEU = 5;

export function phanTichCauHoi(
  ds: readonly CauTraLoiDeDo[],
  soLuotToiThieu: number = SO_LUOT_TOI_THIEU,
): PhanTichCau[] {
  const bang = new Map<string, { soLuot: number; soDung: number }>();
  for (const c of ds) {
    // `isCorrect = null` là câu TỰ LUẬN chưa chấm — không đếm vào cả tử lẫn mẫu.
    if (c.isCorrect == null) continue;
    const t = bang.get(c.examQuestionId) ?? { soLuot: 0, soDung: 0 };
    t.soLuot += 1;
    if (c.isCorrect) t.soDung += 1;
    bang.set(c.examQuestionId, t);
  }

  return [...bang.entries()]
    .map(([examQuestionId, t]) => {
      const tiLeDung = t.soLuot > 0 ? Math.round((t.soDung / t.soLuot) * 100) : null;
      if (t.soLuot < soLuotToiThieu || tiLeDung == null) {
        return {
          examQuestionId,
          soLuot: t.soLuot,
          soDung: t.soDung,
          tiLeDung,
          canRaLai: null,
          lyDo: `Mới ${t.soLuot} lượt — chưa đủ để kết luận (cần ${soLuotToiThieu})`,
        };
      }
      if (tiLeDung <= NGUONG_QUA_KHO) {
        return {
          examQuestionId,
          soLuot: t.soLuot,
          soDung: t.soDung,
          tiLeDung,
          canRaLai: true,
          lyDo: `Chỉ ${tiLeDung}% trả lời đúng — nhiều khả năng câu hỏi mơ hồ hoặc nội dung chưa phủ`,
        };
      }
      if (tiLeDung >= NGUONG_QUA_DE) {
        return {
          examQuestionId,
          soLuot: t.soLuot,
          soDung: t.soDung,
          tiLeDung,
          canRaLai: true,
          lyDo: "100% trả lời đúng — câu này không phân loại được ai",
        };
      }
      return {
        examQuestionId,
        soLuot: t.soLuot,
        soDung: t.soDung,
        tiLeDung,
        canRaLai: false,
        lyDo: null,
      };
    })
    .sort((a, b) => (a.tiLeDung ?? 999) - (b.tiLeDung ?? 999));
}

export const R5_COLUMNS = [
  "Đề thi",
  "Tổng lượt",
  "Lượt lần đầu",
  "Đạt lần đầu",
  "M6 %",
  "Điểm TB",
] as const;

export const R5_CAU_COLUMNS = [
  "Câu hỏi",
  "Số lượt",
  "Số đúng",
  "% đúng",
  "Cần rà lại",
  "Lý do",
] as const;
