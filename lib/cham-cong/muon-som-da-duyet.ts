// lib/cham-cong/muon-som-da-duyet.ts — đơn ĐI MUỘN / VỀ SỚM đã duyệt ⇒ khung giờ được miễn trừ
// cho engine (đợt 2 đơn từ, chủ dự án chốt Q-5 08/10/2026: "miễn trừ công").
//
// THUẦN — không DB. `recompute.ts` đọc các đơn `LATE_EARLY` APPROVED của (người × ngày) rồi gom qua
// đây; engine nhận kết quả như mọi dữ liệu khác. Engine KHÔNG đọc thẳng bảng đơn (BA §7: dựng
// "context" rồi mới tính).
//
// ── Vì sao tính LÚC TÍNH LẠI CÔNG, không chụp lúc duyệt ─────────────────────────────────────
// Đơn đi muộn thường nộp TRƯỚC ngày ("biết trước sẽ đến muộn") — lúc duyệt chưa có lượt quét
// nào để so. Chụp số phút lúc duyệt thì hoặc ra 0, hoặc lệch khi người đó đổi ca / quét lại. Đọc
// đơn mỗi lần tính lại thì số luôn theo dữ liệu hiện tại.
//
// ── Miễn trừ TRONG KHUNG đã xin, không phải cả ngày ────────────────────────────────────────────
// Xin đến lúc 08:30 mà 09:10 mới tới ⇒ 30′ đầu được miễn, 40′ sau vẫn là đi muộn (cờ `DI_MUON`
// giữ nguyên, nội quy vẫn đếm nếu phần vượt quá ngưỡng). Miễn trọn ngày thì đơn "xin muộn 10′"
// thành giấy phép đến lúc nào cũng được.
import { laDiMuon } from "./tom-tat-don";

/** Phút kể từ 00:00 giờ VN. `null` = không có đơn đã duyệt cho chiều đó. */
export type MuonSomDaDuyet = {
  /** Đơn "Đi muộn": được đến muộn tới mốc này (đầu ca). */
  denLuc: number | null;
  /** Đơn "Về sớm": được về từ mốc này (cuối ca). */
  veLuc: number | null;
};

export const KHONG_CO_DON_MUON_SOM: MuonSomDaDuyet = { denLuc: null, veLuc: null };

function phut(hhmm: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/**
 * Gom mọi đơn LATE_EARLY ĐÃ DUYỆT của một ngày. Nhiều đơn cùng chiều (hiếm — cổng "đơn trùng" chỉ
 * chặn đơn còn chờ) ⇒ lấy khung RỘNG nhất đã được duyệt: đến muộn nhất / về sớm nhất.
 *
 * Đơn không rõ chiều (`detail` lạ) hoặc giờ sai định dạng ⇒ BỎ QUA, không đoán: đoán sai chiều là
 * miễn trừ nhầm cho một vi phạm khác.
 */
export function gomMuonSomDaDuyet(
  dons: readonly { detail: string | null; startTime: string | null }[],
): MuonSomDaDuyet {
  let denLuc: number | null = null;
  let veLuc: number | null = null;
  for (const d of dons) {
    const gio = phut(d.startTime);
    if (gio === null) continue;
    const muon = laDiMuon(d.detail);
    if (muon === true) denLuc = denLuc === null ? gio : Math.max(denLuc, gio);
    else if (muon === false) veLuc = veLuc === null ? gio : Math.min(veLuc, gio);
  }
  return { denLuc, veLuc };
}
