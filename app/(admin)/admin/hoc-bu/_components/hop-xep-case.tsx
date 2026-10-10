"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { cn } from "@/lib/utils";
import { formatDateVN } from "@/lib/format/date";
import type { GvTrongCa } from "@/lib/hoc-bu/case-db";
import { trangThaiSucChua } from "@/lib/hoc-bu/hien-thi-thuan";
import {
  layGvChoCaseAction,
  layLuaChonCaseAction,
  taoCaseAction,
  xepVaoCaseAction,
  type LuaChonCase,
  type XungDotNhom,
} from "../_actions";

// Hộp XẾP VÀO CASE — modal có chủ đích: đây là một biểu mẫu nhiều bước cần giữ tiêu điểm, và
// người dùng phải thấy ĐỦ nhóm bé đang xếp trong lúc chọn giờ/giáo viên.
//
// Hai đường, xếp theo thứ tự người dùng nên cân nhắc: case CÓ SẴN cùng buổi trước (gộp bé cho
// đỡ tốn giờ giáo viên), rồi mới tạo case mới.

const FIELD = "h-10";
const BAI_TOI_DA = 3;

const TIEU_DE_XUNG_DOT: Record<XungDotNhom["nhom"], string> = {
  GIAO_VIEN: "Giáo viên bận",
  PHONG: "Phòng đã có lịch",
  HOC_VIEN: "Học viên có lịch khác",
};

/** Xung đột lịch chia theo CHIỀU (giáo viên · phòng · học viên) để người xếp biết đổi cái nào — thay vì một câu dài. */
export function XungDotView({ nhom }: { nhom: XungDotNhom[] }) {
  if (nhom.length === 0) return null;
  return (
    <div role="alert" className="space-y-2 rounded-lg bg-[color:var(--state-danger-soft)] px-3 py-2.5 text-sm text-[color:var(--state-danger)]">
      {nhom.map((g) => (
        <section key={g.nhom} aria-label={TIEU_DE_XUNG_DOT[g.nhom]}>
          <h4 className="font-semibold">{TIEU_DE_XUNG_DOT[g.nhom]}</h4>
          <ul className="list-disc space-y-0.5 pl-5">
            {g.dong.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export const GIO_MAC_DINH = { batDau: "18:00", ketThuc: "19:30" };

export type MoHopXep = {
  needIds: string[];
  luaChon: LuaChonCase;
  gvBanDau: KetQuaGv;
};

type KetQuaGv = { ds: GvTrongCa[]; lyDoRong: string | null } | { loi: string };

/**
 * Tải MỌI THỨ hộp cần — gọi từ HANDLER của nút "Xếp case" (không `useEffect`, luật repo): lựa
 * chọn case + danh sách GV trong ca cho ngày/giờ mặc định. Lỗi mạng ⇒ trả kết quả lỗi, không ném.
 */
export async function taiHopXep(needIds: string[]): Promise<MoHopXep> {
  try {
    const luaChon = await layLuaChonCaseAction(needIds);
    if (!luaChon.ok) return { needIds, luaChon, gvBanDau: { loi: luaChon.error } };
    const gv = await layGvChoCaseAction({
      needIds,
      ymd: luaChon.homNay,
      startTime: GIO_MAC_DINH.batDau,
      endTime: GIO_MAC_DINH.ketThuc,
    });
    return { needIds, luaChon, gvBanDau: gv.ok ? { ds: gv.ds, lyDoRong: gv.lyDoRong } : { loi: gv.error } };
  } catch {
    const loi = "Không tải được lựa chọn case lúc này — thử lại sau ít phút.";
    return { needIds, luaChon: { ok: false, error: loi }, gvBanDau: { loi } };
  }
}

export function HopXepCase({ mo, onDong }: { mo: MoHopXep; onDong: (daXep: boolean) => void }) {
  const router = useRouter();
  const { needIds, luaChon } = mo;
  const [pending, start] = useTransition();
  const [xungDot, setXungDot] = useState<XungDotNhom[]>([]);

  function xepVao(caseId: string) {
    setXungDot([]);
    start(async () => {
      const kq = await xepVaoCaseAction({ caseId, needIds });
      if (!kq.ok) {
        toast.error(kq.error);
        setXungDot(kq.xungDot ?? []);
        return;
      }
      toast.success("Đã xếp vào case dạy bù");
      onDong(true);
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(mo) => !mo && onDong(false)}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Xếp {needIds.length} học viên vào case dạy bù</DialogTitle>
          <DialogDescription>
            {luaChon.ok
              ? `${luaChon.coSo} · ${luaChon.khoa} · ${luaChon.buoi}`
              : "Các bé trong một case phải cùng cơ sở, cùng khoá và cùng buổi bù."}
          </DialogDescription>
        </DialogHeader>

        {!luaChon.ok ? (
          <p className="rounded-lg bg-[color:var(--state-danger-soft)] px-3 py-2.5 text-sm text-[color:var(--state-danger)]">
            {luaChon.error}
          </p>
        ) : (
          <div className="space-y-6">
            <ul className="flex flex-wrap gap-1.5">
              {luaChon.be.map((b) => (
                <li key={b.id}>
                  <StatusPill tone={b.cachXep === "Lượt bù" ? "success" : "info"}>
                    {b.hocVien} · {b.cachXep}
                  </StatusPill>
                </li>
              ))}
            </ul>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Case cùng buổi đã có</h3>
              {luaChon.caseCoSan.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Chưa có case nào cho buổi bù này từ hôm nay trở đi — tạo case mới bên dưới.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {luaChon.caseCoSan.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0 text-sm">
                        <p className="font-medium tabular-nums">
                          {formatDateVN(c.date)} · {c.startTime}–{c.endTime}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.giaoVien}
                          {c.phong ? ` · ${c.phong}` : ""} · {c.soBe} bé
                        </p>
                      </div>
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => xepVao(c.id)}>
                        Xếp vào
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <XungDotView nhom={xungDot} />
            </section>

            <TaoCaseMoi
              needIds={needIds}
              gvBanDau={mo.gvBanDau}
              phong={luaChon.phong}
              baiCuaNhom={luaChon.baiCuaNhom}
              baiCoTheThem={luaChon.baiCoTheThem}
              homNay={luaChon.homNay}
              onXong={(caseId) => {
                onDong(true);
                router.push(`/hoc-bu/case/${caseId}`);
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TaoCaseMoi({
  needIds,
  gvBanDau,
  phong,
  baiCuaNhom,
  baiCoTheThem,
  homNay,
  onXong,
}: {
  needIds: string[];
  gvBanDau: KetQuaGv;
  phong: { id: string; name: string; sucChua: number }[];
  baiCuaNhom: { id: string; ten: string }[];
  baiCoTheThem: { id: string; ten: string }[];
  homNay: string;
  onXong: (caseId: string) => void;
}) {
  const [ymd, setYmd] = useState(homNay);
  const [batDau, setBatDau] = useState(GIO_MAC_DINH.batDau);
  const [ketThuc, setKetThuc] = useState(GIO_MAC_DINH.ketThuc);
  const [roomId, setRoomId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [note, setNote] = useState("");
  const [themBai, setThemBai] = useState<string[]>([]);
  const [xungDot, setXungDot] = useState<XungDotNhom[]>([]);
  const [gv, setGv] = useState<KetQuaGv>(gvBanDau);
  const [dangTaiGv, taiGv] = useTransition();
  const [pending, start] = useTransition();
  // Lượt tải mới nhất — kết quả của lượt cũ về muộn thì bỏ (cùng mẫu ô chọn GV trial).
  const luot = useRef(0);

  // Danh sách GV đổi theo ngày + khung giờ: chỉ người có CA LÀM phủ trọn khung giờ đó.
  function doiKhung(p: { ymd?: string; batDau?: string; ketThuc?: string }) {
    const moi = { ymd: p.ymd ?? ymd, batDau: p.batDau ?? batDau, ketThuc: p.ketThuc ?? ketThuc };
    if (p.ymd !== undefined) setYmd(p.ymd);
    if (p.batDau !== undefined) setBatDau(p.batDau);
    if (p.ketThuc !== undefined) setKetThuc(p.ketThuc);
    setTeacherId("");
    if (!moi.ymd || !moi.batDau || !moi.ketThuc) return;
    const cua = (luot.current += 1);
    taiGv(async () => {
      try {
        const r = await layGvChoCaseAction({ needIds, ymd: moi.ymd, startTime: moi.batDau, endTime: moi.ketThuc });
        if (cua !== luot.current) return;
        setGv(r.ok ? { ds: r.ds, lyDoRong: r.lyDoRong } : { loi: r.error });
      } catch {
        if (cua !== luot.current) return;
        setGv({ loi: "Không tải được danh sách giáo viên — chọn lại ngày/giờ để thử lại." });
      }
    });
  }

  const dsGv = "ds" in gv ? gv.ds : [];
  const loiGv = "loi" in gv ? gv.loi : gv.lyDoRong;

  const conCho = BAI_TOI_DA - baiCuaNhom.length - themBai.length;
  const sucChua = trangThaiSucChua(needIds.length, phong.find((r) => r.id === roomId)?.sucChua ?? null);

  function tao() {
    setXungDot([]);
    start(async () => {
      const kq = await taoCaseAction({
        needIds,
        ymd,
        startTime: batDau,
        endTime: ketThuc,
        roomId: roomId || null,
        teacherId,
        note: note.trim() || null,
        // Chỉ gửi bộ bài khi người xếp THÊM bài; không thêm thì để dịch vụ lấy đúng các bài vắng của nhóm bé.
        lessonIds: themBai.length > 0 ? [...baiCuaNhom.map((b) => b.id), ...themBai] : undefined,
      });
      if (!kq.ok) {
        toast.error(kq.error);
        setXungDot(kq.xungDot ?? []);
        return;
      }
      toast.success("Đã tạo case dạy bù");
      onXong(kq.caseId);
    });
  }

  return (
    <section className="space-y-3 border-t border-border pt-5">
      <h3 className="text-sm font-semibold">Tạo case mới</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="hb-ngay">Ngày dạy bù</Label>
          <Input id="hb-ngay" type="date" min={homNay} className={FIELD} value={ymd} onChange={(e) => doiKhung({ ymd: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hb-bd">Bắt đầu</Label>
          <Input id="hb-bd" type="time" className={FIELD} value={batDau} onChange={(e) => doiKhung({ batDau: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hb-kt">Kết thúc</Label>
          <Input id="hb-kt" type="time" className={FIELD} value={ketThuc} onChange={(e) => doiKhung({ ketThuc: e.target.value })} />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Bài dạy trong case ({baiCuaNhom.length + themBai.length}/{BAI_TOI_DA})</legend>
        <ul className="flex flex-wrap gap-1.5">
          {baiCuaNhom.map((b) => (
            <li key={b.id}>
              <StatusPill tone="info">{b.ten}</StatusPill>
            </li>
          ))}
        </ul>
        {baiCoTheThem.length > 0 && (
          <details className="rounded-lg border border-border">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm text-muted-foreground">
              Dạy thêm bài khác trong cùng buổi {conCho > 0 ? `(còn ${conCho} chỗ)` : "(đã đủ 3 bài)"}
            </summary>
            <ul className="max-h-48 divide-y divide-border overflow-y-auto border-t border-border">
              {baiCoTheThem.map((b) => {
                const chon = themBai.includes(b.id);
                return (
                  <li key={b.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={chon}
                        disabled={!chon && conCho <= 0}
                        onChange={() => setThemBai((cu) => (chon ? cu.filter((x) => x !== b.id) : [...cu, b.id]))}
                      />
                      <span className="min-w-0 truncate">{b.ten}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        <p className="text-xs text-muted-foreground">Mỗi bé chỉ học các bài mình vắng; bài thêm vào để các bé khác cùng buổi dùng chung giáo viên và phòng.</p>
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="hb-phong">Phòng</Label>
          <select
            id="hb-phong"
            className={cn(FIELD, "w-full rounded-md border border-input bg-background px-3 text-sm")}
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          >
            <option value="">— Chưa xếp phòng —</option>
            {phong.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · chứa {r.sucChua}
              </option>
            ))}
          </select>
          <p
            className={cn(
              "text-xs",
              sucChua.muc === "VUOT" ? "font-medium text-[color:var(--state-danger)]" : sucChua.muc === "GAN_DAY" ? "text-[color:var(--state-warning)]" : "text-muted-foreground",
            )}
            data-suc-chua={sucChua.muc}
          >
            {sucChua.nhan}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hb-gv">Giáo viên trong ca</Label>
          <select
            id="hb-gv"
            className={cn(FIELD, "w-full rounded-md border border-input bg-background px-3 text-sm")}
            value={teacherId}
            disabled={dangTaiGv || dsGv.length === 0}
            onChange={(e) => setTeacherId(e.target.value)}
          >
            <option value="">{dangTaiGv ? "Đang tìm giáo viên…" : dsGv.length ? "— Chọn giáo viên —" : "Không có ai trong ca"}</option>
            {dsGv.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · ca {g.ma}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!dangTaiGv && loiGv && <p className="text-xs text-[color:var(--state-warning)]">{loiGv}</p>}
      <XungDotView nhom={xungDot} />
      <div className="space-y-1.5">
        <Label htmlFor="hb-note">Ghi chú (tuỳ chọn)</Label>
        <Textarea id="hb-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button onClick={tao} disabled={pending || !teacherId}>
          {pending ? "Đang tạo…" : `Tạo case và xếp ${needIds.length} bé`}
        </Button>
      </div>
    </section>
  );
}
