interface DataLayerEvent {
  event: string;
  page_location: string;
  page_path: string;
  page_title: string;
}

declare global {
  interface Window {
    dataLayer?: DataLayerEvent[];
  }
}

export function trackPageView(pathname: string): void {
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({
    event: "page_view",
    page_location: window.location.href,
    page_path: `${pathname}${window.location.search}`,
    page_title: document.title,
  });
}
