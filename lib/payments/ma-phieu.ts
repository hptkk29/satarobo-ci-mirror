// lib/payments/ma-phieu.ts — MÃ PHIẾU THU 5 KÝ TỰ, CÓ CHECKSUM. Thuần.
//
// ─────────────────────────────────────────────────────────────────────────────
// US-10 · Spec chốt 16/09/2026. Mã này là KHOÁ CHÍNH của việc đối khớp tiền về.
//
//   <TÊN> <SĐT> <MÃ>        vd  PHUONG 0905123456 K7M2N
//   tên ≤8 + 1 + 10 + 1 + 5 = 25 ký tự (trần EMVCo của nội dung VietQR)
//
// ─────────────────────────────────────────────────────────────────────────────
// BẢNG CHỮ — 27 KÝ TỰ, VÀ MỖI KÝ TỰ BỊ LOẠI ĐỀU CÓ LÝ DO
//
// A–Z + 2–9, LOẠI `O·0·I·1·L·B·8·S·5`. Chín ký tự đó là bốn cặp nhìn giống nhau trên màn
// hình điện thoại và trên giấy in nhiệt của quầy: O/0 · I/1/L · B/8 · S/5.
//
// Vì sao loại hẳn thay vì "chuẩn hoá khi đọc" (map 0→O, 1→I…): mã này đi qua **tai người**.
// Sale đọc cho phụ huynh qua điện thoại, phụ huynh gõ vào app ngân hàng. "Không, chữ O không
// phải số không" là câu phải nói mỗi cuộc gọi. Bảng chữ không có ký tự nhập nhằng thì câu đó
// không bao giờ phải nói.
//
// KÝ TỰ ĐẦU BẮT BUỘC LÀ CHỮ CÁI — đây là MỎ NEO, không phải thẩm mỹ. Ngân hàng chèn số vào
// nội dung chuyển khoản (`MBVCB.123...`), và sau khi parser xoá hết ký tự phân cách thì mã
// dính liền vào dãy số đó. Nếu mã được bắt đầu bằng số thì mọi cửa sổ trượt cắt trúng dãy số
// của ngân hàng đều là ứng viên; bắt đầu bằng chữ thì chỉ cắt trúng đúng chỗ mã bắt đầu.
//
// DUNG LƯỢNG: 21 chữ cái × 27³ = 413.343 mã. Không tái sử dụng.
//
// ─────────────────────────────────────────────────────────────────────────────
// CHECKSUM — VÀ VÌ SAO NÓ LÀ ĐIỀU KIỆN NHẬN DẠNG, KHÔNG CHỈ LÀ CHỐNG GÕ SAI
//
// Parser quét bằng CỬA SỔ TRƯỢT trên một chuỗi đã bị xoá hết dấu phân cách, nên nó không biết
// mã bắt đầu ở đâu. Thứ duy nhất phân biệt "đây là mã" với "đây là 5 ký tự bất kỳ trong tên
// khách" là checksum. Không có checksum thì mỗi memo có hàng chục ứng viên và parser phải
// ĐOÁN — mà đoán sai ở đây nghĩa là rót tiền của nhà này vào phiếu của nhà khác.
//
// Phép chọn: tựa Damm trên nhóm `Z₂₇` với phép `x * y = (5x + y) mod 27`.
//   · quasigroup    — gcd(5,27)=1 và gcd(1,27)=1;
//   · phản đối xứng — `x*y = y*x ⟺ 4x = 4y ⟺ x = y` (gcd(4,27)=1);
//   · phản đối xứng TOÀN PHẦN — `(c*x)*y = (c*y)*x ⟺ (a−1)(x−y) ≡ 0`, với a=5 thì
//     gcd(4,27)=1 nên chỉ xảy ra khi x=y.
// Theo định lý Damm, hai điều đó đủ để bắt **mọi lỗi sai 1 ký tự** và **mọi lỗi đảo 2 ký tự
// LIỀN KỀ**, kể cả cặp (ký tự cuối, ký tự checksum).
//
// ⚠️ Cặp cuối là chỗ dễ hụt nhất, và là lý do KHÔNG dùng "tổng đan dấu" cho tiện: với tổng đan
// dấu `c = d4 − d3 + d2 − d1`, đảo `d4` với `c` KHÔNG luôn bị bắt. Đã tính ra và loại. Có ca
// test VÉT CẠN cho cả hai họ lỗi trên 20.000 mã, chứ không tin suông vào định lý.

/** Chín ký tự bị loại — bốn cặp nhìn giống nhau trên màn hình và trên giấy in nhiệt. */
export const KY_TU_LOAI = "O0I1LB8S5";

/**
 * 27 ký tự: 21 chữ cái + 6 chữ số.
 *
 * ⚠️ THỨ TỰ CỐ ĐỊNH. Đổi thứ tự là đổi giá trị checksum của **mọi mã đã phát hành**, tức mọi
 * QR đang nằm trong điện thoại phụ huynh thành không đọc được. Viết tường minh (không `.slice`,
 * không sinh động) để đọc là thấy, và có ca `[MP-01]` đếm lại thành phần.
 */
export const BANG_CHU = "ACDEFGHJKMNPQRTUVWXYZ234679";

/** Chữ cái của bảng — tập hợp ký tự được phép ĐỨNG ĐẦU mã (21 ký tự). */
export const CHU_CAI_DAU = "ACDEFGHJKMNPQRTUVWXYZ";

/** Độ dài mã đời MỚI: 4 ký tự sinh + 1 checksum. */
export const DAI_MA = 5;

/** Hệ số của phép quasigroup. Xem chú thích đầu file trước khi đổi. */
const HE_SO = 5;
const CO_SO = 27;

const CHI_SO = new Map<string, number>([...BANG_CHU].map((c, i) => [c, i]));

/** Tổng số mã sinh được: 21 × 27³. Dùng cho cảnh báo cạn kho. */
export const DUNG_LUONG = CHU_CAI_DAU.length * CO_SO ** (DAI_MA - 2);

/** Ngưỡng cảnh báo cấp phát (spec: cảnh báo khi vượt 50%). */
export const NGUONG_CANH_BAO = 0.5;

/** Chuỗi có phải toàn ký tự của bảng không (đã chuẩn hoá HOA). */
function thuocBang(s: string): boolean {
  for (const c of s) if (!CHI_SO.has(c)) return false;
  return true;
}

/**
 * Giá trị checksum cho phần thân (4 ký tự đầu).
 *
 * Horner theo `HE_SO`: `I ← 5·I + d`. Ký tự kiểm là nghiệm của `5·I + c ≡ 0 (mod 27)`.
 */
function kyTuKiem(than: string): string {
  let i = 0;
  for (const c of than) i = (HE_SO * i + (CHI_SO.get(c) ?? 0)) % CO_SO;
  // c ≡ −5·I (mod 27)
  const c = ((-HE_SO * i) % CO_SO + CO_SO) % CO_SO;
  return BANG_CHU[c]!;
}

/**
 * Mã có hợp lệ không: đúng độ dài, toàn ký tự của bảng, ký tự đầu là CHỮ, checksum khớp.
 *
 * ⚠️ Cả bốn điều kiện đều là điều kiện NHẬN DẠNG của parser. Nới bất kỳ cái nào là mở cửa cho
 * một khối ký tự trong tên khách được nhận nhầm là mã.
 */
export function maHopLe(ma: string): boolean {
  if (typeof ma !== "string" || ma.length !== DAI_MA) return false;
  if (!thuocBang(ma)) return false;
  if (!CHU_CAI_DAU.includes(ma[0]!)) return false;
  let i = 0;
  for (const c of ma) i = (HE_SO * i + CHI_SO.get(c)!) % CO_SO;
  return i === 0;
}

/**
 * Sinh mã từ một SỐ THỨ TỰ (0 .. DUNG_LUONG−1).
 *
 * Nhận số thứ tự chứ không tự random, vì hai lý do:
 *   1. **Không tái sử dụng** là yêu cầu của spec, và cách rẻ nhất để bảo đảm điều đó là một
 *      bộ đếm đơn điệu, không phải một vòng "random rồi kiểm trùng" (vòng đó chậm dần theo độ
 *      đầy của kho và không bao giờ kết thúc chắc chắn).
 *   2. Hàm thuần thì test được, và `Math.random` trong đường sinh mã là thứ làm mọi ca test
 *      thành "chạy lại ra khác".
 *
 * ⚠️ Số thứ tự KHÔNG phải bí mật: mã liền kề nhau thì đoán được mã kế tiếp. Điều đó chấp nhận
 * được vì mã chỉ nói "phiếu nào", không cấp quyền gì — đoán trúng mã người khác cũng chỉ
 * chuyển tiền HỘ họ. Nếu sau này mã mang quyền thì phải đổi sang hoán vị/ngẫu nhiên.
 */
export function sinhMa(soThuTu: number): string {
  const n = Number.isFinite(soThuTu) ? Math.trunc(soThuTu) : -1;
  if (n < 0 || n >= DUNG_LUONG) {
    throw new RangeError(`Số thứ tự mã ngoài kho: ${soThuTu} (kho ${DUNG_LUONG})`);
  }
  // Ký tự đầu lấy từ tập CHỮ CÁI; ba ký tự sau lấy từ cả bảng.
  const dau = CHU_CAI_DAU[Math.floor(n / CO_SO ** 3)]!;
  let con = n % CO_SO ** 3;
  const giua: string[] = [];
  for (let k = 2; k >= 0; k--) {
    const b = CO_SO ** k;
    giua.push(BANG_CHU[Math.floor(con / b)]!);
    con %= b;
  }
  const than = dau + giua.join("");
  return than + kyTuKiem(than);
}

/** Cảnh báo cạn kho mã — spec: cài đếm + cảnh báo khi cấp phát vượt 50%. */
export type TinhTrangKho = {
  daCap: number;
  dungLuong: number;
  tiLe: number;
  canhBao: boolean;
  moTa: string;
};

/**
 * ⚠️ Trả `canhBao` chứ KHÔNG ném. Cạn kho là việc của người vận hành, không phải lý do để một
 * phụ huynh không quét được QR. Người gọi ghi log/thông báo; đường sinh phiếu vẫn chạy cho tới
 * khi `sinhMa` thật sự hết số (và lúc đó nó ném, đúng chỗ).
 */
export function tinhTrangKhoMa(daCap: number): TinhTrangKho {
  const n = Number.isFinite(daCap) ? Math.max(0, Math.trunc(daCap)) : 0;
  const tiLe = n / DUNG_LUONG;
  return {
    daCap: n,
    dungLuong: DUNG_LUONG,
    tiLe,
    canhBao: tiLe >= NGUONG_CANH_BAO,
    moTa:
      `Đã cấp ${n.toLocaleString("vi-VN")}/${DUNG_LUONG.toLocaleString("vi-VN")} mã phiếu ` +
      `(${(tiLe * 100).toFixed(1)}%)`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MÃ ĐỜI CŨ
//
// ⚠️ ĐO ĐƯỢC 16/09/2026 — spec nói "đời 8 ký tự cũ", nhưng **không có mã 8 ký tự nào đã phát
// hành**. `SELECT length("matchKey"), count(*) FROM "PaymentRequest"` trên `satarobo_local` ra
// đúng ba độ dài: **11** (`ORDCS1101D0`), **12** (`ORDCS11210D0`), **17**
// (`ORD260915000011D3`) — tức khuôn `paymentMatchKey()` đang dùng, không phải mã 8 ký tự của
// bản thiết kế (`PaymentBill.code`, bảng đó 0 dòng vì vừa tạo hôm nay).
//
// Nên "đời cũ" ở đây nhận đúng khuôn ĐANG TỒN TẠI. Điều đó giữ nguyên tinh thần của ràng buộc
// ("mã đã phát hành cấm đổi, parser nhận cả hai đời") và tránh một cái bẫy: nếu nhận mọi khối
// `[A-Z0-9]{8}` thì `PHUONG09` trong chính memo mới cũng thành "mã đời cũ", và parser sẽ đi
// tra một mã không tồn tại ở mọi giao dịch có tên khách dài 6 ký tự.
// ─────────────────────────────────────────────────────────────────────────────

/** Khuôn mã đời cũ: `ORD` + phần mã đơn + `D` + số đợt. Neo hai đầu, không cho lem. */
const MA_DOI_CU = /^ORD[A-Z0-9]{4,14}D\d{1,2}$/;

export function maDoiCuHopLe(ma: string): boolean {
  return typeof ma === "string" && MA_DOI_CU.test(ma);
}
