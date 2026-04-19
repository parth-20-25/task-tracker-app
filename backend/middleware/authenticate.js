const { verifyToken } = require("../auth");
const { getAuthenticatedUser } = require("../services/authService");

async function authenticate(req, res, next) {
  verifyToken(req, res, async (verifyError) => {
    if (verifyError) {
      return next(verifyError);
    }

    try {
      req.user = await getAuthenticatedUser(req.auth.employee_id);
      return next();
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = {
  authenticate,
};
