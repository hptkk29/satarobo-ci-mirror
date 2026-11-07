// Ca [LK-W*] — LƯỚI GHIM MÃ NGUỒN của Signature Engine (lệnh ký hoá đơn, Invoice Hub S9).
//
// Hành vi (vòng đời, đua nhau, tách nhiệm vụ, chéo cơ sở, hết hạn, lỗi bộ ký) đo ở `tests/finance/hoa-don-lenh-ky-db.test.ts` trên Postgres thật + các test thuần cùng thư mục.
// Lưới này khoá điều test hành vi KHÔNG chứng minh được vì là thứ mã KHÔNG làm / làm ở ĐÚNG chỗ:
//   · chỉ ghi vào `HoaDonLenhKy` (+ audit): không hoá đơn, đơn, khoản thu; không SQL thô;
//   · MỌI chuyển trạng thái đi qua MỘT hàm ghi có điều kiện trạng thái cũ + cơ sở, audit chỉ SAU khi ghi đúng 1 dòng và CÙNG giao dịch;
//   · bên trong `$transaction` không `ok: false` / không `catch` (từ chối = ném), và bộ ký KHÔNG bao giờ được gọi trong giao dịch;
//   · không đồng hồ trần; không PIN / khoá / thông điệp gốc của bộ ký; audit không mang hash; cơ sở lấy từ hoá đơn;
//   · chính sách duyệt không có mặc định ngầm; chỉ HSM + `=== true` mới bỏ qua bước duyệt.
// Cách viết (CLAUDE.md "lưới ghim mã nguồn"): đọc mã đã BÓC chú thích; neo vào lời gọi / biểu thức; đếm SỐ LẦN khớp; mỗi ca đã cấy lỗi để thấy ĐỎ.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
const doc = (f: string) => boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
const dem = (src: string, re: RegExp) => src.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))?.length ?? 0;
/** Thay nội dung chuỗi bằng rỗng để đếm ngoặc không vướng dấu ngoặc nằm trong chuỗi tiếng Việt. */
const boChuoi = (s: string) => s.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, "``");
/** Văn bản trong cặp ngoặc tròn bắt đầu tại `batDau` (ký tự `(`). */
function trongNgoac(src: string, batDau: number): string {
  let sau = 0;
  for (let k = batDau; k < src.length; k++) {
    if (src[k] === "(") sau++;
    else if (src[k] === ")" && --sau === 0) return src.slice(batDau + 1, k);
  }
  throw new Error("không khớp ngoặc");
}
const moi = (src: string, re: RegExp): number[] => [...src.matchAll(new RegExp(re.source, "g"))].map((m) => m.index!);

const DIR = "lib/finance/hoa-don";
const DB = `${DIR}/lenh-ky-db.ts`;
const TT = `${DIR}/lenh-ky-trang-thai.ts`;
const BK = `${DIR}/lenh-ky-bo-ky.ts`;
const GIA = `${DIR}/lenh-ky-bo-ky-gia.ts`;
const TAT_CA = [DB, TT, BK, GIA];

describe("[LK-W1] chỉ ghi vào HoaDonLenhKy (+ audit): không hoá đơn / đơn / khoản thu, không SQL thô", () => {
  const nguon = doc(DB);
  it("đúng MỘT `create` và MỘT `updateMany` trên hoaDonLenhKy; không update/delete/upsert/createMany/…", () => {
    expect(dem(nguon, /\bhoaDonLenhKy\.create\(/)).toBe(1);
    expect(dem(nguon, /\bhoaDonLenhKy\.updateMany\(/)).toBe(1);
    expect(dem(nguon, /\bhoaDonLenhKy\.(update|upsert|delete|deleteMany|createMany|updateManyAndReturn)\(/)).toBe(0);
  });
  it("không có phép ghi nào vào model khác (mọi `.create/.update*/.delete*/.upsert*` đều thuộc hoaDonLenhKy) và không SQL thô", () => {
    const ghi = [...nguon.matchAll(/\b(\w+)\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/g)].map((m) => m[1]);
    expect(ghi.sort()).toEqual(["hoaDonLenhKy", "hoaDonLenhKy"]);
    expect(dem(nguon, /\$executeRaw|\$queryRaw|\$executeRawUnsafe|\$queryRawUnsafe/)).toBe(0);
  });
  it("đọc hoá đơn đúng MỘT lần (findUnique chỉ để lấy cơ sở); không đụng order / payment", () => {
    expect(dem(nguon, /\bhoaDonDienTu\.findUnique\(/)).toBe(1);
    expect(dem(nguon, /\b(order|payment|hoaDonKhoan|hoaDonDong)\./)).toBe(0);
  });
});

describe("[LK-W2] mọi chuyển trạng thái đi qua MỘT hàm ghi có điều kiện; audit sau khi ghi đúng 1 dòng, cùng giao dịch", () => {
  const nguon = doc(DB);
  const ham = nguon.slice(nguon.search(/async function chuyenCoDieuKien\(/));
  const hamDen = ham.slice(0, ham.search(/\nconst DA_DOI = /));
  it("`updateMany` nằm TRONG hàm đó, where có trạng thái cũ (`trangThai: i.tu`) VÀ cơ sở (`centerId: i.row.centerId`)", () => {
    expect(dem(hamDen, /\bhoaDonLenhKy\.updateMany\(/)).toBe(1);
    expect(dem(hamDen, /\bid:\s*i\.row\.id,\s*trangThai:\s*i\.tu,\s*centerId:\s*i\.row\.centerId\b/)).toBe(1);
  });
  it("0 dòng ⇒ trả false TRƯỚC khi ghi audit (audit chỉ cho phép ghi đã xảy ra) và audit mang `tx`", () => {
    const dongDem = hamDen.search(/if \(upd\.count !== 1\) return false;/);
    const audit = hamDen.search(/await writeAudit\(\{/);
    expect(dongDem).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(dongDem);
    expect(dem(hamDen, /\bwriteAudit\(\{\s*tx,/)).toBe(1);
  });
  it("mọi nơi đổi trạng thái gọi hàm này: 1 định nghĩa + 6 lời gọi (tạo-đóng-cũ · duyệt · DA_KY · LOI_KY · huỷ · quét); chỉ ghi `trangThai` ở MỘT chỗ", () => {
    expect(dem(nguon, /\bchuyenCoDieuKien\(/)).toBe(7);
    expect(dem(nguon, /\.\.\.i\.data,\s*trangThai:\s*i\.den\b/)).toBe(1);
    expect(dem(nguon, /phuongThuc,\s*trangThai:\s*"CHO_KY",/)).toBe(1); // lệnh MỚI sinh ra ở CHO_KY, không trạng thái nào khác
  });
  it("tất cả `writeAudit` (2: hàm ghi + tạo) đều nằm trong giao dịch (mang `tx`)", () => {
    expect(dem(nguon, /\bwriteAudit\(\{/)).toBe(2);
    expect(dem(nguon, /\bwriteAudit\(\{\s*tx,/)).toBe(2);
  });
});

describe("[LK-W3] từ chối = ném trong giao dịch; bắt ở NGOÀI; bộ ký không bao giờ ở trong giao dịch", () => {
  const goc = doc(DB);
  const nguon = boChuoi(goc);
  const giaoDich = moi(nguon, /\$transaction\(/).map((i) => trongNgoac(nguon, i + "$transaction".length));
  it("tìm thấy đủ 5 giao dịch (tạo · duyệt · ghi kết quả · huỷ · quét) — nếu số này đổi, lưới phải được xét lại", () => {
    expect(giaoDich.length).toBe(5);
  });
  it("thân giao dịch không có `ok: false`, `return loi(`, `catch`, và KHÔNG gọi bộ ký (`.ky(`)", () => {
    for (const g of giaoDich) {
      expect(dem(g, /\bok:\s*false\b/)).toBe(0);
      expect(dem(g, /\breturn loi\(/)).toBe(0);
      expect(dem(g, /\bcatch\b/)).toBe(0);
      expect(dem(g, /\.ky\(/)).toBe(0);
    }
  });
  it("bộ ký được gọi đúng MỘT lần trong cả file, và lệnh gọi nằm TRƯỚC giao dịch ghi kết quả", () => {
    expect(dem(nguon, /\.ky\(/)).toBe(1);
    const goi = nguon.search(/\.ky\(/);
    const ghi = nguon.search(/await ghiKetQuaKy\(\{ actor: i\.actor, ten: i\.ten, lenhId: row\.id, ketQua,/);
    expect(goi).toBeGreaterThan(-1);
    expect(ghi).toBeGreaterThan(goi);
  });
  it("P2002 bắt đúng 1 lần, ở ngoài giao dịch (sau `return await db.$transaction`)", () => {
    expect(dem(goc, /"P2002"/)).toBe(1);
    const tx = goc.search(/return await db\.\$transaction\(async \(tx\) => \{\s*const song/);
    const p = goc.search(/"P2002"/);
    expect(tx).toBeGreaterThan(-1);
    expect(p).toBeGreaterThan(tx);
    expect(dem(goc, /e\.code === "P2002"/)).toBe(1);
  });
});

describe("[LK-W4] không đồng hồ trần, không PIN / khoá, không thông điệp gốc của bộ ký", () => {
  it("không `Date.now()` / `new Date()` trần ở bốn tệp mã miền", () => {
    for (const f of TAT_CA) {
      const s = doc(f);
      expect(dem(s, /\bDate\.now\s*\(/), f).toBe(0);
      expect(dem(s, /\bnew Date\s*\(\s*\)/), f).toBe(0);
    }
  });
  it("không định danh PIN / khoá riêng / mật khẩu / bí mật trong mã (tên biến, tên cột)", () => {
    for (const f of TAT_CA) {
      expect(dem(doc(f), /\b(pin|pinCode|maPin|otp|matKhau|passphrase|privateKey|khoaRieng|khoaBiMat|secretKey|apiKey|password)\b/i), f).toBe(0);
    }
  });
  it("bảng `HoaDonLenhKy` trong schema CHỈ có các cột đã duyệt — thêm cột (đặc biệt cột lưu bí mật) là đỏ", () => {
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const bat = schema.indexOf("model HoaDonLenhKy {");
    const khoi = schema.slice(bat, schema.indexOf("\n}", bat));
    const cot = khoi
      .split(/\r?\n/)
      .map((d) => d.trim())
      .filter((d) => d && !d.startsWith("///") && !d.startsWith("//") && !d.startsWith("@@") && !d.startsWith("model "))
      .map((d) => d.split(/\s+/)[0]!);
    expect(cot.sort()).toEqual(
      [
        "centerId", "chungThuHetHan", "createdAt", "duLieuCanKyHash", "hetHanLuc", "hoaDon", "hoaDonId", "id", "lyDo", "maGiaoDich", "nguoiKyId", "nguoiYeuCauId", "orgUnitId", "phuongThuc", "trangThai", "updatedAt",
        // 04/11/2026 (hub/13 §4) — phiên ký USB của VIN: mã phiên giao dịch (sống 30 phút, KHÔNG phải khoá/PIN), lúc lấy, và XML hoá đơn CHƯA ký
        // (nội dung hoá đơn, không phải bí mật) để đối chiếu XML đã ký. Chủ đích: không có cột nào chứa PIN / khoá riêng / mật khẩu.
        "maPhienNcc", "phienLayLuc", "xmlChuaKy",
        // 04/11/2026 (BGĐ) — AI ký · LÚC NÀO · bằng CHỨNG THƯ nào: serial chứng thư THỰC TẾ (số công khai trong chữ ký, không phải khoá) + lúc nhà cung cấp nhận chữ ký.
        "chungThuSerial", "kyLuc",
      ].sort(),
    );
  });
  it("thông điệp gốc của bộ ký / của lỗi bị ném KHÔNG được đọc ở lớp DB: không `.message`, không `thongDiepNgan`, không `String(e)`; log chỉ lấy `e.name`", () => {
    const s = doc(DB);
    // `.message` đọc đúng MỘT chỗ: thông điệp của lỗi nghiệp vụ tự định nghĩa (`TuChoiLenhKy`) trong `loi()`. Lỗi `unknown` (bộ ký, Prisma) không bao giờ bị đọc message.
    expect(dem(s, /\be\.message\b/)).toBe(1);
    expect(dem(s, /\bconst loi = \(e: TuChoiLenhKy\): LoiLenhKy => \(\{ ok: false, ma: e\.ma, error: e\.message,/)).toBe(1);
    expect(dem(s, /\berr\.message\b|\.thongDiepNgan\b/)).toBe(0);
    expect(dem(s, /\bString\(e\)/)).toBe(0);
    expect(dem(s, /\be instanceof Error \? e\.name\b/)).toBe(1);
  });
  it("audit không mang hash: không đối tượng `newValues:` / `oldValues:` / `reason:` nào nhắc tới hash hay mã giao dịch", () => {
    const s = doc(DB);
    const doan = [...s.matchAll(/\b(newValues|oldValues|reason):[^\n]*/g)].map((m) => m[0]);
    expect(doan.length).toBeGreaterThan(8);
    // `chungThuSerial` được phép (số serial công khai, BGĐ 04/11/2026: nhật ký phải nói chứng thư nào đã ký); mọi thứ khác của chứng thư (hạn · dấu vân tay) và hash / mã giao dịch thì không.
    for (const d of doan) expect(d, d).not.toMatch(/Hash|maGiaoDich|chungThu(?!Serial)/);
  });
});

describe("[LK-W5] đầu vào, cơ sở và quyền", () => {
  const nguon = doc(DB);
  it("kiểm hash + phương thức + hạn TRƯỚC mọi phép đọc DB của `taoLenhKy`", () => {
    const tao = nguon.slice(nguon.search(/export async function taoLenhKy\(/));
    const doc1 = tao.search(/\bdb\.hoaDonDienTu\.findUnique\(/);
    for (const re of [/laPhuongThucKy\(i\.phuongThuc\)/, /laHashHopLe\(i\.duLieuCanKyHash\)/, /tinhHetHan\(i\.now, i\.ttlPhut\)/]) {
      const vt = tao.search(re);
      expect(vt, String(re)).toBeGreaterThan(-1);
      expect(vt, String(re)).toBeLessThan(doc1);
    }
  });
  it("cơ sở của lệnh đến từ HOÁ ĐƠN: `centerId: hd.centerId` đúng 1 lần; không có `i.centerId` (đầu vào không có chỗ truyền)", () => {
    expect(dem(nguon, /\bcenterId:\s*hd\.centerId\b/)).toBe(1);
    expect(dem(nguon, /\bi\.centerId\b/)).toBe(0);
  });
  it("cổng cơ sở: `duocThaoTac` (kế toán tại cơ sở ∧ tầm nhìn) dùng ở 4 nơi đọc lệnh; tạo dùng `coQuyenKeToanTaiCoSo(i.actor, hd.centerId)` ∧ passesScope; không so role", () => {
    expect(dem(nguon, /\bduocThaoTac\(/)).toBe(5); // 1 định nghĩa + duyệt + ghi kết quả + đọc DANG_KY + huỷ
    expect(dem(nguon, /\bcoQuyenKeToanTaiCoSo\(/)).toBe(2); // trong duocThaoTac + tạo
    expect(dem(nguon, /\bcoQuyenKeToanTaiCoSo\(i\.actor, hd\.centerId\)/)).toBe(1);
    expect(dem(nguon, /\bpassesScope\(/)).toBe(2);
    expect(dem(nguon, /\.roles?\b|\brole\s*===|isSuperAdmin/)).toBe(0);
  });
  it("lệnh không thấy / cơ sở khác / ngoài tầm nhìn cùng MỘT câu 'không tìm thấy' (không để dò id)", () => {
    expect(dem(nguon, /\bKHONG_THAY\(\)/)).toBe(4);
    expect(dem(nguon, /new TuChoiLenhKy\("KHONG_THAY"/)).toBe(1); // trong KHONG_THAY()
  });
  it("quét hết hạn: `phamVi` bắt buộc (không `??`, không giá trị mặc định), rỗng ⇒ không đụng gì, lọc cơ sở khi không phải ALL, và coi hạn NULL là quá hạn", () => {
    const quet = nguon.slice(nguon.search(/export async function quetHetHan\(/));
    expect(dem(quet, /\bphamVi\s*\?\?|\bphamVi\s*=\s/)).toBe(0);
    expect(dem(quet, /i\.phamVi !== "ALL" && i\.phamVi\.length === 0\) return \{ soLenh: 0 \}/)).toBe(1);
    expect(dem(quet, /i\.phamVi === "ALL" \? \{\} : \{ centerId: \{ in: \[\.\.\.i\.phamVi\] \} \}/)).toBe(1);
    expect(dem(quet, /OR: \[\{ hetHanLuc: null \}, \{ hetHanLuc: \{ lte: i\.now \} \}\]/)).toBe(1);
    expect(dem(quet, /take: TOI_DA_MOI_LAN_QUET/)).toBe(1);
  });
});

describe("[LK-W6] chính sách duyệt: không mặc định ngầm; chỉ HSM + `=== true` mới bỏ qua bước duyệt", () => {
  const tt = doc(TT);
  const db = doc(DB);
  it("lớp DB nhận `chinhSach` BẮT BUỘC: không `chinhSach?`, không `chinhSach =`, không import hằng nghiêm nhất", () => {
    expect(dem(db, /\bchinhSach\s*\?:|\bchinhSach\s*=\s|\bchinhSach\s*\?\?/)).toBe(0);
    expect(dem(db, /CHINH_SACH_KY_NGHIEM_NHAT/)).toBe(0);
    expect(dem(db, /\bchinhSach:\s*ChinhSachDuyetKy\b/)).toBe(2); // duyệt + hoàn tất
  });
  it("`canDuyet`: mọi phương thức ≠ HSM_NHA_CUNG_CAP luôn CẦN duyệt, HSM chỉ khi `hsmTuKy` không đúng `true`", () => {
    const ham = tt.slice(tt.search(/export function canDuyet\(/));
    const than = ham.slice(0, ham.search(/\n}\n/));
    expect(dem(than, /if \(phuongThuc !== "HSM_NHA_CUNG_CAP"\) return true;/)).toBe(1);
    expect(dem(than, /return !chinhSachChoCoSo\(chinhSach, centerId\)\.hsmTuKy;/)).toBe(1);
  });
  it("`hsmTuKy` chỉ nhận đúng `true` (so sánh nghiêm) ở cả hai nơi dựng quy tắc; `khacNguoi` chỉ nới khi đúng `false`", () => {
    expect(dem(tt, /m\.hsmTuKy === true/)).toBe(2);
    expect(dem(tt, /kn\[pt\] === false/)).toBe(2);
    expect(dem(tt, /hsmTuKy:\s*false,\s*\n?\s*khacNguoi:/)).toBe(1); // quy tắc nghiêm nhất
  });
  it("cơ sở lấy bằng `hasOwn` (id 'constructor' / '__proto__' không đọc nhầm prototype), mục thiếu ⇒ nghiêm nhất", () => {
    expect(dem(tt, /Object\.hasOwn\(theoCoSo, centerId\)/)).toBe(1);
    expect(dem(tt, /Object\.fromEntries\(ra\)/)).toBe(1);
  });
  it("hạn lệnh: không hạn ⇒ quá hạn; `>=` tại mốc; ttl không có mặc định", () => {
    expect(dem(tt, /if \(!hetHanLuc\) return true;/)).toBe(1);
    expect(dem(tt, /now\.getTime\(\) >= hetHanLuc\.getTime\(\)/)).toBe(1);
    expect(dem(tt, /ttlPhut\s*=\s|ttlPhut\?:/)).toBe(0);
  });
});

describe("[LK-W7] không đẻ cờ mới, không nối dây, không sửa tệp có sẵn", () => {
  it("bốn tệp không import cờ / cấu hình / feature (không cờ mới)", () => {
    for (const f of TAT_CA) expect(dem(doc(f), /from "\.\/feature"|getSetting|\.\.\/flags|@\/lib\/flags/), f).toBe(0);
  });
  it("tệp luật thuần và giao diện bộ ký không chạm DB / server-only", () => {
    for (const f of [TT, BK, GIA]) {
      const s = doc(f);
      expect(dem(s, /@\/lib\/db|server-only|@prisma\/client/), f).toBe(0);
    }
  });
  it("giao diện bộ ký tái dùng KIỂU năng lực TD-05 (type-only), không sửa NANG_LUC", () => {
    const s = doc(BK);
    expect(dem(s, /import type \{ KhaiNangLuc \} from "\.\/nha-cung-cap\/nang-luc";/)).toBe(1);
    expect(dem(s, /adapterImplements === true && bo\.nangLuc\.providerSupports === "CO"/)).toBe(1);
  });
});
