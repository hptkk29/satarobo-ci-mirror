"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createParentRequest } from "@/app/(portal)/portal/yeu-cau/actions";
import {
  CHU_DE_KHAC,
  KHUNG_GIO_MONG_MUON,
  LY_DO_BAO_LUU,
  noiDungYeuCau,
  type SlugYeuCau,
} from "@/lib/portal/yeu-cau-loai";
import { lyDoBaoNghi, noiDungBaoNghi } from "@/lib/portal/hoc-bu-thuan";

// Bộ form cho NĂM loại yêu cầu còn lại (board M-Yeu-cau-nghi / -bao-luu / -doi-lop / -doi-co-so / -khac). Mỗi loại một màn
// (`/portal/yeu-cau/<slug>`), cùng một hình dạng: chọn nhanh bằng chip 44px → ghi chú → MỘT nút «Gửi yêu cầu» 48px.
// Tất cả gọi ĐÚNG `createParentRequest` (kiểm quyền, giới hạn, rate-limit và thông báo nằm ở server). Phụ huynh chỉ GỬI
// YÊU CẦU — không màn nào tự đổi lịch, tự bảo lưu hay tự chuyển lớp.

const O_NHAP =
  "w-full rounded-xl border border-[#d9c9e4] bg-white px-3 text-base text-[var(--sr-ink,#241133)] outline-none focus:border-[var(--sr-purple)]";
const NHAN = "flex flex-col gap-1.5 text-sm font-semibold";

function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-full px-3.5 text-sm font-semibold",
        on ? "border-2 border-[var(--sr-purple)] bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]" : "border border-[#d9c9e4] bg-white",
      )}
    >
      {children}
    </button>
  );
}

export type TuyChon = {
  buoiSapToi: { id: string; label: string }[];
  coSoDich: { id: string; ten: string; diaChi: string }[];
  homNay: string;
};

export function FormYeuCauLoai({ slug, tuyChon }: { slug: Exclude<SlugYeuCau, "hoc-bu">; tuyChon: TuyChon }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [buoiId, setBuoiId] = useState("");
  const [chip, setChip] = useState<string>("");
  const [nhieuChip, setNhieuChip] = useState<string[]>([]);
  const [ngay, setNgay] = useState("");
  const [coSo, setCoSo] = useState("");
  const [muonBu, setMuonBu] = useState(true);
  const [ghiChu, setGhiChu] = useState("");

  const chonNhieu = (v: string) => setNhieuChip((c) => (c.includes(v) ? c.filter((x) => x !== v) : [...c, v]));

  function gui() {
    let input: Parameters<typeof createParentRequest>[0] | null = null;
    let thieu: string | null = null;
    if (slug === "nghi") {
      if (!buoiId) thieu = "Ba mẹ chọn buổi con nghỉ nhé.";
      else input = { type: "ABSENCE", sessionId: buoiId, content: noiDungBaoNghi({ lyDo: chip || lyDoBaoNghi[0]!, ghiChu, muonBu }) };
    } else if (slug === "bao-luu") {
      if (!chip) thieu = "Ba mẹ chọn lý do bảo lưu nhé.";
      else
        input = {
          type: "RESERVE",
          preferredDate: ngay || null,
          content: noiDungYeuCau([`Xin bảo lưu. Lý do: ${chip}.`, ngay && `Dự kiến từ ${ngay.split("-").reverse().join("/")}.`, ghiChu && `Ghi chú: ${ghiChu}`]),
        };
    } else if (slug === "doi-lop") {
      if (nhieuChip.length === 0 && ghiChu.trim().length < 5) thieu = "Ba mẹ chọn khung giờ mong muốn hoặc ghi chú giúp nhé.";
      else
        input = {
          type: "TRANSFER_CLASS",
          content: noiDungYeuCau(["Xin chuyển lớp.", nhieuChip.length > 0 && `Khung giờ mong muốn: ${nhieuChip.join(", ")}.`, ghiChu && `Ghi chú: ${ghiChu}`]),
        };
    } else if (slug === "doi-co-so") {
      const cs = tuyChon.coSoDich.find((c) => c.id === coSo);
      if (!cs) thieu = "Ba mẹ chọn cơ sở muốn chuyển đến nhé.";
      else input = { type: "TRANSFER_CENTER", content: noiDungYeuCau([`Xin chuyển sang cơ sở ${cs.ten} (${cs.diaChi}).`, ghiChu && `Ghi chú: ${ghiChu}`]) };
    } else {
      if (ghiChu.trim().length < 5) thieu = "Ba mẹ mô tả yêu cầu giúp nhé (ít nhất vài chữ).";
      else input = { type: "OTHER", content: noiDungYeuCau([`Chủ đề: ${chip || CHU_DE_KHAC[CHU_DE_KHAC.length - 1]}.`, ghiChu]) };
    }
    if (thieu || !input) return void toast.error(thieu ?? "Thiếu thông tin");
    const goi = input;
    start(async () => {
      const r = await createParentRequest(goi);
      if (!r.ok) return void toast.error(r.error ?? "Chưa gửi được yêu cầu, ba mẹ thử lại nhé.");
      toast.success("Đã gửi yêu cầu. Trung tâm sẽ phản hồi sớm.");
      router.push("/portal/yeu-cau");
      router.refresh();
    });
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-[20px] border border-border bg-card p-4 min-[560px]:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        gui();
      }}
    >
      {slug === "nghi" ? (
        <>
          {tuyChon.buoiSapToi.length === 0 ? (
            <div className="rounded-[14px] border-2 border-dashed border-border p-4 text-sm text-[var(--sr-ink-muted)]">
              Chưa có buổi sắp tới nào để báo nghỉ.
            </div>
          ) : (
            <label className={NHAN}>
              Buổi con nghỉ
              <select value={buoiId} onChange={(e) => setBuoiId(e.target.value)} className={cn(O_NHAP, "h-12")}>
                <option value="">— Chọn buổi —</option>
                {tuyChon.buoiSapToi.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Lý do</span>
            <div className="flex flex-wrap gap-2">
              {lyDoBaoNghi.map((l) => (
                <Chip key={l} on={(chip || lyDoBaoNghi[0]) === l} onClick={() => setChip(l)}>
                  {l}
                </Chip>
              ))}
            </div>
          </div>
          <label className="flex min-h-11 items-center gap-2.5 text-sm">
            <input type="checkbox" checked={muonBu} onChange={(e) => setMuonBu(e.target.checked)} className="size-5 accent-[var(--sr-purple)]" />
            Con muốn học bù buổi này
          </label>
          <p className="text-xs leading-[18px] text-[var(--sr-ink-muted)]">
            Theo quy định, ba mẹ xin nghỉ trên ứng dụng trước giờ học ít nhất 4 tiếng.
          </p>
        </>
      ) : null}

      {slug === "bao-luu" ? (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Lý do bảo lưu</span>
            <div className="flex flex-wrap gap-2">
              {LY_DO_BAO_LUU.map((l) => (
                <Chip key={l} on={chip === l} onClick={() => setChip(l)}>
                  {l}
                </Chip>
              ))}
            </div>
          </div>
          <label className={NHAN}>
            Ngày dự kiến bắt đầu bảo lưu (không bắt buộc)
            <input type="date" value={ngay} min={tuyChon.homNay} onChange={(e) => setNgay(e.target.value)} className={cn(O_NHAP, "h-12")} />
          </label>
          <p className="text-xs leading-[18px] text-[var(--sr-ink-muted)]">
            Theo quy định, bảo lưu học phí còn lại tối đa 06 tháng. Trung tâm lập hồ sơ sau khi nhận yêu cầu và liên hệ ba mẹ.
          </p>
        </>
      ) : null}

      {slug === "doi-lop" ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">Khung giờ ba mẹ mong muốn (chọn nhiều)</span>
          <div className="flex flex-wrap gap-2">
            {KHUNG_GIO_MONG_MUON.map((k) => (
              <Chip key={k} on={nhieuChip.includes(k)} onClick={() => chonNhieu(k)}>
                {k}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      {slug === "doi-co-so" ? (
        tuyChon.coSoDich.length === 0 ? (
          <div className="rounded-[14px] border-2 border-dashed border-border p-4 text-sm text-[var(--sr-ink-muted)]">
            Hiện chưa có cơ sở khác để chuyển đến. Ba mẹ dùng mục «Yêu cầu khác» để trao đổi với trung tâm nhé.
          </div>
        ) : (
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="pb-2 text-sm font-semibold">Cơ sở muốn chuyển đến</legend>
            {tuyChon.coSoDich.map((c) => (
              <label
                key={c.id}
                className={cn(
                  "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5",
                  coSo === c.id ? "border-2 border-[var(--sr-purple)] bg-[var(--sr-tint-purple)]" : "border-[#d9c9e4]",
                )}
              >
                <input type="radio" name="co-so" checked={coSo === c.id} onChange={() => setCoSo(c.id)} className="size-5 accent-[var(--sr-purple)]" />
                <span className="flex min-w-0 flex-col">
                  <b className="text-sm">{c.ten}</b>
                  <span className="text-xs text-[var(--sr-ink-muted)]">{c.diaChi}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )
      ) : null}

      {slug === "khac" ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">Chủ đề</span>
          <div className="flex flex-wrap gap-2">
            {CHU_DE_KHAC.map((c) => (
              <Chip key={c} on={chip === c} onClick={() => setChip(c)}>
                {c}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      <label className={NHAN}>
        {slug === "khac" ? "Nội dung yêu cầu" : "Ghi chú cho trung tâm (không bắt buộc)"}
        <textarea
          rows={slug === "khac" ? 5 : 3}
          value={ghiChu}
          onChange={(e) => setGhiChu(e.target.value)}
          placeholder={slug === "khac" ? "Ba mẹ mô tả điều cần trung tâm hỗ trợ…" : "Ví dụ: con chỉ rảnh cuối tuần"}
          className={cn(O_NHAP, "resize-y py-2.5")}
        />
      </label>

      <button
        type="submit"
        disabled={pending || (slug === "doi-co-so" && tuyChon.coSoDich.length === 0)}
        className="h-12 rounded-[14px] bg-[var(--sr-purple)] px-4 text-[15px] font-bold text-white disabled:opacity-60"
      >
        {pending ? "Đang gửi…" : "Gửi yêu cầu"}
      </button>
    </form>
  );
}
