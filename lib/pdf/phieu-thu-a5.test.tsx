// @vitest-environment node
// [PT5] Phiếu thu A5 cho 3 pháp nhân (brief 12/11/2026) — dựng PDF THẬT và đo: 1 trang, đúng pháp nhân, không CCCD, dấu nền theo trạng thái.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PhieuThuPdf, dauNenPhieu, type PhieuThuPdfData } from "@/lib/pdf/phieu-thu";
import { CAU_HINH_HOA_DON_MAC_DINH } from "@/lib/finance/hoa-don/phap-nhan";
import { KIEU_GIA, tinhDongHoaDon, tongHoaDon } from "@/lib/finance/hoa-don/tinh-hoa-don";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const CCCD = "048123456789";

function dung(pn: (typeof CAU_HINH_HOA_DON_MAC_DINH.phapNhan)[number], soDong: number, maPhieu: string | null): PhieuThuPdfData {
  const dong = Array.from({ length: soDong }, (_, i) =>
    tinhDongHoaDon({
      ten: `Học phí — Khoá Robotics cơ bản (Buổi ${i * 12 + 1}–${i * 12 + 12}) HV Nguyễn Gia Bảo`,
      donViTinh: "Lần",
      soLuong: 1,
      soTien: 1_000_000,
      thueSuat: 8,
      kieuGia: KIEU_GIA.DA_GOM_THUE,
    }),
  );
  return {
    maPhieu,
    ngayLap: "12/11/2026",
    phapNhan: pn,
    nguoiMua: { hoTen: "Mỹ Dung", tenDonVi: null, maSoThue: null, diaChi: "36A Trần Phú, TP. Đà Nẵng", cccd: CCCD, email: null, dienThoai: null, maKhachHang: null },
    hinhThucThanhToan: "sepay",
    dong,
    tong: tongHoaDon(dong),
    soTienBangChu: "Một triệu đồng./.",
    maDon: "ORD-261112-000004",
    nguoiThu: "Kế toán A",
  };
}

const soTrang = (b: Buffer) => (b.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

describe("[PT5] phiếu thu A5", () => {
  const ds = CAU_HINH_HOA_DON_MAC_DINH.phapNhan;

  it("[PT5-01] có đủ 3 pháp nhân với MST khác nhau (nguồn dữ liệu duy nhất là phap-nhan.ts)", () => {
    expect(ds.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ds.map((p) => p.maSoThue)).size).toBe(ds.length);
  });

  for (const soDong of [1, 5]) {
    it(`[PT5-02] mỗi pháp nhân × ${soDong} dòng ⇒ ĐÚNG 1 trang A5 và KHÔNG in CCCD`, async () => {
      for (const pn of ds) {
        const buf = await renderToBuffer(<PhieuThuPdf data={dung(pn, soDong, "PT-261112-000001")} />);
        expect(soTrang(buf), `${pn.ma} ${soDong} dòng`).toBe(1);
        // A5 = 419.53 × 595.28 pt.
        expect(buf.toString("latin1")).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+419\.\d+\s+595\.\d+\s*\]/);
        expect(buf.toString("latin1").includes(CCCD), pn.ma).toBe(false);
      }
    }, 60_000);
  }

  it("[PT5-03] dấu nền theo trạng thái: chờ xác nhận / đã thu / đã huỷ", () => {
    expect(dauNenPhieu({ maPhieu: null }).chu).toBe("CHỜ XÁC NHẬN");
    expect(dauNenPhieu({ maPhieu: "PT-1" }).chu).toBe("ĐÃ THU");
    expect(dauNenPhieu({ maPhieu: "PT-1", daHuy: true }).chu).toBe("ĐÃ HUỶ");
    // Huỷ thắng chờ: phiếu chưa số mà bị vô hiệu vẫn phải nói «ĐÃ HUỶ».
    expect(dauNenPhieu({ maPhieu: null, daHuy: true }).chu).toBe("ĐÃ HUỶ");
  });

  it("[PT5-04] tờ phiếu chỉ có HAI ô ký, không dòng CCCD, không số lẻ ở đơn giá (lưới ghim mã)", () => {
    const s = doc("lib/pdf/phieu-thu.tsx");
    expect(s).toContain("Người nộp tiền");
    expect(s).toContain("Người thu tiền");
    expect(s).not.toMatch(/Người lập phiếu/);
    expect(s).not.toMatch(/nm\.cccd/);
    expect(s).toContain("formatVndPlain(Math.round(n))");
    expect(s).toContain('size="A5"');
  });
});

describe("[PT5-W] ba nơi tải phiếu cùng dựng bằng MỘT hàm", () => {
  it("[PT5-W1] kế toán · Sale ở trang đơn · phụ huynh đều gọi taoPdfPhieuThu", () => {
    for (const f of [
      "app/(admin)/admin/payments/[id]/phieu-thu/route.ts",
      "app/(admin)/admin/orders/[id]/phieu-thu/[paymentId]/route.ts",
      "lib/portal/phieu-thu-ph.ts",
    ]) {
      expect(doc(f), f).toContain("taoPdfPhieuThu(");
    }
  });

  it("[PT5-W2] route của Sale: orders:view (không payments:manage), scopedDb, khoản phải thuộc ĐÚNG đơn trên URL", () => {
    const s = doc("app/(admin)/admin/orders/[id]/phieu-thu/[paymentId]/route.ts");
    expect(s).toContain('checkPermission("orders:view")');
    expect(s).not.toContain("payments:manage");
    expect(s).toContain("scopedDb(");
    expect(s).toContain("payment.orderId !== orderId");
  });

  it("[PT5-W3] route phụ huynh: PARENT · không chế độ học sinh · đồng ý chính sách · sở hữu trong where · luật nhóm chứng từ", () => {
    const r = doc("app/(portal)/portal/hoa-don/phieu-thu/[paymentId]/route.ts");
    expect(r).toContain('session.user.role !== "PARENT"');
    expect(r).toContain('ctx.cheDo === "hoc-sinh"');
    expect(r).toContain("hasAcceptedSitePolicy(");
    const l = doc("lib/portal/phieu-thu-ph.ts");
    expect(l).toMatch(/enrollment:\s*\{\s*studentId:\s*\{\s*in:\s*\[\.\.\.childIds\]\s*\}/);
    expect(l).toContain('huongChungTu(khoan.order) !== "PHIEU_THU"');
  });

  it("[PT5-W4] danh sách học phí chỉ vẽ nút tải phiếu theo cờ `coPhieuThuTai` (cùng hàm huongChungTu với route)", () => {
    expect(doc("lib/portal/billing.ts")).toContain('huongChungTu(p.order) === "PHIEU_THU"');
    expect(doc("components/portal/hoc-phi-phu-huynh.tsx")).toContain("r.coPhieuThuTai ? (");
  });

  it("[PT5-W5] trang đơn admin vẽ khối Phiếu thu phía TRÊN khối hoá đơn điện tử, kể cả khi cờ hoá đơn tắt", () => {
    const s = doc("app/(admin)/admin/orders/_components/order-detail-client.tsx");
    const phieu = s.indexOf("<KhoiPhieuThu");
    const hoaDon = s.indexOf("<KhoiHoaDon ");
    expect(phieu).toBeGreaterThan(0);
    expect(hoaDon).toBeGreaterThan(phieu);
    expect(s).toContain("{phieuThu.length > 0 ? (");
  });
});

describe("[PT6] phiếu thu gọn theo yêu cầu 12/11/2026", () => {
  it("[PT6-01] hình thức thanh toán chỉ ghi «Chuyển khoản» — không lộ SePay / payOS; hình thức khác giữ nhãn riêng", async () => {
    const { nhanHinhThuc } = await import("@/lib/pdf/phieu-thu");
    expect(nhanHinhThuc("sepay")).toBe("Chuyển khoản");
    expect(nhanHinhThuc("payos")).toBe("Chuyển khoản");
    expect(nhanHinhThuc("BANK_TRANSFER")).toBe("Chuyển khoản");
    expect(nhanHinhThuc("CASH")).toBe("Tiền mặt");
    expect(nhanHinhThuc("card_pos")).toBe("Quẹt thẻ (POS)");
  });

  it("[PT6-02] đầu phiếu dùng ẢNH logo thật; không còn nhãn «Pháp nhân mẹ» / «Cơ sở» dưới dòng hotline", () => {
    const s = doc("lib/pdf/phieu-thu.tsx");
    expect(s).toContain("<Image src={logoPhieu()}");
    expect(s).toContain("public/brand/logo-satarobo.png");
    expect(s).not.toMatch(/PHÁP NHÂN MẸ|HỆ THỐNG SATA ROBO|NHAN_PHAP_NHAN|nhanHieu/);
    expect(readFileSync(resolve(process.cwd(), "public/brand/logo-satarobo.png")).length).toBeGreaterThan(1000);
  });

  it("[PT6-03] chân trang KHÔNG nhắc nhà cung cấp hoá đơn (MISA/VIN) — phát hành bằng nhà nào là việc của kế toán; vẫn nói rõ KHÔNG phải hoá đơn", () => {
    const s = doc("lib/pdf/phieu-thu.tsx");
    expect(s).toContain("Đây KHÔNG phải hoá đơn giá trị gia tăng và không thay thế hoá");
    expect(s).not.toMatch(/phanMem|MISA meInvoice phát hành|mang tên pháp nhân này|Mã cơ quan thuế/);
    expect(s).toContain("Phiếu thu nội bộ — KHÔNG phải hoá đơn giá trị gia tăng");
  });

  it("[PT6-04] dựng PDF thật cho CS2 (New Vision) vẫn đúng 1 trang A5", async () => {
    const nv = CAU_HINH_HOA_DON_MAC_DINH.phapNhan.find((p) => p.ma === "NEW_VISION")!;
    const buf = await renderToBuffer(<PhieuThuPdf data={dung(nv, 2, "RCP-1")} />);
    const txt = buf.toString("latin1");
    expect((txt.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  });
});
