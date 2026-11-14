// @vitest-environment node
// [PT5-P] Pháp nhân in trên phiếu thu theo CẤU HÌNH HOÁ ĐƠN CỦA CƠ SỞ × NGÀY (cùng nguồn với màn hoá đơn), rơi về ánh xạ mặc định khi chưa có dòng.
import { beforeEach, describe, expect, it, vi } from "vitest";

const cauHinhFindMany = vi.fn();
vi.mock("@/lib/db", () => ({ db: { cauHinhHoaDonCoSo: { findMany: (...a: unknown[]) => cauHinhFindMany(...a) } } }));

import { phapNhanTheoCauHinhCoSo } from "./phieu-thu-khoan";
import { CAU_HINH_HOA_DON_MAC_DINH, phapNhanChoDon } from "@/lib/finance/hoa-don/phap-nhan";

const CAU_HINH = CAU_HINH_HOA_DON_MAC_DINH;
// Cột `hieuLucTu/Den` là `@db.Date` ⇒ Prisma trả `Date` nửa đêm UTC (sangDong đổi sang chuỗi yyyy-mm-dd).
const ngay = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dong = (o: Partial<{ id: string; centerId: string; phapNhanMa: string; hieuLucTu: string; hieuLucDen: string; dangBat: boolean }> = {}) => ({
  id: "c1", centerId: "co-so-nguyen-huu-tho", phapNhanMa: "STEM_ROBOTICS_AI", kyHieu: "1C26MAI", dangBat: true,
  ghiChu: null, taoBoiId: null, capNhatBoiId: null, updatedAt: new Date(), ...o,
  hieuLucTu: ngay(o.hieuLucTu ?? "2026-01-01"), hieuLucDen: ngay(o.hieuLucDen ?? "2026-12-31"),
});
const NGAY = new Date("2026-11-10T03:00:00Z");

beforeEach(() => cauHinhFindMany.mockReset());

describe("[PT5-P] pháp nhân theo cấu hình cơ sở", () => {
  it("[PT5-P1] CS1 có dòng cấu hình → STEM Robotics & AI, DÙ ánh xạ mặc định theo mã cơ sở vẫn là Sata Robo (lỗi mà brief nêu)", async () => {
    cauHinhFindMany.mockResolvedValue([dong()]);
    expect(phapNhanChoDon("CS1", CAU_HINH)?.ma).toBe("SATA_ROBO"); // đường cũ: sai pháp nhân
    const pn = await phapNhanTheoCauHinhCoSo("co-so-nguyen-huu-tho", NGAY, CAU_HINH);
    expect(pn?.ma).toBe("STEM_ROBOTICS_AI");
    expect(pn?.maSoThue).toBe("0402341056");
  });

  it("[PT5-P2] CS2 → New Vision khi có dòng; mỗi cơ sở tra ĐÚNG centerId của nó", async () => {
    cauHinhFindMany.mockResolvedValue([dong({ centerId: "co-so-hoang-dieu", phapNhanMa: "NEW_VISION" })]);
    const pn = await phapNhanTheoCauHinhCoSo("co-so-hoang-dieu", NGAY, CAU_HINH);
    expect(pn?.ma).toBe("NEW_VISION");
    expect((cauHinhFindMany.mock.calls[0]![0] as { where: { centerId: string } }).where.centerId).toBe("co-so-hoang-dieu");
  });

  it("[PT5-P3] không có dòng / ngoài khoảng hiệu lực / chồng ngày / không có cơ sở ⇒ null (rơi về mặc định, không đoán)", async () => {
    cauHinhFindMany.mockResolvedValue([]);
    expect(await phapNhanTheoCauHinhCoSo("co-so-nguyen-huu-tho", NGAY, CAU_HINH)).toBeNull();
    cauHinhFindMany.mockResolvedValue([dong({ hieuLucTu: "2026-01-01", hieuLucDen: "2026-06-30" })]);
    expect(await phapNhanTheoCauHinhCoSo("co-so-nguyen-huu-tho", NGAY, CAU_HINH)).toBeNull();
    cauHinhFindMany.mockResolvedValue([dong({ id: "a" }), dong({ id: "b", phapNhanMa: "NEW_VISION" })]);
    expect(await phapNhanTheoCauHinhCoSo("co-so-nguyen-huu-tho", NGAY, CAU_HINH)).toBeNull();
    expect(await phapNhanTheoCauHinhCoSo(null, NGAY, CAU_HINH)).toBeNull();
  });

  it("[PT5-P4] dòng cơ sở trỏ vào pháp nhân đã TẮT ở cấu hình chung ⇒ null (không in tên pháp nhân đã đóng)", async () => {
    cauHinhFindMany.mockResolvedValue([dong()]);
    const tat = { ...CAU_HINH, phapNhan: CAU_HINH.phapNhan.map((p) => (p.ma === "STEM_ROBOTICS_AI" ? { ...p, bat: false } : p)) };
    expect(await phapNhanTheoCauHinhCoSo("co-so-nguyen-huu-tho", NGAY, tat)).toBeNull();
  });

  it("[PT5-P5] taoPdfPhieuThu dùng cấu hình cơ sở TRƯỚC ánh xạ mặc định (lưới ghim thứ tự ưu tiên)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const s = readFileSync(resolve(process.cwd(), "lib/pdf/phieu-thu-khoan.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    const a = s.indexOf("phapNhanTheoCauHinhCoSo(payment.order?.centerId, payment.paidDate, cauHinh)");
    const b = s.indexOf("phapNhanChoDon(p.centerCode, cauHinh)");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });
});
