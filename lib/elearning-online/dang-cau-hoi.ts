import { z } from "zod";

/**
 * E-LEARNING ONLINE — 8 DẠNG CÂU HỎI MỞ RỘNG (V10.0, Q5): điền chỗ trống · ghép cặp · sắp xếp · phân loại · chọn trên hình · nhập số · nộp sản phẩm · khối lệnh.
 * HÀM THUẦN, không đọc/ghi DB, KHÔNG import từ `lib/elearning/*` (Nội bộ) — chỉ chung KHÁI NIỆM. Dữ liệu nằm trong JSON của `OnlQuestion` (`optionsJson` = cấu hình hiển thị, `answerKeyJson` = đáp án).
 *
 * Bất biến:
 * 1. Học viên KHÔNG BAO GIỜ nhận đáp án khi đang làm bài (`veCauMoRong`): không cặp đúng, không thứ tự đúng, không nhóm đúng, không vùng đúng, không số đúng, không lời giải khối lệnh.
 *    Thứ tự hiển thị của ghép cặp/sắp xếp/phân loại được xáo CỐ ĐỊNH theo mã câu và KHÔNG bao giờ trùng thứ tự đáp án.
 * 2. Câu "nộp sản phẩm" KHÔNG tự chấm — chỉ có điểm sau khi người chấm chấm tay (như tự luận).
 * 3. Khối lệnh được CHẤM BẰNG MÔ PHỎNG một ngôn ngữ nhỏ, có giới hạn bước — KHÔNG BAO GIỜ thực thi mã của học viên.
 * 4. Câu trả lời sai KIỂU = sai, không ném lỗi. Điểm một phần (ghép cặp/sắp xếp/phân loại/điền trống) làm tròn XUỐNG.
 */

export const LOAI_MO_RONG = ["FILL_BLANK", "MATCHING", "ORDERING", "CLASSIFY", "IMAGE_HOTSPOT", "NUMERIC", "PRODUCT", "BLOCK_SEQUENCE"] as const;
export type LoaiMoRong = (typeof LOAI_MO_RONG)[number];
export const laLoaiMoRong = (t: string): t is LoaiMoRong => (LOAI_MO_RONG as readonly string[]).includes(t);

/** Loại KHÔNG tự chấm được: đề có loại này chưa chấm tay ⇒ chưa kết luận đạt/không. */
export const laLoaiChamTay = (t: string) => t === "ESSAY" || t === "PRODUCT";

type Obj = Record<string, unknown>;
const laObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const txt = (max = 1000) => z.string().trim().min(1, "Nội dung không được trống").max(max);

// ───────── Xáo cố định (không lộ đáp án qua thứ tự) ─────────

function bam(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Xáo cố định theo hạt giống; nếu kết quả TRÙNG thứ tự gốc (ví dụ ngẫu nhiên đúng đáp án) thì xoay một bước — luôn khác thứ tự gốc khi có ≥ 2 phần tử khác nhau. */
export function xaoCoDinh<T extends { id: string }>(ds: readonly T[], hat: string): T[] {
  const a = [...ds].sort((x, y) => bam(hat + "|" + x.id) - bam(hat + "|" + y.id) || x.id.localeCompare(y.id));
  if (a.length > 1 && a.every((x, i) => x.id === ds[i]!.id)) a.push(a.shift()!);
  return a;
}

// ───────── Mô phỏng khối lệnh ─────────

export const KHOI_LENH = ["fwd", "right", "left", "repeat", "ifwall", "stop"] as const;
export type KhoiLenhId = (typeof KHOI_LENH)[number];
export type Nut = { b: KhoiLenhId; n?: number; body?: Nut[] };
export type Huong = "N" | "E" | "S" | "W";
const HUONG: Huong[] = ["N", "E", "S", "W"];
const DX: Record<Huong, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export type SaBan = { cols: number; rows: number; start: { c: number; r: number; dir: Huong }; goal: { c: number; r: number }; walls: { c: number; r: number }[]; blocks: KhoiLenhId[]; maxBlocks: number };

const o = (n: number) => z.number().int().min(0).max(n);
const saBanSchema = z
  .object({
    cols: z.number().int().min(2).max(12),
    rows: z.number().int().min(2).max(12),
    start: z.object({ c: o(11), r: o(11), dir: z.enum(["N", "E", "S", "W"]) }).strict(),
    goal: z.object({ c: o(11), r: o(11) }).strict(),
    walls: z.array(z.object({ c: o(11), r: o(11) }).strict()).max(100),
    blocks: z.array(z.enum(KHOI_LENH)).min(1).max(KHOI_LENH.length),
    maxBlocks: z.number().int().min(1).max(60),
  })
  .strict();

export const GIOI_HAN_BUOC = 500;

/** Số nút (kể cả lồng nhau). */
export function demNut(p: readonly Nut[]): number {
  return p.reduce((s, x) => s + 1 + (x.body ? demNut(x.body) : 0), 0);
}

const nutSchema: z.ZodType<Nut> = z.lazy(() =>
  z.object({ b: z.enum(KHOI_LENH), n: z.number().int().min(2).max(9).optional(), body: z.array(nutSchema).max(60).optional() }).strict(),
);
export const chuongTrinhSchema = z.array(nutSchema).max(60);

/** Chạy chương trình trên sa bàn: đụng tường/ra ngoài ⇒ đứng yên. `dung` ⇔ kết thúc (hết chương trình hoặc gặp "dừng") TẠI ĐÍCH. Có trần số bước — vòng lặp lồng nhau không treo được. */
export function moPhongKhoiLenh(sb: SaBan, chuongTrinh: readonly Nut[]): { dung: boolean; c: number; r: number; hetBuoc: boolean; soBuoc: number } {
  let c = sb.start.c, r = sb.start.r, h = HUONG.indexOf(sb.start.dir), buoc = 0;
  const tuong = new Set(sb.walls.map((w) => w.c + "," + w.r));
  const gapTuong = () => {
    const [dx, dy] = DX[HUONG[h]!];
    const nc = c + dx, nr = r + dy;
    return nc < 0 || nr < 0 || nc >= sb.cols || nr >= sb.rows || tuong.has(nc + "," + nr);
  };
  const chay = (ds: readonly Nut[]): boolean => {
    for (const x of ds) {
      if (++buoc > GIOI_HAN_BUOC) return false;
      if (x.b === "stop") return true;
      if (x.b === "fwd") { if (!gapTuong()) { const [dx, dy] = DX[HUONG[h]!]; c += dx; r += dy; } }
      else if (x.b === "right") h = (h + 1) % 4;
      else if (x.b === "left") h = (h + 3) % 4;
      else if (x.b === "repeat") { for (let i = 0; i < (x.n ?? 2); i++) { if (chay(x.body ?? [])) return true; if (buoc > GIOI_HAN_BUOC) return false; } }
      else if (x.b === "ifwall") { if (gapTuong() && chay(x.body ?? [])) return true; }
    }
    return false;
  };
  chay(chuongTrinh);
  const hetBuoc = buoc > GIOI_HAN_BUOC;
  return { dung: !hetBuoc && c === sb.goal.c && r === sb.goal.r, c, r, hetBuoc, soBuoc: buoc };
}

/** Đích có tới được bằng các ô trống không (BFS)? Kiểm khi soạn để không ra câu không ai làm được. */
function dichToiDuoc(sb: SaBan): boolean {
  const tuong = new Set(sb.walls.map((w) => w.c + "," + w.r));
  const q: [number, number][] = [[sb.start.c, sb.start.r]];
  const thay = new Set([sb.start.c + "," + sb.start.r]);
  while (q.length) {
    const [c, r] = q.shift()!;
    if (c === sb.goal.c && r === sb.goal.r) return true;
    for (const [dx, dy] of Object.values(DX)) {
      const nc = c + dx, nr = r + dy, k = nc + "," + nr;
      if (nc < 0 || nr < 0 || nc >= sb.cols || nr >= sb.rows || tuong.has(k) || thay.has(k)) continue;
      thay.add(k);
      q.push([nc, nr]);
    }
  }
  return false;
}

// ───────── Soạn: kiểm + dựng optionsJson/answerKeyJson ─────────

export type KetQuaKiemMoRong = { ok: true; optionsJson: Obj; answerKeyJson: Obj; stem?: string } | { ok: false; thongBao: string };
const loi = (thongBao: string): KetQuaKiemMoRong => ({ ok: false, thongBao });
const dau = (m: z.ZodError) => m.issues[0]?.message ?? "Dữ liệu câu hỏi không hợp lệ";

/** Tách các ô trống `[[đáp án|đáp án khác]]` trong đề. */
export function tachOTrong(stem: string): string[][] {
  return [...stem.matchAll(/\[\[([^\]]*)\]\]/g)].map((m) => m[1]!.split("|").map((x) => x.trim()).filter(Boolean));
}
/** Đề dành cho học viên: ô trống thành `[[]]` — không còn đáp án. */
export const stemAnODapAn = (stem: string) => stem.replace(/\[\[[^\]]*\]\]/g, "[[]]");

const moTaFile = z.object({ accept: z.array(z.enum(["VIDEO", "IMAGE", "PDF"])).min(1).max(3), maxMb: z.number().int().min(1).max(500), maxVideoSec: z.number().int().min(5).max(3600).optional(), rubricId: z.string().min(1).max(60).nullable().optional() }).strict();
const hinhSchema = z.object({ imageUrl: z.string().trim().min(1).max(500).refine((u) => /^https:\/\//.test(u) || u.startsWith("/"), "Ảnh phải là đường dẫn https hoặc nội bộ"), width: z.number().int().min(50).max(8000), height: z.number().int().min(50).max(8000) }).strict();
const vungSchema = z.union([
  z.object({ shape: z.literal("rect"), x: z.number().min(0), y: z.number().min(0), w: z.number().positive(), h: z.number().positive() }).strict(),
  z.object({ shape: z.literal("circle"), cx: z.number().min(0), cy: z.number().min(0), r: z.number().positive() }).strict(),
]);

export function kiemCauMoRong(type: LoaiMoRong, stem: string, cfg: unknown): KetQuaKiemMoRong {
  const c = laObj(cfg) ? cfg : {};
  switch (type) {
    case "FILL_BLANK": {
      const blanks = tachOTrong(stem);
      if (!blanks.length) return loi("Đặt đáp án trong [[ ]] để tạo ít nhất một ô trống");
      if (blanks.some((b) => !b.length)) return loi("Có ô trống chưa có đáp án");
      const p = z.object({ distractors: z.array(txt(100)).max(20).optional(), allowTyping: z.boolean().optional() }).strict().safeParse(c);
      if (!p.success) return loi(dau(p.error));
      return { ok: true, optionsJson: { distractors: [...new Set(p.data.distractors ?? [])], allowTyping: p.data.allowTyping ?? false }, answerKeyJson: { blanks } };
    }
    case "MATCHING": {
      const p = z.object({ pairs: z.array(z.object({ left: txt(), right: txt() }).strict()).min(2).max(10), distractors: z.array(txt()).max(10).optional() }).strict().safeParse(c);
      if (!p.success) return loi(p.error.issues[0]?.path[0] === "pairs" ? "Ghép cặp cần ít nhất 2 cặp, mỗi bên có nội dung" : dau(p.error));
      const left = p.data.pairs.map((x, i) => ({ id: "l" + (i + 1), text: x.left }));
      const right = [...p.data.pairs.map((x, i) => ({ id: "r" + (i + 1), text: x.right })), ...(p.data.distractors ?? []).map((t, i) => ({ id: "d" + (i + 1), text: t }))];
      if (new Set(right.map((x) => x.text.toLowerCase())).size !== right.length) return loi("Hai mục bên phải trùng nhau");
      return { ok: true, optionsJson: { left, right }, answerKeyJson: { pairs: Object.fromEntries(left.map((l, i) => [l.id, "r" + (i + 1)])) } };
    }
    case "ORDERING": {
      const p = z.object({ items: z.array(txt()).min(2).max(12) }).strict().safeParse(c);
      if (!p.success) return loi("Sắp xếp cần ít nhất 2 bước");
      if (new Set(p.data.items.map((x) => x.toLowerCase())).size !== p.data.items.length) return loi("Hai bước trùng nội dung — không phân biệt được thứ tự");
      const items = p.data.items.map((t, i) => ({ id: "s" + (i + 1), text: t }));
      return { ok: true, optionsJson: { items }, answerKeyJson: { order: items.map((x) => x.id) } };
    }
    case "CLASSIFY": {
      const p = z.object({ groups: z.array(z.object({ name: txt(100), cards: z.array(txt(200)).min(1).max(10) }).strict()).min(2).max(6) }).strict().safeParse(c);
      if (!p.success) return loi("Phân loại cần ít nhất 2 nhóm, mỗi nhóm có ít nhất 1 thẻ");
      const groups = p.data.groups.map((g, i) => ({ id: "g" + (i + 1), text: g.name }));
      const cards: { id: string; text: string }[] = [];
      const map: Record<string, string> = {};
      p.data.groups.forEach((g, gi) => g.cards.forEach((t) => { const id = "c" + (cards.length + 1); cards.push({ id, text: t }); map[id] = "g" + (gi + 1); }));
      if (new Set(cards.map((x) => x.text.toLowerCase())).size !== cards.length) return loi("Hai thẻ trùng nội dung — không biết thuộc nhóm nào");
      return { ok: true, optionsJson: { groups, cards }, answerKeyJson: { map } };
    }
    case "IMAGE_HOTSPOT": {
      const p = z.object({ image: hinhSchema, regions: z.array(vungSchema).min(1).max(10), tolerance: z.number().min(0).max(200).optional() }).strict().safeParse(c);
      if (!p.success) return loi("Cần ảnh (https hoặc nội bộ) và ít nhất một vùng đúng");
      const { image, regions } = p.data;
      const ra = regions.some((v) => (v.shape === "rect" ? v.x + v.w > image.width || v.y + v.h > image.height : v.cx + v.r > image.width + 1 || v.cy + v.r > image.height + 1 || v.cx - v.r < -1 || v.cy - v.r < -1));
      if (ra) return loi("Có vùng đúng nằm ngoài ảnh");
      return { ok: true, optionsJson: { ...image }, answerKeyJson: { regions, tolerance: p.data.tolerance ?? 0 } };
    }
    case "NUMERIC": {
      const p = z.object({ answer: z.number().finite(), tolerance: z.number().min(0).max(1e9).optional(), unit: z.string().trim().max(20).optional(), hint: z.string().trim().max(300).optional() }).strict().safeParse(c);
      if (!p.success) return loi("Nhập đáp án là một số và sai số không âm");
      return { ok: true, optionsJson: { ...(p.data.unit ? { unit: p.data.unit } : {}) }, answerKeyJson: { answer: p.data.answer, tolerance: p.data.tolerance ?? 0, ...(p.data.hint ? { hint: p.data.hint } : {}) } };
    }
    case "PRODUCT": {
      const p = moTaFile.safeParse(c);
      if (!p.success) return loi("Chọn ít nhất một loại tệp được nộp và dung lượng tối đa (1–500 MB)");
      if (p.data.accept.includes("VIDEO") === false && p.data.maxVideoSec !== undefined) return loi("Chỉ đặt thời lượng khi cho nộp video");
      return { ok: true, optionsJson: { ...p.data, rubricId: p.data.rubricId ?? null }, answerKeyJson: {} };
    }
    case "BLOCK_SEQUENCE": {
      const p = saBanSchema.safeParse(c);
      if (!p.success) return loi("Sa bàn chưa hợp lệ (cột/hàng 2–12, ít nhất một khối, số khối tối đa 1–60)");
      const sb = p.data;
      const trong = (x: { c: number; r: number }) => x.c < sb.cols && x.r < sb.rows;
      if (!trong(sb.start) || !trong(sb.goal) || sb.walls.some((w) => !trong(w))) return loi("Có ô nằm ngoài sa bàn");
      if (sb.start.c === sb.goal.c && sb.start.r === sb.goal.r) return loi("Xe và đích không được cùng một ô");
      if (sb.walls.some((w) => (w.c === sb.start.c && w.r === sb.start.r) || (w.c === sb.goal.c && w.r === sb.goal.r))) return loi("Tường không được đè lên xe hoặc đích");
      if (!dichToiDuoc(sb)) return loi("Tường chắn kín — xe không tới được đích");
      return { ok: true, optionsJson: { ...sb }, answerKeyJson: {} };
    }
  }
}

// ───────── Chấm ─────────

export type CauMoRong = { id: string; type: LoaiMoRong; stem: string; options: unknown; key: unknown; points: number };
export type KetQuaMoRong = { dung: boolean | null; soDung: number; soCau: number };

const motPhan = (ok: number, tong: number): KetQuaMoRong => ({ dung: tong > 0 && ok === tong, soDung: ok, soCau: tong });
const sai: KetQuaMoRong = { dung: false, soDung: 0, soCau: 1 };

/** Đọc số người dùng gõ: chấp nhận dấu phẩy HOẶC dấu chấm thập phân; từ chối chuỗi lạ. */
export function docSoVN(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(",", ".");
  if (!/^-?\d{1,15}(\.\d{1,10})?$/.test(t)) return null;
  return Number(t);
}

const chuanHoa = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

export function chamMoRong(q: CauMoRong, traLoi: unknown): KetQuaMoRong {
  const key = laObj(q.key) ? q.key : {};
  const opt = laObj(q.options) ? q.options : {};
  switch (q.type) {
    case "FILL_BLANK": {
      const blanks = Array.isArray(key.blanks) ? (key.blanks as string[][]) : [];
      if (!Array.isArray(traLoi)) return { dung: false, soDung: 0, soCau: blanks.length || 1 };
      return motPhan(blanks.filter((acc, i) => typeof traLoi[i] === "string" && acc.some((a) => chuanHoa(a) === chuanHoa(traLoi[i] as string)) && chuanHoa(traLoi[i] as string) !== "").length, blanks.length);
    }
    case "MATCHING": {
      const pairs = laObj(key.pairs) ? (key.pairs as Record<string, string>) : {};
      const ids = Object.keys(pairs);
      if (!laObj(traLoi)) return { dung: false, soDung: 0, soCau: ids.length || 1 };
      return motPhan(ids.filter((l) => traLoi[l] === pairs[l]).length, ids.length);
    }
    case "ORDERING": {
      const order = Array.isArray(key.order) ? (key.order as string[]) : [];
      if (!Array.isArray(traLoi) || new Set(traLoi).size !== traLoi.length) return { dung: false, soDung: 0, soCau: order.length || 1 };
      return motPhan(order.filter((id, i) => traLoi[i] === id).length, order.length);
    }
    case "CLASSIFY": {
      const map = laObj(key.map) ? (key.map as Record<string, string>) : {};
      const ids = Object.keys(map);
      if (!laObj(traLoi)) return { dung: false, soDung: 0, soCau: ids.length || 1 };
      return motPhan(ids.filter((c) => traLoi[c] === map[c]).length, ids.length);
    }
    case "IMAGE_HOTSPOT": {
      const vung = Array.isArray(key.regions) ? (key.regions as z.infer<typeof vungSchema>[]) : [];
      const tol = typeof key.tolerance === "number" ? key.tolerance : 0;
      if (!laObj(traLoi) || typeof traLoi.x !== "number" || typeof traLoi.y !== "number" || !Number.isFinite(traLoi.x) || !Number.isFinite(traLoi.y)) return sai;
      const { x, y } = traLoi as { x: number; y: number };
      const trung = vung.some((v) => (v.shape === "rect" ? x >= v.x - tol && x <= v.x + v.w + tol && y >= v.y - tol && y <= v.y + v.h + tol : Math.hypot(x - v.cx, y - v.cy) <= v.r + tol));
      return { dung: trung, soDung: trung ? 1 : 0, soCau: 1 };
    }
    case "NUMERIC": {
      const so = docSoVN(traLoi);
      const dapAn = key.answer, tol = typeof key.tolerance === "number" ? key.tolerance : 0;
      if (so === null || typeof dapAn !== "number") return sai;
      const dung = Math.abs(so - dapAn) <= tol + 1e-9;
      return { dung, soDung: dung ? 1 : 0, soCau: 1 };
    }
    case "PRODUCT":
      return { dung: null, soDung: 0, soCau: 1 };
    case "BLOCK_SEQUENCE": {
      const sb = saBanSchema.safeParse(opt);
      const ct = chuongTrinhSchema.safeParse(traLoi);
      if (!sb.success || !ct.success) return sai;
      const cho = new Set<string>(sb.data.blocks);
      const hopLe = (p: readonly Nut[]): boolean => p.every((x) => cho.has(x.b) && (x.b === "repeat" || x.n === undefined) && (x.b === "repeat" || x.b === "ifwall" || !x.body) && (!x.body || hopLe(x.body)));
      if (!hopLe(ct.data) || demNut(ct.data) > sb.data.maxBlocks) return sai;
      const dung = moPhongKhoiLenh(sb.data as SaBan, ct.data).dung;
      return { dung, soDung: dung ? 1 : 0, soCau: 1 };
    }
  }
}

// ───────── Phần gửi cho học viên (KHÔNG đáp án) ─────────

export type CauMoRongChoHocVien = { stem: string; cauHinh: Obj };

export function veCauMoRong(q: CauMoRong): CauMoRongChoHocVien {
  const opt = laObj(q.options) ? q.options : {};
  const key = laObj(q.key) ? q.key : {};
  const hat = q.id;
  switch (q.type) {
    case "FILL_BLANK": {
      const blanks = Array.isArray(key.blanks) ? (key.blanks as string[][]) : [];
      const dis = Array.isArray(opt.distractors) ? (opt.distractors as string[]) : [];
      const the = xaoCoDinh([...blanks.map((b, i) => ({ id: "w" + i, text: b[0]! })), ...dis.map((t, i) => ({ id: "x" + i, text: t }))], hat).map((x) => x.text);
      return { stem: stemAnODapAn(q.stem), cauHinh: { soO: blanks.length, the: [...new Set(the)], choGo: opt.allowTyping === true } };
    }
    case "MATCHING":
      return { stem: q.stem, cauHinh: { trai: opt.left ?? [], phai: xaoCoDinh((opt.right as { id: string }[] | undefined) ?? [], hat) } };
    case "ORDERING":
      return { stem: q.stem, cauHinh: { muc: xaoCoDinh((opt.items as { id: string }[] | undefined) ?? [], hat) } };
    case "CLASSIFY":
      return { stem: q.stem, cauHinh: { nhom: opt.groups ?? [], the: xaoCoDinh((opt.cards as { id: string }[] | undefined) ?? [], hat) } };
    case "IMAGE_HOTSPOT":
      return { stem: q.stem, cauHinh: { anh: opt.imageUrl, rong: opt.width, cao: opt.height } };
    case "NUMERIC":
      return { stem: q.stem, cauHinh: { donVi: typeof opt.unit === "string" ? opt.unit : null } };
    case "PRODUCT":
      return { stem: q.stem, cauHinh: { cho: opt.accept ?? [], toiDaMb: opt.maxMb ?? null, toiDaGiay: opt.maxVideoSec ?? null } };
    case "BLOCK_SEQUENCE":
      return { stem: q.stem, cauHinh: { ...opt } };
  }
}

// ───────── Đọc ngược để SỬA câu đã lưu ─────────

type Dong = { id: string; text: string };
const dsDong = (x: unknown): Dong[] => (Array.isArray(x) ? (x as Dong[]).filter((d) => laObj(d) && typeof d.id === "string" && typeof d.text === "string") : []);

/**
 * Dựng lại `cauHinh` (đầu vào của `kiemCauMoRong`) từ `optionsJson` + `answerKeyJson` đã lưu — để người soạn SỬA câu. Phép nghịch của `kiemCauMoRong`:
 * `kiemCauMoRong(type, stem, cauHinhTuLuu(...))` ra lại ĐÚNG `optionsJson/answerKeyJson` đã lưu (lưới round-trip ở `dang-cau-hoi.test.ts`). Dữ liệu hỏng ⇒ cấu hình rỗng ở chỗ hỏng (server vẫn kiểm lại khi lưu).
 */
export function cauHinhTuLuu(type: LoaiMoRong, optionsJson: unknown, answerKeyJson: unknown): Obj {
  const opt = laObj(optionsJson) ? optionsJson : {};
  const key = laObj(answerKeyJson) ? answerKeyJson : {};
  switch (type) {
    case "FILL_BLANK":
      return { distractors: Array.isArray(opt.distractors) ? opt.distractors : [], allowTyping: opt.allowTyping === true };
    case "MATCHING": {
      const trai = dsDong(opt.left), phai = dsDong(opt.right);
      const cap = laObj(key.pairs) ? (key.pairs as Record<string, string>) : {};
      return {
        pairs: trai.map((l) => ({ left: l.text, right: phai.find((r) => r.id === cap[l.id])?.text ?? "" })),
        distractors: phai.filter((r) => r.id.startsWith("d")).map((r) => r.text),
      };
    }
    case "ORDERING": {
      const muc = dsDong(opt.items);
      return { items: (Array.isArray(key.order) ? (key.order as string[]) : []).map((id) => muc.find((m) => m.id === id)?.text ?? "") };
    }
    case "CLASSIFY": {
      const nhom = dsDong(opt.groups), the = dsDong(opt.cards);
      const map = laObj(key.map) ? (key.map as Record<string, string>) : {};
      return { groups: nhom.map((g) => ({ name: g.text, cards: the.filter((c) => map[c.id] === g.id).map((c) => c.text) })) };
    }
    case "IMAGE_HOTSPOT":
      return { image: { imageUrl: opt.imageUrl, width: opt.width, height: opt.height }, regions: Array.isArray(key.regions) ? key.regions : [], tolerance: typeof key.tolerance === "number" ? key.tolerance : 0 };
    case "NUMERIC":
      return { answer: key.answer, tolerance: typeof key.tolerance === "number" ? key.tolerance : 0, ...(typeof opt.unit === "string" ? { unit: opt.unit } : {}), ...(typeof key.hint === "string" ? { hint: key.hint } : {}) };
    case "PRODUCT":
      return { accept: opt.accept, maxMb: opt.maxMb, ...(typeof opt.maxVideoSec === "number" ? { maxVideoSec: opt.maxVideoSec } : {}), rubricId: typeof opt.rubricId === "string" ? opt.rubricId : null };
    case "BLOCK_SEQUENCE":
      return { ...opt };
  }
}
