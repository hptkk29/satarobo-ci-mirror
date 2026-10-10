// lib/lms/xep-vao-lop.ts — "học viên mua n buổi thì xếp được vào lớp đang ở buổi nào".
// THUẦN: không DB, không mạng, không `server-only`.
//
// ── LUẬT, CHỦ DỰ ÁN CHỐT 29/09/2026 ─────────────────────────────────────────────────
// Buổi bắt đầu của học viên: `S = tổng − mua + 1` (đã có sẵn ở `phamViBuoiDangKy`).
// Lớp đã qua `P` buổi ⇒ buổi kế tiếp `N = P + 1`.
//
//   MUA ĐỦ KHOÁ (S = 1)
//     *"nếu 48 buổi thì có thể xếp vào những lớp nào học chưa tới buổi 5 (nếu chưa học
//     buổi nào thì thêm bth, nếu học 1-4 buổi rồi thì phải học vượt làm sao cho học viên
//     đó đuổi kịp tiến độ của lớp, còn nếu vượt quá 5 buổi thì không thêm vào được)"*,
//     rồi chốt lại: *"nếu đăng ký 48 mà lớp đã học >4 buổi thì tất cả các role khác không
//     thêm vào được nữa, chỉ admin vẫn toàn quyền thêm được cho tất cả các trường hợp"*.
//     ⇒ `P ≤ 4` xếp được, và `P` chính là số buổi phải HỌC VƯỢT. `P > 4` chỉ Quản trị
//     tối cao.
//
//   MUA ÍT HƠN CẢ KHOÁ (S > 1)
//     *"trường hợp học vượt chỉ khi đăng ký 48 buổi, nếu đăng ký từ 43 buổi trở xuống thì
//     khách hàng sẽ thanh toán theo đúng số tiền của các buổi đó, và add vào lớp tương
//     ứng với buổi đăng ký"*.
//     ⇒ KHÔNG học vượt. Khách trả tiền cho đúng `n` buổi, nên phải vào lớp còn đủ `n`
//     buổi phía trước: `N ≤ S`. Nếu `N > S` thì bé đã MẤT `N − S` buổi đã trả tiền ⇒ chỉ
//     Quản trị tối cao (và người bấm phải biết mình đang lấy mất buổi của khách).
//
// ⚠️ `N < S` KHÔNG phải lỗi: bé vào lớp sớm, ngồi chờ tới buổi `S` rồi mới học. Cổng
// điểm danh (`lib/orders/buoi-duoc-hoc.ts`) đã chặn sẵn việc chấm cho bé trước buổi ấy,
// nên bé vẫn nhận ĐÚNG `n` buổi. Chặn ca này là cấm giữ chỗ trước, không có lý do.
//
// ── "LỚP ĐÃ HỌC TỚI BUỔI MẤY" ĐO BẰNG NGÀY, KHÔNG BẰNG TRẠNG THÁI ───────────────────
// Chủ dự án chọn "buổi ĐÃ QUA NGÀY". Đây là lựa chọn có số đo đằng sau: đo
// `satarobo_local` ngày 29/09 — lớp `CS1.SATA3.01` đã qua ngày **25 buổi** nhưng có
// **0 buổi `COMPLETED`**; toàn DB 292 `SCHEDULED` / 461 `COMPLETED`.
// Đếm theo `COMPLETED` thì MỌI lớp trông như chưa dạy buổi nào ⇒ không ca nào bị chặn ⇒
// luật này thành trang trí. Hàm này KHÔNG tự đếm; người gọi truyền `soBuoiDaQua` vào, và
// đó là chỗ duy nhất quyết định cách đếm.
import { phamViBuoiDangKy } from "@/lib/orders/dot-theo-hoc-phan";

/**
 * Số buổi TỐI ĐA một học viên mua đủ khoá được phép học vượt.
 *
 * 4, không phải 5. Chủ dự án chốt bằng câu *"lớp đã học >4 buổi thì … không thêm vào được
 * nữa"* — câu đầu tiên có nói "vượt quá 5 buổi", hai câu lệch nhau đúng một buổi và câu
 * sau là câu chốt.
 */
export const TRAN_BUOI_HOC_VUOT = 4;

export type LoaiXepLop =
  /** Vào ngay, không lỡ buổi nào, không phải học bù. */
  | "binh_thuong"
  /** Mua đủ khoá, lớp đã dạy 1..4 buổi ⇒ vào được nhưng phải học bù đúng ngần ấy buổi. */
  | "hoc_vuot"
  /** Mua ít hơn cả khoá, lớp CHƯA tới buổi bắt đầu của bé ⇒ bé giữ chỗ, chờ tới lượt. */
  | "cho_toi_luot"
  /** Mua đủ khoá, lớp đã dạy quá trần học vượt. */
  | "qua_xa"
  /** Mua ít hơn cả khoá, lớp đã QUA buổi bắt đầu ⇒ bé mất buổi đã trả tiền. */
  | "mat_buoi_da_tra"
  /** Không đủ dữ kiện để xét (khoá không khai số buổi, số buổi mua vô nghĩa). */
  | "khong_xet";

export type XetXepLop = {
  loai: LoaiXepLop;
  /**
   * Vai THƯỜNG có xếp được không.
   *
   * ⚠️ Quản trị tối cao xếp được MỌI ca — chủ dự án chốt *"chỉ admin vẫn toàn quyền thêm
   * được cho tất cả các trường hợp"*. Hàm này KHÔNG biết vai người gọi (nó thuần); nơi
   * gọi đọc `chiAdmin` rồi tự quyết. Nhét vai vào đây là trộn phân quyền vào phép tính.
   */
  xepDuoc: boolean;
  /** Ca này chỉ Quản trị tối cao mới qua được. `xepDuoc` luôn `false` khi cờ này bật. */
  chiAdmin: boolean;
  /** Buổi đầu tiên bé được học (S). `null` khi `khong_xet`. */
  buoiBatDau: number | null;
  /** Buổi kế tiếp của lớp (N = P + 1). */
  buoiKeTiepCuaLop: number;
  /** Số buổi phải học bù. CHỈ > 0 ở `hoc_vuot`. */
  soBuoiHocVuot: number;
  /** Số buổi đã trả tiền mà bé sẽ KHÔNG được học. CHỈ > 0 ở `mat_buoi_da_tra`. */
  soBuoiMatTrang: number;
  /** Câu cho người xếp lớp đọc. Luôn có, kể cả ca thuận. */
  cau: string;
};

const KHONG_XET: XetXepLop = {
  loai: "khong_xet",
  // FAIL-OPEN có chủ đích: khoá không khai `totalSessions` thì không suy được gì, và
  // chặn ở đây là khoá luồng ghi danh của mọi khoá chưa khai số buổi. Cùng hướng với
  // `xetBuoiDuocHoc` (`lib/orders/buoi-duoc-hoc.ts`), vì hai hàm canh cùng một sự thật.
  xepDuoc: true,
  chiAdmin: false,
  buoiBatDau: null,
  buoiKeTiepCuaLop: 1,
  soBuoiHocVuot: 0,
  soBuoiMatTrang: 0,
  cau: "Khoá chưa khai số buổi — không xét được tiến độ lớp.",
};

export type XepVaoLopVao = {
  /** `Course.totalSessions`. */
  tongSoBuoiKhoa: number | null;
  /** Số buổi học viên ĐÃ MUA. `null` = mua đủ khoá (cùng luật suy với `phamViBuoiDangKy`). */
  soBuoiMua: number | null;
  /**
   * Số buổi lớp ĐÃ QUA NGÀY (P). Xem khối chú thích đầu file về vì sao đếm theo ngày.
   * Lớp chưa dạy buổi nào ⇒ 0.
   */
  soBuoiDaQua: number;
};

export function xetXepVaoLop(d: XepVaoLopVao): XetXepLop {
  const pv = phamViBuoiDangKy({
    tongSoBuoiKhoa: d.tongSoBuoiKhoa,
    soBuoiMua: d.soBuoiMua,
  });
  if (!pv) return KHONG_XET;

  const P = Number.isInteger(d.soBuoiDaQua) && d.soBuoiDaQua > 0 ? d.soBuoiDaQua : 0;
  const N = P + 1;
  const S = pv.buoiBatDau;
  const muaDuKhoa = S === 1;

  if (muaDuKhoa) {
    // `P` buổi đã dạy chính là `P` buổi bé lỡ — bé có quyền học cả 48 buổi.
    if (P === 0) {
      return {
        loai: "binh_thuong",
        xepDuoc: true,
        chiAdmin: false,
        buoiBatDau: S,
        buoiKeTiepCuaLop: N,
        soBuoiHocVuot: 0,
        soBuoiMatTrang: 0,
        cau: "Lớp chưa học buổi nào — xếp vào bình thường.",
      };
    }
    if (P <= TRAN_BUOI_HOC_VUOT) {
      return {
        loai: "hoc_vuot",
        xepDuoc: true,
        chiAdmin: false,
        buoiBatDau: S,
        buoiKeTiepCuaLop: N,
        soBuoiHocVuot: P,
        soBuoiMatTrang: 0,
        cau:
          `Lớp đã học ${P} buổi — bé phải HỌC VƯỢT ${P} buổi để đuổi kịp lớp. ` +
          `Hệ thống sẽ tạo ${P} phiếu học bù.`,
      };
    }
    return {
      loai: "qua_xa",
      xepDuoc: false,
      chiAdmin: true,
      buoiBatDau: S,
      buoiKeTiepCuaLop: N,
      soBuoiHocVuot: P,
      soBuoiMatTrang: 0,
      cau:
        `Lớp đã học ${P} buổi, quá ${TRAN_BUOI_HOC_VUOT} buổi cho phép học vượt — ` +
        `chỉ Quản trị tối cao xếp được vào lớp này.`,
    };
  }

  // ── Mua ÍT HƠN cả khoá: không học vượt, chỉ cần lớp còn đủ buổi phía trước ──
  if (N <= S) {
    const cho = S - N;
    return {
      loai: cho === 0 ? "binh_thuong" : "cho_toi_luot",
      xepDuoc: true,
      chiAdmin: false,
      buoiBatDau: S,
      buoiKeTiepCuaLop: N,
      soBuoiHocVuot: 0,
      soBuoiMatTrang: 0,
      cau:
        cho === 0
          ? `Lớp đang ở buổi ${N} — đúng buổi bé bắt đầu. Xếp vào bình thường.`
          : `Bé mua ${pv.soBuoi} buổi, bắt đầu từ buổi ${S}; lớp mới ở buổi ${N}. ` +
            `Xếp vào được để giữ chỗ — bé chờ ${cho} buổi rồi mới vào học.`,
    };
  }
  const mat = N - S;
  return {
    loai: "mat_buoi_da_tra",
    xepDuoc: false,
    chiAdmin: true,
    buoiBatDau: S,
    buoiKeTiepCuaLop: N,
    soBuoiHocVuot: 0,
    soBuoiMatTrang: mat,
    cau:
      `Bé mua ${pv.soBuoi} buổi (từ buổi ${S}) nhưng lớp đã tới buổi ${N} — ` +
      `xếp vào là bé MẤT ${mat} buổi đã trả tiền. Chỉ Quản trị tối cao xếp được.`,
  };
}

/** Người có vai này xếp được lớp đó không. `laAdmin` = Quản trị tối cao. */
export function duocXep(x: XetXepLop, laAdmin: boolean): boolean {
  return x.xepDuoc || (x.chiAdmin && laAdmin);
}

/**
 * Buổi lớp đã QUA NGÀY. Một chỗ duy nhất đếm, để mọi màn ra cùng con số.
 *
 * ⚠️ Đếm cả buổi ĐÃ HUỶ: buổi huỷ vẫn chiếm một nấc trong lộ trình của lớp (buổi bù xếp
 * ở cuối, xem `lib/classes/adjust.ts`), nên bỏ nó ra là con số tiến độ tụt và bé được xếp
 * vào một lớp thực tế đã đi xa hơn.
 */
export function demBuoiDaQua(
  buoi: readonly { date: Date | string | number }[],
  bayGio: Date,
): number {
  const moc = bayGio.getTime();
  return buoi.filter((b) => {
    const t = b.date instanceof Date ? b.date.getTime() : new Date(b.date).getTime();
    return Number.isFinite(t) && t <= moc;
  }).length;
}
