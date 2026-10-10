"use client";

// Form BAN HÀNH / SỬA chính sách khuyến mãi — khuôn `chinhSachSchema`.
//
// Bố cục theo đúng thứ tự người soạn cầm văn bản giấy trong tay: số hiệu + tên → ưu đãi → điều
// kiện → hiệu lực → phạm vi → tệp gốc. Nút chính nói đúng hệ quả ("Ban hành — có hiệu lực và báo
// Sale ngay"), vì ở màn này bấm nút là thông báo đi tới mọi người tra cứu trong phạm vi.
//
// Phạm vi: không chọn cơ sở nào = TOÀN HỆ THỐNG; không chọn khoá nào = MỌI KHOÁ. Câu đó in ngay
// cạnh ô chọn — hai mặc định "rỗng = tất cả" mà không nói ra là lời hứa ngầm dễ đọc ngược.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { banHanhAction, suaAction } from "../_actions";
import { TepVanBan, type TepDaTai } from "./tep-van-ban";

export type LuaChon = { id: string; ma: string; ten: string; daNgung?: boolean };

export type GiaTriForm = {
  maVanBan: string;
  ten: string;
  noiDungUuDai: string;
  dieuKien: string;
  tuNgay: string;
  denNgay: string;
  coSo: string[];
  khoaHoc: string[];
  tep: TepDaTai | null;
};

const MA_RE = /^[A-Z0-9][A-Z0-9._/-]{1,39}$/;

function NhanTruong({ children, batBuoc }: { children: React.ReactNode; batBuoc?: boolean }) {
  return (
    <span className="mb-1 block text-sm font-semibold text-foreground">
      {children}
      {batBuoc && <span className="text-state-danger-ink"> *</span>}
    </span>
  );
}

function ChonNhieu({
  luaChon,
  daChon,
  doi,
  khiRong,
  disabled,
}: {
  luaChon: LuaChon[];
  daChon: string[];
  doi: (ids: string[]) => void;
  khiRong: string;
  disabled: boolean;
}) {
  const tatCa = daChon.length === 0;
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        aria-pressed={tatCa}
        disabled={disabled}
        onClick={() => doi([])}
        className={cn(
          "inline-flex h-9 items-center whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors",
          tatCa ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-card text-foreground hover:bg-muted",
        )}
      >
        {khiRong}
      </button>
      {luaChon.map((l) => {
        const chon = daChon.includes(l.id);
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={chon}
            disabled={disabled}
            onClick={() => doi(chon ? daChon.filter((x) => x !== l.id) : [...daChon, l.id])}
            className={cn(
              "inline-flex h-9 items-center whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors",
              chon ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            {l.ten}
            {l.daNgung && <span className="ml-1 text-xs text-muted-foreground">(đã ngừng)</span>}
          </button>
        );
      })}
    </div>
  );
}

export function FormChinhSach({
  id,
  giaTriDau,
  coSo,
  khoaHoc,
}: {
  /** Có id ⇒ sửa; không ⇒ ban hành mới. */
  id?: string;
  giaTriDau: GiaTriForm;
  coSo: LuaChon[];
  khoaHoc: LuaChon[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState<GiaTriForm>(giaTriDau);
  const [daBamGui, setDaBamGui] = useState(false);
  const dat = <K extends keyof GiaTriForm>(k: K, x: GiaTriForm[K]) => setV((cu) => ({ ...cu, [k]: x }));

  const loi: Partial<Record<keyof GiaTriForm, string>> = {};
  if (!MA_RE.test(v.maVanBan.trim().toUpperCase())) loi.maVanBan = "Gồm chữ, số, dấu chấm hoặc gạch — vd SR.QD.233.";
  if (v.ten.trim().length < 3) loi.ten = "Tối thiểu 3 ký tự.";
  if (v.noiDungUuDai.trim().length < 10) loi.noiDungUuDai = "Ghi rõ ưu đãi — tối thiểu 10 ký tự.";
  if (!v.tuNgay) loi.tuNgay = "Chọn ngày bắt đầu.";
  if (!v.denNgay) loi.denNgay = "Chọn ngày kết thúc.";
  else if (v.tuNgay && v.denNgay < v.tuNgay) loi.denNgay = "Ngày kết thúc phải từ ngày bắt đầu trở đi.";
  const hopLe = Object.keys(loi).length === 0;
  const hienLoi = (k: keyof GiaTriForm) => (daBamGui && loi[k] ? loi[k] : null);

  function gui() {
    setDaBamGui(true);
    if (!hopLe) return;
    const du = {
      maVanBan: v.maVanBan.trim().toUpperCase(),
      ten: v.ten.trim(),
      noiDungUuDai: v.noiDungUuDai.trim(),
      dieuKien: v.dieuKien.trim() || undefined,
      tuNgay: v.tuNgay,
      denNgay: v.denNgay,
      coSo: v.coSo,
      khoaHoc: v.khoaHoc,
      tep: v.tep,
    };
    startTransition(async () => {
      if (id) {
        const kq = await suaAction({ id, ...du });
        if (kq.ok) {
          toast.success("Đã lưu thay đổi");
          router.push(`/khuyen-mai/${id}`);
          router.refresh();
        } else toast.error(kq.error);
        return;
      }
      const kq = await banHanhAction(du);
      if (kq.ok) {
        toast.success(
          kq.data.soNguoiDuocBao > 0
            ? `Đã ban hành ${du.maVanBan} — đã báo ${kq.data.soNguoiDuocBao} người tra cứu`
            : `Đã ban hành ${du.maVanBan}`,
        );
        router.push(`/khuyen-mai/${kq.data.id}`);
        router.refresh();
      } else toast.error(kq.error);
    });
  }

  const coLoi = (k: keyof GiaTriForm) => !!hienLoi(k);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        gui();
      }}
      className="space-y-5"
    >
      <section className="rounded-xl border border-border bg-card px-5 py-5 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <label className="block">
            <NhanTruong batBuoc>Số hiệu văn bản</NhanTruong>
            <Input
              value={v.maVanBan}
              onChange={(e) => dat("maVanBan", e.target.value.toUpperCase())}
              placeholder="SR.QD.xxx"
              maxLength={40}
              disabled={pending}
              aria-invalid={coLoi("maVanBan")}
              className="h-10 font-semibold tabular-nums placeholder:font-normal"
            />
            {hienLoi("maVanBan") && <span className="mt-1 block text-xs text-state-danger-ink">{hienLoi("maVanBan")}</span>}
          </label>
          <label className="block">
            <NhanTruong batBuoc>Tên chương trình</NhanTruong>
            <Input
              value={v.ten}
              onChange={(e) => dat("ten", e.target.value)}
              placeholder="Chương trình Back To School 2026"
              maxLength={200}
              disabled={pending}
              aria-invalid={coLoi("ten")}
              className="h-10"
            />
            {hienLoi("ten") && <span className="mt-1 block text-xs text-state-danger-ink">{hienLoi("ten")}</span>}
          </label>
        </div>

        <label className="mt-5 block">
          <NhanTruong batBuoc>Ưu đãi khách nhận được</NhanTruong>
          <Textarea
            value={v.noiDungUuDai}
            onChange={(e) => dat("noiDungUuDai", e.target.value)}
            rows={4}
            maxLength={4000}
            disabled={pending}
            aria-invalid={coLoi("noiDungUuDai")}
            placeholder={"VD: Giảm 10% học phí khoá Sata 3–5 khi đăng ký trọn khoá.\nTặng bộ cảm biến cho 30 học viên đầu tiên."}
          />
          <span className={cn("mt-1 block text-xs", hienLoi("noiDungUuDai") ? "text-state-danger-ink" : "text-muted-foreground")}>
            {hienLoi("noiDungUuDai") ?? "Sale đọc đúng câu này để tư vấn — viết như đang nói với phụ huynh. Dòng đầu hiện ở danh sách."}
          </span>
        </label>

        <label className="mt-5 block">
          <NhanTruong>Điều kiện áp dụng</NhanTruong>
          <Textarea
            value={v.dieuKien}
            onChange={(e) => dat("dieuKien", e.target.value)}
            rows={3}
            maxLength={4000}
            disabled={pending}
            placeholder="VD: Không cộng dồn với ưu đãi anh chị em. Áp dụng cho học viên mới."
          />
        </label>
      </section>

      <section className="rounded-xl border border-border bg-card px-5 py-5 sm:px-6">
        <h2 className="text-base font-semibold text-foreground">Hiệu lực và phạm vi</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:max-w-xl">
          <label className="block">
            <NhanTruong batBuoc>Áp dụng từ ngày</NhanTruong>
            <Input
              type="date"
              value={v.tuNgay}
              onChange={(e) => dat("tuNgay", e.target.value)}
              disabled={pending}
              aria-invalid={coLoi("tuNgay")}
              className="h-10 tabular-nums"
            />
            {hienLoi("tuNgay") && <span className="mt-1 block text-xs text-state-danger-ink">{hienLoi("tuNgay")}</span>}
          </label>
          <label className="block">
            <NhanTruong batBuoc>Đến hết ngày</NhanTruong>
            <Input
              type="date"
              value={v.denNgay}
              min={v.tuNgay || undefined}
              onChange={(e) => dat("denNgay", e.target.value)}
              disabled={pending}
              aria-invalid={coLoi("denNgay")}
              className="h-10 tabular-nums"
            />
            {hienLoi("denNgay") && <span className="mt-1 block text-xs text-state-danger-ink">{hienLoi("denNgay")}</span>}
          </label>
        </div>

        <fieldset className="mt-5">
          <legend className="mb-1.5 block text-sm font-semibold text-foreground">Áp dụng tại cơ sở</legend>
          <ChonNhieu luaChon={coSo} daChon={v.coSo} doi={(x) => dat("coSo", x)} khiRong="Toàn hệ thống" disabled={pending} />
          <span className="mt-1.5 block text-xs text-muted-foreground">
            Không chọn cơ sở nào = toàn hệ thống. Chỉ người tra cứu ở cơ sở được chọn nhận thông báo.
          </span>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="mb-1.5 block text-sm font-semibold text-foreground">Khoá học</legend>
          <ChonNhieu luaChon={khoaHoc} daChon={v.khoaHoc} doi={(x) => dat("khoaHoc", x)} khiRong="Mọi khoá" disabled={pending} />
        </fieldset>
      </section>

      <section className="rounded-xl border border-border bg-card px-5 py-5 sm:px-6">
        <h2 className="text-base font-semibold text-foreground">Văn bản gốc</h2>
        <p className="mb-3 mt-0.5 text-sm text-muted-foreground">
          Không bắt buộc — ban hành được ngay, đính kèm bản ký sau khi có.
        </p>
        <TepVanBan value={v.tep} onChange={(t) => dat("tep", t)} disabled={pending} />
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <Button type="submit" disabled={pending || (daBamGui && !hopLe)} className="h-10 px-5">
          {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
          {id ? "Lưu thay đổi" : "Ban hành — có hiệu lực và báo Sale ngay"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10"
          disabled={pending}
          onClick={() => router.push(id ? `/khuyen-mai/${id}` : "/khuyen-mai")}
        >
          Huỷ
        </Button>
        {id && (
          <span className="text-xs text-muted-foreground sm:ml-2">
            Sửa không gửi thông báo lại. Đổi ưu đãi đáng kể thì nên thu hồi và ban hành văn bản mới.
          </span>
        )}
      </div>
    </form>
  );
}
