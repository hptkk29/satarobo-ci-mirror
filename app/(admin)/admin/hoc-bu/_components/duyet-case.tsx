"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LY_DO_TOI_THIEU } from "@/lib/hoc-bu/huy";
import { duyetCaseAction, layLuaChonDuyetAction, layTrucTrungAction, tuChoiCaseAction, type LuaChonDuyet, type XungDotNhom } from "../_actions";
import { HoiTruc, quyetTrucGui, type QuyetTrucChon, type TrucTrung } from "./hoi-truc";
import { XungDotView } from "./hop-xep-case";

// Duyệt / từ chối case CHỜ DUYỆT (20/10/2026) — dùng ở màn "Duyệt case" và ở màn chi tiết case. Chỉ người có `makeup:waive` thấy hai nút (trang quyết, Server Action gác lại).
// Duyệt có thể ĐỔI giáo viên / phòng ngay trong hộp: danh sách giáo viên là những người CÓ CA phủ khung giờ của case (cùng nguồn với ô chọn lúc tạo), không nhập tay.

const FIELD = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export function NutDuyetCase({ caseId, phienBan, size = "sm" }: { caseId: string; phienBan: number; size?: "sm" | "default" }) {
  const [d, setD] = useState<LuaChonDuyet | null>(null);
  const [dangTai, taiLua] = useTransition();
  return (
    <>
      <Button
        size={size}
        className="min-h-11"
        disabled={dangTai}
        onClick={() =>
          taiLua(async () => {
            const r = await layLuaChonDuyetAction(caseId);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            setD(r);
          })
        }
      >
        {dangTai ? "Đang mở…" : "Duyệt"}
      </Button>
      {d && <HopDuyet caseId={caseId} phienBan={phienBan} d={d} onDong={() => setD(null)} />}
    </>
  );
}

function HopDuyet({ caseId, phienBan, d, onDong }: { caseId: string; phienBan: number; d: LuaChonDuyet; onDong: () => void }) {
  const router = useRouter();
  const [teacherId, setTeacherId] = useState(d.teacherId);
  const [roomId, setRoomId] = useState(d.roomId ?? "");
  const [loi, setLoi] = useState<string | null>(null);
  const [xungDot, setXungDot] = useState<XungDotNhom[]>([]);
  const [pending, start] = useTransition();
  // PR6: duyệt xong case thành lịch thật — nếu giáo viên đang có ca TRỰC chứa buổi bù thì hỏi luôn "còn trực phần còn lại không".
  const [truc, setTruc] = useState<{ truc: TrucTrung | null; coTheQuyet: boolean }>({ truc: d.truc, coTheQuyet: d.coTheQuyetTruc });
  const [quyetTruc, setQuyetTruc] = useState<QuyetTrucChon>(null);
  const [, taiTruc] = useTransition();
  function kiemTruc(id: string) {
    setQuyetTruc(null);
    setTruc({ truc: null, coTheQuyet: false });
    if (!id) return;
    taiTruc(async () => {
      const r = await layTrucTrungAction({ caseId, teacherId: id, ymd: d.ymd, startTime: d.startTime, endTime: d.endTime });
      if (r.ok) setTruc({ truc: r.truc, coTheQuyet: r.coTheQuyet });
    });
  }
  // Giáo viên hiện tại luôn có trong lựa chọn (kể cả khi lưới ca đã đổi và họ không còn phủ khung giờ) để người duyệt thấy mình đang giữ ai — và máy chủ sẽ báo nếu họ không còn ca.
  const giuNguyenGv = !d.gv.some((g) => g.id === d.teacherId);

  function duyet() {
    setLoi(null);
    setXungDot([]);
    start(async () => {
      const kq = await duyetCaseAction({
        caseId,
        phienBan,
        teacherId: teacherId !== d.teacherId ? teacherId : undefined,
        roomId: (roomId || null) !== d.roomId ? (roomId || null) : undefined,
        quyetTruc: quyetTrucGui(quyetTruc),
      });
      if (!kq.ok) {
        setLoi(kq.error);
        setXungDot(kq.xungDot ?? []);
        toast.error(kq.error);
        return;
      }
      toast.success("Đã duyệt — giáo viên và phụ huynh được báo");
      if (kq.canhBaoTruc) toast.warning(kq.canhBaoTruc, { duration: 12000 });
      onDong();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(m) => !m && onDong()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Duyệt case dạy bù</DialogTitle>
          <DialogDescription>Duyệt xong case thành lịch thật: giáo viên và phụ huynh các bé được báo. Cần đổi người dạy hoặc phòng thì đổi ngay tại đây.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dc-gv">Giáo viên</Label>
            <select
              id="dc-gv"
              className={FIELD}
              value={teacherId}
              onChange={(e) => {
                setTeacherId(e.target.value);
                kiemTruc(e.target.value);
              }}
            >
              {giuNguyenGv && <option value={d.teacherId}>Giáo viên đang giữ (không còn ca phủ khung giờ)</option>}
              {d.gv.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · ca {g.ma}
                </option>
              ))}
            </select>
            {d.lyDoGvRong && <p className="text-xs text-[color:var(--state-warning)]">{d.lyDoGvRong}</p>}
          </div>
          <HoiTruc truc={truc.truc} coTheQuyet={truc.coTheQuyet} value={quyetTruc} onChange={setQuyetTruc} idPrefix="dc" />
          <div className="space-y-1.5">
            <Label htmlFor="dc-phong">Phòng</Label>
            <select id="dc-phong" className={FIELD} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="" disabled={!!d.roomId}>
                — Chưa xếp phòng —
              </option>
              {d.phong.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.sucChua != null ? ` · chứa ${r.sucChua}` : ""}
                </option>
              ))}
            </select>
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
            <Button onClick={duyet} disabled={pending}>
              {pending ? "Đang duyệt…" : "Duyệt"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NutTuChoiCase({ caseId, size = "sm" }: { caseId: string; size?: "sm" | "default" }) {
  const [mo, setMo] = useState(false);
  return (
    <>
      <Button size={size} variant="outline" className="min-h-11" onClick={() => setMo(true)}>
        Từ chối
      </Button>
      {mo && <HopTuChoi caseId={caseId} onDong={() => setMo(false)} />}
    </>
  );
}

function HopTuChoi({ caseId, onDong }: { caseId: string; onDong: () => void }) {
  const router = useRouter();
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const du = lyDo.trim().length >= LY_DO_TOI_THIEU;

  function tuChoi() {
    setLoi(null);
    start(async () => {
      const kq = await tuChoiCaseAction({ caseId, lyDo: lyDo.trim() });
      if (!kq.ok) {
        setLoi(kq.error);
        toast.error(kq.error);
        return;
      }
      toast.success("Đã từ chối — các bé quay lại danh sách cần bù");
      onDong();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(m) => !m && onDong()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Từ chối case dạy bù</DialogTitle>
          <DialogDescription>Case bị huỷ, các bé quay lại danh sách cần bù và người tạo thấy lý do dưới đây. Phụ huynh và giáo viên không nhận tin (case chưa từng được báo).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tc-lydo">Lý do (ít nhất {LY_DO_TOI_THIEU} ký tự)</Label>
            <Textarea id="tc-lydo" rows={3} value={lyDo} onChange={(e) => setLyDo(e.target.value)} maxLength={500} />
          </div>
          {loi && (
            <p role="alert" className="rounded-lg bg-[color:var(--state-danger-soft)] px-3 py-2 text-sm text-[color:var(--state-danger)]">
              {loi}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onDong} disabled={pending}>
              Đóng
            </Button>
            <Button variant="destructive" className={cn(!du && "opacity-60")} onClick={tuChoi} disabled={pending || !du}>
              {pending ? "Đang từ chối…" : "Từ chối case"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
