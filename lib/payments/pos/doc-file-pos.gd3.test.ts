// [POS3-03..05] — GĐ3 POS: đọc zip NHIỀU phần + thiếu cột ⇒ từ chối CẢ FILE (docs/pos-gd3-thiet-ke.md
// §3, §4). THUẦN — chạy trong `pnpm test:unit`.
//
// Fixture `tests/fixtures/pos/smartpos-gd3.ts` dựng từ hình dạng file thật đã che (65 cột, data
// descriptor, dòng Hủy âm) — 10 dòng chia `_000` + `_001`.
import { describe, expect, it } from "vitest";
import { docFilePos } from "./doc-file-pos";
import { COT_BAT_BUOC, dongPosSchema } from "./kieu";
import { phanLoaiDongPos } from "./phan-loai-pos";
import { sinhMa } from "@/lib/payments/ma-phieu";
import { HEADER_THAT, THU_MUC_CS1, dungXlsxThat } from "@/tests/fixtures/pos/smartpos-that";
import {
  GD3,
  MA_CHI_O_001,
  SO_THE_DAY_DU,
  TEN_CHU_THE_GIA,
  boCot,
  dungDongGd3,
  dungZipCacPhan,
  dungZipGd3,
  type MaPhieuGd3,
} from "@/tests/fixtures/pos/smartpos-gd3";

// Mã phiếu HỢP LỆ (qua checksum) — ở ca DB chúng do `taoPhieuGop` cấp.
const MA: MaPhieuGd3 = {
  thu: [sinhMa(101), sinhMa(202), sinhMa(303)],
  capHuy: sinhMa(404),
  trongGhiChu: [sinhMa(505), sinhMa(606)],
};

const CTX = { thietBiDaGan: true, biHuyTrongLo: false, biHoanMotPhan: false } as const;

describe("[POS3-DOC] zip nhiều phần + thiếu cột", () => {
  it("[POS3-03] zip _000 + _001 ⇒ đọc đủ 10 dòng của CẢ HAI phần; nhóm 3/5/2; chỉ 18 khoá; số thẻ đã che", async () => {
    const kq = await docFilePos(await dungZipGd3(MA), "29092026_USER_TXN.zip");
    if (!kq.ok) throw new Error(`docFilePos từ chối: ${kq.loi}`);
    expect(kq.soFileXlsx).toBe(2);
    expect(kq.dong).toHaveLength(10);
    const ma = new Set(kq.dong.map((d) => d.maGiaoDich));
    // Mọi mã CHỈ có ở `_001` phải có mặt — đọc mục đầu của zip thôi là mất đúng 4 dòng này.
    for (const m of MA_CHI_O_001) expect(ma.has(m), `dòng ${m} của _001`).toBe(true);

    const thanhCong = kq.dong.filter(
      (d) => d.loaiGiaoDich === "Thanh toán" && d.trangThai === "Thành công" && d.trangThaiHoanHuy === null,
    );
    const thatBai = kq.dong.filter((d) => d.trangThai === "Thất bại");
    const cap = kq.dong.filter((d) => d.maGiaoDich === GD3.goc || d.maGiaoDich === GD3.huy);
    expect([thanhCong.length, thatBai.length, cap.length]).toEqual([3, 5, 2]);
    // Mọi dòng thất bại đều có ghi chú — đúng điều file thật không có (Phụ lục A.3).
    for (const d of thatBai) expect(d.dienGiai.trim(), d.maGiaoDich).not.toBe("");
    // Ghi chú thành công mang ĐÚNG MỘT mã ⇒ đi khớp; cặp hủy liên kết đúng gốc, Hủy âm.
    for (const d of thanhCong) expect(phanLoaiDongPos(d, CTX).loai, d.dienGiai).toBe("THU");
    const huy = kq.dong.find((d) => d.maGiaoDich === GD3.huy)!;
    expect(huy.maGiaoDichGoc).toBe(GD3.goc);
    expect(huy.soTien).toBeLessThan(0);

    const khoa = Object.keys(dongPosSchema.shape).sort();
    for (const d of kq.dong) {
      expect(Object.keys(d).sort()).toEqual(khoa);
      expect(Object.values(d), "tên chủ thẻ không vào DongPos").not.toContain(TEN_CHU_THE_GIA);
      if (d.soTheMasked !== null) {
        expect(d.soTheMasked).toContain("*");
        expect(d.soTheMasked).not.toMatch(/(?<!\d)\d{13,19}(?!\d)/);
      }
    }
    // File lỡ không che số thẻ ⇒ tầng đọc tự che.
    expect(kq.dong.find((d) => d.maGiaoDich === GD3.thu[2])!.soTheMasked).toBe(
      `${SO_THE_DAY_DU.slice(0, 6)}******${SO_THE_DAY_DU.slice(-4)}`,
    );
  });

  it("[POS3-04] zip: _000 đủ cột, _001 thiếu 'Phí giao dịch' ⇒ từ chối CẢ zip, nêu tên phần + cột", async () => {
    const { phan000, phan001 } = dungDongGd3(MA);
    const bo = boCot(phan001, "Phí giao dịch");
    const kq = await docFilePos(
      await dungZipCacPhan(THU_MUC_CS1, [{ dong: phan000 }, { dong: bo.dong, header: bo.header }]),
      "29092026_USER_TXN.zip",
    );
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.cotThieu).toEqual(["Phí giao dịch"]);
    expect(kq.loi).toContain("_001.xlsx");
    expect(kq.loi).toContain("Phí giao dịch");
    // `ok: false` không mang dòng nào — kể cả 6 dòng hợp lệ của `_000`.
    expect("dong" in kq).toBe(false);

    // Đối chứng dương: cùng zip, `_001` đủ cột ⇒ đọc được.
    const du = await docFilePos(await dungZipCacPhan(THU_MUC_CS1, [{ dong: phan000 }, { dong: phan001 }]), "z.zip");
    expect(du.ok).toBe(true);
  });

  it("[POS3-05] bỏ LẦN LƯỢT từng cột trong 18 cột bắt buộc ⇒ cotThieu đúng bằng [cột đó]", async () => {
    const { phan000 } = dungDongGd3(MA);
    expect(COT_BAT_BUOC).toHaveLength(18);
    for (const cot of COT_BAT_BUOC) {
      const bo = boCot(phan000, cot);
      expect(bo.header).toHaveLength(HEADER_THAT.length - 1);
      const kq = await docFilePos(await dungXlsxThat(bo.dong, { header: bo.header }), "29092026_TXN_000.xlsx");
      expect(kq.ok, `bỏ "${cot}" phải bị từ chối`).toBe(false);
      if (kq.ok) continue;
      // Khớp TÊN ĐÚNG, không khớp tiền tố: bỏ "Mã giao dịch" thì "Mã giao dịch TCB/thẻ/gốc" không lấp chỗ.
      expect(kq.cotThieu, cot).toEqual([cot]);
      expect(kq.loi, cot).toContain(cot);
    }
    // Đối chứng dương: header đầy đủ ⇒ đọc được.
    const du = await docFilePos(await dungXlsxThat(phan000), "29092026_TXN_000.xlsx");
    expect(du.ok).toBe(true);
  });
});
