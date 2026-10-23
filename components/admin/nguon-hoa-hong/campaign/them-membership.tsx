"use client";

// components/admin/nguon-hoa-hong/campaign/them-membership.tsx — FORM «Thêm đối tác vào campaign» (trang chi tiết campaign).
//
// ── Nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────────────
// · Trang chỉ vẽ form khi người xem có `affiliate_memberships:manage` (đúng khoá mà `themMembershipAction` kiểm) và campaign CHƯA kết thúc.
// · Ô chọn chỉ liệt kê đối tác ĐANG HOẠT ĐỘNG; đối tác đã ở trong campaign (chờ duyệt · đang tham gia · tạm ngừng) hiện nhưng `disabled` kèm trạng thái; đối tác đã KẾT THÚC hiện kèm «sẽ mở lại
//   dòng cũ» — thêm lại không tạo dòng trùng.
// · Dữ liệu trong ô chọn chỉ có tên · mã · loại (không SĐT / email).
// · Vào là «Chờ duyệt»; duyệt ở nút trên dòng — form nói rõ để không ai tưởng thêm xong là đã tham gia.
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { themMembershipAction } from "@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions";
import type { DoiTacChonView } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { NHAN_TRANG_THAI_MEMBERSHIP, themMembershipSchema, type KetQuaThemMembership } from "@/lib/affiliate/ghi-membership-dau-vao";
import { isoTuNgayVN } from "@/lib/nguon/form-nguon";
import { cn } from "@/lib/utils";
import { BTN_PRIMARY, FIELD, LOI_O, NHAN_O } from "../classes";

type Them = (i: { campaignId: string; vao: Record<string, unknown> }) => Promise<KetQuaThemMembership>;
const THEM_MAC_DINH: Them = (i) => themMembershipAction(i);

function nhanDoiTac(d: DoiTacChonView): string {
  const co = `${d.ten} (${d.code})${d.loai ? ` · ${d.loai}` : ""}`;
  if (d.trongCampaign === null) return co;
  if (d.trongCampaign === "ENDED") return `${co} — đã kết thúc, sẽ mở lại dòng cũ`;
  return `${co} — đã ở trong campaign (${NHAN_TRANG_THAI_MEMBERSHIP[d.trongCampaign].toLowerCase()})`;
}

export function ThemMembership({ campaignId, doiTac, conNua, them = THEM_MAC_DINH }: { campaignId: string; doiTac: readonly DoiTacChonView[]; conNua: boolean; them?: Them }) {
  const router = useRouter();
  const uid = useId();
  const [partyId, setPartyId] = useState("");
  const [nhan, setNhan] = useState("");
  const [tu, setTu] = useState("");
  const [den, setDen] = useState("");
  const [loi, setLoi] = useState<{ truong: string; text: string } | null>(null);
  const [dangLuu, setDangLuu] = useState(false);

  async function nop(e: React.FormEvent) {
    e.preventDefault();
    if (dangLuu) return;
    const vao = {
      partyId,
      groupLabel: nhan,
      effectiveFrom: tu.trim() === "" ? null : (isoTuNgayVN(tu) ?? tu),
      effectiveTo: den.trim() === "" ? null : (isoTuNgayVN(den) ?? den),
    };
    const kq = themMembershipSchema.safeParse(vao);
    if (!kq.success) {
      const i = kq.error.issues[0];
      setLoi({ truong: typeof i?.path[0] === "string" ? i.path[0] : "chung", text: i?.message ?? "Dữ liệu không hợp lệ." });
      return;
    }
    setLoi(null);
    setDangLuu(true);
    let r: KetQuaThemMembership;
    try {
      r = await them({ campaignId, vao });
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(false);
    if (!r.ok) {
      setLoi({ truong: r.truong ?? "chung", text: r.loi });
      return;
    }
    toast.success(r.viec === "MO_LAI" ? "Đã mở lại đối tác trong campaign — đang chờ duyệt." : "Đã thêm đối tác — đang chờ duyệt.");
    setPartyId("");
    setNhan("");
    setTu("");
    setDen("");
    router.refresh();
  }

  const loiO = (t: string) => (loi && loi.truong === t ? loi.text : undefined);
  const dat = (f: () => void) => {
    f();
    setLoi(null);
  };
  return (
    <form onSubmit={nop} noValidate aria-label="Thêm đối tác vào campaign" className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Thêm đối tác</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-doitac`} className={NHAN_O}>
            Đối tác
          </label>
          <select
            id={`${uid}-doitac`}
            value={partyId}
            onChange={(e) => dat(() => setPartyId(e.target.value))}
            aria-invalid={loiO("partyId") ? true : undefined}
            aria-describedby={loiO("partyId") ? `${uid}-loi-doitac` : undefined}
            disabled={doiTac.length === 0}
            className={FIELD}
          >
            <option value="">{doiTac.length === 0 ? "— Chưa có đối tác nào đang hoạt động —" : "— Chọn đối tác —"}</option>
            {doiTac.map((d) => (
              <option key={d.id} value={d.id} disabled={d.trongCampaign !== null && d.trongCampaign !== "ENDED"}>
                {nhanDoiTac(d)}
              </option>
            ))}
          </select>
          {conNua && <p className="mt-1 text-sm text-muted-foreground">Danh sách chỉ hiện {doiTac.length} đối tác đầu theo tên — còn nhiều hơn nữa.</p>}
          {loiO("partyId") && (
            <p id={`${uid}-loi-doitac`} role="alert" className={LOI_O}>
              {loiO("partyId")}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={`${uid}-nhan`} className={NHAN_O}>
            Nhãn nhóm (tuỳ chọn)
          </label>
          <input id={`${uid}-nhan`} type="text" maxLength={80} value={nhan} onChange={(e) => dat(() => setNhan(e.target.value))} className={FIELD} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}-tu`} className={NHAN_O}>
              Từ ngày
            </label>
            <input id={`${uid}-tu`} type="date" value={tu} onChange={(e) => dat(() => setTu(e.target.value))} className={FIELD} />
          </div>
          <div>
            <label htmlFor={`${uid}-den`} className={NHAN_O}>
              Đến ngày
            </label>
            <input
              id={`${uid}-den`}
              type="date"
              value={den}
              onChange={(e) => dat(() => setDen(e.target.value))}
              aria-invalid={loiO("effectiveTo") ? true : undefined}
              aria-describedby={loiO("effectiveTo") ? `${uid}-loi-den` : undefined}
              className={FIELD}
            />
          </div>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Để trống ngày = bắt đầu ngay, không giới hạn. Đối tác vào ở trạng thái «Chờ duyệt»; bấm «Duyệt» trên dòng để cho tham gia.</p>
      {loiO("effectiveTo") && (
        <p id={`${uid}-loi-den`} role="alert" className={LOI_O}>
          {loiO("effectiveTo")}
        </p>
      )}
      {loi && !["partyId", "effectiveTo"].includes(loi.truong) && (
        <p role="alert" className={cn(LOI_O)}>
          {loi.text}
        </p>
      )}
      <div className="mt-3">
        <button type="submit" disabled={dangLuu || doiTac.length === 0} className={BTN_PRIMARY}>
          {dangLuu ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
          Thêm đối tác
        </button>
      </div>
    </form>
  );
}
