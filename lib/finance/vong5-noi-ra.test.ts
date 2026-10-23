// [V5-NT-*] [V5-W*] [MG-CH-*] — rà đối kháng vòng 5 (30/09/2026): các lời NÓI TRƯỚC / NÓI SAU (luật
// 12) và dây nối của chúng. THUẦN + lưới ghim mã nguồn. Hành vi thật (Postgres):
// `tests/finance/pos-vong5.test.ts` + `tests/finance/doi-khoa.test.ts` `[V5-10]`.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canhBaoTruocHuyDon,
  canhBaoTruocPhieuCuaCon,
  canhBaoTruocVoidDot,
  quyetPhieuDoiSo,
  thongDiepPhieuKhiHuyDon,
} from "./soat-phieu-gop";
import { canhBaoMienGiamChuaHapThu } from "./mien-giam";
import { conPhaiThuCuaPhieu, chiaTheoPhieuGop } from "@/lib/payments/chia-phieu-gop";

function ma(tep: string): string {
  return readFileSync(resolve(process.cwd(), tep), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}
const dem = (s: string, re: RegExp) => s.match(new RegExp(re.source, "g"))?.length ?? 0;

const PHIEU = { ma: "K7M2N", daNhan: 0, dong: [{ paymentRequestId: "d1" }, { paymentRequestId: "d2" }] };

describe("[V5-NT] câu nói trước / nói sau", () => {
  it("[V5-NT-01] huỷ đơn: nói trước mã của cả nhà, KHÔNG mời 'phát mã mới'; phiếu đã nhận ⇒ ĐÓNG", () => {
    const cb = canhBaoTruocHuyDon(PHIEU);
    expect(cb?.tieuDe).toBe("Mã phiếu K7M2N của cả nhà sẽ bị HUỶ");
    expect(cb?.chiTiet).not.toMatch(/phát mã mới/);
    expect(canhBaoTruocHuyDon({ ...PHIEU, daNhan: 1_000_000 })?.dich).toBe("CLOSED");
    expect(canhBaoTruocHuyDon(null), "không phiếu ⇒ im").toBeNull();
  });

  it("[V5-NT-02] huỷ đơn: câu SAU nêu mã, không mời phát mã mới; không phiếu ⇒ null", () => {
    expect(thongDiepPhieuKhiHuyDon([{ ma: "K7M2N", dich: "VOID" }])).toBe(
      "Phiếu gộp K7M2N đã HUỶ — báo phụ huynh bỏ QR cũ; tiền chuyển theo mã đó sẽ không vào đơn.",
    );
    expect(thongDiepPhieuKhiHuyDon([])).toBeNull();
  });

  it("[V5-NT-03] đổi khoá / dừng học: nói trước từ bản xem trước máy chủ — HUỶ / ĐÓNG đúng ranh giới", () => {
    expect(canhBaoTruocPhieuCuaCon({ ma: "AB12C", daNhan: 0, hanhDong: "HUY" })?.tieuDe).toBe("Mã phiếu AB12C của cả nhà sẽ bị HUỶ");
    expect(canhBaoTruocPhieuCuaCon({ ma: "AB12C", daNhan: 500_000, hanhDong: "DONG" })?.dich).toBe("CLOSED");
    expect(canhBaoTruocPhieuCuaCon(null)).toBeNull();
  });

  it("[V5-NT-04] đổi SỐ đợt: cùng ranh giới HUỶ/ĐÓNG, câu chữ nói 'đổi số tiền'", () => {
    expect(quyetPhieuDoiSo({ daNhan: 0 }).dich).toBe("VOID");
    expect(quyetPhieuDoiSo({ daNhan: 1 }).dich).toBe("CLOSED");
    const cb = canhBaoTruocVoidDot(PHIEU, [], ["d1"]);
    expect(cb?.chiTiet).toMatch(/^Thao tác này huỷ \/ đổi số tiền 1\/2 đợt/);
    expect(canhBaoTruocVoidDot(PHIEU, [], ["khac"]), "đợt đổi số không nằm trong phiếu ⇒ im").toBeNull();
  });

  it("[MG-CH-01] miễn giảm không trừ được vào đợt nào ⇒ NÓI RA số và hệ quả", () => {
    expect(canhBaoMienGiamChuaHapThu(1_000_000)).toMatch(/^1\.000\.000đ không trừ được vào đợt nào của bé — phiếu thu \/ mã QR của đơn VẪN ĐÒI SỐ CŨ/);
  });

  it("[MG-CH-02] đối chứng: trừ hết vào đợt ⇒ im", () => {
    expect(canhBaoMienGiamChuaHapThu(0)).toBeNull();
  });

  it("[V5-NT-05] dung sai: đợt đủ nhờ phần THA không còn bị đòi — phiếu 0đ, không chia 2.000đ vào nó", () => {
    const dong = [{ paymentRequestId: "a", sortOrder: 1, amount: 3_168_000, amountDue: 3_168_000, daRot: 3_166_000, daTha: 2_000 }];
    expect(conPhaiThuCuaPhieu(dong)).toBe(0);
    expect(chiaTheoPhieuGop(2_000, { billId: "b", trangThai: "OPEN", dong }).chia).toBe(false);
    // Đối chứng dương: không có phần tha ⇒ còn đòi đúng 2.000.
    expect(conPhaiThuCuaPhieu([{ ...dong[0]!, daTha: 0 }])).toBe(2_000);
  });
});

describe("[V5-W] dây nối — nói ra ở ĐÚNG màn, bằng ĐÚNG kết quả của đường ghi", () => {
  it("[V5-W1] hộp đổi trạng thái: nói trước khi chọn Đã huỷ + toast đọc `thongDiepPhieu` của action", () => {
    const t = ma("app/(admin)/admin/orders/_components/order-detail-client.tsx");
    expect(t).toContain('const canhBaoHuyDon = newStatus === "CANCELLED" ? canhBaoTruocHuyDon(phieuGop) : null;');
    expect(dem(t, /<CanhBaoPhieuTruoc canhBao=\{canhBaoHuyDon\} \/>/)).toBe(1);
    expect(t).toContain('nhanNutKemPhieu("Xác nhận", canhBaoHuyDon)');
    expect(t).toMatch(/if \(result\.thongDiepPhieu\) \{\s*\n\s*toast\.warning\(result\.thongDiepPhieu/);
  });

  it("[V5-W2] đổi khoá: xem trước lấy phiếu bằng CÙNG hàm dừng học; kết quả mang câu từ `dung.phieuGop`; hộp vẽ + toast", () => {
    const db = ma("lib/finance/doi-khoa-db.ts");
    expect(db).toContain("const phieuGop = await docPhieuGopChoXemTruoc(input.orderId, bc.dong.id);");
    expect(db).toContain("thongDiepPhieu: thongDiepPhieuDaSoat(dung.phieuGop ? [dung.phieuGop] : []),");
    const dh = ma("lib/finance/dung-hoc-con.ts");
    expect(dh).toMatch(/phieuGop: phieu\?\.coDongCuaCon \? \{ ma: phieu\.ma, dich: phieu\.daNhan > 0 \? "CLOSED" : "VOID" \} : null,/);
    const ui = ma("app/(admin)/admin/orders/_components/doi-khoa-dialog.tsx");
    expect(ui).toContain("canhBaoTruocPhieuCuaCon(xem.phieuGop)");
    expect(dem(ui, /<CanhBaoPhieuTruoc canhBao=\{canhBaoPhieu\} \/>/)).toBe(1);
    expect(ui).toContain('nhanNutKemPhieu("Xác nhận đổi khoá", canhBaoPhieu)');
    expect(ui).toContain("if (r.thongDiepPhieu) toast.warning(r.thongDiepPhieu");
  });

  it("[V5-W3] miễn giảm: phần chưa hấp thụ được NÓI TRƯỚC (cùng hàm đường ghi) và NÓI SAU (`r.chuaHapThu`)", () => {
    const t = ma("app/(admin)/admin/orders/_components/cong-no-theo-con.tsx");
    // ĐỔI CÁCH VIẾT 30/09/2026 (Q-L): bản vòng 5 ghim `keHoachHapThu({ dot: con.dotDangMo … }).chuaHapThuDuoc`.
    // Lý lẽ giữ nguyên; hàm nay là `keHoachMienGiam` (CHÍNH hàm `mienGiamNoChoCon` gọi), câu chỉ còn cho
    // luật cũ (bé có đợt theo con) — `chuaHapThuKhiMienGiam`.
    expect(t).toContain("canhBaoMienGiamChuaHapThu(chuaHapThuKhiMienGiam(keHoach))");
    expect(t).toContain("canhBaoMienGiamChuaHapThu(r.chuaHapThu)");
    expect(dem(t, /\{canhBaoChuaHapThu\}/)).toBe(1);
  });

  // [V5-W4] ĐÃ GỠ 30/09/2026 cùng `dongPhieuMoLaiKhiHoanSauGo` (`lib/finance/phieu-gop-hoan-sau-go.ts`): Q-M làm
  // lượt gỡ gắn THẺ không bao giờ mở lại phiếu gộp ⇒ nhật ký `TXN_GO_GAN` của giao dịch thẻ không còn vết
  // `MO_LAI` nào để hàm đó đóng — mã chết. Hành vi thay thế ghim ở `[V6-M04]` (tests/finance/pos-vong6.test.ts).

  it("[V5-W5] màn sửa kế hoạch: đơn thu theo con không có nút; bị R-02 chặn chắc chắn ⇒ in lý do, khoá nút, không hứa 'đóng mã'", () => {
    const t = ma("app/(admin)/admin/orders/_components/order-payment-section.tsx");
    expect(t).toContain("const thuTheoCon = donDangThuTheoCon(paymentRequests);");
    expect(dem(t, /canManage && !thuTheoCon && /)).toBe(2);
    expect(t).toContain("const chanLuu = chanTruocKhiLuuKeHoach({ phieu: paymentRequests, dots });");
    expect(t).toContain("disabled={pending || lech !== 0 || thieuHan >= 0 || !!chanLuu}");
  });
});
