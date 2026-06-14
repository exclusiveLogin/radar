import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./app/AppShell";
import { AdminAppShell } from "./admin/AdminAppShell";
import { AppLogOverlay } from "./widgets/map-log/AppLogOverlay";

/** Корень приложения: `/` — карта обстановки, `/admin` — админ-панель. */
export function App() {
  return (
    <BrowserRouter>
      <AppLogOverlay />
      <Routes>
        <Route path="/" element={<AppShell />} />
        <Route path="/admin" element={<AdminAppShell />} />
      </Routes>
    </BrowserRouter>
  );
}
