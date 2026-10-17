import "server-only";
import { db } from "@/lib/db";
import { nationalPhone } from "@/lib/phone";

// =============================================================================
// Commit 4 — VietQR động. Tài khoản nhận tiền lưu ở IntegrationConfig
// provider="VIETQR" settings { bankBin, accountNumber, accountName }.
// CHỜ NGƯỜI DÙNG cung cấp bank+STK+chủ TK → khi chưa có, mọi helper trả null và
// UI hiển thị "chưa cấu hình". KHÔNG hardcode số tài khoản.
// QR dựng từ ảnh public img.vietqr.io (không cần API key/secret).
// =============================================================================

const PROVIDER = "VIETQR";

/**
 * BGĐ 31/07 — mỗi CƠ SỞ có tài khoản nhận tiền riêng. Lưu cùng bảng IntegrationConfig
 * với khoá `VIETQR:<centerId>`; khoá `VIETQR` trần là cấu hình CHUNG (fallback khi cơ
 * sở chưa cấu hình / đơn không gắn cơ sở). Không đổi schema — provider vốn là unique key.
 */
export function providerKeyForCenter(centerId?: string | null): string {
  return centerId ? `${PROVIDER}:${centerId}` : PROVIDER;
}

export interface PaymentConfig {
  bankBin: string; // mã ngân hàng (BIN) theo chuẩn VietQR, vd 970415 (Vietinbank)
  accountNumber: string;
  accountName: string;
}

function parseConfig(settings: unknown): PaymentConfig | null {
  const s = (settings ?? null) as Partial<PaymentConfig> | null;
  if (!s || !s.bankBin || !s.accountNumber || !s.accountName) return null;
  return { bankBin: s.bankBin, accountNumber: s.accountNumber, accountName: s.accountName };
}

/**
 * Tài khoản nhận tiền: ưu tiên cấu hình CỦA CƠ SỞ, lùi về cấu hình chung.
 * `centerId` null/không cấu hình → dùng cấu hình chung (hành vi cũ).
 */
export async function getPaymentConfig(centerId?: string | null): Promise<PaymentConfig | null> {
  if (centerId) {
    const perCenter = await db.integrationConfig.findUnique({
      where: { provider: providerKeyForCenter(centerId) },
      select: { settings: true },
    });
    const parsed = parseConfig(perCenter?.settings);
    if (parsed) return parsed;
  }
  const cfg = await db.integrationConfig.findUnique({
    where: { provider: PROVIDER },
    select: { settings: true },
  });
  return parseConfig(cfg?.settings);
}

/** Đọc cấu hình ĐÚNG cấp (không fallback) — dùng cho màn cấu hình để biết cơ sở nào đã đặt. */
export async function getPaymentConfigExact(
  centerId?: string | null,
): Promise<PaymentConfig | null> {
  const cfg = await db.integrationConfig.findUnique({
    where: { provider: providerKeyForCenter(centerId) },
    select: { settings: true },
  });
  return parseConfig(cfg?.settings);
}

/** Ba cột tài khoản trên một dòng `PaymentMethod` → `PaymentConfig`, hoặc null nếu thiếu. */
function configFromMethod(m: {
  bankBin: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
}): PaymentConfig | null {
  if (!m.bankBin || !m.bankAccountNumber || !m.bankAccountName) return null;
  return {
    bankBin: m.bankBin,
    accountNumber: m.bankAccountNumber,
    accountName: m.bankAccountName,
  };
}

/**
 * TÀI KHOẢN NHẬN TIỀN của một ĐƠN — nguồn sự thật từ 31/08/2026.
 *
 * Thứ tự tìm, và mỗi bước đều có lý do nghiệp vụ:
 *  1. PHƯƠNG THỨC ĐÃ CHỌN TRÊN ĐƠN, nếu nó là chuyển khoản và đã khai đủ tài khoản.
 *     Đây là ý chính của cả đợt: sale chọn "Chuyển khoản — CS1" thì phụ huynh quét ra
 *     đúng tài khoản CS1, không phải một tài khoản chung nào đó.
 *  2. Đơn chọn tiền mặt / chưa chọn phương thức (đơn từ convert lead luôn rơi vào đây —
 *     lib/crm/convert-lead.ts tạo đơn KHÔNG set paymentMethodId) → lấy phương thức
 *     chuyển khoản ĐANG BẬT của CƠ SỞ đơn, theo displayOrder. Không có bước này thì
 *     "xuất QR" trên phần lớn đơn thật sẽ báo chưa cấu hình.
 *  3. Phương thức chuyển khoản DÙNG CHUNG (centerId null) — cho đơn không gắn cơ sở.
 *  4. Kho CŨ `IntegrationConfig` khoá `VIETQR:*`. Chỉ còn là đường LÙI cho dữ liệu khai
 *     trước 31/08; màn /admin/tich-hop đã gỡ ô nhập nên không ai tạo thêm được. Chuyển
 *     nốt sang phương thức bằng `scripts/pttt-chuyen-tai-khoan-vietqr.ts` rồi bước này
 *     sẽ không bao giờ chạy nữa.
 */
export async function resolveOrderPaymentConfig(input: {
  centerId?: string | null;
  paymentMethodId?: string | null;
}): Promise<PaymentConfig | null> {
  const BANK_SELECT = {
    bankBin: true,
    bankAccountNumber: true,
    bankAccountName: true,
  } as const;

  // 1 — phương thức đã chọn trên đơn.
  if (input.paymentMethodId) {
    const chosen = await db.paymentMethod.findUnique({
      where: { id: input.paymentMethodId },
      select: { type: true, ...BANK_SELECT },
    });
    if (chosen?.type === "BANK_TRANSFER") {
      const cfg = configFromMethod(chosen);
      if (cfg) return cfg;
    }
  }

  // 2 + 3 — phương thức chuyển khoản của cơ sở, rồi tới dùng chung.
  // Một câu truy vấn cho cả hai, sắp `centerId` giảm dần để dòng CỦA CƠ SỞ đứng trước
  // dòng dùng chung (Postgres xếp NULL sau cùng với `NULLS LAST`).
  const candidates = await db.paymentMethod.findMany({
    where: {
      type: "BANK_TRANSFER",
      isActive: true,
      OR: [{ centerId: input.centerId ?? null }, { centerId: null }],
    },
    orderBy: [{ centerId: { sort: "desc", nulls: "last" } }, { displayOrder: "asc" }],
    select: BANK_SELECT,
  });
  for (const c of candidates) {
    const cfg = configFromMethod(c);
    if (cfg) return cfg;
  }

  // 4 — đường lùi cho dữ liệu cũ.
  return getPaymentConfig(input.centerId ?? null);
}

export async function setPaymentConfig(
  input: PaymentConfig,
  centerId?: string | null,
): Promise<void> {
  const provider = providerKeyForCenter(centerId);
  await db.integrationConfig.upsert({
    where: { provider },
    update: { isEnabled: true, settings: input as unknown as object },
    create: { provider, isEnabled: true, settings: input as unknown as object },
  });
}

/**
 * Bỏ dấu tiếng Việt + MỌI ký tự không phải chữ/số (kể cả khoảng trắng) trong MỘT
 * thành phần: "Nguyễn Văn A" → "NguyenVanA".
 *
 * Khoảng trắng bị bỏ hẳn (khác bản cũ vốn giữ lại) vì dấu phân cách giữa các
 * thành phần nay là "_" — còn khoảng trắng thì ngân hàng cắt/gộp tuỳ ý và ta mất
 * biên giữa tên con với tên khoá.
 */
function sanitizePart(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9]/g, "");
}

/** Trần ký tự của nội dung CK theo giới hạn ngân hàng (chuỗi phụ huynh GÕ TAY). */
export const MAX_TRANSFER_CONTENT = 80;

/**
 * Trần ký tự của `addInfo` khi NHÚNG VÀO MÃ QR — 25, không phải 80.
 *
 * VÌ SAO 25: `addInfo` đi vào trường EMVCo `08` ("purpose of transaction") của
 * chuẩn VietQR, đặc tả giới hạn 25 ký tự; dài hơn thì bên dựng mã CẮT ĐUÔI IM
 * LẶNG — không lỗi, không cảnh báo. Đây KHÔNG phải con số tuỳ hứng.
 *
 * VÌ SAO PHẢI CẮT SẴN Ở TA thay vì để nó tự cắt: định dạng chốt 20/08 là
 * `HoTenCon_SdtPH_TenKhoa`, SĐT nằm SAU tên con ⇒ tên con dài là dao rơi trúng
 * SĐT. Mất SĐT = mất khoá đối khớp DUY NHẤT của nhánh (d)
 * (lib/payments/payos-ingest.ts) ⇒ mọi giao dịch của phụ huynh đó rơi vào đối
 * soát tay vĩnh viễn mà không ai biết. `buildTransferContent` cắt TÊN CON và giữ
 * trọn SĐT + tên khoá, nên cắt ở ta là an toàn — đã đo: "NguyenThiMinhKhue_
 * 0987654321_Sata4" dài 34 ký tự, vượt trần 9 ký tự.
 */
export const VIETQR_ADDINFO_MAX = 25;

/**
 * Trần ký tự của MÃ KHOÁ ngắn trong nội dung CK.
 *
 * VÌ SAO 5 — hai lý do trùng nhau, không phải số chọn bừa:
 *  1. Toàn bộ danh mục thật đều có mã đúng 5 ký tự: `Sata1`…`Sata8` và `Combo`
 *     (prisma/seed-courses.ts đặt tên khoá là `${c.id} — ${c.displayName}`, phần
 *     mã là `c.id`). Cắt ở 5 nên KHÔNG khoá nào bị cụt mã.
 *  2. Đúng bằng phần còn lại của trần QR sau khi trả đủ các phần bắt buộc:
 *     25 − 10 (SĐT nội địa `0…`) − 2 (hai dấu `_`) − 7 (`TRANSFER_NAME_MIN`) = 6,
 *     nên trần 5 nay còn dư một ký tự — dư đó chảy sang TÊN CON, không nới mã khoá
 *     (lý do 1 vẫn chặn ở 5).
 *     Chọn lớn hơn thì ở trần 25 nó vẫn bị ngân sách cắt lại (mã khoá trong QR sẽ
 *     KHÁC mã khoá trong bản 80 ký tự sale đọc — hai bên lệch nhau là tự đẻ ca
 *     trượt đối khớp); chọn nhỏ hơn thì mã thật bị cụt vô cớ.
 */
export const COURSE_TOKEN_MAX = 5;

/**
 * Hạn mức TỐI THIỂU bảo đảm cho TÊN CON trước khi tên khoá được lấy chỗ.
 *
 * VÌ SAO PHẢI CÓ (đo 20/08, hỏng thật): bản trước cấp chỗ cho tên con bằng "phần
 * thừa sau khi SĐT và tên khoá đã lấy đủ", mà tên khoá là tên marketing dài
 * ("Sata4 — Bứt Phá Giới Hạn" → sạch còn 19 ký tự) ⇒ ngân sách tên con ≤ 0 với
 * **11/11 khoá thật** ⇒ tên con biến mất khỏi MỌI chuỗi. Hệ quả nghiệp vụ: kế toán
 * nhìn sao kê chỉ thấy số + mã khoá cụt, không biết tiền của con nào — đúng thứ
 * chủ dự án đổi định dạng để có được.
 *
 * VÌ SAO 7: đủ chứa họ + ký tự đầu của chữ đệm ("NguyenV"), và là số lớn nhất còn
 * chừa trọn 5 ký tự mã khoá ở trần 25 (7 + 1 + 10 + 1 + 5 = 24, dư 1 ký tự cho tên con).
 *
 * ⚠️ Giới hạn CÒN LẠI, cố ý không vá ở đây: hai anh em ruột mà 7 ký tự đầu của tên
 * trùng nhau ("Nguyen Van An" / "Nguyen Van Anh" → đều "NguyenV") vẫn sinh chuỗi
 * giống hệt ở trần 25. Viết tắt kiểu "NVAn" tách được ca đó nhưng làm hỏng định
 * dạng chủ dự án đã chốt (`NguyenV_0987654321_Sata4`), nên ca này nhường cho tiêu
 * chí phụ theo số tiền ở lib/payments/payos-ingest.ts.
 */
export const TRANSFER_NAME_MIN = 7;

/**
 * Rút MÃ KHOÁ NGẮN từ tên dòng hàng: `"Sata4 — Bứt Phá Giới Hạn"` → `"Sata4"`.
 *
 * ⚠️ VÌ SAO KHÔNG DÙNG THẲNG `OrderItem.itemName`: đó là tên MARKETING đầy đủ
 * (`Course.name`), dài 17–24 ký tự sau khi bỏ dấu — một mình nó đã ăn hết trần 25
 * của mã QR. Ví dụ chủ dự án đưa ra khi chốt định dạng dùng đúng `Sata4`, tức yêu
 * cầu vốn đã ngụ ý mã ngắn chứ không phải tên đầy đủ.
 *
 * Quy tắc tách: phần TRƯỚC dấu gạch ngang là mã. Chỉ coi là dấu phân cách khi gặp
 * gạch DÀI (`—` / `–`, dạng seed đang dùng) hoặc gạch ngắn CÓ KHOẢNG TRẮNG HAI BÊN
 * (` - `, dạng `shortName` trong courses-pricing.ts). Gạch ngắn dính chữ là dấu nối
 * trong từ ("E-learning") — cắt ở đó là chặt cụt tên khoá.
 *
 * Không có dấu gạch (2 khoá gốc `"Lập trình Robot"`, `"Luyện thi Robosim"`) → sạch
 * hoá rồi cắt ở `COURSE_TOKEN_MAX`. Rỗng/null → chuỗi rỗng (thành phần bị bỏ qua).
 */
export function shortCourseToken(courseName: string | null | undefined): string {
  const raw = String(courseName ?? "").trim();
  if (!raw) return "";
  const sep = raw.match(/[—–]|\s-\s/);
  const head = sep && sep.index !== undefined ? raw.slice(0, sep.index) : raw;
  // Tên bắt đầu bằng chính dấu gạch ("— Bứt Phá") thì phần đầu rỗng → lùi về cả
  // chuỗi, đừng trả rỗng: mất luôn thành phần tên khoá là mất một bằng chứng phụ.
  const token = sanitizePart(head) || sanitizePart(raw);
  return token.slice(0, COURSE_TOKEN_MAX);
}

/**
 * Phần SĐT trong nội dung CK — dạng NỘI ĐỊA `0XXXXXXXXX` (lib/phone.ts là nguồn
 * chuẩn hoá DUY NHẤT của repo, đừng viết lại regex ở đây).
 *
 * ⚠️ ĐỔI 14/09/2026 — trước đây in canonical `84XXXXXXXXX`. Chủ dự án: "sđt trong
 * nội dung ck là 0987654321 chứ không dùng 0987654321". Chuỗi này là thứ SALE ĐỌC
 * cho phụ huynh và phụ huynh GÕ TAY, mà không ai đọc số của mình theo dạng `84…`.
 *
 * ĐỐI KHỚP KHÔNG HỀ HẤN — đã kiểm cả hai chiều trước khi đổi:
 *  · `extractVnPhoneCandidates` (payos-ingest) chuẩn hoá NGƯỢC mọi token về `84…`,
 *    và đã có ca sẵn cho `0987654321` (payos-ingest.test.ts).
 *  · `findPendingOrdersByPhone` tra bằng `phoneVariants`, vốn trả CẢ `84…` LẪN `0…`.
 *  · `expectedContentsFor` tái dựng bằng CHÍNH hàm này nên hai vế luôn cùng dạng.
 *
 * Lợi phụ: `0…` ngắn hơn `84…` một ký tự, và ngân sách trong `transferContentParts`
 * tính động theo `phone.length`, nên ký tự đó tự chảy sang TÊN CON.
 *
 * ⚠️ Nợ đi kèm, chưa vá ở đây: mã QR PHÁT TRƯỚC 14/09 mang `84…`, nên tầng 1 của
 * nhánh (d) ("chứa trọn chuỗi tái dựng") sẽ trượt với chúng và tụt xuống tầng 2
 * (bằng chứng yếu hơn, vẫn khớp được nhờ tên con). Vá triệt để = cho
 * `expectedContentsFor` thử cả hai dạng SĐT — nằm ở `payos-ingest.ts`, để đợt sau.
 *
 * Số không chuẩn hoá được (số bàn, số nước ngoài, dữ liệu cũ lỗi) vẫn in phần chữ
 * số để kế toán soi sao kê còn đối chiếu được bằng mắt; nó KHÔNG tự khớp bừa được
 * vì nhánh đối khớp theo SĐT chỉ nhận di động VN.
 */
export function transferPhonePart(raw: string | null | undefined): string {
  const noiDia = nationalPhone(raw);
  if (noiDia) return noiDia;
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

/**
 * TÊN GỌI của học viên — chữ CUỐI trong họ tên: `"Trần Minh An"` → `"An"`.
 *
 * ⚠️ VÌ SAO CÓ (chủ dự án 21/08): trần 25 ký tự của mã QR không đủ cho họ tên đầy
 * đủ, và bản trước cắt cụt giữa chừng ra `"NguyenV"` — vừa khó đọc, vừa không phải
 * tên ai cả. Chủ dự án chốt: "nếu họ tên dài quá thì chỉ lấy tên", mẫu
 * `An_0987654321_sata4`. Tên gọi ngắn, phụ huynh nhận ra ngay, và tách anh em ruột
 * TỐT HƠN cách cắt cũ (hai anh em thường trùng họ + chữ đệm, khác nhau ở chữ cuối —
 * `"Trần Minh An"`/`"Trần Minh Anh"` cắt 7 ký tự đều ra `"TranMin"`, lấy tên gọi
 * thì ra `"An"`/`"Anh"`).
 *
 * ⚠️ Phải tách chữ TRƯỚC khi `sanitizePart` — hàm đó xoá luôn khoảng trắng nên gọi
 * sau thì không còn biên chữ nào để tách.
 */
export function givenNamePart(fullName: string | null | undefined): string {
  const words = String(fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "";
  return sanitizePart(words[words.length - 1]!);
}

/**
 * Nội dung CK: `HoTenCon_SdtPH_TenKhoa` — vd `NguyenVanA_0987654321_Sata4`.
 *
 * ⚠️ Chủ dự án 20/08 ĐẢO quy ước cũ: nội dung KHÔNG còn mang MÃ ĐƠN
 * (`ORD260820000001D1`). Lý do: sale phải đọc chuỗi này qua điện thoại cho phụ
 * huynh và kế toán phải nhìn sao kê biết tiền của ai — mã đơn không nói lên gì.
 * Tham số `orderCode` cũ ĐÃ BỎ HẲN khỏi chữ ký (không để lại tham số câm, kẻo
 * người sau truyền mã đơn vào rồi tưởng nó có trong chuỗi).
 *
 * Đối khớp tiền về không còn dựa vào chuỗi này nữa mà đi nhánh SĐT — xem
 * `resolvePaymentTarget` nhánh (d) trong lib/payments/payos-ingest.ts.
 *
 * Thành phần rỗng bị BỎ QUA (không để lại "__"). Thiếu chỗ thì cắt theo thứ tự ưu
 * tiên đã chốt: SĐT trọn tuyệt đối → tên con giữ tối thiểu `TRANSFER_NAME_MIN` →
 * tên khoá (vốn đã là MÃ NGẮN, xem `shortCourseToken`) cắt sau cùng.
 */
export function buildTransferContent(
  studentName: string,
  parentPhone: string | null | undefined,
  courseName: string | null | undefined,
  maxLength: number = MAX_TRANSFER_CONTENT,
): string {
  return transferContentParts(studentName, parentPhone, courseName, maxLength).content;
}

/**
 * Ba mảnh của nội dung CK **sau khi đã cắt** + chuỗi cuối cùng.
 *
 * ⚠️ "SAU KHI ĐÃ CẮT" là toàn bộ lý do kiểu này tồn tại. Ở trần QR 25 ký tự, HỌ
 * TÊN đầy đủ gần như luôn phải thu về TÊN GỌI (`givenNamePart`). Bên đối khớp
 * (lib/payments/payos-ingest.ts nhánh (d)) phải so với đúng những gì hệ thống
 * THỰC SỰ PHÁT RA — so với tên đầy đủ là hồi quy đã đo: 8/11 khoá học trong dữ
 * liệu thật không bao giờ khớp, tiền hợp lệ rơi hết vào đối soát tay.
 *
 * ⚠️ Quan hệ giữa bản 25 và bản 80 (`MAX_TRANSFER_CONTENT`): `phone` và `course`
 * GIỐNG HỆT nhau ở hai bản (SĐT không bao giờ bị cắt; mã khoá đã ngắn sẵn 5 ký
 * tự), nhưng `name` KHÁC HẲN — bản 80 giữ họ tên đầy đủ (`"NguyenVanA"`) còn bản
 * 25 chỉ còn tên gọi (`"A"`). Vì vậy chuỗi 25 KHÔNG phải chuỗi con của chuỗi 80
 * (`A_849…` không nằm trong `NguyenVanA_849…`). Đây là hệ quả cố ý của định dạng
 * chốt 21/08, KHÔNG phải bug — và là lý do nhánh (d) phải tái dựng CẢ HAI trần:
 * phụ huynh quét QR gửi bản 25, phụ huynh gõ tay theo lời sale gửi bản 80.
 */
export type TransferContentParts = {
  /** Tên con còn sống sót — tối thiểu `TRANSFER_NAME_MIN` ký tự nếu còn chỗ. */
  name: string;
  /** SĐT — trọn vẹn, trừ khi `maxLength` nhỏ hơn cả độ dài số (ca không có thật). */
  phone: string;
  /** Mã khoá ngắn còn sống sót (có thể ngắn hơn `shortCourseToken` khi hết chỗ). */
  course: string;
  /** Chuỗi cuối cùng — ĐÚNG BẰNG `buildTransferContent(...)` cùng tham số. */
  content: string;
};

/**
 * Bản "mổ xẻ" của `buildTransferContent`: cùng một phép tính, nhưng trả thêm
 * từng mảnh sống sót. `buildTransferContent` gọi thẳng vào đây nên hai đường
 * KHÔNG THỂ lệch nhau — lệch là sale đọc một đằng, webhook so một nẻo.
 */
export function transferContentParts(
  studentName: string,
  parentPhone: string | null | undefined,
  courseName: string | null | undefined,
  maxLength: number = MAX_TRANSFER_CONTENT,
): TransferContentParts {
  const phone = transferPhonePart(parentPhone);
  const wantName = sanitizePart(studentName ?? "");
  // ⚠️ MÃ NGẮN, không phải tên marketing — xem `shortCourseToken`. Đây là thay đổi
  // làm cho định dạng chốt 20/08 THỰC SỰ đạt: trước đó tên khoá dài nuốt hết ngân
  // sách và tên con biến mất ở cả 11/11 khoá thật.
  const wantCourse = shortCourseToken(courseName);

  // ── Chia ngân sách ký tự ──────────────────────────────────────────────────
  // Thứ tự ưu tiên (chủ dự án chốt 20/08), KHÔNG được đảo:
  //   1. SĐT giữ TRỌN tuyệt đối — nó là khoá đối khớp DUY NHẤT của nhánh (d)
  //      (lib/payments/payos-ingest.ts). Mất số = tiền rơi vào đối soát tay.
  //   2. TÊN CON giữ tối thiểu `TRANSFER_NAME_MIN` — mục đích nghiệp vụ của cả
  //      định dạng này là để kế toán nhìn sao kê biết tiền của con nào.
  //   3. TÊN KHOÁ cắt sau cùng.
  //
  // Quy ước tính: coi MỌI thành phần đều tốn `len + 1` (1 ký tự cho dấu "_" đứng
  // trước nó) rồi cộng bù 1 vào ngân sách — nhờ vậy không phải xét riêng "thành
  // phần nào đang là thành phần đầu tiên" khi có thành phần rỗng.
  const budget = maxLength + 1 - (phone ? phone.length + 1 : 0);
  const nameCost = wantName ? wantName.length + 1 : 0;
  const courseCost = wantCourse ? wantCourse.length + 1 : 0;

  let name = wantName;
  let course = wantCourse;
  if (nameCost + courseCost > budget) {
    // ── Bước 1: THU GỌN HỌ TÊN VỀ TÊN GỌI, chưa cắt chữ nào ────────────────
    // Chủ dự án 21/08: "nếu họ tên dài quá thì chỉ lấy tên" (mẫu
    // `An_0987654321_sata4`). Thu gọn nguyên chữ bao giờ cũng hơn cắt cụt: `"An"`
    // là một cái tên, `"NguyenV"` thì không. Đại đa số ca dừng ngay ở đây — tên gọi
    // tiếng Việt hiếm khi quá 6 ký tự sau khi bỏ dấu.
    const shortName = givenNamePart(studentName);
    const shortCost = shortName ? shortName.length + 1 : 0;
    if (shortName && shortCost + courseCost <= budget) {
      name = shortName; // tên khoá giữ NGUYÊN VẸN
    } else {
      // ── Bước 2: tên gọi vẫn không vừa → mới cắt ─────────────────────────
      // Cắt trên TÊN GỌI chứ không phải họ tên đầy đủ: mất mấy chữ cuối của tên
      // gọi vẫn còn nhận ra, còn cắt họ tên thì ra một mẩu họ vô nghĩa.
      const base = shortName || wantName;
      const nameFloorCost = base ? Math.min(base.length, TRANSFER_NAME_MIN) + 1 : 0;
      const courseRoom = budget - nameFloorCost - 1; // −1 cho dấu "_" của tên khoá
      course = courseRoom > 0 ? wantCourse.slice(0, courseRoom) : "";
      // Tên khoá cắt xong còn thừa bao nhiêu thì trả lại hết cho tên.
      const nameRoom = budget - (course ? course.length + 1 : 0) - 1;
      name = nameRoom > 0 ? base.slice(0, nameRoom) : "";
    }
  }

  const ordered = [name, phone, course].filter(Boolean);
  const cut = ordered.join("_").slice(0, maxLength);

  // Phép chia ngân sách ở trên đã bảo đảm không vượt trần, nên `.slice` chỉ là
  // LƯỚI AN TOÀN (ca `maxLength` nhỏ hơn cả độ dài SĐT). Vẫn soi lại từng mảnh từ
  // chuỗi ĐÃ CẮT để `parts` không bao giờ mô tả sai `content`.
  const alive: string[] = [];
  let pos = 0;
  for (const p of ordered) {
    alive.push(cut.slice(pos, pos + p.length));
    pos += p.length + 1; // +1 cho dấu "_" đứng sau mảnh này
  }
  // Lấy lần lượt các mảnh còn sống theo ĐÚNG thứ tự đã ghép. Mảnh nào vốn rỗng
  // thì không có mặt trong `ordered` nên cũng không được lấy — nhờ vậy chỉ số
  // không bao giờ lệch khi thiếu SĐT hoặc thiếu tên khoá.
  const take = (): string => alive.shift() ?? "";
  return {
    name: name ? take() : "",
    phone: phone ? take() : "",
    course: course ? take() : "",
    content: cut.replace(/_+$/, ""),
  };
}

/**
 * Dữ liệu tối thiểu của ĐƠN để dựng nội dung CK.
 *
 * Có kiểu này để cả 3 nơi in nội dung ra màn hình (bảng phiếu thu, hộp phóng to
 * QR, khối "Thanh toán & QR" mức đơn) VÀ chuỗi nhúng vào ảnh QR dùng CHUNG một
 * công thức. Lệch công thức = sale đọc một đằng, QR mã một nẻo.
 */
export type TransferContentSource = {
  /** Tên học viên (ưu tiên) — đơn chưa gắn học viên thì lùi về tên người mua. */
  studentName?: string | null;
  customerName: string;
  customerPhone?: string | null;
  /** Tên khoá = tên dòng hàng đầu tiên của đơn. */
  courseName?: string | null;
};

/** Nội dung CK của MỘT ĐƠN. Mọi đợt của cùng đơn ra CÙNG chuỗi — xem ghi chú ở _qr-core.ts. */
export function transferContentForOrder(
  o: TransferContentSource,
  maxLength: number = MAX_TRANSFER_CONTENT,
): string {
  return transferContentPartsForOrder(o, maxLength).content;
}

/**
 * Bản mổ xẻ mức ĐƠN — dùng ở nhánh đối khớp theo SĐT. Giữ chung một chỗ quy ước
 * "tên học viên, thiếu thì lùi về tên người mua" để bên phát và bên đối khớp
 * không thể suy ra hai chuỗi khác nhau.
 */
export function transferContentPartsForOrder(
  o: TransferContentSource,
  maxLength: number = MAX_TRANSFER_CONTENT,
): TransferContentParts {
  return transferContentParts(
    o.studentName?.trim() || o.customerName,
    o.customerPhone,
    o.courseName,
    maxLength,
  );
}

/** URL ảnh VietQR động (compact2 — có logo + số tiền + nội dung). null nếu chưa cấu hình. */
export function buildVietQrImageUrl(
  cfg: PaymentConfig | null,
  amount: number,
  addInfo: string,
): string | null {
  if (!cfg) return null;
  const base = `https://img.vietqr.io/image/${encodeURIComponent(cfg.bankBin)}-${encodeURIComponent(cfg.accountNumber)}-compact2.png`;
  const params = new URLSearchParams();
  if (amount > 0) params.set("amount", String(amount));
  if (addInfo) params.set("addInfo", addInfo);
  params.set("accountName", cfg.accountName);
  return `${base}?${params.toString()}`;
}
