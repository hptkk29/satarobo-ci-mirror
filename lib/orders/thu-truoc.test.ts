// [TT-*] "Thu trước (cọc)" — luật thuần + lưới ghim dây nối. Xem đầu `lib/orders/thu-truoc.ts`.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { kiemThuTruoc, LY_DO_KHONG_THU_TRUOC, lyDoKhongThuTruocDuoc, type DauVaoThuTruoc } from "./thu-truoc";

const HOM_NAY = new Date("2026-10-30T03:00:00Z"); // 10h sáng 30/10 giờ VN
const NUA_DEM_VN = new Date("2026-10-29T17:00:00Z"); // 00:00 30/10 giờ VN
const HAN_MAC_DINH = new Date("2026-11-28T17:00:00Z"); // 00:00 29/11 giờ VN (+30 ngày)

const SACH: DauVaoThuTruoc = {
  homNay: HOM_NAY,
  soTien: 3_000_000,
  tongDon: 10_000_000,
  trangThaiDon: "PENDING",
  laDonPhiHocBu: false,
  soKeHoachCu: 0,
  soPhieuDotDangSong: 0,
  tongDaNhan: 0,
};

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("[TT] thu trước — luật thuần", () => {
  it("[TT-01] đơn sạch + số tiền hợp lệ ⇒ đúng HAI đợt chưa thu, cộng lại bằng tổng đơn", () => {
    const r = kiemThuTruoc(SACH);
    expect(r).toEqual({
      ok: true,
      soTien: 3_000_000,
      conLai: 7_000_000,
      dots: [
        { amount: 3_000_000, daThu: false, dueDate: NUA_DEM_VN },
        { amount: 7_000_000, daThu: false, dueDate: HAN_MAC_DINH },
      ],
    });
  });

  it("[TT-02] số tiền: 0, âm, bằng tổng đơn, lớn hơn tổng, lẻ, NaN, chuỗi ⇒ từ chối", () => {
    for (const x of [0, -1, 10_000_000, 10_000_001, 1.5, Number.NaN, Infinity, "3000000", null, undefined]) {
      const r = kiemThuTruoc({ ...SACH, soTien: x });
      expect(r.ok, String(x)).toBe(false);
    }
  });

  it("[TT-03] biên: 1đ và tổng−1 vẫn được", () => {
    expect(kiemThuTruoc({ ...SACH, soTien: 1 }).ok).toBe(true);
    expect(kiemThuTruoc({ ...SACH, soTien: 9_999_999 }).ok).toBe(true);
  });

  it("[TT-04] mỗi lý do chặn ở cấp đơn đều chặn, và nói đúng câu của nó", () => {
    const ca: [Partial<DauVaoThuTruoc>, string][] = [
      [{ trangThaiDon: "CANCELLED" }, LY_DO_KHONG_THU_TRUOC.trangThai],
      [{ laDonPhiHocBu: true }, LY_DO_KHONG_THU_TRUOC.phiHocBu],
      [{ soKeHoachCu: 2 }, LY_DO_KHONG_THU_TRUOC.coKeHoach],
      [{ soPhieuDotDangSong: 1 }, LY_DO_KHONG_THU_TRUOC.coKeHoach],
      [{ tongDaNhan: 1 }, LY_DO_KHONG_THU_TRUOC.daNhanTien],
    ];
    for (const [thay, cau] of ca) {
      const v = { ...SACH, ...thay };
      expect(lyDoKhongThuTruocDuoc(v), JSON.stringify(thay)).toBe(cau);
      const r = kiemThuTruoc(v);
      expect(r).toEqual({ ok: false, loi: cau });
    }
  });

  it("[TT-06] hạn phần còn lại: chọn được; sai định dạng / quá khứ ⇒ từ chối; hôm nay thì được; cọc luôn đến hạn hôm nay", () => {
    const ok = kiemThuTruoc({ ...SACH, hanConLai: "2026-12-05" });
    expect(ok.ok && ok.dots[1].dueDate).toEqual(new Date("2026-12-04T17:00:00Z"));
    expect(ok.ok && ok.dots[0].dueDate).toEqual(NUA_DEM_VN);
    expect(kiemThuTruoc({ ...SACH, hanConLai: "2026-10-30" }).ok).toBe(true);
    for (const x of ["2026-10-29", "05/12/2026", "abc", 20261205, {}]) {
      expect(kiemThuTruoc({ ...SACH, hanConLai: x }).ok, String(x)).toBe(false);
    }
    expect(kiemThuTruoc({ ...SACH, hanConLai: "" }).ok).toBe(true); // trống ⇒ mặc định
  });

  it("[TT-05] đơn sạch ⇒ nút được bật (lý do = null); đơn 1đ quá nhỏ ⇒ chặn", () => {
    expect(lyDoKhongThuTruocDuoc(SACH)).toBeNull();
    expect(lyDoKhongThuTruocDuoc({ ...SACH, tongDon: 1 })).not.toBeNull();
  });
});

describe("[TT-W] lưới ghim dây nối (trang đơn là RSC, action chạm DB — không ca hành vi nào chạm tới)", () => {
  it("[TT-W1] action gác `payments:record` + scope, và gọi đúng MỘT lõi", () => {
    const a = boChuThich(doc("app/(admin)/admin/orders/_thu-truoc-actions.ts"));
    expect(a).toMatch(/checkPermission\(\s*["']payments:record["']/);
    expect(a).toMatch(/passesScope\(/);
    expect((a.match(/thuTruocChoDon\(/g) ?? []).length).toBe(1);
  });

  it("[TT-W2] lõi ghi: cổng `kiemThuTruoc` đứng TRƯỚC `recordInstallmentPlan`, và đọc tình trạng từ DB (không tin client)", () => {
    const g = boChuThich(doc("lib/orders/thu-truoc-ghi.ts"));
    const i = g.indexOf("kiemThuTruoc(");
    const j = g.indexOf("recordInstallmentPlan(");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect((g.match(/recordInstallmentPlan\(/g) ?? []).length).toBe(1);
    expect(g).toMatch(/docTinhTrangThuTruoc\(/);
  });

  it("[TT-W3] trang đơn tính `thuTruoc` bằng chính `lyDoKhongThuTruocDuoc` và chỉ khi có `payments:record`", () => {
    const p = boChuThich(doc("app/(admin)/admin/orders/[id]/page.tsx"));
    expect(p).toMatch(/thuTruoc=\{\s*canRecordPayments\s*\?/);
    expect((p.match(/lyDoKhongThuTruocDuoc\(/g) ?? []).length).toBe(1);
  });

  it("[TT-W5] cổng D chỉ mở cho ĐÚNG MỘT chỗ gọi: `choPhepDonPhamVi` mặc định tắt, chỉ `thu-truoc-ghi.ts` truyền `true`", () => {
    const inst = boChuThich(doc("lib/orders/installments.ts"));
    expect((inst.match(/!params\.choPhepDonPhamVi\s*&&\s*laDonPhamVi\(order\.items\)/g) ?? []).length).toBe(1);
    expect(inst).toMatch(/choPhepDonPhamVi\?:\s*boolean/);
    expect((boChuThich(doc("lib/orders/thu-truoc-ghi.ts")).match(/choPhepDonPhamVi:\s*true/g) ?? []).length).toBe(1);
    // Không nơi nào khác (app/ + lib/) truyền cờ này.
    const ra: string[] = [];
    const quet = (d: string) => {
      for (const e of readdirSync(resolve(process.cwd(), d), { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) { if (!["node_modules", ".next"].includes(e.name)) quet(p); }
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && /choPhepDonPhamVi:\s*true/.test(boChuThich(doc(p)))) ra.push(p);
      }
    };
    quet("lib"); quet("app");
    expect(ra).toEqual(["lib/orders/thu-truoc-ghi.ts"]);
  });

  it("[TT-W4] `thuTruoc` là prop BẮT BUỘC ở màn chi tiết đơn (luật 7)", () => {
    const c = boChuThich(doc("app/(admin)/admin/orders/_components/order-detail-client.tsx"));
    expect(c).toMatch(/^\s*thuTruoc:\s*\{/m);
    expect(c).not.toMatch(/thuTruoc\?:/);
  });
});
