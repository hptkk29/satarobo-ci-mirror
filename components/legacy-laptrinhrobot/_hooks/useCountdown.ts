"use client";
import { useEffect, useState } from "react";
import { getNextDeadline, getTimeRemaining, type TimeRemaining } from "../_utils/deadlines";

export default function useCountdown(): { deadline: Date; timeLeft: TimeRemaining } {
  const [deadline, setDeadline] = useState<Date>(getNextDeadline());
  const [timeLeft, setTimeLeft] = useState<TimeRemaining>(getTimeRemaining(deadline));

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = getTimeRemaining(deadline);
      setTimeLeft(remaining);

      if (remaining.expired) {
        const newDeadline = getNextDeadline();
        setDeadline(newDeadline);
        setTimeLeft(getTimeRemaining(newDeadline));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [deadline]);

  return { deadline, timeLeft };
}
