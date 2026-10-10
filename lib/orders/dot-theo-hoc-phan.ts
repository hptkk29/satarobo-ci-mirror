/**
 * KẾ HOẠCH ĐỢT THEO HỌC PHẦN — hàm THUẦN, không DB, không `server-only`.
 *
 * Chủ dự án chốt 28/09/2026: *"thanh toán theo đúng số học phần"*, phạm vi **chỉ sata3→7**
 * (khoá 48 buổi, 4 học phần), và **số tiền mỗi đợt tính theo SỐ BUỔI của học phần đó**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ DÙNG LẠI HAI THỨ ĐÃ CÓ, KHÔNG DỰNG BẢN THỨ HAI
 *
 * · Phạm vi + mốc hợp lệ + số học phần → `xetSoBuoiDong` (`./so-buoi-hoc-phan`).
 *   Đó là **cùng một định nghĩa "học phần"** mà luật duyệt đang dùng. Gõ lại con số 12 ở
 *   đây là dựng hai nguồn cho một sự thật: đổi một bên quên bên kia thì đơn vừa "đúng mốc"
 *   theo cổng duyệt vừa "sai số đợt" theo cổng này, tuỳ chỗ hỏi.
 * · Phép chia tiền → `chiaDotHocPhi(tong, soDot, tiLe)` (`@/lib/payments/ke-hoach-dot`),
 *   vốn đã nhận TRỌNG SỐ và đã giữ bất biến **Σ đợt = tổng đơn** (phần lẻ dồn đợt cuối).
 *   Bất biến ấy là thứ `kiemKeHoachDot` và các cổng tiền đang dựa vào — tự chia ở đây là
 *   tự nhận trách nhiệm giữ nó, và đó là chỗ bug tiền nằm.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ HÔM NAY "THEO SỐ BUỔI" == "CHIA ĐỀU" — VÀ ĐÓ LÀ ĐIỀU PHẢI NÓI RA
 *
 * Trong phạm vi đã chốt, cả 4 học phần đều **12 buổi**, nên hai cách tính ra **cùng một
 * kết quả**. Tức khác biệt giữa chúng **chưa đo được**, và mọi bug do nó gây ra sẽ không
 * có ca test nào bắt (luật: một tối ưu cho tập rỗng là một tối ưu không chứng minh được).
 *
 * Vẫn tính theo BUỔI chứ không `chiaDotHocPhi(tong, n)` trần, vì hai lý do:
 *   1. ngày có khoá 48 buổi chia KHÔNG đều (giáo trình thật đã có học phần 16 và 5 buổi ở
 *      các khoá khác), luật này đúng sẵn thay vì phải nhớ quay lại sửa;
 *   2. nó nói đúng ý định trong mã, nên người đọc sau không tưởng "chia đều" là luật.
 */
import { chiaDotHocPhi } from "@/lib/payments/ke-hoach-dot";
import { SO_BUOI_MOI_HOC_PHAN, SO_HOC_PHAN_TOI_DA, xetSoBuoiDong } from "./so-buoi-hoc-phan";

export type DotHocPhan = {
  /**
   * Số thứ tự THẬT của học phần trong khoá (1..4) — KHÔNG phải thứ tự đợt.
   *
   * 🔴 Mua ít hơn cả khoá là học **PHẦN CUỐI**, không phải phần đầu (chủ dự án 28/09):
   * *"đăng ký 2 học phần 24 buổi thì sẽ học bắt đầu từ học phần 3 của khoá"*. Nên đơn mua
   * 24 buổi có hai đợt, mang nhãn **HP3** và **HP4**.
   *
   * Đánh số 1..k ở đây là sai theo cách KHÓ THẤY: phiếu thu và cổng phụ huynh sẽ ghi "Học
   * phần 1" cho buổi 25–36, lệch hẳn với giáo trình mà giáo viên và học sinh đang nhìn.
   */
  hocPhan: number;
  /** Số buổi của học phần này — cũng là TRỌNG SỐ chia tiền. */
  soBuoi: number;
  soTien: number;
};

export type PhamViBuoi = {
  /** Buổi đầu tiên học viên được học/điểm danh (1-based). */
  buoiBatDau: number;
  /** Buổi cuối — LUÔN là buổi cuối của khoá. */
  buoiKetThuc: number;
  /** Số buổi thực học = `buoiKetThuc − buoiBatDau + 1`. */
  soBuoi: number;
};

/**
 * Mua ít hơn cả khoá ⇒ học các buổi CUỐI, kết thúc cùng cả lớp.
 *
 * Chủ dự án 28/09/2026: *"đăng ký 39 buổi thì sẽ bắt đầu học từ buổi 10 → 48, để khi thêm
 * vào lớp học thì chỉ được học và điểm danh từ buổi 10 → 48, các buổi không đăng ký thì bỏ
 * qua"*.
 *
 * ⚠️ **KHÔNG gác theo mốc học phần.** Hàm này trả về phạm vi kể cả khi số buổi LỆCH mốc
 * (39 buổi là ví dụ của chính chủ dự án, và 39 không chia hết cho 12 ⇒ đơn ấy phải qua
 * QLCS duyệt). Hai luật khác nhau, đừng nhập làm một:
 *   · *"được học từ buổi nào"* — luôn áp, đây;
 *   · *"có phải duyệt không"*  — `xetSoBuoiDong`, chỉ hỏi số buổi có rơi đúng mốc.
 * Gác phạm vi buổi theo mốc là: đơn 39 buổi đã được QLCS duyệt rồi mà vẫn không biết bắt
 * đầu từ đâu.
 */
export function phamViBuoiDangKy(d: {
  tongSoBuoiKhoa: number | null;
  soBuoiMua: number | null;
}): PhamViBuoi | null {
  const tong = d.tongSoBuoiKhoa;
  if (tong === null || !Number.isInteger(tong) || tong <= 0) return null;

  // Không khai ⇒ mua đủ khoá (cùng luật suy mặc định với `xetSoBuoiDong`).
  const mua = d.soBuoiMua ?? tong;
  if (!Number.isInteger(mua) || mua <= 0) return null;
  // Mua nhiều hơn khoá là dữ liệu vô nghĩa — trả `null` thay vì bịa một buổi bắt đầu ≤ 0.
  if (mua > tong) return null;

  const buoiBatDau = tong - mua + 1;
  return { buoiBatDau, buoiKetThuc: tong, soBuoi: mua };
}

export type KeHoachTheoHocPhan =
  /** Khoá ngoài phạm vi, hoặc số buổi không rơi đúng mốc ⇒ KHÔNG đề xuất gì. */
  | { apLuat: false; dot: null }
  | { apLuat: true; dot: DotHocPhan[] };

const NGOAI_PHAM_VI: KeHoachTheoHocPhan = { apLuat: false, dot: null };

/**
 * Đề xuất kế hoạch đợt cho MỘT dòng đơn.
 *
 * ⚠️ Trả `apLuat: false` khi số buổi LỆCH mốc — cố ý, không phải bỏ sót. Đơn lệch mốc là
 * đơn đang chờ QLCS duyệt (`xetSoBuoiDong(...).canDuyet`); đề xuất một kế hoạch "gần đúng"
 * cho nó là **che mất chính cái lệch mà người duyệt cần nhìn thấy**.
 *
 * ⚠️ BA THAM SỐ BẮT BUỘC, không mặc định (luật 7). Mặc định ở đây nguy hiểm theo chiều
 * ÂM THẦM ĐÚNG MỘT NỬA: thiếu `tongSoBuoiKhoa` thì hàm trả "ngoài phạm vi" và form lặng lẽ
 * rơi về kế hoạch cũ — không lỗi nào báo, và tính năng câm đúng 100% như cột `soBuoi`
 * trước 25/09.
 */
export function keHoachDotTheoHocPhan(d: {
  /** `Course.totalSessions` — tra DB, không phải payload client. */
  tongSoBuoiKhoa: number | null;
  /** `OrderItem.metadata.soBuoi`; `null` ⇒ suy về MUA ĐỦ KHOÁ. */
  soBuoiMua: number | null;
  /** Học phí THỰC của dòng (sau ưu đãi) — số tiền sẽ chia. */
  hocPhi: number;
}): KeHoachTheoHocPhan {
  const xet = xetSoBuoiDong({
    tongSoBuoiKhoa: d.tongSoBuoiKhoa,
    soBuoiMua: d.soBuoiMua,
  });
  if (!xet.apLuat || xet.soHocPhan === null) return NGOAI_PHAM_VI;

  const soBuoiMoiPhan = Array.from({ length: xet.soHocPhan }, () => SO_BUOI_MOI_HOC_PHAN);
  // `chiaDotHocPhi` kẹp âm/không-hữu-hạn về 0 và làm tròn — không lặp lại ở đây.
  const soTien = chiaDotHocPhi(d.hocPhi, xet.soHocPhan, soBuoiMoiPhan);

  // 🔴 ĐÁNH SỐ HỌC PHẦN THEO PHẠM VI BUỔI, KHÔNG PHẢI 1..k.
  // Mua k học phần là học k phần CUỐI (xem `phamViBuoiDangKy`), nên phần đầu tiên được
  // học là `soHocPhanCuaKhoa − k + 1`. Đo lại bằng ví dụ của chủ dự án: khoá 4 học phần,
  // mua 2 ⇒ bắt đầu ở 4 − 2 + 1 = **3**. Khớp câu *"bắt đầu từ học phần 3 của khoá"*.
  //
  // ⚠️ Dùng hằng `SO_HOC_PHAN_TOI_DA`, KHÔNG chia `tongSoBuoiKhoa / SO_BUOI_MOI_HOC_PHAN`.
  // Trong phạm vi đã chốt, khoá LUÔN là 48 buổi = đúng `SO_HOC_PHAN_TOI_DA` học phần (vế
  // phạm vi của `xetSoBuoiDong` đã bảo đảm điều đó). Tự chia ở đây là dựng nguồn thứ hai
  // cho cùng một sự thật — đúng thứ `[DHP-06]` cấm, và nó bắt tôi ngay ở bản đầu.
  const phanDau = SO_HOC_PHAN_TOI_DA - xet.soHocPhan + 1;

  return {
    apLuat: true,
    dot: soBuoiMoiPhan.map((soBuoi, i) => ({
      hocPhan: phanDau + i,
      soBuoi,
      soTien: soTien[i] ?? 0,
    })),
  };
}

/** Một dòng khoá học của đơn, rút gọn về đúng hai số mà luật này cần. */
export type DongKhoaHoc = {
  tongSoBuoiKhoa: number | null;
  soBuoiMua: number | null;
};

/**
 * Gợi ý kế hoạch đợt cho CẢ ĐƠN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ CHIA `tongDon`, KHÔNG CHIA HỌC PHÍ TỪNG DÒNG.
 *
 * Kế hoạch đợt là của ĐƠN (một bộ phiếu thu, một chuỗi QR), còn học phần là của DÒNG.
 * Chia theo học phí dòng rồi cộng lại sẽ lệch `totalAmount` đúng bằng phần giảm giá ở cấp
 * ĐƠN — và `kiemKeHoachDot` sẽ từ chối với câu "Σ đợt ≠ tổng đơn" mà không ai hiểu vì sao.
 *
 * ⚠️ CHỈ GỢI Ý KHI MỌI DÒNG KHOÁ HỌC ĐỒNG Ý MỘT SỐ HỌC PHẦN.
 *
 * Đơn hai con cùng mua đủ khoá ⇒ cả hai ra 4 ⇒ gợi ý 4 đợt, đúng. Nhưng một con mua 48
 * buổi còn con kia mua 24 thì **không có câu trả lời đúng** ở cấp đơn: 4 đợt thì con thứ
 * hai trả cho học phần nó không học, 2 đợt thì con thứ nhất trả thiếu.
 *
 * Trả `null` ở ca đó là CỐ Ý — im lặng còn hơn đề xuất một con số sai mà sale bấm theo vì
 * nó do hệ thống đưa ra. Ai cần khác thì tự gõ, và cổng duyệt vẫn soi.
 */
export function goiYKeHoachDon(
  dongs: readonly DongKhoaHoc[],
  tongDon: number,
): KeHoachTheoHocPhan {
  if (dongs.length === 0) return NGOAI_PHAM_VI;

  const xets = dongs.map((d) => xetSoBuoiDong(d));
  // Mọi dòng phải trong phạm vi VÀ đúng mốc — một dòng ngoài phạm vi là đơn có cả khoá
  // chia học phần lẫn khoá không chia, không có kế hoạch chung nào đúng.
  if (xets.some((x) => !x.apLuat || x.soHocPhan === null)) return NGOAI_PHAM_VI;

  const k = xets[0]!.soHocPhan!;
  if (xets.some((x) => x.soHocPhan !== k)) return NGOAI_PHAM_VI;

  // Dùng lại đúng hàm của một dòng: truyền `tongSoBuoiKhoa`/`soBuoiMua` của dòng đầu (mọi
  // dòng đã đồng ý về k) và `tongDon` làm số tiền. Nhãn học phần vì vậy cũng đúng.
  return keHoachDotTheoHocPhan({
    tongSoBuoiKhoa: dongs[0]!.tongSoBuoiKhoa,
    soBuoiMua: dongs[0]!.soBuoiMua,
    hocPhi: tongDon,
  });
}

// ⚠️ `lechHocPhan` ĐÃ GỠ [28/09/2026] — nó mã hoá MỘT LUẬT KHÔNG TỒN TẠI.
//
// Chủ dự án: *"học phần khác đợt, chọn 3 học phần nhưng thanh toán 1 đợt, chứ không phải
// chọn 3 học phần là bắt buộc thanh toán 3 đợt... tôi muốn thanh toán 1, 2 hay 3 đợt đều
// được chứ?"* — đúng, và nó luôn đúng như vậy.
//
// SỐ HỌC PHẦN là *mua gì* (36 buổi = 3 học phần). SỐ ĐỢT là *trả thế nào*. Hai trục độc
// lập; buộc chúng bằng nhau là bịa thêm một ràng buộc mà không văn bản nào ban hành.
//
// 🔴 VÀ NÓ CÒN NÓI DỐI. Docblock cũ tự khai *"dùng cho câu cảnh báo trên form VÀ CHO THẺ
// DUYỆT"*, còn form thì in *"Đơn sẽ cần quản lý cơ sở duyệt trước khi xuất mã QR"*. Đo
// `xetDuyetDon` (`lib/orders/nguong-duyet.ts`): nó KHÔNG nhận đầu vào nào của học phần ×
// đợt. Ba thứ nó xét là số buổi lệch mốc · số đợt VƯỢT TRẦN (mặc định 4) · số ưu đãi vượt
// trần. Nên với 1 đợt / 4 học phần — đúng ảnh chụp chủ dự án gửi — câu cảnh báo ấy SAI
// HOÀN TOÀN: không cổng nào bật.
//
// Đây đúng luật 12 (affordance nói dối): lời hứa suông không ném lỗi, không làm ca nào
// đỏ, console vẫn sạch — chỉ người đọc mới biết. Bài học kèm theo: **một chú thích tự
// khai "dùng cho X" không phải bằng chứng nó được nối vào X** — hỏi bằng `git grep` ở
// chính nơi X nhận đầu vào.
//
// Phần CÒN GIÁ TRỊ giữ nguyên: `goiYKeHoachDon` vẫn gợi ý "mỗi học phần một đợt" và form
// vẫn có nút đặt nhanh. Gợi ý thì được; ép thì không.
