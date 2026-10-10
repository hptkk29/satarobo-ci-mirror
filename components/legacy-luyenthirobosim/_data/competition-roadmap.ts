export interface CompetitionStage {
  icon: string;
  title: string;
  subtitle: string;
  date: string;
  color: string;
  isCurrent: boolean;
}

export const competitionStages: CompetitionStage[] = [
  {
    icon: "🥉",
    title: "VÒNG LOẠI",
    subtitle: "RBT2026",
    date: "26/07/2026",
    color: "urgent",
    isCurrent: true,
  },
  {
    icon: "🥈",
    title: "VÒNG KHU VỰC",
    subtitle: "",
    date: "13 & 20/09/2026",
    color: "warning",
    isCurrent: false,
  },
  {
    icon: "🥇",
    title: "CHUNG KẾT",
    subtitle: "QUỐC GIA",
    date: "23 → 25/10/2026",
    color: "r1-primary",
    isCurrent: false,
  },
  {
    icon: "🌍",
    title: "CHUNG KẾT",
    subtitle: "THẾ GIỚI",
    date: "Dự kiến 12/2026 → 01/2027",
    color: "r2-primary",
    isCurrent: false,
  },
];
