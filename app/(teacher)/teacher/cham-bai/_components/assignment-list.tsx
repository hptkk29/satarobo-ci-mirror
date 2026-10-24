"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookMarked, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { BangPhanTrang } from "@/components/ui/bang-phan-trang";
import {
  ListToolbar,
  type SelectFilter,
} from "../../_components/ui/list-toolbar";
import { EmptyState } from "../../_components/ui/empty-state";
import type { AssignmentWindowView } from "../_data";
import { LateWindowDialog } from "./late-window-dialog";

/** Một hàng bài tập đã giao — plain data từ server. */
export interface AssignmentRow {
  id: string;
  title: string;
  /** Lớp của bài — dùng link sang trang lớp (/teacher/lop?classId=…). */
  classId: string;
  className: string;
  /** true = có câu hỏi (trắc nghiệm/kiểm tra); false = bài tập tự luận/nộp tệp. */
  isTest: boolean;
  /** true = giao từ template thư viện admin; false = GV tự tạo trực tiếp. */
  fromAdmin: boolean;
  /** Parity 18/08 — buổi học bài được gắn vào ("dd/MM · chủ đề"); null = không gắn. */
  sessionLabel: string | null;
  /** Mô tả ngắn của đầu bài (hiện mờ dưới tiêu đề). */
  description: string | null;
  submitted: number;
  total: number;
  /**
   * Trạng thái SUY tại lúc render (25/08) — thay cho việc in thẳng cột `status`.
   * Cột `status` một mình không nói được "quá hạn rồi": nó đứng nguyên PUBLISHED
   * mãi mãi, nên bảng cũ ghi "Đang mở" cho cả bài hết hạn từ tháng trước.
   */
  win: AssignmentWindowView;
}

/** Nhãn + màu pill theo trạng thái suy. Đóng = "info" cho khớp ngôn ngữ màu cũ của site GV. */
const STATE_CLASS: Record<AssignmentWindowView["state"], string> = {
  draft: "bg-muted text-muted-foreground",
  open: "bg-state-success-soft text-state-success-ink",
  "late-open": "bg-state-warning-soft text-state-warning-ink",
  closed: "bg-state-info-soft text-state-info-ink",
  archived: "bg-muted text-muted-foreground",
};
const STATE_LABEL: Record<AssignmentWindowView["state"], string> = {
  draft: "Nháp",
  open: "Đang mở",
  "late-open": "Nộp trễ",
  closed: "Đã đóng",
  archived: "Lưu trữ",
};
/** Thứ tự bộ lọc — theo vòng đời bài, không theo bảng chữ cái. */
const STATE_ORDER: AssignmentWindowView["state"][] = [
  "draft",
  "open",
  "late-open",
  "closed",
  "archived",
];

const ALL = "ALL";

export function AssignmentList({
  rows,
  actions,
}: {
  rows: AssignmentRow[];
  /** Nút "Giao bài" (AssignDialog) đặt trong thanh công cụ — parity 18/08. */
  actions?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [cls, setCls] = useState(ALL);
  const [kind, setKind] = useState(ALL); // ALL | test | homework
  const [status, setStatus] = useState(ALL);

  const classOptions = useMemo<SelectFilter["options"]>(() => {
    const names = [...new Set(rows.map((r) => r.className))].sort((a, b) =>
      a.localeCompare(b, "vi"),
    );
    return [
      { value: ALL, label: "Tất cả lớp" },
      ...names.map((n) => ({ value: n, label: n })),
    ];
  }, [rows]);

  const kindOptions: SelectFilter["options"] = [
    { value: ALL, label: "Mọi hình thức" },
    { value: "test", label: "Kiểm tra" },
    { value: "homework", label: "Bài tập" },
  ];

  // Lọc theo trạng thái NGƯỜI DÙNG NHÌN THẤY (suy), không theo cột status: chọn
  // "Đã đóng" mà ra bài đang hiện chữ "Đang mở" thì bộ lọc thành thứ gây nghi ngờ.
  const statusOptions = useMemo<SelectFilter["options"]>(() => {
    const present = new Set(rows.map((r) => r.win.state));
    return [
      { value: ALL, label: "Mọi trạng thái" },
      ...STATE_ORDER.filter((s) => present.has(s)).map((s) => ({
        value: s,
        label: STATE_LABEL[s],
      })),
    ];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (cls !== ALL && r.className !== cls) return false;
      if (kind === "test" && !r.isTest) return false;
      if (kind === "homework" && r.isTest) return false;
      if (status !== ALL && r.win.state !== status) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.className.toLowerCase().includes(q)
      );
    });
  }, [rows, query, cls, kind, status]);

  return (
    <>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm theo tên bài, lớp..."
        actions={actions}
        filters={[
          { value: cls, onChange: setCls, options: classOptions },
          { value: kind, onChange: setKind, options: kindOptions },
          { value: status, onChange: setStatus, options: statusOptions },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={PencilLine}
          title="Chưa có bài tập nào được giao ở lớp bạn phụ trách."
        />
      ) : (
        // BangPhanTrang (KHÔNG phải PhanTrangBang): nó đặt vùng cuộn ngang quanh RIÊNG
        // cái bảng, thanh phân trang nằm ngoài. Bọc kiểu cũ thì cuộn sang phải là thanh
        // phân trang trôi mất khỏi màn hình.
        <div className="t-card overflow-hidden">
          <BangPhanTrang
            className="pb-3"
            tenDonVi="bài"
            khoaGhiNho="gv-bai-tap"
            colSpan={7}
            trong="Không có bài tập khớp bộ lọc."
            // Bỏ cột "Nguồn" (gộp vào ô Nội dung) + cho tiêu đề xuống dòng: bảng cũ
            // min-w 880px, thêm cột thao tác nữa là tràn ngang trên laptop 1280.
            tableClassName="min-w-[720px] border-collapse text-left"
            theadClassName="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
            head={
              <tr>
                <th scope="col" className="px-5 py-3">
                  Nội dung
                </th>
                <th scope="col" className="px-5 py-3">
                  Lớp
                </th>
                <th scope="col" className="px-5 py-3">
                  Hình thức
                </th>
                <th scope="col" className="px-5 py-3">
                  Hạn nộp
                </th>
                <th scope="col" className="px-5 py-3">
                  Đã nộp
                </th>
                <th scope="col" className="px-5 py-3">
                  Trạng thái
                </th>
                <th scope="col" className="px-5 py-3 text-right">
                  <span className="sr-only">Gia hạn</span>
                </th>
              </tr>
            }
            rows={filtered.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
              >
                {/* min-w trên <td> thì trình duyệt tôn trọng, còn max-w thì KHÔNG:
                    CSS 2.1 §17.5.2 để `max-width` trên ô bảng là undefined và
                    Chrome/Firefox bỏ qua ở table-layout:auto. `max-w-sm` cũ ở đây vì
                    thế vô tác dụng — trần phải đặt trên khối BÊN TRONG ô (xem div
                    dưới), còn sàn thì đặt ngay trên ô. Không có sàn thì cột nội dung
                    bị bóp còn 92px và mỗi dòng cao 350px (QA vòng 1, BUG-026). */}
                <td className="min-w-[16rem] px-5 py-3.5">
                  <div className="max-w-[30rem]">
                  <Link
                    href={`?assignmentId=${r.id}`}
                    className="rounded-sm font-medium text-foreground outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {r.title}
                  </Link>
                  {r.sessionLabel && (
                    <p className="text-xs text-primary-ink">Buổi: {r.sessionLabel}</p>
                  )}
                  {r.description && (
                    <p className="text-xs text-muted-foreground">{r.description}</p>
                  )}
                  {/* Nguồn đề: gộp vào đây thay vì chiếm một cột riêng — thông tin
                      tham khảo, không ai lọc/sắp xếp theo nó. */}
                  <span className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    {r.fromAdmin ? (
                      <>
                        <BookMarked className="h-3.5 w-3.5" aria-hidden />
                        Thư viện admin
                      </>
                    ) : (
                      <>
                        <PencilLine className="h-3.5 w-3.5" aria-hidden />
                        Tự tạo
                      </>
                    )}
                  </span>
                  </div>
                </td>
                {/* KHÔNG whitespace-nowrap: tên lớp là text tự do ("Luyện thi Robosim
                    — T7 sáng"), nowrap làm min-content của cột BẰNG max-content nên
                    cột này nở tới 397px và bóp cột nội dung xuống 92px. Cùng bệnh và
                    cùng bản vá với class-list.tsx. */}
                <td className="min-w-[9rem] px-5 py-3.5">
                  <Link
                    href={`/teacher/lop?classId=${r.classId}`}
                    className="rounded-sm font-medium text-primary-ink outline-none hover:text-primary-ink-hover hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {r.className}
                  </Link>
                </td>
                <td className="px-5 py-3.5 whitespace-nowrap">
                  {r.isTest ? (
                    <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary-ink">
                      Kiểm tra
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-state-info-soft px-2.5 py-1 text-xs font-semibold text-state-info-ink">
                      Bài tập
                    </span>
                  )}
                </td>
                <td className="px-5 py-3.5 whitespace-nowrap text-muted-foreground">
                  {r.win.dueText ?? "—"}
                  {/* Cửa nộp bù hiện ngay dưới hạn gốc: GV cần thấy CẢ HAI mốc, hạn gốc
                      là cái quyết định bài nộp có bị ghi "muộn" hay không. */}
                  {r.win.lateUntilText && (
                    <p className="text-xs font-semibold text-state-warning-ink">
                      Nộp bù đến {r.win.lateUntilText}
                    </p>
                  )}
                </td>
                <td className="px-5 py-3.5 whitespace-nowrap text-foreground">
                  {r.submitted}/{r.total}
                </td>
                <td className="px-5 py-3.5 whitespace-nowrap">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                      STATE_CLASS[r.win.state],
                    )}
                  >
                    {r.win.label}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right whitespace-nowrap">
                  <LateWindowDialog assignmentId={r.id} title={r.title} win={r.win} />
                </td>
              </tr>
            ))}
          />
        </div>
      )}
    </>
  );
}
