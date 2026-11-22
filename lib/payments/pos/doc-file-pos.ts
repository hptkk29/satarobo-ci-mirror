// lib/payments/pos/doc-file-pos.ts — Đọc file "Danh sách giao dịch V2" (merchant.techcombank.com)
// thành `DongPos[]`. THUẦN (không DB) — chạy được ở trình duyệt lẫn server.
//
// Nhận:
//   · `.zip` — ngân hàng xuất một thư mục `DDMMYYYY_TXN_x/…_000.xlsx, _001.xlsx…` khi file lớn.
//     Đọc HẾT mọi `*.xlsx` (kể cả trong thư mục con), sắp theo TÊN để `_000, _001…` đúng thứ tự;
//     bỏ rác của macOS (`__MACOSX/`, `._x`) và file khoá của Excel (`~$x`).
//   · `.xlsx` — upload thẳng.
// Mỗi file: SHEET ĐẦU, dòng đầu là header, tìm cột theo TÊN (không theo vị trí — file có ~65 cột
// và thứ tự cột không phải hợp đồng). Chỉ các cột của `COT_BAT_BUOC` được đọc: "Tên chủ thẻ" và
// mọi cột khác KHÔNG bao giờ vào `DongPos`.
//
// ⚠️ FAIL-CLOSED: một ô không đọc được (thời gian lạ, số tiền lẻ, mã giao dịch sai dạng) làm HỎNG
// CẢ LẦN ĐỌC, kèm tên file + số dòng. Đây là sổ tiền — đoán một giá trị để "cho qua" thì sai lệch
// đi thẳng vào đối soát mà không ai thấy.
import * as XLSX from "xlsx";
import type JSZip from "jszip";
import { COT_BAT_BUOC, cheSoThe, dongPosNhapSchema, type DongPos } from "./kieu";

export type KetQuaDocFile =
  | { ok: true; dong: DongPos[]; soFileXlsx: number }
  | { ok: false; loi: string; cotThieu: string[] };

const MB = 1024 * 1024;
/** Trần dung lượng file tải lên. */
export const TRAN_FILE = 10 * MB;
/** Trần tổng dung lượng giải nén của các file trong zip (chặn zip bom). */
export const TRAN_GIAI_NEN = 50 * MB;
/**
 * Trần tổng dung lượng giải nén BÊN TRONG các file .xlsx (một .xlsx cũng là một zip). Rộng hơn
 * `TRAN_GIAI_NEN` vì XML của 20.000 dòng × 65 cột tự nó đã vài chục MB; trần này chỉ để một
 * .xlsx bom không nở ra hàng GB trong bộ nhớ.
 */
export const TRAN_GIAI_NEN_XLSX = 200 * MB;
export const TRAN_SO_FILE = 20;
export const TRAN_SO_DONG = 20_000;

/** Header → khoá DongPos. Đủ 18 cột của `COT_BAT_BUOC`, không hơn. */
const COT_VAO: ReadonlyArray<readonly [string, keyof DongPos]> = [
  ["Mã giao dịch", "maGiaoDich"],
  ["Loại giao dịch", "loaiGiaoDich"],
  ["Hình thức thanh toán", "hinhThuc"],
  ["Trạng thái giao dịch", "trangThai"],
  ["Số tiền thanh toán", "soTien"],
  ["Thời gian giao dịch", "thoiGian"],
  ["Diễn giải đơn hàng", "dienGiai"],
  ["Mã chuẩn chi", "maChuanChi"],
  ["Mã giao dịch thẻ", "maGiaoDichThe"],
  ["Mã giao dịch gốc", "maGiaoDichGoc"],
  ["Trạng thái Hoàn/Hủy", "trangThaiHoanHuy"],
  ["Mã đơn hàng", "maDonHang"],
  ["Mã quầy thanh toán", "maQuay"],
  ["Mã thiết bị", "maThietBi"],
  ["Số thẻ", "soTheMasked"],
  ["Loại thẻ", "loaiThe"],
  ["Mã hạch toán", "maHachToan"],
  ["Phí giao dịch", "phiGiaoDich"],
];
const HEADER_CUA_KHOA = new Map<string, string>(COT_VAO.map(([h, k]) => [k, h]));

/** Chuẩn hoá tên header để so: NFC (Excel có thể lưu NFD), gộp khoảng trắng, trim. */
function chuanHeader(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

class LoiDoc extends Error {
  constructor(
    message: string,
    readonly cotThieu: string[] = [],
  ) {
    super(message);
  }
}

// ─── Giải nén có trần ─────────────────────────────────────────────────────────

/** `internalStream` có ở runtime của JSZip nhưng thiếu trong file khai kiểu. */
type CoStream = {
  internalStream(type: "uint8array"): {
    on(ev: "data", cb: (chunk: Uint8Array) => void): unknown;
    on(ev: "end", cb: () => void): unknown;
    on(ev: "error", cb: (e: Error) => void): unknown;
    pause(): unknown;
    resume(): unknown;
  };
};

function coStream(f: JSZip.JSZipObject): f is JSZip.JSZipObject & CoStream {
  return typeof (f as unknown as { internalStream?: unknown }).internalStream === "function";
}

/**
 * Giải nén một mục zip, DỪNG ngay khi vượt `conLai` byte (trả "VUOT") — không đợi nở hết rồi mới
 * đo, vì zip bom nở hết là đã hết bộ nhớ.
 */
async function giaiNenCoTran(f: JSZip.JSZipObject, conLai: number): Promise<Uint8Array | "VUOT"> {
  if (!coStream(f)) {
    // Đường lùi (không xảy ra với jszip 3.x): nở hết rồi đo.
    const u = await f.async("uint8array");
    return u.byteLength > conLai ? "VUOT" : u;
  }
  const s = f.internalStream("uint8array");
  return new Promise<Uint8Array | "VUOT">((resolve, reject) => {
    const khuc: Uint8Array[] = [];
    let n = 0;
    let xong = false;
    s.on("data", (c) => {
      if (xong) return;
      n += c.byteLength;
      if (n > conLai) {
        xong = true;
        s.pause();
        resolve("VUOT");
        return;
      }
      khuc.push(c);
    });
    s.on("error", (e) => {
      if (xong) return;
      xong = true;
      reject(e);
    });
    s.on("end", () => {
      if (xong) return;
      xong = true;
      const out = new Uint8Array(n);
      let o = 0;
      for (const c of khuc) {
        out.set(c, o);
        o += c.byteLength;
      }
      resolve(out);
    });
    s.resume();
  });
}

async function napJsZip(): Promise<typeof JSZip> {
  const m = await import("jszip");
  return m.default;
}

/** Nở thử toàn bộ nội dung một .xlsx để đo, trả số byte đã nở hoặc "VUOT". */
async function doGiaiNenXlsx(bytes: Uint8Array, conLai: number): Promise<number | "VUOT"> {
  const JSZipCtor = await napJsZip();
  let zip: JSZip;
  try {
    zip = await JSZipCtor.loadAsync(bytes);
  } catch {
    return 0; // không phải zip ⇒ để XLSX.read báo lỗi định dạng
  }
  let tong = 0;
  for (const f of Object.values(zip.files)) {
    if (f.dir) continue;
    const u = await giaiNenCoTran(f, conLai - tong);
    if (u === "VUOT") return "VUOT";
    tong += u.byteLength;
  }
  return tong;
}

// ─── Đọc ô ─────────────────────────────────────────────────────────────────────

function vanBan(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return "";
  if (cell.t === "e" || cell.t === "z") return "";
  if (cell.t === "n" && typeof cell.v === "number") {
    // Mã số dài lưu dạng Ô SỐ: số nguyên an toàn ⇒ in đủ chữ số, không lấy chuỗi đã định dạng
    // (định dạng có thể chèn phân cách / ký hiệu mũ).
    return Number.isSafeInteger(cell.v) ? String(cell.v) : (cell.w ?? String(cell.v)).trim();
  }
  if (cell.v instanceof Date) return cell.v.toISOString();
  return String(cell.v).trim();
}

function soNgayTrongThang(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** Ghép ISO +07:00 từ các thành phần giờ VN. `null` khi thành phần vô lý. */
function isoVn(y: number, mo: number, d: number, h: number, mi: number, s: number): string | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12) return null;
  if (d < 1 || d > soNgayTrongThang(y, mo)) return null;
  if (h > 23 || mi > 59 || s > 59) return null;
  return `${y}-${p2(mo)}-${p2(d)}T${p2(h)}:${p2(mi)}:${p2(s)}+07:00`;
}

const TG_YMD = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const TG_DMY = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Thời gian giao dịch ⇒ ISO có offset +07:00. Giờ trong file là giờ VN; ghép chuỗi thẳng từ
 * thành phần, KHÔNG qua `new Date(chuỗi)` (kết quả của đường đó phụ thuộc TZ của máy chạy).
 */
function thoiGianIso(cell: XLSX.CellObject | undefined, date1904: boolean): string | null {
  if (cell && cell.t === "n" && typeof cell.v === "number") {
    // Ô ngày của Excel: số ngày từ mốc 1899-12-30 (hoặc 1904-01-01), phần lẻ là giờ — "giờ
    // đồng hồ" không múi, đọc bằng UTC để tách thành phần.
    const moc = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const t = new Date(moc + Math.round(cell.v * 86_400) * 1000);
    return isoVn(
      t.getUTCFullYear(),
      t.getUTCMonth() + 1,
      t.getUTCDate(),
      t.getUTCHours(),
      t.getUTCMinutes(),
      t.getUTCSeconds(),
    );
  }
  const s = vanBan(cell);
  let m = TG_YMD.exec(s);
  if (m) return isoVn(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  m = TG_DMY.exec(s);
  if (m) return isoVn(+m[3]!, +m[2]!, +m[1]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  return null;
}

/**
 * Số nguyên VND. `null` = ô trống; `"LOI"` = không phải số nguyên (KHÔNG làm tròn — VND không có
 * phần lẻ, một số lẻ nghĩa là đọc sai cột hoặc sai định dạng).
 */
function soNguyen(cell: XLSX.CellObject | undefined): number | null | "LOI" {
  if (cell && cell.t === "n" && typeof cell.v === "number") {
    return Number.isSafeInteger(cell.v) ? cell.v : "LOI";
  }
  // `\s` của JS đã gồm cả NBSP (Excel hay chèn làm phân cách nghìn).
  let s = vanBan(cell).replace(/\s/g, "");
  if (s === "") return null;
  s = s.replace(/(vnđ|vnd|đ|₫)$/i, "");
  let so: string | null = null;
  if (/^-?\d+$/.test(s)) so = s;
  else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) so = s.replace(/,/g, "");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) so = s.replace(/\./g, "");
  if (so === null) return "LOI";
  const n = Number(so);
  return Number.isSafeInteger(n) ? n : "LOI";
}

// ─── Đọc một file xlsx ─────────────────────────────────────────────────────────

type ONam = { dong: DongPos; soDong: number };

/**
 * ĐÚNG cảnh báo "ô kích thước = 0 trong data descriptor" — neo cả hai đầu. `N != M` với M ≠ 0 là
 * kích thước lệch THẬT (zip hỏng / bị cắt) và PHẢI in (rà vòng 3, ca `[POS-CB-06]`; bản trước lọc
 * bằng `startsWith` nên nuốt cả nó).
 */
const CANH_BAO_KICH_THUOC_ZIP = /^Bad uncompressed size: \d+ != 0$/;

/**
 * Chạy `fn` mà NUỐT đúng một cảnh báo của thư viện `xlsx`: `Bad uncompressed size: N != 0`.
 *
 * File ngân hàng ghi mục zip bằng data descriptor có ô kích thước giải nén = 0 (đo 30/09/2026 trên
 * hai file thật: 9 dòng cảnh báo mỗi file) — `xlsx` vẫn đọc đúng nhưng `console.error` mỗi mục, và
 * dev overlay của Next đếm thành "Issues" ⇒ người import tưởng hỏng. Chỉ lọc ĐÚNG chuỗi đó, CHỈ
 * trong lúc `fn` chạy (đồng bộ), khôi phục trong `finally`; mọi cảnh báo khác vẫn in. Ca `[POS-CB-*]`.
 */
export function nuotCanhBaoKichThuocZip<T>(fn: () => T): T {
  const errGoc = console.error;
  const warnGoc = console.warn;
  const loc =
    (goc: (...a: unknown[]) => void) =>
    (...a: unknown[]) => {
      if (typeof a[0] === "string" && CANH_BAO_KICH_THUOC_ZIP.test(a[0])) return;
      goc.apply(console, a);
    };
  console.error = loc(errGoc);
  console.warn = loc(warnGoc);
  try {
    return fn();
  } finally {
    console.error = errGoc;
    console.warn = warnGoc;
  }
}

function docMotXlsx(bytes: Uint8Array, tenFile: string, conLaiDong: number): ONam[] {
  let wb: XLSX.WorkBook;
  try {
    wb = nuotCanhBaoKichThuocZip(() =>
      XLSX.read(bytes, { type: "array", sheets: 0, cellFormula: false, cellHTML: false }),
    );
  } catch {
    throw new LoiDoc(`File ${tenFile} không đọc được như .xlsx`);
  }
  const tenSheet = wb.SheetNames[0];
  const ws = tenSheet ? wb.Sheets[tenSheet] : undefined;
  if (!ws || !ws["!ref"]) throw new LoiDoc(`File ${tenFile} không có dữ liệu ở sheet đầu`);
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  const vung = XLSX.utils.decode_range(ws["!ref"]);
  const o = (r: number, c: number): XLSX.CellObject | undefined =>
    ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;

  // Header: dòng đầu của vùng. Trùng tên ⇒ lấy cột đầu tiên.
  const viTri = new Map<string, number>();
  for (let c = vung.s.c; c <= vung.e.c; c++) {
    const ten = chuanHeader(vanBan(o(vung.s.r, c)));
    if (ten && !viTri.has(ten)) viTri.set(ten, c);
  }
  const cotThieu = COT_BAT_BUOC.filter((h) => !viTri.has(chuanHeader(h)));
  if (cotThieu.length > 0) {
    throw new LoiDoc(`File ${tenFile} thiếu ${cotThieu.length} cột: ${cotThieu.join(", ")}`, [...cotThieu]);
  }
  const cot = new Map<keyof DongPos, number>(
    COT_VAO.map(([h, k]) => [k, viTri.get(chuanHeader(h))!]),
  );
  const ocua = (r: number, k: keyof DongPos) => o(r, cot.get(k)!);
  const txt = (r: number, k: keyof DongPos) => vanBan(ocua(r, k));
  const txtNull = (r: number, k: keyof DongPos) => {
    const v = txt(r, k);
    return v === "" ? null : v;
  };

  // Chỉ lặp trên các dòng THẬT CÓ Ô. KHÔNG tin `!ref`: file từng mở ra định dạng / xoá nội
  // dung rồi lưu lại mang dimension `A1:BM1048576` dù chỉ 1 dòng dữ liệu — quét từng dòng × 65
  // cột khi đó khoá luồng chính của trình duyệt hàng chục giây (ca `[POS-13]`).
  const dongCoO = new Set<number>();
  for (const k of Object.keys(ws)) {
    if (k.startsWith("!")) continue;
    const r = XLSX.utils.decode_cell(k).r;
    if (r > vung.s.r && r <= vung.e.r) dongCoO.add(r);
  }
  const dongCanDoc = [...dongCoO].sort((a, b) => a - b);

  const ra: ONam[] = [];
  for (const r of dongCanDoc) {
    let trong = true;
    for (let c = vung.s.c; c <= vung.e.c && trong; c++) if (vanBan(o(r, c)) !== "") trong = false;
    if (trong) continue;

    const soDong = r + 1; // số dòng như Excel hiển thị
    const noi = `File ${tenFile}, dòng ${soDong}`;
    if (ra.length >= conLaiDong) throw new LoiDoc(`Vượt ${TRAN_SO_DONG.toLocaleString("vi-VN")} dòng — tách file nhỏ hơn`);

    const thoiGian = thoiGianIso(ocua(r, "thoiGian"), date1904);
    if (thoiGian === null) {
      throw new LoiDoc(`${noi}: "Thời gian giao dịch" không đọc được ("${txt(r, "thoiGian")}")`);
    }
    const soTien = soNguyen(ocua(r, "soTien"));
    if (soTien === null || soTien === "LOI") {
      throw new LoiDoc(`${noi}: "Số tiền thanh toán" không phải số nguyên ("${txt(r, "soTien")}")`);
    }
    const phi = soNguyen(ocua(r, "phiGiaoDich"));
    if (phi === "LOI") {
      throw new LoiDoc(`${noi}: "Phí giao dịch" không phải số nguyên ("${txt(r, "phiGiaoDich")}")`);
    }
    const soThe = txtNull(r, "soTheMasked");

    const tho: DongPos = {
      maGiaoDich: txt(r, "maGiaoDich"),
      loaiGiaoDich: txt(r, "loaiGiaoDich"),
      hinhThuc: txt(r, "hinhThuc"),
      trangThai: txt(r, "trangThai"),
      soTien,
      thoiGian,
      dienGiai: txt(r, "dienGiai"),
      maChuanChi: txtNull(r, "maChuanChi"),
      maGiaoDichThe: txtNull(r, "maGiaoDichThe"),
      maGiaoDichGoc: txtNull(r, "maGiaoDichGoc"),
      trangThaiHoanHuy: txtNull(r, "trangThaiHoanHuy"),
      maDonHang: txtNull(r, "maDonHang"),
      maQuay: txtNull(r, "maQuay"),
      maThietBi: txtNull(r, "maThietBi"),
      soTheMasked: soThe === null ? null : cheSoThe(soThe),
      loaiThe: txtNull(r, "loaiThe"),
      maHachToan: txtNull(r, "maHachToan"),
      phiGiaoDich: phi,
    };
    // CÙNG hợp đồng với lối vào server (GĐ3, `[POS3-W4]`): file nào màn nhận thì action cũng nhận —
    // một ô quá dài bị chặn NGAY ở đây kèm tên cột + số dòng, không đợi server trả lỗi giữa lượt.
    const kt = dongPosNhapSchema.safeParse(tho);
    if (!kt.success) {
      const issue = kt.error.issues[0];
      const khoa = issue?.path[0];
      const ten = typeof khoa === "string" ? (HEADER_CUA_KHOA.get(khoa) ?? khoa) : "?";
      throw new LoiDoc(`${noi}: "${ten}" không hợp lệ (${issue?.message ?? "sai dạng"})`);
    }
    ra.push({ dong: kt.data, soDong });
  }
  return ra;
}

// ─── Điểm vào ─────────────────────────────────────────────────────────────────

function laRac(ten: string): boolean {
  const phan = ten.split("/");
  if (phan.includes("__MACOSX")) return true;
  const base = phan[phan.length - 1] ?? "";
  return base.startsWith("~$") || base.startsWith("._");
}

async function tachZip(bytes: Uint8Array): Promise<{ ten: string; bytes: Uint8Array }[]> {
  const JSZipCtor = await napJsZip();
  let zip: JSZip;
  try {
    zip = await JSZipCtor.loadAsync(bytes);
  } catch {
    throw new LoiDoc("File .zip hỏng hoặc không phải zip");
  }
  const muc = Object.values(zip.files)
    .filter((f) => !f.dir && f.name.toLowerCase().endsWith(".xlsx") && !laRac(f.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (muc.length === 0) throw new LoiDoc("File zip không có file .xlsx nào");
  if (muc.length > TRAN_SO_FILE) {
    throw new LoiDoc(`Zip có ${muc.length} file .xlsx — tối đa ${TRAN_SO_FILE} file`);
  }
  let tong = 0;
  const ra: { ten: string; bytes: Uint8Array }[] = [];
  for (const f of muc) {
    const u = await giaiNenCoTran(f, TRAN_GIAI_NEN - tong);
    if (u === "VUOT") throw new LoiDoc(`Tổng dung lượng giải nén vượt ${TRAN_GIAI_NEN / MB}MB`);
    tong += u.byteLength;
    ra.push({ ten: f.name, bytes: u });
  }
  return ra;
}

export async function docFilePos(buf: ArrayBuffer | Uint8Array, tenFile: string): Promise<KetQuaDocFile> {
  try {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const duoi = tenFile.toLowerCase();
    const laZip = duoi.endsWith(".zip");
    if (!laZip && !duoi.endsWith(".xlsx")) throw new LoiDoc("Chỉ nhận file .zip hoặc .xlsx");
    if (bytes.byteLength > TRAN_FILE) throw new LoiDoc(`File vượt ${TRAN_FILE / MB}MB`);

    const files = laZip ? await tachZip(bytes) : [{ ten: tenFile, bytes }];

    const theoMa = new Map<string, DongPos>();
    let daDoc = 0;
    let noXlsx = 0;
    for (const f of files) {
      const n = await doGiaiNenXlsx(f.bytes, TRAN_GIAI_NEN_XLSX - noXlsx);
      if (n === "VUOT") {
        throw new LoiDoc(`Nội dung .xlsx giải nén vượt ${TRAN_GIAI_NEN_XLSX / MB}MB`);
      }
      noXlsx += n;
      const dong = docMotXlsx(f.bytes, f.ten, TRAN_SO_DONG - daDoc);
      daDoc += dong.length;
      for (const { dong: d } of dong) {
        // Trùng mã giữa các file ⇒ giữ dòng xuất hiện SAU (xoá rồi đặt lại để giữ thứ tự mới).
        theoMa.delete(d.maGiaoDich);
        theoMa.set(d.maGiaoDich, d);
      }
    }
    return { ok: true, dong: [...theoMa.values()], soFileXlsx: files.length };
  } catch (e) {
    if (e instanceof LoiDoc) return { ok: false, loi: e.message, cotThieu: e.cotThieu };
    return { ok: false, loi: "Không đọc được file", cotThieu: [] };
  }
}
