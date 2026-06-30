import { createContext, useContext, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuthContext } from "./AuthContext";
import type { SocketContextType, SocketProviderProps } from "../interfaces";

export const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const useSocketContext = (): SocketContextType => {
    const context = useContext(SocketContext);
    if (!context) {
        throw new Error("useSocketContext must be used within a SocketContextProvider");
    }
    return context;
};

export const SocketContextProvider: React.FC<SocketProviderProps> = ({ children }) => {
    const { authUser } = useAuthContext();
    const [socket, setSocket] = useState<Socket | null>(null);

    // VITE_SOCKET_URL must be set in .env (e.g. http://localhost:3001)
    const socketUrl = import.meta.env.VITE_SOCKET_URL as string;

    useEffect(() => {
        if (authUser) {
            const newSocket = io(socketUrl, {
                query: {
                    userId: authUser._id,
                },
                transports: ["websocket", "polling"],
            });

            setSocket(newSocket);

            return () => {
                newSocket.close();
                setSocket(null);
            };
        } else {
            // No authenticated user — close any stale socket
            setSocket((prev) => {
                if (prev) {
                    prev.close();
                }
                return null;
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authUser]);

    return (
        <SocketContext.Provider value={{ socket }}>
            {children}
        </SocketContext.Provider>
    );
};
