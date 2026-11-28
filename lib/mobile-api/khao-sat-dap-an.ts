// lib/mobile-api/khao-sat-dap-an.ts — kiểm đáp án khảo sát theo ĐÚNG câu hỏi của khảo sát (OD-16, chủ dự án chốt 19/11/2026: thang 0–10, KHÔNG ẩn danh). THUẦN, không DB.
//
// Giữ NGUYÊN luật của web (`app/(portal)/portal/khao-sat/_actions.ts` — `submitSurveyResponse`): NPS 0–10, RATING 1–5, TEXT là chuỗi; câu NPS/RATING bắt buộc, TEXT tuỳ chọn;
// đáp án không thuộc khảo sát ⇒ từ chối; `npsScore` lấy từ câu NPS ĐẦU TIÊN (KPI). Viết lại thành hàm thuần để test được từng nhánh — nợ kỹ thuật ghi nhận: hợp nhất hai bản về một lõi
// khi sửa lưới web cùng lúc (cùng cách `lib/mobile-api/dich-vu/yeu-cau.ts`).
//
// KHÔNG có chế độ ẩn danh ở bất kỳ đâu trong đường này: người gửi luôn là tài khoản xác thực (`parentUserId` do máy chủ gắn từ phiên, không do client gửi).
export type LoaiCau = "NPS" | "RATING" | "TEXT";
export type CauKhaoSat = { id: string; text: string; type: LoaiCau };
export type DapAn = { questionId: string; value: number | string };

export type KetQuaKiem = { ok: true; answers: Record<string, number | string>; npsScore: number | null } | { ok: false; loi: string };

export function kiemDapAnKhaoSat(cau: readonly CauKhaoSat[], dapAn: readonly DapAn[]): KetQuaKiem {
  if (cau.length === 0) return { ok: false, loi: "Khảo sát này chưa có câu hỏi." };
  const theoId = new Map(cau.map((q) => [q.id, q]));
  const answers: Record<string, number | string> = {};
  const daTraLoi = new Set<string>();
  for (const a of dapAn) {
    const q = theoId.get(a.questionId);
    if (!q) return { ok: false, loi: "Câu trả lời không thuộc khảo sát này." };
    if (daTraLoi.has(q.id)) return { ok: false, loi: `Câu «${q.text}» bị trả lời hai lần.` };
    daTraLoi.add(q.id);
    if (q.type === "TEXT") {
      if (typeof a.value !== "string") return { ok: false, loi: `Đáp án không hợp lệ cho «${q.text}».` };
      const t = a.value.trim();
      if (t.length > 2000) return { ok: false, loi: `Câu «${q.text}» quá dài.` };
      if (t.length > 0) answers[q.id] = t;
    } else {
      const min = q.type === "NPS" ? 0 : 1;
      const max = q.type === "NPS" ? 10 : 5;
      if (typeof a.value !== "number" || !Number.isInteger(a.value) || a.value < min || a.value > max) return { ok: false, loi: `Đáp án không hợp lệ cho «${q.text}» (từ ${min} đến ${max}).` };
      answers[q.id] = a.value;
    }
  }
  for (const q of cau) if (q.type !== "TEXT" && answers[q.id] === undefined) return { ok: false, loi: `Vui lòng trả lời: ${q.text}` };
  const nps = cau.find((q) => q.type === "NPS");
  const v = nps ? answers[nps.id] : undefined;
  return { ok: true, answers, npsScore: typeof v === "number" ? v : null };
}
