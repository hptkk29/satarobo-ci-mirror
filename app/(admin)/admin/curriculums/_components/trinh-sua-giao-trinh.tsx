"use client";

import { useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, ChevronLeft, ChevronRight, Clock, FileBox, Lock, MessageSquareWarning } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LessonFormDialog } from "./lesson-form-dialog";
import { LessonResourcePanel, type AssignmentRow, type LessonResourceRow } from "./lesson-resources";
import type { LessonRow } from "./lesson-list";

// TRÌNH SỬA GIÁO TRÌNH theo HỌC PHẦN (29/09/2026 — thiết kế lại màn giáo trình).
//
// Luận đề: người soạn giáo trình nghĩ theo HỌC PHẦN rồi tới TỪNG BUỔI, nên màn đi đúng thứ tự đó:
// chọn học phần (cột trái) → thấy các buổi của nó (lưới thẻ) → bấm một buổi → ngăn chỉnh bên phải
// có ĐỦ mọi thứ của buổi (nội dung, giáo án SCORM, bài tập) — không còn phải kéo xuống cuối trang.
//
// An toàn dữ liệu: ngăn chỉnh dùng LẠI nguyên form sửa buổi (`updateLesson`) và khối SCORM/bài tập
// (`LessonResourcePanel`) — không có đường ghi nào mới ở đây. Học phần đang chọn + buổi đang mở
// nằm trên URL (`?hp=&bai=`) nên tải lại trang vẫn ở đúng chỗ.

const CHUA_CHIA = "_";

type Nhom = { ma: string; nhan: string; bai: LessonRow[] };

export function TrinhSuaGiaoTrinh({
  curriculumId,
  lessons,
  moduleCodeTheoBai,
  taiNguyenTheoBai,
  availableAssignments,
  scormEnabled,
  canActivateScorm,
  chiNgan = false,
}: {
  curriculumId: string;
  /** Chỉ bài ĐANG DÙNG (chưa lưu trữ), theo thứ tự. */
  lessons: LessonRow[];
  moduleCodeTheoBai: Record<string, string | null>;
  taiNguyenTheoBai: Record<string, LessonResourceRow>;
  availableAssignments: AssignmentRow[];
  scormEnabled: boolean;
  canActivateScorm: boolean;
  /** Tab “Thiết lập”: chỉ dựng NGĂN chỉnh buổi (danh sách buổi ở đó mở nó qua `?bai=`). */
  chiNgan?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, start] = useTransition();

  const nhom = useMemo<Nhom[]>(() => {
    const m = new Map<string, Nhom>();
    for (const l of lessons) {
      const ma = moduleCodeTheoBai[l.id] ?? CHUA_CHIA;
      if (!m.has(ma)) m.set(ma, { ma, nhan: ma === CHUA_CHIA ? "Chưa chia học phần" : ma, bai: [] });
      m.get(ma)!.bai.push(l);
    }
    return [...m.values()];
  }, [lessons, moduleCodeTheoBai]);

  const baiId = sp?.get("bai") ?? null;
  const bai = baiId ? (lessons.find((l) => l.id === baiId) ?? null) : null;
  // Buổi đang mở quyết định học phần (link từ tab Thiết lập không mang `hp`) — nhờ vậy nút
  // “Buổi trước/sau” đi đúng trong học phần của buổi đó.
  const hp =
    (bai ? nhom.find((n) => n.bai.some((l) => l.id === bai.id)) : undefined) ??
    nhom.find((n) => n.ma === sp?.get("hp")) ??
    nhom[0] ??
    null;
  const ngan = sp?.get("ngan") === "tai-lieu" ? "tai-lieu" : "noi-dung";
  const viTri = bai && hp ? hp.bai.findIndex((l) => l.id === bai.id) : -1;

  function dat(p: { hp?: string; bai?: string | null }) {
    const q = new URLSearchParams(sp?.toString() ?? "");
    if (p.hp !== undefined) q.set("hp", p.hp);
    if (p.bai === null) {
      q.delete("bai");
      q.delete("ngan");
    }
    else if (p.bai !== undefined) q.set("bai", p.bai);
    start(() => router.replace(`?${q.toString()}`, { scroll: false }));
  }

  if (lessons.length === 0 && !chiNgan) {
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Giáo trình chưa có buổi nào — đặt số buổi ở tab “Thiết lập”.
      </p>
    );
  }

  const coGiaoAn = (id: string) =>
    taiNguyenTheoBai[id]?.scorm.some((p) => p.isActiveForLesson && p.status === "PUBLISHED") ?? false;

  // ── Ngăn chỉnh MỘT buổi — dùng chung cho tab “Nội dung” và tab “Thiết lập” ──
  const nganBuoi = (
      <Sheet open={bai !== null} onOpenChange={(mo) => !mo && dat({ bai: null })}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl 2xl:max-w-3xl">
          {bai && (
            <>
              <SheetHeader className="border-b border-border pb-3">
                <SheetDescription className="tabular-nums">
                  {hp?.nhan} · Bài {bai.order}
                </SheetDescription>
                <SheetTitle className="pr-8 text-lg">{bai.title}</SheetTitle>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={viTri <= 0}
                    onClick={() => hp && dat({ bai: hp.bai[viTri - 1]!.id })}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40"
                  >
                    <ChevronLeft className="size-3.5" aria-hidden /> Buổi trước
                  </button>
                  <button
                    type="button"
                    disabled={!hp || viTri < 0 || viTri >= hp.bai.length - 1}
                    onClick={() => hp && dat({ bai: hp.bai[viTri + 1]!.id })}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40"
                  >
                    Buổi sau <ChevronRight className="size-3.5" aria-hidden />
                  </button>
                </div>
              </SheetHeader>
              <Tabs key={`${bai.id}:${ngan}`} defaultValue={ngan} className="px-4 pb-6">
                <TabsList className="w-full sm:w-auto">
                  <TabsTrigger value="noi-dung">Nội dung buổi</TabsTrigger>
                  <TabsTrigger value="tai-lieu">Giáo án &amp; bài tập</TabsTrigger>
                </TabsList>
                <TabsContent value="noi-dung" className="pt-4">
                  {bai.status === "LOCKED" && (
                    <p className="mb-3 rounded-lg bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
                      Buổi đã khoá — Đào tạo mở khoá ở tab “Thiết lập” › danh sách buổi rồi mới sửa được.
                    </p>
                  )}
                  {/* `key` theo buổi: chuyển buổi là dựng lại form với dữ liệu buổi mới. */}
                  <LessonFormDialog key={bai.id} inline curriculumId={curriculumId} lesson={bai} />
                </TabsContent>
                <TabsContent value="tai-lieu" className="pt-4">
                  {taiNguyenTheoBai[bai.id] ? (
                    <LessonResourcePanel
                      key={bai.id}
                      lesson={taiNguyenTheoBai[bai.id]!}
                      availableAssignments={availableAssignments}
                      scormEnabled={scormEnabled}
                      canActivateScorm={canActivateScorm}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">Không đọc được tài nguyên của buổi này.</p>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
  );

  if (chiNgan) return nganBuoi;

  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] 2xl:grid-cols-[17rem_minmax(0,1fr)]">
      {/* ── Học phần: dải chip cuộn ngang ở màn nhỏ, cột dính ở màn lớn ── */}
      <nav aria-label="Học phần" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {nhom.map((n) => {
            const dangChon = n.ma === hp?.ma;
            const soGiaoAn = n.bai.filter((l) => coGiaoAn(l.id)).length;
            return (
              <li key={n.ma} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  onClick={() => dat({ hp: n.ma, bai: null })}
                  aria-current={dangChon ? "true" : undefined}
                  className={cn(
                    "flex w-full min-w-[9.5rem] flex-col items-start rounded-xl border px-3.5 py-2.5 text-left transition-colors",
                    dangChon
                      ? "border-primary bg-primary-soft/60"
                      : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
                  )}
                >
                  <span className="text-sm font-semibold text-foreground">{n.nhan}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Bài {n.bai[0]!.order}–{n.bai[n.bai.length - 1]!.order} · {n.bai.length} buổi
                  </span>
                  {scormEnabled && (
                    <span
                      className={cn(
                        "mt-1.5 text-[11px] font-medium tabular-nums",
                        soGiaoAn === n.bai.length ? "text-state-success-ink" : "text-muted-foreground",
                      )}
                    >
                      Giáo án {soGiaoAn}/{n.bai.length}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── Các buổi của học phần đang chọn ── */}
      {hp && (
        <section aria-label={hp.nhan} className="min-w-0">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">
              {hp.nhan}
              <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">{hp.bai.length} buổi</span>
            </h2>
            <p className="text-xs text-muted-foreground">Bấm một buổi để sửa nội dung, giáo án và bài tập.</p>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
            {hp.bai.map((l) => {
              const tn = taiNguyenTheoBai[l.id];
              const giaoAn = coGiaoAn(l.id);
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => dat({ bai: l.id })}
                    className={cn(
                      "group flex h-full w-full flex-col rounded-xl border bg-card p-4 text-left shadow-sm transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      bai?.id === l.id ? "border-primary" : "border-border",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground tabular-nums">
                        Bài {l.order}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {l.status === "LOCKED" && <Lock className="size-3.5 text-muted-foreground" aria-label="Đã khoá" />}
                        {l.openChangeRequests > 0 && (
                          <MessageSquareWarning
                            className="size-3.5 text-state-warning-ink"
                            aria-label={`${l.openChangeRequests} đề xuất chỉnh bài`}
                          />
                        )}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 font-medium text-foreground">{l.title}</p>
                    {l.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{l.description}</p>}
                    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Clock className="size-3.5" aria-hidden /> {l.duration} phút
                      </span>
                      {scormEnabled && (
                        <span className={cn("inline-flex items-center gap-1", giaoAn && "text-state-success-ink")}>
                          <FileBox className="size-3.5" aria-hidden /> {giaoAn ? "Có giáo án" : "Chưa giáo án"}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <BookOpen className="size-3.5" aria-hidden /> {tn?.assignments.length ?? 0} bài tập
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {nganBuoi}
    </div>
  );
}
