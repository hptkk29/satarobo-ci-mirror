// components/admin/cham-cong/module-nav.tsx — hàng tab đứng đầu MỌI màn chấm công.
//
// Vì sao file này tồn tại: sidebar cũ bày 15 mục phẳng của riêng module này, nên người dùng
// phải nhớ màn nào ở đâu, và chuyển màn là rơi hết ngữ cảnh (đang xem kỳ nào, khối nào).
// Sidebar rút còn 5 mục; 6 tab dưới đây là đường đi bên trong module, và mỗi href đi qua
// `scopeHref()` nên kỳ/khối/ngày theo người dùng sang màn kế.
//
// Hai luật không được phá:
//  1. `href` là CHUỖI LITERAL — `components/admin/nav-coverage.test.ts` quét chuỗi đứng ngay sau
//     `href:` để biết route nào còn lối vào. Ghép động (`${base}/phan-ca`) là route thành mồ côi
//     và test đỏ.
//  2. Tab phải tự lọc theo quyền. ModuleNav KHÔNG nằm trong `sidebar.tsx` nên không bộ test nào
//     bắt được dead-link ở đây — hiện tab của màn người ta không vào được là đẩy họ vào màn
//     "không có quyền" do chính mình vẽ ra.
import Link from "next/link";
import { cn } from "@/lib/utils";
import { scopeHref, type ScopeCtx } from "@/lib/cham-cong/scope-href";
import type { ModuleAction, ModuleScope, ScopeBlock } from "@/lib/cham-cong/module-scope";
import { khoiParttime } from "@/lib/cham-cong/khoi-parttime";
import { TAB, TAB_ACTIVE, TAB_IDLE } from "./classes";

export type ModuleNavKey =
  | "ngay"
  | "luoi"
  | "phancong"
  | "congpt"
  | "bangthang"
  | "ky"
  | "xacnhan"
  | "thongke"
  | "congday"
  | "don"
  | "nghibu"
  | "sophep"
  | "doisoat"
  | "cauhinh";

/** Màn Cấu hình khi người dùng KHÔNG có `hr_attendance:config`: rơi về Loại nghỉ (chỉ cần view). */
const CAU_HINH_KHONG_CONFIG = "/cham-cong/loai-nghi";

type Tab = {
  key: ModuleNavKey;
  label: string;
  href: string;
  /** Tab có hiện không. */
  show: (s: ModuleScope) => boolean;
  /** Khối đang chọn còn dùng được ở màn đích không — sai thì không đẩy `?coSo=` sang. */
  ok: (s: ModuleScope, coSo: string | null | undefined) => boolean;
  /**
   * Chỉ hai tab Parttime: khối mà màn đích SẼ MỞ có đang "chưa bật" không ⇒ in nhãn "Chưa bật". Khối đó suy từ CHÍNH href vừa dựng
   * (`?coSo=` nó mang) qua `khoiParttime` — cùng phép với trang, nên nhãn không nói khác màn.
   */
  chuaBat?: (b: ScopeBlock) => boolean;
};

const VIEW: ModuleAction = "hr_attendance:view";
const ASSIGN: ModuleAction = "hr_attendance:assign";
const APPROVE: ModuleAction = "hr_attendance:approve";
const CONFIG: ModuleAction = "hr_attendance:config";

const TABS: Tab[] = [
  {
    key: "ngay",
    label: "Bảng công ngày",
    href: "/cham-cong",
    show: (s) => s.any(VIEW),
    ok: (s, c) => s.has(VIEW, c),
  },
  {
    key: "luoi",
    label: "Lưới phân ca",
    href: "/cham-cong/phan-ca",
    show: (s) => s.any(ASSIGN) || s.any(VIEW),
    ok: (s, c) => s.has(ASSIGN, c) || s.has(VIEW, c),
  },
  {
    // SR.QD.238 (P2) — cạnh "Lưới phân ca": lưới xếp NGƯỜI × NGÀY, màn này xếp NGƯỜI × BUỔI (đứng chính / trợ giảng)
    // và cho thấy họ đã tự nhận lớp chưa.
    // ĐẢO 20/10/2026 (chủ dự án, nghiệm thu đường vào): bản 19/10 ẩn tab khi cơ sở chưa bật Parttime (MENU_HIDDEN_WHEN_DISABLED)
    // ⇒ màn chỉ mở được bằng link dán tay. Nay tab hiện cho MỌI người xem được màn (VIEW / ASSIGN ở một khối — cùng phép với chính
    // trang, `khoiParttime`), kèm nhãn "Chưa bật" khi khối màn sẽ mở chưa bật. Không nới quyền: màn vẫn chỉ đọc khối người dùng có
    // quyền, và khi tắt không ghi được (cổng `congThaoTacParttime`). Site giáo viên GIỮ ẩn mục menu khi tắt.
    key: "phancong",
    label: "Phân công buổi",
    href: "/cham-cong/phan-cong",
    show: (s) => khoiParttime(s, null) !== null,
    ok: (s, c) => s.has(ASSIGN, c) || s.has(VIEW, c),
    chuaBat: (b) => !b.parttimeStaffing,
  },
  {
    // SR.QD.238 (P5) — số tháng của Parttime: tiết đã xác nhận, ca trực, đối soát, khoản trừ ĐỀ XUẤT. KHÁC "Bảng công tháng" (công
    // ngày theo ca của mọi nhân sự) và KHÔNG phải bảng lương. Trước 20/10/2026 chỉ vào được bằng một liên kết chữ trên đầu màn
    // Phân công buổi. "Chưa bật" theo công tắc ĐỐI SOÁT (thứ màn này đọc), không theo công tắc phân công — đợt 1 (chỉ bật phân công)
    // thì tab này vẫn "Chưa bật".
    key: "congpt",
    label: "Công parttime tháng",
    href: "/cham-cong/phan-cong/thang",
    show: (s) => khoiParttime(s, null) !== null,
    ok: (s, c) => s.has(ASSIGN, c) || s.has(VIEW, c),
    chuaBat: (b) => !b.parttimeShadow,
  },
  {
    // Ngay sau "Lưới phân ca": cùng một lưới người × ngày, chỉ khác chỗ lưới kia là KẾ HOẠCH
    // (xếp ai vào ca nào) còn màn này là KẾT QUẢ (hôm đó họ chấm ra sao). Đặt cạnh nhau để
    // người xếp ca đổi qua lại mà không phải nhớ đường.
    key: "bangthang",
    label: "Bảng công tháng",
    href: "/cham-cong/bang-cong-thang",
    show: (s) => s.any(VIEW),
    ok: (s, c) => s.has(VIEW, c),
  },
  {
    key: "ky",
    label: "Kỳ công & chốt",
    href: "/cham-cong/ky-cong",
    show: (s) => s.any(VIEW),
    ok: (s, c) => s.has(VIEW, c),
  },
  {
    // P2.2 — ngay sau "Kỳ công": nhân sự xác nhận / khiếu nại là bước TRƯỚC khi chốt kỳ.
    key: "xacnhan",
    label: "Xác nhận công",
    href: "/cham-cong/xac-nhan-cong",
    show: (s) => s.any(VIEW),
    ok: (s, c) => s.has(VIEW, c),
  },
  {
    // Đặt NGAY SAU "Kỳ công": cùng một câu hỏi cuối tháng, chỉ khác chỗ kỳ công trả lời "bao
    // nhiêu công để trả lương" còn màn này trả lời "kỷ luật quét thế nào". Tách ra vì bảng kỳ
    // công đã 13 cột / 1100px — nhồi thêm ba cột nữa là hỏng cả hai.
    key: "thongke",
    label: "Nội quy & thống kê",
    href: "/cham-cong/thong-ke",
    show: (s) => s.any(VIEW),
    ok: (s, c) => s.has(VIEW, c),
  },
  {
    // Sau "Nội quy & thống kê": cả hai đều là số cuối tháng, chỉ khác chỗ một cái nói về kỷ
    // luật quét, một cái nói về buổi đứng lớp.
    key: "congday",
    label: "Công dạy",
    href: "/cham-cong/cong-day",
    show: (s) => s.any(VIEW),
    ok: (s, c) => s.has(VIEW, c),
  },
  {
    key: "don",
    label: "Đơn từ",
    href: "/don-tu",
    show: (s) => s.any(APPROVE),
    ok: (s, c) => s.has(APPROVE, c),
  },
  {
    // Sau "Đơn từ": quỹ nghỉ bù là thứ đơn nghỉ bù trừ vào và tăng ca quy đổi cộng vào.
    key: "nghibu",
    label: "Nghỉ bù",
    href: "/cham-cong/nghi-bu",
    show: (s) => s.any(VIEW),
    ok: (s, c) => s.has(VIEW, c),
  },
  {
    // Cạnh "Nghỉ bù": hai quỹ nghỉ của cùng một người, cùng khuôn sổ cái theo phút.
    key: "sophep",
    label: "Sổ phép",
    href: "/cham-cong/so-phep",
    show: (s) => s.any(VIEW),
    ok: (s, c) => s.has(VIEW, c),
  },
  {
    key: "doisoat",
    label: "Đối soát",
    href: "/cham-cong/doi-soat",
    show: (s) => s.any(VIEW),
    ok: (s, c) => s.has(VIEW, c),
  },
  {
    key: "cauhinh",
    label: "Cấu hình",
    href: "/cham-cong/danh-muc-ca",
    // Đúng một mục ConfigTabs là đủ để tab này có nghĩa; mục rẻ nhất là Khung ca / Ghi chú
    // (assign ∨ view), nên điều kiện gộp lại là "có bất kỳ quyền nào của module".
    show: (s) => s.any(CONFIG) || s.any(ASSIGN) || s.any(VIEW),
    ok: (s, c) => s.has(CONFIG, c) || s.has(ASSIGN, c) || s.has(VIEW, c),
  },
];

/** `?coSo=` mà href mang (null nếu không mang) — khối màn đích sẽ mở được suy từ ĐÂY, không từ ngữ cảnh trang hiện tại. */
function coSoCuaHref(href: string): string | null {
  const q = href.split("?")[1];
  return q ? new URLSearchParams(q).get("coSo") : null;
}

export function ModuleNav({
  active,
  scope,
  ctx,
}: {
  active: ModuleNavKey;
  scope: ModuleScope;
  ctx: ScopeCtx;
}) {
  const items = TABS.filter((t) => t.show(scope));
  if (items.length === 0) return null;

  return (
    <div className="mb-4 border-b border-border">
      <nav aria-label="Điều hướng chấm công" className="-mb-px flex gap-1 overflow-x-auto">
        {items.map((t) => {
          const base =
            t.key === "cauhinh" && !scope.any(CONFIG) ? CAU_HINH_KHONG_CONFIG : t.href;
          const isActive = t.key === active;
          const href = scopeHref(base, ctx, t.ok(scope, ctx.coSo));
          const dich = t.chuaBat ? khoiParttime(scope, coSoCuaHref(href)) : null;
          const chuaBat = !!(dich && t.chuaBat?.(dich.block));
          return (
            <Link
              key={t.key}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(TAB, isActive ? TAB_ACTIVE : TAB_IDLE, chuaBat && "inline-flex items-center gap-1.5")}
            >
              {t.label}
              {chuaBat && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold leading-none text-muted-foreground">
                  Chưa bật
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
