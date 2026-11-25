// Ca [QNW-*] — LƯỚI GHIM MÃ NGUỒN của scanner bóng nghĩa vụ hoá đơn (Invoice Hub S8).
//
// Hành vi (ghi đúng, chạy lại không đổi, cô lập cơ sở, không ghi tiền…) đã được ĐO ở `tests/finance/hoa-don-quet-db.test.ts` trên Postgres thật. Lưới này khoá những điều
// mà test hành vi KHÔNG chứng minh được vì chúng là về thứ mã KHÔNG làm: không gọi nhà cung cấp, không ghi bảng tiền / hoá đơn, không chen vào khoá của đường tiền.
// Một test hành vi xanh không nói gì về một lời gọi ai đó thêm vào sau.
//
// Cách viết (CLAUDE.md "lưới ghim mã nguồn"): đọc mã đã BÓC chú thích; neo vào lời gọi / biểu thức, không vào chỗ đặt `await`; đếm SỐ LẦN khớp; mỗi ca đã cấy lỗi để thấy ĐỎ.
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
const DB = `${DIR}/quet-nghia-vu-db.ts`;
const KE_HOACH = `${DIR}/quet-nghia-vu-ke-hoach.ts`;
const LO = `${DIR}/quet-nghia-vu-lo.ts`;
const THONG_BAO = `${DIR}/quet-nghia-vu-thong-bao.ts`;
const THONG_BAO_DB = `${DIR}/ngoai-le-thong-bao-db.ts`;
const ROUTE = "app/api/cron/hoa-don-misa-doi-soat/route.ts";
const MA_QUET = [DB, KE_HOACH, LO, THONG_BAO, THONG_BAO_DB] as const;
const THUAN = [KE_HOACH, LO, THONG_BAO] as const;

/** Thân hàm `async function <ten>(` hoặc `function <ten>(` tới `\n}\n` đầu tiên. */
function than(src: string, ten: string): string {
  const i = src.search(new RegExp(`(?:async )?function ${ten}\\(`));
  if (i < 0) return "";
  const j = src.indexOf("\n}\n", i);
  return src.slice(i, j < 0 ? undefined : j);
}

describe("[QNW-00] lưới không rỗng", () => {
  it("đọc được cả năm tệp và có nội dung", () => {
    for (const f of [...MA_QUET, ROUTE]) expect(doc(f).length, f).toBeGreaterThan(300);
    expect(than(doc(DB), "ghiKeHoach").length).toBeGreaterThan(500);
    expect(than(doc(DB), "quetCacDon").length).toBeGreaterThan(500);
  });
});

describe("[QNW-01] scanner KHÔNG chạm nhà cung cấp, ký, phát hành, gửi", () => {
  const CAM_IMPORT = [
    "nha-cung-cap",
    "cong-phat-hanh",
    "phat-hanh-misa",
    "lib/misa",
    "ghi-hoa-don",
    "chot-hoa-don",
    "gui-email",
    "dinh-kem-email",
    "kho-tep",
    "lib/email",
  ];
  it.each(MA_QUET)("%s: không import module nhà cung cấp / phát hành / email / kho tệp", (f) => {
    const src = doc(f);
    for (const t of CAM_IMPORT) expect(dem(src, new RegExp(`from "[^"]*${t.replace(/[/-]/g, "\\$&")}[^"]*"`)), `${f} import ${t}`).toBe(0);
  });
  it.each(MA_QUET)("%s: không mạng, không env, không lời gọi cổng (phatHanh / traCuu / taiTep)", (f) => {
    const src = doc(f);
    expect(dem(src, /\bfetch\s*\(/), `${f} fetch`).toBe(0);
    expect(dem(src, /\bprocess\.env\b/), `${f} env`).toBe(0);
    expect(dem(src, /\.(phatHanh|traCuu|taiTep|ky|dieuChinh|thayThe)\s*\(/), `${f} cổng`).toBe(0);
    expect(dem(src, /\bcongHoaDonTuEnv\b|\blayCongHoaDon\b/), `${f} lấy cổng`).toBe(0);
  });
});

describe("[QNW-02] scanner KHÔNG ghi sổ tiền, đơn, hoá đơn; không sự kiện trên đường tiền", () => {
  const GHI = "create|createMany|update|updateMany|upsert|delete|deleteMany";
  const BANG_CAM = ["payment", "receipt", "paymentRequest", "paymentAllocation", "creditBalance", "bankTransaction", "order", "orderItem", "hoaDonDienTu", "hoaDonKhoan", "hoaDonDong", "cauHinhHoaDonCoSo", "refundRequest"];
  it.each(MA_QUET)("%s: 0 lời GHI vào bảng tiền / đơn / hoá đơn", (f) => {
    const src = doc(f);
    for (const b of BANG_CAM) {
      expect(dem(src, new RegExp(`\\b(?:db|tx|sdb)\\.${b}\\.(?:${GHI})\\s*\\(`)), `${f} ghi ${b}`).toBe(0);
    }
  });
  it.each(MA_QUET)("%s: không publishEvent, không import đường tiền (ghi-tien-don · payos · lib/payments · payment.ts)", (f) => {
    const src = doc(f);
    expect(dem(src, /\bpublishEvent\b/), `${f} publishEvent`).toBe(0);
    for (const t of ["ghi-tien-don", "payos", "lib/payments", "finance/payment\""]) {
      expect(dem(src, new RegExp(`from "[^"]*${t.replace(/[/-]/g, "\\$&")}`)), `${f} import ${t}`).toBe(0);
    }
  });
  it("[QNW-02b] duy nhất MỘT lời SQL thô trong cả bộ, và đó là khoá tư vấn riêng của scanner (không $queryRaw nào)", () => {
    const db = doc(DB);
    expect(dem(db, /\$executeRaw/)).toBe(1);
    expect(dem(db, /\$queryRaw|\$queryRawUnsafe|\$executeRawUnsafe/)).toBe(0);
    expect(dem(db, /\$executeRaw`SELECT pg_advisory_xact_lock\(hashtext\(\$\{`hoa-don-quet:\$\{orderId\}`\}\)::bigint\)`/)).toBe(1);
    for (const f of THUAN) expect(dem(doc(f), /\$executeRaw|\$queryRaw/), f).toBe(0);
  });
});

describe("[QNW-03] KHÓA: riêng của scanner, KHÔNG chen vào khoá đơn của đường tiền (lệch có chủ ý so ADR §7.3)", () => {
  it("không nhắc khoaDonTrongTx / khoaGiaoDichTrongTx; khoá là MỘT lời, đứng đầu giao dịch ghi", () => {
    const db = doc(DB);
    expect(dem(db, /\bkhoaDonTrongTx\b|\bkhoaGiaoDichTrongTx\b|\bghiTienChoDon\b/)).toBe(0);
    const g = than(db, "ghiKeHoach");
    const iKhoa = g.search(/pg_advisory_xact_lock/);
    const iDoc = g.search(/tx\.hoaDonNghiaVu\.findMany/);
    const iLap = g.search(/\blapKeHoachDon\(/);
    const iGhiDau = g.search(/\.(?:createMany|updateMany)\(/);
    expect(iKhoa, "khoá phải có").toBeGreaterThan(-1);
    // Thứ tự: khoá → đọc lại dưới khoá → lập lại kế hoạch (ném tại đây nếu dữ liệu sai) → phép ghi đầu tiên.
    expect(iKhoa).toBeLessThan(iDoc);
    expect(iDoc).toBeLessThan(iLap);
    expect(iLap).toBeLessThan(iGhiDau);
  });
  it("[QNW-03b] giao dịch: đúng MỘT `db.$transaction`, và mọi ghi bảng chiếu / ngoại lệ trong `ghiKeHoach` đi qua `tx.` (trừ nhịp tim đã ngoài giao dịch)", () => {
    const db = doc(DB);
    expect(dem(db, /\bdb\.\$transaction\(/)).toBe(1);
    const g = than(db, "ghiKeHoach");
    expect(dem(g, /\bdb\.(?:hoaDonNghiaVu|hoaDonNgoaiLe)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/)).toBe(0);
    expect(dem(g, /\btx\.hoaDonNghiaVu\.createMany\(/)).toBe(2); // gốc trước, điều chỉnh sau
    expect(dem(g, /\btx\.hoaDonNghiaVu\.updateMany\(/)).toBe(1);
    expect(dem(g, /\btx\.hoaDonNgoaiLe\.createMany\(/)).toBe(1);
    expect(dem(g, /\btx\.hoaDonNgoaiLe\.updateMany\(/)).toBe(1);
    // Ngoài giao dịch chỉ còn đúng MỘT lời ghi bảng chiếu: nhịp tim (`quetLanCuoiLuc`), không đổi cột nào khác.
    const ngoai = db.replace(g, "");
    expect(dem(ngoai, /\bdb\.hoaDonNghiaVu\.updateMany\(/)).toBe(1);
    expect(ngoai).toMatch(/db\.hoaDonNghiaVu\.updateMany\(\{[\s\S]{0,160}?data: \{ quetLanCuoiLuc: input\.now \} \}\)/);
    expect(dem(ngoai, /\bdb\.(?:hoaDonNgoaiLe)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/)).toBe(0);
  });
  it("[QNW-03c] chống trùng ở lớp cuối: skipDuplicates cả ba lần tạo; cập nhật bảng chiếu CÓ điều kiện phienBan (khoá lạc quan)", () => {
    const g = than(doc(DB), "ghiKeHoach");
    expect(dem(g, /skipDuplicates: true/)).toBe(3);
    expect(g).toMatch(/updateMany\(\{\s*where: \{ id: c\.id, phienBan: c\.phienBanCu \}/);
    expect(dem(g, /trangThai: "MO" \}/)).toBeGreaterThanOrEqual(1); // đóng ngoại lệ chỉ khi còn MO
  });
});

describe("[QNW-04] cờ TẮT ⇒ không chạm bảng Hub; ngân sách thời gian", () => {
  it("chayQuetBong hỏi `laHubQuetBat()` ĐÚNG MỘT lần, trước khi chọn lô, và trả null khi tắt", () => {
    const db = doc(DB);
    const c = than(db, "chayQuetBong");
    expect(dem(db, /\blaHubQuetBat\(\)/)).toBe(1);
    expect(c).toMatch(/if \(!\(await laHubQuetBat\(\)\)\) return null;/);
    expect(c.search(/laHubQuetBat\(\)/)).toBeLessThan(c.search(/chonDonCanQuet\(/));
  });
  it("quetCacDon kiểm `conThoiGian()` trước MỖI đơn (một lời gọi, đầu vòng lặp) và dừng bằng break", () => {
    const q = than(doc(DB), "quetCacDon");
    expect(dem(q, /\binput\.conThoiGian\(\)/)).toBe(1);
    expect(q).toMatch(/for \(const d of nguon\.don\) \{\s*if \(!input\.conThoiGian\(\)\) \{\s*kq\.dungSom = true;\s*break;/);
  });
  it("tham số nguy hiểm KHÔNG có mặc định (luật 7): `conThoiGian`, `now`, `cheDo` của kế hoạch đều bắt buộc", () => {
    expect(doc(DB)).not.toMatch(/conThoiGian\??:\s*\(\)\s*=>\s*boolean\s*=/);
    expect(doc(DB)).toMatch(/input: \{ now: Date; conThoiGian: \(\) => boolean \}/);
    expect(doc(KE_HOACH)).toMatch(/\n {2}cheDo: "THEO_KHOAN_THU" \| "THEO_KHOAN_THU_VA_DONG_DON";/);
    expect(doc(KE_HOACH)).not.toMatch(/cheDo\?:/);
  });
});

describe("[QNW-05] các quyết định CHỜ OWNER được ghim, không lặng lẽ trôi", () => {
  it("thu trước: không tín hiệu + coi như học phí (OD-03 chưa trả lời); chế độ chỉ theo khoản thu (OD-05 chưa chốt) — mỗi cái đúng một chỗ", () => {
    const q = than(doc(DB), "quetCacDon");
    expect(dem(q, /thuTruocPaymentIds: new Set<string>\(\)/)).toBe(1);
    expect(dem(q, /chinhSachThuTruoc: "NHU_HOC_PHI"/)).toBe(1);
    expect(dem(q, /cheDo: "THEO_KHOAN_THU"/)).toBe(2); // một cho engine, một cho kế hoạch — phải đi CÙNG nhau
    expect(dem(q, /"THEO_KHOAN_THU_VA_DONG_DON"/)).toBe(0);
  });
  it("pháp nhân: scanner KHÔNG tự điền `legalEntityId` (fail-closed — OD-01); nghĩa vụ mới không mang pháp nhân", () => {
    const g = than(doc(DB), "ghiKeHoach");
    expect(dem(g, /legalEntityId/)).toBe(0);
    expect(dem(doc(KE_HOACH), /legalEntityId/)).toBe(0);
  });
});

describe("[QNW-06] phần THUẦN thật sự thuần", () => {
  it.each(THUAN)("%s: không DB, không Prisma (giá trị), không đồng hồ, không ngẫu nhiên", (f) => {
    const src = doc(f);
    expect(dem(src, /@\/lib\/db\b|\bscopedDb\b|\bPrismaClient\b/), `${f} DB`).toBe(0);
    expect(dem(src, /import \{[^}]*\} from "@prisma\/client"/), `${f} prisma giá trị`).toBe(0);
    expect(dem(src, /\bDate\.now\s*\(|\bnew Date\s*\(\s*\)|\bperformance\.now\b/), `${f} đồng hồ`).toBe(0);
    expect(dem(src, /\bMath\.random\b|\brandomUUID\b/), `${f} ngẫu nhiên`).toBe(0);
  });
  it("người chạy DB cũng không đọc đồng hồ thật: mọi mốc là `now` truyền vào (chỉ `new Date(<tham số>)`)", () => {
    const db = doc(DB);
    expect(dem(db, /\bDate\.now\s*\(|\bnew Date\s*\(\s*\)/)).toBe(0);
  });
});

describe("[QNW-07] chuông: người nhận suy từ DỮ LIỆU quyền của TỪNG cơ sở", () => {
  it("scanner KHÔNG tự gửi chuông: gọi `guiThongBaoNgoaiLe` đúng MỘT lần (module dùng chung với đường tức thời) và không nhắc notifyStaff", () => {
    const db = doc(DB);
    expect(dem(db, /\bguiThongBaoNgoaiLe\(/)).toBe(1);
    expect(dem(db, /\bnotifyStaff\b|\bnguoiGiuQuyenTaiCoSo\b/)).toBe(0);
  });
  it("`nguoiGiuQuyenTaiCoSo` chỉ gọi với [QUYEN_KE_TOAN_HOA_DON] — MỘT lần cho bản gom theo ngày (từng cơ sở), MỘT lần cho bản riêng từng ngoại lệ; mỗi `notifyStaff` bọc try/catch; không danh sách người gõ cứng", () => {
    const db = doc(THONG_BAO_DB);
    expect(dem(db, /\bnguoiGiuQuyenTaiCoSo\(/)).toBe(2);
    expect(dem(db, /\bnguoiGiuQuyenTaiCoSo\(id, \[QUYEN_KE_TOAN_HOA_DON\]\)/)).toBe(1);
    expect(dem(db, /\bnguoiGiuQuyenTaiCoSo\(input\.centerId, \[QUYEN_KE_TOAN_HOA_DON\]\)/)).toBe(1);
    expect(dem(db, /\bnotifyStaff\(/)).toBe(2);
    expect(db).toMatch(/try \{\s*await notifyStaff\(t\);[\s\S]*?\} catch \{/);
    expect(db).toMatch(/try \{\s*await notifyStaff\(tb\);[\s\S]*?\} catch \{/);
    expect(dem(db, /\buserIds:\s*\[/)).toBe(0);
    expect(dem(db, /role\s*===|\.role\b|roles\.includes/)).toBe(0);
  });
});

describe("[QNW-08] route cron: P1 trước và KHÔNG ĐỔI, P2 sau; route không biết gì về bảng hay cờ của Hub", () => {
  it("`doiSoatPhatHanhTreo` MỘT lần, `chayQuetBong` MỘT lần, P1 đứng trước; `layCongHoaDon` vẫn đúng một lời gọi (lưới [PHM-W1])", () => {
    const r = doc(ROUTE);
    expect(dem(r, /\bdoiSoatPhatHanhTreo\(/)).toBe(1);
    expect(dem(r, /\bchayQuetBong\(/)).toBe(1);
    expect(r.search(/\bdoiSoatPhatHanhTreo\(/)).toBeLessThan(r.search(/\bchayQuetBong\(/));
    expect(dem(r, /\blayCongHoaDon\(/)).toBe(1);
  });
  it("route không nhắc cờ / bảng của Hub và không đọc env (cờ chỉ ở feature.ts, bảng chỉ trong lib hoá đơn)", () => {
    const r = doc(ROUTE);
    expect(dem(r, /hubQuet|laHubQuetBat|HoaDonNghiaVu|hoaDonNghiaVu|HoaDonNgoaiLe|hoaDonNgoaiLe/)).toBe(0);
    expect(dem(r, /\bprocess\.env\b/)).toBe(0);
  });
  it("lỗi P1 không làm mất P2 và ngược lại: P1 bắt rồi ném lại SAU P2; P2 không có đường ném ra route (chayQuetBong tự bắt)", () => {
    const r = doc(ROUTE);
    expect(r).toMatch(/catch \(e\) \{\s*loiP1 = e;/);
    expect(r.search(/loiP1 = e;/)).toBeLessThan(r.search(/\bchayQuetBong\(/));
    expect(r).toMatch(/if \(doiSoat === null\) throw loiP1;/);
    expect(r.search(/\bchayQuetBong\(/)).toBeLessThan(r.search(/throw loiP1;/));
    const c = than(doc(DB), "chayQuetBong");
    expect(dem(c, /\btry \{/)).toBe(3); // cờ · quét · chuông — mỗi pha tự bắt
    expect(dem(c, /\bthrow\b/)).toBe(0);
  });
});
