// PORT từ repo hodacphuchtc/DISC · tests/checksum.test.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c (chỉ đổi đường dẫn import).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { NGAN_HANG, PHIEN_BAN_BO_DE } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import daKhoa from "@/lib/disc/engine-goc/config/disc-checksum.json";
import { bamNganHang, chuoiChuanTac } from "@/lib/disc/engine-goc/modules/core/bo-de/bam";

const bam = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("khoá ngân hàng câu bằng checksum", () => {
  it("nội dung ngân hàng KHỚP với bản đã khoá", () => {
    expect(
      bamNganHang(NGAN_HANG, bam),
      "Nội dung ngân hàng câu đã đổi so với bản đã khoá.\n" +
        "Sửa nội dung một câu là ĐỔI Ý NGHĨA CỦA ĐIỂM SỐ — bài cũ và bài mới không còn so " +
        "được với nhau, nhưng vùng lệch vẫn sẽ tính và vẫn ra một con số đầy thuyết phục.\n" +
        "Cách xử lý: TĂNG `PHIEN_BAN_BO_DE` trong config/disc-cau-hoi.ts, rồi chạy\n" +
        "  node scripts/sinh-checksum.mjs",
    ).toBe(daKhoa.bam);
  });

  it("phiên bản trong ngân hàng KHỚP với phiên bản đã khoá", () => {
    expect(PHIEN_BAN_BO_DE).toBe(daKhoa.phienBanBoDe);
  });

  it("băm ổn định — chạy hai lần ra cùng kết quả", () => {
    expect(bamNganHang(NGAN_HANG, bam)).toBe(bamNganHang(NGAN_HANG, bam));
  });

  it("băm KHÔNG phụ thuộc thứ tự khoá của object", () => {
    const daoThuTu = Object.fromEntries(
      Object.entries(NGAN_HANG).reverse(),
    ) as typeof NGAN_HANG;
    expect(bamNganHang(daoThuTu, bam)).toBe(bamNganHang(NGAN_HANG, bam));
  });

  it("đổi MỘT CHỮ trong một câu ⇒ băm đổi", () => {
    const sua = structuredClone(NGAN_HANG) as typeof NGAN_HANG;
    const cau = sua.THCS.cau as unknown as { noiDung: string }[];
    cau[0].noiDung = `${cau[0].noiDung}.`;
    expect(bamNganHang(sua, bam)).not.toBe(bamNganHang(NGAN_HANG, bam));
  });

  it("đổi NHÃN THANG cũng làm băm đổi — đó cũng là đổi thứ người ta đang trả lời", () => {
    const sua = structuredClone(NGAN_HANG) as typeof NGAN_HANG;
    const thang = sua.MN.thang as unknown as { nhan: string }[];
    thang[2].nhan = "Đôi khi";
    expect(bamNganHang(sua, bam)).not.toBe(bamNganHang(NGAN_HANG, bam));
  });

  it("đổi cột ĐẢO của một câu cũng làm băm đổi", () => {
    const sua = structuredClone(NGAN_HANG) as typeof NGAN_HANG;
    const cau = sua.THCS.cau as unknown as { dao: boolean }[];
    cau[0].dao = !cau[0].dao;
    expect(bamNganHang(sua, bam)).not.toBe(bamNganHang(NGAN_HANG, bam));
  });

  it("chuỗi chuẩn tắc luôn ở dạng NFC", () => {
    const s = chuoiChuanTac(NGAN_HANG);
    expect(s).toBe(s.normalize("NFC"));
    expect(s.length).toBeGreaterThan(1000);
  });
});
