// QoImport — 8 dạng mở rộng (điền chỗ trống · ghép cặp · sắp xếp · phân loại · chọn trên hình · nhập số · nộp sản phẩm · khối lệnh). HÀM THUẦN.
//
// Nguyên tắc: file này CHỈ đổi các ô Excel thành `cauHinh` rồi giao cho `kiemCauHoi` (cham-diem.ts) — luật kiểm thật nằm ở MỘT chỗ (`kiemCauMoRong`),
// đường lưu từng câu (`luuCauHoi`) và đường nhập hàng loạt (`nhapCauHoi`) cùng gọi nó ⇒ "hợp lệ ở bản xem trước" = "lưu được".
// Toạ độ trong Excel tính từ 1 (cột 1, hàng 1) cho người soạn; chuyển về chỉ số từ 0 của sa bàn khi dựng `cauHinh`.
import { kiemCauHoi, type CauHoiInput } from "./cham-diem";
import { KHOI_LENH, docSoVN, type LoaiMoRong } from "./dang-cau-hoi";

export type LoaiNhapMoRong = LoaiMoRong;
type CauNhapMoRong = Omit<CauHoiInput, "courseId" | "id">;
type Lay = (ten: string) => string;
type KetQuaDong = { cau?: CauNhapMoRong; loi?: string };

export type MauMoRong = { loai: LoaiNhapMoRong; sheet: string; tepMau: string; cotBatBuoc: string; cot: string[]; viDu: string[]; batBuoc: readonly string[] };

const cotCap = (n: number) => Array.from({ length: n }, (_, i) => [`Trái ${i + 1}`, `Phải ${i + 1}`]).flat();
const cotNhom = (n: number) => Array.from({ length: n }, (_, i) => [`Nhóm ${i + 1}`, `Thẻ nhóm ${i + 1}`]).flat();
const cotBuoc = (n: number) => Array.from({ length: n }, (_, i) => `Bước ${i + 1}`);

const TAIL = ["Điểm", "Giải thích"];
const trong = (n: number) => Array<string>(n).fill("");

export const MAU_MO_RONG: MauMoRong[] = [
  {
    loai: "FILL_BLANK", sheet: "Điền vào chỗ trống", tepMau: "mau-dien-cho-trong.xlsx",
    cotBatBuoc: "Đề bài (đáp án đặt trong [[ ]], nhiều đáp án chấp nhận cách nhau bằng |)",
    batBuoc: ["Đề bài"],
    cot: ["Đề bài", "Từ gây nhiễu", "Cho gõ", ...TAIL],
    viDu: ["Robot dùng cảm biến [[siêu âm|ultrasonic]] để đo [[khoảng cách]].", "màu|chạm", "Không", "1", ""],
  },
  {
    loai: "MATCHING", sheet: "Ghép cặp", tepMau: "mau-ghep-cap.xlsx",
    cotBatBuoc: "Đề bài · Trái 1–Phải 1 · Trái 2–Phải 2 (tối đa 10 cặp)",
    batBuoc: ["Đề bài", "Trái 1", "Phải 1", "Trái 2", "Phải 2"],
    cot: ["Đề bài", ...cotCap(10), "Mục gây nhiễu", ...TAIL],
    viDu: ["Ghép cảm biến với chức năng", "Siêu âm", "Đo khoảng cách", "Màu", "Nhận biết màu sắc", ...trong(16), "Đo nhiệt độ", "1", ""],
  },
  {
    loai: "ORDERING", sheet: "Sắp xếp thứ tự", tepMau: "mau-sap-xep.xlsx",
    cotBatBuoc: "Đề bài · Bước 1, Bước 2… (điền ĐÚNG thứ tự, tối đa 12 bước)",
    batBuoc: ["Đề bài", "Bước 1", "Bước 2"],
    cot: ["Đề bài", ...cotBuoc(12), ...TAIL],
    viDu: ["Sắp xếp các bước lập trình robot", "Xác định bài toán", "Viết chương trình", "Nạp vào robot", "Chạy thử", ...trong(8), "1", ""],
  },
  {
    loai: "CLASSIFY", sheet: "Phân loại", tepMau: "mau-phan-loai.xlsx",
    cotBatBuoc: "Đề bài · Nhóm 1–Thẻ nhóm 1 · Nhóm 2–Thẻ nhóm 2 (thẻ cách nhau bằng |, tối đa 6 nhóm)",
    batBuoc: ["Đề bài", "Nhóm 1", "Thẻ nhóm 1", "Nhóm 2", "Thẻ nhóm 2"],
    cot: ["Đề bài", ...cotNhom(6), ...TAIL],
    viDu: ["Phân loại bộ phận robot", "Cảm biến", "Siêu âm|Màu", "Động cơ", "Động cơ bước|Động cơ DC", ...trong(8), "2", ""],
  },
  {
    loai: "IMAGE_HOTSPOT", sheet: "Chọn trên hình", tepMau: "mau-chon-tren-hinh.xlsx",
    cotBatBuoc: "Đề bài · Ảnh (https hoặc /…) · Rộng · Cao · Vùng đúng (rect:x,y,rộng,cao hoặc circle:x,y,bán kính; cách nhau bằng ;)",
    batBuoc: ["Đề bài", "Ảnh", "Rộng", "Cao", "Vùng đúng"],
    cot: ["Đề bài", "Ảnh", "Rộng", "Cao", "Vùng đúng", "Sai số", ...TAIL],
    viDu: ["Bấm vào cảm biến siêu âm", "https://example.com/robot.png", "800", "600", "rect:100,100,200,150;circle:600,300,60", "10", "1", ""],
  },
  {
    loai: "NUMERIC", sheet: "Nhập số", tepMau: "mau-nhap-so.xlsx",
    cotBatBuoc: "Đề bài · Đáp án (số; dấu , hoặc . đều được)",
    batBuoc: ["Đề bài", "Đáp án"],
    cot: ["Đề bài", "Đáp án", "Sai số", "Đơn vị", "Gợi ý", ...TAIL],
    viDu: ["Xe đi 3 vòng bánh, mỗi vòng 20 cm. Quãng đường?", "60", "0", "cm", "Nhân số vòng với chu vi", "1", ""],
  },
  {
    loai: "PRODUCT", sheet: "Nộp sản phẩm", tepMau: "mau-nop-san-pham.xlsx",
    cotBatBuoc: "Đề bài · Loại tệp (VIDEO;IMAGE;PDF) · Dung lượng tối đa (MB)",
    batBuoc: ["Đề bài", "Loại tệp", "Dung lượng tối đa (MB)"],
    cot: ["Đề bài", "Loại tệp", "Dung lượng tối đa (MB)", "Thời lượng video tối đa (giây)", ...TAIL],
    viDu: ["Quay video robot của em chạy qua mê cung", "VIDEO;IMAGE", "200", "120", "10", ""],
  },
  {
    loai: "BLOCK_SEQUENCE", sheet: "Kéo thả khối lệnh", tepMau: "mau-khoi-lenh.xlsx",
    cotBatBuoc: "Đề bài · Số cột · Số hàng · Xe (cột,hàng,hướng) · Đích (cột,hàng) · Khối cho phép · Số khối tối đa",
    batBuoc: ["Đề bài", "Số cột", "Số hàng", "Xe", "Đích", "Khối cho phép", "Số khối tối đa"],
    cot: ["Đề bài", "Số cột", "Số hàng", "Xe", "Đích", "Tường", "Khối cho phép", "Số khối tối đa", ...TAIL],
    viDu: ["Đưa xe tới ô đích", "4", "3", "1,1,Đông", "4,1", "", "fwd;right;left;repeat", "8", "3", ""],
  },
];


function diemCau(v: string): { ok: true; v: number } | { ok: false } {
  if (v === "") return { ok: true, v: 1 };
  if (!/^\d+$/.test(v)) return { ok: false };
  const n = Number(v);
  return n >= 1 && n <= 1000 ? { ok: true, v: n } : { ok: false };
}

/** Số nguyên dương trong ô; trống ⇒ undefined; sai kiểu ⇒ null. */
function soNguyen(v: string): number | undefined | null {
  if (v === "") return undefined;
  const n = docSoVN(v);
  return n !== null && Number.isInteger(n) ? n : null;
}

const HUONG: Record<string, "N" | "E" | "S" | "W"> = { n: "N", e: "E", s: "S", w: "W", bac: "N", dong: "E", nam: "S", tay: "W", "bắc": "N", "đông": "E", "tây": "W" };
const KHOI_ALIAS: Record<string, string> = { tien: "fwd", "tiến": "fwd", phai: "right", "phải": "right", trai: "left", "trái": "left", lap: "repeat", "lặp": "repeat", "gặp tường": "ifwall", "gap tuong": "ifwall", dung: "stop", "dừng": "stop" };
const LOAI_TEP: Record<string, "VIDEO" | "IMAGE" | "PDF"> = { video: "VIDEO", image: "IMAGE", "ảnh": "IMAGE", anh: "IMAGE", pdf: "PDF" };

const bo = (s: string, sep: string | RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean);

function dungCauHinh(loai: LoaiNhapMoRong, deBai: string, diem: number, giaiThich: string | null, cauHinh: Record<string, unknown>): KetQuaDong {
  const cau: CauNhapMoRong = { type: loai, stem: deBai, points: diem, explanation: giaiThich, cauHinh };
  const k = kiemCauHoi({ type: loai, stem: deBai, cauHinh });
  return k.ok ? { cau } : { loi: k.thongBao };
}

/** Kiểm MỘT dòng của sheet thuộc 8 dạng mở rộng. `lay(tên cột)` trả ô đã cắt khoảng trắng. */
export function kiemDongMoRong(loai: LoaiNhapMoRong, lay: Lay): KetQuaDong {
  const deBai = lay("Đề bài");
  if (!deBai) return { loi: "Thiếu Đề bài" };
  const d = diemCau(lay("Điểm"));
  if (!d.ok) return { loi: "Điểm phải là số nguyên từ 1 đến 1000" };
  const giaiThich = lay("Giải thích") || null;
  const xong = (cauHinh: Record<string, unknown>) => dungCauHinh(loai, deBai, d.v, giaiThich, cauHinh);

  switch (loai) {
    case "FILL_BLANK": {
      const goRaw = lay("Cho gõ").toLowerCase();
      if (goRaw && !["có", "co", "không", "khong", "true", "false", "yes", "no"].includes(goRaw)) return { loi: "Cho gõ phải là Có hoặc Không" };
      return xong({ distractors: bo(lay("Từ gây nhiễu"), "|"), allowTyping: ["có", "co", "true", "yes"].includes(goRaw) });
    }
    case "MATCHING": {
      const pairs: { left: string; right: string }[] = [];
      for (let i = 1; i <= 10; i++) {
        const l = lay(`Trái ${i}`), r = lay(`Phải ${i}`);
        if (!l && !r) continue;
        if (!l || !r) return { loi: `Cặp ${i} thiếu một bên (Trái ${i} và Phải ${i} phải cùng có nội dung)` };
        pairs.push({ left: l, right: r });
      }
      return xong({ pairs, distractors: bo(lay("Mục gây nhiễu"), "|") });
    }
    case "ORDERING": {
      const items: string[] = [];
      for (let i = 1; i <= 12; i++) { const t = lay(`Bước ${i}`); if (t) items.push(t); }
      return xong({ items });
    }
    case "CLASSIFY": {
      const groups: { name: string; cards: string[] }[] = [];
      for (let i = 1; i <= 6; i++) {
        const ten = lay(`Nhóm ${i}`), the = bo(lay(`Thẻ nhóm ${i}`), "|");
        if (!ten && the.length === 0) continue;
        if (!ten) return { loi: `Thẻ nhóm ${i} có nội dung nhưng Nhóm ${i} chưa có tên` };
        if (the.length === 0) return { loi: `Nhóm ${i} chưa có thẻ nào` };
        groups.push({ name: ten, cards: the });
      }
      return xong({ groups });
    }
    case "IMAGE_HOTSPOT": {
      const rong = soNguyen(lay("Rộng")), cao = soNguyen(lay("Cao"));
      if (typeof rong !== "number" || typeof cao !== "number") return { loi: "Rộng và Cao phải là số nguyên (điểm ảnh)" };
      const regions: Record<string, unknown>[] = [];
      for (const v of bo(lay("Vùng đúng"), ";")) {
        const m = /^(rect|circle)\s*:\s*(.+)$/i.exec(v);
        if (!m) return { loi: `Vùng "${v}" sai cú pháp — dùng rect:x,y,rộng,cao hoặc circle:x,y,bán kính` };
        const so = bo(m[2]!, ",").map((x) => docSoVN(x));
        if (so.some((x) => x === null)) return { loi: `Vùng "${v}" có giá trị không phải số` };
        const n = so as number[];
        if (m[1]!.toLowerCase() === "rect") {
          if (n.length !== 4) return { loi: `Vùng "${v}" cần đúng 4 số: x,y,rộng,cao` };
          regions.push({ shape: "rect", x: n[0], y: n[1], w: n[2], h: n[3] });
        } else {
          if (n.length !== 3) return { loi: `Vùng "${v}" cần đúng 3 số: x,y,bán kính` };
          regions.push({ shape: "circle", cx: n[0], cy: n[1], r: n[2] });
        }
      }
      const tolRaw = lay("Sai số");
      const tol = tolRaw === "" ? undefined : docSoVN(tolRaw);
      if (tol === null) return { loi: "Sai số phải là số không âm" };
      return xong({ image: { imageUrl: lay("Ảnh"), width: rong, height: cao }, regions, ...(tol !== undefined ? { tolerance: tol } : {}) });
    }
    case "NUMERIC": {
      const dapAn = docSoVN(lay("Đáp án"));
      if (dapAn === null) return { loi: "Đáp án phải là một số" };
      const tolRaw = lay("Sai số");
      const tol = tolRaw === "" ? undefined : docSoVN(tolRaw);
      if (tol === null) return { loi: "Sai số phải là số không âm" };
      return xong({ answer: dapAn, ...(tol !== undefined ? { tolerance: tol } : {}), ...(lay("Đơn vị") ? { unit: lay("Đơn vị") } : {}), ...(lay("Gợi ý") ? { hint: lay("Gợi ý") } : {}) });
    }
    case "PRODUCT": {
      const accept: ("VIDEO" | "IMAGE" | "PDF")[] = [];
      for (const t of bo(lay("Loại tệp"), /[;,|]/)) {
        const v = LOAI_TEP[t.toLowerCase()];
        if (!v) return { loi: `Loại tệp "${t}" không hợp lệ — chỉ VIDEO, IMAGE, PDF` };
        if (!accept.includes(v)) accept.push(v);
      }
      const mb = soNguyen(lay("Dung lượng tối đa (MB)"));
      if (typeof mb !== "number") return { loi: "Dung lượng tối đa (MB) phải là số nguyên 1–500" };
      const giay = soNguyen(lay("Thời lượng video tối đa (giây)"));
      if (giay === null) return { loi: "Thời lượng video tối đa phải là số nguyên (giây)" };
      return xong({ accept, maxMb: mb, ...(giay !== undefined ? { maxVideoSec: giay } : {}) });
    }
    case "BLOCK_SEQUENCE": {
      const cols = soNguyen(lay("Số cột")), rows = soNguyen(lay("Số hàng")), maxBlocks = soNguyen(lay("Số khối tối đa"));
      if (typeof cols !== "number" || typeof rows !== "number") return { loi: "Số cột và Số hàng phải là số nguyên" };
      if (typeof maxBlocks !== "number") return { loi: "Số khối tối đa phải là số nguyên" };
      const xe = bo(lay("Xe"), ",");
      if (xe.length !== 3) return { loi: "Xe cần đúng 3 giá trị: cột,hàng,hướng (ví dụ 1,1,Đông)" };
      const huong = HUONG[xe[2]!.toLowerCase()];
      const xc = docSoVN(xe[0]!), xr = docSoVN(xe[1]!);
      if (!huong) return { loi: "Hướng của xe phải là Bắc, Đông, Nam hoặc Tây" };
      if (xc === null || xr === null) return { loi: "Cột và hàng của xe phải là số" };
      const dich = bo(lay("Đích"), ",").map((x) => docSoVN(x));
      if (dich.length !== 2 || dich.some((x) => x === null)) return { loi: "Đích cần đúng 2 số: cột,hàng" };
      const walls: { c: number; r: number }[] = [];
      for (const w of bo(lay("Tường"), ";")) {
        const p = bo(w, ",").map((x) => docSoVN(x));
        if (p.length !== 2 || p.some((x) => x === null)) return { loi: `Ô tường "${w}" sai cú pháp — dùng cột,hàng; các ô cách nhau bằng ;` };
        walls.push({ c: (p[0] as number) - 1, r: (p[1] as number) - 1 });
      }
      const blocks: string[] = [];
      for (const b of bo(lay("Khối cho phép"), /[;,|]/)) {
        const id = (KHOI_LENH as readonly string[]).includes(b.toLowerCase()) ? b.toLowerCase() : KHOI_ALIAS[b.toLowerCase()];
        if (!id) return { loi: `Khối "${b}" không hợp lệ — dùng ${KHOI_LENH.join(", ")}` };
        if (!blocks.includes(id)) blocks.push(id);
      }
      return xong({ cols, rows, start: { c: xc - 1, r: xr - 1, dir: huong }, goal: { c: (dich[0] as number) - 1, r: (dich[1] as number) - 1 }, walls, blocks, maxBlocks });
    }
  }
}
