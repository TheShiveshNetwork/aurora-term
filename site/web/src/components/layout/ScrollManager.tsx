import { useEffect } from "react";

const HEADER_OFFSET = 88;

function scrollToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

function scrollToElement(el: HTMLElement) {
  const top = el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;
  window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
}

function scrollToHash(hash: string) {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    // keep the raw id on malformed sequences
  }
  if (!id) {
    scrollToTop();
    return;
  }

  scrollToTop();

  let attempts = 0;
  const attempt = () => {
    const el = document.getElementById(id);
    if (el) {
      scrollToElement(el);
      return;
    }
    if (attempts++ < 40) {
      requestAnimationFrame(attempt);
    }
  };
  attempt();
}

export function ScrollManager({ pathname = "" }: { pathname?: string }) {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      scrollToHash(hash);
    } else {
      scrollToTop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}