import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SignIn from "./pages/SignIn";
import AuthCallback from "./pages/AuthCallback";
import "./styles/globals.css";

function route() {
  const path = location.pathname;
  if (path.startsWith("/signin")) return <SignIn />;
  if (path.startsWith("/auth/callback")) return <AuthCallback />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{route()}</React.StrictMode>,
);
