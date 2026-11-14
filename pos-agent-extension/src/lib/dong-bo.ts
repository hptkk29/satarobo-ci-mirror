/**
 * MỘT lượt đồng bộ (hợp đồng §4.4 + §8.3): cửa sổ ⇒ các mảnh ≤ 24h ⇒ duyệt trang search (page_size
 * 50, lặp tới đủ `total_items`) ⇒ chuẩn hoá từng dòng theo whitelist ⇒ gửi theo lô.
 *
 *   · Lô gửi NGAY khi đọc (giao dịch tới satarobo sớm — sale đang chờ 8 giây), nhưng luôn GIỮ
 *     LẠI một lô để biết lô nào là CUỐI: lô cuối mang `final: true` + `jobIds` + `windowTo` của CẢ LƯỢT (hợp đồng
 *     1.1 §4.4 — mảnh cuối rỗng thì lô đang giữ là của mảnh sớm hơn, nhưng mốc gửi vẫn là mốc cuối mảnh cuối).
 *   · Lượt không có dòng nào vẫn gửi một lô rỗng `final: true` (để job được đánh DONE).
 *   · Hỏng giữa chừng (portal lỗi, hết phiên, satarobo từ chối) ⇒ gửi nốt lô đang giữ với
 *     `final: false` (dữ liệu đã đọc không bỏ), KHÔNG có lô final ⇒ nơi gọi KHÔNG đẩy `lastSyncedAt`.
 *   · RV5 — satarobo 400 PAYLOAD_INVALID trỏ ĐÚNG một dòng (`transactions[i].…`) ⇒ bỏ dòng đó, gửi lại lô
 *     (hợp đồng §7.1: "KHÔNG gửi lại y hệt"); tối đa `TOI_DA_BO_DONG_MOT_LUOT` dòng / lượt. Lượt có dòng bị
 *     bỏ là lượt CHƯA TRỌN: lô final KHÔNG mang `jobIds` — dòng bị bỏ có thể chính là lần quẹt sale đang
 *     chờ, đóng job lúc đó là trả "chưa thấy giao dịch" giả ⇒ mời khách quẹt lại (thu hai lần).
 *     Rà đối kháng 1.1: CHỈ bỏ được dòng THANH TOÁN. Dòng hủy / hoàn / loại lạ / thiếu loại là TÍN HIỆU HỦY của một
 *     thanh toán cùng RRN — bỏ nó là để thanh toán đó vào sổ MỘT MÌNH (thu tiền lần quẹt đã hủy) ⇒ DỪNG lượt.
 */
import { chiaCuaSo, type CuaSo } from "./cua-so.js";
import { dinhDangGioVN } from "./gio-vn.js";
import { BYTE_MOT_LO, DONG_MOT_LO, TOI_DA_BO_DONG_MOT_LUOT, TOI_DA_LO_MOT_LUOT, TOI_DA_TRANG_MOT_MANH } from "./hang-so.js";
import { duyetTrang } from "./phan-trang.js";
import { chuanHoaGiaoDich, type DongGiaoDich } from "./payload.js";
import type { KetQuaMain } from "./portal.js";

export interface LoGiaoDich {
  syncId: string;
  batchIndex: number;
  final: boolean;
  windowFrom: string;
  windowTo: string;
  jobIds: string[];
  transactions: DongGiaoDich[];
}

/** Dựng lô với thứ tự khoá CỐ ĐỊNH của hợp đồng (thân V3 của test vector dựng lại đúng từng byte). */
export function dungLo(p: LoGiaoDich): LoGiaoDich {
  return {
    syncId: p.syncId,
    batchIndex: p.batchIndex,
    final: p.final,
    windowFrom: p.windowFrom,
    windowTo: p.windowTo,
    jobIds: [...p.jobIds],
    transactions: p.transactions,
  };
}

export type KetQuaGuiLo = { ok: true; data: unknown } | { ok: false; ma: string; httpStatus: number | null; field: string | null };

export type LoiDongBo =
  | { nguon: "PORTAL"; ketQua: Exclude<KetQuaMain, { loai: "TRANG" }> }
  | { nguon: "PHAN_TRANG"; ma: "THIEU_DONG" | "QUA_NHIEU_TRANG" | "PORTAL_BAD_SHAPE" }
  | { nguon: "SATAROBO"; ma: string; httpStatus: number | null }
  | { nguon: "QUA_NHIEU_LO" };

export interface DauVaoDongBo {
  cuaSo: CuaSo;
  jobIds: readonly string[];
  syncId: string;
  goiTrang(manh: CuaSo, pageIndex: number): Promise<KetQuaMain>;
  guiLo(lo: LoGiaoDich): Promise<KetQuaGuiLo>;
}

export type KetQuaDongBo =
  | { ok: true; soDong: number; soLo: number; phanHoiCuoi: unknown; dongBiBo: number }
  | { ok: false; loi: LoiDongBo; soDong: number; soLo: number };

const enc = new TextEncoder();

/** Chia dòng thành lô ≤ `toiDaDong` dòng và ≤ `toiDaByte` byte (ước theo JSON từng dòng). */
export function chiaLo(rows: readonly DongGiaoDich[], toiDaDong: number, toiDaByte: number): DongGiaoDich[][] {
  const ra: DongGiaoDich[][] = [];
  let hien: DongGiaoDich[] = [];
  let byte = 0;
  for (const r of rows) {
    const b = enc.encode(JSON.stringify(r)).length + 1;
    if (hien.length > 0 && (hien.length >= toiDaDong || byte + b > toiDaByte)) {
      ra.push(hien);
      hien = [];
      byte = 0;
    }
    hien.push(r);
    byte += b;
  }
  if (hien.length > 0) ra.push(hien);
  return ra;
}

/** Chỉ số dòng mà máy chủ chỉ ra trong `error.field` (dạng GĐ4 `transactions[3].x`, hoặc zod `transactions.3.x`). */
export function dongHongTuLoi(kq: Extract<KetQuaGuiLo, { ok: false }>, soDong: number): number | null {
  if (kq.httpStatus !== 400 || kq.ma !== "PAYLOAD_INVALID" || kq.field === null) return null;
  const m = /^transactions(?:\[(\d{1,4})\]|\.(\d{1,4}))(?:\.|$)/.exec(kq.field);
  if (!m) return null;
  const i = Number(m[1] ?? m[2]);
  return Number.isInteger(i) && i < soDong ? i : null;
}

/**
 * Dòng THANH TOÁN (`transaction_type` = `PAYMENT`, không phân biệt hoa thường — cùng phép so `laLoaiThanhToan` của
 * máy chủ). CHỈ dòng này được BỎ ở đường 400 trỏ một dòng (máy chủ 1.0): máy chủ 1.1 GIỮ LẠI thanh toán cùng RRN khi
 * THẤY dòng hủy/hoàn bị từ chối trong cùng lô (RVG-02 của GĐ4) — dòng extension tự bỏ thì không bao giờ được thấy.
 * Mã TRƯỚC (RV5): bỏ BẤT KỲ dòng nào `error.field` trỏ tới, kể cả dòng VOID ⇒ thanh toán của nó vào sổ một mình.
 */
function laDongThanhToan(d: DongGiaoDich | undefined): boolean {
  return typeof d?.transaction_type === "string" && d.transaction_type.trim().toUpperCase() === "PAYMENT";
}

class DungDongBo extends Error {
  constructor(readonly loi: LoiDongBo) {
    super("dừng lượt đồng bộ");
  }
}

export async function chayDongBo(dv: DauVaoDongBo): Promise<KetQuaDongBo> {
  const manh = chiaCuaSo(dv.cuaSo);
  let soDong = 0;
  let soLo = 0;
  let batchIndex = 0;
  let dangGiu: LoGiaoDich | null = null;
  let phanHoiCuoi: unknown = null;
  let dongBiBo = 0;

  const gui = async (lo: LoGiaoDich): Promise<void> => {
    if (lo.batchIndex > TOI_DA_LO_MOT_LUOT) throw new DungDongBo({ nguon: "QUA_NHIEU_LO" });
    let hien = lo;
    for (;;) {
      const kq = await dv.guiLo(hien);
      if (kq.ok) {
        soLo++;
        phanHoiCuoi = kq.data;
        return;
      }
      const i = dongHongTuLoi(kq, hien.transactions.length);
      // Dòng không phải THANH TOÁN (tín hiệu hủy) ⇒ DỪNG lượt thay vì bỏ: không lô final ⇒ máy chủ không ghi gì của
      // lượt, job không DONE (sale nhận "chưa trả lời kịp" — không bao giờ "cho quẹt lại").
      if (i === null || dongBiBo >= TOI_DA_BO_DONG_MOT_LUOT || !laDongThanhToan(hien.transactions[i])) {
        throw new DungDongBo({ nguon: "SATAROBO", ma: kq.ma, httpStatus: kq.httpStatus });
      }
      dongBiBo++;
      // Bỏ ĐÚNG dòng đó; lượt thành chưa trọn ⇒ lô (kể cả final) không đóng job nào.
      hien = dungLo({ ...hien, jobIds: [], transactions: hien.transactions.filter((_, j) => j !== i) });
    }
  };
  const xaLoDangGiu = async (): Promise<void> => {
    if (!dangGiu) return;
    const lo = dangGiu;
    dangGiu = null;
    await gui(lo);
  };

  try {
    let khungCuoi = { windowFrom: dinhDangGioVN(dv.cuaSo.tu), windowTo: dinhDangGioVN(dv.cuaSo.den) };
    for (const m of manh) {
      const khung = { windowFrom: dinhDangGioVN(m.tu), windowTo: dinhDangGioVN(m.den) };
      const kq = await duyetTrang<LoiDongBo>(
        async (pageIndex) => {
          const r = await dv.goiTrang(m, pageIndex);
          if (r.loai === "TRANG") return { ok: true, rows: r.rows, totalItems: r.totalItems };
          return { ok: false, loi: { nguon: "PORTAL", ketQua: r } };
        },
        async (rows) => {
          const dong: DongGiaoDich[] = [];
          for (const r of rows) {
            const d = chuanHoaGiaoDich(r);
            if (d) dong.push(d);
          }
          soDong += dong.length;
          for (const phan of chiaLo(dong, DONG_MOT_LO, BYTE_MOT_LO)) {
            await xaLoDangGiu();
            dangGiu = dungLo({ syncId: dv.syncId, batchIndex: batchIndex++, final: false, ...khung, jobIds: [], transactions: phan });
          }
        },
        TOI_DA_TRANG_MOT_MANH,
      );
      if (!kq.ok) {
        const loi: LoiDongBo = "nguon" in kq.loi ? kq.loi : { nguon: "PHAN_TRANG", ma: kq.loi.ma };
        await xaLoDangGiu(); // dữ liệu đã đọc vẫn tới satarobo — nhưng KHÔNG có lô final
        return { ok: false, loi, soDong, soLo };
      }
      khungCuoi = khung;
    }
    const cuoi: LoGiaoDich =
      dangGiu ?? dungLo({ syncId: dv.syncId, batchIndex: batchIndex++, final: true, ...khungCuoi, jobIds: [], transactions: [] });
    dangGiu = null;
    // Hợp đồng 1.1 §4.4: lô final mang `windowTo` của CẢ LƯỢT (= mốc cuối mảnh CUỐI) dù lô đang giữ là của một mảnh
    // SỚM hơn (mảnh sau rỗng) — máy chủ chỉ đóng job tạo ≤ mốc này và lưu nó làm "dữ liệu đã đọc tới". `windowFrom`
    // giữ của lô. Chỉ lô final: lượt hỏng giữa chừng không có lô final nên không bao giờ khai mốc cả lượt.
    await gui({ ...cuoi, final: true, windowTo: khungCuoi.windowTo, jobIds: dongBiBo > 0 ? [] : [...dv.jobIds] });
    return { ok: true, soDong, soLo, phanHoiCuoi, dongBiBo };
  } catch (e) {
    if (e instanceof DungDongBo) return { ok: false, loi: e.loi, soDong, soLo };
    throw e;
  }
}
