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
import type { ModuleAction, ModuleScope } from "@/lib/cham-cong/module-scope";
import { TAB, TAB_ACTIVE, TAB_IDLE } from "./classes";

export type ModuleNavKey =
  | "ngay"
  | "luoi"
  | "bangthang"
  | "ky"
  | "thongke"
  | "congday"
  | "don"
  | "nghibu"
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
          return (
            <Link
              key={t.key}
              href={scopeHref(base, ctx, t.ok(scope, ctx.coSo))}
              aria-current={isActive ? "page" : undefined}
              className={cn(TAB, isActive ? TAB_ACTIVE : TAB_IDLE)}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
