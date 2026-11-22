// Ba tab con CHỈ ĐỌC của tab Khiếu nại & lịch sử — Đổi nguồn · Lịch sử chính sách · Nhật ký — cùng một thân: `AuditTimeline` + phân trang.
//
// Đọc qua `docNhatKyChoMan` (lib/hoa-hong/khieu-nai-man.ts → nhat-ky-doc.ts): kênh + phạm vi theo cơ sở + bảo vệ nội dung nằm ở lib, không ở đây. Không có nút nào: không sửa, không xoá.
// Rỗng nói đúng điều đang rỗng; lỗi đọc nói câu tiếng Việt kèm đường thử lại (DESIGN.md §5).
import Link from "next/link";

import { AuditTimeline } from "@/components/admin/nguon-hoa-hong/audit-timeline";
import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { soVN } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { EmptyState, ErrorState } from "@/components/admin/ui/states";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import type { Actor } from "@/lib/auth/actor";
import { docNhatKyChoMan } from "@/lib/hoa-hong/khieu-nai-man";
import type { KenhNhatKy, KetQuaNhatKy } from "@/lib/hoa-hong/nhat-ky-doc";
import { hrefVoi, kepTrang } from "@/lib/nguon-hoa-hong/url";

const KICH_THUOC = 25;

const MO_TA: Record<KenhNhatKy, { rong: string; chuThich: string }> = {
  "doi-nguon": {
    rong: "Chưa có lần đổi nguồn nào trong phạm vi của bạn.",
    chuThich: "Mỗi lần đổi nguồn của lead: ai đổi, lúc nào, từ nguồn nào sang nguồn nào và vì sao.",
  },
  "chinh-sach": {
    rong: "Chưa có thay đổi chính sách hay văn bản nào được ghi lại.",
    chuThich: "Soạn, kích hoạt, phiên bản mới và văn bản quy định của chính sách hoa hồng.",
  },
  "nhat-ky": {
    rong: "Chưa có thao tác nào ở kỳ, hàng chờ hay khiếu nại trong phạm vi của bạn.",
    chuThich: "Khoá kỳ, xuất bảng chi, giải hàng chờ, quyết định khiếu nại và đặt mốc chuyển sổ.",
  },
};

export async function NhatKyPanel({ actor, kenh, base, giu, trangTho }: { actor: Actor; kenh: KenhNhatKy; base: string; giu: Record<string, string | null>; trangTho: number }) {
  let kq: KetQuaNhatKy;
  try {
    kq = await docNhatKyChoMan(actor, kenh, { trang: trangTho, coTrang: KICH_THUOC });
  } catch (e) {
    console.error("[nhat-ky] đọc lỗi:", e);
    return (
      <ErrorState
        title="Không đọc được nhật ký"
        description="Có lỗi khi đọc nhật ký từ máy chủ. Thử tải lại trang; nếu vẫn lỗi, báo bộ phận kỹ thuật."
        action={
          <Link href={hrefVoi(base, giu)} className="text-sm font-medium text-primary-ink underline focus-visible:ring-2 focus-visible:ring-ring">
            Tải lại
          </Link>
        }
      />
    );
  }
  const trang = kepTrang(trangTho, kq.tongSo, KICH_THUOC);
  if (kq.tongSo === 0) return <EmptyState title="Chưa có gì để hiển thị" description={MO_TA[kenh].rong} />;

  return (
    <>
      <p className="mb-3 max-w-prose text-sm text-muted-foreground">{MO_TA[kenh].chuThich}</p>
      <div className={VO_BANG}>
        <div className="px-5 py-4">
          <AuditTimeline
            muc={kq.muc.map((m) => ({
              id: m.id,
              luc: m.luc,
              tieuDe: m.hanhDong,
              doiTuong: `${m.doiTuong} · ${m.maDoiTuong}`,
              nguoi: m.nguoi,
              thayDoi: m.thayDoi,
              lyDo: m.lyDo,
            }))}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">{soVN(kq.tongSo)} mục · mới nhất trước</span>
        <DieuHuongTrangLink trang={trang} soTrang={Math.max(1, Math.ceil(kq.tongSo / KICH_THUOC))} hrefCua={(t) => hrefVoi(base, { ...giu, trang: t === 1 ? null : String(t) })} />
      </div>
    </>
  );
}
