// [TDG-*] — câu báo sau gỡ gắn phải nói ĐÚNG trạng thái cuối (luật 12). THUẦN + lưới ghim.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { thongDiepGoGan } from "./thong-diep-go-gan";
import { LY_DO_THE_HOAN_MOT_PHAN, LY_DO_THE_LUON_DONG } from "./phieu-gop-go-gan";

const co = { tienDao: 6_732_000, soDongDao: 2 };

describe("[TDG] thông báo gỡ gắn", () => {
  it("[TDG-01] giao dịch thẻ đã hủy/hoàn (IGNORED) ⇒ nói 'Bỏ qua', KHÔNG nói 'về hàng chờ'", () => {
    const s = thongDiepGoGan({ ...co, trangThaiGiaoDich: "IGNORED", phieuGop: [] });
    expect(s).toContain("Bỏ qua");
    expect(s).not.toContain("Giao dịch về hàng chờ");
    expect(s).toContain("6.732.000đ");
  });

  it("[TDG-02] UNMATCHED ⇒ 'về hàng chờ'; phiếu gộp mở lại / đóng được nói ra, GIỮ thì im", () => {
    const s = thongDiepGoGan({
      ...co,
      trangThaiGiaoDich: "UNMATCHED",
      phieuGop: [
        { ma: "K7M2N", hanhDong: "MO_LAI", conPhaiThu: 6_732_000, lyDo: "Mở lại phiếu" },
        { ma: "ACDEQ", hanhDong: "DONG", conPhaiThu: 100, lyDo: "Đơn đã có phiếu gộp khác đang mở" },
        { ma: "ZZZZZ", hanhDong: "GIU", conPhaiThu: 0, lyDo: "giữ" },
      ],
    });
    expect(s).toContain("Giao dịch về hàng chờ.");
    expect(s).toContain("Phiếu gộp K7M2N mở lại — mã cũ thu lại 6.732.000đ.");
    // Rà vòng 6 (hoàn lại đổi của vòng Q-M): chuyển khoản ra ĐÓNG vì lý do TRẠNG THÁI (có phiếu mở khác, đơn
    // không nhận tiền, đợt huỷ) thì "phát mã mới" chắc chắn bị `taoPhieuGop` từ chối ⇒ giữ câu cũ.
    expect(s).toContain("Phiếu gộp ACDEQ đã đóng — mã cũ không tự khớp nữa.");
    expect(s).not.toContain("phát mã mới");
    expect(s).not.toContain("ZZZZZ");
  });

  it("[TDG-03] Q-M: gỡ gắn THẺ ⇒ câu nói ĐÚNG 'mã <MÃ> đã ĐÓNG — phát mã mới nếu cần thu lại' (cả hoàn một phần)", () => {
    const s = thongDiepGoGan({
      ...co,
      trangThaiGiaoDich: "UNMATCHED",
      phieuGop: [{ ma: "K7M2N", hanhDong: "DONG", conPhaiThu: 6_732_000, lyDo: LY_DO_THE_LUON_DONG }],
    });
    expect(s).toBe(
      "Đã gỡ 6.732.000đ (2 bút toán đảo). Giao dịch về hàng chờ. Phiếu gộp: mã K7M2N đã ĐÓNG — phát mã mới nếu cần thu lại.",
    );
    expect(s, "không hứa mã cũ thu lại").not.toContain("mở lại");
    const hoan = thongDiepGoGan({
      ...co,
      trangThaiGiaoDich: "IGNORED",
      phieuGop: [{ ma: "K7M2N", hanhDong: "DONG", conPhaiThu: 6_732_000, lyDo: LY_DO_THE_HOAN_MOT_PHAN }],
    });
    expect(hoan).toContain("Phiếu gộp: mã K7M2N đã ĐÓNG — phát mã mới nếu cần thu lại.");
  });

  it("[TDG-04] rà vòng 6 — phiếu 0đ bị khép để nhường chỗ ⇒ 'đã khép (không còn phải thu)', không mời phát mã", () => {
    const s = thongDiepGoGan({
      ...co,
      trangThaiGiaoDich: "UNMATCHED",
      phieuGop: [
        { ma: "WT9GX", hanhDong: "DONG", conPhaiThu: 0, lyDo: "Phiếu còn phải thu 0đ — khép để nhường chỗ cho phiếu mở lại" },
        { ma: "QHKMN", hanhDong: "MO_LAI", conPhaiThu: 3_168_000, lyDo: "Mở lại phiếu" },
      ],
    });
    expect(s).toContain("Phiếu gộp WT9GX đã khép (không còn phải thu).");
    expect(s).toContain("Phiếu gộp QHKMN mở lại — mã cũ thu lại 3.168.000đ.");
    expect(s).not.toContain("phát mã mới");
  });

  it("[TDG-W1] action gỡ gắn dựng câu bằng `thongDiepGoGan(kq)` — không in cứng 'về hàng chờ'", () => {
    const ma = readFileSync(resolve(process.cwd(), "app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(ma.match(/\bthongDiepGoGan\(kq\)/g)?.length ?? 0).toBe(1);
    expect(ma.match(/về hàng chờ/g)?.length ?? 0).toBe(0);
  });

  it("[TDG-W2] hộp xác nhận TRƯỚC khi gỡ không hứa cứng 'về lại hàng chờ' (thẻ đã hủy/hoàn sang Bỏ qua)", () => {
    const ma = readFileSync(resolve(process.cwd(), "app/(admin)/admin/bien-dong-so-du/_components/go-gan-giao-dich.tsx"), "utf8");
    expect(ma).toMatch(/Bỏ qua/);
  });

  it("[TDG-W3] Q-M: hộp xác nhận NÓI TRƯỚC 'mã phiếu gộp sẽ ĐÓNG' cho giao dịch THẺ — bảng truyền `laThe` từ provider", () => {
    const hop = readFileSync(resolve(process.cwd(), "app/(admin)/admin/bien-dong-so-du/_components/go-gan-giao-dich.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(hop).toMatch(/\{laThe && \(/);
    // Rà vòng 6: chỉ phiếu mà tiền này đã trả / đã lấp mới ĐÓNG — phiếu phát SAU khi gắn (không tính số
    // của nó) giữ nguyên; câu nói trước phải nói đúng phạm vi đó.
    expect(hop).toContain("mã phiếu gộp mà tiền này đã trả hoặc đã lấp sẽ ĐÓNG, không mở lại — phát mã mới nếu cần thu lại.");
    expect(hop).toContain("Phiếu phát SAU khi gắn khoản này giữ nguyên.");
    // `laThe` BẮT BUỘC (không mặc định) — mặc định `false` là lỗi câm luật 11: dòng cảnh báo biến mất.
    expect(hop).toMatch(/\n\s*laThe: boolean;/);
    const bang = readFileSync(resolve(process.cwd(), "app/(admin)/admin/bien-dong-so-du/_components/bank-txn-client.tsx"), "utf8");
    expect(bang.match(/laThe=\{i\.provider === PROVIDER_THE_POS\}/g)?.length ?? 0).toBe(1);
  });
});
