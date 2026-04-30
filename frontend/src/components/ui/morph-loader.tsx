import * as React from "react";

import { cn } from "@/lib/utils";

import styles from "./morph-loader.module.css";

export type MorphLoaderProps = {
  size?: number | string;
  color?: string;
  duration?: string;
  className?: string;
};

const DEFAULT_SIZE = 36;
const DEFAULT_COLOR = "#D4537E";
const DEFAULT_DURATION = "2.4s";

const resolveSize = (size: number | string): string => {
  if (typeof size === "number") {
    return `${size}px`;
  }

  return size;
};

export const MorphLoader = ({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
  duration = DEFAULT_DURATION,
  className,
}: MorphLoaderProps) => {
  const inlineSize = resolveSize(size);

  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(styles.root, className)}
      style={
        {
          "--morph-loader-size": inlineSize,
          "--morph-loader-color": color,
          "--morph-loader-duration": duration,
        } as React.CSSProperties
      }
    >
      <span aria-hidden="true" className={styles.shape} />
    </span>
  );
};
