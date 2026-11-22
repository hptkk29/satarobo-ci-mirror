"use client";

// components/portal/tao-link-cua-toi.tsx — «Tạo link giới thiệu» trên cổng đối tác (AFF-WEB): Website → Trang đích → Tạo (04/11/2026: đối tác KHÔNG chọn campaign).
//
// ── Nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────────────
//  · Mọi ô chọn đọc từ `TaoLinkCuaToi` (server đã lọc: chỉ chương trình CỦA CHÍNH đối tác, website ĐANG HOẠT ĐỘNG đã gắn campaign, trang đích đang bật và KHÔNG có dấu `*`). Component không tự suy thêm.
//  · Máy chủ KIỂM LẠI tất cả (`tuTaoLink` → `phatLink`): giao diện chỉ là lối đi, không phải cổng. Câu lỗi của máy chủ hiện nguyên văn cạnh nút.
//  · Chưa có gì để chọn ⇒ nói rõ vì sao + khoá nút (không để nút bấm được rồi báo lỗi). Hết hạn mức link của chương trình ⇒ khoá và nói.
//  · Hàm gọi máy chủ được TIÊM (`tao`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useId, useMemo, useState, useTransition } from "react";
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

  // Đối tác chỉ cần biết mình giới thiệu cho WEBSITE nào, trang đích nào — KHÔNG chọn chương trình (campaign). Máy chủ vẫn cần `membershipId`,
  // nên mỗi website một dòng, gom từ mọi chương trình của đối tác; website nằm ở nhiều chương trình thì lấy chương trình còn hạn mức
  // (không còn thì giữ chương trình đầu tiên — nút bị khoá và nói hết hạn mức).
  const cacWeb = useMemo(() => {
    type CT = TaoLinkCuaToi["chuongTrinh"][number];
    const theoSite = new Map<string, { ct: CT; web: CT["websites"][number] }>();
    for (const c of data.chuongTrinh) {
      for (const w of c.websites) {
        const cu = theoSite.get(w.siteId);
        if (!cu || (cu.ct.soLinkDangChay >= cu.ct.soLinkToiDa && c.soLinkDangChay < c.soLinkToiDa)) theoSite.set(w.siteId, { ct: c, web: w });
      }
    }
    return [...theoSite.values()];
  }, [data.chuongTrinh]);
  const motWeb = cacWeb.length === 1 ? cacWeb[0]! : null;
  const [siteId, setSiteId] = useState(motWeb?.web.siteId ?? "");
  const chon = cacWeb.find((x) => x.web.siteId === siteId) ?? null;
  const ct = chon?.ct ?? null;
  const site = chon?.web ?? null;
  const membershipId = ct?.membershipId ?? "";
  const motTrang = site && site.trangDich.length === 1 ? site.trangDich[0]! : null;
  const [trangId, setTrangId] = useState(motWeb && motWeb.web.trangDich.length === 1 ? motWeb.web.trangDich[0]!.id : "");
  const trang = site?.trangDich.find((t) => t.id === trangId) ?? null;
  const [nhan, setNhan] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [xong, setXong] = useState(false);

  const hetHanMuc = ct !== null && ct.soLinkDangChay >= ct.soLinkToiDa;

  function doiWebsite(v: string) {
    setSiteId(v);
    const w = cacWeb.find((x) => x.web.siteId === v)?.web ?? null;
    setTrangId(w && w.trangDich.length === 1 ? w.trangDich[0]!.id : "");
    setLoi(null);
    setXong(false);
  }

  function gui(e: React.FormEvent) {
    e.preventDefault();
    if (membershipId === "" || siteId === "" || trang === null) {
      setLoi("Chọn đủ website và trang đích.");
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
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={id("site")} className="mb-1.5 block text-xs font-bold text-muted-foreground">
            Website
          </label>
          <select id={id("site")} value={siteId} onChange={(e) => doiWebsite(e.target.value)} disabled={dangGui} className={O_CHON}>
            {motWeb === null && <option value="">Chọn website…</option>}
            {cacWeb.map(({ web: w }) => (
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
          Đã dùng {ct.soLinkDangChay}/{ct.soLinkToiDa} link đang hoạt động{hetHanMuc ? " — đã hết hạn mức, liên hệ trung tâm để được hỗ trợ." : "."}
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
