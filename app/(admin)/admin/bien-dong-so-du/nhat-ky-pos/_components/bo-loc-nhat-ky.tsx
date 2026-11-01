"use client";

// Bộ lọc màn "Nhật ký kiểm thẻ POS" — mọi ô là một tham số URL (`docLocNhatKy` đọc lại ở server và BỎ
// giá trị lạ). Áp dụng khi bấm "Lọc" (một lần điều hướng cho cả bộ), không mỗi lần gõ. Không fetch ở
// client: trang là RSC, đổi URL ⇒ server dựng lại (`router.replace`, giữ chỗ cuộn).
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TAT_CA = "TAT_CA";

type LuaChon = { value: string; label: string };

export type GiaTriLoc = { tu: string; den: string; coSo: string | null; nguon: string | null; ketQua: string | null; ma: string | null };

function OChon({
  id,
  nhan,
  giaTri,
  tatCa,
  luaChon,
  datGiaTri,
  tat,
}: {
  id: string;
  nhan: string;
  giaTri: string;
  tatCa: string;
  luaChon: LuaChon[];
  datGiaTri: (v: string) => void;
  tat: boolean;
}) {
  const ten = giaTri === TAT_CA ? tatCa : (luaChon.find((o) => o.value === giaTri)?.label ?? tatCa);
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {nhan}
      </Label>
      <Select value={giaTri} onValueChange={(v) => datGiaTri(v ?? TAT_CA)} disabled={tat}>
        <SelectTrigger id={id} className="h-9 w-full">
          {/* CON của SelectValue — không bao giờ rơi về giá trị thô (mã enum / id cơ sở). */}
          <SelectValue>{ten}</SelectValue>
        </SelectTrigger>
        <SelectContent className="admin-scope">
          <SelectItem value={TAT_CA}>{tatCa}</SelectItem>
          {luaChon.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function BoLocNhatKy({
  giaTri,
  homNay,
  coSo,
  nguon,
  ketQua,
}: {
  /**
   * Bộ lọc ĐANG áp (server đọc từ URL). Trang đặt `key` theo bộ lọc ⇒ đổi URL là dựng lại ô nhập —
   * `useState` chỉ đọc giá trị đầu lúc mount, không theo prop.
   */
  giaTri: GiaTriLoc;
  /** "YYYY-MM-DD" hôm nay giờ VN (server tính) — "Đặt lại" đưa hai ô ngày về đây. */
  homNay: string;
  /** Cơ sở người xem CHỌN ĐƯỢC — một cơ sở thì không vẽ ô (không có gì để chọn). */
  coSo: LuaChon[];
  nguon: LuaChon[];
  ketQua: LuaChon[];
}) {
  const router = useRouter();
  const [dangLoc, batDau] = useTransition();
  const [tu, datTu] = useState(giaTri.tu);
  const [den, datDen] = useState(giaTri.den);
  const [coSoChon, datCoSo] = useState(giaTri.coSo ?? TAT_CA);
  const [nguonChon, datNguon] = useState(giaTri.nguon ?? TAT_CA);
  const [ketQuaChon, datKetQua] = useState(giaTri.ketQua ?? TAT_CA);
  const [ma, datMa] = useState(giaTri.ma ?? "");

  function di(q: URLSearchParams) {
    const s = q.toString();
    batDau(() => router.replace(s ? `?${s}` : "?", { scroll: false }));
  }

  function loc(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = new URLSearchParams();
    if (tu) q.set("tu", tu);
    if (den) q.set("den", den);
    if (coSoChon !== TAT_CA) q.set("coSo", coSoChon);
    if (nguonChon !== TAT_CA) q.set("nguon", nguonChon);
    if (ketQuaChon !== TAT_CA) q.set("ketQua", ketQuaChon);
    if (ma.trim()) q.set("ma", ma.trim());
    di(q);
  }

  function datLai() {
    datTu(homNay);
    datDen(homNay);
    datCoSo(TAT_CA);
    datNguon(TAT_CA);
    datKetQua(TAT_CA);
    datMa("");
    di(new URLSearchParams());
  }

  return (
    <form
      onSubmit={loc}
      noValidate
      aria-label="Lọc nhật ký kiểm thẻ POS"
      // Đo smoke 06/10: một hàng 7 cột ở 1280px (khung nội dung ~976px) cắt chữ ô ngày ("06/10/20") và
      // ô chọn ("Mọi kết qu"). Bốn cột từ lg, một hàng chỉ từ 2xl; ô ngày chiếm cả hàng ở màn hẹp.
      className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-[repeat(6,minmax(0,1fr))_auto]"
    >
      <div className="col-span-2 min-w-0 space-y-1.5 sm:col-span-1">
        <Label htmlFor="nk-tu" className="text-xs text-muted-foreground">
          Từ ngày
        </Label>
        <Input id="nk-tu" type="date" value={tu} onChange={(e) => datTu(e.target.value)} disabled={dangLoc} className="h-9" />
      </div>
      <div className="col-span-2 min-w-0 space-y-1.5 sm:col-span-1">
        <Label htmlFor="nk-den" className="text-xs text-muted-foreground">
          Đến ngày
        </Label>
        <Input id="nk-den" type="date" value={den} onChange={(e) => datDen(e.target.value)} disabled={dangLoc} className="h-9" />
      </div>
      {coSo.length > 1 ? (
        <OChon id="nk-co-so" nhan="Cơ sở" giaTri={coSoChon} tatCa="Mọi cơ sở" luaChon={coSo} datGiaTri={datCoSo} tat={dangLoc} />
      ) : null}
      <OChon id="nk-nguon" nhan="Nguồn" giaTri={nguonChon} tatCa="Mọi nguồn" luaChon={nguon} datGiaTri={datNguon} tat={dangLoc} />
      <OChon id="nk-ket-qua" nhan="Kết quả" giaTri={ketQuaChon} tatCa="Mọi kết quả" luaChon={ketQua} datGiaTri={datKetQua} tat={dangLoc} />
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="nk-ma" className="text-xs text-muted-foreground">
          Mã phiếu
        </Label>
        <Input
          id="nk-ma"
          value={ma}
          onChange={(e) => datMa(e.target.value)}
          disabled={dangLoc}
          placeholder="VD K7M2N"
          maxLength={12}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="h-9 font-mono uppercase placeholder:normal-case placeholder:font-sans"
        />
      </div>
      <div className="col-span-2 flex items-end gap-2 sm:col-span-3 lg:col-span-2 2xl:col-span-1">
        <Button type="submit" className="h-9 flex-1 lg:min-w-32 lg:flex-none" disabled={dangLoc}>
          {dangLoc ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}
          {dangLoc ? "Đang lọc…" : "Lọc"}
        </Button>
        <Button type="button" variant="ghost" className="h-9" onClick={datLai} disabled={dangLoc} aria-label="Đặt lại bộ lọc về hôm nay">
          <RotateCcw aria-hidden />
          <span className="2xl:sr-only">Đặt lại</span>
        </Button>
      </div>
    </form>
  );
}
