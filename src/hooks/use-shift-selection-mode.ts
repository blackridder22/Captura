import { useEffect, useState } from "react";

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function useShiftSelectionMode() {
  const [shiftHeld, setShiftHeld] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift" && !isEditableTarget(event.target)) {
        setShiftHeld(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShiftHeld(false);
    };
    const reset = () => setShiftHeld(false);
    const handleVisibilityChange = () => {
      if (document.hidden) reset();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return shiftHeld;
}
