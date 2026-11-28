// Ca [ENG-LUOI-*] — lưới ghim MÃ NGUỒN của engine S3 (shadow, thuần, chưa nối luồng nào).
//
// Mẫu "lưới ghim mã nguồn" (CLAUDE.md): đọc mã đã BÓC chú thích, neo vào BIỂU THỨC / lời gọi chứ không vào chỗ đặt chữ,
// đếm SỐ LẦN khớp, và có ca đối chứng chứng minh bộ quét thật sự bắt được (không xanh vì quét nhầm chỗ).
//
// Năm luật cần khoá:
//   1. Engine không chạm DB/env/đồng hồ/ngẫu nhiên, và KHÔNG đọc tên cột tiền của phiếu thu (số tiền chỉ từ số ròng của Payment).
//   2. Một chỗ làm tròn: không `Math.round`; cả hai công thức thuế đi qua `lamTronChia`.
//   3. Import trực tiếp của từng tệp nằm trong danh sách cho phép; các import nặng (hàng chờ, pháp nhân) chỉ là `import type`.
//   4. SHADOW: không tệp mã nào ngoài thư mục engine/ được import engine; tệp dữ liệu mẫu chỉ test được import.
//   5. Không module nào ngoài module hoá đơn được nhắc bảng chiếu nghĩa vụ (khuôn `truc-a.test.ts` — "sổ tiền thứ ba").
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();
const THU_MUC_ENGINE = "lib/finance/hoa-don/engine";
const MA_NGUON = ["tien-thue.ts", "chinh-sach.ts", "phan-loai-nghia-vu.ts", "doi-chieu-bong.ts"] as const;

const boNho = new Map<string, string>();
/** Đọc một tệp (có nhớ — bốn mô tả quét cây dùng chung một lượt đọc). */
const doc = (p: string) => {
  let s = boNho.get(p);
  if (s === undefined) {
    s = readFileSync(resolve(GOC, p), "utf8").replace(/\r\n/g, "\n");
    boNho.set(p, s);
  }
  return s;
};
/** Bóc chú thích khối + dòng (không đụng chuỗi chứa `//` vì engine không có URL trong mã). */
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

function tepNguon(thuMuc: string, boQuaTest = true): string[] {
  const kq: string[] = [];
  for (const ten of readdirSync(resolve(GOC, thuMuc))) {
    if (ten === "node_modules" || ten === ".next" || ten.startsWith(".")) continue;
    const p = join(thuMuc, ten).replace(/\\/g, "/");
    if (statSync(resolve(GOC, p)).isDirectory()) kq.push(...tepNguon(p, boQuaTest));
    else if (/\.tsx?$/.test(ten) && !(boQuaTest && /\.test\.tsx?$/.test(ten))) kq.push(p);
  }
  return kq;
}

/** Dòng import (một dòng hoặc nhiều dòng) → [kiểu, đường dẫn]. `import type` được nhận diện riêng. */
function docImport(src: string): { dangType: boolean; tu: string }[] {
  const kq: { dangType: boolean; tu: string }[] = [];
  const re = /^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) kq.push({ dangType: Boolean(m[1]), tu: m[2]! });
  return kq;
}

describe("[ENG-LUOI-01] engine thuần: không DB · env · đồng hồ · ngẫu nhiên · tên cột tiền của phiếu thu", () => {
  const CAM: [string, RegExp][] = [
    ["tên cột tiền của phiếu thu (số tiền chỉ từ số ròng của Payment)", /\bamountDue\b/],
    ["bảng chiếu nghĩa vụ", /\bHoaDonNghiaVu\b|\bhoaDonNghiaVu\b/],
    ["Prisma", /@prisma|\bprisma\b|\bPrismaClient\b/],
    ["cổng DB", /@\/lib\/db|\bscopedDb\b|\bportalDb\b/],
    ["biến môi trường", /\bprocess\.env\b/],
    ["đồng hồ thật", /\bDate\.now\s*\(|\bnew Date\s*\(\s*\)|\bperformance\.now\b/],
    ["ngẫu nhiên", /\bMath\.random\b|\brandomUUID\b/],
    ["mạng / SQL thô", /\bfetch\s*\(|\$queryRaw|\$executeRaw/],
  ];
  it("thư mục engine/ có ĐÚNG tập tệp này — tệp mới phải được thêm vào lưới có chủ đích", () => {
    const co = readdirSync(resolve(GOC, THU_MUC_ENGINE)).sort();
    const mong = [...MA_NGUON, "du-lieu-mau.testdata.ts", "tien-thue.test.ts", "chinh-sach.test.ts", "phan-loai-nghia-vu.test.ts", "doi-chieu-bong.test.ts", "luoi.test.ts"].sort();
    expect(co).toEqual(mong);
  });
  it.each(MA_NGUON)("%s: không chạm thứ nào trong danh sách cấm (sau khi bóc chú thích)", (tep) => {
    const src = boChuThich(doc(`${THU_MUC_ENGINE}/${tep}`));
    expect(src.length).toBeGreaterThan(500); // đừng để lưới rỗng vì sai đường dẫn
    for (const [ten, re] of CAM) expect(src.match(re), `${tep} chạm: ${ten}`).toBeNull();
  });
  it("ĐỐI CHỨNG: bộ bắt thật sự bắt (chú thích bị bóc, mã thì không)", () => {
    const co = "const x = 1; // amountDue ở đây là chú thích\n/* new Date() */\nconst y = row.amountDue;";
    const sach = boChuThich(co);
    expect(sach).not.toMatch(/ở đây là chú thích/);
    expect(sach.match(/\bamountDue\b/g)).toHaveLength(1); // chỉ lần ở MÃ
    expect("const t = new Date();".match(CAM[5]![1])).not.toBeNull();
    expect("const t = new Date(Date.UTC(2026, 0, 1));".match(CAM[5]![1])).toBeNull(); // có tham số = không đọc đồng hồ
  });
});

describe("[ENG-LUOI-02] một chỗ làm tròn", () => {
  const src = boChuThich(doc(`${THU_MUC_ENGINE}/tien-thue.ts`));
  it("không `Math.round` nào trong mã engine", () => {
    for (const tep of MA_NGUON) expect(boChuThich(doc(`${THU_MUC_ENGINE}/${tep}`)).match(/\bMath\.round\b/g), tep).toBeNull();
  });
  it("`lamTronChia` được định nghĩa MỘT lần và cả hai công thức thuế (đã gồm / chưa gồm) đều gọi nó", () => {
    expect(src.match(/export function lamTronChia\(/g)).toHaveLength(1);
    expect(src).toMatch(/const thanhTien = lamTronChia\(soTienKhongAm \* 100, 100 \+ p\);/);
    expect(src).toMatch(/const tienThue = lamTronChia\(soTienKhongAm \* p, 100\);/);
    expect(src.match(/\blamTronChia\(/g)).toHaveLength(3); // 1 định nghĩa + 2 lời gọi: thêm nơi chia tiền mới phải vào lưới này
  });
  it("không đường làm tròn nào khác trong mã engine (floor / ceil / trunc / toFixed)", () => {
    for (const tep of MA_NGUON) expect(boChuThich(doc(`${THU_MUC_ENGINE}/${tep}`)).match(/\bMath\.(floor|ceil|trunc)\b|\.toFixed\(/g), tep).toBeNull();
  });
});

describe("[ENG-LUOI-03] import trực tiếp: danh sách cho phép; import nặng chỉ là `import type`", () => {
  const CHO_PHEP: Record<(typeof MA_NGUON)[number], { tu: string; chiType?: true }[]> = {
    "tien-thue.ts": [{ tu: "../tinh-hoa-don" }, { tu: "../so-tien-bang-chu" }],
    "chinh-sach.ts": [{ tu: "../cau-hinh-co-so" }, { tu: "../loai-khoan" }, { tu: "../phap-nhan", chiType: true }, { tu: "./tien-thue" }],
    "phan-loai-nghia-vu.ts": [{ tu: "node:crypto" }, { tu: "../du-dieu-kien" }, { tu: "../dong-hang-cho", chiType: true }, { tu: "../lan-thu" }, { tu: "../ly-do-khong-xuat" }, { tu: "../nguon-khoan" }],
    "doi-chieu-bong.ts": [{ tu: "../dong-hang-cho", chiType: true }, { tu: "./phan-loai-nghia-vu", chiType: true }],
  };
  it.each(MA_NGUON)("%s: mọi import đều nằm trong danh sách; nhóm `chiType` không bao giờ là import giá trị", (tep) => {
    const ds = docImport(boChuThich(doc(`${THU_MUC_ENGINE}/${tep}`)));
    expect(ds.length).toBeGreaterThan(0);
    const cho = CHO_PHEP[tep];
    expect(ds.map((i) => i.tu).sort()).toEqual(cho.map((c) => c.tu).sort());
    for (const c of cho) if (c.chiType) expect(ds.find((i) => i.tu === c.tu)!.dangType, `${tep} phải \`import type\` từ ${c.tu}`).toBe(true);
  });
  it("ĐỐI CHỨNG: bộ đọc import phân biệt `import type` với import giá trị", () => {
    const m = docImport('import type { A } from "../x";\nimport { B, type C } from "../y";\nimport {\n  D,\n} from "../z";');
    expect(m).toEqual([{ dangType: true, tu: "../x" }, { dangType: false, tu: "../y" }, { dangType: false, tu: "../z" }]);
  });
});

describe("[ENG-LUOI-04] SHADOW: chưa nối vào luồng nào", () => {
  // Khi một lát sau nối engine vào cron/loader, THÊM tệp đó vào đây CÓ CHỦ ĐÍCH (cùng PR với lý do) — lưới này đỏ là để buộc câu hỏi đó.
  // S7 (01/11/2026): dịch vụ CHÍNH SÁCH CÓ PHIÊN BẢN dùng `engine/chinh-sach` để (1) dựng `QuyTac[]` từ nội dung đã duyệt (`sangQuyTac`, `docHieuLuc`),
  // (2) chạy `moPhong` cho bước duyệt. Đây vẫn là đường XEM TRƯỚC / CẤU HÌNH: không file nào trong ba file này gọi `tinhHoaDon` để lập hoá đơn,
  // không cái nào chạm nhà cung cấp hay sổ tiền, và chưa luồng phát hành nào đọc `docHieuLuc` (cờ `hoaDon.hubChinhSach` TẮT mặc định).
  // Khi scanner/cron (S8) nối `docHieuLuc` vào luồng thật, THÊM tệp gọi nó vào đây CÓ LÝ DO.
  // S8 (01/11/2026): SCANNER BÓNG nối `phanLoaiNghiaVu` + `doiChieuBong` vào pha P2 của cron `hoa-don-misa-doi-soat` (cờ `hoaDon.hubQuet` TẮT mặc định):
  //   · quet-nghia-vu-ke-hoach.ts — bộ lập kế hoạch THUẦN; chỉ `import type` kiểu của engine (KetQuaPhanLoai, BaoCaoDoiChieu…).
  //   · quet-nghia-vu-db.ts       — người chạy: gọi `phanLoaiNghiaVu` + `doiChieuBong` rồi GHI bảng chiếu + ngoại lệ. Không gọi `tinhHoaDon` (không lập hoá đơn),
  //                                 không nhà cung cấp, không sổ tiền — lưới `[QNW-*]` (quet-nghia-vu.wiring.test.ts) ghim các điều đó.
  // Route cron chỉ gọi `chayQuetBong` (lib), không import engine trực tiếp ⇒ KHÔNG nằm ở đây.
  const NOI_DUOC_PHEP: string[] = [
    "lib/finance/hoa-don/chinh-sach-phien-ban.ts",
    "lib/finance/hoa-don/chinh-sach-mo-phong.ts",
    "lib/finance/hoa-don/chinh-sach-db.ts",
    "lib/finance/hoa-don/quet-nghia-vu-ke-hoach.ts",
    "lib/finance/hoa-don/quet-nghia-vu-db.ts",
  ];
  /** Tệp `p` (đã bóc chú thích thành `src`) có import engine không — bằng đường tuyệt đối `@/lib/...` hoặc đường tương đối từ thư mục hoá đơn. */
  const nhacEngine = (p: string, src: string) => /finance\/hoa-don\/engine\b/.test(src) || (p.startsWith("lib/finance/hoa-don/") && /from\s+"\.\/engine\//.test(src));
  it("không tệp mã nào ngoài engine/ import nó (kể cả bằng đường tương đối từ thư mục hoá đơn)", () => {
    const goc = [...tepNguon("lib"), ...tepNguon("app"), ...tepNguon("components"), ...tepNguon("scripts")];
    const ngoaiEngine = goc.filter((p) => !p.startsWith(`${THU_MUC_ENGINE}/`));
    expect(ngoaiEngine.length).toBeGreaterThan(1000); // lưới không rỗng
    const noi = ngoaiEngine.filter((p) => nhacEngine(p, boChuThich(doc(p))));
    expect(noi.filter((p) => !NOI_DUOC_PHEP.includes(p))).toEqual([]);
  }, 60_000);
  it("ĐỐI CHỨNG DƯƠNG: mọi tệp trong danh sách cho phép TỒN TẠI và THẬT SỰ import engine (danh sách không cũ, không cho qua ngầm)", () => {
    for (const p of NOI_DUOC_PHEP) expect(nhacEngine(p, boChuThich(doc(p))), p).toBe(true);
  });
  it("ĐỐI CHỨNG: bộ bắt thật sự bắt — đường tuyệt đối, đường tương đối trong thư mục hoá đơn; bỏ qua chú thích", () => {
    expect(nhacEngine("app/x.ts", boChuThich('import { a } from "@/lib/finance/hoa-don/engine/tien-thue";'))).toBe(true);
    expect(nhacEngine("lib/finance/hoa-don/y.ts", boChuThich('import { a } from "./engine/chinh-sach";'))).toBe(true);
    expect(nhacEngine("lib/finance/z.ts", boChuThich('import { a } from "./engine/chinh-sach";'))).toBe(false); // thư mục khác: "./engine/" là của nó
    expect(nhacEngine("app/x.ts", boChuThich('// import "@/lib/finance/hoa-don/engine/tien-thue"\nconst a = 1;'))).toBe(false);
  });
  it("tệp dữ liệu mẫu chỉ được import bởi `*.test.ts` trong engine/", () => {
    const dung = tepNguon("lib", false).filter((p) => p !== `${THU_MUC_ENGINE}/du-lieu-mau.testdata.ts` && /du-lieu-mau\.testdata/.test(boChuThich(doc(p))));
    expect(dung.filter((p) => !(p.startsWith(`${THU_MUC_ENGINE}/`) && p.endsWith(".test.ts")))).toEqual([]);
    expect(dung.length).toBeGreaterThan(0); // có dùng thật — không phải lưới rỗng
  });
});

describe("[ENG-LUOI-05] không ai ngoài module hoá đơn nhắc bảng chiếu nghĩa vụ — trừ hai tệp KHAI CÁCH LY CƠ SỞ, và ở đó chỉ dưới dạng chuỗi tên model", () => {
  const TOKEN = /\bHoaDonNghiaVu\b|\bhoaDonNghiaVu\b/;
  // Seed nghiệm thu LOCAL (02/11/2026) ghi mẫu nghĩa vụ để người nghiệm thu có gì mà xem — chạy tay, có chốt chỉ-DB-local, không phải mã chạy thật.
  const cho = (p: string) =>
    p.startsWith("lib/finance/hoa-don/") || p.startsWith("app/(admin)/admin/payments/hoa-don/") || /^scripts\/dev\/seed-nghiem-thu-/.test(p);
  // S4 (01/11/2026): bảng đã có, và luật Nền #3 BUỘC khai nó ở `SCOPED_MODELS`/`getModelPrefixes()` (lib/db-scope.ts) và `BACKFILL_SPECS`
  // (lib/org/center-bridge.ts). Đúng hai tệp, đúng một dạng nhắc: chuỗi tên model `"HoaDonNghiaVu"` — KHÔNG phải truy cập delegate.
  const KHAI_CACH_LY = ["lib/db-scope.ts", "lib/org/center-bridge.ts"];
  it("quét lib · app · components · scripts: 0 lần nhắc ngoài hai thư mục của module hoá đơn và hai tệp khai cách ly", () => {
    const tep = [...tepNguon("lib"), ...tepNguon("app"), ...tepNguon("components"), ...tepNguon("scripts")];
    expect(tep.length).toBeGreaterThan(1000);
    expect(tep.filter((p) => !cho(p) && !KHAI_CACH_LY.includes(p) && TOKEN.test(boChuThich(doc(p))))).toEqual([]);
  });
  it("hai tệp khai cách ly: CÓ nhắc (đối chứng dương) và chỉ ở dạng chuỗi tên model — không `db.hoaDonNghiaVu`, không tên trần", () => {
    for (const p of KHAI_CACH_LY) {
      const src = boChuThich(doc(p));
      expect(src, p).toMatch(/"HoaDonNghiaVu"/);
      expect(TOKEN.test(src.replace(/"HoaDonNghiaVu"/g, "")), p).toBe(false);
    }
  });
  it("ĐỐI CHỨNG: bộ quét bắt token trong mã, bỏ qua trong chú thích", () => {
    expect(TOKEN.test(boChuThich("// HoaDonNghiaVu\nconst a = 1;"))).toBe(false);
    expect(TOKEN.test(boChuThich("const n = await db.hoaDonNghiaVu.findMany();"))).toBe(true);
  });
});

describe("[ENG-LUOI-06] số tiền của nghĩa vụ chỉ từ số ròng", () => {
  const src = boChuThich(doc(`${THU_MUC_ENGINE}/phan-loai-nghia-vu.ts`));
  it("`soTien` của khoản thu = `rong.get(...)` (soTienRong) hoặc độ lớn dòng âm / usedValue — không có đường thứ tư", () => {
    expect(src).toMatch(/soTien: rong\.get\(p\.id\) \?\? 0,/);
    expect(src).toMatch(/soTien: -p\.amount,/);
    expect(src).toMatch(/soTien: d\.usedValue,/);
    expect(src.match(/\bsoTien: (?!number)/g)).toHaveLength(3); // thêm nguồn số tiền thứ tư phải vào lưới này (khai kiểu `soTien: number` không tính)
  });
  it("`allocations` chỉ được đọc để NUÔI `gomLanThu` (đo lần thu), một lần, không cộng thành tiền", () => {
    expect(src.match(/\.allocations\b/g)).toHaveLength(1);
    expect(src).toMatch(/const phanBo = don\.paymentRequests\.flatMap\(\(r\) => r\.allocations\);/);
  });
  it("số ròng tính bằng `soTienRong(don.payments)` trên MỌI dòng của đơn (không lọc trước)", () => {
    expect(src).toMatch(/const rong = soTienRong\(don\.payments\);/);
    expect(src.match(/\bsoTienRong\(/g)).toHaveLength(1);
  });
});
