import mongoose from "mongoose";

export async function connectToMongoDB(): Promise<void> {
    const url = process.env.MONGO_URL!;

    mongoose.connection.on("connected", () => console.log("[Mongo] Connected"));
    mongoose.connection.on("error", (err) => console.error("[Mongo] Error:", err));

    await mongoose.connect(url);
}