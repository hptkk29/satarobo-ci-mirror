// lib/payments/pos/huy-phieu-the-db.test.ts — LƯỚI GHIM MÃ NGUỒN cho phần MÁY CHỦ của nút "Huỷ phiếu thẻ" (Việc 4 · S).
//
// Vì sao cần lưới văn bản bên cạnh `tests/finance/pos-huy-phieu-the.test.ts` (ca hành vi trên Postgres thật): có những luật
// KHÔNG quan sát được bằng hành vi, và hai lớp bảo vệ dự phòng nhau thì bỏ một lớp không làm ca hành vi nào đỏ (cùng bài học
// `[POS2-PL-08b]` của poller):
//   · THỨ TỰ KHOÁ đơn → dòng phiếu: khoá dòng một mình đã chặn ghi đôi; bỏ khoá đơn ⇒ ca đua vẫn xanh, chỉ mở lại khả năng
//     vòng chờ (deadlock) với đường tiền đã khoá đơn trước;
//   · `updateMany` CÓ ĐIỀU KIỆN là lớp thứ hai sau "đọc lại dưới khoá": cấy bỏ điều kiện thì ca hành vi vẫn xanh vì lớp một đã đủ;
//   · chỉ MỘT phép ghi, và chỉ vào `posPaymentIntent` (đặc tả 5: không đụng bill/order/payment) — một phép ghi thứ hai vô hại với
//     mọi ca hành vi cho tới ngày nó ghi nhầm tiền.
//
// Mẫu: neo BIỂU THỨC (không neo chỗ đặt chữ), bỏ chú thích TRƯỚC khi đếm (chú thích giải thích bản vá chứa đúng chuỗi lưới tìm),
// đếm SỐ LẦN khớp, và có ĐỐI CHỨNG của bộ quét (luật 11, 14 của repo). THUẦN — không DB, chạy trong `test:unit`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf8");
/**
 * Bỏ chú thích khối MỞ Ở ĐẦU DÒNG + chú thích dòng. Chuỗi chứa `/*` giữa dòng (đường dẫn glob) mà bị nhận là mở chú thích sẽ
 * nuốt cả đoạn mã ⇒ chỉ nhận khối mở ở đầu dòng (JSDoc luôn thế).
 */
const boChuThich = (s: string) => s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/.*$/gm, "");
const dem = (ma: string, re: RegExp) => [...ma.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))].length;

const TEP_DB = "lib/payments/pos/huy-phieu-the-db.ts";
const TEP_ACTION = "app/(admin)/admin/orders/_actions.ts";

/** Thân MỘT hàm cấp module: từ khai báo tới dòng `}` ĐẦU TIÊN ở cột 0 (cùng cách `thanAction` cắt). VIỆC 6 · a3. */
function thanHam(ma: string, khaiBao: string): string {
  const dau = ma.indexOf(khaiBao);
  if (dau < 0) return "";
  const sau = ma.slice(dau);
  return sau.slice(0, sau.search(/\r?\n\}\r?\n/) + 3);
}

/** Thân `huyPhieuTheAction`: từ khai báo tới dòng `}` ĐẦU TIÊN ở cột 0 (cùng cách `[HN4-W5]` cắt). */
function thanAction(ma: string): string {
  const dau = ma.indexOf("export async function huyPhieuTheAction(");
  if (dau < 0) return "";
  const sau = ma.slice(dau);
  return sau.slice(0, sau.search(/\r?\n\}\r?\n/) + 3);
}

/**
 * Thân CALLBACK của `$transaction(`: từ `{` đầu tiên sau mốc tới `}` khớp (cùng cách `cong-truoc-phep-ghi.test.ts` cắt). Nhánh `catch` đứng
 * NGOÀI callback — nơi dịch lỗi ném thành `{ ok: false }` cho người dùng là hợp lệ (luật rollback chỉ cấm `return` từ chối BÊN TRONG).
 */
function thanCallbackTx(ma: string): string {
  const dau = ma.indexOf("$transaction(");
  if (dau < 0) return "";
  const mo = ma.indexOf("{", dau);
  let sau = 0;
  for (let i = mo; i < ma.length; i += 1) {
    if (ma[i] === "{") sau += 1;
    else if (ma[i] === "}") {
      sau -= 1;
      if (sau === 0) return ma.slice(mo, i + 1);
    }
  }
  return "";
}

describe("[HN4-S-W] huyPhieuThe (huy-phieu-the-db.ts) — thứ tự khoá · một phép ghi · cổng trước phép ghi", () => {
  const ma = boChuThich(doc(TEP_DB));

  it("[HN4-S-W0] ĐỐI CHỨNG của bộ quét: đọc được tệp thật và thấy hàm xuất ra (lưới rỗng thì mọi ca dưới xanh vô nghĩa)", () => {
    expect(ma.length).toBeGreaterThan(500);
    expect(dem(ma, /\bexport async function huyPhieuThe\(/), "đúng MỘT hàm xuất ra").toBe(1);
    expect(dem(ma, /\$transaction\(/), "đúng MỘT transaction").toBe(1);
  });

  it("[HN4-S-W1] THỨ TỰ trong transaction: khoá ĐƠN → khoá DÒNG → đọc lại phiếu → mốc quét → yêu cầu sai mã (đang giữ · mới nhất) → nhận ra câu từ chối → CỔNG → phép ghi (lời gọi hàm ghi dùng chung — vết nằm trong hàm đó) (mỗi mốc đúng một lần)", () => {
    const cb = thanCallbackTx(ma);
    expect(cb.length, "cắt được thân callback").toBeGreaterThan(500);
    const MOC: [string, RegExp][] = [
      ["khoá đơn", /\bkhoaDonTrongTx\(tx,\s*input\.orderId\)/],
      ["khoá dòng phiếu thẻ", /\bkhoaPhieuPosTrongTx\(tx,\s*input\.intentId\)/],
      ["đọc lại phiếu thẻ dưới khoá", /\btx\.posPaymentIntent\.findUnique\(/],
      ["giao dịch chờ tay", /\bmaCoGiaoDichChoTay\(tx,/],
      ["cờ yêu cầu sai mã đang giữ (Việc 3)", /\bcoYeuCauSaiMaDangGiu\(tx,/],
      // VIỆC 6 · a2: cờ "mới nhất bị từ chối" đã gỡ; thay bằng đọc yêu cầu MỚI NHẤT (trạng thái + lý do) rồi nhận ra câu lưu sau từ chối.
      ["yêu cầu sai mã MỚI NHẤT (Việc 3 · VIỆC 6)", /\byeuCauSaiMaMoiNhat\(tx,/],
      ["nhận ra câu lưu sau từ chối", /\blaCauLuuTuChoiSaiMa\(/],
      ["cổng luật thuần", /\bchoPhepHuyPhieuThe\(/],
      // VIỆC 6 · a3: phép ghi + vết dời xuống `ghiHuyPhieuTheTrongTx` (dừng học dùng CHUNG, không có đường ghi HUY thứ hai); callback chỉ GỌI nó — thân hàm ghi canh ở `[HN4-S-W3]`/`[HN4-S-W6]`.
      ["phép ghi (hàm ghi dùng chung)", /\bghiHuyPhieuTheTrongTx\(tx,/],
    ];
    let truoc = -1;
    for (const [ten, re] of MOC) {
      expect(dem(cb, re), `${ten}: đúng một lần`).toBe(1);
      const i = cb.search(re);
      expect(i, `${ten}: đứng SAU mốc trước`).toBeGreaterThan(truoc);
      truoc = i;
    }
  });

  it("[HN4-S-W2] CHỈ MỘT phép ghi, và là `updateMany` vào `posPaymentIntent` (không `update` trần — ném khi không thấy; không ghi bill/order/payment/giao dịch)", () => {
    const ghi = [...ma.matchAll(/\btx\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(ghi, "đúng một phép ghi qua tx").toEqual(["posPaymentIntent.updateMany"]);
    expect(dem(ma, /\$executeRaw|\$queryRaw|\$executeRawUnsafe/), "khoá đi qua hàm module, không viết SQL thô ở đây").toBe(0);
    expect(dem(ma, /\bdb\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/), "không ghi ngoài transaction").toBe(0);
    // Vết đi CÙNG transaction.
    expect(dem(ma, /\bwriteAudit\(\{\s*tx,/), "vết ghi bằng CHÍNH tx").toBe(1);
  });

  it("[HN4-S-W3] `updateMany` (trong `ghiHuyPhieuTheTrongTx` — hàm ghi DÙNG CHUNG) mang điều kiện: còn MỞ và CHƯA nhận giao dịch; chỉ đổi `status` thành HUY; đổi 0 dòng ⇒ NÉM (rollback), không `return` từ chối nào đứng SAU phép ghi", () => {
    // VIỆC 6 · a3: phép ghi dời khỏi callback xuống `ghiHuyPhieuTheTrongTx` (nút tay VÀ dừng học huỷ kèm cùng dùng — không có đường ghi HUY thứ hai). LÝ LẼ của ca không đổi một chữ: điều kiện
    // `updateMany` là lớp thứ hai sau "đọc lại dưới khoá"; đổi 0 dòng là bất khả ⇒ NÉM; sau phép ghi không có `return` từ chối. Chỉ ĐỔI CHỖ canh: thân hàm ghi thay vì callback.
    const ham = thanHam(ma, "export async function ghiHuyPhieuTheTrongTx(");
    expect(ham.length, "cắt được thân hàm ghi").toBeGreaterThan(300);
    const iGhi = ham.search(/\btx\.posPaymentIntent\.updateMany\(/);
    expect(iGhi).toBeGreaterThan(-1);
    const sauGhi = ham.slice(iGhi);
    const khoiGhi = sauGhi.slice(0, sauGhi.indexOf(");") + 2);
    expect(khoiGhi).toMatch(/\bstatus:\s*\{\s*in:\s*\[\.\.\.TRANG_THAI_MO\]\s*\}/);
    expect(khoiGhi).toMatch(/\bbankTransactionId:\s*null\b/);
    expect(khoiGhi).toMatch(/\bdata:\s*\{\s*status:\s*"HUY"\s*\}/);
    expect(dem(khoiGhi, /\bdata:/), "không đổi cột nào khác (mã, kết quả lượt kiểm, giao dịch đã nhận giữ nguyên)").toBe(1);
    expect(sauGhi, "đổi 0 dòng dưới khoá = bất khả ⇒ NÉM để rollback").toMatch(/if\s*\(\s*\w+\.count\s*===\s*0\s*\)\s*throw\b/);
    expect(dem(sauGhi, /\breturn\s*\{\s*ok:\s*false\b/), "luật rollback: sau phép ghi chỉ NÉM, không `return { ok: false }`").toBe(0);
    expect(dem(ham, /\breturn\b/), "hàm ghi KHÔNG có đường `return` sớm nào (không từ chối; hai người gọi đều giữ cổng riêng)").toBe(0);
    // Callback của NÚT TAY: mọi cổng từ chối đứng TRƯỚC lời gọi hàm ghi (từng cổng được ghim theo BIỂU THỨC ở `[HN4-S-W8]`; ở đây chỉ đòi có cổng); sau lời gọi chỉ NÉM.
    const cb = thanCallbackTx(ma);
    const iGoi = cb.search(/\bghiHuyPhieuTheTrongTx\(tx,/);
    expect(iGoi, "callback GỌI hàm ghi").toBeGreaterThan(-1);
    expect(dem(cb.slice(0, iGoi), /\breturn\s*\{\s*ok:\s*false\b/), "có cổng từ chối trước phép ghi").toBeGreaterThanOrEqual(1);
    expect(dem(cb.slice(iGoi), /\breturn\s*\{\s*ok:\s*false\b/), "luật rollback: sau lời gọi hàm ghi không còn `return { ok: false }`").toBe(0);
    expect(dem(ma, /\bghiHuyPhieuTheTrongTx\(/), "khai báo + đúng MỘT lời gọi trong tệp này (lời gọi thứ hai của dừng học nằm ở `huy-the-cung-phieu-gop.ts`)").toBe(2);
  });

  it("[HN4-S-W8] BA cổng từ chối trước phép ghi, mỗi cổng một BIỂU THỨC: (1) phiếu không thuộc đơn · (2) luật thuần từ chối ⇒ `ghepCauTuChoiHuy` · (3) cần xác nhận mạnh mà chưa tick ⇒ `CAU_THIEU_XAC_NHAN_MANH` (đứng SAU cổng luật)", () => {
    // Bản đầu của `[HN4-S-W3]` đếm "≥ 3 `return { ok: false`" thay cho từng cổng: gỡ cổng tick làm nó đỏ LẪN với ca của cổng tick —
    // cấy lỗi C14 (09/10/2026) lộ ra. Ghim theo biểu thức thì mỗi cổng có đúng một ca đỏ và không bị che bởi cổng khác.
    const cb = thanCallbackTx(ma);
    // VIỆC 6 · a3: "phép ghi" của callback nay là LỜI GỌI hàm ghi dùng chung (thân hàm ghi canh ở `[HN4-S-W3]`).
    const iGhi = cb.search(/\bghiHuyPhieuTheTrongTx\(tx,/);
    expect(iGhi, "callback GỌI hàm ghi").toBeGreaterThan(-1);
    const truocGhi = cb.slice(0, iGhi);
    const g1 = truocGhi.search(/\bif\s*\(\s*!p\s*\|\|\s*p\.paymentBill\.orderId\s*!==\s*input\.orderId\s*\)\s*return\s*\{\s*ok:\s*false,\s*error:\s*CAU_KHONG_THAY_PHIEU\s*\}/);
    const iLuat = truocGhi.search(/\bconst\s+quyet\s*=\s*choPhepHuyPhieuThe\(/);
    const g2 = truocGhi.search(/\bif\s*\(\s*!quyet\.huyDuoc\s*\)\s*return\s*\{\s*ok:\s*false,\s*error:\s*ghepCauTuChoiHuy\(quyet\)\s*\}/);
    const g3 = truocGhi.search(/\bif\s*\(\s*quyet\.canXacNhanManh\s*&&\s*!input\.xacNhanKhachChuaQuet\s*\)\s*return\s*\{\s*ok:\s*false,\s*error:\s*CAU_THIEU_XAC_NHAN_MANH\s*\}/);
    for (const [ten, i] of [["phiếu thuộc đơn", g1], ["luật thuần", iLuat], ["cổng luật", g2], ["cổng tick", g3]] as const) {
      expect(i, `${ten}: có, trước phép ghi`).toBeGreaterThan(-1);
    }
    expect(g1, "cổng IDOR đứng TRƯỚC khi hỏi luật").toBeLessThan(iLuat);
    expect(g2, "cổng luật đứng SAU lời gọi luật").toBeGreaterThan(iLuat);
    expect(g3, "tick đứng SAU cổng luật — không đòi tick cho một phiếu chắc chắn bị từ chối").toBeGreaterThan(g2);
    expect(dem(truocGhi, /\bCAU_THIEU_XAC_NHAN_MANH\b/), "câu thiếu tick chỉ một chỗ").toBe(1);
  });

  it("[HN4-S-W4] mốc tìm giao dịch chờ tay lấy từ MỌI phiếu thẻ của phiếu gộp (không chỉ phiếu đang huỷ) — cạm bẫy `mocChoTay`", () => {
    // Mã TRƯỚC khi vá cạm bẫy (rà đối kháng 06/10): `mocChoTay(bill.createdAt, [phieu.createdAt])` bỏ sót giao dịch quẹt dưới
    // phiếu CŨ đã bị thay. Cổng huỷ phiếu gộp (`docTheDangMoCuaPhieuGop`) và `taoPhieuPosTrongKhoa` đều lấy MỌI phiếu.
    expect(dem(ma, /\btx\.posPaymentIntent\.findMany\(\{\s*where:\s*\{\s*paymentBillId\b/), "đọc mọi phiếu thẻ của phiếu gộp").toBe(1);
    const goi = ma.match(/\bmocChoTay\(([^;]*?)\)\s*[,}]/); // `[^;]` đã khớp cả xuống dòng — không cần cờ `/s` (target < es2018)
    expect(goi, "có lời gọi mocChoTay").not.toBeNull();
    expect(goi![1], "đối số thứ hai là danh sách MỌI phiếu (`.map(`), không một mảng một phần tử").toMatch(/\.map\(/);
    expect(goi![1], "không phải `[p.createdAt]`").not.toMatch(/\[\s*\w+\.createdAt\s*\]/);
  });

  it("[HN4-S-W5] `now` BẮT BUỘC (luật 19); hạn đo bằng `phieuPosHetHan`; phiếu gộp còn mở đo bằng `status === \"OPEN\"`; phiếu phải thuộc ĐÚNG đơn", () => {
    expect(ma).toMatch(/\bnow:\s*Date\b/);
    expect(ma, "không tham số `now` tuỳ chọn").not.toMatch(/\bnow\?:/);
    expect(ma).toMatch(/\bdaHetHan:\s*phieuPosHetHan\(\w+\.expiresAt,\s*input\.now\)/);
    expect(ma).toMatch(/\bphieuGopConMo:\s*\w+\.paymentBill\.status\s*===\s*"OPEN"/);
    expect(ma, "IDOR dưới khoá: phiếu phải thuộc đúng đơn đã khoá").toMatch(/\.paymentBill\.orderId\s*!==\s*input\.orderId/);
    expect(dem(ma, /\bnew Date\(|\bDate\.now\(/), "không đồng hồ ngầm").toBe(0);
  });

  it("[HN4-S-W6] vết: `POS_PHIEU_HUY` · nguồn `HUY_TAY` · thực thể là ĐƠN · module finance; đủ lý do/ghi chú/trạng thái trước; `reason` ≤ 500", () => {
    expect(dem(ma, /\baction:\s*"POS_PHIEU_HUY"/)).toBe(1);
    expect(dem(ma, /\bnguon:\s*"HUY_TAY"/)).toBe(1);
    expect(dem(ma, /\bentityType:\s*"Order"/)).toBe(1);
    expect(dem(ma, /\bmodule:\s*"finance"/)).toBe(1);
    expect(ma).toMatch(/\boldValues:\s*\{\s*intentId:[^}]*\bstatus:/);
    expect(ma).toMatch(/\.slice\(0,\s*500\)/);
    expect(ma).toMatch(/NHAN_LY_DO_HUY_PHIEU_THE\[/);
  });

  it("[HN4-S-W7] HUY chỉ ghi ở HAI nơi — `phieu-pos.ts` (mở phiếu mới thay phiếu của phiếu gộp khác) và tệp này; mọi nơi khác là đường HUY mới KHÔNG có vết", () => {
    const tep: string[] = [];
    const di = (dir: string) => {
      for (const ten of readdirSync(dir)) {
        if (ten === "node_modules" || ten.startsWith(".")) continue;
        const p = join(dir, ten);
        if (statSync(p).isDirectory()) di(p);
        else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\./.test(ten)) tep.push(p);
      }
    };
    di(resolve(GOC, "lib"));
    di(resolve(GOC, "app"));
    const ghi: string[] = [];
    for (const f of tep) {
      const tho = readFileSync(f, "utf8");
      if (!tho.includes('"HUY"')) continue; // lọc thô trước khi bỏ chú thích (500+ tệp)
      if (/data:\s*\{\s*status:\s*"HUY"\s*\}/.test(boChuThich(tho))) ghi.push(f.slice(GOC.length + 1).replace(/\\/g, "/"));
    }
    expect(ghi.sort()).toEqual(["lib/payments/pos/huy-phieu-the-db.ts", "lib/payments/pos/phieu-pos.ts"]);
    expect(tep.length, "bộ quét thật sự thấy cây mã nguồn").toBeGreaterThan(500);
  }, 60_000);

  it("[HN6-A2-W1] VIỆC 6 · a2 — máy chủ nhận ra câu lưu sau từ chối bằng CHÍNH hàm của view (`laCauLuuTuChoiSaiMa`), từ yêu cầu MỚI NHẤT đọc DƯỚI khoá bằng `tx` trần, và đưa vào cổng bằng một BIẾN (không hằng, không mảng rỗng)", () => {
    // Mã TRƯỚC VIỆC 6: `biTuChoiSaiMa = await yeuCauSaiMaMoiNhatBiTuChoi(tx, p.id)` rồi `yeuCauSaiMaMoiNhatBiTuChoi: biTuChoiSaiMa` — một cổng chặn riêng "vì từng bị từ chối".
    expect(dem(ma, /\blaCauLuuTuChoiSaiMa\(/), "đúng MỘT lời gọi").toBe(1);
    const goi = ma.match(/\blaCauLuuTuChoiSaiMa\(\{([^}]*)\}\)/)?.[1] ?? "";
    expect(goi, "câu lưu lấy từ phiếu thẻ đã đọc LẠI dưới khoá").toMatch(/\blastResultMessage:\s*p\.lastResultMessage\b/);
    const bien = goi.match(/\byeuCauMoiNhat:\s*([A-Za-z_$][\w$]*)\b/)?.[1] ?? "";
    expect(bien, "đối số yêu cầu mới nhất là một biến").not.toBe("");
    expect(ma, "…và biến đó chính là kết quả `yeuCauSaiMaMoiNhat(tx, p.id)` (tx trần, không scopedDb)").toMatch(
      new RegExp(`\\b${bien}\\s*=\\s*await yeuCauSaiMaMoiNhat\\(tx,\\s*p\\.id\\)`),
    );
    expect(dem(ma, /\byeuCauSaiMaMoiNhat\(/), "đọc yêu cầu mới nhất đúng MỘT lần").toBe(1);
    expect(ma, "cờ cũ đã gỡ hẳn khỏi cổng máy chủ").not.toMatch(/\byeuCauSaiMaMoiNhatBiTuChoi\b/);
  });

  it("[HN6-A2-W2] vết huỷ ghi RÕ 'huỷ sau khi kế toán đã từ chối' (`sauTuChoiSaiMa`) — cổng riêng đã bỏ nên dấu vết là thứ còn lại để điều tra khoản về muộn", () => {
    expect(ma).toMatch(/\bsauTuChoiSaiMa:\s*\w+\?\.trangThai\s*===\s*"TU_CHOI"/);
    expect(dem(ma, /\bsauTuChoiSaiMa:/), "đúng một chỗ").toBe(1);
  });
});

describe("[HN4-S-A] huyPhieuTheAction — thân action: cổng IDOR → lib → làm mới", () => {
  const ma = boChuThich(doc(TEP_ACTION));
  const than = thanAction(ma);

  it("[HN4-S-A0] ĐỐI CHỨNG của bộ quét: cắt được thân action (không rỗng, chứa zod và cổng quyền)", () => {
    expect(than.length).toBeGreaterThan(200);
    expect(than).toMatch(/huyPhieuTheSchema\.safeParse\(input\)/);
    expect(than).toMatch(/\bcongXemPhieuPos\(/);
  });

  it("[HN4-S-A1] cổng IDOR bằng `cong.sdb` (scopedDb): phiếu phải thuộc CHÍNH đơn đã qua cổng phạm vi; chỉ lấy `id`; đứng TRƯỚC lời gọi lib", () => {
    expect(dem(than, /\bcong\.sdb\.posPaymentIntent\.findFirst\(\{/), "đúng một câu tra").toBe(1);
    expect(than).toMatch(/where:\s*\{\s*id:\s*parsed\.data\.intentId,\s*paymentBill:\s*\{\s*orderId:\s*cong\.order\.id\s*\}\s*\}/);
    expect(than).toMatch(/select:\s*\{\s*id:\s*true\s*\}/);
    expect(than.search(/\bcong\.sdb\.posPaymentIntent\.findFirst\(/)).toBeLessThan(than.search(/\bhuyPhieuThe\(\{/));
    expect(than, "không phiếu ⇒ câu 'Không tìm thấy phiếu POS' (khuôn kiểm tra / báo admin)").toMatch(/Không tìm thấy phiếu POS/);
  });

  it("[HN4-S-A2] lời gọi lib: đúng MỘT, nhận id từ KẾT QUẢ cổng IDOR (không từ đầu vào), đơn từ cổng quyền, `now: new Date()`, tick và lý do từ zod", () => {
    expect(dem(than, /\bhuyPhieuThe\(\{/)).toBe(1);
    expect(than).toMatch(/\borderId:\s*cong\.order\.id\b/);
    expect(than).toMatch(/\bintentId:\s*phieu\.id\b/);
    expect(than).toMatch(/\blyDo:\s*parsed\.data\.lyDo\b/);
    expect(than).toMatch(/\bxacNhanKhachChuaQuet:\s*parsed\.data\.xacNhanKhachChuaQuet\b/);
    expect(than).toMatch(/\bnow:\s*new Date\(\)/);
    expect(than, "người bấm lấy từ PHIÊN (cổng quyền), id rỗng ⇒ null như khuôn kiểm tra").toMatch(/\bid:\s*cong\.actor\.id\s*\|\|\s*null\b/);
    expect(than, "đầu vào thô không đi thẳng vào lib").not.toMatch(/\bintentId:\s*input\./);
  });

  it("[HN4-S-A4] cổng quyền `congXemPhieuPos`: hỏi ĐÚNG `payments:pos-check`, phạm vi đơn BẰNG CẢ HAI lớp (`scopedDb` + `passesScope`), KHÔNG hỏi cờ `billing.flexV1Enabled` (V4.13)", () => {
    // `passesScope` ở đây là lớp DỰ PHÒNG của `scopedDb(...).order.findUnique` (đã lọc hậu kỳ theo cơ sở) — bỏ nó thì ca hành vi
    // `[HN4-DB-10d]` vẫn xanh (lớp kia đủ chặn), nên chỉ lưới văn bản này canh được. Cùng bài học `[POS2-PL-08b]`.
    const dau = ma.indexOf("async function congXemPhieuPos(");
    expect(dau, "có hàm").toBeGreaterThan(-1);
    const sau = ma.slice(dau);
    const cong = sau.slice(0, sau.search(/\r?\n\}\r?\n/) + 3);
    expect(cong.length).toBeGreaterThan(200);
    expect(dem(cong, /\bcheckPermission\("payments:pos-check"\)/)).toBe(1);
    expect(dem(cong, /\bscopedDb\(actor\)/)).toBe(1);
    expect(dem(cong, /\bpassesScope\("Order",\s*order,\s*actor\)/)).toBe(1);
    expect(cong, "cùng một câu cho 'không có' và 'không thuộc cơ sở bạn'").toMatch(/Không tìm thấy đơn hàng/);
    expect(dem(cong, /laThuTienLinhHoatBat/), "huỷ GIẢM rủi ro ⇒ không hỏi cờ (khác `congDuongB`)").toBe(0);
  });

  it("[HN4-S-A3] làm mới trang đơn CHỈ khi thành công và SAU lời gọi lib; không `db.` trần trong action (cổng DB đã đóng)", () => {
    const iLib = than.search(/\bhuyPhieuThe\(\{/);
    const iRev = than.search(/\brevalidatePath\(/);
    expect(dem(than, /\brevalidatePath\(/)).toBe(1);
    expect(iRev).toBeGreaterThan(iLib);
    expect(than).toMatch(/\brevalidatePath\(`\/orders\/\$\{cong\.order\.id\}`\)/);
    expect(than.slice(iLib, iRev), "từ chối thoát TRƯỚC khi làm mới").toMatch(/\bif\s*\(\s*!kq\.ok\s*\)\s*return\b/);
    expect(dem(than, /\bdb\./)).toBe(0);
    expect(dem(than, /\$transaction/)).toBe(0);
  });
});

describe("[HN4-S-C] ba câu 'nói thật' của Việc 1 (H17 mục 2–4) — không còn hứa 'phải đợi hết hạn' khi nút huỷ phiếu thẻ ĐÃ CÓ", () => {
  it("[HN4-S-C1] `phieu-gop.ts`: hai câu cũ 'phải đợi thẻ hết hạn' đã thay; mỗi câu chỉ tới việc huỷ phiếu thẻ, giữ các mảnh `[HN2-DB-05/07]` ghim", () => {
    const ma = boChuThich(doc("lib/finance/phieu-gop.ts"));
    expect(dem(ma, /phải đợi thẻ hết hạn/)).toBe(0);
    for (const manh of ["đã có một phiếu gộp đang mở", "chưa có gì để đóng", "chờ quẹt thẻ", "chưa huỷ được"]) {
      expect(ma, `giữ mảnh "${manh}"`).toContain(manh);
    }
    // Hai chỗ nói "chưa huỷ được" khi thẻ chờ quẹt — cả hai đều phải chỉ tới việc huỷ PHIẾU THẺ.
    const cac = [...ma.matchAll(/thì chưa huỷ được[^"\n]*/g)].map((m) => m[0]);
    expect(cac.length, "hai câu").toBe(2);
    for (const c of cac) expect(c, c).toMatch(/huỷ phiếu thẻ/);
  });

  it("[HN4-S-C2] `qr-theo-dot.ts`: nhánh DANG_CHO của `loiDotKhacDangGiu` không còn bảo 'chờ mã đó hết hạn' là lối thoát DUY NHẤT; `chuDotKhacDangGiu` KHÔNG đổi (V4.15)", () => {
    const ma = boChuThich(doc("lib/payments/qr-theo-dot.ts"));
    expect(dem(ma, /chờ mã đó hết hạn rồi xuất cho đợt khác/)).toBe(0);
    expect(ma).toMatch(/huỷ phiếu thẻ/);
    // Nhãn ngắn bị ghim NGUYÊN VĂN ở `kenh-thu.test.ts` (đóng băng) và RTL của giao diện.
    expect(ma).toContain("`${goc} (thẻ đang chờ)`");
  });
});
