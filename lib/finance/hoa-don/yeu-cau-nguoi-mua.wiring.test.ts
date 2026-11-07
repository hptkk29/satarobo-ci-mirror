// Ca [YCM-W*] — LƯỚI GHIM MÃ NGUỒN của yêu cầu thu thập thông tin người mua (Invoice Hub đợt 2, S11 phần độc lập).
//
// Hành vi (vòng đời, khoá sau N lần sai, đua, chéo cơ sở, rò rỉ) đo ở `tests/finance/hoa-don-yeu-cau-nguoi-mua-db.test.ts` + `yeu-cau-nguoi-mua.test.ts`. Lưới này khoá điều test hành vi
// không chứng minh được vì là thứ mã KHÔNG làm / làm ở ĐÚNG chỗ:
//   · không có cột / biến / khoá nào cho giấy tờ tuỳ thân (kể cả trong khối model của schema);
//   · chỉ ghi bảng `hoaDonYeuCauNguoiMua` (+ AuditLog); không đụng đơn / hoá đơn / tiền; không SQL thô ngoài khoá tư vấn;
//   · không đọc đồng hồ, không `console.*`, không ngẫu nhiên ngoài `sinhToken`;
//   · mọi `updateMany` có điều kiện `trangThai` VÀ `centerId`; mọi truy vấn nhân viên có `centerId`;
//   · audit không mang token / hash / giá trị ô; `tokenHash` chỉ được chọn ở đường công khai;
//   · so khớp hash đi qua `timingSafeEqual`; TTL và thời hạn giữ là tham số, không hằng ẩn.
// Cách viết (CLAUDE.md "lưới ghim mã nguồn"): đọc mã đã BÓC chú thích; neo vào lời gọi / biểu thức; đếm SỐ LẦN khớp (chú thích giải thích bản vá hay chứa đúng chuỗi đang cấm); mỗi ca đã cấy lỗi để thấy ĐỎ.
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

const DIR = "lib/finance/hoa-don";
const THUAN = `${DIR}/yeu-cau-nguoi-mua.ts`;
const TOKEN = `${DIR}/yeu-cau-nguoi-mua-token.ts`;
const DB = `${DIR}/yeu-cau-nguoi-mua-db.ts`;

/** Cắt mọi lời gọi `<tien-to>(`…`)` theo ngoặc đơn cân bằng. */
function cacLoiGoi(src: string, tienTo: RegExp): string[] {
  const ra: string[] = [];
  const re = new RegExp(tienTo.source, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const mo = src.indexOf("(", m.index + m[0].length - 1);
    let sau = 0;
    for (let i = mo; i < src.length; i += 1) {
      if (src[i] === "(") sau += 1;
      else if (src[i] === ")") {
        sau -= 1;
        if (sau === 0) {
          ra.push(src.slice(m.index, i + 1));
          break;
        }
      }
    }
  }
  return ra;
}

describe("[YCM-W1] giấy tờ tuỳ thân: CHỈ CCCD (của ba/mẹ + học viên, chủ dự án chốt 02/11/2026), nằm trong JSON `duLieuGui`, KHÔNG có cột riêng, KHÔNG có giấy tờ nào khác", () => {
  // Trước 02/11/2026 lưới này cấm CẢ `cccd`. Chủ dự án đảo: form QR thu CCCD (cùng khối «Người mua trên hoá đơn»). Còn cấm: mọi giấy tờ KHÁC, và cột riêng cho CCCD ở bảng yêu cầu.
  const CAM = /cccd|can[_-]?cuoc|giay[_-]?to|passport|national[_-]?id|so[_-]?cmnd|\bcmnd\b/i;
  const CAM_KHAC = /can[_-]?cuoc|giay[_-]?to|passport|national[_-]?id|so[_-]?cmnd|\bcmnd\b|ho[_-]?chieu|giay[_-]?khai[_-]?sinh/i;
  it("ba tệp mã nguồn (đã bóc chú thích) không chứa tên giấy tờ NÀO KHÁC ngoài CCCD", () => {
    expect(dem(doc(THUAN), CAM_KHAC)).toBe(0);
    expect(dem(doc(TOKEN), CAM_KHAC)).toBe(0);
    expect(dem(doc(DB), CAM_KHAC)).toBe(0);
  });
  it("CCCD có mặt ĐÚNG chỗ: ô trong miền thuần + cột đơn được băm/chọn; dịch vụ DB CHỈ chọn cột đơn để băm (không tự tay ghi CCCD ở đâu)", () => {
    expect(dem(doc(THUAN), /\bcccd\b/)).toBeGreaterThan(0);
    expect(dem(doc(DB), /\bcustomerCccd: true\b/)).toBe(1); // chỉ ở `select` của `taoYeuCau` (băm lúc tạo)
    expect(dem(doc(DB), /\bcustomerCccd:(?!\s*true)/)).toBe(0); // không chỗ nào gán GIÁ TRỊ cho cột CCCD (chỉ `: true` của select)
  });
  it("khối `model HoaDonYeuCauNguoiMua` của schema cũng không có cột như vậy (đối chứng: khối có cột `tokenHash`)", () => {
    const sc = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const i = sc.indexOf("model HoaDonYeuCauNguoiMua {");
    expect(i).toBeGreaterThan(-1);
    const khoi = boChuThich(sc.slice(i, sc.indexOf("\n}", i)));
    expect(dem(khoi, /\btokenHash\b/)).toBe(1);
    expect(dem(khoi, CAM)).toBe(0);
  });
});

describe("[YCM-W2] chỉ ghi bảng yêu cầu (+ AuditLog) và — DUY NHẤT — các cột người mua của đơn khi PH gửi: không đụng hoá đơn / tiền, không SQL thô ngoài khoá tư vấn", () => {
  const nguon = doc(DB);
  it("mọi phép ghi Prisma nhắm `hoaDonYeuCauNguoiMua`: create ×1, updateMany ×8, không update/upsert/delete/createMany; NGOẠI LỆ DUY NHẤT: `tx.order.updateMany` ×1 (ghi cột người mua — xem ca dưới)", () => {
    const ghi = nguon.match(/\b(?:tx|db)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g) ?? [];
    expect(ghi.length).toBeGreaterThan(0);
    for (const g of ghi) expect(g, g).toMatch(/\.hoaDonYeuCauNguoiMua\.|^tx\.order\.updateMany\($/);
    expect(dem(nguon, /\.hoaDonYeuCauNguoiMua\.create\(/)).toBe(1);
    expect(dem(nguon, /\.hoaDonYeuCauNguoiMua\.updateMany\(/)).toBe(8);
    expect(dem(nguon, /\.hoaDonYeuCauNguoiMua\.(update|upsert|delete|deleteMany|createMany)\(/)).toBe(0);
  });
  it("không đụng `hoaDonDienTu` / `payment` / `receipt` / … để ghi; `order` chỉ có MỘT phép ghi (`tx.order.updateMany`) + hai phép đọc (`db.order.findFirst` lúc tạo, `tx.order.findFirst` lúc ghi vào đơn)", () => {
    expect(dem(nguon, /\.(?:hoaDonDienTu|payment|paymentRequest|receipt|hoaDonNghiaVu)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/)).toBe(0);
    expect(dem(nguon, /\.order\.(create|createMany|update|upsert|delete|deleteMany)\(/)).toBe(0);
    expect(dem(nguon, /\btx\.order\.updateMany\(/)).toBe(1);
    expect(dem(nguon, /\bdb\.order\.findFirst\(/)).toBe(2); // `taoYeuCau` + `docDienSan` (điền sẵn)
    expect(dem(nguon, /\btx\.order\.findFirst\(/)).toBe(1);
    expect(dem(nguon, /\.order\.\w+\(/)).toBe(4);
  });
  it("[YCM-W2b] phép ghi đơn nằm TRONG `ghiVaoDonTrongTx`, có `centerId` của chính yêu cầu, chỉ ghi `cot` do `cotDonTuPhuHuynh` tính, chặn khi hoá đơn DANG_PHAT_HANH, và chỉ được gọi từ `guiThongTinPhuHuynh`", () => {
    const i = nguon.indexOf("async function ghiVaoDonTrongTx");
    const j = nguon.indexOf("export type KetQuaGhiO");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    const ham = nguon.slice(i, j);
    expect(dem(ham, /\btx\.order\.updateMany\(\{ where: \{ id: don\.id, centerId: row\.centerId \}, data: cot \}\)/)).toBe(1);
    expect(dem(ham, /cotDonTuPhuHuynh\(du, banDau\)/)).toBe(1);
    expect(dem(ham, /trangThai: "DANG_PHAT_HANH"/)).toBe(1);
    expect(dem(ham, /return "HOA_DON_DANG_PHAT_HANH"/)).toBe(1);
    // Cổng DANG_PHAT_HANH đứng TRƯỚC phép ghi (cổng trước phép ghi đầu tiên).
    expect(ham.indexOf("return \"HOA_DON_DANG_PHAT_HANH\"")).toBeLessThan(ham.indexOf("tx.order.updateMany("));
    expect(dem(nguon, /\bghiVaoDonTrongTx\(/)).toBe(2); // định nghĩa + MỘT lời gọi
    const gui = nguon.slice(nguon.indexOf("export async function guiThongTinPhuHuynh"), nguon.indexOf("// ── NHÂN VIÊN"));
    expect(dem(gui, /\bghiVaoDonTrongTx\(tx, row, input\.du, input\.banDau\)/)).toBe(1);
  });
  it("SQL thô: đúng MỘT `$executeRaw` (khoá tư vấn theo id yêu cầu); không `$queryRaw` / `*Unsafe`", () => {
    expect(dem(nguon, /\$executeRaw\b/)).toBe(1);
    expect(dem(nguon, /pg_advisory_xact_lock\(/)).toBe(1);
    expect(dem(nguon, /\$queryRaw|Unsafe\b/)).toBe(0);
  });
  it("khoá tư vấn lấy trong MỌI giao dịch đọc-sửa-ghi ô: mở · gửi · nhập thay · xác nhận · huỷ = 5 lời gọi", () => {
    expect(dem(nguon, /\bkhoaTuVan\(tx,/)).toBe(5);
  });
});

describe("[YCM-W3] đồng hồ ĐÓNG BĂNG, không log, không ngẫu nhiên ngoài `sinhToken`", () => {
  for (const [ten, f] of [["miền", THUAN], ["mật mã", TOKEN], ["dịch vụ DB", DB]] as const) {
    it(`${ten}: không \`Date.now()\` / \`new Date()\` trần / \`Math.random\` / \`console.*\``, () => {
      const nguon = doc(f);
      expect(dem(nguon, /\bDate\.now\s*\(/)).toBe(0);
      expect(dem(nguon, /\bnew Date\s*\(\s*\)/)).toBe(0);
      expect(dem(nguon, /\bMath\.random\b/)).toBe(0);
      expect(dem(nguon, /\bconsole\s*\./)).toBe(0);
    });
  }
  it("ngẫu nhiên: id yêu cầu bằng `randomUUID` ×1 và token bằng `sinhToken` ×1 ở dịch vụ; `randomBytes` chỉ ở `sinhToken` của miền", () => {
    const db = doc(DB);
    expect(dem(db, /\brandomUUID\(\)/)).toBe(1);
    expect(dem(db, /\bsinhToken\(\)/)).toBe(1);
    expect(dem(db, /\brandomBytes\b/)).toBe(0);
    expect(dem(doc(THUAN), /\brandomBytes\b/)).toBe(0);
    expect(dem(doc(TOKEN), /\brandomBytes\b/)).toBe(2); // import + giá trị mặc định của tham số nguồn
  });
});

describe("[YCM-W4] mọi `updateMany` có điều kiện `trangThai` VÀ `centerId`; mọi truy vấn của nhân viên có `centerId`", () => {
  const nguon = doc(DB);
  it("phần `where` của từng `updateMany` chứa `trangThai` và `centerId`", () => {
    const cac = cacLoiGoi(nguon, /\.hoaDonYeuCauNguoiMua\.updateMany\(/);
    expect(cac).toHaveLength(8);
    for (const c of cac) {
      const where = c.slice(0, c.indexOf("data:"));
      expect(where).toMatch(/\bcenterId\b/);
      expect(where).toMatch(/\btrangThai\b/);
    }
  });
  it("mọi `data` chuyển trạng thái ghi `updatedAt` từ đồng hồ truyền vào (`now`), không để Prisma dùng giờ máy", () => {
    const cac = cacLoiGoi(nguon, /\.hoaDonYeuCauNguoiMua\.updateMany\(/);
    for (const c of cac) expect(c.slice(c.indexOf("data:"))).toMatch(/updatedAt:\s*(?:input\.)?now\b/);
  });
  it("`findFirst` trên bảng yêu cầu luôn lọc `centerId`; `findUnique` đúng MỘT chỗ (tay cầm id → centerId) và chỉ chọn hai cột đó", () => {
    const ff = cacLoiGoi(nguon, /\.hoaDonYeuCauNguoiMua\.findFirst\(/);
    expect(ff.length).toBe(3);
    for (const c of ff) expect(c).toMatch(/\bcenterId\b/);
    const fu = cacLoiGoi(nguon, /\.hoaDonYeuCauNguoiMua\.findUnique\(/);
    expect(fu).toHaveLength(1);
    expect(fu[0]).toMatch(/select:\s*\{\s*id:\s*true,\s*centerId:\s*true\s*\}/);
  });
  it("đường nhân viên đi qua phạm vi quyền: `phamViXuLyYeuCau` + `duocXuLyYeuCau` ở tạo và ở tra cứu; bộ lọc `centerId: { in: pv }` ×2", () => {
    expect(dem(nguon, /\bphamViXuLyYeuCau\(/)).toBe(2);
    expect(dem(nguon, /\bduocXuLyYeuCau\(/)).toBe(2);
    expect(dem(nguon, /centerId:\s*\{\s*in:\s*pv\s*\}/)).toBe(2);
  });
  it("không so vai trực tiếp (luật cứng #1): không `role ===`, `.role`, `roleCode`", () => {
    for (const f of [THUAN, DB]) {
      const n = doc(f);
      expect(dem(n, /\brole(?:Code)?\s*[!=]==?/)).toBe(0);
      expect(dem(n, /\.role\b|\.roles\b/)).toBe(0);
    }
  });
});

describe("[YCM-W5] chỉ chuyển sang trạng thái ĐÚNG; cơ chế 'một yêu cầu mở mỗi đơn' do DB làm trọng tài", () => {
  const nguon = doc(DB);
  it("ghi `trangThai` đúng ba giá trị: DA_AP_DUNG ×1 · THU_HOI ×1 · HET_HAN ×1; không bao giờ ghi DA_GUI / TU_CHOI / DANG_MO mới", () => {
    // Chỉ đếm trong phần `data` của các `updateMany` (audit cũng có `trangThai: "…"` nhưng không phải phép ghi trạng thái).
    const data = cacLoiGoi(nguon, /\.hoaDonYeuCauNguoiMua\.updateMany\(/).map((c) => c.slice(c.indexOf("data:")));
    expect(dem(data.join("\n"), /\btrangThai:\s*"DA_AP_DUNG"/)).toBe(1);
    expect(dem(data.join("\n"), /\btrangThai:\s*"THU_HOI"/)).toBe(1);
    expect(dem(data.join("\n"), /\btrangThai:\s*"HET_HAN"/)).toBe(1);
    expect(dem(data.join("\n"), /\btrangThai:/)).toBe(3);
    expect(dem(nguon, /\btrangThai:\s*"(?:DA_GUI|TU_CHOI)"/)).toBe(0);
    expect(dem(nguon, /\.hoaDonYeuCauNguoiMua\.create\([\s\S]*?trangThai:\s*"DANG_MO"/)).toBe(1); // yêu cầu chỉ ra đời ở DANG_MO
  });
  it("tạo yêu cầu: KHÔNG kiểm-trước-rồi-ghi (không `findFirst` đơn-mở trước `create`); trọng tài là P2002 từ chỉ mục từng phần, bắt đúng một chỗ", () => {
    const tao = nguon.slice(nguon.indexOf("export async function taoYeuCau"), nguon.indexOf("type HangCongKhai"));
    expect(tao.length).toBeGreaterThan(200);
    expect(dem(tao, /\.hoaDonYeuCauNguoiMua\.(?:findFirst|findUnique|count)\(/)).toBe(0);
    expect(dem(nguon, /\bP2002\b/)).toBe(1);
    expect(dem(nguon, /"DA_CO_YEU_CAU_MO"/)).toBeGreaterThanOrEqual(2); // kiểu MaLoi + nhánh bắt
    expect(dem(nguon, /e\.code === "P2002"/)).toBe(1);
  });
  it("quét hết hạn chỉ đóng yêu cầu CHƯA gửi (`guiLuc: null`) hoặc đã gửi mà bị bỏ rơi quá số ngày do ĐƯỜNG GỌI chọn; không có nhánh nào đóng yêu cầu đã gửi vô điều kiện", () => {
    const cac = cacLoiGoi(nguon, /\.hoaDonYeuCauNguoiMua\.updateMany\(/).filter((c) => /trangThai:\s*"HET_HAN"/.test(c));
    expect(cac).toHaveLength(1);
    expect(cac[0]!.slice(0, cac[0]!.indexOf("data:"))).toMatch(/OR:\s*chuaGuiHoacBoRoi/);
    expect(dem(nguon, /const chuaGuiHoacBoRoi = \[\{ guiLuc: null \}, \.\.\.\(catGui === null \? \[\] : \[\{ guiLuc: \{ lte: catGui \} \}\]\)\];/)).toBe(1);
    expect(dem(nguon, /OR:\s*chuaGuiHoacBoRoi/)).toBe(2); // findMany + updateMany
    expect(dem(nguon, /input\.choXuLyToiDaNgay === null \? null : new Date\(/)).toBe(1);
  });
  it("quét theo PHẠM VI cơ sở: bắt buộc, rỗng ⇒ không quét, `TAT_CA` phải nói rõ; ba truy vấn quét đều mang bộ lọc `coSo`", () => {
    expect(dem(nguon, /phamVi: PhamViQuet/)).toBe(1);
    expect(dem(nguon, /input\.phamVi\.length === 0\) return \{ hetHan: 0, daXoaDuLieu: 0, choXuLyQuaHan: 0 \}/)).toBe(1);
    expect(dem(nguon, /\.\.\.coSo\b/)).toBe(3);
  });
  it("xoá dữ liệu quá hạn: chỉ yêu cầu ĐÃ ĐÓNG (không có DANG_MO trong danh sách) và đặt `duLieuGui` = DbNull", () => {
    const m = nguon.match(/const TRANG_THAI_DONG = \[([^\]]*)\]/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/DANG_MO/);
    expect(dem(nguon, /duLieuGui:\s*Prisma\.DbNull/)).toBe(1);
  });
});

describe("[YCM-W6] token: DB chỉ giữ hash, audit không mang token / hash / giá trị ô, so khớp thời gian hằng", () => {
  const nguon = doc(DB);
  it("`tokenHash` chỉ được CHỌN ở đường công khai (đúng một chỗ khai: CHON_CONG_KHAI); nhân viên không bao giờ đọc hash", () => {
    expect(dem(nguon, /\btokenHash:\s*true/)).toBe(1);
    expect(dem(nguon, /const CHON_CONG_KHAI = \{ \.\.\.CHON_NHAN_VIEN, tokenHash: true \}/)).toBe(1);
    expect(dem(nguon, /select:\s*CHON_NHAN_VIEN/)).toBe(1);
    expect(dem(nguon, /select:\s*CHON_CONG_KHAI/)).toBe(2);
  });
  it("ghi hash đúng MỘT lần (`bamToken(token)` lúc tạo); token thô chỉ xuất hiện trong kết quả `taoYeuCau`", () => {
    expect(dem(nguon, /\bbamToken\(/)).toBe(1);
    expect(dem(nguon, /\btokenHash:\s*bamToken\(token\)/)).toBe(1);
    expect(dem(nguon, /\breturn \{ ok: true, id, token, maLienKet: ghepMaLienKet\(id, token\), hetHanLuc \}/)).toBe(1);
  });
  it("mọi khối `writeAudit({…})` không chứa token / hash / `duLieuGui` / `.du` / giá trị ô", () => {
    const cac = cacLoiGoi(nguon, /\bwriteAudit\(/);
    expect(cac.length).toBe(9); // 8 cũ + nhật ký «PH ghi vào đơn» (chỉ TÊN cột)
    for (const goc of cac) {
      // `changedFields: ["duLieuGui"]` là TÊN cột (được phép); giá trị mới là thứ cấm.
      const c = goc.replace(/changedFields:\s*\[[^\]]*\],?/, "");
      expect(c).not.toMatch(/token|bamToken|duLieuGui|giaTri|\bdu\b|ketQua\b/i);
    }
  });
  it("so khớp qua `soKhopHash` (một chỗ gọi) và `timingSafeEqual` (một chỗ gọi ở miền); không so `===`/`!==` với hash", () => {
    expect(dem(nguon, /\bsoKhopHash\(/)).toBe(1);
    const matMa = doc(TOKEN);
    expect(dem(matMa, /\btimingSafeEqual\(/)).toBe(1);
    expect(dem(matMa, /(?<!typeof )\bhashDaLuu\s*[!=]==?|[!=]==?\s*hashDaLuu\b|\btokenHash\s*[!=]==?/)).toBe(0);
    expect(dem(nguon, /\btokenHash\s*[!=]==?|[!=]==?\s*(?:row\.)?tokenHash\b/)).toBe(0);
  });
});

describe("[YCM-W7] TTL và thời hạn giữ là THAM SỐ — không hằng ẩn trong mã miền / dịch vụ", () => {
  it("`TTL_MAC_DINH_PHUT` chỉ được ĐỊNH NGHĨA (export) ở miền, không được dùng làm mặc định ở dịch vụ", () => {
    expect(dem(doc(THUAN), /\bTTL_MAC_DINH_PHUT\b/)).toBe(1);
    expect(dem(doc(DB), /\bTTL_MAC_DINH_PHUT\b/)).toBe(0);
  });
  it("hạn tính qua `tinhHetHan(input.now, input.ttlPhut)` ×1 TRƯỚC mọi truy vấn của `taoYeuCau`; `ttlPhut`, `giuDuLieuNgay`, `lo`, `gioiHan` không có giá trị mặc định", () => {
    const db = doc(DB);
    expect(dem(db, /\btinhHetHan\(input\.now,\s*input\.ttlPhut\)/)).toBe(1);
    expect(db.indexOf("tinhHetHan(")).toBeLessThan(db.indexOf("db.order.findFirst("));
    expect(dem(db, /\b(?:ttlPhut|giuDuLieuNgay|lo|gioiHan)\s*[?]?:[^;,}]*=\s*\d/)).toBe(0);
    expect(dem(db, /\b(?:ttlPhut|giuDuLieuNgay|toiDaSaiToken|toiDaLanMo|khoaPhut)\s*=\s*\d/)).toBe(0);
    expect(dem(db, /\bkiemGioiHan\(input\.gioiHan\)/)).toBe(2);
  });
  it("tham số thời gian/giới hạn hỏng ném RangeError ở miền (không biến thành 'không bao giờ khoá')", () => {
    expect(dem(doc(THUAN), /throw new RangeError\(/)).toBe(2); // TTL · giới hạn chống đoán
    expect(dem(doc(TOKEN), /throw new RangeError\(/)).toBe(1); // nguồn ngẫu nhiên sai độ dài
  });
});

describe("[YCM-W8] ranh giới mô-đun: miền không kéo `node:crypto`; xác nhận tách lõi để ghép giao dịch với phép ghi đơn", () => {
  it("`yeu-cau-nguoi-mua.ts` an toàn cho biểu mẫu client: không `node:crypto`, không `server-only`, không `@/lib/db`, không Prisma; chỉ import zod + kiểu quyền", () => {
    const thuan = doc(THUAN);
    expect(dem(thuan, /node:crypto|server-only|@\/lib\/db|@prisma\/client/)).toBe(0);
    // Ba import: zod · kiểu quyền · `@/lib/phone` (THUẦN, không server-only — SĐT dùng đúng luật chuẩn hoá chung của repo, từ 02/11/2026).
    expect(dem(thuan, /^import /m)).toBe(3);
    expect(dem(thuan, /^import .*from "zod";/m)).toBe(1);
    expect(dem(thuan, /^import .*from "@\/lib\/phone";/m)).toBe(1);
  });
  it("mật mã nằm ở tệp riêng; dịch vụ DB chỉ dùng `randomUUID` từ `node:crypto`", () => {
    expect(dem(doc(TOKEN), /from "node:crypto"/)).toBe(1);
    expect(dem(doc(DB), /from "node:crypto"/)).toBe(1);
    expect(dem(doc(DB), /import \{ randomUUID \} from "node:crypto"/)).toBe(1);
  });
  it("`xacNhanYeuCau` chỉ bọc `xacNhanYeuCauTrongTx` trong MỘT `$transaction`; lõi giữ khoá tư vấn + chuyển trạng thái; lõi và `TuChoi`/`sangLoi` được export", () => {
    const db = doc(DB);
    expect(dem(db, /db\.\$transaction\(\(tx\) => xacNhanYeuCauTrongTx\(tx, input\)\)/)).toBe(1);
    expect(dem(db, /export async function xacNhanYeuCauTrongTx\(tx: Tx,/)).toBe(1);
    expect(dem(db, /export class TuChoi extends Error/)).toBe(1);
    expect(dem(db, /export const sangLoi\b/)).toBe(1);
    const loi = db.slice(db.indexOf("export async function xacNhanYeuCauTrongTx"), db.indexOf("export type KetQuaDong"));
    expect(dem(loi, /await khoaTuVan\(tx, input\.id\);/)).toBe(1);
    expect(dem(loi, /tx\.hoaDonYeuCauNguoiMua\.updateMany\(/)).toBe(1);
    expect(dem(loi, /\$transaction/)).toBe(0);
  });
});
