"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { cn } from "@/lib/utils";
import { tongBaiSauKhiThem, vuotTranNeuChon } from "@/lib/hoc-bu/them-vao-case-thuan";
import { layUngVienThemVaoCaseAction, xepVaoCaseAction, type UngVienCase, type XungDotNhom } from "../../_actions";
import { XungDotView } from "../../_components/hop-xep-case";
import { NHAN_GUI_DUYET, quyetDinhThemVaoCase } from "@/lib/hoc-bu/yeu-cau-them-be-thuan";

// [20/10/2026] THÊM HỌC VIÊN vào case ĐÃ TẠO — chủ dự án: "sau khi tạo case vẫn có thể sửa thêm các buổi khác, hoặc thêm học viên khác cùng lớp vào chung case".
//
// Một thao tác cho cả hai việc: chọn các dòng "buổi vắng đang chờ bù" (của bé khác, hoặc buổi vắng khác của bé đã trong case). Dòng vắng một bài case CHƯA dạy thì bài đó vào bộ bài cùng lúc
// (tối đa 3). Không có đường "thêm bài trần": một bài không bé nào vắng thì dạy không ai.
// [20/10/2026 — chủ dự án: "có thể thêm các học viên khác lớp vào chung 1 case, nhưng phải chung khoá; có thể thêm các case khác buổi nhau vào chung 1 case"] KHÔNG giới hạn theo lớp: ràng buộc
// là CÙNG CƠ SỞ + CÙNG KHOÁ (máy chủ đọc ứng viên theo đúng hai khoá đó của case) và tối đa 3 bài.
// [ĐẢO — chủ dự án, cùng ngày] BỎ HẲN ô "Chỉ cùng lớp": danh sách luôn hiện MỌI dòng cần bù cùng khoá trong phạm vi của người xem (Sale chỉ thấy bé mình phụ trách — phạm vi do máy chủ áp).
// `NutThemBuoi` là cùng hộp này nhưng ở THẺ TỪNG BÉ và chỉ nạp các buổi vắng của đúng bé đó ("thêm nút thêm buổi: chọn thêm các buổi vắng cần bù khác").
//
// Mọi dòng mang sẵn LÝ DO nếu xếp không được (tính ở máy chủ bằng đúng cổng xếp case) — dòng đó bị khoá kèm câu giải thích, không hứa rồi từ chối.

type Ung = Extract<UngVienCase, { ok: true }>;

/** Nút ở đầu trang: thêm học viên (mọi bé cùng khoá) hoặc buổi vắng khác vào case. */
export function NutThemHocVien({ caseId }: { caseId: string }) {
  return <NutMoHop caseId={caseId} nhan="Thêm học viên" Icon={UserPlus} className="min-h-11" />;
}

/** Nút ở thẻ MỘT bé trong case: chọn thêm các buổi vắng cần bù khác của đúng bé đó. */
export function NutThemBuoi({ caseId, studentId, hocVien }: { caseId: string; studentId: string; hocVien: string }) {
  return <NutMoHop caseId={caseId} studentId={studentId} hocVien={hocVien} nhan="Thêm buổi" Icon={CalendarPlus} className="min-h-11 w-full sm:w-auto" />;
}

function NutMoHop({
  caseId,
  studentId,
  hocVien,
  nhan,
  Icon,
  className,
}: {
  caseId: string;
  studentId?: string;
  hocVien?: string;
  nhan: string;
  Icon: typeof UserPlus;
  className: string;
}) {
  const [mo, setMo] = useState<Ung | null>(null);
  const [dangTai, tai] = useTransition();
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className={className}
        disabled={dangTai}
        onClick={() =>
          tai(async () => {
            try {
              const r = await layUngVienThemVaoCaseAction(caseId, studentId);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              setMo(r);
            } catch {
              toast.error("Không tải được danh sách buổi vắng — thử lại sau ít phút.");
            }
          })
        }
      >
        <Icon className="mr-1.5 size-3.5" aria-hidden /> {dangTai ? "Đang tải…" : nhan}
      </Button>
      {mo && <HopThem caseId={caseId} d={mo} chiBe={hocVien ? { ten: hocVien } : undefined} onDong={() => setMo(null)} />}
    </>
  );
}

function HopThem({ caseId, d, chiBe, onDong }: { caseId: string; d: Ung; /** Có ⇒ hộp của MỘT bé (nút Thêm buổi ở thẻ bé): danh sách đã là buổi vắng của riêng bé đó. */ chiBe?: { ten: string }; onDong: () => void }) {
  const router = useRouter();
  const [chon, setChon] = useState<Set<string>>(new Set());
  const [tim, setTim] = useState("");
  const [xungDot, setXungDot] = useState<XungDotNhom[]>([]);
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dsChon = d.ds.filter((r) => chon.has(r.id));
  // Bài MỚI (case chưa dạy) mà các dòng đã chọn sẽ kéo vào bộ bài — phép đếm ở `lib/hoc-bu/them-vao-case-thuan.ts` (có test), không tính tại chỗ.
  const { baiMoi, tong: tongBai } = tongBaiSauKhiThem(d.soBaiCase, dsChon);
  const vuot = tongBai > d.tranBai;
  // Chờ duyệt khi người xem không có quyền duyệt VÀ có dòng của bé chưa trong case — cùng hàm quyết với máy chủ (`soBeMoi` chỉ cần phân biệt 0 / >0 ở đây).
  const choDuyet =
    quyetDinhThemVaoCase({ coQuyenDuyet: d.coQuyenDuyet, soBeMoi: new Set(dsChon.filter((r) => !r.beTrongCase).map((r) => r.hocVien)).size }) === "CHO_DUYET";
  const vuotNeuChon = (r: Ung["ds"][number]) => vuotTranNeuChon({ soBaiCase: d.soBaiCase, tran: d.tranBai, dsChon, r });

  const chuoiTim = tim.trim().toLocaleLowerCase("vi");
  const rows = d.ds.filter((r) => !chuoiTim || `${r.hocVien} ${r.lop}`.toLocaleLowerCase("vi").includes(chuoiTim));
  const soBaiKhac = new Set(d.ds.filter((r) => !r.trongBoBai).map((r) => r.lessonId)).size;

  function doi(id: string) {
    setChon((cu) => {
      const moi = new Set(cu);
      if (moi.has(id)) moi.delete(id);
      else moi.add(id);
      return moi;
    });
  }

  function luu() {
    setLoi(null);
    setXungDot([]);
    start(async () => {
      const kq = await xepVaoCaseAction({ caseId, needIds: [...chon], moRongBai: true });
      if (!kq.ok) {
        setLoi(kq.error);
        setXungDot(kq.xungDot ?? []);
        toast.error(kq.error);
        return;
      }
      toast.success(
        kq.choDuyet
          ? "Đã gửi quản lý cơ sở duyệt — case giữ nguyên, các bé được thêm sau khi được duyệt"
          : chiBe
            ? `Đã thêm ${dsChon.length} buổi cho ${chiBe.ten}`
            : `Đã thêm ${new Set(dsChon.map((r) => r.hocVien)).size} học viên vào case`,
      );
      onDong();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(m) => !m && onDong()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{chiBe ? `Thêm buổi vắng cho ${chiBe.ten}` : "Thêm học viên vào case"}</DialogTitle>
          <DialogDescription>
            {chiBe
              ? `Chọn các buổi vắng cần bù khác của ${chiBe.ten} để học chung case này.`
              : "Danh sách các buổi vắng đang chờ bù cùng khoá + cơ sở với case (kể cả học viên lớp khác)."}{" "}
            Buổi vắng ở bài case chưa dạy sẽ thêm bài đó vào case (tối đa {d.tranBai} bài).
            {!d.coQuyenDuyet && " Thêm học viên khác vào case phải được quản lý cơ sở duyệt; thêm buổi vắng khác của bé đã trong case thì thêm ngay."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!chiBe && <Input value={tim} onChange={(e) => setTim(e.target.value)} placeholder="Tìm tên học viên hoặc lớp" aria-label="Tìm học viên" className="h-11 sm:h-9" />}

          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {d.ds.length === 0
                ? chiBe
                  ? `${chiBe.ten} không còn buổi vắng nào khác đang chờ bù.`
                  : "Không có buổi vắng nào đang chờ bù ở cơ sở + khoá của case này."
                : "Không có dòng nào khớp."}
            </p>
          ) : (
            <ul className="max-h-[45vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {rows.map((r) => {
                const khoa = !r.xepDuoc || vuotNeuChon(r);
                const lyDoKhoa = r.lyDo ?? (vuotNeuChon(r) ? `Case đã đủ ${d.tranBai} bài — bỏ chọn dòng thêm bài khác trước` : null);
                return (
                  <li key={r.id}>
                    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2 text-sm", khoa && "cursor-not-allowed opacity-60")}>
                      <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={chon.has(r.id)} disabled={khoa} onChange={() => doi(r.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{r.hocVien}</span>
                          {r.beTrongCase && <StatusPill tone="success">Đã trong case</StatusPill>}
                          {!r.trongBoBai && <StatusPill tone="info">Thêm bài vào case</StatusPill>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {r.lop} · {r.bai} · {r.cachXep}
                        </span>
                        {lyDoKhoa && <span className="block text-xs text-[color:var(--state-warning)]">{lyDoKhoa}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {d.biCat && <p className="text-xs text-muted-foreground">Danh sách chỉ hiện {d.ds.length} dòng đầu — gõ tên vào ô tìm để thu hẹp.</p>}

          <p className={cn("text-xs", vuot ? "font-medium text-[color:var(--state-danger)]" : "text-muted-foreground")} data-tong-bai={tongBai}>
            Case sẽ dạy {tongBai}/{d.tranBai} bài{baiMoi.length > 0 ? ` (thêm ${baiMoi.length} bài mới)` : soBaiKhac > 0 ? ` — còn ${soBaiKhac} bài khác có người vắng, chọn dòng để thêm` : ""}.
          </p>

          {xungDot.length > 0 ? (
            <XungDotView nhom={xungDot} />
          ) : (
            loi && (
              <p role="alert" className="rounded-lg bg-[color:var(--state-danger-soft)] px-3 py-2 text-sm text-[color:var(--state-danger)]">
                {loi}
              </p>
            )
          )}

          {/* Thanh nút DÍNH ĐÁY hộp ở mobile (cùng mẫu hộp Xếp case): form dài hơn màn hình thì nút Thêm không nằm ngoài tầm nhìn. */}
          <div className="sticky bottom-0 z-[1] -mx-4 -mb-4 flex justify-end gap-2 border-t border-border bg-popover px-4 py-3 sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0">
            <Button variant="ghost" className="h-11 sm:h-8" onClick={onDong} disabled={pending}>
              Đóng
            </Button>
            <Button className="h-11 sm:h-8" onClick={luu} disabled={pending || chon.size === 0 || vuot}>
              {pending ? (choDuyet ? "Đang gửi…" : "Đang thêm…") : chon.size === 0 ? "Thêm vào case" : choDuyet ? `${NHAN_GUI_DUYET} (${chon.size} dòng)` : `Thêm ${chon.size} dòng vào case`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
