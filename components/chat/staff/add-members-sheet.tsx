"use client";

// Admin THÊM thành viên vào nhóm chat lớp — một người vào một nhóm ("single") hoặc nhiều
// người vào nhiều nhóm cùng lúc ("bulk"), có lọc người + chọn TỪNG nhóm lớp.
//
// ⚠️ Nút/khung này KHÔNG phải chốt chặn. Trang cha chỉ render nó khi `chat:admin` đúng; mỗi
// Server Action (`lib/chat/_actions.ts` → `lib/chat/members-admin.ts`) tự kiểm quyền lần nữa,
// kiểm lại người được thêm có hợp lệ không (không phải phụ huynh/khoá), và từ chối nhóm đã lưu trữ.
//
// ⚠️ Danh sách nhân viên + nhóm tải MỘT LẦN lúc mở khung rồi lọc/tìm tại chỗ: số nhân viên nhỏ
// (trần 400) nên gõ tới đâu thấy tới đó, không có trạng thái "đang tìm…" và không thêm endpoint.
//
// Bố cục: ≥lg hai cột cạnh nhau (Người | Nhóm lớp) để nhìn cả hai vế của phép thêm cùng lúc;
// <lg một cột với thanh chuyển "Người / Nhóm lớp" — không cắt bớt chức năng ở màn nhỏ.
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Search, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  addMembersAction,
  listAddableGroupsAction,
  listAddableStaffAction,
} from "@/lib/chat/_actions";
// ⚠️ CHỈ `import type` từ lib/chat/members-admin (kéo Prisma): hằng nhóm vai chép lại dưới đây,
// có test ghim cho khỏi lệch (`add-members-sheet.test.tsx` — [AMS-BUCKET]).
import type {
  AddableGroup,
  AddableStaff,
  AddMembersResult,
  StaffBucket,
} from "@/lib/chat/members-admin";
import { Chip, PersonAvatar } from "./chat-ui";

export const BUCKET_FILTERS: { key: "ALL" | StaffBucket; label: string }[] = [
  { key: "ALL", label: "Tất cả" },
  { key: "QLCS", label: "Quản lý cơ sở" },
  { key: "GIAO_VU", label: "Giáo vụ" },
  { key: "SALE", label: "Sale" },
  { key: "GIAO_VIEN", label: "Giáo viên" },
  { key: "KHAC", label: "Vai khác" },
];

/** Bỏ dấu để gõ "van" ra "Vân". */
export function chuanHoa(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();
}

type Mode =
  | { kind: "single"; conversationId: string; conversationTitle: string }
  | { kind: "bulk" };

export function AddMembersSheet({
  mode,
  open,
  onOpenChange,
}: {
  mode: Mode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const isBulk = mode.kind === "bulk";
  const singleId = mode.kind === "single" ? mode.conversationId : null;

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [submitting, startSubmit] = useTransition();

  const [staff, setStaff] = useState<AddableStaff[]>([]);
  const [alreadyIn, setAlreadyIn] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<AddableGroup[]>([]);

  const [pickedUsers, setPickedUsers] = useState<Set<string>>(new Set());
  const [pickedGroups, setPickedGroups] = useState<Set<string>>(new Set());

  const [q, setQ] = useState("");
  const [bucket, setBucket] = useState<"ALL" | StaffBucket>("ALL");
  const [center, setCenter] = useState<string>("ALL");
  const [gq, setGq] = useState("");
  const [gCenter, setGCenter] = useState<string>("ALL");
  /** <lg: đang xem vế nào. */
  const [pane, setPane] = useState<"people" | "groups">("people");
  const [result, setResult] = useState<AddMembersResult | null>(null);

  function load() {
    setLoadError(null);
    startLoad(async () => {
      const [s, g] = await Promise.all([
        listAddableStaffAction(singleId),
        isBulk ? listAddableGroupsAction() : Promise.resolve(null),
      ]);
      if (!s.ok) return setLoadError(s.error.message);
      if (g && !g.ok) return setLoadError(g.error.message);
      setStaff(s.data.staff);
      setAlreadyIn(new Set(s.data.alreadyIn));
      if (g && g.ok) setGroups(g.data);
      setLoaded(true);
    });
  }

  function handleOpenChange(next: boolean) {
    if (submitting) return;
    onOpenChange(next);
  }

  // Khung chỉ được dựng khi người dùng BẤM nút mở (xem `AddMemberButton`/`BulkAddButton`), nên
  // tải đúng một lần lúc dựng. Đây là dữ liệu của MỘT thao tác theo yêu cầu, không phải dữ liệu
  // ban đầu của trang — danh sách nhân viên (trần 400) không đáng nằm trong payload RSC của
  // mọi người xem chat, kể cả người không có quyền thêm.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- chủ ý chạy một lần
  useEffect(load, []);

  const centers = useMemo(() => {
    const m = new Map<string, string>();
    let hasHo = false;
    for (const s of staff) {
      if (s.centerId && s.centerName) m.set(s.centerId, s.centerName);
      else hasHo = true;
    }
    return { list: [...m.entries()].map(([id, name]) => ({ id, name })), hasHo };
  }, [staff]);

  const groupCenters = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) if (g.centerId && g.centerName) m.set(g.centerId, g.centerName);
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [groups]);

  const shownStaff = useMemo(() => {
    const k = chuanHoa(q);
    return staff.filter((s) => {
      if (bucket !== "ALL" && !s.buckets.includes(bucket)) return false;
      if (center === "HO" ? s.centerId !== null : center !== "ALL" && s.centerId !== center) return false;
      if (!k) return true;
      return chuanHoa(s.name).includes(k) || s.roleLabels.some((l) => chuanHoa(l).includes(k));
    });
  }, [staff, q, bucket, center]);

  const shownGroups = useMemo(() => {
    const k = chuanHoa(gq);
    return groups.filter((g) => {
      if (gCenter !== "ALL" && g.centerId !== gCenter) return false;
      return !k || chuanHoa(g.title).includes(k);
    });
  }, [groups, gq, gCenter]);

  const selectableStaff = shownStaff.filter((s) => !alreadyIn.has(s.userId));
  const allStaffPicked =
    selectableStaff.length > 0 && selectableStaff.every((s) => pickedUsers.has(s.userId));
  const allGroupsPicked = shownGroups.length > 0 && shownGroups.every((g) => pickedGroups.has(g.conversationId));

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  const groupCount = isBulk ? pickedGroups.size : 1;
  const canSubmit = pickedUsers.size > 0 && groupCount > 0 && !submitting;

  function submit() {
    if (!canSubmit) return;
    startSubmit(async () => {
      const res = await addMembersAction({
        conversationIds: isBulk ? [...pickedGroups] : [singleId],
        userIds: [...pickedUsers],
      });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      setResult(res.data);
      router.refresh();
      if (res.data.groups.every((g) => g.error === null)) {
        toast.success(
          res.data.addedTotal > 0
            ? `Đã thêm ${res.data.addedTotal} lượt thành viên.`
            : "Mọi người đã ở sẵn trong nhóm — không có gì thay đổi.",
        );
      }
    });
  }

  const title = isBulk ? "Thêm đồng loạt vào nhóm lớp" : "Thêm thành viên";
  const description = isBulk
    ? "Chọn người cần thêm, rồi chọn từng nhóm lớp muốn họ vào."
    : `Chọn nhân viên để thêm vào nhóm “${mode.kind === "single" ? mode.conversationTitle : ""}”.`;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn("w-full gap-0 p-0", isBulk ? "sm:max-w-[1040px]" : "sm:max-w-[520px]")}
      >
        <SheetHeader className="flex-row items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
            <SheetDescription className="mt-0.5 line-clamp-2 text-xs">{description}</SheetDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => handleOpenChange(false)}
            aria-label="Đóng"
            className="-mr-1 size-9 shrink-0"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </SheetHeader>

        {result ? (
          <ResultView result={result} onClose={() => handleOpenChange(false)} />
        ) : (
          <>
            {isBulk && (
              <div className="border-b border-border px-4 py-2 lg:hidden" role="tablist" aria-label="Bước chọn">
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
                  <PaneTab active={pane === "people"} onClick={() => setPane("people")}>
                    Người ({pickedUsers.size})
                  </PaneTab>
                  <PaneTab active={pane === "groups"} onClick={() => setPane("groups")}>
                    Nhóm lớp ({pickedGroups.size})
                  </PaneTab>
                </div>
              </div>
            )}

            <div
              // `minmax(0,1fr)`: cột lưới mặc định co theo min-content, mà hàng chip có
              // `overflow-x-auto` vẫn báo min-content = tổng bề ngang các chip ⇒ cả khung rộng
              // hơn màn hình và ô tìm bị cắt ở mép phải (đo ở 375px).
              className={cn(
                "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]",
                isBulk && "lg:grid-cols-2 lg:divide-x lg:divide-border",
              )}
            >
              <section
                className={cn(
                  "min-h-0 min-w-0 flex-col",
                  isBulk && pane !== "people" ? "hidden lg:flex" : "flex",
                )}
                aria-label="Chọn người"
              >
                <PaneToolbar>
                  <SearchBox value={q} onChange={setQ} placeholder="Tìm theo tên hoặc vai…" label="Tìm nhân viên" />
                  <ChipRow>
                    {BUCKET_FILTERS.map((b) => (
                      <FilterChip key={b.key} active={bucket === b.key} onClick={() => setBucket(b.key)}>
                        {b.label}
                      </FilterChip>
                    ))}
                  </ChipRow>
                  {(centers.list.length > 0 || centers.hasHo) && (
                    <select
                      value={center}
                      onChange={(e) => setCenter(e.target.value)}
                      aria-label="Lọc theo cơ sở"
                      className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
                    >
                      <option value="ALL">Mọi cơ sở</option>
                      {centers.list.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                      {centers.hasHo && <option value="HO">Hội sở (không gắn cơ sở)</option>}
                    </select>
                  )}
                  <SelectAllRow
                    shown={selectableStaff.length}
                    picked={pickedUsers.size}
                    all={allStaffPicked}
                    noun="người"
                    onToggleAll={() =>
                      setPickedUsers((cur) => {
                        const next = new Set(cur);
                        for (const s of selectableStaff) {
                          if (allStaffPicked) next.delete(s.userId);
                          else next.add(s.userId);
                        }
                        return next;
                      })
                    }
                    onClear={() => setPickedUsers(new Set())}
                  />
                </PaneToolbar>

                <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" aria-label="Danh sách nhân viên">
                  {loading && !loaded && <ListMessage>Đang tải danh sách…</ListMessage>}
                  {loadError && (
                    <ListMessage tone="error">
                      {loadError}{" "}
                      <button type="button" onClick={load} className="font-medium underline">
                        Thử lại
                      </button>
                    </ListMessage>
                  )}
                  {loaded && shownStaff.length === 0 && (
                    <ListMessage>Không có nhân viên nào khớp bộ lọc.</ListMessage>
                  )}
                  {shownStaff.map((s) => {
                    const already = alreadyIn.has(s.userId);
                    return (
                      <PickRow
                        key={s.userId}
                        checked={pickedUsers.has(s.userId) || already}
                        disabled={already}
                        onChange={() => setPickedUsers((cur) => toggle(cur, s.userId))}
                        lead={<PersonAvatar name={s.name} id={s.userId} />}
                        title={s.name}
                        meta={s.roleLabels.join(" · ") || "Nhân viên"}
                        trailing={
                          already ? (
                            <Chip tone="success">Đã trong nhóm</Chip>
                          ) : s.centerName ? (
                            <span className="max-w-[9rem] truncate text-xs text-muted-foreground">{s.centerName}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Hội sở</span>
                          )
                        }
                      />
                    );
                  })}
                </ul>
              </section>

              {isBulk && (
                <section
                  className={cn("min-h-0 min-w-0 flex-col", pane !== "groups" ? "hidden lg:flex" : "flex")}
                  aria-label="Chọn nhóm lớp"
                >
                  <PaneToolbar>
                    <SearchBox value={gq} onChange={setGq} placeholder="Tìm nhóm lớp…" label="Tìm nhóm lớp" />
                    {groupCenters.length > 1 && (
                      <ChipRow>
                        <FilterChip active={gCenter === "ALL"} onClick={() => setGCenter("ALL")}>
                          Mọi cơ sở
                        </FilterChip>
                        {groupCenters.map((c) => (
                          <FilterChip key={c.id} active={gCenter === c.id} onClick={() => setGCenter(c.id)}>
                            {c.name}
                          </FilterChip>
                        ))}
                      </ChipRow>
                    )}
                    <SelectAllRow
                      shown={shownGroups.length}
                      picked={pickedGroups.size}
                      all={allGroupsPicked}
                      noun="nhóm"
                      onToggleAll={() =>
                        setPickedGroups((cur) => {
                          const next = new Set(cur);
                          for (const g of shownGroups) {
                            if (allGroupsPicked) next.delete(g.conversationId);
                            else next.add(g.conversationId);
                          }
                          return next;
                        })
                      }
                      onClear={() => setPickedGroups(new Set())}
                    />
                  </PaneToolbar>

                  <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" aria-label="Danh sách nhóm lớp">
                    {loading && !loaded && <ListMessage>Đang tải danh sách…</ListMessage>}
                    {loaded && shownGroups.length === 0 && (
                      <ListMessage>Không có nhóm lớp nào khớp bộ lọc.</ListMessage>
                    )}
                    {shownGroups.map((g) => (
                      <PickRow
                        key={g.conversationId}
                        checked={pickedGroups.has(g.conversationId)}
                        onChange={() => setPickedGroups((cur) => toggle(cur, g.conversationId))}
                        lead={
                          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                            <Users className="size-4" aria-hidden />
                          </span>
                        }
                        title={g.title}
                        meta={g.centerName ?? "Chưa gắn cơ sở"}
                        trailing={
                          <span className="text-xs text-muted-foreground">{g.memberCount} thành viên</span>
                        }
                      />
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <SheetFooter className="mt-0 flex-row items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 sm:px-5">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground sm:text-sm" aria-live="polite">
                {pickedUsers.size === 0 ? (
                  "Chưa chọn ai."
                ) : isBulk ? (
                  <>
                    Thêm <b className="text-foreground">{pickedUsers.size}</b> người vào{" "}
                    <b className="text-foreground">{pickedGroups.size}</b> nhóm
                  </>
                ) : (
                  <>
                    Thêm <b className="text-foreground">{pickedUsers.size}</b> người
                  </>
                )}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
                  Huỷ
                </Button>
                <Button type="button" onClick={submit} disabled={!canSubmit} className="gap-1.5">
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <UserPlus className="size-4" aria-hidden />
                  )}
                  Thêm vào nhóm
                </Button>
              </div>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PaneTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "h-9 rounded-md px-3 text-sm font-medium transition-colors",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PaneToolbar({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2 border-b border-border bg-card px-4 py-3 sm:px-5">{children}</div>;
}

function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-10 w-full rounded-lg border border-border bg-background pl-8 pr-8 text-sm outline-none focus:border-primary"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Xoá từ khoá"
          className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">{children}</div>;
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SelectAllRow({
  shown,
  picked,
  all,
  noun,
  onToggleAll,
  onClear,
}: {
  shown: number;
  picked: number;
  all: boolean;
  noun: string;
  onToggleAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <button
        type="button"
        onClick={onToggleAll}
        disabled={shown === 0}
        className="font-medium text-foreground underline-offset-2 hover:underline disabled:text-muted-foreground disabled:no-underline"
      >
        {all ? "Bỏ chọn" : "Chọn"} {shown} {noun} đang lọc
      </button>
      {picked > 0 && (
        <button type="button" onClick={onClear} className="text-muted-foreground underline-offset-2 hover:underline">
          Xoá {picked} đã chọn
        </button>
      )}
    </div>
  );
}

function PickRow({
  checked,
  disabled,
  onChange,
  lead,
  title,
  meta,
  trailing,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  lead: React.ReactNode;
  title: string;
  meta: string;
  trailing: React.ReactNode;
}) {
  return (
    <li>
      <label
        className={cn(
          "flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors sm:px-5",
          disabled ? "cursor-not-allowed opacity-60" : "hover:bg-muted/60",
          checked && !disabled && "bg-primary/5",
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          className="size-4 shrink-0 accent-primary"
        />
        {lead}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{meta}</span>
        </span>
        <span className="shrink-0">{trailing}</span>
      </label>
    </li>
  );
}

function ListMessage({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <li
      className={cn(
        "px-5 py-10 text-center text-sm",
        tone === "error" ? "text-state-danger-ink" : "text-muted-foreground",
      )}
    >
      {children}
    </li>
  );
}

function ResultView({ result, onClose }: { result: AddMembersResult; onClose: () => void }) {
  const failed = result.groups.filter((g) => g.error);
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="mb-3 flex items-center gap-2">
          <CheckCircle2 className="size-5 text-state-success-ink" aria-hidden />
          <p className="text-sm font-semibold text-foreground">
            {result.addedTotal > 0 ? `Đã thêm ${result.addedTotal} lượt thành viên` : "Không có thay đổi"}
            {failed.length > 0 && (
              <span className="font-normal text-state-danger-ink"> · {failed.length} nhóm không thêm được</span>
            )}
          </p>
        </div>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {result.groups.map((g) => (
            <li key={g.conversationId} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{g.title}</span>
              {g.error ? (
                <Chip tone="danger" className="max-w-[60%] whitespace-normal text-left">
                  {g.error.message}
                </Chip>
              ) : g.added > 0 ? (
                <Chip tone="success">
                  Thêm {g.added}
                  {g.alreadyIn > 0 ? ` · ${g.alreadyIn} đã có` : ""}
                </Chip>
              ) : (
                <Chip>Đã có sẵn</Chip>
              )}
            </li>
          ))}
        </ul>
      </div>
      <SheetFooter className="mt-0 border-t border-border bg-card px-4 py-3 sm:px-5">
        <Button type="button" onClick={onClose}>
          Xong
        </Button>
      </SheetFooter>
    </>
  );
}

// ─── Nút mở khung ───────────────────────────────────────────────────────────

/** Nút "Thêm thành viên" trên đầu luồng / màn thành viên — thêm vào ĐÚNG nhóm đang mở. */
export function AddMemberButton({
  conversationId,
  conversationTitle,
  compact = false,
  className,
}: {
  conversationId: string;
  conversationTitle: string;
  /** Chỉ biểu tượng ở màn hẹp. */
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Thêm thành viên"
        className={cn("gap-1.5", compact && "size-9 px-0 xl:w-auto xl:px-3", className)}
      >
        <UserPlus className="size-4" aria-hidden />
        <span className={cn(compact && "hidden xl:inline")}>Thêm thành viên</span>
      </Button>
      {open && (
        <AddMembersSheet
          mode={{ kind: "single", conversationId, conversationTitle }}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}

/** Nút "Thêm đồng loạt" trên đầu danh sách hội thoại. */
export function BulkAddButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn("h-9 gap-1.5", className)}
      >
        <Users className="size-4" aria-hidden />
        Thêm đồng loạt
      </Button>
      {open && <AddMembersSheet mode={{ kind: "bulk" }} open={open} onOpenChange={setOpen} />}
    </>
  );
}
