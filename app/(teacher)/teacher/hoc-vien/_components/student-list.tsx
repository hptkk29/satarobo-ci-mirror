"use client";

// app/(teacher)/teacher/hoc-vien/_components/student-list.tsx — danh sách HV các lớp GV dạy.
//
// 23/08: đổi LƯỚI THẺ → BẢNG + PHÂN NHÓM THEO LỚP (chủ dự án: "để dễ quản lý").
// Lưới thẻ đọc đẹp nhưng không so được theo cột: muốn biết "lớp này còn ai chưa
// hoàn thành" thì mắt phải nhảy zíc-zắc giữa các thẻ. Bảng + nhóm theo lớp đưa đúng
// cái GV cần — một lớp là một khối, mỗi khối là một roster có sĩ số.
//
// Nhận `rows` PLAIN từ page.tsx (đã scopedDb + gộp theo HV) → chỉ lọc/hiển thị,
// KHÔNG đọc DB. Câu 46: CHỈ tên + mã HV + lớp + trạng thái — KHÔNG SĐT/email/tên PH.
// Nhãn trạng thái đi qua ENROLLMENT_STATUS (repo có 7 bộ status song song — chép tay
// danh sách là đẻ bug).
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, GraduationCap } from "lucide-react";
import { ENROLLMENT_STATUS } from "@/lib/labels/registry";
import { inRosterScope } from "@/lib/enrollment-scope";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  ListToolbar,
  type SelectFilter,
} from "../../_components/ui/list-toolbar";
import { EmptyState } from "../../_components/ui/empty-state";
import { initialsOf } from "@/lib/ui/initials";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

/** Một ghi danh của HV trong MỘT lớp GV phụ trách. */
export interface StudentClassRef {
  /** Class.id — khoá gộp/nhóm. KHÔNG dùng `name`: schema không ràng buộc unique tên lớp. */
  id: string;
  name: string;
  /** EnrollmentStatus TRONG ĐÚNG lớp này — không phải trạng thái gộp của HV. */
  status: string;
}

/** 1 học viên gộp các lớp mình phụ trách (câu 46: KHÔNG contact PH). */
export interface StudentRow {
  id: string;
  name: string;
  studentCode: string | null;
  classes: StudentClassRef[];
  /**
   * Trạng thái ĐẠI DIỆN khi gộp nhiều lớp (ưu tiên active) — chỉ dùng ở chế độ
   * "Danh sách phẳng", nơi một dòng đại diện cho nhiều ghi danh. Chế độ nhóm theo
   * lớp phải dùng `classes[].status`, nếu không thì HV đã nghỉ lớp A vẫn hiện
   * "Đang học" ở khối lớp A chỉ vì em ấy còn học lớp B.
   */
  status: string;
}

const ALL = "ALL";
const NHOM = "NHOM";
const PHANG = "PHANG";
const DANG_HOC = "DANG_HOC";

// Mặc định "Đang học" — khớp tài liệu hướng dẫn (mục "hoc-vien" gọi tiêu đề khối là
// "sĩ số" và cột Lớp là "các lớp em đang học") và khớp con số ở Tổng quan. Trước đây
// trang đổ MỌI ghi danh nên đếm 103 em còn Tổng quan đếm 81 (QA vòng 1, BUG-024).
// Vẫn giữ "Tất cả trạng thái" để không lặp lại bug "học viên tàng hình" 21/08: em đã
// nghỉ phải TÌM RA ĐƯỢC, chỉ là không nằm trong sĩ số mặc định.
/** Số khối lớp dựng ngay lần đầu; phần còn lại mở bằng nút "Xem thêm". */
const SO_KHOI_DAU = 8;

const STATUS_OPTIONS = [
  { value: DANG_HOC, label: "Đang học" },
  { value: ALL, label: "Tất cả trạng thái" },
];

// Mặc định NHÓM: GV mở màn này gần như luôn nghĩ theo lớp. "Danh sách phẳng" giữ lại
// cho việc tra một em cụ thể (mỗi HV đúng một dòng, không lặp ở nhiều khối).
const VIEW_OPTIONS = [
  { value: NHOM, label: "Nhóm theo lớp" },
  { value: PHANG, label: "Danh sách phẳng" },
];

/** Dòng bảng — đã "phẳng hoá" theo đúng ngữ cảnh đang vẽ (trong nhóm lớp / phẳng). */
interface DongBang {
  id: string;
  name: string;
  studentCode: string | null;
  /** Chuỗi lớp cho cột "Lớp"; null khi bảng nằm trong một khối lớp (tiêu đề khối đã nói). */
  classesLabel: string | null;
  status: string;
  /**
   * Lớp đang đứng khi bấm vào — đi kèm vào URL hồ sơ để hồ sơ mở ra ĐÚNG lớp đó.
   * `null` ở chế độ danh sách phẳng (một dòng đại diện nhiều lớp, không có lớp nào
   * là "đang đứng"). Thiếu tham số này là hồ sơ trộn mọi lớp vào một dòng thời gian
   * (QA vòng 1, BUG-003).
   */
  classId: string | null;
}

/** URL hồ sơ, mang theo lớp đang đứng nếu có. */
function hoSoHref(r: DongBang): string {
  return r.classId ? `?s=${r.id}&classId=${r.classId}` : `?s=${r.id}`;
}

export function StudentList({ rows }: { rows: StudentRow[] }) {
  const [query, setQuery] = useState("");
  const [cls, setCls] = useState(ALL);
  const [tt, setTt] = useState(DANG_HOC);
  // Chế độ nhóm dựng MỘT BẢNG cho MỖI lớp. Giáo viên dạy nhiều lớp thì đó là 37 bảng
  // và 4.194 phần tử DOM đổ ra trong một lần render, không phân trang, không ảo hoá
  // (QA vòng 1, RISK-001). Mở dần theo khối: người ta gần như luôn tìm MỘT lớp, và
  // ô lọc lớp ngay trên đầu đã đưa họ tới đó nhanh hơn cuộn.
  const [soKhoi, setSoKhoi] = useState(SO_KHOI_DAU);
  const [view, setView] = useState(NHOM);

  const classOptions = useMemo<SelectFilter["options"]>(() => {
    const names = [
      ...new Set(rows.flatMap((r) => r.classes.map((c) => c.name))),
    ].sort((a, b) => a.localeCompare(b, "vi"));
    return [
      { value: ALL, label: "Tất cả lớp" },
      ...names.map((n) => ({ value: n, label: n })),
    ];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (cls !== ALL && !r.classes.some((c) => c.name === cls)) return false;
        // Lọc trạng thái ở TẦNG NÀY nữa, không chỉ trong `groups` bên dưới: `groups`
        // dựng TỪ `filtered`, nên lọc một tầng thôi thì dòng đếm đầu trang vẫn cộng
        // em đó trong khi không khối nào có dòng — đẻ ra đúng loại lệch mà vé này
        // đang tố. Xét theo `c.status` của TỪNG lớp chứ KHÔNG dùng `r.status`: cái
        // đó là trạng thái gộp đã "ưu tiên active", nên em nghỉ lớp A mà còn học lớp
        // B sẽ lọt qua và hiện ở khối lớp A.
        if (tt !== ALL) {
          const scoped = r.classes.some(
            (c) =>
              (cls === ALL || c.name === cls) &&
              inRosterScope({ status: c.status }, "dang-hoc"),
          );
          if (!scoped) return false;
        }
        if (!q) return true;
        return (
          r.name.toLowerCase().includes(q) ||
          (r.studentCode?.toLowerCase().includes(q) ?? false)
        );
      })
      // Sắp theo tên ở ĐÂY chứ không tin thứ tự server: truy vấn sắp theo tên TRONG
      // TỪNG LỚP, gộp nhiều lớp lại thì thứ tự tổng thành "lớp nào gặp trước".
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [rows, query, cls, tt]);

  const flatRows = useMemo<DongBang[]>(
    () =>
      filtered.map((r) => ({
        id: r.id,
        name: r.name,
        studentCode: r.studentCode,
        classesLabel: r.classes.map((c) => c.name).join(" · "),
        status: r.status,
        // Danh sách phẳng: một dòng đại diện nhiều lớp nên không có lớp "đang đứng".
        classId: null,
      })),
    [filtered],
  );

  // Nhóm theo lớp. QUY ƯỚC: HV học 2 lớp của cùng GV thì XUẤT HIỆN Ở CẢ HAI khối —
  // đúng trực giác "danh sách lớp" (mở khối lớp A phải thấy đủ sĩ số lớp A). Hệ quả:
  // tổng các khối > số HV riêng biệt, nên dòng đếm phía trên nói rõ cả hai con số.
  // Khoá nhóm là Class.id, KHÔNG phải tên lớp: `Class.name` không unique trong schema
  // (chỉ `classCode` unique). Gộp theo tên thì hai lớp trùng tên biến thành MỘT khối
  // với sĩ số cộng dồn — và `key` của <section> cũng trùng nhau (React cảnh báo, dựng
  // lại DOM sai chỗ khi lọc).
  const groups = useMemo(() => {
    const byClass = new Map<string, { name: string; rows: DongBang[] }>();
    for (const r of filtered) {
      for (const c of r.classes) {
        // Đã lọc về đúng một lớp → chỉ dựng khối đó. Không thì HV học thêm lớp khác
        // sẽ kéo theo một khối lạ mà người dùng vừa lọc bỏ.
        if (cls !== ALL && c.name !== cls) continue;
        // Tầng thứ hai của bộ lọc trạng thái — xem chú thích ở `filtered`.
        if (tt !== ALL && !inRosterScope({ status: c.status }, "dang-hoc")) continue;
        const g = byClass.get(c.id) ?? { name: c.name, rows: [] };
        g.rows.push({
          id: r.id,
          name: r.name,
          studentCode: r.studentCode,
          classesLabel: null,
          status: c.status, // trạng thái trong CHÍNH lớp này
          classId: c.id,
        });
        byClass.set(c.id, g);
      }
    }
    return [...byClass.entries()]
      .map(([id, g]) => ({ id, name: g.name, rows: g.rows }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [filtered, cls, tt]);

  const soLuotGhiDanh = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm theo tên hoặc mã học viên..."
        filters={[
          { value: cls, onChange: setCls, options: classOptions },
          { value: tt, onChange: setTt, options: STATUS_OPTIONS },
          // Chế độ xem đi chung thanh công cụ (không phải "bộ lọc" đúng nghĩa) để
          // khỏi đẻ thêm một hàng điều khiển nữa — ở 375px mỗi hàng là một màn cuộn.
          { value: view, onChange: setView, options: VIEW_OPTIONS },
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="Không tìm thấy học viên"
          description="Thử đổi từ khoá tìm kiếm hoặc bộ lọc lớp."
        />
      ) : view === NHOM ? (
        <div className="space-y-6">
          {/* Nói thẳng hai con số khi chúng lệch nhau — nếu không, người dùng cộng
              sĩ số các khối rồi tưởng hệ thống đếm sai. */}
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {filtered.length}
            </span>{" "}
            học viên
            {soLuotGhiDanh > filtered.length
              ? ` · ${soLuotGhiDanh} lượt ghi danh`
              : ""}
          </p>
          {groups.slice(0, soKhoi).map((g) => (
            <section key={g.id} className="space-y-2">
              <h2 className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-semibold text-foreground">
                {g.name}
                <span className="text-xs font-medium text-muted-foreground">
                  {g.rows.length} học viên
                </span>
              </h2>
              <StudentTable rows={g.rows} showClass={false} />
            </section>
          ))}
          {groups.length > soKhoi && (
            <button
              type="button"
              onClick={() => setSoKhoi((n) => n + SO_KHOI_DAU)}
              className="w-full rounded-lg border border-dashed border-border py-3 text-sm font-semibold text-muted-foreground outline-none hover:border-primary hover:text-primary-ink focus-visible:ring-2 focus-visible:ring-ring"
            >
              Xem thêm {Math.min(SO_KHOI_DAU, groups.length - soKhoi)} lớp nữa
              {" · "}còn {groups.length - soKhoi}
            </button>
          )}
        </div>
      ) : (
        <StudentTable rows={flatRows} showClass phanTrang />
      )}
    </>
  );
}

/**
 * Bảng học viên.
 *
 * PHÂN TRANG CHỈ Ở CHẾ ĐỘ PHẲNG. `PhanTrangBang` bọc ĐÚNG MỘT `<table>` một `<tbody>`;
 * chế độ nhóm có N bảng nên sẽ thành N thanh phân trang chồng nhau — vừa ồn vừa vô
 * ích, vì một khối = một roster lớp (thực tế 10–25 em, dưới cả mức nhỏ nhất 10 mà
 * `PhanTrangBang` mới chịu hiện thanh). Ai cần trang gọn thì chuyển "Danh sách phẳng".
 */
function StudentTable({
  rows,
  showClass,
  phanTrang = false,
}: {
  rows: DongBang[];
  showClass: boolean;
  phanTrang?: boolean;
}) {
  const table = (
    <table
      className={cn(
        "w-full border-collapse text-left text-sm",
        showClass ? "min-w-[640px]" : "min-w-[520px]",
      )}
    >
      <thead>
        <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <th scope="col" className="px-4 py-3">
            Học viên
          </th>
          <th scope="col" className="px-4 py-3">
            Mã HV
          </th>
          {showClass && (
            <th scope="col" className="px-4 py-3">
              Lớp
            </th>
          )}
          <th scope="col" className="px-4 py-3">
            Trạng thái
          </th>
          <th scope="col" className="px-4 py-3 text-right">
            Thao tác
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
          >
            <td className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-ink">
                  {initialsOf(r.name)}
                </span>
                {/* Link THẬT trên tên (không phải onClick trên <tr>): giữ Tab/Enter,
                    chuột giữa mở tab mới, và trình đọc màn hình đọc ra "liên kết". */}
                <Link
                  href={hoSoHref(r)}
                  className="rounded-sm font-medium text-foreground outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {r.name}
                </Link>
              </div>
            </td>
            <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
              {r.studentCode ?? "—"}
            </td>
            {showClass && (
              <td className="px-4 py-3 text-foreground">{r.classesLabel}</td>
            )}
            <td className="px-4 py-3 whitespace-nowrap">
              <Badge variant="outline">
                {ENROLLMENT_STATUS.label(r.status)}
              </Badge>
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              {/* aria-label kèm tên: không có nó thì màn hình đọc ra 30 liên kết
                  "Xem hồ sơ" giống hệt nhau, không phân biệt được của ai. */}
              <Link
                href={hoSoHref(r)}
                aria-label={`Xem hồ sơ ${r.name}`}
                className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary-ink outline-none transition-colors hover:bg-primary-soft-hover focus-visible:ring-2 focus-visible:ring-ring"
              >
                Xem hồ sơ
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="t-card overflow-hidden">
      {/* 375px: BẢNG cuộn ngang TRONG khung của nó, TRANG thì không.
          (Ghi chú cũ ở đây nói về cạm bẫy `min-w-0` của ô lưới — hết hiệu lực từ khi
          bỏ lưới thẻ. Cạm bẫy tương đương của bảng là quên lớp `overflow-x-auto` này:
          `min-w-[520px]`/`[640px]` rộng hơn khung 343px, thiếu nó là cả trang trôi ngang.) */}
      <div className="overflow-x-auto">
        {phanTrang ? (
          <PhanTrangBang tenDonVi="học viên"
          khoaGhiNho="gv-hoc-vien">{table}</PhanTrangBang>
        ) : (
          table
        )}
      </div>
    </div>
  );
}
