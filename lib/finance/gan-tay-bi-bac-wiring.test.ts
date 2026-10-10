// [GTB-W1..W5] — LƯỚI GHIM MÃ NGUỒN cho VIỆC 6 · MỤC 1 "sale không gắn tay được giao dịch kế toán đã BÁC cho chính đơn đó". THUẦN.
//
// Luật dạng "lời gọi này phải có ở ĐÚNG chỗ kia / không được có ở chỗ này" — ca hành vi nằm ở `gan-tay-bi-bac.test.ts` (db giả) và
// `tests/finance/pos-ban-tay-bi-bac.test.ts` (Postgres thật, không chạy trong `test:unit`), nên dây nối phải có khoá chạy ở mọi lượt `test:unit`.
//
// Mẫu (CLAUDE.md "LƯỚI GHIM MÃ NGUỒN"): bóc chú thích TRƯỚC khi đếm (chú thích giải thích bản vá chứa đúng chuỗi đang tìm — luật 11), neo theo LỜI GỌI /
// BIỂU THỨC ĐIỀU KIỆN chứ không theo chỗ đặt `await`, khẳng định SỐ LẦN khớp, và mỗi ca ghi mã TRƯỚC bản vá. Mọi ca ở đây đã được CẤY lại lỗi tương ứng và đỏ đúng tập.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, sep } from "node:path";

function bocChuThich(v: string): string {
  return v
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/[^\n]*$/, "$1"))
    .join("\n");
}

const doc = (tep: string) => bocChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
const dem = (ma: string, re: RegExp) => [...ma.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))].length;

/** Thân MỘT hàm `export async function <ten>(` tới `export` kế tiếp (hoặc hết tệp). Không thấy ⇒ chuỗi rỗng (ca đỏ). */
function ham(ma: string, ten: string): string {
  const i = ma.search(new RegExp(`export async function ${ten}\\(`));
  if (i < 0) return "";
  const j = ma.slice(i + 1).search(/\nexport /);
  return j < 0 ? ma.slice(i) : ma.slice(i, i + 1 + j);
}

const GHI = doc("lib/finance/ghi-tien-don.ts");
const ACT = doc("app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts");
const MOD = doc("lib/finance/gan-tay-bi-bac.ts");
const UI = doc("app/(admin)/admin/bien-dong-so-du/_components/xu-ly-giao-dich.tsx");
const ACT_CU = doc("app/(admin)/admin/bien-dong-so-du/_actions.ts");
const THAN = ham(GHI, "ganTienTheoCon");

describe("[GTB-W1] `ganTienTheoCon` — người gắn là trường BẮT BUỘC, hai dạng, dạng KHÁC-kế-toán buộc mang hàm đọc", () => {
  it("[GTB-W1a] đầu vào có `nguoiGan: NguoiGan;` (không `?`) — quên khai là `tsc` đỏ ở MỌI chỗ gọi, không phải cổng biến mất trong im lặng (luật 7)", () => {
    expect(THAN, "tìm thấy ganTienTheoCon").not.toBe("");
    expect(dem(THAN, /\n\s+nguoiGan: NguoiGan;/), "khai một lần, bắt buộc").toBe(1);
    expect(dem(GHI, /\bnguoiGan\?\s*:/), "không có dạng tuỳ chọn ở đâu trong tệp").toBe(0);
  });

  it("[GTB-W1b] `NguoiGan` có ĐÚNG hai dạng: `KE_TOAN` (miễn) và `KHAC` — dạng KHAC bắt buộc mang `docGiaoDichDaBiBac` (không thể nói 'không phải kế toán' mà không đưa cách kiểm)", () => {
    const m = /export type NguoiGan =\s*\|\s*\{\s*loai: "KE_TOAN"\s*\}\s*\|\s*\{\s*loai: "KHAC";\s*docGiaoDichDaBiBac: \(tx: Tx, orderId: string\) => Promise<\{ readonly giaoDich: ReadonlySet<string> \}>;?\s*\};/.exec(GHI);
    expect(m, "kiểu NguoiGan đúng hình dạng").not.toBeNull();
    expect(dem(GHI, /loai: "KE_TOAN"/), "chỉ khai kiểu — lời miễn nằm ở phía người gọi").toBe(1);
  });
});

describe("[GTB-W2] cổng DƯỚI KHOÁ — đọc bằng `tx` của chính lượt gắn, theo ĐƠN của lời gọi, kiểm ĐÚNG giao dịch", () => {
  it("[GTB-W2a] đúng MỘT biểu thức cổng: `input.nguoiGan.loai === \"KHAC\"` → `await input.nguoiGan.docGiaoDichDaBiBac(tx, input.orderId)` → `.giaoDich.has(txn.id)` → trả `CAU_GAN_TAY_DA_BI_BAC`", () => {
    expect(dem(THAN, /input\.nguoiGan\.loai === "KHAC"/), "điều kiện").toBe(1);
    // `tx` (KHÔNG `db`): đọc ngoài transaction là đọc ngoài khoá — vết bác đến giữa chừng sẽ không thấy.
    expect(dem(THAN, /await input\.nguoiGan\.docGiaoDichDaBiBac\(tx, input\.orderId\)/), "đọc bằng tx, theo đơn của lời gọi").toBe(1);
    // `.has(txn.id)`: chặn ĐÚNG giao dịch đang gắn. `soLan > 0` sẽ chặn mọi giao dịch của đơn từng có một vết bác.
    expect(dem(THAN, /\.giaoDich\.has\(txn\.id\)/), "kiểm đúng giao dịch").toBe(1);
    expect(dem(THAN, /\.soLan\b/), "không dùng số lần bị bác làm điều kiện chặn").toBe(0);
    expect(dem(THAN, /error: CAU_GAN_TAY_DA_BI_BAC/), "trả đúng hằng, không câu viết tay").toBe(1);
    expect(dem(GHI, /\bCAU_GAN_TAY_DA_BI_BAC\b/), "khai báo + đúng một chỗ dùng").toBe(2);
  });

  it("[GTB-W2b] THỨ TỰ: cổng đứng SAU từ chối về giao dịch (không thấy · MATCHED · IGNORED) và về đơn (`locDonNhanTien`), TRƯỚC bước chia và TRƯỚC phép ghi ĐẦU TIÊN (`return` không rollback)", () => {
    const vt = (re: RegExp) => THAN.search(re);
    const cong = vt(/input\.nguoiGan\.loai === "KHAC"/);
    expect(cong, "tìm thấy cổng").toBeGreaterThan(-1);
    for (const [ten, re] of [
      ["không tìm thấy giao dịch", /error: "Không tìm thấy giao dịch"/],
      ["MATCHED", /txn\.status === "MATCHED"/],
      ["IGNORED", /txn\.status === "IGNORED"/],
      ["đơn không nhận tiền", /\.\.\.locDonNhanTien\(\)/],
    ] as const) {
      const i = vt(re);
      expect(i, `tìm thấy ${ten}`).toBeGreaterThan(-1);
      expect(i, `${ten} đứng TRƯỚC cổng`).toBeLessThan(cong);
    }
    for (const [ten, re] of [
      ["bước chia", /dungDotDeChia\(so\)/],
      ["nâng đợt NULL (ghi đầu tiên)", /tx\.paymentRequest\.update\(/],
      ["phân bổ", /tx\.paymentAllocation\.create\(/],
      ["Payment", /tx\.payment\.create\(/],
      ["đổi trạng thái giao dịch", /tx\.bankTransaction\.update\(/],
      ["nhật ký", /await writeAudit\(/],
    ] as const) {
      const i = vt(re);
      expect(i, `tìm thấy ${ten}`).toBeGreaterThan(-1);
      expect(cong, `cổng đứng TRƯỚC ${ten}`).toBeLessThan(i);
    }
  });

  it("[GTB-W2c] MỘT chỗ đọc: `ghi-tien-don.ts` không tự hỏi vết bác (0 `posSaiMaYeuCau`, 0 `\"TU_CHOI\"`) và KHÔNG import `sai-ma-doc` (sẽ thành vòng phụ thuộc — `no-circular` là error)", () => {
    expect(dem(GHI, /posSaiMaYeuCau/)).toBe(0);
    expect(dem(GHI, /"TU_CHOI"/)).toBe(0);
    expect(dem(GHI, /from "[^"]*sai-ma-doc"/)).toBe(0);
  });
});

describe("[GTB-W3] action `ganGiaoDichTheoConAction` — người gắn suy từ quyền THẬT, hàm đọc là hàm DÙNG CHUNG của Việc 5, không viết lại", () => {
  it("[GTB-W3a] `coManage` = `checkPermission(\"payments:manage\")` (cùng lời gọi mà cổng cờ-tắt dùng); \"là kế toán\" của cổng V71 = `coManage` VÀ `quyenTaiCoSoCuaDon(...)` tại cơ sở CỦA ĐƠN — và cổng chung TRẢ cả hai ra", () => {
    expect(dem(ACT, /const coManage = await checkPermission\("payments:manage"\);/)).toBe(1);
    // VIỆC 6 (chốt): trước bản vá chỉ có `coManage` trần ⇒ kế toán ở BẤT KỲ cơ sở nào cũng được coi là kế toán ở đơn này (sale@CS1 + kế toán@CS2 lách cổng). Mã TRƯỚC vá: `return { …, coManage }` và `cong.coManage ? KE_TOAN : KHAC`.
    expect(dem(ACT, /const keToanTaiCoSoDon = coManage && quyenTaiCoSoCuaDon\(actor, QUYEN_KE_TOAN_SAI_MA, order\.centerId\);/), "một biểu thức, thu hẹp theo cơ sở của ĐƠN").toBe(1);
    expect(dem(ACT, /return \{ ok: true as const, session, actor, order, kieuMoi, coManage, keToanTaiCoSoDon \};/)).toBe(1);
    expect(dem(ACT, /import \{ QUYEN_KE_TOAN_SAI_MA, quyenTaiCoSoCuaDon \} from "@\/lib\/payments\/pos\/quyen-co-so";/), "hàm DÙNG CHUNG với các cổng thu thẻ POS, không bản chép").toBe(1);
  });

  it("[GTB-W3b] đúng MỘT lời gọi `ganTienTheoCon({` và `nguoiGan` là phép chọn theo `cong.coManage` — kế toán miễn, người khác mang `docGiaoDichDaBiBac` TRẦN (không bọc)", () => {
    expect(dem(ACT, /\bganTienTheoCon\(\{/), "một lời gọi").toBe(1);
    expect(dem(ACT, /nguoiGan: cong\.keToanTaiCoSoDon \? \{ loai: "KE_TOAN" \} : \{ loai: "KHAC", docGiaoDichDaBiBac \},/)).toBe(1);
    // `coManage` trần KHÔNG được quay lại làm điều kiện miễn (đó chính là lỗ đa vai): nó chỉ còn ở cổng cờ-tắt.
    expect(dem(ACT, /\bcong\.coManage\b/), "không chỗ nào dùng coManage trần của cổng chung để miễn").toBe(0);
    expect(dem(ACT, /import \{ docGiaoDichDaBiBac \} from "@\/lib\/payments\/pos\/sai-ma-doc";/), "import hàm dùng chung").toBe(1);
    expect(dem(ACT, /\bdocGiaoDichDaBiBac\b/), "import + đúng một chỗ dùng").toBe(2);
  });

  it("[GTB-W3c] action không tự hỏi vết bác: 0 `posSaiMaYeuCau`, 0 `\"TU_CHOI\"`, và `loai: \"KE_TOAN\"` chỉ xuất hiện ở phép chọn trên (không hằng `true` rải ra)", () => {
    expect(dem(ACT, /posSaiMaYeuCau/)).toBe(0);
    expect(dem(ACT, /"TU_CHOI"/)).toBe(0);
    expect(dem(ACT, /loai: "KE_TOAN"/)).toBe(1);
    expect(dem(ACT, /coQuyen|laKeToan|isAccountant/i), "không biến thể thứ hai của câu hỏi quyền").toBe(0);
  });

  it("[GTB-W3d] CỬA CŨ rót-toàn-đơn (`ganGiaoDichVaoDon`, chỉ kế toán, KHÔNG đọc vết bác) đóng cho người chỉ-là-sale tại cơ sở của đơn: đúng MỘT `quyenTaiCoSoCuaDon(ctx.actor, QUYEN_KE_TOAN_SAI_MA, order.centerId)`, đứng SAU khi đã đọc đơn và TRƯỚC `allocateToOrder(`", () => {
    const cuaCu = ham(ACT_CU, "ganGiaoDichVaoDon");
    expect(cuaCu, "tìm thấy cửa cũ").not.toBe("");
    expect(dem(cuaCu, /if \(!quyenTaiCoSoCuaDon\(ctx\.actor, QUYEN_KE_TOAN_SAI_MA, order\.centerId\)\) return \{ ok: false, error: "Không tìm thấy đơn hàng" \};/), "đúng một biểu thức, câu không phân biệt 'không có' với 'không thuộc cơ sở bạn'").toBe(1);
    const vt = (re: RegExp) => cuaCu.search(re);
    expect(vt(/const order = await sdb\.order\.findUnique/), "đơn đã đọc").toBeGreaterThan(-1);
    expect(vt(/const order = await sdb\.order\.findUnique/)).toBeLessThan(vt(/quyenTaiCoSoCuaDon\(/));
    expect(vt(/quyenTaiCoSoCuaDon\(/), "cổng đứng TRƯỚC phép ghi tiền").toBeLessThan(vt(/await allocateToOrder\(/));
    expect(dem(ACT_CU, /import \{ QUYEN_KE_TOAN_SAI_MA, quyenTaiCoSoCuaDon \} from "@\/lib\/payments\/pos\/quyen-co-so";/)).toBe(1);
  });
});

describe("[GTB-W5] BÁO TRƯỚC ở bước chọn đơn (mục e) — chỉ là lời nhắc cho màn, KHÔNG thay cổng; cùng MỘT nguồn dữ liệu và MỘT câu chữ với cổng", () => {
  const LOADER = ham(ACT, "taiChiTietDonDeGan");

  it("[GTB-W5a] `taiChiTietDonDeGan(orderId, bankTransactionId)` — tham số BẮT BUỘC; báo trước bằng đúng MỘT biểu thức `!cong.coManage && await giaoDichDaBiBacChoDon(…)` → trả `CAU_GAN_TAY_DA_BI_BAC`; đứng SAU `congGanVaoDon` (cổng cũ nói trước) và TRƯỚC `noTheoCon`", () => {
    expect(LOADER, "tìm thấy hàm nạp chi tiết").not.toBe("");
    expect(dem(LOADER, /taiChiTietDonDeGan\(\s*orderId: string,\s*bankTransactionId: string,\s*\)/), "chữ ký: giao dịch là tham số bắt buộc (không `?`, không mặc định)").toBe(1);
    expect(dem(LOADER, /if \(!cong\.keToanTaiCoSoDon && \(await giaoDichDaBiBacChoDon\(orderId, bankTransactionId\)\)\) \{\s*return \{ error: CAU_GAN_TAY_DA_BI_BAC \};\s*\}/), "đúng một biểu thức báo trước").toBe(1);
    const vt = (re: RegExp) => LOADER.search(re);
    expect(vt(/await congGanVaoDon\(/), "cổng chung đứng trước").toBeGreaterThan(-1);
    expect(vt(/await congGanVaoDon\(/)).toBeLessThan(vt(/giaoDichDaBiBacChoDon\(/));
    expect(vt(/giaoDichDaBiBacChoDon\(/)).toBeLessThan(vt(/await noTheoCon\(/));
    // Đúng MỘT chỗ gọi hàm báo trước trong cả tệp action — ở đây, không ở `ganGiaoDichTheoConAction` (xem W5d).
    expect(dem(ACT, /\bgiaoDichDaBiBacChoDon\(/)).toBe(1);
  });

  it("[GTB-W5b] MỘT NGUỒN: mô-đun báo trước hỏi `docGiaoDichDaBiBac(db, orderId)` rồi `.giaoDich.has(bankTransactionId)` — 0 truy vấn `TU_CHOI` riêng, 0 `posSaiMaYeuCau`, 0 `scopedDb`", () => {
    expect(MOD, "tìm thấy mô-đun").not.toBe("");
    expect(dem(MOD, /await docGiaoDichDaBiBac\(db, orderId\)/), "đọc bằng db TRẦN, theo đơn").toBe(1);
    expect(dem(MOD, /\.giaoDich\.has\(bankTransactionId\)/), "kiểm đúng giao dịch").toBe(1);
    expect(dem(MOD, /posSaiMaYeuCau/)).toBe(0);
    expect(dem(MOD, /"TU_CHOI"/)).toBe(0);
    expect(dem(MOD, /scopedDb/)).toBe(0);
    expect(dem(MOD, /\.soLan\b/), "không dùng số lần bị bác làm điều kiện").toBe(0);
    // Câu chữ: cổng và lời báo trước dùng CÙNG MỘT hằng (khai ở ghi-tien-don.ts, dùng ở action đúng một lần cho báo trước).
    expect(dem(ACT, /\bCAU_GAN_TAY_DA_BI_BAC\b/), "import + đúng một chỗ dùng (báo trước)").toBe(2);
  });

  it("[GTB-W5c] CẢ HAI chỗ UI gọi `taiChiTietDonDeGan(` đều truyền `bankTransactionId` (giao dịch đang gắn)", () => {
    expect(dem(UI, /\btaiChiTietDonDeGan\(/), "đúng hai chỗ gọi").toBe(2);
    expect(dem(UI, /\btaiChiTietDonDeGan\([A-Za-z.]+, bankTransactionId\)/), "cả hai truyền giao dịch").toBe(2);
  });

  it("[GTB-W5d] báo trước KHÔNG thay cổng: `ganGiaoDichTheoConAction` không gọi hàm báo trước (cổng ở lib đọc lại dưới khoá), và `ghi-tien-don.ts` không biết mô-đun báo trước", () => {
    const hanhDong = ham(ACT, "ganGiaoDichTheoConAction");
    expect(hanhDong, "tìm thấy action").not.toBe("");
    expect(dem(hanhDong, /giaoDichDaBiBacChoDon/), "action gắn không dùng hàm báo trước").toBe(0);
    expect(dem(GHI, /gan-tay-bi-bac/), "lib ghi tiền không biết mô-đun báo trước").toBe(0);
  });
});

describe("[GTB-W4] CẢ CÂY: `ganTienTheoCon(` chỉ có ĐÚNG hai nơi trong mã chạy thật — định nghĩa và action đã có cổng", () => {
  const GOC = process.cwd();
  const THU_MUC = ["app", "lib", "components", "scripts"];
  const BO_QUA = new Set(["node_modules", ".next", ".git"]);
  const LA_MA = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
  const LA_TEST = /\.(?:test|spec)\.[^.]+$/;

  function quet(thuMuc: string, ra: string[]) {
    for (const ten of readdirSync(thuMuc)) {
      if (BO_QUA.has(ten)) continue;
      const duong = resolve(thuMuc, ten);
      const st = statSync(duong);
      if (st.isDirectory()) quet(duong, ra);
      else if (LA_MA.test(ten) && !LA_TEST.test(ten)) ra.push(duong);
    }
  }

  it("[GTB-W4a] mọi tệp mã (không phải test) gọi `ganTienTheoCon(` đều nằm trong danh sách — thêm một cửa gắn mới là ĐỎ cho tới khi nó mang `nguoiGan` và vào danh sách này", { timeout: 60_000 }, () => {
    const tep: string[] = [];
    for (const d of THU_MUC) quet(resolve(GOC, d), tep);
    expect(tep.length, "quét được mã nguồn").toBeGreaterThan(500);
    // Lọc thô bằng `includes` TRƯỚC khi bóc chú thích: bóc chú thích cả vài nghìn tệp là việc thừa (và đã làm ca này quá 60 giây dưới tải); chỉ tệp có chữ mới đáng bóc.
    const co = tep
      .filter((t) => {
        const ma = readFileSync(t, "utf8");
        return ma.includes("ganTienTheoCon") && dem(bocChuThich(ma), /\bganTienTheoCon\s*\(/) > 0;
      })
      .map((t) => relative(GOC, t).split(sep).join("/"))
      .sort();
    expect(co).toEqual(["app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts", "lib/finance/ghi-tien-don.ts"]);
  });
});
