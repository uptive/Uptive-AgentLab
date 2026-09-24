import { useLayoutEffect, useRef } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { theme } from "../theme.js";
import { DEMO_COLORS, useEditorContext } from "./EditorContext.js";

/** Bezier edge that, during a demo run, shows a "handoff" token travelling to the next step. */
export function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected }: EdgeProps) {
  const { demo } = useEditorContext();
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const progress = demo?.edges[id];
  const inFlight = progress !== undefined && progress < 1;

  const pathRef = useRef<SVGPathElement>(null);
  const tokenRef = useRef<SVGCircleElement>(null);
  useLayoutEffect(() => {
    if (!inFlight || !pathRef.current || !tokenRef.current) return;
    const p = pathRef.current.getPointAtLength(pathRef.current.getTotalLength() * progress);
    tokenRef.current.setAttribute("cx", String(p.x));
    tokenRef.current.setAttribute("cy", String(p.y));
  }, [inFlight, progress, path]);

  const stroke = !demo ? (selected ? DEMO_COLORS.done : theme.edge) : progress === 1 ? DEMO_COLORS.done : inFlight ? DEMO_COLORS.running : DEMO_COLORS.idle;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke, strokeWidth: selected ? 3 : 2, transition: "stroke 200ms" }} />
      {inFlight ? (
        <>
          <path ref={pathRef} d={path} fill="none" stroke="none" />
          <circle ref={tokenRef} r={6} fill={DEMO_COLORS.running} style={{ filter: `drop-shadow(0 0 4px ${DEMO_COLORS.running})` }} />
        </>
      ) : null}
    </>
  );
}
