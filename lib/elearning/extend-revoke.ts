/**
 * EL-05 — GIA HẠN và THU HỒI.
 *
 * Hai thao tác nhìn thì nhỏ, nhưng cả hai đều đụng vào con số mà mọi báo cáo
 * đứng lên: tỉ lệ đúng hạn.
 *
 * ⚠️ LUẬT KHÔNG ĐƯỢC PHÁ: gia hạn ghi `dueAt`, **không bao giờ** ghi
 * `dueAtOriginal`. Ghi cả hai thì ai được gia hạn cũng thành "đúng hạn", và chỉ
 * số đúng hạn thành thứ đo được 100% mãi mãi. Đây cũng là lý do bảng có hai cột
 * chứ không một.
 */

export type TrangThaiGhiDanh =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "COMPLETED_LATE"
  | "OVERDUE"
  | "REVOKED";

export type DongGhiDanh = {
  id: string;
  status: TrangThaiGhiDanh;
  dueAt: Date | null;
};

export type LyDoBoQua =
  | "DA_THU_HOI"
  | "DA_HOAN_THANH"
  | "KHONG_CO_HAN"
  | "HAN_MOI_KHONG_XA_HON";

export type KetQuaGiaHan = {
  /** Dòng sẽ ghi: id + hạn mới. */
  capNhat: { id: string; dueAt: Date }[];
  /** Dòng KHÔNG đụng tới, kèm lý do — để màn hình nói được vì sao. */
  boQua: { id: string; lyDo: LyDoBoQua }[];
};

/**
 * Tính hạn mới cho một lô ghi danh.
 *
 * Hai kiểu gia hạn:
 * - `denNgay` — mốc tuyệt đối, dùng khi người vận hành gõ thẳng ngày.
 * - `themNgay` — cộng N ngày, tính từ `max(hạn hiện tại, bây giờ)`.
 *
 * ⚠️ Vì sao cộng từ `max(hạn, bây giờ)` chứ không từ hạn cũ: nút này tồn tại cho
 * tình huống SỰ CỐ HỆ THỐNG, và sự cố thường được xác nhận SAU khi hạn đã trôi
 * qua. Cộng 2 ngày vào một cái hạn đã quá 5 ngày thì hạn mới vẫn nằm trong quá
 * khứ — người học vẫn bị khoá, và người vận hành tưởng mình đã cứu họ.
 */
export function tinhGiaHan(
  ds: DongGhiDanh[],
  cach: { denNgay: Date } | { themNgay: number },
  now: Date,
): KetQuaGiaHan {
  const capNhat: { id: string; dueAt: Date }[] = [];
  const boQua: { id: string; lyDo: LyDoBoQua }[] = [];

  for (const d of ds) {
    if (d.status === "REVOKED") {
      boQua.push({ id: d.id, lyDo: "DA_THU_HOI" });
      continue;
    }
    if (d.status === "COMPLETED" || d.status === "COMPLETED_LATE") {
      // Gia hạn cho người đã học xong không sai, nhưng nó ghi đè một cột đã yên
      // và làm sổ audit đầy những dòng không đổi gì.
      boQua.push({ id: d.id, lyDo: "DA_HOAN_THANH" });
      continue;
    }
    if (!d.dueAt) {
      // Bài không hạn thì không có gì để gia hạn. Đặt hạn cho nó là BIẾN bài tự
      // chọn thành bài có hạn — một thao tác khác hẳn, phải đi đường khác.
      boQua.push({ id: d.id, lyDo: "KHONG_CO_HAN" });
      continue;
    }

    const moi =
      "denNgay" in cach
        ? cach.denNgay
        : new Date(
            Math.max(d.dueAt.getTime(), now.getTime()) +
              cach.themNgay * 24 * 60 * 60 * 1000,
          );

    if (moi.getTime() <= d.dueAt.getTime()) {
      // Rút ngắn hạn không phải "gia hạn". Cho nó lọt qua đường này là để một
      // thao tác siết chặt đi qua cái nút mang tên nới lỏng — và người bị siết
      // chỉ biết khi đã trễ.
      boQua.push({ id: d.id, lyDo: "HAN_MOI_KHONG_XA_HON" });
      continue;
    }
    capNhat.push({ id: d.id, dueAt: moi });
  }

  return { capNhat, boQua };
}

export type KetQuaThuHoi = {
  thuHoi: string[];
  boQua: { id: string; lyDo: "DA_THU_HOI" | "DA_HOAN_THANH" }[];
};

/**
 * Chọn dòng nào được thu hồi.
 *
 * ⚠️ Người ĐÃ HỌC XONG không bị thu hồi. Thu hồi họ là xoá bằng chứng của một
 * việc đã hoàn thành thật — và với khoá bắt buộc, đó là xoá luôn cơ sở để nói
 * người này đã được đào tạo.
 */
export function chonDeThuHoi(ds: DongGhiDanh[]): KetQuaThuHoi {
  const thuHoi: string[] = [];
  const boQua: { id: string; lyDo: "DA_THU_HOI" | "DA_HOAN_THANH" }[] = [];
  for (const d of ds) {
    if (d.status === "REVOKED") {
      boQua.push({ id: d.id, lyDo: "DA_THU_HOI" });
      continue;
    }
    if (d.status === "COMPLETED" || d.status === "COMPLETED_LATE") {
      boQua.push({ id: d.id, lyDo: "DA_HOAN_THANH" });
      continue;
    }
    thuHoi.push(d.id);
  }
  return { thuHoi, boQua };
}
