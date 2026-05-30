import { useState } from "react";
import type { ReactNode } from "react";

export type AccordionItem = {
  id: string;
  head: ReactNode;
  body: ReactNode;
};

type AccordionProps = {
  items: AccordionItem[];
  defaultOpenId?: string;
};

/** Простой аккордеон: одна открытая секция за раз. */
export function Accordion({ items, defaultOpenId }: AccordionProps) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenId ?? null);
  return (
    <div className="ds-accordion">
      {items.map((item) => {
        const isOpen = item.id === openId;
        return (
          <div key={item.id} className="ds-accordion__item">
            <button
              type="button"
              className="ds-accordion__head"
              onClick={() => setOpenId(isOpen ? null : item.id)}
            >
              <span>{isOpen ? "▾" : "▸"}</span>
              {item.head}
            </button>
            {isOpen && <div className="ds-accordion__body">{item.body}</div>}
          </div>
        );
      })}
    </div>
  );
}
