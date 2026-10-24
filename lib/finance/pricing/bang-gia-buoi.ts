// lib/finance/pricing/bang-gia-buoi.ts — BẢNG GIÁ THEO BUỔI. Thuần.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO HỌC PHÍ PHẢI BỂ RA THÀNH GIÁ TỪNG BUỔI
//
// Một con số học phí không trả lời được câu hỏi duy nhất quan trọng khi phụ huynh cho con
// nghỉ giữa chừng: **"cháu đã học 20 buổi thì tính bao nhiêu?"**. Chia nhẩm `học phí × 20/48`
// ra số lẻ, và mỗi người nhẩm một kiểu. Bảng giá buổi biến câu đó thành một phép cộng.
//
// Nó cũng là chỗ duy nhất biểu diễn được "mất ưu đãi từ buổi 25": tách bảng thành hai đoạn,
// đoạn sau giá khác. Không có bảng giá thì việc đó phải sửa học phí — tức sửa một con số đã
// ký với phụ huynh.
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT LÀM TRÒN (BA 4.4) — VÀ VÌ SAO PHẦN LẺ DỒN VÀO BUỔI CUỐI
//
// Đơn giá làm tròn XUỐNG tới 1.000đ; phần lẻ dồn vào **buổi cuối**.
//
// Hai phương án khác đều tệ hơn, và tệ theo cách khó thấy:
//   · Chia đều rồi để số lẻ ở mọi buổi ⇒ đơn giá kiểu 208.333,33đ. Mọi màn in ra một số có
//     phần thập phân, và Σ 48 buổi không bao giờ đúng bằng học phí vì phép làm tròn hiển thị.
//   · Dồn lẻ vào buổi ĐẦU ⇒ buổi đầu đắt nhất, và đó đúng là buổi hay bị bỏ (học thử xong
//     không theo). Quyết toán buổi 1 sẽ đòi nhiều hơn phụ huynh nghĩ.
//
// Dồn vào buổi cuối: mọi buổi trừ buổi cuối có giá TRÒN NGHÌN, giải thích được qua điện thoại;
// và phần lẻ rơi vào buổi mà gần như ai học tới đó cũng đã đóng đủ tiền.
//
// ⚠️ Pre-mortem T12 chỉ đúng vào đây: 9.600.000 ÷ 48 tròn, nhưng 10.000.000 ÷ 48 thì không.
// Nếu Σ bảng giá lệch học phí dù chỉ vài trăm đồng, kiểm cân đêm sẽ báo đỏ mỗi đêm, và một
// cảnh báo đỏ thường trực là một cảnh báo bị bỏ qua. Vì thế có test thuộc tính 1.000 bộ số.

/** Một đoạn giá: các buổi từ `tuBuoi` đến `denBuoi` cùng đơn giá. Cả hai đầu ĐỀU tính. */
export type DoanGia = {
  /** Số thứ tự buổi đầu đoạn, tính từ 1. */
  tuBuoi: number;
  /** Số thứ tự buổi cuối đoạn, tính từ 1. */
  denBuoi: number;
  donGia: number;
};

/** Bước làm tròn đơn giá. Tiền Việt không có mệnh giá dưới 1.000 đáng in ra. */
export const BUOC_LAM_TRON = 1_000;

/**
 * Bể học phí thực của MỘT dòng thành bảng giá buổi.
 *
 * Trả 1 đoạn khi chia hết, 2 đoạn khi có phần lẻ. KHÔNG bao giờ trả đoạn có đơn giá âm, và
 * Σ (số buổi × đơn giá) LUÔN bằng `hocPhiThuc` — đó là hai thứ test thuộc tính canh.
 *
 * Đầu vào rác (số buổi ≤ 0, học phí âm/NaN) trả mảng RỖNG thay vì ném: hàm này chạy trong
 * đường tạo đơn, và một ngoại lệ ở đây làm hỏng cả transaction vì một ô người dùng gõ sai.
 * Mảng rỗng thì `tongBangGia` ra 0 và cổng kiểm kế hoạch từ chối với một câu nói được.
 */
export function bangGiaBuoi(hocPhiThuc: number, soBuoi: number): DoanGia[] {
  const n = Number.isFinite(soBuoi) ? Math.trunc(soBuoi) : 0;
  const tong = Number.isFinite(hocPhiThuc) ? Math.round(hocPhiThuc) : -1;
  if (n <= 0 || tong < 0) return [];
  if (n === 1) return [{ tuBuoi: 1, denBuoi: 1, donGia: tong }];

  const donGia = Math.floor(tong / n / BUOC_LAM_TRON) * BUOC_LAM_TRON;
  const buoiCuoi = tong - donGia * (n - 1);

  // Chia hết theo bước làm tròn ⇒ một đoạn duy nhất. Tách thành hai đoạn giá BẰNG NHAU là đẻ
  // một đoạn 1 buổi vô nghĩa trong mọi bảng hiển thị và mọi phép tách đoạn sau này.
  if (buoiCuoi === donGia) return [{ tuBuoi: 1, denBuoi: n, donGia }];

  return [
    { tuBuoi: 1, denBuoi: n - 1, donGia },
    { tuBuoi: n, denBuoi: n, donGia: buoiCuoi },
  ];
}

/** Σ tiền của cả bảng giá. Phải bằng học phí thực — bất biến B6. */
export function tongBangGia(doan: readonly DoanGia[]): number {
  return doan.reduce((s, d) => s + soBuoiCuaDoan(d) * Math.round(d.donGia), 0);
}

function soBuoiCuaDoan(d: DoanGia): number {
  return Math.max(0, Math.trunc(d.denBuoi) - Math.trunc(d.tuBuoi) + 1);
}

/**
 * Giá trị đã dùng sau `k` buổi — nền của mọi phép quyết toán khi dừng học.
 *
 * ⚠️ `k` là **số buổi ĐÃ DIỄN RA**, và ở hệ thống này nó KHÔNG được đếm bằng
 * `ClassSession.status = 'COMPLETED'`. Đo 16/09 (`docs/thanh-toan-linh-hoat/gate-0.md` G0-4):
 * **93 buổi đã qua vẫn mang `SCHEDULED`** — 16,8% số buổi quá khứ. Đếm theo `status` là đếm
 * THIẾU 1/6, và đếm thiếu nghĩa là TRẢ LẠI cho phụ huynh nhiều hơn thực tế. Đếm theo
 * `ClassSession.date ≤ mốc`: ngày là sự thật của tờ lịch, `status` là cột phải có người bấm.
 *
 * `k` vượt tổng số buổi bị kẹp — học lố là chuyện của quyết toán (phí, dòng dương), không phải
 * chuyện của bảng giá.
 */
export function giaTriDaDung(doan: readonly DoanGia[], k: number): number {
  const soBuoi = Number.isFinite(k) ? Math.max(0, Math.trunc(k)) : 0;
  let conLai = soBuoi;
  let tien = 0;
  for (const d of [...doan].sort((a, b) => a.tuBuoi - b.tuBuoi)) {
    if (conLai <= 0) break;
    const lay = Math.min(conLai, soBuoiCuaDoan(d));
    tien += lay * Math.round(d.donGia);
    conLai -= lay;
  }
  return tien;
}

/**
 * Tách bảng giá tại buổi `k`: từ buổi `k` trở đi dùng đơn giá mới.
 *
 * Đây là phép biểu diễn "mất ưu đãi anh em từ buổi 25" (BA 4.4). Các buổi TRƯỚC `k` giữ nguyên
 * giá cũ — tức **không truy thu đoạn đã học**, đúng mặc định `BO_TU_DOAN_CHUA_HOC`.
 *
 * `k ≤ 1` ⇒ cả bảng về giá mới (ca "chưa học buổi nào", tình huống C của gia đình mẫu).
 * `k` vượt tổng số buổi ⇒ không đổi gì.
 */
export function tachBangGiaTaiBuoi(
  doan: readonly DoanGia[],
  k: number,
  donGiaMoi: number,
): DoanGia[] {
  const sapXep = [...doan].sort((a, b) => a.tuBuoi - b.tuBuoi);
  const tongBuoi = sapXep.reduce((s, d) => s + soBuoiCuaDoan(d), 0);
  const moc = Number.isFinite(k) ? Math.trunc(k) : 1;
  const gia = Number.isFinite(donGiaMoi) ? Math.max(0, Math.round(donGiaMoi)) : 0;
  if (tongBuoi === 0) return [];
  if (moc > tongBuoi) return sapXep;
  if (moc <= 1) return [{ tuBuoi: 1, denBuoi: tongBuoi, donGia: gia }];

  const ra: DoanGia[] = [];
  for (const d of sapXep) {
    if (d.denBuoi < moc) {
      ra.push({ ...d });
      continue;
    }
    if (d.tuBuoi < moc) ra.push({ tuBuoi: d.tuBuoi, denBuoi: moc - 1, donGia: d.donGia });
    // Phần từ `moc` trở đi của đoạn này bị nuốt vào đoạn giá mới — gộp ở dưới.
  }
  ra.push({ tuBuoi: moc, denBuoi: tongBuoi, donGia: gia });
  return ra;
}
