// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/kiem-hop-le.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * NĂM HÀNG RÀO TÍNH HỢP LỆ — chạy TRƯỚC khi trả kết quả (DISC_BA.md §7.3).
 *
 * Hàm THUẦN, thuộc TẦNG LÕI (ADR-004): không DOM, không localStorage.
 *
 * 🔴 Mấy hàng rào này chặn NGƯỜI TRẢ LỜI ẨU. Chúng KHÔNG làm cho bộ câu hỏi đo đúng hơn.
 * Đừng nhầm hai chuyện đó với nhau khi đọc kết quả.
 */

import { NGUONG_HOP_LE } from "@/lib/disc/engine-goc/config/disc-nguong";

import { MA_TRUC, type BoDe, type MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

export type MaCanhBao = "MOT_COT" | "MAU_THUAN" | "BAM_BUA";
export type MaChan = "PHANG" | "THIEU_CAU";

export type TraLoi = Readonly<Record<string, number>>;

/** Đảo chiều một giá trị thô về "điểm cho trục". */
export function daoChieu(raw: number, dao: boolean, mucToiDa: number): number {
  return dao ? mucToiDa + 1 - raw : raw;
}

/** HL-5 — BỎ TRỐNG. Trả về danh sách mã câu chưa trả lời. */
export function cauConThieu(boDe: BoDe, traLoi: TraLoi): string[] {
  return boDe.cau
    .filter((c) => {
      const v = traLoi[c.ma];
      return typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > boDe.mucToiDa;
    })
    .map((c) => c.ma);
}

/** Thang có mức giữa thật không (thang lẻ). Thang chẵn ⇒ HL-1 phải tắt. */
export function coMucGiua(mucToiDa: number): boolean {
  return mucToiDa % 2 === 1;
}

/** HL-1 — TRẢ LỜI PHẲNG. Tỷ lệ câu chọn đúng mức giữa. Thang chẵn trả về 0. */
export function tyLeTraLoiPhang(boDe: BoDe, traLoi: TraLoi): number {
  if (!coMucGiua(boDe.mucToiDa) || boDe.cau.length === 0) return 0;
  const giua = (boDe.mucToiDa + 1) / 2;
  const soPhang = boDe.cau.filter((c) => traLoi[c.ma] === giua).length;
  return soPhang / boDe.cau.length;
}

/** HL-2 — TICK MỘT CỘT. Chuỗi DÀI NHẤT các câu liên tiếp cùng một đáp án. */
export function chuoiCungDapAnDaiNhat(boDe: BoDe, traLoi: TraLoi): number {
  let dai = 0;
  let hienTai = 0;
  let truoc: number | undefined;
  for (const c of boDe.cau) {
    const v = traLoi[c.ma];
    hienTai = v !== undefined && v === truoc ? hienTai + 1 : 1;
    truoc = v;
    if (hienTai > dai) dai = hienTai;
  }
  return dai;
}

/**
 * HL-3 — MÂU THUẪN THUẬN/ĐẢO.
 *
 * Với mỗi trục, so trung bình các câu THUẬN với trung bình các câu ĐẢO (sau khi đã đảo
 * chiều). Người trả lời nhất quán thì hai con số này gần nhau. Lấy trung bình 4 trục.
 *
 * Trục thiếu một trong hai loại câu thì bỏ qua trục đó — không có gì để so.
 */
export function doMauThuanThuanDao(boDe: BoDe, traLoi: TraLoi): number {
  const lech: number[] = [];
  for (const t of MA_TRUC) {
    const cua = boDe.cau.filter((c) => c.truc === t);
    const thuan = cua.filter((c) => !c.dao).map((c) => traLoi[c.ma]).filter((v) => v !== undefined);
    const dao = cua
      .filter((c) => c.dao)
      .map((c) => daoChieu(traLoi[c.ma], true, boDe.mucToiDa))
      .filter((v) => !Number.isNaN(v));
    if (thuan.length === 0 || dao.length === 0) continue;
    const tb = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    lech.push(Math.abs(tb(thuan) - tb(dao)));
  }
  if (lech.length === 0) return 0;
  return lech.reduce((a, b) => a + b, 0) / lech.length;
}

export type KetQuaKiem =
  | { readonly chan: MaChan; readonly cauThieu?: readonly string[] }
  | { readonly chan: null; readonly canhBao: readonly MaCanhBao[] };

/**
 * Chạy cả năm hàng rào. Trả về lý do CHẶN (nếu có) hoặc danh sách CẢNH BÁO.
 *
 * `giay` là tổng thời gian làm bài, tính bằng giây. Không đo được thì truyền `null` —
 * lúc đó HL-4 bị bỏ qua thay vì báo bừa.
 */
export function kiemHopLe(boDe: BoDe, traLoi: TraLoi, giay: number | null): KetQuaKiem {
  const thieu = cauConThieu(boDe, traLoi);
  if (thieu.length > 0) return { chan: "THIEU_CAU", cauThieu: thieu };

  if (tyLeTraLoiPhang(boDe, traLoi) > NGUONG_HOP_LE.tyLePhangToiDa) {
    return { chan: "PHANG" };
  }

  const canhBao: MaCanhBao[] = [];

  if (chuoiCungDapAnDaiNhat(boDe, traLoi) >= NGUONG_HOP_LE.soCauLienTiepCanhBao) {
    canhBao.push("MOT_COT");
  }

  const nguongMauThuan = NGUONG_HOP_LE.nguongMauThuanTheoThang[boDe.mucToiDa];
  if (nguongMauThuan !== undefined && doMauThuanThuanDao(boDe, traLoi) > nguongMauThuan) {
    canhBao.push("MAU_THUAN");
  }

  if (giay !== null && boDe.cau.length > 0) {
    if (giay / boDe.cau.length < NGUONG_HOP_LE.giayMoiCauToiThieu) canhBao.push("BAM_BUA");
  }

  return { chan: null, canhBao };
}

export type { MaTruc };
