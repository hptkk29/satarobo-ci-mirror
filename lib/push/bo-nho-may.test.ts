// @vitest-environment jsdom
/**
 * `lib/push/bo-nho-may.ts` — hai mẩu trạng thái nằm trong TRÌNH DUYỆT (Đợt 6).
 *
 * Bộ này canh bốn thứ mà mắt người không giữ nổi:
 *
 *  1. **MỌI KHOÁ MANG THEO NGƯỜI.** Đây là bản vá của hai lỗ máy-dùng-chung mà lăng kính Đợt 6
 *     đo được: khoá theo ORIGIN thì một người bấm "Tắt" là bịt miệng mọi người khác dùng chung
 *     trình duyệt đó, và mốc "đã đồng bộ" (sessionStorage SỐNG QUA đăng xuất trong cùng tab) chặn
 *     đúng cú chuyển chủ ⇒ lead của người trước nổ trên màn hình khoá của người sau.
 *  2. **CHIỀU SAI AN TOÀN của từng hàm.** Hai hàm đọc fail sang hai chiều NGƯỢC NHAU, mỗi chiều
 *     được chọn vì lý do riêng: `daTatTayOMayNay` fail sang `true` ("đừng tự bật lại"),
 *     `daDongBoTrongPhien` fail sang `false` ("cứ ghi thêm một lượt"). Đổi chiều một trong hai là
 *     đổi hành vi của cả đường tự đăng ký lại, mà không có triệu chứng nào ở giao diện.
 *  3. **KHO CHỨA của từng mẩu.** `da-tat-tay` phải sống qua việc đóng tab (`localStorage`);
 *     `da-dong-bo` phải CHẾT theo tab (`sessionStorage`). Đặt `da-dong-bo` vào `localStorage` là
 *     khoá cứng vĩnh viễn: một dòng bị thu hồi ở nơi khác sẽ không bao giờ được dựng lại.
 *  4. **KHÔNG NÉM.** Cửa sổ riêng tư và "chặn site data" làm mọi lời gọi storage ném; một lỗi lọt
 *     ra ngoài là làm trắng màn hình cho một tính năng cộng thêm.
 *
 * ⚠️ Storage phải TỰ DỰNG — xem `tests/_helpers/storage-gia.ts` để biết vì sao (không dựng thì
 * mọi ca dưới đây đi nhánh `catch` và bộ test xanh mà chẳng kiểm gì).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  daDongBoTrongPhien,
  daTatTayOMayNay,
  datDaDongBo,
  datTatTay,
  xoaTatTay,
} from "./bo-nho-may";
import {
  camCaHaiKho,
  camStorage,
  storageNem,
  traStorage,
} from "@/tests/_helpers/storage-gia";

const A = "usr_sale_a";
const B = "usr_sale_b";
const BAM = "aaaaaaaaaaaaaaaa";
const BAM2 = "bbbbbbbbbbbbbbbb";

beforeEach(camCaHaiKho);
afterEach(traStorage);

describe("[PUSH-D6-T01] cờ 'người dùng này đã tự tắt thông báo trên máy này'", () => {
  it("mặc định là CHƯA tắt — máy mới không bị khoá khỏi đường tự đăng ký lại", () => {
    expect(daTatTayOMayNay(A)).toBe(false);
  });

  it("bấm tắt ⇒ true; bấm bật lại ⇒ false", () => {
    datTatTay(A);
    expect(daTatTayOMayNay(A)).toBe(true);
    xoaTatTay(A);
    expect(daTatTayOMayNay(A)).toBe(false);
  });

  it("⚠️ CỜ THEO NGƯỜI: A tắt thì B trên CÙNG máy vẫn được tự đăng ký", () => {
    // CA QUAN TRỌNG NHẤT CỦA TỆP. Khoá theo ORIGIN (bản đầu của Đợt 6) nghĩa là: Sale A bấm "Tắt
    // trên máy này" cuối buổi ⇒ sáng sau Sale B đăng nhập trên đúng máy lễ tân đó và KHÔNG BAO
    // GIỜ được đăng ký lại, trong khi màn hình vẫn hứa "thông báo sẽ tới máy này". Một người tắt
    // là bịt miệng mọi người còn lại dùng chung trình duyệt đó — im lặng.
    datTatTay(A);
    expect(daTatTayOMayNay(A)).toBe(true);
    expect(daTatTayOMayNay(B)).toBe(false);
  });

  it("xoá cờ của A không xoá cờ của B", () => {
    datTatTay(A);
    datTatTay(B);
    xoaTatTay(A);
    expect(daTatTayOMayNay(A)).toBe(false);
    expect(daTatTayOMayNay(B)).toBe(true);
  });

  it("nằm ở localStorage (sống qua việc đóng tab), KHÔNG ở sessionStorage", () => {
    // Nếu cờ này chết theo tab thì người dùng tắt thông báo, mở tab mới, và nó tự bật lại —
    // đúng kiểu lỗi khiến người ta đi chặn quyền ở cấp trình duyệt.
    datTatTay(A);
    expect(localStorage.getItem(`satarobo:push:da-tat-tay:${A}`)).toBe("1");
    expect(sessionStorage.getItem(`satarobo:push:da-tat-tay:${A}`)).toBeNull();
  });

  it("KHÔNG BIẾT người dùng là ai ⇒ trả TRUE (fail-closed), và KHÔNG ghi gì", () => {
    // Đường tự đăng ký lại tuyệt đối không được ghi bằng một danh tính không rõ.
    for (const x of ["", null, undefined]) expect(daTatTayOMayNay(x)).toBe(true);
    datTatTay("");
    xoaTatTay(null);
    expect(localStorage.getItem("satarobo:push:da-tat-tay:")).toBeNull();
    expect(localStorage.getItem("satarobo:push:da-tat-tay")).toBeNull();
  });

  it("KHÔNG ĐỌC ĐƯỢC storage ⇒ trả TRUE (fail sang 'đừng tự bật lại')", () => {
    // Chiều này được chọn có chủ đích: đoán sai theo chiều này chỉ bắt người dùng bấm "Bật
    // thông báo" một lần; đoán sai theo chiều kia là tự bật lại thứ họ vừa tắt.
    camStorage("localStorage", storageNem());
    expect(daTatTayOMayNay(A)).toBe(true);
  });

  it("storage VẮNG MẶT hoàn toàn ⇒ vẫn trả TRUE, không ReferenceError", () => {
    camStorage("localStorage", undefined);
    expect(daTatTayOMayNay(A)).toBe(true);
  });

  it("storage NÉM / VẮNG MẶT ⇒ `datTatTay`/`xoaTatTay` không ném ra ngoài", () => {
    camStorage("localStorage", storageNem());
    expect(() => datTatTay(A)).not.toThrow();
    expect(() => xoaTatTay(A)).not.toThrow();
    camStorage("localStorage", undefined);
    expect(() => datTatTay(A)).not.toThrow();
    expect(() => xoaTatTay(A)).not.toThrow();
  });
});

describe("[PUSH-D6-T02] mốc 'người này đã đồng bộ endpoint này trong phiên tab'", () => {
  it("chưa ghi gì ⇒ false; ghi rồi ⇒ true cho ĐÚNG băm đó", () => {
    expect(daDongBoTrongPhien(A, BAM)).toBe(false);
    datDaDongBo(A, BAM);
    expect(daDongBoTrongPhien(A, BAM)).toBe(true);
  });

  it("băm KHÁC ⇒ false — đổi endpoint (khoá VAPID xoay) phải đồng bộ lại", () => {
    datDaDongBo(A, BAM);
    expect(daDongBoTrongPhien(A, BAM2)).toBe(false);
  });

  it("⚠️ MỐC THEO NGƯỜI: A đã đồng bộ endpoint E thì B trên CÙNG TAB vẫn phải đồng bộ lại", () => {
    // CA QUAN TRỌNG NHẤT CỦA KHỐI NÀY, và nó vá một lỗ LÀM RÒ DỮ LIỆU. `sessionStorage` sống qua
    // đăng xuất trong cùng tab (redirect về /login không xoá nó). Khoá theo endpoint đơn nghĩa
    // là: A bị phiên chết ⇒ layout đá sang /dang-xuat ⇒ tài khoản CÒN SỐNG nên không thu hồi gì,
    // và vì là redirect phía server nên không nửa client nào chạy ⇒ đăng ký E còn sống. B đăng
    // nhập TRONG CÙNG TAB ⇒ mốc khớp E ⇒ đường tự động trả "đã đồng bộ" và KHÔNG gọi máy chủ ⇒
    // KHÔNG chuyển chủ ⇒ mọi lead của A nổ trên màn hình khoá máy B đang cầm, kèm tên phụ huynh,
    // và B không nhận gì cả ngày.
    datDaDongBo(A, BAM);
    expect(daDongBoTrongPhien(A, BAM)).toBe(true);
    expect(daDongBoTrongPhien(B, BAM)).toBe(false);
  });

  it("nằm ở sessionStorage (CHẾT theo tab), KHÔNG ở localStorage", () => {
    // Dùng `localStorage` ở đây là khoá cứng vĩnh viễn: dòng bị thu hồi ở nơi khác (đăng xuất
    // trên máy khác, quản trị gỡ) sẽ không bao giờ được dựng lại vì mốc vẫn còn.
    datDaDongBo(A, BAM);
    expect(sessionStorage.getItem(`satarobo:push:da-dong-bo:${A}`)).toBe(BAM);
    expect(localStorage.getItem(`satarobo:push:da-dong-bo:${A}`)).toBeNull();
  });

  it("băm rỗng, hoặc KHÔNG BIẾT người dùng ⇒ false và KHÔNG ghi gì", () => {
    // Băm ở client có thể trả `null` (không có `crypto.subtle`) — và đường tự động vẫn phải gọi
    // máy chủ trong ca đó, không được coi như đã đồng bộ.
    datDaDongBo(A, "");
    datDaDongBo("", BAM);
    datDaDongBo(null, BAM);
    expect(daDongBoTrongPhien(A, "")).toBe(false);
    expect(daDongBoTrongPhien("", BAM)).toBe(false);
    expect(daDongBoTrongPhien(undefined, BAM)).toBe(false);
    expect(sessionStorage.getItem(`satarobo:push:da-dong-bo:${A}`)).toBeNull();
    expect(sessionStorage.getItem("satarobo:push:da-dong-bo:")).toBeNull();
  });

  it("KHÔNG ĐỌC ĐƯỢC storage ⇒ trả FALSE (fail sang 'ghi thêm một lượt') và không ném", () => {
    // Ngược chiều với cờ tắt tay, và đúng: mất mốc chỉ tốn một lượt ghi; coi như đã đồng bộ khi
    // không chắc là MẤT đăng ký.
    camStorage("sessionStorage", storageNem());
    expect(daDongBoTrongPhien(A, BAM)).toBe(false);
    expect(() => datDaDongBo(A, BAM)).not.toThrow();
  });

  it("sessionStorage VẮNG MẶT hoàn toàn ⇒ cũng FALSE, không ReferenceError", () => {
    // Khối song sinh `[PUSH-D6-T01]` có ca này; thiếu nó ở đây thì tách cổng `typeof` ra và đảo
    // chiều fail của nó vẫn xanh (lăng kính Đợt 6 chứng minh đúng phép thay đó).
    camStorage("sessionStorage", undefined);
    expect(daDongBoTrongPhien(A, BAM)).toBe(false);
    expect(() => datDaDongBo(A, BAM)).not.toThrow();
  });
});
