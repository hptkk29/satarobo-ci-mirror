import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * [QDO] LƯỚI cho cổng đơn Online (`lib/finance/quyen-don-online.ts`) — M8 P0-1, 28/11/2026.
 *
 * Fail-closed: MỌI export (không phải kiểu) của một tệp `"use server"` trong bốn thư mục dưới đây phải (a) gọi một cổng nhận diện được,
 * hoặc (b) nằm trong `NGOAI_LE` kèm mã lý do. Action mới ⇒ đỏ cho tới khi có người phân loại. Lưới KHÔNG dò phép ghi: phần lớn thao tác ghi đi qua lib.
 *
 * GIỚI HẠN — lưới chỉ phủ Server Action của bốn thư mục này. KHÔNG phủ `app/api/**`, thư mục admin khác, cron, hay nơi gọi thẳng lib.
 * Nó chỉ chứng minh «có gọi cổng», không chứng minh cổng đứng đúng chỗ hay kết quả được dùng — việc đó là của `[TTO-*]` / `[HTO-*]` / `[HTQ-*]` trên Postgres thật.
 * Mục `CHUA_GAC` là finding còn mở, KHÔNG phải «đã xét và cho qua»; mục ghi (SUY) là đọc mã, chưa đo.
 */
const GOC = "app/(admin)/admin";
const THU_MUC = ["orders", "payments", "bien-dong-so-du", "hoan-tien"];

/** Cổng dùng ở mọi tệp. `congDuongB` chỉ tính khi khoá truyền vào là chữ `"payments:manage"` (nhóm record / pos-check giữ luật cũ). */
const CONG = ["loiQuyenDonOnline", "congDungHoc", "loadScopedPayment", "duocQuanLyHoanOnline", "laHoanDonOnline"];
/** Cổng riêng của một tệp: từ chối mọi đơn không có cơ sở ⇒ đơn Online (`centerId NULL`) không đi qua được. */
const CONG_THEO_TEP: Record<string, string[]> = {
  "payments/hoa-don/_actions.ts": ["congKeToanDon"],
  "orders/_actions-nguoi-mua.ts": ["batDau", "batDauXuatLien"],
};

type Ma =
  | "DOC" // chỉ đọc
  | "KHONG_GHI_DON" // cấu hình / máy ký / agent / tệp lô — không ghi lên một đơn được chỉ định
  | "CHI_QUAN_TRI_TOI_CAO"
  | "KHONG_CHAM_ONLINE" // đường ghi không tới được đơn Online
  | "LIB_TU_CHOI_ONLINE" // lib từ chối — ghim ở [QDO-3]
  | "LUAT_KHONG_DOI" // payments:record / payments:pos-check: Coordinator chốt không đổi luật ⇒ khe còn lại ghi ở báo cáo
  | "POS_V2_DOI_TOAN_HE" // `quyenTaiCoSoCuaDon(…, null)`: v2 đòi khoá tầm toàn hệ; v1 luôn cho
  | "CHUA_GAC"; // FINDING còn mở — phát hiện sau khi chốt phạm vi vòng cuối

type NgoaiLe = { ma: Ma; tep: string; ham: string[]; ly: string };
const g = (ma: Ma, tep: string, ham: string[], ly: string): NgoaiLe => ({ ma, tep, ham, ly });

const NGOAI_LE: NgoaiLe[] = [
  // ───────── CHƯA GÁC — finding (mọi mục (SUY)) ─────────
  g("CHUA_GAC", "orders/_actions.ts", ["huyDotChoConAction"], "orders:manage; đổi phiếu thu sang VOID — cặp ngược của taoDotChoCon (đã gác)"),
  g("CHUA_GAC", "orders/_actions.ts", ["luuThongTinHoaDonAction"], "ghi người mua trên hoá đơn của đơn (orders:manage / edit-invoice-buyer*)"),
  g("CHUA_GAC", "orders/_actions.ts", ["sendManualOrderEmailAction"], "orders:manage; gửi nội dung đơn tới địa chỉ nhập tay"),
  g("CHUA_GAC", "bien-dong-so-du/_actions.ts", ["boQuaGiaoDich"], "payments:manage; bỏ qua được giao dịch CHƯA gắn — gồm tiền đang giữ của đơn Online đã huỷ"),
  g("CHUA_GAC", "orders/duyet/_actions.ts", ["approveOrderAction", "rejectOrderAction"], "duyệt giảm giá / đợt / số buổi; chỉ chạm khi đơn Online có phần chờ duyệt — chưa thấy đường sinh"),
  g("CHUA_GAC", "orders/[id]/chuyen-doi/_actions.ts", ["chuyenDoiDonAction", "doiBuoiBatDauAction", "suaGhiDanhAction"], "khoá enrollments:*; đường đọc đơn không lọc loại đơn"),

  // ───────── luật không đổi ─────────
  g("LUAT_KHONG_DOI", "orders/_actions.ts", ["ganKhoanChoConAction", "tachKhoanChoConAction", "taoPhieuGopAction", "huyPhieuGopAction"], "congDuongB payments:record"),
  g("LUAT_KHONG_DOI", "orders/_actions.ts", ["taoPhieuPosAction", "kiemTraPhieuPosAction", "baoAdminPhieuPosAction", "huyPhieuTheAction"], "payments:pos-check"),
  g("LUAT_KHONG_DOI", "orders/_pos-sai-ma-actions.ts", ["guiSaiMaAction"], "payments:pos-check"),
  g("LUAT_KHONG_DOI", "orders/_qr-actions.ts", ["issueQrForRequest", "regenerateQr"], "payments:record"),
  g("LUAT_KHONG_DOI", "orders/_thu-truoc-actions.ts", ["thuTruocAction"], "payments:record"),
  g("LUAT_KHONG_DOI", "payments/_actions.ts", ["recordPaymentAction"], "payments:record — khoản ghi vào tính cho «đã thu đủ»"),
  g("LUAT_KHONG_DOI", "bien-dong-so-du/_actions.ts", ["ganGiaoDichVaoDon"], "payments:record"),
  g("LUAT_KHONG_DOI", "bien-dong-so-du/_gan-theo-con.ts", ["ganGiaoDichTheoConAction", "taoDotChoConTaiChoAction"], "congGanVaoDon: payments:record HOẶC payments:manage; taoDotChoConTaiCho ghi cùng thứ với taoDotChoCon"),
  g("POS_V2_DOI_TOAN_HE", "bien-dong-so-du/_pos-sai-ma-actions.ts", ["duyetSaiMaAction", "tuChoiSaiMaAction"], "congKeToanSaiMa"),

  // ───────── không tới được đơn Online / đã từ chối ─────────
  g("LIB_TU_CHOI_ONLINE", "hoan-tien/_actions.ts", ["approveRefundAction", "rejectRefundAction"], "approveRefund / rejectRefund"),
  g("KHONG_CHAM_ONLINE", "hoan-tien/_actions.ts", ["taoDeXuatHoanTienAction"], "đi từ ghi danh lớp của cơ sở (SUY)"),
  g("KHONG_CHAM_ONLINE", "orders/_actions.ts", ["createOrderManualAction"], "methodAllowsOrderType không có nhánh ONLINE ⇒ không tạo được đơn Online (SUY)"),
  g("KHONG_CHAM_ONLINE", "orders/_actions.ts", ["recordOrderInstallmentsAction"], "luôn từ chối"),
  g("KHONG_CHAM_ONLINE", "payments/_actions.ts", ["bulkConfirmBackfillPaymentsAction"], "chỉ khoản mang dấu nhập từ sheet (SUY)"),
  g("KHONG_CHAM_ONLINE", "payments/_actions.ts", ["ganGhiDanhChoKhoanAction"], "cần ghi danh cùng học viên của đơn; đơn Online không có studentId (SUY)"),
  g(
    "KHONG_CHAM_ONLINE",
    "payments/hoa-don/chung-tu-ngan-hang/_actions.ts",
    ["danhDauCanChungTuAction", "huyDanhDauChungTuAction", "kyTaiLenChungTuAction", "ghiChungTuDaTaiAction", "kiemTraChungTuAction", "yeuCauBoSungLaiChungTuAction"],
    "hồ sơ chứng từ đòi cơ sở của khoản thu (đo ở danhDauCanChungTu; các hàm còn lại SUY)",
  ),
  g("CHI_QUAN_TRI_TOI_CAO", "orders/_hoc-bong-actions.ts", ["capHocBong100Action", "thuHoiHocBong100Action"], "canGrantFullScholarship"),
  g("CHI_QUAN_TRI_TOI_CAO", "orders/_actions.ts", ["xoaDonDaHuyAction"], "so vai SUPER_ADMIN trong phiên"),

  // ───────── không ghi lên đơn ─────────
  g("KHONG_GHI_DON", "bien-dong-so-du/_pos-actions.ts", ["batDauNhapPosAction", "nhapLoPosAction", "ketThucNhapPosAction", "dongCanhBaoHuyPosAction"], "nhập lô file thẻ (đòi tầm mọi cơ sở) / đóng cảnh báo"),
  g("KHONG_GHI_DON", "bien-dong-so-du/pos-agent/_actions.ts", ["taoPosAgentAction", "taoLaiBiMatAgentAction", "doiTrangThaiAgentAction"], "máy trạm POS"),
  g("KHONG_GHI_DON", "payments/hoa-don/canh-bao/_ngoai-le-actions.ts", ["xuLyNgoaiLeAction"], "cảnh báo ngoại lệ hoá đơn (SUY)"),
  g("KHONG_GHI_DON", "payments/hoa-don/cau-hinh/_actions.ts", ["luuCauHinhHoaDonAction"], "cấu hình"),
  g("KHONG_GHI_DON", "payments/hoa-don/cau-hinh/_chinh-sach-actions.ts", ["taoNhapChinhSachAction", "guiDuyetChinhSachAction", "duyetChinhSachAction", "tuChoiChinhSachAction", "hetHieuLucChinhSachAction"], "cấu hình"),
  g("KHONG_GHI_DON", "payments/hoa-don/cau-hinh/_ket-noi-actions.ts", ["luuKetNoiAction", "kiemTraKetNoiAction"], "cấu hình"),
  g("KHONG_GHI_DON", "payments/hoa-don/cau-hinh/_ky-chinh-sach-actions.ts", ["luuHanMucKyAction", "tamDungKyAction", "batLaiKyAction"], "cấu hình"),
  g("KHONG_GHI_DON", "payments/hoa-don/cau-hinh/_ky-usb-actions.ts", ["taoLenhKyUsbAction", "kyLoUsbAction", "huyLenhKyUsbAction", "kiemTraLaiKyUsbAction", "taoMaGhepMayKyAction", "thuHoiMayKyAction"], "máy ký hoá đơn (hoá đơn đòi cơ sở)"),

  // ───────── chỉ đọc ─────────
  g("DOC", "orders/_actions.ts", ["queryOrders", "loadCreateOrderFormData", "timPhuHuynhTheoSdtAction"], "đọc"),
  g("DOC", "orders/_pham-vi-actions.ts", ["xemTruocGiaPhamViAction"], "xem trước giá"),
  g("DOC", "orders/_pos-sai-ma-actions.ts", ["timUngVienSaiMaAction"], "tìm ứng viên"),
  g("DOC", "payments/_actions.ts", ["queryPayments", "revealPaymentsPii", "loadPaymentMethodOptions", "loadOrderOptions", "khoanBiBoAction"], "đọc"),
  g("DOC", "payments/hoa-don/chung-tu-ngan-hang/_actions.ts", ["timKhoanTheoMaDonAction"], "tìm khoản"),
  g("DOC", "bien-dong-so-du/_actions.ts", ["timDonDeGan"], "tìm đơn"),
  g("DOC", "bien-dong-so-du/_gan-theo-con.ts", ["taiChiTietDonDeGan"], "đọc chi tiết"),
];

const phanTich = (ten: string, ma: string) => ts.createSourceFile(ten, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const laServer = (sf: ts.SourceFile) => {
  const dau = sf.statements[0];
  return !!dau && ts.isExpressionStatement(dau) && ts.isStringLiteral(dau.expression) && dau.expression.text === "use server";
};
const coExport = (n: ts.Node) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Mọi export chạy được. Dạng lạ (re-export, default, class…) vẫn được trả ra bằng một tên ⇒ không phân loại thì đỏ. */
function exportCuaTep(sf: ts.SourceFile): { ten: string; than: ts.Node }[] {
  const ra: { ten: string; than: ts.Node }[] = [];
  for (const s of sf.statements) {
    if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) continue;
    if (ts.isExportDeclaration(s)) {
      if (!s.isTypeOnly) ra.push({ ten: s.getText(sf), than: s });
    } else if (ts.isExportAssignment(s)) {
      ra.push({ ten: "default", than: s });
    } else if (!coExport(s)) {
      continue;
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) ra.push({ ten: d.name.getText(sf), than: d });
    } else {
      ra.push({ ten: (s as ts.FunctionDeclaration).name?.text ?? s.getText(sf).slice(0, 60), than: s });
    }
  }
  return ra;
}

function loiGoi(than: ts.Node): ts.CallExpression[] {
  const ra: ts.CallExpression[] = [];
  const di = (n: ts.Node) => {
    if (ts.isCallExpression(n)) ra.push(n);
    ts.forEachChild(n, di);
  };
  di(than);
  return ra;
}

function coCong(than: ts.Node, congThem: string[] = []): boolean {
  return loiGoi(than).some((c) => {
    const ten = ts.isIdentifier(c.expression) ? c.expression.text : "";
    if (ten === "congDuongB") {
      const khoa = c.arguments[1];
      return !!khoa && ts.isStringLiteral(khoa) && khoa.text === "payments:manage";
    }
    return CONG.includes(ten) || congThem.includes(ten);
  });
}

function thanHam(tepTuGoc: string, ten: string): ts.FunctionDeclaration {
  const sf = phanTich(tepTuGoc, readFileSync(path.join(process.cwd(), tepTuGoc), "utf8"));
  const ham = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === ten);
  if (!ham) throw new Error(`Không thấy hàm ${ten} trong ${tepTuGoc}`);
  return ham;
}
const goiTen = (than: ts.Node, ten: string) => loiGoi(than).some((c) => ts.isIdentifier(c.expression) && c.expression.text === ten);

function quet() {
  const tepServer: string[] = [];
  const hanhDong: { khoa: string; cong: boolean }[] = [];
  for (const thuMuc of THU_MUC) {
    for (const tuong of readdirSync(path.join(process.cwd(), GOC, thuMuc), { recursive: true, encoding: "utf8" })) {
      const tep = `${thuMuc}/${tuong.replaceAll("\\", "/")}`;
      if (!/\.tsx?$/.test(tep) || /\.(test|spec)\.tsx?$/.test(tep)) continue;
      const sf = phanTich(tep, readFileSync(path.join(process.cwd(), GOC, tep), "utf8"));
      if (!laServer(sf)) continue;
      tepServer.push(tep);
      for (const e of exportCuaTep(sf)) hanhDong.push({ khoa: `${tep}#${e.ten}`, cong: coCong(e.than, CONG_THEO_TEP[tep]) });
    }
  }
  return { tepServer, hanhDong };
}

describe("[QDO] lưới cổng đơn Online", () => {
  const { tepServer, hanhDong } = quet();
  const khoaNgoaiLe = NGOAI_LE.flatMap((n) => n.ham.map((h) => `${n.tep}#${h}`));

  it("[QDO-0] bộ quét thấy tệp thật (không xanh vì quét rỗng)", () => {
    expect(tepServer).toEqual(expect.arrayContaining(["orders/_actions.ts", "payments/_actions.ts", "bien-dong-so-du/_gan-theo-con.ts", "hoan-tien/_actions.ts", "orders/[id]/chuyen-doi/_actions.ts"]));
    expect(hanhDong.length).toBeGreaterThan(120);
  });

  it("[QDO-1] mọi Server Action đều có cổng nhận diện được hoặc đã được phân loại", () => {
    expect(hanhDong.filter((h) => !h.cong && !khoaNgoaiLe.includes(h.khoa)).map((h) => h.khoa)).toEqual([]);
  });

  it("[QDO-2] danh sách ngoại lệ không mục thừa, không trùng, không mục nào đã có cổng", () => {
    const co = new Map(hanhDong.map((h) => [h.khoa, h.cong]));
    expect(khoaNgoaiLe.filter((k) => !co.has(k))).toEqual([]);
    expect(khoaNgoaiLe.filter((k) => co.get(k) === true)).toEqual([]);
    expect(khoaNgoaiLe.filter((k, i) => khoaNgoaiLe.indexOf(k) !== i)).toEqual([]);
  });

  it("[QDO-3] các hàm được tính là cổng vẫn thật sự chặn", () => {
    const orders = `${GOC}/orders/_actions.ts`;
    expect(goiTen(thanHam(orders, "congDungHoc"), "loiQuyenDonOnline")).toBe(true);
    expect(goiTen(thanHam(orders, "congDuongB"), "loiQuyenDonOnline")).toBe(true);
    expect(goiTen(thanHam(`${GOC}/payments/_actions.ts`, "loadScopedPayment"), "duocTrenDonOnline")).toBe(true);
    for (const ten of ["approveRefund", "rejectRefund"]) expect(goiTen(thanHam("lib/finance/refund.ts", ten), "laHoanDonOnline")).toBe(true);
    expect(thanHam(`${GOC}/payments/hoa-don/_actions.ts`, "congKeToanDon").getText()).toContain("!order.centerId");
    expect(thanHam(`${GOC}/orders/_actions-nguoi-mua.ts`, "batDau").getText()).toContain("!order?.centerId");
    expect(goiTen(thanHam(`${GOC}/orders/_actions-nguoi-mua.ts`, "batDauXuatLien"), "batDau")).toBe(true);
  });

  it("[QDO-4] bộ dò: chữ trong chú thích không phải cổng; congDuongB chỉ tính với payments:manage; export lạ không lọt", () => {
    const sf = phanTich(
      "x.ts",
      `"use server";
      export async function a() { /* loiQuyenDonOnline( */ return "congDungHoc("; }
      export async function b() { return congDuongB(id, "payments:record"); }
      export async function c() { return congDuongB(id, "payments:manage"); }
      export const d = async () => loiQuyenDonOnline("ONLINE", actor, "orders:manage");
      export { e } from "./khac";`,
    );
    expect(laServer(sf)).toBe(true);
    expect(exportCuaTep(sf).map((e) => [e.ten, coCong(e.than)])).toEqual([
      ["a", false],
      ["b", false],
      ["c", true],
      ["d", true],
      ['export { e } from "./khac";', false],
    ]);
  });
});
