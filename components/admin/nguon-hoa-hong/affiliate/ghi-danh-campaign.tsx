"use client";

// components/admin/nguon-hoa-hong/affiliate/ghi-danh-campaign.tsx — «GHI DANH VÀO CAMPAIGN» từ trang chi tiết đối tác (AFF-L3a). Danh sách campaign ĐỐI TÁC CHƯA Ở TRONG và còn nhận thành viên, mỗi cái kèm
// XEM TRƯỚC NGUỒN khách (kết quả của `giaiNguonCuaDoiTac`) để quản trị viên thấy cấu hình thiếu TRƯỚC khi ghi danh, rồi nút «Ghi danh».
//
// ── Nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────────────
//  · Nút gọi ĐÚNG `themMembershipAction` của tab Campaign (khoá `affiliate_memberships:manage`) — không viết lại luật ghi danh. `coTheGhi` = `scope.has("affiliate_memberships:manage")`: người thiếu khoá
//    đó không thấy nút. Thao tác mà cổng `kiemThemMembership` chắc chắn từ chối (đối tác chưa hoạt động) KHÔNG vẽ nút: hiện câu lý do của CHÍNH cổng đó (`lyDoChan`).
//  · «Chờ duyệt thành viên» là kết quả của ghi danh (PENDING): duyệt ở bảng chương trình bên trên — hộp thoại nói rõ để không ai tưởng ghi danh xong là đã tham gia.
//  · Campaign chưa giải ra nguồn vẫn ghi danh được (khách của đối tác sẽ vào hàng «cần xem tay» tới khi cấu hình xong) nhưng dòng nói THẲNG điều đó, không giấu.
// Hàm gọi máy chủ được TIÊM (`them`) — test dựng bằng hàm giả.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { themMembershipAction } from "@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions";
import type { UngVienGhiDanh } from "@/lib/affiliate/doc-ho-so-doi-tac";
import type { KetQuaThemMembership } from "@/lib/affiliate/ghi-membership-dau-vao";
import { NHAN_TRANG_THAI_CAMPAIGN } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { cn } from "@/lib/utils";
import { BTN_PRIMARY, NUT_NHO } from "../classes";
import { NguonXemTruoc } from "./nguon-xem-truoc";

type Them = (i: { campaignId: string; vao: Record<string, unknown> }) => Promise<KetQuaThemMembership>;
const THEM_MAC_DINH: Them = (i) => themMembershipAction(i);

export function GhiDanhCampaign({
  partyId,
  ungVien,
  conNua,
  coTheGhi,
  them = THEM_MAC_DINH,
}: {
  partyId: string;
  ungVien: readonly UngVienGhiDanh[];
  conNua: boolean;
  /** `scope.has("affiliate_memberships:manage")` — page tính, khối không đoán (luật 7: bắt buộc). */
  coTheGhi: boolean;
  them?: Them;
}) {
  const router = useRouter();
  const [dang, setDang] = useState<string | null>(null);
  const [loi, setLoi] = useState<{ id: string; text: string } | null>(null);

  async function ghiDanh(c: UngVienGhiDanh) {
    if (dang) return;
    setLoi(null);
    setDang(c.campaignId);
    let r: KetQuaThemMembership;
    try {
      r = await them({ campaignId: c.campaignId, vao: { partyId, groupLabel: "", effectiveFrom: null, effectiveTo: null } });
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDang(null);
    if (!r.ok) {
      setLoi({ id: c.campaignId, text: r.loi });
      return;
    }
    toast.success(`Đã ghi danh vào «${c.ten}» — đang chờ duyệt thành viên.`);
    router.refresh();
  }

  if (ungVien.length === 0) {
    return (
      <p data-rong="ghi-danh" className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        Không còn campaign nào để ghi danh: đối tác đã ở trong mọi campaign còn nhận thành viên, hoặc chưa có campaign nào.
      </p>
    );
  }
  return (
    <div>
      <ul aria-label="Campaign có thể ghi danh" className="space-y-3">
        {ungVien.map((c) => (
          <li key={c.campaignId} data-ung-vien={c.ma} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 break-words text-sm font-semibold text-foreground">
                {c.ten} <span className="font-mono text-xs font-normal text-muted-foreground">{c.ma}</span>
                <span className="ml-2 text-xs font-normal text-muted-foreground">{NHAN_TRANG_THAI_CAMPAIGN[c.trangThai]}</span>
              </p>
              {coTheGhi && c.lyDoChan === null && (
                <button type="button" disabled={dang !== null} onClick={() => void ghiDanh(c)} aria-label={`Ghi danh vào ${c.ten}`} className={cn(BTN_PRIMARY, NUT_NHO)}>
                  {dang === c.campaignId && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
                  Ghi danh
                </button>
              )}
            </div>
            <div className="mt-2">
              <p className="text-xs text-muted-foreground">Nguồn khách của đối tác này trong campaign:</p>
              <NguonXemTruoc ketQua={c.nguon} />
            </div>
            {c.lyDoChan !== null && (
              <p data-chan className="mt-2 text-xs text-muted-foreground">
                Chưa ghi danh được: {c.lyDoChan}
              </p>
            )}
            {loi && loi.id === c.campaignId && (
              <p role="alert" className="mt-2 text-sm text-state-danger-ink">
                {loi.text}
              </p>
            )}
          </li>
        ))}
      </ul>
      {conNua && <p className="mt-2 text-xs text-muted-foreground">Danh sách chỉ hiện các campaign đầu theo mã. Cần campaign khác: ghi danh ở trang chi tiết campaign đó.</p>}
      {!coTheGhi && <p className="mt-2 text-xs text-muted-foreground">Bạn không có quyền ghi danh (affiliate_memberships:manage) — nhờ người có quyền thực hiện.</p>}
    </div>
  );
}
