/**
 * EL-20 — ẢNH CHỤP CHỈ SỐ và ngưỡng ẩn danh ở TẦNG DỮ LIỆU.
 *
 * ⚠️ Vì sao chụp thay vì tính lại mỗi lần mở báo cáo: mọi mốc NSM viết dạng tỉ lệ có
 * mẫu số, mà mẫu số đổi theo thời gian (người vào, người nghỉ, yêu cầu mới khai).
 * Tính lại nghĩa là con số của tháng 3 đổi vì một việc xảy ra tháng 9 — trong khi
 * người đọc báo cáo tháng 3 đã ra quyết định dựa trên nó.
 */

/** Ngưỡng n tối thiểu — cùng con số với R4, và cùng lý do. */
export const NGUONG_N_ANH_CHUP = 5;

export type ChieuTachNhom = Record<string, string>;

/**
 * Khoá phẳng của một chiều, để đưa vào `@@unique` (Postgres không cho unique trên
 * JSON).
 *
 * ⚠️ Dựng ở MỘT chỗ duy nhất và sắp khoá theo alphabet: `{a:1,b:2}` và `{b:2,a:1}` là
 * cùng một chiều, nhưng `JSON.stringify` cho ra hai chuỗi khác nhau — và hai dòng ảnh
 * chụp cho cùng một nhóm là mất luôn ý nghĩa của khoá duy nhất.
 */
export function dimensionKeyCua(chieu: ChieuTachNhom): string {
  const khoa = Object.keys(chieu).sort();
  if (khoa.length === 0) return "TONG";
  return khoa.map((k) => `${k}=${chieu[k]}`).join("|");
}

export type DongAnhChup = {
  metricKey: string;
  chieu: ChieuTachNhom;
  numerator: number;
  denominator: number;
  groupN: number;
};

export type AnhChupDeGhi = DongAnhChup & {
  dimensionKey: string;
  suppressed: boolean;
};

/**
 * 🔴 Áp ngưỡng ẩn danh — trả về bản ĐỂ GHI.
 *
 * `suppressed = true` nghĩa là nhóm này KHÔNG được công bố tách riêng. Dòng vẫn được
 * ghi (số liệu còn đó để cộng dồn), chỉ là mọi đường ĐỌC phải tôn trọng cờ.
 *
 * ⚠️ Đặt cờ ở tầng DỮ LIỆU chứ không tầng hiển thị. Một cờ ở tầng hiển thị thì lần
 * xuất Excel tiếp theo, hay một màn mới, hay một truy vấn tay sẽ bỏ qua nó — và ở quy
 * mô 15 người với ba phòng mỗi phòng một người, "bỏ qua nó" nghĩa là nêu đích danh
 * một cá nhân.
 */
export function apNguong(
  ds: readonly DongAnhChup[],
  nguong: number = NGUONG_N_ANH_CHUP,
): AnhChupDeGhi[] {
  return ds.map((d) => ({
    ...d,
    dimensionKey: dimensionKeyCua(d.chieu),
    // Dòng TỔNG (không tách chiều) không bao giờ bị chặn: nó không nói về ai cụ thể.
    suppressed: Object.keys(d.chieu).length > 0 && d.groupN < nguong,
  }));
}

/** Tỉ lệ — `null` khi mẫu số 0, KHÔNG phải 0%. */
export function tiLeAnhChup(d: {
  numerator: number;
  denominator: number;
}): number | null {
  return d.denominator > 0
    ? Math.round((d.numerator / d.denominator) * 100)
    : null;
}

/**
 * 🔴 CỤM TỪ BỊ CẤM trên báo cáo hiệu quả R7 và mọi phiếu L3/L4.
 *
 * ⚠️ Đây không phải chuyện văn phong. Ở quy mô 15 người, Kirkpatrick L3 và L4 **vĩnh
 * viễn** không có ý nghĩa thống kê — không phải "chờ đủ dữ liệu". Một phép so sánh
 * nhóm ở n = 15 tạo ra một con số **nghe như bằng chứng mà không phải bằng chứng**,
 * và nó sẽ được dùng để quyết định về con người.
 *
 * Thay bằng ĐỌC TỪNG CA: mỗi ca một dòng, quản lý trực tiếp viết nhận xét, Trưởng
 * phòng Đào tạo đọc từng dòng.
 *
 * Có một bước kiểm tĩnh quét mẫu báo cáo và ĐỎ nếu tìm thấy các cụm này (TS-37).
 */
export const CUM_TU_CAM_R7 = [
  "so sánh nhóm",
  "nhóm đã học",
  "nhóm chưa học",
  "nhóm đối chứng",
  "có ý nghĩa thống kê",
  "tương quan",
  "chênh lệch có ý nghĩa",
] as const;

export function quetCumTuCam(vanBan: string): string[] {
  const thuong = vanBan.toLowerCase();
  return CUM_TU_CAM_R7.filter((c) => thuong.includes(c));
}

/**
 * Chi phí trên mỗi lượt hoàn thành.
 *
 * ⚠️ Chưa khai ngân sách ⇒ trả `null`, và màn hình phải in một dòng chữ — KHÔNG in số
 * 0. "0đ/người" bị đọc thành "đào tạo không tốn gì", và đó là câu sẽ được trích trong
 * một cuộc họp về ngân sách.
 */
export function chiPhiMoiLuot(input: {
  nganSach: number | null;
  soLuotHoanThanh: number;
}): number | null {
  if (input.nganSach == null) return null;
  if (input.soLuotHoanThanh <= 0) return null;
  return Math.round(input.nganSach / input.soLuotHoanThanh);
}

/**
 * HAI dòng chú thích BẮT BUỘC đi kèm mọi con số chi phí (QĐ-CDA-05, QĐ-CDA-07).
 *
 * Không có chúng thì con số chi phí bị đọc là tổng chi phí đào tạo, trong khi nó chỉ
 * là phần ngân sách khai tay.
 */
export const CHU_THICH_CHI_PHI = [
  "Không bao gồm giờ công người học — giờ học là tự chọn và không tính công (QĐ-CDA-05).",
  "Không bao gồm giờ sản xuất nội dung của dự án — sản xuất nội dung là hoạt động vận hành thường xuyên của phòng Đào tạo sau bàn giao (QĐ-CDA-07).",
] as const;
