// lib/orders/so-buoi-hoc-phan.ts — "SỐ BUỔI MUA CÓ RƠI ĐÚNG MỐC HỌC PHẦN KHÔNG".
// THUẦN, không DB, không `server-only`.
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT [chủ dự án chốt 25/09/2026]
//
// *"khi sale tạo đơn, nếu buổi học khác 12 24 36 48 tức 1 học phần, 2 học phần, 3 học
// phần, 4 học phần thì phải qua quản lý duyệt"* — và, khi được hỏi lại vì số đo cho thấy
// danh mục có khoá 9/11/23 buổi: *"ở prod có các khoá sata 3,4,5,6,7 có 48 buổi thì mới
// áp luật này, còn các khoá khác thì không"*.
//
// ⇒ HAI vế, và vế thứ nhất mới là vế giữ cho luật không nổ:
//   (1) PHẠM VI — chỉ khoá có ĐỦ 4 học phần (`Course.totalSessions === 48`);
//   (2) MỐC     — với khoá ấy, số buổi mua phải là 12 / 24 / 36 / 48.
//
// ⚠️ VÌ SAO VẾ (1) LÀ BẮT BUỘC, đo `satarobo_local` 25/09/2026:
//
//   | khoá                        | totalSessions |
//   |-----------------------------|---------------|
//   | Luyện thi RoboSim           | 9             |
//   | Sata 1 — Nhập môn Robotics  | 11            |
//   | Lập trình Robot             | 11            |
//   | Sata 2 / 3 / 4              | 12            |
//   | Combo Sata 1 & 2            | 23            |
//
// Form tạo đơn lấy `Course.totalSessions` làm MẶC ĐỊNH cho ô "Số buổi mua"
// (`order-create-form.tsx:432-434`). Bỏ vế (1) đi thì mọi đơn RoboSim · Sata 1 · Combo
// rơi vào hàng chờ duyệt **mà sale không gõ sai gì cả** — hàng chờ đầy đơn bình thường
// là hàng chờ không ai đọc nữa, tức mất luôn tác dụng của hai luật duyệt đang chạy.
//
// ⚠️ SỐ 48 KHÔNG ĐƯỢC GÕ TAY hai lần: nó = `SO_BUOI_MOI_HOC_PHAN × SO_HOC_PHAN_TOI_DA`,
// và tập mốc hợp lệ cũng SUY RA từ đúng hai hằng ấy. Gõ `[12, 24, 36, 48]` cạnh một hằng
// `48` là dựng sẵn hai nguồn cho một sự thật — đổi một bên quên bên kia thì khoá 60 buổi
// (5 học phần, nếu có ngày mở) vừa "ngoài phạm vi" vừa "mốc hợp lệ", tuỳ chỗ hỏi.
//
// ⚠️ THỨ NÀY ĐỌC TỪ PAYLOAD CLIENT — giới hạn phải biết trước khi tin nó.
// `soBuoiMua` đến từ `OrderItem.metadata.soBuoi`, tức client gửi lên; `tongSoBuoiKhoa`
// thì tra `Course` trong DB. Client cầm MỘT vế, không phải cả hai (đúng ranh giới mà
// `lib/orders/hinh-thuc-lop.ts` đã dựng cho cổng soát giá). Sale cố tình khai 48 để né
// duyệt thì đơn ghi lại đúng 48 buổi — họ nói dối vào chính tờ giấy mình ký, và phụ
// huynh cầm đơn 48 buổi. Đó là lý do cổng này ĐỦ ở mức "chặn nhầm lẫn", và KHÔNG được
// coi là cổng chống gian lận.

/** Một học phần = 12 buổi (lộ trình Sata, `lib/lms/curriculum-sata.ts`). */
export const SO_BUOI_MOI_HOC_PHAN = 12;

/** Khoá Sata 3–7 gồm 4 học phần. */
export const SO_HOC_PHAN_TOI_DA = 4;

/**
 * Tổng số buổi của khoá thì luật này mới áp — 48.
 *
 * SUY RA, không gõ tay. Xem chú thích đầu file về "hai nguồn cho một sự thật".
 */
export const TONG_SO_BUOI_KHOA_AP_LUAT = SO_BUOI_MOI_HOC_PHAN * SO_HOC_PHAN_TOI_DA;

/** 12 · 24 · 36 · 48 — cũng suy ra từ hai hằng trên. */
export const SO_BUOI_HOP_LE: readonly number[] = Array.from(
  { length: SO_HOC_PHAN_TOI_DA },
  (_, i) => (i + 1) * SO_BUOI_MOI_HOC_PHAN,
);

export type XetSoBuoi = {
  /** Khoá của dòng này có nằm trong phạm vi luật không (vế 1). */
  apLuat: boolean;
  /** Số buổi có rơi đúng mốc học phần không. `true` khi ngoài phạm vi — không xét thì không vi phạm. */
  hopLe: boolean;
  /** `apLuat && !hopLe`. Đây là thứ quyết định đơn có vào hàng chờ duyệt hay không. */
  canDuyet: boolean;
  /**
   * Con số THỰC SỰ đem ra xét, sau khi suy mặc định. `null` khi không xét.
   *
   * Nêu ra chứ không giấu: câu lỗi phải in đúng con số mà cổng đã dùng, kẻo sale nhìn ô
   * trống trên form rồi đọc một câu nói về "20 buổi" và tưởng hệ thống lỗi.
   */
  soBuoiXet: number | null;
  /** 1..4 khi hợp lệ và trong phạm vi; `null` khi không xét hoặc không khớp mốc. */
  soHocPhan: number | null;
};

const NGOAI_PHAM_VI: XetSoBuoi = {
  apLuat: false,
  hopLe: true,
  canDuyet: false,
  soBuoiXet: null,
  soHocPhan: null,
};

/**
 * Xét MỘT DÒNG đơn.
 *
 * ⚠️ HAI THAM SỐ KHAI BẮT BUỘC (luật 7), cố ý không có mặc định. Mặc định ở đây nguy hiểm
 * theo chiều NỚI: chỗ gọi quên `select` cột `totalSessions` thì mọi dòng ra "ngoài phạm
 * vi" ⇒ luật câm hoàn toàn, bảng sạch sẽ, không ai biết. Bỏ mặc định ⇒ `tsc` liệt kê đủ
 * chỗ gọi — đúng cái lợi ngoài dự kiến của luật 7 ghi trong `docs/luat-doc-so-va-ket-luan.md`.
 *
 * ⚠️ `soBuoiMua = null` ⇒ SUY VỀ "MUA ĐỦ KHOÁ", KHÔNG phải "fail-closed".
 * Đây là quyết định có hệ quả, nên nói thẳng:
 *   · form tạo đơn ĐANG mặc định ô số buổi = `Course.totalSessions`, nên "không khai" và
 *     "khai đủ khoá" là cùng một ý định của người bán;
 *   · ba đường tạo đơn còn lại (`convert-lead`, `backfill-order`, `ghi-giao-dich-cu`)
 *     KHÔNG ghi `soBuoi` bao giờ — fail-closed ở đây là đẩy **mọi đơn convert của khoá
 *     Sata 3–7** vào hàng chờ duyệt, tức đúng cái tai nạn mà vế (1) sinh ra để tránh.
 * Đổi lại: người cố tình xoá `soBuoi` khỏi payload né được cổng. Chấp nhận — xem đoạn
 * "ĐỌC TỪ PAYLOAD CLIENT" ở đầu file.
 */
export function xetSoBuoiDong(d: {
  /** `Course.totalSessions`. `null` = khoá không khai, hoặc dòng không phải khoá học. */
  tongSoBuoiKhoa: number | null;
  /** `OrderItem.metadata.soBuoi`. `null` = không khai ⇒ suy về đủ khoá. */
  soBuoiMua: number | null;
}): XetSoBuoi {
  if (d.tongSoBuoiKhoa !== TONG_SO_BUOI_KHOA_AP_LUAT) return NGOAI_PHAM_VI;

  const soBuoiXet = d.soBuoiMua ?? d.tongSoBuoiKhoa;
  const hopLe = SO_BUOI_HOP_LE.includes(soBuoiXet);
  return {
    apLuat: true,
    hopLe,
    canDuyet: !hopLe,
    soBuoiXet,
    soHocPhan: hopLe ? soBuoiXet / SO_BUOI_MOI_HOC_PHAN : null,
  };
}

/** "12 / 24 / 36 / 48 buổi" — dùng chung cho câu lỗi và cho nhãn trên màn duyệt. */
export function moTaMocHopLe(): string {
  return `${SO_BUOI_HOP_LE.join(" / ")} buổi`;
}

/**
 * Câu lý do in cho SALE đọc trên màn và cho QUẢN LÝ đọc trên thẻ duyệt.
 *
 * Nói bằng NGÔN NGỮ CỦA NGUYÊN NHÂN và in ra cả con số đã dùng lẫn tập mốc — cùng bài
 * học đã ghi trong CLAUDE.md ở cổng tạo đợt: một câu cụt lủn đọc như hệ thống bị lỗi,
 * rồi người ta học cách bỏ qua cổng.
 */
export function lyDoSoBuoi(x: XetSoBuoi, nhan: string): string | null {
  if (!x.canDuyet || x.soBuoiXet == null) return null;
  const ten = nhan.trim() || "Dòng đơn";
  return (
    `${ten}: mua ${x.soBuoiXet} buổi — không khớp mốc học phần ` +
    `(${moTaMocHopLe()}, mỗi học phần ${SO_BUOI_MOI_HOC_PHAN} buổi).`
  );
}

/**
 * Nguồn của con số buổi in ra — quyết định câu chú thích đi kèm.
 *
 * `"khai"`    người bán gõ tay trên form ⇒ in trần con số.
 * `"du-khoa"` không khai ⇒ suy về đủ khoá (xem `xetSoBuoiDong`). PHẢI nói ra chữ
 *             "đủ khoá", vì đó là một PHÉP SUY chứ không phải dữ liệu.
 * `"khong-ro"` không khai, và khoá cũng không có `totalSessions` ⇒ không ai biết.
 */
export type NguonSoBuoi = "khai" | "du-khoa" | "khong-ro";

export type NhanSoBuoi = {
  /** Chuỗi in ra, vd "24 buổi", "48 buổi (đủ khoá)", "chưa rõ số buổi". */
  chu: string;
  nguon: NguonSoBuoi;
  /** Dòng này có lệch mốc học phần không — để tô cảnh báo. */
  lech: boolean;
};

/**
 * NHÃN SỐ BUỔI cho một dòng đơn khoá học — LUÔN có chữ, KHÔNG BAO GIỜ im.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 Chủ dự án 26/09/2026: *"không hiển thị bao nhiêu buổi thì sao biết mà duyệt"*.
 *
 * Bản trước in số buổi **chỉ khi `metadata.soBuoi` có giá trị**, mà cột đó trống trên
 * mọi đơn cũ và mọi đơn đi đường convert/backfill. Kết quả: quản lý mở thẻ duyệt và
 * thấy `Sata 4 · SL 1 · 10.400.003đ` — được hỏi "gật hay không" về một con số **không
 * hề có trên màn**. Đúng luật 12: vắng mặt phải NÓI RA, không được im.
 *
 * ⚠️ Ba nguồn, ba câu KHÁC NHAU — đừng gộp. "48 buổi" (người bán gõ) và "48 buổi (đủ
 * khoá)" (hệ thống suy ra vì không ai gõ) là hai sự thật khác nhau, và người ký cần
 * phân biệt: cái đầu là cam kết của sale, cái sau là mặc định của hệ thống.
 *
 * ⚠️ CHỈ gọi cho dòng KHOÁ HỌC. Dòng sản phẩm (hộp LEGO, phí thi) không có "số buổi",
 * in "chưa rõ số buổi" ở đó là bịa ra một vấn đề không tồn tại — chỗ gọi phải tự lọc
 * bằng `laKhoaHoc`.
 */
export function nhanSoBuoiDong(d: {
  tongSoBuoiKhoa: number | null;
  soBuoiMua: number | null;
}): NhanSoBuoi {
  const lech = xetSoBuoiDong(d).canDuyet;
  if (d.soBuoiMua != null) return { chu: `${d.soBuoiMua} buổi`, nguon: "khai", lech };
  if (d.tongSoBuoiKhoa != null) {
    return { chu: `${d.tongSoBuoiKhoa} buổi (đủ khoá)`, nguon: "du-khoa", lech };
  }
  return { chu: "chưa rõ số buổi", nguon: "khong-ro", lech };
}
