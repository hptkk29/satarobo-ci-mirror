"use client";

// Hộp THÊM HÀNG LOẠT vào khung ca của một khối.
//
// Vì sao có: bản cũ chỉ thêm được từng người qua một `<select>`, mỗi lần một vòng server.
// Dựng khung ca cho một cơ sở 20 người là 20 lượt bấm, và không có gì ngăn bấm trùng.
//
// Ba điều dễ vỡ:
//  · Lọc là để THU HẸP danh sách, KHÔNG phải để chọn hộ. Đổi bộ lọc không được đụng vào
//    tập đã tick — người dùng lọc "Đào tạo" tick 5 người, đổi sang "Kinh doanh" tick tiếp
//    3 người, bấm Thêm thì phải vào cả 8. Vì thế `chon` sống độc lập với `loc`.
//  · "Chọn tất cả" chỉ áp lên danh sách ĐANG LỌC, và nhãn phải nói ra con số đó — nút
//    "chọn tất cả" mà âm thầm chọn cả người không nhìn thấy là bẫy.
//  · Người đã ở trong khối KHÔNG xuất hiện ở đây (page đã lọc). Người từng bị gỡ thì CÓ —
//    và action mở lại cụm cũ của họ thay vì dựng mới, nên lịch tuần cũ sống lại. Chú
//    thích dưới danh sách nói điều đó, vì nó ngược trực giác.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BTN_OUTLINE,
  BTN_PRIMARY,
  CHIP,
  CHIP_IDLE,
  FIELD,
} from "@/components/admin/cham-cong/classes";
import { addPeopleToBlockAction } from "../_actions";

/** Một người có thể thêm — page dựng, đã loại người đang ở trong khối. */
export type Candidate = {
  userId: string;
  name: string;
  employeeCode: string;
  /** Enum `Department` — nhãn hiển thị do page truyền xuống, đây chỉ là khoá lọc. */
  department: string | null;
  departmentLabel: string;
  /** Chức danh tự do (`Employee.jobTitle`) — "vai" theo cách người vận hành gọi. */
  jobTitle: string | null;
  /** Cơ sở TRỰC THUỘC của nhân sự — KHÁC khối đang xếp ca, và đó là chuyện bình thường. */
  centerLabel: string;
};

const TAT_CA = "__all__";

export function BulkAddDialog({
  centerId,
  blockLabel,
  candidates,
  disabled,
}: {
  centerId: string;
  blockLabel: string;
  candidates: Candidate[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [chon, setChon] = useState<Set<string>>(new Set());
  const [tim, setTim] = useState("");
  const [boPhan, setBoPhan] = useState(TAT_CA);
  const [vai, setVai] = useState(TAT_CA);
  const [coSo, setCoSo] = useState(TAT_CA);

  const dsBoPhan = useMemo(
    () =>
      [
        ...new Map(
          candidates.map((c) => [c.department ?? "", c.departmentLabel]),
        ).entries(),
      ]
        .filter(([k]) => k !== "")
        .sort((a, b) => a[1].localeCompare(b[1], "vi")),
    [candidates],
  );
  const dsVai = useMemo(
    () =>
      [
        ...new Set(
          candidates.map((c) => c.jobTitle).filter((v): v is string => !!v),
        ),
      ].sort((a, b) => a.localeCompare(b, "vi")),
    [candidates],
  );
  const dsCoSo = useMemo(
    () =>
      [...new Set(candidates.map((c) => c.centerLabel))].sort((a, b) =>
        a.localeCompare(b, "vi"),
      ),
    [candidates],
  );

  const hienThi = useMemo(() => {
    const q = tim.trim().toLowerCase();
    return candidates.filter((c) => {
      if (boPhan !== TAT_CA && (c.department ?? "") !== boPhan) return false;
      if (vai !== TAT_CA && (c.jobTitle ?? "") !== vai) return false;
      if (coSo !== TAT_CA && c.centerLabel !== coSo) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.employeeCode.toLowerCase().includes(q) ||
        (c.jobTitle ?? "").toLowerCase().includes(q)
      );
    });
  }, [candidates, tim, boPhan, vai, coSo]);

  const chuaTick = hienThi.filter((c) => !chon.has(c.userId));

  function bat(userId: string) {
    setChon((s) => {
      const n = new Set(s);
      if (n.has(userId)) n.delete(userId);
      else n.add(userId);
      return n;
    });
  }

  function dongLai() {
    setOpen(false);
    setChon(new Set());
    setTim("");
    setBoPhan(TAT_CA);
    setVai(TAT_CA);
    setCoSo(TAT_CA);
  }

  function them() {
    if (chon.size === 0) return;
    start(async () => {
      const r = await addPeopleToBlockAction({ centerId, userIds: [...chon] });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const { themMoi, hoiSinh, boQua } = r.data;
      // Nói rõ chuyện gì đã xảy ra với TỪNG nhóm. Một thao tác hàng loạt chỉ báo
      // "Đã thêm N người" là thao tác không kiểm lại được.
      const cau = [
        themMoi.length > 0 ? `thêm mới ${themMoi.length}` : null,
        hoiSinh.length > 0 ? `mở lại ${hoiSinh.length} người từng bị gỡ` : null,
        boQua.length > 0 ? `bỏ qua ${boQua.length} người đã có sẵn` : null,
      ].filter(Boolean);

      // ⚠️ HỒI SINH PHẢN TRỰC GIÁC — nói THẲNG, đừng nhét vào ngoặc.
      //
      // Người quản lý thường gỡ ai đó ra CHÍNH VÌ lịch của họ đổi, rồi thêm lại và tưởng
      // mình bắt đầu từ trắng. Thực tế lịch tuần cũ quay lại NGUYÊN XI — đúng theo mô
      // hình gỡ mềm, nhưng ngược với thứ họ đang nghĩ, và đây là chỗ duy nhất họ đọc.
      //
      // Bản trước viết "mở lại 1 người từng bị gỡ (giữ nguyên lịch tuần cũ)" — nhét cảnh
      // báo vào trong ngoặc giữa một câu ghép là GIẤU nó. Tách xuống dòng mô tả riêng và
      // kéo dài thời gian hiện.
      toast.success(
        `${blockLabel}: ${cau.join(" · ")}`,
        hoiSinh.length > 0
          ? {
              description: `${hoiSinh.length} người từng bị gỡ quay lại với ĐÚNG lịch tuần cũ của họ, không phải lịch trắng. Cần lịch khác thì sửa từng ô trên bảng.`,
              duration: 10_000,
            }
          : undefined,
      );
      dongLai();
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className={BTN_OUTLINE}
        disabled={disabled || candidates.length === 0}
        onClick={() => setOpen(true)}
        title={
          candidates.length === 0
            ? "Mọi nhân sự đang hoạt động đều đã có trong khối này"
            : `Chọn nhiều người một lượt để thêm vào khung ca ${blockLabel}`
        }
      >
        <UserPlus aria-hidden className="h-4 w-4" />
        Thêm nhân sự
      </button>

      <Dialog
        open={open}
        onOpenChange={(o) => !pending && (o ? setOpen(true) : dongLai())}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Thêm nhân sự vào {blockLabel}</DialogTitle>
            <DialogDescription>
              Người được thêm xuất hiện với Thứ Hai ={" "}
              <span className="font-mono">X</span> (nghỉ); chọn mã ca cho từng
              thứ ở bảng. Người đã có trong khối không hiện ở đây.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="sr-only" htmlFor="bulk-tim">
              Tìm theo tên, mã nhân sự hoặc chức danh
            </label>
            <input
              id="bulk-tim"
              className={FIELD}
              placeholder="Tìm tên / mã NV / chức danh…"
              value={tim}
              onChange={(e) => setTim(e.target.value)}
            />
            <div className="grid grid-cols-3 gap-2">
              <select
                className={FIELD}
                value={boPhan}
                onChange={(e) => setBoPhan(e.target.value)}
                aria-label="Lọc theo bộ phận"
              >
                <option value={TAT_CA}>Mọi bộ phận</option>
                {dsBoPhan.map(([k, nhan]) => (
                  <option key={k} value={k}>
                    {nhan}
                  </option>
                ))}
              </select>
              <select
                className={FIELD}
                value={vai}
                onChange={(e) => setVai(e.target.value)}
                aria-label="Lọc theo chức danh"
              >
                <option value={TAT_CA}>Mọi chức danh</option>
                {dsVai.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                className={FIELD}
                value={coSo}
                onChange={(e) => setCoSo(e.target.value)}
                aria-label="Lọc theo cơ sở trực thuộc"
              >
                <option value={TAT_CA}>Mọi cơ sở</option>
                {dsCoSo.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {hienThi.length} người khớp bộ lọc · đã chọn <b>{chon.size}</b>
            </span>
            <button
              type="button"
              className={cn(CHIP, CHIP_IDLE)}
              disabled={chuaTick.length === 0}
              onClick={() =>
                setChon(
                  (s) => new Set([...s, ...chuaTick.map((c) => c.userId)]),
                )
              }
            >
              Chọn {chuaTick.length} người đang lọc
            </button>
            <button
              type="button"
              className={cn(CHIP, CHIP_IDLE)}
              disabled={chon.size === 0}
              onClick={() => setChon(new Set())}
            >
              Bỏ chọn hết
            </button>
          </div>

          <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-border">
            {hienThi.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                Không ai khớp bộ lọc. Người đã có trong khối không hiện ở đây.
              </p>
            ) : (
              <ul>
                {hienThi.map((c) => {
                  const tick = chon.has(c.userId);
                  return (
                    <li
                      key={c.userId}
                      className="border-b border-border last:border-0"
                    >
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted",
                          tick && "bg-primary-soft",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={tick}
                          onChange={() => bat(c.userId)}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {c.name}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {c.employeeCode}
                            {c.jobTitle && ` · ${c.jobTitle}`}
                          </span>
                        </span>
                        <span className={cn(CHIP, CHIP_IDLE, "shrink-0")}>
                          {c.departmentLabel}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {c.centerLabel}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Chọn lại người <b>từng bị gỡ</b> khỏi khối thì họ quay lại với{" "}
            <b>đúng lịch tuần cũ</b>, không phải lịch trắng — hệ thống mở lại
            dòng cũ chứ không dựng mới. Cần lịch khác thì sửa từng ô sau khi
            thêm.
          </p>

          <DialogFooter>
            <button
              type="button"
              className={BTN_OUTLINE}
              onClick={dongLai}
              disabled={pending}
            >
              Huỷ
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={them}
              disabled={pending || chon.size === 0}
            >
              {pending ? "Đang thêm…" : `Thêm ${chon.size} người`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
