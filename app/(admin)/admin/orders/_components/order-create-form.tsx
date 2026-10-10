"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, Plus, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import {
  HE_SO_COACH,
  laKhoaLoaiTruCoach,
  NHAN_COACH,
  type CoachFormat,
} from "@/lib/finance/coach-pricing";
import { goiYGiaCoach, veMetadataDongDon } from "@/lib/orders/hinh-thuc-lop";
import { loiChuaDuyet } from "@/lib/orders/nguong-duyet";
import type { OrderType, OrderStatus, OrderItemType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { nationalPhone } from "@/lib/phone";
import {
  conChonSan,
  conCuaPhuHuynh,
  locConChoODon,
  MA_LOC_CON,
  docMaChonHocVien,
  maChonConLead,
  studentIdChoDon,
  thieuHocVienODong,
  type ConLead,
} from "@/lib/orders/hoc-vien-dong-don";
import { nhacTraLead, SO_CHU_SO_TOI_THIEU_TRA_LEAD } from "@/lib/orders/goi-y-sdt";
import {
  KIEU_GIAM,
  TRAN_KHOAN_GIAM_MOI_DONG,
  dongThieuGiaiTrinh,
  khoanVuotTran,
  loiThieuGiaiTrinh,
  loiVuotTran,
  tienDon,
  tienDong,
  type KhaiGiam,
  type KieuGiam,
} from "@/lib/orders/giam-gia-dong";
import {
  NHAN_LY_DO_LOAI,
  khaiGiamTuMa,
  locMaChoDong,
  lyDoKhongDung,
  nhanMucUuDai,
  type BoiCanhDong,
  type LyDoLoai,
  type MaApDung,
} from "@/lib/khuyen-mai/ap-vao-don";
import { ngayKetThuc } from "@/lib/khuyen-mai/hieu-luc";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { HelpHint } from "@/components/admin/ui/help-hint";
// KHỐI NHẬP KẾ HOẠCH — CÙNG component với trang chi tiết đơn (15/09/2026). Lý do không
// chép sang: chia đợt là phép chia TIỀN; xem chú thích đầu `ke-hoach-dot-editor.tsx`.
import { KeHoachDotEditor, useKeHoachDot } from "./ke-hoach-dot-editor";
import { dotsChoDonMoi, khoaKeHoachDonMoi } from "@/lib/payments/ke-hoach-don-moi";
import { goiYKeHoachDon } from "@/lib/orders/dot-theo-hoc-phan";
import { lyDoSoBuoi, xetSoBuoiDong } from "@/lib/orders/so-buoi-hoc-phan";
import {
  methodAllowsOrderType,
  methodServesCenter,
} from "@/lib/payments/method-scope";
import {
  createOrderManualAction,
  timPhuHuynhTheoSdtAction,
} from "../_actions";

type Course = {
  id: string;
  code: string | null;
  name: string;
  price: number | null;
  slug: string | null;
  /**
   * Số buổi CHUẨN của khoá — mẫu số của giá/buổi (SR.QD.219 Mục 5.2).
   *
   * ⚠️ Nullable THẬT và hay thiếu: `prisma/seed.ts` không đặt cột này, và đường ghi duy
   * nhất (`/admin/course-packages`) ghi NULL đè lên được. Thiếu ⇒ KHÔNG gợi ý được giá,
   * và màn phải nói ra chứ không được lặng lẽ ra số 0.
   */
  totalSessions: number | null;
};
type ProductOption = {
  id: string;
  sku: string;
  name: string;
  salePrice: number;
  stockOnHand: number;
  category: string;
};
type PM = {
  id: string;
  code: string;
  name: string;
  /** null = phương thức DÙNG CHUNG mọi cơ sở. */
  centerId: string | null;
  canBuyCourse: boolean;
  canBuyPackage: boolean;
  canBuyExam: boolean;
  canBuyProduct: boolean;
};
type Center = { id: string; name: string };
type StudentOption = {
  id: string;
  name: string;
  parentName: string | null;
  parentPhone: string | null;
};

/**
 * MỘT DÒNG HÀNG của đơn.
 *
 * ⚠️ Trước 15/09/2026 màn này chỉ có SÁU biến rời (`itemRefId`, `itemName`, `quantity`,
 * `unitPrice`, `coachFormat`, `soBuoiMua`) — tức chốt cứng MỘT dòng, dù cổng server
 * `createOrderManualAction` vốn đã nhận `items: z.array(...).max(20)` từ đầu. Hệ quả
 * nghiệp vụ: phụ huynh có hai con học hai khoá phải tạo HAI đơn ⇒ hai công nợ, hai mã
 * QR, hai lần nhắc nợ cho cùng một người trả tiền.
 *
 * `key` là id ổn định phía client để React không nhầm dòng khi xoá giữa danh sách —
 * KHÔNG dùng chỉ số mảng: xoá dòng 1 thì dòng 2 tụt lên chỉ số 1 và mang theo state của
 * dòng vừa xoá (giá trị ô input, ô đang focus).
 */
type DongHang = {
  key: string;
  /** `Course.id` hoặc `Product.id` tuỳ loại đơn. */
  refId: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  /** SR.QD.219 Điều 5 — chỉ có nghĩa với đơn KHOÁ HỌC. */
  coachFormat: CoachFormat;
  soBuoiMua: number | null;
  /** Dòng này mua cho CON NÀO. null = chưa chọn / đơn sản phẩm. */
  studentId: string | null;
  /**
   * Dòng này mua cho con nào KHI CON ĐÓ CHƯA CÓ HỒ SƠ `Student` [16/09/2026].
   *
   * Chủ dự án: *"lead này đa số là lead chưa chốt nên chưa phải là học viên nên sẽ lấy
   * thông tin con của PH lead đó chứ"*. Đo: 121/125 lead không có `Student` nào khớp SĐT,
   * còn `LeadChild` có 130 dòng / 104 lead.
   *
   * `studentId` và `leadChildId` LOẠI TRỪ NHAU: một dòng trỏ về một đứa trẻ, và đứa trẻ đó
   * hoặc đã có hồ sơ hoặc chưa. Giữ cả hai cùng lúc là mở đường cho hai câu trả lời khác
   * nhau cho cùng một câu hỏi "tiền này của ai".
   */
  leadChildId: string | null;
  /** Tên con lead — chỉ để hiển thị lại sau khi chọn; server tự tra tên từ `leadChildId`. */
  tenConLead: string | null;
  /**
   * CÁC KHOẢN GIẢM CỦA RIÊNG DÒNG NÀY (15/09/2026 — "làm flex").
   *
   * Ưu đãi thật bám vào MỘT em (anh chị em học cùng, học bổng) và CHỒNG LÊN NHAU — một
   * em có thể vừa được ưu đãi anh chị em vừa được ưu đãi đóng sớm. Mảng rỗng = không
   * giảm; không cần cờ bật/tắt riêng.
   */
  giam: KhaiGiam[];
};

/**
 * Bộ đếm sinh `key` cho dòng — CHỈ dùng làm khoá đối chiếu của React.
 *
 * ⚠️ TUYỆT ĐỐI KHÔNG đưa `key` này vào thuộc tính DOM nào (`name`, `id`, `htmlFor`…).
 * Nó là biến ở TẦNG MODULE, nên server và client giữ HAI bộ đếm khác nhau: tiến trình
 * dev server sống lâu nên nó đã đếm tới `d3` khi lượt kết xuất trên máy khách mới ở
 * `d1`. Đo thật 15/09/2026 trên `/orders/new`:
 *
 *     + <input type="hidden" name="unitPrice-d3">   (client)
 *     - <input type="hidden" name="unitPrice-d1">   (server)
 *     Error: Hydration failed because the server rendered HTML didn't match the client.
 *
 * React vứt cả cây của server và dựng lại ở client — không có lỗi nào hiện ra cho
 * người dùng, chỉ có một trang chậm hơn và một cảnh báo trong console. Vì thế tên
 * trường trong DOM nay suy từ CHỈ SỐ dòng (`stt`), thứ hai bên đều tính ra như nhau.
 */
let demKey = 0;
const dongMoi = (): DongHang => ({
  key: `d${(demKey += 1)}`,
  refId: "",
  itemName: "",
  quantity: 1,
  unitPrice: 0,
  coachFormat: "GROUP",
  soBuoiMua: null,
  studentId: null,
  leadChildId: null,
  tenConLead: null,
  giam: [],
});

// O1 — selector loại đơn chỉ 2 lựa chọn (combo là course teachable → nằm trong "Khoá học").
type UiOrderType = Extract<OrderType, "COURSE" | "PRODUCT">;

const NO_CENTER = "NONE";

/**
 * `KhaiGiam.voucherId` khi khoản ĐANG ở chế độ "theo chương trình" nhưng CHƯA chọn mã.
 *
 * Phải khác `null` (= sale tự gõ) và khác một id thật: ba trạng thái, ba giá trị. Gộp
 * "chưa chọn" vào `null` là bấm nút "Theo chương trình" xong giao diện nhảy ngược về
 * chế độ gõ tay — và cổng lưu sẽ để lọt một khoản 0đ không ai giải trình.
 */
const CHUA_CHON_MA = "";
// N-2 — mốc "chưa quy được về con" trong ô chọn học sinh. Tách hằng riêng khỏi
// NO_CENTER dù cùng giá trị: hai ô khác nhau, đổi một cái không được kéo cái kia.
const NO_CHILD = "NONE";

/**
 * Đơn CHƯA TỒN TẠI ⇒ không đợt nào có thể đã nhận tiền.
 *
 * Khối nhập dùng chung khoá ô số tiền theo `PaymentAllocation` (cổng A6). Ở đây Map rỗng
 * là một khẳng định, không phải một chỗ trống chưa điền: không có `Order` thì không có
 * `PaymentRequest`, nên không có gì để khoá. Đặt ở mức module để mỗi lượt render không
 * sinh một Map mới.
 */
const KHONG_CO_TIEN_DA_ROT: Map<number, number> = new Map();

export function OrderCreateForm({
  paymentMethods,
  courses,
  products,
  centers,
  students,
  conLeadBanDau,
  maKhuyenMai,
  maCoSoTheoCenter,
  provinces,
  leadId = null,
  leadChildren = [],
  defaultCustomer,
  defaultCenterId,
  lockCenter = false,
  tranPhanTram,
}: {
  paymentMethods: PM[];
  courses: Course[];
  products: ProductOption[];
  centers: Center[];
  students: StudentOption[];
  /**
   * CON KHAI TRONG LEAD mà trang được mở kèm (`/orders/new?leadId=…`) [16/09/2026].
   *
   * Prop BẮT BUỘC, không mặc định `[]` (luật 7): mặc định rỗng làm ca chiếm 96,8% lặng
   * lẽ biến mất mà không lời gọi nào bị `tsc` chỉ ra. Không mở từ lead thì truyền `[]`
   * một cách CÓ Ý THỨC.
   *
   * ⚠️ Đây chỉ là giá trị BAN ĐẦU. Người bán gõ SĐT rồi chọn một lead khác từ gợi ý thì
   * danh sách con phải đổi theo — nên form giữ nó trong state (`conLead`), không đọc
   * thẳng prop này ở chỗ dựng ô chọn.
   */
  conLeadBanDau: ConLead[];
  /** Mã khuyến mãi còn đáng bày — lọc THÔ ở RSC (`docMaChoDon`), lọc tinh ở client. */
  maKhuyenMai: MaApDung[];
  /** `Center.id` → MÃ OrgUnit, để suy `phamViCoSo` từ cơ sở ĐANG CHỌN trên form. */
  maCoSoTheoCenter: Record<string, string>;
  // O2 — danh sách tỉnh/thành (2 cấp 2025) load từ server (vietnam-address-data).
  provinces: ComboboxOption[];
  // convert-v2 (R7-05/06): khi tạo đơn TỪ một lead, gắn leadId để convert sau tìm
  // được Payment RECORDED qua order.leadId. null = đơn walk-in thông thường.
  leadId?: string | null;
  // N-2 · quyết định B4 — con của phiếu, để quy đơn về đúng một đứa.
  leadChildren?: { id: string; fullName: string }[];
  defaultCustomer?: { name?: string; phone?: string; email?: string };
  defaultCenterId?: string | null;
  /**
   * KHOÁ ô "Trung tâm" — bật cho người KHÔNG có `orders:manage` (Sale cơ sở).
   *
   * ⚠️ Đây là sửa một chỗ NÓI DỐI, không phải thêm ràng buộc mới. Cổng server
   * `createOrderManualAction` vốn đã ép `data.centerId = guard.enforcedCenterId` (cơ sở
   * của lead) cho nhánh không có `orders:manage` — nghĩa là Sale đổi ô này thì giá trị
   * họ chọn bị VỨT IM LẶNG. Đơn vẫn tạo ra, nhưng ở cơ sở khác cái họ vừa chọn, và cả
   * danh sách phương thức thanh toán họ vừa cân nhắc cũng thành sai. Khoá ô lại để màn
   * hình nói đúng thứ hệ thống sẽ làm.
   */
  lockCenter?: boolean;
  /**
   * Trần % giảm của MỘT khoản — `orders.maxDiscountPercent` đọc ở RSC.
   *
   * Truyền xuống thay vì để form đoán: client không đọc được `getSetting`, và một hằng
   * cứng ở client là con số thứ hai sống song song với tham số vận hành. Người vận hành
   * hạ trần mà form vẫn cho gõ tới 50 là sale gõ xong rồi mới bị server từ chối.
   */
  tranPhanTram: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [orderType, setOrderType] = useState<UiOrderType>("COURSE");
  const [orderStatus, setOrderStatus] = useState<OrderStatus>("PENDING_PAYMENT");
  const [paymentMethodId, setPaymentMethodId] = useState<string>("");

  const [customer, setCustomer] = useState({
    name: defaultCustomer?.name ?? "",
    phone: defaultCustomer?.phone ?? "",
    email: defaultCustomer?.email ?? "",
    cccd: "",
    address: "",
  });
  /**
   * Con khai trong lead ĐANG gắn với form. Khởi từ prop, nhưng phải là STATE vì người bán
   * có thể gõ SĐT rồi chọn một lead KHÁC từ gợi ý — lúc đó danh sách con phải đổi theo.
   */
  const [conLead, setConLead] = useState<ConLead[]>(conLeadBanDau);
  // O2 — tỉnh/phường qua combobox; lưu id, map sang tên khi submit.
  const [provinceId, setProvinceId] = useState<string | null>(null);
  const [wardId, setWardId] = useState<string | null>(null);
  const [wardOptions, setWardOptions] = useState<ComboboxOption[]>([]);
  const [wardLoading, setWardLoading] = useState(false);
  const [centerId, setCenterId] = useState<string>(defaultCenterId ?? NO_CENTER);

  /**
   * MÃ OrgUnit của cơ sở ĐANG CHỌN — đầu vào phạm vi cho bộ chọn mã khuyến mãi.
   *
   * ⚠️ Chưa chọn cơ sở ⇒ RỖNG, và rỗng là FAIL-CLOSED: `apDungTrongPhamVi` chỉ trả true
   * khi chính sách không khai cơ sở nào. Nghĩa là chương trình riêng của một cơ sở sẽ
   * KHÔNG hiện cho tới khi sale chọn cơ sở — đúng thứ ta muốn, vì lúc đó chưa ai biết
   * đơn thuộc về đâu. Suy bừa ra "áp mọi nơi" là phát ưu đãi của CS1 cho khách CS2.
   */
  const phamViCoSo = useMemo(() => {
    if (centerId === NO_CENTER) return [];
    const ma = maCoSoTheoCenter[centerId];
    return ma ? [ma] : [];
  }, [centerId, maCoSoTheoCenter]);
  // N-2 — phiếu ĐÚNG 1 con thì chọn sẵn (không có lựa chọn nào khác); phiếu nhiều con để
  // trống, ép người tạo đơn chọn thay vì hệ thống đoán hộ. Server suy lại y hệt luật này
  // (`resolveOrderLeadChildId`) nên bỏ qua form vẫn ra cùng kết quả.
  const [leadChildId, setLeadChildId] = useState<string>(
    leadChildren.length === 1 ? leadChildren[0]!.id : NO_CHILD,
  );

  // NHIỀU dòng hàng — xem chú thích ở `DongHang`.
  //
  // ── CHỌN SẴN CON CỦA PHỤ HUYNH [15/09/2026] ────────────────────────────────
  // Chủ dự án: *"ở dưới khoá học thì tên học viên được chọn sẵn 1 trong số con của PH
  // luôn"*.
  //
  // ⚠️ PHẢI LÀM Ở ĐÂY, không chỉ trong `chonLead`. Trước bản này việc chọn sẵn chỉ chạy
  // khi người bán GÕ SĐT rồi bấm một lead trong danh sách gợi ý — còn đường CHÍNH mà chủ
  // dự án mô tả ("bấm từ trang lead sang trang tạo đơn hàng") thì `leadId` có sẵn trên
  // URL nên `daChonLead` bật ngay từ đầu và `chonLead` KHÔNG BAO GIỜ chạy.
  //
  // Đo thật trên `/orders/new?leadId=…` trước bản vá: tên PH và SĐT điền sẵn, ô lọc
  // hiện đúng "Đang lọc theo SĐT 0930000001 — 1 con", mà ô Học viên vẫn RỖNG. Người bán
  // vẫn phải tự mở danh sách và chọn đúng cái tên duy nhất trong đó.
  const [dong, setDong] = useState<DongHang[]>(() => [
    (() => {
      // Dòng đầu chọn sẵn: ưu tiên HỒ SƠ HỌC VIÊN, rơi về CON LEAD nếu chưa em nào có hồ
      // sơ. Nhánh thứ hai là ca chiếm 96,8% khi mở trang từ `/orders/new?leadId=…`.
      const hv = conChonSan(students, defaultCustomer?.phone);
      if (hv) return { ...dongMoi(), studentId: hv };
      const cl = conLeadBanDau[0];
      return cl
        ? { ...dongMoi(), leadChildId: cl.id, tenConLead: cl.fullName }
        : dongMoi();
    })(),
  ]);

  function suaDong(key: string, thayDoi: Partial<DongHang>) {
    setDong((cu) => cu.map((d) => (d.key === key ? { ...d, ...thayDoi } : d)));
  }
  function themDong() {
    setDong((cu) => [...cu, dongMoi()]);
  }
  function xoaDong(key: string) {
    // Luôn chừa lại ÍT NHẤT một dòng: đơn 0 dòng không lưu được (server đòi min 1), và
    // một form trống trơn không nói cho người dùng biết phải làm gì tiếp.
    setDong((cu) => (cu.length <= 1 ? cu : cu.filter((d) => d.key !== key)));
  }

  // ⚠️ KHÔNG còn state giảm giá CẤP ĐƠN [15/09/2026]. Giảm giá nay là thuộc tính của
  // từng `DongHang` — xem `giamKieu`/`giamGiaTri`/`giamLyDo`. Server cũng đã TỪ CHỐI
  // cho ra tiếng nếu ai đó gửi `discountAmount` ở cấp đơn (lib/validators/order.ts).

  // ── SĐT LÀ NEO (15/09/2026) ────────────────────────────────────────────────
  //
  // Chủ dự án: nhập SĐT ⇒ thấy lead của SĐT đó ⇒ chọn ⇒ tự điền tên PH ⇒ ô Học viên
  // ở dưới chỉ còn con của PH đó và chọn sẵn một đứa.
  //
  // Tra THEO YÊU CẦU chứ không nạp cả bảng lead vào form (xem chú thích ở
  // `timPhuHuynhTheoSdtAction`). Danh sách con thì lọc từ `students` đã nạp sẵn —
  // nó vốn đã mang `parentPhone`.
  type LeadGoiY = {
    id: string;
    parentName: string;
    phone: string;
    email: string | null;
    centerId: string | null;
    /** Con lead khai — CÓ `id` từ 16/09/2026 để dòng đơn lưu được `leadChildId`. */
    conKhai: ConLead[];
  };
  const [leadGoiY, setLeadGoiY] = useState<LeadGoiY[]>([]);
  const [dangTraSdt, setDangTraSdt] = useState(false);
  /**
   * SĐT (chỉ chữ số) mà kết quả hiện tại thuộc về — `null` là chưa tra lần nào.
   *
   * ⚠️ Cần cái này để phân biệt HAI kiểu "danh sách rỗng": chưa tra (đang gõ dở) và đã tra
   * rồi mà không có lead. Suy từ `leadGoiY.length === 0` thì hai ca đó giống hệt nhau, và
   * đó chính là lý do ô SĐT im lặng trước bản này.
   */
  const [sdtDaTra, setSdtDaTra] = useState<string | null>(null);
  /** Đã chọn một gợi ý rồi thì thôi bày bảng ra nữa, kẻo nó che ô bên dưới. */
  const [daChonLead, setDaChonLead] = useState(leadId != null);

  // Notes
  const [customerNote, setCustomerNote] = useState("");
  const [internalNote, setInternalNote] = useState("");

  // Hai chiều lọc, dùng CHUNG luật với Server Action (lib/payments/method-scope.ts):
  // loại đơn (cờ canBuy*) và CƠ SỞ. Lệch luật giữa dropdown và cổng server là người
  // dùng chọn được một thứ rồi bấm Lưu mới bị từ chối.
  const orderCenterId = centerId === NO_CENTER ? null : centerId;
  const availablePMs = useMemo(() => {
    return paymentMethods.filter(
      (pm) =>
        methodServesCenter(pm, orderCenterId) && methodAllowsOrderType(pm, orderType),
    );
  }, [paymentMethods, orderType, orderCenterId]);

  // Đổi cơ sở / loại đơn mà giữ nguyên lựa chọn cũ là để lại một `paymentMethodId`
  // KHÔNG còn hợp lệ trong state — trigger vẫn hiện tên phương thức cũ (Base UI in value
  // thô), người dùng tưởng vẫn ổn, tới lúc Lưu mới ăn từ chối. Xoá ngay khi nó rớt khỏi
  // danh sách. `useEffect` ở đây là ĐỒNG BỘ STATE THEO STATE, không phải fetch dữ liệu —
  // không phạm luật "không useEffect để fetch".
  useEffect(() => {
    if (paymentMethodId && !availablePMs.some((pm) => pm.id === paymentMethodId)) {
      setPaymentMethodId("");
      return;
    }
    // TỰ NHẬN phương thức của cơ sở đang chọn khi chỉ có ĐÚNG MỘT lựa chọn hợp lệ
    // (chốt 31/08/2026: "đơn ở cơ sở nào thì tự nhận pttt ở cs đó"). Đây là ca thường
    // gặp nhất — cơ sở khai một phương thức chuyển khoản riêng, còn lại là dùng chung
    // vốn hay bị tắt. Nhiều hơn một thì vẫn để người dùng chọn: đoán hộ chỗ tiền đi
    // đường nào là việc không nên tự làm.
    if (!paymentMethodId && availablePMs.length === 1) {
      setPaymentMethodId(availablePMs[0]!.id);
    }
  }, [availablePMs, paymentMethodId]);

  // Base UI <Select.Value> hiển thị value THÔ (mã/ID) → phải truyền `items` (map
  // value→nhãn) cho trigger hiện đúng tiếng Việt (item 3 — fix Radix→Base UI regression).
  const ORDER_TYPE_ITEMS: Record<UiOrderType, string> = {
    COURSE: "Khoá học",
    PRODUCT: "Sản phẩm",
  };
  const ORDER_STATUS_ITEMS = { DRAFT: "Nháp", PENDING_PAYMENT: "Chờ thanh toán", CONFIRMED: "Đã xác nhận đơn" };
  const pmItems = useMemo(
    () => Object.fromEntries(availablePMs.map((pm) => [pm.id, pm.name])),
    [availablePMs],
  );
  const centerItems: Record<string, string> = useMemo(
    () => ({ [NO_CENTER]: "— Không gán —", ...Object.fromEntries(centers.map((c) => [c.id, c.name])) }),
    [centers],
  );

  /** Chọn khoá/sản phẩm cho MỘT dòng — tự điền tên + đơn giá + số buổi mặc định. */
  function chonMatHang(key: string, refId: string) {
    if (orderType === "COURSE") {
      const c = courses.find((x) => x.id === refId);
      suaDong(key, {
        refId,
        itemName: c?.name ?? "",
        unitPrice: c?.price ?? 0,
        // Số buổi mua mặc định = ĐỦ KHOÁ. Khoá thiếu `totalSessions` thì để null — ô
        // trống buộc người bán gõ, còn điền 0 là bịa ra một con số rồi nhân với tiền.
        soBuoiMua: c?.totalSessions ?? null,
      });
      return;
    }
    const pd = products.find((x) => x.id === refId);
    suaDong(key, {
      refId,
      itemName: pd ? `${pd.name} (${pd.sku})` : "",
      unitPrice: pd?.salePrice ?? 0,
    });
  }

  // O2 — đổi tỉnh: reset phường + lazy-load danh sách phường theo tỉnh.
  function handleProvinceChange(nextProvinceId: string | null) {
    setProvinceId(nextProvinceId);
    setWardId(null);
    setWardOptions([]);
    if (!nextProvinceId) return;
    setWardLoading(true);
    void import("vietnam-address-data")
      .then(({ getWardsByProvince }) => {
        setWardOptions(
          getWardsByProvince(nextProvinceId).map((w) => ({
            value: w.id,
            label: w.name,
          })),
        );
      })
      .finally(() => setWardLoading(false));
  }

  // Tiền của đơn suy từ CÁC DÒNG, bằng CHÍNH hàm server dùng (`lib/orders/giam-gia-dong.ts`).
  // Hai bản cài đặt = hai con số, và con số người bán đọc trên màn hình sẽ khác con số
  // vào sổ — đúng loại sai lệch mà không lỗi nào báo.
  const tien = useMemo(
    () =>
      tienDon(
        dong.map((d) => ({
          unitPrice: d.unitPrice,
          quantity: d.quantity,
          giam: d.giam,
        })),
        { tranPhanTram },
      ),
    [dong, tranPhanTram],
  );
  const subtotal = tien.tamTinh;
  const totalAmount = tien.tongDon;

  // ── KẾ HOẠCH THANH TOÁN NGAY TRÊN FORM TẠO ĐƠN [15/09/2026] ─────────────────
  //
  // Chủ dự án: *"lấy số tiền cần thanh toán ở phần khoá học sau khi hoàn thành các tuỳ
  // chọn của đơn hàng khoá học luôn"* và *"khi sale chưa chọn khoá học thì khối kế hoạch
  // hiện nhưng khoá"* — số tiền là `totalAmount`, tức TỔNG ĐƠN SAU GIẢM GIÁ, đúng con số
  // thẻ "Tóm tắt" bên phải đang in và đúng con số server sẽ lưu vào `Order.totalAmount`.
  //
  // `theoTong: true` ⇒ đổi khoá học / số lượng / một khoản giảm giá là kế hoạch tự chia
  // lại. Không có nó thì Σ các đợt giữ số cũ, lệch tổng, và nút "Tạo đơn" bị chặn vì một
  // lỗi người bán không gây ra.
  const khoaKeHoach = khoaKeHoachDonMoi(totalAmount);
  const keHoach = useKeHoachDot({
    totalAmount,
    dots0: () =>
      // Mốc "hôm nay" đọc ở ĐÂY — `dotsChoDonMoi` cố ý không tự đọc đồng hồ (luật 19).
      dotsChoDonMoi(totalAmount, new Date()).map((d) => ({
        amount: d.amount,
        daThu: d.daThu,
        dueDate: d.dueDate.toISOString().slice(0, 10),
        reminderDays: d.reminderDays,
        laCoc: false,
      })),
    daRotTheoDot: KHONG_CO_TIEN_DA_ROT,
    theoTong: true,
  });

  // ── THANH TOÁN THEO HỌC PHẦN [28/09/2026] ───────────────────────────────────
  //
  // Chủ dự án: *"thanh toán theo đúng số học phần"*, phạm vi CHỈ khoá 48 buổi (sata3→7).
  //
  // ⚠️ GỢI Ý, KHÔNG ÉP. Sale vẫn gõ số đợt khác được — cổng duyệt (`xetDuyetDon`) mới là
  // chỗ chặn. Ép ở đây là biến một quy ước thành một cái khoá, và mọi ca ngoại lệ có thật
  // sẽ phải đi vòng qua form thay vì đi qua người duyệt.
  //
  // ⚠️ Chỉ gợi ý khi MỌI dòng khoá học đồng ý một số học phần — xem `goiYKeHoachDon`.
  const dongKhoaHoc = useMemo(
    () =>
      orderType !== "COURSE"
        ? []
        : dong
            .filter((d) => d.refId)
            .map((d) => ({
              tongSoBuoiKhoa: courses.find((c) => c.id === d.refId)?.totalSessions ?? null,
              soBuoiMua: d.soBuoiMua,
            })),
    [orderType, dong, courses],
  );

  const goiYHocPhan = useMemo(
    () => goiYKeHoachDon(dongKhoaHoc, totalAmount),
    [dongKhoaHoc, totalAmount],
  );

  // ⚠️ `lechHP` ĐÃ GỠ [28/09/2026] cùng với `lechHocPhan`. Chú thích cũ ở đây khai
  // *"cùng con số mà `xetDuyetDon` đọc, nên câu cảnh báo ở đây và quyết định duyệt ở
  // server không đá nhau"* — câu ấy SAI: `xetDuyetDon` so số đợt với TRẦN, không so với
  // số học phần, nên nó chưa bao giờ đọc con số này. Số đợt là tự do.

  /**
   * SỐ BUỔI LỆCH MỐC HỌC PHẦN — cảnh báo THẬT, nói TRƯỚC khi bấm Lưu [28/09/2026].
   *
   * Chủ dự án: *"nếu các khoá sata 3,4,5,6,7 có 48 buổi có 4 học phần, nếu lệch buổi của
   * từng học phần thì lưu ý lên là phải qua quản lý duyệt cho sale biết"*.
   *
   * Đây LÀ luật thật (khác hẳn "số đợt phải bằng số học phần" vừa gỡ): `xetDuyetDon` đọc
   * `soBuoiTheoDong` và bật cờ `phan.soBuoi` ⇒ đơn vào hàng chờ, sale KHÔNG xuất được QR.
   *
   * 🔴 ĐÂY LÀ LỖ ĐÃ GHI TRONG CLAUDE.md, nay bịt: *"form tạo đơn KHÔNG gọi `xetDuyetDon`,
   * nên sale chỉ biết đơn phải chờ duyệt SAU khi bấm Lưu"* — với khách đang ngồi trước mặt.
   *
   * ⚠️ Câu chữ lấy từ `lyDoSoBuoi`, KHÔNG ghép lại ở đây: nó phải in ĐÚNG con số mà cổng
   * đem ra xét (sau khi suy mặc định "không khai = mua đủ khoá"), mà con số ấy chỉ tồn tại
   * bên trong phép xét. Ghép tay là màn hình nói một đằng, server chặn một nẻo.
   */
  const canhBaoSoBuoi = useMemo(() => {
    if (orderType !== "COURSE") return [];
    return dong
      .filter((d) => d.refId)
      .map((d, i) => {
        const x = xetSoBuoiDong({
          tongSoBuoiKhoa: courses.find((c) => c.id === d.refId)?.totalSessions ?? null,
          soBuoiMua: d.soBuoiMua,
        });
        return lyDoSoBuoi(x, d.itemName?.trim() || `Dòng ${i + 1}`);
      })
      .filter((c): c is string => c !== null);
  }, [orderType, dong, courses]);

  // Debounce 350ms: gõ 10 chữ số mà không chờ là 10 lượt gọi server cho một lần nhập.
  // Huỷ theo cờ `boQua` chứ không huỷ request: lượt trả về muộn của một chuỗi CŨ hơn
  // sẽ ghi đè kết quả của chuỗi mới nếu không chặn (đua bàn phím).
  useEffect(() => {
    if (daChonLead) return;
    const so = customer.phone.replace(/\D/g, "");
    if (so.length < SO_CHU_SO_TOI_THIEU_TRA_LEAD) {
      setLeadGoiY([]);
      // Gõ ngắn lại ⇒ kết quả cũ không còn thuộc về số đang gõ nữa.
      setSdtDaTra(null);
      return;
    }
    let boQua = false;
    setDangTraSdt(true);
    const t = setTimeout(() => {
      timPhuHuynhTheoSdtAction(so)
        .then((r) => {
          if (boQua) return;
          setLeadGoiY(r.ok ? (r.leads ?? []) : []);
          // Ghi lại KẾT QUẢ NÀY THUỘC VỀ SỐ NÀO — xem chú thích ở `sdtDaTra`.
          setSdtDaTra(so);
        })
        .finally(() => {
          if (!boQua) setDangTraSdt(false);
        });
    }, 350);
    return () => {
      boQua = true;
      clearTimeout(t);
    };
  }, [customer.phone, daChonLead]);

  /**
   * Chọn một lead gợi ý — điền tên/email/cơ sở, rồi CHỌN SẴN một con vào dòng 1.
   *
   * Chỉ chọn sẵn khi PH có ĐÚNG hồ sơ học viên trong tầm nhìn; con mà lead khai nhưng
   * chưa có `Student` thì KHÔNG chọn được (ô này lưu `Student.id`) — hiện thành lời
   * nhắc thay vì một tuỳ chọn bấm vào không ăn (affordance phải nói thật).
   */
  /**
   * CÂU NHẮC DƯỚI Ô SĐT — trả lời đúng câu hỏi của chủ dự án 15/09:
   * *"đang nhập ở sđt thì lọc theo sđt chứ sao lại lọc xuống dưới khoá học → học viên?"*
   *
   * Việc tra lead vẫn chạy; cái hỏng là nhánh RỖNG không vẽ gì, nên khi SĐT không có lead
   * thì ô này im, còn phản ứng duy nhất nhìn thấy được lại nằm tận dưới khối Khoá học.
   * Nay ô SĐT tự nói kết quả của nó, và khi SĐT có hồ sơ học viên thì CHỈ ĐƯỜNG xuống đó.
   *
   * Luật ở `lib/orders/goi-y-sdt.ts` (thuần, có test + đã cấy lỗi): bốn trạng thái phải
   * loại trừ nhau, viết thẳng vào JSX là có ngày hiện cả spinner lẫn "không tìm thấy".
   */
  const soChuSoSdt = customer.phone.replace(/\D/g, "").length;
  const nhacSdt = daChonLead
    ? null
    : nhacTraLead({
        soChuSo: soChuSoSdt,
        dangTra: dangTraSdt,
        daTraXong: sdtDaTra === customer.phone.replace(/\D/g, ""),
        soLead: leadGoiY.length,
        // Cùng hàm mà ô Học viên dùng để lọc — câu nhắc không được hứa một con số khác
        // với con số người bán sẽ thấy ở dưới.
        soCon: conCuaPhuHuynh(students, customer.phone).length,
      });

  function chonLead(l: LeadGoiY) {
    setCustomer((c) => ({
      ...c,
      name: l.parentName || c.name,
      phone: nationalPhone(l.phone) ?? l.phone,
      email: l.email ?? c.email,
    }));
    if (l.centerId && !lockCenter) setCenterId(l.centerId);
    setDaChonLead(true);
    setLeadGoiY([]);
    // Con của lead vừa chọn THAY THẾ danh sách đang có — người bán đổi sang lead khác thì
    // ô chọn phải đổi theo, giữ lại con của lead cũ là bày ra con nhà khác.
    setConLead(l.conKhai);

    // Cùng LUẬT với lúc mở trang từ lead và với ô lọc bên dưới — `conChonSan`. Ba bản
    // chép tay của cùng một phép so SĐT là ba cách lệch nhau, và lệch ở đây nghĩa là ô
    // lọc bày ra một tập còn ô chọn sẵn trỏ vào em ngoài tập đó.
    const chonSan = conChonSan(students, l.phone);
    if (chonSan) {
      setDong((cu) =>
        cu.map((d, i) => (i === 0 && !d.studentId ? { ...d, studentId: chonSan } : d)),
      );
      return;
    }
    // ⚠️ KHÔNG có hồ sơ học viên nào ⇒ chọn sẵn CON LEAD đầu tiên [16/09/2026].
    //
    // Đây là ca chiếm 96,8% (121/125 lead). Trước bản này nhánh đó rơi xuống "không chọn
    // sẵn gì", và vì ô chọn cũng chỉ biết bảng `Student` nên người bán không có đường nào
    // chỉ ra đứa trẻ — dù tên con đang hiện ngay trên dòng gợi ý lead.
    const conDau = l.conKhai[0];
    if (conDau) {
      setDong((cu) =>
        cu.map((d, i) =>
          i === 0 && !d.studentId && !d.leadChildId
            ? { ...d, leadChildId: conDau.id, tenConLead: conDau.fullName }
            : d,
        ),
      );
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const chuaChon = dong.findIndex((d) => !d.refId || !d.itemName);
    if (chuaChon >= 0) {
      toast.error(`Dòng ${chuaChon + 1}: chưa chọn ${orderType === "COURSE" ? "khoá học" : "sản phẩm"}`);
      return;
    }
    const giaXau = dong.findIndex((d) => d.unitPrice <= 0);
    if (giaXau >= 0) {
      toast.error(`Dòng ${giaXau + 1}: đơn giá phải lớn hơn 0`);
      return;
    }
    // Đơn MỘT dòng cho khách vãng lai (con chưa có hồ sơ) để trống ô học viên là
    // đúng; đơn nhiều con mà còn dòng trống thì không. Luật ở `hoc-vien-dong-don.ts`
    // — dùng chung với `createOrderManualAction`, để cái hiện ở đây và cái server
    // chấp nhận không thể lệch nhau.
    if (thieuHocVienODong(dong)) {
      toast.error("Đơn có nhiều học viên — mỗi dòng phải chọn rõ là của con nào");
      return;
    }
    // Cơ chế DUYỆT giảm giá đã gỡ 14/09 — GIẢI TRÌNH thì giữ, và nay nó theo DÒNG.
    // Cùng hàm với server (`dongThieuGiaiTrinh`), nên không thể lệch nhau.
    // Vượt trần % xét TRƯỚC giải trình: bắt người bán viết lý do cho một khoản rồi mới
    // báo khoản đó không hợp lệ là hai lần làm mất việc của họ.
    const vuot = khoanVuotTran(dong, tranPhanTram);
    if (vuot.length > 0) {
      toast.error(loiVuotTran(vuot, tranPhanTram));
      return;
    }
    const thieuLyDo = dongThieuGiaiTrinh(dong, tranPhanTram);
    if (thieuLyDo.length > 0) {
      toast.error(loiThieuGiaiTrinh(thieuLyDo));
      return;
    }
    // AUTH-SĐT P5 — email khách hàng KHÔNG còn bắt buộc (xác nhận/nhắc nợ đi
    // Zalo theo SĐT). SĐT đã được validator `phoneVn` bắt buộc ở server.
    if (!paymentMethodId) {
      toast.error("Vui lòng chọn phương thức thanh toán");
      return;
    }
    // KẾ HOẠCH phải khớp tổng đơn TRƯỚC khi gửi. Cổng thật ở server (`kiemKeHoachDot` so
    // với `Order.totalAmount` vừa tính), nhưng để nó báo thì đơn đã được TẠO RỒI và người
    // bán nhận một cảnh báo "đơn xong, kế hoạch chưa" — đúng thứ nói ở đây là tránh được.
    if (khoaKeHoach == null) {
      if (keHoach.lech !== 0) {
        toast.error(
          `Kế hoạch thanh toán đang lệch ${Math.abs(keHoach.lech).toLocaleString("vi-VN")}đ so với tổng đơn — sửa số tiền các đợt`,
        );
        return;
      }
      if (keHoach.thieuHan >= 0) {
        toast.error(`Kế hoạch: đợt ${keHoach.thieuHan + 1} chưa thu — chọn ngày hẹn đóng`);
        return;
      }
    }

    // ⚠️ KHOẢN ĐANG Ở CHẾ ĐỘ "THEO CHƯƠNG TRÌNH" MÀ CHƯA CHỌN MÃ ⇒ CHẶN, ĐỪNG BỎ QUA.
    //
    // Payload lọc `k.giaTri > 0`, mà khoản chưa chọn mã có `giaTri = 0` ⇒ nó bị vứt IM
    // LẶNG: sale bấm "Theo chương trình", quên chọn, bấm Lưu, đơn lưu thành công với giá
    // NGUYÊN — và không gì nói cho họ biết ưu đãi vừa bốc hơi. Server có cổng từ chối
    // chuỗi rỗng, nhưng nó không bao giờ được gọi tới vì khoản đã rụng trước khi gửi.
    {
      const thieu: string[] = [];
      dong.forEach((d, i) =>
        d.giam.forEach((k, j) => {
          if (k.voucherId === "") thieu.push(`dòng ${i + 1} (khoản ${j + 1})`);
        }),
      );
      if (thieu.length > 0) {
        toast.error(`Chưa chọn chương trình khuyến mãi ở ${thieu.join(", ")}`);
        return;
      }
    }

    const itemTypeMap: Record<UiOrderType, OrderItemType> = {
      COURSE: "COURSE_ENROLLMENT",
      PRODUCT: "PRODUCT",
    };
    const itemType: OrderItemType = itemTypeMap[orderType];

    const items = dong.map((d) => ({
      type: itemType,
      itemName: d.itemName,
      quantity: d.quantity,
      unitPrice: d.unitPrice,
      packageId: null,
      examAttemptId: null,
      productId: orderType === "PRODUCT" ? d.refId : null,
      studentId: d.studentId,
      // Con lead chưa chốt (loại trừ với `studentId` — validator chặn ca khai cả hai).
      leadChildId: d.leadChildId,
      // CÁC KHOẢN giảm của dòng, đúng thứ tự người bán gõ. Gửi Ý ĐỊNH (kiểu + số đã
      // gõ + lý do); server tính lại số tiền thật và kẹp theo tạm tính của dòng.
      discounts: d.giam
        .filter((k) => k.giaTri > 0)
        .map((k) => ({
          kieu: k.kieu,
          giaTri: k.giaTri,
          lyDo: k.lyDo?.trim() || null,
          // PHIÊN E — NHÃN loại ưu đãi. Không chọn ⇒ `null`, và đó là hợp lệ.
          loai: k.loai ?? null,
          /**
           * 🔴 THIẾU DÒNG NÀY = TÍNH NĂNG CÂM HOÀN TOÀN [sửa 29/09/2026].
           *
           * Payload dựng bằng danh sách trường TƯỜNG MINH, nên một trường mới không tự
           * đi theo — nó rơi mất im lặng. Đo trên đơn thật `ORD-260929-000001`: màn hình
           * hiện đúng "SR.QD.240 · FULL4HP15 −1.584.000đ", `lyDo` vào DB đúng câu tự
           * sinh, **mà `discounts[].voucherId` là `null` và `VoucherRedemption` 0 dòng**.
           *
           * Vì sao KHÓ THẤY: câu `lyDo` do CLIENT tính cũng bằng chữ mà server sẽ tính,
           * nên nhánh "không tìm thấy mã" của server cho ra một bản ghi trông y hệt bản
           * đúng. Chỉ `voucherId` và bảng lượt dùng mới lộ ra — và cả hai đều là thứ
           * không ai nhìn trên màn.
           */
          voucherId: k.voucherId ?? null,
        })),
      // Một khuôn duy nhất cho hình thức lớp, đọc lại bằng `docHinhThucLop` ở server.
      metadata:
        orderType === "COURSE"
          ? veMetadataDongDon({
              courseId: d.refId,
              coachFormat: d.coachFormat,
              soBuoi: d.soBuoiMua,
            })
          : null,
    }));

    const cityName = provinceId
      ? (provinces.find((p) => p.value === provinceId)?.label ?? null)
      : null;
    const wardName = wardId
      ? (wardOptions.find((w) => w.value === wardId)?.label ?? null)
      : null;

    const input = {
      type: orderType as OrderType,
      status: orderStatus,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      customerCccd: customer.cccd || null,
      customerAddress: customer.address || null,
      customerWard: wardName,
      customerCity: cityName,
      // `Order.studentId` chỉ có nghĩa khi cả đơn về ĐÚNG MỘT em — đơn nhiều con để
      // null, và null là giá trị hợp lệ sẵn có (mọi đường đọc đã xử). Ép một em làm
      // "con chính" là dựng một sự thật không có thật. Server TÍNH LẠI bằng chính hàm
      // này và không tin số gửi lên; gửi kèm chỉ để bản nháp/log khớp nhau.
      studentId: studentIdChoDon(dong, null),
      leadId: leadId ?? null,
      // N-2 — null = chưa quy được về con; server kiểm con có thuộc phiếu này không.
      leadChildId: leadChildId === NO_CHILD ? null : leadChildId,
      centerId: centerId === NO_CENTER ? null : centerId,
      paymentMethodId,
      items,
      // ⚠️ KHÔNG gửi giảm giá ở cấp đơn — nó nằm trong `items[]`. Server TỪ CHỐI cho ra
      // tiếng nếu ba trường này > 0, thay vì lặng lẽ bỏ qua và tạo đơn giá nguyên.
      customerNote: customerNote || null,
      internalNote: internalNote || null,
      // KẾ HOẠCH THANH TOÁN gửi KÈM lúc tạo đơn. Khối đang khoá (chưa chọn khoá học) ⇒
      // null, tức đơn ra đời như trước: một phiếu "thu toàn đơn", kế hoạch lập sau ở trang
      // chi tiết. Server KHÔNG tin Σ này — nó kiểm lại với tổng đơn nó tự tính.
      keHoachDot:
        khoaKeHoach != null
          ? null
          : keHoach.dots.map((d) => ({
              amount: d.amount,
              daThu: d.daThu,
              // Đợt đã thu không cần hạn — `dotsGhiTuForm` ở server cũng ép về null, đây
              // chỉ là đừng gửi rác lên.
              dueDate: d.daThu ? null : d.dueDate || null,
              reminderDays: d.daThu ? null : d.reminderDays,
              // Cọc nằm NGOÀI trần số đợt (chủ dự án chốt 22/09: "4 đợt và cọc"), nên
              // server cần cờ này để đếm đúng. Không gửi thì kế hoạch hợp lệ "cọc + 4 đợt"
              // bị đếm thành 5 đợt và rơi vào hàng chờ duyệt — cổng chặn đúng thứ nó được
              // dựng ra để cho qua.
              laCoc: d.laCoc,
            })),
    };

    startTransition(async () => {
      const result = await createOrderManualAction(input);
      if (result.ok) {
        toast.success(`Đã tạo đơn ${result.code}`);
        // Đơn XONG mà kế hoạch thì chưa — nói ra, đừng để người bán tưởng đã xong cả hai.
        // Vẫn chuyển sang trang chi tiết: đó đúng là nơi đặt lại được kế hoạch.
        if (result.canhBaoKeHoach) {
          toast.error(
            `Đơn đã tạo, nhưng CHƯA lưu được kế hoạch thanh toán: ${result.canhBaoKeHoach}. Đặt lại ở khối "Kế hoạch thanh toán" trong trang đơn.`,
            { duration: 12_000 },
          );
        }
        // ⚠️ NÓI NGAY rằng đơn phải chờ duyệt, và NÓI VÌ SAO [25/09/2026].
        //
        // Không có dòng này thì sale bấm Lưu, thấy "Đã tạo đơn", rồi mãi tới lúc bấm
        // "Xuất QR" mới biết đơn đang bị chặn — với khách đang ngồi đợi trước mặt. Câu
        // chữ dựng ở `loiChuaDuyet` (dùng chung), mỗi lý do một gạch đầu dòng, để sale
        // biết SỬA GÌ thì khỏi phải chờ.
        if (result.lyDoChoDuyet.length > 0) {
          toast.warning(loiChuaDuyet(result.lyDoChoDuyet), { duration: 15_000 });
        }
        router.push(`/orders/${result.id}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── HAI CỘT ──────────────────────────────────────────────────────
          Trái là thứ người bán ĐIỀN (đơn · khách · dòng hàng · ghi chú); phải là
          thứ họ ĐỌC và bấm (tổng tiền · giảm giá · nút tạo), dính lại khi cuộn.
          Dưới `lg` xếp chồng đúng thứ tự đó — điền xong mới tới tổng. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-5 lg:space-y-6">
          {/* Order header */}
          <section className="space-y-4 rounded-xl border border-border bg-muted/50 p-5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Thông tin đơn
            </h2>
            {/* 4 ô: Loại đơn · Trạng thái · Trung tâm · Phương thức TT.
                "Trung tâm" DỜI LÊN ĐÂY (trước ở khối Khách hàng, tức DƯỚI ô Phương thức):
                nó quyết định danh sách phương thức, nên để sau là người dùng chọn phương
                thức xong, kéo xuống đổi cơ sở, và lựa chọn vừa chọn bị bỏ mà không hiểu vì
                sao. Cơ sở cũng vốn là thông tin của ĐƠN (doanh thu/công nợ tính về nó),
                không phải thông tin của khách. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label>
                  Loại đơn *
                  <HelpHint>
                    Khoá học = học phí (gói combo cũng nằm ở đây). Sản phẩm = kit/robot bán
                    rời. Chọn sai thì danh sách bên dưới và các hình thức thanh toán sẽ
                    không hiện đúng.
                  </HelpHint>
                </Label>
                <Select
                  items={ORDER_TYPE_ITEMS}
                  value={orderType}
                  onValueChange={(v) => {
                    setOrderType(v as UiOrderType);
                    // Đổi loại đơn thì mọi dòng đang chọn đều vô nghĩa (khoá học ≠ sản
                    // phẩm) — dựng lại MỘT dòng trống thay vì giữ tên/giá cũ trên một
                    // danh mục khác.
                    setDong([dongMoi()]);
                    setPaymentMethodId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="COURSE">Khoá học</SelectItem>
                    <SelectItem value="PRODUCT">Sản phẩm</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>
                  Trạng thái ban đầu
                  <HelpHint>
                    Nháp: lưu tạm để sửa tiếp. Chờ thanh toán: đã chốt với khách, đang đợi
                    thu tiền — chọn cái này cho hầu hết đơn. Đã xác nhận đơn: chỉ chọn khi
                    tiền đã về đủ và kế toán đã đối chiếu.
                  </HelpHint>
                </Label>
                <Select
                  items={ORDER_STATUS_ITEMS}
                  value={orderStatus}
                  onValueChange={(v) => setOrderStatus(v as OrderStatus)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRAFT">Nháp</SelectItem>
                    <SelectItem value="PENDING_PAYMENT">Chờ thanh toán</SelectItem>
                    <SelectItem value="CONFIRMED">Đã xác nhận đơn</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>
                  Trung tâm
                  <HelpHint>
                    {lockCenter ? (
                      <span className="block normal-case tracking-normal">
                        Cơ sở của đơn lấy theo cơ sở của khách bạn đang chốt, không đổi được.
                        Nó quyết định danh sách Phương thức TT bên cạnh và tài khoản ngân hàng
                        mà mã QR trỏ vào. Cần đổi cơ sở thì chuyển cơ sở cho khách trước.
                      </span>
                    ) : (
                      <span className="block normal-case tracking-normal">
                        Cơ sở đứng tên đơn này — doanh thu và công nợ tính về cơ sở đó, và
                        người của cơ sở khác sẽ không thấy đơn. Cơ sở cũng quyết định danh
                        sách Phương thức TT bên cạnh và tài khoản ngân hàng mà mã QR trỏ vào,
                        nên chọn cơ sở TRƯỚC. Chỉ để trống khi đơn thật sự không thuộc cơ sở
                        nào.
                      </span>
                    )}
                  </HelpHint>
                </Label>
                {lockCenter ? (
                  // Ô TĨNH thay vì <Select disabled>: giá trị vẫn phải đọc được rõ ràng, và
                  // `centerId` đã nằm trong state nên submit không đổi gì.
                  <div className="flex h-9 items-center rounded-lg border border-border bg-muted px-3 text-sm text-muted-foreground">
                    {centerItems[centerId] ?? "— Không gán —"}
                  </div>
                ) : (
                  <Select
                    items={centerItems}
                    value={centerId}
                    onValueChange={(v) => setCenterId(v ?? NO_CENTER)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CENTER}>— Không gán —</SelectItem>
                      {centers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>
                  Phương thức TT *
                  <HelpHint>
                    Cách phụ huynh trả tiền cho đơn này. Danh sách lọc theo HAI thứ: loại
                    đơn đang chọn, và CƠ SỞ bên trái — mỗi cơ sở chỉ dùng phương thức của
                    mình cộng các phương thức dùng chung, không thấy phương thức của cơ sở
                    khác. Đổi loại đơn hoặc đổi cơ sở thì lựa chọn cũ tự bỏ, phải chọn lại.
                  </HelpHint>
                </Label>
                <Select
                  items={pmItems}
                  value={paymentMethodId}
                  onValueChange={(v) => setPaymentMethodId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePMs.map((pm) => (
                      <SelectItem key={pm.id} value={pm.id}>
                        {pm.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availablePMs.length === 0 && (
                  // Danh sách rỗng mà không nói gì thì người dùng ngồi bấm mãi không ra.
                  // Ca thật: cơ sở chỉ có phương thức riêng loại "Chuyển khoản" nhưng đang
                  // tạo đơn Sản phẩm, hoặc mọi phương thức của cơ sở đã bị tắt.
                  <p className="text-xs text-state-warning-ink">
                    Cơ sở đang chọn chưa có phương thức thanh toán nào dùng được cho loại đơn
                    này. Khai thêm ở trang Cơ sở → mục Thanh toán.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Customer */}
          <section className="space-y-4 rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Khách hàng
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tên phụ huynh *</Label>
                <Input
                  value={customer.name}
                  onChange={(e) =>
                    setCustomer({ ...customer, name: e.target.value })
                  }
                  required
                  minLength={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label>SĐT *</Label>
                {/* ── SĐT LÀ NEO ────────────────────────────────────────────
                    Gõ ≥6 chữ số ⇒ tra lead THẬT theo SĐT (mọi biến thể 0…/84…) và bày
                    gợi ý. Vẫn là ô TỰ DO: khách walk-in không có lead nào vẫn gõ được
                    và bảng gợi ý chỉ đơn giản trống. Đây là autocomplete, không phải
                    một ô chọn — biến nó thành select là chặn đúng nhóm khách mới. */}
                <div className="relative">
                  <Input
                    value={customer.phone}
                    onChange={(e) => {
                      setCustomer({ ...customer, phone: e.target.value });
                      // Sửa lại SĐT nghĩa là đổi ý ⇒ mở lại gợi ý.
                      setDaChonLead(false);
                    }}
                    placeholder="09xxxxxxxx"
                    required
                  />
                  {dangTraSdt && !daChonLead && (
                    <span className="absolute inset-y-0 right-2 flex items-center text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </span>
                  )}
                  {leadGoiY.length > 0 && !daChonLead && (
                    <ul
                      className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md"
                      aria-label="Lead trùng số điện thoại"
                    >
                      {leadGoiY.map((l) => (
                        <li key={l.id}>
                          <button
                            type="button"
                            onClick={() => chonLead(l)}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                          >
                            <span className="font-medium">{l.parentName}</span>
                            <span className="ml-1.5 text-muted-foreground">
                              {nationalPhone(l.phone) ?? l.phone}
                            </span>
                            {l.conKhai.length > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {l.conKhai.length} con: {l.conKhai.map((c) => c.fullName).join(", ")}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* Ô SĐT NÓI KẾT QUẢ TRA CỦA CHÍNH NÓ. Trước bản này chỉ có nhánh
                    "có lead" được vẽ, nên SĐT không có lead là ô im hoàn toàn — và im
                    lặng mang hai nghĩa (chưa tra / tra rồi mà không có) mà người dùng
                    không tách được. Luật 12. */}
                {nhacSdt && (
                  <p className="text-xs text-muted-foreground">{nhacSdt}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Email (không bắt buộc)</Label>
                <Input
                  type="email"
                  value={customer.email}
                  onChange={(e) =>
                    setCustomer({ ...customer, email: e.target.value })
                  }
                  placeholder="Kênh dự phòng — bỏ trống nếu khách không dùng"
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  CCCD/CMND
                  {/* Câu hỏi phụ huynh hay hỏi lại nhân viên ("sao phải đưa CCCD?") — để sẵn
                      câu trả lời ngay cạnh ô, khỏi mỗi người giải thích một kiểu. */}
                  <HelpHint>
                    Chỉ cần khi phụ huynh muốn xuất hoá đơn hoặc phiếu thu đứng tên mình. Bỏ
                    trống được. Số này là thông tin nhạy cảm nên ở màn Thanh toán sẽ bị che,
                    ai mở xem đầy đủ đều bị ghi nhật ký.
                  </HelpHint>
                </Label>
                <Input
                  value={customer.cccd}
                  onChange={(e) =>
                    setCustomer({ ...customer, cccd: e.target.value })
                  }
                  inputMode="numeric"
                  placeholder="9 hoặc 12 chữ số"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Địa chỉ (số nhà, đường)</Label>
                <Input
                  value={customer.address}
                  onChange={(e) =>
                    setCustomer({ ...customer, address: e.target.value })
                  }
                />
              </div>
              {/* O2 — Tỉnh/Thành TRƯỚC (searchable), Phường/Xã SAU (phụ thuộc tỉnh) */}
              <div className="space-y-1.5">
                <Label>Tỉnh/Thành</Label>
                <Combobox
                  options={provinces}
                  value={provinceId}
                  onValueChange={handleProvinceChange}
                  placeholder="Tìm tỉnh/thành..."
                  emptyText="Không tìm thấy tỉnh/thành"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phường/Xã</Label>
                <Combobox
                  options={wardOptions}
                  value={wardId}
                  onValueChange={setWardId}
                  disabled={!provinceId || wardLoading}
                  placeholder={
                    !provinceId
                      ? "Chọn tỉnh/thành trước"
                      : wardLoading
                        ? "Đang tải..."
                        : "Tìm phường/xã..."
                  }
                  emptyText="Không tìm thấy phường/xã"
                />
              </div>
            </div>
          </section>

          {/* ── DÒNG HÀNG ────────────────────────────────────────────────────────
              Một đơn NHIỀU dòng, mỗi dòng nói rõ mua cho CON NÀO. Chủ dự án 15/09:
              "phụ huynh có 2 con và học 2 khoá khác nhau thì phải tạo 2 đơn à?" —
              không, và đây là chỗ sửa điều đó. Cổng server vốn đã nhận tới 20 dòng. */}
          <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                {orderType === "COURSE" ? "Khoá học" : "Sản phẩm"} ({dong.length})
              </h2>
              <Button type="button" variant="outline" size="sm" onClick={themDong}>
                <Plus className="h-4 w-4" aria-hidden />
                Thêm dòng
              </Button>
            </div>

            <div className="space-y-4">
              {dong.map((d, idx) => (
                <DongHangCard
                  key={d.key}
                  stt={idx + 1}
                  tongDong={dong.length}
                  tranPhanTram={tranPhanTram}
                  customerPhone={customer.phone}
                  maKhuyenMai={maKhuyenMai}
                  phamViCoSo={phamViCoSo}
                  dong={d}
                  orderType={orderType}
                  courses={courses}
                  products={products}
                  students={students}
                  conLead={conLead}
                  onSua={(t) => suaDong(d.key, t)}
                  onChonMatHang={(refId) => chonMatHang(d.key, refId)}
                  onXoa={() => xoaDong(d.key)}
                />
              ))}
            </div>

            {/* Nút thêm thứ hai ở CUỐI danh sách: với đơn 3-4 dòng, nút trên đầu đã cuộn
                khuất khi người dùng nhập xong dòng cuối — đó là đúng lúc họ cần nó. */}
            {dong.length > 1 && (
              <Button type="button" variant="outline" size="sm" onClick={themDong} className="w-full sm:w-auto">
                <Plus className="h-4 w-4" aria-hidden />
                Thêm dòng nữa
              </Button>
            )}
          </section>

          {/* ── KẾ HOẠCH THANH TOÁN ──────────────────────────────────────────────
              Chủ dự án 15/09: *"đặt ở dưới session khoá học và lấy số tiền cần thanh toán
              ở phần khoá học sau khi hoàn thành các tuỳ chọn"*. Đứng NGAY dưới các dòng
              hàng vì số tiền của nó đến từ đó — và người bán vừa chốt giá xong thì câu kế
              tiếp với phụ huynh đúng là "đóng một lần hay chia đợt".

              Chưa chọn khoá học ⇒ HIỆN NHƯNG KHOÁ (chốt của chủ dự án), không ẩn: ẩn thì
              người mới không biết là có thể chia đợt ngay ở đây. */}
          <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                <CalendarClock className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                Kế hoạch thanh toán
                <HelpHint>
                  Đóng một lần hoặc chia thành nhiều đợt theo học phần (48 buổi = 4 học phần × 12 buổi).
                  Công văn SR.QD.223 nêu mốc các đợt cách 30 ngày; SR.QD.219 Điều 2 cho
                  phép chia đều tối đa 12 kỳ theo tháng. Lưu cùng lúc với đơn — mở trang
                  đơn là đã có phiếu thu và mã QR cho từng đợt.
                </HelpHint>
              </h2>
              {/* NÓI RÕ NGUỒN SỐ TIỀN. Câu hỏi đầu tiên của người bán khi thấy một con số
                  tiền thứ hai trên cùng trang là "con này lấy ở đâu" — và nếu không trả
                  lời thì họ tự đoán, thường là đoán thành "tạm tính". */}
              <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                Tổng đơn sau giảm giá:{" "}
                <b className="font-semibold text-foreground">
                  {totalAmount.toLocaleString("vi-VN")}đ
                </b>
              </span>
            </div>
            {/* `choKhaiDaThu={false}` — chủ dự án 16/09: *"đây chỉ là giai đoạn tạo đơn
                và tạo kế hoạch thanh toán để xuất QR cho KH quét thì làm gì đã thu mà
                tick?"*. Đúng: đơn còn chưa tồn tại, nên một ô tick ở đây chỉ mở đường ghi
                một khoản Ledger-A khống. Khách đã đóng trước thì khai ở TRANG ĐƠN, nơi
                prop này là `true`. */}
            {/* GỢI Ý THEO HỌC PHẦN — chỉ hiện khi khoá có chia học phần và số buổi rơi
                đúng mốc. Ngoài phạm vi thì KHÔNG hiện gì: một khối trống hay một câu
                "không áp dụng" chỉ làm người bán phải đọc thêm một dòng vô nghĩa. */}
            {!khoaKeHoach && goiYHocPhan.apLuat && goiYHocPhan.dot && (
              <div className="rounded-lg border border-state-info-ink/25 bg-state-info-soft p-3 text-xs leading-relaxed">
                <p className="text-state-info-ink">
                  Khoá này chia{" "}
                  <b className="font-semibold tabular-nums">{goiYHocPhan.dot.length} học phần</b>{" "}
                  (
                  {goiYHocPhan.dot.map((d, i) => (
                    <span key={d.hocPhan}>
                      {i > 0 && " · "}
                      <b className="font-semibold">HP{d.hocPhan}</b> {d.soBuoi} buổi
                    </span>
                  ))}
                  ).
                </p>
                {/* 🔴 SỐ ĐỢT LÀ TỰ DO — KHÔNG bị số học phần trói [28/09/2026].
                    Chủ dự án, hai lượt: *"học phần khác đợt... tôi muốn thanh toán 1, 2
                    hay 3 đợt đều được chứ?"* rồi *"bỏ luôn nút chia N đợt theo học phần
                    này đi, không cần thiết, tôi muốn thanh toán bao nhiêu đợt tuỳ tôi"*.

                    Bản đầu còn in *"Đang khai 1 đợt — lệch với 4 học phần. Đơn sẽ cần
                    quản lý cơ sở duyệt."* — SAI HOÀN TOÀN, `xetDuyetDon` không nhận đầu
                    vào nào của học phần × đợt. Bản hai gỡ câu ấy nhưng giữ nút đặt nhanh;
                    nút đó vẫn ngầm bảo "nên theo học phần", nên gỡ nốt.

                    ⚠️ KHÔNG in con số trần đợt: trần là tham số vận hành
                    (`orders.maxInstallments`), form không đọc được, và in một hằng cứng là
                    dựng con số thứ hai sống song song với cấu hình (bẫy
                    `crm.commissionMaxTotalRate`). Vượt trần thì cổng duyệt tự nói. */}
                <p className="mt-1.5 text-state-info-ink">
                  Số đợt thanh toán tuỳ bạn — chia 1 đợt hay nhiều đợt đều được. Chia quá
                  mức cho phép thì đơn cần quản lý duyệt, và hệ thống sẽ báo ngay.
                </p>
              </div>
            )}
            {/* ⚠️ CẢNH BÁO LỆCH MỐC — NGOÀI khối gợi ý, cố ý.
                Khi số buổi lệch mốc thì `goiYKeHoachDon` trả "ngoài phạm vi" và khối xanh
                ở trên BIẾN MẤT — đúng lúc sale cần được nhắc nhất. Lồng cảnh báo vào
                trong khối ấy là viết một câu không bao giờ hiện được. */}
            {canhBaoSoBuoi.length > 0 && (
              <div className="rounded-lg border border-state-warning-ink/30 bg-state-warning-soft p-3 text-xs leading-relaxed">
                <p className="font-semibold text-state-warning-ink">
                  Đơn này sẽ cần quản lý cơ sở duyệt trước khi xuất mã QR
                </p>
                <ul className="mt-1 space-y-0.5 text-state-warning-ink/90">
                  {canhBaoSoBuoi.map((c, i) => (
                    <li key={i}>• {c}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-muted-foreground">
                  Vẫn lưu đơn được — nhưng khách chưa quét QR trả tiền được cho tới khi
                  quản lý duyệt. Muốn xuất QR ngay thì sửa số buổi về đúng mốc.
                </p>
              </div>
            )}
            <KeHoachDotEditor
              kh={keHoach}
              totalAmount={totalAmount}
              khoa={khoaKeHoach}
              choKhaiDaThu={false}
            />
          </section>


          {/* Notes */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>
                Ghi chú khách hàng
                <HelpHint>
                  Nội dung liên quan trực tiếp tới khách: yêu cầu riêng, thoả thuận lúc bán.
                  Việc nội bộ (dặn nhau, đánh giá khách) ghi ở ô bên cạnh.
                </HelpHint>
              </Label>
              <Textarea
                value={customerNote}
                onChange={(e) => setCustomerNote(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Ghi chú nội bộ
                <HelpHint>
                  Chỉ nhân viên Sata Robo đọc được — dùng để dặn nhau về đơn này (đã hẹn gọi
                  lại, chờ phụ huynh chuyển khoản…).
                </HelpHint>
              </Label>
              <Textarea
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                rows={2}
              />
            </div>
          </section>

        </div>

        <aside className="min-w-0 space-y-5 lg:sticky lg:top-4 lg:self-start lg:space-y-6">
        {/* ── TÓM TẮT TIỀN ────────────────────────────────────────────────
            Dính bên phải khi cuộn: người bán vừa nhập từng dòng vừa phải thấy tổng,
            và với đơn nhiều con thì tổng là con số họ đọc cho phụ huynh nghe. Trước
            bản này tổng nằm lẫn trong khối Định giá ở cuối trang — nhập tới dòng thứ
            ba là nó đã cuộn khuất. */}
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Tóm tắt
          </h2>
          <dl className="space-y-2 text-sm">
            {dong.map((d, idx) => {
              const t = tien.dong[idx]!;
              return (
                <div key={d.key} className="space-y-0.5">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="min-w-0 break-words text-muted-foreground">
                      {d.itemName || `Dòng ${idx + 1} — chưa chọn`}
                      {d.quantity > 1 && (
                        <span className="ml-1 text-xs">×{d.quantity}</span>
                      )}
                      {(() => {
                        const hv = students.find((x) => x.id === d.studentId);
                        return hv ? (
                          <span className="block text-xs text-muted-foreground">
                            {hv.name}
                          </span>
                        ) : null;
                      })()}
                    </dt>
                    <dd className="shrink-0 tabular-nums text-foreground">
                      {t.tamTinh.toLocaleString("vi-VN")}đ
                    </dd>
                  </div>
                  {/* Giảm của RIÊNG dòng, hiện ngay dưới dòng đó. Dồn hết vào một con
                      số "giảm giá" ở chân thẻ là mất đúng thứ chủ dự án yêu cầu tách:
                      bớt cho ĐỨA NÀO. */}
                  {/* ⚠️ LIỆT KÊ TỪNG KHOẢN, KÈM TÊN CHƯƠNG TRÌNH [28/09/2026].
                      Chủ dự án: *"đưa chương trình giảm giá vào phần tóm tắt"*.

                      Bản cũ gộp cả dòng thành một chữ "Giảm 10%" — đúng số tiền nhưng
                      KHÔNG nói được bớt theo chương trình nào, mà đó chính là thứ người
                      đọc tóm tắt cần đối chiếu với văn bản BLĐ. Và khi một dòng có hai
                      khoản thì `t.phanTram` là `null` (xem `tienDong`), nên chữ "Giảm"
                      trơ ra không mang thông tin gì. */}
                  {t.khoan
                    .filter((k) => k.giam > 0)
                    .map((k, j) => {
                      const m = k.voucherId
                        ? maKhuyenMai.find((x) => x.voucherId === k.voucherId)
                        : undefined;
                      return (
                        <div
                          key={j}
                          className="flex items-start justify-between gap-3 pl-3 text-xs"
                        >
                          <dt className="min-w-0 break-words text-state-danger-ink">
                            {m ? (
                              <>
                                <span className="font-medium">{m.maVanBan}</span> · {m.ma}
                                <span className="block text-muted-foreground">
                                  {m.tenChuongTrinh}
                                </span>
                              </>
                            ) : (
                              <>
                                Giảm riêng
                                {k.phanTram != null ? ` ${k.phanTram}%` : ""}
                                {k.lyDo && (
                                  <span className="block text-muted-foreground">{k.lyDo}</span>
                                )}
                              </>
                            )}
                          </dt>
                          <dd className="shrink-0 tabular-nums text-state-danger-ink">
                            −{k.giam.toLocaleString("vi-VN")}đ
                          </dd>
                        </div>
                      );
                    })}
                </div>
              );
            })}

            <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
              <dt className="text-muted-foreground">Tạm tính</dt>
              <dd className="tabular-nums text-foreground">
                {subtotal.toLocaleString("vi-VN")}đ
              </dd>
            </div>
            {tien.tongGiam > 0 && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">
                  Tổng giảm
                  <HelpHint>
                    Cộng từ phần giảm của từng dòng ở trên — không có ô giảm giá nào cho
                    cả đơn. Muốn bớt cho một em thì bớt ở đúng dòng của em đó, để sau này
                    hoàn tiền hay chuyển lớp còn biết phần giảm thuộc về ai.
                  </HelpHint>
                </dt>
                <dd className="tabular-nums text-state-danger-ink">
                  −{tien.tongGiam.toLocaleString("vi-VN")}đ
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
              <dt className="font-semibold text-foreground">Tổng đơn</dt>
              {/* text-xl là TRẦN cho số tiền (DESIGN.md §3) — 955.563.000đ từng tràn thẻ. */}
              <dd className="text-xl font-bold tabular-nums text-foreground">
                {totalAmount.toLocaleString("vi-VN")}đ
              </dd>
            </div>
          </dl>
        </section>
          {/* ⚠️ KHỐI "ĐỊNH GIÁ" CẤP ĐƠN ĐÃ GỠ [15/09/2026].
              Nó chứa ô Giảm giá + Giải trình dùng chung cho cả đơn — thứ chủ dự án chốt
              bỏ. Phần TỔNG mà nó hiện đã trùng sẵn với thẻ "Tóm tắt" ngay trên (chú thích
              ở thẻ đó đã ghi nhận sự trùng lặp này), nên gỡ cả khối chứ không giữ lại một
              thẻ rỗng chỉ để in lại con số. Ô giảm giá nay nằm trong từng `DongHangCard`. */}

          <div className="flex gap-3">
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Đang tạo..." : "Tạo đơn"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isPending}
            >
              Huỷ
            </Button>
          </div>
        </aside>
      </div>
    </form>
  );
}

/**
 * MỘT dòng hàng — chọn con, chọn khoá/sản phẩm, hình thức lớp, số buổi, SL, đơn giá.
 *
 * Tách ra component riêng vì mỗi dòng có state dẫn xuất RIÊNG (gợi ý giá theo công văn
 * phụ thuộc khoá + số buổi + hình thức của CHÍNH dòng đó). Để chung trong form thì phải
 * tính một mảng `goiY[]` song song với `dong[]` và giữ hai mảng đồng bộ bằng tay — đúng
 * loại việc mà React tách component ra để khỏi phải làm.
 */
function DongHangCard({
  stt,
  tongDong,
  tranPhanTram,
  customerPhone,
  maKhuyenMai,
  phamViCoSo,
  dong,
  orderType,
  courses,
  products,
  students,
  conLead,
  onSua,
  onChonMatHang,
  onXoa,
}: {
  stt: number;
  tongDong: number;
  tranPhanTram: number;
  /** SĐT phụ huynh đang nhập — dùng để LỌC danh sách con. */
  customerPhone: string;
  maKhuyenMai: MaApDung[];
  /** MÃ OrgUnit của cơ sở đơn — RỖNG khi chưa chọn cơ sở (xem `phamViCoSo`). */
  phamViCoSo: string[];
  dong: DongHang;
  orderType: UiOrderType;
  courses: Course[];
  products: ProductOption[];
  students: StudentOption[];
  /** Con khai trong lead đang gắn — chưa có hồ sơ `Student`. Xem `KetQuaLocCon.conLead`. */
  conLead: ConLead[];
  onSua: (thayDoi: Partial<DongHang>) => void;
  onChonMatHang: (refId: string) => void;
  onXoa: () => void;
}) {
  const khoa = useMemo(
    () =>
      orderType === "COURSE"
        ? (courses.find((c) => c.id === dong.refId) ?? null)
        : null,
    [orderType, courses, dong.refId],
  );
  const sanPham = useMemo(
    () =>
      orderType === "PRODUCT"
        ? (products.find((p) => p.id === dong.refId) ?? null)
        : null,
    [orderType, products, dong.refId],
  );

  /**
   * GỢI Ý học phí theo SR.QD.219 Điều 5 — để người bán ĐỌC, không phải giá hệ thống áp.
   *
   * Ô "Đơn giá" vẫn do người bán gõ: hệ thống chưa có cách đối chiếu hình thức lớp đã
   * bán với lớp học thật, nên tự áp giá ×2 là biến một con số người khai thành một con
   * số hệ thống bảo đảm.
   *
   * Giảm giá: cố ý truyền `null`. Ô giảm giá của ĐƠN trừ trên TỔNG sau khi đã nhân hệ
   * số, còn Mục 5.3 bảo giảm TRƯỚC rồi mới nhân — hai thứ tự khác nhau.
   */
  const goiY = useMemo(() => {
    if (orderType !== "COURSE" || !khoa) return null;
    return goiYGiaCoach({
      giaNiemYet: khoa.price,
      tongSoBuoi: khoa.totalSessions,
      soBuoiMua: dong.soBuoiMua,
      coachFormat: dong.coachFormat,
      giamGia: null,
      khoaKhongApDungCoach: laKhoaLoaiTruCoach(khoa),
    });
  }, [orderType, khoa, dong.soBuoiMua, dong.coachFormat]);

  const thieuGiaNiemYet =
    orderType === "COURSE" && !!khoa && (khoa.price == null || khoa.price <= 0);
  const thieuKho = !!sanPham && sanPham.stockOnHand < dong.quantity;
  const thanhTien = dong.unitPrice * dong.quantity;

  const matHangItems = useMemo(() => {
    if (orderType === "COURSE")
      return Object.fromEntries(
        courses.map((c) => [c.id, c.code ? `${c.name} (${c.code})` : c.name]),
      );
    return Object.fromEntries(products.map((pd) => [pd.id, `${pd.sku} · ${pd.name}`]));
  }, [orderType, courses, products]);

  // Nhãn học viên mang THÊM tên phụ huynh + SĐT: một cơ sở có nhiều em trùng tên, và
  // người bán đang cầm SĐT của phụ huynh trước mặt — đó là thứ họ đối chiếu được.
  //
  // ⚠️ SĐT phải ra dạng NỘI ĐỊA `0987654321`, không phải `84987654321` như trong DB.
  // Đây KHÔNG chỉ là chuyện hiển thị: bộ lọc của `Combobox` khớp trên chính chuỗi
  // `label` này, nên để nguyên dạng `84…` là người bán gõ số họ đang cầm trên tay
  // (`09…`) thì danh sách ra RỖNG — đúng lúc họ cần nó nhất, tức lúc tìm các con của
  // cùng một phụ huynh. Dạng nội địa khớp cả hai kiểu dữ liệu vì `nationalPhone`
  // chuẩn hoá trước.
  // Tiền của CHÍNH dòng này — cùng hàm với thẻ Tóm tắt và với server.
  const tienDongNay = tienDong(
    { unitPrice: dong.unitPrice, quantity: dong.quantity, giam: dong.giam },
    tranPhanTram,
  );

  /** Sửa MỘT khoản giảm tại chỗ — giữ nguyên thứ tự, không dựng lại cả mảng ở chỗ gọi. */
  const suaKhoan = (idx: number, thayDoi: Partial<KhaiGiam>) =>
    onSua({ giam: dong.giam.map((k, i) => (i === idx ? { ...k, ...thayDoi } : k)) });

  /**
   * Bối cảnh xét mã của DÒNG NÀY — cùng đầu vào mà server sẽ dùng lại lúc lưu.
   *
   * `ngay` đọc đồng hồ MÁY, và đó là chỗ duy nhất được phép: đây là lớp trải nghiệm.
   * Server tự lấy ngày của nó và TÍNH LẠI — nếu hai bên lệch ngày thì bên quyết định là
   * server, và nó từ chối. Tin ngày client gửi mới là lỗ (đổi đồng hồ máy để dùng một
   * chương trình đã hết hạn).
   */
  const boiCanhMa: BoiCanhDong = useMemo(
    () => ({
      courseId: orderType === "COURSE" ? (dong.refId || null) : null,
      phamViCoSo,
      ngay: ngayVN(new Date()),
      tamTinhDong: tienDongNay.tamTinh,
    }),
    [orderType, dong.refId, phamViCoSo, tienDongNay.tamTinh],
  );

  /** Mã dùng được cho dòng này — lọc tinh, chạy lại mỗi lần đổi khoá/cơ sở/giá. */
  const maChoDongNay = useMemo(
    () => locMaChoDong(maKhuyenMai, boiCanhMa),
    [maKhuyenMai, boiCanhMa],
  );

  /**
   * Mã KHÔNG dùng được, kèm lý do — để nói THẬT khi bộ chọn trống (luật 12).
   *
   * Im lặng ở đây là loại lỗi tệ nhất của màn này: sale biết có chương trình 15% đang
   * chạy, mở form ra không thấy đâu, và không có cách nào biết là vì sai cơ sở hay vì
   * dòng chưa đạt mức tối thiểu.
   */
  const maBiLoai = useMemo(
    () =>
      maKhuyenMai
        .map((m) => ({ m, lyDo: lyDoKhongDung(m, boiCanhMa) }))
        .filter((x): x is { m: MaApDung; lyDo: LyDoLoai } => x.lyDo !== null),
    [maKhuyenMai, boiCanhMa],
  );

  /**
   * Danh sách học viên cho ô chọn — LỌC THEO SĐT PHỤ HUYNH đang nhập (15/09/2026).
   *
   * Chủ dự án: *"học viên thì lấy đúng số con trong lead nhập ở sđt ở trên session khách
   * hàng, chứ không hiển thị full như vậy."* Trước bản này ô này bày cả 250 học viên của
   * cơ sở, và người bán phải tự nhớ con nào là của khách đang đứng trước mặt.
   *
   * ⚠️ SĐT TRỐNG thì vẫn bày ĐỦ, cố ý: đơn walk-in không gắn lead nào vẫn phải chọn được
   * con: lọc-về-rỗng khi chưa có SĐT là khoá luồng đó. Lọc chỉ bật khi đã có SĐT để lọc.
   *
   * ⚠️ PHÉP SO SĐT không nằm ở đây mà ở `conCuaPhuHuynh` (thuần, có test + đã cấy lỗi):
   * cùng một hàm với lúc dựng dòng đầu (chọn sẵn con) và với `chonLead`. Ba bản chép tay
   * của cùng phép so là ba cách lệch, và lệch ở đây nghĩa là ô này bày ra một tập còn ô
   * kia chọn sẵn một em NGOÀI tập đó.
   *
   * ⚠️ CẬP NHẬT 16/09/2026 — QUYẾT ĐỊNH "bày ai" ĐÃ RA KHỎI TỆP NÀY. Chủ dự án nêu lỗi
   * lần thứ hai (*"đã lọc sđt ph vẫn hiển thị full… có thể chọn sai con"*) và gốc là dòng
   * fail-open TỪNG nằm ngay dưới chú thích này. Nay hỏi `locConChoODon` — nó trả CẢ tập
   * LẪN mã trạng thái, nên ô chọn và câu nhắc không thể nói khác nhau. Lý do đầy đủ + số
   * đo 121/125 lead ở `lib/orders/hoc-vien-dong-don.ts`.
   */
  /** Người bán CHỦ ĐỘNG xin cả danh sách — mặc định TẮT, và reset theo từng dòng hàng. */
  const [bayCaDanhSach, setBayCaDanhSach] = useState(false);
  const loc = useMemo(
    () => locConChoODon(students, customerPhone, bayCaDanhSach, conLead),
    [students, customerPhone, bayCaDanhSach, conLead],
  );
  const hocVienOptions: ComboboxOption[] = useMemo(() => {
    // ⚠️ KHÔNG lọc lại ở đây, KHÔNG thay bằng tập khác. `locConChoODon` là chỗ DUY NHẤT
    // quyết định ô này bày ai, và nó trả kèm mã trạng thái để câu nhắc bên dưới không phải
    // suy lại. Dòng cũ ở đây là `conCuaSdt.length > 0 ? conCuaSdt : students` — fail-open,
    // và nó làm 121/125 lead bày đủ 247 em (xem chú thích trong `hoc-vien-dong-don.ts`).
    const hoSo = loc.ds.map((hv) => ({
      value: hv.id,
      label: [hv.name, hv.parentName, nationalPhone(hv.parentPhone) ?? hv.parentPhone]
        .filter(Boolean)
        .join(" · "),
    }));
    // CON LEAD đứng SAU, và mang hậu tố nói rõ em chưa có hồ sơ — người bán phải phân biệt
    // được hai nhóm bằng mắt, vì chọn nhóm nào quyết định tiền ghi vào bảng nào.
    const cl = loc.conLead.map((c) => ({
      value: maChonConLead(c.id),
      label: `${c.fullName} · chưa có hồ sơ học viên`,
    }));
    return [...hoSo, ...cl];
  }, [loc]);

  /** Giá trị hiện tại của ô — một dòng trỏ về học viên HOẶC con lead, không bao giờ cả hai. */
  const giaTriODon = dong.studentId ?? (dong.leadChildId ? maChonConLead(dong.leadChildId) : "");

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted tabular-nums">
            {stt}
          </span>
          Dòng {stt}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {thanhTien.toLocaleString("vi-VN")}đ
          </span>
          {/* Dòng cuối cùng KHÔNG xoá được — đơn 0 dòng không lưu được (server đòi
              min 1) và một form trống trơn không nói được phải làm gì tiếp. Vô hiệu
              hoá kèm `title` chứ không ẩn nút: nút biến mất làm người ta tưởng hỏng. */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onXoa}
            disabled={tongDong <= 1}
            title={tongDong <= 1 ? "Đơn phải có ít nhất một dòng" : "Xoá dòng này"}
            aria-label={`Xoá dòng ${stt}`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* HỌC VIÊN — ô đầu tiên vì đó là câu hỏi đầu tiên khi bán cho nhà nhiều con. */}
        <div className="space-y-1.5">
          <Label>
            <User className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
            Học viên
            <HelpHint>
              Dòng này mua cho con nào. Để trống được khi khách vãng lai — con chưa có hồ
              sơ trong hệ thống, tên con lúc đó nằm ở tên khoá học. Nhưng đơn có TỪ HAI
              con trở lên thì bắt buộc chọn rõ từng dòng, nếu không thì sau này không ai
              biết khoản tiền là của ai.
            </HelpHint>
          </Label>
          <Combobox
            options={hocVienOptions}
            value={giaTriODon}
            onValueChange={(v) => {
              // ⚠️ Giải mã ở HÀM THUẦN (`docMaChonHocVien`), không tự tách chuỗi tại chỗ:
              // `Student.id` và `LeadChild.id` đều là cuid nên nhìn không phân biệt được,
              // và đoán sai ở đây là gán tiền sang nhầm bảng mà không lỗi nào báo.
              const { studentId, leadChildId } = docMaChonHocVien(v);
              onSua({
                studentId,
                leadChildId,
                tenConLead: leadChildId
                  ? (loc.conLead.find((c) => c.id === leadChildId)?.fullName ?? null)
                  : null,
              });
            }}
            placeholder="Chọn học viên (tuỳ chọn)…"
            emptyText="Không tìm thấy học viên"
          />
          {/* Việc LỌC phải tự nói ra. Một ô đột nhiên chỉ còn 2 dòng mà không giải thích
              thì người bán tưởng mất dữ liệu và đi tìm ở chỗ khác.

              ⚠️ Câu nhắc đi theo `loc.ma`, KHÔNG tự suy lại từ `customerPhone`. Bản cũ tự
              suy bằng `customerPhone.replace(/D/g, "").length >= 6` — thiếu dấu gạch chéo
              (`/\D/g`) nên nó xoá chữ "D" hoa chứ không xoá ký tự không-phải-số; ý định
              "đủ 6 chữ số mới nhắc" chưa từng chạy. Lỗi câm kiểu đó chỉ tránh được bằng
              cách để tập và câu nhắc là CÙNG MỘT giá trị trả về. */}
          {loc.ma === MA_LOC_CON.DANG_LOC && (
            <p className="text-xs text-muted-foreground">
              Đang lọc theo SĐT {nationalPhone(customerPhone) ?? customerPhone} —{" "}
              {loc.soCon} con
            </p>
          )}
          {loc.ma === MA_LOC_CON.CON_LEAD && (
            <p className="text-xs text-muted-foreground">
              Đang bày <b className="font-semibold text-foreground">{loc.conLead.length} con
              của khách này</b> — các em chưa có hồ sơ học viên (hồ sơ được tạo khi chốt
              khách và xếp lớp). Cứ chọn đúng em, đơn vẫn tạo được bình thường.
            </p>
          )}
          {loc.ma === MA_LOC_CON.KHONG_CO_CON && (
            <p className="text-xs text-state-warning-ink">
              SĐT {nationalPhone(customerPhone) ?? customerPhone} chưa có hồ sơ học viên nào.
              Để trống ô này được — tên con khi đó nằm ở tên khoá học.{" "}
              <button
                type="button"
                onClick={() => setBayCaDanhSach(true)}
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                Bày cả danh sách ({loc.tong} em)
              </button>
            </p>
          )}
          {loc.ma === MA_LOC_CON.BAY_TAY && (
            <p className="text-xs text-muted-foreground">
              Đang bày cả danh sách ({loc.tong} em) — KHÔNG lọc theo SĐT, hãy đối chiếu tên
              phụ huynh trong từng dòng.{" "}
              <button
                type="button"
                onClick={() => setBayCaDanhSach(false)}
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                Lọc lại theo SĐT
              </button>
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>
            {orderType === "COURSE" ? "Khoá học *" : "Sản phẩm *"}
            <HelpHint>
              {orderType === "COURSE"
                ? "Chọn khoá là đơn giá tự điền theo giá niêm yết của khoá đó. Khoá chưa nạp giá sẽ có cảnh báo — khi đó phải nhập đơn giá tay."
                : "Sản phẩm hết hàng bị khoá, không chọn được — nhập kho trước rồi quay lại. Số tồn hiện ngay trong danh sách."}
            </HelpHint>
          </Label>
          <Select
            items={matHangItems}
            value={dong.refId}
            onValueChange={(v) => onChonMatHang(v ?? "")}
          >
            <SelectTrigger>
              <SelectValue placeholder="Chọn..." />
            </SelectTrigger>
            <SelectContent>
              {orderType === "COURSE" &&
                courses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.code ? ` (${c.code})` : ""}
                  </SelectItem>
                ))}
              {orderType === "PRODUCT" && products.length === 0 && (
                <div className="p-2 text-xs text-muted-foreground">
                  Không có sản phẩm ACTIVE. Tạo sản phẩm tại /products/new
                </div>
              )}
              {orderType === "PRODUCT" &&
                products.map((pd) => (
                  <SelectItem key={pd.id} value={pd.id} disabled={pd.stockOnHand <= 0}>
                    {pd.sku} · {pd.name} · {pd.salePrice.toLocaleString("vi-VN")}đ · còn{" "}
                    {pd.stockOnHand}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {thieuGiaNiemYet && (
        <p className="mt-2 rounded-lg border border-state-warning bg-state-warning-soft p-2 text-sm text-state-warning-ink">
          ⚠️ Khoá học này chưa có giá niêm yết. Nhập đơn giá thủ công bên dưới.
        </p>
      )}
      {sanPham && (
        <p
          className={
            "mt-2 rounded-lg p-2 text-sm " +
            (thieuKho
              ? "border border-state-danger-soft bg-state-danger-soft text-state-danger-ink"
              : "border border-state-info-soft bg-state-info-soft text-state-info-ink")
          }
        >
          {thieuKho ? "⚠️" : "ℹ️"} Tồn kho hiện tại: {sanPham.stockOnHand}
          {thieuKho && ` — không đủ cho yêu cầu ${dong.quantity}`}
        </p>
      )}

      {/* ── HÌNH THỨC LỚP — SR.QD.219 Điều 5 ─────────────────────────────────
          Chỉ đơn KHOÁ HỌC mới có nghĩa. Khối này KHAI hình thức đã bán và GỢI Ý giá
          theo công văn; nó cố ý KHÔNG tự ghi đè "Đơn giá" — xem chú thích ở `goiY`. */}
      {orderType === "COURSE" && (
        <div className="mt-4 space-y-3 rounded-lg border border-border bg-muted/40 p-3 sm:p-4">
          <div className="space-y-1.5">
            <Label>
              Hình thức lớp
              <HelpHint>
                Theo SR.QD.219 Điều 5: Coach 1-1 là 1 giáo viên kèm riêng 1 học sinh, 1-2
                kèm 2, 1-4 kèm tối đa 4. Giá mỗi buổi = giá/buổi của khoá × hệ số (1-1
                ×2,0 · 1-2 ×1,8 · 1-4 ×1,5). Chọn ở đây để đơn GHI LẠI hình thức đã bán;
                đơn giá vẫn do bạn gõ.
              </HelpHint>
            </Label>
            <div className="flex flex-wrap gap-2">
              {(
                ["GROUP", "ONE_ON_ONE", "ONE_ON_TWO", "ONE_ON_FOUR"] as CoachFormat[]
              ).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => onSua({ coachFormat: f })}
                  aria-pressed={dong.coachFormat === f}
                  className={`min-h-11 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors duration-150 ${
                    dong.coachFormat === f
                      ? "border-primary bg-primary text-white"
                      : "border-border bg-background hover:bg-muted"
                  }`}
                >
                  {NHAN_COACH[f]}
                  {f !== "GROUP" && (
                    <span className="ml-1 text-xs opacity-80">
                      ×{HE_SO_COACH[f].toLocaleString("vi-VN")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-1">
              <Label>
                Số buổi mua
                <HelpHint>
                  Mặc định bằng tổng số buổi của khoá. Sửa khi khách mua LẺ buổi (học
                  thêm ngoài chính khoá — Mục 5.4) hoặc mua theo học phần.
                </HelpHint>
              </Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={dong.soBuoiMua ?? ""}
                placeholder={khoa?.totalSessions ? String(khoa.totalSessions) : "—"}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onSua({ soBuoiMua: Number.isInteger(v) && v > 0 ? v : null });
                }}
              />
            </div>

            <div className="sm:col-span-2">
              {goiY?.dungDuoc ? (
                <div className="rounded-lg border border-state-info bg-state-info-soft/40 p-3">
                  <p className="text-xs leading-relaxed text-state-info-ink">
                    Theo công văn:{" "}
                    <b className="font-semibold tabular-nums">
                      {goiY.giaMoiBuoi.toLocaleString("vi-VN")}đ/buổi
                    </b>{" "}
                    × hệ số{" "}
                    <b className="font-semibold">{goiY.heSo.toLocaleString("vi-VN")}</b> ×{" "}
                    <b className="font-semibold tabular-nums">{goiY.soBuoiMua} buổi</b> ={" "}
                    <b className="font-semibold tabular-nums">
                      {goiY.thanhTien.toLocaleString("vi-VN")}đ
                    </b>
                    {goiY.lechLamTron !== 0 && (
                      <>
                        {" "}
                        <span className="text-muted-foreground">
                          (lệch {goiY.lechLamTron > 0 ? "+" : ""}
                          {goiY.lechLamTron.toLocaleString("vi-VN")}đ do làm tròn giá/buổi)
                        </span>
                      </>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => onSua({ unitPrice: goiY.thanhTien })}
                    className="mt-2 min-h-9 rounded-md border border-border bg-background px-2.5 text-xs font-medium transition-colors duration-150 hover:bg-muted"
                  >
                    Áp số này vào Đơn giá
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border border-state-warning bg-state-warning-soft p-3 text-xs leading-relaxed text-state-warning-ink">
                  {goiY?.thieu === "LOAI_TRU" ? (
                    <>
                      Khoá này <b className="font-semibold">không áp dụng Coach</b>{" "}
                      (SR.QD.219 Điều 5 — gói cam kết 5 buổi, giá cố định Điều 3). Chọn
                      lớp nhóm, hoặc chọn khoá khác — server cũng từ chối đơn này.
                    </>
                  ) : goiY?.thieu === "SO_BUOI" ? (
                    <>
                      Khoá chưa khai <b className="font-semibold">tổng số buổi</b> nên
                      không tính được giá/buổi. Khai ở màn Gói khoá học, hoặc gõ đơn giá
                      tay.
                    </>
                  ) : goiY?.thieu === "GIA" ? (
                    <>
                      Khoá chưa có <b className="font-semibold">giá niêm yết</b> nên không
                      gợi ý được. Nhập đơn giá tay.
                    </>
                  ) : (
                    <>Chọn khoá học để xem gợi ý giá theo công văn.</>
                  )}
                </div>
              )}
            </div>
          </div>

          {dong.coachFormat !== "GROUP" && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Hình thức lớp được{" "}
              <b className="font-semibold text-foreground">ghi lại trên dòng đơn</b>;{" "}
              <b className="font-semibold text-foreground">đơn giá vẫn là số bạn gõ</b>.
              Hai điều phải biết: (1) ô Giảm giá bên dưới trừ trên TỔNG sau khi đã nhân hệ
              số, còn Mục 5.3 bảo giảm TRƯỚC rồi mới nhân — giảm theo % thì hai cách trùng
              nhau, giảm theo SỐ TIỀN thì lệch; (2) công nợ và cổng phụ huynh hiện vẫn đọc
              giá LỚP NHÓM của ghi danh, nên đơn Coach sẽ lệch với số phụ huynh thấy cho
              tới khi phần ghi danh được sửa.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-1">
          <Label>Số lượng</Label>
          <Input
            type="number"
            min={1}
            value={dong.quantity}
            onChange={(e) => onSua({ quantity: Number(e.target.value) || 1 })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>
            Đơn giá (VND) *
            <HelpHint>
              Tự điền theo giá niêm yết khi chọn khoá học/sản phẩm; chỉ sửa tay khi khoá
              chưa có giá. Muốn bớt tiền cho khách thì dùng ô Giảm giá ngay bên dưới — hạ
              thẳng đơn giá là báo cáo mất dấu khoản ưu đãi, và cổng soát giá (so đơn giá
              với giá niêm yết) không còn thấy gì bất thường để cảnh báo.
            </HelpHint>
          </Label>
          <MoneyInput
            /* Theo `stt`, KHÔNG theo `dong.key` — xem chú thích ở `demKey`. */
            name={`unitPrice-${stt}`}
            min={0}
            value={dong.unitPrice}
            onValueChange={(v) => onSua({ unitPrice: v ?? 0 })}
          />
        </div>
      </div>

      {/* ── CÁC KHOẢN GIẢM CỦA RIÊNG DÒNG NÀY (15/09/2026) ───────────────────
          Chủ dự án: "giảm giá tách riêng theo từng đơn" rồi "làm flex đi, vì 1 đơn có
          thể áp nhiều giảm giá khác nhau". Ưu đãi thật chồng lên nhau — anh chị em học
          cùng + đóng sớm cả khoá + học bổng — nên đây là một DANH SÁCH, đứng trong thẻ
          của dòng đó, cạnh tên con. */}
      <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Giảm giá dòng này
            {dong.giam.length > 0 ? ` (${dong.giam.length})` : ""}
            <HelpHint>
              Mỗi ưu đãi là MỘT khoản riêng, có giải trình riêng — anh chị em học cùng,
              đóng sớm cả khoá, học bổng… Các khoản CỘNG DỒN trên tạm tính của chính dòng
              này (không tính lũy tiến): 10% + 20% là bớt 30%, không phải 28%. Tổng các
              khoản không bao giờ vượt quá tạm tính của dòng.
            </HelpHint>
          </Label>
          {/* Số cuối của dòng hiện ngay đây — người bán gõ phần giảm và thấy ngay kết
              quả, không phải đưa mắt sang thẻ Tóm tắt rồi tìm lại đúng dòng. */}
          {tienDongNay.giam > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {tienDongNay.tamTinh.toLocaleString("vi-VN")}đ
              <span className="mx-1 text-state-danger-ink">
                −{tienDongNay.giam.toLocaleString("vi-VN")}đ
              </span>
              ={" "}
              <strong className="text-foreground">
                {tienDongNay.thanhTien.toLocaleString("vi-VN")}đ
              </strong>
            </span>
          )}
        </div>

        {dong.giam.length === 0 && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Chưa có khoản giảm nào — dòng này bán đúng giá.
          </p>
        )}

        <div className="mt-2 space-y-3">
          {dong.giam.map((k, idx) => {
            const daAp = tienDongNay.khoan[idx];
            // Mã ĐANG chọn của khoản này. `CHUA_CHON_MA` (chuỗi rỗng) nghĩa là "đang ở
            // chế độ chương trình nhưng chưa chọn cái nào" — khác hẳn `null` (gõ riêng),
            // và cổng lưu phải phân biệt được hai ca đó.
            const maDangChon =
              k.voucherId && k.voucherId !== CHUA_CHON_MA
                ? maChoDongNay.find((m) => m.voucherId === k.voucherId)
                : undefined;
            return (
              <div
                key={idx}
                className="rounded-md border border-border bg-background p-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Khoản {idx + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    {/* Hiện SỐ THẬT đã trừ được, không phải số đã gõ: khi các khoản cộng
                        lại vượt tạm tính thì khoản cuối bị cắt bớt, và người bán phải
                        thấy điều đó ngay chứ không phải đoán từ tổng. */}
                    {daAp && daAp.giam > 0 && (
                      <span className="text-xs tabular-nums text-state-danger-ink">
                        −{daAp.giam.toLocaleString("vi-VN")}đ
                        {daAp.giam < (daAp.phanTram != null
                          ? Math.round((tienDongNay.tamTinh * daAp.phanTram) / 100)
                          : daAp.giaTri) && (
                          <span className="ml-1 text-muted-foreground">(đã chạm trần dòng)</span>
                        )}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-state-danger-ink"
                      onClick={() =>
                        onSua({ giam: dong.giam.filter((_, i) => i !== idx) })
                      }
                      title="Xoá khoản giảm này"
                      aria-label={`Xoá khoản giảm ${idx + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* ── CHẾ ĐỘ: theo CHƯƠNG TRÌNH hay GÕ RIÊNG [28/09/2026] ──────────
                    Chủ dự án: *"lấy đúng mã của chương trình giảm giá hiện tại để áp
                    dụng, không để ô nhập nữa"* — và khi được hỏi thẳng, chốt GIỮ đường
                    gõ tay làm chế độ thứ hai.

                    ⚠️ Vì sao KHÔNG bỏ hẳn ô nhập: đo 28/09 có **0 chương trình** trong
                    DB. Bỏ hẳn là hôm đó không ai giảm giá được đồng nào, và cổng
                    `orders.maxDiscountPercent` + "Giải trình bắt buộc" mất luôn thứ để
                    gác — hai cổng thật biến thành mã chết.

                    Chế độ suy từ `voucherId`, KHÔNG thêm state: một state song song với
                    dữ liệu là hai nguồn sự thật, và chúng sẽ lệch đúng lúc người dùng
                    xoá một khoản ở giữa mảng. */}
                {(() => {
                  const theoChuongTrinh = k.voucherId != null;
                  return (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(
                        [
                          [true, "Theo chương trình"],
                          [false, "Giảm riêng"],
                        ] as [boolean, string][]
                      ).map(([bat, nhan]) => (
                        <button
                          key={nhan}
                          type="button"
                          onClick={() => {
                            if (bat === theoChuongTrinh) return;
                            // Đổi chế độ là ĐẶT LẠI cả khoản, không giữ lại số cũ. Giữ
                            // lại là "15" đang nghĩa là 15% của chương trình bỗng thành
                            // 15% do sale tự khai — cùng con số, khác hẳn nguồn gốc, và
                            // không gì trên màn hình nói ra.
                            suaKhoan(
                              idx,
                              bat
                                ? (maChoDongNay[0]
                                    ? khaiGiamTuMa(maChoDongNay[0])
                                    : { kieu: KIEU_GIAM.SO_TIEN, giaTri: 0, lyDo: "", tranTien: null, voucherId: CHUA_CHON_MA })
                                : { kieu: KIEU_GIAM.SO_TIEN, giaTri: 0, lyDo: "", tranTien: null, voucherId: null },
                            );
                          }}
                          aria-pressed={bat === theoChuongTrinh}
                          className={`min-h-11 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors duration-150 ${
                            bat === theoChuongTrinh
                              ? "border-primary bg-primary text-white"
                              : "border-border bg-background hover:bg-muted"
                          }`}
                        >
                          {nhan}
                        </button>
                      ))}
                    </div>
                  );
                })()}

                {k.voucherId != null ? (
                  <div className="mt-2 space-y-1.5">
                    <Label className="text-xs">
                      Chương trình khuyến mãi *
                      <HelpHint>
                        Chỉ bày chương trình ĐANG hiệu lực, đúng cơ sở của đơn và đúng
                        khoá của dòng này. Số tiền do chương trình quyết — không sửa tay
                        được, và giải trình tự sinh từ mã văn bản.
                      </HelpHint>
                    </Label>
                    {maChoDongNay.length === 0 ? (
                      /* Luật 12 — nói THẬT vì sao trống, đừng bày một ô chọn rỗng rồi
                         để người dùng tự đoán. */
                      <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
                        Không có chương trình nào áp dụng được cho dòng này
                        {!dong.refId && " — chọn khoá học trước"}
                        {dong.refId && phamViCoSo.length === 0 && " — chọn cơ sở của đơn trước"}.
                        {maBiLoai.length > 0 && (
                          <>
                            {" "}
                            Có {maBiLoai.length} mã bị loại:{" "}
                            {maBiLoai
                              .map((x) => `${x.m.ma} (${NHAN_LY_DO_LOAI[x.lyDo].toLowerCase()})`)
                              .join(", ")}
                            .
                          </>
                        )}
                      </p>
                    ) : (
                      <>
                        <select
                          value={k.voucherId === CHUA_CHON_MA ? "" : k.voucherId}
                          onChange={(e) => {
                            const chon = maChoDongNay.find((m) => m.voucherId === e.target.value);
                            suaKhoan(
                              idx,
                              chon
                                ? khaiGiamTuMa(chon)
                                : { voucherId: CHUA_CHON_MA, giaTri: 0, tranTien: null, lyDo: "" },
                            );
                          }}
                          className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
                        >
                          <option value="">— Chọn chương trình —</option>
                          {maChoDongNay.map((m) => (
                            <option key={m.voucherId} value={m.voucherId}>
                              {m.maVanBan} · {m.ma} — {nhanMucUuDai(m)}
                            </option>
                          ))}
                        </select>
                        {maDangChon && (
                          <p className="text-xs text-muted-foreground">
                            {maDangChon.tenChuongTrinh} · hiệu lực đến{" "}
                            {ngayKetThuc(maDangChon.hieuLuc).split("-").reverse().join("/")}
                            {/* Chạm trần TIỀN của chương trình là chạy ĐÚNG chính sách,
                                nên không phải lỗi — nhưng phải nói ra, kẻo sale hứa
                                khách "15% của 10 triệu" khi trần chặn ở 800.000đ. */}
                            {daAp?.chamTranTien && (
                              <span className="ml-1 font-medium text-amber-600 dark:text-amber-500">
                                — chạm trần {maDangChon.giamToiDa?.toLocaleString("vi-VN")}đ của
                                chương trình
                              </span>
                            )}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                  {/* Cùng khuôn nút với "Hình thức lớp" ngay trên — hai bộ chọn trong
                      CÙNG một thẻ mà trông khác nhau thì mắt phải học hai lần.
                      `min-w-[4.5rem]` vì nhãn ngắn: để `Button` tự co thì nút "%" ra
                      rộng ~22px, đứng cạnh "Số tiền" trông như phần thừa của nút bên
                      cạnh chứ không như một lựa chọn. */}
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        [KIEU_GIAM.SO_TIEN, "Số tiền"],
                        [KIEU_GIAM.PHAN_TRAM, "Theo %"],
                      ] as [KieuGiam, string][]
                    ).map(([kieu, nhan]) => (
                      <button
                        key={kieu}
                        type="button"
                        onClick={() => suaKhoan(idx, { kieu, giaTri: 0 })}
                        aria-pressed={k.kieu === kieu}
                        className={`min-h-11 min-w-[4.5rem] whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors duration-150 ${
                          k.kieu === kieu
                            ? "border-primary bg-primary text-white"
                            : "border-border bg-background hover:bg-muted"
                        }`}
                      >
                        {nhan}
                      </button>
                    ))}
                  </div>
                  {/* Đổi kiểu thì ĐẶT LẠI giá trị về 0 (xem onClick trên). Giữ số cũ là
                      để "500000" đang nghĩa là 500.000đ bỗng thành 100% sau một cú bấm —
                      cùng con số, khác hẳn số tiền, và không gì trên màn hình nói ra. */}
                  {k.kieu === KIEU_GIAM.SO_TIEN ? (
                    <MoneyInput
                      name={`giamGia-${stt}-${idx + 1}`}
                      min={0}
                      value={k.giaTri}
                      onValueChange={(v) => suaKhoan(idx, { giaTri: v ?? 0 })}
                      placeholder="Số tiền giảm"
                    />
                  ) : (
                    // `max` = TRẦN CẤU HÌNH, không phải 100: nút tăng/giảm của ô số
                    // dừng ngay ở mức chính sách. Vẫn kẹp trong `onChange` vì người
                    // dùng gõ tay được con số bất kỳ, `max` chỉ chặn mũi tên.
                    <div className="space-y-1">
                      <Input
                        type="number"
                        min={0}
                        max={tranPhanTram}
                        value={k.giaTri}
                        onChange={(e) =>
                          suaKhoan(idx, {
                            giaTri: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        placeholder={`% giảm (1–${tranPhanTram})`}
                      />
                      {/* Nói NGAY, không chờ bấm Lưu. `gopGiamGia` đã kẹp xuống trần nên
                          con số luôn đúng chính sách, nhưng người bán vừa gõ một mức
                          khác — im lặng là để họ đi hứa với phụ huynh mức đã gõ. */}
                      {daAp?.vuotTran && (
                        <p className="text-xs font-medium text-state-danger-ink">
                          Vượt trần {tranPhanTram}% — sửa lại để lưu được đơn
                        </p>
                      )}
                    </div>
                  )}
                </div>
                )}

                {/* Giải trình theo TỪNG KHOẢN. Cơ chế duyệt đã gỡ 14/09 — dòng chữ này
                    chính là thứ thay thế nó, nên nó phải nói được vì sao có ĐÚNG khoản
                    này, không phải vì sao dòng được bớt nói chung. */}
                {/* ⚠️ Ô "LOẠI ƯU ĐÃI" ĐÃ GỠ [chủ dự án chốt 24/09/2026].
                    *"bỏ ô loại ưu đãi đi vì nó chả có tác dụng gì, vì phải giải trình ở dưới rồi"*.

                    Đo trước khi gỡ, và số đo ủng hộ: `NHAN_LOAI_GIAM` chỉ được dùng ở ĐÚNG
                    form này — không màn nào, không báo cáo nào đọc lại nhãn đó. Chính chú
                    thích của trường cũng tự khai "NHÃN, không tham gia phép tính nào" và
                    "_actions.ts` không đọc nó để quyết một đồng nào". Tức nó được GHI XUỐNG
                    mà chưa từng được ĐỌC LẠI — một trường bắt người dùng chọn cho một mục
                    đích không tồn tại.

                    ⚠️ CHỈ gỡ Ô NHẬP. Cột `loai` trong `OrderItem.discounts` GIỮ NGUYÊN, và
                    `docLoaiGiam` ở server vẫn nhận: khoản giảm cũ đã có nhãn thì đừng làm
                    mất, và hai đường ghi khác (`_actions.ts:2330`, `:2362`) vẫn truyền nó.
                    Ngày nào cần thống kê theo loại thì dựng lại ô này, dữ liệu cũ còn đó. */}
                {/* Ô giải trình CHỈ hiện ở chế độ gõ riêng. Theo chương trình thì câu
                    giải trình là MÃ VĂN BẢN (`lyDoTuMa`) — sale không phải gõ lại, và
                    không gõ sai được. Bày một ô đã điền sẵn và khoá là bày một ô vô
                    dụng; bày một ô sửa được là mời người ta sửa cho lệch với văn bản. */}
                {k.voucherId == null && (
                <div className="mt-2 space-y-1.5">
                  <Label className="text-xs">
                    Giải trình *
                    <HelpHint>
                      Ghi rõ chương trình và ai đã đồng ý (VD: &ldquo;em ruột HV Sata2,
                      chị Lan CS1 đồng ý&rdquo;). Đây là dấu vết duy nhất còn lại của
                      khoản bớt này — &ldquo;ưu đãi&rdquo; chung chung thì sáu tháng sau
                      không ai giải thích được cho kế toán.
                    </HelpHint>
                  </Label>
                  <Input
                    value={k.lyDo ?? ""}
                    onChange={(e) => suaKhoan(idx, { lyDo: e.target.value })}
                    maxLength={1000}
                    placeholder="VD: em ruột HV Sata2 — ưu đãi theo chính sách anh chị em"
                  />
                </div>
                )}
              </div>
            );
          })}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={dong.giam.length >= TRAN_KHOAN_GIAM_MOI_DONG}
          title={
            dong.giam.length >= TRAN_KHOAN_GIAM_MOI_DONG
              ? `Tối đa ${TRAN_KHOAN_GIAM_MOI_DONG} khoản giảm mỗi dòng`
              : "Thêm một khoản giảm nữa cho dòng này"
          }
          onClick={() =>
            onSua({
              // MẶC ĐỊNH LÀ "THEO CHƯƠNG TRÌNH" khi dòng này có chương trình dùng được
              // [28/09/2026]. Chủ dự án chốt lấy mã của chương trình làm đường chính, ô
              // gõ tay chỉ còn là đường thoát — nên mặc định phải là đường chính, không
              // phải đường thoát.
              //
              // KHÔNG chọn sẵn mã nào (`CHUA_CHON_MA`): chọn hộ là sale bấm Lưu mà chưa
              // đọc, và khoản giảm đầu tiên trong danh sách chưa chắc là khoản đúng.
              // Cổng ở action từ chối `""` cho ra tiếng, nên bỏ quên không lọt im lặng.
              //
              // Không có chương trình nào ⇒ rơi về gõ tay, vì bày một chế độ trống rỗng
              // là bắt sale bấm thêm một nút để tới chỗ họ buộc phải tới.
              giam: [
                ...dong.giam,
                maChoDongNay.length > 0
                  ? { kieu: KIEU_GIAM.SO_TIEN, giaTri: 0, lyDo: "", tranTien: null, voucherId: CHUA_CHON_MA }
                  : { kieu: KIEU_GIAM.SO_TIEN, giaTri: 0, lyDo: "" },
              ],
            })
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Thêm khoản giảm
        </Button>
      </div>
    </div>
  );
}
