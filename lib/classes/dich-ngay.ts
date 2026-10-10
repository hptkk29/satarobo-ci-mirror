// lib/classes/dich-ngay.ts — THUẦN: xếp thứ tự một lô "dời ngày buổi học" sao cho KHÔNG BAO GIỜ có hai buổi cùng lớp
// chiếm một thời điểm, dù chỉ trong giây lát giữa hai câu UPDATE.
//
// VÌ SAO CẦN (T03, 07/10/2026): cả bốn đường dời hàng loạt (`luiLichLop`, `resyncClassSessions`, `applyScheduleAction`,
// `applyClassReschedule`) cuốn chiếu: buổi i nhận đúng ngày CỦA BUỔI i+1 (`cuonChieuBuoi`, `assignPhasedDates`). Ví dụ
// 5/5, 7/5, 12/5, 14/5, 19/5 → 5/5, 12/5, 14/5, 19/5, 21/5: cập nhật bài 2 sang 12/5 khi bài 3 CHƯA rời 12/5. Khi có
// chỉ mục duy nhất `(classId, date) WHERE status <> 'CANCELLED'` thì Postgres kiểm TỪNG HÀNG (không hoãn được cho chỉ
// mục từng phần) ⇒ cập nhật theo thứ tự ngày tăng dần là nổ ngay ở câu thứ hai, KHÔNG cần đua.
//
// Cách làm: coi lô là đồ thị "A muốn vào chỗ đang do B giữ ⇒ B phải đi trước"; đi theo thứ tự đó. Gặp VÒNG (hai buổi
// đổi chỗ cho nhau) thì cất một buổi sang ngày ĐỖ (năm 1900 — không buổi thật nào ở đó) rồi đưa nó về đích sau cùng.
// Ít câu UPDATE nhất có thể: chỉ buổi nằm trong vòng mới tốn hai câu.

export type DoiNgay = { id: string; oldDate: Date; newDate: Date };

/** Một câu UPDATE: đưa buổi `id` từ ngày hiện tại `tu` sang `den`. `tam` = ngày đỗ, chưa phải đích. */
export type BuocDich = { id: string; tu: Date; den: Date; tam: boolean };

export type LoiDich =
  | { ma: "TRUNG_DICH"; ngay: Date }
  | { ma: "DE_LEN_BUOI_KHAC"; ngay: Date }
  | { ma: "LAP_ID"; id: string }
  /** Không lập được thứ tự trong số vòng hữu hạn — chỉ xảy ra khi các cổng trên bị bỏ; đừng bao giờ để vòng lặp chạy vô hạn. */
  | { ma: "KHONG_LAP_DUOC" };

const NGAY_DO_GOC = Date.UTC(1900, 0, 1);
/** Ngày đỗ thứ k — cách nhau một phút, đủ phân biệt mà vẫn là mốc năm 1900 hợp lệ cho timestamptz. */
export const ngayDo = (k: number): Date => new Date(NGAY_DO_GOC + k * 60_000);

/**
 * Lập thứ tự dời. `codinh` = ngày của các buổi CÒN SỐNG khác trong lớp (không nằm trong lô) — đích không được đè lên.
 * Buổi có `newDate === oldDate` bị bỏ khỏi kết quả (không có gì để làm).
 */
export function lapThuTuDich(
  doi: readonly DoiNgay[],
  codinh: readonly Date[],
): { ok: true; buoc: BuocDich[] } | { ok: false; loi: LoiDich } {
  const ids = new Set<string>();
  for (const d of doi) {
    if (ids.has(d.id)) return { ok: false, loi: { ma: "LAP_ID", id: d.id } };
    ids.add(d.id);
  }
  const can = doi.filter((d) => d.newDate.getTime() !== d.oldDate.getTime());

  const dich = new Set<number>();
  for (const d of can) {
    const k = d.newDate.getTime();
    if (dich.has(k)) return { ok: false, loi: { ma: "TRUNG_DICH", ngay: d.newDate } };
    dich.add(k);
  }
  const codinhMs = new Set(codinh.map((d) => d.getTime()));
  for (const d of can) {
    if (codinhMs.has(d.newDate.getTime())) return { ok: false, loi: { ma: "DE_LEN_BUOI_KHAC", ngay: d.newDate } };
  }

  // vị trí hiện tại của từng buổi đang chờ dời (ms → id) — ai đang giữ chỗ nào.
  const giu = new Map<number, string>();
  const hienTai = new Map<string, number>();
  const dichCuaId = new Map<string, Date>();
  for (const d of can) {
    giu.set(d.oldDate.getTime(), d.id);
    hienTai.set(d.id, d.oldDate.getTime());
    dichCuaId.set(d.id, d.newDate);
  }

  const buoc: BuocDich[] = [];
  const conLai = can.map((d) => d.id); // giữ thứ tự gốc cho kết quả ổn định
  let k = 0;
  // Mỗi buổi tối đa một lần cất và một lần vào đích ⇒ 2n vòng là đủ. Quá số đó là dữ liệu vào sai (đích trùng nhau…) mà cổng
  // phía trên đáng lẽ đã chặn: trả lỗi, KHÔNG quay vô hạn (bản cấy thử bỏ cổng từng làm test treo tới hết giờ).
  let vong = 0;
  while (conLai.length > 0) {
    if (++vong > 2 * can.length + 2) return { ok: false, loi: { ma: "KHONG_LAP_DUOC" } };
    let tienDuoc = false;
    for (let i = 0; i < conLai.length; ) {
      const id = conLai[i]!;
      const den = dichCuaId.get(id)!;
      const ai = giu.get(den.getTime());
      if (ai === undefined || ai === id) {
        const tu = hienTai.get(id)!;
        buoc.push({ id, tu: new Date(tu), den, tam: false });
        giu.delete(tu);
        giu.set(den.getTime(), id);
        hienTai.delete(id);
        conLai.splice(i, 1);
        tienDuoc = true;
      } else {
        i++;
      }
    }
    if (!tienDuoc && conLai.length > 0) {
      // VÒNG: cất buổi đầu tiên sang ngày đỗ, giải phóng chỗ nó đang giữ; nó quay lại hàng chờ với vị trí mới.
      const id = conLai[0]!;
      const tu = hienTai.get(id)!;
      k += 1;
      const do_ = ngayDo(k);
      buoc.push({ id, tu: new Date(tu), den: do_, tam: true });
      giu.delete(tu);
      giu.set(do_.getTime(), id);
      hienTai.set(id, do_.getTime());
    }
  }
  return { ok: true, buoc };
}
