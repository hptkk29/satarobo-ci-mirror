"use client";

// Tab "Cơ sở & catalog": (1) cơ sở được xuất bản cho từng Page, (2) xem trước thay đổi so với bản hiện hành + xuất bản, (3) lịch sử version + xuất bản lại (rollback).
// Snapshot đã xuất bản BẤT BIẾN: "xuất bản lại" tạo version MỚI mang nội dung cũ, không sửa bản nào.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CauHinhView } from "@/lib/ai-lead/dich-vu/cau-hinh";
import { moTaThayDoi } from "@/lib/ai-lead/dich-vu/cau-hinh-thuan";
import { goCoSoXuatBanAction, luuCoSoXuatBanAction, xuatBanCatalogAction, xuatBanLaiAction } from "../_actions";
import { NhanDon } from "../../_components/nhan-trang-thai";
import { NutLyDo } from "../../_components/nut-ly-do";
import { LOP_O_CHON, LOP_O_NHAP, LOP_THE } from "../../_components/lop";
import { gioVn, rutGon } from "../../_components/dinh-dang";

type Hang = CauHinhView["xuatBan"][number];

function DongXuatBan({ hang, duocSua }: { hang: Hang; duocSua: boolean }) {
  const router = useRouter();
  const [nhan, datNhan] = useState(hang.acceptingLeads);
  const [hien, datHien] = useState(hang.publicVisible);
  const [thuTu, datThuTu] = useState(String(hang.displayOrder));
  const [loi, datLoi] = useState<string | null>(null);
  const [xacNhanGo, datXacNhanGo] = useState(false);
  const [dang, batDau] = useTransition();
  const thuTuSo = Number(thuTu);
  const hopLe = Number.isInteger(thuTuSo) && thuTuSo >= 0 && thuTuSo <= 9999;
  const doi = nhan !== hang.acceptingLeads || hien !== hang.publicVisible || thuTuSo !== hang.displayOrder;
  const id = `${hang.pageId}-${hang.campusCenterId}`;

  function chay(f: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    datLoi(null);
    batDau(async () => {
      const r = await f();
      if (!r.ok) datLoi(r.error);
      else router.refresh();
    });
  }

  return (
    <li className="grid gap-2 border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold">{hang.campus.code ?? "—"}</span>
        <span className="min-w-0 break-words text-sm">{hang.campus.name}</span>
        {!hang.campus.isActive ? <NhanDon tone="danger">Cơ sở đã ngừng hoạt động</NhanDon> : null}
      </div>
      {duocSua ? (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={nhan} onChange={(e) => datNhan(e.target.checked)} disabled={dang} />
            Nhận khách
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={hien} onChange={(e) => datHien(e.target.checked)} disabled={dang} />
            Hiện công khai
          </label>
          <div className="grid w-24 gap-1">
            <label htmlFor={`tt-${id}`} className="text-xs text-muted-foreground">
              Thứ tự
            </label>
            <Input id={`tt-${id}`} type="number" min={0} max={9999} className={LOP_O_NHAP} value={thuTu} onChange={(e) => datThuTu(e.target.value)} disabled={dang} aria-invalid={!hopLe} />
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!doi || !hopLe || dang}
            onClick={() =>
              chay(() => luuCoSoXuatBanAction({ pageId: hang.pageId, campusCenterId: hang.campusCenterId, acceptingLeads: nhan, publicVisible: hien, displayOrder: thuTuSo }))
            }
          >
            Lưu
          </Button>
          <Button
            type="button"
            variant={xacNhanGo ? "destructive" : "ghost"}
            className={xacNhanGo ? "min-h-11 text-white" : "min-h-11"}
            disabled={dang}
            onClick={() => {
              if (!xacNhanGo) {
                datXacNhanGo(true);
                return;
              }
              datXacNhanGo(false);
              chay(() => goCoSoXuatBanAction({ pageId: hang.pageId, campusCenterId: hang.campusCenterId }));
            }}
          >
            {xacNhanGo ? "Bấm lần nữa để gỡ" : "Gỡ"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {hang.acceptingLeads ? "Đang nhận khách" : "Không nhận khách"} · {hang.publicVisible ? "Hiện công khai" : "Ẩn"} · thứ tự {hang.displayOrder}
        </p>
      )}
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink">
          {loi}
        </p>
      ) : null}
    </li>
  );
}

function ThemXuatBan({ pageIds, coSo, xuatBan }: { pageIds: string[]; coSo: CauHinhView["coSoChon"]; xuatBan: Hang[] }) {
  const router = useRouter();
  const [pageId, datPageId] = useState(pageIds[0] ?? "");
  const [coSoId, datCoSoId] = useState("");
  const [loi, datLoi] = useState<string | null>(null);
  const [dang, batDau] = useTransition();
  const chon = coSo.filter((c) => !xuatBan.some((x) => x.pageId === pageId && x.campusCenterId === c.id));
  return (
    <form
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
      aria-label="Xuất bản thêm một cơ sở cho Page"
      onSubmit={(e) => {
        e.preventDefault();
        datLoi(null);
        batDau(async () => {
          const r = await luuCoSoXuatBanAction({ pageId, campusCenterId: coSoId, acceptingLeads: true, publicVisible: true, displayOrder: xuatBan.filter((x) => x.pageId === pageId).length });
          if (!r.ok) datLoi(r.error);
          else {
            datCoSoId("");
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor="xb-page" className="text-sm font-medium">
          Page
        </label>
        <select id="xb-page" className={LOP_O_CHON} value={pageId} onChange={(e) => (datPageId(e.target.value), datCoSoId(""))} required>
          {pageIds.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="xb-co-so" className="text-sm font-medium">
          Cơ sở
        </label>
        <select id="xb-co-so" className={LOP_O_CHON} value={coSoId} onChange={(e) => datCoSoId(e.target.value)} required>
          <option value="">— Chọn cơ sở —</option>
          {chon.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" className="min-h-11" disabled={dang || !pageId || !coSoId}>
        {dang ? "Đang thêm…" : "Thêm cơ sở"}
      </Button>
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink sm:col-span-3">
          {loi}
        </p>
      ) : null}
    </form>
  );
}

export function CoSoCatalog({ view, duocSua }: { view: CauHinhView; duocSua: boolean }) {
  const pageIds = [...new Set([...view.agents.flatMap((a) => a.pages.map((p) => p.pageId)), ...view.xuatBan.map((x) => x.pageId)])].sort();
  const { xemTruoc, hienHanh, lichSu } = view;
  const coThayDoi = xemTruoc.thayDoi.length > 0;
  // Bản mới nhất KHÔNG toàn vẹn (vd. etag bị sửa tay) ⇒ /catalog đang 503: được xuất bản lại DÙ nội dung không đổi (máy chủ cũng cho phép đúng trường hợp này).
  const hienHong = view.hienHanhToanVen !== null && !view.hienHanhToanVen.ok;
  const khongXuatBan = !!xemTruoc.loi || (!coThayDoi && !hienHong);
  const lyDoKhong = xemTruoc.loi ? "Sửa lỗi ở trên trước khi xuất bản." : !coThayDoi && !hienHong ? "Không có thay đổi nào so với bản hiện hành." : null;
  const versionKe = (lichSu[0]?.version ?? 0) + 1; // theo bản MỚI NHẤT đã lưu — kể cả khi nội dung của nó không đọc được (hienHanh = null)

  return (
    <div className="grid gap-5">
      <section className={LOP_THE} aria-labelledby="xb-tieu-de">
        <h2 id="xb-tieu-de" className="text-base font-semibold">
          Cơ sở xuất bản cho từng Page
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Chỉ cơ sở đang hoạt động, có mã hợp lệ và nhận ghi danh mới xuất bản được (Hội sở không nhận khách). Sửa ở đây chưa đổi catalog Agent thấy — phải bấm “Xuất bản” ở khối dưới.
        </p>
        {pageIds.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Chưa có Page nào được cấp cho Agent — cấp Page ở tab “Page” trước.</p>
        ) : (
          <div className="mt-4 grid gap-4">
            {pageIds.map((pid) => {
              const cua = view.xuatBan.filter((x) => x.pageId === pid);
              return (
                <div key={pid}>
                  <h3 className="mb-2 font-mono text-sm font-semibold [overflow-wrap:anywhere]">Page {pid}</h3>
                  {cua.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Chưa xuất bản cơ sở nào — khách sẽ nhận INVALID_SELECTION khi chọn cơ sở.</p>
                  ) : (
                    <ul>
                      {cua.map((h) => (
                        <DongXuatBan key={h.campusCenterId} hang={h} duocSua={duocSua} />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {duocSua ? <ThemXuatBan pageIds={pageIds} coSo={view.coSoChon} xuatBan={view.xuatBan} /> : null}
          </div>
        )}
      </section>

      <section className={LOP_THE} aria-labelledby="xt-tieu-de">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="xt-tieu-de" className="text-base font-semibold">
            Xem trước & xuất bản
          </h2>
          <NhanDon tone={hienHong ? "danger" : "muted"}>
            {hienHong ? `Hiện hành: v${lichSu[0]?.version ?? "?"} — KHÔNG toàn vẹn` : hienHanh ? `Hiện hành: v${hienHanh.version}` : "Chưa xuất bản lần nào"}
          </NhanDon>
        </div>
        {xemTruoc.loi ? (
          <p role="alert" className="mt-3 rounded-lg bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
            {xemTruoc.loi}
          </p>
        ) : coThayDoi ? (
          <ul className="mt-3 grid gap-1.5 text-sm" aria-label="Thay đổi so với bản hiện hành">
            {xemTruoc.thayDoi.map((t, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                {moTaThayDoi(t)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Cấu hình hiện tại giống hệt bản đang hiện hành — không có gì để xuất bản.</p>
        )}
        {duocSua ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <NutLyDo
              nhan="Xuất bản catalog"
              tieuDe="Xuất bản catalog mới?"
              moTa={`${hienHong ? "Bản hiện hành KHÔNG toàn vẹn nên Agent đang nhận 503 — xuất bản lại sẽ thay nó bằng bản đúng. " : ""}Tạo version v${versionKe} bất biến. Agent thấy bản mới ở nhịp sống / lần gọi catalog kế tiếp; khách đang chọn cơ sở đã gỡ sẽ nhận INVALID_SELECTION.`}
              nhanXacNhan="Xuất bản"
              disabled={khongXuatBan}
              thongBaoXong="Đã xuất bản catalog."
              chay={(lyDo) => xuatBanCatalogAction({ lyDo })}
            />
            {lyDoKhong ? <p className="text-sm text-muted-foreground">{lyDoKhong}</p> : null}
          </div>
        ) : null}
      </section>

      <section className={LOP_THE} aria-labelledby="ls-tieu-de">
        <h2 id="ls-tieu-de" className="text-base font-semibold">
          Lịch sử phiên bản
        </h2>
        {lichSu.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Chưa có phiên bản nào. Agent gọi catalog sẽ nhận danh sách rỗng cho tới khi bạn xuất bản.</p>
        ) : (
          <ul className="mt-3 grid">
            {lichSu.map((s, i) => (
              <li key={s.version} className="grid gap-2 border-t border-border py-3 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    v{s.version}
                    {i === 0 ? <NhanDon tone="info">Hiện hành</NhanDon> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {gioVn(s.publishedAt)} · {s.publishedByName ?? "—"} · {s.soPage} Page · {s.soCoSo} cơ sở · etag <span className="font-mono">{rutGon(s.etag, 6)}</span>
                  </p>
                </div>
                {duocSua && i > 0 ? (
                  <NutLyDo
                    nhan="Xuất bản lại bản này"
                    tieuDe={`Xuất bản lại nội dung của v${s.version}?`}
                    moTa={`Tạo version MỚI (v${versionKe}) mang nội dung của v${s.version}. Các bản cũ không bị sửa.`}
                    nhanXacNhan="Xuất bản lại"
                    thongBaoXong="Đã xuất bản lại."
                    chay={(lyDo) => xuatBanLaiAction({ version: s.version, lyDo })}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
