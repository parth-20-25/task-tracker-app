const jwt = require("jsonwebtoken");
const { env } = require("./config/env");

function getJwtSecret() {
  if (!env.jwtSecret) {
    throw new Error("JWT_SECRET is required for authentication.");
  }

  return env.jwtSecret;
}

function generateToken(employeeId) {
  return jwt.sign({ employee_id: employeeId }, getJwtSecret(), { expiresIn: env.jwtExpiresIn });
}

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      error: "No token provided",
      details: null,
    });
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      success: false,
      error: "Malformed authorization header",
      details: null,
    });
  }

  try {
    req.auth = jwt.verify(token, getJwtSecret());
    if (!req.auth || typeof req.auth.employee_id !== "string" || !req.auth.employee_id.trim()) {
      return res.status(401).json({
        success: false,
        error: "Invalid token",
        details: null,
      });
    }
    return next();
  } catch (_error) {
    return res.status(401).json({
      success: false,
      error: "Invalid token",
      details: null,
    });
  }
}

module.exports = {
  generateToken,
  verifyToken,
};
