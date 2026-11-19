import type { CSSProperties } from "react";
import "./skeleton.css";

type SkeletonProps = {
  width?: string;
  height?: string;
  radius?: string;
  style?: CSSProperties;
};

export default function Skeleton({
  width = "100%",
  height = "20px",
  radius = "10px",
  style,
}: SkeletonProps) {
  return (
    <div
      className="manemi-skeleton"
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}
