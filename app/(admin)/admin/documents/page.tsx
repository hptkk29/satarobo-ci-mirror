import Link from "next/link";
import {
  File as FileIcon,
  FileAudio,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderOpen,
  Image as ImageIcon,
  Plus,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { DocumentType, type Prisma } from "@prisma/client";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tài liệu giảng dạy | Admin" };

const TYPE_INFO: Record<DocumentType, { label: string; color: string }> = {
  PDF: { label: "PDF", color: "bg-state-danger-soft text-state-danger-ink" },
  IMAGE: { label: "Ảnh", color: "bg-state-info-soft text-state-info-ink" },
  VIDEO: { label: "Video", color: "bg-primary-soft text-primary" },
  SLIDE: { label: "Slide", color: "bg-state-warning-soft text-state-warning-ink" },
  WORKSHEET: { label: "Worksheet", color: "bg-state-success-soft text-state-success-ink" },
  AUDIO: { label: "Audio", color: "bg-primary-soft text-primary" },
  OTHER: { label: "Khác", color: "bg-muted text-foreground" },
};

function getTypeIcon(type: DocumentType) {
  switch (type) {
    case "PDF":
    case "SLIDE":
      return FileText;
    case "VIDEO":
      return FileVideo;
    case "AUDIO":
      return FileAudio;
    case "IMAGE":
      return ImageIcon;
    case "WORKSHEET":
      return FileSpreadsheet;
    default:
      return FileIcon;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const VALID_TYPES = Object.values(DocumentType);

interface SearchParams {
  searchParams: Promise<{
    q?: string;
    type?: string;
    lessonId?: string;
    isPublic?: string;
  }>;
}

export default async function DocumentsPage({ searchParams }: SearchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("documents:view"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const typeFilter =
    sp.type && VALID_TYPES.includes(sp.type as DocumentType)
      ? (sp.type as DocumentType)
      : undefined;
  const lessonFilter = sp.lessonId?.trim() || undefined;
  const publicFilter =
    sp.isPublic === "true" ? true : sp.isPublic === "false" ? false : undefined;

  const where: Prisma.DocumentWhereInput = {
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(lessonFilter ? { lessonId: lessonFilter } : {}),
    ...(publicFilter !== undefined ? { isPublic: publicFilter } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { fileName: { contains: q, mode: "insensitive" as const } },
            { documentCode: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  // Nhóm 01 L1 — Document/Lesson = học liệu toàn cục, scopedDb pass-through.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [documents, lessons] = await Promise.all([
    sdb.document.findMany({
      where,
      include: {
        lesson: {
          select: { order: true, title: true, curriculum: { select: { name: true } } },
        },
        uploadedBy: { select: { fullName: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    sdb.lesson.findMany({
      where: { curriculum: { isActive: true } },
      include: { curriculum: { select: { name: true } } },
      orderBy: [{ curriculumId: "asc" }, { order: "asc" }],
      take: 500,
    }),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <FolderOpen className="h-6 w-6 text-primary" />
            Tài liệu giảng dạy
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {documents.length > 0
              ? `${documents.length} tài liệu giảng dạy`
              : "Chưa có tài liệu giảng dạy nào"}
          </p>
        </div>
        <Link
          href="/documents/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Tải lên tài liệu giảng dạy
        </Link>
      </div>

      <form
        method="GET"
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Tìm tiêu đề / tên file / mã..."
          className="lg:col-span-2 rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <select
          name="type"
          defaultValue={typeFilter ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi loại</option>
          {Object.entries(TYPE_INFO).map(([v, { label }]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="lessonId"
          defaultValue={lessonFilter ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi bài học</option>
          {lessons.map((l) => (
            <option key={l.id} value={l.id}>
              {l.curriculum.name} — Bài {l.order}: {l.title}
            </option>
          ))}
        </select>
        <select
          name="isPublic"
          defaultValue={sp.isPublic ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi quyền truy cập</option>
          <option value="true">Public</option>
          <option value="false">Private (chỉ admin/GV)</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 sm:col-span-2 lg:col-span-5"
        >
          Áp dụng bộ lọc
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tài liệu
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Loại
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Bài học
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Kích thước
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Public
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tags
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Người tải
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {documents.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Chưa có tài liệu nào khớp bộ lọc.{" "}
                    <Link
                      href="/documents/new"
                      className="text-primary hover:underline"
                    >
                      Tải lên →
                    </Link>
                  </td>
                </tr>
              ) : (
                documents.map((d) => {
                  const typeInfo = TYPE_INFO[d.type];
                  const Icon = getTypeIcon(d.type);
                  return (
                    <tr key={d.id} className="hover:bg-muted/60">
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-2">
                          <Icon className="h-5 w-5 flex-shrink-0 text-muted-foreground mt-0.5" />
                          <div className="min-w-0">
                            <div className="font-medium text-foreground line-clamp-1">
                              {d.title}
                            </div>
                            <div className="text-xs text-muted-foreground line-clamp-1">
                              {d.fileName}
                            </div>
                            {d.documentCode && (
                              <div className="text-[10px] text-muted-foreground tabular-nums">
                                {d.documentCode}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${typeInfo.color}`}
                        >
                          {typeInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground max-w-[180px]">
                        {d.lesson ? (
                          <>
                            <div className="font-medium">
                              {d.lesson.curriculum.name}
                            </div>
                            <div className="text-muted-foreground">
                              Bài {d.lesson.order}: {d.lesson.title}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm tabular-nums text-foreground">
                        {formatBytes(d.fileSize)}
                      </td>
                      <td className="px-3 py-3">
                        {d.isPublic ? (
                          <span className="inline-flex rounded-full bg-state-success-soft px-2 py-0.5 text-xs font-semibold text-state-success-ink">
                            Public
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                            Private
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {d.tags.slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className="inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              {t}
                            </span>
                          ))}
                          {d.tags.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{d.tags.length - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {d.uploadedBy?.fullName ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <a
                            href={d.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                          >
                            Mở
                          </a>
                          <Link
                            href={`/documents/${d.id}/edit`}
                            className="rounded-md border border-primary-soft px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
                          >
                            Sửa
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
