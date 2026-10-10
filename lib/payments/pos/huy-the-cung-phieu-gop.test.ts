// lib/payments/pos/huy-the-cung-phieu-gop.test.ts — LƯỚI GHIM MÃ NGUỒN cho "dừng học huỷ kèm phiếu thẻ mở" (Việc 6 · mục 3 · a3). THUẦN — không DB, chạy trong `test:unit`.
//
// Vì sao cần lưới văn bản bên cạnh `tests/finance/pos-dung-hoc-huy-the.test.ts` (ca hành vi trên Postgres thật): có những luật KHÔNG quan sát được bằng hành vi, hoặc hai lớp bảo vệ dự phòng nhau
// nên bỏ một lớp không làm ca hành vi nào đỏ (cùng bài học `[POS2-PL-08b]`, `[HN4-S-W*]`):
//   · khoá DÒNG phiếu thẻ trước khi đọc lại: khoá đơn đã tuần tự mọi đường tiền; bỏ khoá dòng chỉ mở khe cho `giuLuotKiem` (đường duy nhất KHÔNG lấy khoá đơn) — ca hành vi vẫn xanh;
//   · điều kiện của `updateMany` ở hàm ghi là lớp thứ hai sau "đọc lại dưới khoá" (canh ở `huy-phieu-the-db.test.ts` `[HN4-S-W3]`);
//   · MỘT định nghĩa "phiếu thẻ mở" cho xem trước (đếm) và đường ghi (liệt kê): ba chỗ tự viết điều kiện là ba chỗ có ngày cãi nhau và màn "Sẽ huỷ khi xác nhận" nói dối;
//   · `throw` (không `return`) khi `doiTrangThaiPhieuTrongTx` từ chối SAU phép ghi: bất khả dưới khoá nên chỉ ca cấy hook (`[HN6-DH-08b]`) với được — và lưới này canh BIỂU THỨC.
//
// Mẫu (CLAUDE.md "LƯỚI GHIM MÃ NGUỒN" + luật 11/14): neo BIỂU THỨC (không neo chỗ đặt chữ), bỏ chú thích TRƯỚC khi đếm, đếm SỐ LẦN khớp, ĐỐI CHỨNG của bộ quét.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CAU_THE_POS_HUY_CUNG, HAU_TO_TOAST_THE_POS_DA_HUY, canhBaoTruocPhieuCuaCon } from "@/lib/finance/soat-phieu-gop";

const GOC = process.cwd();
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf8");
/** Bỏ chú thích khối MỞ Ở ĐẦU DÒNG + chú thích dòng (chuỗi chứa `/*` giữa dòng — đường dẫn glob — không bị nhận nhầm là chú thích). */
const boChuThich = (s: string) => s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/.*$/gm, "");
const dem = (ma: string, re: RegExp) => [...ma.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))].length;
/** Thân MỘT hàm cấp module: từ khai báo tới dòng `}` ĐẦU TIÊN ở cột 0. */
function thanHam(ma: string, khaiBao: string): string {
  const dau = ma.indexOf(khaiBao);
  if (dau < 0) return "";
  const sau = ma.slice(dau);
  return sau.slice(0, sau.search(/\r?\n\}\r?\n/) + 3);
}

/**
 * Quét MỘT lần cây `lib` + `app` (mã nguồn, bỏ tệp test) và chỉ giữ tệp có nhắc một trong hai tên cần đếm người gọi — W5 và W10 dùng chung kết quả. Đọc ~3000 tệp hai lần là hai lần phí
 * (đo ở máy đang tải: ~3 phút MỖI lần; máy thường ~1 giây). `tong` để ĐỐI CHỨNG: bộ quét thật sự thấy cây mã nguồn, không phải thư mục rỗng.
 */
let quetCache: { tep: Map<string, string>; tong: number } | null = null;
function quetCayMa(): { tep: Map<string, string>; tong: number } {
  if (quetCache) return quetCache;
  const tep = new Map<string, string>();
  let tong = 0;
  const di = (dir: string) => {
    for (const ten of readdirSync(dir)) {
      if (ten === "node_modules" || ten.startsWith(".")) continue;
      const p = join(dir, ten);
      if (statSync(p).isDirectory()) di(p);
      else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\./.test(ten)) {
        tong++;
        const tho = readFileSync(p, "utf8");
        if (tho.includes("ghiHuyPhieuTheTrongTx") || tho.includes("huyTheMoCungPhieuGopTrongTx")) tep.set(p.slice(GOC.length + 1).replace(/\\/g, "/"), tho);
      }
    }
  };
  di(resolve(GOC, "lib"));
  di(resolve(GOC, "app"));
  quetCache = { tep, tong };
  return quetCache;
}

const TEP_MOI = "lib/payments/pos/huy-the-cung-phieu-gop.ts";
const TEP_DUNG_HOC = "lib/finance/dung-hoc-con.ts";
const TEP_GHI = "lib/payments/pos/huy-phieu-the-db.ts";
const TEP_SAI_MA = "lib/payments/pos/sai-ma-ghi.ts";

describe("[HN6-DH-W] module `huy-the-cung-phieu-gop.ts` — khoá · đọc lại · bỏ qua phiếu mang tiền · một đường ghi", () => {
  const ma = boChuThich(doc(TEP_MOI));
  const than = thanHam(ma, "export async function huyTheMoCungPhieuGopTrongTx(");

  it("[HN6-DH-W0] ĐỐI CHỨNG của bộ quét: đọc được tệp thật, thấy cả hai hàm xuất ra và cắt được thân hàm (lưới rỗng thì mọi ca dưới xanh vô nghĩa)", () => {
    expect(ma.length).toBeGreaterThan(800);
    expect(dem(ma, /\bexport async function huyTheMoCungPhieuGopTrongTx\(/)).toBe(1);
    expect(dem(ma, /\bexport async function demTheMoCuaPhieuGop\(/)).toBe(1);
    expect(than.length, "cắt được thân hàm").toBeGreaterThan(500);
  });

  it("[HN6-DH-W1] THỨ TỰ trong vòng lặp: khoá DÒNG phiếu thẻ → ĐỌC LẠI dưới khoá → bỏ qua phiếu mang yêu cầu sống → GHI (mỗi mốc đúng một lần, tăng dần)", () => {
    const MOC: [string, RegExp][] = [
      ["liệt kê ứng viên (đọc)", /\btx\.posPaymentIntent\.findMany\(/],
      ["khoá dòng phiếu thẻ", /\bkhoaPhieuPosTrongTx\(tx,\s*id\)/],
      ["đọc lại dưới khoá", /\btx\.posPaymentIntent\.findFirst\(/],
      ["phiếu mang yêu cầu sống ⇒ bỏ qua", /\bcoYeuCauSaiMaDangGiu\(tx,\s*p\.id\)/],
      ["phép ghi dùng chung", /\bghiHuyPhieuTheTrongTx\(tx,/],
    ];
    let truoc = -1;
    for (const [ten, re] of MOC) {
      expect(dem(than, re), `${ten}: đúng một lần`).toBe(1);
      const i = than.search(re);
      expect(i, `${ten}: đứng SAU mốc trước`).toBeGreaterThan(truoc);
      truoc = i;
    }
    // Phiếu lấy theo `id` tăng dần ⇒ thứ tự khoá dòng ổn định (hai lượt cùng khoá nhiều phiếu không đan nhau).
    expect(than, "ứng viên xếp `id` tăng dần").toMatch(/\borderBy:\s*\{\s*id:\s*"asc"\s*\}/);
    // Nhánh bỏ qua đi `continue` (không ghi, không ném) và ghi vào danh sách `boQua` để vết nói ra.
    const tuCo = than.slice(than.search(/\bcoYeuCauSaiMaDangGiu\(tx,/));
    const nhanhBoQua = tuCo.slice(0, tuCo.indexOf("continue;") + "continue;".length);
    expect(nhanhBoQua, "bỏ qua + nói ra").toMatch(/\bket\.boQua\.push\(\{[^}]*vi:\s*"CO_YEU_CAU_SAI_MA"[^}]*\}\);\s*continue;$/);
  });

  it("[HN6-DH-W2] MỘT định nghĩa 'phiếu thẻ mở': `theMoChuaNhan()` dùng ở ĐÚNG ba chỗ (đếm cho xem trước · liệt kê · đọc lại dưới khoá) và là chỗ DUY NHẤT nói `TRANG_THAI_MO` + `bankTransactionId: null`", () => {
    expect(dem(ma, /\btheMoChuaNhan\(\)/), "3 chỗ dùng (đếm · liệt kê · đọc lại)").toBe(3);
    expect(dem(ma, /\bconst theMoChuaNhan = \(\) =>/), "1 khai báo").toBe(1);
    const khai = ma.slice(ma.search(/\bconst theMoChuaNhan = \(\) =>/));
    const dong = khai.slice(0, khai.indexOf("\n"));
    expect(dong).toMatch(/\bstatus:\s*\{\s*in:\s*\[\.\.\.TRANG_THAI_MO\]\s*\}/);
    expect(dong).toMatch(/\bbankTransactionId:\s*null\b/);
    expect(dem(ma, /\bTRANG_THAI_MO\b/), "không nơi nào khác tự nói tập trạng thái mở").toBe(2); // import + khai báo
    expect(dem(ma, /\bbankTransactionId\b/), "không nơi nào khác tự nói điều kiện chưa nhận giao dịch").toBe(1);
  });

  it("[HN6-DH-W2b] XEM TRƯỚC đếm đúng thứ đường ghi SẼ huỷ: luật 'phiếu mang yêu cầu sống thì bỏ qua' (`coYeuCauSaiMaDangGiu`) có mặt ở CẢ hàm đếm lẫn hàm ghi — đếm thừa là màn hứa huỷ một phiếu mà máy chủ để nguyên", () => {
    const dem_ = thanHam(ma, "export async function demTheMoCuaPhieuGop(");
    expect(dem_.length, "cắt được thân hàm đếm").toBeGreaterThan(150);
    expect(dem(dem_, /\bcoYeuCauSaiMaDangGiu\(/), "hàm đếm bỏ qua phiếu mang yêu cầu sống").toBe(1);
    expect(dem(dem_, /\btheMoChuaNhan\(\)/), "và đếm trên CÙNG định nghĩa phiếu mở").toBe(1);
    expect(dem(ma, /\bcoYeuCauSaiMaDangGiu\(/), "đúng HAI chỗ gọi: đếm + ghi").toBe(2);
  });

  it("[HN6-DH-W3] KHÔNG có đường ghi thứ hai: 0 phép ghi trực tiếp lên bảng, 0 SQL thô, 0 `db.` trần, 0 `$transaction` (chạy TRONG transaction của người gọi), 0 chữ HUY (nguồn ghi HUY vẫn đúng hai tệp — `[HN4-S-W7]`)", () => {
    expect(dem(ma, /\btx\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/), "phép ghi duy nhất đi qua `ghiHuyPhieuTheTrongTx`").toBe(0);
    expect(dem(ma, /\$executeRaw|\$queryRaw|\$executeRawUnsafe|\$queryRawUnsafe/), "khoá đi qua hàm module").toBe(0);
    expect(dem(ma, /\bdb\./), "không dùng client trần (hàm đếm nhận `client` do người gọi truyền)").toBe(0);
    expect(dem(ma, /\$transaction\(/)).toBe(0);
    expect(dem(ma, /["']HUY["']/), "không tự ghi trạng thái HUY").toBe(0);
    expect(dem(ma, /\bnguon:\s*"DUNG_HOC"/), "nguồn của vết").toBe(1);
  });

  it("[HN6-DH-W4] KHÔNG TỪ CHỐI: hàm không có `return { ok… }` và không `throw` của riêng mình (dừng học không chịu cổng tiền của nút tay); lỗi duy nhất có thể nổi lên là `LoiHuyPhieuThe` của hàm ghi (bất khả dưới khoá)", () => {
    expect(dem(than, /\breturn\s*\{\s*ok\b/)).toBe(0);
    expect(dem(than, /\bthrow\b/)).toBe(0);
    expect(dem(ma, /\bchoPhepHuyPhieuThe\b|\bghepCauTuChoiHuy\b/), "không mượn cổng tiền của nút tay").toBe(0);
    expect(dem(ma, /\bnow\b/), "không đồng hồ: huỷ phiếu MỞ không phụ thuộc hạn (kể cả phiếu quá hạn mà chưa kết luận)").toBe(0);
  });

  it("[HN6-DH-W5] `ghiHuyPhieuTheTrongTx` có đúng BA người gọi trong cây mã nguồn — nút tay (`HUY_TAY`), tệp này (`DUNG_HOC`) và kế toán từ chối khi phiếu gộp đã đóng (`TU_CHOI_SAI_MA`, `sai-ma-ghi.ts`); thêm người gọi thứ tư phải qua lưới này", () => {
    const { tep, tong } = quetCayMa();
    const goi: string[] = [];
    for (const [f, tho] of tep) {
      if (!tho.includes("ghiHuyPhieuTheTrongTx")) continue; // lọc thô trước khi bỏ chú thích
      const n = dem(boChuThich(tho), /\bghiHuyPhieuTheTrongTx\(tx,/);
      if (n > 0) goi.push(`${f}×${n}`);
    }
    expect(goi.sort()).toEqual([`${TEP_GHI}×1`, `${TEP_MOI}×1`, `${TEP_SAI_MA}×1`]);
    expect(tong, "bộ quét thật sự thấy cây mã nguồn").toBeGreaterThan(500);
  }, 300_000);
});

describe("[HN6-DH-W] `dungHocTrongTx` (dung-hoc-con.ts) — huỷ kèm TRƯỚC khi đổi phiếu gộp · THROW khi từ chối sau phép ghi · kết quả + vết nói đủ", () => {
  const ma = boChuThich(doc(TEP_DUNG_HOC));
  const than = thanHam(ma, "export async function dungHocTrongTx(");
  const motCuaPhieu = than.slice(than.search(/\bif\s*\(\s*phieu\?\.coDongCuaCon\s*\)\s*\{/));

  it("[HN6-DH-W6] ĐỐI CHỨNG của bộ quét: cắt được thân `dungHocTrongTx` và khối xử lý phiếu gộp", () => {
    expect(than.length).toBeGreaterThan(3000);
    expect(motCuaPhieu.length, "khối `if (phieu?.coDongCuaCon)` tồn tại").toBeGreaterThan(200);
    expect(dem(than, /\bif\s*\(\s*phieu\?\.coDongCuaCon\s*\)\s*\{/), "đúng MỘT khối xử lý phiếu gộp").toBe(1);
  });

  it("[HN6-DH-W7] DÂY NỐI: lời gọi huỷ kèm phiếu thẻ mở nằm TRONG khối phiếu gộp (bé không có dòng trong phiếu ⇒ không đụng thẻ), SAU khi đã đọc phiếu gộp, chạy bằng CHÍNH `tx` (cùng transaction); đổi trạng thái phiếu gộp đúng một lời gọi", () => {
    // Cố ý KHÔNG ghim thứ tự huỷ-thẻ so với đổi-phiếu-gộp: cả hai ở cùng `tx` dưới cùng khoá đơn nên thứ tự đổi không đổi kết cục (lưới ghim CÁCH VIẾT là lưới đỏ oan —
    // bài học `[NDC-07]`/`[QCS-03]`). Luật cần khoá: có gọi · đúng chỗ · cùng `tx` · không phải client trần.
    const MOC: [string, RegExp][] = [
      ["VOID đợt (phép ghi đầu tiên)", /\bhuyDotKhiDungHoc\(tx,/],
      ["đọc phiếu gộp", /\bphieuGopCuaConTrongTx\(tx,/],
      ["huỷ kèm phiếu thẻ mở", /\bhuyTheMoCungPhieuGopTrongTx\(tx,/],
    ];
    let truoc = -1;
    for (const [ten, re] of MOC) {
      expect(dem(than, re), `${ten}: đúng một lần`).toBe(1);
      const i = than.search(re);
      expect(i, `${ten}: đứng SAU mốc trước`).toBeGreaterThan(truoc);
      truoc = i;
    }
    expect(dem(motCuaPhieu, /\bhuyTheMoCungPhieuGopTrongTx\(tx,/), "lời gọi nằm TRONG khối phiếu gộp").toBe(1);
    expect(dem(than, /\bdoiTrangThaiPhieuTrongTx\(\s*tx,/), "đổi trạng thái phiếu gộp: đúng một lời gọi, cũng bằng `tx`").toBe(1);
    expect(dem(than, /\bdb\b/), "thân dừng học không dùng client trần (mọi thứ qua `tx`)").toBe(0);
  });

  it("[HN6-DH-W8] kết quả của `doiTrangThaiPhieuTrongTx` được KIỂM và từ chối là THROW (bản cũ nuốt `{ ok:false }` sau phép ghi đầu tiên); `dungHocMotCon` dịch lỗi đó NGOÀI transaction", () => {
    expect(than, "nhận kết quả vào một biến").toMatch(/\bconst\s+(\w+)\s*=\s*await\s+doiTrangThaiPhieuTrongTx\(/);
    const bien = /\bconst\s+(\w+)\s*=\s*await\s+doiTrangThaiPhieuTrongTx\(/.exec(than)![1]!;
    expect(than, "từ chối ⇒ NÉM, không return").toMatch(new RegExp(`\\bif\\s*\\(\\s*!${bien}\\.ok\\s*\\)\\s*throw\\s+new\\s+LoiDungHocGiuaChung\\(${bien}\\.error\\)`));
    // Luật rollback: mọi `return { ok: false` của thân đứng TRƯỚC phép ghi đầu tiên (VOID đợt).
    const iGhiDau = than.search(/\bhuyDotKhiDungHoc\(tx,/);
    expect(dem(than.slice(iGhiDau), /\breturn\s*\{\s*ok:\s*false\b/), "sau phép ghi đầu tiên không còn `return { ok: false }`").toBe(0);
    expect(dem(than.slice(0, iGhiDau), /\breturn\s*\{\s*ok:\s*false\b/), "các cổng từ chối vẫn có và đứng trước").toBeGreaterThanOrEqual(5);
    const motCon = thanHam(ma, "export async function dungHocMotCon(");
    expect(motCon, "bắt lỗi của mình NGOÀI transaction").toMatch(/\bcatch\s*\(\s*err\s*\)\s*\{[\s\S]*\berr\s+instanceof\s+LoiDungHocGiuaChung\b[\s\S]*\{\s*ok:\s*false\s+as\s+const,\s*error:\s*err\.message\s*\}/);
    expect(motCon, "lỗi khác nổi lên nguyên vẹn").toMatch(/\bthrow\s+err\b/);
  });

  it("[HN6-DH-W9] kết quả + vết nói đủ: `soPhieuTheDaHuy` (BẮT BUỘC, không tuỳ chọn) · `phieuTheDaHuy` + `phieuTheBoQua` trong `CON_DUNG_HOC`; xem trước đếm bằng CÙNG định nghĩa", () => {
    expect(dem(ma, /\bsoPhieuTheDaHuy:\s*number;/), "khai BẮT BUỘC trong kiểu kết quả").toBe(1);
    expect(dem(ma, /\bsoPhieuTheDaHuy\?:/)).toBe(0);
    expect(dem(than, /\bsoPhieuTheDaHuy:\s*theCungPhieu\.daHuy\.length\b/), "trả đúng số đã huỷ").toBe(1);
    expect(dem(than, /\bphieuTheDaHuy:\s*theCungPhieu\.daHuy\.map\(/)).toBe(1);
    expect(dem(than, /\bphieuTheBoQua:\s*theCungPhieu\.boQua\b/)).toBe(1);
    expect(dem(ma, /\bsoPhieuTheMo:\s*number\b/), "kiểu xem trước + kiểu trả của `docPhieuGopChoXemTruoc`").toBe(2);
    const xem = thanHam(ma, "export async function docPhieuGopChoXemTruoc(");
    expect(dem(xem, /\bdemTheMoCuaPhieuGop\(db,\s*p\.billId\)/), "xem trước đếm bằng hàm của module huỷ kèm (cùng điều kiện với đường ghi)").toBe(1);
  });

  it("[HN6-DH-W10] chỉ MỘT nơi trong `lib` + `app` gọi `huyTheMoCungPhieuGopTrongTx` (dừng học; đổi khoá đi qua thân dùng chung) — nối thêm đường khác là quyết định riêng của chủ dự án", () => {
    const { tep, tong } = quetCayMa();
    const goi: string[] = [];
    for (const [f, tho] of tep) {
      if (!tho.includes("huyTheMoCungPhieuGopTrongTx")) continue;
      if (dem(boChuThich(tho), /\bhuyTheMoCungPhieuGopTrongTx\(tx,/) > 0) goi.push(f);
    }
    expect(goi).toEqual([TEP_DUNG_HOC]);
    expect(tong, "bộ quét thật sự thấy cây mã nguồn").toBeGreaterThan(500);
  }, 300_000);
});

describe("[HN6-DH-W] hộp 'Dừng học' nói đúng điều máy chủ làm với phiếu thẻ POS (luật 12)", () => {
  const ui = boChuThich(doc("app/(admin)/admin/orders/_components/dung-hoc-dialog.tsx"));

  it("[HN6-DH-W11] NÓI TRƯỚC (một dòng trong 'Sẽ huỷ khi xác nhận', chỉ khi có phiếu thẻ mở, chữ lấy từ MỘT hằng dùng chung) và NÓI SAU (toast, chỉ khi máy chủ báo đã huỷ)", () => {
    // Điều kiện vẽ dòng "nói trước" nằm ở MỘT biểu thức, đọc từ bản xem trước MÁY CHỦ (`soPhieuTheMo`) — màn không tự đoán.
    expect(dem(ui, /\bxem\.phieuGop\s*&&\s*xem\.phieuGop\.soPhieuTheMo\s*>\s*0\b/)).toBe(1);
    // "Nói sau" đọc từ KẾT QUẢ ghi thật (`soPhieuTheDaHuy`), không từ bản xem trước.
    expect(dem(ui, /\br\.soPhieuTheDaHuy\s*>\s*0\b/)).toBe(1);
    // Chữ của dòng "nói trước" KHÔNG viết tay ở đây: hộp Đổi khoá nói CÙNG câu (xem W12) — hai bản chép tay là hai màn lệch nhau ở lần sửa đầu tiên.
    const dong = ui.slice(ui.search(/\bxem\.phieuGop\.soPhieuTheMo\s*>\s*0\b/));
    const khoi = dong.slice(0, dong.indexOf("</li>"));
    expect(khoi, "dòng nói trước dùng hằng dùng chung").toMatch(/\{\s*CAU_THE_POS_HUY_CUNG\s*\}/);
    expect(dem(ui, /CAU_THE_POS_HUY_CUNG/g), "import + đúng MỘT chỗ dùng").toBe(2);
    expect(ui, "import từ module câu chữ dùng chung").toMatch(/import\s*\{[^}]*\bCAU_THE_POS_HUY_CUNG\b[^}]*\}\s*from\s*"@\/lib\/finance\/soat-phieu-gop"/);
  });
});

describe("[HN6-DH-W] câu NÓI TRƯỚC về phiếu thẻ — MỘT nguồn cho hộp Dừng học và hộp Đổi khoá (đổi khoá dùng CHUNG thân nên cũng huỷ phiếu thẻ — luật 12)", () => {
  it("[HN6-DH-W12] hằng câu nói đúng điều máy chủ làm: huỷ CÙNG; khoản về sau ở hàng chờ gắn tay, KHÔNG tự ghi vào đơn; không mời quẹt lại", () => {
    // Danh từ khớp nút "Huỷ phiếu thẻ" / toast "Đã huỷ phiếu thẻ mã …" của Việc 4 (một vật, một tên — `/impeccable clarify` 10/10); động từ nói RÕ chủ ngữ ("cũng bị huỷ"), không cụt "huỷ cùng".
    expect(CAU_THE_POS_HUY_CUNG).toMatch(/phiếu thẻ POS/i);
    expect(CAU_THE_POS_HUY_CUNG).toMatch(/cũng bị huỷ/);
    expect(CAU_THE_POS_HUY_CUNG).toMatch(/hàng chờ gắn tay[\s\S]*không[\s\S]*tự ghi vào đơn/);
    expect(CAU_THE_POS_HUY_CUNG, "không hứa khách quẹt lại được").not.toMatch(/quẹt lại/);
  });

  it("[HN6-DH-W12b] `canhBaoTruocPhieuCuaCon` (cảnh báo của hộp Đổi khoá): có phiếu thẻ mở ⇒ cả `chiTiet` lẫn `cau` mang câu; 0 hoặc vắng ⇒ y như cũ (không nhắc thẻ); HUỶ và ĐÓNG đều nói; tiêu đề/đích không đổi", () => {
    const co = canhBaoTruocPhieuCuaCon({ ma: "AB12C", daNhan: 0, hanhDong: "HUY", soPhieuTheMo: 1 });
    expect(co?.tieuDe).toBe("Mã phiếu AB12C của cả nhà sẽ bị HUỶ");
    expect(co?.dich).toBe("VOID");
    expect(co?.chiTiet).toContain(CAU_THE_POS_HUY_CUNG);
    expect(co?.cau).toContain(CAU_THE_POS_HUY_CUNG);

    const khong = canhBaoTruocPhieuCuaCon({ ma: "AB12C", daNhan: 0, hanhDong: "HUY", soPhieuTheMo: 0 });
    const vang = canhBaoTruocPhieuCuaCon({ ma: "AB12C", daNhan: 0, hanhDong: "HUY" });
    expect(khong?.cau, "0 phiếu thẻ ⇒ không nhắc thẻ").not.toMatch(/thẻ POS/);
    expect(vang, "vắng trường ⇒ y hệt 0").toEqual(khong);
    expect(co?.cau.replace(CAU_THE_POS_HUY_CUNG, "").replace(/\s{2,}/g, " "), "khác bản không-thẻ ĐÚNG một câu (chỗ đặt câu không bị ghim)").toBe(khong?.cau);

    const dong = canhBaoTruocPhieuCuaCon({ ma: "AB12C", daNhan: 500_000, hanhDong: "DONG", soPhieuTheMo: 1 });
    expect(dong?.dich).toBe("CLOSED");
    expect(dong?.cau, "phiếu ĐÓNG (đã nhận tiền) cũng huỷ thẻ mở ⇒ cũng nói").toContain(CAU_THE_POS_HUY_CUNG);
    expect(canhBaoTruocPhieuCuaCon(null)).toBeNull();
  });

  it("[HN6-DH-W13] DÂY NỐI đổi khoá: `XemTruocDoiKhoa.phieuGop` mang `soPhieuTheMo` (BẮT BUỘC, lấy thẳng từ `docPhieuGopChoXemTruoc`) · `dungHocTrongTx` ném lỗi bất khả bằng `LoiDungHocGiuaChung` XUẤT RA và `.catch` của đổi khoá dịch nó thành câu", () => {
    const db = boChuThich(doc("lib/finance/doi-khoa-db.ts"));
    expect(db, "kiểu xem trước đổi khoá mang số phiếu thẻ mở").toMatch(/\bphieuGop:\s*\{[^}]*\bsoPhieuTheMo:\s*number\b[^}]*\}\s*\|\s*null;/);
    expect(dem(db, /\bconst phieuGop = await docPhieuGopChoXemTruoc\(/), "vẫn MỘT hàm xem trước dùng chung với dừng học").toBe(1);
    const dh = boChuThich(doc(TEP_DUNG_HOC));
    expect(dem(dh, /\bexport class LoiDungHocGiuaChung\b/), "lớp lỗi được xuất để người gọi thân dùng chung dịch nó").toBe(1);
    expect(db, "import lớp lỗi").toMatch(/\bLoiDungHocGiuaChung\b[\s\S]*from\s*"@\/lib\/finance\/dung-hoc-con"/);
    const catchDb = db.slice(db.search(/\.catch\(\s*\(err\)\s*=>/));
    expect(catchDb, "`.catch` cuối hàm đổi khoá dịch lỗi bất khả của dừng học thay vì để nổi thành lỗi chung").toMatch(
      /\berr\s+instanceof\s+LoiDungHocGiuaChung\b[\s\S]*\{\s*ok:\s*false\s+as\s+const,\s*error:\s*err\.message\s*\}/,
    );
  });

  it("[HN6-DH-W15] ĐỔI KHOÁ NÓI SAU (rà đối kháng chốt): kết quả đổi khoá mang `soPhieuTheDaHuy` (BẮT BUỘC, lấy từ kết quả của thân dừng học), toast nói hậu tố KHI > 0 — và hậu tố là MỘT hằng dùng chung với hộp Dừng học, không bản chép tay", () => {
    const db = boChuThich(doc("lib/finance/doi-khoa-db.ts"));
    expect(dem(db, /^\s*soPhieuTheDaHuy:\s*number;/m), "kiểu kết quả khai trường bắt buộc").toBe(1);
    expect(dem(db, /\bsoPhieuTheDaHuy:\s*dung\.soPhieuTheDaHuy\b/), "lấy thẳng từ kết quả thân dừng học").toBe(1);
    const dk = boChuThich(doc("app/(admin)/admin/orders/_components/doi-khoa-dialog.tsx"));
    const dh = boChuThich(doc("app/(admin)/admin/orders/_components/dung-hoc-dialog.tsx"));
    expect(dem(dk, /\br\.soPhieuTheDaHuy\s*>\s*0\b/), "đổi khoá: nói sau chỉ khi máy chủ báo đã huỷ").toBe(1);
    expect(dem(dk, /\bHAU_TO_TOAST_THE_POS_DA_HUY\b/), "import + đúng MỘT chỗ dùng").toBe(2);
    expect(dem(dh, /\bHAU_TO_TOAST_THE_POS_DA_HUY\b/), "dừng học dùng CÙNG hằng: import + đúng MỘT chỗ dùng").toBe(2);
    expect(dem(dk, /đã huỷ phiếu thẻ POS đang chờ quẹt/), "không chép tay chữ của hậu tố").toBe(0);
    expect(dem(dh, /đã huỷ phiếu thẻ POS đang chờ quẹt/), "không chép tay chữ của hậu tố").toBe(0);
    expect(HAU_TO_TOAST_THE_POS_DA_HUY).toMatch(/đã huỷ phiếu thẻ POS đang chờ quẹt/);
  });
});

describe("[HN6-DH-W] `tuChoiSaiMa` (sai-ma-ghi.ts) — kế toán bác khi phiếu gộp ĐÃ ĐÓNG thì phiếu thẻ KẾT THÚC, không mở lại trên mã chết", () => {
  const ma = boChuThich(doc(TEP_SAI_MA));
  const than = thanHam(ma, "export async function tuChoiSaiMa(");

  it("[HN6-DH-W14] khối có ĐIỀU KIỆN `paymentBill.status !== \"OPEN\"`: ngay SAU bước nhả (CHO_QUET) và TRƯỚC vết từ chối, gọi ĐÚNG đường ghi HUY chung (nguồn `TU_CHOI_SAI_MA`), cùng `tx`", () => {
    expect(than.length, "cắt được thân `tuChoiSaiMa`").toBeGreaterThan(1500);
    const MOC: [string, RegExp][] = [
      ["bước nhả phiếu thẻ về mở", /\btx\.posPaymentIntent\.update\(\s*\{[\s\S]*?status:\s*"CHO_QUET"/],
      ["điều kiện phiếu gộp đã đóng", /\bpaymentBill\.status\s*!==\s*"OPEN"/],
      ["kết thúc phiếu thẻ bằng đường chung", /\bghiHuyPhieuTheTrongTx\(tx,/],
      ["vết từ chối", /\baction:\s*"POS_SAI_MA_TU_CHOI"/],
    ];
    let truoc = -1;
    for (const [ten, re] of MOC) {
      expect(dem(than, re), `${ten}: đúng một lần`).toBe(1);
      const i = than.search(re);
      expect(i, `${ten}: đứng SAU mốc trước`).toBeGreaterThan(truoc);
      truoc = i;
    }
    // Lời gọi nằm TRONG khối điều kiện (không chạy ở đường thường) và mang nguồn riêng.
    const tuDk = than.slice(than.search(/\bpaymentBill\.status\s*!==\s*"OPEN"/));
    const khoi = tuDk.slice(0, tuDk.search(/\baction:\s*"POS_SAI_MA_TU_CHOI"/));
    expect(dem(khoi, /\bghiHuyPhieuTheTrongTx\(tx,/), "lời gọi nằm sau điều kiện, trước vết từ chối").toBe(1);
    expect(dem(khoi, /\bnguon:\s*"TU_CHOI_SAI_MA"/)).toBe(1);
    // KHÔNG đường ghi HUY thứ hai: tệp này không tự nói trạng thái HUY.
    expect(dem(ma, /["']HUY["']/), "không tự ghi HUY — đi qua `ghiHuyPhieuTheTrongTx`").toBe(0);
  });

  it("[HN6-DH-W14b] đường thường KHÔNG đổi: bước nhả vẫn đặt `CHO_QUET` + `bankTransactionId: null` + câu từ chối; không `else` đổi nó; phép ghi hai đầu vẫn nằm SAU mọi cổng `return { ok: false`", () => {
    expect(than).toMatch(/\bdata:\s*\{\s*status:\s*"CHO_QUET",\s*bankTransactionId:\s*null,\s*lastResultMessage:\s*cauTuChoi\(lyDo\)\s*\}/);
    const iGhiDau = than.search(/\btx\.posSaiMaYeuCau\.updateMany\(/);
    expect(iGhiDau, "phép ghi đầu tiên là updateMany có điều kiện").toBeGreaterThan(0);
    // Mọi `return { ok: false` SAU phép ghi đầu tiên TRONG callback chỉ được là ngoại lệ FIX-H9 (đổi 0 dòng ngay sau updateMany). Cắt ở `return { ok: true …` cuối callback: khối `catch` ngoài
    // transaction (P2002 → câu cho người dùng) cố ý KHÔNG tính — nó chạy SAU khi transaction đã cuộn ngược.
    const cuoiCallback = than.search(/\breturn\s*\{\s*ok:\s*true\s+as\s+const,\s*nguoiGuiId\b/);
    expect(cuoiCallback, "tìm được `return` cuối callback").toBeGreaterThan(iGhiDau);
    const sauGhi = than.slice(iGhiDau, cuoiCallback);
    expect(dem(sauGhi, /\breturn\s*\{\s*ok:\s*false\b/), "đúng MỘT (đổi 0 dòng ⇒ bên kia đã quyết)").toBe(1);
    expect(sauGhi.slice(0, sauGhi.search(/\breturn\s*\{\s*ok:\s*false\b/)), "nó đứng ngay sau updateMany").toMatch(/if\s*\(\s*upd\.count\s*===\s*0\s*\)\s*$/);
  });
});
