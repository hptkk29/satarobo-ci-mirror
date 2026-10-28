// lib/payments/pos/nut-trong-hop-phieu-the.test.ts — `nutTrongHopPhieuThe`: MỘT chỗ quyết hộp phiếu thẻ vẽ NÚT NÀO (Việc 3 × Việc 4, lượt ghép 10/10/2026).
//
// Vì sao có hàm này: sau khi ghép, hộp phiếu thẻ có BA lối cùng sống — "Kiểm tra thanh toán", "Tôi nhập sai mã trên máy" (Việc 3: khách ĐÃ quẹt
// thành công mà sale gõ sai mã) và "Huỷ phiếu thẻ" (Việc 4: khách CHƯA quẹt). Mỗi việc được viết khi việc kia chưa tồn tại, nên điều kiện của
// chúng ghép SẠCH về văn bản nhưng HỎNG về nghĩa (docs §7.1): nút huỷ vẫn sáng trong cửa sổ "vừa gửi, trang chưa về" · dòng "Chưa huỷ được…" in
// thêm một lệnh "ĐỪNG cho khách quẹt lại" ngay dưới lệnh cấm của kế toán · hai nút nguy hiểm đứng cạnh nhau mà không câu nào nói khác biệt.
//
// RÀ ĐỐI KHÁNG BẢN GHÉP (10/10/2026) thêm hai đầu ra + một đầu vào, cùng một hàm:
//   · `tienDangBay` / `moiQuet` — phiếu còn chờ quẹt mà cổng huỷ nhận ra DẤU HIỆU TIỀN ĐANG BAY thì hộp KHÔNG được mời quẹt (bốn bước) và lý do phải ở tông cảnh báo;
//   · `dangHuy` — lượt huỷ đang chạy (máy chủ đã ghi HUY, trang chưa về): không mời quẹt, không mời "Tôi nhập sai mã" (máy chủ chắc chắn từ chối);
//   · nút "Tôi nhập sai mã" tắt khi có DÒNG THẺ MANG ĐÚNG MÃ (cổng G-A của bước tìm chắc chắn từ chối — luật 12).
//
// FIXTURE ĐI QUA ĐƯỜNG THẬT (luật 9 của `docs/luat-doc-so-va-ket-luan.md`): mọi view ở đây do CHÍNH `dungPhieuPosView` dựng từ hàng thô —
// KHÔNG gõ tay `huyPhieuThe`. Lý do đo được: ca `[HN3-R10]`/`[HN3-R11]` đỏ vì fixture dùng mặc định `huyDuoc: true` cho một phiếu mà máy chủ
// chắc chắn trả `huyDuoc: false` (CAN_XU_LY ...); một fixture sai mô hình làm test nói về một trạng thái không tồn tại.
// VIỆC 6 · a2 (10/10/2026): kế toán từ chối thì sale HUỶ ĐƯỢC phiếu thẻ — mã `SAI_MA_BI_TU_CHOI` đã gỡ. Hộp sau từ chối: nút huỷ HIỆN khi cổng thường cho; vẫn KHÔNG mời quẹt lại;
// khi cổng không cho thì KHÔNG in dòng lý do thứ hai (dòng đỏ của yêu cầu là lệnh cấm duy nhất).
//
// Đồng hồ ĐÓNG BĂNG (luật 19): `NOW` truyền vào `dungPhieuPosView`, không đọc đồng hồ thật.
import { describe, expect, it } from "vitest";
import { dungPhieuPosView, type PhieuPosDeXem, type PhieuPosView } from "./phieu-pos-luat";
import { cauTuChoi, nutNhapSaiMa } from "./sai-ma";
import { thongDiepPos } from "./thong-diep-pos";
import { NHAN_NUT_HUY_PHIEU_THE } from "./huy-phieu-the-cau";
import { buocSaiMaConHieuLuc, canhBaoDonDaBac, CAU_PHAN_BIET_HAI_NUT, MA_TIEN_DANG_BAY, nutTrongHopPhieuThe, type DauVaoNutTrongHop, type NutTrongHop } from "./nut-trong-hop-phieu-the";

const PHUT = 60_000;
const NOW = new Date("2026-10-09T06:30:00.000Z");
const TAO = new Date(NOW.getTime() - 2 * PHUT);

const CAU_CHUA_THAY = thongDiepPos({
  loai: "CHUA_THAY",
  code5: "H6WR4",
  duLieuLuc: new Date(NOW.getTime() - PHUT),
  gdMoiNhatLuc: new Date(NOW.getTime() - PHUT),
  taoLuc: TAO,
  baoAdminTuLuc: new Date(TAO.getTime() + 10 * PHUT),
}).cau;
const CAU_DANG_XU_LY = thongDiepPos({ loai: "DANG_CHO_NGAN_HANG", code5: "H6WR4", maTrangThai: "Đang xử lý" }).cau;
/** Câu `tuChoiSaiMa` ghi vào phiếu thẻ lúc kế toán từ chối — HÀM THẬT của Việc 3, với đúng lý do mà `yeuCau("TU_CHOI")` dựng (VIỆC 6 · a2: view nhận ra câu này qua yêu cầu MỚI NHẤT). */
const CAU_SAU_TU_CHOI = cauTuChoi("Giao dịch của khách khác");

function raw(p: Partial<PhieuPosDeXem> = {}): PhieuPosDeXem {
  return {
    id: "i1",
    code5: "H6WR4",
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
const yeuCau = (trangThai: PhieuPosDeXem["saiMaYeuCau"][number]["trangThai"]): PhieuPosDeXem["saiMaYeuCau"] => [
  { trangThai, lyDoTuChoi: trangThai === "TU_CHOI" ? "Giao dịch của khách khác" : null, dangGhiLuc: null, btStatus: "UNMATCHED", btDaGoGan: false },
];
const PHIEU_MO = { billId: "b1", tongTien: 800_000, dong: [{ paymentRequestId: "pr1", ten: "Đợt 1", soTien: 800_000 }] };
const chuaThay = { lastResultKind: "NOT_FOUND", lastResultMessage: CAU_CHUA_THAY } as const;

type NguCanh = { choLamMoi?: boolean; dangHuy?: boolean };
/**
 * Đúng phép nối của `NoiDungPhieu` (hop-phieu-pos.tsx): `nutSaiMa` do `nutNhapSaiMa` (Việc 3) tính trên câu đang hiện, `daBiTuChoi` đọc từ `saiMa`
 * (chỉ trên phiếu còn mở). Lưới `[HNG-W*]` ghim biểu thức ở component — nếu hai bên lệch thì ca ghim đỏ, không phải ca này.
 */
function noi(v: PhieuPosView, c: NguCanh = {}): { dau: DauVaoNutTrongHop; nut: NutTrongHop } {
  const h = v.hienThi;
  const dau: DauVaoNutTrongHop = {
    hienThi: h,
    huyPhieuThe: v.huyPhieuThe,
    saiMa: v.saiMa,
    nutSaiMa: nutNhapSaiMa({ hienThi: h, thongDiep: v.thongDiep }),
    daBiTuChoi: v.saiMa?.trangThai === "TU_CHOI" && (h === "CHO_QUET" || h === "THAT_BAI" || h === "HET_HAN"),
    choLamMoi: c.choLamMoi ?? false,
    dangHuy: c.dangHuy ?? false,
  };
  return { dau, nut: nutTrongHopPhieuThe(dau) };
}
const view = (p: Partial<PhieuPosDeXem> = {}) => dungPhieuPosView({ intent: raw(p), phieuMo: PHIEU_MO, now: NOW });
const tinh = (p: Partial<PhieuPosDeXem> = {}, c: NguCanh = {}) => noi(view(p), c).nut;

/** Tập mã từ chối mà hàm coi là "tiền đang bay" — ghim ở đây để thêm / bớt một mã phải sửa CẢ hàm lẫn lưới (bất biến I10 đọc từ view thật). */
const MA_BAY = ["DA_NHAN_GIAO_DICH", "CO_GIAO_DICH_CHO_TAY", "CO_YEU_CAU_SAI_MA", "DONG_THE_CHUA_NGA_NGU", "KET_QUA_PAID_CHUA_GHI", "CHUA_NGA_NGU"];
const MA_DONG_MANG_MA = ["CO_GIAO_DICH_CHO_TAY", "DONG_THE_CHUA_NGA_NGU"];

describe("[HNG-N01] bảng trạng thái THẬT ⇒ (nút huỷ · nút nhập sai mã · câu phân biệt · tiền đang bay · mời quẹt)", () => {
  type Hang = [ten: string, p: Partial<PhieuPosDeXem>, c: NguCanh, mong: NutTrongHop];
  const KHONG_DONG: NutTrongHop = { huyPhieuThe: "KHONG", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: false };
  const BANG: Hang[] = [
    // ── Phiếu còn chờ quẹt, huỷ được ────────────────────────────────────────────
    ["chưa kiểm lần nào (khách chưa quẹt) ⇒ chỉ nút huỷ, MỜI quẹt", {}, {}, { huyPhieuThe: "NUT", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: true }],
    [
      "'Chưa thấy' trần ⇒ CẢ HAI nút + câu nói khác biệt (khách ĐÃ quẹt ↔ CHƯA quẹt), MỜI quẹt",
      { ...chuaThay },
      {},
      { huyPhieuThe: "NUT", nhapSaiMa: true, phanBiet: true, tienDangBay: false, moiQuet: true },
    ],
    [
      "máy báo lần quẹt gần nhất THẤT BẠI ⇒ chỉ nút huỷ (V62: THAT_BAI không có 'nhập sai mã'), MỜI quẹt",
      { status: "THAT_BAI", lastResultKind: "FAILED", lastResultMessage: "Giao dịch thất bại — cho quẹt lại." },
      {},
      { huyPhieuThe: "NUT", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: true },
    ],
    // ── Cửa sổ "vừa gửi, trang chưa về": props còn CHO_QUET + huyDuoc:true nhưng phiếu thật đã sang CAN_XU_LY ─────
    ["'Chưa thấy' + sale VỪA GỬI yêu cầu (trang chưa về) ⇒ KHÔNG nút huỷ (không chỉ khoá), KHÔNG nhập sai mã, KHÔNG mời quẹt", { ...chuaThay }, { choLamMoi: true }, KHONG_DONG],
    // ── Cửa sổ "đang huỷ, trang chưa về" (rà ghép 10/10/2026): máy chủ đã ghi HUY, props còn CHO_QUET ───────────────
    [
      "chưa kiểm + sale ĐANG HUỶ (trang chưa về) ⇒ nút huỷ GIỮ (để hiện 'Đang huỷ…'), KHÔNG mời quẹt",
      {},
      { dangHuy: true },
      { huyPhieuThe: "NUT", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: false },
    ],
    [
      "'Chưa thấy' trần + sale ĐANG HUỶ ⇒ KHÔNG nút nhập sai mã (máy chủ chắc chắn từ chối: phiếu không còn chờ quẹt), KHÔNG câu phân biệt, KHÔNG mời quẹt",
      { ...chuaThay },
      { dangHuy: true },
      { huyPhieuThe: "NUT", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: false },
    ],
    // ── Kế toán đã TỪ CHỐI (VIỆC 6 · a2: sale HUỶ ĐƯỢC phiếu thẻ; hộp vẫn KHÔNG mời quẹt lại và vẫn chỉ MỘT lệnh cấm — dòng đỏ của chính yêu cầu) ──
    [
      "NGAY SAU từ chối (câu lưu = `cauTuChoi(lyDo)`) ⇒ nút HUỶ HIỆN (huỷ theo cổng thường); KHÔNG nút nhập sai mã (câu đang hiện không phải 'Chưa thấy'); KHÔNG mời quẹt",
      { lastResultKind: "NOT_FOUND", lastResultMessage: CAU_SAU_TU_CHOI, saiMaYeuCau: yeuCau("TU_CHOI") },
      {},
      { huyPhieuThe: "NUT", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: false },
    ],
    [
      "vài phút sau, poller ghi 'Chưa thấy' trần ⇒ VẪN nút huỷ (không nhấp nháy); nút nhập sai mã hiện lại (V76) ⇒ CẢ HAI nút + câu phân biệt; KHÔNG mời quẹt",
      { ...chuaThay, saiMaYeuCau: yeuCau("TU_CHOI") },
      {},
      { huyPhieuThe: "NUT", nhapSaiMa: true, phanBiet: true, tienDangBay: false, moiQuet: false },
    ],
    [
      "sau từ chối, lượt kiểm ghi dòng 'Đang xử lý' mang mã ⇒ KHÔNG huỷ được (CHUA_NGA_NGU) nhưng KHÔNG in dòng lý do thứ hai dưới dòng đỏ (MỘT lệnh cấm); không nút nào; KHÔNG mời quẹt",
      { lastResultKind: "NOT_FOUND", lastResultMessage: CAU_DANG_XU_LY, saiMaYeuCau: yeuCau("TU_CHOI") },
      {},
      { huyPhieuThe: "KHONG", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: false },
    ],
    [
      // VIỆC 6 (chốt, rà đối kháng): lý do không huỷ được KHÔNG phải dấu hiệu tiền đang bay (lỗi kết nối = chưa biết gì) thì dòng lý do VẪN in — nó trung tính nên không thể là "lệnh cấm thứ hai", và nút biến mất
      // không lý do là nút nói dối (luật 12). Bản trước gộp mọi lý do thành KHONG sau từ chối.
      "sau từ chối, lượt kiểm ghi LỖI KẾT NỐI (PROVIDER_ERROR) ⇒ không huỷ được (LOI_KET_NOI) nhưng dòng lý do XÁM vẫn in (lý do trung tính, KHÔNG phải lệnh cấm quẹt); không nút huỷ; KHÔNG tông tiền-đang-bay; KHÔNG mời quẹt",
      { lastResultKind: "PROVIDER_ERROR", lastResultMessage: "Lỗi kết nối hệ thống thanh toán (mã X) — đã báo admin.", saiMaYeuCau: yeuCau("TU_CHOI") },
      {},
      { huyPhieuThe: "DONG_LY_DO", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: false },
    ],
    [
      "sau từ chối + giao dịch thẻ MANG ĐÚNG MÃ chờ kế toán ⇒ không huỷ được ⇒ KHONG (dòng đỏ của yêu cầu là lệnh cấm duy nhất); KHÔNG nút nhập sai mã (cổng G-A); KHÔNG mời quẹt",
      { ...chuaThay, saiMaYeuCau: yeuCau("TU_CHOI"), coGiaoDichChoTay: true },
      {},
      { huyPhieuThe: "KHONG", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: false },
    ],
    [
      "sau từ chối + sale VỪA GỬI yêu cầu MỚI (trang chưa về) ⇒ KHÔNG nút huỷ, KHÔNG nhập sai mã, KHÔNG mời quẹt (cửa sổ vừa gửi thắng)",
      { ...chuaThay, saiMaYeuCau: yeuCau("TU_CHOI") },
      { choLamMoi: true },
      KHONG_DONG,
    ],
    [
      "sau từ chối + sale ĐANG HUỶ (trang chưa về) ⇒ nút huỷ GIỮ (hiện 'Đang huỷ…'), KHÔNG nhập sai mã, KHÔNG mời quẹt",
      { lastResultKind: "NOT_FOUND", lastResultMessage: CAU_SAU_TU_CHOI, saiMaYeuCau: yeuCau("TU_CHOI") },
      { dangHuy: true },
      { huyPhieuThe: "NUT", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: false },
    ],
    // ── Không huỷ được vì kết quả lượt kiểm CHƯA CHỐT (chưa phải dấu hiệu tiền đang bay) ⇒ MỘT dòng xám, vẫn mời quẹt như cũ ──
    [
      "lỗi kết nối ở lượt kiểm gần nhất ⇒ dòng lý do (xám), KHÔNG phải tiền đang bay, vẫn mời quẹt như trước",
      { lastResultKind: "PROVIDER_ERROR", lastResultMessage: "x" },
      {},
      { huyPhieuThe: "DONG_LY_DO", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: true },
    ],
    [
      "PAID trên phiếu THẤT BẠI (có thể khách đã huỷ trên máy, cũng có thể đã quẹt) ⇒ dòng lý do TRUNG TÍNH (xám), không coi là tiền đang bay",
      { status: "THAT_BAI", lastResultKind: "PAID", lastResultMessage: "Đã thu" },
      {},
      { huyPhieuThe: "DONG_LY_DO", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: true },
    ],
    // ── DẤU HIỆU TIỀN ĐANG BAY ⇒ dòng lý do ở TÔNG CẢNH BÁO + KHÔNG mời quẹt ──────────────────────────────
    [
      "dòng 'Đang xử lý' mang mã (NOT_FOUND nhưng KHÔNG phải 'chưa thấy' trần) ⇒ tiền đang bay: cảnh báo, không mời quẹt, không nút nhập sai mã",
      { lastResultKind: "NOT_FOUND", lastResultMessage: CAU_DANG_XU_LY },
      {},
      { huyPhieuThe: "DONG_LY_DO", nhapSaiMa: false, phanBiet: false, tienDangBay: true, moiQuet: false },
    ],
    [
      "'Chưa thấy' + giao dịch thẻ MANG ĐÚNG MÃ chờ kế toán ⇒ tiền đang bay; KHÔNG nút nhập sai mã (cổng G-A của bước tìm chắc chắn từ chối: 'Có giao dịch mang mã X — bấm Kiểm tra')",
      { ...chuaThay, coGiaoDichChoTay: true },
      {},
      { huyPhieuThe: "DONG_LY_DO", nhapSaiMa: false, phanBiet: false, tienDangBay: true, moiQuet: false },
    ],
    [
      "'Chưa thấy' + dòng thẻ mang mã CHƯA NGÃ NGŨ (Việc 4: câu lưu cũ vẫn nói 'Chưa thấy') ⇒ tiền đang bay; KHÔNG nút nhập sai mã, KHÔNG mời quẹt",
      { ...chuaThay, coDongTheChuaKetLuan: true },
      {},
      { huyPhieuThe: "DONG_LY_DO", nhapSaiMa: false, phanBiet: false, tienDangBay: true, moiQuet: false },
    ],
    [
      "lượt kiểm thấy khách ĐÃ quẹt (PAID) mà phiếu còn CHO_QUET ⇒ tiền đang bay: cảnh báo, không mời quẹt",
      { lastResultKind: "PAID", lastResultMessage: "Đã thu" },
      {},
      { huyPhieuThe: "DONG_LY_DO", nhapSaiMa: false, phanBiet: false, tienDangBay: true, moiQuet: false },
    ],
    [
      "'Chưa thấy' + yêu cầu sai mã đang GIỮ trên phiếu còn CHO_QUET (dữ liệu vi phạm bất biến) ⇒ tiền đang bay; KHÔNG nút nhập sai mã (DB có `PosSaiMaYeuCau_phieu_giu_key`: gửi thêm chắc chắn bị từ chối)",
      { ...chuaThay, saiMaYeuCau: yeuCau("CHO_DUYET") },
      {},
      { huyPhieuThe: "DONG_LY_DO", nhapSaiMa: false, phanBiet: false, tienDangBay: true, moiQuet: false },
    ],
    // ── Phiếu ĐÃ ĐÓNG ⇒ hộp tự kể trạng thái, không nút, không dòng, không mời quẹt ───────────────────────────
    [
      "đã gửi kế toán (CAN_XU_LY + yêu cầu CHO_DUYET) ⇒ không nút nào",
      { status: "CAN_XU_LY", bankTransaction: { status: "UNMATCHED", allocations: [] }, saiMaYeuCau: yeuCau("CHO_DUYET") },
      {},
      KHONG_DONG,
    ],
    [
      "đã thu (DA_THU, tiền vào đúng phiếu gộp)",
      { status: "DA_THU", bankTransaction: { status: "MATCHED", allocations: [{ paymentRequestId: "pr1" }] } },
      {},
      KHONG_DONG,
    ],
    ["hết hạn", { expiresAt: NOW }, {}, KHONG_DONG],
    ["phiếu gộp đã đóng", { paymentBill: { status: "CLOSED", lines: [{ paymentRequestId: "pr1" }] } }, {}, KHONG_DONG],
    ["đã huỷ tay (HUY)", { status: "HUY" }, {}, KHONG_DONG],
  ];

  for (const [i, [ten, p, c, mong]] of BANG.entries()) {
    it(`[HNG-N01-${i + 1}] ${ten}`, () => {
      expect(tinh(p, c)).toEqual(mong);
    });
  }

  it("[HNG-N01-cot] ĐỐI CHỨNG DƯƠNG (luật 11): bảng có đủ cả ba giá trị của nút huỷ, cả hai giá trị của mỗi cờ còn lại — không hàng nào 'luôn KHONG' xanh nhờ trùng hợp", () => {
    const ra = BANG.map(([, , , m]) => m);
    expect(new Set(ra.map((m) => m.huyPhieuThe))).toEqual(new Set(["NUT", "DONG_LY_DO", "KHONG"]));
    expect(new Set(ra.map((m) => m.nhapSaiMa))).toEqual(new Set([true, false]));
    expect(new Set(ra.map((m) => m.tienDangBay))).toEqual(new Set([true, false]));
    expect(new Set(ra.map((m) => m.moiQuet))).toEqual(new Set([true, false]));
    expect(ra.some((m) => m.phanBiet)).toBe(true);
  });
});

describe("[HNG-N02] bất biến trên LƯỚI TỔ HỢP đầu vào thật (view do `dungPhieuPosView` dựng)", () => {
  const STATUS = ["CHO_QUET", "THAT_BAI", "DA_THU", "LECH_TIEN", "CAN_XU_LY", "HET_HAN", "HUY"] as const;
  const KET_QUA: Partial<PhieuPosDeXem>[] = [
    {},
    { lastResultKind: "FAILED", lastResultMessage: "Giao dịch thất bại — cho quẹt lại." },
    { ...chuaThay },
    { lastResultKind: "NOT_FOUND", lastResultMessage: CAU_DANG_XU_LY },
    { lastResultKind: "PROVIDER_ERROR", lastResultMessage: "x" },
    { lastResultKind: "PAID", lastResultMessage: "Đã thu" },
  ];
  const YEU_CAU: PhieuPosDeXem["saiMaYeuCau"][] = [[], yeuCau("CHO_DUYET"), yeuCau("DANG_GHI"), yeuCau("DA_GHI_NHAN"), yeuCau("TU_CHOI")];

  it("[HNG-N02] I1–I12 trên 13.440 tổ hợp (trạng thái × hạn × phiếu gộp × kết quả kiểm × yêu cầu sai mã × giao dịch chờ tay × dòng chưa ngã ngũ × vừa gửi × đang huỷ)", () => {
    const dem = { NUT: 0, DONG_LY_DO: 0, KHONG: 0, phanBiet: 0, nhapSaiMa: 0, tienDangBay: 0, moiQuet: 0, tong: 0 };
    for (const status of STATUS)
      for (const hetHan of [false, true])
        for (const billMo of [true, false])
          for (const kq of KET_QUA)
            for (const saiMaYeuCau of YEU_CAU)
              for (const coGiaoDichChoTay of [false, true])
                for (const coDongTheChuaKetLuan of [false, true])
                  for (const choLamMoi of [false, true])
                    for (const dangHuy of [false, true]) {
                      const v = view({
                        status,
                        expiresAt: hetHan ? NOW : new Date(NOW.getTime() + 60 * PHUT),
                        paymentBill: { status: billMo ? "OPEN" : "CLOSED", lines: [{ paymentRequestId: "pr1" }] },
                        ...kq,
                        saiMaYeuCau,
                        coGiaoDichChoTay,
                        coDongTheChuaKetLuan,
                      });
                      const { dau, nut } = noi(v, { choLamMoi, dangHuy });
                      const ten = JSON.stringify({ status, hetHan, billMo, kq: kq.lastResultKind ?? null, yc: saiMaYeuCau[0]?.trangThai ?? null, coGiaoDichChoTay, coDongTheChuaKetLuan, choLamMoi, dangHuy, hienThi: v.hienThi });
                      const chuaQuet = v.hienThi === "CHO_QUET" || v.hienThi === "THAT_BAI";
                      // VIỆC 6 · a2: `coThe` = hộp CÓ THỂ nói về việc huỷ (phiếu còn chờ quẹt, không ở cửa sổ vừa gửi). Sau từ chối nó VẪN đúng — nút huỷ quay lại.
                      const coThe = chuaQuet && !choLamMoi;
                      // `sach` = trước đây "chưa từng bị từ chối" — GIỮ cho các bất biến về BỐN BƯỚC MỜI QUẸT (sau từ chối hộp không mời quẹt lại).
                      const sach = coThe && !dau.daBiTuChoi;
                      const dangGiu = v.saiMa !== null && v.saiMa.trangThai !== "TU_CHOI";
                      const ma = v.huyPhieuThe.huyDuoc ? null : v.huyPhieuThe.ma;

                      // I1 — vẽ NÚT thì máy chủ sẽ cho huỷ: phán quyết của hàm luật, phiếu còn chờ quẹt, không phải cửa sổ vừa gửi. (Sau từ chối: ĐƯỢC vẽ.)
                      if (nut.huyPhieuThe === "NUT") expect(v.huyPhieuThe.huyDuoc && coThe, `I1 ${ten}`).toBe(true);
                      // I2 — vẽ DÒNG LÝ DO thì quả thật không huỷ được, phiếu còn chờ quẹt, và hộp CHƯA có dòng đỏ của yêu cầu bị từ chối (một lệnh cấm, không hai — `[HN3-R11b]`).
                      // VIỆC 6 (chốt): sau từ chối dòng lý do CHỈ còn khi lý do KHÔNG thuộc nhóm tiền-đang-bay (lý do trung tính không thành lệnh cấm thứ hai).
                      if (nut.huyPhieuThe === "DONG_LY_DO") expect(!v.huyPhieuThe.huyDuoc && coThe && (sach || (ma !== null && !MA_TIEN_DANG_BAY.includes(ma))), `I2 ${ten}`).toBe(true);
                      // I3 — LUẬT 12: phiếu còn chờ quẹt (ngoài các ngoại lệ có chủ đích) thì hoặc có nút hoặc có lý do, KHÔNG im lặng. Ngoại lệ: vừa gửi · hoặc đã bị từ chối mà không huỷ được
                      // (dòng đỏ của yêu cầu đã là lệnh cấm — in thêm lý do là lệnh cấm thứ hai).
                      if (coThe && !(dau.daBiTuChoi && ma !== null && MA_TIEN_DANG_BAY.includes(ma))) expect(nut.huyPhieuThe, `I3 ${ten}`).not.toBe("KHONG");
                      // I3b — sau từ chối: huỷ ĐƯỢC ⇒ có NÚT; không huỷ được ⇒ KHÔNG dòng (chỉ dòng đỏ).
                      // VIỆC 6 (chốt): không huỷ được ⇒ KHONG CHỈ khi lý do là dấu hiệu tiền đang bay (dòng đỏ của yêu cầu là lệnh cấm duy nhất); lý do trung tính (lỗi kết nối · PAID sau thất bại · huỷ sau thu) ⇒ DONG_LY_DO.
                      if (coThe && dau.daBiTuChoi) expect(nut.huyPhieuThe, `I3b ${ten}`).toBe(v.huyPhieuThe.huyDuoc ? "NUT" : ma !== null && MA_TIEN_DANG_BAY.includes(ma) ? "KHONG" : "DONG_LY_DO");
                      // I4 — ngoài tập "có thể" (không chờ quẹt · vừa gửi) thì không nút, không dòng.
                      if (!coThe) expect(nut.huyPhieuThe, `I4 ${ten}`).toBe("KHONG");
                      // I5 — nút nhập sai mã: chỉ khi V3 cho (`nutNhapSaiMa`) VÀ chưa có yêu cầu đang giữ VÀ không phải cửa sổ vừa gửi / đang huỷ.
                      if (nut.nhapSaiMa) {
                        expect(dau.nutSaiMa && !dangGiu && !choLamMoi && !dangHuy, `I5 ${ten}`).toBe(true);
                        expect(v.hienThi, `I5 ${ten}`).toBe("CHO_QUET");
                      }
                      // I6 — câu phân biệt ⇔ cả hai nút cùng hiện.
                      expect(nut.phanBiet, `I6 ${ten}`).toBe(nut.nhapSaiMa && nut.huyPhieuThe === "NUT");
                      // I7 — cửa sổ vừa gửi: dù props còn nói huyDuoc:true cũng KHÔNG vẽ nút huỷ.
                      if (choLamMoi) expect(nut.huyPhieuThe, `I7 ${ten}`).toBe("KHONG");
                      // I8 — PHÍA VIEW (VIỆC 6 · a2 viết lại): yêu cầu ĐANG GIỮ (≠ TU_CHOI) trên phiếu còn chờ quẹt ⇒ `dungPhieuPosView` trả `huyDuoc: false`. Đây là sợi dây giữ vị từ
                      // `dangGiuYeuCau` của hàm ghép KHÔNG LỆCH khỏi `coYeuCauSaiMaDangGiu` của view: view đổi nghĩa "đang giữ" mà quên hàm ghép thì ca này đỏ ở ô tương ứng.
                      if (dangGiu && chuaQuet) expect(v.huyPhieuThe.huyDuoc, `I8 ${ten}`).toBe(false);
                      // I8b — yêu cầu BỊ TỪ CHỐI không tự nó đổi phán quyết huỷ: cùng hàng thô nhưng KHÔNG có yêu cầu nào ⇒ cùng kết quả (bỏ cổng riêng `SAI_MA_BI_TU_CHOI`). Câu lưu trong lưới
                      // không bao giờ là câu từ chối nên cờ nhận ra câu luôn tắt ở đây — phần "câu từ chối" được đo ở hàng bảng `[HNG-N01]` và `[HN6-A2-V1]`.
                      if (v.saiMa?.trangThai === "TU_CHOI") {
                        const khongYeuCau = view({
                          status,
                          expiresAt: hetHan ? NOW : new Date(NOW.getTime() + 60 * PHUT),
                          paymentBill: { status: billMo ? "OPEN" : "CLOSED", lines: [{ paymentRequestId: "pr1" }] },
                          ...kq,
                          saiMaYeuCau: [],
                          coGiaoDichChoTay,
                          coDongTheChuaKetLuan,
                        });
                        expect(v.huyPhieuThe, `I8b ${ten}`).toEqual(khongYeuCau.huyPhieuThe);
                      }
                      // I9 — MỜI quẹt ⇔ phiếu "sạch" (còn chờ quẹt, không sau từ chối, không vừa gửi) ∧ không dấu hiệu tiền đang bay ∧ không đang huỷ.
                      expect(nut.moiQuet, `I9 ${ten}`).toBe(sach && !nut.tienDangBay && !dangHuy);
                      // I10 — tiền đang bay ⇒ phiếu "sạch" mà KHÔNG huỷ được vì đúng một mã trong tập dấu hiệu; dòng lý do được vẽ (không im lặng); KHÔNG mời quẹt.
                      if (nut.tienDangBay) {
                        expect(sach && ma !== null && MA_BAY.includes(ma), `I10 ${ten}`).toBe(true);
                        expect(nut.huyPhieuThe, `I10 ${ten}`).toBe("DONG_LY_DO");
                        expect(nut.moiQuet, `I10 ${ten}`).toBe(false);
                      }
                      // I10b — ngược lại: phiếu "sạch" + mã thuộc tập dấu hiệu ⇒ phải được gắn cờ (không sót mã nào).
                      if (sach && ma !== null && MA_BAY.includes(ma)) expect(nut.tienDangBay, `I10b ${ten}`).toBe(true);
                      // I11 — có DÒNG THẺ MANG ĐÚNG MÃ (giao dịch chờ tay · dòng chưa ngã ngũ) trên phiếu còn chờ quẹt ⇒ KHÔNG mời "Tôi nhập sai mã" (cổng G-A chắc chắn từ chối).
                      if (chuaQuet && ma !== null && MA_DONG_MANG_MA.includes(ma)) expect(nut.nhapSaiMa, `I11 ${ten}`).toBe(false);
                      // I12 — đang huỷ: KHÔNG mời quẹt, KHÔNG nút nhập sai mã (nút huỷ giữ nguyên để hiện 'Đang huỷ…').
                      if (dangHuy) {
                        expect(nut.moiQuet, `I12 ${ten}`).toBe(false);
                        expect(nut.nhapSaiMa, `I12 ${ten}`).toBe(false);
                      }

                      dem[nut.huyPhieuThe] += 1;
                      if (nut.phanBiet) dem.phanBiet += 1;
                      if (nut.nhapSaiMa) dem.nhapSaiMa += 1;
                      if (nut.tienDangBay) dem.tienDangBay += 1;
                      if (nut.moiQuet) dem.moiQuet += 1;
                      dem.tong += 1;
                    }
    expect(dem.tong).toBe(13_440); // 7 × 2 × 2 × 6 × 5 × 2 × 2 × 2 × 2
    // Lưới phải có mặt ở MỌI nhánh, kẻo "luôn KHONG" cũng thoả mọi bất biến.
    expect(dem.NUT, "có ô vẽ nút huỷ").toBeGreaterThan(0);
    expect(dem.DONG_LY_DO, "có ô vẽ dòng lý do").toBeGreaterThan(0);
    expect(dem.KHONG, "có ô không vẽ gì").toBeGreaterThan(0);
    expect(dem.phanBiet, "có ô hiện cả hai nút").toBeGreaterThan(0);
    expect(dem.nhapSaiMa, "có ô hiện nút nhập sai mã").toBeGreaterThan(0);
    expect(dem.tienDangBay, "có ô tiền đang bay").toBeGreaterThan(0);
    expect(dem.moiQuet, "có ô mời quẹt").toBeGreaterThan(0);
  });
});

describe("[HNG-N03] tự bảo vệ khi đầu vào KHÔNG nhất quán (chỉ xảy ra khi có người dựng view bằng tay hoặc trang cũ)", () => {
  const HUY_DUOC = { huyDuoc: true, canXacNhanManh: true } as const;
  const dau = (p: Partial<DauVaoNutTrongHop> = {}): DauVaoNutTrongHop => ({
    hienThi: "CHO_QUET",
    huyPhieuThe: HUY_DUOC,
    saiMa: null,
    nutSaiMa: false,
    daBiTuChoi: false,
    choLamMoi: false,
    dangHuy: false,
    ...p,
  });

  it("[HNG-N03a] ĐỐI CHỨNG DƯƠNG: đầu vào nhất quán, huyDuoc:true ⇒ NUT", () => {
    expect(nutTrongHopPhieuThe(dau()).huyPhieuThe).toBe("NUT");
  });

  it("[HNG-N03b] (VIỆC 6 · a2 viết lại) view nói huyDuoc:true và kế toán đã từ chối ⇒ NÚT HIỆN (cổng riêng `SAI_MA_BI_TU_CHOI` đã bỏ); nhưng KHÔNG mời quẹt lại — bốn bước vẫn ẩn", () => {
    const ra = nutTrongHopPhieuThe(dau({ daBiTuChoi: true, saiMa: { trangThai: "TU_CHOI", hieuLuc: "TU_CHOI", lyDoTuChoi: null } }));
    expect(ra.huyPhieuThe).toBe("NUT");
    expect(ra.moiQuet, "sau từ chối KHÔNG mời quẹt lại").toBe(false);
    // ĐỐI CHỨNG DƯƠNG: cùng đầu vào, KHÔNG bị từ chối ⇒ nút CÓ và hộp MỜI quẹt.
    expect(nutTrongHopPhieuThe(dau()).moiQuet).toBe(true);
  });

  it("[HNG-N03b2] view nói huyDuoc:FALSE và kế toán đã từ chối ⇒ KHÔNG nút VÀ KHÔNG dòng lý do KHI lý do là dấu hiệu TIỀN ĐANG BAY (dòng đỏ của yêu cầu là lệnh cấm duy nhất — không hai lệnh cấm liền nhau, `[HN3-R11b]`)", () => {
    const khongHuy = (ma: "CHUA_NGA_NGU" | "CO_GIAO_DICH_CHO_TAY" | "DONG_THE_CHUA_NGA_NGU" | "LOI_KET_NOI") =>
      ({ huyDuoc: false, ma, lyDo: "x", viecNenLam: "y." }) as const;
    for (const ma of ["CHUA_NGA_NGU", "CO_GIAO_DICH_CHO_TAY", "DONG_THE_CHUA_NGA_NGU"] as const) {
      const ra = nutTrongHopPhieuThe(dau({ daBiTuChoi: true, huyPhieuThe: khongHuy(ma), saiMa: { trangThai: "TU_CHOI", hieuLuc: "TU_CHOI", lyDoTuChoi: null } }));
      expect(ra.huyPhieuThe, ma).toBe("KHONG");
      expect(ra.tienDangBay, `${ma}: dòng lý do không vẽ nên không có tông cảnh báo của nó`).toBe(false);
      expect(ra.moiQuet, `${ma}: vẫn không mời quẹt`).toBe(false);
      // ĐỐI CHỨNG DƯƠNG: cùng lý do mà CHƯA bị từ chối ⇒ có dòng lý do.
      expect(nutTrongHopPhieuThe(dau({ huyPhieuThe: khongHuy(ma) })).huyPhieuThe, `${ma} (chưa bị từ chối)`).toBe("DONG_LY_DO");
    }
  });

  it("[HNG-N03b3] VIỆC 6 (chốt): lý do TRUNG TÍNH (lỗi kết nối — chưa biết gì; KHÔNG phải dấu hiệu tiền đang bay) ⇒ sau từ chối dòng lý do XÁM VẪN in (không phải lệnh cấm quẹt nên không là lệnh cấm thứ hai); vẫn không nút, không tông cảnh báo, không mời quẹt", () => {
    const ra = nutTrongHopPhieuThe(
      dau({ daBiTuChoi: true, huyPhieuThe: { huyDuoc: false, ma: "LOI_KET_NOI", lyDo: "x", viecNenLam: "y." }, saiMa: { trangThai: "TU_CHOI", hieuLuc: "TU_CHOI", lyDoTuChoi: null } }),
    );
    expect(ra.huyPhieuThe).toBe("DONG_LY_DO");
    expect(ra.tienDangBay, "lý do trung tính ⇒ không tông cảnh báo").toBe(false);
    expect(ra.moiQuet, "vẫn không mời quẹt").toBe(false);
    expect(MA_TIEN_DANG_BAY, "LOI_KET_NOI thật sự KHÔNG thuộc nhóm tiền-đang-bay").not.toContain("LOI_KET_NOI");
  });

  it("[HNG-N03c] view nói huyDuoc:true nhưng hộp đang vẽ một trạng thái KHÔNG chờ quẹt ⇒ KHÔNG nút", () => {
    for (const h of ["HUY", "DA_THU", "HET_HAN", "PHIEU_DA_DONG", "CAN_XU_LY", "LECH_TIEN", "KE_TOAN_DA_GHI", "KE_TOAN_DA_GO"] as const) {
      expect(nutTrongHopPhieuThe(dau({ hienThi: h })).huyPhieuThe, h).toBe("KHONG");
    }
  });

  it("[HNG-N03d] cửa sổ vừa gửi ⇒ KHÔNG nút dù huyDuoc:true; và nút nhập sai mã cũng tắt dù `nutSaiMa` còn true (không dựa vào việc câu đang hiện tình cờ đã đổi)", () => {
    const ra = nutTrongHopPhieuThe(dau({ choLamMoi: true, nutSaiMa: true }));
    expect(ra).toEqual({ huyPhieuThe: "KHONG", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: false });
  });

  it("[HNG-N03e] đang huỷ ⇒ nút nhập sai mã tắt dù `nutSaiMa` còn true, không mời quẹt; nút huỷ GIỮ (hộp cần hiện 'Đang huỷ…') — và không có câu phân biệt (chỉ MỘT nút)", () => {
    const ra = nutTrongHopPhieuThe(dau({ dangHuy: true, nutSaiMa: true }));
    expect(ra).toEqual({ huyPhieuThe: "NUT", nhapSaiMa: false, phanBiet: false, tienDangBay: false, moiQuet: false });
    // Đối chứng dương: cùng đầu vào, KHÔNG đang huỷ ⇒ cả hai nút + mời quẹt.
    expect(nutTrongHopPhieuThe(dau({ nutSaiMa: true }))).toEqual({ huyPhieuThe: "NUT", nhapSaiMa: true, phanBiet: true, tienDangBay: false, moiQuet: true });
  });
});

describe("[HNG-N04] câu nói khác biệt giữa hai nút nguy hiểm", () => {
  it("[HNG-N04a] gọi ĐÚNG tên nút huỷ (lấy từ hằng của hợp đồng, không gõ lại) và nói tiền đề: khách CHƯA quẹt", () => {
    expect(CAU_PHAN_BIET_HAI_NUT).toContain(`“${NHAN_NUT_HUY_PHIEU_THE}”`);
    expect(CAU_PHAN_BIET_HAI_NUT).toMatch(/CHƯA quẹt/);
  });

  it("[HNG-N04b] KHÔNG hướng dẫn huỷ giao dịch trên máy (đặc tả Việc 3, điều 6) và đủ ngắn cho màn 375px (≤ 120 ký tự)", () => {
    expect(CAU_PHAN_BIET_HAI_NUT).not.toMatch(/huỷ giao dịch|hủy giao dịch/i);
    expect(CAU_PHAN_BIET_HAI_NUT.length).toBeGreaterThan(20);
    expect(CAU_PHAN_BIET_HAI_NUT.length).toBeLessThanOrEqual(120);
  });
});

describe("[HNG-N05] `buocSaiMaConHieuLuc` — bước 'Chọn giao dịch' chỉ có nghĩa khi phiếu còn chờ quẹt", () => {
  it("[HNG-N05] CHO_QUET · THAT_BAI ⇒ còn; mọi trạng thái khác ⇒ nhường chỗ cho câu trạng thái (trang về với cùng intentId mà phiếu đã HUY / CAN_XU_LY / DA_THU)", () => {
    expect(buocSaiMaConHieuLuc("CHO_QUET")).toBe(true);
    expect(buocSaiMaConHieuLuc("THAT_BAI")).toBe(true);
    for (const h of ["HUY", "DA_THU", "HET_HAN", "PHIEU_DA_DONG", "CAN_XU_LY", "LECH_TIEN", "KE_TOAN_DA_GHI", "KE_TOAN_DA_GO"] as const) {
      expect(buocSaiMaConHieuLuc(h), h).toBe(false);
    }
  });
});

describe("[HN5-N1] `canhBaoDonDaBac` — đơn từng có giao dịch bị kế toán bác ⇒ phiếu thẻ MỚI cũng phải mang cảnh báo, trừ khi hộp đã có dòng từ chối riêng", () => {
  const HIEN_THI_CHO = ["CHO_QUET", "THAT_BAI", "HET_HAN"] as const;
  it("[HN5-N1a] đơn có vết bác ∧ phiếu CHƯA có dòng từ chối riêng ∧ phiếu còn chờ quẹt/vừa quá hạn ⇒ có cảnh báo; thiếu BẤT KỲ vế nào ⇒ không", () => {
    for (const h of HIEN_THI_CHO) expect(canhBaoDonDaBac({ hienThi: h, daBiTuChoi: false, donDaCoVetBac: true }), h).toBe(true);
    // Đối chứng dương từng vế: đơn sạch · hộp đã có dòng từ chối của CHÍNH phiếu (không in hai lần) · phiếu không còn chờ quẹt.
    for (const h of HIEN_THI_CHO) expect(canhBaoDonDaBac({ hienThi: h, daBiTuChoi: false, donDaCoVetBac: false }), `đơn sạch ${h}`).toBe(false);
    for (const h of HIEN_THI_CHO) expect(canhBaoDonDaBac({ hienThi: h, daBiTuChoi: true, donDaCoVetBac: true }), `đã có dòng từ chối riêng ${h}`).toBe(false);
    for (const h of ["DA_THU", "CAN_XU_LY", "LECH_TIEN", "KE_TOAN_DA_GHI", "KE_TOAN_DA_GO", "PHIEU_DA_DONG"] as const) {
      expect(canhBaoDonDaBac({ hienThi: h, daBiTuChoi: false, donDaCoVetBac: true }), `không còn chờ quẹt ${h}`).toBe(false);
    }
  });

  it("[HN6-A2-N1c] VIỆC 6 · a2 — phiếu vừa bị HUỶ của đơn có vết bác CŨNG mang cảnh báo cấp đơn (huỷ sau từ chối: giữa lúc huỷ và lúc mở phiếu mới không còn gì nhắc 'ĐỪNG quẹt lại'); đơn sạch ⇒ không", () => {
    // Trước VIỆC 6 cổng huỷ chặn huỷ-sau-từ-chối nên câu cấm quẹt lại luôn còn trên màn tới khi phiếu hết hạn; nay sale huỷ được, hộp chuyển sang câu 'đã huỷ — thu thẻ lại thì mở phiếu mới' và
    // `canhBaoDonDaBac` (chỉ CHO_QUET · THAT_BAI · HET_HAN) im lặng ⇒ hở đúng khoảng giữa huỷ và mở phiếu mới. HUY đứng cạnh HET_HAN: cả hai là 'phiếu đã đóng mà màn mời mở phiếu mới'.
    expect(canhBaoDonDaBac({ hienThi: "HUY", daBiTuChoi: false, donDaCoVetBac: true })).toBe(true);
    expect(canhBaoDonDaBac({ hienThi: "HUY", daBiTuChoi: false, donDaCoVetBac: false }), "đơn sạch").toBe(false);
    // Phiếu HUY không bao giờ mang dòng từ chối riêng (`daBiTuChoi` chỉ tính trên phiếu còn mở / vừa quá hạn) — nhưng nếu một ngày nó mang, vẫn không in hai lệnh cấm.
    expect(canhBaoDonDaBac({ hienThi: "HUY", daBiTuChoi: true, donDaCoVetBac: true })).toBe(false);
    // Đo qua view THẬT: phiếu HUY của đơn có vết bác.
    const v = dungPhieuPosView({ intent: raw({ status: "HUY", donDaCoVetBac: true, lastResultKind: "NOT_FOUND", lastResultMessage: CAU_CHUA_THAY }), phieuMo: PHIEU_MO, now: NOW });
    expect(v.hienThi).toBe("HUY");
    expect(canhBaoDonDaBac({ hienThi: v.hienThi, daBiTuChoi: false, donDaCoVetBac: v.donDaCoVetBac })).toBe(true);
  });

  it("[HN5-N1b] cảnh báo KHÔNG đổi nút nào: phiếu mới của đơn có vết bác vẫn mời quẹt và vẫn huỷ được (cổng huỷ Việc 4 không đổi — vết bác của ĐƠN do bộ nhớ theo đơn chặn, không do việc giấu nút)", () => {
    const v = dungPhieuPosView({ intent: raw({ donDaCoVetBac: true, lastResultMessage: CAU_CHUA_THAY }), phieuMo: null, now: NOW });
    expect(v.donDaCoVetBac, "view mang cờ").toBe(true);
    const nut = nutTrongHopPhieuThe({ hienThi: v.hienThi, huyPhieuThe: v.huyPhieuThe, saiMa: v.saiMa, nutSaiMa: true, daBiTuChoi: false, choLamMoi: false, dangHuy: false });
    expect(nut.moiQuet, "vẫn mời quẹt (đơn có vết bác cũ KHÔNG nghĩa là khách này đã quẹt)").toBe(true);
    const sach = dungPhieuPosView({ intent: raw({ donDaCoVetBac: false, lastResultMessage: CAU_CHUA_THAY }), phieuMo: null, now: NOW });
    expect(sach.donDaCoVetBac, "đối chứng: đơn sạch ⇒ cờ tắt").toBe(false);
    expect(sach.huyPhieuThe, "cờ KHÔNG đổi phán quyết huỷ").toEqual(v.huyPhieuThe);
  });
});
