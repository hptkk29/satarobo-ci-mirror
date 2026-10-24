"use client";

// Khung tab của trang Cấu hình vận hành — nơi DUY NHẤT giữ "đang mở tab nào".
//
// Tách khỏi `page.tsx` vì trang là Server Component (nó đọc DB và biến môi trường), còn trạng
// thái tab thì phải ở client. Mọi dữ liệu đã tính sẵn ở server rồi truyền xuống: khung này
// không tự đi hỏi gì thêm.
//
// Tab "Thông báo điện thoại" hiện KHÁC các tab còn lại — nó có thêm bảng 51 công tắc loại
// thông báo. Cố ý không ép nó vào chung một khuôn: một trong hai thứ đó là bật/tắt cả kênh,
// thứ kia là chọn trong danh sách dài. Nhét chung một khuôn là được sự "nhất quán" trên hình
// và mất đi thứ người dùng cần — sự rõ ràng về hai tầng quyết định.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BangCauHinhTab, ThanhTab, type SettingRowView } from "./settings-editor";
import { ChonLoaiThongBao, type CanhBaoKenh } from "./chon-loai-thong-bao";
import type { NotiCatalogEntry } from "@/lib/notifications/catalog";

export interface TabView {
  id: string;
  ten: string;
  moTa: string;
  rows: SettingRowView[];
}

export function KhungCauHinh({
  tabs,
  choSua,
  choSuaCoSo,
  tabThongBao,
  danhMucThongBao,
  loaiDangBat,
  canhBaoKenh,
  noiDungRieng,
  khoiThem,
  tabBanDau,
}: {
  tabs: readonly TabView[];
  /** Sửa được giá trị TOÀN HỆ THỐNG (`settings:edit`, thực tế là Quản trị tối cao). */
  choSua: boolean;
  /**
   * Sửa được phần CỦA CƠ SỞ MÌNH — khối "Cài riêng theo cơ sở" ở từng dòng.
   *
   * ⚠️ KHÔNG có mặc định, và đó là chủ đích (luật 7): mặc định ở đây nguy hiểm theo CẢ HAI
   * chiều. `true` mặc định là bày nút ghi cho người không có quyền ghi; `false` mặc định là
   * đúng lỗi vừa vá — Quản lý cơ sở vào được màn mà mọi ô đều khoá, và không lỗi nào báo.
   * Bỏ mặc định thì `tsc` liệt kê đủ chỗ gọi.
   */
  choSuaCoSo: boolean;
  /** Id của tab mang bảng chọn loại thông báo. */
  tabThongBao: string;
  danhMucThongBao: readonly NotiCatalogEntry[];
  loaiDangBat: readonly string[];
  canhBaoKenh: readonly CanhBaoKenh[];
  /**
   * Tab có nội dung RIÊNG, không phải danh sách ô cấu hình: `tabId → khối JSX`.
   *
   * Hai tab đầu tiên dùng nó là "Phương thức thanh toán" (bảng danh mục + nút thêm) và
   * "Hoa hồng" (bảng chính sách khai được). Chúng không phải một con số để nhét vào ô
   * nhập, nên ép vào chung khuôn `BangCauHinhTab` là được sự nhất quán trên hình và mất
   * đi thứ người dùng cần — cùng lý do tab Thông báo đẩy đã có khối riêng ngay bên dưới.
   *
   * Nội dung dựng ở Server Component rồi truyền xuống như `ReactNode`: khung này không tự
   * đi hỏi gì thêm, đúng như nó vẫn làm với mọi tab khác.
   */
  noiDungRieng?: Readonly<Record<string, ReactNode>>;
  /**
   * Khối bày THÊM ở CUỐI một tab, DƯỚI bảng ô cấu hình: `tabId → khối JSX`.
   *
   * ⚠️ ĐỪNG NHẦM VỚI `noiDungRieng` NGAY TRÊN — hai prop trông giống hệt nhau (cùng kiểu
   * `Record<string, ReactNode>`) nhưng làm hai việc NGƯỢC nhau:
   *
   *   · `noiDungRieng` THAY bảng ô cấu hình. Dùng nhầm nó cho một tab đang có tham số là
   *     XOÁ TRẮNG mọi dòng cấu hình của tab đó khỏi màn hình — không lỗi, không cảnh báo,
   *     người vận hành chỉ thấy tham số của mình biến mất.
   *   · `khoiThem` GIỮ bảng và bày thêm bên dưới. Đây là thứ cần cho tab vừa có tham số
   *     vừa có một bảng khai riêng.
   *
   * Người dùng đầu tiên là tab "Lớp & giáo viên": nó có 5 ô cấu hình PHẢI giữ nguyên, cộng
   * bảng chọn giáo viên luôn hiện khi xếp buổi học thử (`trial.gvMienLocTheoCa` — một mảng
   * mã người dùng, không gõ tay được).
   *
   * Cùng khuôn với bảng loại thông báo ngay dưới, chỉ khác là bày theo `tabId` thay vì một
   * prop riêng — khung này không phải biết bên trong khối là gì.
   */
  khoiThem?: Readonly<Record<string, ReactNode>>;
  /**
   * Tab mở sẵn — trang đọc từ `?tab=` rồi truyền xuống.
   *
   * Bỏ trống ⇒ tab đầu tiên. Giá trị lạ cũng rơi về tab đầu (fail-soft): đường dẫn cũ hoặc
   * người gõ tay `?tab=linh-tinh` phải ra một trang dùng được, không phải trang trắng.
   */
  tabBanDau?: string;
}) {
  const [dangChon, setDangChon] = useState(
    () => (tabBanDau && tabs.some((t) => t.id === tabBanDau) ? tabBanDau : tabs[0]?.id) ?? "",
  );

  /**
   * ĐỔI TAB THÌ ĐỔI CẢ ĐƯỜNG DẪN.
   *
   * Chủ dự án 14/09/2026: "khi ở tab hoa hồng ở cấu hình vận hành xong chuyển sang màn
   * leads xong bấm quay lui thì bị chuyển về tab thông báo đẩy". Đúng — tab chỉ sống trong
   * `useState`, mà state mất khi rời trang; quay lại là mount mới và về tab đầu.
   *
   * ⚠️ Dùng `history.replaceState` THUẦN, KHÔNG `router.replace`:
   *   · `router.replace` kéo theo một lượt dựng lại Server Component cho MỌI lần bấm tab —
   *     trang này `force-dynamic` và đọc DB, nên mỗi cú bấm tốn một vòng máy chủ chỉ để
   *     đổi thứ đã nằm sẵn trong bộ nhớ trình duyệt.
   *   · `replaceState` ĐÈ mục lịch sử hiện tại thay vì thêm mục mới — bấm qua 5 tab rồi
   *     Back phải ra khỏi trang, không phải lùi từng tab một. Đó cũng đúng ý: người dùng
   *     nhớ "tôi đang ở Cấu hình vận hành", không nhớ mình đã xem tab nào trước đó.
   *
   * Khi rời trang, URL đã mang `?tab=…`; lúc Back, trang dựng lại từ đường dẫn đó và
   * `tabBanDau` khôi phục đúng tab.
   */
  const doiTab = useCallback((id: string) => {
    setDangChon(id);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    // ⚠️ Tham số đầu là `null`, KHÔNG phải `window.history.state`.
    //
    // Đo 14/09/2026 sau khi chủ dự án báo "vẫn lỗi": truyền lại state cũ là giữ nguyên
    // STATE NỘI BỘ CỦA NEXT APP ROUTER, thứ đang mang đường dẫn CŨ. Bấm tab → thanh địa
    // chỉ đổi, nhưng Next vẫn nhớ `/cau-hinh-van-hanh`; đi sang màn khác rồi Back thì nó
    // khôi phục theo trí nhớ của nó và `?tab=` bay mất.
    //
    // Next hỗ trợ chính thức `history.pushState/replaceState` để đổi đường dẫn mà không
    // nạp lại trang — với điều kiện KHÔNG giẫm lên state của nó.
    window.history.replaceState(null, "", url);
  }, []);

  /**
   * ĐỒNG BỘ VỚI ĐƯỜNG DẪN THẬT — hai đường, vì Back có HAI kết cục khác nhau.
   *
   * ⚠️ Đo 14/09/2026 sau khi chủ dự án báo "vẫn lỗi" lần hai, tái hiện đúng thao tác của
   * họ (bấm LINK trong sidebar, không phải gõ địa chỉ): sau khi Back, đường dẫn đúng
   * `?tab=hoa-hong` nhưng màn hiện "Thông báo đẩy" — MÀN NÓI DỐI SO VỚI URL.
   *
   * Vì sao: Next dựng lại trang từ BỘ ĐỆM CLIENT, tức component mount lại nhưng mang
   * props của lần render server CŨ — lúc ấy đường dẫn chưa có `?tab=`, nên `tabBanDau`
   * là `undefined` và state khởi tạo về tab đầu. Máy chủ không chạy lại lần nào.
   *
   *   · effect [] — chạy sau MỖI lần mount, kể cả lần mount do Back. Đây là đường vá
   *     chính, và là đường mà bản trước THIẾU.
   *   · popstate  — cho ca ngược lại: Next giữ nguyên cây, không mount lại, nên effect []
   *     không chạy; lúc đó chỉ sự kiện lịch sử mới báo được.
   *
   * Đọc `window.location` chứ không `useSearchParams()`: `history.replaceState` ở trên
   * không đi qua router, nên hook đó có thể còn giữ giá trị cũ. `window.location` thì
   * luôn là đường dẫn THẬT đang hiển thị.
   *
   * Cố ý KHÔNG khởi tạo state trực tiếp từ `window.location`: máy chủ không có `window`,
   * và đọc nó trong lần render đầu là lệch HTML hai bên (hydration mismatch). Effect chạy
   * SAU khi hydrate xong nên an toàn.
   */
  useEffect(() => {
    function theoDuongDan() {
      const id = new URL(window.location.href).searchParams.get("tab");
      if (id && tabs.some((t) => t.id === id)) setDangChon(id);
    }
    theoDuongDan();
    window.addEventListener("popstate", theoDuongDan);
    return () => window.removeEventListener("popstate", theoDuongDan);
  }, [tabs]);

  const tab = tabs.find((t) => t.id === dangChon) ?? tabs[0];
  if (!tab) return null;

  return (
    <div className="space-y-4">
      {/* Dính đỉnh khi cuộn — CHỈ từ `lg` trở lên: tab "Chấm công" có 18 dòng, cuộn tới cuối
          rồi muốn đổi tab thì không phải kéo ngược lên đầu trang. Dưới `lg` thì thanh tab
          chiếm 2–3 hàng (và ở điện thoại là ô chọn), dính vào là ăn mất một phần ba màn hình
          suốt lúc cuộn.
          ⚠️ Nền ĐẶC, tuyệt đối không `backdrop-blur` — một tổ tiên có `backdrop-filter` trở
          thành khối chứa cho mọi con `position: fixed`, đúng lỗi đã làm vỡ drawer trang public
          hôm 13/09. Ở đây có lớp phủ dính bên dưới, không đáng đánh đổi. */}
      <div className="z-20 -mx-1 bg-muted px-1 pb-1 pt-1 lg:sticky lg:top-0">
        <ThanhTab tabs={tabs} dangChon={tab.id} onChon={doiTab} />
      </div>

      {/* Câu mô tả tab đặt NGAY dưới thanh tab, không nhét vào tooltip: người mở một tab lạ
          cần biết mình đang xem gì trước khi đọc 18 dòng tham số. */}
      <p className="max-w-[72ch] text-sm text-muted-foreground">{tab.moTa}</p>

      <div role="tabpanel" aria-label={tab.ten} className="space-y-4">
        {/* Tab có nội dung riêng thì KHÔNG dựng bảng ô cấu hình — không phải để gọn, mà
            vì bảng đó sẽ rỗng và một bảng rỗng nằm trên đầu trang trông y hệt lỗi tải. */}
        {noiDungRieng?.[tab.id] ?? <BangCauHinhTab rows={tab.rows} choSua={choSua} choSuaCoSo={choSuaCoSo} />}

        {/* THÊM, không thay — xem khối chú thích của prop `khoiThem`. Đứng sau bảng ô cấu
            hình vì nó là phần phụ của tab, không phải thứ đầu tiên người ta tới đây để tìm. */}
        {khoiThem?.[tab.id]}

        {tab.id === tabThongBao && (
          <ChonLoaiThongBao
            danhMuc={danhMucThongBao}
            dangBat={loaiDangBat}
            choSua={choSua}
            canhBao={canhBaoKenh}
          />
        )}
      </div>
    </div>
  );
}
