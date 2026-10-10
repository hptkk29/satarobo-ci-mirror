"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createNotification,
  toggleNotificationPublish,
  deleteNotification,
} from "../actions";
import { formatDateVN } from "@/lib/format/date";

type Opt = { id: string; label: string };
type Item = {
  id: string;
  title: string;
  body: string;
  audience: string;
  scopeLabel: string;
  isPublished: boolean;
  createdAt: string;
  createdByName: string | null;
};

const inputCls =
  "w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none";

export function NotificationsClient({
  items,
  centers,
  classes,
  students = [],
}: {
  items: Item[];
  centers: Opt[];
  classes: Opt[];
  students?: Opt[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("ALL_PARENTS");
  const [centerId, setCenterId] = useState("");
  const [classId, setClassId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  function submit() {
    startTransition(async () => {
      const res = await createNotification({
        title,
        body,
        audience,
        centerId: centerId || null,
        classId: classId || null,
        studentId: studentId || null,
        publish: true,
      });
      if (res.ok) {
        toast.success("Đã đăng thông báo");
        setTitle("");
        setBody("");
        setAudience("ALL_PARENTS");
        setCenterId("");
        setClassId("");
        setStudentId("");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">
          Soạn thông báo
        </h2>
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Tiêu đề"
            className={inputCls}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="Nội dung thông báo…"
            className={inputCls}
          />
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className={inputCls}
          >
            <option value="ALL_PARENTS">Tất cả phụ huynh</option>
            <option value="CENTER">Theo cơ sở</option>
            <option value="CLASS">Theo lớp</option>
            <option value="STUDENT">Theo học viên (riêng)</option>
          </select>
          {audience === "CENTER" && (
            <select
              value={centerId}
              onChange={(e) => setCenterId(e.target.value)}
              className={inputCls}
            >
              <option value="">— Chọn cơ sở —</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          {audience === "CLASS" && (
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className={inputCls}
            >
              <option value="">— Chọn lớp —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          {audience === "STUDENT" && (
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className={inputCls}
            >
              <option value="">— Chọn học viên —</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
          >
            Đăng thông báo
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">
          Đã đăng ({items.length})
        </h2>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Chưa có thông báo.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((n) => (
              <li key={n.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-foreground">{n.title}</p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ n.isPublished ? "bg-state-success-soft text-state-success-ink" : "bg-muted text-muted-foreground" }`}
                  >
                    {n.isPublished ? "Hiển thị" : "Ẩn"}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {n.scopeLabel} ·{" "}
                  {formatDateVN(n.createdAt)}
                  {n.createdByName ? ` · ${n.createdByName}` : ""}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      startTransition(async () => {
                        await toggleNotificationPublish(n.id);
                        router.refresh();
                      })
                    }
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {n.isPublished ? "Ẩn" : "Hiển thị"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmDel === n.id) {
                        startTransition(async () => {
                          await deleteNotification(n.id);
                          setConfirmDel(null);
                          router.refresh();
                        });
                      } else {
                        setConfirmDel(n.id);
                      }
                    }}
                    className="text-xs font-medium text-state-danger-ink hover:underline"
                  >
                    {confirmDel === n.id ? "Xác nhận xoá?" : "Xoá"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
