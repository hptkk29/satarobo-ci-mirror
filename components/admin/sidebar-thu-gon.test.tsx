// @vitest-environment jsdom
/**
 * THANH ĐIỀU HƯỚNG ADMIN — nút thu gọn + phân cấp tên danh mục.
 *
 * Chủ dự án 18/09/2026: "1. sidebar làm thêm 1 nút để thu gọn, mở ra · 2. các tên danh mục
 * ở sidebar thiết kế nổi bật hơn các mục bình thường để dễ nhận biết".
 *
 * ── BỘ NÀY CANH GÌ ───────────────────────────────────────────────────────────────────────
 * Không canh "có render ra chữ không". Canh những lời hứa mà một thanh thu gọn được đưa ra,
 * và cả bốn đều hứa suông được mà không ném lỗi, không làm đỏ test, console vẫn sạch:
 *
 *  1. Nút CÓ TÁC DỤNG — bấm là thanh hẹp lại thật, và bấm lại thì rộng ra.
 *  2. Ở chế độ dải, biểu tượng vẫn CÓ TÊN đọc được (`aria-label`) — một biểu tượng không
 *     tên là lời hứa không đọc được (luật 12).
 *  3. Drawer điện thoại KHÔNG BAO GIỜ thu gọn và KHÔNG có nút — thu gọn ở đó là biến drawer
 *     thành "một tấm rỗng", đúng thứ `[ADMIN-NAV-T01]` sinh ra để canh.
 *  4. Tên danh mục NỔI HƠN mục thường — và "nổi hơn" phải đo được, không phải cảm tính.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

// Cùng bộ mock với `admin-shell.test.tsx` — topbar kéo theo `next-auth` (→ `next/server`)
// và badge chat mở kênh realtime; cả hai không dựng được trong test khung.
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/chat/use-chat-unread", () => ({
  useChatUnread: (_id: string, seed: number) => seed,
}));
vi.mock("@/lib/auth/logout-client", () => ({ logoutToGate: vi.fn() }));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => null,
}));
vi.mock("@/components/admin/role-switcher", () => ({ RoleSwitcher: () => null }));

import { AdminShell } from "./admin-shell";

afterEach(cleanup);

/**
 * ⚠️ TỰ DỰNG `localStorage` CHO MỖI CA — đừng dùng bản của môi trường.
 *
 * Trạng thái thu gọn được lưu vào `localStorage`, nên nó là TRẠNG THÁI DÙNG CHUNG giữa các
 * ca trong cùng tệp. Bản đầu của bộ này không dọn, và hậu quả đúng là lớp lỗi luật 18:
 *
 *   · máy dev: `localStorage` HỎNG HOÀN TOÀN (vitest ở đây cảnh báo `--localstorage-file
 *     was provided without a valid path`; đo thử thì `setItem` rồi `getItem` cũng thất
 *     bại). Ghi không được ⇒ không rò rỉ ⇒ 16/16 XANH.
 *   · CI: `localStorage` chạy thật ⇒ ca đầu bấm thu gọn, ca sau mount đã ở trạng thái thu
 *     gọn ⇒ không tìm thấy nút "Thu gọn" ⇒ 9 ca ĐỎ.
 *
 * Tức MÁY DEV LÀ CÁI HỎNG, và nó che đúng khuyết điểm của bộ test. Bài học không phải "nhớ
 * dọn localStorage" mà là: một bộ test phụ thuộc trạng thái dùng chung của MÔI TRƯỜNG thì
 * kết quả của nó nói về môi trường, không nói về mã. Nên ở đây cắm hẳn một bản trong bộ
 * nhớ — xanh/đỏ giống nhau ở mọi máy, và ca "nhớ trạng thái" mới kiểm được thật.
 */
beforeEach(() => {
  const kho = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => kho.get(k) ?? null,
      setItem: (k: string, v: string) => void kho.set(k, String(v)),
      removeItem: (k: string) => void kho.delete(k),
      clear: () => kho.clear(),
      key: (i: number) => [...kho.keys()][i] ?? null,
      get length() {
        return kho.size;
      },
    },
  });
});

/** Quyền đủ rộng để nav dựng nhiều nhóm — bộ này không kiểm quyền. */
const GRANTED = [
  "leads:view-all",
  "leads:view-own",
  "leads:create",
  "students:view-all",
  "classes:view-all",
];

function dung() {
  return render(
    <AdminShell
      granted={GRANTED}
      anMenu={[]}
      userId="u1"
      chatUserId="u1"
      chatUnread={0}
      userName="Thử"
      userRole="SUPER_ADMIN"
      roles={["SUPER_ADMIN"]}
      activeRole="SUPER_ADMIN"
      elearningUrl={null}
      evalV2Enabled={false}
      scormEnabled={false}
      classGroupEnabled={false}
      zalocrmEnabled={false}
      hoaDonEnabled={false}
    >
      <p>noi dung</p>
    </AdminShell>,
  );
}

const nutThuGon = () => screen.getByRole("button", { name: /Thu gọn thanh điều hướng/ });
const nutMoRong = () => screen.getByRole("button", { name: /Mở rộng thanh điều hướng/ });

/** `<aside>` của thanh CỐ ĐỊNH (bản đầu trong DOM); drawer là bản thứ hai. */
const thanhCoDinh = () => document.querySelectorAll("aside")[0] as HTMLElement;
const thanhDrawer = () => document.querySelectorAll("aside")[1] as HTMLElement;

describe("[SB-T10] nút thu gọn CÓ TÁC DỤNG", () => {
  it("có nút, và mặc định thanh đang MỞ", () => {
    dung();
    expect(nutThuGon()).toBeTruthy();
    expect(thanhCoDinh().className).toContain("w-64");
    expect(thanhCoDinh().dataset.thuGon).toBe("0");
  });

  it("⚠️ bấm ⇒ thanh HẸP LẠI THẬT, không chỉ đổi nhãn nút", () => {
    // Đây là ca then chốt. Một nút đổi được chữ trên chính nó mà không đổi gì khác là
    // affordance nói dối — và nó không ném lỗi, console vẫn sạch.
    dung();
    fireEvent.click(nutThuGon());
    expect(thanhCoDinh().className).toContain("w-16");
    expect(thanhCoDinh().className).not.toContain("w-64");
    expect(thanhCoDinh().dataset.thuGon).toBe("1");
  });

  it("bấm lần nữa ⇒ rộng lại", () => {
    dung();
    fireEvent.click(nutThuGon());
    fireEvent.click(nutMoRong());
    expect(thanhCoDinh().className).toContain("w-64");
  });

  it("nhãn nút NÓI ĐÚNG việc nó sắp làm, ở cả hai chiều", () => {
    dung();
    expect(nutThuGon().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(nutThuGon());
    expect(nutMoRong().getAttribute("aria-expanded")).toBe("false");
  });

  it("⚠️ NHỚ trạng thái qua lần tải trang sau", () => {
    // Trước đó việc này chỉ được đo bằng trình duyệt (F5 vẫn 64px). Ở bộ unit nó KHÔNG
    // kiểm được, vì `localStorage` của máy dev hỏng — đúng chỗ mà bản vá `beforeEach` bên
    // trên mở ra.
    localStorage.setItem("satarobo:sidebar:thu-gon", "1");
    dung();
    expect(thanhCoDinh().dataset.thuGon).toBe("1");
    expect(thanhCoDinh().className).toContain("w-16");
  });

  it("mỗi ca bắt đầu từ trạng thái MỞ — không mượn trạng thái ca trước", () => {
    // Ca này là cái bẫy chuột: nó ĐỎ ngay nếu ai gỡ `beforeEach`, kể cả trên máy có
    // `localStorage` hỏng thì cũng không cứu được (vì ca trên vừa ghi vào).
    expect(localStorage.getItem("satarobo:sidebar:thu-gon")).toBeNull();
    dung();
    expect(thanhCoDinh().dataset.thuGon).toBe("0");
  });

  it("vùng bấm ≥44px theo DESIGN.md §2 — ngưỡng `md` gồm cả máy tính bảng", () => {
    dung();
    expect(nutThuGon().className).toMatch(/\bh-11\b/);
    expect(nutThuGon().className).toMatch(/\bw-11\b/);
  });
});

describe("[SB-T11] ⚠️ thu gọn rồi biểu tượng vẫn phải CÓ TÊN", () => {
  it("mục nav mang `aria-label` khi thu gọn", () => {
    // Nhãn chữ bị ẩn ⇒ không có `aria-label` thì trình đọc màn hình chỉ đọc được
    // đường dẫn, và người dùng chuột thì đoán theo hình.
    dung();
    fireEvent.click(nutThuGon());
    const muc = screen.getAllByRole("link", { name: "Leads" });
    expect(muc.length).toBeGreaterThan(0);
  });

  it("mở rộng lại thì nhãn CHỮ quay về", () => {
    // Dùng "Dashboard" chứ không "Leads": ở chế độ MỞ, sidebar chỉ bung nhóm đang active
    // (hành vi có sẵn từ trước, state `collapsed`), và `usePathname` ở đây là `/dashboard`
    // ⇒ nhóm "CRM & Tuyển sinh" đang thu. Bản đầu của ca này tìm "Leads" và ĐỎ — test sai,
    // không phải mã sai.
    //
    // Chênh lệch ấy là CÓ CHỦ ĐÍCH và đáng ghi: chế độ DẢI hiện HẾT mục (bỏ qua thu gọn
    // từng nhóm, vì một nhóm thu trong dải là vùng chết — không nhãn, không mũi tên), còn
    // chế độ MỞ giữ nguyên nếp cũ.
    dung();
    fireEvent.click(nutThuGon());
    fireEvent.click(nutMoRong());
    const co = screen
      .getAllByRole("link")
      .some((a) => a.textContent?.trim() === "Dashboard");
    expect(co).toBe(true);
  });

  it("⚠️ chế độ DẢI hiện HẾT mục, kể cả nhóm đang thu ở chế độ mở", () => {
    // Đây là phần bù của ca trên, và là lý do ca trên phải đổi nhãn.
    dung();
    const moRong = screen.getAllByRole("link").length;
    fireEvent.click(nutThuGon());
    const dai = screen.getAllByRole("link").length;
    expect(dai).toBeGreaterThan(moRong);
  });

  it("⚠️ thu gọn KHÔNG được làm mất mục nào — dải là để bấm nhanh, không phải để ẩn việc", () => {
    dung();
    const truoc = thanhCoDinh().querySelectorAll("a").length;
    fireEvent.click(nutThuGon());
    const sau = thanhCoDinh().querySelectorAll("a").length;
    // Dải bỏ liên kết lockup ở đầu thanh (đổi thành nút), nên chênh đúng 1.
    expect(sau).toBeGreaterThanOrEqual(truoc - 1);
  });
});

describe("[SB-T12] ⚠️ DRAWER điện thoại không bao giờ thu gọn", () => {
  it("drawer KHÔNG có nút thu gọn", () => {
    // ⚠️ PHẢI MỞ DRAWER TRƯỚC KHI ĐẾM.
    //
    // Bản đầu của ca này đếm ngay khi drawer còn đóng, và nó XANH GIẢ: cấy lỗi (móc
    // `onDoiThuGon` vào cả drawer) mà bộ vẫn xanh. Vì drawer đóng mang `aria-hidden`, nên
    // `getAllByRole` — vốn đi theo cây trợ năng — KHÔNG THẤY nút bên trong nó. Ca đếm một
    // thứ bị ẩn khỏi tầm nhìn của chính phép đếm.
    dung();
    fireEvent.click(screen.getByRole("button", { name: "Mở menu điều hướng" }));
    expect(screen.getAllByRole("button", { name: /Thu gọn thanh điều hướng/ })).toHaveLength(1);
  });

  it("thu gọn thanh cố định ⇒ drawer VẪN rộng và vẫn có chữ", () => {
    // `[ADMIN-NAV-T01]` canh "drawer mở ⇒ CÓ mục menu thật để bấm". Nếu trạng thái thu gọn
    // dò được sang drawer thì ca đó vẫn xanh (link vẫn tồn tại) mà người dùng điện thoại
    // nhận một cột biểu tượng trong khay rộng 256px.
    dung();
    fireEvent.click(nutThuGon());
    expect(thanhDrawer().className).toContain("w-64");
    expect(thanhDrawer().dataset.thuGon).toBe("0");
  });
});

describe("[SB-T13] ⚠️ TÊN DANH MỤC nổi hơn mục thường — đo trên mã, không cảm tính", () => {
  // Phân cấp là việc của lớp CSS, mà `getComputedStyle` trong jsdom không có Tailwind nên
  // không đọc được màu thật. Nên ở đây soi CHÍNH mã nguồn (lưới ghim mã nguồn, luật 11:
  // neo hẹp, và đã cấy lại lỗi để thấy đỏ).
  const NGUON = fs.readFileSync(path.join(process.cwd(), "components/admin/sidebar.tsx"), "utf8");

  it("phép quét tự kiểm: đọc được tệp", () => {
    expect(NGUON.length).toBeGreaterThan(5000);
  });

  it("nhãn nhóm dùng màu ĐẦY, mục con dùng màu nhạt", () => {
    // Bản cũ cho CẢ HAI cùng `text-muted-foreground`, nên tiêu đề nhóm lùi xuống dưới
    // thứ nó đang gán nhãn — phân cấp ngược. Thứ tạo phân cấp là ĐỘ TƯƠNG PHẢN.
    expect(NGUON).toContain('"text-foreground transition-colors hover:text-primary"');
  });

  it("nhãn nhóm IN ĐẬM và KHÔNG còn nhỏ hơn mục con", () => {
    expect(NGUON).toMatch(/text-\[11px\] font-bold uppercase/);
    expect(NGUON).not.toMatch(/text-\[10px\] uppercase tracking-widest font-semibold/);
  });

  it("mỗi nhóm có VẠCH NGĂN phía trên (trừ nhóm đầu)", () => {
    expect(NGUON).toContain('gIdx > 0 && "mt-1 border-t border-border pt-3"');
  });

  it("⚠️ nhãn CỤM CON phải rõ ràng THẤP HƠN nhãn nhóm (tầng CHƯA có dữ liệu)", () => {
    // ⚠️ NÓI THẲNG GIỚI HẠN CỦA CA NÀY: đo 18/09/2026, KHÔNG item nào trong `NAV_GROUPS`
    // khai `cluster` (`grep -c "cluster:"` → 0), nên nhánh ấy chưa render lần nào và ca
    // này chỉ canh được VĂN BẢN MÃ, không canh được thứ hiện ra trên màn hình.
    //
    // Giữ lại vì kiểu dữ liệu + luật R3 vẫn còn, và cấy lỗi (S9) có làm nó đỏ. Nhưng đừng
    // đọc nó như bằng chứng đã xem tận mắt — đó là hai chuyện khác nhau.
    // Bản cũ hai tầng gần y hệt nhau (`text-[10px] uppercase tracking-wider
    // text-muted-foreground`) nên trông như ngang hàng. Nay: không in hoa, chữ nhạt hơn,
    // và thụt vào thẳng hàng với nhãn mục.
    expect(NGUON).toContain('text-[11px] font-medium text-muted-foreground/70');
    expect(NGUON).toContain('pl-[3.25rem]');
  });
});
