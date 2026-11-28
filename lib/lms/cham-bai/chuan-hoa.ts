import { z } from "zod";

/**
 * ENGINE CÂU HỎI — 13 DẠNG (thiết kế HL-Q-* được duyệt) — BƯỚC 1: CHUẨN HOÁ + KIỂM `meta`.
 *
 * Một nguồn duy nhất cho: dạng của câu, đáp án chuẩn (CHỈ ở máy chủ), và việc "câu này có hợp lệ để phát hành không".
 * `chuanHoaCau` KHÔNG ném: trả `{ok:false, loi}` để cổng xuất bản / bắt đầu lượt thi liệt kê CÂU LỖI thay vì chấm 0 âm thầm.
 * Thuần (không DB, không IO). Đầu vào là hàng `Question` + `Choice` thô (cũng là hình dạng ảnh chụp đề lưu trong `ExamAttempt.contentSnapshot`).
 */

/** Mã dạng phía API (khớp `MA_DANG_CAU_HOI` của hợp đồng app). */
export const MA_DANG = [
  "chon_mot",
  "chon_nhieu",
  "dung_sai",
  "ngan",
  "tu_luan",
  "dien_khuyet",
  "ghep_cap",
  "sap_xep",
  "nop_san_pham",
  "phan_loai",
  "chon_tren_hinh",
  "nhap_so",
  "sap_khoi_lenh",
] as const;
export type MaDang = (typeof MA_DANG)[number];

/** Dạng CHẤM TAY (giáo viên). Còn lại là chấm máy. */
export const DANG_CHAM_TAY: ReadonlySet<MaDang> = new Set<MaDang>(["tu_luan", "nop_san_pham"]);

export type LuaChonGoc = { id: string; order: number; text: string; isCorrect: boolean; imageUrl?: string | null };
export type CauHoiGoc = {
  id: string;
  /** `Question.type` (chuỗi để engine không phụ thuộc bản Prisma Client đã sinh). */
  type: string;
  text: string;
  imageUrl?: string | null;
  correctAnswer?: string | null;
  meta?: unknown;
  choices: readonly LuaChonGoc[];
  /** Điểm của câu TRONG ĐỀ (`ExamQuestion.points`). */
  points: number;
};

// ── đáp án chuẩn đã chuẩn hoá (CHỈ ở máy chủ) ──
export type VungHinh =
  | { loai: "tron"; x: number; y: number; r: number }
  | { loai: "chu_nhat"; x: number; y: number; rong: number; cao: number }
  | { loai: "da_giac"; diem: readonly (readonly [number, number])[] };
export type HanhDongKhoi = { kieu: "di" } | { kieu: "phai" } | { kieu: "trai" } | { kieu: "dung" } | { kieu: "lap"; so: number };
export type Huong = "B" | "D" | "N" | "T";

export type CauChuanHoa =
  | { dang: "chon_mot" | "chon_nhieu" | "dung_sai"; goc: CauHoiGoc; luaChon: readonly LuaChonGoc[]; dungIds: readonly string[] }
  | { dang: "ngan"; goc: CauHoiGoc; dapAn: string }
  | { dang: "tu_luan"; goc: CauHoiGoc }
  | { dang: "dien_khuyet"; goc: CauHoiGoc; manh: readonly string[]; chapNhan: readonly (readonly string[])[] }
  | { dang: "ghep_cap"; goc: CauHoiGoc; trai: readonly string[]; phai: readonly string[] }
  | { dang: "sap_xep"; goc: CauHoiGoc; muc: readonly string[] }
  | { dang: "nop_san_pham"; goc: CauHoiGoc }
  | { dang: "phan_loai"; goc: CauHoiGoc; nhom: readonly { id: string; ten: string }[]; the: readonly { id: string; noiDung: string; nhomId: string }[] }
  | { dang: "chon_tren_hinh"; goc: CauHoiGoc; hinh: { url: string; rong: number; cao: number }; vung: readonly VungHinh[]; soDiemToiDa: number }
  | { dang: "nhap_so"; goc: CauHoiGoc; giaTri: string; /** null = giáo viên không đặt sai số ⇒ chính sách chấm quyết mặc định (chưa được Owner duyệt) */ saiSo: string | null; donVi: string | null; choPhepThapPhan: boolean }
  | {
      dang: "sap_khoi_lenh";
      goc: CauHoiGoc;
      hopKhoi: readonly { id: string; nhan: string; loai: "don" | "lap"; hanhDong: HanhDongKhoi }[];
      soKhoiToiDa: number;
      banDo: { hang: number; cot: number; tuong: readonly (readonly [number, number])[]; dich: readonly [number, number]; batDau: readonly [number, number]; huong: Huong };
    };

export type KetQuaChuanHoa = { ok: true; cau: CauChuanHoa } | { ok: false; loi: string; dang: MaDang | null };

// ── tiện ích chuỗi/số ──
/** Chuẩn hoá để SO: Unicode NFC + gộp khoảng trắng + hạ chữ. */
export const chuanChu = (s: string): string => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

const MU = BigInt(1000000);
/** Chuỗi thập phân → số nguyên vi mô (×10⁶). Không dùng float. `null` nếu không hợp lệ. */
export function sangViMo(s: string): bigint | null {
  const m = /^(-?)(\d{1,12})(?:\.(\d{1,6}))?$/.exec(s.trim());
  if (!m) return null;
  const v = BigInt(m[2]!) * MU + BigInt((m[3] ?? "").padEnd(6, "0") || "0");
  return m[1] ? -v : v;
}

const chuoiKhongRong = z.string().trim().min(1).max(1000);
const so01 = z.number().min(0).max(1);
const toaDo = z.tuple([so01, so01]);

const metaDienKhuyet = z.object({ answers: z.array(z.union([chuoiKhongRong, z.array(chuoiKhongRong).min(1).max(10)])).min(1).max(10) });
const metaGhepCap = z.object({ pairs: z.array(z.object({ left: chuoiKhongRong, right: chuoiKhongRong })).min(2).max(10) });
const metaSapXep = z.object({ items: z.array(chuoiKhongRong).min(2).max(12) });
const metaPhanLoai = z.object({
  groups: z.array(z.object({ id: z.string().min(1).max(40), name: chuoiKhongRong })).min(2).max(6),
  cards: z.array(z.object({ id: z.string().min(1).max(40), text: chuoiKhongRong, group: z.string().min(1).max(40) })).min(2).max(16),
});
const metaChonTrenHinh = z.object({
  image: z.object({ url: z.string().min(1).max(2000), w: z.number().int().min(1).max(20000), h: z.number().int().min(1).max(20000) }),
  regions: z
    .array(
      z.union([
        z.object({ shape: z.literal("circle"), x: so01, y: so01, r: z.number().gt(0).max(1) }),
        z.object({ shape: z.literal("rect"), x: so01, y: so01, w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) }),
        z.object({ shape: z.literal("polygon"), points: z.array(toaDo).min(3).max(40) }),
      ]),
    )
    .min(1)
    .max(5),
  maxPoints: z.number().int().min(1).max(5).optional(),
});
const metaNhapSo = z.object({
  value: z.string().regex(/^-?\d{1,12}(\.\d{1,6})?$/),
  tolerance: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).optional(),
  unit: z.string().trim().max(20).optional(),
  allowDecimal: z.boolean().optional(),
});
const toaDoLuoi = z.tuple([z.number().int().min(0).max(11), z.number().int().min(0).max(11)]);
const metaKhoiLenh = z.object({
  palette: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({ id: z.string().min(1).max(40), label: chuoiKhongRong, kind: z.literal("move") }),
        z.object({ id: z.string().min(1).max(40), label: chuoiKhongRong, kind: z.literal("turnL") }),
        z.object({ id: z.string().min(1).max(40), label: chuoiKhongRong, kind: z.literal("turnR") }),
        z.object({ id: z.string().min(1).max(40), label: chuoiKhongRong, kind: z.literal("stop") }),
        z.object({ id: z.string().min(1).max(40), label: chuoiKhongRong, kind: z.literal("repeat"), times: z.number().int().min(2).max(10) }),
      ]),
    )
    .min(1)
    .max(12),
  grid: z.object({ rows: z.number().int().min(2).max(12), cols: z.number().int().min(2).max(12), walls: z.array(toaDoLuoi).max(60), goal: toaDoLuoi, start: toaDoLuoi, dir: z.enum(["N", "E", "S", "W"]) }),
  maxBlocks: z.number().int().min(1).max(40).optional(),
  mode: z.literal("reach_goal").optional(),
});
const metaMc = z.object({ ui: z.enum(["single", "multiple"]).optional() }).passthrough();

const DAU_CHO_TRONG = /_{3,}/;
const HUONG_ANH_XA = { N: "B", E: "D", S: "N", W: "T" } as const;

const loi = (dang: MaDang | null, thongBao: string): KetQuaChuanHoa => ({ ok: false, loi: thongBao, dang });
const ghep = (e: z.ZodError) => e.issues.slice(0, 2).map((i) => `${i.path.join(".") || "meta"}: ${i.message}`).join("; ");

/**
 * Dạng của một câu + đáp án chuẩn đã kiểm. Câu LỖI (thiếu đáp án, meta sai hình…) ⇒ `{ok:false}` — KHÔNG bao giờ ngầm thành "chấm 0".
 * `CODE` không thuộc 13 dạng thiết kế ⇒ `{ok:false, dang:null}` (web vẫn chấm tay; ứng dụng không phục vụ).
 */
export function chuanHoaCau(q: CauHoiGoc): KetQuaChuanHoa {
  switch (q.type) {
    case "MULTIPLE_CHOICE":
    case "TRUE_FALSE": {
      const lc = [...q.choices].sort((a, b) => a.order - b.order);
      const dungIds = lc.filter((c) => c.isCorrect).map((c) => c.id);
      if (q.type === "TRUE_FALSE") {
        if (lc.length !== 2 || dungIds.length !== 1) return loi("dung_sai", "Câu đúng/sai phải có đúng 2 lựa chọn và 1 đáp án đúng.");
        return { ok: true, cau: { dang: "dung_sai", goc: q, luaChon: lc, dungIds } };
      }
      if (lc.length < 2 || lc.length > 10) return loi(null, "Câu trắc nghiệm cần 2–10 lựa chọn.");
      if (lc.some((c) => c.text.trim().length === 0 && !c.imageUrl)) return loi(null, "Có lựa chọn trống.");
      if (dungIds.length === 0) return loi(null, "Câu trắc nghiệm chưa đánh dấu đáp án đúng.");
      const m = metaMc.safeParse(q.meta ?? {});
      const ui = (m.success ? m.data.ui : undefined) ?? (dungIds.length > 1 ? "multiple" : "single");
      if (ui === "single" && dungIds.length !== 1) return loi("chon_mot", "Câu chọn một phải có đúng 1 đáp án đúng.");
      const dang: MaDang = ui === "multiple" ? "chon_nhieu" : "chon_mot";
      return { ok: true, cau: { dang, goc: q, luaChon: lc, dungIds } };
    }
    case "SHORT_ANSWER": {
      const dapAn = (q.correctAnswer ?? "").trim();
      if (dapAn.length === 0) return loi("ngan", "Câu trả lời ngắn chưa có đáp án.");
      return { ok: true, cau: { dang: "ngan", goc: q, dapAn } };
    }
    case "ESSAY":
      return { ok: true, cau: { dang: "tu_luan", goc: q } };
    case "VIDEO":
      return { ok: true, cau: { dang: "nop_san_pham", goc: q } };
    case "FILL_BLANK": {
      const m = metaDienKhuyet.safeParse(q.meta);
      if (!m.success) return loi("dien_khuyet", `Điền khuyết: ${ghep(m.error)}`);
      const manh = q.text.split(DAU_CHO_TRONG);
      if (manh.length - 1 !== m.data.answers.length) return loi("dien_khuyet", `Số chỗ trống trong đề (${manh.length - 1}) khác số đáp án (${m.data.answers.length}).`);
      const chapNhan = m.data.answers.map((a) => (Array.isArray(a) ? a : [a]));
      return { ok: true, cau: { dang: "dien_khuyet", goc: q, manh, chapNhan } };
    }
    case "MATCHING": {
      const m = metaGhepCap.safeParse(q.meta);
      if (!m.success) return loi("ghep_cap", `Ghép cặp: ${ghep(m.error)}`);
      return { ok: true, cau: { dang: "ghep_cap", goc: q, trai: m.data.pairs.map((p) => p.left), phai: m.data.pairs.map((p) => p.right) } };
    }
    case "ORDERING": {
      const m = metaSapXep.safeParse(q.meta);
      if (!m.success) return loi("sap_xep", `Sắp xếp: ${ghep(m.error)}`);
      return { ok: true, cau: { dang: "sap_xep", goc: q, muc: m.data.items } };
    }
    case "CLASSIFY": {
      const m = metaPhanLoai.safeParse(q.meta);
      if (!m.success) return loi("phan_loai", `Phân loại: ${ghep(m.error)}`);
      const nhomIds = new Set(m.data.groups.map((g) => g.id));
      if (nhomIds.size !== m.data.groups.length) return loi("phan_loai", "Phân loại: id nhóm bị trùng.");
      if (new Set(m.data.cards.map((c) => c.id)).size !== m.data.cards.length) return loi("phan_loai", "Phân loại: id thẻ bị trùng.");
      if (m.data.cards.some((c) => !nhomIds.has(c.group))) return loi("phan_loai", "Phân loại: có thẻ trỏ tới nhóm không tồn tại.");
      return { ok: true, cau: { dang: "phan_loai", goc: q, nhom: m.data.groups.map((g) => ({ id: g.id, ten: g.name })), the: m.data.cards.map((c) => ({ id: c.id, noiDung: c.text, nhomId: c.group })) } };
    }
    case "HOTSPOT": {
      const m = metaChonTrenHinh.safeParse(q.meta);
      if (!m.success) return loi("chon_tren_hinh", `Chọn trên hình: ${ghep(m.error)}`);
      const vung: VungHinh[] = m.data.regions.map((r) => (r.shape === "circle" ? { loai: "tron", x: r.x, y: r.y, r: r.r } : r.shape === "rect" ? { loai: "chu_nhat", x: r.x, y: r.y, rong: r.w, cao: r.h } : { loai: "da_giac", diem: r.points }));
      return { ok: true, cau: { dang: "chon_tren_hinh", goc: q, hinh: { url: m.data.image.url, rong: m.data.image.w, cao: m.data.image.h }, vung, soDiemToiDa: Math.max(m.data.maxPoints ?? 1, vung.length) } };
    }
    case "NUMERIC": {
      const m = metaNhapSo.safeParse(q.meta);
      if (!m.success) return loi("nhap_so", `Nhập số: ${ghep(m.error)}`);
      return { ok: true, cau: { dang: "nhap_so", goc: q, giaTri: m.data.value, saiSo: m.data.tolerance ?? null, donVi: m.data.unit?.trim() ? m.data.unit.trim() : null, choPhepThapPhan: m.data.allowDecimal ?? true } };
    }
    case "BLOCK_PROGRAM": {
      const m = metaKhoiLenh.safeParse(q.meta);
      if (!m.success) return loi("sap_khoi_lenh", `Sắp khối lệnh: ${ghep(m.error)}`);
      const g = m.data.grid;
      const trong = (p: readonly [number, number]) => p[0] < g.rows && p[1] < g.cols;
      if (!trong(g.goal) || !trong(g.start) || g.walls.some((w) => !trong(w))) return loi("sap_khoi_lenh", "Sắp khối lệnh: toạ độ ngoài bản đồ.");
      if (g.walls.some((w) => (w[0] === g.goal[0] && w[1] === g.goal[1]) || (w[0] === g.start[0] && w[1] === g.start[1]))) return loi("sap_khoi_lenh", "Sắp khối lệnh: tường đè lên ô bắt đầu/đích.");
      if (new Set(m.data.palette.map((p) => p.id)).size !== m.data.palette.length) return loi("sap_khoi_lenh", "Sắp khối lệnh: id khối bị trùng.");
      const hopKhoi = m.data.palette.map((p) => ({
        id: p.id,
        nhan: p.label,
        loai: p.kind === "repeat" ? ("lap" as const) : ("don" as const),
        hanhDong: (p.kind === "move" ? { kieu: "di" } : p.kind === "turnL" ? { kieu: "trai" } : p.kind === "turnR" ? { kieu: "phai" } : p.kind === "stop" ? { kieu: "dung" } : { kieu: "lap", so: p.times }) as HanhDongKhoi,
      }));
      return { ok: true, cau: { dang: "sap_khoi_lenh", goc: q, hopKhoi, soKhoiToiDa: m.data.maxBlocks ?? 20, banDo: { hang: g.rows, cot: g.cols, tuong: g.walls, dich: g.goal, batDau: g.start, huong: HUONG_ANH_XA[g.dir] } } };
    }
    default:
      return loi(null, `Dạng câu "${q.type}" không thuộc 13 dạng được hỗ trợ.`);
  }
}

/** Kiểm cả đề: danh sách câu LỖI (để cổng xuất bản chặn / ứng dụng từ chối bắt đầu). */
export function kiemDeThi(cau: readonly CauHoiGoc[]): { ok: boolean; loi: readonly { cauHoiId: string; thuTu: number; loi: string }[]; dang: ReadonlyMap<string, MaDang> } {
  const dsLoi: { cauHoiId: string; thuTu: number; loi: string }[] = [];
  const dang = new Map<string, MaDang>();
  cau.forEach((q, i) => {
    const r = chuanHoaCau(q);
    if (r.ok) dang.set(q.id, r.cau.dang);
    else dsLoi.push({ cauHoiId: q.id, thuTu: i + 1, loi: r.loi });
  });
  return { ok: dsLoi.length === 0, loi: dsLoi, dang };
}
