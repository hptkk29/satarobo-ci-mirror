"use client";

// components/portal/tao-link-cua-toi.tsx — «Tạo link giới thiệu» trên cổng đối tác (AFF-WEB): Campaign → Website → Trang đích → Tạo.
//
// ── Nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────────────
//  · Mọi ô chọn đọc từ `TaoLinkCuaToi` (server đã lọc: chỉ chương trình CỦA CHÍNH đối tác, website ĐANG HOẠT ĐỘNG đã gắn campaign, trang đích đang bật và KHÔNG có dấu `*`). Component không tự suy thêm.
//  · Máy chủ KIỂM LẠI tất cả (`tuTaoLink` → `phatLink`): giao diện chỉ là lối đi, không phải cổng. Câu lỗi của máy chủ hiện nguyên văn cạnh nút.
//  · Chưa có gì để chọn ⇒ nói rõ vì sao + khoá nút (không để nút bấm được rồi báo lỗi). Hết hạn mức link của chương trình ⇒ khoá và nói.
//  · Hàm gọi máy chủ được TIÊM (`tao`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

import { taoLinkCuaToiAction, type KetQuaTaoLinkCuaToi } from "@/app/(portal)/portal/gioi-thieu/_actions";
import type { TaoLinkCuaToi } from "@/lib/affiliate/cua-toi";
import { cn } from "@/lib/utils";

// AFF-L6: trang đích chọn theo ID (một website có thể có nhiều tên miền, cùng đường dẫn ở hai tên miền là hai trang đích khác nhau). Tên miền KHÔNG gửi — máy chủ suy từ dòng trang đích.
type Tao = (vao: { membershipId: string; siteId: string; landingPageId: string; landingPath: string; label: string | null }) => Promise<KetQuaTaoLinkCuaToi>;
const TAO_MAC_DINH: Tao = (vao) => taoLinkCuaToiAction(vao);

const O_CHON =
  "h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground outline-none focus:border-primary/60 disabled:text-muted-foreground md:h-10";

export function TaoLinkCuaToiForm({ data, tao = TAO_MAC_DINH }: { data: TaoLinkCuaToi; tao?: Tao }) {
  const router = useRouter();
  const uid = useId();
  const id = (t: string) => `${uid}-${t}`;
  const [dangGui, batDauGui] = useTransition();

  const mot = data.chuongTrinh.length === 1 ? data.chuongTrinh[0]! : null;
  const [membershipId, setMembershipId] = useState(mot?.membershipId ?? "");
  const ct = data.chuongTrinh.find((c) => c.membershipId === membershipId) ?? null;
  const motSite = ct && ct.websites.length === 1 ? ct.websites[0]! : null;
  const [siteId, setSiteId] = useState(mot && mot.websites.length === 1 ? mot.websites[0]!.siteId : "");
  const site = ct?.websites.find((w) => w.siteId === siteId) ?? null;
  const motTrang = site && site.trangDich.length === 1 ? site.trangDich[0]! : null;
  const [trangId, setTrangId] = useState(mot && mot.websites.length === 1 && mot.websites[0]!.trangDich.length === 1 ? mot.websites[0]!.trangDich[0]!.id : "");
  const trang = site?.trangDich.find((t) => t.id === trangId) ?? null;
  const [nhan, setNhan] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [xong, setXong] = useState(false);

  const hetHanMuc = ct !== null && ct.soLinkDangChay >= ct.soLinkToiDa;

  function doiChuongTrinh(v: string) {
    setMembershipId(v);
    const c = data.chuongTrinh.find((x) => x.membershipId === v) ?? null;
    // Đổi campaign ⇒ làm lại các tầng dưới (website của campaign này có thể khác); chỉ tự điền khi có đúng MỘT lựa chọn.
    const w = c && c.websites.length === 1 ? c.websites[0]! : null;
    setSiteId(w?.siteId ?? "");
    setTrangId(w && w.trangDich.length === 1 ? w.trangDich[0]!.id : "");
    setLoi(null);
    setXong(false);
  }
  function doiWebsite(v: string) {
    setSiteId(v);
    const w = ct?.websites.find((x) => x.siteId === v) ?? null;
    setTrangId(w && w.trangDich.length === 1 ? w.trangDich[0]!.id : "");
    setLoi(null);
    setXong(false);
  }

  function gui(e: React.FormEvent) {
    e.preventDefault();
    if (membershipId === "" || siteId === "" || trang === null) {
      setLoi("Chọn đủ chương trình, website và trang đích.");
      return;
    }
    setLoi(null);
    setXong(false);
    batDauGui(async () => {
      let kq: KetQuaTaoLinkCuaToi;
      try {
        kq = await tao({ membershipId, siteId, landingPageId: trang.id, landingPath: trang.mau, label: nhan.trim() === "" ? null : nhan.trim() });
      } catch {
        setLoi("Không tạo được link lúc này. Thử lại sau ít giây.");
        return;
      }
      if (!kq.ok) {
        setLoi(kq.loi);
        return;
      }
      setXong(true);
      setNhan("");
      router.refresh();
    });
  }

  if (data.chuongTrinh.length === 0) {
    return (
      <p data-rong="tao-link" className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        Hiện chưa có chương trình nào cho phép bạn tự tạo link. Cần: tham gia một chương trình đang chạy, website của chương trình đang bật, và website có ít nhất một trang đích «đúng một trang» (không dùng dấu *). Liên hệ trung tâm để được hỗ trợ.
      </p>
    );
  }

  return (
    <form onSubmit={gui} data-tao-link className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-label="Tạo link giới thiệu">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label htmlFor={id("ct")} className="mb-1.5 block text-xs font-bold text-muted-foreground">
            Chương trình (campaign)
          </label>
          <select id={id("ct")} value={membershipId} onChange={(e) => doiChuongTrinh(e.target.value)} disabled={dangGui} className={O_CHON}>
            {mot === null && <option value="">Chọn chương trình…</option>}
            {data.chuongTrinh.map((c) => (
              <option key={c.membershipId} value={c.membershipId}>
                {c.campaignTen}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={id("site")} className="mb-1.5 block text-xs font-bold text-muted-foreground">
            Website
          </label>
          <select id={id("site")} value={siteId} onChange={(e) => doiWebsite(e.target.value)} disabled={dangGui || ct === null} className={O_CHON}>
            {motSite === null && <option value="">{ct === null ? "Chọn chương trình trước" : "Chọn website…"}</option>}
            {(ct?.websites ?? []).map((w) => (
              <option key={w.siteId} value={w.siteId}>
                {w.ten} ({w.host})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={id("trang")} className="mb-1.5 block text-xs font-bold text-muted-foreground">
            Trang đích
          </label>
          <select id={id("trang")} value={trangId} onChange={(e) => (setTrangId(e.target.value), setLoi(null), setXong(false))} disabled={dangGui || site === null} className={O_CHON}>
            {motTrang === null && <option value="">{site === null ? "Chọn website trước" : "Chọn trang đích…"}</option>}
            {(site?.trangDich ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nhan ? `${t.nhan} — ${t.host}${t.mau}` : `${t.host}${t.mau}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor={id("nhan")} className="mb-1.5 block text-xs font-bold text-muted-foreground">
          Nhãn nhớ (không bắt buộc)
        </label>
        <input
          id={id("nhan")}
          value={nhan}
          maxLength={120}
          onChange={(e) => setNhan(e.target.value)}
          disabled={dangGui}
          placeholder="VD: Nhóm Zalo lớp 3A"
          className={O_CHON}
        />
      </div>

      {ct && (
        <p className={cn("text-xs", hetHanMuc ? "text-state-warning-ink" : "text-muted-foreground")} data-han-muc>
          Đã dùng {ct.soLinkDangChay}/{ct.soLinkToiDa} link đang hoạt động trong chương trình này{hetHanMuc ? " — đã hết hạn mức, liên hệ trung tâm để được hỗ trợ." : "."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={dangGui || hetHanMuc}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 md:h-10"
        >
          {dangGui ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Plus aria-hidden className="size-4" />}
          {dangGui ? "Đang tạo…" : "Tạo link"}
        </button>
        <span role="status" aria-live="polite" className="min-w-0 flex-1 text-sm">
          {loi && (
            <span role="alert" data-loi-tao-link className="text-state-danger-ink">
              {loi}
            </span>
          )}
          {xong && !loi && <span data-da-tao-link className="text-state-success-ink">Đã tạo link — sao chép hoặc lấy mã QR ở danh sách bên dưới.</span>}
        </span>
      </div>
    </form>
  );
}
