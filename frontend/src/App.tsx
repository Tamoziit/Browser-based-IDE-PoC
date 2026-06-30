import { Routes, Route, Navigate } from "react-router-dom";
import { AuthContextProvider } from "./context/AuthContext";
import { SocketContextProvider } from "./context/SocketContext";
import LabSelectionPage from "./pages/LabSelectionPage";
import LabPage from "./pages/LabPage";
import type { LabType } from "./interfaces";

/** Guard: only allow known labType values in the URL */
const VALID_LAB_TYPES: LabType[] = ["RO_EXEC", "RWX"];

function App() {
  return (
    <AuthContextProvider>
      <SocketContextProvider>
        <Routes>
          {/* Selection screen */}
          <Route path="/" element={<LabSelectionPage />} />

          {/* Lab screen — labType comes from the URL param */}
          <Route
            path="/lab/:labType"
            element={<LabPage />}
          />

          {/* Catch-all — unknown paths go back to selection */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SocketContextProvider>
    </AuthContextProvider>
  );
}

export { VALID_LAB_TYPES };
export default App;