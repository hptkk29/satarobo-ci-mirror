"use client";

// components/admin/nguon-hoa-hong/campaign/nut-doi-trang-thai-campaign.tsx — CÁC NÚT «Kích hoạt · Tạm dừng · Chạy lại · Kết thúc · Huỷ nháp» của MỘT campaign (đầu trang chi tiết).
//
// ── Nút nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────────
// · Danh sách nút LẤY TỪ `CHUYEN_TRANG_THAI` (lib/affiliate/ghi-campaign-dau-vao.ts) — cùng bảng mà `doiTrangThaiCampaign` kiểm. ENDED không có nút nào.
// · Trang chỉ vẽ component này khi người xem có `affiliate_campaigns:activate` (đúng khoá mà `doiTrangThaiCampaignAction` kiểm ở đầu hàm). Có `manage` mà thiếu `activate` thì KHÔNG có nút.
// · Nút đưa campaign tới ACTIVE mà còn điều kiện chưa đạt (`chanKichHoat`, tính bằng CHÍNH `kiemKichHoat` của hàm ghi) mở hộp thoại CHỈ ĐỌC liệt kê từng điều kiện — không vẽ nút xác nhận
//   dẫn tới một lời từ chối chắc chắn. Máy chủ vẫn kiểm lại dưới khoá (dữ liệu của trang có thể cũ vài giây).
// · Khoá lạc quan: gửi `capNhatLuc` của campaign; máy chủ báo «vừa được đổi» ⇒ banner + «Tải lại».
import { useState } from "react";
import { Pause, Play, Power } from "lucide-react";
import { doiTrangThaiCampaignAction } from "@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions";
import { CHUYEN_TRANG_THAI, LY_DO_TOI_THIEU_CAMPAIGN, NHAN_TRANG_THAI_CAMPAIGN, type ChanKichHoat, type KetQuaDoiTrangThaiCampaign, type ThaoTacChuyen, type TrangThaiCampaign } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { cn } from "@/lib/utils";
import { BTN_DANGER_OUTLINE, BTN_OUTLINE, BTN_PRIMARY } from "../classes";
import { HopThoaiLyDo } from "./hop-thoai-ly-do";

type Doi = (i: { id: string; updatedAtDaThay: string; den: TrangThaiCampaign; lyDo: string | null }) => Promise<KetQuaDoiTrangThaiCampaign>;
const DOI_MAC_DINH: Doi = (i) => doiTrangThaiCampaignAction(i);

export type CampaignDeDoiTrangThai = { id: string; name: string; status: TrangThaiCampaign; capNhatLuc: string };

function bieuTuong(den: TrangThaiCampaign) {
  if (den === "ACTIVE") return <Play aria-hidden className="h-4 w-4" />;
  if (den === "PAUSED") return <Pause aria-hidden className="h-4 w-4" />;
  return <Power aria-hidden className="h-4 w-4" />;
}

export function NutDoiTrangThaiCampaign({
  campaign,
  chanKichHoat,
  goc,
  doi = DOI_MAC_DINH,
}: {
  campaign: CampaignDeDoiTrangThai;
  /** Điều kiện kích hoạt còn thiếu (`ChiTietCampaignView.chanKichHoat`). BẮT BUỘC (luật 7): quên truyền là nút «Kích hoạt» hứa suông. */
  chanKichHoat: readonly ChanKichHoat[];
  /** Đường trang chi tiết campaign — để mỗi điều kiện thiếu có đường tới chỗ sửa. BẮT BUỘC (luật 7). */
  goc: string;
  doi?: Doi;
}) {
  const [mo, setMo] = useState<ThaoTacChuyen | null>(null);
  const thaoTac = CHUYEN_TRANG_THAI[campaign.status];
  if (thaoTac.length === 0) return null;
  return (
    <>
      {thaoTac.map((t) => (
        <button
          key={t.den}
          type="button"
          onClick={() => setMo(t)}
          className={cn(t.den === "ACTIVE" ? BTN_PRIMARY : t.den === "ENDED" ? BTN_DANGER_OUTLINE : BTN_OUTLINE)}
        >
          {bieuTuong(t.den)}
          {t.nhan}
        </button>
      ))}
      {mo && (
        <HopThoaiLyDo
          tieuDe={`${mo.nhan} campaign «${campaign.name}»`}
          moTa={
            <>
              <span className="block">
                Hiện tại: <b className="text-foreground">{NHAN_TRANG_THAI_CAMPAIGN[campaign.status]}</b> → <b className="text-foreground">{NHAN_TRANG_THAI_CAMPAIGN[mo.den]}</b>.
              </span>
              <span className="mt-1 block">{mo.moTa}</span>
            </>
          }
          nhanXacNhan={mo.nhan}
          nguyHiem={mo.den === "ENDED"}
          canLyDo={mo.canLyDo}
          lyDoToiThieu={LY_DO_TOI_THIEU_CAMPAIGN}
          chan={mo.den === "ACTIVE" ? chanKichHoat : undefined}
          gocChan={goc}
          thanhCong={`${mo.nhan} campaign «${campaign.name}»: xong.`}
          xacNhan={(lyDo) => doi({ id: campaign.id, updatedAtDaThay: campaign.capNhatLuc, den: mo.den, lyDo })}
          dong={() => setMo(null)}
        />
      )}
    </>
  );
}
