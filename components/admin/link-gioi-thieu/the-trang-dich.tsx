"use client";

// components/admin/link-gioi-thieu/the-trang-dich.tsx — tab «Link theo trang đích»: mỗi trang đích MỘT thẻ chứa mọi thứ về link của trang đó (chủ dự án 21/11/2026):
// trạng thái · link ngắn + Sao chép + Mã QR · lượt bấm · lượt giới thiệu · «Thu hồi» (bấm hai lần để chắc). Đã thu hồi ⇒ «Cấp link mới»; chưa có ⇒ «Lấy link».
// Dữ liệu thẻ dựng ở `lib/affiliate/the-trang-dich.ts`; ba hàm gọi máy chủ TIÊM được cho test.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Link2, Loader2, RefreshCw } from "lucide-react";

import { taoLinkNhanSuAction, taoQrNhanSuAction, thuHoiLinkNhanSuAction, type KetQuaTaoLinkNhanSu } from "@/app/(admin)/admin/link-gioi-thieu/_actions";
import { NutQrLinkCuaToi, type TaoQr } from "@/components/portal/nut-qr-link-cua-toi";
import { NutSaoChepLink } from "@/components/portal/nut-sao-chep-link";
import type { TheTrangDich } from "@/lib/affiliate/the-trang-dich";

type Tao = (vao: TheTrangDich["vao"]) => Promise<KetQuaTaoLinkNhanSu>;
type ThuHoi = (vao: { id: string }) => Promise<{ ok: true } | { ok: false; loi: string }>;
type HanhDong = { tao: Tao; thuHoi: ThuHoi; taoQr: TaoQr };
const MAC_DINH: HanhDong = {
  tao: (vao) => taoLinkNhanSuAction(vao),
  thuHoi: async (vao) => {
    const kq = await thuHoiLinkNhanSuAction(vao);
    return kq.ok ? { ok: true } : { ok: false, loi: kq.loi };
  },
  taoQr: (vao) => taoQrNhanSuAction(vao),
};

const so = (n: number) => n.toLocaleString("vi-VN");
const NUT = "inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors disabled:opacity-60 md:h-9";

function MotThe({ the, hd }: { the: TheTrangDich; hd: HanhDong }) {
  const router = useRouter();
  const [dangGui, batDau] = useTransition();
  const [loi, setLoi] = useState<string | null>(null);
  const [xacNhanThuHoi, setXacNhanThuHoi] = useState(false);
  const l = the.link;

  function chay(viec: () => Promise<{ ok: true } | { ok: false; loi: string }>) {
    setLoi(null);
    batDau(async () => {
      let kq: { ok: true } | { ok: false; loi: string };
      try {
        kq = await viec();
      } catch {
        setLoi("Chưa làm được lúc này. Thử lại sau ít giây.");
        return;
      }
      setXacNhanThuHoi(false);
      if (!kq.ok) {
        setLoi(kq.loi);
        return;
      }
      router.refresh();
    });
  }
  const capLink = () => chay(async () => {
    const kq = await hd.tao(the.vao);
    return kq.ok ? { ok: true } : { ok: false, loi: kq.loi };
  });

  const trangThai = !l ? null : l.hoatDong ? { nhan: "Đang dùng", cls: "bg-state-success-soft text-state-success-ink" } : { nhan: "Đã thu hồi", cls: "bg-muted text-muted-foreground" };

  return (
    <li data-the-trang-dich={the.khoa} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{the.ten}</p>
          <p className="truncate text-xs text-muted-foreground">
            {the.host}
            {the.duongDan}
          </p>
        </div>
        {trangThai && <span data-trang-thai-link className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${trangThai.cls}`}>{trangThai.nhan}</span>}
      </div>

      {l?.hoatDong && l.lienKet && (
        // `items-start` + ô link CÙNG chiều cao nút: «Sao chép» bọc thêm một dòng trạng thái bên dưới, căn giữa theo chiều dọc là nó bị đẩy lệch lên so với «Mã QR».
        <div data-hang-link className="flex flex-wrap items-start gap-2">
          <code className="block h-11 min-w-0 flex-1 truncate rounded-lg bg-muted px-2.5 text-xs leading-[2.75rem] md:h-9 md:leading-9">{l.lienKet}</code>
          <NutSaoChepLink diaChi={l.lienKet} nhan={`link ${the.ten}`} />
          {l.laLinkNgan && <NutQrLinkCuaToi id={l.id} nhan={the.ten} taoQr={hd.taoQr} />}
        </div>
      )}

      {l && (
        <p className="text-xs text-muted-foreground">
          <span data-so-luot-bam className="font-semibold tabular-nums text-foreground">{so(l.soLuotBam)}</span> lượt bấm ·{" "}
          <span data-so-referral className="font-semibold tabular-nums text-foreground">{so(l.soReferral)}</span> lượt giới thiệu
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!l && (
          <button type="button" onClick={capLink} disabled={dangGui} className={`${NUT} bg-primary text-primary-foreground hover:bg-primary/90`}>
            {dangGui ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Link2 aria-hidden className="size-4" />}
            Lấy link
          </button>
        )}
        {l && !l.hoatDong && (
          <button type="button" onClick={capLink} disabled={dangGui} className={`${NUT} bg-primary text-primary-foreground hover:bg-primary/90`}>
            {dangGui ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}
            Cấp link mới
          </button>
        )}
        {l?.hoatDong && (
          <button
            type="button"
            onClick={() => (xacNhanThuHoi ? chay(() => hd.thuHoi({ id: l.id })) : setXacNhanThuHoi(true))}
            disabled={dangGui}
            className={`${NUT} border border-border ${xacNhanThuHoi ? "bg-state-danger-soft text-state-danger-ink" : "text-foreground hover:bg-muted"}`}
          >
            {dangGui ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Ban aria-hidden className="size-4" />}
            {xacNhanThuHoi ? "Bấm lần nữa để thu hồi" : "Thu hồi"}
          </button>
        )}
        {xacNhanThuHoi && (
          <button type="button" onClick={() => setXacNhanThuHoi(false)} disabled={dangGui} className={`${NUT} text-muted-foreground hover:bg-muted`}>
            Huỷ
          </button>
        )}
      </div>
      {xacNhanThuHoi && <p className="text-xs text-muted-foreground">Link đã gửi đi sẽ ngừng ghi nhận khách. Khách đã để lại thông tin vẫn giữ nguyên.</p>}

      {loi && (
        <p role="alert" className="text-sm text-state-danger-ink">
          {loi}
        </p>
      )}
    </li>
  );
}

export function DanhSachTheTrangDich({ the, hanhDong = MAC_DINH }: { the: readonly TheTrangDich[]; hanhDong?: HanhDong }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {the.map((t) => (
        <MotThe key={t.khoa} the={t} hd={hanhDong} />
      ))}
    </ul>
  );
}
