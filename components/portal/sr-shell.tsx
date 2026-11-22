"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Gift,
  Home,
  Image as ImageIcon,
  LogOut,
  Menu,
  MessageSquareText,
  MessagesSquare,
  Moon,
  Phone,
  Route as RouteIcon,
  Star,
  Sun,
  Trophy,
  Users,
  Wallet,
  X,
  type LucideIcon,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { legalUrlTuyetDoi } from "@/lib/legal-pages";
import { logoutToGate } from "@/lib/auth/logout-client";
import { SU_KIEN_DA_DOC_THONG_BAO } from "@/lib/portal/su-kien-thong-bao";
import { useSetActiveSite } from "@/components/portal/use-set-active-site";
import { usePortalAppearance } from "@/components/portal/appearance-provider";
import { useChatUnread } from "@/components/chat/use-chat-unread";
import { locMucBaiTapBaiThi } from "@/lib/portal/muc-tam-an-thuan";
import { coQuaTangNao } from "@/lib/portal/qua-tang";
import { Sticker } from "@/components/portal/sticker";
import { DaiLinkPhapLy } from "@/components/public/dai-link-phap-ly";
import type { SwitcherChild } from "@/lib/portal/child-switcher-data";

// Vỏ Cổng phụ huynh theo artifact "Cổng Phụ Huynh — Thiết kế lại" (02/11/2026):
//   ≥900px  menu bên 248px (Sidebar.dc.html)
//   <900px  thanh tab dưới 5 mục + màn "Thêm" (TabBar.dc.html / M-Them.dc.html)
// Màu, bo góc, cỡ chữ lấy từ token `--sr-*` / shadcn của `.portal-v2` (globals.css) nên
// sáng/tối đổi cùng nhau. Mặc định SÁNG (appearance mặc định `light`).
//
// ⚠️ Mọi `href: "/portal/…"` ở đây phải để LITERAL: lưới `v2-nav-day-du.test.ts` quét chuỗi
// trong tệp này để chắc mọi trang của cổng đều có lối vào. Trang ngoài artifact (Bài thi,
// Học bạ, SataCoin…) nằm ở nhóm "TIỆN ÍCH KHÁC" chứ không bị bỏ rơi.

type Item = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Dòng phụ ở màn "Thêm" (điện thoại). */
  sub?: string;
  /** Tên ngắn trên thanh tab. */
  tab?: string;
  /** Hiện nhãn «MỚI» (mục vừa ra mắt). */
  moi?: boolean;
};

const NHOM_CON: Item[] = [
  { label: "Tổng quan", href: "/portal", icon: Home, sub: "Buổi tới, nhận xét, học phí" },
  {
    label: "Chuyên cần & kết quả",
    href: "/portal/ket-qua",
    icon: Trophy,
    sub: "Đủ buổi chưa · học bù · học vượt",
  },
  {
    label: "Hành trình học",
    href: "/portal/lich",
    icon: RouteIcon,
    sub: "Các buổi của khoá · lịch tháng",
    tab: "Hành trình",
  },
  {
    label: "Góc sản phẩm của con",
    href: "/portal/hinh-anh",
    icon: ImageIcon,
    sub: "Ảnh, video con làm ra",
    tab: "Sản phẩm",
  },
  {
    label: "Nhận xét & học bạ",
    href: "/portal/nhan-xet",
    icon: MessageSquareText,
    sub: "Thầy cô nói gì về con",
  },
  {
    label: "Bài tập & bài thi",
    href: "/portal/bai-tap",
    icon: ClipboardList,
    sub: "Bài về nhà và điểm",
  },
];

const NHOM_VIEC: Item[] = [
  {
    label: "Gửi yêu cầu đến trung tâm",
    href: "/portal/yeu-cau",
    icon: CalendarPlus,
    sub: "Báo nghỉ, chọn giờ học bù",
  },
  {
    label: "Học phí",
    href: "/portal/hoc-phi",
    icon: Wallet,
    sub: "Đã đóng, còn nợ, phiếu thu",
  },
  {
    label: "Nhắn cô thầy",
    href: "/portal/tin-nhan",
    icon: MessagesSquare,
    sub: "Nhóm lớp · giáo viên · tư vấn",
    tab: "Tin nhắn",
  },
];

const NHOM_TRUNG_TAM: Item[] = [
  { label: "Thông báo", href: "/portal/thong-bao", icon: Bell, sub: "Tin từ trung tâm" },
  {
    label: "Góp ý cho trung tâm",
    href: "/portal/khao-sat",
    icon: Star,
    sub: "Khảo sát và góp ý",
  },
  {
    label: "Hồ sơ gia đình",
    href: "/portal/ho-so",
    icon: Users,
    sub: "Con, người đón, bảo mật",
  },
];

/**
 * «Quà tặng» (12/11/2026, chủ dự án chốt) — HỘP QUÀ gom các tính năng miễn phí (DISC · Sức khỏe · Tủ sách …) thay cho ba mục rời. Hiện khi ÍT NHẤT
 * MỘT cờ trong ba cờ bật (`coQuaTangNao`, lib/portal/qua-tang.ts); từng quà bên trong vẫn theo cờ riêng của trang đích.
 */
const MUC_QUA_TANG: Item = {
  label: "Quà tặng",
  href: "/portal/qua-tang",
  icon: Gift,
  sub: "Công cụ miễn phí cho cả nhà",
  moi: true,
};

/** «Khuyến mãi» (12/11/2026) — chương trình ưu đãi đang áp dụng; đi cặp với hộp quà ở nhóm KHÁM PHÁ. */
const MUC_KHUYEN_MAI: Item = {
  label: "Khuyến mãi",
  href: "/portal/khuyen-mai",
  icon: Tag,
  sub: "Ưu đãi đang áp dụng",
};

/** Chỉ hiện khi bật cờ `EVAL_V2_ENABLED` — trang tự chặn khi cờ tắt. */
const MUC_DANH_GIA_GV: Item = {
  label: "Đánh giá giáo viên",
  href: "/portal/danh-gia-gv",
  icon: Star,
};

/** Chỉ hiện khi tài khoản là đối tác Affiliate (trang tự 404 ở mọi trường hợp khác). */
const MUC_GIOI_THIEU: Item = {
  label: "Giới thiệu",
  href: "/portal/gioi-thieu",
  icon: Gift,
};

/** Năm mục của thanh tab dưới; mục thứ năm ("Thêm") mở màn menu đầy đủ. */
const TAB_HREFS = ["/portal", "/portal/lich", "/portal/hinh-anh", "/portal/tin-nhan"];

function chuanHoa(pathname: string): string {
  // Host hocvien.* rewrite "/" → /portal và "/x" → /portal/x nhưng URL trình duyệt giữ
  // nguyên → thêm tiền tố trước khi so, nếu không không mục nào được tô sáng.
  if (pathname === "/") return "/portal";
  return pathname.startsWith("/portal") ? pathname : `/portal${pathname}`;
}

function dangO(pathname: string, href: string): boolean {
  const p = chuanHoa(pathname);
  if (href === "/portal") return p === "/portal";
  return p === href || p.startsWith(`${href}/`);
}

function Badge({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--sr-orange)] px-1.5 text-[11px] font-bold text-[var(--sr-on-orange)]",
        className,
      )}
    >
      {n > 9 ? "9+" : n}
    </span>
  );
}

function NhanMoi({ nen }: { nen: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-[7px] py-px text-[10px] font-bold tracking-[0.04em]",
        nen ? "bg-white/20 text-white" : "bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]",
      )}
    >
      MỚI
    </span>
  );
}

function Logo({ className, href = "/portal" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      aria-label="Sata Robo — Trang chủ"
      className={cn(
        "flex items-baseline gap-0.5 font-display text-[26px] font-extrabold tracking-[0.02em] no-underline",
        className,
      )}
    >
      <span className="text-[var(--sr-orange)]">SATA</span>
      <span className="text-[var(--sr-purple-text)]">ROBO</span>
    </Link>
  );
}

function tenRutGon(name: string): string {
  return name.trim();
}

function chuViet(name: string): string {
  const w = name.trim().split(/\s+/).filter((x) => /\p{L}/u.test(x[0] ?? ""));
  return (w.slice(-2).map((x) => x[0]).join("") || "HS").toUpperCase();
}

export function SrShell({
  userId,
  parentName,
  activeStudentName,
  notifCount,
  msgCount = 0,
  switcherChildren = [],
  evalV2Enabled = false,
  coGioiThieu,
  coDisc = false,
  coTuSach,
  coSucKhoe,
  coBaiTap,
  coHocTap,
  soKhuyenMaiMoi,
  quyDinhNgay,
  children,
}: {
  userId: string;
  parentName: string;
  activeStudentName?: string | null;
  notifCount: number;
  msgCount?: number;
  switcherChildren?: SwitcherChild[];
  evalV2Enabled?: boolean;
  /** BẮT BUỘC, không mặc định (luật 11): quên truyền = mục «Giới thiệu» biến mất im lặng. */
  coGioiThieu: boolean;
  /** Cờ `DISC_ENABLED` — hiện mục «Khám phá DISC». */
  coDisc?: boolean;
  /** BẮT BUỘC, không mặc định (luật 11): quên truyền = mục «Tủ sách gia đình» biến mất im lặng. `isTuSachEnabled()` ∧ PARENT ở layout. */
  coTuSach: boolean;
  /** BẮT BUỘC, không mặc định (luật 11): quên truyền = mục «Sức khỏe cả nhà» biến mất im lặng. `isSucKhoeEnabled()` ∧ PARENT ở layout. */
  coSucKhoe: boolean;
  /**
   * BẮT BUỘC, không mặc định (luật 11): quên truyền = mục «Bài tập & bài thi» biến mất im lặng (hoặc hiện mà route đã 404).
   * Tính ở layout bằng `mucBaiTapBaiThiDangHien()` — tạm ẩn 03/11/2026, xem lib/portal/muc-tam-an.ts.
   */
  coBaiTap: boolean;
  /**
   * BẮT BUỘC, không mặc định (luật 11): quên truyền = tài khoản chưa có bé nào vẫn thấy cả menu học tập, bấm vào chỉ gặp
   * thông báo «chưa liên kết học viên» (link chết — luật 12). Tính ở layout bằng `children_.length > 0`.
   * `false` (khách làm DISC nhưng chưa đăng ký học) ⇒ ẩn MỌI mục học tập / khoá học / học phí / bé; chỉ còn lối vào DISC.
   * Đăng ký xong có bé ⇒ layout truyền `true` ⇒ menu đầy đủ trở lại, không cần làm gì thêm.
   */
  coHocTap: boolean;
  /**
   * BẮT BUỘC, không mặc định (luật 11): số chương trình khuyến mãi MỚI ra (≤ 14 ngày) cho nhãn «N MỚI» ở ô Khuyến mãi của màn «Thêm».
   * Quên truyền = nhãn biến mất im lặng. Tính ở layout từ `docKhuyenMaiChoPhuHuynh` (lỗi đọc ⇒ 0).
   */
  soKhuyenMaiMoi: number;
  /**
   * BẮT BUỘC, không mặc định (luật 11): ngày (dd/mm/yyyy) ba mẹ đã đồng ý «Quy định đào tạo» — hiện dòng xanh «Đã đồng ý…» ở màn «Thêm».
   * `null` = chưa có mốc / không áp dụng (không có con đã đăng ký) ⇒ không vẽ dòng. Tính ở layout bằng `docDongYQuyDinh`.
   */
  quyDinhNgay: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [soChuaDoc, setSoChuaDoc] = useState(notifCount);
  useEffect(() => setSoChuaDoc(notifCount), [notifCount]);
  useEffect(() => {
    const xong = () => setSoChuaDoc(0);
    window.addEventListener(SU_KIEN_DA_DOC_THONG_BAO, xong);
    return () => window.removeEventListener(SU_KIEN_DA_DOC_THONG_BAO, xong);
  }, []);
  // MỘT hook cho cả vỏ: menu bên, thanh tab và màn "Thêm" cùng đọc con số qua `badgeFor`.
  const tinChuaDoc = useChatUnread(userId, msgCount);
  const badgeFor = (href: string): number =>
    href === "/portal/thong-bao" ? soChuaDoc : href === "/portal/tin-nhan" ? tinChuaDoc : 0;

  const [moThem, setMoThem] = useState(false);
  // Đổi trang thì đóng màn "Thêm".
  useEffect(() => setMoThem(false), [pathname]);
  useEffect(() => {
    if (!moThem) return;
    const phim = (e: KeyboardEvent) => e.key === "Escape" && setMoThem(false);
    window.addEventListener("keydown", phim);
    return () => window.removeEventListener("keydown", phim);
  }, [moThem]);

  // Mục có điều kiện (cờ / đối tác) nằm trong nhóm TRUNG TÂM — không còn nhóm «Tiện ích khác».
  // «Bài tập & bài thi» tạm ẩn (03/11/2026): lọc ở MỘT hàm dùng chung với route và action.
  const mucCon = locMucBaiTapBaiThi(NHOM_CON, coBaiTap);
  // Gói miễn phí (mở cả khi chưa có bé): Quà tặng + Khuyến mãi.
  // 12/11/2026: ba mục rời (DISC · Sức khỏe · Tủ sách) gộp thành «Quà tặng» + «Khuyến mãi»; mở khi có ít nhất một quà (mọi cờ tắt ⇒ không có gì để tặng).
  const mucMienPhi = coQuaTangNao({ disc: coDisc, sucKhoe: coSucKhoe, tuSach: coTuSach }) ? [MUC_QUA_TANG, MUC_KHUYEN_MAI] : [];
  const nhomCon = [...mucCon, ...mucMienPhi];
  const nhomTrungTam = [
    ...NHOM_TRUNG_TAM,
    ...(evalV2Enabled ? [MUC_DANH_GIA_GV] : []),
    ...(coGioiThieu ? [MUC_GIOI_THIEU] : []),
  ];
  // Chưa có bé nào (khách làm DISC chưa đăng ký học): layout thay THÂN mọi trang trừ /portal/disc bằng «chưa liên kết học viên»
  // (components/portal/khung-chua-lien-ket.tsx), nên menu chỉ được giữ đúng thứ còn mở được — lối vào DISC.
  const tatCa = coHocTap ? [...nhomCon, ...NHOM_VIEC, ...nhomTrungTam] : mucMienPhi;
  // Trang chủ của vỏ: chưa có bé thì «Tổng quan» chỉ là thông báo «chưa liên kết» ⇒ logo dẫn thẳng tới DISC (không để link chết).
  const trangChu = coHocTap || mucMienPhi.length === 0 ? "/portal" : (mucMienPhi[0]?.href ?? "/portal");
  const tabItems = coHocTap
    ? TAB_HREFS.flatMap((h) => {
        const it = tatCa.find((i) => i.href === h);
        return it ? [it] : [];
      })
    : tatCa;
  const themDangChon =
    moThem || !tabItems.some((i) => dangO(pathname, i.href));

  const nhomMenu: { title: string; items: Item[] }[] = coHocTap
    ? [
        { title: "CON CỦA TÔI", items: nhomCon },
        { title: "VIỆC CỦA BA MẸ", items: NHOM_VIEC },
        { title: "TRUNG TÂM", items: nhomTrungTam },
      ]
    : tatCa.length > 0
      ? [{ title: "KHÁM PHÁ", items: tatCa }]
      : [];

  return (
    <div className="flex min-h-screen flex-wrap items-stretch bg-background font-sans text-foreground">
      {/* Menu bên (≥900px) */}
      <aside
        aria-label="Menu cổng phụ huynh"
        className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-card px-4 py-6 min-[900px]:flex"
      >
        <Logo className="px-2" href={trangChu} />
        {coHocTap && (
          <ChipCon
            activeStudentName={activeStudentName ?? null}
            childrenList={switcherChildren}
          />
        )}
        {nhomMenu.map((g) => (
          <div key={g.title} className="flex flex-col gap-1">
            <div className="px-3 pb-1.5 text-[11px] font-bold tracking-[0.08em] text-muted-foreground">
              {g.title}
            </div>
            {g.items.map((it) => (
              <MucMenuBen
                key={it.href}
                item={it}
                active={dangO(pathname, it.href)}
                badge={badgeFor(it.href)}
              />
            ))}
          </div>
        ))}
        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-4">
          <DoiGiaoDien />
          <button
            type="button"
            onClick={() => logoutToGate()}
            className="flex min-h-10 items-center gap-3 rounded-[10px] px-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-[18px] shrink-0" aria-hidden="true" />
            Đăng xuất
          </button>
          <div className="px-3 pt-2 text-xs leading-[18px] text-muted-foreground">
            Hotline{" "}
            <a
              href="tel:0837312860"
              className="font-bold text-[var(--sr-purple-text)]"
            >
              0837.312.860
            </a>
            <br />
            Mở cửa 8:00–21:00, T3–CN
          </div>
          <LinkChinhSachBaoMat className="px-3 pt-1 text-left" />
        </div>
      </aside>

      {/* Nội dung */}
      <div className="flex min-w-0 flex-[999_1_560px] flex-col">
        <main className="min-w-0 flex-1 px-[clamp(16px,3vw,40px)] pb-[110px] pt-7 min-[900px]:pb-14">
          <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
            {children}
          </div>
        </main>
        <div className="border-t border-border px-4 pb-[100px] pt-3 min-[900px]:px-6 min-[900px]:pb-3">
          <DaiLinkPhapLy />
        </div>
      </div>

      {/* Màn "Thêm" (<900px) */}
      {moThem && (
        <ManThem
          trangChu={trangChu}
          parentName={parentName}
          activeStudentName={activeStudentName ?? null}
          childrenList={switcherChildren}
          nhom={nhomMenu}
          badgeFor={badgeFor}
          coHopQua={mucMienPhi.length > 0}
          soKhuyenMaiMoi={soKhuyenMaiMoi}
          quyDinhNgay={quyDinhNgay}
          coHocTap={coHocTap}
          onClose={() => setMoThem(false)}
        />
      )}

      {/* Thanh tab dưới (<900px) */}
      <nav
        aria-label="Điều hướng chính"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 grid h-[84px] border-t border-border bg-card px-1 pb-[22px] pt-2 min-[900px]:hidden",
          // Chưa có bé: chỉ còn tab DISC (nếu cờ bật) + «Thêm» ⇒ không kéo dãn 5 cột trống.
          coHocTap ? "grid-cols-5" : tabItems.length > 0 ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {tabItems.map((it) => {
          const on = !moThem && dangO(pathname, it.href);
          const Icon = it.icon;
          const badge = badgeFor(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={() => setMoThem(false)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-1 text-[11px] no-underline",
                on
                  ? "font-bold text-[var(--sr-purple-text)]"
                  : "font-medium text-muted-foreground",
              )}
            >
              <span className="relative flex">
                <Icon className="size-[22px]" aria-hidden="true" />
                {badge > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-1.5 -top-[3px] size-[9px] rounded-full border-2 border-card bg-[var(--sr-orange)]"
                  />
                )}
              </span>
              {it.tab ?? it.label}
            </Link>
          );
        })}
        <button
          type="button"
          aria-expanded={moThem}
          onClick={() => setMoThem((v) => !v)}
          className={cn(
            "relative flex min-h-12 flex-col items-center justify-center gap-1 text-[11px]",
            themDangChon
              ? "font-bold text-[var(--sr-purple-text)]"
              : "font-medium text-muted-foreground",
          )}
        >
          <span className="relative flex">
            <Menu className="size-[22px]" aria-hidden="true" />
            {nhomMenu
              .flatMap((g) => g.items)
              .some(
                (i) =>
                  !TAB_HREFS.includes(i.href) &&
                  i.href !== "/portal" &&
                  badgeFor(i.href) > 0,
              ) && (
              <span
                aria-hidden="true"
                className="absolute -right-1.5 -top-[3px] size-[9px] rounded-full border-2 border-card bg-[var(--sr-orange)]"
              />
            )}
          </span>
          Thêm
        </button>
      </nav>
    </div>
  );
}

function MucMenuBen({
  item,
  active,
  badge,
}: {
  item: Item;
  active: boolean;
  badge: number;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-sm no-underline transition-colors",
        active
          ? "bg-[var(--sr-purple)] font-semibold text-white"
          : "font-medium text-foreground hover:bg-muted",
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <Icon className="size-[18px] shrink-0" aria-hidden="true" />
        <span className="truncate">{item.label}</span>
      </span>
      {item.moi ? <NhanMoi nen={active} /> : <Badge n={badge} />}
    </Link>
  );
}

function DoiGiaoDien() {
  const { isDark, setTheme, mounted } = usePortalAppearance();
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
      className="flex min-h-10 items-center gap-3 rounded-[10px] px-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {/* Trước khi mount chưa đọc được localStorage → luôn vẽ theo SÁNG để khớp SSR. */}
      {mounted && isDark ? (
        <Sun className="size-[18px] shrink-0" aria-hidden="true" />
      ) : (
        <Moon className="size-[18px] shrink-0" aria-hidden="true" />
      )}
      {mounted && isDark ? "Giao diện sáng" : "Giao diện tối"}
    </button>
  );
}

/** Chip "đang xem" ở đầu menu bên — bấm để đổi con hoặc vào Cổng học sinh. */
function ChipCon({
  activeStudentName,
  childrenList,
}: {
  activeStudentName: string | null;
  childrenList: SwitcherChild[];
}) {
  const router = useRouter();
  const { pending, switchTo } = useSetActiveSite();
  const [mo, setMo] = useState(false);
  const goc = useRef<HTMLDivElement>(null);
  // Đang mở thì bấm RA NGOÀI vùng chip + danh sách, hoặc nhấn Escape, là đóng (trước đây chỉ bấm lại mũi tên mới đóng).
  useEffect(() => {
    if (!mo) return;
    const raNgoai = (e: Event) => {
      if (goc.current && e.target instanceof Node && !goc.current.contains(e.target)) setMo(false);
    };
    const phim = (e: KeyboardEvent) => e.key === "Escape" && setMo(false);
    document.addEventListener("pointerdown", raNgoai);
    document.addEventListener("keydown", phim);
    return () => {
      document.removeEventListener("pointerdown", raNgoai);
      document.removeEventListener("keydown", phim);
    };
  }, [mo]);
  const dangXem =
    childrenList.find((c) => c.active) ?? childrenList[0] ?? null;
  const ten = tenRutGon(activeStudentName ?? dangXem?.name ?? "Chưa chọn con");
  return (
    <div ref={goc} className="relative">
      <button
        type="button"
        aria-expanded={mo}
        aria-label={`Đang xem ${ten} — bấm để đổi con`}
        onClick={() => setMo((v) => !v)}
        disabled={pending}
        className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-[var(--sr-tint-purple)] p-3 text-left disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--sr-orange)] text-[15px] font-bold text-[var(--sr-on-orange)]"
        >
          {chuViet(ten)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 break-words text-[15px] font-bold leading-tight text-foreground">{ten}</span>
          <span className="truncate text-xs text-muted-foreground">
            {dangXem?.courseName ?? "Chưa có khoá đang học"}
          </span>
        </span>
        <ChevronDown className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {mo && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 flex flex-col gap-1 rounded-xl border border-border bg-popover p-2 shadow-lg">
          {childrenList.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.active}
              disabled={pending || c.active}
              onClick={() => {
                setMo(false);
                switchTo(c.id);
              }}
              className={cn(
                "flex min-h-11 items-center gap-2.5 rounded-lg px-2 text-left text-sm",
                c.active ? "bg-[var(--sr-tint-purple)] font-bold" : "hover:bg-muted",
              )}
            >
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--sr-tint-purple)] text-xs font-bold text-[var(--sr-purple-text)]"
              >
                {c.initials}
              </span>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
            </button>
          ))}
          {dangXem && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setMo(false);
                switchTo(dangXem.id, {
                  onSuccess: (r) => {
                    r.push("/portal/hoc-sinh/vao");
                    r.refresh();
                  },
                });
              }}
              className="flex min-h-11 items-center rounded-lg px-2 text-left text-sm font-semibold text-[var(--sr-purple-text)] hover:bg-muted"
            >
              Mở Cổng học sinh của {tenRutGon(dangXem.name)}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setMo(false);
              router.push("/portal/ho-so");
            }}
            className="flex min-h-11 items-center rounded-lg px-2 text-left text-sm font-medium hover:bg-muted"
          >
            Hồ sơ gia đình
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Màn "Thêm" của bản điện thoại — theo artifact M-Them.dc.html (12/11/2026): thẻ con (xuống dòng, KHÔNG lướt ngang) → hai ô nổi bật Quà tặng + Khuyến mãi
 * → hotline → «Cho con vào Cổng học sinh» (sticker robot Sata Robo) → ba nhóm mục → dòng «Đã đồng ý Quy định» → Đăng xuất.
 * Hai mục Quà tặng / Khuyến mãi KHÔNG lặp trong danh sách nhóm (đã là hai ô ở đầu màn); menu bên ≥900px vẫn giữ chúng như cũ.
 */
function ManThem({
  trangChu,
  parentName,
  activeStudentName,
  childrenList,
  nhom,
  badgeFor,
  coHopQua,
  soKhuyenMaiMoi,
  quyDinhNgay,
  coHocTap,
  onClose,
}: {
  trangChu: string;
  parentName: string;
  activeStudentName: string | null;
  childrenList: SwitcherChild[];
  nhom: { title: string; items: Item[] }[];
  badgeFor: (href: string) => number;
  coHopQua: boolean;
  soKhuyenMaiMoi: number;
  quyDinhNgay: string | null;
  coHocTap: boolean;
  onClose: () => void;
}) {
  const { pending, switchTo } = useSetActiveSite();
  const { isDark, setTheme } = usePortalAppearance();
  const dangXem = childrenList.find((c) => c.active) ?? childrenList[0];
  // Hai mục đã thành ô ở đầu màn ⇒ bỏ khỏi danh sách; nhóm rỗng thì không vẽ tiêu đề trơ.
  const nhomHienThi = nhom
    .map((g) => ({
      ...g,
      title: g.title === "TRUNG TÂM" ? "TRUNG TÂM & TÀI KHOẢN" : g.title,
      items: g.items.filter((it) => it.href !== MUC_QUA_TANG.href && it.href !== MUC_KHUYEN_MAI.href),
    }))
    .filter((g) => g.items.length > 0);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tất cả mục của cổng phụ huynh"
      className="fixed inset-0 z-40 overflow-y-auto bg-background pb-[120px] min-[900px]:hidden"
    >
      <header className="flex flex-col gap-3.5 px-4 pb-2 pt-5">
        <div className="flex items-center justify-between">
          <Logo className="text-[22px]" href={trangChu} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="grid size-11 place-items-center rounded-xl text-foreground"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        {childrenList.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground">ĐANG XEM</div>
            <div
              role="group"
              aria-label="Chọn con"
              className="flex flex-wrap gap-2"
            >
              {childrenList.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={c.active}
                  disabled={pending || c.active}
                  onClick={() => switchTo(c.id)}
                  className={cn(
                    "flex h-[52px] min-w-[150px] flex-1 items-center gap-2 rounded-[14px] px-2.5 text-left text-foreground",
                    c.active
                      ? "border-2 border-[var(--sr-purple)] bg-[var(--sr-tint-purple)]"
                      : "border border-border bg-card",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-[34px] shrink-0 place-items-center rounded-full text-xs font-bold",
                      c.active
                        ? "bg-[var(--sr-orange)] text-[var(--sr-on-orange)]"
                        : "bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]",
                    )}
                  >
                    {c.initials}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-bold">{c.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{c.courseName ?? "Chưa có khoá"}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {childrenList.length === 0 && activeStudentName && (
          <div className="text-sm font-semibold">{activeStudentName}</div>
        )}
      </header>

      <div className="flex flex-col gap-[18px] px-4 pb-6 pt-2">
        {/* Hai ô nổi bật — chỉ khi có ít nhất một quà (mọi cờ tắt ⇒ không có gì để tặng, và route đã 404). */}
        {coHopQua && (
          <div className="grid grid-cols-2 gap-2.5">
            <Link
              href={MUC_QUA_TANG.href}
              onClick={onClose}
              aria-label="Quà tặng: DISC, Sức khoẻ, Tủ sách"
              className="flex min-h-[112px] flex-col gap-1.5 rounded-[18px] bg-gradient-to-br from-[#620c8b] via-[#8a2d9e] to-[#c2570c] p-3.5 text-white no-underline shadow-[0_8px_18px_rgba(98,12,139,0.25)]"
            >
              <Gift className="size-8" aria-hidden="true" />
              <b className="text-base">Quà tặng</b>
              <span className="text-xs leading-4 opacity-90">DISC · Sức khoẻ · Tủ sách</span>
            </Link>
            <Link
              href={MUC_KHUYEN_MAI.href}
              onClick={onClose}
              aria-label={soKhuyenMaiMoi > 0 ? `Khuyến mãi: ${soKhuyenMaiMoi} chương trình mới` : "Khuyến mãi: ưu đãi đang chạy"}
              className="flex min-h-[112px] flex-col gap-1.5 rounded-[18px] bg-gradient-to-br from-[var(--sr-orange)] to-[#f06a1f] p-3.5 text-[var(--sr-on-orange)] no-underline shadow-[0_8px_18px_rgba(240,106,31,0.25)]"
            >
              <span className="flex items-center justify-between">
                <Tag className="size-8" aria-hidden="true" />
                {soKhuyenMaiMoi > 0 && (
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-extrabold text-[#c2570c]">
                    {soKhuyenMaiMoi} MỚI
                  </span>
                )}
              </span>
              <b className="text-base">Khuyến mãi</b>
              <span className="text-xs leading-4">Ưu đãi đang chạy</span>
            </Link>
          </div>
        )}

        <a
          href="tel:0837312860"
          className="flex items-center gap-3 rounded-[18px] bg-[var(--sr-purple)] p-4 text-white no-underline"
        >
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--sr-orange)] text-[var(--sr-on-orange)]"
          >
            <Phone className="size-5" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-bold">Hotline 0837.312.860</span>
            <span className="text-xs text-[var(--sr-hero-text)]">8:00–21:00 · thứ 3 đến chủ nhật</span>
          </span>
        </a>

        {/* Lối vào Cổng học sinh của con ĐANG XEM (cùng cơ chế «Mở Cổng học sinh của …» ở chip menu bên): đặt con đang xem rồi tới «Cho con vào». */}
        {coHocTap && dangXem && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              switchTo(dangXem.id, {
                onSuccess: (r) => {
                  onClose();
                  r.push("/portal/hoc-sinh/vao");
                  r.refresh();
                },
              });
            }}
            className="relative flex items-center gap-3.5 overflow-hidden rounded-[18px] border-2 border-[var(--sr-orange)] bg-gradient-to-br from-[#fff1d6] to-[#ffd3a8] p-4 text-left text-[#241133] shadow-[0_6px_16px_rgba(254,143,45,0.25)] disabled:opacity-70"
          >
            <span aria-hidden="true" className="grid h-[60px] w-[56px] shrink-0 place-items-center">
              <Sticker ten="may-tinh" cao={60} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="text-base font-extrabold">Cho con vào Cổng học sinh</span>
              <span className="text-[13px] leading-[18px] text-[#5a3a12]">
                Con tự làm bài, xem huy hiệu, SataCoin trên máy này
              </span>
            </span>
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--sr-purple)] text-white"
            >
              <ArrowRight className="size-[18px]" />
            </span>
          </button>
        )}

        {nhomHienThi.map((g) => (
          <section key={g.title} className="flex flex-col gap-2">
            <h2 className="m-0 px-1 text-[11px] font-bold tracking-[0.08em] text-muted-foreground">{g.title}</h2>
            <div className="overflow-hidden rounded-[18px] border border-border bg-card">
              {g.items.map((it) => {
                const Icon = it.icon;
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={onClose}
                    className="flex min-h-14 items-center gap-3 border-b border-[var(--sr-tint-purple)] px-4 text-foreground no-underline last:border-b-0"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]"
                    >
                      <Icon className="size-[18px]" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="text-[15px] font-semibold">{it.label}</span>
                      {it.sub && <span className="text-xs text-muted-foreground">{it.sub}</span>}
                    </span>
                    {it.moi ? <NhanMoi nen={false} /> : <Badge n={badgeFor(it.href)} className="px-2" />}
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}

        {quyDinhNgay && (
          <Link
            href="/portal/quy-dinh"
            onClick={onClose}
            aria-label={`Đã đồng ý Quy định đào tạo học viên ngày ${quyDinhNgay} — bấm để xem lại`}
            className="flex items-center gap-3 rounded-[18px] bg-[var(--sr-success-bg)] px-4 py-3.5 text-foreground no-underline"
          >
            <span
              aria-hidden="true"
              className="grid size-[34px] shrink-0 place-items-center rounded-full bg-[var(--sr-success)] text-[var(--sr-success-bg)]"
            >
              <Check className="size-[18px]" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-bold">Đã đồng ý Quy định đào tạo</span>
              <span className="text-xs">{quyDinhNgay} · bấm để xem lại quy định</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-[var(--sr-success)]" aria-hidden="true" />
          </Link>
        )}

        <button
          type="button"
          onClick={() => logoutToGate()}
          className="flex h-12 items-center justify-center gap-2 rounded-[14px] border border-border bg-card text-[15px] font-semibold text-[var(--sr-danger)]"
        >
          <LogOut className="size-4" aria-hidden="true" />
          Đăng xuất
        </button>
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-muted-foreground"
        >
          {isDark ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
          {isDark ? "Giao diện sáng" : "Giao diện tối"}
        </button>
        <p className="m-0 text-center text-xs text-muted-foreground">{parentName}</p>
        <LinkChinhSachBaoMat className="text-center" />
      </div>
    </div>
  );
}

/**
 * «Chính sách bảo mật» ở cuối menu (13/11/2026, chủ dự án: «để có gì PH còn có thể đọc lại luôn»).
 * Link TUYỆT ĐỐI sang satarobo.vn: trên host hocvien mọi đường dẫn tương đối bị viết lại thành `/portal/…`
 * (`decideRoute`, nhánh portal) nên `/chinh-sach-bao-mat` sẽ thành trang 404. Mở thẻ mới để không rời cổng.
 */
const URL_CHINH_SACH_BAO_MAT = legalUrlTuyetDoi("chinh-sach-bao-mat");

function LinkChinhSachBaoMat({ className }: { className?: string }) {
  return (
    <a
      href={URL_CHINH_SACH_BAO_MAT}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground", className)}
    >
      Chính sách bảo mật
    </a>
  );
}
