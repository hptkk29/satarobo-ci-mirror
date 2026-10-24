// lib/integrations/zalocrm/compose-url.ts — S2: địa chỉ "Nhắn Zalo" dựng từ phiếu lead.
//
// Sale đang đọc phiếu khách, bấm một nút, sang thẳng hộp soạn tin của ZaloCRM với đúng
// số của khách đó. Toàn bộ phần "đúng số" nằm ở file này.
//
// 🔴 VÌ SAO PHẢI LÀ MỘT HÀM RIÊNG, KHÔNG GHÉP CHUỖI TẠI CHỖ. Chặng nhận ở giữa
// (`duongDanNhungZaloCrm`, `sso.ts`) lọc tham số `compose` bằng `/^84\d{8,10}$/` và
// **BỎ HẲN tham số** khi sai khuôn — không ném lỗi, không cảnh báo. Nên mọi dạng sai
// (`0912…`, `+84912…`, chuỗi rỗng của lead Facebook, bản SĐT đã che `090xxxx456`) đều
// cho ra đúng một triệu chứng: hộp soạn tin mở TRỐNG. Sale sẽ báo "ZaloCRM không tìm ra
// khách" chứ không ai nghĩ tới cái nút. Hỏng câm chỉ khoá được bằng test, và test chỉ
// khoá được thứ nằm trong một hàm thuần — đó là lý do file này tồn tại thay vì một
// template string trong JSX.
//
// ⚠️ MODULE THUẦN: không `server-only`, không `db`, không `process.env`. Nó được gọi từ
// Server Component nhưng phải chạy được trong `vitest` mặc định (glob `lib/**`).
//
// Phần "AI được thấy nút" KHÔNG ở đây — đó là việc của chỗ gọi (`canViewPii` +
// `zalocrm:use`, chấm ở server). File này chỉ trả lời: dựng được địa chỉ hợp lệ không.
import { canonicalPhone } from "@/lib/phone";

/**
 * Đường dẫn màn ZaloCRM nhúng. **Không có tiền tố `/admin`** — host `admin.satarobo.vn`
 * phục vụ route group `(admin)` ở GỐC (cùng quy ước với `href` trong sidebar và
 * `PAGE_GATES`; chỉ `revalidatePath` mới cần tiền tố).
 */
export const DUONG_DAN_ZALO_CRM = "/zalo-crm";

/**
 * Khuôn SĐT mà ZaloCRM chấp nhận cho tham số `compose`: `84XXXXXXXXX`, không dấu `+`,
 * không số `0` đầu.
 *
 * ⚠️ Đây là BẢN SAO CÓ CHỦ ĐÍCH của `KHUON_SDT_84` trong `sso.ts` (bên đó là hằng nội
 * bộ của module, không xuất ra). Chép một regex là nợ, nhưng nợ này rẻ hơn thứ nó mua:
 * ca [ZC-CU-06] dùng chính hằng này để kiểm rằng đầu ra của `canonicalPhone` LỌT được
 * cổng bên kia. Ngày nào định dạng canonical đổi, ca đó đỏ ngay — thay vì hộp soạn tin
 * âm thầm mở trống trên prod. Sửa khuôn ở đây thì phải sửa cả `sso.ts`, và ngược lại.
 */
export const KHUON_COMPOSE_ZALOCRM = /^84\d{8,10}$/;

/**
 * Khuôn `orgCode` — NGUỒN DUY NHẤT cho cả hai chiều: nút này dựng `?org=`, và
 * `chonCoSoZaloCrm` bên màn nhúng đọc nó. Đặt ở module thuần này để hai bên không trôi
 * khỏi nhau; bên kia `import` vào chứ không chép lại.
 */
export const KHUON_ORG_CODE = /^[a-z0-9-]{1,32}$/;

/**
 * Tra `orgCode` bên ZaloCRM từ mã cơ sở của phiếu lead.
 *
 * Trả `null` khi: phiếu chưa gắn cơ sở · cơ sở chưa đặt `Center.code` · cơ sở chưa được
 * ánh xạ trong `zalocrm.orgCodes` · giá trị ánh xạ sai khuôn. **`null` không phải lỗi** —
 * nó chỉ có nghĩa "không nói được cơ sở nào", và nút sẽ mở cơ sở đầu tiên y như trước.
 * Đó là lối lùi có chủ đích: một bảng ánh xạ thiếu một dòng KHÔNG được làm biến mất cái
 * nút mà Sale đang dùng hằng ngày.
 */
export function orgCodeCuaCoSo(
  centerCode: string | null | undefined,
  orgCodes: Readonly<Record<string, string>> | null | undefined,
): string | null {
  if (typeof centerCode !== "string" || !centerCode || !orgCodes) return null;
  const org = orgCodes[centerCode];
  if (typeof org !== "string" || !KHUON_ORG_CODE.test(org)) return null;
  return org;
}

/**
 * Dựng địa chỉ mở hộp soạn tin ZaloCRM cho một phiếu lead, hoặc `null` khi không dựng
 * được — **`null` nghĩa là ĐỪNG RENDER NÚT**, không phải "render nút trỏ vào chỗ trống".
 *
 * Trả `null` khi số không phải di động VN hợp lệ. Ca hay gặp nhất KHÔNG phải dữ liệu
 * rác: `Lead.phone` là cột NOT NULL nhưng **được phép rỗng** — lead quảng cáo Facebook
 * chỉ có link FB, chưa xin được số. Render nút vô điều kiện cho nhóm này là mỗi cú bấm
 * đốt một lượt tra số của ZaloCRM (`PhoneSearchEvent`, tính vào hạn mức Zalo của công
 * ty) cho một truy vấn chắc chắn không ra ai.
 *
 * @param sdt   SĐT THÔ của phiếu (`lead.phone`) — **không bao giờ truyền bản đã che**
 *              (`piiLead.phone`): mặt nạ `090xxxx456` không chuẩn hoá được nên hàm trả
 *              `null` và nút biến mất, đúng kiểu hỏng lặng mà [S-1] đã bắt ở màn chốt đơn.
 * @param leadId Mã phiếu, đi kèm để ZaloCRM/nhật ký biết tin này thuộc khách nào. Rỗng
 *              thì bỏ hẳn tham số — `&lead=` trống bắt phía nhận phải đoán.
 * @param orgCode Cơ sở của chính phiếu này (qua `orgCodeCuaCoSo`). **Thiếu nó là lỗi
 *              THẤY ĐƯỢC với người kiêm nhiều cơ sở:** màn nhúng mở cơ sở đầu bảng chữ
 *              cái, nên Sale kiêm CS1+CS2 bấm từ phiếu CS2 sẽ nhắn bằng nick CS1 — và
 *              dòng "đặt trước" (`datTruocLuongZalo`) bị từ chối vì lệch cơ sở, tức hội
 *              thoại KHÔNG tự nối vào phiếu nữa. Đó là toàn bộ giá trị của cái nút.
 *              Giá trị lạ vẫn an toàn: màn nhúng coi `?org=` là dữ liệu người dùng và
 *              chỉ dùng để TRA trong danh sách cơ sở người này nhìn thấy.
 */
export function duongDanNhanZalo(
  sdt: unknown,
  leadId: string | null | undefined,
  orgCode?: string | null,
): string | null {
  const so = canonicalPhone(sdt);
  if (!so) return null;

  // Bất biến, không phải phép kiểm dữ liệu: `canonicalPhone` luôn trả `84` + 9 chữ số.
  // Giữ lại vì cổng bên kia im lặng — nếu định dạng canonical đổi mà không ai để ý, thà
  // không có nút còn hơn có một nút mở hộp soạn tin trống.
  if (!KHUON_COMPOSE_ZALOCRM.test(so)) return null;

  // `URLSearchParams` chứ không ghép chuỗi: mã phiếu là dữ liệu, và dữ liệu mang `&`
  // hay `=` không được phép đẻ thêm tham số trên URL.
  const tham = new URLSearchParams({ compose: so });
  const ma = typeof leadId === "string" ? leadId.trim() : "";
  if (ma) tham.set("lead", ma);

  // Sai khuôn thì BỎ tham số chứ không trả `null`: mất `?org=` chỉ làm mở nhầm cơ sở,
  // còn trả `null` là mất luôn cái nút — hỏng nặng hơn thứ đang vá.
  const org = typeof orgCode === "string" ? orgCode.trim() : "";
  if (org && KHUON_ORG_CODE.test(org)) tham.set("org", org);

  return `${DUONG_DAN_ZALO_CRM}?${tham.toString()}`;
}
