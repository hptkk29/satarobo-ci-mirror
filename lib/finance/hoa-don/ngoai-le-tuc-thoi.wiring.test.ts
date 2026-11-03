// Ca [NLT-W*] — LƯỚI GHIM MÃ NGUỒN của đường báo ngoại lệ hoá đơn TỨC THỜI (Invoice Hub §6).
//
// Hành vi (tạo đúng cơ sở, chạy lại không trùng, cờ TẮT, bỏ qua có lý do, không ném) đo ở `tests/finance/hoa-don-ngoai-le-tuc-thoi-db.test.ts` + `[PHM-12c/d]` trên Postgres thật.
// Lưới này khoá điều test hành vi không chứng minh được vì là thứ mã KHÔNG làm / làm ở ĐÚNG chỗ:
//   · lời gọi nằm SAU giao dịch đã commit và chỉ khi lượt này là lượt chuyển sang lỗi (không báo oan khi người khác đã đi tiếp; không chuông cho một giao dịch rồi rollback);
//   · hàm không ném, không tự gửi chuông bằng đường riêng (chung người nhận với scanner), chỉ gửi cho CƠ SỞ của hoá đơn;
//   · ngoài một dòng `HoaDonNgoaiLe` nó không ghi gì (không hoá đơn, đơn, tiền);
//   · không có lời gọi lạc ngoài đường phát hành.
// Cách viết (CLAUDE.md "lưới ghim mã nguồn"): đọc mã đã BÓC chú thích; neo vào lời gọi / biểu thức; đếm SỐ LẦN khớp; mỗi ca đã cấy lỗi để thấy ĐỎ.
import { execFileSync } from "node:child_process";
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
const DB = `${DIR}/ngoai-le-tuc-thoi-db.ts`;
const MAY = `${DIR}/phat-hanh-misa.ts`;

describe("[NLT-W1] đường phát hành: báo SAU giao dịch, chỉ khi lượt này là lượt chuyển sang lỗi, đúng nhánh TỪ CHỐI", () => {
  const may = doc(MAY);
  it("đúng HAI lời gọi: nhánh TỪ CHỐI (loại TU_CHOI_NHA_CUNG_CAP, khoá = refId của lượt gửi) và nhánh QUÁ HẠN của đối soát (loại do `loaiQuaHan`, chỉ khi khác null)", () => {
    expect(dem(may, /\bbaoNgoaiLeTucThoi\(/)).toBe(2);
    expect(dem(may, /\bloaiQuaHan\(\{[^}]*slaPhut: input\.slaKhongRoPhut \}\)/)).toBe(1);
    expect(dem(may, /if \(loai !== null\) await baoNgoaiLeTucThoi\(\{ hoaDonId: id, loai, khoa: misaRefId \?\? id, now \}\);/)).toBe(1);
    expect(dem(may, /baoNgoaiLeTucThoi\(\{\s*hoaDonId,\s*loai:\s*"TU_CHOI_NHA_CUNG_CAP",\s*khoa:\s*refId,\s*now\s*\}\)/)).toBe(1);
  });
  it("lời gọi nằm trong nhánh `kq.loai === \"TU_CHOI\"` (trước nhánh KHONG_RO), SAU khi giao dịch trả `true`, và có điều kiện `vuaChuyenSangLoi`", () => {
    const dau = may.search(/kq\.loai === "TU_CHOI"/);
    const cuoi = may.search(/kq\.loai === "KHONG_RO"/);
    const goi = may.search(/\bbaoNgoaiLeTucThoi\(/); // lời gọi ĐẦU TIÊN = nhánh TỪ CHỐI
    expect(dau).toBeGreaterThan(-1);
    expect(goi).toBeGreaterThan(dau);
    expect(goi).toBeLessThan(cuoi);
    // giao dịch kết thúc (trả true) TRƯỚC lời gọi
    expect(may.slice(dau, goi)).toMatch(/return true;\s*\}\);/);
    expect(may.slice(dau, goi)).toMatch(/const vuaChuyenSangLoi = await db\.\$transaction\(/);
    // lời gọi có điều kiện
    expect(dem(may.slice(goi - 60, goi), /if \(vuaChuyenSangLoi\)\s*await\s*$/)).toBe(1);
    // nhánh ghi 0 dòng (người khác đã đi tiếp) trả false ⇒ không báo
    expect(dem(may.slice(dau, goi), /if \(upd\.count !== 1\) return false;/)).toBe(1);
  });
});

describe("[NLT-W2] người báo tức thời: không ném, đúng cơ sở, không ghi ngoài một dòng ngoại lệ", () => {
  const nguon = doc(DB);
  it("toàn thân hàm bọc try/catch ngoài cùng và KHÔNG có `throw`", () => {
    expect(dem(nguon, /\bthrow\b/)).toBe(0);
    expect(dem(nguon, /\btry \{/)).toBe(2); // ngoài cùng + riêng cho chuông
    expect(dem(nguon, /\} catch \(e\) \{/)).toBe(2);
  });
  it("cổng cờ THEO CƠ SỞ `laHubQuetBatChoCoSo(hd.centerId)` hỏi MỘT lần, đứng SAU khi biết cơ sở của hoá đơn và TRƯỚC mọi phép ghi / chuông; không còn cờ toàn hệ", () => {
    expect(dem(nguon, /\blaHubQuetBatChoCoSo\(hd\.centerId\)/)).toBe(1);
    expect(dem(nguon, /\blaHubQuetBat\(\)/)).toBe(0);
    const co = nguon.search(/\blaHubQuetBatChoCoSo\(/);
    const tim = nguon.search(/\bhoaDonDienTu\.findFirst\(/);
    const ghi = nguon.search(/\bhoaDonNgoaiLe\.createMany\(/);
    const chuong = nguon.search(/\bguiThongBaoTucThoi\(/);
    expect(tim).toBeGreaterThan(-1);
    expect(co).toBeGreaterThan(tim);
    expect(co).toBeLessThan(ghi);
    expect(co).toBeLessThan(chuong);
  });
  it("chuông đi qua `guiThongBaoTucThoi` với id ngoại lệ vừa tạo + cơ sở của hoá đơn; KHÔNG dùng chuông gom theo ngày của scanner (khoá đó nuốt lỗi thứ hai trong ngày); không tự gọi notifyStaff / tìm người nhận", () => {
    expect(dem(nguon, /\bguiThongBaoTucThoi\(\{ ngoaiLeId: id, centerId: hd\.centerId, loai: input\.loai, muc \}\)/)).toBe(1);
    expect(dem(nguon, /\bguiThongBaoNgoaiLe\b/)).toBe(0);
    expect(dem(nguon, /notifyStaff|nguoiGiuQuyenTaiCoSo/)).toBe(0);
  });
  it("cơ sở lấy từ CHÍNH hoá đơn (dòng ngoại lệ + lời gọi chuông), không từ đầu vào của người gọi", () => {
    expect(dem(nguon, /\bcenterId:\s*hd\.centerId\b/)).toBe(2);
    expect(dem(nguon, /\bcenterId\b\s*[:,]\s*input\./)).toBe(0);
  });
  it("ghi duy nhất là `hoaDonNgoaiLe.createMany` (skipDuplicates); không create/update/delete/upsert nào khác", () => {
    expect(dem(nguon, /\bhoaDonNgoaiLe\.createMany\(/)).toBe(1);
    expect(dem(nguon, /skipDuplicates:\s*true/)).toBe(1);
    expect(dem(nguon, /\.(create|update|updateMany|delete|deleteMany|upsert|executeRaw|queryRaw)\w*\(/)).toBe(0 + dem(nguon, /\.createMany\(/));
    expect(dem(nguon, /\$executeRaw|\$queryRaw|\$transaction/)).toBe(0);
  });
  it("không bỏ qua kiểm 'đã có' (mọi trạng thái) trước khi tạo: tra theo dedupeKey KHÔNG lọc trạng thái", () => {
    const m = nguon.match(/hoaDonNgoaiLe\.findFirst\(\{ where: \{ dedupeKey \}/g);
    expect(m?.length ?? 0).toBe(1);
  });
  it("đồng hồ không đọc: mốc là `input.now`", () => {
    expect(dem(nguon, /\bDate\.now\s*\(|\bnew Date\s*\(\s*\)/)).toBe(0);
  });
});

describe("[NLT-W3] không có lời gọi lạc ngoài đường phát hành", () => {
  it("trong lib/app/components, ngoài tệp định nghĩa, `phat-hanh-misa.ts` (từ chối / quá hạn) và `lenh-ky-db.ts` (lỗi ký), không tệp mã nguồn (không-test) nào gọi `baoNgoaiLeTucThoi(`", () => {
    const ra = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "lib", "app", "components"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const goi = ra
      .split(/\r?\n/)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
      .filter((f) => dem(doc(f), /\bbaoNgoaiLeTucThoi\(/) > 0)
      .sort();
    expect(goi).toEqual([DB, MAY, `${DIR}/lenh-ky-db.ts`].sort());
  });
});
