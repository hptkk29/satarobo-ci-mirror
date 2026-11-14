// [GNV-W*] LƯỚI GHIM «Gửi NHÁP lên VIN»: những điều chỉ đúng khi mã nối ĐÚNG chỗ và test hành vi KHÔNG chứng minh được (gỡ dây ⇒ ca hành vi vẫn xanh vì chúng gọi hàm trực tiếp):
//   · nháp dừng TRƯỚC phép ghi đầu tiên của phát hành thật (không hoá đơn, không khoá khoản, không giữ hạn mức);
//   · lõi nháp KHÔNG tự ghi hoá đơn và KHÔNG tự dựng phiếu (chỉ qua `dungPhieuNhap`);
//   · refId của nháp riêng (`nhap-…`) — dùng lại refId thật sẽ chặn chính hoá đơn thật sau này (VIN lỗi 03 trùng mã);
//   · action đứng sau cổng công tắc + nút trên dòng loader + nhà cung cấp VIN; giao diện chỉ vẽ nút khi VIN ∧ nút Phát hành sáng.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const doc = (p: string) => bo(readFileSync(resolve(process.cwd(), p), "utf8"));

describe("[GNV-W] dây nối của «Gửi nháp lên VIN»", () => {
  const phatHanh = doc("lib/finance/hoa-don/phat-hanh-misa.ts");
  const loi = doc("lib/finance/hoa-don/gui-nhap-vin.ts");
  const action = doc("app/(admin)/admin/payments/hoa-don/_actions.ts");
  const ui = doc("app/(admin)/admin/payments/hoa-don/_components/phat-hanh-misa.tsx");
  const batDau = phatHanh.slice(phatHanh.indexOf("export async function batDauPhatHanh"), phatHanh.indexOf("export class PhieuNhapDaDung"));

  it("[GNV-W1] `chiDungPhieu` NÉM sau khi dựng + kiểm phiếu và TRƯỚC giữ chỗ hạn mức lẫn tạo hoá đơn (ném ⇒ rollback, không ghi gì)", () => {
    const iPhieu = batDau.indexOf("chanPhieuKhongHopLe(phieu);");
    const iNem = batDau.indexOf("if (input.chiDungPhieu) throw new PhieuNhapDaDung(");
    const iHanMuc = batDau.indexOf("giuChoHanMucTrongTx(");
    const iTao = batDau.indexOf("tx.hoaDonDienTu.create(");
    expect(iPhieu).toBeGreaterThan(0);
    expect(iNem).toBeGreaterThan(iPhieu);
    expect(iHanMuc).toBeGreaterThan(iNem);
    expect(iTao).toBeGreaterThan(iNem);
    // Chỉ MỘT chỗ ném, và `dungPhieuNhap` đặt cờ + chọn kieu BAM_TAY (không hạn mức tự động).
    expect(batDau.match(/throw new PhieuNhapDaDung\(/g)).toHaveLength(1);
    expect(phatHanh).toMatch(/kieu: "BAM_TAY", chiDungPhieu: true/);
  });

  it("[GNV-W2] lõi nháp: dựng phiếu CHỈ qua `dungPhieuNhap`; không gọi `batDauPhatHanh` / không tạo hoá đơn / không đụng khoản; refId riêng `nhap-`", () => {
    expect(loi).toContain("dungPhieuNhap(");
    expect(loi).not.toMatch(/\bbatDauPhatHanh\(/);
    expect(loi).not.toMatch(/hoaDonDienTu\.(create|update|upsert|delete)/);
    expect(loi).not.toMatch(/\$transaction/);
    expect(loi).toContain("`nhap-${randomUUID()}`");
    // Gọi VIN đúng một chỗ và bằng phiếu ĐÃ ĐỔI refId (không phải `phieuGoc`).
    expect(loi.match(/kyUsb\.luuNhap\(/g)).toHaveLength(1);
    expect(loi).toContain("kyUsb.luuNhap(phieu)");
    expect(loi).not.toContain("luuNhap(phieuGoc)");
  });

  it("[GNV-W3] action: công tắc → nút trên dòng loader → nhà cung cấp VIN → số tiền → cổng VIN đúng pháp nhân → giới hạn lượt → mới gọi lõi; khoản lấy từ `row.khoan` (loader), không từ client", () => {
    const h = action.slice(action.indexOf("export async function guiNhapHoaDonVinAction"), action.indexOf("function veKetQua"));
    const thuTu = ["congKeToanDon(", "laMisaPhatHanhBat()", "nut.bat", 'nut.nhaCungCap !== "VIN_HOADON"', "soTienDaThay !== row.soTien", "layCongNhapVinChoPhapNhan(", "rateLimit(", "guiNhapLenVin("].map((k) => h.indexOf(k));
    expect(thuTu.every((i) => i > 0), thuTu.join(",")).toBe(true);
    expect([...thuTu].sort((a, b) => a - b)).toEqual(thuTu);
    expect(h).toContain("khoan: row.khoan");
    expect(h).not.toMatch(/khoan:\s*(v|input|p\.data)\./);
  });

  it("[GNV-W4] giao diện: nút chỉ vẽ khi nhà cung cấp là VIN ∧ nút Phát hành đang sáng; gọi đúng action với số tiền người bấm đã thấy", () => {
    expect(ui).toMatch(/nut\.nhaCungCap === "VIN_HOADON" && nut\.bat \? \(/);
    expect(ui).toContain("guiNhapHoaDonVinAction({ orderId: dong.orderId, lanThuKey: dong.key, soTienDaThay: dong.soTien })");
    expect(ui.match(/Gửi nháp \(không ký\)/g)?.length).toBeGreaterThanOrEqual(1);
    // Chủ dự án 09/11/2026: chữ trên màn KHÔNG nêu tên nhà cung cấp (đổi nhà cung cấp thì không phải sửa màn).
    expect(ui).not.toMatch(/Gửi nháp lên VIN/);
  });

  it("[GNV-W5] cổng VIN cho nháp: hỏi tạm dừng ký (mục GUI) TRƯỚC, chỉ VIN-HOADON, KHÔNG đòi cách ký (HSM chưa kích hoạt vẫn thử được)", () => {
    const g = doc("lib/finance/hoa-don/ket-noi/cong-theo-phap-nhan.ts");
    const h = g.slice(g.indexOf("export async function layCongNhapVinChoPhapNhan"), g.indexOf("export async function moiTruongSanSangHsm"));
    expect(h.indexOf('chanNeuTamDung(phapNhanMa, "GUI")')).toBeGreaterThan(0);
    expect(h).toContain('ketQua.nhaCungCap !== "VIN_HOADON"');
    expect(h).not.toContain("phuongThucKy");
  });
});

// [11/11/2026] «Bỏ khỏi Nháp» — bấm nhầm «Gửi nháp» thì đưa dòng về «Chờ xuất». Hành vi thuần canh ở dong-hang-cho.test.ts [DHC-NHAP-BO]; action ở _actions.bo-nhap.test.ts [BNV-A*].
// Ở đây ghim DÂY NỐI mà ca hành vi không chứng minh được (gỡ dây ⇒ chúng vẫn xanh vì gọi hàm trực tiếp / mock loader).
describe("[BNV-W] dây nối của «Bỏ khỏi Nháp»", () => {
  const loader = doc("lib/finance/hoa-don/hang-cho.ts");
  const dongHang = doc("lib/finance/hoa-don/dong-hang-cho.ts");
  const action = doc("app/(admin)/admin/payments/hoa-don/_actions.ts");
  const ui = doc("app/(admin)/admin/payments/hoa-don/_components/phat-hanh-misa.tsx");
  const ngan = doc("app/(admin)/admin/payments/hoa-don/_components/ngan-lan-thu.tsx");

  it("[BNV-W1] loader đọc CẢ HAI vết trong MỘT câu `auditLog.findMany` (không thêm nhịp tuần tự — [DST-01]) và đưa vết bỏ xuống dựng dòng", () => {
    expect(loader.match(/auditLog\.findMany\(/g)).toHaveLength(1);
    expect(loader).toMatch(/action:\s*\{\s*in:\s*\["GUI_NHAP_VIN",\s*"BO_NHAP_VIN"\]\s*\}/);
    expect(loader).toContain("nhapDaBo: nguon.nhapDaBoTheoDon.get(d.id)");
    expect(loader).toContain('v.action === "BO_NHAP_VIN"');
  });

  it("[BNV-W2] dòng hàng chờ truyền `don.nhapDaBo` vào phép tính cờ — quên truyền ⇒ bỏ xong dòng vẫn kẹt ở tab Nháp", () => {
    expect(dongHang).toContain("nhapDaGuiCuaLanThu(don.nhapDaGui, lt.key, ghiNhanMoiNhat(don.payments, lt.khoanIds), don.nhapDaBo)");
  });

  it("[BNV-W3] action: cổng kế toán → dòng loader dựng lại → PHẢI đang là «đã gửi nháp» → mới ghi vết; không chạm VIN, không đòi công tắc phát hành", () => {
    const h = action.slice(action.indexOf("export async function boKhoiNhapHoaDonVinAction"), action.indexOf("function veKetQua"));
    const thuTu = ["congKeToanDon(", "dongCuaLanThu(", "!row.daGuiNhap", "boDanhDauNhapVin("].map((k) => h.indexOf(k));
    expect(thuTu.every((i) => i > 0), thuTu.join(",")).toBe(true);
    expect([...thuTu].sort((a, b) => a - b)).toEqual(thuTu);
    expect(h).not.toMatch(/guiNhapLenVin\(|luuNhap\(|layCongNhapVin|laMisaPhatHanhBat/);
    expect(h).toContain("lanThuKey: row.key");
  });

  it("[BNV-W4] giao diện: khối «Bỏ khỏi Nháp» chỉ vẽ khi dòng loader nói đã gửi nháp, độc lập nút Phát hành, gọi đúng action chỉ với (đơn, khoá)", () => {
    expect(ngan).toMatch(/!dong\.hoaDonNhap && dong\.daGuiNhap \? <BoKhoiNhap /);
    expect(ui).toContain("boKhoiNhapHoaDonVinAction({ orderId: dong.orderId, lanThuKey: dong.key })");
    // Nói thật: không hứa xoá bản nháp ở nhà cung cấp.
    expect(ui).toMatch(/xoá bản nháp<\/b>/);
  });
});
