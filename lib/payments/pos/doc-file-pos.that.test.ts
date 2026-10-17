// [POS-THAT-xx] — docFilePos + phanLoaiDongPos trên HAI FILE THẬT (đã che) tải về 29/09/2026.
//
// Fixture `tests/fixtures/pos/smartpos-that.ts` giữ nguyên 65 cột, thứ tự cột, ô trống '', số
// tiền dạng Ô SỐ (dòng Hủy âm), và hình dạng zip của ngân hàng (data descriptor). Bộ ca này tồn
// tại vì fixture dựng theo ĐẶC TẢ không có mấy thứ chỉ file thật mới có:
//   · các cột TÊN GẦN TRÙNG: "Mã giao dịch" / "Mã giao dịch TCB" / "Mã giao dịch thẻ" /
//     "Mã giao dịch gốc", "Mã chuẩn chi" / "Mã chuẩn chi 2", "Mã hạch toán" / "Mã hạch toán giao
//     dịch gốc" — tìm cột theo tên phải KHỚP ĐÚNG, không khớp tiền tố;
//   · "Tên chủ thẻ" = "/" (không bao giờ được vào DongPos);
//   · dòng Hủy KHÔNG có "Mã chuẩn chi", KHÔNG có "Số thẻ".
import { describe, expect, it } from "vitest";
import { docFilePos } from "./doc-file-pos";
import { phanLoaiDongPos } from "./phan-loai-pos";
import { dongPosSchema, type DongPos } from "./kieu";
import {
  DONG_CS1,
  DONG_CS2,
  MAY_CS1,
  MAY_CS2,
  THU_MUC_CS1,
  THU_MUC_CS2,
  dungXlsxThat,
  dungZipThat,
} from "@/tests/fixtures/pos/smartpos-that";

async function doc(buf: Uint8Array, ten: string): Promise<DongPos[]> {
  const kq = await docFilePos(buf, ten);
  if (!kq.ok) throw new Error(`docFilePos từ chối: ${kq.loi} — thiếu ${kq.cotThieu.join(", ")}`);
  return kq.dong;
}

// Tập mã gốc bị hủy/hoàn dựng ĐÚNG như server (`nhapLoPos`): mỗi dòng hủy tự qua
// `phanLoaiDongPos` (chỉ dòng "Thành công" mới là HUY), tách toàn phần khỏi một phần.
function phanLoaiCaLo(dong: DongPos[]) {
  const ctx0 = { thietBiDaGan: true, biHuyTrongLo: false, biHoanMotPhan: false };
  const toanPhan = new Set<string>();
  const motPhan = new Set<string>();
  for (const d of dong) {
    const p = phanLoaiDongPos(d, ctx0);
    if (p.loai === "HUY" && p.maGoc) (p.toanPhan ? toanPhan : motPhan).add(p.maGoc);
  }
  return dong.map((d) => ({
    ma: d.maGiaoDich,
    kq: phanLoaiDongPos(d, {
      thietBiDaGan: true,
      biHuyTrongLo: toanPhan.has(d.maGiaoDich),
      biHoanMotPhan: !toanPhan.has(d.maGiaoDich) && motPhan.has(d.maGiaoDich),
    }),
  }));
}

describe("[POS-THAT] file SmartPOS thật (đã che)", () => {
  it("[POS-THAT-00] fixture giữ hình dạng zip của ngân hàng: mục xlsx ghi bằng data descriptor", async () => {
    // Mọi header cục bộ (PK\x03\x04) của mục TỆP: cờ general-purpose ở byte 6–7 có bit 3 (data
    // descriptor) và kích thước giải nén ở byte 22–25 = 0 — đúng thứ file ngân hàng mang.
    for (const buf of [await dungXlsxThat(DONG_CS1), await dungZipThat(THU_MUC_CS1, [DONG_CS1])]) {
      const b = Buffer.from(buf);
      const sig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      let soMucTep = 0;
      for (let i = b.indexOf(sig); i >= 0; i = b.indexOf(sig, i + 4)) {
        const ten = b.subarray(i + 30, i + 30 + b.readUInt16LE(i + 26)).toString();
        if (ten.endsWith("/")) continue;
        soMucTep++;
        expect(b.readUInt16LE(i + 6) & 0x08, ten).toBe(0x08);
        expect(b.readUInt32LE(i + 22), ten).toBe(0);
      }
      expect(soMucTep).toBeGreaterThan(0);
    }
  });

  it("[POS-THAT-01] zip CS1 (4 dòng) và CS2 (7 dòng) đọc đủ, mỗi dòng qua dongPosSchema", async () => {
    const cs1 = await doc(await dungZipThat(THU_MUC_CS1, [DONG_CS1]), "29092026_USER_TXN (1).zip");
    const cs2 = await doc(await dungZipThat(THU_MUC_CS2, [DONG_CS2]), "29092026_USER_TXN.zip");
    expect(cs1).toHaveLength(4);
    expect(cs2).toHaveLength(7);
    for (const d of [...cs1, ...cs2]) expect(dongPosSchema.safeParse(d).success).toBe(true);
    expect(new Set(cs1.map((d) => d.maThietBi))).toEqual(new Set([MAY_CS1]));
    expect(new Set(cs2.map((d) => d.maThietBi))).toEqual(new Set([MAY_CS2]));
    expect(new Set(cs1.map((d) => d.maQuay))).toEqual(new Set(["QTT45XWQT"]));
    expect(new Set(cs2.map((d) => d.maQuay))).toEqual(new Set(["QTTFBKATK"]));
  });

  it("[POS-THAT-02] cột tên gần trùng ra ĐÚNG cột; Hủy âm; giờ +07:00; phí trống ⇒ null", async () => {
    const cs2 = await doc(await dungZipThat(THU_MUC_CS2, [DONG_CS2]), "x.zip");
    for (const [i, d] of cs2.entries()) {
      const goc = DONG_CS2[i]!;
      expect(d.maGiaoDich).toBe(goc["Mã giao dịch"]);
      expect(d.maChuanChi).toBe(goc["Mã chuẩn chi"] ?? null);
      expect(d.maGiaoDichThe).toBe(goc["Mã giao dịch thẻ"] ?? null);
      expect(d.maGiaoDichGoc).toBe(goc["Mã giao dịch gốc"] ?? null);
      expect(d.maHachToan).toBeNull(); // file 29/09 chưa kết toán — "Mã hạch toán" trống, dù "Mã hạch toán giao dịch gốc" có giá trị ở dòng Hủy
      expect(d.phiGiaoDich).toBeNull();
      expect(d.soTien).toBe(goc["Số tiền thanh toán"]);
      expect(d.thoiGian).toBe(String(goc["Thời gian giao dịch"]).replace(/\//g, "-").replace(" ", "T") + "+07:00");
    }
    const huy = cs2.find((d) => d.loaiGiaoDich === "Hủy")!;
    expect(huy.soTien).toBe(-2000);
    expect(huy.maChuanChi).toBeNull();
    expect(huy.soTheMasked).toBeNull();
    expect(cs2.some((d) => d.maGiaoDich === huy.maGiaoDichGoc)).toBe(true);
  });

  it("[POS-THAT-03] 'Tên chủ thẻ' và mọi cột ngoài hợp đồng KHÔNG vào DongPos", async () => {
    const dong = await doc(await dungZipThat(THU_MUC_CS1, [DONG_CS1, DONG_CS2]), "x.zip");
    const khoa = Object.keys(dongPosSchema.shape).sort();
    for (const d of dong) {
      expect(Object.keys(d).sort()).toEqual(khoa);
      expect(Object.values(d)).not.toContain("/");
    }
  });

  it("[POS-THAT-04] phân loại đúng từng dòng thật", async () => {
    const cs1 = phanLoaiCaLo(await doc(await dungZipThat(THU_MUC_CS1, [DONG_CS1]), "a.zip"));
    const cs2 = phanLoaiCaLo(await doc(await dungZipThat(THU_MUC_CS2, [DONG_CS2]), "b.zip"));
    const dem = (xs: typeof cs1) =>
      xs.reduce<Record<string, number>>((m, x) => ((m[x.kq.loai] = (m[x.kq.loai] ?? 0) + 1), m), {});
    // CS1: 1 thành công không mã ⇒ CAN_XU_LY · 1 thất bại + 1 gốc đã hủy ⇒ BO_QUA · 1 dòng Hủy.
    expect(dem(cs1)).toEqual({ CAN_XU_LY: 1, BO_QUA: 2, HUY: 1 });
    // CS2: 2 thành công không mã ⇒ CAN_XU_LY · 3 thất bại + 1 gốc đã hủy ⇒ BO_QUA · 1 dòng Hủy.
    expect(dem(cs2)).toEqual({ CAN_XU_LY: 2, BO_QUA: 4, HUY: 1 });
    for (const x of [...cs1, ...cs2]) {
      if (x.kq.loai === "CAN_XU_LY") {
        expect(x.kq.lyDo).toMatch(/Không có mã phiếu/);
        expect(x.kq.taoGiaoDich).toBe(true);
      }
      if (x.kq.loai === "HUY") expect(x.kq.toanPhan).toBe(true);
    }
    // Dòng thất bại DUY NHẤT có ghi chú (một SĐT) vẫn BO_QUA — ghi chú không cứu giao dịch thất bại.
    const coGhiChu = DONG_CS2.find((d) => d["Diễn giải đơn hàng"])!;
    expect(cs2.find((x) => x.ma === coGhiChu["Mã giao dịch"])!.kq.loai).toBe("BO_QUA");
  });

  it("[POS-THAT-05] zip nhiều phần _000 + _001 ⇒ đọc đủ 11 dòng, đúng thứ tự phần", async () => {
    const kq = await docFilePos(await dungZipThat(THU_MUC_CS1, [DONG_CS1, DONG_CS2]), "gop.zip");
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.soFileXlsx).toBe(2);
    expect(kq.dong).toHaveLength(11);
    expect(kq.dong[0]!.maThietBi).toBe(MAY_CS1);
    expect(kq.dong[10]!.maThietBi).toBe(MAY_CS2);
  });

  it("[POS-THAT-06] upload thẳng .xlsx thật (không zip) cũng đọc được", async () => {
    const dong = await doc(await dungXlsxThat(DONG_CS2), "29092026_TXN_000.xlsx");
    expect(dong).toHaveLength(7);
  });
});
