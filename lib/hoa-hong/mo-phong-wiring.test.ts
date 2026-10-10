// @vitest-environment node
/**
 * [NHH-POL-10-W*] — LƯỚI GHIM MÃ NGUỒN cho THỬ TÍNH chính sách (04 §14, 05 PR10).
 *
 * Vì sao cần lưới thay vì chỉ ca hành vi: bất biến "thử tính KHÔNG GHI GÌ" bị phá bởi MỘT dòng thêm vào (một `.create(`, một `ghiSo`, một
 * `publishEvent`) mà mọi ca tính-số vẫn xanh. Ca DB `[NHH-POL-10]` đếm 17 bảng — nhưng chỉ những bảng nó đếm. Lưới này canh CHÍNH MÃ.
 *
 * Khuôn "lưới ghim mã nguồn" (CLAUDE.md): đọc mã ĐÃ BỎ CHÚ THÍCH, neo hẹp, đếm SỐ LẦN khớp, không cờ `/s`. Mỗi ca đã được cấy lại lỗi để thấy đỏ
 * (bảng cấy ở docs/source-commission/05, mục "Trạng thái thi công — PR10").
 *
 *   [NHH-POL-10-W1]  CÙNG lõi với engine thật: gọi `tinhDongChoKhoan` đúng 2 lần (hiện tại / đề xuất); lấy đầu vào từ `lapThu`; không công thức tiền riêng
 *   [NHH-POL-10-W2]  CHỈ ĐỌC: không token ghi / giao dịch / sự kiện / audit / làm mới trang; import chỉ trong danh sách cho phép; từ `quet-khoan` chỉ `lapThu`
 *   [NHH-POL-10-W3]  luật 19 + 7: không đọc đồng hồ, `now` không mặc định; nguy hiểm không có mặc định (tranSoKhoan bắt buộc)
 *   [NHH-POL-10-W4]  cách ly: bản nháp tra qua `scopedDb`, phạm vi cơ sở lọc HAI lớp, engine thật không phụ thuộc thử tính (không import ngược)
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();
const DIR = "lib/hoa-hong";

/** Bỏ chú thích dòng TRƯỚC, khối SAU (chú thích dòng hay nhắc `lib/x/*` — chuỗi đó mở một "khối" giả nuốt mã thật). */
function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

const FILE_MO_PHONG = readdirSync(resolve(GOC, DIR))
  .filter((f) => /^mo-phong[\w-]*\.ts$/.test(f) && !f.endsWith(".test.ts"))
  .sort();
const NOI_DUNG = new Map(FILE_MO_PHONG.map((f) => [f, doc(`${DIR}/${f}`)]));
const hop = (f: string) => NOI_DUNG.get(f)!;

/** `import … from "x"` (kể cả nhiều dòng) → { spec, ten: tên import có tên, loaiType: import type }. */
function cacImport(src: string): { spec: string; ten: string[]; chiType: boolean }[] {
  return [...src.matchAll(/import\s+(type\s+)?([\s\S]*?)\s+from\s+"([^"]+)"/g)].map((m) => {
    const trongNgoac = /\{([\s\S]*?)\}/.exec(m[2]!);
    const ten = trongNgoac ? trongNgoac[1]!.split(",").map((x) => x.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!).filter(Boolean) : [];
    return { spec: m[3]!, ten, chiType: m[1] !== undefined };
  });
}

describe("[NHH-POL-10-W0] tập tệp thử tính", () => {
  it("[NHH-POL-10-W0a] đúng bốn tệp mo-phong*.ts: lõi · nạp DB · điều phối · luật hiển thị (thêm tệp mới thì lưới này phải biết — nó quét theo tên)", () => {
    expect(FILE_MO_PHONG).toEqual(["mo-phong-db.ts", "mo-phong-hanh-dong.ts", "mo-phong-ui.ts", "mo-phong.ts"]);
  });
});

describe("[NHH-POL-10-W1] CÙNG lõi với engine thật", () => {
  it("[NHH-POL-10-W1a] mo-phong.ts import `tinhDongChoKhoan` từ tệp của engine và gọi ĐÚNG HAI LẦN (hiện tại · đề xuất)", () => {
    const src = hop("mo-phong.ts");
    const nhap = cacImport(src).filter((i) => i.spec === "./tinh-dong-cho-khoan");
    expect(nhap).toHaveLength(1);
    expect(nhap[0]!.ten).toContain("tinhDongChoKhoan");
    expect(dem(src, /\btinhDongChoKhoan\(/g)).toBe(2);
    expect(dem(src, /hoaHong:\s*cauHinh\.hienTai/g)).toBe(1);
    expect(dem(src, /hoaHong:\s*cauHinh\.deXuat/g)).toBe(1);
  });

  it("[NHH-POL-10-W1b] mo-phong-db.ts lấy đầu vào bằng `lapThu` (đúng một lời gọi) và đưa `kh.dauVao` cho `tinhHaiKichBan` — không dựng đầu vào riêng", () => {
    const src = hop("mo-phong-db.ts");
    expect(dem(src, /\blapThu\(/g)).toBe(1);
    expect(dem(src, /tinhHaiKichBan\(\s*kh\.dauVao,\s*kh\.vat\.netBase,\s*cauHinh\)/g)).toBe(1);
    // không tự gọi các bước dựng đầu vào của engine (đó là việc của lapThu)
    expect(dem(src, /\bdungDauVaoChinhSach\(|\bphanLoaiDongDon\(|\bphanBoKhoan\(|\bchuSoHuuButToan\(|\bphanGiaiNguoiHuong\(/g)).toBe(0);
  });

  it("[NHH-POL-10-W1c] KHÔNG có công thức tiền trong thử tính: không nhân tỉ lệ, không làm tròn tiền, không chia người", () => {
    for (const f of FILE_MO_PHONG) {
      const src = hop(f);
      expect(dem(src, /\btienPhanTram\(|\blamTronTien\(|\bchiaTienChoVai\(|\btienTheoQuyTac\(|\bkiemTran\(|\btachVat\(/g), f).toBe(0);
      // duy nhất: đếm NGÀY của khoảng (mo-phong.ts) và làm tròn TỈ LỆ hiển thị (mo-phong-ui.ts, 3 chỗ) — không có tiền nào
      expect(dem(src, /Math\.round\(|Math\.floor\(|Math\.ceil\(/g), f).toBe(f === "mo-phong.ts" ? 1 : f === "mo-phong-ui.ts" ? 3 : 0);
    }
  });

  it("[NHH-POL-10-W1d] bối cảnh thử tính: mốc cutover giả CHO MỌI THÁNG và nạp người hưởng cho vai của CẢ HAI bộ (hop)", () => {
    const src = hop("mo-phong-db.ts");
    expect(dem(src, /kyCutover:\s*KY_SOM_NHAT/g)).toBe(1);
    expect(dem(src, /hoaHong:\s*\{\s*\.\.\.i\.bc\.hoaHong,\s*quyTac:\s*kb\.hop\s*\}/g)).toBe(1);
    expect(dem(src, /export const KY_SOM_NHAT = "0001-01"/g)).toBe(1);
  });
});

describe("[NHH-POL-10-W2] CHỈ ĐỌC", () => {
  const TOKEN_GHI: [string, RegExp][] = [
    ["create/createMany/update/updateMany/upsert/delete/deleteMany", /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g],
    ["$transaction", /\$transaction/g],
    ["$executeRaw", /\$executeRaw/g],
    ["$queryRaw", /\$queryRaw/g],
    ["ghiSo / chayTrongKhoa / taoO / khoaKyDeGhi", /\bghiSo\b|\bchayTrongKhoa\b|\btaoO\(|\bkhoaKyDeGhi\b|\bghiChenhLech\b|\bghiMoiThu\b/g],
    ["ghiHangCho / danhDauDaDung / danhDauOKhop", /\bghiHangCho\b|\bdanhDauDaDung\b|\bdanhDauOKhop\b/g],
    ["publishEvent / writeAudit", /\bpublishEvent\b|\bwriteAudit\b/g],
    ["revalidatePath / revalidateTag", /\brevalidate(Path|Tag)\b/g],
    ["setSetting / setGlobalSetting", /\bsetSetting\b|\bsetGlobalSetting\b/g],
    ["gửi tin / email", /\bsendEmail\b|\bgui[A-Z]\w*\(|\bnotify\w*\(/g],
  ];
  for (const f of FILE_MO_PHONG) {
    it(`[NHH-POL-10-W2a] ${f}: không có token GHI nào (0 lần mỗi loại)`, () => {
      for (const [ten, re] of TOKEN_GHI) expect(dem(hop(f), re), `${f} chứa ${ten}`).toBe(0);
    });
  }

  it("[NHH-POL-10-W2b] import tương đối CHỈ trong danh sách cho phép; từ `quet-khoan` chỉ `lapThu` (không phải mọi hàm ghi của nó)", () => {
    const CHO_PHEP: Record<string, readonly string[] | "TAT_CA"> = {
      "./boi-canh": ["BoiCanhQuet", "dungBoiCanhTuMoc"],
      "./but-toan": ["loaiButToan"],
      "./chon-quy-tac": ["QuyTac"],
      "./chinh-sach-service": ["coSoTrongPhamVi", "docQuyTacCuaVersion"],
      "./chinh-sach-doc": ["tamNhinChinhSach"],
      "./kieu": ["HoaHongContext", "HoaHongError"],
      "./mo-phong": "TAT_CA",
      "./mo-phong-db": "TAT_CA",
      "./nap-khoan": ["conThucThu", "docKhoan", "hangButToanCua"],
      "./hang-rao-ui": ["ngayDMY"],
      "./huong-xu-ly-tran": ["DUONG_CAU_HINH_TRAN", "dungHuongXuLyTran", "loiKhuyenNangTran"], // lời khuyên nâng trần (09/10/2026) — thuần, an toàn cho client
      "./ngay-lam-viec": ["ngayHopLe", "dauNgayVN", "ngayVN"],
      "./quet-khoan": ["lapThu"],
      "./tinh-dong-cho-khoan": ["tinhDongChoKhoan", "DauVaoKhoan", "KetQuaTinhKhoan"],
      "./vi-sao": ["dinhDangDong", "dinhDangSo"], // định dạng tiền + số DUY NHẤT của module — thuần, không chạm DB
    };
    for (const f of FILE_MO_PHONG) {
      for (const i of cacImport(hop(f)).filter((x) => x.spec.startsWith("./"))) {
        const cho = CHO_PHEP[i.spec];
        expect(cho, `${f} import "${i.spec}" ngoài danh sách cho phép`).toBeDefined();
        if (cho !== "TAT_CA") for (const t of i.ten) expect(cho, `${f}: "${t}" từ ${i.spec}`).toContain(t);
      }
    }
    const tuQuet = FILE_MO_PHONG.flatMap((f) => cacImport(hop(f)).filter((x) => x.spec === "./quet-khoan"));
    expect(tuQuet).toHaveLength(1); // chỉ mo-phong-db.ts
    expect(tuQuet[0]!.ten).toEqual(["lapThu"]);
  });

  it("[NHH-POL-10-W2c] import tuyệt đối: chỉ hằng/ kiểu / client đọc — không audit, sự kiện, cache, email, storage", () => {
    const CHO_PHEP = new Set(["@prisma/client", "@/lib/finance/thuc-thu", "@/lib/db", "@/lib/db-scope", "@/lib/auth/actor"]);
    for (const f of FILE_MO_PHONG) {
      for (const i of cacImport(hop(f)).filter((x) => !x.spec.startsWith("./"))) expect(CHO_PHEP.has(i.spec), `${f} import "${i.spec}"`).toBe(true);
    }
    // `@prisma/client` chỉ để lấy KIỂU
    for (const f of FILE_MO_PHONG) for (const i of cacImport(hop(f)).filter((x) => x.spec === "@prisma/client")) expect(i.chiType, f).toBe(true);
  });

  it("[NHH-POL-10-W2d] `docQuyTacCuaVersion` (thêm vào service cho thử tính) cũng CHỈ ĐỌC: thân hàm không có token ghi", () => {
    const src = doc(`${DIR}/chinh-sach-service.ts`);
    const i = src.indexOf("export async function docQuyTacCuaVersion");
    expect(i).toBeGreaterThan(-1);
    const than = src.slice(i, src.indexOf("\n}\n", i));
    expect(than.length).toBeGreaterThan(50);
    expect(dem(than, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$transaction|\$executeRaw|writeAudit|publishEvent/g)).toBe(0);
    expect(dem(than, /anhXaVersion\(client,\s*\[v\],\s*"ACTIVE"\)/g)).toBe(1);
  });
});

describe("[NHH-POL-10-W3] đồng hồ và mặc định", () => {
  it("[NHH-POL-10-W3a] không đọc đồng hồ thật ở BẤT KỲ tệp thử tính nào (luật 19): không `new Date()` rỗng, không Date.now / performance.now", () => {
    for (const f of FILE_MO_PHONG) {
      expect(dem(hop(f), /new Date\(\s*\)|Date\.now\(|performance\.now\(/g), f).toBe(0);
    }
  });

  it("[NHH-POL-10-W3b] `now` BẮT BUỘC: không tham số `now` có mặc định / tuỳ chọn", () => {
    for (const f of FILE_MO_PHONG) {
      expect(dem(hop(f), /\bnow\s*=\s*[^=>]|\bnow\?\s*:/g), f).toBe(0);
    }
    expect(dem(hop("mo-phong-db.ts"), /\bnow:\s*Date\b/g)).toBe(1);
    expect(dem(hop("mo-phong-hanh-dong.ts"), /\bnow:\s*Date\b/g)).toBe(1);
  });

  it("[NHH-POL-10-W3c] `tranSoKhoan` BẮT BUỘC (không mặc định ngầm): khai kiểu `number`, kiểm số nguyên dương, dùng làm `take`", () => {
    const src = hop("mo-phong-db.ts");
    expect(dem(src, /tranSoKhoan:\s*number;/g)).toBe(1);
    expect(dem(src, /take:\s*i\.tranSoKhoan\b/g)).toBe(1);
    expect(dem(src, /Number\.isInteger\(i\.tranSoKhoan\)\s*\|\|\s*i\.tranSoKhoan\s*<\s*1/g)).toBe(1);
    expect(dem(src, /tranSoKhoan\s*=\s*\d|tranSoKhoan\?:/g)).toBe(0);
  });

  it("[NHH-POL-10-W3d] cắt thì NÓI: kết quả có `cat`, tính từ số khoản dương so với số đã lấy — không cắt im lặng", () => {
    const src = hop("mo-phong-db.ts");
    expect(dem(src, /const cat = soDuong > duong\.length \?/g)).toBe(1);
    expect(dem(src, /\bcat,\s*$/gm)).toBe(1); // trả `cat` ra ngoài
  });
});

describe("[NHH-POL-10-W4] cách ly và hướng phụ thuộc", () => {
  it("[NHH-POL-10-W4a] bản nháp tra qua `scopedDb(actor)` (đúng 1 lần), KHÔNG tra bằng `db` trần; tầm nhìn cơ sở đi từ `tamNhinChinhSach(actor)`", () => {
    const src = hop("mo-phong-hanh-dong.ts");
    expect(dem(src, /scopedDb\(a\.actor\)\.commissionPolicyVersion\.findUnique\(/g)).toBe(1);
    expect(dem(src, /\bdb\.commissionPolicy(Version)?\./g)).toBe(0);
    expect(dem(src, /coSoTrongTamNhin:\s*tamNhinChinhSach\(a\.actor\)/g)).toBe(1);
    // bản nháp không thấy ⇒ trả TRƯỚC khi tính, cùng câu với "không tồn tại"
    const iTra = src.indexOf("scopedDb(a.actor).commissionPolicyVersion.findUnique(");
    const iTinh = src.indexOf("moPhongChinhSach({");
    expect(iTra).toBeGreaterThan(-1);
    expect(iTinh).toBeGreaterThan(iTra);
    expect(dem(src, /if \(!ver\) return \{ ok: false, chung: KHONG_THAY \}/g)).toBe(1);
  });

  it("[NHH-POL-10-W4b] phạm vi cơ sở lọc HAI lớp: trong câu truy vấn (`dieuKienCoSo`) VÀ sau `lapThu` theo cơ sở engine quy (`kh.co.centerId`)", () => {
    const src = hop("mo-phong-db.ts");
    expect(dem(src, /dieuKienCoSo\(\[\.\.\.tap\]\)/g)).toBe(1);
    expect(dem(src, /tap\s*!==\s*null\s*&&\s*!tap\.has\(kh\.co\.centerId\)/g)).toBe(1);
    // tầm nhìn rỗng KHÔNG được hiểu thành "không giới hạn": nhánh "ALL" là nhánh duy nhất bỏ giới hạn tầm nhìn
    expect(dem(src, /if \(tamNhin === "ALL"\) return trongPhamVi;/g)).toBe(1);
  });

  it("[NHH-POL-10-W4c] engine thật KHÔNG import thử tính (hướng phụ thuộc: thử tính → engine, không ngược lại)", () => {
    const tapEngine = readdirSync(resolve(GOC, DIR)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith("mo-phong"));
    for (const f of tapEngine) {
      expect(dem(doc(`${DIR}/${f}`), /from\s+"\.\/mo-phong[\w-]*"|from\s+"@\/lib\/hoa-hong\/mo-phong[\w-]*"/g), f).toBe(0);
    }
  });

  it("[NHH-POL-10-W4d] chỉ Server Action `_actions.ts` và tệp thử tính nhắc `mo-phong-hanh-dong` / `mo-phong-db` (không rò sang chỗ khác)", () => {
    const duyet = (d: string, ra: string[]) => {
      for (const e of readdirSync(resolve(GOC, d), { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name !== "node_modules" && e.name !== ".next" && !e.name.startsWith(".")) duyet(p, ra);
        } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) ra.push(p);
      }
    };
    const tat: string[] = [];
    for (const d of ["lib", "app", "components"]) duyet(d, tat);
    const nhacDen = tat.filter((p) => /hoa-hong\/mo-phong-(hanh-dong|db)"|\.\/mo-phong-(hanh-dong|db)"/.test(readFileSync(resolve(GOC, p), "utf8")));
    expect(nhacDen.sort()).toEqual(["app/(admin)/admin/nguon-hoa-hong/chinh-sach/_actions.ts", "lib/hoa-hong/mo-phong-hanh-dong.ts"]);
  });
});

describe("[NHH-POL-10-W5] giao diện bước 'Thử tính' (luật 12: vẽ bằng key nào thì máy chủ hỏi đúng key đó)", () => {
  const T = "app/(admin)/admin/nguon-hoa-hong/chinh-sach";
  const soan = doc(`${T}/_components/trinh-soan.tsx`);

  it("[NHH-POL-10-W5a] trình soạn gọi `thuTinhAction` ĐÚNG MỘT chỗ, với versionId ĐÃ LƯU + ba tham số; nút hỏi quyền bằng `p.thuTinh.coQuyen` (tách `coQuyenSoan`)", () => {
    expect(dem(soan, /\bthuTinhAction\(/g)).toBe(1);
    expect(dem(soan, /thuTinhAction\(\{ versionId: luu\.versionId, tuNgay: t\.tuNgay, denNgay: t\.denNgay, orgUnitId: t\.orgUnitId \}\)/g)).toBe(1);
    expect(dem(soan, /quyetDinhNutThuTinh\(\{ coQuyen: p\.thuTinh\.coQuyen, laBanNhap, daLuu: luu !== null, coThayDoiChuaLuu: dirty \}\)/g)).toBe(1);
    expect(dem(soan, /coQuyen:\s*p\.coQuyenSoan/g)).toBe(0);
  });

  it("[NHH-POL-10-W5b] `ThuTinhThat` đứng NGOÀI `<fieldset disabled>` (người chỉ-đọc vẫn chạy được: thử tính không ghi gì)", () => {
    expect(dem(soan, /<ThuTinhThat\b/g)).toBe(1);
    const iThu = soan.indexOf("<ThuTinhThat");
    const iMo = soan.indexOf("<fieldset");
    const iDong = soan.indexOf("</fieldset>");
    expect(iMo).toBeGreaterThan(-1);
    expect(iThu).toBeGreaterThan(iDong);
  });

  it("[NHH-POL-10-W5c] hộp thoại kích hoạt nhận `tacDong` từ MỘT hàm (`tomTatTacDong` với độ cũ) — không còn câu cố định 'chưa có'", () => {
    expect(dem(soan, /tomTatTacDong\(thu, tuoiThu\)/g)).toBe(1);
    expect(dem(soan, /tacDong=\{tacDong\}/g)).toBe(1);
    expect(dem(soan, /const tuoiThu = thu\.kieu === "xong" \? tuoiKetQua\(thu, luu, dirty\) : null/g)).toBe(1);
    const kich = doc(`${T}/_components/buoc-kich-hoat.tsx`);
    expect(dem(kich, /chưa thử tính được/g)).toBe(0);
    expect(dem(kich, /tacDong\.dong\.map/g)).toBe(1);
    const cacBuoc = doc(`${T}/_components/cac-buoc.tsx`);
    expect(dem(cacBuoc, /Chưa có\. Tính năng này/g)).toBe(0);
  });

  it("[NHH-POL-10-W5d] nút 'Chạy thử' do `quyetDinh` quyết: chỉ vẽ form khi `quyetDinh.ve`, nút tắt khi `!quyetDinh.bamDuoc || dangChay`, lý do gắn aria-describedby", () => {
    const that = doc(`${T}/_components/thu-tinh-that.tsx`);
    expect(dem(that, /\{quyetDinh\.ve \? \(/g)).toBe(1);
    expect(dem(that, /disabled=\{!quyetDinh\.bamDuoc \|\| dangChay\}/g)).toBe(1);
    expect(dem(that, /aria-describedby=\{quyetDinh\.lyDo \? idLyDo : undefined\}/g)).toBe(1);
    expect(dem(that, /if \(!quyetDinh\.bamDuoc \|\| dangChay \|\| loiKhoang\) return;/g)).toBe(1);
    expect(dem(that, /kiemKhoang\(tuNgay, denNgay\)/g)).toBe(1);
  });

  it("[NHH-POL-10-W5e] hai trang soạn truyền `thuTinh` với quyền = ĐÚNG key của action và khoảng mặc định do MÁY CHỦ tính", () => {
    for (const f of ["moi/page.tsx", "[policyId]/soan/page.tsx"]) {
      const src = doc(`${T}/${f}`);
      expect(dem(src, /thuTinh=\{\{ coQuyen: scope\.has\("commission_policies:manage"\), khoangMacDinh: khoangMacDinh\((?:now|new Date\(\))\) \}\}/g), f).toBe(1);
    }
  });

  it("[NHH-POL-10-W5f] tệp phía CLIENT của thử tính không kéo mã máy chủ (DB, nạp engine, server-only)", () => {
    const clients = [`${T}/_components/thu-tinh-that.tsx`, `${T}/_components/thu-tinh-ket-qua.tsx`, `${DIR}/mo-phong-ui.ts`, `${DIR}/mo-phong.ts`];
    for (const f of clients) {
      for (const i of cacImport(doc(f))) {
        expect(/@\/lib\/db|mo-phong-db|mo-phong-hanh-dong|quet-khoan|server-only/.test(i.spec), `${f} import "${i.spec}"`).toBe(false);
      }
    }
    expect(readFileSync(resolve(GOC, `${T}/_components/thu-tinh-that.tsx`), "utf8").trimStart().startsWith('"use client"')).toBe(true);
  });
});
