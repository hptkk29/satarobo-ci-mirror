/**
 * MỘT ĐƠN — NHIỀU CON. Luật "khoản tiền này của đứa trẻ nào" hỏi ở ĐÚNG MỘT chỗ.
 *
 * ── Vì sao có file này (15/09/2026) ──
 * Trước đợt này `/orders/new` chỉ dựng được đơn một dòng, nên "học viên của đơn"
 * (`Order.studentId`) và "học viên của dòng" là cùng một thứ và không ai phải phân
 * biệt. Từ khi một phụ huynh hai con học hai khoá gộp được vào MỘT đơn (một công nợ,
 * một mã QR — đúng yêu cầu của chủ dự án), hai khái niệm đó tách hẳn ra:
 *
 *   · `OrderItem.studentId` — của TỪNG DÒNG. Đây là sự thật.
 *   · `Order.studentId`     — chỉ còn nghĩa khi cả đơn về ĐÚNG MỘT em.
 *
 * Đơn hai con mà vẫn nhét một `Order.studentId` vào là nói dối một cách im lặng: hoàn
 * tiền, ZNS học phí và cổng phụ huynh đều đọc cột đó, nên tất cả sẽ nói sai tên một
 * đứa trẻ mà không lỗi nào nổ ra.
 *
 * ⚠️ File THUẦN — KHÔNG `import "server-only"`. Form tạo đơn (client component) và
 * `createOrderManualAction` (server) phải dùng CHUNG hàm này, kẻo hai bên suy ra hai
 * kết quả khác nhau cho cùng một đơn. Server vẫn là bên quyết định: client gửi gì thì
 * gửi, action tính lại từ các dòng.
 */

import { canonicalPhone } from "@/lib/phone";

/** Đủ để trả lời "em này là con của SĐT nào" — cố ý hẹp, đừng đòi cả bản ghi học viên. */
export type HocVienTheoSdt = { id: string; parentPhone: string | null };

/**
 * CON CỦA SỐ ĐIỆN THOẠI NÀY — một luật, ba chỗ gọi [15/09/2026].
 *
 * Chủ dự án: *"ở phần khoá học, học viên thì lấy đúng số con trong lead nhập ở sđt ở trên
 * session khách hàng, chứ không hiển thị full như vậy"* và *"ở dưới khoá học thì tên học
 * viên được chọn sẵn 1 trong số con của PH luôn"*.
 *
 * Ba nơi cần đúng CÙNG một câu trả lời, nếu không thì ô lọc bày ra một tập còn ô chọn sẵn
 * lại trỏ vào em ngoài tập đó:
 *   1. danh sách gợi ý trong ô "Học viên" của dòng hàng;
 *   2. lúc người bán bấm chọn một lead từ gợi ý SĐT;
 *   3. lúc mở `/orders/new?leadId=…` từ trang lead (đường CHÍNH, và là đường trước bản này
 *      KHÔNG chọn sẵn con nào — đo thật: tên PH + SĐT điền sẵn, lọc đúng "1 con", mà ô học
 *      viên vẫn rỗng).
 *
 * ⚠️ So bằng `canonicalPhone`, KHÔNG so chuỗi thô. `Student.parentPhone` trong DB đang có
 * cả `0…` lẫn `84…` (di sản 6 hàm chuẩn hoá cũ) và `Lead.phone` cũng vậy — đo trên
 * `satarobo_local`: lead mẫu mang `84930000001`, nên so thô là lọc mất đúng bản ghi cần tìm.
 *
 * ⚠️ SĐT rỗng/không đọc được ⇒ mảng RỖNG, KHÔNG phải "tất cả". Đây là hàm trả lời "con của
 * ai", và "chưa biết ai" thì câu trả lời đúng là không ai. Việc "chưa có SĐT thì bày đủ
 * danh sách cho đơn walk-in" là quyết định của MÀN HÌNH, và nó phải nằm ở màn hình — trộn
 * vào đây là biến một hàm tra cứu thành một hàm đôi lúc trả về cả thế giới.
 */
export function conCuaPhuHuynh<T extends HocVienTheoSdt>(
  hocVien: readonly T[],
  sdt: string | null | undefined,
): T[] {
  const chuan = canonicalPhone(sdt);
  if (!chuan) return [];
  return hocVien.filter((hv) => canonicalPhone(hv.parentPhone) === chuan);
}

/**
 * Em được CHỌN SẴN ở dòng đầu — `null` khi SĐT chưa có hoặc không con nào khớp.
 *
 * Lấy em ĐẦU TIÊN theo đúng thứ tự danh sách gợi ý đang bày, để thứ được chọn sẵn luôn là
 * thứ người bán nhìn thấy đầu bảng.
 *
 * ⚠️ Phụ huynh NHIỀU CON thì đây là một PHỎNG ĐOÁN, và nó gán tiền cho một đứa trẻ. Chủ dự
 * án chốt vẫn chọn sẵn ("chọn sẵn 1 trong số con của PH luôn") vì đa số đơn là một con;
 * bù lại màn hình phải NÓI RA số con đang khớp để người bán biết mà đổi — xem lời nhắc
 * dưới ô Học viên. Đừng bỏ lời nhắc đó đi cùng lúc với việc giữ phép đoán này.
 */
export function conChonSan(
  hocVien: readonly HocVienTheoSdt[],
  sdt: string | null | undefined,
): string | null {
  return conCuaPhuHuynh(hocVien, sdt)[0]?.id ?? null;
}

/** Bỏ khoảng trắng, bỏ rỗng, bỏ trùng — danh sách học viên KHÁC NHAU trên các dòng. */
export function hocVienTrenCacDong(
  items: readonly { studentId?: string | null }[],
): string[] {
  return [
    ...new Set(
      items
        .map((it) => it.studentId?.trim())
        .filter((v): v is string => !!v),
    ),
  ];
}

/**
 * Giá trị ĐÚNG cho `Order.studentId`, suy từ các dòng.
 *
 * - 1 em trên các dòng  → chính em đó (dù client gửi gì).
 * - ≥2 em               → `null`. Đơn nhiều con KHÔNG quy về một em.
 * - 0 em khai trên dòng → giữ `studentIdGuiLen` (đường convert-lead vẫn dựa vào nó;
 *   người gọi có trách nhiệm đã tra scope giá trị này trước khi truyền vào).
 */
export function studentIdChoDon(
  items: readonly { studentId?: string | null }[],
  studentIdGuiLen: string | null | undefined,
): string | null {
  const tren = hocVienTrenCacDong(items);
  if (tren.length === 1) return tren[0]!;
  if (tren.length > 1) return null;
  return studentIdGuiLen?.trim() || null;
}

/**
 * Đơn có từ HAI em trở lên mà còn dòng chưa khai học viên → chặn.
 *
 * Đơn một con để trống ô học viên vẫn hợp lệ (khách vãng lai, con chưa có hồ sơ —
 * tên con lúc đó nằm trong tên khoá học). Nhưng ngay khi đơn mang hai em, một dòng
 * trống là một khoản tiền KHÔNG AI BIẾT của ai — và nó chỉ lộ ra lúc hoàn tiền hoặc
 * lúc phụ huynh hỏi, tức là muộn nhất có thể.
 */
export function thieuHocVienODong(
  items: readonly { studentId?: string | null }[],
): boolean {
  return (
    hocVienTrenCacDong(items).length > 1 &&
    items.some((it) => !it.studentId?.trim())
  );
}

/**
 * Ô CHỌN HỌC VIÊN BÀY RA TẬP NÀO — và vì sao [16/09/2026].
 *
 * ── Vì sao có hàm này, khi `conCuaPhuHuynh` đã tồn tại ──
 * Chủ dự án nêu lỗi này LẦN THỨ HAI: *"bộ lọc học viên khi đã lọc sđt ph vẫn hiển thị full
 * chứ không hiển thị chỉ con của PH đó, dẫn đến loạn, có thể chọn sai con"*. Bản vá lần
 * trước (`9b69d193`, giữ nguyên qua `f3259122`) KHÔNG sai ở phép so — nó sai ở một dòng
 * fail-open nằm TRONG màn hình:
 *
 *     const dung = conCuaSdt.length > 0 ? conCuaSdt : students;   // order-create-form.tsx:1345
 *
 * Không con nào khớp ⇒ bày lại TOÀN BỘ danh sách. Đo trên `satarobo_local` (chính DB mà
 * dev server đọc): **121/125 lead = 96,8% cho ra 0 con khớp** ⇒ ô chọn bày đủ 247 học viên.
 * Từ ghế người bán, hành vi đó KHÔNG phân biệt được với "không lọc gì cả" — nên bản vá
 * trước, dù đúng về hàm, không đổi được điều chủ dự án nhìn thấy.
 *
 * Vì sao 121/125: với lead MỚI, "con của phụ huynh này" sống ở `LeadChild` chứ chưa ở
 * `Student` (đo: 130 dòng `LeadChild` / 104 lead, và `LeadChild` KHÔNG có cột `studentId`).
 * Ô chọn chỉ nạp từ `Student` (`orders/_actions.ts:1179-1184`) nên nó không thể khớp.
 *
 * ⚠️ Bẫy mà người vá trước NGHI SAI, ghi lại để không ai đi lại: hình dạng SĐT KHÔNG phải
 * nguyên nhân. `canonicalPhone("84938691925") === canonicalPhone("0938691925")` → `true`
 * (đo thật). Và chú thích ở `conCuaPhuHuynh` bảo DB có cả `0…` lẫn `84…` cũng SAI: đo
 * 259/259 `Student.parentPhone` đều dạng `84…`, 0 bản ghi dạng `0…`. Chú thích không phải
 * bằng chứng.
 *
 * ── Vì sao ĐÚNG MỘT hàm trả CẢ tập LẪN mã trạng thái ──
 * Bản cũ để màn hình tự suy câu nhắc bằng một biểu thức RIÊNG, và biểu thức đó mang một
 * lỗi câm suốt thời gian sống của nó: `customerPhone.replace(/D/g, "")` — thiếu dấu gạch
 * chéo, nên nó xoá chữ `D` hoa chứ không xoá ký tự không-phải-số (`/\D/g`; dòng 498 cùng
 * tệp viết ĐÚNG). Ý định "đủ 6 chữ số mới nhắc" vì thế chưa từng được thi hành. Tách tập
 * và câu nhắc thành hai phép tính là mở sẵn đường cho chúng nói khác nhau — nên ở đây
 * chúng là MỘT giá trị trả về.
 *
 * ── Bốn trạng thái, loại trừ nhau ──
 * · `CHUA_CO_SDT`  — chưa đọc được SĐT (trống, hoặc đang gõ dở) ⇒ bày ĐỦ. Cố ý: chặn lúc
 *                    người ta đang gõ là ô chọn nhảy loạn, và đơn walk-in không có SĐT vẫn
 *                    phải chọn được con.
 * · `DANG_LOC`     — SĐT đọc được, có con khớp ⇒ bày ĐÚNG các con đó.
 * · `KHONG_CO_CON` — SĐT đọc được, KHÔNG con nào khớp ⇒ bày **RỖNG**. Đây là chỗ đảo hành
 *                    vi cũ, và là toàn bộ mục đích của hàm: thà một ô rỗng có lời giải
 *                    thích còn hơn 247 em trong đó có con của nhà khác.
 * · `BAY_TAY`      — người bán CHỦ ĐỘNG bấm "bày cả danh sách" ⇒ bày ĐỦ.
 *
 * `BAY_TAY` không phải cửa hậu cho hành vi cũ: khác biệt là AI quyết. Trước đây hệ thống
 * âm thầm mở; nay người bán phải bấm, và cú bấm đó là lúc họ tự nhận "tôi biết em này
 * không khớp SĐT". Bỏ hẳn cửa này thì ca SĐT nhà có hai số (mẹ đăng ký, bố đóng tiền) trở
 * thành đường cụt.
 */
export const MA_LOC_CON = {
  CHUA_CO_SDT: "CHUA_CO_SDT",
  DANG_LOC: "DANG_LOC",
  /** 0 học viên khớp NHƯNG lead có khai con — ca CHIẾM ĐA SỐ, xem `conLead` bên dưới. */
  CON_LEAD: "CON_LEAD",
  KHONG_CO_CON: "KHONG_CO_CON",
  BAY_TAY: "BAY_TAY",
} as const;

export type MaLocCon = (typeof MA_LOC_CON)[keyof typeof MA_LOC_CON];

/** Con KHAI TRONG LEAD — chưa có hồ sơ `Student`. Cố ý hẹp. */
export type ConLead = { id: string; fullName: string };

export type KetQuaLocCon<T> = {
  /** Học viên ĐÃ CÓ HỒ SƠ đem vào ô chọn. Màn hình không được lọc lại. */
  ds: T[];
  /**
   * Con KHAI TRONG LEAD, chưa convert nên chưa có `Student`.
   *
   * ⚠️ ĐÂY MỚI LÀ CA CHÍNH, không phải ca biên [đảo 16/09/2026]. Chủ dự án: *"lead này đa
   * số là lead chưa chốt nên chưa phải là học viên nên sẽ lấy thông tin con của PH lead đó
   * chứ"*. Đo trên `satarobo_local`: **121/125 lead (96,8%)** không có `Student` nào khớp
   * SĐT, trong khi `LeadChild` có **130 dòng trên 104 lead** — con CÓ trong hệ thống, chỉ
   * nằm ở bảng khác. Bản vá sáng 16/09 chặn được việc chọn NHẦM con nhà khác, nhưng vẫn
   * chưa cho chọn ĐÚNG con, vì nó chỉ nhìn bảng `Student`.
   *
   * Danh sách này KHÔNG lọc lại theo SĐT: nó là con của ĐÚNG lead mà màn hình đang gắn,
   * nên quan hệ cha–con đã chắc chắn từ nguồn. Lọc lại ở đây là thêm một phép so có thể
   * sai mà không thêm bảo đảm nào.
   *
   * ⚠️ `LeadChild` KHÔNG có cột `studentId` (đã grep). Không có đường nối sẵn nào từ con
   * lead sang học viên — cầu nối duy nhất trong repo là `Enrollment.leadChildId`, do
   * `convert-lead-v2` ghi lúc chốt. Nên dòng đơn chọn con lead phải mang `leadChildId`
   * để lúc convert còn ráp lại được.
   */
  conLead: ConLead[];
  ma: MaLocCon;
  /** Số con khớp SĐT — dùng cho câu nhắc. Luôn là số con THẬT, kể cả khi `ma = BAY_TAY`. */
  soCon: number;
  /** Tổng số học viên đang có, để câu nhắc nói được "bày cả danh sách (N em)". */
  tong: number;
};

export function locConChoODon<T extends HocVienTheoSdt>(
  hocVien: readonly T[],
  sdt: string | null | undefined,
  bayTay: boolean,
  /**
   * Con khai trong lead đang gắn với màn hình. Tham số BẮT BUỘC, không mặc định `[]`
   * (luật 7): mặc định rỗng làm ca chiếm 96,8% lặng lẽ biến mất, và không lời gọi nào bị
   * `tsc` chỉ ra. Không có lead thì truyền `[]` một cách CÓ Ý THỨC.
   */
  conLead: readonly ConLead[],
): KetQuaLocCon<T> {
  const con = conCuaPhuHuynh(hocVien, sdt);
  const tong = hocVien.length;
  const cl = [...conLead];

  // ⚠️ Thứ tự các nhánh có nghĩa. `BAY_TAY` đứng TRƯỚC nhánh SĐT: người bán đã chủ động
  // xin cả danh sách thì một SĐT khớp 1 con KHÔNG được thu ô lại — làm vậy là cú bấm của
  // họ bị hệ thống lặng lẽ huỷ (luật 12: affordance phải nói thật).
  if (bayTay) {
    return { ds: [...hocVien], conLead: cl, ma: MA_LOC_CON.BAY_TAY, soCon: con.length, tong };
  }
  if (!canonicalPhone(sdt)) {
    // Chưa đọc được SĐT: bày đủ học viên. Con lead VẪN đi kèm nếu màn đang gắn một lead —
    // mở `/orders/new?leadId=…` thì quan hệ cha–con đã chắc chắn, không phụ thuộc ô SĐT
    // người bán đã gõ xong hay chưa.
    return { ds: [...hocVien], conLead: cl, ma: MA_LOC_CON.CHUA_CO_SDT, soCon: 0, tong };
  }
  if (con.length > 0) {
    return { ds: con, conLead: cl, ma: MA_LOC_CON.DANG_LOC, soCon: con.length, tong };
  }
  if (cl.length > 0) {
    // CA CHÍNH (121/125 lead): chưa em nào có hồ sơ, nhưng lead đã khai con. Ô chọn phải
    // bày ĐÚNG những em đó — không rỗng, và tuyệt đối không phải cả 247 em của cơ sở.
    return { ds: [], conLead: cl, ma: MA_LOC_CON.CON_LEAD, soCon: 0, tong };
  }
  return { ds: [], conLead: [], ma: MA_LOC_CON.KHONG_CO_CON, soCon: 0, tong };
}

/**
 * MÃ HOÁ LỰA CHỌN CỦA Ô "HỌC VIÊN" — một ô, hai loại đứa trẻ [16/09/2026].
 *
 * Ô chọn bày CHUNG hai nhóm: em đã có hồ sơ (`Student.id`) và con khai trong lead
 * (`LeadChild.id`). Cả hai đều là cuid nên nhìn chuỗi KHÔNG phân biệt được — mà đoán sai
 * ở đây là gán tiền cho nhầm bảng, im lặng.
 *
 * Nên giá trị của con lead mang tiền tố. Cặp mã hoá/giải mã để ở tầng thuần (không phải
 * trong JSX) vì nó có test, và vì một bản chép tay thứ hai của cùng quy ước là chỗ để lệch.
 *
 * ⚠️ Tiền tố `lead:` KHÔNG được xuất hiện trong `Student.id`/`LeadChild.id` thật — cuid chỉ
 * gồm chữ và số, không có dấu hai chấm. Ca test ghim đúng điều đó.
 */
const TIEN_TO_CON_LEAD = "lead:";

/** Giá trị đem vào ô chọn cho một con lead. */
export function maChonConLead(leadChildId: string): string {
  return `${TIEN_TO_CON_LEAD}${leadChildId}`;
}

/**
 * Giải mã giá trị ô chọn thành ĐÚNG MỘT trong hai khoá.
 *
 * Trả `{studentId, leadChildId}` với đúng một vế khác `null` — hoặc cả hai `null` khi ô
 * để trống (khách vãng lai, con chưa có hồ sơ ở đâu cả). Không bao giờ trả cả hai.
 */
export function docMaChonHocVien(gia: string | null | undefined): {
  studentId: string | null;
  leadChildId: string | null;
} {
  const v = (gia ?? "").trim();
  if (!v) return { studentId: null, leadChildId: null };
  if (v.startsWith(TIEN_TO_CON_LEAD)) {
    const id = v.slice(TIEN_TO_CON_LEAD.length).trim();
    return id ? { studentId: null, leadChildId: id } : { studentId: null, leadChildId: null };
  }
  return { studentId: v, leadChildId: null };
}

/**
 * GHÉP `leadChildId` VÀO `metadata` CỦA DÒNG ĐƠN — thuần, có test [16/09/2026].
 *
 * Trả về giá trị đem thẳng vào `OrderItem.metadata`. `null` khi không có gì để ghi (người
 * gọi tự đổi thành `Prisma.JsonNull`) — cố ý KHÔNG import Prisma vào tệp thuần này.
 *
 * ⚠️ Vì sao `metadata` chứ không một cột riêng: `LeadChild` KHÔNG có cột `studentId`, và
 * cầu nối THẬT giữa con lead và học viên là `Enrollment.leadChildId`, do `convert-lead-v2`
 * ghi lúc chốt. Giá trị này chỉ cần sống từ lúc tạo đơn tới lúc convert. Thêm một cột +
 * migration trên bảng có dữ liệu prod cho một giá trị tạm là không xứng, và `metadata` vốn
 * đã giữ `courseId`/`coachFormat` cùng họ (xem `veMetadataDongDon`).
 *
 * ⚠️ KHÔNG đè các khoá đang có. Đơn khoá học mang `courseId` trong metadata, và
 * `chiaKhoanTheoDon` khớp tiền theo đúng khoá đó — ghi đè là làm mù phép chia tiền.
 */
export function veMetadataConLead(
  metadataDangCo: Record<string, unknown> | null,
  leadChildId: string | null,
): Record<string, unknown> | null {
  const id = leadChildId?.trim() || null;
  if (!id) return metadataDangCo;
  return { ...(metadataDangCo ?? {}), leadChildId: id };
}

/** Đọc `leadChildId` từ metadata của dòng đơn. Đối xứng với `veMetadataConLead`. */
export function docConLeadTuMetadata(
  metadata: unknown,
): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const v = (metadata as Record<string, unknown>).leadChildId;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * HỌC VIÊN TRÊN DÒNG PHẢI THUỘC ĐÚNG PHỤ HUYNH CỦA ĐƠN [16/09/2026].
 *
 * ── Vì sao cổng này tồn tại ──
 * Chủ dự án 16/09, bước A1: *"mọi OrderItem khi tạo/sửa phải có học viên thuộc đúng
 * lead/phụ huynh của đơn, sai → từ chối"*.
 *
 * Không phải phòng xa. ĐO ĐƯỢC trên `satarobo_local`, đơn `ORD-260915-000007`:
 *   · đơn của **Chị Diễm** (`84941000002`);
 *   · hai dòng hàng lại ghi **Dương Duy Đạt** (mẹ `84930000044`) và **Bùi Thanh Thảo**
 *     (mẹ `84930000150`) — con của HAI GIA ĐÌNH KHÁC;
 *   · tiền thì chảy đúng về ba con của chị Diễm (nhờ nhánh `duongLui` bỏ qua `studentId`).
 * Tức bản ghi đơn đang mang tên con nhà khác. Đơn đó phát QR/ZNS ra ngoài là LỘ THÔNG TIN
 * một đứa trẻ cho một gia đình không liên quan.
 *
 * Nguồn gốc: ô chọn học viên trước 16/09 bày cả 247 em của cơ sở (nhánh fail-open, xem
 * `locConChoODon`). Ô đó đã vá — nhưng vá ở CLIENT. Cổng này là vế SERVER: một lời gọi
 * action tự chế, hay một bản client cũ còn mở trong tab, vẫn gửi được `studentId` bất kỳ.
 *
 * ── Luật ──
 * Em hợp lệ khi `canonicalPhone(parentPhone)` của em khớp SĐT của ĐƠN, hoặc khớp SĐT của
 * LEAD mà đơn gắn vào. Hai vế vì đơn mở từ lead có thể mang SĐT đã sửa lại ở ô khách hàng.
 *
 * ⚠️ `parentPhone` RỖNG ⇒ TỪ CHỐI, không phải "cho qua". Đây là cổng chứng minh quyền sở
 * hữu; "không chứng minh được" và "chứng minh được" không phải một. Fail-open ở đúng chỗ
 * này là thứ vừa sinh ra dữ liệu hỏng.
 *
 * ⚠️ Trả về DANH SÁCH em vi phạm, không phải boolean: màn hình phải gọi được TÊN em sai để
 * người bán biết sửa dòng nào. Một câu "có lỗi" thì họ phải tự dò.
 */
export function hocVienLaCuaNguoiKhac<T extends HocVienTheoSdt>(
  hocVien: readonly T[],
  sdtDon: string | null | undefined,
  sdtLead: string | null | undefined,
): T[] {
  const duoc = new Set(
    [canonicalPhone(sdtDon), canonicalPhone(sdtLead)].filter(
      (v): v is string => !!v,
    ),
  );
  // Đơn KHÔNG có SĐT nào đọc được ⇒ không có gì để đối chiếu. Trả RỖNG (không chặn) và để
  // cổng khác lo: chặn ở đây sẽ khoá luôn đường tạo đơn walk-in chưa kịp nhập SĐT, mà ca
  // đó không phải ca cổng này sinh ra để chặn.
  if (duoc.size === 0) return [];
  return hocVien.filter((hv) => {
    const c = canonicalPhone(hv.parentPhone);
    return !c || !duoc.has(c);
  });
}
