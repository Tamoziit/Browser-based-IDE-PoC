import { createContext, useContext, useEffect, useState } from "react";
import type { AuthContextType, AuthProviderProps, AuthUser } from "../interfaces";

// Keys used by the trusted auth module to persist session data
const DN_USER_KEY = "DN-user";
const DN_TOKEN_KEY = "DN-token";

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuthContext = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuthContext must be used within an AuthContextProvider");
    }
    return context;
};

export const AuthContextProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [authUser, setAuthUser] = useState<AuthUser | null>(null);
    const [token, setToken] = useState<string | null>(null);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(DN_USER_KEY);
            const storedToken = localStorage.getItem(DN_TOKEN_KEY);

            if (raw) {
                const user = JSON.parse(raw) as AuthUser;
                setAuthUser(user);
            }
            if (storedToken) {
                setToken(storedToken);
            }
        } catch (err) {
            console.error("[AuthContext] Failed to load DN-user from localStorage:", err);
        }
    }, []);

    return (
        <AuthContext.Provider value={{ authUser, token }}>
            {children}
        </AuthContext.Provider>
    );
};
