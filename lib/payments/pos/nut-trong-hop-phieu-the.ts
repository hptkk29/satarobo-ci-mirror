// lib/payments/pos/nut-trong-hop-phieu-the.ts — hộp phiếu thẻ vẽ NÚT NÀO (Việc 3 × Việc 4, lượt ghép 10/10/2026). THUẦN, client-safe.
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §7.8. Sau khi ghép, hộp phiếu thẻ có BA lối cùng sống, mỗi lối có một tiền đề NGƯỢC nhau:
//
//   "Kiểm tra thanh toán"      — việc hằng ngày, luôn có (trừ phiếu HUY). Nút chính.
//   "Tôi nhập sai mã trên máy" — khách ĐÃ quẹt THÀNH CÔNG, sale gõ sai mã (Việc 3). Chỉ khi hệ thống nói "Chưa thấy giao dịch".
//   "Huỷ phiếu thẻ"            — khách CHƯA quẹt / đổi cách trả (Việc 4). Việc phá huỷ hiếm: ở chân hộp, bên trái, cách xa nút chính.
//
// Hai nút sau cùng hiện đúng ở trạng thái hay gặp nhất — CHO_QUET + "Chưa thấy" — và chọn nhầm nút huỷ lúc khách ĐÃ quẹt là chính điều cổng Việc 4 canh
// (sale phát mã mới / QR cho một khoản đã trả ⇒ đòi khách trả lần hai). Nên khi cả hai cùng hiện, hộp in thêm MỘT câu nói khác biệt (`phanBiet`).
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CẦN MỘT HÀM (luật 12 + luật 11): Việc 3 và Việc 4 được viết khi việc kia chưa tồn tại, nên điều kiện của chúng ghép SẠCH về văn bản mà HỎNG về
// nghĩa — không dấu xung đột nào báo (docs §7.1, `hop-phieu-pos.tsx` "sạch chữ, SAI nghĩa"):
//   · cửa sổ "sale vừa GỬI yêu cầu, trang chưa về": props còn CHO_QUET + `huyDuoc: true` (tính ở lượt tải trước) trong khi phiếu thật đã sang CAN_XU_LY ⇒
//     nút huỷ KHÔNG chỉ cần khoá mà phải BIẾN MẤT (nút khoá cạnh câu "Đã gửi kế toán" là affordance nói dối kiểu khác — và trang sau đó cũng không có nó);
//   · sau khi kế toán TỪ CHỐI: dòng "Chưa huỷ được phiếu thẻ: … ĐỪNG cho khách quẹt lại …" đứng cạnh dòng cảnh báo đỏ cũng nói "ĐỪNG cho khách quẹt lại" ⇒
//     HAI lệnh cấm liền nhau (đúng lỗi `[HN3-R11b]` đã vá một lần). VIỆC 6 · a2 (chủ dự án chốt 10/10/2026: sau từ chối sale HUỶ ĐƯỢC phiếu thẻ): NÚT huỷ quay lại khi cổng thường cho huỷ,
//     còn dòng lý do thứ hai vẫn KHÔNG in (khi không huỷ được, dòng đỏ của yêu cầu là lệnh cấm duy nhất) và hộp vẫn KHÔNG mời quẹt lại;
//   · yêu cầu sai mã đang GIỮ trên một phiếu còn CHO_QUET (dữ liệu vi phạm bất biến — hôm nay chỉ xảy ra khi dữ liệu hỏng): DB có
//     `PosSaiMaYeuCau_phieu_giu_key` nên nút "Tôi nhập sai mã" chắc chắn bị từ chối.
// Tất cả đi qua đây. Component CHỈ vẽ theo kết quả — không tự so trạng thái (`[HNG-W*]` ghim điều đó).
//
// ĐẦU VÀO BẮT BUỘC, KHÔNG MẶC ĐỊNH (luật 7): `tsc` liệt kê mọi chỗ gọi. Quên truyền `choLamMoi` là nút huỷ sáng trong đúng cửa sổ nguy hiểm nhất.
// Hàm KHÔNG thay `choPhepHuyPhieuThe` (máy chủ hỏi lại hàm đó dưới khoá) — nó chỉ quyết ĐIỀU GÌ VẼ ra từ phán quyết ấy cộng ngữ cảnh của hộp.
import type { HienThiPhieuPos, PhieuPosView } from "./phieu-pos-luat";
import { NHAN_NUT_HUY_PHIEU_THE, type MaTuChoiHuyPhieuThe } from "./huy-phieu-the-cau";

export type DauVaoNutTrongHop = {
  /** `PhieuPosView.hienThi`. */
  hienThi: HienThiPhieuPos;
  /** `PhieuPosView.huyPhieuThe` — phán quyết của `choPhepHuyPhieuThe`. Hàm này KHÔNG tính lại nó. */
  huyPhieuThe: PhieuPosView["huyPhieuThe"];
  /** `PhieuPosView.saiMa` — yêu cầu "nhập sai mã" MỚI NHẤT của phiếu (hoặc `null`). */
  saiMa: PhieuPosView["saiMa"];
  /** Kết quả `nutNhapSaiMa` (Việc 3) trên câu ĐANG HIỆN: phiếu CHO_QUET ∧ câu là "Chưa thấy giao dịch…". */
  nutSaiMa: boolean;
  /**
   * Kế toán đã TỪ CHỐI yêu cầu mới nhất trên một phiếu còn mở/vừa quá hạn (hộp đã in dòng cảnh báo riêng — Việc 3, V70). VIỆC 6 · a2: cờ này KHÔNG còn giấu nút huỷ (sau từ chối sale huỷ ĐƯỢC phiếu thẻ);
   * nó chỉ còn ba việc — hộp KHÔNG mời quẹt lại, KHÔNG in dòng "Chưa huỷ được…" thứ hai dưới dòng đỏ của yêu cầu (một lệnh cấm, không hai — `[HN3-R11b]`), và nhường chỗ cho cảnh báo cấp đơn.
   */
  daBiTuChoi: boolean;
  /** Sale vừa GỬI một giao dịch thành công và trang mới CHƯA về (`guiDangCho !== null` ở hộp) — Việc 3, `[HN3-R14]`. */
  choLamMoi: boolean;
  /**
   * Lượt HUỶ phiếu thẻ đang chạy (transition bao cả `router.refresh()`, `dangHuy` ở hộp ngoài) — Việc 4. Cửa cổ chai thứ hai sau `choLamMoi`: máy chủ đã ghi HUY, hộp xác nhận
   * đã đóng, props còn là phiếu CHO_QUET cũ ⇒ không được mời quẹt và không được mời "Tôi nhập sai mã" (máy chủ chắc chắn từ chối: phiếu không còn chờ quẹt).
   * Rà đối kháng bản ghép 10/10/2026. BẮT BUỘC, không mặc định (luật 7).
   */
  dangHuy: boolean;
};

export type NutTrongHop = {
  /** Vẽ nút "Tôi nhập sai mã trên máy". */
  nhapSaiMa: boolean;
  /**
   * Nút "Huỷ phiếu thẻ":
   *   · `NUT`        — vẽ nút (máy chủ sẽ cho huỷ). VIỆC 6 · a2: kể cả SAU KHI kế toán từ chối;
   *   · `DONG_LY_DO` — phiếu còn chờ quẹt, CHƯA bị từ chối mà KHÔNG huỷ được ⇒ MỘT dòng nói vì sao (cặp câu của hợp đồng);
   *   · `KHONG`      — không nút, không dòng: phiếu đã đóng (hộp tự kể trạng thái), hoặc hộp đã có câu nói đúng hơn (vừa gửi · đã bị từ chối mà không huỷ được — dòng đỏ của yêu cầu là lệnh cấm duy nhất).
   */
  huyPhieuThe: "NUT" | "DONG_LY_DO" | "KHONG";
  /** Cả hai nút nguy hiểm cùng hiện ⇒ in `CAU_PHAN_BIET_HAI_NUT` dưới nút "Tôi nhập sai mã". */
  phanBiet: boolean;
  /**
   * Phiếu còn chờ quẹt mà cổng huỷ nhận ra DẤU HIỆU TIỀN ĐANG BAY (giao dịch chờ tay · dòng thẻ chưa ngã ngũ · lượt kiểm thấy đã quẹt mà chưa ghi · …). Khi `true`: dòng
   * lý do (`huyPhieuThe === "DONG_LY_DO"`) phải vẽ ở TÔNG CẢNH BÁO, NGAY dưới câu trạng thái, TRƯỚC mọi nút — không phải dòng 12px xám cuối hộp — và hộp
   * KHÔNG mời quẹt (`moiQuet === false`). Câu lưu của lượt kiểm trước ("Chưa thấy…") có thể cãi nhau với dấu hiệu mới hơn; câu đúng không được nằm ở chỗ yếu nhất.
   */
  tienDangBay: boolean;
  /**
   * Hộp được MỜI khách quẹt (hiện bốn bước hướng dẫn + "Cùng mã với QR chuyển khoản"): phiếu còn chờ quẹt VÀ không có dấu hiệu tiền đang bay VÀ không ở cửa sổ vừa gửi / đang huỷ /
   * sau từ chối. Component chỉ thêm vế dữ liệu của chính nó (`soTienPhaiThu !== null`).
   */
  moiQuet: boolean;
};

/**
 * Mã từ chối của cổng huỷ có nghĩa "tiền CÓ THỂ ĐANG BAY" trên phiếu còn chờ quẹt (khách có thể đã bị trừ tiền). `KET_QUA_PAID_SAU_THAT_BAI` và `HUY_SAU_THU`
 * CỐ Ý không vào: câu của chúng trung tính (khách có thể đã huỷ trên máy / đã hoàn). `LOI_KET_NOI`: chưa biết gì — không phải dấu hiệu.
 */
export const MA_TIEN_DANG_BAY: readonly MaTuChoiHuyPhieuThe[] = [
  "DA_NHAN_GIAO_DICH",
  "CO_GIAO_DICH_CHO_TAY",
  "CO_YEU_CAU_SAI_MA",
  "DONG_THE_CHUA_NGA_NGU",
  "KET_QUA_PAID_CHUA_GHI",
  "CHUA_NGA_NGU",
];

/**
 * Trong số đó, hai mã nghĩa là có DÒNG THẺ MANG ĐÚNG MÃ của phiếu trong DB. Bước TÌM của "Tôi nhập sai mã" (`docUngVienSaiMa`, cổng G-A) từ chối đúng tình huống đó
 * ("Có giao dịch mang mã X — bấm Kiểm tra thanh toán") nên nút chắc chắn ăn từ chối ⇒ không vẽ (luật 12: nút chắc chắn bị từ chối là lời hứa suông).
 */
const MA_DONG_MANG_MA: readonly MaTuChoiHuyPhieuThe[] = ["CO_GIAO_DICH_CHO_TAY", "DONG_THE_CHUA_NGA_NGU"];

/**
 * Câu nói khác biệt khi CẢ HAI nút cùng hiện. Đứng ngay dưới câu "Dùng khi biên lai máy đã báo THÀNH CÔNG nhưng mã … gõ sai." của nút nhập sai mã:
 * hai câu thành hai vế "khách ĐÃ quẹt ⇒ nhập sai mã" / "khách CHƯA quẹt ⇒ huỷ phiếu thẻ". Tên nút lấy từ HẰNG của hợp đồng — đổi nhãn nút là câu này đổi theo,
 * không có ngày nó chỉ tới một cái tên không còn.
 *
 * KHÔNG hướng dẫn huỷ giao dịch trên máy rồi quẹt lại (đặc tả Việc 3, điều 6): "huỷ" ở đây là huỷ PHIẾU THẺ của hệ thống, và chỉ khi khách chưa quẹt.
 */
export const CAU_PHAN_BIET_HAI_NUT = `Khách CHƯA quẹt, hoặc đổi cách trả? Dùng “${NHAN_NUT_HUY_PHIEU_THE}” bên dưới.`;

const laChoQuet = (h: HienThiPhieuPos) => h === "CHO_QUET" || h === "THAT_BAI";

/**
 * Bước "Chọn giao dịch của khách" (Việc 3) còn nghĩa không: chỉ khi phiếu còn chờ quẹt. Trang mới về với CÙNG `intentId` nhưng phiếu đã HUY / CAN_XU_LY / DA_THU thì bước đó
 * phải nhường chỗ cho câu trạng thái — `buocCua` (state, không reset khi `router.refresh()`) không biết điều đó. MỘT hàm để hộp ngoài không tự so trạng thái.
 */
export function buocSaiMaConHieuLuc(h: HienThiPhieuPos): boolean {
  return laChoQuet(h);
}

/**
 * Hộp in `CAU_DON_DA_CO_VET_BAC` không: đơn từng có giao dịch bị bác ∧ phiếu còn chờ quẹt / vừa quá hạn / VỪA BỊ HUỶ ∧ hộp CHƯA có dòng từ chối riêng của chính phiếu (`daBiTuChoi` — dòng ấy đã
 * nói điều nặng hơn và cùng lệnh cấm; in cả hai là hai lệnh cấm liền nhau, đúng lỗi `[HN3-R11b]`). MỘT hàm để component không tự so trạng thái.
 *
 * VIỆC 6 · a2 — thêm `HUY`: trước Việc 6 cổng huỷ chặn huỷ-sau-từ-chối nên lệnh cấm quẹt lại LUÔN còn trên màn tới khi phiếu hết hạn. Nay sale huỷ được, hộp chuyển sang câu "Phiếu thu thẻ đã huỷ… Thu thẻ lại thì mở
 * phiếu thẻ mới" (`CAU_PHIEU_THE_DA_HUY`) và dòng đỏ của yêu cầu cũng đi theo phiếu cũ — khoảng GIỮA lúc huỷ và lúc mở phiếu mới sẽ không còn gì nhắc "ĐỪNG cho khách quẹt lại" dù khách có thể đã bị trừ tiền. `HUY` đứng
 * cạnh `HET_HAN`: cả hai là "phiếu đã đóng mà màn mời mở phiếu mới". Phiếu `HUY` không bao giờ mang `daBiTuChoi` (cờ ấy chỉ tính trên phiếu còn mở / vừa quá hạn).
 */
export function canhBaoDonDaBac(v: { hienThi: HienThiPhieuPos; daBiTuChoi: boolean; donDaCoVetBac: boolean }): boolean {
  return v.donDaCoVetBac && !v.daBiTuChoi && (v.hienThi === "CHO_QUET" || v.hienThi === "THAT_BAI" || v.hienThi === "HET_HAN" || v.hienThi === "HUY");
}

export function nutTrongHopPhieuThe(v: DauVaoNutTrongHop): NutTrongHop {
  // "Đang GIỮ" = `≠ TU_CHOI` — CÙNG vị từ với hai chỉ mục duy nhất từng phần của Việc 3 và với `coYeuCauSaiMaDangGiu` của `dungPhieuPosView`. Ba bản của một vị từ là
  // ba nơi có ngày cãi nhau, nên `[HNG-N02]` ghim CẢ HAI phía: I5 (hàm này không mời gửi khi đang giữ) và I8 (view không cho huỷ khi có yêu cầu, giữ hay bị từ chối).
  const dangGiuYeuCau = v.saiMa !== null && v.saiMa.trangThai !== "TU_CHOI";

  // Nút "Tôi nhập sai mã": V3 cho (`nutSaiMa`) VÀ chưa có yêu cầu đang giữ VÀ không phải cửa sổ vừa gửi. Sau TỪ CHỐI nút VẪN hiện (V76: đề nghị
  // ứng viên khác — máy chủ ép chờ kế toán).
  // Rà ghép 10/10/2026: (1) `dangHuy` — lượt huỷ đang chạy, máy chủ chắc chắn từ chối; (2) có dòng thẻ MANG ĐÚNG MÃ ⇒ cổng G-A của bước tìm chắc chắn từ chối.
  const maHuy = v.huyPhieuThe.huyDuoc ? null : v.huyPhieuThe.ma;
  const coDongMangMa = laChoQuet(v.hienThi) && maHuy !== null && MA_DONG_MANG_MA.includes(maHuy);
  const nhapSaiMa = v.nutSaiMa && !dangGiuYeuCau && !v.choLamMoi && !v.dangHuy && !coDongMangMa;

  // Nút / dòng huỷ chỉ có nghĩa trên phiếu CÒN CHỜ QUẸT, và không có nghĩa khi hộp đã nói điều đúng hơn bằng câu riêng (vừa gửi yêu cầu, trang chưa về).
  // VIỆC 6 · a2: TÁCH HAI TẬP. `coTheNoiVeHuy` (còn chờ quẹt ∧ không vừa gửi) quyết NÚT hay không — sau từ chối nút QUAY LẠI khi cổng thường cho huỷ. `sach` (= thêm "chưa bị từ chối") quyết những gì còn lại:
  // dòng lý do, tông "tiền đang bay" và việc MỜI quẹt. Sau từ chối hộp đã có dòng đỏ của yêu cầu — in thêm "Chưa huỷ được phiếu thẻ: … ĐỪNG cho khách quẹt lại" là lệnh cấm thứ hai (`[HN3-R11b]`), và mời
  // quẹt lại là mời đúng thứ dòng đỏ đang cấm. Gộp hai tập làm một thì hoặc nút biến mất (như bản Việc 4) hoặc hộp vừa cấm vừa mời.
  const coTheNoiVeHuy = laChoQuet(v.hienThi) && !v.choLamMoi;
  const sach = coTheNoiVeHuy && !v.daBiTuChoi;
  // VIỆC 6 (chốt, rà đối kháng): sau từ chối, "không huỷ được" chỉ im lặng (KHONG) khi lý do là DẤU HIỆU TIỀN ĐANG BAY — dòng đỏ của yêu cầu đã là lệnh cấm duy nhất, in thêm là lệnh cấm thứ hai. Lý do
  // TRUNG TÍNH (lỗi kết nối · PAID sau thất bại · huỷ sau thu) thì dòng xám vẫn in: bản trước gộp mọi lý do thành KHONG nên sale bấm Kiểm tra gặp lỗi kết nối là nút Huỷ vừa hiện biến mất không một chữ (luật 12).
  const laMaTienDangBay = maHuy !== null && MA_TIEN_DANG_BAY.includes(maHuy);
  const huyPhieuThe: NutTrongHop["huyPhieuThe"] = !coTheNoiVeHuy ? "KHONG" : v.huyPhieuThe.huyDuoc ? "NUT" : sach || !laMaTienDangBay ? "DONG_LY_DO" : "KHONG";

  const tienDangBay = sach && maHuy !== null && MA_TIEN_DANG_BAY.includes(maHuy);
  const moiQuet = sach && !tienDangBay && !v.dangHuy;

  return { nhapSaiMa, huyPhieuThe, phanBiet: nhapSaiMa && huyPhieuThe === "NUT", tienDangBay, moiQuet };
}
