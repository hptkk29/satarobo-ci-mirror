// tests/fixtures/pos/smartpos-gd3.ts — FIXTURE GĐ3 POS (docs/pos-gd3-thiet-ke.md §9.1).
//
// ⚠️ DỰNG từ hình dạng hai file thật 29/09/2026 (xem `smartpos-that.ts`), KHÔNG phải bản sao: file
// thật chỉ có 1 dòng thất bại có ghi chú và không có mã phiếu (đo: Phụ lục A.3 của thiết kế). Mỗi
// dòng ở đây NHÂN BẢN một dòng thật CÙNG LOẠI đã che trong `DONG_CS1`/`DONG_CS2` (65 cột đúng thứ tự,
// ô số, dòng Hủy ÂM, dòng Hủy không có "Mã chuẩn chi"/"Số thẻ", "Mã hạch toán giao dịch gốc" = mã
// giao dịch thẻ của gốc) rồi đổi:
//   · "Mã giao dịch"                       — băm hex 32 TẤT ĐỊNH theo nhãn, giữ liên kết Hủy → gốc;
//   · "Mã giao dịch thẻ" / "Mã chuẩn chi" /
//     "Mã đơn hàng"                         — dãy số GIẢ tất định (che RRN / mã chuẩn chi / mã đơn);
//   · "Mã thiết bị" = MAY_CS1, quầy + cửa hàng của CS1;
//   · "Diễn giải đơn hàng"                 — theo bảng §9.1 (mã phiếu do người gọi truyền vào);
//   · "Số tiền thanh toán"                 — KHÔNG tròn (khớp đúng số phiếu ở ca DB).
//
// HAI CHỖ CỐ Ý KHÁC file thật, để lưới PII có cái mà bắt (file thật đã che sẵn nên không thử được):
//   · "Tên chủ thẻ" của dòng thành công = một tên GIẢ dễ nhận (`TEN_CHU_THE_GIA`) — file thật ghi "/";
//   · "Số thẻ" của `thu[2]` = số thẻ TEST đầy đủ 16 chữ số (`SO_THE_DAY_DU`) — như một file lỡ không
//     che; tầng đọc + schema server phải che nó.
//
// HÌNH DẠNG ZIP: `<thu_muc>/29092026_TXN_000.xlsx` + `_001.xlsx`, mỗi mục ghi bằng DATA DESCRIPTOR
// (đúng như file ngân hàng — `dungXlsxThat` lo phần đó). File ngân hàng xếp giờ GIẢM DẦN ⇒ dòng Hủy
// (giờ muộn hơn gốc) nằm ở `_000`, gốc nằm ở `_001`.
import { createHash } from "node:crypto";
import JSZip from "jszip";
import {
  DONG_CS1,
  DONG_CS2,
  HEADER_THAT,
  MAY_CS1,
  THU_MUC_CS1,
  dungXlsxThat,
  type DongThat,
} from "./smartpos-that";

/** Mã phiếu (5 ký tự) mà các dòng mang trong "Diễn giải đơn hàng" — người gọi truyền vào. */
export type MaPhieuGd3 = {
  thu: readonly [string, string, string];
  capHuy: string;
  trongGhiChu: readonly [string, string];
};

/** Số tiền (VND) — KHÔNG tròn, mỗi phiếu một số. Dòng Hủy mang ÂM số gốc. */
export const TIEN_GD3 = {
  thu: [3_168_000, 3_564_000, 2_772_000],
  capHuy: 1_980_000,
  trongGhiChu: [2_376_000, 1_584_000],
  /** Hai dòng thất bại không mang mã phiếu nào ("0900000001", "Quet lai"). */
  thatBaiKhongMa: 2_000,
} as const;

/** Tên GIẢ trên ô "Tên chủ thẻ" của dòng thành công — không được xuất hiện ở bất kỳ đâu trong DB. */
export const TEN_CHU_THE_GIA = "TRAN THI CHU THE GIA";
/** Số thẻ TEST (Visa 4111…) ĐẦY ĐỦ — như một file lỡ không che. */
export const SO_THE_DAY_DU = "4111111111111111";

const bam = (nhan: string) => createHash("sha256").update(`pos-gd3:${nhan}`).digest("hex");

/** Mã giao dịch 32 hex tất định theo nhãn (đúng dạng file thật). */
const maGd = (nhan: string) => bam(nhan).slice(0, 32);

/** `n` chữ số GIẢ tất định theo nhãn. */
function soGia(nhan: string, n: number): string {
  const h = createHash("sha256").update(`pos-gd3-so:${nhan}`).digest();
  let s = "";
  for (let i = 0; s.length < n; i++) s += String(h[i % h.length]! % 10);
  return s;
}

/** Mã giao dịch của từng dòng — dùng để tra kết quả trong DB. */
export const GD3 = {
  thu: [maGd("thu-0"), maGd("thu-1"), maGd("thu-2")] as const,
  /** [0] "0900000001" · [1] "<tg0>" · [2] "HP <tg1> Be B" · [3] "<tg0> <tg1>" · [4] "Quet lai". */
  thatBai: [maGd("tb-0"), maGd("tb-1"), maGd("tb-2"), maGd("tb-3"), maGd("tb-4")] as const,
  goc: maGd("cap-goc"),
  huy: maGd("cap-huy"),
};

/** Mọi mã giao dịch của fixture (10). */
export const MA_GD3_TAT_CA: readonly string[] = [...GD3.thu, ...GD3.thatBai, GD3.goc, GD3.huy];

/** Mã chỉ có ở phần `_001` (gốc của cặp + 1 thành công + 2 thất bại). */
export const MA_CHI_O_001: readonly string[] = [GD3.goc, GD3.thu[2], GD3.thatBai[3], GD3.thatBai[4]];

// ── Khuôn: dòng thật CÙNG LOẠI (đã che) ──────────────────────────────────────────
const ma = (d: DongThat) => String(d["Mã giao dịch"]);
const timDong = (ds: readonly DongThat[], dk: (d: DongThat) => boolean, ten: string): DongThat => {
  const d = ds.find(dk);
  if (!d) throw new Error(`fixture GĐ3: không thấy dòng thật "${ten}"`);
  return d;
};
const KHUON_THANH_CONG = timDong(
  DONG_CS1,
  (d) => d["Loại giao dịch"] === "Thanh toán" && d["Trạng thái giao dịch"] === "Thành công" && !d["Trạng thái Hoàn/Hủy"],
  "thanh toán thành công",
);
const KHUON_THAT_BAI = timDong(DONG_CS1, (d) => d["Trạng thái giao dịch"] === "Thất bại", "thất bại");
const KHUON_THAT_BAI_GHI_CHU = timDong(DONG_CS2, (d) => d["Trạng thái giao dịch"] === "Thất bại" && !!d["Diễn giải đơn hàng"], "thất bại có ghi chú");
const KHUON_HUY = timDong(DONG_CS1, (d) => d["Loại giao dịch"] === "Hủy", "dòng Hủy");
const KHUON_GOC = timDong(DONG_CS1, (d) => ma(d) === String(KHUON_HUY["Mã giao dịch gốc"]), "gốc của dòng Hủy");

/** Cột của CỬA HÀNG / QUẦY / MÁY CS1 — áp cho mọi dòng (kể cả dòng nhân bản từ khuôn CS2). */
const COT_CS1: DongThat = Object.fromEntries(
  [
    "Tên cửa hàng",
    "Tên quầy thanh toán",
    "Mã cửa hàng",
    "Mã quầy thanh toán",
    "Mã TCB quầy thanh toán",
    "Mã nhà cung cấp",
    "Mã TCB Nhà cung cấp",
    "Tên nhà cung cấp",
  ].map((k) => [k, KHUON_THANH_CONG[k] ?? ""]),
);

type MotDong = {
  nhan: string;
  khuon: DongThat;
  dienGiai: string;
  soTien: number;
  gio: string;
  them?: DongThat;
};

function dung(x: MotDong): DongThat {
  const d: DongThat = { ...x.khuon, ...COT_CS1 };
  d["Mã giao dịch"] = maGd(x.nhan);
  if (x.khuon["Mã giao dịch thẻ"] !== undefined) d["Mã giao dịch thẻ"] = soGia(`rrn:${x.nhan}`, 12);
  if (x.khuon["Mã chuẩn chi"] !== undefined) d["Mã chuẩn chi"] = soGia(`ccc:${x.nhan}`, 6);
  d["Mã đơn hàng"] = `SMPC${soGia(`don:${x.nhan}`, 22)}`;
  d["Mã thiết bị"] = MAY_CS1;
  d["Diễn giải đơn hàng"] = x.dienGiai;
  d["Số tiền thanh toán"] = x.soTien;
  d["Số tiền đơn hàng"] = Math.abs(x.soTien);
  d["Thời gian giao dịch"] = `2026/09/29 ${x.gio}`;
  d["Thời gian tạo đơn hàng"] = `2026/09/29 ${x.gio.slice(0, 6)}00`;
  if (d["Diễn giải đơn hàng"] === "") delete d["Diễn giải đơn hàng"];
  return { ...d, ...(x.them ?? {}) };
}

/**
 * 10 dòng, chia hai phần như file ngân hàng (giờ GIẢM DẦN):
 *   `_000` = Hủy + 2 thành công + 3 thất bại   ·   `_001` = gốc + 1 thành công + 2 thất bại.
 */
export function dungDongGd3(maPhieu: MaPhieuGd3): { phan000: DongThat[]; phan001: DongThat[] } {
  const [tg0, tg1] = maPhieu.trongGhiChu;
  const thanhCong = (i: 0 | 1 | 2, dienGiai: string, gio: string, them?: DongThat): MotDong => ({
    nhan: `thu-${i}`,
    khuon: KHUON_THANH_CONG,
    dienGiai,
    soTien: TIEN_GD3.thu[i],
    gio,
    them: { "Tên chủ thẻ": TEN_CHU_THE_GIA, ...(them ?? {}) },
  });
  const thatBai = (i: number, dienGiai: string, soTien: number, gio: string, khuon = KHUON_THAT_BAI): MotDong => ({
    nhan: `tb-${i}`,
    khuon,
    dienGiai,
    soTien,
    gio,
  });

  const goc = dung({ nhan: "cap-goc", khuon: KHUON_GOC, dienGiai: maPhieu.capHuy, soTien: TIEN_GD3.capHuy, gio: "19:24:15" });
  const huy = dung({
    nhan: "cap-huy",
    khuon: KHUON_HUY,
    dienGiai: "",
    soTien: -TIEN_GD3.capHuy,
    gio: "19:24:36",
    them: {
      "Mã giao dịch gốc": String(goc["Mã giao dịch"]),
      // Như file thật: dòng Hủy mang CÙNG mã giao dịch thẻ + mã đơn hàng với gốc.
      "Mã hạch toán giao dịch gốc": String(goc["Mã giao dịch thẻ"]),
      "Mã giao dịch thẻ": String(goc["Mã giao dịch thẻ"]),
      "Mã đơn hàng": String(goc["Mã đơn hàng"]),
    },
  });

  const phan000 = [
    dung(thanhCong(0, maPhieu.thu[0], "19:41:18")),
    dung(thatBai(0, "0900000001", TIEN_GD3.thatBaiKhongMa, "19:38:55", KHUON_THAT_BAI_GHI_CHU)),
    dung(thanhCong(1, `HP ${maPhieu.thu[1]}`, "19:35:07")),
    dung(thatBai(1, tg0, TIEN_GD3.trongGhiChu[0], "19:31:40")),
    dung(thatBai(2, `HP ${tg1} Be B`, TIEN_GD3.trongGhiChu[1], "19:28:02")),
    huy,
  ];
  const phan001 = [
    goc,
    dung(thanhCong(2, `${maPhieu.thu[2]} 0900000002`, "19:20:44", { "Số thẻ": SO_THE_DAY_DU })),
    dung(thatBai(3, `${tg0} ${tg1}`, TIEN_GD3.trongGhiChu[0], "19:17:09")),
    dung(thatBai(4, "Quet lai", TIEN_GD3.thatBaiKhongMa, "19:12:51")),
  ];
  return { phan000, phan001 };
}

/** Một phần của zip: các dòng + header riêng (mặc định 65 cột thật). */
export type PhanZip = { dong: readonly DongThat[]; header?: readonly string[] };

/** Zip như file tải về, mỗi phần một .xlsx `<thuMuc>/29092026_TXN_00i.xlsx` (data descriptor). */
export async function dungZipCacPhan(thuMuc: string, cacPhan: readonly PhanZip[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.folder(thuMuc);
  for (let i = 0; i < cacPhan.length; i++) {
    const so = String(i).padStart(3, "0");
    const p = cacPhan[i]!;
    zip.file(
      `${thuMuc}/29092026_TXN_${so}.xlsx`,
      await dungXlsxThat(p.dong, { header: p.header ?? HEADER_THAT, tenSheet: `29092026_TXN_${so}` }),
    );
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", streamFiles: true });
}

/** Zip GĐ3 (`_000` + `_001`). `phan` cho phép thay dòng của từng phần (ca nhập lại có sửa). */
export async function dungZipGd3(
  maPhieu: MaPhieuGd3,
  phan?: { phan000?: readonly DongThat[]; phan001?: readonly DongThat[]; header001?: readonly string[] },
): Promise<Uint8Array> {
  const goc = dungDongGd3(maPhieu);
  return dungZipCacPhan(THU_MUC_CS1, [
    { dong: phan?.phan000 ?? goc.phan000 },
    { dong: phan?.phan001 ?? goc.phan001, header: phan?.header001 },
  ]);
}

/** Bỏ MỘT cột khỏi header + mọi dòng (ca "thiếu cột"). */
export function boCot(dong: readonly DongThat[], cot: string): { header: string[]; dong: DongThat[] } {
  if (!HEADER_THAT.includes(cot)) throw new Error(`fixture GĐ3: không có cột "${cot}" để bỏ`);
  return {
    header: HEADER_THAT.filter((h) => h !== cot),
    dong: dong.map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== cot))),
  };
}

/** Sửa các ô của MỘT dòng (theo mã giao dịch) trong một phần — mọi ô khác giữ nguyên. */
export function suaDong(dong: readonly DongThat[], maGiaoDich: string, o: DongThat): DongThat[] {
  if (!dong.some((d) => ma(d) === maGiaoDich)) throw new Error(`fixture GĐ3: không có dòng ${maGiaoDich}`);
  return dong.map((d) => (ma(d) === maGiaoDich ? { ...d, ...o } : d));
}
