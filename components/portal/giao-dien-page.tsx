"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  GraduationCap,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Save,
  Sun,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PageHero } from "@/components/portal/page-header";
import { usePortalAppearance } from "@/components/portal/appearance-provider";
import {
  ACCENT_PRESETS,
  INK_DARK,
  ROLE_DEFAULT_ACCENT,
  WCAG_AA,
  accentContrast,
  inkOn,
  type PortalRole,
  type ThemeMode,
} from "@/lib/portal/appearance";

const THEMES: { id: ThemeMode; label: string; icon: LucideIcon }[] = [
  { id: "light", label: "Sáng", icon: Sun },
  { id: "dark", label: "Tối", icon: Moon },
  { id: "system", label: "Hệ thống", icon: Monitor },
];

const ROLES: { id: PortalRole; label: string; icon: LucideIcon }[] = [
  { id: "parent", label: "Phụ huynh", icon: UserRound },
  { id: "student", label: "Học sinh", icon: GraduationCap },
];

export function GiaoDienPage() {
  const {
    mounted,
    role,
    theme,
    setTheme,
    accents,
    setAccent,
    saveAccents,
    discardAccents,
    dirty,
  } = usePortalAppearance();

  // Vai trò ĐANG SỬA — mặc định là vai trò của route hiện tại. Khác với `role`
  // của context (vai trò đang hiển thị trên shell).
  const [editRole, setEditRole] = useState<PortalRole>(role);
  const [justSaved, setJustSaved] = useState(false);

  const accent = accents[editRole];

  // Ô nhập HEX giữ state riêng để người dùng gõ dở (chưa đủ 6 ký tự) không bị
  // ghi đè ngược; chỉ commit khi đủ 6 ký tự hợp lệ.
  const [hexInput, setHexInput] = useState(() => accent.replace("#", ""));
  useEffect(() => setHexInput(accent.replace("#", "")), [accent]);

  const onHexChange = (raw: string) => {
    const value = raw.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
    setHexInput(value);
    if (value.length === 6) setAccent(editRole, `#${value}`);
  };

  const onSave = () => {
    saveAccents();
    setJustSaved(true);
  };
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(t);
  }, [justSaved]);

  const ink = inkOn(accent);
  // Tương phản THỰC của chữ trên nền accent, sau khi đã chọn mực tốt nhất.
  const ratio = accentContrast(accent);
  const passesAA = ratio >= WCAG_AA;
  const isDefault =
    accent.toUpperCase() === ROLE_DEFAULT_ACCENT[editRole].toUpperCase();
  const previewingShell = editRole === role;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHero
        icon={Palette}
        overline="Cài đặt"
        title="Giao diện"
        subtitle="Tùy chỉnh chế độ hiển thị và màu nhấn — lưu riêng trên thiết bị này."
      />

      {/* Vai trò đang sửa */}
      <Card className="mb-5 rounded-2xl border-border/60 py-0 shadow-none">
        <CardContent className="flex flex-wrap items-center gap-3 p-3.5">
          <span className="text-sm font-semibold text-muted-foreground">
            Áp dụng cho:
          </span>
          <div className="inline-flex gap-1 rounded-xl bg-muted p-1">
            {ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setEditRole(r.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all",
                  editRole === r.id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: accents[r.id] }}
                />
                {r.label}
              </button>
            ))}
          </div>
          <span className="ml-auto hidden text-xs font-medium text-muted-foreground sm:block">
            Mỗi vai trò một màu riêng · Sáng/Tối dùng chung
          </span>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_21rem] lg:items-start">
        <Card className="overflow-hidden rounded-2xl border-border/60 py-0 shadow-none">
          <CardContent className="divide-y divide-border/60 p-0">
            {/* 1. Chế độ hiển thị */}
            <section className="p-5 sm:p-6">
              <SectionTitle
                num={1}
                title="Chế độ hiển thị"
                desc="Chọn nền sáng, tối hoặc bám theo cài đặt thiết bị. Lưu ngay khi chọn."
              />
              <div className="grid grid-cols-3 gap-2.5 sm:ml-8 sm:gap-3">
                {THEMES.map((t) => {
                  // Trước khi mount chưa đọc được localStorage → không tô mục nào,
                  // tránh nháy sai lựa chọn.
                  const on = mounted && theme === t.id;
                  const dark = t.id === "dark";
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTheme(t.id)}
                      aria-pressed={on}
                      className={cn(
                        "rounded-xl border-2 p-3 text-left transition-all",
                        on
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40 hover:bg-muted",
                      )}
                    >
                      <div className="mb-2.5 flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground">
                          <t.icon className="size-4" /> {t.label}
                        </span>
                        {on && (
                          <span
                            className="grid size-5 place-items-center rounded-full bg-primary"
                            style={{ color: "var(--primary-foreground)" }}
                          >
                            <Check className="size-3" />
                          </span>
                        )}
                      </div>
                      <div
                        className={cn(
                          "flex h-12 flex-col justify-center gap-1.5 rounded-lg border p-2",
                          dark
                            ? "border-white/10 bg-[#0E0B12]"
                            : "border-black/10 bg-white",
                        )}
                      >
                        <span className="h-1.5 w-[42%] rounded-full bg-primary/85" />
                        <span
                          className={cn(
                            "h-1.5 w-[66%] rounded-full",
                            dark ? "bg-white/25" : "bg-neutral-200",
                          )}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 2. Màu nhấn gợi ý */}
            <section className="p-5 sm:p-6">
              <SectionTitle
                num={2}
                title="Màu nhấn thương hiệu"
                desc="Chọn nhanh từ bộ màu gợi ý."
              />
              <div className="flex flex-wrap gap-5 sm:ml-8">
                {ACCENT_PRESETS.map((p) => {
                  const on = accent.toUpperCase() === p.hex.toUpperCase();
                  const def =
                    ROLE_DEFAULT_ACCENT[editRole].toUpperCase() ===
                    p.hex.toUpperCase();
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setAccent(editRole, p.hex)}
                      aria-label={`Màu ${p.name}`}
                      aria-pressed={on}
                      className="group flex flex-col items-center gap-2"
                    >
                      <span
                        className={cn(
                          "grid size-11 place-items-center rounded-full transition-all",
                          on
                            ? "scale-110"
                            : "opacity-70 group-hover:scale-105 group-hover:opacity-100",
                        )}
                        style={{
                          backgroundColor: p.hex,
                          color: inkOn(p.hex),
                          boxShadow: on
                            ? `0 0 0 3px var(--card), 0 0 0 5px ${p.hex}`
                            : undefined,
                        }}
                      >
                        {on && <Check className="size-5" />}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-bold uppercase tracking-wide",
                          on ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {p.name}
                        {def ? " ✓" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 3. Màu tùy chỉnh */}
            <section className="p-5 sm:p-6">
              <SectionTitle
                num={3}
                title="Tùy chỉnh màu"
                desc="Nhập mã HEX hoặc chọn tự do. Chữ trên nút tự đổi để giữ tương phản."
              />
              <div className="space-y-3 sm:ml-8">
                <div className="flex flex-wrap items-center gap-3">
                  <label
                    className="size-11 shrink-0 cursor-pointer overflow-hidden rounded-xl border-2 border-border"
                    style={{ backgroundColor: accent }}
                  >
                    <input
                      type="color"
                      value={accent}
                      onChange={(e) => setAccent(editRole, e.target.value)}
                      className="size-full cursor-pointer opacity-0"
                      aria-label="Chọn màu nhấn"
                    />
                  </label>
                  <div className="inline-flex h-11 items-center rounded-xl border-2 border-border bg-muted px-3">
                    <span className="font-bold text-muted-foreground">#</span>
                    <input
                      value={hexInput.toUpperCase()}
                      onChange={(e) => onHexChange(e.target.value)}
                      maxLength={6}
                      inputMode="text"
                      spellCheck={false}
                      aria-label="Mã màu HEX"
                      className="w-28 bg-transparent font-semibold uppercase tracking-wider text-foreground outline-none"
                    />
                  </div>
                  <span
                    className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-bold"
                    style={{ backgroundColor: accent, color: ink }}
                  >
                    Aa Nút
                  </span>
                  {!isDefault && (
                    <button
                      type="button"
                      onClick={() =>
                        setAccent(editRole, ROLE_DEFAULT_ACCENT[editRole])
                      }
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <RotateCcw className="size-3.5" /> Mặc định
                    </button>
                  )}
                </div>

                <div
                  className={cn(
                    // Nền dark rất tối → sắc 700 chìm hẳn; cần nâng lên 300 ở dark.
                    "flex items-start gap-2 rounded-xl p-3 text-sm font-semibold",
                    passesAA
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                  )}
                >
                  {passesAA ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  )}
                  <span>
                    {passesAA
                      ? `Tương phản tốt (${ratio.toFixed(1)}:1) — chữ ${ink === INK_DARK ? "tối" : "trắng"} dễ đọc trên nền này.`
                      : `Tương phản thấp (${ratio.toFixed(1)}:1) — chưa đạt chuẩn WCAG AA (${WCAG_AA}:1). Hãy chọn màu đậm hơn hoặc nhạt hơn.`}
                  </span>
                </div>
              </div>
            </section>
          </CardContent>
        </Card>

        {/* Xem trước */}
        <div className="lg:sticky lg:top-20">
          <Card className="overflow-hidden rounded-2xl border-border/60 py-0 shadow-none">
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <span className="text-sm font-bold text-foreground">
                  Xem trước
                </span>
                <span
                  className="rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide"
                  style={{ backgroundColor: `${accent}26`, color: accent }}
                >
                  {editRole === "parent" ? "Phụ huynh" : "Học sinh"}
                </span>
              </div>
              <div className="p-4">
                {/* Mini portal — dùng màu inline để xem trước ĐÚNG vai trò đang sửa,
                    kể cả khi shell đang hiển thị vai trò khác. */}
                <div className="flex h-56 overflow-hidden rounded-xl border border-border">
                  <div
                    className="flex w-14 shrink-0 flex-col items-center gap-2.5 py-3"
                    style={{ backgroundColor: accent }}
                  >
                    <span className="grid size-6 place-items-center rounded-lg bg-white/90 text-xs">
                      🤖
                    </span>
                    <span
                      className="h-1.5 w-8 rounded"
                      style={{ backgroundColor: `${ink}59` }}
                    />
                    <span
                      className="h-2 w-9 rounded"
                      style={{ backgroundColor: ink }}
                    />
                    <span
                      className="h-1.5 w-8 rounded"
                      style={{ backgroundColor: `${ink}59` }}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-2.5 bg-card p-3.5">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="grid size-8 place-items-center rounded-full border-2 text-xs font-bold"
                        style={{ borderColor: accent, color: accent }}
                      >
                        BM
                      </span>
                      <div className="space-y-1">
                        <span className="block h-2 w-20 rounded bg-foreground/80" />
                        <span className="block h-1.5 w-14 rounded bg-muted-foreground/60" />
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-bold"
                        style={{
                          backgroundColor: `${accent}26`,
                          color: accent,
                        }}
                      >
                        Tiến độ
                      </span>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        Đã bù
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full w-[62%] rounded-full"
                        style={{ backgroundColor: accent }}
                      />
                    </div>
                    <button
                      type="button"
                      className="mt-auto self-start rounded-lg px-3.5 py-2 text-xs font-bold"
                      style={{ backgroundColor: accent, color: ink }}
                    >
                      Xem chi tiết
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {previewingShell
                    ? "Mọi nút, thanh tiến độ và điểm nhấn quanh bạn đang dùng màu này."
                    : `Màu này áp dụng khi bạn vào Cổng ${editRole === "student" ? "học sinh" : "phụ huynh"}.`}
                  {isDefault && " Đang dùng màu mặc định của vai trò."}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Thanh lưu */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <span className="text-sm font-medium text-muted-foreground">
          {dirty
            ? "Có thay đổi chưa lưu"
            : justSaved
              ? "Đã lưu thay đổi"
              : "Đã đồng bộ"}
        </span>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              type="button"
              onClick={discardAccents}
              className="inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Hoàn tác
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty}
            className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl px-6 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-foreground)",
            }}
          >
            {justSaved ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <Save className="size-4" />
            )}
            {justSaved ? "Đã lưu" : "Lưu thay đổi"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({
  num,
  title,
  desc,
}: {
  num: number;
  title: string;
  desc: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="flex items-center gap-2.5 text-base font-bold text-foreground">
        <span className="grid size-6 place-items-center rounded-md bg-primary/15 text-xs font-bold text-primary">
          {num}
        </span>
        {title}
      </h2>
      <p className="ml-8 mt-1.5 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
