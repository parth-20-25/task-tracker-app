const jwt = require("jsonwebtoken");
const { env } = require("./config/env");

function generateToken(employeeId) {
  return jwt.sign({ employee_id: employeeId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "No token provided", details: null });
  }

  const [, token] = authHeader.split(" ");

  if (!token) {
    return res.status(401).json({ error: "Malformed authorization header", details: null });
  }

  try {
    req.auth = jwt.verify(token, env.jwtSecret);
    return next();
  } catch (_error) {
    return res.status(403).json({ error: "Invalid token", details: null });
  }
}

module.exports = {
  generateToken,
  verifyToken,
};
