const PRODUCTION_WEB_AUTH_URL = "https://aurora.shitworks.co/signin";

export const WEB_AUTH_URL =
  import.meta.env.DEV && import.meta.env.VITE_WEB_AUTH_URL
    ? import.meta.env.VITE_WEB_AUTH_URL
    : PRODUCTION_WEB_AUTH_URL;
