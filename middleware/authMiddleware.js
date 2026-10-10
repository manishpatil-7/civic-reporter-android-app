import jwt from "jsonwebtoken";

export const protectAuthority = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Not authorized, token missing" });
    }

    const token = authHeader.split(" ")[1];
    if (!process.env.JWT_SECRET) {
      console.error("FATAL: JWT_SECRET environment variable is not set");
      return res.status(500).json({ message: "Server configuration error" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    req.authority = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Not authorized, invalid token" });
  }
};
