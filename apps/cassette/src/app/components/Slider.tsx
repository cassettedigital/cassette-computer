"use client";

/**
 * Slider + RangeSlider — mixing-console faders (graduated from the kit). RA
 * Slider: recessed graduated channel, amber LED fill, milled fader cap.
 * Controllable via value/defaultValue/onChange.
 */

import {
  Slider as AriaSlider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
} from "react-aria-components";
import styles from "./FormControls.module.css";

export function Slider({
  label,
  defaultValue = 60,
  minValue = 0,
  maxValue = 100,
  step = 1,
  value,
  onChange,
  formatValue = (v: number) => `${v}`,
  /** When set, draw a labeled stop at each value (replaces the decorative track ticks). */
  marks,
}: {
  label: string;
  defaultValue?: number;
  minValue?: number;
  maxValue?: number;
  step?: number;
  value?: number;
  onChange?: (v: number) => void;
  formatValue?: (v: number) => string;
  marks?: { value: number; label: string }[];
}) {
  const span = Math.max(1, maxValue - minValue);
  return (
    <AriaSlider
      className={styles.slider}
      defaultValue={defaultValue}
      value={value}
      onChange={onChange}
      minValue={minValue}
      maxValue={maxValue}
      step={step}
      aria-label={label}
    >
      <div className={styles.sliderHead}>
        <span className={styles.sliderLabel}>{label}</span>
        <SliderOutput className={styles.sliderOut}>
          {({ state }) => formatValue(Number(state.getThumbValue(0)))}
        </SliderOutput>
      </div>
      <SliderTrack
        className={[styles.sliderTrack, marks ? styles.sliderTrackMarked : null]
          .filter(Boolean)
          .join(" ")}
      >
        {({ state }) => (
          <>
            <span className={styles.sliderRail} />
            <span
              className={styles.sliderFill}
              style={{ width: `${state.getThumbPercent(0) * 100}%` }}
            />
            {marks?.map((m) => (
              <span
                key={m.value}
                className={styles.sliderMarkTick}
                style={{ left: `${((m.value - minValue) / span) * 100}%` }}
                aria-hidden="true"
              />
            ))}
            <SliderThumb className={styles.sliderThumb} />
          </>
        )}
      </SliderTrack>
      {marks && marks.length > 0 ? (
        <div className={styles.sliderMarks} aria-hidden="true">
          {marks.map((m) => (
            <span key={m.value} className={styles.sliderMarkLabel}>
              {m.label}
            </span>
          ))}
        </div>
      ) : null}
    </AriaSlider>
  );
}

export function RangeSlider({
  label,
  defaultValue = [25, 75],
  minValue = 0,
  maxValue = 100,
  value,
  onChange,
  formatValue = (v: number) => `${v}`,
}: {
  label: string;
  defaultValue?: number[];
  minValue?: number;
  maxValue?: number;
  value?: number[];
  onChange?: (v: number[]) => void;
  formatValue?: (v: number) => string;
}) {
  return (
    <AriaSlider
      className={styles.slider}
      defaultValue={defaultValue}
      value={value}
      onChange={onChange as (v: number | number[]) => void}
      minValue={minValue}
      maxValue={maxValue}
      aria-label={label}
    >
      <div className={styles.sliderHead}>
        <span className={styles.sliderLabel}>{label}</span>
        <SliderOutput className={styles.sliderOut}>
          {({ state }) =>
            `${formatValue(Number(state.getThumbValue(0)))} – ${formatValue(Number(state.getThumbValue(1)))}`
          }
        </SliderOutput>
      </div>
      <SliderTrack className={styles.sliderTrack}>
        {({ state }) => (
          <>
            <span className={styles.sliderRail} />
            <span
              className={styles.sliderFill}
              style={{
                left: `${state.getThumbPercent(0) * 100}%`,
                width: `${(state.getThumbPercent(1) - state.getThumbPercent(0)) * 100}%`,
              }}
            />
            <SliderThumb index={0} className={styles.sliderThumb} />
            <SliderThumb index={1} className={styles.sliderThumb} />
          </>
        )}
      </SliderTrack>
    </AriaSlider>
  );
}
