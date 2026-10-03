"use client";
import { useEffect, useState } from "react";
/** Due dates and local study-day rollover can change without an IndexedDB write. */
export function useClock() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const advance = () => setTick((value) => value + 1);
    const timer = setInterval(advance, 15000);
    window.addEventListener("focus", advance);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", advance);
    };
  }, []);
  return tick;
}
