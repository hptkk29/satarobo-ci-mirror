"use client";

// BỌC MỘT BẢNG CÓ SẴN → có phân trang, KHÔNG phải viết lại bảng đó.
//
// Vì sao có thêm cái này bên cạnh `BangPhanTrang`: hệ có ~140 bảng cần phân trang, mỗi
// bảng một kiểu class, một kiểu dòng rỗng, có bảng còn `<tfoot>` tổng cộng. Viết lại từng
// cái là 140 cơ hội làm vỡ giao diện. Ở đây chỉ BỌC:
//
//   <PhanTrangBang tenDonVi="học viên">
//     <table className="...">…nguyên xi như cũ…</table>
//   </PhanTrangBang>
//
// Component đọc cây con, tìm `<tbody>`, cắt DANH SÁCH DÒNG của nó theo trang rồi dựng lại
// đúng cái bảng đó. Mọi className, `<thead>`, `<tfoot>`, cấu trúc ô — giữ nguyên tuyệt đối.
//
// ⚠️ Cắt ở TẦNG HIỂN THỊ, không phải tầng truy vấn — xem ghi chú dài trong
// `components/ui/bang-phan-trang.tsx`. Bảng lớn tới mức nặng truy vấn vẫn phải phân trang
// ở tầng DB (`/admin/leads` là mẫu).
//
// ⚠️ FAIL-SAFE: gặp hình dạng lạ (không thấy `<tbody>`, có nhiều hơn một `<tbody>`) thì
// render Y NGUYÊN bảng gốc, không phân trang. Thà một bảng dài còn hơn một bảng sai.

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { MUC_SO_DONG, SO_DONG_MAC_DINH } from "@/components/ui/bang-phan-trang";
import { DieuHuongTrang } from "@/components/ui/dieu-huong-trang";
import { cn } from "@/lib/utils";

const KHOA_LUU = "satarobo:bang:soDong";

/** Trải phẳng children của tbody: `.map()` cho mảng, điều kiện cho `false`/`null`. */
function trảiDòng(children: ReactNode): ReactNode[] {
  return Children.toArray(children).filter((c) => isValidElement(c));
}

type ElementCoChildren = ReactElement<{ children?: ReactNode }>;

/**
 * Dòng có `key` React đúng bằng `khoa` không. `Children.toArray` MÃ HOÁ khoá (`=`→`=0`, `:`→`=2`, thêm
 * `$`) và thêm tiền tố vị trí (`.` hoặc `.1:` khi tbody có nhiều biểu thức con) — so chuỗi trần thì khoá
 * `dot:abc` không bao giờ khớp.
 */
function laDongCoKhoa(c: ReactNode, khoa: string): boolean {
  if (!isValidElement(c) || c.key == null) return false;
  const ma = `$${khoa.replace(/[=:]/g, (m) => (m === "=" ? "=0" : "=2"))}`;
  return c.key === `.${ma}` || c.key.endsWith(`:${ma}`);
}

/**
 * Có phải phần tử thân bảng không — nhận CẢ `<tbody>` thô lẫn `<TableBody>` của shadcn.
 * Repo dùng lẫn hai kiểu (97 file thô / 17 file shadcn); chỉ nhận một kiểu là 17 bảng kia
 * âm thầm không phân trang mà không ai biết vì fail-safe không kêu.
 */
function laThanBang(c: unknown): boolean {
  if (!isValidElement(c)) return false;
  const t = c.type as string | { displayName?: string; name?: string };
  if (t === "tbody") return true;
  if (typeof t === "function" || (typeof t === "object" && t !== null)) {
    const ten = (t as { displayName?: string; name?: string }).displayName ??
      (t as { name?: string }).name;
    return ten === "TableBody";
  }
  return false;
}

export function PhanTrangBang({
  children,
  tenDonVi = "dòng",
  khoaGhiNho,
  soDongMacDinh = SO_DONG_MAC_DINH,
  className,
  cuonNgang = false,
  luonHienThanh = false,
  khoaTrang,
  classThanh,
  khoaDongHien,
}: {
  /** ĐÚNG MỘT phần tử `<table>`. */
  children: ReactNode;
  tenDonVi?: string;
  khoaGhiNho?: string;
  soDongMacDinh?: number;
  className?: string;
  /**
   * Tự bọc RIÊNG cái bảng trong vùng cuộn ngang (`overflow-x-auto`).
   *
   * 25/08 — vá lỗi "cuộn sang phải là mất thanh phân trang". Nếp cũ ở ~24 bảng là bọc
   * cả `<PhanTrangBang>` trong một div `overflow-x-auto`, mà thanh phân trang lại là
   * con của component ⇒ nó nằm TRONG vùng cuộn: kéo bảng sang phải để đọc cột cuối là
   * nút chuyển trang trôi khỏi màn hình. Bật cờ này rồi BỎ div bọc ngoài ở chỗ gọi:
   * bảng cuộn được, thanh phân trang đứng yên.
   */
  cuonNgang?: boolean;
  /**
   * Hiện thanh phân trang CẢ KHI bảng ngắn hơn mức nhỏ nhất (vẫn ẩn khi 0 dòng).
   *
   * 23/09 — bảng bung chi tiết của báo cáo trải nghiệm: chủ dự án thấy 8 case mà không
   * có thanh phân trang nên tưởng bảng chưa phân trang. Bảng mà NGƯỜI DÙNG KỲ VỌNG dài
   * thì thanh "1–8 / 8 case" là lời xác nhận, không phải nhiễu. Mặc định TẮT để ~140
   * bảng khác không đổi.
   */
  luonHienThanh?: boolean;
  /**
   * Ghi nhớ TRANG đang xem (sessionStorage, theo tab) dưới khoá này.
   *
   * 24/09 — `/classes`: lọc xong, sang trang 3, bấm vào một lớp rồi quay lại là về trang 1
   * vì `trang` chỉ là state trong bộ nhớ. Truyền khoá GẮN VỚI BỘ LỌC (vd chuỗi query) để
   * đổi bộ lọc là về trang 1 của bộ lọc mới, còn quay lại đúng bộ lọc cũ thì về đúng trang
   * cũ. Không truyền = hành vi cũ.
   */
  khoaTrang?: string;
  /**
   * Class thêm cho THANH phân trang. Bảng nằm trong thẻ có viền mà không có lề trong
   * (vd `/classes`) thì thanh dính sát mép thẻ — truyền `px-4 pb-3` ở đó.
   */
  classThanh?: string;
  /**
   * `key` React của dòng PHẢI nằm trên trang đang hiện — bảng tự mở trang chứa nó mỗi khi khoá (hoặc vị
   * trí của nó) đổi. Người dùng tự lật trang mà dòng chọn không đổi thì KHÔNG bị giật về.
   *
   * 28/09 — màn Hoá đơn điện tử: xác nhận xong, ngăn chuyển sang dòng kế tiếp (`?chon=`), nhưng bảng vẫn
   * đứng ở trang cũ ⇒ dòng đang mở không có trên bảng (PLAN §10). Khoá không có trong bảng / không truyền
   * = hành vi cũ.
   */
  khoaDongHien?: string | null;
}) {
  const [soDong, setSoDong] = useState(soDongMacDinh);
  const [trang, setTrangState] = useState(1);
  const khoaTrangDay = khoaTrang != null ? `satarobo:bang:trang:${khoaTrang}` : null;
  useEffect(() => {
    if (!khoaTrangDay) return;
    let luu = 1;
    try {
      const n = Number(window.sessionStorage?.getItem(khoaTrangDay));
      if (Number.isInteger(n) && n > 0) luu = n;
    } catch {
      /* sessionStorage có thể ném — mất chỗ ghi nhớ thôi */
    }
    setTrangState(luu);
  }, [khoaTrangDay]);
  function setTrang(n: number) {
    setTrangState(n);
    if (!khoaTrangDay) return;
    try {
      window.sessionStorage?.setItem(khoaTrangDay, String(n));
    } catch {
      /* bỏ qua */
    }
  }

  // ── AFFORDANCE CUỘN NGANG (09/09/2026, luật 12) ────────────────────────────
  //
  // Bảng Danh mục mã ca có 10 cột, rộng 1561px trong khung 1151px (`max-w-6xl`). Nó CUỘN
  // ĐƯỢC — đo trên prod: đặt `scrollLeft` thì cột "Hành động" về đúng mép. Nhưng thanh
  // cuộn nằm ở ĐÁY bảng 21 dòng, cách hàng tiêu đề ~1000px, nên trong tầm mắt người dùng
  // KHÔNG có gì báo là cuộn được. Chủ dự án báo "cột bị cắt, không cuộn tới được".
  //
  // Đây là luật 12 ở dạng ngược: không phải affordance hứa suông, mà là một khả năng CÓ
  // THẬT nhưng không có affordance nào. Vệt mờ + bóng ở MÉP là chỗ mắt đang nhìn.
  //
  // Chỉ hiện khi THẬT SỰ còn nội dung bên đó — một vệt mờ đứng mãi cũng là lời hứa suông.
  const vungCuon = useRef<HTMLDivElement | null>(null);
  const [conTrai, setConTrai] = useState(false);
  const [conPhai, setConPhai] = useState(false);
  const idSelect = useId();
  const khoa = khoaGhiNho ? `${KHOA_LUU}:${khoaGhiNho}` : KHOA_LUU;

  // Đo sau mỗi lần đổi trang / đổi số dòng: bảng đổi chiều rộng thì tình trạng cuộn đổi
  // theo. `ResizeObserver` bắt cả lúc cửa sổ co lại và lúc nội dung ô đổi.
  useEffect(() => {
    const el = vungCuon.current;
    if (!el) return;
    const do_ = () => {
      const thua = el.scrollWidth - el.clientWidth;
      setConTrai(el.scrollLeft > 1);
      // −1 cho sai số làm tròn của trình duyệt ở tỉ lệ zoom lạ.
      setConPhai(thua > 1 && el.scrollLeft < thua - 1);
    };
    do_();
    el.addEventListener("scroll", do_, { passive: true });
    // ⚠️ jsdom KHÔNG có `ResizeObserver`. Gọi thẳng là 23 test component của bảng khác
    // chết bằng `ReferenceError` — đã ăn thật 09/09. Thiếu nó chỉ mất phép đo lại khi
    // khung đổi kích thước; listener `scroll` vẫn chạy, nên trình duyệt thật không thiệt.
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(do_);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", do_);
      ro?.disconnect();
    };
  }, [cuonNgang, soDong, trang, children]);

  useEffect(() => {
    try {
      const luu = Number(window.localStorage?.getItem(khoa));
      if (MUC_SO_DONG.includes(luu as (typeof MUC_SO_DONG)[number])) setSoDong(luu);
    } catch {
      /* localStorage có thể ném (Safari riêng tư) — mất chỗ ghi nhớ thôi, đừng vỡ bảng */
    }
  }, [khoa]);

  const { bang, dong, viTriTbody } = useMemo(() => {
    const el = Children.toArray(children).find(isValidElement) as ElementCoChildren | undefined;
    if (!el) return { bang: null, dong: [] as ReactNode[], viTriTbody: -1 };
    const con = Children.toArray(el.props.children);
    const cacTbody = con
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => laThanBang(c));
    // 0 hoặc >1 tbody → không đoán, trả bảng nguyên trạng.
    if (cacTbody.length !== 1) return { bang: el, dong: [] as ReactNode[], viTriTbody: -1 };
    const tbody = cacTbody[0].c as ElementCoChildren;
    return { bang: el, dong: trảiDòng(tbody.props.children), viTriTbody: cacTbody[0].i };
  }, [children]);

  const viTriDongHien = useMemo(
    () => (khoaDongHien == null ? -1 : dong.findIndex((c) => laDongCoKhoa(c, khoaDongHien))),
    [dong, khoaDongHien],
  );
  // Đứng SAU hiệu ứng khôi phục trang từ sessionStorage (`khoaTrang`) để lúc mount dòng chọn thắng.
  // Phụ thuộc vào VỊ TRÍ chứ không vào `dong`: `children` đổi tham chiếu mỗi lần cha vẽ lại.
  useEffect(() => {
    if (viTriDongHien < 0) return;
    setTrang(Math.floor(viTriDongHien / soDong) + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `setTrang` là hàm cục bộ, không đổi hành vi
  }, [khoaDongHien, viTriDongHien, soDong]);

  const tong = dong.length;
  const soTrang = Math.max(1, Math.ceil(tong / soDong));
  const trangHt = Math.min(trang, soTrang);

  const bangDaCat = useMemo(() => {
    if (!bang || viTriTbody < 0) return bang;
    const con = Children.toArray((bang as ElementCoChildren).props.children);
    const tbody = con[viTriTbody] as ElementCoChildren;
    const dau = (trangHt - 1) * soDong;
    const conMoi = [...con];
    conMoi[viTriTbody] = cloneElement(tbody, undefined, dong.slice(dau, dau + soDong));
    return cloneElement(bang as ElementCoChildren, undefined, conMoi);
  }, [bang, viTriTbody, dong, trangHt, soDong]);

  function doiSoDong(n: number) {
    setSoDong(n);
    setTrang(1);
    try {
      window.localStorage?.setItem(khoa, String(n));
    } catch {
      /* bỏ qua */
    }
  }

  const tu = tong === 0 ? 0 : (trangHt - 1) * soDong + 1;
  const den = Math.min(tong, trangHt * soDong);
  // Bảng ngắn hơn mức nhỏ nhất, hoặc hình dạng lạ (viTriTbody < 0) → không bày gì thêm.
  const hienThanh = viTriTbody >= 0 && (luonHienThanh ? tong > 0 : tong > MUC_SO_DONG[0]);

  return (
    <div className={cn("space-y-3", className)}>
      {cuonNgang ? (
        // `relative` KHÔNG thừa: nhiều bảng có `<th><span className="sr-only">` mà
        // `sr-only` là `position:absolute`. Vùng cuộn không được định vị thì cái span đó
        // neo vào khối chứa ban đầu của TRANG ở x ≈ min-width của bảng (880px…), kéo cả
        // `<body>` trượt ngang mấy trăm px ở màn 375px — và `overflow-hidden` của thẻ card
        // KHÔNG cắt được nó, vì absolute chỉ bị cắt bởi tổ tiên CÓ định vị.
        // Site GV vá bằng `.t-card{position:relative}` (teacher.css); admin không có thứ
        // tương đương, nên đặt luôn ở đây cho mọi site.
        <div className="relative">
          <div ref={vungCuon} className="relative overflow-x-auto">
            {bangDaCat}
          </div>
          {/* Hai lớp phủ: `pointer-events-none` để không nuốt click vào ô dưới nó.
              Bóng inset thay vì nền gradient — bảng nằm trên `bg-card` ở màn này và
              `bg-background` ở màn khác, gradient theo màu là sẽ sai ở một trong hai. */}
          {conTrai && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-8 shadow-[inset_12px_0_10px_-10px_rgba(0,0,0,0.28)]"
            />
          )}
          {conPhai && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-8 shadow-[inset_-12px_0_10px_-10px_rgba(0,0,0,0.28)]"
            />
          )}
        </div>
      ) : (
        bangDaCat
      )}
      {hienThanh && (
        <div
          className={cn(
            "flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between",
            classThanh,
          )}
        >
          <div className="flex items-center gap-2">
            <label htmlFor={idSelect} className="whitespace-nowrap">
              Hiển thị
            </label>
            <select
              id={idSelect}
              value={soDong}
              onChange={(e) => doiSoDong(Number(e.target.value))}
              className="h-8 rounded-lg border border-border bg-background py-0 pl-2 pr-7 text-sm text-foreground outline-none focus:border-primary"
            >
              {MUC_SO_DONG.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="whitespace-nowrap">
              / {tong} {tenDonVi}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap tabular-nums">
              {tu}–{den} · trang {trangHt}/{soTrang}
            </span>
            <DieuHuongTrang trang={trangHt} soTrang={soTrang} onDoi={setTrang} />
          </div>
        </div>
      )}
    </div>
  );
}
