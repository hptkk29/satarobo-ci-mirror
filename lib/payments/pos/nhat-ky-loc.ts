// lib/payments/pos/nhat-ky-loc.ts — BỘ LỌC màn tra cứu "Nhật ký kiểm thẻ POS" (GĐ2 POS). THUẦN.
//
// Thiết kế: docs/pos-gd2-thiet-ke.md §7.2. Tham số URL đi vào đây trước khi thành `where` — mọi giá trị lạ
// bị BỎ (không ném, không lọc nhầm). Đây chỉ là BỘ LỌC: cách ly cơ sở do `scopedDb` (`PosCheckLog` ∈
// SCOPED_MODELS, prefix `payments:`), không do ô "Cơ sở". Ngày theo giờ Việt Nam (luật 19: nhận `now`).
import type { PosCheckLogKind, PosCheckTrigger, PosIntentStatus, Prisma } from "@prisma/client";
import { congNgay, dauNgayTuChuoi, laNgayHopLe, ngayVN, soNgayGiua } from "@/lib/format/thoi-gian-vn";
import { tachMaPos } from "./tach-ma-pos";

/** Trần số dòng một lần xem — chạm trần thì màn nói "thu hẹp bộ lọc". */
export const TRAN_DONG_NHAT_KY = 500;
/** Khoảng ngày tối đa một lần lọc (gồm cả hai đầu). */
export const TRAN_KHOANG_NGAY = 31;

/** Nhãn nguồn — `Record` ⇒ thêm giá trị enum mà quên nhãn là `tsc` đỏ. */
export const NHAN_NGUON: Record<PosCheckTrigger, string> = {
  SALE: "Sale bấm",
  POLLER: "Tự kiểm",
  AGENT: "Máy đồng bộ",
  IMPORT: "Sau import",
  QUET_SACH: "Quét cuối ngày",
};

export const NHAN_KET_QUA: Record<PosCheckLogKind, string> = {
  PAID: "Đã thu",
  PAID_AMOUNT_MISMATCH: "Lệch tiền",
  FAILED: "Thất bại",
  NOT_FOUND: "Chưa thấy",
  CANCELLED_AFTER_PAID: "Huỷ sau thu",
  PROVIDER_ERROR: "Lỗi kết nối",
  CACHE: "Bấm dồn (không hỏi máy)",
};

/** Nhãn ngắn trạng thái phiếu thu thẻ (cột "Trạng thái sau", thân chuông quét sạch). */
export const NHAN_TRANG_THAI_PHIEU: Record<PosIntentStatus, string> = {
  CHO_QUET: "Chờ quẹt",
  THAT_BAI: "Thất bại",
  DA_THU: "Đã thu",
  LECH_TIEN: "Lệch tiền",
  CAN_XU_LY: "Cần xử lý",
  HET_HAN: "Hết hạn",
  HUY: "Đã huỷ",
};

export type LocNhatKy = {
  /** "YYYY-MM-DD" giờ VN — gồm cả hai đầu. */
  tu: string;
  den: string;
  coSo: string | null;
  nguon: PosCheckTrigger | null;
  ketQua: PosCheckLogKind | null;
  /** Mã phiếu 5 ký tự đã chuẩn hoá (IN HOA, qua checksum). */
  ma: string | null;
  /** Câu nói cho người xem biết bộ lọc đã bị chỉnh / bỏ (luật 12 — không lặng lẽ đổi điều họ hỏi). */
  canhBao: string[];
};

type ThamSo = Record<string, string | string[] | undefined>;

const motGiaTri = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

function laKhoa<K extends string>(bang: Record<K, string>, v: string | undefined): v is K {
  return v !== undefined && Object.prototype.hasOwnProperty.call(bang, v);
}

export function docLocNhatKy(sp: ThamSo, now: Date, coSoChonDuoc: readonly string[]): LocNhatKy {
  const homNay = ngayVN(now);
  const canhBao: string[] = [];
  const tuTho = motGiaTri(sp.tu);
  const denTho = motGiaTri(sp.den);
  let tu = tuTho && laNgayHopLe(tuTho) ? tuTho : homNay;
  let den = denTho && laNgayHopLe(denTho) ? denTho : homNay;
  if (den < tu) [tu, den] = [den, tu];
  if (soNgayGiua(tu, den) + 1 > TRAN_KHOANG_NGAY) {
    den = congNgay(tu, TRAN_KHOANG_NGAY - 1);
    canhBao.push(`Chỉ xem tối đa ${TRAN_KHOANG_NGAY} ngày một lần — đã cắt tới ${den}.`);
  }

  const coSoTho = motGiaTri(sp.coSo);
  const nguonTho = motGiaTri(sp.nguon);
  const ketQuaTho = motGiaTri(sp.ketQua);
  const maTho = motGiaTri(sp.ma);

  let ma: string | null = null;
  if (maTho) {
    const tach = tachMaPos(maTho);
    if (tach.length === 1) ma = tach[0]!;
    else canhBao.push("Mã phiếu không hợp lệ (5 ký tự, có kiểm tra).");
  }

  return {
    tu,
    den,
    coSo: coSoTho && coSoChonDuoc.includes(coSoTho) ? coSoTho : null,
    nguon: laKhoa(NHAN_NGUON, nguonTho) ? nguonTho : null,
    ketQua: laKhoa(NHAN_KET_QUA, ketQuaTho) ? ketQuaTho : null,
    ma,
    canhBao,
  };
}

/** Bộ lọc ⇒ `where` của `PosCheckLog`: [00:00 VN ngày đầu, 00:00 VN ngày SAU ngày cuối). */
export function whereNhatKy(l: LocNhatKy): Prisma.PosCheckLogWhereInput {
  return {
    createdAt: { gte: dauNgayTuChuoi(l.tu), lt: dauNgayTuChuoi(congNgay(l.den, 1)) },
    ...(l.coSo ? { centerId: l.coSo } : {}),
    ...(l.nguon ? { triggeredBy: l.nguon } : {}),
    ...(l.ketQua ? { kind: l.ketQua } : {}),
    ...(l.ma ? { intent: { code5: l.ma } } : {}),
  };
}

/** Tham số URL của một bộ lọc (giữ bộ lọc khi chuyển trang / lọc nhanh). */
export function thamSoNhatKy(l: LocNhatKy, doi: Partial<Pick<LocNhatKy, "nguon" | "ketQua">> = {}): string {
  const q = new URLSearchParams({ tu: l.tu, den: l.den });
  const nguon = "nguon" in doi ? doi.nguon : l.nguon;
  const ketQua = "ketQua" in doi ? doi.ketQua : l.ketQua;
  if (l.coSo) q.set("coSo", l.coSo);
  if (nguon) q.set("nguon", nguon);
  if (ketQua) q.set("ketQua", ketQua);
  if (l.ma) q.set("ma", l.ma);
  return q.toString();
}
