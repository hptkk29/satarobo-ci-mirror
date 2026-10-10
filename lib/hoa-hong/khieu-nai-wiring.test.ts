// @vitest-environment node
/**
 * LƯỚI GHIM MÃ NGUỒN của KHIẾU NẠI HOA HỒNG (PR11). Hành vi do ca DB (`tests/hoa-hong/khieu-nai*.spec.ts`) canh; lưới này canh những điều mà ca hành vi KHÔNG
 * chứng minh được vì chúng là "lời gọi này phải đứng trước/sau lời gọi kia" hoặc "không được có đường thứ hai":
 *
 *   [NHH-DSP-W1]  nội dung đã gửi BẤT BIẾN: không `update*` nào trên `CommissionDispute` chạm `reason`/`evidence`/đích/người gửi; không `delete*`; không SQL thô
 *                 UPDATE/DELETE; `commissionDispute.create(` đúng MỘT chỗ (`taoKhieuNai`)
 *   [NHH-DSP-W2]  dòng điều chỉnh tiền chỉ đi qua `ghiDong` (đường ghi sổ duy nhất), KHÔNG `commissionTransaction.create*` trong tệp khiếu nại
 *   [NHH-DSP-W3]  trong `duyetTien`: khoá hàng khiếu nại → khoá ô → khoá kỳ → GHI dòng → cập nhật khiếu nại (cổng đứng TRƯỚC phép ghi đầu tiên; CLAUDE.md "Luật rollback")
 *   [NHH-DSP-W4]  MỌI đường của người duyệt (nhận · quyết · đóng) đi qua cổng chung `docDeXuLy` — phạm vi + quyền + "người duyệt ≠ người khiếu nại"
 *   [NHH-DSP-W5]  `taoKhieuNai`: kiểm quyền gửi TRƯỚC khi xác định đích và TRƯỚC giao dịch
 *   [NHH-DSP-W6]  Server Action: mỗi action `assertPermission(KEY)` TRƯỚC `resolveActor`, đúng KEY mà nút vẽ (hằng dùng chung), có kiểm cờ engine
 *   [NHH-DSP-W7]  mọi hàm đọc đi qua `phamViKhieuNai`; không `scopedDb(` (khiếu nại của chính mình phải thấy ở mọi cơ sở)
 *   [NHH-DSP-W8]  service KHÔNG gửi thông báo (thông báo gửi SAU commit ở tầng điều phối)
 *   [NHH-DSP-W9]  tab đếm hàng chờ khiếu nại chỉ cho người giữ quyền duyệt
 *
 * Quy tắc viết lưới (CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN", luật 11/14): neo vào LỜI GỌI, bỏ chú thích trước khi so, đếm số lần khớp, không cờ `/s`; mỗi lưới có
 * phép tự-kiểm "đã quét đủ tệp" để một lần quét rỗng không thành xanh giả. Đã cấy lỗi — danh sách ca đỏ ghi ở docs/source-commission/05.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const boChuThich = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const dem = (s: string, m: string | RegExp) =>
  typeof m === "string" ? s.split(m).length - 1 : (s.match(new RegExp(m.source, m.flags.includes("g") ? m.flags : `${m.flags}g`)) ?? []).length;

type Tep = { ten: string; code: string };

function maChayToanCay(): Tep[] {
  const ds = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "lib", "app", "scripts", "components"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split(/\r?\n/)
    .filter((d) => /\.(ts|tsx|mjs|cjs)$/.test(d) && !/\.(test|spec)\.(ts|tsx)$/.test(d) && !d.endsWith(".d.ts"))
    .filter((d) => existsSync(resolve(process.cwd(), d)));
  return ds.map((ten) => ({ ten, code: boChuThich(readFileSync(resolve(process.cwd(), ten), "utf8")) }));
}

const TEP = maChayToanCay();
const doc = (ten: string): string => {
  const t = TEP.find((x) => x.ten === ten);
  if (!t) throw new Error(`thiếu tệp ${ten} trong cây mã`);
  return t.code;
};
const DV = "lib/hoa-hong/khieu-nai.ts";
const ACTIONS = "app/(admin)/admin/nguon-hoa-hong/khieu-nai/_actions.ts";

/** Phần `data: { ... }` của một lời gọi `.update*(` bắt đầu tại `viTri` — đếm ngoặc, không regex lười. */
function trichData(src: string, viTri: number): string {
  const i = src.indexOf("data:", viTri);
  if (i < 0) return "";
  const b = src.indexOf("{", i);
  if (b < 0) return "";
  let sau = 0;
  for (let j = b; j < src.length; j += 1) {
    if (src[j] === "{") sau += 1;
    else if (src[j] === "}") {
      sau -= 1;
      if (sau === 0) return src.slice(b, j + 1);
    }
  }
  return src.slice(b);
}

/** Thân hàm từ `mo` tới mốc kế tiếp `// ═══` / `async function` cùng cấp. */
function than(src: string, mo: string): string {
  const i = src.indexOf(mo);
  if (i < 0) throw new Error(`không thấy ${mo}`);
  const rest = src.slice(i + mo.length);
  const j = rest.search(/\n(?:export )?async function |\nexport function /);
  return j < 0 ? rest : rest.slice(0, j);
}

describe("[NHH-DSP-W] khiếu nại — lưới ghim mã nguồn", () => {
  it("[NHH-DSP-W0] tự-kiểm: đã quét đủ cây mã và thấy các tệp khiếu nại", () => {
    expect(TEP.length).toBeGreaterThan(500);
    for (const t of [DV, "lib/hoa-hong/khieu-nai-doc.ts", "lib/hoa-hong/khieu-nai-hanh-dong.ts", ACTIONS]) expect(TEP.some((x) => x.ten === t), t).toBe(true);
  });

  it("[NHH-DSP-W1] nội dung đã gửi BẤT BIẾN: không `update*` nào chạm lý do/bằng chứng/đích/người gửi; không `delete*`; không SQL thô UPDATE/DELETE; `create(` đúng một chỗ", () => {
    const CAM = /\b(reason|evidence|raisedByUserId|transactionId|paymentId|createdAt)\s*:/;
    let soLoiGoiUpdate = 0;
    for (const t of TEP) {
      const re = /\bcommissionDispute\.(update|updateMany|upsert)\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(t.code))) {
        soLoiGoiUpdate += 1;
        const data = trichData(t.code, m.index);
        expect(data, `${t.ten}: ${m[1]} lên CommissionDispute phải có \`data\``).not.toBe("");
        expect(CAM.test(data), `${t.ten}: \`${m[1]}\` chạm cột BẤT BIẾN → ${data.slice(0, 120)}`).toBe(false);
        expect(m[1], `${t.ten}: không dùng upsert/update đơn lẻ (update không có điều kiện trạng thái là ghi mù)`).toBe("updateMany");
      }
      expect(dem(t.code, /\bcommissionDispute\.(delete|deleteMany)\(/), `${t.ten}: xoá khiếu nại`).toBe(0);
      expect(dem(t.code, /DELETE\s+FROM\s+"CommissionDispute"/i), `${t.ten}: SQL thô xoá`).toBe(0);
      expect(dem(t.code, /UPDATE\s+"CommissionDispute"/i), `${t.ten}: SQL thô sửa`).toBe(0);
    }
    // vế dương: lưới nhìn đúng chỗ — dịch vụ có đủ các lời gọi updateMany (nhận · quyết không tiền · quyết tiền · đóng tự động · đóng tay)
    expect(soLoiGoiUpdate).toBeGreaterThanOrEqual(5);
    expect(dem(doc(DV), /\bcommissionDispute\.updateMany\(/)).toBe(soLoiGoiUpdate);
    const taoO = TEP.map((t) => ({ ten: t.ten, n: dem(t.code, /\bcommissionDispute\.create\(/) })).filter((x) => x.n > 0);
    expect(taoO).toEqual([{ ten: DV, n: 1 }]);
  });

  it("[NHH-DSP-W2] dòng điều chỉnh tiền chỉ đi qua `ghiDong`: tệp khiếu nại KHÔNG `commissionTransaction.create*`, có đúng MỘT lời gọi `h.ghiDong(` và `chayTrongKhoa(`", () => {
    for (const t of TEP.filter((x) => /^lib\/hoa-hong\/khieu-nai/.test(x.ten))) {
      expect(dem(t.code, /\bcommissionTransaction\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/), t.ten).toBe(0);
    }
    const dv = doc(DV);
    expect(dem(dv, /\bh\.ghiDong\(/)).toBe(1);
    expect(dem(dv, /\bchayTrongKhoa\(/)).toBe(1);
    expect(dem(dv, /\bdungDongDieuChinhKhieuNai\(/)).toBe(1);
  });

  it("[NHH-DSP-W3] `duyetTien`: khoá hàng khiếu nại → khoá ô → khoá kỳ → GHI dòng → cập nhật khiếu nại → audit → đóng (cổng TRƯỚC phép ghi đầu tiên)", () => {
    const b = than(doc(DV), "async function duyetTien(");
    const vt = (s: string) => {
      const i = b.indexOf(s);
      expect(i, `thiếu ${s}`).toBeGreaterThanOrEqual(0);
      expect(dem(b, s), `${s} xuất hiện đúng một lần`).toBe(1);
      return i;
    };
    const khoaHang = vt("await khoaHang(tx, d.id)");
    const khoaO = vt("await h.khoaO(");
    const khoaKy = vt("await h.khoaKyDeGhi(");
    const ghi = vt("await h.ghiDong(");
    const capNhat = vt("tx.commissionDispute.updateMany(");
    const audit = vt("await writeAudit(");
    const dong = vt("await dongTuDong(tx, d, \"APPROVED\"");
    expect([khoaHang, khoaO, khoaKy, ghi, capNhat, audit, dong]).toEqual([khoaHang, khoaO, khoaKy, ghi, capNhat, audit, dong].slice().sort((x, y) => x - y));
    // Không `return { ok: false` / `return fail(` ở bất kỳ đâu sau phép ghi (từ chối sau khi ghi = `throw`)
    expect(dem(b.slice(ghi), /\breturn\s*\{\s*ok\s*:\s*false/)).toBe(0);
  });

  it("[NHH-DSP-W4] nhận · quyết · đóng đều đi qua cổng chung `docDeXuLy` (phạm vi · quyền · người duyệt ≠ người khiếu nại): đúng 3 chỗ gọi, và cổng có đủ ba phép thử", () => {
    const dv = doc(DV);
    expect(dem(dv, /\bdocDeXuLy\(/)).toBe(4); // 1 định nghĩa + 3 chỗ gọi
    const cong = than(dv, "async function docDeXuLy(");
    expect(dem(cong, /passesScope\("CommissionDispute"/)).toBe(1);
    expect(dem(cong, /can\(nguoi\.quyen, KEY_DUYET_KHIEU_NAI\)/)).toBe(1);
    expect(dem(cong, /d\.raisedByUserId === nguoi\.userId/)).toBe(1);
    // ba hàm công khai mỗi hàm gọi cổng TRƯỚC `$transaction`/`chayTrongKhoa`
    for (const [mo, ten] of [["export async function nhanKhieuNai(", "nhan"], ["export async function quyetDinhKhieuNai(", "quyet"], ["export async function dongKhieuNaiDoiNguon(", "dong"]] as const) {
      const b = than(dv, mo);
      const iCong = b.indexOf("await docDeXuLy(");
      const iGhi = Math.min(...["$transaction(", "chayTrongKhoa(", "duyetTien(", "quyetKhongTien("].map((s) => b.indexOf(s)).filter((i) => i >= 0));
      expect(iCong, `${ten}: có cổng`).toBeGreaterThanOrEqual(0);
      expect(iCong, `${ten}: cổng đứng trước phép ghi`).toBeLessThan(iGhi);
    }
  });

  it("[NHH-DSP-W5] `taoKhieuNai`: kiểm quyền gửi (view-self) TRƯỚC khi xác định đích và TRƯỚC giao dịch; đích xác định TRƯỚC giao dịch", () => {
    const b = than(doc(DV), "export async function taoKhieuNai(");
    const iQuyen = b.indexOf("can(i.nguoi.quyen, KEY_TAO_KHIEU_NAI)");
    const iDich = b.indexOf("await docDichDeTao(");
    const iTx = b.indexOf("client.$transaction(");
    expect(iQuyen).toBeGreaterThanOrEqual(0);
    expect(iQuyen).toBeLessThan(iDich);
    expect(iDich).toBeLessThan(iTx);
    expect(dem(b, "can(i.nguoi.quyen, KEY_TAO_KHIEU_NAI)")).toBe(1);
  });

  it("[NHH-DSP-W6] Server Action: mỗi action `assertPermission(KEY)` TRƯỚC `resolveActor`; tạo = KEY_TAO, còn lại = KEY_DUYET; không key viết tay; có kiểm cờ engine; chỉ export hàm async", () => {
    const a = doc(ACTIONS);
    const raw = readFileSync(resolve(process.cwd(), ACTIONS), "utf8");
    expect(raw.trimStart().startsWith("\"use server\"") || raw.trimStart().startsWith("'use server'") || raw.includes("\"use server\";")).toBe(true);
    const ham = [...a.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    expect(ham).toEqual(["taoKhieuNaiAction", "nhanKhieuNaiAction", "quyetDinhKhieuNaiAction", "dongKhieuNaiAction"]);
    expect(dem(a, /\bexport\s+(?!async function)(?:const|let|var|function|class|type|interface)\b/)).toBe(0);
    expect(dem(a, /["']commission[_:]/)).toBe(0); // không key viết tay — đi qua hằng chung
    for (const [i, h] of ham.entries()) {
      const b = than(a, `export async function ${h}(`);
      const key = i === 0 ? "KEY_TAO_KHIEU_NAI" : "KEY_DUYET_KHIEU_NAI";
      const iQuyen = b.indexOf(`assertPermission(${key})`);
      expect(iQuyen, `${h}: assertPermission(${key})`).toBeGreaterThanOrEqual(0);
      expect(dem(b, /assertPermission\(/), `${h}: đúng một lần kiểm quyền`).toBe(1);
      expect(iQuyen, `${h}: kiểm quyền trước resolveActor`).toBeLessThan(b.indexOf("resolveActor("));
      expect(iQuyen, `${h}: kiểm quyền trước điều phối`).toBeLessThan(b.indexOf("await hanhDong"));
      expect(dem(b, /\blaEngineHoaHongBat\(\)/), `${h}: kiểm cờ engine`).toBe(1);
      expect(dem(b, /\bauth\(\)/), `${h}: auth() đầu hàm`).toBe(1);
      // Lưới câm tìm ra khi cấy lại 09/10: gỡ guard đăng nhập thì cả bộ vẫn xanh (assertPermission chặn thay, nhưng người chưa đăng nhập đọc "không có quyền" thay vì "chưa đăng nhập").
      expect(dem(b, /if \(!session\?\.user\) return tuChoi\(/), `${h}: guard chưa đăng nhập`).toBe(1);
      expect(b.indexOf("if (!session?.user)"), `${h}: guard đăng nhập trước kiểm quyền`).toBeLessThan(iQuyen);
    }
  });

  it("[NHH-DSP-W7] mọi hàm đọc đi qua `phamViKhieuNai`; KHÔNG `scopedDb(`; phạm vi 'của mình' khoá cứng theo `raisedByUserId`", () => {
    const d = doc("lib/hoa-hong/khieu-nai-doc.ts");
    expect(dem(d, /\bphamViKhieuNai\(/)).toBe(4); // 1 định nghĩa + danh sách + đếm + chi tiết
    expect(dem(d, /\bscopedDb\(/)).toBe(0);
    expect(dem(d, /raisedByUserId:\s*actor\.userId/)).toBeGreaterThanOrEqual(1);
    // chi tiết: `where` luôn gộp phạm vi (không findUnique trần theo id)
    const ct = than(d, "export async function docChiTietKhieuNai(");
    expect(dem(ct, /where:\s*\{\s*AND:\s*\[\{\s*id\s*\},\s*pv\.where\s*\]\s*\}/)).toBe(1);
    expect(dem(ct, /commissionDispute\.findUnique\(/)).toBe(0);
    const man = doc("lib/hoa-hong/khieu-nai-man.ts");
    expect(dem(man, /\bscopedDb\(/)).toBe(0);
  });

  it("[NHH-DSP-W8] service KHÔNG gửi thông báo; điều phối gửi SAU khi service trả về (thành công), mỗi loại đúng một lần", () => {
    const dv = doc(DV);
    expect(dem(dv, /ghiThongBaoNhanSu|khieu-nai-gui-thong-bao|baoKhieuNaiMoi|baoKetQuaKhieuNai/)).toBe(0);
    const hd = doc("lib/hoa-hong/khieu-nai-hanh-dong.ts");
    const tao = than(hd, "export async function hanhDongTao(");
    expect(tao.indexOf("await taoKhieuNai(")).toBeGreaterThanOrEqual(0);
    expect(tao.indexOf("await taoKhieuNai(")).toBeLessThan(tao.indexOf("await baoKhieuNaiMoi("));
    const quyet = than(hd, "export async function hanhDongQuyet(");
    expect(quyet.indexOf("await quyetDinhKhieuNai(")).toBeLessThan(quyet.indexOf("await baoKetQuaKhieuNai("));
    expect(dem(hd, /\bawait baoKhieuNaiMoi\(/)).toBe(1);
    expect(dem(hd, /\bawait baoKetQuaKhieuNai\(/)).toBe(1);
  });

  it("[NHH-DSP-W9] đếm hàng chờ của tab: chỉ khi người xem giữ `commission_disputes:review` (và thấy tab); hàm đếm trả null cho người không duyệt", () => {
    const h = doc("lib/nguon-hoa-hong/hang-cho.ts");
    expect(dem(h, /scope\.tabMoDuoc\("khieu-nai"\)\s*&&\s*scope\.has\("commission_disputes:review"\)\s*\?\s*demKhieuNaiChoTab\(actor\)/)).toBe(1);
    const d = doc("lib/hoa-hong/khieu-nai-doc.ts");
    const dem2 = than(d, "export async function demKhieuNaiCanXuLy(");
    expect(dem2.indexOf("if (!can(actor, KEY_DUYET_KHIEU_NAI)) return null;")).toBeGreaterThanOrEqual(0);
    expect(dem2.indexOf("raisedByUserId: { not: actor.userId }")).toBeGreaterThanOrEqual(0);
  });
});
