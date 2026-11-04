"use client";

// CÀI RIÊNG THEO CƠ SỞ — PHIÊN H · 22/09/2026.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO KHỐI NÀY TỒN TẠI
//
// `saveCenterSettingAction` có trong repo từ R6-A và **KHÔNG giao diện nào gọi** (đo
// 22/09/2026: `grep saveCenterSettingAction --include=*.tsx` ra 0 dòng). Tức 47 tham số khai
// `centerOverridable: true` đều KHÔNG cài riêng được — khả năng có trong mã, không có trong
// tay người vận hành. Đúng lớp "cờ chết" mà `PAYMENT_LEDGER_V2` đã dạy, chỉ khác là ở đây
// đường ghi thật sự chạy được, chỉ thiếu nút.
//
// ─────────────────────────────────────────────────────────────────────────────
// BA TRẠNG THÁI, KHÔNG PHẢI HAI
//
//   · **Theo toàn hệ** — cơ sở KHÔNG có dòng riêng; đổi mức toàn hệ thì cơ sở đổi theo.
//   · **Bật riêng**    — có dòng, giá trị riêng, KHÁC mức toàn hệ.
//   · **Tắt riêng**    — có dòng, giá trị riêng; với công tắc thì là `false`.
//
// ⚠️ "Tắt riêng" và "theo toàn hệ mà toàn hệ đang tắt" **trông giống hệt nhau** trên màn hình
// nếu chỉ vẽ một cái công tắc. Nhưng chúng khác nhau về HẬU QUẢ: quản trị bật mức toàn hệ thì
// cái thứ hai bật theo, cái thứ nhất thì không. Nên mỗi cơ sở hiện một NHÃN nói rõ nó đang ở
// trạng thái nào, và nút "Trả về theo toàn hệ" chỉ hiện khi có gì để trả.
//
// ⚠️ Gỡ KHÔNG PHẢI tắt. Gộp hai thứ vào một nút là người vận hành tưởng mình vừa tắt trong
// khi thật ra vừa trả cơ sở về mức toàn hệ — mà mức ấy có thể đang BẬT.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { NhanVanHanh } from "@/lib/settings/nhan-van-hanh";
import { saveCenterSettingAction, xoaCenterSettingAction } from "../actions";

/** Một cơ sở + giá trị riêng của nó (nếu có). */
export type CoSoCauHinh = {
  orgUnitId: string;
  ten: string;
  /** `undefined` = KHÔNG có dòng riêng ⇒ theo toàn hệ. `null` là một giá trị HỢP LỆ. */
  giaTriRieng?: unknown;
};

export type TrangThaiCoSo = "THEO_TOAN_HE" | "RIENG";

/**
 * Cơ sở đang ở trạng thái nào. THUẦN — export để test gọi thẳng.
 *
 * ⚠️ Phân biệt bằng `undefined`, KHÔNG bằng giá trị falsy. `false` là một giá trị cài riêng
 * hợp lệ ("tắt riêng"), và coi nó là "chưa cài" là xoá mất một trong ba trạng thái.
 */
export function trangThaiCuaCoSo(cs: CoSoCauHinh): TrangThaiCoSo {
  return cs.giaTriRieng === undefined ? "THEO_TOAN_HE" : "RIENG";
}

/** Nhãn người vận hành đọc cho một cơ sở. */
export function nhanTrangThai(cs: CoSoCauHinh, giaTriToanHe: unknown): string {
  if (trangThaiCuaCoSo(cs) === "THEO_TOAN_HE") {
    return typeof giaTriToanHe === "boolean"
      ? `Theo toàn hệ (đang ${giaTriToanHe ? "bật" : "tắt"})`
      : "Theo toàn hệ";
  }
  if (typeof cs.giaTriRieng === "boolean") {
    return cs.giaTriRieng ? "Bật riêng" : "Tắt riêng";
  }
  return `Cài riêng: ${String(cs.giaTriRieng)}`;
}

export function CaiRiengTheoCoSo({
  settingKey,
  nhan,
  giaTriToanHe,
  coSo,
  choSua,
}: {
  settingKey: string;
  nhan: NhanVanHanh;
  giaTriToanHe: unknown;
  coSo: readonly CoSoCauHinh[];
  choSua: boolean;
}) {
  const [mo, datMo] = useState(false);
  const soRieng = coSo.filter((c) => trangThaiCuaCoSo(c) === "RIENG").length;

  if (coSo.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => datMo(!mo)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        <Building2 className="size-3.5" aria-hidden />
        Cài riêng theo cơ sở
        {/* Đếm ngay trên nút: người vận hành phải biết có cơ sở nào đang LỆCH mà không cần
            mở ra. Một mục gấp lại không có dấu hiệu gì là một mục không ai mở. */}
        {soRieng > 0 && (
          <span className="rounded bg-state-warning-soft px-1.5 text-state-warning-ink">
            {soRieng} cơ sở cài riêng
          </span>
        )}
      </button>

      {mo && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/20 p-3">
          {coSo.map((c) => (
            <HangCoSo
              // ⚠️ KHOÁ mang cả TRẠNG THÁI, không chỉ mã cơ sở — để hàng DỰNG LẠI khi giá
              // trị riêng đổi. Ô nhập và công tắc khởi tạo từ prop bằng `useState`, mà
              // `useState` KHÔNG chạy lại khi prop đổi: sau khi bấm "Trả về theo toàn hệ",
              // trang dựng lại từ máy chủ, NHÃN đổi thành "Theo toàn hệ (đang bật)" còn
              // CÔNG TẮC vẫn giữ mức riêng vừa gỡ. Hai thứ cạnh nhau nói hai điều khác
              // nhau — đúng kiểu màn hình nói dối mà luật 12 cấm, và không lỗi nào báo.
              key={`${c.orgUnitId}:${"giaTriRieng" in c ? JSON.stringify(c.giaTriRieng ?? null) : "-"}`}
              settingKey={settingKey}
              nhan={nhan}
              giaTriToanHe={giaTriToanHe}
              coSo={c}
              choSua={choSua}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HangCoSo({
  settingKey,
  nhan,
  giaTriToanHe,
  coSo,
  choSua,
}: {
  settingKey: string;
  nhan: NhanVanHanh;
  giaTriToanHe: unknown;
  coSo: CoSoCauHinh;
  choSua: boolean;
}) {
  const laCongTac = typeof giaTriToanHe === "boolean";
  const laSo = typeof giaTriToanHe === "number";
  const rieng = trangThaiCuaCoSo(coSo) === "RIENG";

  const [bat, datBat] = useState(() =>
    rieng ? coSo.giaTriRieng === true : giaTriToanHe === true,
  );
  const [oNhap, datONhap] = useState(() =>
    String((rieng ? coSo.giaTriRieng : giaTriToanHe) ?? ""),
  );
  const [lyDo, datLyDo] = useState("");
  const [dangLuu, batDauLuu] = useTransition();

  const giaTriMoi = (): unknown => {
    if (laCongTac) return bat;
    if (laSo) return Number(oNhap.trim().replace(/\s/g, ""));
    return oNhap;
  };

  const luu = () => {
    if (!lyDo.trim()) {
      toast.error("Vui lòng nhập lý do thay đổi");
      return;
    }
    const v = giaTriMoi();
    if (laSo && Number.isNaN(v)) {
      toast.error("Hãy nhập một con số");
      return;
    }
    batDauLuu(async () => {
      const r = await saveCenterSettingAction({
        orgUnitId: coSo.orgUnitId,
        key: settingKey,
        value: v,
        reason: lyDo,
      });
      if (r.ok) {
        toast.success(`Đã cài riêng cho ${coSo.ten}`);
        datLyDo("");
      } else {
        toast.error(r.error.message);
      }
    });
  };

  const traVe = () => {
    if (!lyDo.trim()) {
      toast.error("Vui lòng nhập lý do thay đổi");
      return;
    }
    batDauLuu(async () => {
      const r = await xoaCenterSettingAction({
        orgUnitId: coSo.orgUnitId,
        key: settingKey,
        reason: lyDo,
      });
      if (r.ok) {
        toast.success(`${coSo.ten} nay theo mức toàn hệ`);
        datLyDo("");
      } else {
        toast.error(r.error.message);
      }
    });
  };

  const idO = `cs-${coSo.orgUnitId}-${settingKey.replace(/\./g, "-")}`;

  return (
    <div className="rounded-md border border-border bg-background p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">{coSo.ten}</span>{" "}
          <span
            className={cn(
              "text-xs",
              rieng ? "font-medium text-state-warning-ink" : "text-muted-foreground",
            )}
          >
            · {nhanTrangThai(coSo, giaTriToanHe)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {laCongTac ? (
            <Switch
              id={idO}
              checked={bat}
              onCheckedChange={datBat}
              disabled={!choSua || dangLuu}
              aria-label={`${nhan.ten} — ${coSo.ten}`}
            />
          ) : (
            <Input
              id={idO}
              value={oNhap}
              inputMode={laSo ? "decimal" : "text"}
              onChange={(e) => datONhap(e.target.value)}
              disabled={!choSua || dangLuu}
              aria-label={`${nhan.ten} — ${coSo.ten}`}
              className={cn("h-9", laSo ? "w-28 text-right tabular-nums" : "w-44")}
            />
          )}
          {nhan.donVi && <span className="text-xs text-muted-foreground">{nhan.donVi}</span>}
        </div>
      </div>

      {choSua && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={lyDo}
            onChange={(e) => datLyDo(e.target.value)}
            placeholder="Vì sao cơ sở này khác? (bắt buộc)"
            disabled={dangLuu}
            aria-label={`Lý do thay đổi cho ${coSo.ten}`}
            className="h-9 sm:flex-1"
          />
          <Button size="sm" onClick={luu} disabled={dangLuu}>
            Cài riêng
          </Button>
          {/* Chỉ hiện khi CÓ GÌ để trả. Một nút "trả về" trên một cơ sở vốn đã theo toàn hệ
              là một nút không làm gì — lời hứa suông (luật 12). */}
          {rieng && (
            <Button size="sm" variant="outline" onClick={traVe} disabled={dangLuu}>
              Trả về theo toàn hệ
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
