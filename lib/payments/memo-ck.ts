// lib/payments/memo-ck.ts — SINH và ĐỌC nội dung chuyển khoản. Thuần.
//
// ─────────────────────────────────────────────────────────────────────────────
// US-10 · Spec chốt 16/09/2026
//
//   Khuôn sinh ra (QR tự điền):   <TÊN> <SĐT> <MÃ>
//   Ví dụ:                        PHUONG 0905123456 K7M2N
//   Ngân sách:                    tên ≤8 + 1 + 10 + 1 + 5 = 25 ký tự
//
// Ba trường, ba vai KHÁC HẲN nhau — và lẫn vai là nguồn của mọi lỗi đối khớp từ trước tới nay:
//
//   · TÊN — trường HIỂN THỊ. **Không bao giờ tham gia khớp.** Nó ở đó để phụ huynh nhìn vào
//     app ngân hàng và biết mình đang chuyển cho con nào, và để kế toán đọc sao kê không phải
//     tra mã. Parser MẶC KỆ nó hoàn toàn.
//   · MÃ  — khoá CHÍNH. 5 ký tự, có checksum (`ma-phieu.ts`).
//   · SĐT — khoá PHỤ và ĐỐI CHỨNG. Không bao giờ phủ quyết mã.
//
// ⚠️ Vì sao tên KHÔNG cho sale gõ tự do: trước đây nội dung CK do người gõ, và kết quả là mỗi
// người một kiểu ("be Phuong", "PH Phuong", "chuyen hoc phi be Phuong"), rồi đối khớp phải đi
// đoán chuỗi. Tên nay lấy TỪ CUỐI của họ tên trong hồ sơ học viên, máy sinh, không ai sửa —
// nên nó ổn định, và quan trọng hơn: nó KHÔNG được dùng để khớp nên sai cũng không hại tiền.
//
// ─────────────────────────────────────────────────────────────────────────────
// PARSER HAI TẦNG — VÀ VÌ SAO TẦNG 1 XOÁ SẠCH DẤU PHÂN CÁCH
//
// Tầng 1 (normalize): HOA → bỏ dấu → **xoá mọi ký tự không phải [A-Z0-9]**.
// Tầng 2 (quét): cửa sổ trượt trên chuỗi đã sạch, KHÔNG đòi vị trí.
//
// Ngân hàng viết lại nội dung chuyển khoản theo cách của họ: chèn tiền tố (`MBVCB.3021...`),
// hậu tố (`.CT TU NGUYEN VAN A`), đổi dấu cách thành `-` hoặc `_`, bỏ dấu, viết hoa/thường
// tuỳ nhà. Mọi thứ đó là NHIỄU. Xoá sạch dấu phân cách rồi quét bằng cửa sổ trượt là cách duy
// nhất cho ra CÙNG MỘT kết quả với mọi biến thể — và "cùng một kết quả" mới là thứ đối soát
// được.
//
// Cái giá: sau khi xoá, tên dính liền số điện thoại dính liền mã
// (`PHUONG0905123456K7M2N`). Nên mã phải TỰ NHẬN DẠNG ĐƯỢC — đó chính là việc của checksum và
// của luật "ký tự đầu là chữ cái". Không có hai thứ đó thì tầng 2 không làm được gì.

import {
  DAI_MA,
  CHU_CAI_DAU,
  BANG_CHU,
  maDoiCuHopLe,
  maHopLe,
} from "./ma-phieu";

/** Trần EMVCo cho nội dung VietQR. */
export const TRAN_MEMO = 25;
/** Trần độ dài phần TÊN trong memo. */
export const TRAN_TEN = 8;

/**
 * Rút TÊN hiển thị từ họ tên trong hồ sơ: **từ cuối**, IN HOA, bỏ dấu, cắt ≤8.
 *
 * Từ cuối chứ không phải từ đầu: tiếng Việt gọi nhau bằng tên, không bằng họ. "Nguyễn Phương
 * Quỳnh Anh" thì người nhà gọi là "Anh". Lấy từ đầu sẽ ra "NGUYEN" cho một nửa số học viên —
 * tức trường hiển thị không phân biệt được ai với ai, mất sạch công dụng.
 *
 * Rỗng/rác trả `""` — memo khi đó chỉ còn SĐT và MÃ, vẫn khớp được (tên không tham gia khớp).
 */
export function tenHienThi(hoTen: string): string {
  const sach = (hoTen ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .trim();
  if (sach === "") return "";
  const tu = sach.split(/\s+/);
  return (tu[tu.length - 1] ?? "").slice(0, TRAN_TEN);
}

/**
 * Chuẩn hoá SĐT về 10 số bắt đầu bằng 0. `+84`/`84` → `0`.
 *
 * Trả `""` khi không ra được 10 số — và **không đoán**. 9 số (mất số 0 đầu vì ai đó lưu SĐT
 * vào ô kiểu số) hay 11 số đều trả rỗng. Đoán ở đây nghĩa là tự thêm một chữ số vào số điện
 * thoại của khách rồi đi tìm phiếu theo nó.
 */
export function sdtChuan(sdt: string): string {
  const so = (sdt ?? "").replace(/[^\d+]/g, "");
  let s = so.startsWith("+84") ? `0${so.slice(3)}` : so.startsWith("84") ? `0${so.slice(2)}` : so;
  s = s.replace(/\D/g, "");
  return /^0\d{9}$/.test(s) ? s : "";
}

/** Dựng nội dung chuyển khoản theo khuôn. Bỏ trống phần nào thiếu, không chèn chỗ trống thừa. */
export function dungMemo(input: { hoTen?: string; sdt?: string; ma: string }): string {
  const ten = tenHienThi(input.hoTen ?? "");
  const sdt = sdtChuan(input.sdt ?? "");
  const memo = [ten, sdt, input.ma].filter((x) => x !== "").join(" ");
  // ⚠️ Cắt ở đây là LƯỚI CHẶN CUỐI, không phải phép chia ngân sách. Ngân sách đã khít 25 ký tự
  // (8+1+10+1+5) nên nhánh này chỉ chạy khi có ai đó nới một trần ở trên. Cắt thì mất MÃ (nằm
  // cuối) — nên nếu ca `[MCK-09]` đỏ thì đừng nới `TRAN_MEMO`, hãy tìm trần nào vừa bị nới.
  return memo.slice(0, TRAN_MEMO);
}

// ─────────────────────────────────────────────────────────────────────────────
// ĐỌC
// ─────────────────────────────────────────────────────────────────────────────

/** Tầng 1: HOA → bỏ dấu → xoá mọi thứ không phải [A-Z0-9]. */
export function chuanHoaMemo(memo: string): string {
  return (memo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export type MemoDaDoc = {
  /** Chuỗi sau tầng 1 — lưu lại để kế toán đối chiếu khi phải xử tay. */
  sach: string;
  /** Mã ĐỜI MỚI đầu tiên qua được checksum; `null` nếu không có. */
  ma: string | null;
  /**
   * MỌI mã đời mới qua checksum, theo thứ tự xuất hiện.
   *
   * Có danh sách chứ không chỉ một, vì checksum lọc được 26/27 khối rác nhưng không lọc hết:
   * một khối 5 ký tự trong tên khách vẫn có ~1/27 cơ hội qua. Khi đó `ma` trỏ vào một mã KHÔNG
   * tồn tại, và tầng khớp cần ứng viên kế tiếp thay vì đầu hàng. Xác suất nhỏ, nhưng hậu quả
   * là "tiền về không khớp phiếu nào" — thứ mà mỗi lần xảy ra là một cuộc gọi của phụ huynh.
   */
  ungVien: string[];
  /** Mã ĐỜI CŨ (`ORD…D<số>`) nếu có. */
  maDoiCu: string | null;
  /** SĐT 10 số nếu có; `null` khi không có hoặc không chắc. */
  sdt: string | null;
};

/**
 * Tầng 2: quét chuỗi đã sạch bằng cửa sổ trượt.
 *
 * ⚠️ KHÔNG đòi vị trí và KHÔNG đoán. Mỗi ứng viên phải tự chứng minh bằng checksum (đời mới)
 * hoặc bằng khuôn neo hai đầu (đời cũ). Khối trượt checksum thì bỏ qua, **không** hạ chuẩn để
 * "đằng nào cũng gần đúng".
 */
export function docMemo(memo: string): MemoDaDoc {
  const sach = chuanHoaMemo(memo);

  // ── Mã đời MỚI: cửa sổ 5, ký tự đầu là chữ cái của bảng, checksum pass ────
  const ungVien: string[] = [];
  for (let i = 0; i + DAI_MA <= sach.length; i++) {
    if (!CHU_CAI_DAU.includes(sach[i]!)) continue; // mỏ neo: không bắt đầu bằng số
    const khoi = sach.slice(i, i + DAI_MA);
    if (!maHopLe(khoi)) continue;
    if (!ungVien.includes(khoi)) ungVien.push(khoi);
  }

  // ── Mã đời CŨ: `ORD` + thân + `D` + số đợt ────────────────────────────────
  // Neo bằng `ORD` ở đầu và phải kết thúc đúng chỗ số đợt hết. Không dùng `{4,14}` tham lam
  // rồi cắt, vì chuỗi sạch có thể còn số của ngân hàng dính ngay sau số đợt.
  let maDoiCu: string | null = null;
  for (const khop of sach.matchAll(/ORD[A-Z0-9]{4,14}?D\d{1,2}/g)) {
    if (maDoiCuHopLe(khop[0])) {
      maDoiCu = khop[0];
      break;
    }
  }

  // ── SĐT: đúng 10 số bắt đầu bằng 0 ────────────────────────────────────────
  // Neo hai đầu bằng "không phải chữ số" để 9 số hay 11 số KHÔNG bị cắt thành 10 — spec:
  // *"9 hay 11 số → coi như không có SĐT, không đoán."*
  let sdt: string | null = null;
  for (const khop of sach.matchAll(/\d+/g)) {
    const day = khop[0];
    if (day.length === 10 && day.startsWith("0")) {
      sdt = day;
      break;
    }
  }

  return { sach, ma: ungVien[0] ?? null, ungVien, maDoiCu, sdt };
}

/** Bảng chữ xuất lại để test và màn quản trị dùng chung một nguồn. */
export { BANG_CHU, CHU_CAI_DAU };
