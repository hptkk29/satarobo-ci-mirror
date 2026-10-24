// lib/payments/pos/ghep-viec-3-4.test.ts — LƯỚI VÙNG GHÉP Việc 3 ("Tôi nhập sai mã trên máy") × Việc 4 (nút "Huỷ phiếu thẻ"). THUẦN.
//
// Vì sao có tệp này (luật 14 — một lưới chưa bao giờ đỏ là một lưới CHƯA ĐƯỢC CHỨNG MINH): lượt ghép Việc 4 lên Việc 3 (10/10/2026) cấy 18 lỗi vào
// các điểm nối (bảng đầy đủ: docs/pos-hai-nut-khai-may.md §7.9). 11 phép CÓ tập khai trước đều bị bắt ĐÚNG TẬP ca; trong 7 phép DÒ (không biết trước lưới nào bắt) một
// bị bắt và SÁU SỐNG SÓT qua 3.519 ca của vùng POS — mỗi lỗ là một chỗ mà Việc 4 phụ thuộc vào thứ Việc 3 viết (hoặc ngược lại) mà không ca thuần nào canh:
//   · C08  `kieuTheDangMo` bỏ qua giao dịch chờ tay khi MỌI phiếu thẻ của phiếu gộp là HUY ⇒ huỷ phiếu thẻ → "Huỷ phiếu" (gộp) → phát mã mới → trả hai lần
//          (ca mới: `the-dang-mo-luat.test.ts` `[HNC-02]`);
//   · C14  cổng "không còn chờ quẹt" của bước TÌM ứng viên để lọt phiếu HUY (ca mới: `sai-ma-doc.test.ts` `[HNC-03]`);
//   · C15  cùng cổng ở bước GỬI dưới khoá (lưới dưới `[HNC-05]` — hành vi chỉ đo được trên Postgres);
//   · C09  `docTheDangMoCuaPhieuGop` lọc phiếu HUY khỏi `posIntents` (lưới `[HNC-06]`);
//   · C20/C21  `ganChoTay` bỏ rơi `saiMaYeuCau` / `CHON_VIEW` lấy yêu cầu CŨ NHẤT thay vì MỚI NHẤT — NGUỒN DUY NHẤT của hai cờ Việc 4 ở tầng màn
//          (`[HNC-04]`, đọc phiếu qua `docPhieuPosView` / `docPhieuPosTho` THẬT với db giả).
// Thêm `[HNC-01]`: bất biến trên TOÀN BỘ tổ hợp của `dungPhieuPosView` — "có yêu cầu sai mã SỐNG thì không huỷ được; phiếu HUY không còn nút sai mã".
// VIỆC 6 · a2 (10/10/2026): vế "BẤT KỲ yêu cầu nào (kể cả bị từ chối)" ĐÃ ĐỔI — kế toán từ chối thì sale huỷ được theo cổng thường; `[HNC-01a/b]` và `[HNC-04b/f]` viết lại.
//
// Mẫu: neo BIỂU THỨC (không neo chỗ đặt chữ), bỏ chú thích TRƯỚC khi đếm (chú thích giải thích bản vá hay chứa đúng chuỗi lưới đang tìm), đếm SỐ LẦN khớp,
// có ĐỐI CHỨNG DƯƠNG (luật 11). Đồng hồ ĐÓNG BĂNG (luật 19).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PosIntentStatus } from "@prisma/client";
import { TIEN_TO_GO_GAN } from "@/lib/finance/ghi-tien-don";
import { choPhepHuyPhieuThe } from "./huy-phieu-the";
import { docPhieuPosTho, docPhieuPosView } from "./phieu-pos";
import { dungPhieuPosView, type PhieuPosDeXem } from "./phieu-pos-luat";
import { CAU_CHO_KE_TOAN, cauTuChoi, nutNhapSaiMa, type TrangThaiSaiMa } from "./sai-ma";
import { thongDiepPos } from "./thong-diep-pos";

// ─────────────────────────────────────────────────────────────────────────────
// DB GIẢ cho `[HNC-04]` — chỉ hai bảng mà `docPhieuPosView` / `docPhieuPosTho` đọc, và NÓ ÁP `orderBy` / `take` của `select.saiMaYeuCau` lên danh sách
// yêu cầu của hàng (đó là chỗ C21 sống sót: mọi ca thuần cũ dựng thẳng `PhieuPosDeXem`, không qua câu `select`).
// ─────────────────────────────────────────────────────────────────────────────
type HangYeuCau = {
  createdAt: Date;
  trangThai: TrangThaiSaiMa;
  lyDoTuChoi: string | null;
  dangGhiLuc: Date | null;
  bankTransaction: { status: "MATCHED" | "UNMATCHED" | "IGNORED"; unmatchedNote: string | null };
};

const gia = vi.hoisted(() => ({ hang: [] as unknown[] }));

vi.mock("@/lib/db", () => {
  type Chon = { saiMaYeuCau?: { orderBy?: { createdAt?: "asc" | "desc" }; take?: number } };
  const ap = (r: unknown, chon: Chon) => {
    const { saiMaTatCa, ...con } = r as Record<string, unknown> & { saiMaTatCa: HangYeuCau[] };
    const spec = chon.saiMaYeuCau;
    let ds = [...saiMaTatCa];
    if (spec?.orderBy?.createdAt) {
      const dau = spec.orderBy.createdAt === "desc" ? -1 : 1;
      ds.sort((a, b) => dau * (a.createdAt.getTime() - b.createdAt.getTime()));
    }
    if (spec?.take !== undefined) ds = ds.slice(0, spec.take);
    return {
      ...con,
      saiMaYeuCau: ds.map((y) => ({ trangThai: y.trangThai, lyDoTuChoi: y.lyDoTuChoi, dangGhiLuc: y.dangGhiLuc, bankTransaction: y.bankTransaction })),
    };
  };
  return {
    db: {
      posPaymentIntent: {
        findUnique: async (a: { where: { id: string }; select: Chon }) => {
          const r = gia.hang.find((x) => (x as { id: string }).id === a.where.id);
          return r ? ap(r, a.select) : null;
        },
        findMany: async (a: { select: Chon }) => gia.hang.map((r) => ap(r, a.select)),
      },
      posCardTransaction: { findMany: async () => [] },
      // Việc 5 (rà đối kháng): `ganCoPhiaMan` hỏi vết bác của ĐƠN qua `docGiaoDichDaBiBac` (`posSaiMaYeuCau.findMany`) — bộ này không đo cờ ấy (đo thật ở `[HN5-DB-12]`), chỉ cần đường đọc không nổ.
      posSaiMaYeuCau: { findMany: async () => [] },
    },
  };
});
vi.mock("@/lib/finance/phieu-gop", () => ({
  docPhieuGopDangMo: async () => ({
    billId: "b1",
    ma: "H6WR4",
    tongTien: 800_000,
    daNhan: 0,
    dong: [{ paymentRequestId: "pr1", installmentNo: 1, ten: "Đợt 1", soTien: 800_000 }],
  }),
}));

const PHUT = 60_000;
const NOW = new Date("2026-10-09T03:00:00.000Z");
const TAO = new Date(NOW.getTime() - 5 * PHUT);
const CODE = "H6WR4";
const PHIEU_MO = { billId: "b1", tongTien: 800_000, dong: [{ paymentRequestId: "pr1", ten: "Đợt 1", soTien: 800_000 }] };

/** Câu "Chưa thấy giao dịch" THẬT do `thongDiepPos` sinh (không gõ tay) — cái mà poller / nút Kiểm tra ghi vào `lastResultMessage`. */
const CHUA_THAY_TRAN = thongDiepPos({
  loai: "CHUA_THAY",
  code5: CODE,
  duLieuLuc: null,
  gdMoiNhatLuc: null,
  taoLuc: TAO,
  baoAdminTuLuc: new Date(TAO.getTime() + 10 * PHUT),
}).cau;
/** Câu Việc 3 ghi vào phiếu thẻ lúc kế toán TỪ CHỐI — hàm THẬT của Việc 3, không bản chép tay. */
const CAU_TU_CHOI = cauTuChoi("Giao dịch của khách khác");

function raw(p: Partial<PhieuPosDeXem> = {}): PhieuPosDeXem {
  return {
    id: "i1",
    code5: CODE,
    amount: 800_000,
    status: "CHO_QUET",
    createdAt: TAO,
    expiresAt: new Date(TAO.getTime() + 24 * 60 * PHUT),
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
}
const yeuCau = (trangThai: TrangThaiSaiMa): PhieuPosDeXem["saiMaYeuCau"] => [
  { trangThai, lyDoTuChoi: trangThai === "TU_CHOI" ? "Giao dịch của khách khác" : null, dangGhiLuc: null, btStatus: "UNMATCHED", btDaGoGan: false },
];

// ─────────────────────────────────────────────────────────────────────────────
// [HNC-01] BẤT BIẾN trên TOÀN BỘ tổ hợp của `dungPhieuPosView` (hàm thuần mà CẢ HAI việc cùng dựng view từ nó)
// ─────────────────────────────────────────────────────────────────────────────
describe("[HNC-01] vùng ghép — bất biến trên mọi tổ hợp (trạng thái × yêu cầu sai mã × kết quả lưu × câu lưu × hàng chờ × hạn × phiếu gộp)", () => {
  const TRANG_THAI = Object.values(PosIntentStatus) as PosIntentStatus[];
  const YEU_CAU = [null, "CHO_DUYET", "DANG_GHI", "DA_GHI_NHAN", "TU_CHOI"] as const;
  /** "Sống" theo Việc 3 = `trangThai ≠ TU_CHOI` (cùng vị từ hai chỉ mục duy nhất từng phần của Việc 3). */
  const SONG = new Set<TrangThaiSaiMa>(["CHO_DUYET", "DANG_GHI", "DA_GHI_NHAN"]);
  const KET_QUA = [null, "NOT_FOUND", "FAILED", "PAID", "PROVIDER_ERROR"] as const;
  const CAU_LUU = [null, CHUA_THAY_TRAN, CAU_TU_CHOI] as const;

  type Cell = {
    status: PosIntentStatus;
    yc: (typeof YEU_CAU)[number];
    kind: (typeof KET_QUA)[number];
    cau: (typeof CAU_LUU)[number];
    cho: boolean;
    bt: boolean;
    hetHan: boolean;
    billMo: boolean;
  };
  const oMa = (c: Cell) => JSON.stringify({ ...c, cau: c.cau === null ? null : c.cau === CHUA_THAY_TRAN ? "chua-thay" : "tu-choi" });
  const view = (c: Cell) =>
    dungPhieuPosView({
      intent: raw({
        status: c.status,
        lastResultKind: c.kind,
        lastResultMessage: c.cau,
        coGiaoDichChoTay: c.cho,
        bankTransaction: c.bt ? { status: "UNMATCHED", allocations: [] } : null,
        expiresAt: c.hetHan ? NOW : new Date(NOW.getTime() + 60 * PHUT),
        paymentBill: { status: c.billMo ? "OPEN" : "CLOSED", lines: [{ paymentRequestId: "pr1" }] },
        saiMaYeuCau: c.yc === null ? [] : yeuCau(c.yc),
      }),
      phieuMo: PHIEU_MO,
      now: NOW,
    });

  const tatCa: Cell[] = [];
  for (const status of TRANG_THAI)
    for (const yc of YEU_CAU)
      for (const kind of KET_QUA)
        for (const cau of CAU_LUU)
          for (const cho of [false, true])
            for (const bt of [false, true])
              for (const hetHan of [false, true])
                for (const billMo of [true, false]) tatCa.push({ status, yc, kind, cau, cho, bt, hetHan, billMo });

  it("điều kiện tiên quyết của bảng: enum có HUY (Việc 4) và đủ các ô — kẻo vòng lặp rỗng nghĩa", () => {
    expect(TRANG_THAI).toContain("HUY");
    expect(TRANG_THAI).toContain("CAN_XU_LY");
    expect(tatCa.length).toBe(TRANG_THAI.length * YEU_CAU.length * KET_QUA.length * CAU_LUU.length * 2 * 2 * 2 * 2);
    expect(CHUA_THAY_TRAN.startsWith("Chưa thấy giao dịch mang mã H6WR4.")).toBe(true);
    expect(CAU_TU_CHOI).not.toBe(CHUA_THAY_TRAN);
  });

  it("[HNC-01a] (VIỆC 6 · a2 viết lại) CÓ yêu cầu SỐNG ⇒ KHÔNG huỷ được phiếu thẻ ở MỌI ô; yêu cầu BỊ TỪ CHỐI thì KHÔNG tự chặn — có ô cho huỷ SAU từ chối", () => {
    const sai: string[] = [];
    let coYeuCauSong = 0;
    let tuChoiChoHuy = 0;
    let tuChoiTong = 0;
    let doiChung = 0;
    for (const c of tatCa) {
      const v = view(c);
      if (c.yc !== null && SONG.has(c.yc)) {
        coYeuCauSong += 1;
        if (v.saiMa === null || v.huyPhieuThe.huyDuoc) sai.push(oMa(c));
      } else if (c.yc === "TU_CHOI") {
        tuChoiTong += 1;
        if (v.saiMa === null) sai.push(`${oMa(c)} (view không mang yêu cầu bị từ chối)`);
        if (v.huyPhieuThe.huyDuoc) tuChoiChoHuy += 1;
      } else if (v.huyPhieuThe.huyDuoc) {
        doiChung += 1; // đối chứng dương: không yêu cầu nào thì CÓ ô cho huỷ (kẻo "luôn từ chối" cũng xanh)
      }
    }
    expect(sai.slice(0, 5), `${sai.length} ô vi phạm`).toEqual([]);
    expect(coYeuCauSong).toBeGreaterThan(800);
    expect(tuChoiTong).toBeGreaterThan(200);
    expect(tuChoiChoHuy, "có ô cho huỷ SAU TỪ CHỐI (chủ dự án chốt 10/10/2026) — bỏ cổng riêng mà vẫn 0 ô là cổng khác đang chặn").toBeGreaterThan(0);
    expect(doiChung, "có ô cho huỷ khi KHÔNG yêu cầu nào").toBeGreaterThan(0);
  });

  it("[HNC-01b] KHÔNG yêu cầu nào ⇒ Việc 3 không đổi nghĩa của Việc 4; có yêu cầu ⇒ view CHÍNH LÀ kết quả của hàm luật với hai sự thật suy ĐỘC LẬP từ trạng thái yêu cầu + câu lưu", () => {
    const sai: string[] = [];
    for (const c of tatCa) {
      const v = view(c);
      const dangGiu = c.yc !== null && SONG.has(c.yc);
      const biBac = c.yc === "TU_CHOI";
      const mong = choPhepHuyPhieuThe({
        status: c.status,
        lastResultKind: c.kind,
        lastResultMessage: c.cau,
        code5: CODE,
        daNhanGiaoDich: c.bt,
        coGiaoDichChoTay: c.cho,
        coYeuCauSaiMaDangGiu: dangGiu,
        // VIỆC 6 · a2: suy ĐỘC LẬP với `laCauLuuTuChoiSaiMa` — yêu cầu MỚI NHẤT bị từ chối ∧ câu lưu CHÍNH LÀ `cauTuChoi(lý do của nó)` (fixture `yeuCau("TU_CHOI")` dựng lý do
        // "Giao dịch của khách khác" = lý do dựng `CAU_TU_CHOI`). Không phải cờ "bị từ chối" trần: cờ trần là cổng chặn riêng đã BỎ.
        cauLuuLaCauTuChoiSaiMa: biBac && c.cau === CAU_TU_CHOI,
        coDongTheChuaKetLuan: false,
        phieuGopConMo: c.billMo,
        daHetHan: c.hetHan,
      });
      if (JSON.stringify(v.huyPhieuThe) !== JSON.stringify(mong)) sai.push(oMa(c));
    }
    expect(sai.slice(0, 5), `${sai.length} ô lệch hàm luật`).toEqual([]);
  });

  it("[HNC-01c] phiếu HUY (huỷ tay): không Kiểm tra, không nút 'Tôi nhập sai mã', không huỷ lần hai, hộp nói 'HUY' — kể cả khi câu lưu CŨ là 'Chưa thấy…'", () => {
    const sai: string[] = [];
    let soHuy = 0;
    for (const c of tatCa) {
      if (c.status !== "HUY") continue;
      soHuy += 1;
      const v = view(c);
      const nut = nutNhapSaiMa({ hienThi: v.hienThi, thongDiep: v.thongDiep });
      if (v.hienThi !== "HUY" || v.duocKiemTra || nut || v.huyPhieuThe.huyDuoc) sai.push(oMa(c));
      if (v.thongDiep === CHUA_THAY_TRAN) sai.push(`${oMa(c)} (câu lưu cũ lọt ra màn)`);
    }
    expect(sai.slice(0, 5), `${sai.length} ô vi phạm`).toEqual([]);
    expect(soHuy).toBeGreaterThan(500);
  });

  it("[HNC-01d] nút 'Tôi nhập sai mã' CHỈ khi phiếu CHO_QUET (V62) — không bao giờ trên phiếu HUY / THAT_BAI / đã đóng; đối chứng dương: có ô bật", () => {
    let bat = 0;
    const sai: string[] = [];
    for (const c of tatCa) {
      const v = view(c);
      if (!nutNhapSaiMa({ hienThi: v.hienThi, thongDiep: v.thongDiep })) continue;
      bat += 1;
      if (c.status !== "CHO_QUET") sai.push(oMa(c));
    }
    expect(sai.slice(0, 5), `${sai.length} ô vi phạm`).toEqual([]);
    expect(bat).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [HNC-04] TỪ HÀNG DB CỦA VIỆC 3 TỚI NÚT HUỶ CỦA VIỆC 4 — đọc phiếu qua `docPhieuPosView` / `docPhieuPosTho` THẬT với db giả
// ─────────────────────────────────────────────────────────────────────────────
describe("[HNC-04] hai cờ của nút 'Huỷ phiếu thẻ' lấy từ yêu cầu MỚI NHẤT mà `CHON_VIEW` / `ganChoTay` (Việc 3) nạp", () => {
  const hangThucTe = (p: Record<string, unknown> = {}, saiMaTatCa: HangYeuCau[] = []): unknown => ({
    id: "i1",
    code5: CODE,
    amount: 800_000,
    status: "CHO_QUET",
    createdAt: TAO,
    expiresAt: new Date(TAO.getTime() + 24 * 60 * PHUT),
    lastCheckAt: null,
    lastResultKind: "NOT_FOUND",
    lastResultMessage: CHUA_THAY_TRAN,
    paymentBillId: "b1",
    posTerminal: null,
    bankTransaction: null,
    paymentBill: { status: "OPEN", orderId: "o1", createdAt: TAO, lines: [{ paymentRequestId: "pr1" }] },
    ...p,
    saiMaTatCa,
  });
  const yc = (trangThai: TrangThaiSaiMa, phutSauTao: number, p: Partial<HangYeuCau> = {}): HangYeuCau => ({
    createdAt: new Date(TAO.getTime() + phutSauTao * PHUT),
    trangThai,
    lyDoTuChoi: trangThai === "TU_CHOI" ? "Giao dịch của khách khác" : null,
    dangGhiLuc: null,
    bankTransaction: { status: "UNMATCHED", unmatchedNote: null },
    ...p,
  });

  it("[HNC-04a] ĐỐI CHỨNG của bộ gá: phiếu CHO_QUET + 'Chưa thấy' trần + KHÔNG yêu cầu nào ⇒ view cho huỷ; saiMa = null", async () => {
    gia.hang = [hangThucTe()];
    const v = await docPhieuPosView("i1", NOW);
    expect(v).not.toBeNull();
    expect(v?.saiMa).toBeNull();
    expect(v?.huyPhieuThe).toEqual({ huyDuoc: true, canXacNhanManh: true });
  });

  it("[HNC-04b] SAU TỪ CHỐI (VIỆC 6 · a2 viết lại): phiếu về CHO_QUET + yêu cầu TU_CHOI ⇒ view mang `saiMa` bị từ chối VÀ nút huỷ CHO huỷ — ngay sau từ chối (câu lưu = câu từ chối) lẫn khi poller đã ghi đè (đường hàng DB → view → hàm luật)", async () => {
    const CAU_TREO = thongDiepPos({ loai: "DANG_CHO_NGAN_HANG", code5: CODE, maTrangThai: "DANG_XU_LY" }).cau;
    // (1) NGAY sau từ chối: câu lưu là câu `tuChoiSaiMa` ghi — `lastResultMessage` thật của phiếu vừa bị từ chối.
    gia.hang = [hangThucTe({ lastResultMessage: CAU_TU_CHOI }, [yc("TU_CHOI", 2)])];
    const ngay = await docPhieuPosView("i1", NOW);
    expect(ngay?.saiMa, "yêu cầu phải tới được view").toEqual({ trangThai: "TU_CHOI", hieuLuc: "TU_CHOI", lyDoTuChoi: "Giao dịch của khách khác" });
    expect(ngay?.huyPhieuThe).toEqual({ huyDuoc: true, canXacNhanManh: true });
    // (2) Vài phút sau: poller ghi 'Chưa thấy' trần ⇒ CÙNG phán quyết (không nhấp nháy).
    gia.hang = [hangThucTe({}, [yc("TU_CHOI", 2)])];
    expect((await docPhieuPosView("i1", NOW))?.huyPhieuThe).toEqual(ngay?.huyPhieuThe);
    // (3) Lượt kiểm SAU ghi câu 'ĐỪNG quẹt lại' (dòng treo) ⇒ thông tin mới hơn thắng: CHUA_NGA_NGU, dù yêu cầu mới nhất từng bị từ chối.
    gia.hang = [hangThucTe({ lastResultMessage: CAU_TREO }, [yc("TU_CHOI", 2)])];
    expect((await docPhieuPosView("i1", NOW))?.huyPhieuThe).toMatchObject({ huyDuoc: false, ma: "CHUA_NGA_NGU" });
    // (4) ĐỐI CHỨNG ÂM: câu từ chối mà KHÔNG có yêu cầu nào đứng sau nó (dữ liệu hỏng) ⇒ CHUA_NGA_NGU — câu một mình không mở khoá.
    gia.hang = [hangThucTe({ lastResultMessage: CAU_TU_CHOI }, [])];
    expect((await docPhieuPosView("i1", NOW))?.huyPhieuThe).toMatchObject({ huyDuoc: false, ma: "CHUA_NGA_NGU" });
  });

  it("[HNC-04c] dữ liệu VI PHẠM bất biến (phiếu còn CHO_QUET mà có yêu cầu SỐNG) ⇒ CO_YEU_CAU_SAI_MA — lớp thứ hai của cổng huỷ", async () => {
    gia.hang = [hangThucTe({}, [yc("CHO_DUYET", 2)])];
    const v = await docPhieuPosView("i1", NOW);
    expect(v?.huyPhieuThe).toMatchObject({ huyDuoc: false, ma: "CO_YEU_CAU_SAI_MA" });
  });

  it("[HNC-04d] HAI yêu cầu (bị từ chối CŨ, rồi gửi lại MỚI — V76): view lấy yêu cầu MỚI NHẤT (`orderBy createdAt desc`), không phải yêu cầu cũ bị từ chối", async () => {
    const cuBiBac = yc("TU_CHOI", 1);
    const moiDangCho = yc("CHO_DUYET", 4);
    // Phiếu đã sang CAN_XU_LY (gửi lại giữ giao dịch) — đường THẬT của Việc 3; hàng đưa vào theo thứ tự ngược để thứ tự DB không tình cờ cứu.
    for (const thuTu of [[cuBiBac, moiDangCho], [moiDangCho, cuBiBac]]) {
      gia.hang = [hangThucTe({ status: "CAN_XU_LY", bankTransaction: { status: "UNMATCHED", allocations: [] } }, thuTu)];
      const v = await docPhieuPosView("i1", NOW);
      expect(v?.saiMa?.trangThai, "yêu cầu MỚI NHẤT").toBe("CHO_DUYET");
      expect(v?.thongDiep, "câu theo yêu cầu đang chờ, không theo yêu cầu cũ bị từ chối").toBe(CAU_CHO_KE_TOAN);
      expect(v?.huyPhieuThe).toMatchObject({ huyDuoc: false, ma: "CAN_XU_LY" });
    }
  });

  it("[HNC-04e] `btDaGoGan` tính từ tiền tố gỡ gắn của giao dịch đang giữ: yêu cầu CHO_DUYET mà kế toán đã gỡ/gắn tay giao dịch ⇒ 'đã xử lý ở nơi khác'", async () => {
    gia.hang = [
      hangThucTe({ status: "CAN_XU_LY", bankTransaction: { status: "UNMATCHED", allocations: [] } }, [
        yc("CHO_DUYET", 2, { bankTransaction: { status: "UNMATCHED", unmatchedNote: `${TIEN_TO_GO_GAN}đã gỡ` } }),
      ]),
    ];
    const v = await docPhieuPosView("i1", NOW);
    expect(v?.saiMa?.hieuLuc).toBe("DA_XU_LY_NGOAI");
  });

  it("[HNC-04f] ĐƯỜNG THỨ HAI (`docPhieuPosTho` — danh sách của màn đơn): mỗi phiếu nhận ĐÚNG yêu cầu mới nhất của nó, và đủ hai cờ bắt buộc", async () => {
    gia.hang = [
      hangThucTe({ id: "i2", status: "CHO_QUET" }, [yc("TU_CHOI", 1), yc("TU_CHOI", 3, { lyDoTuChoi: "Lần hai" })]),
      hangThucTe({ id: "i1", status: "HET_HAN", paymentBillId: "b0" }, []),
    ];
    const ds = await docPhieuPosTho("o1");
    expect(ds).toHaveLength(2);
    expect(ds[0]?.saiMaYeuCau, "phiếu i2: đúng MỘT phần tử (take 1) và là lần bị bác mới nhất").toMatchObject([{ trangThai: "TU_CHOI", lyDoTuChoi: "Lần hai", btStatus: "UNMATCHED", btDaGoGan: false }]);
    expect(ds[1]?.saiMaYeuCau).toEqual([]);
    expect(ds.every((p) => typeof p.coDongTheChuaKetLuan === "boolean" && typeof p.coGiaoDichChoTay === "boolean")).toBe(true);
    const v = dungPhieuPosView({ intent: ds[0]!, phieuMo: PHIEU_MO, now: NOW });
    // VIỆC 6 · a2: bị từ chối KHÔNG còn chặn huỷ (câu lưu của hàng này là 'Chưa thấy' trần) — view dựng từ ĐƯỜNG THỨ HAI cũng phải nói cho huỷ.
    expect(v.huyPhieuThe).toEqual({ huyDuoc: true, canXacNhanManh: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LƯỚI MÃ NGUỒN — những thứ chỉ quan sát được trên Postgres (hành vi) nên ở đây ghim BIỂU THỨC
// ─────────────────────────────────────────────────────────────────────────────
const GOC = process.cwd();
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf8");
/** Bỏ chú thích khối MỞ Ở ĐẦU DÒNG + chú thích dòng (chuỗi chứa `/*` giữa dòng không được nhận là mở chú thích). */
const boChuThich = (s: string) => s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/.*$/gm, "");
const dem = (ma: string, re: RegExp) => [...ma.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))].length;

/** Cắt thân MỘT hàm `export async function <ten>(` tới dòng `}` đầu tiên ở cột 0 (mã đã bóc chú thích). */
function thanHamXuat(ma: string, ten: string): string {
  const dau = ma.search(new RegExp(`^export async function ${ten}\\(`, "m"));
  if (dau < 0) return "";
  const sau = ma.slice(dau);
  const cuoi = sau.search(/\r?\n\}\r?\n/);
  return cuoi < 0 ? sau : sau.slice(0, cuoi + 3);
}

describe("[HNC-05] cổng trạng thái của Việc 3 là phép PHỦ ĐỊNH `!== \"CHO_QUET\"` — trạng thái MỚI (HUY, Việc 4) tự bị chặn, không cần ai nhớ thêm vào danh sách", () => {
  const CAU = "Phiếu thu thẻ không còn chờ quẹt";
  const DIEU_KIEN = /if \(([^()\n]*)\) return \{ ok: false(?: as const)?, error: "Phiếu thu thẻ không còn chờ quẹt" \}/g;

  it("bước GỬI dưới khoá (`guiSaiMa`, sai-ma-ghi.ts): đúng MỘT cổng và điều kiện của nó là CHÍNH XÁC `intent.status !== \"CHO_QUET\"`", () => {
    const ma = boChuThich(doc("lib/payments/pos/sai-ma-ghi.ts"));
    expect(dem(ma, new RegExp(`"${CAU}"`)), "đúng một chỗ nói câu này").toBe(1);
    const dk = [...ma.matchAll(DIEU_KIEN)].map((m) => m[1]);
    expect(dk, "điều kiện của cổng").toEqual(['intent.status !== "CHO_QUET"']);
  });

  it("bước TÌM ứng viên (`timUngVienSaiMa`, sai-ma-doc.ts): cùng một điều kiện", () => {
    const ma = boChuThich(doc("lib/payments/pos/sai-ma-doc.ts"));
    expect(dem(ma, new RegExp(`"${CAU}"`)), "đúng một chỗ nói câu này").toBe(1);
    const dk = [...ma.matchAll(DIEU_KIEN)].map((m) => m[1]);
    expect(dk, "điều kiện của cổng").toEqual(['intent.status !== "CHO_QUET"']);
  });

  it("ĐỐI CHỨNG của bộ cắt: biểu thức bắt được cả một mẫu có thêm `&& intent.status !== \"HUY\"` (đó chính là lỗi C14/C15) — nghĩa là lưới CÓ răng", () => {
    const loi = 'if (intent.status !== "CHO_QUET" && intent.status !== "HUY") return { ok: false, error: "Phiếu thu thẻ không còn chờ quẹt" };';
    expect([...loi.matchAll(DIEU_KIEN)].map((m) => m[1])).toEqual(['intent.status !== "CHO_QUET" && intent.status !== "HUY"']);
  });
});

describe("[HNC-06] `docTheDangMoCuaPhieuGop` đọc MỌI phiếu thẻ của phiếu gộp — kể cả HUY — để giao dịch chờ tay của một mã mà phiếu thẻ đã bị huỷ tay VẪN khoá 'Huỷ phiếu' (gộp)", () => {
  /** Khối `{ … }` mở ở `{` đầu tiên từ chỉ số `tu` (khớp ngoặc; mã đã bóc chú thích). `""` nếu không khớp. */
  function khoiNgoac(ma: string, tu: number): string {
    const mo = ma.indexOf("{", tu);
    let sau = 0;
    for (let i = mo; mo >= 0 && i < ma.length; i += 1) {
      if (ma[i] === "{") sau += 1;
      else if (ma[i] === "}") {
        sau -= 1;
        if (sau === 0) return ma.slice(mo, i + 1);
      }
    }
    return "";
  }
  const khoiPosIntents = (than: string) => khoiNgoac(than, than.search(/\bposIntents:\s*\{/));

  it("khối `posIntents` mở thẳng bằng `select` (không `where` / lọc trạng thái) và vẫn dừng sớm khi KHÔNG có phiếu thẻ nào", () => {
    // Mã TRƯỚC khi lưới có: `posIntents: { where: { status: { not: "HUY" } }, select: … }` làm phiếu gộp chỉ còn phiếu HUY biến thành "không có phiếu thẻ"
    // ⇒ `return null` ⇒ bỏ qua cả hàng chờ tay ⇒ huỷ phiếu thẻ → huỷ phiếu gộp → phát mã/QR mới cho khoản khách ĐÃ trả (đòi trả lần hai).
    const ma = boChuThich(doc("lib/payments/pos/the-dang-mo.ts"));
    const than = thanHamXuat(ma, "docTheDangMoCuaPhieuGop");
    expect(than.length, "cắt được thân hàm").toBeGreaterThan(300);
    expect(dem(than, /\bposIntents:\s*\{/), "đúng một khối posIntents").toBe(1);
    const khoi = khoiPosIntents(than);
    expect(khoi.length, "cắt được khối posIntents").toBeGreaterThan(50);
    // Luật cần khoá là "KHÔNG lọc" (dòng kế) — không phải "`select` đứng ĐẦU khối": thêm `orderBy` trước `select` vẫn đọc MỌI phiếu thẻ (rà ghép 10/10/2026).
    expect(khoi, "khối posIntents có select").toMatch(/\bselect:/);
    expect(khoi, "không `where` / lọc trạng thái trong khối").not.toMatch(/\bwhere\s*:|\bstatus\s*:\s*\{|\bNOT\s*:|\bnot\s*:/);
    expect(than, "vẫn dừng sớm khi không có phiếu thẻ NÀO").toMatch(/posIntents\.length === 0\) return null/);
  });

  it("ĐỐI CHỨNG của bộ cắt: một khối `posIntents` có `where` (lỗi cấy C09) bị CHÍNH bộ cắt này nhận ra", () => {
    const loi = 'posIntents: {\n        where: { status: { not: "HUY" } },\n        select: {\n          createdAt: true,\n        },\n      },';
    const khoi = khoiNgoac(loi, loi.search(/\bposIntents:\s*\{/));
    expect(khoi.length).toBeGreaterThan(50);
    expect(khoi).not.toMatch(/^\{\s*select:/);
    expect(khoi).toMatch(/\bwhere\s*:/);
  });
});
