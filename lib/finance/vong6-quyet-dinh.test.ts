// [V6-W*] — hai quyết định của chủ dự án 30/09/2026 (docs/pos-the-smartpos.md, bảng Q-L / Q-M): DÂY NỐI.
// THUẦN + lưới ghim mã nguồn. Luật thuần: `mien-giam.test.ts` `[MG-L*]`, `phieu-gop-go-gan.test.ts`
// `[PGG-16..17]`. Hành vi thật (Postgres): `tests/finance/pos-vong6.test.ts`.
//
// Vì sao cần lưới ngoài test hành vi: ca DB gọi thẳng `mienGiamNoChoCon` — nó không chạm màn nói-trước.
// Màn tự tính lại bằng một hàm khác (hoặc quên truyền dữ liệu phiếu cấp đơn) thì mọi ca DB vẫn xanh
// trong khi màn nói "không phiếu nào bị chạm" và máy chủ huỷ mã của cả nhà.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ⚠️ Bóc DÒNG chú thích `//` TRƯỚC, khối `/* */` SAU [gộp `test` 01/10/2026]. Thứ tự cũ (khối trước)
// coi một `/*` NẰM TRONG dòng chú thích là chỗ mở khối: PR #436 thêm vào `cong-no-theo-con.tsx` dòng
// "… `grep` toàn `app/**` + `components/**` …", và phép bóc khối chạy từ `/**` ấy tới `*/` kế tiếp —
// nuốt cả phần JSX của `CongNoTheoCon` (đo: 0 lần `<FormMienGiam` còn lại). `[V6-W3]` đỏ trong khi
// form vẫn nhận đủ props: lưới đỏ vì PHÉP BÓC, không vì mã. Luật lưới canh không đổi một chữ.
// Rà đối kháng bản gộp (cùng ngày): dòng ấy đã viết lại không còn glob (gốc của lỗi, che luôn các lưới
// bóc khối-trước khác — `[QTD-W4]` `[SPG-W4]` từng mù ~45 dòng ở đó). Thứ tự bóc ở đây vẫn GIỮ: repo còn
// hàng chục tệp có dòng `//` chứa dấu mở/đóng khối.
function ma(tep: string): string {
  return readFileSync(resolve(process.cwd(), tep), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const dem = (s: string, re: RegExp) => s.match(new RegExp(re.source, "g"))?.length ?? 0;
/** Thân một hàm — từ khai báo tới hàm/export cấp cao kế tiếp. */
function than(src: string, dau: string): string {
  const i = src.indexOf(dau);
  if (i === -1) return "";
  const j = src.indexOf("\nexport ", i + dau.length);
  return src.slice(i, j === -1 ? undefined : j);
}

describe("[V6-W] Q-L — miễn giảm cho bé không có đợt theo con", () => {
  const DB = than(ma("lib/finance/mien-giam-db.ts"), "export async function mienGiamNoChoCon(");

  it("[V6-W1] đường ghi hỏi `keHoachMienGiam` ĐÚNG MỘT lần, và cổng CHẶN đứng TRƯỚC phép ghi đầu tiên", () => {
    expect(DB, "không tách được thân mienGiamNoChoCon").not.toBe("");
    expect(dem(DB, /\bkeHoachMienGiam\(\{/)).toBe(1);
    const cong = DB.indexOf('if (kh.cach === "CHAN") return { ok: false as const, error: kh.loi };');
    const ghiDau = DB.search(/await tx\.\w+\.(?:update|create|updateMany|delete|deleteMany)\(/);
    expect(cong, "cổng CHẶN").toBeGreaterThan(-1);
    expect(ghiDau, "đối chứng: có phép ghi").toBeGreaterThan(-1);
    expect(cong, "luật rollback: return đứng TRƯỚC phép ghi đầu tiên").toBeLessThan(ghiDau);
    // Bé đã dừng — cùng vế `status === "STOPPED"` màn đọc qua `docTrangThaiDungHoc`.
    expect(DB).toContain('daDungHoc: dong.status === "STOPPED",');
    // Hàm thuần nhận MỌI phiếu thu của đơn (không chỉ đợt của bé) + kế hoạch.
    expect(DB).toMatch(/tx\.paymentRequest\.findMany\(\{\s*where: \{ orderId: input\.orderId \},/);
    expect(DB).toMatch(/tx\.orderInstallment\.findMany\(\{\s*where: \{ orderId: input\.orderId \},/);
    // Rà vòng 6 — vế ĐƠN đọc còn nợ CẢ ĐƠN dưới khoá (`so` của `ghiTienChoDon`), và vế R0 đọc TỔNG ĐƠN
    // (số `ensureFullOrderRequest` sẽ ghi). Luật 7: hai tham số bắt buộc, ở đây phải là số THẬT.
    const goi = DB.slice(DB.indexOf("keHoachMienGiam({"), DB.indexOf("});", DB.indexOf("keHoachMienGiam({")));
    expect(dem(goi, /conNoDon: so\.conNoDon,/)).toBe(1);
    expect(dem(goi, /tongDon: dong\.order\.totalAmount,/)).toBe(1);
    expect(DB).toMatch(/order: \{ select: \{[^}]*totalAmount: true[^}]*\} \}/);
  });

  it("[V6-W5] rà vòng 6 — R0 dựng lại ĐÚNG số đã nói trước (một nguồn); câu báo sau so với còn nợ đơn đọc SAU ghi", () => {
    // Tổng đơn mới (tính từ dòng) lệch `ke.doi[0].soMoi` (tính từ `Order.totalAmount`) ⇒ THROW — không ghi
    // một số khác số đã nói trước / đã ghi nhật ký.
    expect(DB).toContain("if (tongDonMoi !== soMoiDaNoi) {");
    expect(dem(DB, /throw new LoiDungLaiCapDon\(/)).toBeGreaterThanOrEqual(4);
    expect(DB).toMatch(/thongDiepCapDon: thongDiepDungLaiCapDon\(dungLaiCapDon, \{ phieuConDoi, conNoDon: sau\.conNoDon \}\),/);
  });

  it("[V6-W2] CAP_DON: VOID → soát phiếu gộp → dựng lại bằng CHÍNH hàm sẵn có (R0: ensureFullOrderRequest; đợt đơn: materialize)", () => {
    const capDon = DB.slice(DB.indexOf('} else if (kh.cach === "CAP_DON") {'));
    expect(capDon.length, "không tách được nhánh CAP_DON").toBeGreaterThan(40);
    const iVoid = capDon.indexOf('data: { status: "VOID" }');
    const iSoat = capDon.indexOf("await soatPhieuGopMoTrongTx(tx, input.orderId)");
    const iR0 = capDon.indexOf("await ensureFullOrderRequest(tx, {");
    const iMat = capDon.indexOf("await materializeInstallmentRequests(tx, input.orderId,");
    expect(iVoid).toBeGreaterThan(-1);
    expect(iSoat, "soát (huỷ mã cũ) SAU khi VOID").toBeGreaterThan(iVoid);
    expect(iR0, "R0 dựng lại SAU khi soát — soát trước lúc R0 còn VOID").toBeGreaterThan(iSoat);
    expect(iMat).toBeGreaterThan(iSoat);
    // Không có đường dựng thứ hai: nhánh CAP_DON không tự `create` phiếu thu.
    expect(dem(capDon.slice(0, capDon.indexOf("const { phieuGopDaSoat } = await recomputeRequestStatuses")), /tx\.paymentRequest\.create\(/)).toBe(0);
    // Kết quả soát của MỌI bước đi lên câu báo sau.
    expect(dem(DB, /phieuDaSoat\.push\(/)).toBe(3);
    expect(DB).toContain("thongDiepPhieu: thongDiepPhieuDaSoat(phieuDaSoat),");
    // Câu báo sau phiếu cấp đơn: `[V6-W5]` (rà vòng 6 thêm tham số so với còn nợ đơn).
    expect(dem(DB, /thongDiepCapDon: thongDiepDungLaiCapDon\(dungLaiCapDon,/)).toBe(1);
  });

  it("[V6-W3] màn miễn giảm NÓI TRƯỚC bằng CHÍNH `keHoachMienGiam`, khoá nút khi bị chặn, và NÓI SAU phiếu dựng lại", () => {
    const ui = ma("app/(admin)/admin/orders/_components/cong-no-theo-con.tsx");
    expect(
      dem(ui, /keHoachMienGiam\(\{ orderItemId: con\.orderItemId, phieuThu, keHoachDon, canGiam: soTien, cach: hapThu, daDungHoc, conNoDon, tongDon \}\)/),
    ).toBe(1);
    expect(ui).toContain("canhBaoTruocVoidDot(phieu, dotSeHuyKhiMienGiam(keHoach))");
    expect(ui).toContain('const chan = keHoach?.cach === "CHAN" ? keHoach.loi : null;');
    expect(ui, "nút khoá khi máy chủ chắc chắn từ chối (luật 12)").toMatch(/const hopLe = keHoach !== null && !chan && !!lyDo\.trim\(\);/);
    expect(dem(ui, /\{chan\}/), "in CHÍNH câu máy chủ trả").toBe(1);
    expect(ui).toContain("if (r.thongDiepCapDon) toast.info(r.thongDiepCapDon");
    // Props BẮT BUỘC — mặc định rỗng là màn nói "không phiếu nào bị chạm" (lỗi câm, luật 11).
    expect(ui).toMatch(/\n\s*phieuThu: readonly PhieuThuDeMien\[\];/);
    expect(ui).toMatch(/\n\s*keHoachDon: readonly DongKeHoachDon\[\];/);
    expect(ui).not.toMatch(/phieuThu = \[\]|keHoachDon = \[\]/);
    expect(ui).toMatch(/<FormMienGiam[\s\S]*?daDungHoc=\{tt\?\.daDung \?\? false\}[\s\S]*?phieuThu=\{phieuThu\}[\s\S]*?keHoachDon=\{keHoachDon\}/);
    // Rà vòng 6 — vế ĐƠN + tổng đơn: form nhận CHÍNH `so.conNoDon` (cùng `docSoTheoCon` đường ghi đọc) và
    // tổng đơn của trang; BẮT BUỘC (luật 7), không mặc định.
    expect(ui).toMatch(/<FormMienGiam[\s\S]*?conNoDon=\{so\.conNoDon\}[\s\S]*?tongDon=\{tongDon\}/);
    expect(ui).toMatch(/\n\s*conNoDon: number;/);
    expect(ui.match(/\n\s*tongDon: number;/g)?.length ?? 0, "FormMienGiam + CongNoTheoCon").toBe(2);
    expect(ui).not.toMatch(/tongDon = |conNoDon = /);
  });

  it("[V6-W4] trang đơn truyền MỌI phiếu thu (số đã rót = tiền THẬT) + kế hoạch cho khối công nợ theo con", () => {
    const trang = ma("app/(admin)/admin/orders/[id]/page.tsx");
    expect(trang).toMatch(/phieuThu=\{paymentRequests\.map\(\(r\) => \(\{[\s\S]*?daRot: r\.allocated,[\s\S]*?\}\)\)\}/);
    expect(trang).toContain("keHoachDon={order.installments.map((i) => ({ soDot: i.soDot, amount: i.amount, status: i.status }))}");
    expect(trang).toContain("tongDon={order.totalAmount}");
  });
});
