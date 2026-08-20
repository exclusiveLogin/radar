import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export type AccordionItem = {
  id: string;
  head: ReactNode;
  body: ReactNode;
  /** Полный текст при наведении на заголовок секции. */
  headTip?: string;
};

type AccordionProps = {
  items: AccordionItem[];
  defaultOpenId?: string;
};

function toggleKey(event: KeyboardEvent, toggle: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggle();
}

/**
 * Аккордеон: одна открытая секция.
 * Head — div[role=button], чтобы внутри можно было ставить настоящие button (jump, chips).
 */
export function Accordion({ items, defaultOpenId }: AccordionProps) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenId ?? null);

  return (
    <div className="ds-accordion">
      {items.map((item) => {
        const isOpen = item.id === openId;
        const toggle = () => setOpenId(isOpen ? null : item.id);

        return (
          <div key={item.id} className={`ds-accordion__item${isOpen ? " is-open" : ""}`}>
            <div
              className="ds-accordion__head"
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              title={item.headTip}
              onClick={toggle}
              onKeyDown={(event) => toggleKey(event, toggle)}
            >
              <span className="ds-accordion__chevron" aria-hidden />
              <div className="ds-accordion__head-content">{item.head}</div>
            </div>
            {isOpen && <div className="ds-accordion__body">{item.body}</div>}
          </div>
        );
      })}
    </div>
  );
}
