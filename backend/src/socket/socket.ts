import { Server as SocketServer } from "socket.io";
import type { Server as HttpServer } from "http";

let io: SocketServer;

const initSocketServer = (httpServer: HttpServer): SocketServer => {
    io = new SocketServer(httpServer, {
        cors: {
            origin: "*",
        },
        transports: ["websocket", "polling"],
    });

    return io;
};

export default initSocketServer;