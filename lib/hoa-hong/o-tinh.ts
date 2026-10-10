// lib/hoa-hong/o-tinh.ts — SO MỘT Ô TÍNH với "kỳ vọng hôm nay" (04 L13, L14, §10.4). THUẦN.
//
// Ô tính = (khoản THU × dòng đơn × thành phần). Ô đã tồn tại ⇒ engine KHÔNG BAO GIỜ ghi ORIGINAL vào nó nữa — mọi thay đổi sau
// đó là CHÊNH LỆCH giữa "kỳ vọng theo đầu vào hôm nay" và "Σ ròng mọi kind đã ghi" (L14), theo từng (vai × người).
//
// Vì sao so trên Σ RÒNG chứ không trên dòng ORIGINAL: đảo (hoàn), sửa nguồn, sửa đầu vào và khiếu nại đều ghi dòng riêng
// mang CÙNG ô. Chỉ nhìn ORIGINAL thì sau một lần hoàn, "kỳ vọng" (tính lại trên toàn bộ cơ sở) lệch với thực tế và lượt quét
// kế tiếp đòi ghi thêm — chính là cơ chế TRẢ HAI LẦN mà ô sinh ra để chặn (V8 của 04).
//
// Hàm này KHÔNG ghi gì. Nó nói: "không làm gì" · "ghi chênh lệch này" (chế độ đổi nguồn có quyền) · "đây là trôi, giữ cho người duyệt".
import type { KhoaNguoi } from "./khoa-so";

export type TrangThaiO = {
  calcSlotId: string;
  /** `netBase` của ô lúc tách. */
  netBase: number;
  /** `netBase` − Σ cơ sở đã đảo bởi các bút toán âm đã xử lý (04 §10.4). */
  coSoConLai: number;
  /** Σ `amount` MỌI kind của ô, theo (vai × người). Người có Σ = 0 có thể vắng. */
  rong: ReadonlyMap<KhoaNguoi, number>;
  /** Hash đã được chấp nhận: lượt ghi/so khớp gần nhất ∪ hash của hàng chờ INPUT_DRIFT đã "giữ nguyên". */
  hashDaChapNhan: ReadonlySet<string>;
  /**
   * Số SỰ KIỆN hoàn / điều chỉnh giảm đã đảo trên ô (mỗi `refEventId` một lần). Quyết định dung sai làm tròn của lượt QUÉT: dòng đảo làm tròn
   * theo TỈ LỆ TIỀN CỦA DÒNG (`round(rong × coSoDao / coSoConLai)`) còn kỳ vọng hôm nay làm tròn trên cơ sở còn lại (`round(coSoConLai × rate)`)
   * — hai phép làm tròn khác nhau nên sau mỗi lần hoàn một phần có thể lệch tới ~0,5đ mà đầu vào KHÔNG đổi (04 §11.1).
   */
  soLanDao: number;
  /** Ô có dòng `DISPUTE_ADJUSTMENT` ⇒ KHÔNG tự động sửa theo nguồn (khiếu nại có thể đã bù đúng phần đó). */
  coKhieuNai: boolean;
};

export type ChenhNguoi = {
  key: KhoaNguoi;
  /** kỳ vọng − ròng. Dương = phải trả thêm; âm = phải đòi lại. */
  chenh: number;
  kyVong: number;
  rong: number;
};

export type KetQuaSoVoiO =
  | { loai: "KHONG_LAM_GI"; lyDo: "HASH_DA_CHAP_NHAN" | "CHENH_BANG_0" | "LAM_TRON_SAU_HOAN" }
  | { loai: "GHI"; chenh: ChenhNguoi[] }
  | { loai: "INPUT_DRIFT"; chenh: ChenhNguoi[] };

/**
 * @param kyVong  số tiền kỳ vọng theo (vai × người) tính TRÊN `coSoConLai` của ô với đầu vào hôm nay. Người vắng = 0.
 * @param hashMoi `inputHash` của đầu vào hôm nay.
 * @param cheDo   `QUET` = lượt quét thường (chỉ phát hiện, KHÔNG tự ghi) · `DOI_NGUON_CO_QUYEN` = đổi nguồn sau thu đã được
 *                cấp quyền (04 §10.4 bước 4): tự ghi chênh lệch, trừ khi ô có khiếu nại.
 */
/**
 * Dung sai làm tròn (VND, mỗi vai × người) của lượt QUÉT, theo số lần ô đã bị hoàn. Chưa hoàn lần nào ⇒ 0: lúc ghi và lúc so dùng CÙNG một
 * công thức nên mọi chênh lệch đều là trôi thật. Mỗi lần hoàn cộng thêm tối đa 0,5đ sai số (đầu và cuối đều là số nguyên nên chênh nguyên ≤ 1 + ⌊k/2⌋).
 */
export function dungSaiLamTron(soLanDao: number): number {
  return soLanDao <= 0 ? 0 : Math.floor(soLanDao / 2) + 1;
}

/**
 * Chênh lệch THÔ `kỳ vọng − ròng` theo từng (vai × người), sắp theo khoá; chỉ người có chênh ≠ 0. Người vắng ở một phía = 0.
 * MỘT chỗ tính cho `soVoiO` (phát hiện) và các đường GHI chênh lệch (`SOURCE_CORRECTION`, `INPUT_CORRECTION`) — bản thứ hai ở chỗ ghi là chỗ lệch.
 */
export function tinhChenhTheoNguoi(kyVong: ReadonlyMap<KhoaNguoi, number>, rong: ReadonlyMap<KhoaNguoi, number>): ChenhNguoi[] {
  const khoa = new Set<KhoaNguoi>([...kyVong.keys(), ...rong.keys()]);
  const chenh: ChenhNguoi[] = [];
  for (const key of [...khoa].sort()) {
    const kv = kyVong.get(key) ?? 0;
    const r = rong.get(key) ?? 0;
    if (kv !== r) chenh.push({ key, chenh: kv - r, kyVong: kv, rong: r });
  }
  return chenh;
}

export function soVoiO(input: {
  o: TrangThaiO;
  kyVong: ReadonlyMap<KhoaNguoi, number>;
  hashMoi: string;
  cheDo: "QUET" | "DOI_NGUON_CO_QUYEN";
}): KetQuaSoVoiO {
  const { o } = input;
  if (input.cheDo === "QUET" && o.hashDaChapNhan.has(input.hashMoi)) {
    return { loai: "KHONG_LAM_GI", lyDo: "HASH_DA_CHAP_NHAN" };
  }

  const chenh = tinhChenhTheoNguoi(input.kyVong, o.rong);
  if (chenh.length === 0) return { loai: "KHONG_LAM_GI", lyDo: "CHENH_BANG_0" };

  // Chỉ lượt QUÉT nuốt sai số làm tròn: đổi nguồn có quyền phải tự ghi ĐÚNG số chênh, kể cả 1đ.
  const dungSai = dungSaiLamTron(o.soLanDao);
  if (input.cheDo === "QUET" && dungSai > 0 && chenh.every((c) => Math.abs(c.chenh) <= dungSai)) {
    return { loai: "KHONG_LAM_GI", lyDo: "LAM_TRON_SAU_HOAN" };
  }

  if (input.cheDo === "DOI_NGUON_CO_QUYEN" && !o.coKhieuNai) return { loai: "GHI", chenh };
  return { loai: "INPUT_DRIFT", chenh };
}

/**
 * Tách chênh lệch của một lượt ĐỔI NGUỒN CÓ QUYỀN thành phần TỰ GHI và phần CHỜ DUYỆT (rà độc lập 08/10).
 *
 * Người đổi nguồn được cấp quyền SỬA NGUỒN — không phải quyền chuyển tiền giữa hai người cùng vai. Ô có thể đang lệch vì một lý do KHÁC nguồn
 * (vd `Lead.convertedById` đổi từ Sale A sang Sale B: A −, B +): đó là INPUT_DRIFT của lượt quét thường, phải qua người duyệt. Nếu lượt đổi nguồn
 * tự ghi luôn phần đó thì khoản chuyển Sale được ghi thẳng vào sổ gắn nhãn "đổi nguồn", không ai duyệt.
 *
 * Luật (theo từng VAI, vì chuyển tiền chỉ xảy ra GIỮA các người cùng vai):
 *   · vai `isAcquisition` (người giới thiệu / cộng tác viên): phụ thuộc nguồn theo định nghĩa ⇒ TỰ GHI;
 *   · vai khác: nếu trong vai có ĐỒNG THỜI người mới xuất hiện (ròng 0 → kỳ vọng ≠ 0) và người cũ biến mất (ròng ≠ 0 → kỳ vọng 0) thì đó là
 *     CHUYỂN TIỀN giữa hai người ⇒ cả vai CHỜ DUYỆT; còn lại (đổi tỉ lệ cho cùng người vì chính sách theo nhóm nguồn, hoặc chỉ một phía) ⇒ TỰ GHI.
 */
export function tachChenhDoiNguon(chenh: readonly ChenhNguoi[], vaiAcquisition: ReadonlySet<string>): { tuGhi: ChenhNguoi[]; choDuyet: ChenhNguoi[] } {
  const theoVai = new Map<string, ChenhNguoi[]>();
  for (const c of chenh) {
    const vai = c.key.split("|")[0]!;
    theoVai.set(vai, [...(theoVai.get(vai) ?? []), c]);
  }
  const tuGhi: ChenhNguoi[] = [];
  const choDuyet: ChenhNguoi[] = [];
  for (const [vai, ds] of theoVai) {
    const chuyenTien = !vaiAcquisition.has(vai) && ds.some((c) => c.rong === 0 && c.kyVong !== 0) && ds.some((c) => c.kyVong === 0 && c.rong !== 0);
    (chuyenTien ? choDuyet : tuGhi).push(...ds);
  }
  const sapXep = (a: ChenhNguoi, b: ChenhNguoi) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return { tuGhi: tuGhi.sort(sapXep), choDuyet: choDuyet.sort(sapXep) };
}
