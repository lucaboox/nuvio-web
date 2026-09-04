import { useLayoutEffect, useRef, useState } from "react";
import { descriptionOverflows } from "./descriptionOverflow";

export function useDescriptionOverflow(text: string | undefined, expanded: boolean) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let live = true;
    const measure = () => {
      if (!live) return;
      const style = getComputedStyle(element);
      setOverflows(!!text && element.clientWidth > 0 && descriptionOverflows(
        element.scrollHeight, parseFloat(style.lineHeight),
        Number(style.getPropertyValue("--description-lines")),
      ));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    void document.fonts?.ready.then(measure);
    document.fonts?.addEventListener("loadingdone", measure);
    return () => {
      live = false;
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [text, expanded]);
  return { ref, overflows };
}
