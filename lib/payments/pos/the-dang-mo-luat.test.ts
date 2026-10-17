// Ca [HN1-15..19] — "THẺ ĐANG MỞ" của một phiếu gộp (hai nút QR / Thẻ POS, 09/10/2026). THUẦN.
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §1.6, TỰ QUYẾT V2/V3/V6.
//
// Một hàm (`kieuTheDangMo`) trả lời câu "phiếu gộp này có thẻ đang mở không" cho BA nơi:
//   · cổng máy chủ của "Huỷ phiếu" (`huyPhieuGop`);
//   · sự thật `PhieuGopView.theDangMo` mà trang đơn tính (không phụ thuộc quyền `payments:pos-check`);
//   · mọi quyết định ẩn/hiện ở màn (panel QR mặc định, nút Huỷ, cảnh báo hai kênh).
//
// Cái cần khoá không phải một giá trị mà là SỰ KHỚP: hàng nào ô dòng nói "Thẻ · đang chờ" thì `theDangMo`
// phải khác `null`, nếu không UI vẽ nút Huỷ mà máy chủ từ chối (luật 12). Ca `[HN1-17]` dựng cùng một phiếu
// thô qua CẢ HAI đường (view → `kieuPhieuPosDangMo`, và `kieuTheDangMo`) rồi so.
//
// Luật 19: đồng hồ ĐÓNG BĂNG; mọi mốc tính từ `NOW`.
import { describe, it, expect } from "vitest";
import {
  choPhepHetHan,
  dungPhieuPosChoDon,
  dungPhieuPosView,
  KIND_CHUA_KET_LUAN,
  kieuTheDangMo,
  LOI_HUY_KHI_CHUA_KET_LUAN,
  LOI_HUY_KHI_CHO_QUET_THE,
  LOI_HUY_KHI_THE_CHO_KE_TOAN,
  loiHuyPhieuGopKhiCoThe,
  type PhieuPosDeXem,
  type PhieuTheDeXetMo,
} from "./phieu-pos-luat";
import { kieuPhieuPosDangMo, nutThuThe, type PhieuPosChoNut } from "./nut-thu-the";
import { cuaSoTheoPhieuGop } from "./the-dang-mo";
import { CUA_SO_LUI_MS } from "./provider/doc-du-lieu";

const NOW = new Date("2026-10-09T03:00:00Z");
const PHUT = 60_000;
const GIO = 60 * PHUT;

const raw = (p: Partial<PhieuPosDeXem> = {}): PhieuPosDeXem => {
  const tao = new Date(NOW.getTime() - 5 * PHUT);
  return {
    id: "i1",
    code5: "H6WR4",
    amount: 800_000,
    status: "CHO_QUET",
    createdAt: tao,
    expiresAt: new Date(tao.getTime() + 24 * GIO),
    lastCheckAt: null,
    lastResultKind: null,
    lastResultMessage: null,
    paymentBillId: "b1",
    posTerminal: null,
    bankTransaction: null,
    paymentBill: { status: "OPEN", lines: [{ paymentRequestId: "pr1" }] },
    coGiaoDichChoTay: false,
    saiMaYeuCau: [],
    coDongTheChuaKetLuan: false,
    donDaCoVetBac: false,
    ...p,
  };
};

const PHIEU_MO = {
  billId: "b1",
  tongTien: 800_000,
  dong: [{ paymentRequestId: "pr1", ten: "Đợt 1", soTien: 800_000 }],
};

/** Phiếu thô → hai đường: ô dòng (view) và sự thật máy chủ. */
function haiDuong(p: PhieuPosDeXem, now: Date = NOW) {
  const view = dungPhieuPosView({ intent: p, phieuMo: PHIEU_MO, now });
  const the: PhieuTheDeXetMo = {
    status: p.status,
    expiresAt: p.expiresAt,
    lastResultKind: p.lastResultKind,
    bankTransaction: p.bankTransaction ? { status: p.bankTransaction.status } : null,
  };
  return {
    oDong: kieuPhieuPosDangMo(view),
    suThat: kieuTheDangMo({ phieu: [the], coGiaoDichChoTay: p.coGiaoDichChoTay, now }),
  };
}

describe("[HN1-15] kieuTheDangMo — từng trạng thái", () => {
  const the = (status: PhieuTheDeXetMo["status"], o: Partial<PhieuTheDeXetMo> = {}): PhieuTheDeXetMo => ({
    status,
    expiresAt: new Date(NOW.getTime() + 24 * GIO),
    lastResultKind: null,
    bankTransaction: null,
    ...o,
  });
  const hoi = (phieu: PhieuTheDeXetMo[], coGiaoDichChoTay = false, now = NOW) => kieuTheDangMo({ phieu, coGiaoDichChoTay, now });

  it("phiếu CHO_QUET / THAT_BAI chưa quá hạn ⇒ DANG_CHO (đối chứng dương cho các ca null bên dưới)", () => {
    expect(hoi([the("CHO_QUET")])).toBe("DANG_CHO");
    expect(hoi([the("THAT_BAI")])).toBe("DANG_CHO");
  });

  it("hết hạn đúng biên `expiresAt ≤ now` ⇒ không còn mở; còn 1 ms ⇒ còn mở", () => {
    // Cùng biên `phieuPosHetHan` (GĐ2 U12) mà view và poller dùng — lệch 1 ms ở đây là UI và cổng cãi nhau.
    expect(hoi([the("CHO_QUET", { expiresAt: new Date(NOW.getTime()) })])).toBeNull();
    expect(hoi([the("CHO_QUET", { expiresAt: new Date(NOW.getTime() + 1) })])).toBe("DANG_CHO");
    expect(hoi([the("THAT_BAI", { expiresAt: new Date(NOW.getTime() - 1) })])).toBeNull();
  });

  it("giao dịch của phiếu còn ở hàng chờ tay (LECH_TIEN / CAN_XU_LY + UNMATCHED) ⇒ CHO_KE_TOAN", () => {
    expect(hoi([the("LECH_TIEN", { bankTransaction: { status: "UNMATCHED" } })])).toBe("CHO_KE_TOAN");
    expect(hoi([the("CAN_XU_LY", { bankTransaction: { status: "UNMATCHED" } })])).toBe("CHO_KE_TOAN");
    // Đối chứng: kế toán đã gắn tay / bỏ qua ⇒ giao dịch rời hàng chờ ⇒ không chặn nữa.
    expect(hoi([the("LECH_TIEN", { bankTransaction: { status: "MATCHED" } })])).toBeNull();
    expect(hoi([the("CAN_XU_LY", { bankTransaction: { status: "IGNORED" } })])).toBeNull();
    // Không có giao dịch nào đính vào phiếu ⇒ không có gì để chờ.
    expect(hoi([the("LECH_TIEN")])).toBeNull();
  });

  it("các trạng thái ĐÓNG / bị thay không bao giờ là 'đang mở'", () => {
    for (const s of ["DA_THU", "HET_HAN", "HUY"] as const) expect(hoi([the(s)]), s).toBeNull();
  });

  it("giao dịch mang MÃ phiếu nằm hàng chờ ⇒ CHO_KE_TOAN, kể cả khi phiếu thẻ đã quá hạn / HET_HAN", () => {
    // T21 theo mã: quẹt dưới phiếu cũ đã bị thay, hoặc ghi chú 2 mã. Không có nhánh này thì "huỷ + phát mã
    // mới + quẹt lại" lách T21 (T21 tính theo từng phiếu gộp).
    expect(hoi([the("CHO_QUET")], true)).toBe("CHO_KE_TOAN");
    expect(hoi([the("CHO_QUET", { expiresAt: new Date(NOW.getTime() - GIO) })], true)).toBe("CHO_KE_TOAN");
    expect(hoi([the("HET_HAN")], true)).toBe("CHO_KE_TOAN");
    expect(hoi([the("HET_HAN")], false), "đối chứng: không có giao dịch chờ").toBeNull();
  });

  it("[HNC-02] phiếu thẻ HUY (huỷ tay, Việc 4) mà giao dịch mang MÃ vẫn nằm hàng chờ ⇒ CHO_KE_TOAN — HUY không phải lối thoát khỏi T21", () => {
    // Cấy lỗi C08 (ghép Việc 4 lên Việc 3, 10/10/2026) SỐNG SÓT qua 3.519 ca của vùng POS: `kieuTheDangMo` bỏ qua giao dịch chờ tay khi MỌI phiếu thẻ của
    // phiếu gộp là HUY. HUY là trạng thái MỚI của Việc 4; mọi ca cũ chỉ thử HUY KHÔNG kèm giao dịch chờ. Hậu quả nếu lọt: sale huỷ phiếu thẻ, khách (đã quẹt, lệch
    // số / ghi chú 2 mã) có giao dịch nằm hàng chờ, "Huỷ phiếu" (gộp) thấy "không có thẻ nào mở" ⇒ phát mã/QR mới ⇒ khách trả lần hai — đúng lối lách T21 mà nút
    // "Huỷ phiếu thẻ" ra đời để KHÔNG mở. Giao dịch chờ đếm theo MÃ của phiếu gộp, không theo trạng thái phiếu thẻ.
    expect(hoi([the("HUY")], true), "HUY + giao dịch chờ").toBe("CHO_KE_TOAN");
    expect(hoi([the("HUY"), the("HET_HAN")], true), "nhiều phiếu, toàn bị thay / đã huỷ").toBe("CHO_KE_TOAN");
    expect(hoi([the("HUY"), the("HUY")], true), "hai lần huỷ").toBe("CHO_KE_TOAN");
    // Đối chứng dương: cùng phiếu HUY mà KHÔNG có giao dịch chờ thì không giữ khoá — kẻo "luôn CHO_KE_TOAN" cũng xanh.
    expect(hoi([the("HUY")], false), "HUY không kèm giao dịch chờ").toBeNull();
    expect(hoi([the("HUY"), the("HET_HAN")], false), "nhiều phiếu, không giao dịch chờ").toBeNull();
  });

  it("nhiều phiếu: CHO_KE_TOAN thắng DANG_CHO; không phiếu nào ⇒ null", () => {
    const cho = the("LECH_TIEN", { bankTransaction: { status: "UNMATCHED" } });
    expect(hoi([the("CHO_QUET"), cho])).toBe("CHO_KE_TOAN");
    expect(hoi([the("HET_HAN"), the("CHO_QUET")])).toBe("DANG_CHO");
    expect(hoi([])).toBeNull();
  });
});

describe("[HN1-16] kieuPhieuPosDangMo — phía ô dòng, và `nutThuThe` không đổi nghĩa", () => {
  const p = (o: Partial<PhieuPosChoNut> = {}): PhieuPosChoNut => ({
    paymentRequestIds: ["pr1"],
    cuaPhieuDangMo: true,
    hienThi: "CHO_QUET",
    choKeToan: false,
    ...o,
  });

  it("CHO_QUET / THAT_BAI ⇒ DANG_CHO; chờ kế toán ⇒ CHO_KE_TOAN (thắng); còn lại null", () => {
    expect(kieuPhieuPosDangMo(p())).toBe("DANG_CHO");
    expect(kieuPhieuPosDangMo(p({ hienThi: "THAT_BAI" }))).toBe("DANG_CHO");
    expect(kieuPhieuPosDangMo(p({ hienThi: "LECH_TIEN", choKeToan: true }))).toBe("CHO_KE_TOAN");
    expect(kieuPhieuPosDangMo(p({ hienThi: "CHO_QUET", choKeToan: true }))).toBe("CHO_KE_TOAN");
    for (const h of ["DA_THU", "HET_HAN", "PHIEU_DA_DONG", "HUY", "KE_TOAN_DA_GHI", "KE_TOAN_DA_GO"] as const) {
      expect(kieuPhieuPosDangMo(p({ hienThi: h })), h).toBeNull();
    }
  });

  it("phiếu thẻ của phiếu gộp KHÔNG còn mở, hoặc không có phiếu ⇒ null", () => {
    expect(kieuPhieuPosDangMo(null)).toBeNull();
    expect(kieuPhieuPosDangMo(p({ cuaPhieuDangMo: false }))).toBeNull();
  });

  it("`nutThuThe` vẫn ra đúng DANG_CHO / CHO_KE_TOAN từ cùng hai điều kiện (refactor không đổi nghĩa)", () => {
    const vao = (phieuPos: PhieuPosChoNut | null) =>
      nutThuThe({
        duocThuThePos: true,
        bat: true,
        tt: { kieu: "MOI_CUA_DOT_NAY" },
        paymentRequestId: "pr1",
        rowStatus: "PENDING",
        conThieu: 800_000,
        lyDoChuaDuyet: null,
        soMay: 1,
        phieuPos,
      }).kieu;
    expect(vao(p())).toBe("DANG_CHO");
    expect(vao(p({ hienThi: "LECH_TIEN", choKeToan: true }))).toBe("CHO_KE_TOAN");
    // Phiếu thẻ của dòng KHÁC không chiếm ô dòng này (đối chứng: cùng phiếu nhưng khác dòng).
    expect(vao(p({ paymentRequestIds: ["pr9"] }))).toBe("TAO");
  });
});

describe("[HN1-17] ô dòng và cổng máy chủ CÙNG một câu trả lời (luật 12: UI không vẽ nút mà cổng từ chối)", () => {
  const HET_HAN_TRUOC = new Date(NOW.getTime() - GIO);
  const BANG: { ten: string; p: Partial<PhieuPosDeXem>; mong: "DANG_CHO" | "CHO_KE_TOAN" | null }[] = [
    { ten: "CHO_QUET mới", p: {}, mong: "DANG_CHO" },
    { ten: "THAT_BAI mới", p: { status: "THAT_BAI" }, mong: "DANG_CHO" },
    { ten: "CHO_QUET đúng biên hết hạn", p: { expiresAt: new Date(NOW.getTime()) }, mong: null },
    { ten: "CHO_QUET còn 1 ms", p: { expiresAt: new Date(NOW.getTime() + 1) }, mong: "DANG_CHO" },
    { ten: "CHO_QUET quá hạn", p: { expiresAt: HET_HAN_TRUOC }, mong: null },
    { ten: "LECH_TIEN + UNMATCHED", p: { status: "LECH_TIEN", bankTransaction: { status: "UNMATCHED", allocations: [] } }, mong: "CHO_KE_TOAN" },
    { ten: "CAN_XU_LY + UNMATCHED", p: { status: "CAN_XU_LY", bankTransaction: { status: "UNMATCHED", allocations: [] } }, mong: "CHO_KE_TOAN" },
    { ten: "LECH_TIEN đã MATCHED vào phiếu", p: { status: "LECH_TIEN", bankTransaction: { status: "MATCHED", allocations: [{ paymentRequestId: "pr1" }] } }, mong: null },
    { ten: "LECH_TIEN không giao dịch", p: { status: "LECH_TIEN" }, mong: null },
    { ten: "DA_THU", p: { status: "DA_THU", bankTransaction: { status: "MATCHED", allocations: [{ paymentRequestId: "pr1" }] } }, mong: null },
    { ten: "HUY", p: { status: "HUY" }, mong: null },
    { ten: "HET_HAN (đã ghi)", p: { status: "HET_HAN" }, mong: null },
    { ten: "CHO_QUET mới + giao dịch mang mã ở hàng chờ", p: { coGiaoDichChoTay: true }, mong: "CHO_KE_TOAN" },
    { ten: "CHO_QUET quá hạn + giao dịch mang mã ở hàng chờ", p: { expiresAt: HET_HAN_TRUOC, coGiaoDichChoTay: true }, mong: "CHO_KE_TOAN" },
    { ten: "HET_HAN (đã ghi) + giao dịch mang mã ở hàng chờ", p: { status: "HET_HAN", coGiaoDichChoTay: true }, mong: "CHO_KE_TOAN" },
    // [HNC-02b] Việc 4: huỷ TAY mà giao dịch mang mã vẫn ở hàng chờ — cả HAI đường phải nói CHO_KE_TOAN (hàng `HUY` trên chỉ thử không-hàng-chờ).
    // Đổi nhãn từ `[HNC-02]` (rà ghép 10/10/2026): cùng tệp có `it("[HNC-02] …")` độc lập, và `it.each` sinh tên từ `$ten` nên bộ quét mã ca theo tiêu đề `it(` không thấy hàng này —
    // hai ca khác nhau mang một mã làm phép so "ĐÚNG TẬP mã ca đỏ" của luật 14 không phân biệt được.
    { ten: "[HNC-02b] HUY (huỷ tay) + giao dịch mang mã ở hàng chờ", p: { status: "HUY", coGiaoDichChoTay: true }, mong: "CHO_KE_TOAN" },
  ];

  it.each(BANG)("$ten ⇒ $mong ở CẢ HAI đường", ({ p, mong }) => {
    const r = haiDuong(raw(p));
    expect(r.oDong).toBe(mong);
    expect(r.suThat).toBe(mong);
  });

  it("[HN1-17b] phiếu bỏ dở ≥ 30 phút RỜI MÀN (U9) nhưng vẫn là 'thẻ đang mở' cho cổng huỷ (V2)", () => {
    // Cửa sổ 30 phút là cửa sổ HIỂN THỊ (U8: không đổi tập đối soát). T14: "chưa thấy giao dịch" phần lớn
    // chỉ là file chưa import — khách có thể ĐÃ trả. Huỷ mã trong lúc đó = phát mã mới cho khoản đã trả.
    const cu = raw({ createdAt: new Date(NOW.getTime() - 31 * PHUT), expiresAt: new Date(NOW.getTime() + 23 * GIO) });
    const lenMan = dungPhieuPosChoDon({ ds: [cu], phieuMo: PHIEU_MO, now: NOW });
    expect(lenMan, "đã rời màn sale").toBeNull();
    expect(
      kieuTheDangMo({
        phieu: [{ status: cu.status, expiresAt: cu.expiresAt, lastResultKind: null, bankTransaction: null }],
        coGiaoDichChoTay: false,
        now: NOW,
      }),
    ).toBe("DANG_CHO");
    // Đối chứng dương: cùng phiếu nhưng mới 29 phút ⇒ còn trên màn VÀ là thẻ đang mở.
    const moi = raw({ createdAt: new Date(NOW.getTime() - 29 * PHUT) });
    expect(dungPhieuPosChoDon({ ds: [moi], phieuMo: PHIEU_MO, now: NOW })).not.toBeNull();
  });
});

describe("[HN1-18] câu từ chối của máy chủ", () => {
  it("đang chờ quẹt ⇒ NGUYÊN VĂN câu chủ dự án chốt", () => {
    expect(LOI_HUY_KHI_CHO_QUET_THE).toBe("Đang chờ quẹt thẻ cho mã này — huỷ phiếu thẻ trước");
    expect(loiHuyPhieuGopKhiCoThe("DANG_CHO")).toBe(LOI_HUY_KHI_CHO_QUET_THE);
  });

  it("chờ kế toán ⇒ câu RIÊNG (không nói 'đang chờ quẹt' — tiền đã trừ, không còn là chờ khách)", () => {
    expect(loiHuyPhieuGopKhiCoThe("CHO_KE_TOAN")).toBe(LOI_HUY_KHI_THE_CHO_KE_TOAN);
    expect(LOI_HUY_KHI_THE_CHO_KE_TOAN).toContain("chờ kế toán");
    expect(LOI_HUY_KHI_THE_CHO_KE_TOAN).not.toContain("chờ quẹt");
    expect(LOI_HUY_KHI_THE_CHO_KE_TOAN).not.toBe(LOI_HUY_KHI_CHO_QUET_THE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RÀ ĐỐI KHÁNG VIỆC 1 (09/10/2026) — thẻ QUÁ HẠN mà kết quả gần nhất CHƯA KẾT LUẬN
// ─────────────────────────────────────────────────────────────────────────────

describe("[HN2-10] kieuTheDangMo — quá hạn nhưng lượt kiểm gần nhất chưa kết luận ⇒ CHƯA KẾT LUẬN (poller cũng không ghi HET_HAN)", () => {
  const QUA_HAN = new Date(NOW.getTime() - GIO);
  const the = (o: Partial<PhieuTheDeXetMo> = {}): PhieuTheDeXetMo => ({
    status: "CHO_QUET",
    expiresAt: QUA_HAN,
    lastResultKind: null,
    bankTransaction: null,
    ...o,
  });
  const hoi = (phieu: PhieuTheDeXetMo[], coGiaoDichChoTay = false) => kieuTheDangMo({ phieu, coGiaoDichChoTay, now: NOW });

  it("PROVIDER_ERROR / PAID / PAID_AMOUNT_MISMATCH + quá hạn ⇒ CHUA_KET_LUAN (khách có thể ĐÃ bị trừ tiền)", () => {
    for (const k of ["PROVIDER_ERROR", "PAID", "PAID_AMOUNT_MISMATCH"] as const) {
      expect(hoi([the({ lastResultKind: k })]), k).toBe("CHUA_KET_LUAN");
      expect(hoi([the({ status: "THAT_BAI", lastResultKind: k })]), `THAT_BAI + ${k}`).toBe("CHUA_KET_LUAN");
    }
  });

  it("ĐỐI CHỨNG DƯƠNG: cùng phiếu quá hạn, kết quả KẾT LUẬN được (hoặc chưa kiểm lần nào) ⇒ không còn mở", () => {
    for (const k of [null, "NOT_FOUND", "FAILED", "CANCELLED_AFTER_PAID"] as const) {
      expect(hoi([the({ lastResultKind: k })]), String(k)).toBeNull();
    }
  });

  it("còn hạn thì vẫn là DANG_CHO bất kể kết quả; DANG_CHO thắng CHUA_KET_LUAN; CHO_KE_TOAN thắng cả hai", () => {
    const conHan = new Date(NOW.getTime() + GIO);
    expect(hoi([the({ expiresAt: conHan, lastResultKind: "PROVIDER_ERROR" })])).toBe("DANG_CHO");
    expect(hoi([the({ lastResultKind: "PROVIDER_ERROR" }), the({ expiresAt: conHan })])).toBe("DANG_CHO");
    expect(hoi([the({ lastResultKind: "PROVIDER_ERROR" })], true)).toBe("CHO_KE_TOAN");
  });

  it("phiếu ĐÃ ĐÓNG (HET_HAN/HUY/DA_THU) mang kết quả cũ KHÔNG kéo thẻ về 'đang mở'", () => {
    for (const s of ["HET_HAN", "HUY", "DA_THU"] as const) {
      expect(hoi([the({ status: s, lastResultKind: "PROVIDER_ERROR" })]), s).toBeNull();
    }
  });

  it("KHỚP poller: với phiếu quá hạn, 'chưa kết luận' ⇔ `choPhepHetHan` = false — hai nơi không thể cãi nhau", () => {
    const moi = ["PROVIDER_ERROR", "PAID", "PAID_AMOUNT_MISMATCH", "NOT_FOUND", "FAILED", "CANCELLED_AFTER_PAID"] as const;
    for (const k of moi) {
      const chua = hoi([the({ lastResultKind: k })]) === "CHUA_KET_LUAN";
      expect(chua, k).toBe(!choPhepHetHan(k));
    }
    // Tập 'chưa kết luận' của poller chính là tập này (đổi một bên mà quên bên kia thì ca này đỏ).
    expect([...KIND_CHUA_KET_LUAN].sort()).toEqual(["PAID", "PAID_AMOUNT_MISMATCH", "PROVIDER_ERROR"]);
  });

  it("[HN1-17c] CỐ Ý lệch với ô dòng PHÍA MÀN: view nói HET_HAN (hết giờ), cổng nói CHUA_KET_LUAN — màn lấy câu trả lời của cổng", () => {
    // Cùng kiểu `[HN1-17b]`: hai bên KHÔNG bị ép đồng ý. View chỉ biết giờ; cổng biết thêm 'tiền có thể đã trừ'. Màn chọn
    // câu trả lời của cổng (`theDangMo` → `kenhCuaDong`), nên không có nút nào bị máy chủ từ chối.
    const p = raw({ expiresAt: QUA_HAN, lastResultKind: "PROVIDER_ERROR" });
    const r = haiDuong(p);
    expect(r.oDong, "phía màn: quá giờ ⇒ không còn mở").toBeNull();
    expect(r.suThat, "phía cổng: kết quả chưa kết luận ⇒ vẫn khoá").toBe("CHUA_KET_LUAN");
  });
});

describe("[HN2-11] câu từ chối của máy chủ cho thẻ chưa kết luận", () => {
  it("câu RIÊNG, nói đúng điều đang xảy ra, không hứa nút không có", () => {
    expect(loiHuyPhieuGopKhiCoThe("CHUA_KET_LUAN")).toBe(LOI_HUY_KHI_CHUA_KET_LUAN);
    expect(LOI_HUY_KHI_CHUA_KET_LUAN).toContain("chưa kết luận");
    expect(LOI_HUY_KHI_CHUA_KET_LUAN).not.toBe(LOI_HUY_KHI_CHO_QUET_THE);
    expect(LOI_HUY_KHI_CHUA_KET_LUAN).not.toMatch(/huỷ phiếu thẻ trước/i);
  });
});

// ── [CSG] `cuaSoTheoPhieuGop` — hàm gom CHUNG của hai cờ phía màn (rà ghép 10/10/2026) ───────────────────────────────────────────────────────────
// Trước đây vòng gom chép ở hai nơi (`ganChoTay` · `ganDongTheChuaKetLuan`); nay MỘT hàm, đo ở đây. THUẦN.
describe("[CSG] cuaSoTheoPhieuGop", () => {
  const phieu = (code5: string, paymentBillId: string, billTao: Date, tao: Date) => ({ code5, paymentBillId, createdAt: tao, paymentBill: { createdAt: billTao } });
  const T0 = new Date("2026-10-09T01:00:00Z");

  it("[CSG-01] một phiếu gộp, nhiều phiếu thẻ ⇒ MỘT dòng; mốc = (sớm nhất của lúc phát mã và các phiếu thẻ) − cửa sổ lùi", () => {
    const ra = cuaSoTheoPhieuGop([phieu("AAAAA", "b1", T0, new Date(T0.getTime() + 10 * PHUT)), phieu("AAAAA", "b1", T0, new Date(T0.getTime() + 30 * PHUT))]);
    expect(ra).toEqual([{ code5: "AAAAA", tu: new Date(T0.getTime() - CUA_SO_LUI_MS) }]);
  });

  it("[CSG-02] phiếu thẻ SỚM hơn lúc phát mã (dữ liệu cũ) ⇒ mốc lùi theo phiếu thẻ sớm nhất; hai phiếu gộp ⇒ hai dòng, không trộn mốc", () => {
    const som = new Date(T0.getTime() - 20 * PHUT);
    const ra = cuaSoTheoPhieuGop([phieu("AAAAA", "b1", T0, som), phieu("BBBBB", "b2", T0, new Date(T0.getTime() + PHUT))]);
    expect(ra).toEqual([
      { code5: "AAAAA", tu: new Date(som.getTime() - CUA_SO_LUI_MS) },
      { code5: "BBBBB", tu: new Date(T0.getTime() - CUA_SO_LUI_MS) },
    ]);
  });

  it("[CSG-03] danh sách rỗng ⇒ rỗng (không ném: `Math.min()` không đối số)", () => {
    expect(cuaSoTheoPhieuGop([])).toEqual([]);
  });
});
