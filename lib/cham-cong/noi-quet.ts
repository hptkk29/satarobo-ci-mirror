/**
 * lib/cham-cong/noi-quet.ts — NƠI QUÉT của một lượt, và nhãn hiện trên bảng công ngày.
 *
 * THUẦN — không `@/lib/db`, không `next/*`. Test được không cần Postgres.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HAI KHÁI NIỆM, ĐỪNG TRỘN
 *
 *   · **NƠI CHỊU CÔNG** của một NGÀY — `recomputeAttendanceDay`:
 *     `assignment?.centerId ?? logs[0]?.centerId ?? home.centerId`.
 *     Ngày công thuộc nơi người đó TRỰC THUỘC / được xếp ca.
 *
 *   · **NƠI QUÉT** của một LƯỢT — `recordTimeLog`: `centerId = wl.centerId`,
 *     kèm `workLocationId` là điểm chấm cụ thể.
 *
 * Hai cái CỐ Ý khác nhau. Người Hội sở quét QR ở CS1 thì **ngày công vẫn thuộc Hội sở**,
 * còn lượt quét mang "CS1". Nhân viên CS1 sang CS2 học nội bộ cũng vậy. Và check-in ở CS1
 * rồi check-out ở CS2 là hợp lệ — **mỗi lượt mang nơi của chính nó**, không phải cả ngày
 * mang một nơi.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CÓ FILE NÀY — ảnh prod 10/09/2026
 *
 * Bảng công ngày in `08:39 → — ·1 · quét nơi khác`. Nhãn đó **vô nghĩa với người đọc**:
 * hệ biết chính xác lượt ấy ở đâu. Đo prod cùng ngày: đúng 1 lượt như vậy — người Hội sở
 * quét ở CS2, mã ca HC, **KHÔNG cờ nào** (đúng — `place.ts` cố ý không gắn `SAI_NOI_LAM`
 * cho người HO vì `placeMode` của họ là `ANY_CENTER`).
 *
 * ⇒ Dữ liệu đúng, cờ đúng, chỉ CÁI NHÃN làm rụng tên. Đây là luật 12 ở dạng nhẹ: một nhãn
 * nói ít hơn thứ hệ thống đang biết cũng là một lời hứa hụt.
 */

/** Một lượt quét, rút gọn còn phần hàm này cần. */
export type LuotCoNoi = { centerId: string };

/**
 * Danh sách MÃ cơ sở mà người đó đã quét ở đó nhưng KHÁC nơi chịu công của ngày.
 *
 * Trả mảng rỗng khi mọi lượt đều ở đúng nơi chịu công — đó là ca thường, và nhãn phải
 * IM LẶNG chứ không in một chuỗi thừa.
 *
 * @param maTheoId `centerId` → mã cơ sở ("CS1", "HO"). Thiếu id nào thì bỏ qua id đó thay
 *   vì in một chuỗi rác — nhãn nói sai còn tệ hơn nhãn không nói.
 */
export function noiQuetKhacNoiChiuCong(
  luot: readonly LuotCoNoi[],
  centerIdChiuCong: string,
  maTheoId: ReadonlyMap<string, string>,
): string[] {
  const ra: string[] = [];
  for (const l of luot) {
    if (l.centerId === centerIdChiuCong) continue;
    const ma = maTheoId.get(l.centerId);
    if (ma && !ra.includes(ma)) ra.push(ma);
  }
  return ra;
}

/**
 * Đuôi nhãn cho ô "Quét" trên bảng công ngày. Chuỗi rỗng = không thêm gì.
 *
 * Cố ý KHÔNG dùng chữ "khác"/"lạ"/"sai": người Hội sở quét ở cơ sở, hay nhân viên CS1 sang
 * CS2 học nội bộ, đều là chuyện thường ngày. Nhãn chỉ NÓI RA NƠI, không phán xét.
 */
export function nhanNoiQuet(ma: readonly string[]): string {
  return ma.length ? ` · quét ở ${ma.join(", ")}` : "";
}
