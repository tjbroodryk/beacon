/** @jsxImportSource react */
// A plain React component using a Radix primitive, rendered in a beacon view through <ReactIsland>.
import * as Slider from '@radix-ui/react-slider';

export function RowCount(props: { value: number; onChange: (rows: number) => void }) {
  return (
    <Slider.Root
      className="slider"
      min={1_000}
      max={500_000}
      step={1_000}
      value={[props.value]}
      onValueChange={([rows]) => {
        if (rows !== undefined) {
          props.onChange(rows);
        }
      }}
    >
      <Slider.Track className="slider-track">
        <Slider.Range className="slider-range" />
      </Slider.Track>
      <Slider.Thumb className="slider-thumb" aria-label="number of rows" />
    </Slider.Root>
  );
}
