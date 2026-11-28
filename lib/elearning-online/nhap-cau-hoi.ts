// QoImport (V9.4 P2) — nhập câu hỏi từ Excel cho khoá ONLINE. Phần THUẦN: đọc bảng (mảng dòng × ô) → kiểm từng dòng → danh sách câu hợp lệ + lỗi theo dòng.
//
// Đủ 13 dạng (V10.0 Q5): 5 dạng gốc ở file này + 8 dạng mở rộng (điền chỗ trống · ghép cặp · sắp xếp · phân loại · chọn trên hình · nhập số · nộp sản phẩm · khối lệnh)
// ở `nhap-cau-hoi-mo-rong.ts`. Mỗi dạng một sheet; sheet lạ vẫn bị báo "bỏ qua", KHÔNG nhập lén sang dạng khác.
// Luật kiểm từng câu nằm ở MỘT chỗ (`kiemCauHoi` trong cham-diem.ts) — đường lưu thật `luuCauHoi` cũng gọi đúng hàm đó, nên "hợp lệ ở bản xem trước" = "lưu được".
import { kiemCauHoi, type CauHoiInput } from "./cham-diem";
import { MAU_MO_RONG, kiemDongMoRong, type LoaiNhapMoRong } from "./nhap-cau-hoi-mo-rong";

export const TOI_DA_DONG = 500;
export const TOI_DA_BYTE = 700_000; // dưới trần thân Server Action mặc định (1 MB) sau khi mã hoá base64
export const CHU_LUA_CHON = ["A", "B", "C", "D", "E", "F"] as const;

type LoaiNhapGoc = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_TEXT" | "ESSAY";
export type LoaiNhap = LoaiNhapGoc | LoaiNhapMoRong;
export type CauNhap = Omit<CauHoiInput, "courseId" | "id">;

type MauLoai = { loai: LoaiNhap; sheet: string; tepMau: string; cotBatBuoc: string; cot: string[]; viDu: string[] };
const MAU_GOC: (MauLoai & { loai: LoaiNhapGoc })[] = [
  { loai: "SINGLE_CHOICE", sheet: "Chọn một đáp án", tepMau: "mau-chon-mot.xlsx", cotBatBuoc: "Đề bài · A–F · Đáp án đúng (1 chữ)", cot: ["Đề bài", ...CHU_LUA_CHON, "Đáp án đúng", "Điểm", "Giải thích"], viDu: ["Thuật toán bám tường trái chọn hướng nào?", "Rẽ trái", "Rẽ phải", "Đi thẳng", "", "", "", "A", "1", ""] },
  { loai: "MULTIPLE_CHOICE", sheet: "Chọn nhiều đáp án", tepMau: "mau-chon-nhieu.xlsx", cotBatBuoc: "Đề bài · A–F · Đáp án đúng (A;C)", cot: ["Đề bài", ...CHU_LUA_CHON, "Đáp án đúng", "Điểm", "Giải thích"], viDu: ["Cảm biến nào đo khoảng cách?", "Siêu âm", "Hồng ngoại", "Chạm", "Màu", "", "", "A;B", "2", ""] },
  { loai: "TRUE_FALSE", sheet: "Đúng sai", tepMau: "mau-dung-sai.xlsx", cotBatBuoc: "Đề bài · Đáp án (Đúng/Sai)", cot: ["Đề bài", "Đáp án", "Điểm", "Giải thích"], viDu: ["Robot rẽ khi cách tường 5 cm", "Đúng", "1", ""] },
  { loai: "SHORT_TEXT", sheet: "Trả lời ngắn", tepMau: "mau-tra-loi-ngan.xlsx", cotBatBuoc: "Đề bài · Đáp án chấp nhận (a|b)", cot: ["Đề bài", "Đáp án chấp nhận", "Điểm", "Giải thích"], viDu: ["Tên cảm biến đo khoảng cách bằng sóng âm?", "siêu âm|ultrasonic", "1", ""] },
  { loai: "ESSAY", sheet: "Tự luận", tepMau: "mau-tu-luan.xlsx", cotBatBuoc: "Đề bài", cot: ["Đề bài", "Điểm", "Giải thích"], viDu: ["Mô tả cách robot né vật cản.", "5", ""] },
];

/** Đủ 13 dạng: 5 gốc + 8 mở rộng. Mỗi dạng một sheet trong bộ mẫu. */
export const MAU_THEO_LOAI: MauLoai[] = [...MAU_GOC, ...MAU_MO_RONG];

/** Cột BẮT BUỘC có mặt ở dòng tiêu đề (Điểm/Giải thích tuỳ chọn). Thiếu ⇒ một lỗi cho CẢ sheet, nói rõ cột nào. */
const COT_BAT_BUOC: Record<LoaiNhap, readonly string[]> = {
  SINGLE_CHOICE: ["Đề bài", "A", "B", "Đáp án đúng"],
  MULTIPLE_CHOICE: ["Đề bài", "A", "B", "Đáp án đúng"],
  TRUE_FALSE: ["Đề bài", "Đáp án"],
  SHORT_TEXT: ["Đề bài", "Đáp án chấp nhận"],
  ESSAY: ["Đề bài"],
  ...(Object.fromEntries(MAU_MO_RONG.map((m) => [m.loai, m.batBuoc])) as Record<LoaiNhapMoRong, readonly string[]>),
};

const LA_MO_RONG = new Set<string>(MAU_MO_RONG.map((m) => m.loai));

const chuanTen = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
const o = (s: unknown) => (s == null ? "" : String(s)).trim();

export type DongKiem = {
  sheet: string;
  /** Số dòng trong tệp (dòng 1 là tiêu đề) */
  dong: number;
  loai: LoaiNhap;
  deBai: string;
  cau?: CauNhap;
  loi?: string;
};
export type KetQuaKiemNhap = {
  tongDong: number;
  hopLe: number;
  loi: number;
  chiTiet: DongKiem[];
  sheetDaDoc: string[];
  sheetBoQua: string[];
  /** Sheet đúng dạng nhưng không có dòng dữ liệu nào (chỉ tiêu đề / để trống) */
  sheetRong: string[];
  /** Có trước khi kiểm từng dòng: tệp vượt trần ⇒ KHÔNG kiểm dòng nào */
  loiChung: string | null;
};

function chiSoCot(tieuDe: string[], ten: string): number {
  const n = chuanTen(ten);
  return tieuDe.findIndex((t) => chuanTen(o(t)) === n);
}

function diem(v: string): { ok: true; v: number } | { ok: false } {
  if (v === "") return { ok: true, v: 1 };
  if (!/^\d+$/.test(v)) return { ok: false };
  const n = Number(v);
  return n >= 1 && n <= 1000 ? { ok: true, v: n } : { ok: false };
}

function kiemMotDong(m: MauLoai, tieuDe: string[], row: string[]): { cau?: CauNhap; loi?: string } {
  const lay = (ten: string) => {
    const i = chiSoCot(tieuDe, ten);
    return i < 0 ? "" : o(row[i]);
  };
  if (LA_MO_RONG.has(m.loai)) return kiemDongMoRong(m.loai as LoaiNhapMoRong, lay);
  const deBai = lay("Đề bài");
  if (!deBai) return { loi: "Thiếu Đề bài" };
  const d = diem(lay("Điểm"));
  if (!d.ok) return { loi: "Điểm phải là số nguyên từ 1 đến 1000" };
  const giaiThich = lay("Giải thích") || null;
  const chung = { type: m.loai, stem: deBai, points: d.v, explanation: giaiThich } as const;

  if (m.loai === "SINGLE_CHOICE" || m.loai === "MULTIPLE_CHOICE") {
    const options: { id: string; text: string }[] = [];
    for (const c of CHU_LUA_CHON) {
      const t = lay(c);
      if (t) options.push({ id: c, text: t });
    }
    const dapAn = lay("Đáp án đúng").toUpperCase().replace(/\s+/g, "");
    if (!dapAn) return { loi: "Thiếu Đáp án đúng" };
    const cau: CauNhap = m.loai === "SINGLE_CHOICE" ? { ...chung, options, correct: dapAn } : { ...chung, options, correct: dapAn.split(/[;,]/).filter(Boolean) };
    if (m.loai === "SINGLE_CHOICE" && !/^[A-F]$/.test(dapAn)) return { loi: "Đáp án đúng phải là MỘT chữ A–F" };
    if (m.loai === "MULTIPLE_CHOICE" && !(cau.correct as string[]).every((c) => /^[A-F]$/.test(c))) return { loi: "Đáp án đúng chỉ gồm các chữ A–F, cách nhau bằng dấu ;" };
    const k = kiemCauHoi({ type: m.loai, options, correct: cau.correct, accepted: undefined });
    return k.ok ? { cau } : { loi: k.thongBao };
  }
  if (m.loai === "TRUE_FALSE") {
    const v = chuanTen(lay("Đáp án"));
    if (!v) return { loi: "Thiếu Đáp án" };
    const dung = ["đúng", "dung", "true", "đ"].includes(v);
    const sai = ["sai", "false", "s"].includes(v);
    if (!dung && !sai) return { loi: "Đáp án phải là Đúng hoặc Sai" };
    return { cau: { ...chung, correct: dung } };
  }
  if (m.loai === "SHORT_TEXT") {
    const accepted = lay("Đáp án chấp nhận").split("|").map((x) => x.trim()).filter(Boolean);
    if (accepted.length === 0) return { loi: "Thiếu Đáp án chấp nhận" };
    if (accepted.length > 20) return { loi: "Tối đa 20 đáp án chấp nhận" };
    const k = kiemCauHoi({ type: m.loai, accepted });
    return k.ok ? { cau: { ...chung, accepted } } : { loi: k.thongBao };
  }
  return { cau: { ...chung } }; // ESSAY
}

const dongRong = (r: string[]) => r.every((c) => o(c) === "");

/**
 * Kiểm toàn bộ bảng tính. `sheets`: tên sheet → các dòng (mỗi dòng là mảng ô dạng chuỗi), dòng đầu là tiêu đề.
 * Không bao giờ ném: mọi lỗi nằm trong kết quả.
 */
export function kiemBangTinh(sheets: Record<string, string[][]>): KetQuaKiemNhap {
  const ketQua: KetQuaKiemNhap = { tongDong: 0, hopLe: 0, loi: 0, chiTiet: [], sheetDaDoc: [], sheetBoQua: [], sheetRong: [], loiChung: null };
  const mauTheoTen = new Map(MAU_THEO_LOAI.map((m) => [chuanTen(m.sheet), m]));
  let soDongCoDuLieu = 0;
  for (const [ten, dong] of Object.entries(sheets)) {
    const m = mauTheoTen.get(chuanTen(ten));
    if (!m) {
      ketQua.sheetBoQua.push(ten); // HUONG-DAN và sheet lạ
      continue;
    }
    soDongCoDuLieu += dong.slice(1).filter((r) => !dongRong(r)).length;
  }
  if (soDongCoDuLieu > TOI_DA_DONG) {
    ketQua.loiChung = `Tệp có ${soDongCoDuLieu} câu — tối đa ${TOI_DA_DONG} câu mỗi lần. Chia nhỏ tệp rồi nhập lại.`;
    return ketQua;
  }
  for (const [ten, dong] of Object.entries(sheets)) {
    const m = mauTheoTen.get(chuanTen(ten));
    if (!m) continue;
    ketQua.sheetDaDoc.push(ten);
    const tieuDe = (dong[0] ?? []).map(o);
    const thieu = COT_BAT_BUOC[m.loai].filter((c) => chiSoCot(tieuDe, c) < 0);
    if (thieu.length > 0) {
      ketQua.chiTiet.push({ sheet: ten, dong: 1, loai: m.loai, deBai: "", loi: `Sheet "${ten}" thiếu cột ${thieu.join(", ")} — tải mẫu mới` });
      ketQua.tongDong += 1;
      ketQua.loi += 1;
      continue;
    }
    if (dong.slice(1).every(dongRong)) ketQua.sheetRong.push(ten);
    dong.slice(1).forEach((row, i) => {
      if (dongRong(row)) return;
      const r = kiemMotDong(m, tieuDe, row);
      const deBai = o(row[chiSoCot(tieuDe, "Đề bài")]);
      ketQua.tongDong += 1;
      if (r.cau) {
        ketQua.hopLe += 1;
        ketQua.chiTiet.push({ sheet: ten, dong: i + 2, loai: m.loai, deBai, cau: r.cau });
      } else {
        ketQua.loi += 1;
        ketQua.chiTiet.push({ sheet: ten, dong: i + 2, loai: m.loai, deBai, loi: r.loi });
      }
    });
  }
  return ketQua;
}

/** Nhãn tiếng Việt của dạng (dùng ở bảng kết quả). */
export const NHAN_LOAI_NHAP: Record<LoaiNhap, string> = {
  SINGLE_CHOICE: "Chọn một đáp án",
  MULTIPLE_CHOICE: "Chọn nhiều đáp án",
  TRUE_FALSE: "Đúng / sai",
  SHORT_TEXT: "Trả lời ngắn",
  ESSAY: "Tự luận",
  FILL_BLANK: "Điền vào chỗ trống",
  MATCHING: "Ghép cặp",
  ORDERING: "Sắp xếp thứ tự",
  CLASSIFY: "Phân loại",
  IMAGE_HOTSPOT: "Chọn trên hình",
  NUMERIC: "Nhập số",
  PRODUCT: "Nộp sản phẩm",
  BLOCK_SEQUENCE: "Kéo thả khối lệnh",
};

/** Chuẩn hoá đề bài để so trùng: NFC, chữ thường, gộp khoảng trắng, bỏ dấu câu hai đầu (KHÔNG bỏ dấu tiếng Việt — dấu đổi nghĩa). */
export function khoaTrungCuaDeBai(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim().replace(/^[\s.,;:!?"'“”‘’()-]+|[\s.,;:!?"'“”‘’()-]+$/g, "");
}

/**
 * Đánh dấu CÂU TRÙNG trên kết quả đã kiểm: (a) trùng với một dòng HỢP LỆ đứng trước trong cùng tệp (cùng dạng + cùng đề bài chuẩn hoá);
 * (b) trùng đề bài với câu ĐANG CÓ trong ngân hàng của khoá (`stemDaCo` là đề bài thô, đã lọc đúng khoá + chưa lưu trữ).
 * Dòng bị đánh dấu thành LỖI (không nhập) — nhập trùng im lặng làm ngân hàng phình và đề bốc trùng câu. Hàm thuần, trả kết quả MỚI.
 */
export function danhDauCauTrung(kq: KetQuaKiemNhap, stemDaCo: readonly string[]): KetQuaKiemNhap {
  const daCo = new Set(stemDaCo.map(khoaTrungCuaDeBai));
  const thay = new Map<string, number>();
  let loi = 0;
  let hopLe = 0;
  const chiTiet = kq.chiTiet.map((d) => {
    if (!d.cau) {
      loi += 1;
      return d;
    }
    const k = `${d.loai}|${khoaTrungCuaDeBai(d.cau.stem)}`;
    if (daCo.has(khoaTrungCuaDeBai(d.cau.stem))) {
      loi += 1;
      return { sheet: d.sheet, dong: d.dong, loai: d.loai, deBai: d.deBai, loi: "Câu đã có trong ngân hàng câu hỏi của khoá" };
    }
    const truoc = thay.get(k);
    if (truoc !== undefined) {
      loi += 1;
      return { sheet: d.sheet, dong: d.dong, loai: d.loai, deBai: d.deBai, loi: `Trùng với dòng ${truoc} trong tệp` };
    }
    thay.set(k, d.dong);
    hopLe += 1;
    return d;
  });
  return { ...kq, chiTiet, hopLe, loi };
}
