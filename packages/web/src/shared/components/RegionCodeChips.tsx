import { selectRegion, selectedRegion$ } from "../state/selectionStore";
import { useObservable } from "../hooks/useObservable";

type Props = {
  codes: string[];
  /** Подпись над рядом чипов (например «По сообщению»). */
  label?: string;
  /** В строке аккордеона — без колонки, короткий код (TUL вместо RU-TUL). */
  inline?: boolean;
  /** Клик по чипу: по умолчанию selectRegion + подсветка на картах. */
  onSelect?: (code: string) => void;
};

function chipLabel(code: string, inline: boolean): string {
  if (!inline) return code;
  return code.startsWith("RU-") ? code.slice(3) : code;
}

/** ISO-коды регионов компактными кликабельными чипами. */
export function RegionCodeChips({ codes, label, inline = false, onSelect }: Props) {
  const selected = useObservable(selectedRegion$, null);
  const unique = [...new Set(codes.filter(Boolean))];
  if (unique.length === 0) return null;

  const pick = onSelect ?? ((code: string) => selectRegion(code));

  return (
    <div className={`ds-region-chips${inline ? " ds-region-chips--inline" : ""}`}>
      {label ? <span className="ds-region-chips__label">{label}</span> : null}
      <div className="ds-region-chips__row" role="list">
        {unique.map((code) => {
          const isSelected = selected === code;
          return (
            <button
              key={code}
              type="button"
              role="listitem"
              className={`ds-region-chip${isSelected ? " ds-region-chip--selected" : ""}`}
              title={code}
              onClick={(event) => {
                event.stopPropagation();
                pick(code);
              }}
            >
              {chipLabel(code, inline)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
