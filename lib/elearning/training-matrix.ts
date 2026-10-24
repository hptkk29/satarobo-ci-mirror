import {
  khopYeuCau,
  PHAM_VI_CHUA_KHOP_DUOC,
  type NguoiDeKhop,
  type YeuCauDeKhop,
} from "@/lib/elearning/requirement-match";

/**
 * EL-17 — MA TRẬN ĐÀO TẠO R3, và mẫu số của North Star Metric.
 *
 * ⚠️ Ô XÁM là lý do tệp này tồn tại, và nó là một khẳng định chứ không phải một màu.
 *
 * Ba trạng thái của một ô KHÔNG phải "đạt / chưa đạt / chưa có dữ liệu". Chúng là:
 *
 *   ĐẠT          — người này có lượt hoàn thành còn hiệu lực cho yêu cầu đó
 *   CHƯA ĐẠT     — yêu cầu ÁP CHO họ, và họ chưa xong
 *   KHÔNG ÁP DỤNG— yêu cầu KHÔNG áp cho họ (ô xám)
 *
 * "Không áp dụng" là một CÂU TRẢ LỜI. Trộn nó với "chưa biết" biến một khoảng trống
 * dữ liệu thành một kết luận về con người — và đó là kết luận sẽ đi vào báo cáo tuân
 * thủ có ghi tên, gửi thẳng quản lý trực tiếp.
 *
 * Vì vậy có trạng thái thứ tư, và nó KHÔNG được vẽ cùng màu với ô xám:
 *
 *   CHUA_DOI_CHIEU_DUOC — phạm vi của yêu cầu chưa tra được ở đâu (`POSITION` khi
 *                         bảng `Position` rỗng, `LEVEL_TAG` khi không bảng nào gắn
 *                         thẻ bậc cho một con người)
 *
 * ⚠️ MẪU SỐ của NSM là số CẶP (người × yêu cầu ÁP DỤNG) — không phải số người, không
 * phải số người × số yêu cầu. Người không dính yêu cầu nào thì KHÔNG nằm trong mẫu
 * số; thêm một vị trí mới không làm mẫu số phình lên (TS-35 bước ④/⑤).
 */

export type TrangThaiO =
  | "DAT"
  | "CHUA_DAT"
  | "KHONG_AP_DUNG"
  | "CHUA_DOI_CHIEU_DUOC";

export type ODat = {
  userId: string;
  requirementId: string;
  trangThai: TrangThaiO;
  /** Chỉ có khi `CHUA_DOI_CHIEU_DUOC` — nói rõ vướng ở đâu. */
  lyDo: string | null;
};

/**
 * Người này đã ĐẠT yêu cầu nào — tra bằng cặp (người, khoá) đã hoàn thành CÒN HIỆU
 * LỰC.
 *
 * ⚠️ "Còn hiệu lực", không phải "đã từng hoàn thành". Một chứng nhận hết hạn nghĩa là
 * người ấy CHƯA ĐẠT lại — đó là toàn bộ lý do chu kỳ tái chứng nhận tồn tại. Đếm
 * "đã từng học" là báo cáo tuân thủ nói dối theo hướng dễ chịu.
 */
export type ChungCuDat = {
  userId: string;
  courseId: string;
};

export function dungMaTran(input: {
  nguoi: NguoiDeKhop[];
  yeuCau: YeuCauDeKhop[];
  /** Cặp (người, khoá) đã đạt và CÒN hiệu lực. */
  daDat: ChungCuDat[];
  /** `requirementId` → `courseId`, để nối yêu cầu với chứng cứ đạt. */
  khoaCuaYeuCau: Map<string, string>;
}): ODat[] {
  const datSet = new Set(input.daDat.map((d) => `${d.userId}::${d.courseId}`));
  const o: ODat[] = [];

  for (const ng of input.nguoi) {
    const khop = khopYeuCau(ng, input.yeuCau);
    const apDung = new Set(khop.apDung.map((y) => y.id));
    const vuong = new Map(
      khop.khongDoiChieuDuoc.map((k) => [k.yeuCau.id, k.lyDo] as const),
    );

    for (const y of input.yeuCau) {
      if (vuong.has(y.id)) {
        o.push({
          userId: ng.userId,
          requirementId: y.id,
          trangThai: "CHUA_DOI_CHIEU_DUOC",
          lyDo: vuong.get(y.id) ?? null,
        });
        continue;
      }
      if (!apDung.has(y.id)) {
        o.push({
          userId: ng.userId,
          requirementId: y.id,
          trangThai: "KHONG_AP_DUNG",
          lyDo: null,
        });
        continue;
      }
      const courseId = input.khoaCuaYeuCau.get(y.id);
      const dat = courseId != null && datSet.has(`${ng.userId}::${courseId}`);
      o.push({
        userId: ng.userId,
        requirementId: y.id,
        trangThai: dat ? "DAT" : "CHUA_DAT",
        lyDo: null,
      });
    }
  }

  return o;
}

export type KetQuaNSM = {
  /** Số cặp ĐẠT. */
  tuSo: number;
  /** Số cặp ÁP DỤNG — `DAT` + `CHUA_DAT`. */
  mauSo: number;
  /**
   * Số cặp CHƯA ĐỐI CHIẾU ĐƯỢC — nằm NGOÀI cả tử lẫn mẫu, và phải hiện ra.
   *
   * ⚠️ Nhét chúng vào mẫu số là tính người ta CHƯA ĐẠT một yêu cầu mà hệ thống còn
   * chưa biết có áp cho họ không. Bỏ im lặng thì con số NSM trông sạch trong khi một
   * phần yêu cầu không được đo — và không ai biết phần ấy lớn cỡ nào.
   */
  chuaDoiChieuDuoc: number;
  /** `null` khi mẫu số = 0 — KHÔNG phải 0%. */
  tiLe: number | null;
};

/**
 * NORTH STAR METRIC — tỷ lệ cặp (người × yêu cầu) đã đạt.
 *
 * ⚠️ Mẫu số 0 trả `null`, không trả 0. "0% tuân thủ" đọc thành thảm hoạ, còn sự thật
 * là chưa có yêu cầu nào được khai — đó là hai câu chuyện khác nhau hoàn toàn, và
 * cái sau xảy ra ở NGÀY MỞ (TS-35: "số nền = 0% tại ngày mở GĐ1" nghĩa là chưa ai
 * đạt, không phải chưa có mẫu số).
 */
export function tinhNSM(o: readonly ODat[]): KetQuaNSM {
  let tuSo = 0;
  let mauSo = 0;
  let chua = 0;
  for (const x of o) {
    if (x.trangThai === "CHUA_DOI_CHIEU_DUOC") chua += 1;
    else if (x.trangThai === "DAT") {
      tuSo += 1;
      mauSo += 1;
    } else if (x.trangThai === "CHUA_DAT") mauSo += 1;
  }
  return {
    tuSo,
    mauSo,
    chuaDoiChieuDuoc: chua,
    tiLe: mauSo > 0 ? Math.round((tuSo / mauSo) * 100) : null,
  };
}

/**
 * NSM tính theo SỐ NGƯỜI — cách đọc chính thức của hai ngưỡng đã chốt.
 *
 * ⚠️ Ngưỡng viết bằng NGƯỜI, không bằng phần trăm (TS-35, HỢP ĐỒNG V2 §Z15).
 *
 * Ở quy mô 15 người, MỖI NGƯỜI là 6,7 điểm phần trăm — nên "80%" và "86,7%" là cùng
 * một người, và một ngưỡng viết bằng phần trăm chỉ tạo ảo giác chính xác. Tệ hơn:
 * "chưa đạt 90%" nghe như một khoảng cách lớn trong khi thực tế là thiếu đúng một
 * đến hai người.
 *
 * Chốt: quý đầu (D+90 kể từ ngày mở) = **12/15 người**; cổng GĐ4 = **13/15 người**.
 *
 * Một người tính là ĐẠT khi họ đạt TOÀN BỘ yêu cầu áp cho họ. Người không có yêu cầu
 * nào thì đứng ngoài — không đạt, không chưa đạt, không nằm trong mẫu số.
 */
export function tinhNSMTheoNguoi(o: readonly ODat[]): {
  soNguoiDat: number;
  soNguoiCoYeuCau: number;
  /** Câu để in ra báo cáo — dạng "12/15 người", KHÔNG phải phần trăm. */
  cau: string;
} {
  const conNo = new Map<string, boolean>();
  for (const x of o) {
    if (x.trangThai !== "DAT" && x.trangThai !== "CHUA_DAT") continue;
    const truoc = conNo.get(x.userId) ?? true;
    conNo.set(x.userId, truoc && x.trangThai === "DAT");
  }
  const soNguoiCoYeuCau = conNo.size;
  let soNguoiDat = 0;
  for (const dat of conNo.values()) if (dat) soNguoiDat += 1;
  return {
    soNguoiDat,
    soNguoiCoYeuCau,
    cau: `${soNguoiDat}/${soNguoiCoYeuCau} người`,
  };
}

/**
 * Cảnh báo cho MÀN QUẢN TRỊ khi khai một yêu cầu — trả `null` nếu không có gì phải
 * nói.
 *
 * ⚠️ Cảnh báo NGAY LÚC LƯU, không phải khi đọc báo cáo (TS-35 case T2 thứ hai). Một
 * yêu cầu áp cho 0 người trông y hệt một yêu cầu chưa ai kịp làm: cả hai đều là một
 * hàng ô xám. Khác biệt chỉ lộ ra khi có người hỏi "vì sao khoá này không ai học",
 * và lúc đó đã trôi qua vài tháng.
 */
export function canhBaoPhamVi(input: {
  scopeKind: string;
  soNguoiKhop: number;
}): string | null {
  const chua = PHAM_VI_CHUA_KHOP_DUOC[input.scopeKind];
  if (chua) {
    return `Phạm vi "${input.scopeKind}" hiện áp cho 0 người — ${chua}. Yêu cầu vẫn lưu được, nhưng ma trận sẽ toàn ô "chưa đối chiếu được" cho tới khi dữ liệu đó có.`;
  }
  if (input.soNguoiKhop === 0) {
    return "Phạm vi này hiện khớp 0 người. Kiểm lại lựa chọn — một yêu cầu áp cho 0 người trông y hệt một yêu cầu chưa ai kịp làm.";
  }
  return null;
}
