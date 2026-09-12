"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface View {
  end: number; // exclusive index — right edge of the window
  span: number; // months shown
}

export function clampView(end: number, span: number, total: number): View {
  const s = Math.min(Math.max(1, span), Math.max(1, total));
  const e = Math.min(Math.max(s, end), total);
  return { end: e, span: s };
}

/**
 * Window state shared by the analytics charts: a span of months ending at
 * `view.end`, with pan (move the window) and zoom (resize the span). Each chart
 * keeps its own window, so they navigate independently. Opens on the most
 * recent `defaultSpan` months once the data arrives.
 */
export function useMonthWindow(total: number, defaultSpan: number) {
  const [view, setView] = useState<View>({ end: 0, span: 1 });
  const totalRef = useRef(0);
  const inited = useRef(false);

  useEffect(() => {
    totalRef.current = total;
    if (total > 0 && !inited.current) {
      inited.current = true;
      setView(clampView(total, Math.min(defaultSpan, total), total));
    }
  }, [total, defaultSpan]);

  const pan = useCallback(
    (dir: number) => setView((v) => clampView(v.end + dir, v.span, totalRef.current)),
    []
  );
  const zoom = useCallback(
    (dir: number) => setView((v) => clampView(v.end, v.span + dir, totalRef.current)),
    []
  );
  const panTo = useCallback(
    (end: number) => setView((v) => clampView(end, v.span, totalRef.current)),
    []
  );

  return {
    view,
    startIdx: Math.max(0, view.end - view.span),
    pan,
    zoom,
    panTo,
    canEarlier: view.end - view.span > 0,
    canLater: view.end < total,
    canZoomIn: view.span > 1,
    canZoomOut: view.span < total,
  };
}
