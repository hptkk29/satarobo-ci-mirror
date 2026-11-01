import type { RoomStatus } from "@prisma/client";

const LABELS: Record<RoomStatus, string> = {
  ACTIVE: "Hoạt động",
  MAINTENANCE: "Bảo trì",
  INACTIVE: "Tạm ngừng",
};

const COLORS: Record<RoomStatus, string> = {
  ACTIVE: "bg-state-success-soft text-state-success-ink",
  MAINTENANCE: "bg-state-warning-soft text-state-warning-ink",
  INACTIVE: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: RoomStatus }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[status]}`}>
      {LABELS[status]}
    </span>
  );
}

export const STATUS_LABELS = LABELS;
