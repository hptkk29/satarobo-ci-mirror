"use client";

// Ô tìm kiếm của màn Tin nhắn (nhân viên).
//
// Gộp HAI nguồn vào MỘT ô, vì với người dùng chúng là một câu hỏi duy nhất — "tôi muốn
// nhắn cho ai":
//   1. HỘI THOẠI ĐÃ CÓ (nhóm lớp + nhắn riêng) — lọc theo tên hiển thị;
//   2. PHỤ HUYNH MÌNH ĐƯỢC GÁN nhưng CHƯA có kênh — chọn là mở kênh mới ngay.
//
// ⚠️ Lọc ở CLIENT, không gọi server mỗi lần gõ. Hai danh sách đã nằm sẵn trong payload
// RSC của trang (hội thoại vốn phải tải để vẽ danh sách; phụ huynh được gán trần 500 dòng).
// Gõ tới đâu thấy tới đó, không có trạng thái "đang tìm…", và không thêm một endpoint nào
// phải đi bảo vệ.
//
// ⚠️ Nhóm lớp LUÔN được xếp lên TRƯỚC khi không tìm kiếm gì: đây chính là yêu cầu "tránh
// tin nhắn nhiều phụ huynh làm trôi mất nhóm lớp".

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X, Users, MessageSquare, UserPlus } from "lucide-react";
import { OpenDmButton } from "../open-dm-button";

export type SearchConversation = {
  conversationId: string;
  displayName: string;
  type: string;
  preview: string | null;
  unreadCount: number;
  isArchived: boolean;
};

export type SearchParent = {
  parentUserId: string;
  parentName: string | null;
  childLabels: string[];
};

/** Bỏ dấu để gõ "an" ra "Bé Ân" — người dùng không gõ dấu khi tìm nhanh. */
function chuanHoa(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();
}

export function ConversationSearch({
  conversations,
  parents,
  basePath,
  selectedId,
}: {
  conversations: SearchConversation[];
  /** Rỗng với vai không mở được kênh mới (GV/QLCS) — khi đó ô chỉ lọc hội thoại. */
  parents: SearchParent[];
  basePath: string;
  selectedId: string | null;
}) {
  const [q, setQ] = useState("");
  const tuKhoa = chuanHoa(q);

  const { nhomLop, nhanRieng, phMoi } = useMemo(() => {
    const khop = (s: string | null | undefined) => !tuKhoa || chuanHoa(s ?? "").includes(tuKhoa);
    const hopLe = conversations.filter((c) => khop(c.displayName) || khop(c.preview));
    // Phụ huynh ĐÃ có kênh riêng thì không hiện lại ở khối "mở kênh mới" — trùng lặp làm
    // người dùng phân vân không biết bấm cái nào.
    const daCoKenh = new Set(
      conversations.filter((c) => c.type !== "CLASS_GROUP").map((c) => chuanHoa(c.displayName)),
    );
    return {
      nhomLop: hopLe.filter((c) => c.type === "CLASS_GROUP"),
      nhanRieng: hopLe.filter((c) => c.type !== "CLASS_GROUP"),
      phMoi: tuKhoa
        ? parents.filter(
            (p) =>
              !daCoKenh.has(chuanHoa(p.parentName ?? "")) &&
              (khop(p.parentName) || p.childLabels.some((l) => khop(l))),
          )
        : [],
    };
  }, [conversations, parents, tuKhoa]);

  const tong = nhomLop.length + nhanRieng.length + phMoi.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm nhóm lớp, phụ huynh, học viên…"
          aria-label="Tìm hội thoại hoặc phụ huynh"
          className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-9 text-sm outline-none focus:border-primary"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Xoá từ khoá"
            className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {tong === 0 && (
          <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            {tuKhoa ? `Không có kết quả cho “${q}”.` : "Chưa có hội thoại nào."}
          </p>
        )}

        <Khoi tieuDe="Nhóm lớp" icon={<Users className="size-3.5" />} so={nhomLop.length}>
          {nhomLop.map((c) => (
            <DongHoiThoai key={c.conversationId} c={c} basePath={basePath} selectedId={selectedId} />
          ))}
        </Khoi>

        <Khoi tieuDe="Nhắn riêng" icon={<MessageSquare className="size-3.5" />} so={nhanRieng.length}>
          {nhanRieng.map((c) => (
            <DongHoiThoai key={c.conversationId} c={c} basePath={basePath} selectedId={selectedId} />
          ))}
        </Khoi>

        <Khoi
          tieuDe="Phụ huynh bạn phụ trách — chưa có kênh"
          icon={<UserPlus className="size-3.5" />}
          so={phMoi.length}
        >
          {phMoi.map((p) => (
            <li
              key={p.parentUserId}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {p.parentName ?? "Phụ huynh"}
                </p>
                {p.childLabels.length > 0 && (
                  <p className="truncate text-xs text-muted-foreground">
                    {p.childLabels.join(" · ")}
                  </p>
                )}
              </div>
              <OpenDmButton
                peerUserId={p.parentUserId}
                kind="SALE_PARENT"
                hrefTemplate={`${basePath}?c=:id`}
                label="Mở kênh"
              />
            </li>
          ))}
        </Khoi>
      </div>
    </div>
  );
}

function Khoi({
  tieuDe,
  icon,
  so,
  children,
}: {
  tieuDe: string;
  icon: React.ReactNode;
  so: number;
  children: React.ReactNode;
}) {
  if (so === 0) return null;
  return (
    <section>
      <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {icon}
        {tieuDe}
        <span className="font-normal">({so})</span>
      </p>
      <ul className="space-y-1.5">{children}</ul>
    </section>
  );
}

function DongHoiThoai({
  c,
  basePath,
  selectedId,
}: {
  c: SearchConversation;
  basePath: string;
  selectedId: string | null;
}) {
  const dangChon = c.conversationId === selectedId;
  return (
    <li>
      <Link
        href={`${basePath}?c=${c.conversationId}`}
        className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
          dangChon
            ? "border-primary bg-primary/5"
            : "border-border bg-card hover:border-primary/40"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {c.displayName}
            {c.isArchived && (
              <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                · đã lưu trữ
              </span>
            )}
          </p>
          {c.preview && <p className="truncate text-xs text-muted-foreground">{c.preview}</p>}
        </div>
        {c.unreadCount > 0 && (
          <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
            {c.unreadCount > 99 ? "99+" : c.unreadCount}
          </span>
        )}
      </Link>
    </li>
  );
}
