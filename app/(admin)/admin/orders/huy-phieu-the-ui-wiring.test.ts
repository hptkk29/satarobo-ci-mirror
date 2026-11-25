// Ca [HN4-UW1..UW5] — LƯỚI GHIM MÃ NGUỒN cho giao diện "Huỷ phiếu thẻ" (Việc 4, 09/10/2026). THUẦN.
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §6.4 + §6.8. Thứ cần khoá là DÂY NỐI và các luật mà test hành vi (`payment-requests-huy-the.test.tsx`)
// không chạm tới được — luật 11: một prop BẮT BUỘC không ai truyền, hoặc một lời gọi bị gỡ khỏi hộp, vẫn để mọi test hàm thuần xanh.
// Bóc chú thích TRƯỚC khi đếm (chú thích giải thích bản vá hay chứa đúng chuỗi đang cấm), khẳng định SỐ LẦN khớp, neo vào BIỂU THỨC
// chứ không vào chỗ đặt chữ. Mỗi ca ghi mã TRƯỚC bản vá trông thế nào.
//
// Đọc tệp bằng `docOrRong`: tệp chưa tồn tại ⇒ chuỗi rỗng ⇒ từng ca đỏ ở ĐÚNG khẳng định của nó (không phải một lỗi ENOENT cho cả bộ).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function bocChuThich(v: string): string {
  return v
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/[^\n]*$/, "$1"))
    .join("\n");
}

function docOrRong(tep: string): string {
  try {
    return bocChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
  } catch {
    return "";
  }
}
const dem = (ma: string, re: RegExp) => [...ma.matchAll(new RegExp(re.source, "g"))].length;

/** Cắt thân MỘT hàm cấp module: từ `function <ten>(` tới `function` cấp module kế tiếp (hoặc hết tệp). */
function thanHam(ma: string, ten: string): string {
  const dau = ma.search(new RegExp(`^(export )?function ${ten}\\b`, "m"));
  if (dau < 0) return "";
  const sau = ma.slice(dau + 1).search(/^(export )?(async )?function \w/m);
  return sau < 0 ? ma.slice(dau) : ma.slice(dau, dau + 1 + sau);
}

const HOP = docOrRong("app/(admin)/admin/orders/_components/hop-phieu-pos.tsx");
const NUT = docOrRong("app/(admin)/admin/orders/_components/huy-phieu-the-dialog.tsx");
const BANG = docOrRong("app/(admin)/admin/orders/_components/payment-requests-section.tsx");

/**
 * LƯỚI NẢY NỞ KHI GHÉP VIỆC 3 (docs §6.12, ghi lại ở §7.8). Việc 3 thêm cho `NoiDungPhieu` một trạng thái `choLamMoi` — "sale vừa GỬI yêu cầu nhập
 * sai mã, trang mới CHƯA về": props vẫn là CHO_QUET + `huyDuoc: true` (tính ở lượt tải trước) trong khi phiếu thật đã sang CAN_XU_LY. Lúc đó nút
 * "Huỷ phiếu thẻ" PHẢI biến mất — không thì màn mời bấm một nút mà máy chủ chắc chắn từ chối (luật 12), và đó đúng là cửa sổ nguy hiểm nhất (khách đã
 * quẹt xong).
 *
 * LƯỢT GHÉP 10/10/2026 ĐỔI CÁCH GIỮ: bản đầu ghim `dangBan={… || choLamMoi}` (khoá nút). Nay `choLamMoi` đi vào `nutTrongHopPhieuThe` và nút KHÔNG ĐƯỢC VẼ
 * (khoá nút cạnh câu "Đã gửi kế toán…" là affordance nói dối kiểu khác, và trang mới về cũng không có nó). Lý lẽ của lưới (cửa sổ ấy không được có nút huỷ
 * sáng) giữ NGUYÊN; chỉ cách hiện thực đổi, nên lưới ghim cái đích — `choLamMoi` có mặt trong lời gọi hàm quyết — chứ không ghim chỗ đặt chữ.
 * Trả `null` = ổn; chuỗi = lỗi.
 */
function loiThieuChoLamMoi(noiDungPhieu: string): string | null {
  if (!/\bchoLamMoi\b/.test(noiDungPhieu)) return null;
  const doiSo = noiDungPhieu.match(/\bnutTrongHopPhieuThe\(\{([\s\S]*?)\}\)/)?.[1];
  if (doiSo === undefined) return "không có lời gọi `nutTrongHopPhieuThe({…})`";
  // Phải truyền CHÍNH biến `choLamMoi` (thuộc tính rút gọn hoặc `choLamMoi: choLamMoi`) — `choLamMoi: false` có chữ `choLamMoi` mà vô nghĩa: phép cấy
  // "gõ cứng false" từng lọt qua regex chỉ đếm chữ (đo ở lượt cấy lỗi ghép 10/10/2026).
  return /(?:^|[\s,{])choLamMoi\s*(?:,|$)|\bchoLamMoi\s*:\s*choLamMoi\b/.test(doiSo) ? null : `lời gọi nutTrongHopPhieuThe({${doiSo.replace(/\s+/g, " ")}}) không truyền biến choLamMoi`;
}

describe("[HN4-UW] dây nối hộp phiếu thẻ → nút 'Huỷ phiếu thẻ'", () => {
  it("[HN4-UW1] hộp vẽ `<NutHuyPhieuThe>` ĐÚNG MỘT lần, TRONG `NoiDungPhieu` (không ở bước chọn máy, không ở hộp ngoài), truyền đủ bốn prop", () => {
    // Mã TRƯỚC bản vá: không có — hộp không có nút huỷ, hộp "Thẻ POS" bấm nhầm khoá cả đơn tới 24 giờ.
    expect(dem(HOP, /<NutHuyPhieuThe\b/)).toBe(1);
    expect(HOP).toMatch(/import \{[^}]*\bNutHuyPhieuThe\b[^}]*\} from "\.\/huy-phieu-the-dialog"/);
    expect(dem(thanHam(HOP, "NoiDungPhieu"), /<NutHuyPhieuThe\b/), "nút nằm trong phần nội dung phiếu").toBe(1);
    expect(dem(thanHam(HOP, "BuocChonMay"), /<NutHuyPhieuThe\b/), "bước chọn máy chưa có phiếu nào để huỷ").toBe(0);
    expect(dem(thanHam(HOP, "HopPhieuPos"), /<NutHuyPhieuThe\b/), "hộp ngoài không tự vẽ nút").toBe(0);
    const thanh = HOP.match(/<NutHuyPhieuThe\b[\s\S]*?\/>/)?.[0] ?? "";
    for (const p of ["orderId={orderId}", "phieu={phieu}", "dangBan=", "onBoKetQuaCu={onBoKetQuaCu}"]) {
      expect(thanh, `truyền ${p}`).toContain(p);
    }
    // GHÉP (10/10/2026): nút chỉ được vẽ khi HÀM THUẦN nói `NUT` — không điều kiện nào khác do component tự viết.
    expect(dem(HOP, /\{nut\.huyPhieuThe === "NUT" && \(\s*<NutHuyPhieuThe\b/), "nút nằm sau cổng của hàm quyết").toBe(1);
  });

  it("[HN4-UW2] `orderId` + `onBoKetQuaCu` đi từ hộp ngoài xuống `NoiDungPhieu`, khai BẮT BUỘC (không `?`, không mặc định) — luật 11", () => {
    // `onBoKetQuaCu` là thứ gỡ câu "Chưa thấy…" của lượt Kiểm tra cũ khỏi `useState` — `router.refresh()` không reset state, nên thiếu
    // nó thì sau khi huỷ hộp vẫn in câu cũ che câu "đã huỷ" (ca `[HN4-U03b]` bắt hành vi; ca này bắt DÂY).
    const ngoai = thanHam(HOP, "HopPhieuPos");
    const trong = thanHam(HOP, "NoiDungPhieu");
    expect(ngoai).toMatch(/<NoiDungPhieu[\s\S]*?\borderId=\{orderId\}/);
    // GHÉP (10/10/2026): hai đường cùng "bỏ câu Kiểm tra cũ" (gửi sai mã thành công · huỷ phiếu thẻ) đi qua MỘT hàm `boCauKiemCu` — bản trước chép hai lần
    // `datVuaKiem(null); datVuaKiemCua(null);` và lưới `[HN3-UW2]` (đếm đúng MỘT lần) đỏ ngay khi ghép. Mã TRƯỚC ghép: `onBoKetQuaCu={() => { … }}` nội tuyến.
    expect(ngoai).toMatch(/<NoiDungPhieu[\s\S]*?\bonBoKetQuaCu=\{boCauKiemCu\}/);
    // Neo hàm gom + NỘI DUNG (mỗi state bị bỏ đúng một lần), không neo THỨ TỰ hai lời gọi (đảo chỗ là refactor vô hại).
    const thanBo = ngoai.match(/function boCauKiemCu\(\) \{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
    expect(dem(ngoai, /function boCauKiemCu\(\)/), "hàm gom khai ĐÚNG một lần").toBe(1);
    expect(dem(thanBo, /\bdatVuaKiem\(null\);/), "bỏ câu vừa kiểm").toBe(1);
    expect(dem(thanBo, /\bdatVuaKiemCua\(null\);/), "bỏ cả phiếu mà câu ấy thuộc về").toBe(1);
    expect(dem(trong, /\borderId: string;/), "khai bắt buộc").toBe(1);
    expect(dem(trong, /\bonBoKetQuaCu: \(\) => void;/), "khai bắt buộc").toBe(1);
    expect(dem(trong, /\borderId\?:/)).toBe(0);
    expect(dem(trong, /\bonBoKetQuaCu\?:/)).toBe(0);
    expect(dem(trong, /\bonBoKetQuaCu\s*=\s*\(/), "không mặc định").toBe(0);
  });

  it("[HN4-UW3] dòng 'Chưa huỷ được phiếu thẻ' vẽ ĐÚNG MỘT lần trong `NoiDungPhieu`; footer ẩn khi phiếu đã HUY (không để dải rỗng)", () => {
    const trong = thanHam(HOP, "NoiDungPhieu");
    expect(dem(trong, /<DongKhongHuyDuoc\b/)).toBe(1);
    expect(dem(thanHam(HOP, "HopPhieuPos"), /<DongKhongHuyDuoc\b/)).toBe(0);
    // "Có in dòng này không" do HÀM THUẦN quyết (`nutTrongHopPhieuThe` → "DONG_LY_DO") — component dòng không tự so trạng thái (`[HN4-UW4]`).
    // Mã TRƯỚC ghép: `<DongKhongHuyDuoc huy={…} dangChoQuet={h === "CHO_QUET" || h === "THAT_BAI"} />` — sau từ chối nó in dòng "ĐỪNG cho khách quẹt lại"
    // thứ hai ngay dưới dòng cảnh báo của Việc 3 (`[HN3-R11]` đỏ). Prop `dangChoQuet` đã GỠ: quyết định không còn hai nơi.
    // Rà ghép 10/10/2026: neo từng BIỂU THỨC (cổng · nguồn của `huy` · nguồn của `canh`) và khoảng cách cổng→component, KHÔNG neo dấu ngoặc / thẻ bọc — dòng lý do nay vẽ trong
    // một khung `mt-2.5` và nhận `canh` (tiền đang bay ⇒ tông cảnh báo). Cổng vẫn là kết quả của hàm thuần, đúng một chỗ, đứng TRƯỚC component.
    expect(dem(trong, /nut\.huyPhieuThe === "DONG_LY_DO"/), "đúng MỘT cổng").toBe(1);
    expect(dem(trong, /<DongKhongHuyDuoc\b[^>]*\bhuy=\{phieu\.huyPhieuThe\}/), "nguồn của `huy`").toBe(1);
    expect(dem(trong, /<DongKhongHuyDuoc\b[^>]*\bcanh=\{nut\.tienDangBay\}/), "tông cảnh báo theo hàm thuần, không tự so").toBe(1);
    const iCong = trong.search(/nut\.huyPhieuThe === "DONG_LY_DO"/);
    const iDong = trong.search(/<DongKhongHuyDuoc\b/);
    expect(iDong - iCong, "component nằm SAU cổng, cùng một khối").toBeGreaterThan(0);
    expect(iDong - iCong, "…và không có khối nào khác chen giữa").toBeLessThan(160);
    expect(dem(trong, /\bdangChoQuet\b/), "prop cũ đã gỡ").toBe(0);
    expect(dem(NUT, /\bdangChoQuet\b/), "component dòng không còn tự nhận cờ chờ quẹt").toBe(0);
    expect(trong, "footer mang `hidden` khi h === \"HUY\"").toMatch(/<DialogFooter[^>]*\bh === "HUY" && "hidden"/);
  });

  it("[HN4-UW4] hộp xác nhận: `admin-scope` trên DialogContent · gọi `huyPhieuTheAction` đúng MỘT lần · ĐỌC `canXacNhanManh` (không hard-code) · không tự tính luật huỷ", () => {
    // Mã đã tránh: `canXacNhanManh = true` gõ cứng (hôm nay đúng, ngày mai `choPhepHuyPhieuThe` thêm ca "thường" là màn đòi tick
    // một việc không cần); `trangThai === "HUY"` ở component (hai nơi quyết "huỷ được không" là hai nơi có ngày cãi nhau).
    expect(NUT).toMatch(/<DialogContent[^>]*className="[^"]*\badmin-scope\b/);
    expect(dem(NUT, /\bhuyPhieuTheAction\(/)).toBe(1);
    expect(NUT).toMatch(/import \{[^}]*\bhuyPhieuTheAction\b[^}]*\} from "\.\.\/_actions"/);
    expect(dem(NUT, /\.canXacNhanManh\b/), "đọc trường của hợp đồng").toBeGreaterThanOrEqual(1);
    expect(dem(NUT, /\bhuyDuoc\b/), "đọc phán quyết của hàm thuần").toBeGreaterThanOrEqual(1);
    expect(dem(NUT, /\bchoPhepHuyPhieuThe\b/), "component không tự gọi hàm luật").toBe(0);
    expect(dem(NUT, /\b(trangThai|hienThi)\s*[!=]==/), "component không so trạng thái để quyết nút").toBe(0);
    expect(dem(NUT, /xacNhanKhachChuaQuet:\s*f\.daTick\b/), "gửi ĐÃ TICK, không phải hằng").toBe(1);
    expect(dem(NUT, /xacNhanKhachChuaQuet:\s*(true|false)\b/), "không gõ cứng cờ").toBe(0);
  });

  it("[HN4-UW6] khi hộp có `choLamMoi` (Việc 3 vừa gửi, trang chưa về) thì lời gọi `nutTrongHopPhieuThe` PHẢI truyền nó — kèm ĐỐI CHỨNG để lưới biết cắn", () => {
    const trong = thanHam(HOP, "NoiDungPhieu");
    // Sau ghép Việc 3 ca này BẬT thật: `NoiDungPhieu` có `choLamMoi`, nên lời gọi hàm quyết phải mang nó.
    expect(trong).toMatch(/\bchoLamMoi\b/);
    expect(loiThieuChoLamMoi(trong)).toBeNull();
    // Chứng minh lưới có răng — bốn mẫu tổng hợp:
    const goi = (doiSo: string) => `const nut = nutTrongHopPhieuThe({ ${doiSo} });`;
    expect(loiThieuChoLamMoi(`choLamMoi: boolean; ${goi("hienThi: h, nutSaiMa, daBiTuChoi")}`), "Việc 3 đã vào mà quên nối ⇒ ĐỎ").not.toBeNull();
    expect(loiThieuChoLamMoi(`choLamMoi: boolean; ${goi("hienThi: h, nutSaiMa, daBiTuChoi, choLamMoi")}`), "nối đủ ⇒ xanh").toBeNull();
    expect(loiThieuChoLamMoi(`choLamMoi: boolean; ${goi("hienThi: h, nutSaiMa, daBiTuChoi, choLamMoi: choLamMoi")}`), "viết đầy đủ ⇒ xanh").toBeNull();
    expect(loiThieuChoLamMoi(`choLamMoi: boolean; ${goi("hienThi: h, nutSaiMa, daBiTuChoi, choLamMoi: false")}`), "gõ cứng false ⇒ ĐỎ (có chữ mà vô nghĩa)").not.toBeNull();
    expect(loiThieuChoLamMoi(`choLamMoi: boolean; const x = 1;`), "có choLamMoi mà không gọi hàm quyết ⇒ ĐỎ").not.toBeNull();
    expect(loiThieuChoLamMoi(goi("hienThi: h")), "chưa có Việc 3 ⇒ xanh (không gì để nối)").toBeNull();
  });

  it("[HN4-UW5] nhãn 'Thẻ đang chờ' (người không có quyền) lấy câu `DANG_CHO` từ `cauKhongHuyDuoc` — MỘT nguồn với panel QR, không gõ lại", () => {
    // Mã TRƯỚC bản vá: title gõ tay "…chưa huỷ được mã. Nhờ người có quyền thu thẻ kiểm tra kết quả" — đúng khi chưa có nút huỷ.
    expect(NUT).toMatch(/DANG_CHO:\s*cauKhongHuyDuoc\("DANG_CHO",\s*\{\s*duocThuThePos:\s*false,\s*phieuPos:\s*null\s*\}\)/);
    expect(dem(BANG, /\bTITLE_THE_DANG_CHO_CHI_BAO\[nut\.the\]/), "bảng dùng bảng title, không gõ lại").toBe(1);
    expect(dem(NUT, /Nhờ người có quyền thu thẻ kiểm tra kết quả/), "câu cũ chỉ còn đúng ở kiểu CHƯA KẾT LUẬN").toBe(1);
    expect(dem(BANG, /Nhờ người có quyền thu thẻ kiểm tra kết quả/), "bảng không còn chuỗi gõ tay").toBe(0);
    // `[POS1-UI-W2]` đếm KHAI BÁO `duocThuThePos` / `phieuPos` ở bảng đúng MỘT lần (dòng `tên: kiểu;`) — ngữ cảnh "không quyền" nằm ở tệp nút, không ở đây.
    expect(dem(BANG, /(?:^|\n)[ \t]*duocThuThePos:[ \t][^;\n]+;/)).toBe(1);
    expect(dem(BANG, /(?:^|\n)[ \t]*phieuPos:[ \t][^;\n]+;/)).toBe(1);
  });
});
