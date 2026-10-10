// [HN3-W1..W14] — LƯỚI GHIM MÃ NGUỒN cho Việc 3 POS "sale nhập sai mã trên máy" (docs/pos-hai-nut-khai-may.md §5). THUẦN.
//
// Luật dạng "lời gọi này phải có ở ĐÚNG chỗ kia / không được có ở chỗ này" — ca hành vi chạm DB nằm ở
// `tests/finance/pos-hai-nut-sai-ma.test.ts` (không chạy trong `test:unit`), nên dây nối phải có khoá chạy ở mọi lượt `test:unit`.
//
// Mẫu (CLAUDE.md "LƯỚI GHIM MÃ NGUỒN"): bóc chú thích TRƯỚC khi đếm (chú thích giải thích bản vá chứa đúng chuỗi đang tìm — luật 11),
// neo theo LỜI GỌI / BIỂU THỨC ĐIỀU KIỆN chứ không theo chỗ đặt `await`, khẳng định SỐ LẦN khớp, và mỗi ca ghi mã TRƯỚC bản vá.
// Mọi ca ở đây đã được CẤY LẠI lỗi tương ứng và đỏ đúng tập (xem bảng mutation ở docs/pos-hai-nut-khai-may.md §5.6).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { duyetSaiMaSchema, guiSaiMaSchema, timSaiMaSchema, tuChoiSaiMaSchema } from "@/lib/validators/phieu-pos";

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

/** Thân MỘT hàm `export async function <ten>(` tới hàm export kế tiếp (hoặc hết tệp). Không thấy ⇒ chuỗi rỗng (ca đỏ). */
function ham(ma: string, ten: string): string {
  const i = ma.search(new RegExp(`export async function ${ten}\\(`));
  if (i < 0) return "";
  const j = ma.slice(i + 1).search(/\nexport (?:async function|function|const|type) /);
  return j < 0 ? ma.slice(i) : ma.slice(i, i + 1 + j);
}

/** Thân callback `$transaction(async (tx) => {` của một hàm — tới `});` đóng ngay trước `} catch (err) {`. */
function thanTx(h: string): string {
  const i = h.search(/await db\.\$transaction\(async \(tx\) => \{/);
  if (i < 0) return "";
  const j = h.slice(i).search(/\n {4}\}\);\n {2}\} catch \(err\) \{/);
  return j < 0 ? "" : h.slice(i, i + j);
}

const GHI = doc("lib/payments/pos/sai-ma-ghi.ts");
const DOC = doc("lib/payments/pos/sai-ma-doc.ts");
const THUAN = doc("lib/payments/pos/sai-ma.ts");
const ACT_SALE = doc("app/(admin)/admin/orders/_pos-sai-ma-actions.ts");
const ACT_KT = doc("app/(admin)/admin/bien-dong-so-du/_pos-sai-ma-actions.ts");
const TRANG = doc("app/(admin)/admin/bien-dong-so-du/page.tsx");
const KHU_THE = doc("app/(admin)/admin/bien-dong-so-du/_components/khu-the-pos.tsx");
const BANG_GD = doc("app/(admin)/admin/bien-dong-so-du/_components/bank-txn-client.tsx");
const HOP = doc("app/(admin)/admin/orders/_components/hop-phieu-pos.tsx");

/** Phép ghi DB trong một callback `tx`: `tx.<model>.<ghi>(` hoặc `writeAudit(` (nó nhận `tx` và INSERT AuditLog). */
const PHEP_GHI = /\btx\.\w+\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\bwriteAudit\(/;

describe("[HN3-W1] MỘT đường tiền — lớp sai mã KHÔNG tự ghi tiền", () => {
  const TEP = [
    ["sai-ma-ghi.ts", GHI],
    ["sai-ma-doc.ts", DOC],
    ["sai-ma.ts", THUAN],
    ["_pos-sai-ma-actions.ts (sale)", ACT_SALE],
    ["_pos-sai-ma-actions.ts (kế toán)", ACT_KT],
  ] as const;

  it("không `thuTheoPhieuGop(` · `allocateToOrder(` · `ganTienTheoCon(` · Payment/phân bổ/giao dịch tiền/phiếu thu/phiếu gộp ghi trực tiếp", () => {
    for (const [ten, ma] of TEP) {
      expect(ma, `${ten} phải đọc được`).not.toBe("");
      for (const cam of [
        /\bthuTheoPhieuGop\s*\(/,
        /\ballocateToOrder\s*\(/,
        /\bingestPayosWebhook\s*\(/,
        /\bganTienTheoCon\s*\(/,
        /\.payment\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
        /\.paymentAllocation\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
        /\.bankTransaction\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
        /\.paymentRequest\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
        /\.paymentBill\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
        /\.creditBalance\.(?:create|update|updateMany|upsert)\s*\(/,
      ]) {
        expect(dem(ma, cam), `${ten}: ${cam.source}`).toBe(0);
      }
    }
  });

  it("ĐỐI CHỨNG DƯƠNG: tiền đi ĐÚNG MỘT lời gọi `xuLyKetQuaPos(`, kèm `maXacNhan` = mã đọc dưới khoá, đứng NGOÀI mọi $transaction", () => {
    expect(dem(GHI, /\bxuLyKetQuaPos\s*\(/), "một lời gọi đường tiền chung").toBe(1);
    expect(dem(GHI, /maXacNhan: x\.maDung,/)).toBe(1);
    // Mã TRƯỚC thiết kế: ghi `Payment` thẳng trong transaction gửi — tách đôi sổ tiền, mất sự kiện `phieu-gop.da-chia`.
    const hamGhiTien = GHI.slice(GHI.search(/async function ghiTienChoYeuCau\(/));
    const dauThan = hamGhiTien.slice(0, hamGhiTien.search(/\n\}\n/));
    expect(dauThan, "tìm thấy ghiTienChoYeuCau").not.toBe("");
    expect(dem(dauThan, /\$transaction/), "ghiTienChoYeuCau không mở transaction (đường tiền tự mở)").toBe(0);
    expect(dem(dauThan, /triggeredBy: "SALE"/), "không thêm giá trị PosCheckTrigger (V74)").toBe(1);
  });

  it("lời gọi đường tiền KHÔNG nằm trong thân callback transaction nào (nó tự khoá đơn → giao dịch → phiếu; lồng là khoá chồng)", () => {
    for (const ten of ["guiSaiMa", "duyetSaiMa", "tuChoiSaiMa"]) {
      const body = thanTx(ham(GHI, ten));
      expect(body, `${ten}: tìm thấy thân $transaction`).not.toBe("");
      expect(dem(body, /\bxuLyKetQuaPos\s*\(|\bghiTienChoYeuCau\s*\(/), `${ten}: không gọi đường tiền trong transaction`).toBe(0);
    }
  });
});

describe("[HN3-W2] `maXacNhan` KHÔNG BAO GIỜ đến từ client", () => {
  it("lib: mã đúng chỉ lấy từ `code5` của phiếu đọc DƯỚI KHOÁ — đúng hai chỗ (gửi · duyệt)", () => {
    expect(dem(GHI, /maDung: intent\.code5,\s*maDon: don\.code,/), "gửi: mã đúng = intent.code5 đọc trong transaction").toBe(1);
    expect(dem(GHI, /maDung: yc\.intent\.code5,\s*tenMay:/), "duyệt: mã đúng = yc.intent.code5 đọc trong transaction").toBe(1);
    // `ThongTinGhi` (thứ nuôi `maXacNhan`) chỉ được dựng ở đúng hai chỗ — gửi · duyệt.
    expect(dem(GHI, /const thongTin: ThongTinGhi = \{/)).toBe(1);
    expect(dem(GHI, /satisfies ThongTinGhi/)).toBe(1);
    // Mọi chỗ gán `maDung:` đều lấy từ thông tin đã dựng ở hai chỗ trên (hoặc là khai báo kiểu).
    expect(dem(GHI, /maDung: (?!intent\.code5|yc\.intent\.code5|x\.maDung|giu\.maDung|tc\.maDung|string)/)).toBe(0);
    expect(dem(GHI, /\bi\.maDung\b|\bi\.maXacNhan\b|\binput\.maXacNhan\b/), "đầu vào của hàm lib không mang mã").toBe(0);
  });

  it("action: object truyền vào lib chỉ có ĐÚNG các khoá định danh — không `maXacNhan` · `maDung` · `kieu` · `soTien` · `centerId`", () => {
    /** Khoá của object đối số trong lời gọi `<ten>({ … })`. */
    const khoa = (ma: string, ten: string): string[] => {
      const m = new RegExp(`\\b${ten}\\(\\{([\\s\\S]*?)\\}\\);`).exec(ma);
      return m ? [...m[1]!.matchAll(/^\s*(\w+):/gm)].map((x) => x[1]!).sort() : ["<KHÔNG THẤY LỜI GỌI>"];
    };
    expect(khoa(ACT_SALE, "timUngVienSaiMa")).toEqual(["intentId", "now", "orderId", "sdb"]);
    expect(khoa(ACT_SALE, "guiSaiMa")).toEqual(["actor", "bankTransactionId", "intentId", "now", "orderId"]);
    expect(khoa(ACT_KT, "duyetSaiMa")).toEqual(["actor", "now", "orderId", "yeuCauId"]);
    expect(khoa(ACT_KT, "tuChoiSaiMa")).toEqual(["actor", "lyDo", "now", "orderId", "yeuCauId"]);
    for (const [ten, ma] of [
      ["sale", ACT_SALE],
      ["kế toán", ACT_KT],
    ] as const) {
      expect(dem(ma, /\bmaXacNhan\b|\bmaDung\b/), `action ${ten}`).toBe(0);
    }
  });

  it("zod: lược đồ chỉ có đúng các trường định danh — tham số thừa bị bỏ, không lọt tới lib", () => {
    expect(Object.keys(timSaiMaSchema.shape).sort()).toEqual(["intentId", "orderId"]);
    expect(Object.keys(guiSaiMaSchema.shape).sort()).toEqual(["bankTransactionId", "intentId", "orderId"]);
    expect(Object.keys(duyetSaiMaSchema.shape).sort()).toEqual(["orderId", "yeuCauId"]);
    expect(Object.keys(tuChoiSaiMaSchema.shape).sort()).toEqual(["lyDo", "orderId", "yeuCauId"]);
    const vao = { orderId: "o1", intentId: "i1", bankTransactionId: "b1" };
    const ra = guiSaiMaSchema.parse({ ...vao, maXacNhan: "ABCDE", kieu: "TU_GHI_NHAN", soTien: 1 });
    expect(ra).toEqual(vao);
    // Đối chứng dương: đủ ba trường thì qua; thiếu một trường thì không.
    expect(guiSaiMaSchema.safeParse(vao).success).toBe(true);
    expect(guiSaiMaSchema.safeParse({ orderId: "o1", intentId: "i1" }).success).toBe(false);
  });
});

describe("[HN3-W3] THỨ TỰ KHOÁ: ĐƠN → GIAO DỊCH → PHIẾU POS, và cả ba đứng TRƯỚC phép ghi đầu tiên", () => {
  for (const ten of ["guiSaiMa", "duyetSaiMa", "tuChoiSaiMa"]) {
    it(`${ten}`, () => {
      const body = thanTx(ham(GHI, ten));
      expect(body, "tìm thấy thân $transaction").not.toBe("");
      expect(dem(body, /khoaDonTrongTx\(tx, i\.orderId\)/), "khoá đơn đúng một lần").toBe(1);
      expect(dem(body, /khoaGiaoDichTrongTx\(tx, /), "khoá giao dịch đúng một lần").toBe(1);
      expect(dem(body, /khoaPhieuPosTrongTx\(tx, /), "khoá phiếu POS đúng một lần").toBe(1);
      const don = body.search(/khoaDonTrongTx\(tx/);
      const gd = body.search(/khoaGiaoDichTrongTx\(tx/);
      const phieu = body.search(/khoaPhieuPosTrongTx\(tx/);
      const ghi = body.search(PHEP_GHI);
      expect(ghi, "có phép ghi để so").toBeGreaterThan(0);
      expect(don, "đơn trước giao dịch").toBeLessThan(gd);
      expect(gd, "giao dịch trước phiếu").toBeLessThan(phieu);
      expect(phieu, "cả ba khoá trước phép ghi đầu tiên").toBeLessThan(ghi);
    });
  }
});

describe("[HN3-W4] duyệt ‖ từ chối loại trừ nhau bằng SỐ DÒNG ĐỔI ĐƯỢC của phép chuyển CÓ ĐIỀU KIỆN — TRƯỚC khi gọi đường tiền", () => {
  it("duyệt: `updateMany` điều kiện trạng thái là PHÉP GHI ĐẦU TIÊN; `count === 0` ⇒ return; không `update` trần", () => {
    const body = thanTx(ham(GHI, "duyetSaiMa"));
    const dau = body.search(PHEP_GHI);
    expect(body.slice(dau, dau + 40)).toMatch(/^tx\.posSaiMaYeuCau\.updateMany\(/);
    // `where` PHẢI mở bằng `{` ngay sau `where:` — lưới `[CTP-02]` (cong-truoc-phep-ghi) đòi đúng hình dạng đó cho mẫu chống-đua được tha.
    expect(body).toMatch(
      /where: \{ id: yc\.id, trangThai: ketLuc \? "DANG_GHI" : "CHO_DUYET", \.\.\.\(ketLuc \? \{ dangGhiLuc: yc\.dangGhiLuc \} : \{\}\) \},/,
    );
    expect(body).toMatch(/if \(upd\.count === 0\) return \{ ok: false as const, error: LOI_DA_XU_LY \};/);
    expect(dem(body, /tx\.posSaiMaYeuCau\.update\(/), "không update trần (ném khi không thấy, hoặc ghi đè người kia)").toBe(0);
  });

  it("từ chối: `updateMany` CHO_DUYET → TU_CHOI đứng TRƯỚC khi nhả phiếu thẻ; `count === 0` ⇒ return", () => {
    const body = thanTx(ham(GHI, "tuChoiSaiMa"));
    const iUpd = body.search(/tx\.posSaiMaYeuCau\.updateMany\(/);
    const iNha = body.search(/tx\.posPaymentIntent\.update\(/);
    expect(iUpd).toBeGreaterThan(0);
    expect(iNha, "nhả phiếu thẻ SAU khi thắng cuộc đua").toBeGreaterThan(iUpd);
    expect(body).toMatch(/where: \{ id: yc\.id, trangThai: "CHO_DUYET" \},/);
    expect(body).toMatch(/if \(upd\.count === 0\) return \{ ok: false as const, error: LOI_DA_XU_LY \};/);
    // Cổng "không từ chối được yêu cầu đang ghi tiền".
    expect(body).toMatch(/if \(yc\.trangThai === "DANG_GHI"\) return \{ ok: false as const, error: LOI_DANG_GHI \};/);
  });

  it("chốt sau tiền: `updateMany` có điều kiện `DANG_GHI` (đổi 0 dòng nếu bên kia đã đổi) — không ghi đè trạng thái", () => {
    // Ba chỗ: chốt DA_GHI_NHAN · trả về CHO_DUYET (số phải thu đổi) · trả về CHO_DUYET (giao dịch đã được GẮN TAY — [HN3-RV-03], rà đối kháng).
    expect(dem(GHI, /where: \{ id: x\.yeuCauId, trangThai: "DANG_GHI" \},/), "ba chỗ: chốt DA_GHI_NHAN · hai nhánh trả về CHO_DUYET").toBe(3);
  });
});

describe("[HN3-W5] lưới CUỐI: UNIQUE bắt `P2002` NGOÀI transaction (Postgres đã đánh dấu cả transaction là hỏng)", () => {
  it("ba hàm đều bắt P2002 sau `$transaction`; không `try`/`P2002` trong thân callback", () => {
    expect(dem(GHI, /err instanceof Prisma\.PrismaClientKnownRequestError && err\.code === "P2002"/)).toBe(3);
    for (const ten of ["guiSaiMa", "duyetSaiMa", "tuChoiSaiMa"]) {
      const h = ham(GHI, ten);
      const body = thanTx(h);
      expect(body).not.toBe("");
      expect(dem(body, /P2002/), `${ten}: không bắt trong callback`).toBe(0);
      expect(dem(body, /\btry\s*\{/), `${ten}: không try trong callback`).toBe(0);
      expect(h.indexOf("P2002"), `${ten}: có bắt sau transaction`).toBeGreaterThan(h.indexOf(body) + body.length);
    }
  });
});

describe("[HN3-W6] cổng của hai action: xác thực → quyền → phạm vi đơn, RỒI mới vào lib; đúng quyền", () => {
  it("sale: `payments:pos-check` (không `payments:manage`), `passesScope('Order')`, lib chỉ nhận `cong.order.id`", () => {
    expect(dem(ACT_SALE, /\bawait auth\(\)/)).toBe(1);
    expect(dem(ACT_SALE, /checkPermission\("payments:pos-check"\)/)).toBe(1);
    expect(dem(ACT_SALE, /checkPermission\(/), "đúng một câu hỏi quyền").toBe(1);
    expect(dem(ACT_SALE, /payments:manage|payments:record/)).toBe(0);
    expect(dem(ACT_SALE, /passesScope\("Order", order, actor\)/)).toBe(1);
    expect(dem(ACT_SALE, /orderId: cong\.order\.id,/), "cả hai lời gọi lib dùng id của ĐƠN đã qua cổng").toBe(2);
    expect(dem(ACT_SALE, /orderId: parsed\.data\.orderId/), "không đưa id thô của client vào lib").toBe(0);
    for (const [ten, lib] of [
      ["timUngVienSaiMaAction", "timUngVienSaiMa("],
      ["guiSaiMaAction", "guiSaiMa("],
    ] as const) {
      const h = ham(ACT_SALE, ten);
      expect(h, ten).not.toBe("");
      const iCong = h.indexOf("congSaiMa(parsed.data.orderId)");
      const iLib = h.indexOf(lib);
      expect(iCong, `${ten} gọi cổng`).toBeGreaterThan(0);
      expect(iLib, `${ten} gọi lib`).toBeGreaterThan(iCong);
      expect(h.indexOf("safeParse("), `${ten}: zod trước cổng`).toBeLessThan(iCong);
    }
  });

  it("kế toán: `payments:manage` (không `payments:record` — sale cũng giữ nó), `passesScope('Order')`, lib chỉ nhận `cong.order.id`", () => {
    expect(dem(ACT_KT, /\bawait auth\(\)/)).toBe(1);
    expect(dem(ACT_KT, /checkPermission\("payments:manage"\)/)).toBe(1);
    expect(dem(ACT_KT, /checkPermission\(/), "đúng một câu hỏi quyền").toBe(1);
    expect(dem(ACT_KT, /payments:record|payments:pos-check/)).toBe(0);
    expect(dem(ACT_KT, /passesScope\("Order", order, actor\)/)).toBe(1);
    expect(dem(ACT_KT, /orderId: cong\.order\.id,/)).toBe(2);
    expect(dem(ACT_KT, /orderId: parsed\.data\.orderId/)).toBe(0);
    for (const [ten, lib] of [
      ["duyetSaiMaAction", "duyetSaiMa("],
      ["tuChoiSaiMaAction", "tuChoiSaiMa("],
    ] as const) {
      const h = ham(ACT_KT, ten);
      expect(h, ten).not.toBe("");
      const iCong = h.indexOf("congKeToanSaiMa(parsed.data.orderId)");
      expect(iCong, `${ten} gọi cổng`).toBeGreaterThan(0);
      expect(h.indexOf(lib), `${ten} gọi lib`).toBeGreaterThan(iCong);
      expect(h.indexOf("safeParse("), `${ten}: zod trước cổng`).toBeLessThan(iCong);
    }
  });
});

describe("[HN3-W7] BẬC xử lý chỉ do `phanLoaiSaiMa` quyết — lib không tự đặt, client không chọn", () => {
  it("`kieu` suy từ `chon.xemTruoc.quyet`; trạng thái đầu từ `kieu`; không có đầu vào `kieu`", () => {
    expect(dem(GHI, /const kieu: KieuSaiMa = chon\.xemTruoc\.quyet === "TU_GHI_NHAN" \? "TU_GHI_NHAN" : "CHO_KE_TOAN";/)).toBe(1);
    expect(dem(GHI, /trangThai: kieu === "TU_GHI_NHAN" \? "DANG_GHI" : "CHO_DUYET",/)).toBe(1);
    expect(dem(GHI, /\bi\.kieu\b/)).toBe(0);
    // Tính LẠI dưới khoá bằng CÙNG hàm với bước tìm: đúng một lời gọi `docUngVienSaiMa({ doc: tx, chan: tx,` ở transaction gửi.
    expect(dem(GHI, /docUngVienSaiMa\(\{ doc: tx, chan: tx, /)).toBe(1);
  });

  it("`docUngVienSaiMa` gọi `phanLoaiSaiMa(` và `locUngVien(` — mỗi cái đúng một lần", () => {
    expect(dem(DOC, /\bphanLoaiSaiMa\(/)).toBe(1);
    expect(dem(DOC, /\blocUngVien\(/)).toBe(1);
  });
});

describe("[HN3-W8] khoá `chan` KHÔNG scope; khách `doc` chỉ để hiển thị — câu tra để CHẶN không đi qua scopedDb", () => {
  it("`timUngVienSaiMa` truyền `chan: db` (trần) và ép `doc` từ sdb; hàm lõi không import scopedDb giá trị", () => {
    expect(dem(DOC, /docUngVienSaiMa\(\{ doc: x\.sdb as unknown as KhachDoc, chan: db, /)).toBe(1);
    expect(dem(DOC, /\bscopedDb\s*\(/), "tệp đọc không tự dựng scopedDb").toBe(0);
    // `chan` chỉ nhận các bảng cần để CHẶN (không scope): đủ phiếu thẻ cạnh tranh, dòng yêu cầu, agent, nguồn đã thấy.
    expect(dem(DOC, /chan\.posSaiMaYeuCau\.count\(/)).toBeGreaterThanOrEqual(1);
    expect(dem(DOC, /chan\.paymentBill\./)).toBeGreaterThanOrEqual(1);
  });
});

describe("[HN3-W9] trang Biến động số dư nối hàng chờ đủ dây, đúng cổng quyền, KHÔNG thêm lượt đi-về nối đuôi", () => {
  it("`docHangChoSaiMa` nằm TRONG lô `Promise.all` có `canhBaoRows`, gác bằng `canManagePayments`", () => {
    expect(dem(TRANG, /canManagePayments \? docHangChoSaiMa\(sdb, actor, new Date\(\)\) : Promise\.resolve\(null\)/)).toBe(1);
    expect(dem(TRANG, /\bdocHangChoSaiMa\(/), "đúng một lời gọi").toBe(1);
    const lo = TRANG.slice(TRANG.search(/const \[canhBaoRows, dongPosRows, soBoQua, loRows, hangSaiMa\] = await Promise\.all\(\[/));
    const hetLo = lo.search(/\n {2}\]\);/);
    expect(hetLo).toBeGreaterThan(0);
    expect(lo.slice(0, hetLo)).toContain("docHangChoSaiMa(");
  });

  it("props nối đủ: KhuThePos (saiMa · nguoiXemId) + BankTxnClient (saiMaTheoGiaoDich) — và chúng BẮT BUỘC", () => {
    expect(dem(TRANG, /saiMa=\{hangSaiMa\}/)).toBe(1);
    expect(dem(TRANG, /nguoiXemId=\{session\.user\.id\}/)).toBe(1);
    expect(dem(TRANG, /saiMaTheoGiaoDich=\{hangSaiMa\?\.theoGiaoDich \?\? \{\}\}/)).toBe(1);
    expect(dem(KHU_THE, /saiMa: HangChoSaiMa \| null;/), "prop BẮT BUỘC, không `?`").toBe(1);
    expect(dem(KHU_THE, /\bsaiMa\?:/)).toBe(0);
    expect(dem(KHU_THE, /nguoiXemId: string;/)).toBe(1);
    expect(dem(BANG_GD, /saiMaTheoGiaoDich: Record</)).toBe(1);
    expect(dem(BANG_GD, /saiMaTheoGiaoDich\?:/)).toBe(0);
  });

  it("khối `KhuSaiMaPos` chỉ vẽ khi người xem có hàng chờ (`saiMa !== null`); băng cảnh báo cùng điều kiện số dòng", () => {
    expect(dem(KHU_THE, /\{saiMa !== null && <KhuSaiMaPos hang=\{saiMa\} nguoiXemId=\{nguoiXemId\} \/>\}/)).toBe(1);
    expect(dem(TRANG, /hangSaiMa !== null && hangSaiMa\.soCanXuLy > 0 && \(/)).toBe(1);
    expect(dem(TRANG, /\{hangSaiMa\.soCanXuLy\} giao dịch thẻ do sale báo nhập sai mã đang chờ xử lý/), "số trên băng = số CẦN NGƯỜI").toBe(1);
    expect(dem(TRANG, /href="#the-pos-sai-ma"/)).toBe(1);
  });

  it("trang KHÔNG tự thêm select lồng / passesScope cho Việc 3 (loader tự lo — V68)", () => {
    expect(dem(TRANG, /posSaiMaYeuCau/), "trang không đọc bảng yêu cầu trực tiếp").toBe(0);
  });
});

describe("[HN3-W10] hộp phiếu POS của sale: nút/bước nối đủ, điều kiện nút ở MỘT hàm thuần", () => {
  it("`nutNhapSaiMa(` đúng một lời gọi; hai action sai mã đúng một lời gọi mỗi cái; `<BuocSaiMa` đúng một chỗ", () => {
    expect(dem(HOP, /\bnutNhapSaiMa\(/)).toBe(1);
    expect(dem(HOP, /\btimUngVienSaiMaAction\(/), "một lần mở bước + một lần tải lại sau lỗi gửi").toBe(2);
    expect(dem(HOP, /\bguiSaiMaAction\(/)).toBe(1);
    expect(dem(HOP, /<BuocSaiMa\b/)).toBe(1);
    // GHÉP Việc 4 (10/10/2026): điều kiện vẽ nút nay là `nut.nhapSaiMa` — KẾT QUẢ của `nutTrongHopPhieuThe`, hàm nhận `nutSaiMa` (= `nutNhapSaiMa`, lời gọi duy nhất
    // ở trên) rồi thêm hai ngoại lệ (yêu cầu đang giữ · vừa gửi). Mã TRƯỚC ghép: `{!dangKiem && nutSaiMa && (`. Dây nối của hàm mới ghim ở `[HNG-W1]`.
    expect(dem(HOP, /\{!dangKiem && nut\.nhapSaiMa && \(/), "nút chỉ vẽ khi đang không kiểm và hàm thuần cho phép").toBe(1);
    expect(dem(HOP, /\{!dangKiem && nutSaiMa && \(/), "không còn vẽ thẳng theo `nutSaiMa` (bỏ qua hai ngoại lệ của hàm ghép)").toBe(0);
  });

  it("nút 'Báo admin' SẴN CÓ giữ nguyên và dùng CHUNG một biến `choBaoAdmin` cho cả hai nơi", () => {
    expect(dem(HOP, /const choBaoAdmin =/)).toBe(1);
    expect(dem(HOP, /choBaoAdmin=\{choBaoAdmin\}/), "truyền cho BuocSaiMa và NoiDungPhieu").toBe(2);
    expect(dem(HOP, /lyDoKhongBaoAdmin\(/)).toBe(1);
  });

  it("sau khi kế toán TỪ CHỐI: ẩn hướng dẫn quẹt lại và in dòng riêng đọc từ DÒNG YÊU CẦU (`phieu.saiMa`), không từ câu lưu", () => {
    expect(dem(HOP, /const daBiTuChoi = phieu\.saiMa\?\.trangThai === "TU_CHOI" && /)).toBe(1);
    // Rà ghép 10/10/2026: "ẩn bốn bước sau từ chối" nay do hàm thuần quyết (`nut.moiQuet` ⇒ I9 của `[HNG-N02]` + `[HNG-R1-8]` đo hành vi); component chỉ lấy kết quả.
    expect(dem(HOP, /const conCanGo = nut\.moiQuet\b/), "bốn bước mời quẹt theo hàm thuần (đã loại trừ daBiTuChoi)").toBe(1);
    expect(dem(HOP, /\bdaBiTuChoi,/), "…và `daBiTuChoi` được đưa vào hàm quyết").toBeGreaterThanOrEqual(1);
    expect(dem(HOP, /cauTuChoi\(phieu\.saiMa\?\.lyDoTuChoi \?\? null\)/)).toBe(1);
    expect(dem(HOP, /\{cauDaTuChoi !== null && \(/), "dòng cảnh báo vẽ từ biến đã tính, một chỗ").toBe(1);
  });

  it("câu LƯU trùng câu từ chối thì KHÔNG in hai lần; `nutNhapSaiMa` vẫn hỏi câu THẬT (`hien`), không hỏi câu đã giấu", () => {
    // Mã TRƯỚC bản vá: `{!dangKiem && hien && tone && …}` in `hien.thongDiep` ngay dưới dòng cảnh báo cùng chữ (smoke 375px 09/10/2026).
    expect(dem(HOP, /const hienDeIn = hien && hien\.thongDiep === cauDaTuChoi \? null : hien;/)).toBe(1);
    expect(dem(HOP, /\{!dangKiem && hienDeIn && tone && \(/)).toBe(1);
    expect(dem(HOP, /\{!dangKiem && hien && tone && \(/), "không còn in thẳng `hien`").toBe(0);
    expect(dem(HOP, /nutNhapSaiMa\(\{ hienThi: h, thongDiep: hien\?\.thongDiep \?\? null \}\)/)).toBe(1);
  });
});

describe("[HN3-W13] khu của kế toán: cột 'Xử lý' DÍNH MÉP PHẢI, nhãn lý do NGẮN, từ chối bằng HỘP THOẠI", () => {
  const KHU_SAI_MA = doc("app/(admin)/admin/bien-dong-so-du/_components/khu-sai-ma-pos.tsx");
  const NUT_SAI_MA = doc("app/(admin)/admin/bien-dong-so-du/_components/nut-xu-ly-sai-ma.tsx");

  it("tiêu đề + ô 'Xử lý' của bảng việc cần làm dùng `O_DINH` (sticky right-0) và nền đục; hai bảng đều bọc `PhanTrangBang cuonNgang`", () => {
    // Mã TRƯỚC bản vá: không cột dính — ở 1280px nút Duyệt/Từ chối nằm sau thanh cuộn ngang, ở 375px chỉ thấy hai cột đầu (smoke 09/10/2026).
    expect(dem(KHU_SAI_MA, /const O_DINH = "sticky right-0 z-10 border-l border-border\/60";/)).toBe(1);
    expect(dem(KHU_SAI_MA, /<th className=\{`\$\{O_DINH\} \$\{TH\} w-44 bg-muted`\}>Xử lý<\/th>/)).toBe(1);
    expect(dem(KHU_SAI_MA, /<td className=\{`\$\{O_DINH\} \$\{TD\} \$\{NEN_O_DINH_CHO\}`\}>/)).toBe(1);
    expect(dem(KHU_SAI_MA, /<PhanTrangBang cuonNgang /)).toBe(2);
  });

  it("cột lý do dùng `nhanLyDo` (nhãn ngắn), KHÔNG `cauLyDo` (câu của sale làm hàng cao 5–6 dòng)", () => {
    expect(dem(KHU_SAI_MA, /\bnhanLyDo\(/)).toBe(1);
    expect(dem(KHU_SAI_MA, /\bcauLyDo\b/)).toBe(0);
  });

  it("từ chối = `<Dialog` (một chỗ), không còn ô lý do nhúng trong ô bảng; đóng bị chặn khi đang gửi", () => {
    // Mã TRƯỚC bản vá: `{moTuChoi && !thuLai ? (<div className="w-[min(88vw,280px)] …">` — 304px trong khung 293px ⇒ cắt mép phải ở 375px.
    expect(dem(NUT_SAI_MA, /<Dialog\b/)).toBe(1);
    expect(dem(NUT_SAI_MA, /w-\[min\(88vw,280px\)\]/)).toBe(0);
    expect(dem(NUT_SAI_MA, /if \(dangChay\) return;/)).toBe(1);
    expect(dem(NUT_SAI_MA, /\{!thuLai && \(\s*<Dialog/), "yêu cầu KẸT không dựng hộp thoại từ chối").toBe(1);
  });
});

describe("[HN3-W11] chữ của sale KHÔNG BAO GIỜ hướng dẫn huỷ giao dịch trên máy rồi quẹt lại (đặc tả điều 6)", () => {
  it("giao diện: không chuỗi nào trong mã chạy thật của ba tệp UI khớp /h[uủ]y|huỷ/ (bóc chú thích trước)", () => {
    for (const tep of [
      "app/(admin)/admin/orders/_components/buoc-sai-ma.tsx",
      "app/(admin)/admin/bien-dong-so-du/_components/nut-xu-ly-sai-ma.tsx",
      "app/(admin)/admin/bien-dong-so-du/_components/khu-sai-ma-pos.tsx",
    ]) {
      const ma = doc(tep);
      expect(ma, tep).not.toBe("");
      expect(dem(ma, /h[uủ]y\b|huỷ|hủy/i), tep).toBe(0);
    }
  });
});

describe("[HN3-W12] quyền: KHÔNG đẻ quyền mới (không `seed-prod-roles`)", () => {
  it("mọi `checkPermission(` ở Việc 3 hỏi khoá có sẵn", () => {
    const khoa = new Set<string>();
    for (const ma of [ACT_SALE, ACT_KT]) for (const m of ma.matchAll(/checkPermission\("([^"]+)"/g)) khoa.add(m[1]!);
    expect([...khoa].sort()).toEqual(["payments:manage", "payments:pos-check"]);
  });
});

describe("[HN3-W15] rà đối kháng (09/10/2026): các dây nối mà test hành vi một mình không giữ được", () => {
  const LUAT = doc("lib/payments/pos/phieu-pos-luat.ts");
  const KHU_SAI_MA = doc("app/(admin)/admin/bien-dong-so-du/_components/khu-sai-ma-pos.tsx");

  it("[HN3-RV-02·W] phiếu thẻ CẠNH TRANH = phiếu MỞ theo `TRANG_THAI_MO` (CHO_QUET ∪ THAT_BAI), không còn `status: \"CHO_QUET\"` trần", () => {
    // Mã TRƯỚC bản vá: `status: "CHO_QUET",` trong câu tra `canhTranh` ⇒ phiếu THAT_BAI (vẫn quẹt lại được) không được đếm.
    expect(dem(DOC, /status: \{ in: \[\.\.\.TRANG_THAI_MO\] \}/)).toBe(1);
    expect(dem(DOC, /status: "CHO_QUET"/)).toBe(0);
  });

  it("[HN4-DB-18·W] phiếu thẻ HUY mà phiếu gộp còn OPEN VẪN là đối thủ, trừ phiếu CÙNG phiếu gộp — hai vế, mỗi vế đúng một chỗ", () => {
    // Mã TRƯỚC bản vá: câu tra `canhTranh` chỉ lấy `TRANG_THAI_MO` ⇒ sale B huỷ TAY phiếu thẻ (phiếu gộp B vẫn mở) là mất tín hiệu cạnh tranh của đơn A.
    // Neo từng BIỂU THỨC chứ không neo thứ tự thuộc tính / dấu ngoặc (ca hành vi `[HN4-DB-18b]` đo hành vi thật trên Postgres).
    expect(dem(DOC, /status: "HUY",\s*paymentBill: \{ status: "OPEN" \}/)).toBe(1);
    expect(dem(DOC, /paymentBillId: \{ not: intent\.paymentBillId \}/)).toBe(1);
  });

  it("[HN3-RV-01·W] yêu cầu SỐNG của phiếu khác (CHO_DUYET ∪ DANG_GHI) cộng vào `soCanhTranh` của MỌI ứng viên — đúng một câu đếm, đúng một chỗ cộng", () => {
    expect(dem(DOC, /chan\.posSaiMaYeuCau\.count\(\{\s*where: \{\s*intentId: \{ not: intent\.id \},/)).toBe(1);
    expect(dem(DOC, /trangThai: \{ in: \["CHO_DUYET", "DANG_GHI"\] \},/)).toBe(1);
    expect(dem(DOC, /const soCanhTranh = \(r: \{[^)]*\}\) =>\s*yeuCauSong \+\s*canhTranh\.filter\(/)).toBe(1);
    // THỨ TỰ câu tra là một phần của luật (READ COMMITTED, ảnh chụp riêng mỗi câu): `canhTranh` TRƯỚC `yeuCauSong` — đảo ⇒ khe hở giữa hai ảnh chụp.
    const iCanhTranh = DOC.search(/const canhTranh = await chan\.posPaymentIntent\.findMany\(/);
    const iYeuCauSong = DOC.search(/const yeuCauSong = await chan\.posSaiMaYeuCau\.count\(/);
    expect(iCanhTranh, "có câu tra canhTranh").toBeGreaterThan(0);
    expect(iCanhTranh, "canhTranh hỏi TRƯỚC yeuCauSong").toBeLessThan(iYeuCauSong);
  });

  it("[HN3-RV-04·W] dây nối `phieuKhac` / `dangMo` của `phanLoaiSaiMa`: dựng từ `maGanCuaGhiChu`, `dangMo` = phiếu gộp đang MỞ", () => {
    // Mã TRƯỚC bản vá: dây nối này không lưới nào canh — `phieuKhac: []` hoặc `dangMo: true` mà 283/283 ca vẫn xanh (rà đối kháng 09/10/2026).
    expect(dem(DOC, /phieuKhac: maGanCuaGhiChu\(r\.dienGiai, intent\.code5\)/)).toBe(1);
    expect(dem(DOC, /dangMo: phieuTheoMa\.get\(m\) === true/)).toBe(1);
    expect(dem(DOC, /\(phieuTheoMa\.get\(p\.matchKey\) \?\? false\) \|\| p\.status === "OPEN"/)).toBe(1);
  });

  it("[HN3-RV-03·W] `chotSauGhiTien`: hỏi marker GẮN TAY TRƯỚC khi nhận công ghi tiền; nhánh đó audit riêng và không có `POS_SAI_MA_GHI_NHAN`", () => {
    const nhanh = GHI.slice(GHI.search(/if \(x\.kq\.loai === "DA_THU"\) \{/));
    const iGanTay = nhanh.search(/markerGanTay\(x\.bankTransactionId\)/);
    const iNhanCong = nhanh.search(/action: "POS_SAI_MA_GHI_NHAN"/);
    expect(iGanTay, "có hỏi marker gắn tay").toBeGreaterThan(0);
    expect(iGanTay, "hỏi TRƯỚC khi nhận công").toBeLessThan(iNhanCong);
    expect(dem(GHI, /markerGanTay\(/)).toBe(1);
    // Chỉ hỏi khi lượt này không tự ghi; bút toán đã xoá mềm không tính.
    expect(dem(GHI, /x\.kq\.daGhiTruoc\s*\? await db\.payment\.count\(\{ where: \{ orderId: x\.orderId, deletedAt: null, /)).toBe(1);
    expect(dem(GHI, /action: "POS_SAI_MA_XU_LY_NGOAI"/)).toBe(1);
  });

  it("[HN3-RV-05·W] `anKhoiManSale` giữ phiếu có yêu cầu mới nhất bị TỪ CHỐI — cùng nguồn `saiMaYeuCau[0]` với `dungPhieuPosView`", () => {
    expect(dem(LUAT, /p\.saiMaYeuCau\[0\]\?\.trangThai === "TU_CHOI"\) return false;/)).toBe(1);
    expect(dem(LUAT, /const yc = p\.saiMaYeuCau\[0\] \?\? null;/)).toBe(1);
  });

  it("[HN3-RV-07·W] `guiSaiMaAction` làm mới trang TRƯỚC khi xét `ok` (như `duyetSaiMaAction`); hộp làm mới cả khi gửi thất bại", () => {
    const ham1 = ham(ACT_SALE, "guiSaiMaAction");
    expect(ham1).not.toBe("");
    const iLamMoi = ham1.search(/revalidatePath\(`\/orders\/\$\{cong\.order\.id\}`\);/);
    const iXetOk = ham1.search(/if \(!kq\.ok\) return \{ ok: false, error: kq\.error \};/);
    expect(iLamMoi, "có làm mới").toBeGreaterThan(0);
    expect(iLamMoi, "làm mới TRƯỚC khi xét ok").toBeLessThan(iXetOk);
    // Nhánh `!res.ok` của `chonGiaoDich` có `router.refresh()` ngay sau `toast.error(res.error)`.
    expect(dem(HOP, /toast\.error\(res\.error\);\s*(?:\/\/[^\n]*\n\s*)*router\.refresh\(\);/)).toBe(1);
  });

  it("[HN3-RV-08·W] hậu kiểm: chip và nhãn người làm đi qua MỘT hàm `cachXetHauKiem`, màn không tự so `kieu`", () => {
    expect(dem(KHU_SAI_MA, /const xet = cachXetHauKiem\(d\);/)).toBe(1);
    expect(dem(KHU_SAI_MA, /xet\.chipSaleTuXacNhan &&/)).toBe(1);
    expect(dem(KHU_SAI_MA, /\{xet\.nhanNguoiQuyet\} \{d\.nguoiQuyet\}/)).toBe(1);
    expect(dem(KHU_SAI_MA, /d\.kieu === "TU_GHI_NHAN"/)).toBe(0);
  });
});

describe("[HN5-W] Việc 5 — vết bác khoá theo ĐƠN, MỘT chỗ đọc, bước TÌM (màn) và bước GỬI (máy chủ, dưới khoá) dùng chung", () => {
  it("[HN5-W1] `docUngVienSaiMa` hỏi vết bác ĐÚNG MỘT lần qua `docGiaoDichDaBiBac(chan, intent.orderId)`; `soLanBiBac` lẫn `daBiBacChoDon` cùng đọc từ kết quả ấy", () => {
    // Mã TRƯỚC Việc 5: hai câu tra RIÊNG (`count` + `findMany`) đều khoá `intentId: intent.id` ⇒ phiếu thẻ mới (hết hạn · huỷ · phiếu gộp đổi mã) "chưa từng bị bác".
    expect(dem(DOC, /\bdocGiaoDichDaBiBac\(chan, intent\.orderId\)/)).toBe(1);
    expect(dem(DOC, /const soLanBiBac = bac\.soLan;/)).toBe(1);
    expect(dem(DOC, /daBiBacChoDon: r\.bankTransactionId !== null && bac\.giaoDich\.has\(r\.bankTransactionId\),/)).toBe(1);
  });

  it("[HN5-W2] chỉ MỘT câu tra nói `trangThai: \"TU_CHOI\"` trong tệp đọc — khoá theo ĐƠN, đi qua `chan` (không scope); khoá theo phiếu thẻ / phiếu gộp: 0 chỗ", () => {
    expect(dem(DOC, /trangThai: "TU_CHOI"/), "mọi chỗ lấy TU_CHOI làm điều kiện tra").toBe(1);
    expect(dem(DOC, /chan\.posSaiMaYeuCau\.findMany\(\{\s*where: \{ trangThai: "TU_CHOI", intent: \{ paymentBill: \{ orderId \} \} \},/)).toBe(1);
    expect(dem(DOC, /intentId: intent\.id,\s*trangThai: "TU_CHOI"/), "khoá theo PHIẾU THẺ (mã trước Việc 5)").toBe(0);
    expect(dem(DOC, /paymentBillId: intent\.paymentBillId,\s*trangThai: "TU_CHOI"/), "khoá theo PHIẾU GỘP (để lọt ca đổi mã phiếu gộp)").toBe(0);
    expect(dem(DOC, /\bdoc\.posSaiMaYeuCau\b/), "câu tra để CHẶN không bao giờ đi qua khách đã scope").toBe(0);
  });

  it("[HN5-W3] cả hai nơi gọi hàm lõi đều truyền ĐƠN vào phiếu thẻ: bước tìm từ `x.orderId` (đã qua `where` của phiếu), bước gửi từ phiếu gộp đọc DƯỚI KHOÁ", () => {
    expect(dem(DOC, /intent: \{ \.\.\.intent, orderId: x\.orderId \},/)).toBe(1);
    expect(dem(GHI, /intent: \{ \.\.\.intent, orderId: intent\.paymentBill\.orderId \},/)).toBe(1);
  });

  it("[HN5-W4] `IntentDeTim.orderId` là trường BẮT BUỘC (không `?`) — quên truyền là `tsc` đỏ, không phải vết bác biến mất trong im lặng", () => {
    const khoi = /export type IntentDeTim = \{[\s\S]*?\n\};/.exec(DOC)?.[0] ?? "";
    expect(khoi, "tìm thấy kiểu IntentDeTim").not.toBe("");
    expect(dem(khoi, /\n {2}orderId: string;/)).toBe(1);
    expect(dem(khoi, /orderId\?:/)).toBe(0);
  });
});

describe("[HN5-W5] rà đối kháng — câu khi danh sách ứng viên trống đến từ MỘT hàm, cả bước TÌM lẫn bước GỬI, dựa trên số giao dịch bị loại vì vết bác", () => {
  it("[HN5-W5a] `docUngVienSaiMa` đếm giao dịch bị loại CHỈ vì vết bác (`soBiLoaiVeBac`) trên cả hai nhánh trả OK có danh sách trống", () => {
    // Mã TRƯỚC: không có trường này; X bị `laUngVienHopLe` loại im lặng rồi hai cửa in `CAU_KHONG_UNG_VIEN` ("Không thấy giao dịch nào…").
    expect(dem(DOC, /\bsoBiLoaiVeBac\b/), "khai ở kiểu · 2 nhánh trống · nhánh cuối").toBeGreaterThanOrEqual(4);
    expect(dem(DOC, /soBiLoaiVeBac: 0 }/), "không có dòng thô nào ⇒ 0").toBe(1);
  });

  it("[HN5-W5b] bước TÌM và bước GỬI đều lấy câu từ `cauKhongUngVien(<số bị loại>)`; không còn dùng thẳng `CAU_KHONG_UNG_VIEN` làm câu của danh sách trống", () => {
    expect(dem(DOC, /cau: hienThi\.length === 0 \? cauKhongUngVien\(r\.soBiLoaiVeBac\) : null,/)).toBe(1);
    expect(dem(GHI, /doc\.ungVien\.length === 0 \? cauKhongUngVien\(doc\.soBiLoaiVeBac\) :/)).toBe(1);
    expect(dem(DOC, /\? CAU_KHONG_UNG_VIEN :/), "bước tìm: 0 chỗ dùng thẳng hằng").toBe(0);
    expect(dem(GHI, /\? CAU_KHONG_UNG_VIEN :/), "bước gửi: 0 chỗ dùng thẳng hằng").toBe(0);
  });
});

describe("[HN5-W6] rà đối kháng — cờ `donDaCoVetBac` của hộp phiếu: MỘT nguồn (`docGiaoDichDaBiBac`), đi hết dây tới hộp", () => {
  const PHIEU_POS = doc("lib/payments/pos/phieu-pos.ts");
  const LUAT = doc("lib/payments/pos/phieu-pos-luat.ts");
  const HOP = doc("app/(admin)/admin/orders/_components/hop-phieu-pos.tsx");

  it("[HN5-W6a] tầng đọc view nạp cờ từ `docGiaoDichDaBiBac(` ĐÚNG một chỗ (không viết lại truy vấn `TU_CHOI`); tầng thuần chỉ chuyển tiếp", () => {
    // Mã TRƯỚC: không có cờ. Hai truy vấn TU_CHOI (một ở sai-ma-doc, một ở đây) là hai nơi có ngày cãi nhau về phạm vi.
    expect(dem(PHIEU_POS, /\bdocGiaoDichDaBiBac\(/)).toBe(1);
    expect(dem(PHIEU_POS, /trangThai: "TU_CHOI"/), "phieu-pos.ts không tự hỏi TU_CHOI").toBe(0);
    expect(dem(LUAT, /donDaCoVetBac: p\.donDaCoVetBac,/), "view chuyển tiếp đúng một lần").toBe(1);
    const khoi = /export type PhieuPosDeXem = \{[\s\S]*?\n\};/.exec(LUAT)?.[0] ?? "";
    expect(dem(khoi, /\n {2}donDaCoVetBac: boolean;/), "BẮT BUỘC (luật 7) trên kiểu đầu vào").toBe(1);
    expect(dem(khoi, /donDaCoVetBac\?:/)).toBe(0);
  });

  it("[HN5-W6b] hộp phiếu hỏi `canhBaoDonDaBac(` (hàm thuần) — không tự so trạng thái; truyền `donDaCoVetBac` và `daBiTuChoi` của chính nó", () => {
    expect(dem(HOP, /\bcanhBaoDonDaBac\(\{/)).toBe(1);
    expect(dem(HOP, /donDaCoVetBac: phieu\.donDaCoVetBac/)).toBe(1);
    expect(dem(HOP, /CAU_DON_DA_CO_VET_BAC/), "một chỗ in câu").toBeGreaterThanOrEqual(1);
  });
});
