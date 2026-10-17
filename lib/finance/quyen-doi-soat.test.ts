// Ca [QDS-*] — AI ĐƯỢC LÀM GÌ ở màn đối soát `/admin/bien-dong-so-du` (PHIÊN B).
//
// ─────────────────────────────────────────────────────────────────────────────
// Chủ dự án chốt 17/09/2026, phương án 1:
//   · Gắn giao dịch + chia theo con + "Tạo đợt cho con…"  → `payments:record`  (SALE làm được)
//   · BỎ QUA (IGNORED) và GỠ GẮN                          → `payments:manage`  (CHỈ kế toán)
//   · Danh sách UNMATCHED: ai có `payments:record` đều thấy TOÀN BỘ
//   · Nhưng chỉ GẮN được vào đơn TRONG phạm vi `scopedDb` của mình
//
// ⚠️ VÌ SAO KHÔNG PHẢI TEST HÀNH VI. Ba khẳng định ở đây là về DÂY NỐI: "vai X có quyền Y
// không" (dữ liệu trong seed) và "action Z gác bằng quyền nào" (hình dạng mã). Một test hành
// vi thật phải dựng `auth()` giả + session + RoleDef trong DB cho từng vai — mà khi đó nó kiểm
// `checkPermission`, thứ đã có test riêng, chứ không kiểm điều đang cần: rằng ĐÚNG cổng ấy
// được cắm vào ĐÚNG action ấy. Theo luật 11: neo chuỗi hẹp nhất, ĐẾM số lần khớp, bóc chú
// thích, và đã cấy thử.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function doc(duong: string): string {
  return readFileSync(resolve(process.cwd(), duong), "utf8");
}

/**
 * Bóc chú thích để lưới không khớp nhầm vào chính câu giải thích bản vá.
 *
 * ⚠️ THỨ TỰ CÓ LÝ DO, và tôi đã trả giá để biết: bóc khối trước thì `prisma/seed-roles.ts`
 * mất nửa tệp. Ở dòng 386 có một chú thích DÒNG chứa đường dẫn `lop-trial` kèm hai dấu sao —
 * hai ký tự đó mở một khối giả, và phép bóc khối nuốt tuốt tới dấu đóng thật cách mấy trăm
 * dòng. Hệ quả: `code: "CENTER_ACCOUNTANT"` biến mất và lưới báo "không thấy vai" — một lưới
 * ĐỎ vì lý do hoàn toàn bịa.
 *
 * Bóc chú thích DÒNG trước là hết: dòng ấy biến mất cả câu, kể cả cái mở khối giả.
 */
function docMa(duong: string): string {
  return doc(duong)
    .split(/\r?\n/)
    .map((d) => d.replace(/\/\/[^\n]*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Thân của một hàm, cắt từ chỗ khai báo tới `export` kế tiếp.
 *
 * KHÔNG cắt tới dấu `}` đầu tiên ở đầu dòng: dấu đó thường là của một khối `if` bên trong,
 * nên thân bị cụt và mọi khẳng định sau đó xanh/đỏ hú hoạ.
 */
function than(src: string, ten: string): string {
  const dau = src.indexOf(`function ${ten}(`);
  if (dau === -1) return "";
  const sau = src.indexOf("\nexport ", dau + 1);
  return src.slice(dau, sau === -1 ? undefined : sau);
}

/** Các `action` mà một vai được cấp trong `prisma/seed-roles.ts`. */
function quyenCuaVai(ma: string): string[] {
  const src = docMa("prisma/seed-roles.ts");
  const dau = src.indexOf(`code: "${ma}"`);
  expect(dau, `không thấy vai ${ma} trong seed-roles.ts`).toBeGreaterThan(-1);
  const sau = src.indexOf('code: "', dau + 10);
  const khoi = src.slice(dau, sau === -1 ? undefined : sau);
  return [...khoi.matchAll(/\{\s*action:\s*"([^"]+)"/g)].map((m) => m[1]!);
}

describe("[QDS-01] seed quyền — sale ghi nhận được, nhưng KHÔNG quyết định kế toán", () => {
  it("CENTER_SALES_CSM CÓ `payments:record` và KHÔNG có `payments:manage`", () => {
    const q = quyenCuaVai("CENTER_SALES_CSM");
    // Vế 1 là thứ làm cho phương án 1 chạy được: sale gắn tiền bằng quyền đã có sẵn.
    expect(q).toContain("payments:record");
    // Vế 2 là thứ làm cho ca "sale bấm IGNORED → từ chối" thành đúng: sale không có quyền
    // này, nên cổng ở server chặn, và nút cũng không được vẽ ra.
    expect(q).not.toContain("payments:manage");
  });

  it("`payments:manage` CHỈ thuộc hai vai kế toán — không vai nào khác", () => {
    const vai = [
      "SUPER_ADMIN",
      "HO_ACCOUNTANT",
      "CENTER_ACCOUNTANT",
      "CENTER_MANAGER",
      "CENTER_SALES_CSM",
    ];
    const co = vai.filter((v) => quyenCuaVai(v).includes("payments:manage"));
    // SUPER_ADMIN không cần khai — `can()` v2 trả true cho nó ở tầng mã (lib/auth/can.ts).
    expect(co).toEqual(["HO_ACCOUNTANT", "CENTER_ACCOUNTANT"]);
  });
});

describe("[QDS-02] cổng gắn vào cổng — đúng quyền cắm vào đúng action", () => {
  it("BỎ QUA và GỠ GẮN gác bằng `payments:manage`", () => {
    const act = docMa("app/(admin)/admin/bien-dong-so-du/_actions.ts");
    // `gateKeToan` là hàm ĐẦY ĐỦ (không uỷ quyền tiếp) — xem chú thích trong tệp: luật lint
    // TS-03 chỉ nhận ra `checkPermission` ở wrapper cục bộ ĐÚNG MỘT CẤP.
    expect(act).toMatch(/async function gateKeToan\(\)[\s\S]{0,200}?checkPermission\("payments:manage"\)/);
    expect(act).toMatch(/export async function boQuaGiaoDich\([\s\S]{0,400}?await gateKeToan\(\)/);

    const gan = docMa("app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts");
    expect(gan).toMatch(
      /export async function goGanGiaoDichAction\([\s\S]{0,500}?checkPermission\("payments:manage"\)/,
    );
  });

  it("GẮN · TẠO ĐỢT TẠI CHỖ · NẠP CHI TIẾT đều đi qua `congGanVaoDon`", () => {
    const gan = docMa("app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts");
    // Ba action + đúng một định nghĩa = 4 lần xuất hiện. Thêm một action thứ tư quên gọi cổng
    // thì số này lệch và ca đỏ.
    expect(gan.match(/congGanVaoDon\(/g) ?? []).toHaveLength(4);
    for (const ten of [
      "taiChiTietDonDeGan",
      "ganGiaoDichTheoConAction",
      "taoDotChoConTaiChoAction",
    ]) {
      expect(gan, ten).toMatch(
        new RegExp(`export async function ${ten}\\([\\s\\S]{0,400}?await congGanVaoDon\\(`),
      );
    }
    expect(gan).toMatch(/async function congGanVaoDon\([\s\S]{0,300}?checkPermission\("payments:record"\)/);
  });

  it("`congGanVaoDon` ép CÁCH LY CƠ SỞ bằng CẢ HAI lớp", () => {
    const gan = docMa("app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts");
    const khoi = than(gan, "congGanVaoDon");
    expect(khoi).not.toBe("");
    // Lớp 1: câu tra đi qua `scopedDb` (đọc đã bị lọc theo cơ sở).
    expect(khoi).toMatch(/scopedDb\(actor\)\.order\.findUnique/);
    // Lớp 2: `passesScope` đọc thẳng `centerId` của bản ghi. `scopedDb` KHÔNG che write, nên
    // bỏ lớp này là một thay đổi ở `SCOPED_MODELS` biến thành lỗ IDOR im lặng.
    expect(khoi).toMatch(/passesScope\("Order", order, actor\)/);
    // Và sale CS1 gửi id đơn CS2 phải nhận đúng câu như khi đơn không tồn tại — biết đơn có
    // thật ở cơ sở khác đã là một mẩu thông tin không nên rò.
    expect(khoi).toContain("Không tìm thấy đơn hàng");
  });

  it("GỠ GẮN không nhận `orderId` từ client", () => {
    const gan = docMa("app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts");
    const khoi = than(gan, "goGanGiaoDichAction");
    expect(khoi).not.toBe("");
    // Tham số chỉ có hai trường; `orderId` suy ra từ chính phân bổ của giao dịch. Nhận từ
    // client là mở đường cho "gỡ giao dịch A nhưng khai đơn B" — khoá giữ đơn B trong khi tay
    // đụng đơn A, tức chạy NGOÀI khoá mà trông như có khoá.
    expect(khoi).toMatch(/input:\s*\{\s*bankTransactionId: string;\s*lyDo: string;\s*\}/);
    expect(khoi).toMatch(/paymentAllocation\.findFirst/);
  });
});

describe("[QDS-04] webhook đơn MỘT con — gắn `orderItemId`, đơn nhiều con thì KHÔNG đoán", () => {
  it("dùng `take: 2` và chỉ nhận khi ĐÚNG một dòng", () => {
    // ⚠️ Thêm sau một lượt cấy LỌT: đổi `take: 2` thành `take: 1` là biến MỌI đơn thành "đơn
    // một con" ⇒ tiền của đơn nhiều con bị gắn bừa vào dòng đầu bảng. Không ca nào đỏ, và
    // trên màn hình nó trông ĐÚNG HƠN trước (bé nào cũng có tên).
    const ing = docMa("lib/payments/payos-ingest.ts");
    expect(ing).toMatch(
      /const dongCuaDon = await tx\.orderItem\.findMany\(\{\s*where: \{ orderId: order\.id \},\s*select: \{ id: true \},\s*take: 2,/,
    );
    expect(ing).toMatch(
      /const dongDuyNhat = dongCuaDon\.length === 1 \? \(dongCuaDon\[0\]\?\.id \?\? null\) : null;/,
    );
    expect(ing).toMatch(/orderItemId: dongDuyNhat,/);
  });
});

describe("[QDS-03] khoá theo đơn — MỘT công thức, dùng chung với đường webhook", () => {
  it("chỉ `khoaDonTrongTx` đánh vần chuỗi khoá cho đơn hàng", () => {
    const ghi = docMa("lib/finance/ghi-tien-don.ts");
    expect(ghi).toMatch(
      /await tx\.\$executeRaw`SELECT pg_advisory_xact_lock\(hashtext\(\$\{orderId\}\)::bigint\)`/,
    );
    // `$executeRaw`, KHÔNG `$queryRaw`: `pg_advisory_xact_lock()` trả `void` và Prisma ném
    // "Failed to deserialize column of type 'void'" (bug PR #76).
    expect(ghi).not.toMatch(/\$queryRaw`SELECT pg_advisory_xact_lock/);
    // Và mọi phép ghi tiền của tệp này đi qua `ghiTienChoDon`, tức luôn nằm dưới khoá.
    //
    // **8** lời gọi. Khai báo là `ghiTienChoDon<T>(` nên không đếm.
    //   1. `taoDotChoCon`          — tạo đợt cho một bé
    //   2. `huyDotChoCon`          — huỷ đợt chưa có tiền
    //   3. `ganTienTheoCon`        — gắn một GIAO DỊCH ngân hàng, chia theo đợt
    //   4. `ganKhoanDaThuChoCon`   — đường B: gắn một KHOẢN đã thu cho một bé  [18/09/2026]
    //   5. `boGanKhoanKhoiCon`     — đường B: bỏ gắn                            [18/09/2026]
    //   6. `goGanTheoCon`          — gỡ gắn giao dịch, sinh bút toán đảo
    //   7. `tachKhoanChoCon`       — đường B: TÁCH một khoản cho n bé          [20/09/2026]
    //   8. `chuyenTienGiuaCon`     — chuyển tiền giữa hai bé CÙNG ĐƠN         [22/09/2026]
    //
    // ⚠️ Con số này ĐẾM CÓ CHỦ ĐÍCH, đừng đổi thành `toBeGreaterThan`. Nó bắt đúng một thứ:
    // ai đó thêm một đường ghi tiền mới mà **quên bọc khoá** thì tổng không tăng, và ca này
    // đỏ. Nới thành "≥" là gỡ luôn khả năng ấy. Thêm hàm mới thì SỬA SỐ và thêm một dòng vào
    // danh sách trên — vài giây, và nó buộc người thêm phải đọc lại vì sao có khoá.
    expect(ghi.match(/ghiTienChoDon\(/g) ?? []).toHaveLength(8);
  });

  it("đường webhook dùng ĐÚNG công thức khoá ấy — hai đường phải giẫm lên nhau được", () => {
    // ⚠️ Nếu hai nơi khoá hai chuỗi khác nhau thì webhook và màn gắn tay chạy song song vẫn
    // giẫm lên nhau, trong khi đọc mã chỗ nào cũng thấy "có khoá". Không có gì báo động.
    const ing = docMa("lib/payments/payos-ingest.ts");
    expect(ing).toMatch(
      /pg_advisory_xact_lock\(hashtext\(\$\{order\.id\}\)::bigint\)/,
    );
  });

  it("`noTheoCon` (đọc hiển thị) và `docSoTheoCon` (đọc trong khoá) là HAI cửa khác nhau", () => {
    const debt = docMa("lib/finance/debt.ts");
    // Bản đọc-hiển-thị chỉ uỷ quyền, và uỷ quyền với `db` TRẦN — "ai mở đơn cũng ra cùng số".
    expect(debt).toMatch(/export async function noTheoCon\(orderId: string\): Promise<NoTheoConKetQua> \{\s*return docSoTheoCon\(db, orderId\);/);
    // Bản thân hàm thật KHÔNG có mặc định `= db` (luật 7): mặc định ở đó nghĩa là "đọc ngoài
    // khoá", đúng cái sai mà PHIÊN B sinh ra để sửa.
    expect(debt).toMatch(/export async function docSoTheoCon\(\s*doc: DocSoTheoCon,/);
    expect(debt).not.toMatch(/doc: DocSoTheoCon = db/);
    // Và đường ghi đọc bằng `tx`, không bằng `db`.
    const ghi = docMa("lib/finance/ghi-tien-don.ts");
    expect(ghi).toMatch(/const so = await docSoTheoCon\(tx, orderId\);/);
    expect(ghi).not.toMatch(/noTheoCon\(/);
  });
});

describe("[QDS-05] CÔNG TẮC THEO CƠ SỞ — cờ tắt thì prod y như TRƯỚC merge", () => {
  // Chủ dự án chốt 17/09: *"Màn gắn kiểu mới + quyền sale phải SAU CỜ theo cơ sở của đơn. Cờ
  // tắt → màn và quyền y như trước merge (chỉ payments:manage)."*
  //
  // ⚠️ Ba khẳng định dưới đây là về DÂY NỐI (cổng nào đọc cờ nào, nhánh nào còn sống), nên
  // chúng là lưới ghim mã nguồn. Phần HÀNH VI của phép giải cờ đã có test thuần riêng ở
  // `lib/finance/feature.test.ts` — ca này không dựng lại phép giải đó.

  it("cổng gắn đọc cờ theo `orgUnitId` của ĐƠN, không theo người bấm", () => {
    const gan = docMa("app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts");
    const khoi = than(gan, "congGanVaoDon");
    expect(khoi).not.toBe("");
    // Cờ của CƠ SỞ GIỮ ĐƠN. Đọc theo người bấm là pilot một cơ sở hoá ra bật cho mọi đơn mà
    // người của cơ sở đó chạm vào.
    expect(khoi).toMatch(/const kieuMoi = await laThuTienLinhHoatBat\(order\.orgUnitId\);/);
    // Và cờ TẮT thì phải đòi `payments:manage` — tức đúng quyền trước merge.
    expect(khoi).toMatch(/if \(!kieuMoi && !coManage\) \{/);
    // Hỏi CẢ HAI quyền, vì vế nào cần thì phụ thuộc vào cờ mà cờ thì chưa biết lúc mở cửa.
    expect(khoi).toMatch(/checkPermission\("payments:record"\)/);
    expect(khoi).toMatch(/checkPermission\("payments:manage"\)/);
  });

  it("đường gắn CŨ (rót toàn đơn) vẫn còn sống và vẫn gác `payments:manage`", () => {
    // ⚠️ PHIÊN B đã XOÁ hàm này. Xoá là merge vào `main` đổi hành vi prod NGAY trong khi công
    // tắc vẫn tắt — đúng thứ công tắc sinh ra để tránh. Nay nó là nhánh CỜ-TẮT.
    const act = docMa("app/(admin)/admin/bien-dong-so-du/_actions.ts");
    expect(act).toMatch(
      /export async function ganGiaoDichVaoDon\([\s\S]{0,300}?await gateKeToan\(\)/,
    );
    // Nó phải đi qua `allocateToOrder` — tức CÙNG đường ghi mà webhook dùng, kèm đủ
    // side-effect sau commit. Viết lại waterfall ở đây là bản thứ hai của phép rót tiền.
    expect(act).toMatch(/await allocateToOrder\(\{/);
  });

  it("màn hình VẼ NÚT theo cờ: không nơi nào bật ⇒ `canGan` rơi về đúng `canManage`", () => {
    const page = docMa("app/(admin)/admin/bien-dong-so-du/page.tsx");
    // Affordance phải nói thật (luật 12): sale không được thấy nút nếu chẳng cơ sở nào bật.
    expect(page).toMatch(
      /const canGan = canManagePayments \|\| \(canRecordPayments && coNoiBatCo\);/,
    );
    expect(page).toMatch(
      /const coNoiBatCo = await coNoiNaoBatThuLinhHoat\(actor\.visibleOrgUnitIds\);/,
    );
    // Và màn phải BIẾT đơn đang ở luồng nào để vẽ đúng khối.
    const gan = docMa("app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts");
    expect(gan).toMatch(/kieuMoi: cong\.kieuMoi,/);
    const man = docMa("app/(admin)/admin/bien-dong-so-du/_components/xu-ly-giao-dich.tsx");
    expect(man).toMatch(/if \(chiTiet && !chiTiet\.kieuMoi\) \{/);
    expect(man).toMatch(/ganGiaoDichVaoDon\(bankTransactionId, chiTiet\.orderId\)/);
  });

  it("`coNoiNaoBatThuLinhHoat` KHÔNG ngắt sớm bằng công tắc toàn hệ", () => {
    // Ca "toàn hệ BẬT + cơ sở này TẮT" có thật (chốt 16/09: *gỡ một cơ sở ra khi nó gặp sự
    // cố*). Ngắt sớm ở công tắc toàn hệ sẽ vẽ nút cho người của đúng cơ sở vừa bị gỡ.
    const src = docMa("lib/finance/feature.ts");
    const khoi = than(src, "coNoiNaoBatThuLinhHoat");
    expect(khoi).not.toBe("");
    // Chỉ đọc toàn hệ khi KHÔNG có cơ sở nào để hỏi.
    expect(khoi).toMatch(/if \(orgUnitIds\.length === 0\) return laThuTienLinhHoatBat\(null\);/);
    expect(khoi).toMatch(/for \(const id of orgUnitIds\)/);
  });

  it("đợt `orderItemId = NULL` PHẢI vào được danh sách chia — đơn cũ không bị bỏ rơi", () => {
    // ⚠️ Bản đầu lọc `dungDotDeChia(so.con)` để tìm đợt NULL, mà hàm đó chỉ đi qua `con[]` nên
    // danh sách LUÔN RỖNG: mọi đơn trước 16/09 hiện 0 đợt để chia. Một chú thích ĐÚNG Ý mà
    // SAI MÃ — nó nói "tra riêng" trong khi thực ra lọc lại đúng danh sách vừa dựng.
    const gan = docMa("app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts");
    expect(gan).toMatch(/dotChungChuaChiaCon: so\.dotChuaGanCon\.map\(/);
    expect(gan).not.toMatch(/dungDotDeChia\(so\.con\)/);

    const ghi = docMa("lib/finance/ghi-tien-don.ts");
    // Đường GHI cũng phải nhận cả hai nguồn, nếu không màn hiện đợt mà cổng từ chối nó.
    expect(ghi).toMatch(/const dotDeChia = dungDotDeChia\(so\);/);
    // Và đơn MỘT con thì nâng đợt NULL lên đúng bé đó.
    expect(ghi).toMatch(/const conDuyNhat = dongCuaDon\.length === 1 \?/);
    expect(ghi).toMatch(/conSuyRa\.set\(d\.paymentRequestId, conDuyNhat\);/);
  });

  it("gỡ gắn chụp ĐỦ cột trước khi xoá, và ghi id bút toán đảo", () => {
    const ghi = docMa("lib/finance/ghi-tien-don.ts");
    const khoi = than(ghi, "goGanTheoCon");
    expect(khoi).not.toBe("");
    // Hai cột KHÔNG suy ra được từ phần còn lại sau khi phân bổ bị xoá.
    expect(khoi).toMatch(/createdAt: true,/);
    expect(khoi).toMatch(/orderItemId: true,/);
    // Người gắn chỉ còn trong nhật ký lượt gắn — phải tra ngược để ảnh chụp tự đủ.
    expect(khoi).toMatch(/action: "TXN_CHIA_THEO_CON"/);
    expect(khoi).toMatch(/nguoiGan: vetGan/);
    expect(khoi).toMatch(/idButToanDao,/);
    expect(khoi).toMatch(/trangThaiDotSauGo:/);
    // Cùng MỘT transaction: `writeAudit` phải nhận `tx`, kẻo nhật ký sống sót một lượt
    // rollback và kể một chuyện chưa từng xảy ra.
    expect(khoi).toMatch(/await writeAudit\(\{\s*tx,/);
  });
});

describe("[QDB-*] ĐƯỜNG B — gắn khoản đã thu vào con, trên màn ĐƠN", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Chủ dự án chốt 18/09/2026: *"payments:record để gắn, payments:manage để bỏ gắn."*
  // Và: *"Sau cờ (billing.flexV1Enabled), cờ tắt thì nút không hiện."*
  //
  // ⚠️ VÌ SAO LÀ LƯỚI MÃ NGUỒN CHỨ KHÔNG PHẢI TEST HÀNH VI — cùng lý do với `[QDS-*]` ở trên:
  // cổng thật nằm trong Server Action và nó gọi `auth()` + `checkPermission()`. Dựng hành vi
  // cho nó phải giả `auth()`, dựng session, dựng `RoleDef` trong DB cho từng vai — và khi đó
  // ca test kiểm `checkPermission`, thứ đã có test riêng, chứ KHÔNG kiểm điều đang cần: rằng
  // ĐÚNG cổng ấy được cắm vào ĐÚNG action ấy.
  //
  // Phần HÀNH VI của đường B (gắn / bỏ gắn / chặn chéo đơn / chỉ đụng một cột) nằm ở
  // `tests/finance/gan-khoan-cho-con.test.ts`, chạy trên Postgres thật.
  // ─────────────────────────────────────────────────────────────────────────────
  const ACT = "app/(admin)/admin/orders/_actions.ts";

  it("gắn đòi `payments:record`, bỏ gắn đòi `payments:manage` — KHÔNG dùng lại `orders:manage`", () => {
    const src = docMa(ACT);
    const gan = than(src, "ganKhoanChoConAction");
    const bo = than(src, "boGanKhoanChoConAction");
    expect(gan, "không tách được thân action gắn").not.toBe("");
    expect(bo, "không tách được thân action bỏ gắn").not.toBe("");

    expect(gan).toMatch(/congDuongB\(input\.orderId, "payments:record"\)/);
    expect(bo).toMatch(/congDuongB\(input\.orderId, "payments:manage"\)/);

    // ⚠️ `requireOrdersManage()` gác bằng `orders:manage` VÀ `redirect()` khi thiếu quyền.
    // Đường B cố ý không dùng nó: gắn một khoản ĐÃ THU cho đúng bé là việc thường ngày của
    // sale, và đá người dùng sang /dashboard giữa lúc đang gắn tiền là mất luôn thao tác dở.
    expect(gan).not.toMatch(/requireOrdersManage/);
    expect(bo).not.toMatch(/requireOrdersManage/);
  });

  it("cổng chung kiểm ĐỦ BA VẾ: quyền · phạm vi cơ sở · công tắc CỦA ĐƠN", () => {
    const cong = than(docMa(ACT), "congDuongB");
    expect(cong, "không tách được thân cổng").not.toBe("");

    expect(cong, "vế 1 — quyền").toMatch(/await checkPermission\(quyen\)/);
    expect(cong, "vế 2 — phạm vi cơ sở").toMatch(/passesScope\("Order", order, actor\)/);
    // ⚠️ Vế 3 đọc theo `order.orgUnitId` — cơ sở GIỮ ĐƠN, KHÔNG phải cơ sở người bấm. Đọc
    // theo người bấm là pilot một cơ sở hoá ra bật cho mọi đơn mà người đó chạm vào.
    expect(cong, "vế 3 — công tắc của ĐƠN").toMatch(
      /laThuTienLinhHoatBat\(order\.orgUnitId\)/,
    );
  });

  it("cờ TẮT ⇒ action TỪ CHỐI (không chỉ ẩn nút)", () => {
    const cong = than(docMa(ACT), "congDuongB");
    // Phải có nhánh phủ định của cờ và nó trả về lỗi — ẩn nút không phải là kiểm quyền.
    expect(cong).toMatch(/if \(!\(await laThuTienLinhHoatBat\(order\.orgUnitId\)\)\)/);
    expect(cong).toMatch(/chưa bật cho cơ sở này/);
  });

  it("màn đơn truyền HAI cờ quyền riêng, không tái dùng `canManage`", () => {
    const page = docMa("app/(admin)/admin/orders/[id]/page.tsx");
    // ⚠️ 24/09/2026 — khoá LUẬT ("hỏi riêng hai quyền này"), không khoá chỗ đặt chữ `await`.
    // Bản đầu ghim `const canRecordPayments = await checkPermission(...)` nên nó ĐỎ khi bốn
    // câu hỏi quyền được gom vào một `Promise.all` — một thay đổi không đụng gì tới luật.
    // Đếm SỐ LẦN để "hỏi riêng" không bị thay bằng một hàm gộp đoán scope chung.
    expect(page.match(/checkPermission\("payments:record"\)/g)?.length ?? 0).toBe(1);
    expect(page.match(/checkPermission\("payments:manage"\)/g)?.length ?? 0).toBe(1);
    expect(page).toMatch(/canRecordPayments/);
    expect(page).toMatch(/canManagePayments/);
    expect(page).toMatch(/duocGan=\{canRecordPayments\}/);
    expect(page).toMatch(/duocBoGan=\{canManagePayments\}/);
    // `duocSua` (tạo/huỷ đợt) VẪN là `canManage` — ba quyền, ba việc.
    expect(page).toMatch(/duocSua=\{canManage\}/);
  });

  it("khối khoản chờ gắn lọc từ tập RỘNG + bỏ bút toán đảo và dòng đã đảo", () => {
    // ⚠️ Hai con bug, hai thời điểm, cùng một dòng mã:
    //
    //   18/09 — gác bằng `so.chuaGanCon > 0` (trục A) ⇒ với 4 khoản `PENDING` của
    //           `ORD-260917-000001` nó ra 0 và cả khối BIẾN MẤT: tiền có thật, màn hình câm.
    //
    //   20/09 — phép TÁCH để lại dòng gốc + một bút toán đảo, CẢ HAI `orderItemId = NULL`.
    //           Không lọc thêm thì khối liệt kê `+9.530.000` và `−9.530.000`, mỗi dòng một
    //           nút "Gắn cho bé…" — tổng in ra đúng (0đ) mà bấm vào đâu cũng sai.
    const ui = docMa("app/(admin)/admin/orders/_components/cong-no-theo-con.tsx");
    expect(ui).toMatch(
      /\(k\) => k\.orderItemId == null && k\.loaiButToan === "PAYMENT" && !k\.daDao,/,
    );
    expect(ui, "không được quay lại gác bằng `so.chuaGanCon > 0`").not.toMatch(
      /so\.chuaGanCon > 0 &&/,
    );
    // Và nút "Bỏ gắn bé" cũng không được mời trên một bút toán ĐẢO: bỏ gắn nó là đưa một
    // dòng đối ứng ra khỏi bé trong khi dòng nó đối ứng vẫn ở đó.
    expect(ui).toMatch(/duocBoGan && k\.loaiButToan === "PAYMENT" && dangMo !== k\.id/);
  });

  it("giới hạn của TỪNG NÚT được NÓI RA trên màn — [ĐẢO LUẬT 20/09/2026]", () => {
    // ⚠️ CA NÀY TỪNG KHẲNG ĐỊNH ĐIỀU NGƯỢC LẠI. Bản 18/09 đòi màn hình có chữ
    // *"chưa hỗ trợ"* — giới hạn "không tách được một khoản cho hai bé". Giới hạn ấy **đã
    // được gỡ**: `tachKhoanChoCon` (mục 6 của `ghi-tien-don.ts`) làm đúng việc đó.
    //
    // Giữ chữ "chưa hỗ trợ" lại sẽ là ca nguy hiểm nhất mà CLAUDE.md mô tả: một lời dặn CẤM
    // SỬA cho một luật đã chết. Nên nay ca này canh HAI giới hạn CÒN SỐNG:
    //   · một lần bấm "Gắn" cho đúng MỘT bé (muốn chia thì có nút khác);
    //   · tách rồi KHÔNG gộp lại được — người dùng phải biết trước khi bấm, không phải sau.
    const ui = docMa("app/(admin)/admin/orders/_components/cong-no-theo-con.tsx");
    expect(ui).toMatch(/đúng một bé/);
    expect(ui).toMatch(/không gộp lại được/);
    expect(ui, "câu 'chưa hỗ trợ' nay là lời dặn cho một luật đã chết").not.toMatch(
      /chưa hỗ trợ/,
    );
  });

  it("[QDB-08] TÁCH: cùng quyền với GẮN, và nó là lựa chọn CÓ Ý THỨC", () => {
    // `payments:record`, KHÔNG phải `payments:manage` — lý do đầy đủ ở đầu
    // `tachKhoanChoConAction`. Ca này ghim để lần đổi sau phải là một lần đổi CÓ CHỦ ĐÍCH,
    // không phải một lần sao chép nhầm dòng trên.
    const tach = than(docMa(ACT), "tachKhoanChoConAction");
    expect(tach).toMatch(/congDuongB\(input\.orderId, "payments:record"\)/);
    // Và nó KHÔNG đi qua `requireOrdersManage` (hàm đó `redirect()` — mất ngữ cảnh đang nhập).
    expect(tach).not.toMatch(/requireOrdersManage/);
  });

  it("[QDB-09] TÁCH: mọi cổng đứng TRƯỚC phép ghi đầu tiên", () => {
    // Luật rollback (CLAUDE.md mục 7): trong callback `$transaction`, `return` KHÔNG rollback.
    // Ca này đo bằng VỊ TRÍ: chỉ số của phép `create` đầu tiên phải LỚN HƠN chỉ số của câu
    // từ chối cuối cùng.
    const than6 = than(docMa("lib/finance/ghi-tien-don.ts"), "tachKhoanChoCon");
    const ghiDau = than6.indexOf("tx.payment.create");
    const tuChoiCuoi = than6.lastIndexOf("return { ok: false as const, error:");
    expect(ghiDau, "phải tìm thấy phép ghi").toBeGreaterThan(0);
    expect(tuChoiCuoi, "phải tìm thấy câu từ chối").toBeGreaterThan(0);
    expect(tuChoiCuoi, "cổng cuối cùng phải đứng TRƯỚC phép ghi đầu tiên").toBeLessThan(ghiDau);
  });

  it("[QDB-10] TÁCH: các phần CHÉP `note` của gốc — dây nối sang sổ ngân hàng", () => {
    // ⚠️ `Payment` KHÔNG có cột `bankTransactionId`. Dây duy nhất là MARKER trong `note`
    // (`[gan-tay:…]` / `[auto:…]`), và `goGanTheoCon` tìm dòng gốc bằng chính marker ấy.
    // Không chép `note` ⇒ gỡ gắn xoá `PaymentAllocation` mà không đảo phần nào ⇒ giao dịch
    // về hàng chờ trong khi công nợ vẫn báo đã đóng. Hành vi được phủ ở `[TKD-09]`; ca này
    // canh chính dòng mã, vì một lần "dọn dẹp" note là đủ để mở lại lỗ đó mà test hành vi
    // của người khác không chạm tới.
    const than6 = than(docMa("lib/finance/ghi-tien-don.ts"), "tachKhoanChoCon");
    expect(than6).toMatch(/note: `\$\{khoan\.note \?\? ""\} \$\{marker\}`\.trim\(\),/);
  });
});

describe("[QPG] PHIÊN C — phiếu gộp: quyền, thứ tự móc, và hai luật không được gỡ", () => {
  // `ACT` của khối trên nằm trong phạm vi của khối đó — khai lại ở đây thay vì nâng lên biến
  // toàn tệp, để hai khối đọc được độc lập.
  const ACT = "app/(admin)/admin/orders/_actions.ts";

  it("[QPG-01] quyền HAI MỨC, và ranh giới là 'phiếu đã nhận tiền chưa'", () => {
    // Phát/huỷ phiếu chưa nhận đồng nào KHÔNG đổi một đồng nào trong sổ ⇒ việc của sale.
    // ĐÓNG phiếu đã nhận một phần là phán quyết về tiền đã vào ⇒ việc của kế toán.
    const act = docMa(ACT);
    expect(than(act, "taoPhieuGopAction")).toMatch(
      /congDuongB\(input\.orderId, "payments:record"\)/,
    );
    expect(than(act, "huyPhieuGopAction")).toMatch(
      /congDuongB\(input\.orderId, "payments:record"\)/,
    );
    expect(than(act, "dongPhieuGopAction")).toMatch(
      /congDuongB\(input\.orderId, "payments:manage"\)/,
    );
  });

  it("[QPG-02] MÓC đặt TRƯỚC mọi phép suy đoán của đường cũ", () => {
    // ⚠️ Đây là thứ phiên C thật sự thêm vào, và nó là thứ dễ bị đẩy xuống dưới nhất khi ai
    // đó "dọn lại luồng". Mã 5 ký tự nói THẲNG phiếu nào; đặt nó sau `resolvePaymentTargetDetailed`
    // là cho một phép đoán theo SĐT cơ hội cướp một giao dịch đã biết đích.
    //
    // Đo bằng VỊ TRÍ, không bằng sự có mặt: có mặt mà đứng sau thì vô dụng y như không có.
    // ⚠️ Phải cắt THÂN `ingestPayosWebhook` trước. Tìm trên cả tệp thì
    // `resolvePaymentTargetDetailed` khớp trúng lời gọi trong `resolvePaymentTarget` — một
    // hàm ĐỨNG TRƯỚC trong tệp — và ca này đỏ vì lý do chẳng liên quan. (Đã mắc, 20/09.)
    const than1 = than(docMa("lib/payments/payos-ingest.ts"), "ingestPayosWebhook");
    const moc = than1.indexOf("await thuTheoPhieuGop(");
    const cu = than1.indexOf("await resolvePaymentTargetDetailed(");
    expect(moc, "phải có lời gọi `thuTheoPhieuGop`").toBeGreaterThan(0);
    expect(cu, "phải có lời gọi đường cũ").toBeGreaterThan(0);
    expect(moc, "móc phiếu gộp phải đứng TRƯỚC đường cũ").toBeLessThan(cu);
  });

  it("[QPG-03] `thuTheoPhieuGop` KHÔNG hỏi cờ — mã đã phát là mã bất biến", () => {
    // ⚠️ Hỏi cờ ở đây nghĩa là tắt cờ = mọi tờ QR ĐÃ phát hoá giấy lộn, và tiền về rơi xuống
    // UNMATCHED hàng loạt. Cờ chỉ được gác ở đường PHÁT HÀNH (action) và ở `memoPhatHanh`.
    const pg = docMa("lib/finance/phieu-gop.ts");
    expect(pg, "đường NHẬN tiền không được hỏi công tắc").not.toMatch(/laThuTienLinhHoatBat/);
    // Còn đường PHÁT thì có — qua `congDuongB`, đã phủ ở `[QPG-01]`.
  });

  it("[QPG-04] NHƯỜNG khi không tra ra phiếu — không tự nuốt giao dịch đời cũ", () => {
    // Checksum lọc 26/27 khối rác chứ không lọc hết: một memo ĐỜI CŨ vẫn có ~1/27 cơ hội chứa
    // khối 5 ký tự qua checksum. Nuốt ca đó là đẩy ~1/27 giao dịch đời cũ xuống UNMATCHED
    // không lý do — triệu chứng sẽ trông như "SePay thỉnh thoảng lỗi".
    //
    // Hành vi đã phủ ở `[PG-09]` (DB thật). Ca này canh chính hai dòng mã, vì một lượt "dọn
    // dẹp" đổi `return { xuLy: false }` thành một nhánh UNMATCHED là đủ mở lại lỗ đó mà không
    // test hành vi nào của người khác chạm tới.
    const than3 = than(docMa("lib/finance/phieu-gop.ts"), "thuTheoPhieuGop");
    expect(than3).toMatch(/if \(memo\.ungVien\.length === 0\) return \{ xuLy: false \};/);
    expect(than3).toMatch(/if \(!so\) return \{ xuLy: false \};/);
  });

  it("[QPG-05] KHÔNG ghi phần THA vào phân bổ của phiếu gộp", () => {
    // ⚠️ PHẠM VI HẸP, nói thẳng để không ai tin quá: ca này canh ĐÚNG HAI hình dạng —
    // `roundingWaived: 0` còn nguyên, và đường này không đọc cấu hình dung sai. Nó **KHÔNG**
    // canh được mọi cách thêm dung sai: cấy thử 20/09 bằng một phép kẹp `lech <= 5_000` viết
    // thẳng số vào mã thì ca này VẪN XANH.
    //
    // Thứ bắt được lượt cấy ấy là HÀNH VI: `[PG-03]` (thừa 1đ) và `[PG-04]` (thiếu 1đ) trong
    // `tests/finance/phieu-gop.test.ts`. Luật 11 — ưu tiên khẳng định hành vi; lưới văn bản
    // chỉ là lớp thứ hai, và phải tự khai nó chặn được cái gì.
    const than3 = than(docMa("lib/finance/phieu-gop.ts"), "thuTheoPhieuGop");
    expect(than3).toMatch(/roundingWaived: 0,/);
    expect(than3, "không được đọc cấu hình dung sai ở đường này").not.toMatch(
      /roundingToleranceVnd/,
    );
  });

  it("[QPG-06] `Payment` của phiếu gộp mang MARKER — dây duy nhất để gỡ gắn tìm lại", () => {
    // `Payment` KHÔNG có cột `bankTransactionId`; marker trong `note` là dây duy nhất, và
    // `goGanTheoCon` tìm dòng gốc bằng chính nó. Mất marker ⇒ gỡ gắn xoá phân bổ mà không đảo
    // dòng nào ⇒ giao dịch về hàng chờ trong khi công nợ vẫn báo đã đóng.
    const than3 = than(docMa("lib/finance/phieu-gop.ts"), "thuTheoPhieuGop");
    expect(than3).toMatch(/\[auto:\$\{input\.provider\.toLowerCase\(\)\}:\$\{input\.providerTxnId\}\]/);
    expect(than3, "và `note` của từng dòng phải CHỞ marker ấy").toMatch(/\$\{marker\}`,/);
  });

  it("[QPG-07] màn đơn: QR nhận bản ĐẦY ĐỦ, phần hiển thị mới che", () => {
    // Nhúng chuỗi ĐÃ CHE vào ảnh QR là mã hỏng — tiền không về được. Đây là cùng một cái bẫy
    // mà khối QR mức đơn đã phải ghi chú một lần.
    const page = docMa("app/(admin)/admin/orders/[id]/page.tsx");
    expect(page).toMatch(/buildVietQrImageUrl\(payCfg, phieuMo\.tongTien, memo\.noiDung\)/);
    expect(page).toMatch(/maskPhoneInTransferContent\(memo\.noiDung, order\.customerPhone\)/);
    expect(page, "phiếu phải được truyền xuống khối công nợ theo con").toMatch(
      /phieu=\{phieuGop\}/,
    );
  });

  it("[QPG-08] số in trên QR là CÒN PHẢI THU của phiếu, không phải `amountDue` đã chụp", () => {
    // Một dòng của phiếu có thể đã được lấp từ đường khác sau lúc phát; khi đó QR phải in số
    // NHỎ HƠN. In `PaymentBill.amountDue` là đòi cả phần đã trả, và vì cổng đối khớp so với
    // `conPhaiThuCuaPhieu` nên khách chuyển đúng số trên QR sẽ bị từ chối — mọi lần.
    const doc = than(docMa("lib/finance/phieu-gop.ts"), "docPhieuGopDangMo");
    expect(doc).toMatch(/tongTien: conPhaiThuCuaPhieu\(dongChia\),/);
  });
});

describe("[QDH-*] PHIÊN D — dừng học một con: quyền · công tắc · dây nối", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Chủ dự án chốt 21/09/2026: quyền `orders:manage`, và *"sau cờ
  // `billing.flexV1Enabled`; cờ tắt → nút ẩn + action từ chối"*.
  //
  // ⚠️ Cùng lý do "không phải test hành vi" với `[QDB-*]` ngay trên: cổng thật nằm trong
  // Server Action và gọi `auth()` + `checkPermission()`. Phần HÀNH VI của dừng học (19 buổi,
  // quyết toán, phân dư, VOID đợt, hoàn tiền…) nằm ở `tests/finance/dung-hoc-mot-con.test.ts`,
  // chạy trên Postgres thật — 18 ca.
  // ─────────────────────────────────────────────────────────────────────────────
  const ACT = "app/(admin)/admin/orders/_actions.ts";

  it("cả HAI action đi qua `congDungHoc` — không action nào tự gác lấy", () => {
    const src = docMa(ACT);
    for (const ten of ["xemTruocDungHocAction", "dungHocConAction"]) {
      const t = than(src, ten);
      expect(t, `không tách được thân ${ten}`).not.toBe("");
      expect(t, `${ten} phải đi qua cổng chung`).toMatch(
        /const cong = await congDungHoc\(input\.orderId\);/,
      );
      expect(t, `${ten} phải trả lỗi, KHÔNG redirect`).not.toMatch(/requireOrdersManage/);
    }
  });

  it("cổng kiểm ĐỦ BA VẾ: quyền `orders:manage` · phạm vi cơ sở · công tắc CỦA ĐƠN", () => {
    const cong = than(docMa(ACT), "congDungHoc");
    expect(cong, "không tách được thân cổng").not.toBe("");
    expect(cong, "vế 1 — quyền").toMatch(/await checkPermission\("orders:manage"\)/);
    expect(cong, "vế 2 — phạm vi cơ sở").toMatch(/passesScope\("Order", order, actor\)/);
    // ⚠️ Vế 3 đọc `order.orgUnitId` — cơ sở GIỮ ĐƠN, không phải cơ sở người bấm.
    expect(cong, "vế 3 — công tắc của ĐƠN").toMatch(/laThuTienLinhHoatBat\(order\.orgUnitId\)/);
  });

  it("cờ TẮT ⇒ action TỪ CHỐI (không chỉ ẩn nút)", () => {
    const cong = than(docMa(ACT), "congDungHoc");
    expect(cong).toMatch(/if \(!\(await laThuTienLinhHoatBat\(order\.orgUnitId\)\)\)/);
    expect(cong).toMatch(/chưa bật cho cơ sở này/);
  });

  it("nút chỉ VẼ khi có quyền VÀ bé chưa dừng — và khối chỉ dựng khi cờ bật", () => {
    // Affordance phải nói thật (luật 12): vẽ nút "Dừng học" cho một bé đã dừng là mời người
    // ta bấm một thứ chắc chắn bị từ chối.
    const ui = docMa("app/(admin)/admin/orders/_components/cong-no-theo-con.tsx");

    // ⚠️ BẢN CŨ CỦA BA DÒNG NÀY GHIM CÁCH VIẾT, KHÔNG GHIM LUẬT [sửa 24/09/2026].
    // Nó đòi đúng văn bản `{duocSua && !tt?.daDung && (` và
    // `<NutDungHoc orderId={orderId} orderItemId={c.orderItemId}` — nên khi khối đổi từ
    // thẻ sang bảng (cùng điều kiện, đặt tên thành `choDung`, nút vào menu `⋯`) nó ĐỎ
    // trong khi luật nó canh không đổi một chữ. Đây là ca thứ năm cùng lớp trong hai
    // ngày (sau `[NDC-07]`, `[NTC-06]`, `[QCS-03]`, `[BTC-06]`).
    //
    // Luật cần khoá: ĐIỀU KIỆN VẼ là "có quyền VÀ bé chưa dừng", và nó phải gác CẢ mục
    // menu LẪN hộp thoại.
    expect(ui, "điều kiện vẽ bị nội tuyến lại — hãy giữ nó ở MỘT biến khai").toMatch(
      /const choDung = duocSua && !tt\?\.daDung;/,
    );
    // Khẳng định DƯƠNG, bắt buộc: gỡ hẳn mục khỏi menu mà không có vế này thì KHÔNG ca
    // nào đỏ — nút biến mất im lặng đúng bằng cách mà luật 12 cấm.
    expect(ui.match(/Dừng học…/g) ?? [], "mục 'Dừng học…' biến mất khỏi menu ⋯").toHaveLength(1);
    expect(ui, "hộp thoại phải dựng NGOÀI menu, và vẫn sau cùng cái cổng").toContain(
      "<NutDungHoc",
    );
    // MỘT chỗ: mục menu. Hộp thoại dựng NGOÀI vòng lặp (nó phải ra khỏi `<tbody>`, xem
    // chú thích tại chỗ), nên nó có cổng RIÊNG — và cổng riêng ấy phải kiểm lại đúng
    // điều kiện, kẻo trạng thái sống qua một lần render thành cửa sau.
    expect(ui.match(/\{choDung &&/g) ?? []).toHaveLength(1);
    expect(
      ui,
      "hộp thoại dừng học mở ra mà KHÔNG kiểm lại `daDung` — bé bị dừng ở tab khác thì " +
        "hộp thoại đang mở vẫn gửi được",
    ).toMatch(/dangMoDung && !dungHoc\?\.\[x\.orderItemId\]\?\.daDung/);

    // Cả khối công nợ theo con chỉ dựng khi `batThuTheoCon` — tức cờ tắt thì không có nút
    // nào để mà ẩn, và trang không tốn thêm một truy vấn nào.
    const trang = docMa("app/(admin)/admin/orders/[id]/page.tsx");
    // ⚠️ 24/09/2026 — nhận cả dạng nằm trong `Promise.all`; xem ghi chú cùng ngày ở
    // `no-theo-con.test.ts` `[NTC-06]`. Luật cần khoá là "cờ tắt thì KHÔNG tra gì".
    expect(trang).toMatch(
      /batThuTheoCon\s*\?\s*(?:await\s+)?docTrangThaiDungHoc\(order\.id\)\s*:\s*(?:undefined|Promise\.resolve\(undefined\))/,
    );
  });

  it("CỔNG ĐỨNG TRƯỚC PHÉP GHI: 7 cổng của `dungHocMotCon` nằm trên phép ghi đầu tiên", () => {
    // Luật rollback (CLAUDE.md mục 7): `return` trong callback `$transaction` KHÔNG rollback.
    // Lưới chung `cong-truoc-phep-ghi.test.ts` quét hình dạng; ca này neo thêm THỨ TỰ cụ thể
    // của hàm này, vì phép ghi đầu tiên của nó nằm trong một hàm phụ (`huyDotKhiDungHoc`) mà
    // lưới chung không nhìn vào.
    const src = docMa("lib/finance/dung-hoc-con.ts");
    const viTriCongCuoi = src.indexOf("} else if (input.phanDu.length > 0) {");
    const viTriGhiDau = src.indexOf("const soDotDaHuy = await huyDotKhiDungHoc(");
    expect(viTriCongCuoi, "không thấy cổng 7").toBeGreaterThan(0);
    expect(viTriGhiDau, "không thấy phép ghi đầu tiên").toBeGreaterThan(0);
    expect(viTriGhiDau, "phép ghi đầu tiên phải nằm SAU cổng cuối cùng").toBeGreaterThan(
      viTriCongCuoi,
    );
  });

  it("ngoại lệ huỷ đợt có TÊN RIÊNG và không ai ngoài đường dừng học gọi được", () => {
    const src = docMa("lib/finance/dung-hoc-con.ts");
    // Không `export` ⇒ ngoài tệp không gọi được. Đây là vế "chỉ gọi được từ đường dừng học".
    expect(src).toMatch(/\nasync function huyDotKhiDungHoc\(/);
    expect(src, "KHÔNG được export ngoại lệ này").not.toMatch(
      /export async function huyDotKhiDungHoc/,
    );
    // Và luật cũ không bị nới: `kiemHuyDot` vẫn từ chối đợt đã có tiền.
    const cu = docMa("lib/finance/no-theo-con.ts");
    expect(cu).toMatch(/if \(tron\(dot\.daRot\) > 0\) \{/);
  });

  it("phần KHÔNG-TIỀN tách ra rồi, và đường 'Nghỉ học hẳn' KHÔNG đổi hành vi", () => {
    const tach = docMa("lib/students/ket-thuc-ghi-danh.ts");
    // Tệp phần-không-tiền TUYỆT ĐỐI không được chạm sổ tiền.
    for (const cam of ["createRefundRequest", "payment.", "paymentRequest.", "refundRequest."]) {
      expect(tach, `phần KHÔNG-TIỀN không được nhắc \`${cam}\``).not.toContain(cam);
    }
    // Đường cũ gọi hàm mới mà KHÔNG truyền `endedAt` ⇒ cột đó vẫn nguyên như trước.
    const cu = docMa("lib/students/remove-from-classes.ts");
    expect(cu).toMatch(/await ketThucMotGhiDanh\(\{/);
    expect(cu, "truyền `endedAt` ở đây là đổi hành vi báo cáo churn").not.toMatch(/endedAt/);
    // Phần TIỀN vẫn ở đúng chỗ cũ — ngoài hàm không-tiền.
    expect(docMa("lib/students/withdraw.ts")).toMatch(/await createRefundRequest\(\{/);
  });
});
