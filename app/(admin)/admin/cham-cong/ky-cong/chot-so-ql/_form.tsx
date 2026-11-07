"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { chotKyTheoSoQlAction } from "./_actions";

const MAU = `[
  { "userId": "…", "units": 26, "leaveUnits": 0, "lateCount": 6, "lateMinutes": 58,
    "earlyLeaveCount": 2, "earlyLeaveMinutes": 73, "ghiChu": "QLCS chốt 03/11" }
]`;

export function ChotSoQlForm({ centers }: { centers: { id: string; name: string }[] }) {
  const [centerId, setCenterId] = useState(centers[0]?.id ?? "");
  const [ky, setKy] = useState("");
  const [lyDo, setLyDo] = useState("");
  const [json, setJson] = useState("");
  const [xacNhan, setXacNhan] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function gui() {
    setLoi(null);
    let rows: unknown;
    try {
      rows = JSON.parse(json);
    } catch {
      setLoi("Danh sách số chốt không phải JSON hợp lệ");
      return;
    }
    if (!xacNhan) {
      setXacNhan(true);
      return;
    }
    start(async () => {
      const r = await chotKyTheoSoQlAction({ centerId, ky, lyDo, rows });
      setXacNhan(false);
      if (r.ok) {
        toast.success(r.note);
        setJson("");
      } else {
        setLoi(r.error);
      }
    });
  }

  const input = "w-full rounded-md border bg-background px-3 py-2 text-sm";
  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Cơ sở</span>
          <select className={input} value={centerId} onChange={(e) => { setCenterId(e.target.value); setXacNhan(false); }}>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Kỳ (YYYY-MM)</span>
          <input className={input} value={ky} placeholder="2026-10" onChange={(e) => { setKy(e.target.value.trim()); setXacNhan(false); }} />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Lý do</span>
        <input className={input} value={lyDo} placeholder="VD: Bảng chốt công T10 chủ dự án duyệt 04/11" onChange={(e) => setLyDo(e.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Số chốt từng người (JSON) — phải đủ mọi người có trong bảng công kỳ này, muốn 0 thì ghi 0</span>
        <textarea className={`${input} min-h-64 font-mono text-xs`} value={json} placeholder={MAU} onChange={(e) => { setJson(e.target.value); setXacNhan(false); }} />
      </label>
      {loi && <pre className="whitespace-pre-wrap rounded-md bg-destructive/10 p-3 text-xs text-destructive">{loi}</pre>}
      <button
        type="button"
        disabled={pending || !centerId || !ky || !json.trim() || lyDo.trim().length < 10}
        onClick={gui}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? "Đang chốt…" : xacNhan ? "Bấm lần nữa để chốt — KHÔNG sửa lại được" : "Chốt kỳ theo số này"}
      </button>
    </section>
  );
}
