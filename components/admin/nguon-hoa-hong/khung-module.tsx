// components/admin/nguon-hoa-hong/khung-module.tsx — KHUNG chung của MỌI màn trong module (06 §0, §4):
// `PageHeader → ModuleNav → ScopeBar → nội dung`, khuôn "Sổ kỳ công" của chấm công.
//
// Một khung duy nhất để năm tab không tự dựng lại phần đầu rồi trôi ra khỏi nhau. `ScopeBar` do page truyền
// vào (mỗi tab theo một model/cơ sở khác nhau); khung chỉ lo thứ tự và khoảng cách.
//
// Trạng thái dùng chung ngay ở đây (DESIGN.md §5):
//   · `ThieuQuyen`  — không có quyền: nêu TÊN KEY thật + hỏi ai (không phải 403 trần);
import type { ReactNode } from "react";
import { PageHeader } from "@/components/admin/ui/page-header";
import { NoPermission } from "@/components/admin/ui/states";
import type { NguonHoaHongScope } from "@/lib/nguon-hoa-hong/scope";
import { HOI_AI_TAB, TIEU_DE_TAB, cacKeyCuaTab, type TabKey } from "@/lib/nguon-hoa-hong/tab";
import { ModuleNav } from "./module-nav";

export function KhungModule({
  tab,
  scope,
  soHangCho,
  actions,
  scopeBar,
  tieuDe,
  phuDe,
  children,
}: {
  tab: TabKey;
  scope: NguonHoaHongScope;
  soHangCho: Partial<Record<TabKey, number>>;
  actions?: ReactNode;
  /** Ghi đè tiêu đề/phụ đề của tab (trang chi tiết nguồn lấy tên nguồn làm tiêu đề). */
  tieuDe?: string;
  phuDe?: string;
  scopeBar?: ReactNode;
  children: ReactNode;
}) {
  const t = TIEU_DE_TAB[tab];
  return (
    <div className="max-w-6xl">
      <PageHeader title={tieuDe ?? t.tieuDe} subtitle={phuDe ?? t.phuDe} actions={actions} />
      <ModuleNav active={tab} scope={scope} soHangCho={soHangCho} />
      {scopeBar}
      {children}
    </div>
  );
}

/** Không có quyền: vẫn hiện khung + các tab người này MỞ ĐƯỢC (để có đường đi tiếp), thân là NoPermission. */
export function ThieuQuyen({ tab, scope, soHangCho }: { tab: TabKey; scope: NguonHoaHongScope; soHangCho: Partial<Record<TabKey, number>> }) {
  const t = TIEU_DE_TAB[tab];
  return (
    <KhungModule tab={tab} scope={scope} soHangCho={soHangCho}>
      <NoPermission
        permission={cacKeyCuaTab(tab).join(" hoặc ")}
        what={t.tieuDe.toLowerCase()}
        askWho={HOI_AI_TAB[tab]}
      />
    </KhungModule>
  );
}
