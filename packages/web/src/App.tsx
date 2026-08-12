import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./app/AppShell";
import { AdminAppShell } from "./admin/AdminAppShell";

/** Корень приложения: `/` — карта обстановки, `/admin` — админ-панель. */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />} />
        <Route path="/admin" element={<AdminAppShell />} />
      </Routes>
    </BrowserRouter>
  );
}
