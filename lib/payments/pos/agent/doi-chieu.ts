// lib/payments/pos/agent/doi-chieu.ts — ĐỐI CHIẾU agent ↔ file theo ngày (cho GĐ6). THUẦN. Thiết kế §9.3 mục 4.
//
// Nguồn: `PosTxnSource` — ẢNH CHỤP mỗi nguồn nói gì (không phải giá trị đang lưu ở `PosCardTransaction`). So
// trạng thái / loại bằng CHÍNH phép chuẩn hoá của lõi (`maTrangThaiPos`): "Thành công" file vs "Thành công"
// agent KHỚP; "Thất bại" vs mã treo LỆCH. Không số thẻ, không ghi chú (chỉ băm).
import { maTrangThaiPos } from "../phan-loai-pos";

export type DongNguonDoiChieu = {
  maGiaoDich: string;
  nguon: "FILE" | "AGENT";
  tuChoi: string | null;
  soTien: number | null;
  trangThai: string | null;
  loaiGiaoDich: string | null;
  thoiGianGiaoDich: Date | null;
  bamDienGiai: string | null;
  lanDauThay: Date;
};

export type NhomDoiChieu = "CHI_AGENT" | "CHI_FILE" | "AGENT_TU_CHOI" | "LECH" | "KHOP";

export type CotLech = "soTien" | "trangThai" | "loaiGiaoDich" | "thoiGianGiaoDich" | "bamDienGiai";

export type AnhNgan = { soTien: number | null; trangThai: string | null; loaiGiaoDich: string | null; tuChoi: string | null };

export type DongDoiChieu = {
  maGiaoDich: string;
  nhom: Exclude<NhomDoiChieu, "KHOP">;
  thoiGian: Date | null;
  agent: AnhNgan | null;
  file: AnhNgan | null;
  lech: CotLech[];
  /** lanDauThay(AGENT) − giờ giao dịch (agent nói). null khi không có agent. */
  treMs: number | null;
  /** Agent thấy trễ > 10 phút ⇒ "được bù" (quét bù sau hết phiên / mất kết nối). */
  duocBu: boolean;
};

const GIO_LECH_TOI_DA_MS = 60_000;
const BU_SAU_MS = 10 * 60_000;

function anh(r: DongNguonDoiChieu | undefined): AnhNgan | null {
  return r ? { soTien: r.soTien, trangThai: r.trangThai, loaiGiaoDich: r.loaiGiaoDich, tuChoi: r.tuChoi } : null;
}

function cotLech(a: DongNguonDoiChieu, f: DongNguonDoiChieu): CotLech[] {
  const lech: CotLech[] = [];
  if (a.soTien !== f.soTien) lech.push("soTien");
  if (maTrangThaiPos(a.trangThai) !== maTrangThaiPos(f.trangThai)) lech.push("trangThai");
  if (maTrangThaiPos(a.loaiGiaoDich) !== maTrangThaiPos(f.loaiGiaoDich)) lech.push("loaiGiaoDich");
  const ta = a.thoiGianGiaoDich?.getTime() ?? null;
  const tf = f.thoiGianGiaoDich?.getTime() ?? null;
  if (ta === null || tf === null ? ta !== tf : Math.abs(ta - tf) > GIO_LECH_TOI_DA_MS) lech.push("thoiGianGiaoDich");
  if (a.bamDienGiai !== f.bamDienGiai) lech.push("bamDienGiai");
  return lech;
}

export function doiChieuNguon(rows: readonly DongNguonDoiChieu[]): {
  tong: Record<NhomDoiChieu, number>;
  dong: DongDoiChieu[];
} {
  const theoMa = new Map<string, { a?: DongNguonDoiChieu; f?: DongNguonDoiChieu }>();
  for (const r of rows) {
    const o = theoMa.get(r.maGiaoDich) ?? {};
    if (r.nguon === "AGENT") o.a = r;
    else o.f = r;
    theoMa.set(r.maGiaoDich, o);
  }
  const tong: Record<NhomDoiChieu, number> = { CHI_AGENT: 0, CHI_FILE: 0, AGENT_TU_CHOI: 0, LECH: 0, KHOP: 0 };
  const dong: DongDoiChieu[] = [];
  for (const [maGiaoDich, { a, f }] of theoMa) {
    let nhom: NhomDoiChieu;
    let lech: CotLech[] = [];
    if (a && a.tuChoi !== null) nhom = "AGENT_TU_CHOI";
    else if (a && !f) nhom = "CHI_AGENT";
    else if (f && !a) nhom = "CHI_FILE";
    else {
      lech = cotLech(a!, f!);
      nhom = lech.length > 0 ? "LECH" : "KHOP";
    }
    tong[nhom] += 1;
    if (nhom === "KHOP") continue;
    const treMs = a?.thoiGianGiaoDich ? a.lanDauThay.getTime() - a.thoiGianGiaoDich.getTime() : null;
    dong.push({
      maGiaoDich,
      nhom,
      thoiGian: a?.thoiGianGiaoDich ?? f?.thoiGianGiaoDich ?? null,
      agent: anh(a),
      file: anh(f),
      lech,
      treMs,
      duocBu: treMs !== null && treMs > BU_SAU_MS,
    });
  }
  dong.sort((x, y) => (y.thoiGian?.getTime() ?? 0) - (x.thoiGian?.getTime() ?? 0) || x.maGiaoDich.localeCompare(y.maGiaoDich));
  return { tong, dong };
}
