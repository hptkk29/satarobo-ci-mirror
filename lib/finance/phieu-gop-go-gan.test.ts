// [PGG-*] — phiếu gộp SAU khi gỡ gắn giao dịch đã trả nó. THUẦN + lưới ghim mã nguồn.
//
// Hành vi trên Postgres thật: `tests/finance/pos-no-so-tien.test.ts` (`[PNS-01..07]`).
// Ở đây: (1) luật chọn phiếu + quyết định, (2) DÂY NỐI — test hành vi của `goGanTheoCon` chỉ đỏ
// khi dây nối gãy ở đúng ca có phiếu gộp, nên dây nối được ghim riêng (mẫu LƯỚI GHIM MÃ NGUỒN).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LY_DO_THE_LUON_DONG,
  nhanPhieuGop,
  phieuDoGiaoDichTra,
  quyetPhieuMoSauGoGan,
  quyetPhieuSauGoGan,
} from "./phieu-gop-go-gan";

type P = { id: string; matchKey: string | null; status: string; lines: { paymentRequestId: string }[] };
const bill = (id: string, matchKey: string | null, status: string, dot: string[]): P => ({
  id,
  matchKey,
  status,
  lines: dot.map((paymentRequestId) => ({ paymentRequestId })),
});
/** Đúng khuôn ghi chú mà `thuTheoPhieuGop` ghi (xem `[PGG-W2]`). */
const ghiChuPhieu = (ma: string, txn: string) => `${nhanPhieuGop(ma)} SEPAY ${txn} [auto:sepay:${txn}]`;

describe("[PGG] chọn phiếu do CHÍNH giao dịch vừa gỡ trả", () => {
  const dotVuaGo = new Set(["dot-a", "dot-b"]);

  it("[PGG-01] nhãn phiếu gộp — khuôn cố định, kết thúc bằng ' —'", () => {
    expect(nhanPhieuGop("ACDEQ")).toBe("Phiếu gộp ACDEQ —");
  });

  it("[PGG-02] PAID + có dòng vừa mất tiền + khoản vừa đảo mang nhãn phiếu ⇒ CHỌN", () => {
    const p = bill("b1", "ACDEQ", "PAID", ["dot-a", "dot-b"]);
    expect(phieuDoGiaoDichTra([p], dotVuaGo, [ghiChuPhieu("ACDEQ", "t1")])).toEqual([p]);
  });

  it("[PGG-03] khoản vừa đảo KHÔNG mang nhãn (gắn tay) ⇒ KHÔNG chọn, dù phiếu có dòng vừa mất tiền", () => {
    // Hình dạng `[PNS-05]`: phiếu được giao dịch KHÁC trả trọn — mở lại là đòi tiền lần hai.
    const p = bill("b1", "ACDEQ", "PAID", ["dot-a"]);
    expect(phieuDoGiaoDichTra([p], dotVuaGo, ["Gắn tay giao dịch SEPAY x [gan-tay:x]"])).toEqual([]);
    // Mã phiếu nằm TRẦN trong ghi chú (không có nhãn) cũng không tính.
    expect(phieuDoGiaoDichTra([p], dotVuaGo, ["SEPAY ACDEQ [auto:sepay:ACDEQ]"])).toEqual([]);
  });

  it("[PGG-04] hai phiếu PAID cùng chứa đợt ⇒ chỉ phiếu MANG NHÃN trong khoản vừa đảo", () => {
    const cu = bill("b-cu", "ACDEQ", "PAID", ["dot-a", "dot-b"]);
    const moi = bill("b-moi", "FGHJK", "PAID", ["dot-a", "dot-b"]);
    expect(phieuDoGiaoDichTra([cu, moi], dotVuaGo, [ghiChuPhieu("FGHJK", "t2")])).toEqual([moi]);
  });

  it("[PGG-05] nhãn đúng mà phiếu KHÔNG có dòng nào vừa mất tiền ⇒ KHÔNG chọn", () => {
    const p = bill("b1", "ACDEQ", "PAID", ["dot-khac"]);
    expect(phieuDoGiaoDichTra([p], dotVuaGo, [ghiChuPhieu("ACDEQ", "t1")])).toEqual([]);
  });

  it("[PGG-06] phiếu không PAID (OPEN/CLOSED/VOID) hoặc không mã ⇒ KHÔNG chọn", () => {
    const gc = [ghiChuPhieu("ACDEQ", "t1")];
    for (const st of ["OPEN", "CLOSED", "VOID"]) {
      expect(phieuDoGiaoDichTra([bill("b1", "ACDEQ", st, ["dot-a"])], dotVuaGo, gc), st).toEqual([]);
    }
    expect(phieuDoGiaoDichTra([bill("b1", null, "PAID", ["dot-a"])], dotVuaGo, [`${nhanPhieuGop(null)} x`])).toEqual([]);
  });
});

describe("[PGG] quyết phiếu PAID sau khi mất tiền", () => {
  it("[PGG-10] còn phải thu > 0, đơn nhận tiền, không phiếu mở khác ⇒ MỞ LẠI", () => {
    expect(quyetPhieuSauGoGan({ conPhaiThu: 6_732_000, donNhanTien: true, coPhieuMoKhac: false, coDotDaHuy: false, tinHieuThe: null, nguon: "CHUYEN_KHOAN" }).hanhDong).toBe("MO_LAI");
  });

  it("[PGG-11] đã có phiếu OPEN khác ⇒ ĐÓNG (không giữ PAID: 'ĐÃ THU ĐỦ' là câu sai)", () => {
    const q = quyetPhieuSauGoGan({ conPhaiThu: 6_732_000, donNhanTien: true, coPhieuMoKhac: true, coDotDaHuy: false, tinHieuThe: null, nguon: "CHUYEN_KHOAN" });
    expect(q.hanhDong).toBe("DONG");
    expect(q.lyDo).toContain("phiếu gộp khác đang mở");
  });

  it("[PGG-12] đơn không còn nhận tiền ⇒ ĐÓNG", () => {
    expect(quyetPhieuSauGoGan({ conPhaiThu: 1, donNhanTien: false, coPhieuMoKhac: false, coDotDaHuy: false, tinHieuThe: null, nguon: "CHUYEN_KHOAN" }).hanhDong).toBe("DONG");
  });

  it("[PGG-13] còn phải thu = 0 ⇒ GIỮ — đứng TRƯỚC mọi vế khác (không có gì để thu thì không đóng/mở)", () => {
    for (const [donNhanTien, coPhieuMoKhac] of [
      [true, false],
      [false, false],
      [true, true],
    ] as const) {
      expect(quyetPhieuSauGoGan({ conPhaiThu: 0, donNhanTien, coPhieuMoKhac, coDotDaHuy: false, tinHieuThe: null, nguon: "CHUYEN_KHOAN" }).hanhDong).toBe("GIU");
    }
    expect(quyetPhieuSauGoGan({ conPhaiThu: Number.NaN, donNhanTien: true, coPhieuMoKhac: false, coDotDaHuy: false, tinHieuThe: null, nguon: "CHUYEN_KHOAN" }).hanhDong).toBe("GIU");
  });

  it("[PGG-14] có dòng trỏ đợt ĐÃ VOID ⇒ ĐÓNG, không MỞ LẠI (rà vòng 3 — mở lại là mời trả lần hai vào đợt VOID)", () => {
    const q = quyetPhieuSauGoGan({ conPhaiThu: 6_732_000, donNhanTien: true, coPhieuMoKhac: false, coDotDaHuy: true, tinHieuThe: null, nguon: "CHUYEN_KHOAN" });
    expect(q.hanhDong).toBe("DONG");
    expect(q.lyDo).toContain("đợt đã bị huỷ");
    // Còn phải thu = 0 vẫn GIỮ (vế 1 đứng trước).
    expect(quyetPhieuSauGoGan({ conPhaiThu: 0, donNhanTien: true, coPhieuMoKhac: false, coDotDaHuy: true, tinHieuThe: null, nguon: "CHUYEN_KHOAN" }).hanhDong).toBe("GIU");
  });

  it("[PGG-15] thẻ HOÀN MỘT PHẦN ⇒ ĐÓNG, không MỞ LẠI (rà vòng 4 — số ròng còn ở công ty, mở lại là thu hai lần)", () => {
    const q = quyetPhieuSauGoGan({ conPhaiThu: 6_732_000, donNhanTien: true, coPhieuMoKhac: false, coDotDaHuy: false, tinHieuThe: "HOAN_MOT_PHAN", nguon: "THE_POS" });
    expect(q.hanhDong).toBe("DONG");
    expect(q.lyDo).toContain("hoàn MỘT PHẦN");
    // ĐỔI VÌ Q-M (30/09/2026): bản vòng 4 ghim "hủy TOÀN PHẦN ⇒ MỞ LẠI" làm đối chứng dương. Hủy toàn
    // phần chỉ có ở giao dịch THẺ, và Q-M đóng MỌI phiếu của gỡ gắn thẻ ⇒ nay ĐÓNG. Đối chứng dương
    // của luật mở lại chuyển sang chuyển khoản — `[PGG-16]`.
    expect(quyetPhieuSauGoGan({ conPhaiThu: 6_732_000, donNhanTien: true, coPhieuMoKhac: false, coDotDaHuy: false, tinHieuThe: "HUY_TOAN_PHAN", nguon: "THE_POS" }).hanhDong).toBe("DONG");
  });

  it("[PGG-16] Q-M: nguồn THẺ ⇒ ĐÓNG kể cả CHƯA có tín hiệu; chuyển khoản vẫn MỞ LẠI (đối chứng dương)", () => {
    const the = quyetPhieuSauGoGan({ conPhaiThu: 6_732_000, donNhanTien: true, coPhieuMoKhac: false, coDotDaHuy: false, tinHieuThe: null, nguon: "THE_POS" });
    expect(the.hanhDong).toBe("DONG");
    expect(the.lyDo).toBe(LY_DO_THE_LUON_DONG);
    // Đối chứng dương — cùng mọi vế, chỉ khác nguồn.
    const ck = quyetPhieuSauGoGan({ conPhaiThu: 6_732_000, donNhanTien: true, coPhieuMoKhac: false, coDotDaHuy: false, tinHieuThe: null, nguon: "CHUYEN_KHOAN" });
    expect(ck.hanhDong).toBe("MO_LAI");
    // Q-M không đè vế GIỮ: phiếu vẫn đủ tiền từ đường khác thì "đã thu đủ" vẫn đúng.
    expect(quyetPhieuSauGoGan({ conPhaiThu: 0, donNhanTien: true, coPhieuMoKhac: false, coDotDaHuy: false, tinHieuThe: null, nguon: "THE_POS" }).hanhDong).toBe("GIU");
    // Và các lý do trạng thái đứng TRƯỚC Q-M vẫn là lý do ghi nhật ký (Q-M chỉ đổi ca lẽ ra mở lại).
    expect(quyetPhieuSauGoGan({ conPhaiThu: 1, donNhanTien: false, coPhieuMoKhac: false, coDotDaHuy: false, tinHieuThe: null, nguon: "THE_POS" }).lyDo).toContain("không còn nhận tiền");
  });

  it("[PGG-17] phiếu ĐANG MỞ mà tiền của lượt gỡ đang lấp: thẻ ⇒ ĐÓNG (Q-M, cả khi chưa tín hiệu); chuyển khoản ⇒ để nguyên", () => {
    // Phiếu phát TRƯỚC khi gắn tay: tiền thẻ lấp nó về 0đ ⇒ trước gỡ 0, sau gỡ 6.732.000.
    const lap = { conPhaiThu: 6_732_000, conPhaiThuTruoc: 0 };
    expect(quyetPhieuMoSauGoGan({ ...lap, nguon: "THE_POS", tinHieuThe: null })).toEqual({ hanhDong: "DONG", lyDo: LY_DO_THE_LUON_DONG });
    expect(quyetPhieuMoSauGoGan({ ...lap, nguon: "THE_POS", tinHieuThe: "HUY_TOAN_PHAN" })?.hanhDong).toBe("DONG");
    expect(quyetPhieuMoSauGoGan({ ...lap, nguon: "THE_POS", tinHieuThe: "HOAN_MOT_PHAN" })?.lyDo).toContain("hoàn MỘT PHẦN");
    // Đối chứng dương: chuyển khoản ⇒ phiếu hiện lại đúng số (`[V3-20]`).
    expect(quyetPhieuMoSauGoGan({ ...lap, nguon: "CHUYEN_KHOAN", tinHieuThe: null })).toBeNull();
    // Phiếu vẫn 0đ sau gỡ (tiền đường khác còn phủ) ⇒ không có gì hiện lại, không đụng.
    expect(quyetPhieuMoSauGoGan({ conPhaiThu: 0, conPhaiThuTruoc: 0, nguon: "THE_POS", tinHieuThe: null })).toBeNull();
  });

  it("[PGG-18] rà vòng 6 — phiếu phát SAU khi gắn tay thẻ (số tiền thẻ chưa từng nằm trong số phiếu đòi) ⇒ gỡ gắn KHÔNG đóng phiếu", () => {
    // Đợt A 3.168.000 đã có 1.000.000 thẻ gắn tay ⇒ dòng A = 2.168.000; QR 5.732.000. Gỡ gắn: còn phải thu
    // vẫn 5.732.000 (min(dòng, còn thiếu đợt)) — phiếu không đòi thêm đồng nào, đóng nó chỉ làm khoản đúng
    // mã đúng số của phụ huynh rơi vào UNMATCHED.
    const khongDoi = { conPhaiThu: 5_732_000, conPhaiThuTruoc: 5_732_000 };
    expect(quyetPhieuMoSauGoGan({ ...khongDoi, nguon: "THE_POS", tinHieuThe: null })).toBeNull();
    expect(quyetPhieuMoSauGoGan({ ...khongDoi, nguon: "THE_POS", tinHieuThe: "HOAN_MOT_PHAN" })).toBeNull();
    // Phiếu đòi THÊM (dù chỉ một phần) ⇒ vẫn ĐÓNG — Q-M giữ nguyên cho phần tiền thẻ đã lấp.
    expect(quyetPhieuMoSauGoGan({ conPhaiThu: 5_732_000, conPhaiThuTruoc: 4_732_000, nguon: "THE_POS", tinHieuThe: null })?.hanhDong).toBe("DONG");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LƯỚI GHIM MÃ NGUỒN — bóc chú thích TRƯỚC khi so (chú thích giải thích bản vá chứa đúng các
// chuỗi đang tìm), và khẳng định SỐ LẦN khớp.
// ─────────────────────────────────────────────────────────────────────────────

function bocChuThich(v: string): string {
  return v
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/\/\/[^\n]*$/, ""))
    .join("\n");
}
const doc = (tep: string) => bocChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
const dem = (ma: string, re: RegExp) => [...ma.matchAll(new RegExp(re.source, "g"))].length;
/** Thân một hàm — từ khai báo tới `export` cấp cao kế tiếp. */
function than(src: string, ten: string): string {
  const dau = src.indexOf(`function ${ten}(`);
  if (dau === -1) return "";
  const sau = src.indexOf("\nexport ", dau + 1);
  return src.slice(dau, sau === -1 ? undefined : sau);
}

describe("[PGG-W] dây nối phiếu gộp ↔ gỡ gắn", () => {
  const GHI = doc("lib/finance/ghi-tien-don.ts");
  const GO = than(GHI, "goGanTheoCon");

  it("[PGG-W1] goGanTheoCon gọi phieuGopSauGoGanTrongTx ĐÚNG MỘT lần, bằng `tx`, SAU khi xoá phân bổ", () => {
    // Mã TRƯỚC bản vá: không có lời gọi nào — phiếu ở lại PAID.
    expect(GO, "không tách được thân goGanTheoCon").not.toBe("");
    expect(dem(GHI, /\bphieuGopSauGoGanTrongTx\s*\(/), "số lời gọi trong cả tệp").toBe(1);
    expect(dem(GO, /\bphieuGopSauGoGanTrongTx\(tx,/), "lời gọi nằm trong goGanTheoCon, với tx").toBe(1);
    const xoa = GO.indexOf("tx.paymentAllocation.deleteMany(");
    const goi = GO.indexOf("phieuGopSauGoGanTrongTx(tx,");
    expect(xoa, "đối chứng: goGanTheoCon còn xoá phân bổ").toBeGreaterThan(-1);
    expect(goi, "gọi SAU deleteMany — số còn phải thu đọc phân bổ sống").toBeGreaterThan(xoa);
    // Rà vòng 4: SAU helper thẻ, và nhận đúng tín hiệu của nó (`[PNS-11]`).
    expect(goi, "gọi SAU giaoDichPosSauGoGanTrongTx — cần tín hiệu hủy/hoàn").toBeGreaterThan(GO.indexOf("giaoDichPosSauGoGanTrongTx(tx,"));
    // (Nhật ký TXN_GO_GAN cũng ghi `tinHieuThe: sauGoPos.tinHieu` — soi đúng khối lời gọi.)
    const khoiGoi = GO.slice(goi, GO.indexOf("});", goi) + 3);
    expect(dem(khoiGoi, /tinHieuThe: sauGoPos\.tinHieu,/)).toBe(1);
    // Q-M (30/09/2026): nguồn tiền do helper THẺ nói ra, đường chung chỉ chuyển tiếp — không tự so
    // provider (`[GGP-W2]`), không gõ cứng một nguồn.
    expect(dem(khoiGoi, /nguon: sauGoPos\.nguon,/), "chuyển tiếp nguồn cho luật Q-M").toBe(1);
    // Đợt vừa mất tiền = đợt của CHÍNH các phân bổ vừa chụp; nhãn = ghi chú của khoản VỪA đảo.
    expect(GO).toMatch(/dotVuaGo: phanBo\.map\(\(p\) => p\.paymentRequestId\),/);
    // Rà vòng 6: ảnh chụp phân bổ VỪA XOÁ (số tiền) đi kèm — phiếu OPEN chỉ đóng khi lượt gỡ làm nó đòi THÊM.
    expect(dem(khoiGoi, /phanBoVuaXoa: phanBo,/)).toBe(1);
    expect(dem(GO, /ghiChuVuaDao\.push\(g\.note \?\? ""\);/)).toBe(1);
    const boQua = GO.indexOf("if (daDao > 0) continue;");
    expect(GO.indexOf('ghiChuVuaDao.push(g.note ?? "");'), "chỉ khoản đảo Ở LƯỢT NÀY").toBeGreaterThan(boQua);
  });

  it("[PGG-W2] nhãn 'Phiếu gộp <mã>' đánh vần ở MỘT chỗ — thuTheoPhieuGop ghi bằng nhanPhieuGop", () => {
    // Mã TRƯỚC bản vá: note: `Phiếu gộp ${phieu.matchKey} — ${input.provider} …` gõ tay.
    const PG = doc("lib/finance/phieu-gop.ts");
    expect(dem(PG, /\bnhanPhieuGop\(phieu\.matchKey\)/)).toBe(1);
    expect(dem(PG, /Phiếu gộp \$\{/), "không còn bản gõ tay thứ hai").toBe(0);
  });

  it("[PGG-W4] tầng DB: phiếu ĐANG MỞ hỏi `quyetPhieuMoSauGoGan` (không còn cổng 'chỉ khi hoàn một phần'); phiếu PAID nhận nguồn", () => {
    // Mã TRƯỚC Q-M: khối phiếu OPEN bọc trong `if (input.tinHieuThe === "HOAN_MOT_PHAN")` ⇒ thẻ chưa có
    // tín hiệu thì phiếu 0đ hiện lại đòi trọn số — đúng cửa sổ Q-M đóng.
    const DB = doc("lib/finance/phieu-gop-go-gan-db.ts");
    expect(dem(DB, /quyetPhieuMoSauGoGan\(\{ conPhaiThu, conPhaiThuTruoc, nguon: input\.nguon, tinHieuThe: input\.tinHieuThe \}\)/)).toBe(1);
    // Rà vòng 6: "trước gỡ" = cùng hàm `conPhaiThuCuaPhieu` trên các dòng CỘNG LẠI phần vừa xoá.
    expect(dem(DB, /const conPhaiThuTruoc = conPhaiThuCuaPhieu\(dongCua\(p, input\.phanBoVuaXoa\)\);/)).toBe(1);
    expect(dem(DB, /input\.tinHieuThe === "HOAN_MOT_PHAN"/), "luật thẻ không viết lại tại chỗ").toBe(0);
    const goiPaid = DB.slice(DB.indexOf("quyetPhieuSauGoGan({"));
    expect(dem(goiPaid.slice(0, goiPaid.indexOf("});")), /nguon: input\.nguon,/)).toBe(1);
  });

  it("[PGG-W3] kết quả trả về + nhật ký nói trạng thái THẬT của giao dịch, không gõ cứng UNMATCHED", () => {
    expect(GO).toMatch(/status: sauGoPos\.trangThai,/);
    expect(GO).toMatch(/trangThaiGiaoDich: sauGoPos\.trangThai, phieuGop \}/);
    expect(dem(GO, /status: "UNMATCHED",/), "chỉ còn câu GHI về UNMATCHED").toBe(1);
  });
});
