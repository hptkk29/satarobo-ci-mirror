"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { trangThaiSucChua } from "@/lib/hoc-bu/hien-thi-thuan";
import type { GvTrongCa } from "@/lib/hoc-bu/case-db";
import { layGvChoCaseAction, nangCapCaseAction, suaCaseAction, type XungDotNhom } from "../../_actions";
import { XungDotView } from "../../_components/hop-xep-case";

// Sửa case CHƯA điểm danh (ngày · giờ · giáo viên · phòng · ghi chú) + nâng cấp case đời cũ. Hai khối này nằm chung một tệp vì cùng một hộp công cụ ở đầu trang.
// Đổi bộ bài của case sửa được ở dịch vụ (`suaCase`) nhưng KHÔNG đưa lên giao diện: đổi bài khi đã có bé xếp là đổi cả việc các bé phải học — làm bằng huỷ rồi xếp lại.

const FIELD = "h-10";

export function NutNangCap({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-4">
      <p className="text-sm text-foreground">Case này tạo theo cách cũ (một bài, chưa có điểm danh từng bài). Nâng cấp để dùng điểm danh hai tầng và nhận xét từng bài.</p>
      <Button
        className="mt-3 min-h-11"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const kq = await nangCapCaseAction(caseId);
            if (!kq.ok) {
              toast.error(kq.error);
              return;
            }
            toast.success("Đã nâng cấp case");
            router.refresh();
          })
        }
      >
        {pending ? "Đang nâng cấp…" : "Nâng cấp case này"}
      </Button>
    </div>
  );
}

export type DuLieuSuaCase = {
  caseId: string;
  phienBan: number;
  ymd: string;
  startTime: string;
  endTime: string;
  teacherId: string;
  giaoVien: string;
  roomId: string | null;
  note: string | null;
  soBe: number;
  /** Mã dòng cần bù của một mục bất kỳ trong case — để hỏi "giáo viên nào có ca" (cơ sở suy từ dòng này, không nhận từ trình duyệt). */
  needIdMau: string | null;
  phong: { id: string; name: string; sucChua: number }[];
};

type KetQuaGv = { ds: GvTrongCa[]; lyDoRong: string | null } | { loi: string };

export function NutSuaCase({ d }: { d: DuLieuSuaCase }) {
  const [mo, setMo] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className="min-h-11" onClick={() => setMo(true)}>
        <Pencil className="mr-1.5 size-3.5" aria-hidden /> Sửa case
      </Button>
      {mo && <HopSuaCase d={d} onDong={() => setMo(false)} />}
    </>
  );
}

function HopSuaCase({ d, onDong }: { d: DuLieuSuaCase; onDong: () => void }) {
  const router = useRouter();
  const [ymd, setYmd] = useState(d.ymd);
  const [batDau, setBatDau] = useState(d.startTime);
  const [ketThuc, setKetThuc] = useState(d.endTime);
  const [teacherId, setTeacherId] = useState(d.teacherId);
  const [roomId, setRoomId] = useState(d.roomId ?? "");
  const [note, setNote] = useState(d.note ?? "");
  const [gv, setGv] = useState<KetQuaGv>({ ds: [], lyDoRong: null });
  const [daTaiGv, setDaTaiGv] = useState(false);
  const [xungDot, setXungDot] = useState<XungDotNhom[]>([]);
  const [loi, setLoi] = useState<string | null>(null);
  const [dangTaiGv, taiGv] = useTransition();
  const [pending, start] = useTransition();
  const luot = useRef(0);

  function timGv(moi: { ymd: string; batDau: string; ketThuc: string }) {
    if (!d.needIdMau || !moi.ymd || !moi.batDau || !moi.ketThuc) return;
    const cua = (luot.current += 1);
    taiGv(async () => {
      try {
        const r = await layGvChoCaseAction({ needIds: [d.needIdMau!], ymd: moi.ymd, startTime: moi.batDau, endTime: moi.ketThuc });
        if (cua !== luot.current) return;
        setGv(r.ok ? { ds: r.ds, lyDoRong: r.lyDoRong } : { loi: r.error });
      } catch {
        if (cua !== luot.current) return;
        setGv({ loi: "Không tải được danh sách giáo viên — đổi ngày/giờ để thử lại." });
      } finally {
        setDaTaiGv(true);
      }
    });
  }

  function doiKhung(p: { ymd?: string; batDau?: string; ketThuc?: string }) {
    const moi = { ymd: p.ymd ?? ymd, batDau: p.batDau ?? batDau, ketThuc: p.ketThuc ?? ketThuc };
    if (p.ymd !== undefined) setYmd(p.ymd);
    if (p.batDau !== undefined) setBatDau(p.batDau);
    if (p.ketThuc !== undefined) setKetThuc(p.ketThuc);
    timGv(moi);
  }

  const dsGv = "ds" in gv ? gv.ds : [];
  // Giáo viên hiện tại luôn có trong lựa chọn (kể cả khi chưa tải danh sách / họ không có ca đúng khung mới) để người sửa thấy mình đang giữ ai.
  const giuNguyenGv = !dsGv.some((g) => g.id === d.teacherId);
  const sucChua = trangThaiSucChua(d.soBe, d.phong.find((r) => r.id === roomId)?.sucChua ?? null);

  function luu() {
    setLoi(null);
    setXungDot([]);
    start(async () => {
      const kq = await suaCaseAction({
        caseId: d.caseId,
        phienBan: d.phienBan,
        ymd: ymd !== d.ymd ? ymd : undefined,
        startTime: batDau !== d.startTime ? batDau : undefined,
        endTime: ketThuc !== d.endTime ? ketThuc : undefined,
        teacherId: teacherId !== d.teacherId ? teacherId : undefined,
        roomId: (roomId || null) !== d.roomId ? (roomId || null) : undefined,
        note: (note.trim() || null) !== d.note ? (note.trim() || null) : undefined,
      });
      if (!kq.ok) {
        setLoi(kq.error);
        setXungDot(kq.xungDot ?? []);
        toast.error(kq.error);
        return;
      }
      toast.success("Đã sửa case");
      onDong();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(m) => !m && onDong()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Sửa case dạy bù</DialogTitle>
          <DialogDescription>Chỉ sửa được khi chưa bé nào được điểm danh. Đổi ngày/giờ/giáo viên/phòng sẽ kiểm lại lịch trùng.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sc-ngay">Ngày</Label>
              <Input id="sc-ngay" type="date" className={FIELD} value={ymd} onChange={(e) => doiKhung({ ymd: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-bd">Bắt đầu</Label>
              <Input id="sc-bd" type="time" className={FIELD} value={batDau} onChange={(e) => doiKhung({ batDau: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-kt">Kết thúc</Label>
              <Input id="sc-kt" type="time" className={FIELD} value={ketThuc} onChange={(e) => doiKhung({ ketThuc: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sc-gv">Giáo viên</Label>
              <select
                id="sc-gv"
                className={cn(FIELD, "w-full rounded-md border border-input bg-background px-3 text-sm")}
                value={teacherId}
                disabled={dangTaiGv}
                onChange={(e) => setTeacherId(e.target.value)}
              >
                {giuNguyenGv && <option value={d.teacherId}>{d.giaoVien} (hiện tại)</option>}
                {dsGv.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} · ca {g.ma}
                  </option>
                ))}
              </select>
              {daTaiGv && "loi" in gv && <p className="text-xs text-[color:var(--state-warning)]">{gv.loi}</p>}
              {daTaiGv && "ds" in gv && gv.lyDoRong && <p className="text-xs text-[color:var(--state-warning)]">{gv.lyDoRong}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-phong">Phòng</Label>
              <select
                id="sc-phong"
                className={cn(FIELD, "w-full rounded-md border border-input bg-background px-3 text-sm")}
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
              >
                <option value="">— Chưa xếp phòng —</option>
                {d.phong.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · chứa {r.sucChua}
                  </option>
                ))}
              </select>
              <p className={cn("text-xs", sucChua.muc === "VUOT" ? "font-medium text-[color:var(--state-danger)]" : "text-muted-foreground")} data-suc-chua={sucChua.muc}>
                {sucChua.nhan}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sc-note">Ghi chú</Label>
            <Textarea id="sc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {xungDot.length > 0 ? (
            <XungDotView nhom={xungDot} />
          ) : (
            loi && (
              <p role="alert" className="rounded-lg bg-[color:var(--state-danger-soft)] px-3 py-2 text-sm text-[color:var(--state-danger)]">
                {loi}
              </p>
            )
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onDong} disabled={pending}>
              Đóng
            </Button>
            <Button onClick={luu} disabled={pending}>
              {pending ? "Đang lưu…" : "Lưu thay đổi"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
